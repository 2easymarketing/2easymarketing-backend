"""
2EasyMarketing — LLM Council Engine
Multi-model AI deliberation: Claude · OpenAI · Gemini
Each model plays a specialized role. Maya synthesizes the final verdict.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx


# ─── CONFIG ───────────────────────────────────────────────────────────────────

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
OPENAI_API_STYLE = os.getenv("OPENAI_API_STYLE", "chat").strip().lower()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-pro")

HTTP_TIMEOUT_SECONDS = float(os.getenv("COUNCIL_HTTP_TIMEOUT_SECONDS", "45"))
COUNCIL_MAX_TOKENS = int(os.getenv("COUNCIL_MAX_TOKENS", "1500"))
SYNTHESIS_MAX_TOKENS = int(os.getenv("COUNCIL_SYNTHESIS_MAX_TOKENS", "2000"))


def clean_key(value: Optional[str]) -> str:
    return (value or "").strip()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def normalize_error(provider: str, error: Exception) -> str:
    return f"[{provider} unavailable: {type(error).__name__}: {error}]"


# ─── COUNCIL MODEL ROSTER ────────────────────────────────────────────────────

COUNCIL_MODELS = {
    "claude": {
        "name": "Claude Sonnet",
        "role": "Creative Strategist",
        "specialty": "Brand voice, storytelling, creative direction, long-form copy",
        "emoji": "🟣",
        "provider": "anthropic",
        "model": ANTHROPIC_MODEL,
    },
    "openai": {
        "name": "OpenAI",
        "role": "Data Analyst",
        "specialty": "Competitive research, performance metrics, structured strategy, ROI analysis",
        "emoji": "🟢",
        "provider": "openai",
        "model": OPENAI_MODEL,
    },
    "gemini": {
        "name": "Gemini",
        "role": "Growth Hacker",
        "specialty": "Viral tactics, platform algorithms, rapid testing, trend exploitation",
        "emoji": "🔵",
        "provider": "google",
        "model": GEMINI_MODEL,
    },
}

COUNCIL_ROLES = {
    "claude": (
        "You are the Creative Strategist on the 2EasyMarketing AI Council. "
        "Your specialty is brand voice, storytelling, emotional resonance, and creative direction. "
        "You think in narratives and human psychology."
    ),
    "openai": (
        "You are the Data Analyst on the 2EasyMarketing AI Council. "
        "Your specialty is competitive intelligence, performance benchmarking, structured frameworks, "
        "and ROI-driven decisions. You think in numbers and systems."
    ),
    "gemini": (
        "You are the Growth Hacker on the 2EasyMarketing AI Council. "
        "Your specialty is viral mechanics, platform algorithm exploitation, rapid A/B testing, "
        "and unconventional growth tactics. You think in experiments and velocity."
    ),
}

SYNTHESIZER_PROMPT = """You are Maya — the Chief AI Strategist of 2EasyMarketing and chair of the LLM Council.

Three specialized AI models analyzed the brief and gave recommendations.

Your job:
1. Identify the strongest ideas from each model.
2. Resolve conflicts or contradictions.
3. Synthesize one unified COUNCIL VERDICT that is better than any individual recommendation.
4. Rate each model's contribution from 1-10 with a one-line reason.

Return ONLY a valid JSON object with this exact structure:

{
  "verdict": "Full unified recommendation, 2-5 paragraphs, ready to execute",
  "key_actions": ["Action 1", "Action 2", "Action 3", "Action 4", "Action 5"],
  "scores": {
    "claude": {"score": 8, "reason": "Strong brand voice but lacked data"},
    "openai": {"score": 9, "reason": "Solid framework and metrics"},
    "gemini": {"score": 7, "reason": "Creative tactics, execution gaps"}
  },
  "winning_insight": "The single most valuable idea from the entire council session",
  "confidence": 87
}
"""


# ─── JSON PARSING ─────────────────────────────────────────────────────────────

def extract_json(raw: str) -> dict:
    raw = (raw or "").strip()

    if not raw:
        raise json.JSONDecodeError("Empty response", raw, 0)

    if "```" in raw:
        for part in raw.split("```"):
            cleaned = part.strip()
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].strip()
            if cleaned.startswith("{") and cleaned.endswith("}"):
                return json.loads(cleaned)

    start = raw.find("{")
    end = raw.rfind("}")

    if start != -1 and end != -1 and end > start:
        return json.loads(raw[start:end + 1])

    return json.loads(raw)


def fallback_verdict(
    responses: dict,
    brief: str,
    error: str = "",
    confidence: int = 45,
) -> dict:
    return {
        "verdict": (
            "The Council session completed, but Maya could not produce a clean synthesized JSON verdict. "
            "Review the raw model responses in the responses field. The most likely causes are a missing API key, "
            "invalid model name, provider outage, or malformed JSON from the synthesizer."
        ),
        "key_actions": [
            "Verify ANTHROPIC_API_KEY, OPENAI_API_KEY, and GEMINI_API_KEY are set correctly",
            "Redeploy the backend after changing environment variables",
            "Run /api/council/quick again with a short test question",
            "Check backend logs for provider-specific API errors",
            "Keep model names configurable through environment variables",
        ],
        "scores": {
            "claude": {"score": 0, "reason": "No reliable synthesis score available"},
            "openai": {"score": 0, "reason": "No reliable synthesis score available"},
            "gemini": {"score": 0, "reason": "No reliable synthesis score available"},
        },
        "winning_insight": "The engine must fail gracefully and never crash the route when one provider is unavailable.",
        "confidence": confidence,
        "error": error,
        "brief": brief,
    }


# ─── MODEL CALLERS ────────────────────────────────────────────────────────────

async def _call_claude(role_prompt: str, task_prompt: str, api_key: str) -> str:
    api_key = clean_key(api_key)

    if not api_key:
        return "[Claude unavailable: no API key configured]"

    try:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=api_key)

        resp = await client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=COUNCIL_MAX_TOKENS,
            system=role_prompt,
            messages=[{"role": "user", "content": task_prompt}],
        )

        content = getattr(resp, "content", None) or []

        if not content:
            return "[Claude unavailable: empty response]"

        first = content[0]

        return getattr(first, "text", str(first))

    except Exception as e:
        return normalize_error("Claude", e)


async def _call_openai(role_prompt: str, task_prompt: str, api_key: str) -> str:
    api_key = clean_key(api_key)

    if not api_key:
        return "[OpenAI unavailable: no API key configured]"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as http:
            resp = await http.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json={
                    "model": OPENAI_MODEL,
                    "max_tokens": COUNCIL_MAX_TOKENS,
                    "messages": [
                        {"role": "system", "content": role_prompt},
                        {"role": "user", "content": task_prompt},
                    ],
                },
            )

        if resp.status_code < 200 or resp.status_code >= 300:
            return f"[OpenAI error {resp.status_code}: {resp.text[:500]}]"

        data = resp.json()

        try:
            return data["choices"][0]["message"]["content"]
        except Exception:
            return "[OpenAI unavailable: unexpected response format]"

    except Exception as e:
        return normalize_error("OpenAI", e)


async def _call_gemini(role_prompt: str, task_prompt: str, api_key: str) -> str:
    api_key = clean_key(api_key)

    if not api_key:
        return "[Gemini unavailable: no API key configured]"

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as http:
            resp = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "system_instruction": {
                        "parts": [{"text": role_prompt}]
                    },
                    "contents": [
                        {
                            "parts": [{"text": task_prompt}]
                        }
                    ],
                    "generationConfig": {
                        "maxOutputTokens": COUNCIL_MAX_TOKENS
                    },
                },
            )

        if resp.status_code < 200 or resp.status_code >= 300:
            return f"[Gemini error {resp.status_code}: {resp.text[:500]}]"

        data = resp.json()

        candidates = data.get("candidates") or []

        if not candidates:
            return "[Gemini unavailable: empty candidates]"

        parts = candidates[0].get("content", {}).get("parts", []) or []

        text = "\n".join(
            part.get("text", "")
            for part in parts
            if part.get("text")
        ).strip()

        return text or "[Gemini unavailable: empty response]"

    except Exception as e:
        return normalize_error("Gemini", e)


# ─── SYNTHESIS ────────────────────────────────────────────────────────────────

def _build_council_input(responses: dict, brief: str) -> str:
    return f"""ORIGINAL BRIEF:
{brief}

---

🟣 CLAUDE / Creative Strategist:
{responses.get("claude", "[no response]")}

---

🟢 OPENAI / Data Analyst:
{responses.get("openai", "[no response]")}

---

🔵 GEMINI / Growth Hacker:
{responses.get("gemini", "[no response]")}

---

Synthesize the above into a COUNCIL VERDICT.
Return only a valid JSON object.
"""


async def _synthesize_with_best_available_model(
    responses: dict,
    brief: str,
    anthropic_key: str,
    openai_key: str = "",
    gemini_key: str = "",
) -> dict:
    council_input = _build_council_input(responses, brief)

    raw = ""
    errors = []

    if clean_key(anthropic_key):
        raw = await _call_claude(SYNTHESIZER_PROMPT, council_input, anthropic_key)

        if raw and not raw.startswith("["):
            try:
                return extract_json(raw)
            except Exception as e:
                errors.append(f"Claude synthesis JSON parse failed: {e}")

    if clean_key(openai_key):
        raw = await _call_openai(SYNTHESIZER_PROMPT, council_input, openai_key)

        if raw and not raw.startswith("["):
            try:
                return extract_json(raw)
            except Exception as e:
                errors.append(f"OpenAI synthesis JSON parse failed: {e}")

    if clean_key(gemini_key):
        raw = await _call_gemini(SYNTHESIZER_PROMPT, council_input, gemini_key)

        if raw and not raw.startswith("["):
            try:
                return extract_json(raw)
            except Exception as e:
                errors.append(f"Gemini synthesis JSON parse failed: {e}")

    if raw and raw.startswith("["):
        errors.append(raw)

    return fallback_verdict(
        responses=responses,
        brief=brief,
        error=" | ".join(errors) if errors else "No synthesizer API key configured",
        confidence=35 if errors else 50,
    )


# ─── MAIN COUNCIL SESSION ─────────────────────────────────────────────────────

async def run_council_session(
    brief: str,
    context: Optional[dict] = None,
    anthropic_key: str = "",
    openai_key: str = "",
    gemini_key: str = "",
) -> dict:
    context = context or {}

    session_id = uuid.uuid4().hex[:12]
    started_at = utc_now()

    business_ctx = context.get("business", "2EasyMarketing")
    task_type = context.get("task_type", "marketing strategy")

    extra_context = {
        k: v
        for k, v in context.items()
        if k not in ("business", "task_type")
    }

    task_prompt = f"""COUNCIL SESSION — {str(task_type).upper()}

Business: {business_ctx}
Task Type: {task_type}

BRIEF:
{brief}

Additional context:
{json.dumps(extra_context, indent=2, ensure_ascii=False)}

Based on your specialized role and expertise, provide your BEST recommendation.
Be specific, actionable, and bold.
This is a council deliberation — compete to give the strongest answer.
"""

    claude_resp, openai_resp, gemini_resp = await asyncio.gather(
        _call_claude(COUNCIL_ROLES["claude"], task_prompt, anthropic_key),
        _call_openai(COUNCIL_ROLES["openai"], task_prompt, openai_key),
        _call_gemini(COUNCIL_ROLES["gemini"], task_prompt, gemini_key),
        return_exceptions=True,
    )

    def safe_response(value: Any) -> str:
        if isinstance(value, Exception):
            return f"[Error: {type(value).__name__}: {value}]"

        return safe_text(value)

    responses = {
        "claude": safe_response(claude_resp),
        "openai": safe_response(openai_resp),
        "gemini": safe_response(gemini_resp),
    }

    verdict = await _synthesize_with_best_available_model(
        responses=responses,
        brief=brief,
        anthropic_key=anthropic_key,
        openai_key=openai_key,
        gemini_key=gemini_key,
    )

    return {
        "session_id": session_id,
        "started_at": started_at,
        "completed_at": utc_now(),
        "brief": brief,
        "context": context,
        "responses": responses,
        "verdict": verdict,
        "models_used": list(COUNCIL_MODELS.keys()),
    }


# ─── QUICK COUNCIL ────────────────────────────────────────────────────────────

async def quick_council(
    question: str,
    anthropic_key: str = "",
    openai_key: str = "",
    gemini_key: str = "",
) -> dict:
    quick_role = lambda base: (
        base + "\n\nGive a CONCISE answer, 3-5 sentences max. Be bold and specific."
    )

    task_prompt = f"""Quick council question for 2EasyMarketing:

{question}

Answer from your specialized perspective in 3-5 sentences.
Be direct and actionable.
"""

    claude_resp, openai_resp, gemini_resp = await asyncio.gather(
        _call_claude(quick_role(COUNCIL_ROLES["claude"]), task_prompt, anthropic_key),
        _call_openai(quick_role(COUNCIL_ROLES["openai"]), task_prompt, openai_key),
        _call_gemini(quick_role(COUNCIL_ROLES["gemini"]), task_prompt, gemini_key),
        return_exceptions=True,
    )

    def safe_response(value: Any) -> str:
        if isinstance(value, Exception):
            return f"[Error: {type(value).__name__}: {value}]"

        return safe_text(value)

    responses = {
        "claude": safe_response(claude_resp),
        "openai": safe_response(openai_resp),
        "gemini": safe_response(gemini_resp),
    }

    verdict = await _synthesize_with_best_available_model(
        responses=responses,
        brief=question,
        anthropic_key=anthropic_key,
        openai_key=openai_key,
        gemini_key=gemini_key,
    )

    return {
        "question": question,
        "responses": responses,
        "verdict": verdict,
        "mode": "quick",
        "models_used": list(COUNCIL_MODELS.keys()),
        "completed_at": utc_now(),
    }


# ─── COUNCIL MODEL INFO ───────────────────────────────────────────────────────

def get_council_roster() -> list:
    return [
        {**info, "model_id": model_id}
        for model_id, info in COUNCIL_MODELS.items()
    ]
