"""
2EasyMarketing — LLM Council Engine
Multi-model AI deliberation: Claude · GPT-4o · Gemini
Each model plays a specialized role. Maya synthesizes the final verdict.
"""
import asyncio, json, os, time, hashlib
from datetime import datetime
from typing import Optional
import httpx

# ─── COUNCIL MODEL ROSTER ────────────────────────────────────────────────────
COUNCIL_MODELS = {
    "claude": {
        "name": "Claude Sonnet",
        "role": "Creative Strategist",
        "specialty": "Brand voice, storytelling, creative direction, long-form copy",
        "emoji": "🟣",
        "provider": "anthropic",
    },
    "gpt4o": {
        "name": "GPT-4o",
        "role": "Data Analyst",
        "specialty": "Competitive research, performance metrics, structured strategy, ROI analysis",
        "emoji": "🟢",
        "provider": "openai",
    },
    "gemini": {
        "name": "Gemini Pro",
        "role": "Growth Hacker",
        "specialty": "Viral tactics, platform algorithms, rapid testing, trend exploitation",
        "emoji": "🔵",
        "provider": "google",
    },
}

COUNCIL_ROLES = {
    "claude":  "You are the Creative Strategist on the 2EasyMarketing AI Council. Your specialty is brand voice, storytelling, emotional resonance, and creative direction. You think in narratives and human psychology.",
    "gpt4o":   "You are the Data Analyst on the 2EasyMarketing AI Council. Your specialty is competitive intelligence, performance benchmarking, structured frameworks, and ROI-driven decisions. You think in numbers and systems.",
    "gemini":  "You are the Growth Hacker on the 2EasyMarketing AI Council. Your specialty is viral mechanics, platform algorithm exploitation, rapid A/B testing, and unconventional growth tactics. You think in experiments and velocity.",
}

SYNTHESIZER_PROMPT = """You are Maya — the Chief AI Strategist of 2EasyMarketing and chair of the LLM Council.
Three specialized AI models have each analyzed the brief and given their recommendation.
Your job is to:
1. Identify the STRONGEST ideas from each model
2. Resolve any conflicts or contradictions
3. Synthesize a single unified COUNCIL VERDICT that is better than any individual recommendation
4. Rate each model's contribution (1-10) with a one-line reason

Return ONLY valid JSON with this exact structure:
{
  "verdict": "Full unified recommendation (2-5 paragraphs, ready to execute)",
  "key_actions": ["Action 1", "Action 2", "Action 3", "Action 4", "Action 5"],
  "scores": {
    "claude": {"score": 8, "reason": "Strong brand voice but lacked data"},
    "gpt4o": {"score": 9, "reason": "Solid framework and metrics"},
    "gemini": {"score": 7, "reason": "Creative tactics, execution gaps"}
  },
  "winning_insight": "The single most valuable idea from the entire council session",
  "confidence": 87
}"""

# ─── MODEL CALLERS ────────────────────────────────────────────────────────────

async def _call_claude(role_prompt: str, task_prompt: str, api_key: str) -> str:
    """Call Claude via Anthropic SDK."""
    try:
        from anthropic import AsyncAnthropic
        c = AsyncAnthropic(api_key=api_key)
        resp = await c.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1500,
            system=role_prompt,
            messages=[{"role": "user", "content": task_prompt}],
        )
        return resp.content[0].text
    except Exception as e:
        return f"[Claude unavailable: {e}]"


async def _call_gpt4o(role_prompt: str, task_prompt: str, api_key: str) -> str:
    """Call GPT-4o via OpenAI REST API."""
    if not api_key:
        return "[GPT-4o unavailable: no API key configured]"
    try:
        async with httpx.AsyncClient(timeout=45.0) as http:
            resp = await http.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": "gpt-4o",
                    "max_tokens": 1500,
                    "messages": [
                        {"role": "system", "content": role_prompt},
                        {"role": "user", "content": task_prompt},
                    ],
                },
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"]
            return f"[GPT-4o error {resp.status_code}: {resp.text[:200]}]"
    except Exception as e:
        return f"[GPT-4o unavailable: {e}]"


async def _call_gemini(role_prompt: str, task_prompt: str, api_key: str) -> str:
    """Call Gemini Pro via Google REST API."""
    if not api_key:
        return "[Gemini unavailable: no API key configured]"
    try:
        async with httpx.AsyncClient(timeout=45.0) as http:
            resp = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key={api_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "system_instruction": {"parts": [{"text": role_prompt}]},
                    "contents": [{"parts": [{"text": task_prompt}]}],
                    "generationConfig": {"maxOutputTokens": 1500},
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"]
            return f"[Gemini error {resp.status_code}: {resp.text[:200]}]"
    except Exception as e:
        return f"[Gemini unavailable: {e}]"


async def _synthesize_with_claude(responses: dict, brief: str, api_key: str) -> dict:
    """Maya synthesizes the 3 model responses into a unified council verdict."""
    try:
        from anthropic import AsyncAnthropic
        c = AsyncAnthropic(api_key=api_key)

        council_input = f"""ORIGINAL BRIEF:
{brief}

---

🟣 CLAUDE (Creative Strategist) says:
{responses.get("claude", "[no response]")}

---

🟢 GPT-4o (Data Analyst) says:
{responses.get("gpt4o", "[no response]")}

---

🔵 GEMINI (Growth Hacker) says:
{responses.get("gemini", "[no response]")}

---

Synthesize the above into a COUNCIL VERDICT. Return only valid JSON."""

        resp = await c.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=2000,
            system=SYNTHESIZER_PROMPT,
            messages=[{"role": "user", "content": council_input}],
        )
        raw = resp.content[0].text.strip()
        # Extract JSON if wrapped in markdown
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)
    except json.JSONDecodeError as e:
        return {
            "verdict": raw if "raw" in dir() else "Synthesis failed — JSON parse error",
            "key_actions": [],
            "scores": {},
            "winning_insight": "",
            "confidence": 0,
            "error": str(e),
        }
    except Exception as e:
        return {
            "verdict": f"Council synthesis failed: {e}",
            "key_actions": [],
            "scores": {},
            "winning_insight": "",
            "confidence": 0,
            "error": str(e),
        }


# ─── MAIN COUNCIL SESSION ─────────────────────────────────────────────────────

async def run_council_session(
    brief: str,
    context: dict,
    anthropic_key: str,
    openai_key: str = "",
    gemini_key: str = "",
) -> dict:
    """
    Run a full LLM Council session:
    1. All 3 models deliberate in parallel
    2. Maya synthesizes the council verdict
    Returns a complete session record.
    """
    session_id = hashlib.md5(f"{brief}{time.time()}".encode()).hexdigest()[:12]
    started_at = datetime.utcnow().isoformat()

    # Build the task prompt each model sees
    business_ctx = context.get("business", "2EasyMarketing")
    task_type = context.get("task_type", "marketing strategy")

    task_prompt = f"""COUNCIL SESSION — {task_type.upper()}

Business: {business_ctx}
Task Type: {task_type}

BRIEF:
{brief}

Additional context:
{json.dumps({k: v for k, v in context.items() if k not in ("business", "task_type")}, indent=2)}

Based on your specialized role and expertise, provide your BEST recommendation.
Be specific, actionable, and bold. This is a council deliberation — compete to give the strongest answer."""

    # Run all 3 models in parallel
    claude_task  = _call_claude(COUNCIL_ROLES["claude"],  task_prompt, anthropic_key)
    gpt4o_task   = _call_gpt4o(COUNCIL_ROLES["gpt4o"],   task_prompt, openai_key)
    gemini_task  = _call_gemini(COUNCIL_ROLES["gemini"], task_prompt, gemini_key)

    claude_resp, gpt4o_resp, gemini_resp = await asyncio.gather(
        claude_task, gpt4o_task, gemini_task
    )

    responses = {
        "claude": claude_resp,
        "gpt4o":  gpt4o_resp,
        "gemini": gemini_resp,
    }

    # Synthesize
    verdict = await _synthesize_with_claude(responses, brief, anthropic_key)

    return {
        "session_id":   session_id,
        "started_at":   started_at,
        "completed_at": datetime.utcnow().isoformat(),
        "brief":        brief,
        "context":      context,
        "responses":    responses,
        "verdict":      verdict,
        "models_used":  list(COUNCIL_MODELS.keys()),
    }


# ─── QUICK COUNCIL (single-question, fast mode) ───────────────────────────────

async def quick_council(
    question: str,
    anthropic_key: str,
    openai_key: str = "",
    gemini_key: str = "",
) -> dict:
    """
    Lightweight council session for quick owner questions.
    Each model gives a short answer (max 400 tokens), Maya picks the winner.
    """
    quick_role = lambda base: base + "\n\nGive a CONCISE answer (3-5 sentences max). Be bold and specific."

    task_prompt = f"""Quick council question for 2EasyMarketing:

{question}

Answer from your specialized perspective in 3-5 sentences. Be direct and actionable."""

    claude_task  = _call_claude(quick_role(COUNCIL_ROLES["claude"]),  task_prompt, anthropic_key)
    gpt4o_task   = _call_gpt4o(quick_role(COUNCIL_ROLES["gpt4o"]),   task_prompt, openai_key)
    gemini_task  = _call_gemini(quick_role(COUNCIL_ROLES["gemini"]), task_prompt, gemini_key)

    claude_resp, gpt4o_resp, gemini_resp = await asyncio.gather(
        claude_task, gpt4o_task, gemini_task
    )

    responses = {"claude": claude_resp, "gpt4o": gpt4o_resp, "gemini": gemini_resp}
    verdict   = await _synthesize_with_claude(responses, question, anthropic_key)

    return {
        "question":  question,
        "responses": responses,
        "verdict":   verdict,
        "mode":      "quick",
    }


# ─── COUNCIL MODEL INFO ───────────────────────────────────────────────────────

def get_council_roster() -> list:
    return [
        {**info, "model_id": mid}
        for mid, info in COUNCIL_MODELS.items()
    ]
