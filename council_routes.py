"""
2EasyMarketing — Council Routes compatibility module.

The launch-ready API routes are defined directly in server.py so they can use
owner authentication, database persistence, and the existing app lifecycle.
This empty router is kept only so older imports do not break.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/council", tags=["Council"])
