"""
2EasyMarketing — Council API Routes

This file connects your website/backend routes to the LLM Council engine.

It creates:
POST /api/council/quick
POST /api/council/session
GET  /api/council/roster
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from council_engine import (
    get_council_roster,
    quick_council,
    run_council_session,
)


router = APIRouter(
    prefix="/api/council",
    tags=["Council"],
)


class QuickCouncilRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=8000,
    )


class FullCouncilRequest(BaseModel):
    brief: str = Field(
        ...,
        min_length=1,
        max_length=20000,
    )
    context: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
    )


def _env(name: str, fallback: str = "") -> str:
    return (os.getenv(name, fallback) or "").strip()


def _provider_keys() -> dict:
    return {
        "anthropic_key": _env("ANTHROPIC_API_KEY"),
        "openai_key": _env("OPENAI_API_KEY"),
        "gemini_key": _env("GEMINI_API_KEY", _env("GOOGLE_API_KEY")),
    }


@router.get("/roster")
async def council_roster():
    return JSONResponse(
        content={
            "models": get_council_roster()
        }
    )


@router.post("/quick")
async def council_quick(payload: QuickCouncilRequest):
    """
    Safe replacement for POST /api/council/quick.

    This avoids StreamingResponse and returns normal JSON.
    That helps prevent the Starlette/FastAPI error you saw in the logs.
    """
    try:
        result = await quick_council(
            question=payload.question,
            **_provider_keys(),
        )

        return JSONResponse(
            content=result
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Council quick failed safely: {type(e).__name__}: {e}",
        )


@router.post("/session")
async def council_session(payload: FullCouncilRequest):
    """
    Full LLM Council session endpoint.
    """
    try:
        result = await run_council_session(
            brief=payload.brief,
            context=payload.context or {},
            **_provider_keys(),
        )

        return JSONResponse(
            content=result
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Council session failed safely: {type(e).__name__}: {e}",
        )
