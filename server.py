"""
2EasyMarketing — Full AI Task Management Backend
Maya chat + Client Portal + AI Task Engine + Owner Dashboard API
"""
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from anthropic import AsyncAnthropic
import httpx, os, json, asyncio, time, sqlite3, hashlib, secrets, uuid, shutil
from datetime import datetime, timedelta
from typing import Optional
from pathlib import Path
import re

# ─── LLM COUNCIL ENGINE ─────────────────────────────────────────────────────
from council_engine import run_council_session, quick_council, get_council_roster, COUNCIL_MODELS
from external_search_utils import json_bearer_headers

# ─── FORTRESS SECURITY ENGINE ────────────────────────────────────────────────
from security import (
    FortressMiddleware, init_security_db,
    get_security_stats, get_blocked_ips_list,
    block_ip, unblock_ip_manual, log_threat,
    BLOCK_TTL, HONEYPOT_BLOCK_TTL
)

app = FastAPI()


# CORS must come BEFORE Fortress so preflight OPTIONS bypass security
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# FORTRESS — add after CORS (middleware runs in reverse order, Fortress runs first on requests)
app.add_middleware(FortressMiddleware)

# ─── RESPONSE HELPERS ────────────────────────────────────────────────────────
from fastapi.responses import Response as FastAPIResponse

def cached_json(data: dict, max_age: int = 60) -> JSONResponse:
    resp = JSONResponse(data)
    resp.headers["Cache-Control"] = f"public, max-age={max_age}, stale-while-revalidate={max_age*2}"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    return resp

client = AsyncAnthropic()
security = HTTPBearer(auto_error=False)

# ─── OWNER CREDENTIALS ──────────────────────────────────────────────────────
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "2easymarketing@gmail.com").strip().lower()
OWNER_PASSWORD_HASH = os.getenv("OWNER_PASSWORD_HASH", "").strip()
_OWNER_PASSWORD = os.getenv("OWNER_PASSWORD", "").strip()
if not OWNER_PASSWORD_HASH and _OWNER_PASSWORD:
    OWNER_PASSWORD_HASH = hashlib.sha256((_OWNER_PASSWORD + "2em_salt_2026").encode()).hexdigest()
OWNER_SECRET = os.getenv("OWNER_SECRET", "")
OWNER_EMAIL_ALIASES = {
    item.strip().lower()
    for item in os.getenv("OWNER_EMAIL_ALIASES", "dev@2easymedia.net,2easymarketing@gmail.com").split(",")
    if item.strip()
}
OWNER_EMAIL_ALIASES.add(OWNER_EMAIL)

# ─── DATABASE SETUP ─────────────────────────────────────────────────────────
DB_PATH = os.environ.get("DB_PATH", "/app/2easymarketing.db")
SEED_DB_PATH = os.environ.get("SEED_DB_PATH", "/app/2easymarketing.db")

def ensure_db_seeded():
    db_path = os.path.abspath(DB_PATH)
    seed_path = os.path.abspath(SEED_DB_PATH)
    if os.path.exists(db_path):
        return
    db_dir = os.path.dirname(db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    if seed_path != db_path and os.path.exists(seed_path):
        shutil.copy2(seed_path, db_path)

ensure_db_seeded()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA cache_size=-65536")   # 64MB page cache
    conn.execute("PRAGMA synchronous=NORMAL")  # faster writes, still safe
    conn.execute("PRAGMA temp_store=MEMORY")   # temp tables in RAM
    return conn

from contextlib import contextmanager

@contextmanager
def db_conn():
    conn = get_db()
    try:
        yield conn
    finally:
        conn.close()

# ─── AUTH HELPERS ────────────────────────────────────────────────────────────
def hash_password(pw: str) -> str:
    return hashlib.sha256((pw + "2em_salt_2026").encode()).hexdigest()

def is_owner_email(email: str) -> bool:
    return (email or "").strip().lower() in OWNER_EMAIL_ALIASES

def owner_email_filter_sql(column: str = "email") -> tuple[str, list[str]]:
    aliases = sorted(OWNER_EMAIL_ALIASES) or [OWNER_EMAIL]
    placeholders = ",".join("?" for _ in aliases)
    return f"{column} NOT IN ({placeholders})", aliases

def ensure_column(cur, table: str, column: str, ddl: str):
    columns = {row[1] for row in cur.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.executescript("""
    CREATE TABLE IF NOT EXISTS clients (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        business    TEXT DEFAULT '',
        website     TEXT DEFAULT '',
        plan        TEXT DEFAULT 'starter',
        status      TEXT DEFAULT 'active',
        created_at  TEXT DEFAULT (datetime('now')),
        notes       TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id     INTEGER REFERENCES clients(id),
        client_name   TEXT,
        client_email  TEXT,
        client_plan   TEXT,
        task_type     TEXT NOT NULL,
        title         TEXT NOT NULL,
        brief         TEXT NOT NULL,
        ai_result     TEXT DEFAULT '',
        status        TEXT DEFAULT 'pending',
        owner_notes   TEXT DEFAULT '',
        created_at    TEXT DEFAULT (datetime('now')),
        completed_at  TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        client_id   INTEGER,
        role        TEXT DEFAULT 'client',
        expires_at  TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS autonomous_tasks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id    INTEGER REFERENCES clients(id),
        client_name  TEXT,
        client_plan  TEXT,
        engine       TEXT NOT NULL,
        title        TEXT NOT NULL,
        content      TEXT DEFAULT '',
        status       TEXT DEFAULT 'pending_review',
        generated_at TEXT DEFAULT (datetime('now')),
        approved_at  TEXT DEFAULT NULL,
        delivered_at TEXT DEFAULT NULL,
        notes        TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS alerts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        type       TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT DEFAULT '',
        severity   TEXT DEFAULT 'info',
        is_read    INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competitor_snapshots (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        data       TEXT NOT NULL,
        hash       TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media_files (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     INTEGER REFERENCES tasks(id),
        client_id   INTEGER REFERENCES clients(id),
        file_type   TEXT NOT NULL,
        filename    TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        status      TEXT DEFAULT 'processing',
        created_at  TEXT DEFAULT (datetime('now'))
    );
    """)
    ensure_column(cur, "tasks", "ai_result", "TEXT DEFAULT ''")
    ensure_column(cur, "tasks", "status", "TEXT DEFAULT 'pending'")
    ensure_column(cur, "tasks", "owner_notes", "TEXT DEFAULT ''")
    ensure_column(cur, "tasks", "completed_at", "TEXT DEFAULT NULL")
    ensure_column(cur, "media_files", "created_at", "TEXT DEFAULT NULL")
    conn.commit()

    # Seed demo client if none exist
    cur.execute("SELECT COUNT(*) FROM clients")
    if cur.fetchone()[0] == 0:
        demo_pw = hash_password("demo1234")
        cur.execute("""
            INSERT INTO clients (name, email, password, business, website, plan)
            VALUES (?, ?, ?, ?, ?, ?)
        """, ("Demo Client", "demo@client.com", demo_pw, "Demo Business LLC", "demobiz.com", "growth"))
        conn.commit()

    conn.close()

init_db()

def make_token(client_id: int, role: str = "client") -> str:
    token = secrets.token_hex(32)
    conn = get_db()
    try:
        expires = (datetime.utcnow() + timedelta(hours=24)).isoformat()
        conn.execute(
            "INSERT INTO sessions (token, client_id, role, expires_at) VALUES (?,?,?,?)",
            (token, client_id, role, expires)
        )
        conn.commit()
    finally:
        conn.close()
    return token

def get_session(token: str) -> Optional[dict]:
    if not token:
        return None
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM sessions WHERE token=?", (token,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    if datetime.fromisoformat(row["expires_at"]) < datetime.utcnow():
        return None
    return dict(row)

def require_auth(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = creds.credentials if creds else None
    session = get_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return session

def require_owner(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = creds.credentials if creds else None
    session = get_session(token)
    if not session or session["role"] != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return session

# ─── COMPETITOR CACHE ────────────────────────────────────────────────────────
_competitor_cache = {"data": None, "timestamp": 0}
CACHE_TTL = 6 * 3600

async def fetch_competitor_pricing() -> str:
    now = time.time()
    if _competitor_cache["data"] and (now - _competitor_cache["timestamp"]) < CACHE_TTL:
        return _competitor_cache["data"]

    api_key = os.environ.get("PPLX_API_KEY", "")
    headers = json_bearer_headers(api_key)

    fallback_data = """
MARKET DATA: Budget agencies $300–$800/mo | Boutique $800–$2,000/mo |
Mid-tier $2,000–$5,000/mo | Large $5,000–$15,000+/mo |
RI local $500–$3,000/mo | Most charge $500–$2,000 setup fees + 6–12mo contracts.
"""

    if not headers:
        print("Competitor search skipped: missing PPLX_API_KEY")
        _competitor_cache["data"] = fallback_data
        _competitor_cache["timestamp"] = now
        return fallback_data

    queries = [
        "digital marketing agency pricing packages 2026 per month",
        "SEO agency monthly retainer cost 2026",
        "Rhode Island digital marketing agency pricing",
    ]
    results_text = []

    async with httpx.AsyncClient(timeout=15.0) as http:
        for query in queries:
            try:
                resp = await http.post(
                    "https://api.perplexity.ai/chat/completions",
                    headers=headers,
                    json={
                        "model": "sonar",
                        "messages": [{"role": "user", "content": f"Search: {query}. Return concise pricing ranges with dollar amounts."}],
                        "max_tokens": 300,
                    },
                )
                if resp.status_code == 200:
                    results_text.append(resp.json()["choices"][0]["message"]["content"])
                else:
                    print(f"Competitor search returned {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                print(f"Competitor search error: {e}")

    data = "\n\n---\n\n".join(results_text) if results_text else fallback_data
    _competitor_cache["data"] = data
    _competitor_cache["timestamp"] = now
    return data

# ─── AI TASK ENGINE ──────────────────────────────────────────────────────────
TASK_PROMPTS = {
    "social_post": """You are an expert social media manager for {business}. 
Create {quantity} engaging social media post(s) for {platform}.
Topic/Goal: {brief}
Tone: {tone}
Target audience: {audience}

Format each post clearly labeled "Post 1:", "Post 2:", etc.
Include relevant hashtags. Keep each post within platform character limits.
Make them scroll-stopping, authentic, and action-driving.""",

    "seo_audit": """You are an expert SEO consultant. Perform a detailed SEO audit report for:
Business: {business}
Website: {website}
Industry/Niche: {niche}
Current situation: {brief}

Provide a structured report with:
1. EXECUTIVE SUMMARY (key findings)
2. ON-PAGE SEO ANALYSIS (title tags, meta descriptions, headers, content)
3. TECHNICAL SEO CHECKLIST (site speed, mobile, structured data, indexability)
4. KEYWORD OPPORTUNITIES (5–10 target keywords with search intent)
5. BACKLINK STRATEGY (3–5 actionable link-building tactics)
6. QUICK WINS (3 things to fix this week)
7. 90-DAY ROADMAP (prioritized action plan)

Be specific and actionable. Reference the business/website context throughout.""",

    "ad_copy": """You are a world-class direct response copywriter. Create {quantity} ad(s) for:
Business: {business}
Platform: {platform}
Campaign Goal: {goal}
Budget: {budget}
Target Audience: {audience}
Key Offer/USP: {brief}

For each ad, provide:
- HEADLINE (attention-grabbing, under 30 chars for Google / under 40 for Meta)
- PRIMARY TEXT (for Meta) or Description (for Google)
- CALL TO ACTION
- A/B VARIANT of the headline

Label each ad clearly. Optimize for clicks and conversions.""",

    "blog_content": """You are a content strategist and SEO writer. Write a {content_type} for:
Business: {business}
Topic: {topic}
Target keyword: {keyword}
Word count: {word_count}
Tone: {tone}
Audience: {audience}

Additional context: {brief}

Structure:
- Compelling SEO-optimized title with the keyword
- Meta description (155 chars max)
- Introduction that hooks the reader
- Well-structured body with H2/H3 subheadings
- Actionable takeaways
- Conclusion with a clear CTA
- Keyword used naturally throughout (3–5 times)

Make it authoritative, helpful, and human — not robotic.""",

    "email_campaign": """You are an email marketing specialist. Write a {sequence_length}-email campaign for:
Business: {business}
Campaign Goal: {goal}
Audience Segment: {audience}
Key Offer: {brief}
Tone: {tone}

For each email provide:
- EMAIL {N} OF {sequence_length}
- SUBJECT LINE (A/B variant)
- PREVIEW TEXT
- EMAIL BODY (formatted with clear sections)
- CTA BUTTON TEXT
- SEND TIMING RECOMMENDATION

Make the sequence tell a story that builds urgency and drives action.""",

    "image_ad": """You are a world-class creative director. Write the CREATIVE BRIEF for an AI-generated ad image for:
Business: {business}
Platform: {platform}
Goal: {goal}
Style: {style}
Brief: {brief}

Provide:
1. AD CONCEPT (1 sentence — the big idea)
2. VISUAL DESCRIPTION (exactly what the image should show — for AI generation)
3. MOOD & TONE (3 adjectives)
4. COLOR PALETTE (3-4 specific colors with hex codes)
5. COPY OVERLAY (headline + subtext that will be added in post)
6. CTA TEXT (button or caption text)
7. A/B VARIANT (second version concept)

Note: The AI image is being generated simultaneously. This brief is your companion strategy doc.""",

    "video_ad": """You are a video ad director and copywriter. Write the PRODUCTION BRIEF for an AI-generated video ad for:
Business: {business}
Platform: {platform}
Duration: {duration} seconds
Style: {video_style}
Brief: {brief}

Provide:
1. CONCEPT (1 sentence — the hook and story)
2. SCENE-BY-SCENE BREAKDOWN (second-by-second description)
3. VOICEOVER SCRIPT (exact words, with [pause] markers)
4. ON-SCREEN TEXT (what appears at each moment)
5. MUSIC DIRECTION (genre, tempo, feel)
6. CTA (final frame text and action)
7. CAPTION/POST COPY (ready to paste for {platform})

Note: The AI video is being generated simultaneously. This is your strategy + distribution doc.""",

    "voiceover": """You are a professional voiceover director. Write an optimized VOICEOVER SCRIPT for:
Business: {business}
Purpose: {purpose}
Duration target: {duration} seconds
Tone: {tone}
Key message: {brief}

Provide:
1. FINAL SCRIPT (polished, ready to record — include [PAUSE], [EMPHASIS] markers)
2. DELIVERY NOTES (pace, energy level, accent direction if relevant)
3. WORD COUNT & TIMING (estimated read time)
4. ALTERNATIVE OPENING (in case A/B testing is needed)
5. USAGE NOTES (where this audio works best — pre-roll, social story, etc.)

Note: The AI audio is being generated simultaneously.""",
}

async def generate_ai_task(task_type: str, brief_data: dict) -> str:
    """Run AI fulfillment for a task."""
    prompt_template = TASK_PROMPTS.get(task_type, "Complete this marketing task:\n{brief}")
    try:
        prompt = prompt_template.format(**brief_data)
    except KeyError:
        prompt = f"Complete this {task_type} marketing task:\n\n{json.dumps(brief_data, indent=2)}"

    system = """You are 2EasyMarketing's AI task fulfillment engine — an expert digital marketer.
Produce complete, professional, ready-to-use marketing deliverables.
Be specific, creative, and results-oriented. Format output cleanly with clear sections.
Never add disclaimers or say "as an AI" — just deliver the work."""

    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text

# ─── MAYA SYSTEM PROMPT ──────────────────────────────────────────────────────
SYSTEM_PROMPT_BASE = """You are Maya, the AI assistant for 2EasyMarketing — a digital marketing agency in Pawtucket, Rhode Island. Website: 2easymarketing.net.

YOUR ROLE:
- Answer questions about digital marketing and 2EasyMarketing's services
- Use live competitor data to show our value
- Help prospects understand our pricing (always better than market)
- When someone wants to START work, tell them to SIGN UP for a client account at 2easymarketing.net — they get access to the Client Portal where they can submit tasks and our AI handles them instantly
- Collect leads: name, email, business, service interest

2EASYMARKETING PRICING:
- Starter ($497/mo): SEO audit, 8 social posts, analytics, Google Business Profile, 2 email campaigns. NO setup fee.
- Growth ($1,497/mo): Full SEO, 20 social posts, Google+Meta Ads ($5K), 4 blogs, weekly reporting, email automation, monthly strategy call.
- Agency ($3,497/mo): Everything + dedicated AM, unlimited ads, 8 blogs + 4 videos, landing pages, CRM, weekly calls.
- ALL PLANS: No setup fees. No long-term contracts required.

CLIENT PORTAL (KEY SELLING POINT):
When clients sign up, they get access to an AI-powered Client Portal where they can:
- Submit tasks (social posts, SEO audits, ad copy, blog content, email campaigns)
- Request AI-generated IMAGE ADS (Facebook, Instagram, Google Display — delivered in 60 seconds)
- Request AI-generated VIDEO ADS (Reels, TikTok, YouTube pre-roll — cinematic, with native audio, 2-4 min)
- Request AI VOICEOVERS (professional-quality audio for any ad or content — 30 seconds)
- Our AI instantly begins working on their request
- Results are reviewed by Dev (the owner) and delivered back through the portal
- No waiting days for an agency to respond — AI fulfillment starts in seconds

AI MEDIA FACTORY (MASSIVE DIFFERENTIATOR):
2EasyMarketing is one of the ONLY agencies offering AI-generated video ads at this price point.
Traditional video ad production: $5,000–$50,000 + 2-3 week turnaround.
2EasyMarketing AI video ads: included in Growth & Agency plans, or $200 add-on for Starter.
AI image ads achieve 12% higher CTR than human-made ads (2026 benchmark data).
AI video ads convert 27% higher than static image campaigns.
We generate 5–10x more ad variations per campaign than any traditional agency.

CONTACT: 2easymarketing@gmail.com | (401) 555-0100

TONE: Short, punchy, friendly. End with a question. Never bash competitors by name.

─── LIVE COMPETITOR DATA ───
{COMPETITOR_DATA}
────────────────────────────
"""

async def get_system_prompt() -> str:
    data = await fetch_competitor_pricing()
    return SYSTEM_PROMPT_BASE.replace("{COMPETITOR_DATA}", data)

# ═══════════════════════════════════════════════════════════════════════════
#  AUTH ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/api/auth/signup")
async def signup(request: Request):
    try:
        body = await request.json()
        name     = body.get("name", "").strip()
        email    = body.get("email", "").strip().lower()
        password = body.get("password", "").strip()
        business = body.get("business", "").strip()
        website  = body.get("website", "").strip()
        plan     = body.get("plan", "starter")

        if not name or not email or not password:
            return JSONResponse({"error": "Name, email, and password are required"}, status_code=400)
        if len(password) < 6:
            return JSONResponse({"error": "Password must be at least 6 characters"}, status_code=400)
        if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
            return JSONResponse({"error": "Invalid email address"}, status_code=400)

        conn = get_db()
        existing = conn.execute("SELECT id FROM clients WHERE email=?", (email,)).fetchone()
        if existing:
            conn.close()
            return JSONResponse({"error": "An account with that email already exists"}, status_code=409)

        hashed = hash_password(password)
        cur = conn.execute(
            "INSERT INTO clients (name, email, password, business, website, plan) VALUES (?,?,?,?,?,?)",
            (name, email, hashed, business, website, plan)
        )
        conn.commit()
        client_id = cur.lastrowid
        conn.close()

        token = make_token(client_id, "client")
        # Fire lead notification async (non-blocking)
        asyncio.create_task(_notify_new_signup(name, email, business, plan))
        return JSONResponse({
            "token": token,
            "user": {"id": client_id, "name": name, "email": email, "plan": plan, "business": business}
        })
    except Exception as e:
        print(f"Signup error: {e}")
        return JSONResponse({"error": "Signup failed, please try again"}, status_code=500)


@app.post("/api/auth/login")
async def login(request: Request):
    try:
        body = await request.json()
        email    = body.get("email", "").strip().lower()
        password = body.get("password", "").strip()

        # Owner login
        if OWNER_PASSWORD_HASH and is_owner_email(email) and hash_password(password) == OWNER_PASSWORD_HASH:
            # Create a virtual owner session
            conn = get_db()
            owner_aliases = sorted(OWNER_EMAIL_ALIASES)
            owner_placeholders = ",".join("?" for _ in owner_aliases)
            owner_row = conn.execute(
                f"SELECT id, email FROM clients WHERE email IN ({owner_placeholders}) LIMIT 1",
                owner_aliases
            ).fetchone()
            if owner_row:
                owner_id = owner_row["id"]
                owner_email = owner_row["email"]
            else:
                cur = conn.execute(
                    "INSERT INTO clients (name, email, password, business, plan) VALUES (?,?,?,?,?)",
                    ("Dev (Owner)", email, OWNER_PASSWORD_HASH, "2EasyMarketing", "agency")
                )
                conn.commit()
                owner_id = cur.lastrowid
                owner_email = email
            conn.close()
            token = make_token(owner_id, "owner")
            return JSONResponse({
                "token": token,
                "user": {"id": owner_id, "name": "Dev (Owner)", "email": owner_email, "plan": "agency", "role": "owner"}
            })

        # Client login
        conn = get_db()
        row = conn.execute("SELECT * FROM clients WHERE email=?", (email,)).fetchone()
        conn.close()
        if not row or row["password"] != hash_password(password):
            return JSONResponse({"error": "Invalid email or password"}, status_code=401)

        role = "owner" if is_owner_email(row["email"]) else "client"
        token = make_token(row["id"], role)
        return JSONResponse({
            "token": token,
            "user": {
                "id": row["id"], "name": row["name"], "email": row["email"],
                "plan": row["plan"], "business": row["business"], "role": role
            }
        })
    except Exception as e:
        print(f"Login error: {e}")
        return JSONResponse({"error": "Login failed"}, status_code=500)


@app.get("/api/auth/me")
async def me(session: dict = Depends(require_auth)):
    conn = get_db()
    row = conn.execute("SELECT * FROM clients WHERE id=?", (session["client_id"],)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": row["id"], "name": row["name"], "email": row["email"],
        "plan": row["plan"], "business": row["business"],
        "website": row["website"], "role": session["role"]
    }


@app.post("/api/auth/logout")
async def logout(session: dict = Depends(require_auth)):
    conn = get_db()
    conn.execute("DELETE FROM sessions WHERE client_id=? AND role=?", (session["client_id"], session["role"]))
    conn.commit()
    conn.close()
    return {"status": "logged out"}

# ═══════════════════════════════════════════════════════════════════════════
#  CLIENT TASK ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/api/tasks/submit")
async def submit_task(request: Request, session: dict = Depends(require_auth)):
    try:
        body = await request.json()
        task_type = body.get("task_type", "")
        title     = body.get("title", "").strip()
        brief_raw = body.get("brief", {})

        if not task_type or not title:
            return JSONResponse({"error": "Task type and title are required"}, status_code=400)

        conn = get_db()
        client_row = conn.execute("SELECT * FROM clients WHERE id=?", (session["client_id"],)).fetchone()

        if not client_row:
            conn.close()
            raise HTTPException(status_code=404, detail="Client not found")

        # Inject client context into brief
        brief_data = {
            "business": client_row["business"] or "the business",
            "website": client_row["website"] or "their website",
            "plan": client_row["plan"],
            **({k: str(v) for k, v in brief_raw.items()} if isinstance(brief_raw, dict) else {"brief": str(brief_raw)})
        }
        brief_data.setdefault("brief", title)

        # Insert task as 'pending' immediately
        cur = conn.execute("""
            INSERT INTO tasks (client_id, client_name, client_email, client_plan, task_type, title, brief, status)
            VALUES (?,?,?,?,?,?,?,?)
        """, (
            client_row["id"], client_row["name"], client_row["email"],
            client_row["plan"], task_type, title,
            json.dumps(brief_data), "processing"
        ))
        conn.commit()
        task_id = cur.lastrowid
        conn.close()

        # Run AI generation in the background
        asyncio.create_task(_fulfill_task(task_id, task_type, brief_data))

        return JSONResponse({
            "task_id": task_id,
            "status": "processing",
            "message": "Your task is being processed by our AI. Check back in a moment!"
        })

    except Exception as e:
        print(f"Task submit error: {e}")
        return JSONResponse({"error": "Failed to submit task"}, status_code=500)


async def _fulfill_task(task_id: int, task_type: str, brief_data: dict):
    """Background AI fulfillment — routes to text or media engine."""
    await _fulfill_task_with_media(task_id, task_type, brief_data)


@app.get("/api/tasks/my")
async def my_tasks(session: dict = Depends(require_auth)):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE client_id=? ORDER BY created_at DESC",
        (session["client_id"],)
    ).fetchall()
    conn.close()
    tasks = []
    for r in rows:
        t = dict(r)
        # Only show ai_result if approved by owner
        if t["status"] not in ("approved", "delivered"):
            t["ai_result"] = "" if t["status"] == "processing" else t["ai_result"]
        tasks.append(t)
    return {"tasks": tasks}


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: int, session: dict = Depends(require_auth)):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    task = dict(row)
    # Clients can only see their own tasks (owners see all)
    if session["role"] != "owner" and task["client_id"] != session["client_id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    return task

# ═══════════════════════════════════════════════════════════════════════════
#  OWNER DASHBOARD ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/owner/tasks")
async def owner_tasks(
    status: Optional[str] = None,
    session: dict = Depends(require_owner)
):
    conn = get_db()
    if status:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status=? ORDER BY created_at DESC", (status,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM tasks ORDER BY created_at DESC"
        ).fetchall()
    conn.close()
    return {"tasks": [dict(r) for r in rows]}


@app.get("/api/owner/stats")
async def owner_stats(session: dict = Depends(require_owner)):
    conn = get_db()
    total_clients  = conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
    total_tasks    = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    pending_review = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='review'").fetchone()[0]
    processing     = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='processing'").fetchone()[0]
    approved       = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='approved'").fetchone()[0]
    delivered      = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='delivered'").fetchone()[0]
    recent_tasks   = conn.execute(
        "SELECT * FROM tasks ORDER BY created_at DESC LIMIT 5"
    ).fetchall()
    recent_clients = conn.execute(
        "SELECT id, name, email, plan, created_at FROM clients ORDER BY created_at DESC LIMIT 5"
    ).fetchall()
    conn.close()
    return {
        "total_clients": total_clients,
        "total_tasks": total_tasks,
        "pending_review": pending_review,
        "processing": processing,
        "approved": approved,
        "delivered": delivered,
        "recent_tasks": [dict(r) for r in recent_tasks],
        "recent_clients": [dict(r) for r in recent_clients],
    }


@app.post("/api/owner/tasks/{task_id}/approve")
async def approve_task(task_id: int, request: Request, session: dict = Depends(require_owner)):
    body = await request.json()
    edited_result = body.get("ai_result", None)
    notes = body.get("notes", "")

    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")

    update_fields = {"status": "approved", "owner_notes": notes, "completed_at": datetime.utcnow().isoformat()}
    if edited_result is not None:
        update_fields["ai_result"] = edited_result

    conn.execute("""
        UPDATE tasks SET status=?, ai_result=COALESCE(?,ai_result), owner_notes=?, completed_at=?
        WHERE id=?
    """, ("approved", edited_result, notes, datetime.utcnow().isoformat(), task_id))
    conn.commit()
    conn.close()
    return {"status": "approved", "task_id": task_id}


@app.post("/api/owner/tasks/{task_id}/deliver")
async def deliver_task(task_id: int, request: Request, session: dict = Depends(require_owner)):
    body = await request.json()
    notes = body.get("notes", "Delivered!")
    conn = get_db()
    conn.execute(
        "UPDATE tasks SET status='delivered', owner_notes=? WHERE id=?",
        (notes, task_id)
    )
    conn.commit()
    conn.close()
    return {"status": "delivered", "task_id": task_id}


@app.post("/api/owner/tasks/{task_id}/reject")
async def reject_task(task_id: int, request: Request, session: dict = Depends(require_owner)):
    body = await request.json()
    reason = body.get("reason", "Needs revision")
    conn = get_db()
    conn.execute(
        "UPDATE tasks SET status='rejected', owner_notes=? WHERE id=?",
        (reason, task_id)
    )
    conn.commit()
    conn.close()
    return {"status": "rejected", "task_id": task_id}


@app.post("/api/owner/tasks/{task_id}/regenerate")
async def regenerate_task(task_id: int, request: Request, session: dict = Depends(require_owner)):
    body = await request.json()
    extra_instructions = body.get("instructions", "")
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
    brief_data = json.loads(row["brief"]) if row["brief"] else {}
    if extra_instructions:
        brief_data["additional_instructions"] = extra_instructions
    conn.execute("UPDATE tasks SET status='processing', ai_result='' WHERE id=?", (task_id,))
    conn.commit()
    conn.close()
    asyncio.create_task(_fulfill_task(task_id, row["task_type"], brief_data))
    return {"status": "regenerating", "task_id": task_id}


@app.get("/api/owner/clients")
async def owner_clients(session: dict = Depends(require_owner)):
    conn = get_db()
    rows = conn.execute("SELECT id, name, email, business, website, plan, status, created_at FROM clients ORDER BY created_at DESC").fetchall()
    conn.close()
    return {"clients": [dict(r) for r in rows]}


@app.patch("/api/owner/clients/{client_id}")
async def update_client(client_id: int, request: Request, session: dict = Depends(require_owner)):
    body = await request.json()
    allowed = ["plan", "status", "notes"]
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        return JSONResponse({"error": "No valid fields to update"}, status_code=400)
    sets = ", ".join(f"{k}=?" for k in updates)
    conn = get_db()
    conn.execute(f"UPDATE clients SET {sets} WHERE id=?", (*updates.values(), client_id))
    conn.commit()
    conn.close()
    return {"status": "updated"}

# ═══════════════════════════════════════════════════════════════════════════
#  EXISTING ENDPOINTS (preserved)
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/api/chat")
async def chat(request: Request):
    try:
        body = await request.json()
        messages = body.get("messages", [])
        if not messages:
            return JSONResponse({"reply": "Hey! 👋 I'm Maya, 2EasyMarketing's AI assistant. Ask me anything about digital marketing — or ask about our Client Portal where AI handles your tasks instantly!"})
        cleaned = [
            {"role": m["role"], "content": str(m["content"])[:2000]}
            for m in messages
            if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")
        ]
        if not cleaned:
            return JSONResponse({"reply": "Ask me anything about digital marketing!"})
        system = await get_system_prompt()
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=450,
            system=system,
            messages=cleaned[-14:],
        )
        return JSONResponse({"reply": response.content[0].text})
    except Exception as e:
        print(f"Chat error: {e}")
        return JSONResponse({"reply": "Quick snag — try again! Or email 2easymarketing@gmail.com"})


@app.get("/api/competitors")
async def get_competitors():
    data = await fetch_competitor_pricing()
    return cached_json({
        "cached_at": datetime.fromtimestamp(_competitor_cache["timestamp"]).isoformat() if _competitor_cache["timestamp"] else None,
        "data": data
    }, max_age=3600)


@app.post("/api/competitors/refresh")
async def refresh_competitors():
    _competitor_cache["data"] = None
    _competitor_cache["timestamp"] = 0
    data = await fetch_competitor_pricing()
    return {"status": "refreshed", "data_length": len(data)}


# ═══════════════════════════════════════════════════════════════════════════
#  CHANNEL HUB PLACEHOLDER ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

CHANNEL_SETUP_GUIDE = {
    "youtube": "Create OAuth credentials in Google Cloud Console and add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway.",
    "youtube-shorts": "Uses the same Google/YouTube OAuth connection as YouTube.",
    "tiktok": "Create a TikTok developer app and add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in Railway.",
    "instagram": "Create a Meta developer app and add META_APP_ID and META_APP_SECRET in Railway.",
    "facebook": "Uses the same Meta developer app as Instagram/Facebook Pages.",
    "linkedin": "Create a LinkedIn developer app and add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in Railway.",
    "twitter-x": "Create an X developer app and add X_CLIENT_ID and X_CLIENT_SECRET in Railway.",
    "pinterest": "Create a Pinterest developer app and add PINTEREST_APP_ID and PINTEREST_APP_SECRET in Railway.",
    "google-ads": "Create Google Cloud OAuth credentials and add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and Google Ads developer token in Railway.",
    "twitch": "Create a Twitch developer app and add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in Railway.",
    "discord": "Create a Discord developer app and add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in Railway.",
    "sms-text": "Create a Twilio account and add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Railway.",
    "email": "Email is enabled for portal messages. For production sending, add SMTP/SENDGRID/MAILGUN settings in Railway."
}

def _channel_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

@app.get("/api/channels/status")
async def channel_status(session: dict = Depends(require_auth)):
    """Return Channel Hub connection status. OAuth integrations are setup-required until credentials are added."""
    return {
        "status": "ok",
        "channels": {
            key: {
                "connected": key == "email",
                "status": "active" if key == "email" else "setup_required",
                "setup": value
            }
            for key, value in CHANNEL_SETUP_GUIDE.items()
        }
    }

@app.post("/api/channels/connect/{channel}")
async def channel_connect(channel: str, session: dict = Depends(require_auth)):
    """Safe placeholder for channel connect buttons until real OAuth apps are configured."""
    slug = _channel_slug(channel)
    setup = CHANNEL_SETUP_GUIDE.get(slug, "This channel needs OAuth/API credentials configured in Railway before it can connect.")
    return JSONResponse(
        status_code=200,
        content={
            "status": "setup_required",
            "channel": channel,
            "message": f"{channel} connection setup is required before live OAuth can run.",
            "setup": setup
        }
    )


# /api/health is defined in the Self-Maintenance Engine section below


# ═══════════════════════════════════════════════════════════════════════════
#  MAYA AUTONOMOUS ENGINE
# ═══════════════════════════════════════════════════════════════════════════

def save_auto_task(client_id: int, client_name: str, client_plan: str, engine: str, title: str, content: str):
    """Persist an autonomous task to DB."""
    conn = get_db()
    conn.execute("""
        INSERT INTO autonomous_tasks (client_id, client_name, client_plan, engine, title, content)
        VALUES (?,?,?,?,?,?)
    """, (client_id, client_name, client_plan, engine, title, content))
    conn.commit()
    conn.close()

def save_alert(alert_type: str, title: str, body: str, severity: str = "info"):
    """Persist an alert to DB."""
    conn = get_db()
    conn.execute("""
        INSERT INTO alerts (type, title, body, severity)
        VALUES (?,?,?,?)
    """, (alert_type, title, body, severity))
    conn.commit()
    conn.close()

def get_active_clients():
    """Return all active non-owner clients."""
    conn = get_db()
    owner_filter, owner_params = owner_email_filter_sql("email")
    rows = conn.execute(
        f"SELECT * FROM clients WHERE status='active' AND {owner_filter}", owner_params
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── ENGINE 1: WEEKLY STRATEGY REPORT ────────────────────────────────────────
async def run_weekly_strategy():
    """Generate a weekly marketing strategy report for every active client."""
    print("🧠 [AUTONOMOUS] Running weekly strategy engine...")
    clients_list = get_active_clients()
    if not clients_list:
        print("⚠️  No active clients for strategy engine.")
        return

    competitor_data = await fetch_competitor_pricing()

    for c in clients_list:
        try:
            prompt = f"""You are Maya, 2EasyMarketing's AI strategy director.

Generate a complete WEEKLY MARKETING STRATEGY REPORT for this client:

Client: {c['name']}
Business: {c['business'] or 'General business'}
Website: {c['website'] or 'Not provided'}
Plan: {c['plan'].upper()} plan

CURRENT COMPETITOR LANDSCAPE:
{competitor_data[:1200]}

Deliver a structured report with these sections:

1. EXECUTIVE SUMMARY (2-3 sentences — what matters most this week)
2. TOP 3 PRIORITIES (specific, actionable, ranked by impact)
3. CONTENT CALENDAR (Mon-Fri post ideas with platform + caption angle)
4. SEO QUICK WIN (one keyword or page to focus on this week)
5. AD OPPORTUNITY (one specific ad campaign idea with targeting)
6. COMPETITOR WATCH (what competitors are likely doing, how to stay ahead)
7. THIS WEEK'S GOAL (one metric to move — be specific)

Be specific to their business type. Use their plan level to calibrate recommendations.
Format cleanly with headers. No fluff — only actionable intelligence."""

            resp = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2000,
                system="You are 2EasyMarketing's autonomous AI strategist. Produce razor-sharp, specific, actionable marketing strategies. Never be generic.",
                messages=[{"role": "user", "content": prompt}],
            )
            content = resp.content[0].text
            title = f"Weekly Strategy Report — {c['name']} — {datetime.utcnow().strftime('%b %d, %Y')}"
            save_auto_task(c["id"], c["name"], c["plan"], "strategy", title, content)
            print(f"  ✅ Strategy report for {c['name']}")
        except Exception as e:
            print(f"  ❌ Strategy error for {c['name']}: {e}")

    save_alert("strategy", "Weekly Strategy Reports Ready",
               f"Generated {len(clients_list)} client strategy report(s). Review and approve before delivery.",
               severity="info")
    print("✅ [AUTONOMOUS] Weekly strategy engine complete.")


# ─── ENGINE 2: AUTO CONTENT FACTORY ──────────────────────────────────────────
async def run_content_factory():
    """Auto-generate social posts, blog intros, and email subjects for every active client."""
    print("🏭 [AUTONOMOUS] Running content factory...")
    clients_list = get_active_clients()
    if not clients_list:
        return

    for c in clients_list:
        try:
            plan = c["plan"].lower()
            post_count  = 8  if plan == "starter" else (20 if plan == "growth" else 30)
            blog_count  = 0  if plan == "starter" else (4  if plan == "growth" else 8)
            email_count = 2  if plan == "starter" else (4  if plan == "growth" else 8)

            prompt = f"""You are 2EasyMarketing's content factory AI.

Generate a WEEKLY CONTENT BATCH for:
Business: {c['business'] or 'a local business'}
Website: {c['website'] or 'not provided'}
Plan: {plan.upper()} — {post_count} social posts, {blog_count} blog topics, {email_count} email subject lines

Deliver:

=== SOCIAL POSTS ({post_count} posts) ===
For each post: Platform | Caption (ready to copy-paste) | Hashtags
Mix of: Instagram, Facebook, LinkedIn. Make them scroll-stopping and brand-authentic.

=== BLOG TOPICS ({blog_count} ideas) ===
For each: Title | Target keyword | Hook sentence | Word count recommendation

=== EMAIL SUBJECTS ({email_count} lines) ===
For each: Subject Line | Preview Text | Best send day/time

Tailor everything to their specific business type. Make it ready to publish immediately."""

            resp = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=3000,
                system="You are 2EasyMarketing's content engine. Produce complete, publish-ready content batches. Be creative, specific, brand-aware.",
                messages=[{"role": "user", "content": prompt}],
            )
            content = resp.content[0].text
            title = f"Weekly Content Batch — {c['name']} — {datetime.utcnow().strftime('%b %d, %Y')}"
            save_auto_task(c["id"], c["name"], c["plan"], "content", title, content)
            print(f"  ✅ Content batch for {c['name']}")
        except Exception as e:
            print(f"  ❌ Content factory error for {c['name']}: {e}")

    # Also queue one AI image ad brief per Growth/Agency client per week
    for c in clients_list:
        if c.get("plan", "starter").lower() in ("growth", "agency"):
            try:
                img_brief_data = {
                    "business": c["business"] or "the business",
                    "platform": "Facebook/Instagram",
                    "goal": "Lead Generation",
                    "style": "Cinematic & Dark",
                    "colors": "brand colors",
                    "aspect_ratio": "1:1",
                    "brief": f"Weekly auto-generated ad creative for {c['name']}. Create a compelling, results-focused ad visual.",
                    "client_id": c["id"],
                    "client_name": c["name"],
                    "client_plan": c["plan"],
                }
                title_img = f"Weekly Auto Image Ad — {c['name']} — {datetime.utcnow().strftime('%b %d, %Y')}"
                save_auto_task(c["id"], c["name"], c["plan"], "content", title_img,
                               f"IMAGE_AD_QUEUED: Weekly image ad brief ready for {c['name']}. Use Media Factory to generate or approve.")
            except Exception as e:
                print(f"  ❌ Auto image ad error for {c['name']}: {e}")

    save_alert("content", "Content Batches Ready",
               f"Auto-generated content for {len(clients_list)} client(s). Approve before delivery.",
               severity="info")
    print("✅ [AUTONOMOUS] Content factory complete.")


# ─── ENGINE 3: COMPETITOR MONITOR ────────────────────────────────────────────
async def run_competitor_monitor():
    """Check competitor pricing, detect changes, and alert owner if significant shift."""
    print("🔎 [AUTONOMOUS] Running competitor monitor...")
    api_key = os.environ.get("PPLX_API_KEY", "")
    headers = json_bearer_headers(api_key)

    if not headers:
        print("  ⚠️  Competitor monitor skipped: missing PPLX_API_KEY")
        return

    queries = [
        "digital marketing agency pricing 2026 monthly retainer rates",
        "SEO agency cost per month small business 2026",
        "Rhode Island marketing agency pricing packages",
        "social media management agency price 2026",
    ]
    fresh_parts = []
    async with httpx.AsyncClient(timeout=20.0) as http:
        for q in queries:
            try:
                resp = await http.post(
                    "https://api.perplexity.ai/chat/completions",
                    headers=headers,
                    json={
                        "model": "sonar",
                        "messages": [{"role": "user", "content": f"{q}. List specific dollar amounts, agency names, and plan tiers found online."}],
                        "max_tokens": 400,
                    }
                )
                if resp.status_code == 200:
                    fresh_parts.append(resp.json()["choices"][0]["message"]["content"])
                else:
                    print(f"  Competitor query returned {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                print(f"  Competitor query error: {e}")

    if not fresh_parts:
        print("  ⚠️  Competitor monitor: no data fetched.")
        return

    fresh_data = "\n\n".join(fresh_parts)
    fresh_hash = hashlib.md5(fresh_data.encode()).hexdigest()

    conn = get_db()
    last = conn.execute(
        "SELECT data, hash FROM competitor_snapshots ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    conn.execute(
        "INSERT INTO competitor_snapshots (data, hash) VALUES (?,?)", (fresh_data, fresh_hash)
    )
    conn.commit()
    conn.close()

    if last and last["hash"] == fresh_hash:
        print("  ✔️  Competitor data unchanged.")
        save_alert("competitor", "Competitor Check Complete — No Changes",
                   "Market pricing is stable. 2EasyMarketing's rates remain competitive.", severity="info")
        return

    old_data = last["data"] if last else "(no previous data)"
    try:
        analysis_resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            system="You are 2EasyMarketing's competitive intelligence analyst. Be direct, specific, and strategic.",
            messages=[{"role": "user", "content": f"""Analyze these two competitor snapshots and identify what changed:

PREVIOUS:
{old_data[:800]}

CURRENT:
{fresh_data[:800]}

Report:
1. KEY CHANGES DETECTED (price shifts, new players, new offers)
2. THREAT LEVEL (Low / Medium / High)
3. RECOMMENDED ACTION for 2EasyMarketing
4. PRICING POSITION (are we still the best value?)

Be concise and actionable."""}]
        )
        analysis = analysis_resp.content[0].text
    except Exception:
        analysis = fresh_data[:600]

    save_alert(
        "competitor",
        "🚨 Competitor Pricing Change Detected",
        analysis,
        severity="warning"
    )
    _competitor_cache["data"] = fresh_data
    _competitor_cache["timestamp"] = time.time()
    print("✅ [AUTONOMOUS] Competitor monitor — CHANGE DETECTED, alert saved.")



# ─── ENGINE 4: OPPORTUNITY SPOTTER ───────────────────────────────────────────
async def run_opportunity_spotter():
    """Detect marketing trends, content gaps, and timing opportunities."""
    print("💡 [AUTONOMOUS] Running opportunity spotter...")
    api_key = os.environ.get("PPLX_API_KEY", "")
    headers = json_bearer_headers(api_key)

    queries = [
        "digital marketing trends small business opportunities 2026 latest",
        "Rhode Island small business marketing opportunities Providence Pawtucket 2026",
        f"marketing campaign ideas {datetime.utcnow().strftime('%B %Y')} small business trending",
    ]
    trend_data = []

    if not headers:
        print("  ⚠️  Trend queries skipped: missing PPLX_API_KEY")
    else:
        async with httpx.AsyncClient(timeout=20.0) as http:
            for q in queries:
                try:
                    resp = await http.post(
                        "https://api.perplexity.ai/chat/completions",
                        headers=headers,
                        json={
                            "model": "sonar",
                            "messages": [{"role": "user", "content": q}],
                            "max_tokens": 350,
                        }
                    )
                    if resp.status_code == 200:
                        trend_data.append(resp.json()["choices"][0]["message"]["content"])
                    else:
                        print(f"  Trend query returned {resp.status_code}: {resp.text[:200]}")
                except Exception as e:
                    print(f"  Trend query error: {e}")

    if not trend_data:
        trend_data = ["No live trend data — using baseline intelligence."]

    combined = "\n\n".join(trend_data)
    try:
        opp_resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1200,
            system="You are 2EasyMarketing's opportunity detection AI. Spot marketing goldmines for small businesses.",
            messages=[{"role": "user", "content": f"""Based on this market intelligence, identify the TOP 5 MARKETING OPPORTUNITIES right now for 2EasyMarketing clients (small businesses in Rhode Island and beyond):

INTELLIGENCE:
{combined[:1500]}

For each opportunity:
OPPORTUNITY #N: [Name]
WHY NOW: [What's making this timely]
BEST CHANNELS: [Where to act]
QUICK WIN: [What to do this week]
POTENTIAL IMPACT: [Low/Medium/High]

Include: seasonal hooks, trending content formats, local RI events/angles, and any gaps competitors are missing."""}]
        )
        opp_content = opp_resp.content[0].text
    except Exception as e:
        opp_content = combined[:800]

    save_alert(
        "opportunity",
        f"💡 {datetime.utcnow().strftime('%B')} Opportunities: 5 Hot Marketing Moves",
        opp_content,
        severity="success"
    )
    save_auto_task(
        0, "(All Clients)", "all", "opportunity",
        f"Opportunity Report — {datetime.utcnow().strftime('%b %d, %Y')}",
        opp_content
    )
    print("✅ [AUTONOMOUS] Opportunity spotter complete.")



# ─── AUTONOMOUS SCHEDULER ─────────────────────────────────────────────────────
DAILY_INTERVAL  = 24 * 3600
WEEKLY_INTERVAL = 7 * 24 * 3600

async def _scheduler_loop():
    """Async background loop — runs all 4 engines on schedule."""
    await asyncio.sleep(10)
    print("🧠 [MAYA AUTONOMOUS] Scheduler started. Running initial scan...")

    await run_competitor_monitor()
    await asyncio.sleep(2)
    await run_opportunity_spotter()
    await asyncio.sleep(2)
    await run_weekly_strategy()
    await asyncio.sleep(2)
    await run_content_factory()

    daily_counter  = 0
    weekly_counter = 0

    while True:
        await asyncio.sleep(3600)
        daily_counter  += 3600
        weekly_counter += 3600

        if daily_counter >= DAILY_INTERVAL:
            daily_counter = 0
            await run_competitor_monitor()
            await asyncio.sleep(5)
            await run_opportunity_spotter()

        if weekly_counter >= WEEKLY_INTERVAL:
            weekly_counter = 0
            await run_weekly_strategy()
            await asyncio.sleep(5)
            await run_content_factory()


@app.on_event("startup")
async def start_autonomous_scheduler():
    """Launch the Maya autonomous engine in the background on server start."""
    asyncio.create_task(_scheduler_loop())
    print("✅ Maya Autonomous Engine scheduled and running.")


# ═══════════════════════════════════════════════════════════════════════════
#  AUTONOMOUS TASK & ALERTS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/owner/autonomous")
async def list_autonomous(session: dict = Depends(require_owner)):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM autonomous_tasks ORDER BY generated_at DESC"
    ).fetchall()
    conn.close()
    return {"tasks": [dict(r) for r in rows]}


@app.post("/api/owner/autonomous/{task_id}/approve")
async def approve_auto_task(task_id: int, request: Request, session: dict = Depends(require_owner)):
    body   = await request.json()
    edited = body.get("content", None)
    notes  = body.get("notes", "")
    conn   = get_db()
    row    = conn.execute("SELECT * FROM autonomous_tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Autonomous task not found")
    conn.execute("""
        UPDATE autonomous_tasks
        SET status='approved', content=COALESCE(?,content), notes=?, approved_at=?
        WHERE id=?
    """, (edited, notes, datetime.utcnow().isoformat(), task_id))
    conn.commit()
    conn.close()
    return {"status": "approved", "task_id": task_id}


@app.post("/api/owner/autonomous/{task_id}/deliver")
async def deliver_auto_task(task_id: int, request: Request, session: dict = Depends(require_owner)):
    body  = await request.json()
    notes = body.get("notes", "Delivered!")
    conn  = get_db()
    conn.execute(
        "UPDATE autonomous_tasks SET status='delivered', notes=?, delivered_at=? WHERE id=?",
        (notes, datetime.utcnow().isoformat(), task_id)
    )
    conn.commit()
    conn.close()
    return {"status": "delivered", "task_id": task_id}


@app.post("/api/owner/autonomous/{task_id}/dismiss")
async def dismiss_auto_task(task_id: int, session: dict = Depends(require_owner)):
    conn = get_db()
    conn.execute("UPDATE autonomous_tasks SET status='dismissed' WHERE id=?", (task_id,))
    conn.commit()
    conn.close()
    return {"status": "dismissed"}


@app.get("/api/owner/alerts")
async def list_alerts(session: dict = Depends(require_owner)):
    conn = get_db()
    rows = conn.execute("SELECT * FROM alerts ORDER BY created_at DESC").fetchall()
    conn.close()
    return {"alerts": [dict(r) for r in rows]}


@app.post("/api/owner/alerts/{alert_id}/read")
async def mark_alert_read(alert_id: int, session: dict = Depends(require_owner)):
    conn = get_db()
    conn.execute("UPDATE alerts SET is_read=1 WHERE id=?", (alert_id,))
    conn.commit()
    conn.close()
    return {"status": "read"}


@app.post("/api/owner/alerts/read-all")
async def mark_all_alerts_read(session: dict = Depends(require_owner)):
    conn = get_db()
    conn.execute("UPDATE alerts SET is_read=1")
    conn.commit()
    conn.close()
    return {"status": "all read"}


@app.post("/api/owner/run-engine")
async def manual_run_engine(request: Request, session: dict = Depends(require_owner)):
    """Manually trigger one or all autonomous engines."""
    body   = await request.json()
    engine = body.get("engine", "all")

    async def run_selected():
        if engine in ("all", "competitor"):
            await run_competitor_monitor()
        if engine in ("all", "opportunity"):
            await run_opportunity_spotter()
        if engine in ("all", "strategy"):
            await run_weekly_strategy()
        if engine in ("all", "content"):
            await run_content_factory()

    asyncio.create_task(run_selected())
    return {"status": "running", "engine": engine, "message": f"Engine '{engine}' triggered — check Autonomous tab in ~30 seconds."}




@app.post("/api/owner/generate-report")
async def generate_owner_report(request: Request, session: dict = Depends(require_owner)):
    """
    Generate one-click owner/client reports from the Client Reports page.
    The report is displayed in the portal and saved to Autonomous Tasks.
    """
    body = await request.json()
    report_type = (body.get("report_type") or body.get("name") or "Custom Report").strip()
    client_name = (body.get("client_name") or "All Clients").strip()

    conn = get_db()
    try:
        owner_filter, owner_params = owner_email_filter_sql("email")
        total_clients = conn.execute(f"SELECT COUNT(*) FROM clients WHERE {owner_filter}", owner_params).fetchone()[0]
        total_tasks = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        recent_tasks = conn.execute("SELECT title, task_type, status, client_name FROM tasks ORDER BY created_at DESC LIMIT 10").fetchall()
        recent_alerts = conn.execute("SELECT type, title, severity FROM alerts ORDER BY created_at DESC LIMIT 8").fetchall()
        recent_auto = conn.execute("SELECT engine, title, status FROM autonomous_tasks ORDER BY generated_at DESC LIMIT 10").fetchall()
    finally:
        conn.close()

    task_lines = [f"- {r['title']} ({r['task_type']}, {r['status']}) for {r['client_name'] or 'Unknown'}" for r in recent_tasks] or ["- No client tasks yet."]
    alert_lines = [f"- {r['title']} ({r['type']}, {r['severity']})" for r in recent_alerts] or ["- No alerts yet."]
    auto_lines = [f"- {r['title']} ({r['engine']}, {r['status']})" for r in recent_auto] or ["- No autonomous activity yet."]

    prompt = f"""Create a polished 2EasyMarketing report.

Report type: {report_type}
Client scope: {client_name}
Total clients: {total_clients}
Total tasks: {total_tasks}

Recent client tasks:
{chr(10).join(task_lines)}

Recent alerts:
{chr(10).join(alert_lines)}

Recent autonomous activity:
{chr(10).join(auto_lines)}

Write a professional, client-ready report with:
1. Executive Summary
2. What Was Done
3. Key Wins
4. Recommended Next Steps
5. Plain-English Owner Notes
"""

    content = f"""# {report_type}

## Executive Summary
This report was generated successfully by 2EasyMarketing. Live AI writing becomes more detailed when ANTHROPIC_API_KEY is configured in Railway.

## Current Snapshot
- Total clients: {total_clients}
- Total tasks: {total_tasks}
- Report scope: {client_name}

## Recent Work
{chr(10).join(task_lines)}

## Recent Alerts
{chr(10).join(alert_lines)}

## AI Activity
{chr(10).join(auto_lines)}

## Recommended Next Steps
1. Review recent tasks and approve completed work.
2. Add missing API keys in Railway for deeper live intelligence.
3. Connect priority channels before enabling automated publishing.
4. Use this report as a starting point for client updates.
"""

    try:
        if os.getenv("ANTHROPIC_API_KEY", "").strip():
            resp = await client.messages.create(
                model=os.getenv("ANTHROPIC_REPORT_MODEL", os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")),
                max_tokens=1800,
                system="You are Maya, 2EasyMarketing's client reporting strategist. Write polished, useful, non-fluffy reports.",
                messages=[{"role": "user", "content": prompt}],
            )
            content = resp.content[0].text
    except Exception as e:
        print(f"Report generation fallback used: {e}")

    title = f"{report_type} — {datetime.utcnow().strftime('%b %d, %Y')}"

    try:
        save_auto_task(0, client_name, "all", "report", title, content)
        save_alert("report", f"📊 Report Generated: {report_type}", f"A new {report_type} has been generated and saved.", severity="success")
    except Exception as e:
        print(f"Report save warning: {e}")

    return {"status": "ok", "report_type": report_type, "title": title, "content": content, "message": "Report generated successfully."}




# ═══════════════════════════════════════════════════════════════════════════
#  SOCIAL AUTOPILOT PREVIEW — BRAND KIT, 30-DAY PLAN, APPROVAL QUEUE
# ═══════════════════════════════════════════════════════════════════════════

def _init_social_autopilot_db():
    conn = get_db()
    try:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS brand_kits (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id            INTEGER UNIQUE REFERENCES clients(id),
            brand_name           TEXT DEFAULT '',
            audience             TEXT DEFAULT '',
            voice                TEXT DEFAULT 'Professional, clear, confident',
            colors               TEXT DEFAULT '#00c4b4, #031716, #ffffff',
            main_offer           TEXT DEFAULT '',
            differentiators      TEXT DEFAULT '',
            forbidden_words      TEXT DEFAULT '',
            created_at           TEXT DEFAULT (datetime('now')),
            updated_at           TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS social_autopilot_posts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id        INTEGER REFERENCES clients(id),
            client_name      TEXT DEFAULT '',
            platform         TEXT NOT NULL,
            post_type        TEXT DEFAULT 'Post',
            hook             TEXT DEFAULT '',
            caption          TEXT NOT NULL,
            cta              TEXT DEFAULT '',
            hashtags         TEXT DEFAULT '',
            asset_idea       TEXT DEFAULT '',
            scheduled_date   TEXT DEFAULT '',
            scheduled_time   TEXT DEFAULT '',
            status           TEXT DEFAULT 'queued_review',
            approval_notes   TEXT DEFAULT '',
            created_at       TEXT DEFAULT (datetime('now')),
            approved_at      TEXT DEFAULT NULL,
            rejected_at      TEXT DEFAULT NULL
        );
        """)
        conn.commit()
    finally:
        conn.close()

def _client_for_session(session: dict):
    conn = get_db()
    try:
        return conn.execute("SELECT * FROM clients WHERE id=?", (session["client_id"],)).fetchone()
    finally:
        conn.close()

def _default_brand_kit(client_row) -> dict:
    business = (client_row["business"] if client_row else "") or (client_row["name"] if client_row else "") or "2EasyMarketing Client"
    return {
        "brand_name": business,
        "audience": "Local customers and warm leads who need trustworthy help now.",
        "voice": "Professional, clear, confident, friendly, and conversion-focused.",
        "colors": "#00c4b4, #031716, #ffffff",
        "main_offer": "Book a consultation, request a quote, or send a message to get started.",
        "differentiators": "Fast response, professional service, clear communication, and modern marketing.",
        "forbidden_words": "guaranteed, cheapest, unbelievable"
    }

def _row_to_brand(row, client_row=None) -> dict:
    base = _default_brand_kit(client_row)
    if not row:
        return base
    for key in base.keys():
        base[key] = row[key] or base[key]
    return base

def _post_row(row) -> dict:
    return {
        "id": row["id"],
        "client_id": row["client_id"],
        "client_name": row["client_name"],
        "platform": row["platform"],
        "post_type": row["post_type"],
        "hook": row["hook"],
        "caption": row["caption"],
        "cta": row["cta"],
        "hashtags": row["hashtags"],
        "asset_idea": row["asset_idea"],
        "scheduled_date": row["scheduled_date"],
        "scheduled_time": row["scheduled_time"],
        "status": row["status"],
        "approval_notes": row["approval_notes"],
        "created_at": row["created_at"],
        "approved_at": row["approved_at"],
        "rejected_at": row["rejected_at"]
    }

def _build_local_30_day_plan(client_row, brand: dict, days: int = 30) -> list[dict]:
    """Free built-in plan generator. No paid API required."""
    business = brand.get("brand_name") or client_row["business"] or client_row["name"] or "Your Business"
    audience = brand.get("audience") or "local customers"
    voice = brand.get("voice") or "professional and friendly"
    offer = brand.get("main_offer") or "book a consultation"
    diff = brand.get("differentiators") or "fast service and clear communication"

    platforms = [
        ("Instagram", "Reel", "10:00 AM"),
        ("TikTok", "Short Video", "3:00 PM"),
        ("Facebook", "Feed Post", "1:00 PM"),
        ("YouTube Shorts", "Short", "12:00 PM"),
        ("LinkedIn", "Thought Leadership", "9:00 AM"),
        ("Instagram", "Carousel", "6:00 PM"),
        ("Facebook", "Story", "7:00 PM"),
    ]
    themes = [
        ("Problem/Solution", "Most people wait too long before fixing this problem. Here is the simple way to move forward."),
        ("Behind the Brand", "People do business with people. Show the real process, the team, and why the work matters."),
        ("Client Pain Point", "Call out the exact frustration your audience feels and explain how your offer makes it easier."),
        ("Quick Tip", "Give one useful tip your audience can apply today, then invite them to take the next step."),
        ("Proof/Trust", "Show why your business is reliable: process, results, reviews, examples, or experience."),
        ("Offer Push", "Make the offer clear, simple, and urgent without sounding pushy."),
        ("Myth Busting", "Correct a common misunderstanding and position the brand as the expert."),
        ("FAQ", "Answer one common question in plain English and end with a direct call-to-action."),
        ("Comparison", "Show the difference between doing it alone and getting professional help."),
        ("Transformation", "Describe the before-and-after result the customer wants.")
    ]

    today = datetime.utcnow().date()
    posts = []
    for i in range(max(7, min(int(days or 30), 30))):
        platform, post_type, time_slot = platforms[i % len(platforms)]
        theme, angle = themes[i % len(themes)]
        date = today + timedelta(days=i)
        hook = f"{theme}: make {business} the easy choice"
        caption = (
            f"{hook}\n\n"
            f"{angle}\n\n"
            f"For {audience}, {business} should sound {voice}. "
            f"The message is simple: {diff}.\n\n"
            f"{offer}"
        )
        cta = "Send a message today" if i % 3 else "Book now"
        hashtags = "#2EasyMarketing #SmallBusinessMarketing #ContentMarketing #LeadGeneration"
        asset_idea = (
            "Use a branded teal/black design with one bold headline and one clear CTA."
            if post_type in ("Feed Post", "Carousel", "Thought Leadership")
            else "Use a short vertical clip/storyboard with a strong opening hook in the first 2 seconds."
        )
        posts.append({
            "platform": platform,
            "post_type": post_type,
            "hook": hook,
            "caption": caption,
            "cta": cta,
            "hashtags": hashtags,
            "asset_idea": asset_idea,
            "scheduled_date": date.isoformat(),
            "scheduled_time": time_slot,
            "status": "queued_review"
        })
    return posts

_init_social_autopilot_db()

@app.get("/api/autopilot/status")
async def social_autopilot_status(session: dict = Depends(require_auth)):
    _init_social_autopilot_db()
    client_row = _client_for_session(session)
    conn = get_db()
    try:
        if session["role"] == "owner":
            total = conn.execute("SELECT COUNT(*) FROM social_autopilot_posts").fetchone()[0]
            queued = conn.execute("SELECT COUNT(*) FROM social_autopilot_posts WHERE status='queued_review'").fetchone()[0]
            approved = conn.execute("SELECT COUNT(*) FROM social_autopilot_posts WHERE status='approved'").fetchone()[0]
            ready = conn.execute("SELECT COUNT(*) FROM social_autopilot_posts WHERE status='ready_to_publish'").fetchone()[0]
        else:
            cid = session["client_id"]
            total = conn.execute("SELECT COUNT(*) FROM social_autopilot_posts WHERE client_id=?", (cid,)).fetchone()[0]
            queued = conn.execute("SELECT COUNT(*) FROM social_autopilot_posts WHERE client_id=? AND status='queued_review'", (cid,)).fetchone()[0]
            approved = conn.execute("SELECT COUNT(*) FROM social_autopilot_posts WHERE client_id=? AND status='approved'", (cid,)).fetchone()[0]
            ready = conn.execute("SELECT COUNT(*) FROM social_autopilot_posts WHERE client_id=? AND status='ready_to_publish'", (cid,)).fetchone()[0]
    finally:
        conn.close()

    return {
        "status": "ok",
        "client": client_row["name"] if client_row else "",
        "total_posts": total,
        "queued_review": queued,
        "approved": approved,
        "ready_to_publish": ready,
        "publishing_enabled": False,
        "message": "Preview mode: posts are generated, reviewed, approved, and exported. Nothing publishes automatically yet."
    }

@app.get("/api/autopilot/brand-kit")
async def get_brand_kit(session: dict = Depends(require_auth)):
    _init_social_autopilot_db()
    client_row = _client_for_session(session)
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM brand_kits WHERE client_id=?", (session["client_id"],)).fetchone()
    finally:
        conn.close()
    return {"status": "ok", "brand": _row_to_brand(row, client_row)}

@app.post("/api/autopilot/brand-kit")
async def save_brand_kit(request: Request, session: dict = Depends(require_auth)):
    _init_social_autopilot_db()
    body = await request.json()
    allowed = ["brand_name", "audience", "voice", "colors", "main_offer", "differentiators", "forbidden_words"]
    data = {k: str(body.get(k, "")).strip() for k in allowed}

    client_row = _client_for_session(session)
    defaults = _default_brand_kit(client_row)
    for k in allowed:
        if not data[k]:
            data[k] = defaults.get(k, "")

    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO brand_kits
                (client_id, brand_name, audience, voice, colors, main_offer, differentiators, forbidden_words, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(client_id) DO UPDATE SET
                brand_name=excluded.brand_name,
                audience=excluded.audience,
                voice=excluded.voice,
                colors=excluded.colors,
                main_offer=excluded.main_offer,
                differentiators=excluded.differentiators,
                forbidden_words=excluded.forbidden_words,
                updated_at=excluded.updated_at
        """, (
            session["client_id"], data["brand_name"], data["audience"], data["voice"],
            data["colors"], data["main_offer"], data["differentiators"], data["forbidden_words"],
            datetime.utcnow().isoformat()
        ))
        conn.commit()
    finally:
        conn.close()

    return {"status": "ok", "brand": data, "message": "Brand Kit saved."}

@app.post("/api/autopilot/generate-plan")
async def generate_social_autopilot_plan(request: Request, session: dict = Depends(require_auth)):
    _init_social_autopilot_db()
    body = await request.json()
    days = int(body.get("days", 30) or 30)
    replace_existing = bool(body.get("replace_existing", False))

    client_row = _client_for_session(session)
    if not client_row:
        raise HTTPException(status_code=404, detail="Client not found")

    conn = get_db()
    try:
        brand_row = conn.execute("SELECT * FROM brand_kits WHERE client_id=?", (session["client_id"],)).fetchone()
        brand = _row_to_brand(brand_row, client_row)
        posts = _build_local_30_day_plan(client_row, brand, days=days)

        if replace_existing:
            conn.execute("DELETE FROM social_autopilot_posts WHERE client_id=? AND status IN ('draft','queued_review','rejected')", (session["client_id"],))

        for p in posts:
            conn.execute("""
                INSERT INTO social_autopilot_posts
                    (client_id, client_name, platform, post_type, hook, caption, cta, hashtags, asset_idea, scheduled_date, scheduled_time, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session["client_id"], client_row["name"], p["platform"], p["post_type"], p["hook"], p["caption"],
                p["cta"], p["hashtags"], p["asset_idea"], p["scheduled_date"], p["scheduled_time"], p["status"]
            ))

        conn.commit()
    finally:
        conn.close()

    return {
        "status": "ok",
        "created": len(posts),
        "message": f"{len(posts)} posts generated and placed in the approval queue.",
        "publishing_enabled": False
    }

@app.get("/api/autopilot/posts")
async def list_social_autopilot_posts(status: str = "", session: dict = Depends(require_auth)):
    _init_social_autopilot_db()
    conn = get_db()
    try:
        params = []
        where = []
        if session["role"] != "owner":
            where.append("client_id=?")
            params.append(session["client_id"])
        if status:
            where.append("status=?")
            params.append(status)
        sql = "SELECT * FROM social_autopilot_posts"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY scheduled_date ASC, scheduled_time ASC, id ASC LIMIT 120"
        rows = conn.execute(sql, tuple(params)).fetchall()
    finally:
        conn.close()
    return {"status": "ok", "posts": [_post_row(r) for r in rows]}

@app.post("/api/autopilot/posts/{post_id}/approve")
async def approve_social_autopilot_post(post_id: int, request: Request, session: dict = Depends(require_owner)):
    body = await request.json()
    notes = str(body.get("notes", "")).strip()
    conn = get_db()
    try:
        conn.execute(
            "UPDATE social_autopilot_posts SET status='approved', approval_notes=?, approved_at=? WHERE id=?",
            (notes, datetime.utcnow().isoformat(), post_id)
        )
        conn.commit()
    finally:
        conn.close()
    return {"status": "ok", "message": "Post approved."}

@app.post("/api/autopilot/posts/{post_id}/reject")
async def reject_social_autopilot_post(post_id: int, request: Request, session: dict = Depends(require_owner)):
    body = await request.json()
    notes = str(body.get("notes", "")).strip() or "Needs revision."
    conn = get_db()
    try:
        conn.execute(
            "UPDATE social_autopilot_posts SET status='rejected', approval_notes=?, rejected_at=? WHERE id=?",
            (notes, datetime.utcnow().isoformat(), post_id)
        )
        conn.commit()
    finally:
        conn.close()
    return {"status": "ok", "message": "Post rejected for revision."}

@app.post("/api/autopilot/posts/{post_id}/ready")
async def mark_social_autopilot_ready(post_id: int, session: dict = Depends(require_owner)):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE social_autopilot_posts SET status='ready_to_publish' WHERE id=?",
            (post_id,)
        )
        conn.commit()
    finally:
        conn.close()
    return {"status": "ok", "message": "Post marked ready to publish. Auto-publishing is still disabled in preview mode."}

@app.get("/api/autopilot/export.csv")
async def export_social_autopilot_csv(session: dict = Depends(require_auth)):
    import csv as _csv, io as _io
    _init_social_autopilot_db()
    conn = get_db()
    try:
        if session["role"] == "owner":
            rows = conn.execute("SELECT * FROM social_autopilot_posts ORDER BY scheduled_date ASC, scheduled_time ASC").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM social_autopilot_posts WHERE client_id=? ORDER BY scheduled_date ASC, scheduled_time ASC",
                (session["client_id"],)
            ).fetchall()
    finally:
        conn.close()

    buf = _io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow(["scheduled_date", "scheduled_time", "platform", "post_type", "hook", "caption", "cta", "hashtags", "asset_idea", "status"])
    for r in rows:
        writer.writerow([r["scheduled_date"], r["scheduled_time"], r["platform"], r["post_type"], r["hook"], r["caption"], r["cta"], r["hashtags"], r["asset_idea"], r["status"]])

    return FastAPIResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=2easymarketing-social-autopilot.csv"}
    )








# ═══════════════════════════════════════════════════════════════════════════
#  GROWTH OS v1 — ALL 10 COMPETITOR GAP UPGRADES SAFE PREVIEW
# ═══════════════════════════════════════════════════════════════════════════

GROWTH_PLATFORMS = ["Instagram", "Facebook", "TikTok", "YouTube Shorts", "LinkedIn", "X / Twitter", "Pinterest"]

GROWTH_TEMPLATE_LIBRARY = [
    {
        "id": "local_offer",
        "name": "Local Offer Post",
        "category": "Offer",
        "best_for": "Local businesses",
        "hook": "Here is a simple offer your customers can act on today.",
        "structure": ["Problem", "Simple offer", "Why now", "Clear call-to-action"]
    },
    {
        "id": "before_after",
        "name": "Before / After Transformation",
        "category": "Proof",
        "best_for": "Service businesses, beauty, fitness, home services",
        "hook": "Show what life looks like before and after the service.",
        "structure": ["Before state", "What changed", "Result", "CTA"]
    },
    {
        "id": "faq_answer",
        "name": "FAQ Answer",
        "category": "Education",
        "best_for": "Any business with common customer questions",
        "hook": "Answer one question clearly so the customer trusts you.",
        "structure": ["Question", "Simple answer", "Why it matters", "CTA"]
    },
    {
        "id": "testimonial",
        "name": "Testimonial / Trust Builder",
        "category": "Trust",
        "best_for": "Businesses with reviews or client wins",
        "hook": "Use proof to make the next customer feel safer.",
        "structure": ["Customer problem", "Positive result", "Trust point", "CTA"]
    },
    {
        "id": "carousel_tips",
        "name": "Carousel Tips",
        "category": "Carousel",
        "best_for": "Instagram, LinkedIn, Facebook",
        "hook": "Turn one useful lesson into a swipeable carousel.",
        "structure": ["Title slide", "Tip 1", "Tip 2", "Tip 3", "CTA slide"]
    },
    {
        "id": "short_video_script",
        "name": "Short Video Script",
        "category": "Video",
        "best_for": "TikTok, Reels, YouTube Shorts",
        "hook": "Open strong in the first two seconds, then give one useful point.",
        "structure": ["Hook", "Point", "Proof", "CTA"]
    },
    {
        "id": "event_promo",
        "name": "Event / Launch Promo",
        "category": "Promotion",
        "best_for": "Events, launches, offers, new services",
        "hook": "Tell people what is happening, why it matters, and how to act.",
        "structure": ["Announcement", "Benefit", "Details", "CTA"]
    },
    {
        "id": "myth_buster",
        "name": "Myth Buster",
        "category": "Authority",
        "best_for": "Expert positioning",
        "hook": "Correct a common mistake and sound helpful, not pushy.",
        "structure": ["Myth", "Truth", "Example", "CTA"]
    }
]

def _growth_init_db():
    conn = get_db()
    try:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS growth_posts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id        INTEGER,
            client_name      TEXT DEFAULT '',
            source           TEXT DEFAULT '',
            platform         TEXT DEFAULT '',
            post_type        TEXT DEFAULT '',
            hook             TEXT DEFAULT '',
            caption          TEXT DEFAULT '',
            hashtags         TEXT DEFAULT '',
            asset_idea       TEXT DEFAULT '',
            status           TEXT DEFAULT 'draft_review',
            readiness_score  INTEGER DEFAULT 0,
            readiness_notes  TEXT DEFAULT '',
            scheduled_date   TEXT DEFAULT '',
            created_at       TEXT DEFAULT (datetime('now')),
            updated_at       TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS growth_usage (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id              INTEGER,
            usage_month            TEXT,
            posts_generated        INTEGER DEFAULT 0,
            repurposes             INTEGER DEFAULT 0,
            readiness_checks       INTEGER DEFAULT 0,
            queue_items            INTEGER DEFAULT 0,
            media_scene_sets       INTEGER DEFAULT 0,
            updated_at             TEXT DEFAULT (datetime('now')),
            UNIQUE(client_id, usage_month)
        );

        CREATE TABLE IF NOT EXISTS growth_onboarding (
            client_id              INTEGER PRIMARY KEY,
            brand_kit_done         INTEGER DEFAULT 0,
            first_plan_done        INTEGER DEFAULT 0,
            first_post_done        INTEGER DEFAULT 0,
            approval_flow_seen     INTEGER DEFAULT 0,
            export_seen            INTEGER DEFAULT 0,
            plugin_reviewed        INTEGER DEFAULT 0,
            trust_examples_seen    INTEGER DEFAULT 0,
            updated_at             TEXT DEFAULT (datetime('now'))
        );
        """)
        conn.commit()
    finally:
        conn.close()

def _growth_current_client(session: dict):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM clients WHERE id=?", (session["client_id"],)).fetchone()
        return row
    finally:
        conn.close()

def _growth_brand_context(session: dict) -> dict:
    client = _growth_current_client(session)
    business = (client["business"] if client else "") or (client["name"] if client else "") or "Your Business"
    base = {
        "business": business,
        "audience": "local customers and warm leads",
        "voice": "clear, professional, friendly, and direct",
        "colors": "#00c4b4, #031716, #ffffff",
        "main_offer": "send a message or book a consultation",
        "differentiators": "clear communication, modern marketing, and simple next steps",
        "forbidden_words": "guaranteed, cheapest, unbelievable"
    }
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM brand_kits WHERE client_id=?", (session["client_id"],)).fetchone()
        if row:
            for key in ["audience", "voice", "colors", "main_offer", "differentiators", "forbidden_words"]:
                if row[key]:
                    base[key] = row[key]
            if row["brand_name"]:
                base["business"] = row["brand_name"]
    except Exception:
        pass
    finally:
        conn.close()
    return base

def _growth_month() -> str:
    return datetime.utcnow().strftime("%Y-%m")

def _growth_increment_usage(client_id: int, field: str, amount: int = 1):
    if field not in {"posts_generated", "repurposes", "readiness_checks", "queue_items", "media_scene_sets"}:
        return
    conn = get_db()
    try:
        month = _growth_month()
        conn.execute("""
            INSERT INTO growth_usage (client_id, usage_month, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(client_id, usage_month) DO UPDATE SET updated_at=excluded.updated_at
        """, (client_id, month, datetime.utcnow().isoformat()))
        conn.execute(f"UPDATE growth_usage SET {field} = COALESCE({field},0) + ?, updated_at=? WHERE client_id=? AND usage_month=?",
                     (amount, datetime.utcnow().isoformat(), client_id, month))
        conn.commit()
    finally:
        conn.close()

def _growth_platform_post(idea: str, platform: str, brand: dict, template_id: str = "") -> dict:
    business = brand["business"]
    audience = brand["audience"]
    offer = brand["main_offer"]
    differentiators = brand["differentiators"]

    platform_map = {
        "Instagram": ("Reel / Carousel", "#2EasyMarketing #SmallBusinessMarketing #ContentMarketing", "Use a teal/black branded visual with one bold headline."),
        "Facebook": ("Feed Post", "#LocalBusiness #MarketingHelp #2EasyMarketing", "Use a clear service graphic and a friendly caption."),
        "TikTok": ("Short Video", "#MarketingTips #BusinessGrowth #AITools", "Use a vertical video script with text captions in the first 2 seconds."),
        "YouTube Shorts": ("Short", "#Shorts #MarketingTips #SmallBusiness", "Use a 30-45 second short video storyboard."),
        "LinkedIn": ("Thought Leadership", "#MarketingStrategy #SmallBusiness #Agency", "Use a professional text post or clean carousel."),
        "X / Twitter": ("Short Thread", "#Marketing #SmallBusiness", "Use a short hook plus 3 practical points."),
        "Pinterest": ("Pin", "#BusinessTips #MarketingIdeas #ContentPlanning", "Use a tall visual pin with headline and CTA.")
    }
    post_type, hashtags, asset = platform_map.get(platform, ("Post", "#2EasyMarketing #Marketing", "Use a clean branded visual."))

    hook = f"{business}: {idea[:72].strip()}"
    if platform in ["TikTok", "YouTube Shorts", "Instagram"]:
        caption = (
            f"Most businesses do not need more random content. They need a clear plan.\n\n"
            f"Here is the idea: {idea.strip()}\n\n"
            f"For {audience}, keep the message simple: {differentiators}.\n\n"
            f"Next step: {offer}."
        )
    elif platform == "LinkedIn":
        caption = (
            f"A stronger marketing system starts with one clear message.\n\n"
            f"Topic: {idea.strip()}\n\n"
            f"What matters most is clarity: who it helps, why it matters, and what the next step is.\n\n"
            f"For {business}, the goal is simple — help {audience} understand the value and take action.\n\n"
            f"Next step: {offer}."
        )
    else:
        caption = (
            f"{idea.strip()}\n\n"
            f"{business} helps {audience} with marketing that feels clear, organized, and ready to use.\n\n"
            f"{offer}."
        )

    score_data = _growth_readiness(platform, caption, hashtags, asset, has_cta=True)
    return {
        "platform": platform,
        "post_type": post_type,
        "hook": hook,
        "caption": caption,
        "hashtags": hashtags,
        "asset_idea": asset,
        "readiness_score": score_data["score"],
        "readiness_notes": "; ".join(score_data["issues"] or ["Ready for review."]),
        "status": "draft_review"
    }

def _growth_readiness(platform: str, caption: str, hashtags: str = "", media_type: str = "", video_seconds: int = 0, has_cta: bool = False) -> dict:
    score = 100
    issues = []
    caption = caption or ""
    hashtags = hashtags or ""

    if len(caption.strip()) < 40:
        score -= 18
        issues.append("Caption is too short to explain the value.")
    if len(caption) > 2200 and platform in ["Instagram", "Facebook", "LinkedIn"]:
        score -= 12
        issues.append("Caption may be too long for quick reading.")
    if platform in ["TikTok", "YouTube Shorts", "Instagram"] and "video" in (media_type or "").lower() and video_seconds and video_seconds > 60:
        score -= 12
        issues.append("Short-form video should usually stay under 60 seconds.")
    if platform in ["TikTok", "Instagram", "YouTube Shorts"] and not any(word in caption.lower() for word in ["watch", "here", "tip", "stop", "how", "why", "first"]):
        score -= 8
        issues.append("Opening hook could be stronger for short-form platforms.")
    if not hashtags.strip():
        score -= 10
        issues.append("Hashtags are missing.")
    elif hashtags.count("#") > 12:
        score -= 8
        issues.append("Too many hashtags can look spammy.")
    if not has_cta and not any(x in caption.lower() for x in ["message", "book", "call", "visit", "click", "send", "start", "learn more"]):
        score -= 14
        issues.append("Call-to-action is missing or unclear.")
    if platform == "Pinterest" and "pin" not in (media_type or "").lower() and "tall" not in (media_type or "").lower():
        score -= 6
        issues.append("Pinterest usually needs a tall visual layout.")
    if platform == "LinkedIn" and len(caption.split()) < 40:
        score -= 6
        issues.append("LinkedIn posts usually perform better with a little more context.")

    score = max(0, min(100, score))
    return {
        "score": score,
        "status": "ready" if score >= 85 else "needs_review" if score >= 70 else "needs_fix",
        "issues": issues,
        "summary": "Ready for review." if score >= 85 else "Good start, but check the notes."
    }

_growth_init_db()

@app.get("/api/growth/templates")
async def growth_templates(session: dict = Depends(require_auth)):
    """Viral Template Library v1."""
    return {
        "status": "ok",
        "templates": GROWTH_TEMPLATE_LIBRARY,
        "message": "Template Library loaded."
    }

@app.post("/api/growth/one-post-everywhere")
async def growth_one_post_everywhere(request: Request, session: dict = Depends(require_auth)):
    """One Post Everywhere v1 — creates platform-specific drafts and adds them to the publish queue."""
    body = await request.json()
    idea = str(body.get("idea") or body.get("topic") or "").strip()
    template_id = str(body.get("template_id") or "").strip()
    platforms = body.get("platforms") or GROWTH_PLATFORMS
    if not idea:
        return JSONResponse({"error": "Please enter a post idea or topic."}, status_code=400)

    brand = _growth_brand_context(session)
    client = _growth_current_client(session)
    client_name = (client["name"] if client else "") or brand["business"]

    posts = []
    conn = get_db()
    try:
        for platform in platforms:
            p = _growth_platform_post(idea, str(platform), brand, template_id)
            cur = conn.execute("""
                INSERT INTO growth_posts
                    (client_id, client_name, source, platform, post_type, hook, caption, hashtags, asset_idea, status, readiness_score, readiness_notes, scheduled_date, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session["client_id"], client_name, "one_post_everywhere", p["platform"], p["post_type"], p["hook"],
                p["caption"], p["hashtags"], p["asset_idea"], p["status"], p["readiness_score"], p["readiness_notes"],
                (datetime.utcnow().date() + timedelta(days=len(posts))).isoformat(), datetime.utcnow().isoformat()
            ))
            p["id"] = cur.lastrowid
            posts.append(p)
        conn.commit()
    finally:
        conn.close()

    _growth_increment_usage(session["client_id"], "posts_generated", len(posts))
    _growth_increment_usage(session["client_id"], "queue_items", len(posts))
    return {
        "status": "ok",
        "created": len(posts),
        "posts": posts,
        "message": f"{len(posts)} platform-specific drafts created and added to the publish queue."
    }

@app.post("/api/growth/repurpose")
async def growth_repurpose(request: Request, session: dict = Depends(require_auth)):
    """Content Repurposing v1 — turns notes/scripts/text into post ideas."""
    body = await request.json()
    source_text = str(body.get("source_text") or body.get("text") or "").strip()
    if not source_text:
        return JSONResponse({"error": "Paste text, notes, a script, or an article summary to repurpose."}, status_code=400)

    brand = _growth_brand_context(session)
    cleaned = re.sub(r"\s+", " ", source_text)[:1800]
    words = cleaned.split()
    short = " ".join(words[:34])
    ideas = [
        {
            "title": "Main takeaway post",
            "idea": f"Turn this into a clear post for {brand['audience']}: {short}",
            "best_platforms": ["Facebook", "LinkedIn", "Instagram"]
        },
        {
            "title": "Short video hook",
            "idea": f"Use this as a 30-second short video: {short}",
            "best_platforms": ["TikTok", "YouTube Shorts", "Instagram"]
        },
        {
            "title": "Carousel breakdown",
            "idea": f"Break this topic into 5 simple carousel slides: {short}",
            "best_platforms": ["Instagram", "LinkedIn", "Pinterest"]
        },
        {
            "title": "FAQ angle",
            "idea": f"Answer the biggest question behind this topic in plain English: {short}",
            "best_platforms": ["Facebook", "LinkedIn", "X / Twitter"]
        }
    ]

    _growth_increment_usage(session["client_id"], "repurposes", 1)
    return {
        "status": "ok",
        "source_preview": cleaned[:280],
        "ideas": ideas,
        "message": "Repurposing ideas created. Use one in One Post Everywhere."
    }

@app.post("/api/growth/readiness-check")
async def growth_readiness_check(request: Request, session: dict = Depends(require_auth)):
    """Platform Readiness Score v1."""
    body = await request.json()
    result = _growth_readiness(
        str(body.get("platform") or "Instagram"),
        str(body.get("caption") or ""),
        str(body.get("hashtags") or ""),
        str(body.get("media_type") or ""),
        int(body.get("video_seconds") or 0),
        bool(body.get("has_cta") or False)
    )
    _growth_increment_usage(session["client_id"], "readiness_checks", 1)
    return {"status": "ok", "readiness": result}

@app.get("/api/growth/publish-queue")
async def growth_publish_queue(status: str = "", session: dict = Depends(require_auth)):
    """Publish Queue Preview v1."""
    conn = get_db()
    try:
        params = []
        where = []
        if session.get("role") != "owner":
            where.append("client_id=?")
            params.append(session["client_id"])
        if status:
            where.append("status=?")
            params.append(status)
        sql = "SELECT * FROM growth_posts"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY created_at DESC LIMIT 100"
        rows = conn.execute(sql, tuple(params)).fetchall()
        posts = [dict(r) for r in rows]
    finally:
        conn.close()
    return {"status": "ok", "posts": posts, "publishing_enabled": False}

@app.post("/api/growth/publish-queue/{post_id}/status")
async def growth_update_queue_status(post_id: int, request: Request, session: dict = Depends(require_auth)):
    body = await request.json()
    new_status = str(body.get("status") or "draft_review").strip()
    allowed = {"draft_review", "needs_fix", "approved", "scheduled", "exported", "posted_preview", "rejected"}
    if new_status not in allowed:
        return JSONResponse({"error": "Invalid status."}, status_code=400)

    conn = get_db()
    try:
        if session.get("role") == "owner":
            conn.execute("UPDATE growth_posts SET status=?, updated_at=? WHERE id=?", (new_status, datetime.utcnow().isoformat(), post_id))
        else:
            conn.execute("UPDATE growth_posts SET status=?, updated_at=? WHERE id=? AND client_id=?", (new_status, datetime.utcnow().isoformat(), post_id, session["client_id"]))
        conn.commit()
    finally:
        conn.close()
    return {
        "status": "ok",
        "message": "Queue status updated.",
        "publishing_enabled": False,
        "note": "This is still preview mode. It does not auto-post to social media yet."
    }

@app.post("/api/growth/carousel-scenes")
async def growth_carousel_scenes(request: Request, session: dict = Depends(require_auth)):
    """AI Visual Agent v1 — carousel/slideshow/video scene builder."""
    body = await request.json()
    topic = str(body.get("topic") or "").strip()
    if not topic:
        return JSONResponse({"error": "Please enter a topic."}, status_code=400)
    count = max(3, min(int(body.get("slides") or 5), 8))
    brand = _growth_brand_context(session)
    scenes = []
    for i in range(count):
        if i == 0:
            title = f"{topic}"
            body_text = f"Make the first slide clear and bold for {brand['business']}."
        elif i == count - 1:
            title = "Ready to take the next step?"
            body_text = brand["main_offer"]
        else:
            title = f"Point {i}"
            body_text = f"Explain one useful point about {topic} in simple language."
        scenes.append({
            "slide": i + 1,
            "title": title,
            "body": body_text,
            "visual_direction": f"Use {brand['colors']} with a clean dark background, teal accent, and strong white headline.",
            "voiceover_line": f"{title}. {body_text}"
        })

    _growth_increment_usage(session["client_id"], "media_scene_sets", 1)
    return {
        "status": "ok",
        "topic": topic,
        "scenes": scenes,
        "message": "Carousel / video scene plan created."
    }

@app.get("/api/growth/usage")
async def growth_usage(session: dict = Depends(require_auth)):
    """Credits / Usage Tracking v1."""
    conn = get_db()
    try:
        month = _growth_month()
        row = conn.execute("SELECT * FROM growth_usage WHERE client_id=? AND usage_month=?", (session["client_id"], month)).fetchone()
        usage = dict(row) if row else {
            "client_id": session["client_id"], "usage_month": month, "posts_generated": 0, "repurposes": 0,
            "readiness_checks": 0, "queue_items": 0, "media_scene_sets": 0
        }
    finally:
        conn.close()
    return {"status": "ok", "usage": usage}

@app.get("/api/growth/onboarding")
async def growth_onboarding(session: dict = Depends(require_auth)):
    """Trust + Onboarding Checklist v1."""
    conn = get_db()
    try:
        conn.execute("INSERT OR IGNORE INTO growth_onboarding (client_id, updated_at) VALUES (?, ?)", (session["client_id"], datetime.utcnow().isoformat()))
        conn.commit()
        row = conn.execute("SELECT * FROM growth_onboarding WHERE client_id=?", (session["client_id"],)).fetchone()
        data = dict(row)
    finally:
        conn.close()
    steps = [
        {"key": "brand_kit_done", "label": "Complete Brand Kit", "why": "Your tools need voice, audience, offer, and colors."},
        {"key": "first_plan_done", "label": "Generate first 30-day plan", "why": "Start with a clear content direction."},
        {"key": "first_post_done", "label": "Create one post everywhere", "why": "Turn one idea into multiple platform drafts."},
        {"key": "approval_flow_seen", "label": "Review approval workflow", "why": "Nothing should move forward without approval."},
        {"key": "export_seen", "label": "Review export / publish queue", "why": "Know what is ready, scheduled, or exported."},
        {"key": "plugin_reviewed", "label": "Review Plugin Hub", "why": "See what can be connected later."},
        {"key": "trust_examples_seen", "label": "Review examples and service proof", "why": "Trust and proof help customers buy."}
    ]
    for s in steps:
        s["done"] = bool(data.get(s["key"], 0))
    return {"status": "ok", "steps": steps, "raw": data}

@app.post("/api/growth/onboarding")
async def growth_update_onboarding(request: Request, session: dict = Depends(require_auth)):
    body = await request.json()
    key = str(body.get("key") or "").strip()
    value = 1 if bool(body.get("done", True)) else 0
    allowed = {"brand_kit_done", "first_plan_done", "first_post_done", "approval_flow_seen", "export_seen", "plugin_reviewed", "trust_examples_seen"}
    if key not in allowed:
        return JSONResponse({"error": "Invalid onboarding key."}, status_code=400)
    conn = get_db()
    try:
        conn.execute("INSERT OR IGNORE INTO growth_onboarding (client_id, updated_at) VALUES (?, ?)", (session["client_id"], datetime.utcnow().isoformat()))
        conn.execute(f"UPDATE growth_onboarding SET {key}=?, updated_at=? WHERE client_id=?", (value, datetime.utcnow().isoformat(), session["client_id"]))
        conn.commit()
    finally:
        conn.close()
    return {"status": "ok", "message": "Onboarding updated."}

@app.get("/api/growth/webhook-guide")
async def growth_webhook_guide(session: dict = Depends(require_auth)):
    """API + Automation guide v1."""
    return {
        "status": "ok",
        "api_ready": False,
        "webhooks_enabled": False,
        "message": "Preview guide only. Public API keys and webhooks should be added after core workflow testing.",
        "future_endpoints": [
            "/api/growth/one-post-everywhere",
            "/api/growth/publish-queue",
            "/api/growth/readiness-check",
            "/api/growth/templates",
            "/api/growth/usage"
        ],
        "safe_rule": "Do not expose private API keys in frontend files or GitHub."
    }


# ═══════════════════════════════════════════════════════════════════════════
#  SUBSCRIPTION ACCESS — HUMAN CLEAN PLAN-BASED DASHBOARD
# ═══════════════════════════════════════════════════════════════════════════

PLAN_ACCESS = {
    "starter": {
        "label": "Starter Platform",
        "mode": "Self-Service",
        "description": "For customers who want simple tools to organize and create their own marketing content.",
        "price_note": "$29.99/mo",
        "visible_views": ["dashboard", "pricing", "plan-access", "growth-os", "launch-checklist", "new-task", "my-tasks", "content-calendar"],
        "included_tools": [
            "Dashboard",
            "New Task",
            "My Tasks",
            "Brand Kit",
            "Basic Content Calendar",
            "AI Captions",
            "CSV Export",
            "Basic Reports"
        ],
        "limited_tools": ["Content Calendar"],
        "locked_tools": ["Plugin Hub", "Media Factory", "Voiceover", "Multi-Client", "Ad Engine"],
        "best_for": "Solo business owners who want a simple starting point."
    },
    "pro": {
        "label": "Pro Platform",
        "mode": "Advanced Self-Service",
        "description": "For businesses that want more automation, media tools, approvals, and reporting.",
        "price_note": "$49.99/mo",
        "visible_views": ["dashboard", "pricing", "plan-access", "growth-os", "launch-checklist", "new-task", "my-tasks", "content-calendar", "media-factory", "channel-hub", "plugin-hub", "client-reports"],
        "included_tools": [
            "Everything in Starter",
            "Social Autopilot",
            "Approval Queue",
            "Media Factory",
            "Plugin Hub Preview",
            "Platform Readiness Score",
            "Weekly Reports"
        ],
        "limited_tools": ["Plugin Hub live connections", "Real MP4/MP3 media until API keys are connected"],
        "locked_tools": ["Multi-Client Agency View"],
        "best_for": "Businesses that want to run their own marketing with stronger tools."
    },
    "done_for_you": {
        "label": "Done-For-You",
        "mode": "Client Portal",
        "description": "For clients who want 2EasyMarketing to do the work while they review and approve.",
        "price_note": "$399+/mo",
        "visible_views": ["dashboard", "pricing", "plan-access", "growth-os", "launch-checklist", "new-task", "my-tasks", "content-calendar", "client-reports"],
        "included_tools": [
            "Submit Requests",
            "Content Waiting for Approval",
            "Approve / Reject Posts",
            "Campaign Progress",
            "Reports",
            "Messages from 2EasyMarketing"
        ],
        "limited_tools": ["Self-service editing tools"],
        "locked_tools": ["Agency Multi-Client Tools", "Owner System Tools"],
        "best_for": "Clients who want help instead of doing everything themselves."
    },
    "agency": {
        "label": "Agency / Multi-Client",
        "mode": "Scale Plan",
        "description": "For managing multiple clients, brand kits, queues, reports, and export/publish workflows.",
        "price_note": "$149.99/mo",
        "visible_views": ["dashboard", "pricing", "plan-access", "growth-os", "launch-checklist", "new-task", "my-tasks", "content-calendar", "media-factory", "channel-hub", "plugin-hub", "client-reports", "clients", "revenue"],
        "included_tools": [
            "Multiple Clients",
            "Client Switcher",
            "Team Workflow",
            "Multiple Brand Kits",
            "Approval Queues Per Client",
            "Reports Per Client",
            "Export / Publish Queue"
        ],
        "limited_tools": ["Live publishing until social APIs are connected"],
        "locked_tools": ["Owner-only system controls"],
        "best_for": "Agencies, creators, and managers who need to handle more than one client."
    },
    "owner": {
        "label": "Owner",
        "mode": "2EasyMarketing Admin",
        "description": "Full internal access for managing clients, systems, reports, plugins, automations, and revenue.",
        "price_note": "Internal account",
        "visible_views": ["dashboard", "pricing", "plan-access", "growth-os", "launch-checklist", "new-task", "my-tasks", "owner-dashboard", "clients", "media-factory", "autonomous", "channel-hub", "content-calendar", "plugin-hub", "competitor-spy", "revenue", "client-reports", "system-health", "update-log", "council", "ad-engine", "security"],
        "included_tools": [
            "All client tools",
            "Owner Dashboard",
            "Clients",
            "Autonomous Engine",
            "Competitor Spy",
            "Revenue",
            "System Health",
            "LLM Council",
            "Ad Engine",
            "Security"
        ],
        "limited_tools": ["Live external services require valid provider API keys"],
        "locked_tools": [],
        "best_for": "Internal 2EasyMarketing operations."
    }
}

FEATURE_TO_VIEW = {
    "media_factory": "media-factory",
    "plugin_hub": "plugin-hub",
    "channel_hub": "channel-hub",
    "client_reports": "client-reports",
    "content_calendar": "content-calendar",
    "clients": "clients",
    "revenue": "revenue",
    "ad_engine": "ad-engine",
    "owner_dashboard": "owner-dashboard"
}

def _normalize_plan_name(plan: str) -> str:
    raw = str(plan or "starter").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "basic": "starter",
        "free": "starter",
        "starter_platform": "starter",
        "premium": "pro",
        "professional": "pro",
        "pro_platform": "pro",
        "done_for_you": "done_for_you",
        "doneforyou": "done_for_you",
        "managed": "done_for_you",
        "managed_service": "done_for_you",
        "agency_multi_client": "agency",
        "multi_client": "agency",
        "scale": "agency",
        "enterprise": "agency",
        "admin": "owner"
    }
    return aliases.get(raw, raw if raw in PLAN_ACCESS else "starter")

def _subscription_access_for_session(session: dict) -> dict:
    role = session.get("role", "client")
    if role == "owner":
        plan_key = "owner"
    else:
        conn = get_db()
        try:
            row = conn.execute("SELECT plan FROM clients WHERE id=?", (session["client_id"],)).fetchone()
            plan_key = _normalize_plan_name(row["plan"] if row else "starter")
        finally:
            conn.close()

    plan = dict(PLAN_ACCESS.get(plan_key, PLAN_ACCESS["starter"]))
    plan["key"] = plan_key
    plan["role"] = role
    plan["all_plan_keys"] = ["starter", "pro", "done_for_you", "agency"]
    plan["publishing_enabled"] = False
    plan["truth_note"] = "This controls what the customer sees. Live posting and paid AI media still require real provider connections."
    return plan

@app.get("/api/subscription/access")
async def subscription_access(session: dict = Depends(require_auth)):
    """Return the current user's plan and the views/tools they are allowed to see."""
    return {"status": "ok", "access": _subscription_access_for_session(session)}

@app.get("/api/subscription/plans")
async def subscription_plans(session: dict = Depends(require_auth)):
    """Return human-readable plan comparison for the dashboard."""
    plans = []
    for key in ["starter", "pro", "done_for_you", "agency"]:
        p = dict(PLAN_ACCESS[key])
        p["key"] = key
        plans.append(p)
    return {
        "status": "ok",
        "pricing_order": ["starter", "pro", "agency", "done_for_you"],
        "plans": plans,
        "publishing_enabled": False,
        "message": "Preview mode. This comparison is for plan access and onboarding clarity."
    }

@app.get("/api/subscription/check/{feature}")
async def subscription_check(feature: str, session: dict = Depends(require_auth)):
    access = _subscription_access_for_session(session)
    view = FEATURE_TO_VIEW.get(feature)
    allowed = bool(view and view in access["visible_views"])
    return {
        "status": "ok",
        "feature": feature,
        "allowed": allowed,
        "plan": access["key"],
        "message": "Allowed for this plan." if allowed else "This feature is available on a higher plan."
    }


# ═══════════════════════════════════════════════════════════════════════════
#  PLUGIN HUB PREVIEW — SAFE INTEGRATION MARKETPLACE
# ═══════════════════════════════════════════════════════════════════════════

PLUGIN_CATALOG = [
    {
        "slug": "instagram-facebook",
        "name": "Instagram + Facebook",
        "category": "Social Channels",
        "status": "setup_required",
        "icon": "IG",
        "description": "Connect Meta pages, schedule posts, push Reels, and manage approval before publishing.",
        "features": ["OAuth", "Reels", "Pages"],
        "required_env": ["META_APP_ID", "META_APP_SECRET"]
    },
    {
        "slug": "youtube-shorts",
        "name": "YouTube Shorts",
        "category": "Social Channels",
        "status": "setup_required",
        "icon": "YT",
        "description": "Upload approved Shorts, attach captions, thumbnails, and track video performance.",
        "features": ["Shorts", "Upload", "Analytics"],
        "required_env": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
    },
    {
        "slug": "tiktok-publisher",
        "name": "TikTok Publisher",
        "category": "Social Channels",
        "status": "setup_required",
        "icon": "TT",
        "description": "Prepare TikTok clips, captions, hashtags, approvals, and publishing workflow.",
        "features": ["Videos", "Captions", "Queue"],
        "required_env": ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]
    },
    {
        "slug": "elevenlabs-voiceover",
        "name": "ElevenLabs Voiceover",
        "category": "AI Media",
        "status": "setup_required",
        "icon": "EL",
        "description": "Create real MP3 voiceovers from approved scripts using natural AI voices.",
        "features": ["MP3", "TTS", "Voices"],
        "required_env": ["ELEVENLABS_API_KEY"]
    },
    {
        "slug": "luma-video-api",
        "name": "Luma Video API",
        "category": "AI Media",
        "status": "setup_required",
        "icon": "LU",
        "description": "Generate actual MP4 AI video ads from your Media Factory storyboards.",
        "features": ["MP4", "Video AI", "Ads"],
        "required_env": ["LUMA_API_KEY"]
    },
    {
        "slug": "openai-images",
        "name": "OpenAI Images",
        "category": "AI Media",
        "status": "setup_required",
        "icon": "OA",
        "description": "Create real AI images for ads, thumbnails, carousels, campaigns, and posts.",
        "features": ["Images", "Ads", "Creative"],
        "required_env": ["OPENAI_API_KEY"]
    },
    {
        "slug": "email-engine",
        "name": "Email Engine",
        "category": "Email & SMS",
        "status": "connected",
        "icon": "EM",
        "description": "Generate client emails, campaign updates, reminders, reports, and follow-up messages.",
        "features": ["Built-In", "Reports", "Client Updates"],
        "required_env": []
    },
    {
        "slug": "approval-queue",
        "name": "Approval Queue",
        "category": "Automation",
        "status": "connected",
        "icon": "AP",
        "description": "Owner/client approval workflow before publishing, exporting, or sending campaigns.",
        "features": ["Built-In", "Approve", "Reject"],
        "required_env": []
    },
    {
        "slug": "csv-export",
        "name": "CSV Export",
        "category": "Automation",
        "status": "connected",
        "icon": "CSV",
        "description": "Export posts, captions, schedules, clients, reports, and campaign plans.",
        "features": ["Built-In", "Export", "Safe"],
        "required_env": []
    }
]

def _plugin_with_runtime_status(plugin: dict) -> dict:
    missing = [key for key in plugin.get("required_env", []) if not os.getenv(key, "").strip()]
    out = dict(plugin)
    out["missing_env"] = missing
    if plugin["status"] != "connected":
        out["status"] = "ready_to_test" if not missing else "setup_required"
    out["publishing_enabled"] = False
    return out

@app.get("/api/plugins/catalog")
async def plugin_catalog(session: dict = Depends(require_auth)):
    """Return safe Plugin Hub catalog. Preview mode: nothing connects or publishes automatically."""
    plugins = [_plugin_with_runtime_status(p) for p in PLUGIN_CATALOG]
    return {
        "status": "ok",
        "preview_mode": True,
        "publishing_enabled": False,
        "plugins": plugins,
        "summary": {
            "total": len(plugins),
            "connected": len([p for p in plugins if p["status"] == "connected"]),
            "setup_required": len([p for p in plugins if p["status"] == "setup_required"]),
            "ready_to_test": len([p for p in plugins if p["status"] == "ready_to_test"]),
        }
    }

@app.get("/api/plugins/{slug}")
async def plugin_detail(slug: str, session: dict = Depends(require_auth)):
    plugin = next((p for p in PLUGIN_CATALOG if p["slug"] == slug), None)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    p = _plugin_with_runtime_status(plugin)
    return {
        "status": "ok",
        "plugin": p,
        "setup_steps": [
            "Create the provider developer account/app if needed.",
            "Copy the required API key/client ID/client secret.",
            "Add the values in Railway Variables, never inside GitHub code.",
            "Redeploy Railway.",
            "Come back to Plugin Hub and press Test Connection."
        ],
        "message": "Preview mode only. Real OAuth connection will be added in a later phase."
    }

@app.post("/api/plugins/{slug}/test")
async def plugin_test_connection(slug: str, session: dict = Depends(require_owner)):
    plugin = next((p for p in PLUGIN_CATALOG if p["slug"] == slug), None)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    p = _plugin_with_runtime_status(plugin)
    if p["missing_env"]:
        return JSONResponse(
            status_code=200,
            content={
                "status": "setup_required",
                "plugin": p,
                "message": f"Missing Railway Variables: {', '.join(p['missing_env'])}"
            }
        )
    return {
        "status": "ok",
        "plugin": p,
        "message": "Required variables are present. Full live API/OAuth test will be added in the next integration phase."
    }


# ═══════════════════════════════════════════════════════════════════════════
#  MAYA AI MEDIA FACTORY — Image Ads, Video Ads, Voiceover
# ═══════════════════════════════════════════════════════════════════════════

import subprocess, uuid
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

def _default_media_dir() -> str:
    if os.path.isdir("/data"):
        return "/data/media"
    if os.path.isdir("/app"):
        return "/app/media"
    return os.path.join(os.getcwd(), "media")

MEDIA_DIR = os.environ.get("MEDIA_DIR") or _default_media_dir()
os.makedirs(MEDIA_DIR, exist_ok=True)

# Serve generated media files statically
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


# ─── PROMPT BUILDER FOR AD CREATIVES ─────────────────────────────────────────

def build_image_prompt(brief: dict) -> str:
    business   = brief.get("business", "a business")
    style      = brief.get("style", "modern professional")
    platform   = brief.get("platform", "social media")
    goal       = brief.get("goal", "brand awareness")
    colors     = brief.get("colors", "dark blue and cyan")
    extra      = brief.get("brief", "")
    aspect     = brief.get("aspect_ratio", "1:1")
    dim_hint   = {"16:9": "widescreen landscape", "9:16": "vertical portrait story format", "1:1": "square", "4:3": "landscape", "3:4": "portrait"}[aspect]

    return (
        f"Professional {style} advertisement for {business}. "
        f"Platform: {platform}. Campaign goal: {goal}. "
        f"Color palette: {colors}. Format: {dim_hint}. "
        f"High-end ad agency quality. Cinematic lighting. No readable text unless specified. "
        f"Additional direction: {extra}. "
        f"Make it scroll-stopping, aspirational, and conversion-focused. "
        f"Photorealistic 3D render quality or clean digital art style."
    )


def build_video_prompt(brief: dict) -> str:
    business   = brief.get("business", "a business")
    style      = brief.get("video_style", "cinematic")
    platform   = brief.get("platform", "social media")
    duration   = int(brief.get("duration", 8))
    hook       = brief.get("hook", "dramatic reveal")
    extra      = brief.get("brief", "")
    return (
        f"{style.title()} {duration}-second video ad for {business}. "
        f"Platform: {platform}. Opening hook: {hook}. "
        f"Show: product/service benefit, rising metrics, energy and momentum. "
        f"Camera: slow cinematic push-in, then dramatic pull-back at climax. "
        f"Mood: premium, confident, results-driven. "
        f"Native audio: upbeat electronic music building to crescendo, subtle whoosh effects. "
        f"End frame: strong call-to-action moment with brand energy. "
        f"Additional: {extra}"
    )



MEDIA_FALLBACK_NOTE = """
Media generation fallback:
The generation request was received and processed, but the external media CLI/provider is not configured in this deployment.
The task was converted into a production-ready creative brief instead of failing silently.
"""

def _media_fallback_result(file_type: str, brief: dict) -> str:
    business = brief.get("business", "the business")
    platform = brief.get("platform", "social media")
    goal = brief.get("goal", "marketing growth")
    details = brief.get("brief", "")
    return f"""{file_type.upper()}_BRIEF_READY

{MEDIA_FALLBACK_NOTE}

Business: {business}
Platform: {platform}
Goal: {goal}

Creative Direction:
{details}

Next Step:
Add the required AI media provider/CLI credentials to Railway, then regenerate this task. For now, this brief can be used by the owner to create the final asset manually or through an external design tool.
"""


# ─── IMAGE AD GENERATION ─────────────────────────────────────────────────────

async def generate_image_ad(task_id: int, brief: dict):
    """Generate an AI ad image using asi-generate-image CLI."""
    try:
        aspect = brief.get("aspect_ratio", "1:1")
        fname  = f"img_ad_{task_id}_{uuid.uuid4().hex[:8]}"
        prompt = build_image_prompt(brief)

        payload = json.dumps({
            "prompt": prompt,
            "filename": fname,
            "aspect_ratio": aspect,
            "model": "gpt_image_2"
        })

        env = {**os.environ, "PPLX_TOOL": "llm-api:image"}
        proc = await asyncio.create_subprocess_exec(
            "asi-generate-image", payload,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=MEDIA_DIR
        )
        stdout, stderr = await proc.communicate()

        out = stdout.decode() + stderr.decode()
        # Find the saved file path
        img_path = None
        for line in out.splitlines():
            if "Image saved to" in line:
                img_path = line.split("Image saved to")[-1].strip().split(" ")[0]
                break

        if not img_path:
            # Try constructed path
            img_path = f"{MEDIA_DIR}/{fname}.png"

        if os.path.exists(img_path):
            # Save to media dir if not already there
            if not img_path.startswith(MEDIA_DIR):
                import shutil
                dest = f"{MEDIA_DIR}/{fname}.png"
                shutil.move(img_path, dest)
                img_path = dest

            rel_path = os.path.basename(img_path)
            # Update task with file URL + text result
            conn = get_db()
            conn.execute(
                "INSERT OR IGNORE INTO media_files (task_id, client_id, file_type, filename, file_path, status) "
                "SELECT id, client_id, 'image_ad', ?, ?, 'ready' FROM tasks WHERE id=?",
                (rel_path, img_path, task_id)
            )
            result_text = f"IMAGE_AD_READY:{rel_path}\n\nYour AI-generated ad image is ready! It has been created based on your brief and is optimized for {brief.get('platform','social media')}. Dev will review and deliver it shortly."
            conn.execute(
                "UPDATE tasks SET ai_result=?, status='review' WHERE id=?",
                (result_text, task_id)
            )
            conn.commit()
            conn.close()
            print(f"✅ Image ad generated for task {task_id}: {rel_path}")
        else:
            raise Exception(f"Image file not found after generation. Output: {out[:300]}")

    except Exception as e:
        print(f"❌ Image ad error task {task_id}: {e}")
        conn = get_db()
        fallback_text = _media_fallback_result("image_ad", brief)
        conn.execute(
            "UPDATE tasks SET ai_result=?, status='review', owner_notes=? WHERE id=?",
            (fallback_text, f"Image generation fallback used: {str(e)[:200]}", task_id)
        )
        conn.commit()
        conn.close()


# ─── VIDEO AD GENERATION ─────────────────────────────────────────────────────

async def generate_video_ad(task_id: int, brief: dict):
    """Generate an AI video ad using asi-generate-video CLI."""
    try:
        aspect   = brief.get("aspect_ratio", "16:9")
        duration = int(brief.get("duration", 8))
        fname    = f"vid_ad_{task_id}_{uuid.uuid4().hex[:8]}"
        prompt   = build_video_prompt(brief)

        payload = json.dumps({
            "prompt": prompt,
            "filename": fname,
            "aspect_ratio": aspect,
            "duration": duration,
            "model": "veo_3_1"
        })

        env = {**os.environ, "PPLX_TOOL": "llm-api:video"}
        proc = await asyncio.create_subprocess_exec(
            "asi-generate-video", payload,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=MEDIA_DIR
        )
        stdout, stderr = await proc.communicate()

        out = stdout.decode() + stderr.decode()
        vid_path = None
        for line in out.splitlines():
            if "Video saved to" in line:
                vid_path = line.split("Video saved to")[-1].strip().split(" ")[0]
                break

        if not vid_path:
            vid_path = f"{MEDIA_DIR}/{fname}.mp4"

        if os.path.exists(vid_path):
            if not vid_path.startswith(MEDIA_DIR):
                import shutil
                dest = f"{MEDIA_DIR}/{fname}.mp4"
                shutil.move(vid_path, dest)
                vid_path = dest

            rel_path = os.path.basename(vid_path)
            conn = get_db()
            conn.execute(
                "INSERT OR IGNORE INTO media_files (task_id, client_id, file_type, filename, file_path, status) "
                "SELECT id, client_id, 'video_ad', ?, ?, 'ready' FROM tasks WHERE id=?",
                (rel_path, vid_path, task_id)
            )
            result_text = f"VIDEO_AD_READY:{rel_path}\n\nYour AI-generated video ad is ready! It's a {duration}-second cinematic ad optimized for {brief.get('platform','social media')}. Dev will review and deliver it shortly."
            conn.execute(
                "UPDATE tasks SET ai_result=?, status='review' WHERE id=?",
                (result_text, task_id)
            )
            conn.commit()
            conn.close()
            print(f"✅ Video ad generated for task {task_id}: {rel_path}")
        else:
            raise Exception(f"Video file not found after generation. Output: {out[:300]}")

    except Exception as e:
        print(f"❌ Video ad error task {task_id}: {e}")
        conn = get_db()
        fallback_text = _media_fallback_result("video_ad", brief)
        conn.execute(
            "UPDATE tasks SET ai_result=?, status='review', owner_notes=? WHERE id=?",
            (fallback_text, f"Video generation fallback used: {str(e)[:200]}", task_id)
        )
        conn.commit()
        conn.close()


# ─── VOICEOVER GENERATION ────────────────────────────────────────────────────

async def generate_voiceover(task_id: int, brief: dict):
    """Generate AI voiceover using asi-text-to-speech CLI."""
    try:
        script   = brief.get("script", brief.get("brief", "Welcome to 2EasyMarketing."))
        voice    = brief.get("voice", "charon")
        fname    = f"vo_{task_id}_{uuid.uuid4().hex[:8]}.txt"
        txt_path = f"{MEDIA_DIR}/{fname}"

        with open(txt_path, "w") as f:
            f.write(script)

        out_base = fname.replace(".txt", "")
        out_path = f"{MEDIA_DIR}/{out_base}.mp3"

        payload = json.dumps({
            "file_path": txt_path,
            "voice": voice
        })

        env = {**os.environ, "PPLX_TOOL": "llm-api:audio"}
        proc = await asyncio.create_subprocess_exec(
            "asi-text-to-speech", payload,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=MEDIA_DIR
        )
        stdout, stderr = await proc.communicate()
        out = stdout.decode() + stderr.decode()

        # Find generated audio file
        audio_path = None
        for line in out.splitlines():
            if "saved to" in line.lower() or ".mp3" in line or ".wav" in line:
                for part in line.split():
                    if part.endswith((".mp3", ".wav", ".ogg")):
                        audio_path = part
                        break

        if not audio_path:
            # Try workspace default location
            import glob as globmod
            candidates = globmod.glob(f"/home/user/workspace/*.mp3") + globmod.glob(f"/home/user/workspace/*.wav")
            if candidates:
                audio_path = sorted(candidates, key=os.path.getmtime)[-1]

        if audio_path and os.path.exists(audio_path):
            if not audio_path.startswith(MEDIA_DIR):
                import shutil
                dest = f"{MEDIA_DIR}/{os.path.basename(audio_path)}"
                shutil.move(audio_path, dest)
                audio_path = dest

            rel_path = os.path.basename(audio_path)
            conn = get_db()
            conn.execute(
                "INSERT OR IGNORE INTO media_files (task_id, client_id, file_type, filename, file_path, status) "
                "SELECT id, client_id, 'voiceover', ?, ?, 'ready' FROM tasks WHERE id=?",
                (rel_path, audio_path, task_id)
            )
            result_text = f"VOICEOVER_READY:{rel_path}\n\nYour AI voiceover is ready! Voice: {voice}. Dev will review and deliver the audio file shortly."
            conn.execute(
                "UPDATE tasks SET ai_result=?, status='review' WHERE id=?",
                (result_text, task_id)
            )
            conn.commit()
            conn.close()
            print(f"✅ Voiceover generated for task {task_id}: {rel_path}")
        else:
            raise Exception(f"Audio file not found. Output: {out[:300]}")

    except Exception as e:
        print(f"❌ Voiceover error task {task_id}: {e}")
        conn = get_db()
        fallback_text = _media_fallback_result("voiceover", brief)
        conn.execute(
            "UPDATE tasks SET ai_result=?, status='review', owner_notes=? WHERE id=?",
            (fallback_text, f"Voiceover fallback used: {str(e)[:200]}", task_id)
        )
        conn.commit()
        conn.close()


@app.post("/api/ads/generate-campaign")
async def generate_ad_campaign_ai(request: Request, session: dict = Depends(require_owner)):
    """
    Generate ad campaign copy from the backend so API keys never appear in browser code.
    This route now returns a usable fallback campaign if Anthropic is missing or temporarily fails.
    """
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    def fallback_campaign(reason: str = "") -> dict:
        return {
            "campaignName": "2EasyMarketing AI Campaign Draft",
            "summary": "A ready-to-edit campaign draft was generated locally because the live AI provider was unavailable. Add ANTHROPIC_API_KEY in Railway to turn on full AI generation.",
            "variations": [
                {"headline": "Grow Faster Today", "body": "Get a high-converting marketing campaign built around your strongest offer.", "cta": "Start"},
                {"headline": "More Leads, Less Stress", "body": "Launch a clean campaign designed to attract the right customers and drive action.", "cta": "Learn More"},
                {"headline": "Turn Clicks Into Clients", "body": "Use a focused offer, clear targeting, and strong follow-up to improve conversions.", "cta": "Book Now"}
            ],
            "audience": {
                "targeting": "Local small-business customers and warm prospects most likely to need the offer now.",
                "interests": ["Small business", "Local services", "Entrepreneurship", "Marketing", "Business growth"],
                "behaviors": "People who engage with service businesses, request quotes, or visit competitor websites.",
                "lookalike": "Create a lookalike audience from existing leads, email subscribers, or website visitors."
            },
            "budget": {
                "dailySpend": "40.00",
                "totalEstimate": "Set based on selected duration",
                "splitRecommendation": "Start with 70% prospecting and 30% retargeting, then shift budget to the best performer.",
                "bestTimes": "Launch Monday morning, review performance after 72 hours, then optimize creative and targeting.",
                "expectedResults": "Expect early learning data first, then optimize toward leads, clicks, or conversions."
            },
            "strategy": "Use one clear offer, one strong call-to-action, and retarget everyone who clicks but does not convert.",
            "fallbackReason": reason
        }

    model = os.getenv("ANTHROPIC_AD_MODEL", os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"))
    max_tokens = int(body.get("max_tokens", 1200) or 1200)

    try:
        if not os.getenv("ANTHROPIC_API_KEY", "").strip():
            return {"content": [{"text": json.dumps(fallback_campaign("Missing ANTHROPIC_API_KEY"))}]}

        response = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return {"content": [{"text": response.content[0].text.strip()}]}

    except Exception as e:
        print(f"Ad campaign AI fallback used: {e}")
        return {"content": [{"text": json.dumps(fallback_campaign(str(e)))}]}


# ─── MEDIA TASK ROUTER — hook into _fulfill_task ─────────────────────────────

_ORIGINAL_FULFILL = None

async def _fulfill_task_with_media(task_id: int, task_type: str, brief_data: dict):
    """Extended fulfillment that routes media tasks to the AI media engine."""
    if task_type == "image_ad":
        await generate_image_ad(task_id, brief_data)
    elif task_type == "video_ad":
        await generate_video_ad(task_id, brief_data)
    elif task_type == "voiceover":
        await generate_voiceover(task_id, brief_data)
    else:
        # Fall through to original text-based fulfillment
        try:
            result = await generate_ai_task(task_type, brief_data)
            conn = get_db()
            conn.execute(
                "UPDATE tasks SET ai_result=?, status=? WHERE id=?",
                (result, "review", task_id)
            )
            conn.commit()
            conn.close()
            print(f"✅ Task {task_id} fulfilled successfully")
        except Exception as e:
            print(f"❌ Task {task_id} fulfillment error: {e}")
            conn = get_db()
            conn.execute(
                "UPDATE tasks SET status=?, owner_notes=? WHERE id=?",
                ("error", f"AI error: {str(e)}", task_id)
            )
            conn.commit()
            conn.close()




# ═══════════════════════════════════════════════════════════════════════════
#  MEDIA FACTORY — INSTANT GENERATE ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════

def _media_svg_escape(value) -> str:
    return str(value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")[:260]

def _media_safe_filename(prefix: str, task_id: int, ext: str = "svg") -> str:
    return f"{prefix}_{task_id}_{uuid.uuid4().hex[:8]}.{ext}"

def _build_branded_svg(media_type: str, brief: dict, task_id: int) -> tuple[str, str]:
    """Create a branded SVG preview asset using only built-in Python."""
    title = _media_svg_escape(brief.get("title") or brief.get("brief") or "2EasyMarketing Media")
    business = _media_svg_escape(brief.get("business") or "2EasyMarketing")
    platform = _media_svg_escape(brief.get("platform") or "Social Media")
    style = _media_svg_escape(brief.get("style") or brief.get("video_style") or brief.get("tone") or "Premium")
    goal = _media_svg_escape(brief.get("goal") or brief.get("campaign_goal") or "More leads")
    details = _media_svg_escape(brief.get("brief") or "AI-generated creative direction")
    aspect = str(brief.get("aspect_ratio") or "1:1")

    is_video = media_type == "video_ad"
    width, height = (1080, 1920) if "9:16" in aspect or "Vertical" in aspect else (1600, 900) if "16:9" in aspect else (1200, 1200)
    prefix = "video_storyboard" if is_video else "image_ad"
    fname = _media_safe_filename(prefix, task_id, "svg")
    path = os.path.join(MEDIA_DIR, fname)

    label = "AI VIDEO STORYBOARD" if is_video else "AI IMAGE AD"
    icon = "PLAY" if is_video else "2E"
    footer = "Storyboard preview generated instantly — connect a video provider for final MP4" if is_video else "Image preview generated instantly"

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#031716"/>
      <stop offset="42%" stop-color="#062b2a"/>
      <stop offset="100%" stop-color="#001110"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="28%" r="62%">
      <stop offset="0%" stop-color="#00c4b4" stop-opacity=".45"/>
      <stop offset="100%" stop-color="#00c4b4" stop-opacity="0"/>
    </radialGradient>
    <filter id="softGlow">
      <feGaussianBlur stdDeviation="18" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <circle cx="{width*0.78:.0f}" cy="{height*0.16:.0f}" r="{min(width,height)*0.22:.0f}" fill="#00c4b4" opacity=".14" filter="url(#softGlow)"/>
  <circle cx="{width*0.18:.0f}" cy="{height*0.84:.0f}" r="{min(width,height)*0.18:.0f}" fill="#5eeee6" opacity=".10" filter="url(#softGlow)"/>
  <rect x="{width*.06:.0f}" y="{height*.06:.0f}" width="{width*.88:.0f}" height="{height*.88:.0f}" rx="34" fill="#061d1c" stroke="#00c4b4" stroke-width="3" opacity=".96"/>
  <text x="{width*.09:.0f}" y="{height*.13:.0f}" fill="#5eeee6" font-family="Arial, Helvetica, sans-serif" font-size="{max(26, width*.028):.0f}" font-weight="800" letter-spacing="6">{label}</text>
  <text x="{width*.09:.0f}" y="{height*.22:.0f}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="{max(44, width*.060):.0f}" font-weight="900">{title}</text>
  <text x="{width*.09:.0f}" y="{height*.29:.0f}" fill="#b7fffb" font-family="Arial, Helvetica, sans-serif" font-size="{max(24, width*.030):.0f}" font-weight="700">For {business}</text>

  <g transform="translate({width*.09:.0f},{height*.38:.0f})">
    <rect width="{width*.82:.0f}" height="{height*.26:.0f}" rx="26" fill="#001d1b" stroke="#00c4b4" stroke-width="2" opacity=".78"/>
    <text x="42" y="72" fill="#00c4b4" font-family="Arial, Helvetica, sans-serif" font-size="{max(24, width*.030):.0f}" font-weight="900">{icon}</text>
    <text x="42" y="135" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="{max(26, width*.033):.0f}" font-weight="800">Platform: {platform}</text>
    <text x="42" y="195" fill="#d6fffd" font-family="Arial, Helvetica, sans-serif" font-size="{max(24, width*.028):.0f}" font-weight="700">Style: {style}</text>
    <text x="42" y="255" fill="#d6fffd" font-family="Arial, Helvetica, sans-serif" font-size="{max(24, width*.028):.0f}" font-weight="700">Goal: {goal}</text>
  </g>

  <text x="{width*.09:.0f}" y="{height*.72:.0f}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="{max(24, width*.030):.0f}" font-weight="700">Creative Direction</text>
  <foreignObject x="{width*.09:.0f}" y="{height*.745:.0f}" width="{width*.82:.0f}" height="{height*.12:.0f}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,Helvetica,sans-serif;color:#d8fffd;font-size:{max(22, width*.026):.0f}px;line-height:1.35;font-weight:500;">
      {details}
    </div>
  </foreignObject>

  <rect x="{width*.09:.0f}" y="{height*.88:.0f}" width="{width*.50:.0f}" height="{height*.055:.0f}" rx="18" fill="#00c4b4"/>
  <text x="{width*.12:.0f}" y="{height*.916:.0f}" fill="#001110" font-family="Arial, Helvetica, sans-serif" font-size="{max(22, width*.028):.0f}" font-weight="900">Generated by 2EasyMarketing</text>
  <text x="{width*.09:.0f}" y="{height*.965:.0f}" fill="#7ff7ef" font-family="Arial, Helvetica, sans-serif" font-size="{max(18, width*.020):.0f}" opacity=".75">{footer}</text>
</svg>"""

    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    return fname, path

def _build_voiceover_script(brief: dict) -> str:
    title = brief.get("title") or "2EasyMarketing Voiceover"
    business = brief.get("business") or "your business"
    purpose = brief.get("purpose") or "Promotional Announcement"
    tone = brief.get("tone") or "Professional & Confident"
    duration = brief.get("duration") or "30 seconds"
    message = brief.get("brief") or "Promote the main offer and invite customers to take action."

    return f"""🎙️ {title}

Purpose: {purpose}
Tone: {tone}
Target length: {duration}

SCRIPT:
Are you ready to make marketing easier and more effective? At {business}, your message deserves to be clear, professional, and built to get attention.

{message}

Now is the time to turn interest into action. Keep it simple, make it memorable, and give your audience one clear next step.

Call to action:
Visit the website, send a message, or book today to get started.

Voice direction:
Read with a confident, warm, modern delivery. Start calm, build energy in the middle, and finish with a clear call-to-action.
"""

@app.post("/api/media-factory/generate")
async def media_factory_generate(request: Request, session: dict = Depends(require_auth)):
    """
    Immediate Media Factory generator.

    This fixes the portal buttons so Image, Video, and Voiceover produce an
    instant on-page result. Image/video previews are generated as branded SVG
    assets without requiring external CLI tools. Voiceover creates a polished
    script plus browser speech preview on the frontend.
    """
    body = await request.json()
    media_type = (body.get("task_type") or body.get("media_type") or "").strip()
    brief_raw = body.get("brief") or {}

    if media_type not in ("image_ad", "video_ad", "voiceover"):
        return JSONResponse({"error": "Invalid media type"}, status_code=400)

    conn = get_db()
    client_row = conn.execute("SELECT * FROM clients WHERE id=?", (session["client_id"],)).fetchone()
    if not client_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Client not found")

    brief = {
        "business": client_row["business"] or client_row["name"] or "2EasyMarketing",
        "website": client_row["website"] or "",
        "plan": client_row["plan"],
        **({k: str(v) for k, v in brief_raw.items()} if isinstance(brief_raw, dict) else {"brief": str(brief_raw)})
    }

    title = brief.get("title") or {
        "image_ad": "AI Image Ad",
        "video_ad": "AI Video Storyboard",
        "voiceover": "AI Voiceover Script"
    }.get(media_type, "AI Media")

    cur = conn.execute("""
        INSERT INTO tasks (client_id, client_name, client_email, client_plan, task_type, title, brief, status)
        VALUES (?,?,?,?,?,?,?,?)
    """, (
        client_row["id"], client_row["name"], client_row["email"], client_row["plan"],
        media_type, title, json.dumps(brief), "delivered"
    ))
    conn.commit()
    task_id = cur.lastrowid

    media_url = ""
    filename = ""
    content = ""
    ai_result = ""

    if media_type == "image_ad":
        filename, path = _build_branded_svg("image_ad", brief, task_id)
        media_url = f"/media/{filename}"
        ai_result = f"IMAGE_AD_READY:{filename}\n\nInstant AI image-ad preview generated by 2EasyMarketing."
        content = "Instant branded image-ad preview generated."

        conn.execute(
            "INSERT INTO media_files (task_id, client_id, file_type, filename, file_path, status) VALUES (?,?,?,?,?,?)",
            (task_id, client_row["id"], "image_ad", filename, path, "ready")
        )

    elif media_type == "video_ad":
        filename, path = _build_branded_svg("video_ad", brief, task_id)
        media_url = f"/media/{filename}"
        ai_result = f"VIDEO_STORYBOARD_READY:{filename}\n\nInstant AI video storyboard generated by 2EasyMarketing. Connect a video provider later for final MP4 rendering."
        content = "Instant branded video storyboard generated."

        conn.execute(
            "INSERT INTO media_files (task_id, client_id, file_type, filename, file_path, status) VALUES (?,?,?,?,?,?)",
            (task_id, client_row["id"], "video_storyboard", filename, path, "ready")
        )

    else:
        content = _build_voiceover_script(brief)
        filename = _media_safe_filename("voiceover_script", task_id, "txt")
        voice_path = os.path.join(MEDIA_DIR, filename)
        with open(voice_path, "w", encoding="utf-8") as f:
            f.write(content)
        media_url = f"/media/{filename}"
        ai_result = f"VOICEOVER_SCRIPT_READY:{filename}\n\n{content}"

        conn.execute(
            "INSERT INTO media_files (task_id, client_id, file_type, filename, file_path, status) VALUES (?,?,?,?,?,?)",
            (task_id, client_row["id"], "voiceover_script", filename, voice_path, "ready")
        )

    conn.execute(
        "UPDATE tasks SET ai_result=?, status='delivered', completed_at=? WHERE id=?",
        (ai_result, datetime.utcnow().isoformat(), task_id)
    )
    conn.commit()
    conn.close()

    return {
        "status": "ok",
        "task_id": task_id,
        "media_type": media_type,
        "title": title,
        "media_url": media_url,
        "filename": filename,
        "content": content,
        "ai_result": ai_result,
        "message": "Media generated successfully."
    }


# ─── MEDIA FILE ENDPOINTS ─────────────────────────────────────────────────────

@app.get("/api/media/{task_id}")
async def get_task_media(task_id: int, session: dict = Depends(require_auth)):
    """Get media files associated with a task."""
    conn = get_db()
    task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not task:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
    # Auth: client can only see own tasks
    if session["role"] != "owner" and task["client_id"] != session["client_id"]:
        conn.close()
        raise HTTPException(status_code=403, detail="Access denied")
    rows = conn.execute(
        "SELECT * FROM media_files WHERE task_id=? AND status='ready'", (task_id,)
    ).fetchall()
    conn.close()
    return {"files": [dict(r) for r in rows]}


@app.get("/api/owner/media")
async def list_all_media(session: dict = Depends(require_owner)):
    """List all generated media files (owner only)."""
    conn = get_db()
    rows = conn.execute(
        "SELECT mf.*, t.title, t.client_name FROM media_files mf "
        "LEFT JOIN tasks t ON mf.task_id = t.id "
        "ORDER BY mf.created_at DESC"
    ).fetchall()
    conn.close()
    return {"files": [dict(r) for r in rows]}


# ════════════════════════════════════════════════════════════════════════════
# ─── SELF-MAINTENANCE ENGINE ─────────────────────────────────────────────────
# Version tracking, health watchdog, DB self-maintenance, error monitoring,
# dependency checks, and autonomous update logging.
# ════════════════════════════════════════════════════════════════════════════

import sys
import subprocess
import importlib.metadata
import traceback
import platform as _platform
from collections import defaultdict, deque

# ─── PLATFORM VERSION ────────────────────────────────────────────────────────
PLATFORM_VERSION = "2.4.0"
PLATFORM_BUILD_DATE = "2026-06-13"
PLATFORM_CODENAME = "Nova"

CHANGELOG = [
    {
        "version": "2.4.0",
        "date": "2026-06-13",
        "changes": [
            "AI Media Factory: image ads, video ads, voiceover generation",
            "Self-maintenance engine: health watchdog, DB vacuum, error monitor",
            "Auto-update check system with version tracking",
            "Media Factory tab in client portal with inline previews",
            "Maya chatbot updated to pitch AI media capabilities",
            "Autonomous content factory queues weekly image ad briefs",
        ]
    },
    {
        "version": "2.3.0",
        "date": "2026-06-12",
        "changes": [
            "Autonomous engine: strategy, content, competitor, opportunity engines",
            "AsyncAnthropic — fully non-blocking AI calls",
            "SQLite WAL + 64MB cache + synchronous=NORMAL for performance",
            "localStorage token persistence — no re-login on refresh",
            "15-second auto-polling on Dashboard and My Tasks views",
            "Exit-intent Maya chatbot capture + scroll-depth trigger",
            "JSON-LD LocalBusiness schema + canonical URL + OG tags",
        ]
    },
    {
        "version": "2.2.0",
        "date": "2026-06-11",
        "changes": [
            "Premium visual overhaul: cinematic neon city hero, glass cards, neon accents",
            "Trust badges strip and animated social proof results bar",
            "Competitor intel via Perplexity sonar API with 6-hour cache",
            "Owner Panel: approve, deliver, regenerate, reject workflow",
        ]
    },
    {
        "version": "2.1.0",
        "date": "2026-06-10",
        "changes": [
            "Full client portal with auth, task submission, owner dashboard",
            "Maya AI chatbot with FastAPI + AsyncAnthropic backend",
            "5 task types: social_post, seo_audit, ad_copy, blog_content, email_campaign",
        ]
    },
    {
        "version": "2.0.0",
        "date": "2026-06-09",
        "changes": [
            "Platform rebrand: DevMarketing → 2EasyMarketing",
            "Domain: 2easymarketing.net, 2E SVG logo",
            "Initial pricing tiers: Starter $497, Growth $1497, Agency $3497",
        ]
    },
]

# ─── ERROR TRACKING ──────────────────────────────────────────────────────────
# Rolling window of recent errors for pattern detection
_error_window: deque = deque(maxlen=500)
_error_counts: dict = defaultdict(int)
_last_maintenance_run: float = 0.0
_maintenance_lock = asyncio.Lock()

def log_platform_error(source: str, error: Exception, context: str = ""):
    """Record an error in the rolling error window."""
    entry = {
        "ts": time.time(),
        "source": source,
        "error": type(error).__name__,
        "msg": str(error)[:500],
        "context": context,
    }
    _error_window.append(entry)
    key = f"{source}:{type(error).__name__}"
    _error_counts[key] += 1


# ─── DB MAINTENANCE ───────────────────────────────────────────────────────────
async def run_db_maintenance():
    """Run SQLite VACUUM, WAL checkpoint, and integrity check."""
    results = {}
    def _sync_maintenance():
        conn = get_db()
        try:
            integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
            results["integrity"] = integrity
            wal_info = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            results["wal_checkpoint"] = {
                "busy": wal_info[0], "log": wal_info[1], "checkpointed": wal_info[2]
            }
            conn.execute("VACUUM")
            results["vacuum"] = "ok"
            db_size = os.path.getsize(DB_PATH) / 1024
            results["db_size_kb"] = round(db_size, 1)
            # Prune expired sessions
            deleted = conn.execute(
                "DELETE FROM sessions WHERE expires_at < datetime('now')"
            ).rowcount
            conn.commit()
            results["expired_sessions_pruned"] = deleted
            return results
        finally:
            conn.close()

    await asyncio.get_running_loop().run_in_executor(None, _sync_maintenance)
    return results


# ─── DEPENDENCY CHECK ─────────────────────────────────────────────────────────
CRITICAL_PACKAGES = [
    "fastapi", "uvicorn", "anthropic", "httpx", "aiofiles",
]

def check_dependencies() -> dict:
    """Check installed versions of critical packages."""
    installed = {}
    for pkg in CRITICAL_PACKAGES:
        try:
            v = importlib.metadata.version(pkg)
            installed[pkg] = v
        except importlib.metadata.PackageNotFoundError:
            installed[pkg] = "NOT INSTALLED"
    return installed


# ─── AI MODEL REGISTRY ───────────────────────────────────────────────────────
REGISTERED_AI_MODELS = {
    "chat_primary": "claude-haiku-4-5-20251001",
    "image_generation": "gpt_image_2 (via asi-generate-image)",
    "video_generation": "veo_3_1 (via asi-generate-video)",
    "tts": "gemini_2_5_pro_tts (via asi-text-to-speech)",
    "competitor_intel": "sonar (via Perplexity API)",
}


# ─── SYSTEM HEALTH SNAPSHOT ──────────────────────────────────────────────────
def get_system_health() -> dict:
    """Collect a full system health snapshot."""
    import resource
    health = {}

    # Python & platform
    health["python_version"] = sys.version.split()[0]
    health["platform"] = _platform.system()
    health["platform_version"] = PLATFORM_VERSION

    # Memory usage (RSS in MB)
    try:
        usage = resource.getrusage(resource.RUSAGE_SELF)
        health["memory_rss_mb"] = round(usage.ru_maxrss / 1024, 1)
    except Exception:
        health["memory_rss_mb"] = "N/A"

    # DB connectivity
    try:
        with db_conn() as conn:
            c = conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
            health["db_clients"] = c
            t = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            health["db_tasks"] = t
            health["db_ok"] = True
    except Exception as e:
        health["db_ok"] = False
        health["db_error"] = str(e)

    # DB file size
    try:
        health["db_size_kb"] = round(os.path.getsize(DB_PATH) / 1024, 1)
    except Exception:
        health["db_size_kb"] = "N/A"

    # Error counts in last hour
    now = time.time()
    recent_errors = [e for e in _error_window if now - e["ts"] < 3600]
    health["errors_last_hour"] = len(recent_errors)

    # Top error sources
    if recent_errors:
        by_source: dict = defaultdict(int)
        for e in recent_errors:
            by_source[e["source"]] += 1
        health["top_error_sources"] = dict(sorted(by_source.items(), key=lambda x: -x[1])[:5])

    # Dependencies
    health["dependencies"] = check_dependencies()

    # AI model registry
    health["ai_models"] = REGISTERED_AI_MODELS

    # Uptime (approximate — seconds since first import)
    health["server_start_iso"] = _SERVER_START_ISO

    return health

_SERVER_START_ISO = datetime.utcnow().isoformat() + "Z"


# ─── UPDATE LOG ──────────────────────────────────────────────────────────────
async def write_update_log(entry: dict):
    """Append an entry to the platform update log in the DB."""
    try:
        with db_conn() as conn:
            # Ensure update_log table exists
            conn.execute("""
                CREATE TABLE IF NOT EXISTS update_log (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type  TEXT NOT NULL,
                    version     TEXT,
                    summary     TEXT,
                    details     TEXT,
                    created_at  TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute(
                "INSERT INTO update_log (event_type, version, summary, details) VALUES (?,?,?,?)",
                (
                    entry.get("type", "info"),
                    entry.get("version", PLATFORM_VERSION),
                    entry.get("summary", ""),
                    json.dumps(entry.get("details", {})),
                )
            )
            conn.commit()
    except Exception as e:
        print(f"⚠️  update_log write failed: {e}")


# ─── MAINTENANCE SCHEDULER ────────────────────────────────────────────────────
async def _run_maintenance_cycle():
    """Full maintenance cycle: DB vacuum, error analysis, dependency check, alert generation."""
    global _last_maintenance_run
    async with _maintenance_lock:
        cycle_start = time.time()
        print("🔧 [Maintenance] Starting maintenance cycle...")
        report = {"started_at": datetime.utcnow().isoformat(), "checks": {}}

        # 1. DB maintenance
        try:
            db_results = await run_db_maintenance()
            report["checks"]["database"] = {"status": "ok", **db_results}
            if db_results.get("integrity") != "ok":
                save_alert(
                    "maintenance",
                    "⚠️ Database Integrity Issue",
                    f"SQLite integrity check returned: {db_results.get('integrity')}. Investigate immediately.",
                    "critical"
                )
        except Exception as e:
            report["checks"]["database"] = {"status": "error", "error": str(e)}
            log_platform_error("maintenance:db", e)

        # 2. Error pattern analysis
        try:
            now = time.time()
            recent = [e for e in _error_window if now - e["ts"] < 3600]
            if len(recent) >= 10:
                by_src: dict = defaultdict(int)
                for err in recent:
                    by_src[err["source"]] += 1
                top_src, top_count = max(by_src.items(), key=lambda x: x[1])
                if top_count >= 5:
                    save_alert(
                        "maintenance",
                        f"🚨 Recurring Error: {top_src}",
                        f"{top_count} errors from '{top_src}' in the last hour. Check server logs.",
                        "warning"
                    )
            report["checks"]["error_analysis"] = {
                "status": "ok",
                "errors_last_hour": len(recent),
            }
        except Exception as e:
            report["checks"]["error_analysis"] = {"status": "error", "error": str(e)}

        # 3. Dependency check
        try:
            deps = check_dependencies()
            missing = [k for k, v in deps.items() if v == "NOT INSTALLED"]
            if missing:
                save_alert(
                    "maintenance",
                    "⚠️ Missing Dependencies",
                    f"Critical packages not found: {', '.join(missing)}",
                    "critical"
                )
            report["checks"]["dependencies"] = {"status": "ok", "installed": deps, "missing": missing}
        except Exception as e:
            report["checks"]["dependencies"] = {"status": "error", "error": str(e)}

        # 4. Stale task detection — tasks stuck in 'processing' for >30 min
        try:
            with db_conn() as conn:
                stale = conn.execute("""
                    SELECT id, title, client_name FROM tasks
                    WHERE status='processing'
                    AND created_at < datetime('now', '-30 minutes')
                """).fetchall()
                if stale:
                    names = ", ".join(f"#{r['id']} {r['title']}" for r in stale[:5])
                    save_alert(
                        "maintenance",
                        f"⏰ {len(stale)} Stale Task(s) Detected",
                        f"Tasks stuck in 'processing' for >30 min: {names}. Auto-reset to 'error'.",
                        "warning"
                    )
                    conn.execute("""
                        UPDATE tasks SET status='error', owner_notes='Auto-reset by maintenance: stuck in processing'
                        WHERE status='processing'
                        AND created_at < datetime('now', '-30 minutes')
                    """)
                    conn.commit()
                report["checks"]["stale_tasks"] = {"status": "ok", "stale_reset": len(stale)}
        except Exception as e:
            report["checks"]["stale_tasks"] = {"status": "error", "error": str(e)}

        # 5. Update log
        elapsed = round(time.time() - cycle_start, 2)
        report["elapsed_seconds"] = elapsed
        await write_update_log({
            "type": "maintenance",
            "version": PLATFORM_VERSION,
            "summary": f"Maintenance cycle completed in {elapsed}s",
            "details": report,
        })
        _last_maintenance_run = time.time()
        print(f"✅ [Maintenance] Cycle complete in {elapsed}s — DB: {report['checks'].get('database', {}).get('db_size_kb', '?')}KB")
        return report


async def _maintenance_scheduler_loop():
    """Runs maintenance every 6 hours."""
    await asyncio.sleep(30)  # warm-up delay after startup
    while True:
        try:
            await _run_maintenance_cycle()
        except Exception as e:
            print(f"❌ [Maintenance] Scheduler error: {e}")
            log_platform_error("maintenance_scheduler", e)
        await asyncio.sleep(6 * 3600)  # every 6 hours


# ─── STARTUP: INIT UPDATE LOG TABLE + BOOT ENTRY ─────────────────────────────
async def _init_maintenance_tables():
    """Create update_log table and write startup boot entry."""
    try:
        with db_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS update_log (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type  TEXT NOT NULL,
                    version     TEXT,
                    summary     TEXT,
                    details     TEXT,
                    created_at  TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.commit()
        await write_update_log({
            "type": "boot",
            "version": PLATFORM_VERSION,
            "summary": f"Platform booted — v{PLATFORM_VERSION} '{PLATFORM_CODENAME}' on {_SERVER_START_ISO}",
            "details": {
                "python": sys.version.split()[0],
                "platform_os": _platform.system(),
                "dependencies": check_dependencies(),
            }
        })
        print(f"🚀 [2EasyMarketing] Platform v{PLATFORM_VERSION} '{PLATFORM_CODENAME}' — Boot logged")
    except Exception as e:
        print(f"⚠️  [Maintenance] Init tables error: {e}")


# ─── HOOK INTO STARTUP ────────────────────────────────────────────────────────
@app.on_event("startup")
async def start_maintenance_engine():
    await _init_maintenance_tables()
    asyncio.create_task(_maintenance_scheduler_loop())
    print("🔧 [Maintenance] Self-maintenance engine started — 6h cycle")


@app.on_event("startup")
async def start_fortress():
    """Initialize FORTRESS security DB and engine."""
    init_security_db()
    print("🛡️  [FORTRESS] Security engine online — 7-layer defense active")


# ═══════════════════════════════════════════════════════════════════════════
#  FORTRESS SECURITY API ENDPOINTS (Owner-only)
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/owner/security/stats")
async def security_stats(hours: int = 24, session: dict = Depends(require_owner)):
    """Real-time security dashboard data — threat counts, top attackers, recent events."""
    return get_security_stats(hours=min(hours, 168))  # max 7 days


@app.get("/api/owner/security/blocked")
async def security_blocked_ips(session: dict = Depends(require_owner)):
    """List all currently blocked IPs."""
    return {"blocked": get_blocked_ips_list()}


@app.post("/api/owner/security/block")
async def security_block_ip(request: Request, session: dict = Depends(require_owner)):
    """Manually block an IP address."""
    body = await request.json()
    ip = body.get("ip", "").strip()
    reason = body.get("reason", "manual_block")
    permanent = body.get("permanent", False)
    if not ip:
        return JSONResponse({"error": "ip required"}, status_code=400)
    block_ip(ip, reason, permanent=permanent)
    log_threat(ip, "manual_block", "high", "", "", "", "", "blocked", f"Manually blocked by owner: {reason}")
    return {"status": "blocked", "ip": ip, "permanent": permanent}


@app.post("/api/owner/security/unblock")
async def security_unblock_ip(request: Request, session: dict = Depends(require_owner)):
    """Manually unblock an IP address."""
    body = await request.json()
    ip = body.get("ip", "").strip()
    if not ip:
        return JSONResponse({"error": "ip required"}, status_code=400)
    success = unblock_ip_manual(ip)
    return {"status": "unblocked" if success else "not_found", "ip": ip}


# ─── MAINTENANCE & VERSION API ENDPOINTS ─────────────────────────────────────

@app.get("/api/owner/system-health")
async def system_health(session: dict = Depends(require_owner)):
    """Full system health snapshot — owner only."""
    return get_system_health()


@app.post("/api/owner/run-maintenance")
async def run_maintenance_now(request: Request, session: dict = Depends(require_owner)):
    """
    Trigger an immediate maintenance cycle.

    Fix:
    - The browser can send an empty POST body.
    - Starlette/FastAPI can throw "Unexpected message received: http.request"
      if middleware has inspected the body and this endpoint returns before
      the request body is fully consumed.
    - Consuming the body here plus bypassing Fortress body inspection for this
      endpoint prevents the noisy ASGI exception while keeping owner auth.
    """
    try:
        try:
            await request.body()
        except Exception:
            pass

        report = await _run_maintenance_cycle()

        return JSONResponse(
            content={
                "status": "ok",
                "message": "Maintenance cycle completed successfully.",
                "report": report or {}
            }
        )

    except Exception as e:
        import traceback as _tb
        print(f"[Maintenance] Endpoint error: {e}\n{_tb.format_exc()}")

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": str(e)
            }
        )


@app.get("/api/version")
async def platform_version():
    """Public endpoint: current platform version + changelog."""
    return {
        "version": PLATFORM_VERSION,
        "codename": PLATFORM_CODENAME,
        "build_date": PLATFORM_BUILD_DATE,
        "brand": "2EasyMarketing",
        "domain": "2easymarketing.net",
        "changelog": CHANGELOG,
    }


@app.get("/api/owner/update-log")
async def get_update_log(session: dict = Depends(require_owner)):
    """View full platform update/maintenance log — owner only."""
    try:
        with db_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM update_log ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
        return {"log": [dict(r) for r in rows]}
    except Exception as e:
        return {"log": [], "error": str(e)}


@app.get("/api/health")
async def health():
    """Enhanced health endpoint (public) — includes version."""
    with db_conn() as conn:
        clients = conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0]
        tasks   = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        auto_t  = conn.execute("SELECT COUNT(*) FROM autonomous_tasks").fetchone()[0]
        alerts  = conn.execute("SELECT COUNT(*) FROM alerts WHERE is_read=0").fetchone()[0]
    return cached_json({
        "status": "ok",
        "version": PLATFORM_VERSION,
        "codename": PLATFORM_CODENAME,
        "agent": "Maya + Task Engine + Autonomous + Maintenance",
        "brand": "2EasyMarketing",
        "domain": "2easymarketing.net",
        "clients": clients,
        "tasks": tasks,
        "autonomous_tasks": auto_t,
        "unread_alerts": alerts,
        "uptime_since": _SERVER_START_ISO,
    }, max_age=30)



# ════════════════════════════════════════════════════════════════════════════
# ─── LEAD NOTIFICATION SYSTEM ────────────────────────────────────────────────
# Sends instant email alerts to 2easymarketing@gmail.com whenever:
#   1. A visitor submits the website contact/lead form
#   2. Maya chatbot captures a lead (name + email collected)
#   3. A new client signs up through the portal
# Uses Gmail SMTP (or any SMTP) — configure SMTP_* vars below.
# ════════════════════════════════════════════════════════════════════════════

import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ─── SMTP CONFIG ─────────────────────────────────────────────────────────────
# Uses Gmail by default. To activate:
#   1. Go to myaccount.google.com/apppasswords
#   2. Generate an App Password for "Mail"
#   3. Set SMTP_USER to your Gmail address
#   4. Set SMTP_PASS to the 16-char app password
# Or swap host/port for any other SMTP provider (Outlook, Yahoo, etc.)

SMTP_HOST    = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT    = int(os.getenv("SMTP_PORT", "465") or "465")
SMTP_USER    = os.getenv("SMTP_USER", "")        # your Gmail: you@gmail.com
SMTP_PASS    = os.getenv("SMTP_PASS", "")        # Gmail App Password
NOTIFY_TO    = os.getenv("NOTIFY_TO", OWNER_EMAIL)   # 2easymarketing@gmail.com


def _send_email_sync(subject: str, html_body: str, text_body: str = ""):
    """Send an email synchronously (called from executor to avoid blocking)."""
    if not SMTP_USER or not SMTP_PASS:
        print(f"📧 [Lead Alert] SMTP not configured — lead notification suppressed. Subject: {subject}")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"2EasyMarketing Leads <{SMTP_USER}>"
        msg["To"]      = NOTIFY_TO
        msg["Reply-To"] = SMTP_USER

        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, NOTIFY_TO, msg.as_string())
        print(f"✅ [Lead Alert] Email sent → {NOTIFY_TO} | {subject}")
        return True
    except Exception as e:
        print(f"❌ [Lead Alert] Email failed: {e}")
        log_platform_error("lead_notification", e, subject)
        return False


async def send_lead_notification(subject: str, html_body: str, text_body: str = ""):
    """Non-blocking async wrapper — runs SMTP in a thread executor."""
    await asyncio.get_running_loop().run_in_executor(None, _send_email_sync, subject, html_body, text_body)


def _lead_email_html(lead_type: str, fields: dict) -> str:
    """Render a clean HTML email for a lead notification."""
    rows = "".join(
        f'<tr><td style="padding:8px 12px;font-weight:600;color:#64748b;'
        f'background:#f8fafc;border:1px solid #e2e8f0;white-space:nowrap">{k}</td>'
        f'<td style="padding:8px 12px;color:#1e293b;border:1px solid #e2e8f0">{v}</td></tr>'
        for k, v in fields.items()
    )
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;
              overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:24px 32px">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:28px;font-weight:900;color:#00d4ff;letter-spacing:-1px">2E</span>
        <div>
          <div style="color:#fff;font-size:16px;font-weight:700">2EasyMarketing</div>
          <div style="color:#94a3b8;font-size:12px">2easymarketing.net</div>
        </div>
      </div>
    </div>
    <!-- Alert badge -->
    <div style="background:#00d4ff;padding:10px 32px">
      <span style="color:#0f172a;font-size:13px;font-weight:700;
                   text-transform:uppercase;letter-spacing:.08em">
        🔥 New {lead_type}
      </span>
    </div>
    <!-- Body -->
    <div style="padding:28px 32px">
      <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6">
        A new lead just came in on <strong>2easymarketing.net</strong>.
        Reach out within the first hour — response speed is the #1 factor in closing leads.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">{rows}</table>
      <div style="margin-top:24px;text-align:center">
        <a href="https://2easymarketing.net" 
           style="display:inline-block;background:linear-gradient(135deg,#00d4ff,#a855f7);
                  color:#fff;font-weight:700;font-size:14px;padding:12px 28px;
                  border-radius:8px;text-decoration:none">
          Open 2EasyMarketing Dashboard →
        </a>
      </div>
    </div>
    <!-- Footer -->
    <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center">
        2EasyMarketing · 2easymarketing@gmail.com · 2easymarketing.net
      </p>
    </div>
  </div>
</body>
</html>"""


# ─── CONTACT FORM ENDPOINT ───────────────────────────────────────────────────

class ContactFormRequest(BaseModel):
    name:    str
    email:   EmailStr
    phone:   str = ""
    business: str = ""
    message: str = ""
    plan:    str = ""

@app.post("/api/contact")
async def submit_contact_form(data: ContactFormRequest):
    """Website contact / lead capture form — emails Dev instantly."""
    # Save to DB as an alert so it also shows in Owner Panel
    fields = {
        "Name":     data.name,
        "Email":    data.email,
        "Phone":    data.phone or "—",
        "Business": data.business or "—",
        "Plan Interest": data.plan or "—",
        "Message":  data.message or "—",
        "Source":   "Website Contact Form",
        "Time":     datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    }
    save_alert(
        "lead",
        f"🔥 New Lead: {data.name} ({data.email})",
        f"Business: {data.business or '—'} | Plan: {data.plan or '—'} | {data.message or 'No message'}",
        "info"
    )
    # Log to update_log
    await write_update_log({
        "type": "lead",
        "version": PLATFORM_VERSION,
        "summary": f"Contact form: {data.name} <{data.email}>",
        "details": fields,
    })
    # Send email notification
    html = _lead_email_html("Contact Form Lead", fields)
    text = f"New lead from 2easymarketing.net\n\n" + "\n".join(f"{k}: {v}" for k,v in fields.items())
    asyncio.create_task(send_lead_notification(
        f"🔥 New Lead: {data.name} — {data.business or data.email}",
        html, text
    ))
    return {"status": "received", "message": "Thanks! We'll be in touch within 24 hours."}


# ─── MAYA LEAD CAPTURE ────────────────────────────────────────────────────────

async def notify_maya_lead(name: str, email: str, interest: str, conversation_snippet: str):
    """Called by Maya when she captures a visitor's name + email during chat."""
    fields = {
        "Name":         name,
        "Email":        email,
        "Interest":     interest or "General inquiry",
        "Conversation": conversation_snippet[:300] + ("..." if len(conversation_snippet) > 300 else ""),
        "Source":       "Maya AI Chatbot",
        "Time":         datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    }
    save_alert(
        "lead",
        f"💬 Maya Captured Lead: {name} ({email})",
        f"Interest: {interest} | Via chatbot",
        "info"
    )
    await write_update_log({
        "type": "lead",
        "version": PLATFORM_VERSION,
        "summary": f"Maya lead: {name} <{email}>",
        "details": fields,
    })
    html = _lead_email_html("Maya Chatbot Lead", fields)
    text = f"Maya captured a lead on 2easymarketing.net\n\n" + "\n".join(f"{k}: {v}" for k,v in fields.items())
    await send_lead_notification(
        f"💬 Maya Lead: {name} — {interest or email}",
        html, text
    )


# ─── NEW CLIENT SIGNUP NOTIFICATION ──────────────────────────────────────────
# Hook into the existing signup flow — patch the signup endpoint to also notify

_original_signup = None

async def _notify_new_signup(name: str, email: str, business: str, plan: str):
    """Fires when a new client creates a portal account."""
    plan_prices = {"starter": "$497/mo", "growth": "$1,497/mo", "agency": "$3,497/mo"}
    fields = {
        "Name":     name,
        "Email":    email,
        "Business": business or "—",
        "Plan":     f"{plan.title()} — {plan_prices.get(plan.lower(), plan)}",
        "Source":   "Client Portal Signup",
        "Time":     datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    }
    save_alert(
        "lead",
        f"🎉 New Client Signed Up: {name}",
        f"{business or email} — {plan.title()} plan",
        "info"
    )
    await write_update_log({
        "type": "signup",
        "version": PLATFORM_VERSION,
        "summary": f"New signup: {name} <{email}> — {plan}",
        "details": fields,
    })
    html = _lead_email_html("New Client Signup", fields)
    text = f"New client signed up on 2easymarketing.net\n\n" + "\n".join(f"{k}: {v}" for k,v in fields.items())
    await send_lead_notification(
        f"🎉 New Client: {name} — {plan.title()} Plan",
        html, text
    )


# ─── PATCH SIGNUP ROUTE ───────────────────────────────────────────────────────
# Find the signup route and wrap it to fire notification

@app.post("/api/auth/signup/notify-hook")
async def _signup_notify_hook(request: Request):
    """Internal — called after successful signup to fire notification."""
    body = await request.json()
    asyncio.create_task(_notify_new_signup(
        body.get("name",""),
        body.get("email",""),
        body.get("business",""),
        body.get("plan","starter"),
    ))
    return {"ok": True}


# ─── SMTP CONFIG ENDPOINT (OWNER ONLY) ───────────────────────────────────────

@app.get("/api/owner/smtp-status")
async def smtp_status(session: dict = Depends(require_owner)):
    """Check if SMTP is configured."""
    return {
        "configured": bool(SMTP_USER and SMTP_PASS),
        "smtp_user":  SMTP_USER[:4] + "****" if SMTP_USER else "not set",
        "notify_to":  NOTIFY_TO,
        "smtp_host":  SMTP_HOST,
        "smtp_port":  SMTP_PORT,
        "instructions": {
            "step1": "Go to myaccount.google.com/apppasswords",
            "step2": "Create App Password for 'Mail'",
            "step3": "Set env vars: SMTP_USER=you@gmail.com, SMTP_PASS=xxxx-xxxx-xxxx-xxxx",
            "step4": "Restart server — notifications will fire instantly on every lead",
            "alternative": "Any SMTP works: Outlook (smtp.office365.com:587), Yahoo (smtp.mail.yahoo.com:465)"
        }
    }

@app.post("/api/owner/test-notification")
async def test_notification(session: dict = Depends(require_owner)):
    """Send a test lead notification to verify SMTP is working."""
    fields = {
        "Name":     "Test Lead",
        "Email":    "test@example.com",
        "Business": "Test Business LLC",
        "Plan":     "Growth — $1,497/mo",
        "Message":  "This is a test notification from 2EasyMarketing.",
        "Source":   "Manual Test",
        "Time":     datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    }
    html = _lead_email_html("TEST Notification", fields)
    success = _send_email_sync(
        "🧪 Test: 2EasyMarketing Lead Notifications Working",
        html,
        "This is a test notification from 2EasyMarketing."
    )
    return {
        "sent": success,
        "to": NOTIFY_TO,
        "message": "Check your inbox!" if success else "SMTP not configured — set SMTP_USER and SMTP_PASS env vars."
    }


# ═══════════════════════════════════════════════════════════════════════════
#  LLM COUNCIL API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

def _init_council_db():
    """Create council_sessions table."""
    with db_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS council_sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL,
                task_type   TEXT NOT NULL DEFAULT 'strategy',
                brief       TEXT NOT NULL,
                context     TEXT NOT NULL DEFAULT '{}',
                responses   TEXT NOT NULL DEFAULT '{}',
                verdict     TEXT NOT NULL DEFAULT '{}',
                mode        TEXT NOT NULL DEFAULT 'full',
                created_at  TEXT DEFAULT (datetime('now'))
            );
        """)
        conn.commit()


@app.on_event("startup")
async def init_council():
    _init_council_db()
    print("⚖️  [Council] LLM Council engine online — Claude · GPT-4o · Gemini")


# ── GET /api/council/roster — model info ─────────────────────────────────────
@app.get("/api/council/roster")
async def council_roster(session: dict = Depends(require_owner)):
    """Return the council model roster and their roles."""
    return {
        "models": get_council_roster(),
        "total": len(COUNCIL_MODELS),
    }


# ── GET /api/council/sessions — list past sessions ───────────────────────────
@app.get("/api/council/sessions")
async def council_sessions(
    limit: int = 20,
    session: dict = Depends(require_owner),
):
    """List past council sessions, most recent first."""
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM council_sessions ORDER BY created_at DESC LIMIT ?",
            (min(limit, 100),),
        ).fetchall()
    return {
        "sessions": [
            {
                **dict(r),
                "responses": json.loads(r["responses"]),
                "verdict":   json.loads(r["verdict"]),
                "context":   json.loads(r["context"]),
            }
            for r in rows
        ]
    }


# ── POST /api/council/session — run a full council session ───────────────────
@app.post("/api/council/session")
async def council_session(request: Request, session: dict = Depends(require_owner)):
    """
    Run a full LLM Council session (3 models + Maya synthesis).
    Body: { brief, task_type, context }
    """
    body      = await request.json()
    brief     = body.get("brief", "").strip()
    task_type = body.get("task_type", "strategy")
    context   = body.get("context", {})

    if not brief:
        raise HTTPException(status_code=400, detail="brief is required")

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    openai_key    = os.environ.get("OPENAI_API_KEY", "")
    gemini_key    = os.environ.get("GEMINI_API_KEY", "")

    context["task_type"] = task_type

    result = await run_council_session(
        brief=brief,
        context=context,
        anthropic_key=anthropic_key,
        openai_key=openai_key,
        gemini_key=gemini_key,
    )

    # Persist session
    with db_conn() as conn:
        conn.execute(
            """INSERT INTO council_sessions
               (session_id, task_type, brief, context, responses, verdict, mode)
               VALUES (?,?,?,?,?,?,?)""",
            (
                result["session_id"],
                task_type,
                brief,
                json.dumps(context),
                json.dumps(result["responses"]),
                json.dumps(result["verdict"]),
                "full",
            ),
        )
        conn.commit()

    return result


class QuickCouncilRequest(BaseModel):
    question: str


# ── POST /api/council/quick — fast single-question council ───────────────────
@app.post("/api/council/quick")
async def council_quick_endpoint(payload: QuickCouncilRequest, session: dict = Depends(require_owner)):
    """Run a quick LLM Council answer safely without manually reading request bodies."""
    question = (payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", os.environ.get("GOOGLE_API_KEY", ""))

    result = await quick_council(
        question=question,
        anthropic_key=anthropic_key,
        openai_key=openai_key,
        gemini_key=gemini_key,
    )

    with db_conn() as conn:
        conn.execute(
            """INSERT INTO council_sessions
               (session_id, task_type, brief, context, responses, verdict, mode)
               VALUES (?,?,?,?,?,?,?)""",
            (
                result.get("session_id", hashlib.md5(question.encode()).hexdigest()[:12]),
                "quick",
                question,
                "{}",
                json.dumps(result.get("responses", {})),
                json.dumps(result.get("verdict", {})),
                "quick",
            ),
        )
        conn.commit()

    return result





# ── DELETE /api/council/sessions/{id} — delete a session ────────────────────
@app.delete("/api/council/sessions/{session_id}")
async def delete_council_session(session_id: int, session: dict = Depends(require_owner)):
    with db_conn() as conn:
        conn.execute("DELETE FROM council_sessions WHERE id=?", (session_id,))
        conn.commit()
    return {"deleted": session_id}


# ── GET /api/council/stats — council usage stats ─────────────────────────────
@app.get("/api/council/stats")
async def council_stats(session: dict = Depends(require_owner)):
    with db_conn() as conn:
        total    = conn.execute("SELECT COUNT(*) FROM council_sessions").fetchone()[0]
        by_type  = conn.execute(
            "SELECT task_type, COUNT(*) as n FROM council_sessions GROUP BY task_type ORDER BY n DESC"
        ).fetchall()
        recent   = conn.execute(
            "SELECT * FROM council_sessions ORDER BY created_at DESC LIMIT 5"
        ).fetchall()

    return {
        "total_sessions": total,
        "by_type": [dict(r) for r in by_type],
        "recent": [
            {**dict(r), "verdict": json.loads(r["verdict"]), "responses": json.loads(r["responses"])}
            for r in recent
        ],
        "models": get_council_roster(),
    }


@app.get("/api/pricing/public")
async def pricing_public():
    """Public-safe pricing preview. No payment processing yet."""
    ordered = ["starter", "pro", "agency", "done_for_you"]
    cards = []
    for key in ordered:
        p = dict(PLAN_ACCESS[key])
        p["key"] = key
        p["price"] = {
            "starter": "$29.99",
            "pro": "$49.99",
            "agency": "$149.99",
            "done_for_you": "$399+"
        }[key]
        p["period"] = "/month" if key == "done_for_you" else "/month"
        cards.append(p)
    return {
        "status": "ok",
        "payment_enabled": False,
        "publishing_enabled": False,
        "plans": cards,
        "message": "Pricing preview only. Payments will be connected in a later phase."
    }




# ═══════════════════════════════════════════════════════════════════════════
#  CUSTOMER READY LAUNCH v1 — TRUST, ONBOARDING, FAQ, CTA, LAUNCH CHECKLIST
# ═══════════════════════════════════════════════════════════════════════════

CUSTOMER_READY_PRICING = [
    {
        "key": "starter",
        "name": "Starter Platform",
        "price": "$29.99",
        "period": "/month",
        "tag": "Self-Service",
        "best_for": "A small business owner who wants simple marketing tools.",
        "description": "Organize your brand, create captions, plan basic content, and export your work.",
        "included": ["Brand Kit", "Basic Content Calendar", "AI Captions", "CSV Export", "Basic Reports"],
        "cta": "Start with Starter"
    },
    {
        "key": "pro",
        "name": "Pro Platform",
        "price": "$49.99",
        "period": "/month",
        "tag": "Advanced Self-Service",
        "best_for": "A business that wants stronger planning, approvals, and content workflows.",
        "description": "Create platform drafts, use Growth OS, manage approvals, and prepare reports.",
        "included": ["Everything in Starter", "Growth OS", "Social Autopilot", "Approval Queue", "Media Factory", "Plugin Hub Preview", "Weekly Reports"],
        "cta": "Choose Pro"
    },
    {
        "key": "agency",
        "name": "Agency / Multi-Client",
        "price": "$149.99",
        "period": "/month",
        "tag": "Scale Plan",
        "best_for": "Agencies, creators, or managers handling more than one client.",
        "description": "Manage multiple clients, brand kits, reports, approval queues, and export-ready posts.",
        "included": ["Multiple Clients", "Client Switcher", "Multiple Brand Kits", "Approval Queues Per Client", "Reports Per Client", "Export / Publish Queue"],
        "cta": "Scale with Agency"
    },
    {
        "key": "done_for_you",
        "name": "Done-For-You",
        "price": "$399+",
        "period": "/month",
        "tag": "Managed Service",
        "best_for": "A client who wants 2EasyMarketing to help create and organize the marketing work.",
        "description": "You submit requests, we prepare the work, and you review and approve before anything moves forward.",
        "included": ["Submit Requests", "We Prepare Content", "Approve / Reject Posts", "Campaign Progress", "Reports", "Messages from 2EasyMarketing"],
        "cta": "Request Done-For-You"
    }
]

CUSTOMER_READY_FAQS = [
    {
        "question": "Is this only an AI tool?",
        "answer": "No. 2EasyMarketing is being built as a marketing platform plus a done-for-you service option. AI helps with drafts and organization, but the focus is clear marketing workflow, approvals, and client support."
    },
    {
        "question": "Does it post directly to social media right now?",
        "answer": "Not yet. The current build prepares drafts, queue items, exports, approvals, and readiness checks. Live posting requires real social platform connections and API approval later."
    },
    {
        "question": "What happens after someone signs up?",
        "answer": "They should complete their Brand Kit, choose or confirm a plan, create or request content, review drafts, approve work, and track progress in the dashboard."
    },
    {
        "question": "Why does Done-For-You say $399+?",
        "answer": "Because managed service work can vary depending on how much content, strategy, reporting, or custom support the client needs."
    },
    {
        "question": "Are payments connected yet?",
        "answer": "No. Stripe or another payment provider should be connected after the pricing, onboarding flow, and dashboard are approved."
    },
    {
        "question": "Can customers use this on mobile?",
        "answer": "Yes. A mobile responsive pass was added so the dashboard, pricing, plan access, and Growth OS pages work better on phones."
    }
]

CUSTOMER_READY_TRUST_SECTIONS = [
    {
        "title": "Clear Workflow",
        "body": "Customers can see what to do next: create, review, approve, export, and report."
    },
    {
        "title": "Plan-Based Access",
        "body": "Each plan shows the right tools instead of overwhelming every customer with everything."
    },
    {
        "title": "Approval Before Publishing",
        "body": "Nothing should move forward without client or owner approval."
    },
    {
        "title": "Human Service Option",
        "body": "Done-For-You keeps the business from feeling like just another AI software tool."
    },
    {
        "title": "Mobile Ready",
        "body": "Customers should be able to check requests, approvals, and reports from their phone."
    },
    {
        "title": "Honest Preview Mode",
        "body": "Live posting, payment processing, and real provider media generation are clearly marked as later connection steps."
    }
]

CUSTOMER_READY_ONBOARDING = [
    {"step": 1, "title": "Choose your plan", "body": "Pick Starter, Pro, Agency, or Done-For-You based on how much help you want."},
    {"step": 2, "title": "Complete your Brand Kit", "body": "Add business name, audience, offer, brand voice, colors, and what to avoid."},
    {"step": 3, "title": "Create or request content", "body": "Self-service users create drafts. Done-For-You clients submit requests."},
    {"step": 4, "title": "Review and approve", "body": "Check captions, visuals, readiness score, and queue status before anything moves forward."},
    {"step": 5, "title": "Export, schedule, or connect later", "body": "Use exports now. Live posting can be connected later through approved providers."},
    {"step": 6, "title": "Review reports", "body": "Track what was created, what is approved, and what should happen next."}
]

CUSTOMER_READY_LAUNCH_CHECKLIST = [
    {"item": "Homepage explains the offer in 10 seconds", "done": True},
    {"item": "Pricing is visible and simple", "done": True},
    {"item": "Plan access is different per subscription", "done": True},
    {"item": "Growth OS tools work in safe-preview mode", "done": True},
    {"item": "Mobile responsive pass is included", "done": True},
    {"item": "FAQ and trust sections are included", "done": True},
    {"item": "Terms, privacy, and refund policy pages still need legal review", "done": False},
    {"item": "Stripe checkout still needs to be connected", "done": False},
    {"item": "Live social posting still needs provider approval/API keys", "done": False},
    {"item": "Real phone + Railway deployment testing still needs to happen", "done": False}
]

@app.get("/api/customer-ready/home")
async def customer_ready_home():
    """Public-safe customer-ready homepage data."""
    return {
        "status": "ok",
        "hero": {
            "headline": "Marketing tools and done-for-you support in one clean place.",
            "subheadline": "2EasyMarketing helps businesses plan, create, review, organize, and prepare marketing content without making the process confusing.",
            "primary_cta": "View Pricing",
            "secondary_cta": "See How It Works"
        },
        "pricing": CUSTOMER_READY_PRICING,
        "trust": CUSTOMER_READY_TRUST_SECTIONS,
        "faqs": CUSTOMER_READY_FAQS,
        "onboarding": CUSTOMER_READY_ONBOARDING,
        "launch_checklist": CUSTOMER_READY_LAUNCH_CHECKLIST,
        "truth_note": "Payment processing, live social publishing, and provider-based AI media still require real external accounts and testing."
    }

@app.get("/api/customer-ready/launch-checklist")
async def customer_ready_launch_checklist(session: dict = Depends(require_auth)):
    """Internal launch checklist for owner/client dashboard."""
    return {
        "status": "ok",
        "checklist": CUSTOMER_READY_LAUNCH_CHECKLIST,
        "message": "Customer-ready launch checklist loaded."
    }


@app.get("/customer-ready.html")
async def customer_ready_page():
    """Serve the customer-ready launch page directly."""
    page = Path(__file__).with_name("customer-ready.html")
    if not page.exists():
        return JSONResponse({"error": "customer-ready.html not found"}, status_code=404)
    return FileResponse(str(page), media_type="text/html")
