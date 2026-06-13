"""
2EasyMarketing — Advanced Security Engine v1.0
Codename: FORTRESS

7-Layer defense system:
  L1  Rate limiting (per-IP, per-endpoint, global)
  L2  IP intelligence (blocklist, Tor, datacenter, geo)
  L3  Request fingerprinting (bot/scanner detection)
  L4  Payload inspection (SQLi, XSS, RCE, traversal, SSRF)
  L5  Behavioral analysis (velocity, anomaly, timing)
  L6  Honeypot & deception (trap endpoints, canary tokens)
  L7  Threat intelligence (logging, alerting, auto-ban)
"""

import re
import time
import hashlib
import hmac
import json
import asyncio
import ipaddress
import os
import sqlite3
import threading
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from typing import Optional
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# ─── Constants ───────────────────────────────────────────────────────────────

SECURITY_DB_PATH = os.getenv("SECURITY_DB_PATH", "/app/security.db")
MAX_BODY_SIZE     = 512 * 1024          # 512 KB max request body
BLOCK_TTL         = 3600 * 24           # 24 hours auto-block
TEMP_BLOCK_TTL    = 900                 # 15 min temp block
HONEYPOT_BLOCK_TTL = 3600 * 24 * 7     # 7-day perma-ban for honeypot triggers
RATE_WINDOW       = 60                  # seconds
RATE_LIMIT_DEFAULT = 120               # requests per window per IP
RATE_LIMIT_AUTH   = 10                  # login attempts per window per IP
RATE_LIMIT_API    = 300                 # API calls per window per IP
RATE_LIMIT_GLOBAL = 5000               # global requests per window

OWNER_SECRET_KEY  = os.getenv("OWNER_SECRET_KEY", "2em_fortress_2026")

# ─── Thread-safe in-memory stores ────────────────────────────────────────────

_lock = threading.RLock()

# { ip: deque([timestamp, ...]) }
_rate_windows: dict[str, deque] = defaultdict(lambda: deque())
_auth_windows: dict[str, deque] = defaultdict(lambda: deque())

# { ip: unblock_timestamp }
_blocked_ips: dict[str, float] = {}

# { ip: { endpoint: deque([ts,...]) } }
_endpoint_windows: dict[str, dict] = defaultdict(lambda: defaultdict(lambda: deque()))

# Behavioral: { ip: { "requests": [...], "user_agents": set(), "paths": set() } }
_behavior: dict[str, dict] = defaultdict(lambda: {
    "requests": deque(maxlen=200),
    "user_agents": set(),
    "paths": set(),
    "error_count": 0,
    "scan_score": 0,
    "first_seen": time.time(),
})

# Global request counter
_global_window: deque = deque()

# ─── Database setup ───────────────────────────────────────────────────────────

def get_security_db() -> sqlite3.Connection:
    conn = sqlite3.connect(SECURITY_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_security_db():
    conn = get_security_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS threat_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          REAL NOT NULL,
                ip          TEXT NOT NULL,
                threat_type TEXT NOT NULL,
                severity    TEXT NOT NULL,  -- low/medium/high/critical
                path        TEXT,
                method      TEXT,
                payload     TEXT,
                user_agent  TEXT,
                action      TEXT,           -- blocked/logged/honeypot
                details     TEXT
            );

            CREATE TABLE IF NOT EXISTS blocked_ips (
                ip          TEXT PRIMARY KEY,
                reason      TEXT,
                blocked_at  REAL NOT NULL,
                unblock_at  REAL,           -- NULL = permanent
                block_count INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS honeypot_hits (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          REAL NOT NULL,
                ip          TEXT NOT NULL,
                path        TEXT NOT NULL,
                method      TEXT,
                payload     TEXT,
                headers     TEXT
            );

            CREATE TABLE IF NOT EXISTS security_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          REAL NOT NULL,
                event_type  TEXT NOT NULL,
                ip          TEXT,
                data        TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_threat_ip   ON threat_log(ip);
            CREATE INDEX IF NOT EXISTS idx_threat_ts   ON threat_log(ts);
            CREATE INDEX IF NOT EXISTS idx_blocked_ip  ON blocked_ips(ip);
        """)
        conn.commit()

        # Load persistent blocks into memory
        rows = conn.execute("SELECT ip, unblock_at FROM blocked_ips WHERE unblock_at IS NULL OR unblock_at > ?", (time.time(),)).fetchall()
        with _lock:
            for row in rows:
                _blocked_ips[row["ip"]] = row["unblock_at"] or float("inf")
    finally:
        conn.close()

# ─── L1: Rate Limiter ────────────────────────────────────────────────────────

def _clean_window(dq: deque, window: int = RATE_WINDOW):
    cutoff = time.time() - window
    while dq and dq[0] < cutoff:
        dq.popleft()

def check_rate_limit(ip: str, endpoint_type: str = "default") -> tuple[bool, str]:
    """Returns (is_allowed, reason). False = block."""
    now = time.time()
    with _lock:
        # Global rate
        _clean_window(_global_window)
        _global_window.append(now)
        if len(_global_window) > RATE_LIMIT_GLOBAL:
            return False, "global_rate_exceeded"

        # Per-IP rate
        dq = _rate_windows[ip]
        _clean_window(dq)
        dq.append(now)

        limit = {
            "auth": RATE_LIMIT_AUTH,
            "api":  RATE_LIMIT_API,
        }.get(endpoint_type, RATE_LIMIT_DEFAULT)

        if len(dq) > limit:
            return False, f"rate_limit_{endpoint_type}"

    return True, "ok"

# ─── L2: IP Intelligence ─────────────────────────────────────────────────────

# Known malicious CIDR ranges (datacenter/hosting abuse, known scanners)
_MALICIOUS_CIDRS = [
    # Shodan scanner IPs
    "198.20.69.0/24", "198.20.70.0/24", "198.20.74.0/24", "198.20.99.0/24",
    "198.20.143.0/24", "208.180.20.0/24",
    # Common scanner/abuse ranges
    "89.248.160.0/19",   # Shodan/LeakIX
    "93.174.88.0/21",    # Shodan
    "5.188.86.0/24",     # Known scanner
    "185.220.100.0/22",  # Tor exit
    "185.220.101.0/24",  # Tor exit
    "185.220.102.0/23",  # Tor exit
    "199.87.154.0/24",   # Known spam
    "45.141.84.0/22",    # Brute force origin
]

_MALICIOUS_NETWORKS = []

def _build_malicious_networks():
    global _MALICIOUS_NETWORKS
    _MALICIOUS_NETWORKS = []
    for cidr in _MALICIOUS_CIDRS:
        try:
            _MALICIOUS_NETWORKS.append(ipaddress.ip_network(cidr, strict=False))
        except Exception:
            pass

def is_ip_malicious_cidr(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return any(addr in net for net in _MALICIOUS_NETWORKS)
    except Exception:
        return False

def is_ip_blocked(ip: str) -> tuple[bool, str]:
    """Check in-memory block list."""
    with _lock:
        unblock_at = _blocked_ips.get(ip)
        if unblock_at is None:
            return False, ""
        if unblock_at == float("inf"):
            return True, "permanent_ban"
        if time.time() < unblock_at:
            return True, "temporary_ban"
        # Expired — remove
        del _blocked_ips[ip]
        return False, ""

def block_ip(ip: str, reason: str, ttl: Optional[float] = BLOCK_TTL, permanent: bool = False):
    """Block an IP with optional TTL."""
    now = time.time()
    unblock_at = None if permanent else now + (ttl or BLOCK_TTL)

    with _lock:
        _blocked_ips[ip] = unblock_at or float("inf")

    # Persist to DB
    def _persist():
        try:
            conn = get_security_db()
            existing = conn.execute("SELECT block_count FROM blocked_ips WHERE ip=?", (ip,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE blocked_ips SET reason=?, blocked_at=?, unblock_at=?, block_count=block_count+1 WHERE ip=?",
                    (reason, now, unblock_at, ip)
                )
            else:
                conn.execute(
                    "INSERT INTO blocked_ips (ip, reason, blocked_at, unblock_at, block_count) VALUES (?,?,?,?,1)",
                    (ip, reason, now, unblock_at)
                )
            conn.commit()
            conn.close()
        except Exception:
            pass
    threading.Thread(target=_persist, daemon=True).start()

# ─── L3: Request Fingerprinting ──────────────────────────────────────────────

# Bot/scanner user-agent patterns
_BOT_UA_PATTERNS = [
    r"(?i)sqlmap", r"(?i)nikto", r"(?i)nmap", r"(?i)masscan",
    r"(?i)zgrab", r"(?i)dirbuster", r"(?i)gobuster", r"(?i)wfuzz",
    r"(?i)hydra", r"(?i)medusa", r"(?i)metasploit", r"(?i)burpsuite",
    r"(?i)nessus", r"(?i)acunetix", r"(?i)appscan", r"(?i)webscarab",
    r"(?i)openvas", r"(?i)qualys", r"(?i)w3af", r"(?i)skipfish",
    r"(?i)httperf", r"(?i)ab/\d",         # Apache Bench
    r"(?i)siege/\d", r"(?i)wrk/\d",       # load testers
    r"(?i)python-requests/\d+\.[01]\.",    # old requests versions used by scanners
    r"(?i)go-http-client/1\.1$",           # bare Go client (scanners)
    r"(?i)curl/[0-6]\.",                   # old curl (automated)
    r"(?i)libwww-perl",
    r"(?i)lwp-trivial",
    r"(?i)jakarta commons-httpclient",
    r"(?i)masscan",
    r"(?i)zgrab",
    r"(?i)^-$",                            # empty/dash UA
    r"(?i)test|scanner|exploit|attack|hack|pentest",
]
_BOT_UA_RE = [re.compile(p) for p in _BOT_UA_PATTERNS]

# Suspicious headers patterns
_SUSPICIOUS_HEADERS = [
    "x-forwarded-for",  # Can be spoofed for IP bypass — we log but don't trust
]

def fingerprint_request(request: Request) -> tuple[int, list[str]]:
    """
    Returns (suspicion_score, [reasons]).
    Score 0 = clean. Score >= 10 = block.
    """
    score = 0
    reasons = []
    ua = request.headers.get("user-agent", "")

    # No user agent
    if not ua or ua.strip() in ("-", ""):
        score += 8
        reasons.append("no_user_agent")

    # Bot UA match
    for pattern in _BOT_UA_RE:
        if pattern.search(ua):
            score += 15
            reasons.append(f"bot_ua:{pattern.pattern[:30]}")
            break

    # Missing standard browser headers
    if not request.headers.get("accept"):
        score += 3
        reasons.append("missing_accept_header")
    if not request.headers.get("accept-language") and not ua.startswith("curl"):
        score += 2
        reasons.append("missing_accept_language")

    # Suspicious header combinations
    if request.headers.get("x-scan") or request.headers.get("x-nessus-id"):
        score += 20
        reasons.append("scanner_header_detected")

    # Oversized or missing content-type on POST
    if request.method == "POST":
        ct = request.headers.get("content-type", "")
        if not ct:
            score += 4
            reasons.append("post_no_content_type")

    return score, reasons

# ─── L4: Payload Inspection ──────────────────────────────────────────────────

# SQL Injection patterns
_SQLI_PATTERNS = [
    r"(?i)(\b(union|select|insert|update|delete|drop|truncate|alter|create|exec|execute|xp_)\b)",
    r"(?i)(--\s|;--|\/\*.*?\*\/)",
    r"(?i)(\bor\b\s+[\d'\"]+\s*=\s*[\d'\"]+)",
    r"(?i)(\band\b\s+[\d'\"]+\s*=\s*[\d'\"]+)",
    r"(?i)(sleep\s*\(\s*\d+\s*\)|benchmark\s*\(|waitfor\s+delay)",
    r"(?i)(load_file\s*\(|into\s+outfile|into\s+dumpfile)",
    r"(?i)(information_schema|sys\.tables|sysobjects|syscolumns)",
    r"(?i)(char\s*\(\s*\d+|0x[0-9a-f]{4,})",
    r"(?i)(convert\s*\(|cast\s*\(.*\bas\b.*varchar)",
    r"'[\s;]*(or|and)[\s]+'",
]

# XSS patterns
_XSS_PATTERNS = [
    r"(?i)<\s*script[^>]*>",
    r"(?i)<\s*\/\s*script\s*>",
    r"(?i)javascript\s*:",
    r"(?i)vbscript\s*:",
    r"(?i)on(load|error|click|mouse|focus|blur|change|submit|key|input|dbl|context|drag|drop|scroll|resize)\s*=",
    r"(?i)<\s*(iframe|frame|object|embed|applet|meta|link|style)\b",
    r"(?i)expression\s*\(",
    r"(?i)data\s*:\s*text\s*\/\s*html",
    r"(?i)(&#x[0-9a-f]+;|&#\d+;)",
    r"(?i)(<|%3C)\s*(script|img|svg|body|html)",
    r"(?i)\.cookie",
    r"(?i)document\.(write|cookie|location|referrer|domain)",
    r"(?i)window\.(location|open|history)",
    r"(?i)eval\s*\(",
    r"(?i)setTimeout\s*\(\s*['\"]",
    r"(?i)setInterval\s*\(\s*['\"]",
    r"(?i)atob\s*\(",
    r"(?i)fromCharCode\s*\(",
]

# Path traversal
_TRAVERSAL_PATTERNS = [
    r"\.\.[\/\\]",
    r"(?i)%2e%2e[%2f%5c]",
    r"(?i)%252e%252e[%252f%255c]",
    r"(?i)\.\.%2f",
    r"(?i)\.\.%5c",
    r"(?i)(\/etc\/passwd|\/etc\/shadow|\/etc\/hosts)",
    r"(?i)(win\.ini|system32|cmd\.exe|powershell)",
    r"(?i)(\.\.\/)+(etc|proc|sys|dev|var\/log)",
]

# Command injection
_CMD_PATTERNS = [
    r"(?i)(\||&&|;|\$\(|`|>\s*/dev/|>\s*/tmp/)",
    r"(?i)(bash|sh|cmd|powershell|wget|curl|nc|netcat|ncat)\s",
    r"(?i)(\/bin\/|\/usr\/bin\/|\/sbin\/)",
    r"(?i)(chmod|chown|passwd|useradd|adduser)\s",
    r"(?i)(cat\s+\/|ls\s+\/|id;|whoami;|uname\s+-)",
]

# SSRF patterns
_SSRF_PATTERNS = [
    r"(?i)(localhost|127\.0\.0\.\d|0\.0\.0\.0|::1)",
    r"(?i)(169\.254\.\d+\.\d+)",   # AWS metadata
    r"(?i)(192\.168\.\d+\.\d+)",
    r"(?i)(10\.\d+\.\d+\.\d+)",
    r"(?i)(172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)",
    r"(?i)file:\/\/",
    r"(?i)dict:\/\/",
    r"(?i)gopher:\/\/",
    r"(?i)ftp:\/\/.*@",
    r"(?i)metadata\.google\.internal",
    r"(?i)169\.254\.169\.254",      # AWS/GCP/Azure IMDS
]

# Compile all
_SQLI_RE    = [re.compile(p) for p in _SQLI_PATTERNS]
_XSS_RE     = [re.compile(p) for p in _XSS_PATTERNS]
_TRAVERSAL_RE = [re.compile(p) for p in _TRAVERSAL_PATTERNS]
_CMD_RE     = [re.compile(p) for p in _CMD_PATTERNS]
_SSRF_RE    = [re.compile(p) for p in _SSRF_PATTERNS]

def inspect_payload(text: str) -> tuple[str | None, str | None]:
    """
    Returns (threat_type, matched_pattern) or (None, None) if clean.
    """
    checks = [
        ("sqli",      _SQLI_RE),
        ("xss",       _XSS_RE),
        ("traversal", _TRAVERSAL_RE),
        ("cmdi",      _CMD_RE),
        ("ssrf",      _SSRF_RE),
    ]
    for threat_type, patterns in checks:
        for pat in patterns:
            if pat.search(text):
                return threat_type, pat.pattern[:60]
    return None, None

def inspect_path(path: str) -> tuple[str | None, str | None]:
    """Inspect URL path for traversal and known attack paths."""
    attack_paths = [
        (r"(?i)\.(php|asp|aspx|jsp|cgi|pl|sh|bash|py|rb|lua)(\?|$)", "lang_probe"),
        (r"(?i)(\.env|\.git\/|\.svn\/|\.htaccess|wp-admin|wp-login|phpmyadmin|adminer)", "cms_probe"),
        (r"(?i)(\/api\/v\d+\/admin|\/console|\/manager|\/actuator)", "admin_probe"),
        (r"(?i)(xmlrpc\.php|eval-stdin\.php|shell\.php|c99\.php|r57\.php)", "webshell"),
        (r"(?i)(\.\.|%2e%2e)", "traversal"),
    ]
    for pattern, threat_type in attack_paths:
        if re.search(pattern, path):
            return threat_type, pattern[:60]
    return None, None

# ─── L5: Behavioral Analysis ─────────────────────────────────────────────────

def analyze_behavior(ip: str, path: str, ua: str, status_code: int = 200) -> tuple[int, list[str]]:
    """
    Track per-IP behavior over time.
    Returns (anomaly_score, [reasons]).
    """
    score = 0
    reasons = []
    now = time.time()

    with _lock:
        b = _behavior[ip]
        b["requests"].append({"ts": now, "path": path, "status": status_code})
        b["user_agents"].add(ua[:100])
        b["paths"].add(path)

        if status_code >= 400:
            b["error_count"] += 1

        recent = [r for r in b["requests"] if now - r["ts"] < 60]
        recent_errors = [r for r in recent if r["status"] >= 400]
        recent_paths = set(r["path"] for r in recent)

        # Multiple user agents from same IP = likely botnet/spoofing
        if len(b["user_agents"]) > 5:
            score += 6
            reasons.append(f"ua_rotation:{len(b['user_agents'])}")

        # High error rate (scanning for valid paths)
        if len(recent) > 10 and len(recent_errors) / len(recent) > 0.5:
            score += 8
            reasons.append(f"high_error_rate:{len(recent_errors)}/{len(recent)}")

        # Path diversity (scanning many different paths)
        if len(b["paths"]) > 100:
            score += 5
            reasons.append(f"path_scan:{len(b['paths'])}")

        # Rapid unique path enumeration
        if len(recent_paths) > 30:
            score += 7
            reasons.append(f"rapid_path_enum:{len(recent_paths)}")

        # Total error volume
        if b["error_count"] > 50:
            score += 10
            reasons.append(f"total_errors:{b['error_count']}")

    return score, reasons

# ─── L6: Honeypot & Deception ────────────────────────────────────────────────

# These paths look attractive to attackers — any access = instant ban
HONEYPOT_PATHS = {
    "/.env",
    "/.env.local",
    "/.env.production",
    "/.git/config",
    "/.git/HEAD",
    "/wp-admin",
    "/wp-login.php",
    "/wp-admin/",
    "/admin",
    "/admin/login",
    "/phpmyadmin",
    "/phpmyadmin/",
    "/adminer",
    "/adminer.php",
    "/console",
    "/manager/html",
    "/shell.php",
    "/c99.php",
    "/r57.php",
    "/eval-stdin.php",
    "/xmlrpc.php",
    "/actuator",
    "/actuator/env",
    "/actuator/health",
    "/debug",
    "/config.php",
    "/config.js",
    "/backup.zip",
    "/backup.sql",
    "/database.sql",
    "/dump.sql",
    "/db.sql",
    "/test.php",
    "/info.php",
    "/phpinfo.php",
    "/server-status",
    "/server-info",
    "/.DS_Store",
    "/credentials.json",
    "/secrets.json",
    "/api/admin",
    "/api/debug",
    "/api/config",
    "/api/env",
    "/api/shell",
    "/api/execute",
    "/api/v1/admin",
    "/api/v2/admin",
    "/login/admin",
    "/administrator",
    "/root",
    "/setup.php",
    "/install.php",
    "/upgrade.php",
    "/cgi-bin/",
    "/bin/sh",
    "/etc/passwd",
    "/proc/self/environ",
}

def is_honeypot_path(path: str) -> bool:
    """Returns True if path is a honeypot trap."""
    path_lower = path.lower().rstrip("/")
    # Exact match
    if path_lower in HONEYPOT_PATHS or (path_lower + "/") in HONEYPOT_PATHS:
        return True
    # Partial match for common patterns
    honeypot_patterns = [
        r"(?i)(wp-admin|wp-login|phpmyadmin|adminer|c99|r57|shell\.php)",
        r"(?i)(\.git\/|\.svn\/|\.hg\/|\.env)",
        r"(?i)(backup|dump|database)\.(zip|sql|tar|gz|bak)",
        r"(?i)(eval-stdin|webshell|cmd\.php|system\.php)",
        r"(?i)\/actuator\/",
        r"(?i)(\.asp|\.aspx|\.jsp|\.cfm)(\?|$)",
    ]
    for p in honeypot_patterns:
        if re.search(p, path):
            return True
    return False

def log_honeypot_hit(ip: str, path: str, method: str, payload: str, headers: str):
    """Log honeypot trigger and permanently ban the IP."""
    block_ip(ip, f"honeypot:{path}", permanent=True)
    log_threat(ip, "honeypot", "critical", path, method, payload[:500], "", "honeypot_ban",
               f"Triggered trap at {path}")

    def _persist():
        try:
            conn = get_security_db()
            conn.execute(
                "INSERT INTO honeypot_hits (ts, ip, path, method, payload, headers) VALUES (?,?,?,?,?,?)",
                (time.time(), ip, path, method, payload[:1000], headers[:2000])
            )
            conn.commit()
            conn.close()
        except Exception:
            pass
    threading.Thread(target=_persist, daemon=True).start()

# ─── L7: Threat Logging ──────────────────────────────────────────────────────

def log_threat(ip: str, threat_type: str, severity: str, path: str = "",
               method: str = "", payload: str = "", user_agent: str = "",
               action: str = "logged", details: str = ""):
    """Async threat log to DB."""
    def _write():
        try:
            conn = get_security_db()
            conn.execute(
                """INSERT INTO threat_log
                   (ts, ip, threat_type, severity, path, method, payload, user_agent, action, details)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (time.time(), ip, threat_type, severity, path, method,
                 payload[:500], user_agent[:300], action, details)
            )
            conn.commit()
            conn.close()
        except Exception:
            pass
    threading.Thread(target=_write, daemon=True).start()

# ─── Security Stats API ───────────────────────────────────────────────────────

def get_security_stats(hours: int = 24) -> dict:
    """Return security dashboard data."""
    since = time.time() - (hours * 3600)
    try:
        conn = get_security_db()

        total_threats = conn.execute(
            "SELECT COUNT(*) as c FROM threat_log WHERE ts > ?", (since,)
        ).fetchone()["c"]

        by_type = conn.execute(
            "SELECT threat_type, COUNT(*) as c FROM threat_log WHERE ts > ? GROUP BY threat_type ORDER BY c DESC",
            (since,)
        ).fetchall()

        by_severity = conn.execute(
            "SELECT severity, COUNT(*) as c FROM threat_log WHERE ts > ? GROUP BY severity",
            (since,)
        ).fetchall()

        top_ips = conn.execute(
            "SELECT ip, COUNT(*) as c FROM threat_log WHERE ts > ? GROUP BY ip ORDER BY c DESC LIMIT 10",
            (since,)
        ).fetchall()

        blocked_count = conn.execute(
            "SELECT COUNT(*) as c FROM blocked_ips WHERE unblock_at IS NULL OR unblock_at > ?",
            (time.time(),)
        ).fetchone()["c"]

        honeypot_hits = conn.execute(
            "SELECT COUNT(*) as c FROM honeypot_hits WHERE ts > ?", (since,)
        ).fetchone()["c"]

        recent_threats = conn.execute(
            """SELECT ts, ip, threat_type, severity, path, action, details
               FROM threat_log WHERE ts > ?
               ORDER BY ts DESC LIMIT 50""",
            (since,)
        ).fetchall()

        # Hourly distribution
        hourly = conn.execute(
            """SELECT CAST((ts - ?) / 3600 AS INTEGER) as hour_bucket,
               COUNT(*) as c FROM threat_log WHERE ts > ?
               GROUP BY hour_bucket ORDER BY hour_bucket""",
            (since, since)
        ).fetchall()

        conn.close()

        return {
            "total_threats":  total_threats,
            "blocked_ips":    blocked_count,
            "honeypot_hits":  honeypot_hits,
            "by_type":        [dict(r) for r in by_type],
            "by_severity":    [dict(r) for r in by_severity],
            "top_ips":        [dict(r) for r in top_ips],
            "recent_threats": [{
                "ts":          datetime.fromtimestamp(r["ts"], tz=timezone.utc).isoformat(),
                "ip":          r["ip"],
                "threat_type": r["threat_type"],
                "severity":    r["severity"],
                "path":        r["path"],
                "action":      r["action"],
                "details":     r["details"],
            } for r in recent_threats],
            "hourly": [dict(r) for r in hourly],
        }
    except Exception as e:
        return {"error": str(e)}

def get_blocked_ips_list() -> list:
    try:
        conn = get_security_db()
        rows = conn.execute(
            "SELECT ip, reason, blocked_at, unblock_at, block_count FROM blocked_ips ORDER BY blocked_at DESC"
        ).fetchall()
        conn.close()
        return [{
            "ip":         r["ip"],
            "reason":     r["reason"],
            "blocked_at": datetime.fromtimestamp(r["blocked_at"], tz=timezone.utc).isoformat(),
            "unblock_at": datetime.fromtimestamp(r["unblock_at"], tz=timezone.utc).isoformat() if r["unblock_at"] else "permanent",
            "block_count": r["block_count"],
        } for r in rows]
    except Exception:
        return []

def unblock_ip_manual(ip: str) -> bool:
    """Owner can manually unblock an IP."""
    try:
        with _lock:
            _blocked_ips.pop(ip, None)
        conn = get_security_db()
        conn.execute("DELETE FROM blocked_ips WHERE ip=?", (ip,))
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False

# ─── Main Middleware ──────────────────────────────────────────────────────────

class FortressMiddleware(BaseHTTPMiddleware):
    """
    The FORTRESS — runs every request through all 7 security layers.
    Any layer can terminate the request with a 403/429 response.
    """

    # Paths that bypass security (health checks, static assets)
    BYPASS_PATHS = {"/health", "/favicon.ico"}
    BYPASS_PREFIXES = ("/static/", "/_next/", "/assets/")

    async def dispatch(self, request: Request, call_next):
        # Skip security for internal health checks and static assets
        path = request.url.path
        if path in self.BYPASS_PATHS or any(path.startswith(p) for p in self.BYPASS_PREFIXES):
            return await call_next(request)

        # Extract real IP (respecting reverse proxy)
        ip = self._get_real_ip(request)
        ua = request.headers.get("user-agent", "")
        method = request.method

        # ── L6: Honeypot check (FIRST — highest priority) ─────────────────
        if is_honeypot_path(path):
            payload = ""
            try:
                body = await request.body()
                payload = body.decode("utf-8", errors="replace")[:500]
                # No need to replay — we're returning immediately for honeypot
            except Exception:
                pass
            headers_str = json.dumps(dict(request.headers))
            log_honeypot_hit(ip, path, method, payload, headers_str)
            # Return a convincing fake response to waste attacker's time
            return Response(
                content='{"error": "Not found"}',
                status_code=404,
                media_type="application/json",
                headers={"X-Request-ID": hashlib.md5(ip.encode()).hexdigest()[:8]}
            )

        # ── L2: IP block check ────────────────────────────────────────────
        blocked, block_reason = is_ip_blocked(ip)
        if blocked:
            log_threat(ip, "blocked_ip", "high", path, method, "", ua, "blocked", block_reason)
            return self._block_response(f"Access denied: {block_reason}")

        # ── L2: Known malicious CIDR ──────────────────────────────────────
        if is_ip_malicious_cidr(ip):
            block_ip(ip, "malicious_cidr", ttl=BLOCK_TTL)
            log_threat(ip, "malicious_cidr", "high", path, method, "", ua, "blocked", "Known attack source")
            return self._block_response("Access denied")

        # ── L3: Request fingerprinting ────────────────────────────────────
        fp_score, fp_reasons = fingerprint_request(request)
        if fp_score >= 15:
            block_ip(ip, f"scanner_detected:{','.join(fp_reasons)}", ttl=TEMP_BLOCK_TTL)
            log_threat(ip, "scanner", "high", path, method, "", ua, "blocked", str(fp_reasons))
            return self._block_response("Access denied")
        elif fp_score >= 10:
            log_threat(ip, "suspicious_request", "medium", path, method, "", ua, "logged", str(fp_reasons))

        # ── L1: Rate limiting ─────────────────────────────────────────────
        endpoint_type = "auth" if "/login" in path or "/register" in path else \
                        "api" if path.startswith("/api/") else "default"
        rate_ok, rate_reason = check_rate_limit(ip, endpoint_type)
        if not rate_ok:
            log_threat(ip, "rate_limit", "medium", path, method, "", ua, "blocked", rate_reason)
            if endpoint_type == "auth":
                # Auth brute force — temp block the IP
                block_ip(ip, f"auth_brute_force", ttl=TEMP_BLOCK_TTL)
            return JSONResponse(
                {"error": "Too many requests. Please slow down."},
                status_code=429,
                headers={"Retry-After": "60"}
            )

        # ── L4: Payload inspection ────────────────────────────────────────
        # Inspect URL path
        path_threat, path_match = inspect_path(path)
        if path_threat:
            log_threat(ip, path_threat, "high", path, method, path, ua, "blocked", path_match)
            block_ip(ip, f"path_attack:{path_threat}", ttl=TEMP_BLOCK_TTL)
            return self._block_response("Request blocked")

        # Inspect query string
        query_string = str(request.url.query)
        if query_string:
            q_threat, q_match = inspect_payload(query_string)
            if q_threat:
                log_threat(ip, q_threat, "high", path, method, query_string[:200], ua, "blocked", q_match)
                block_ip(ip, f"query_attack:{q_threat}", ttl=TEMP_BLOCK_TTL)
                return self._block_response("Request blocked")

        # Inspect request body (only for non-GET/HEAD, within size limit)
        # CRITICAL: After reading the body we MUST replay it back into the
        # request's receive channel, otherwise FastAPI handlers get empty body.
        if method not in ("GET", "HEAD", "OPTIONS"):
            try:
                body = await request.body()

                # ── Replay body so downstream handlers can read it ────────
                async def _replay_receive():
                    return {"type": "http.request", "body": body, "more_body": False}
                request._receive = _replay_receive  # patch the receive callable

                if len(body) > MAX_BODY_SIZE:
                    log_threat(ip, "oversized_body", "medium", path, method, f"{len(body)} bytes", ua, "blocked")
                    return self._block_response("Request too large", status_code=413)

                body_text = body.decode("utf-8", errors="replace")
                b_threat, b_match = inspect_payload(body_text)
                if b_threat:
                    log_threat(ip, b_threat, "critical", path, method, body_text[:300], ua, "blocked", b_match)
                    block_ip(ip, f"payload_attack:{b_threat}", ttl=BLOCK_TTL)
                    return self._block_response("Request blocked")

            except Exception:
                pass  # Don't crash on body read failure

        # ── Process request ───────────────────────────────────────────────
        start_time = time.time()
        response = await call_next(request)
        elapsed = time.time() - start_time

        # ── L5: Post-response behavioral analysis ─────────────────────────
        status_code = response.status_code
        beh_score, beh_reasons = analyze_behavior(ip, path, ua, status_code)
        if beh_score >= 15:
            block_ip(ip, f"behavioral_anomaly:{','.join(beh_reasons[:2])}", ttl=BLOCK_TTL)
            log_threat(ip, "behavioral_anomaly", "high", path, method, "", ua, "blocked", str(beh_reasons))
        elif beh_score >= 8:
            log_threat(ip, "behavioral_suspicious", "medium", path, method, "", ua, "logged", str(beh_reasons))

        # Add security response headers
        response.headers["X-Content-Type-Options"]   = "nosniff"
        response.headers["X-Frame-Options"]          = "DENY"
        response.headers["X-XSS-Protection"]         = "1; mode=block"
        response.headers["Referrer-Policy"]          = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"]       = "geolocation=(), microphone=(), camera=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"]  = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https:; "
            "connect-src 'self' https://web-production-f0dfa2.up.railway.app; "
            "frame-ancestors 'none';"
        )
        # Remove server fingerprint headers
        response.headers.pop("server", None)
        response.headers.pop("x-powered-by", None)

        return response

    def _get_real_ip(self, request: Request) -> str:
        """Extract real IP, respecting Railway's reverse proxy."""
        # Railway sets X-Forwarded-For
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            # Take the first IP (leftmost = real client)
            ip = forwarded.split(",")[0].strip()
            try:
                addr = ipaddress.ip_address(ip)
                # Don't trust private IPs from X-Forwarded-For
                if not addr.is_private:
                    return ip
            except Exception:
                pass
        return request.client.host if request.client else "0.0.0.0"

    def _block_response(self, message: str = "Access denied", status_code: int = 403) -> Response:
        return JSONResponse({"error": message}, status_code=status_code)

# ─── Initialize ───────────────────────────────────────────────────────────────

_build_malicious_networks()
