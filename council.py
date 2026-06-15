"""
2EasyMarketing — LLM Council compatibility wrapper.

The active council implementation lives in council_engine.py.
This file is kept only so older imports do not break.
"""

from council_engine import (  # noqa: F401
    COUNCIL_MODELS,
    get_council_roster,
    quick_council,
    run_council_session,
)
