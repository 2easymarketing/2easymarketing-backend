"""
2EasyMarketing — External Search Utilities

This prevents the error:
Illegal header value b'Bearer '
"""

from __future__ import annotations

from typing import Dict, Optional


def clean_key(value: Optional[str]) -> str:
    return (value or "").strip()


def bearer_headers(
    api_key: Optional[str],
    extra: Optional[Dict[str, str]] = None,
) -> Optional[Dict[str, str]]:
    """
    Return Authorization headers only when a real token exists.
    Returns None if the token is missing or blank.
    """
    key = clean_key(api_key)

    if not key:
        return None

    headers = {
        "Authorization": f"Bearer {key}"
    }

    if extra:
        headers.update(extra)

    return headers


def json_bearer_headers(api_key: Optional[str]) -> Optional[Dict[str, str]]:
    return bearer_headers(
        api_key,
        {
            "Content-Type": "application/json"
        },
    )


def api_key_query_param(
    api_key: Optional[str],
    key_name: str = "key",
) -> Optional[Dict[str, str]]:
    """
    For APIs that use ?key= instead of Authorization Bearer.
    """
    key = clean_key(api_key)

    if not key:
        return None

    return {
        key_name: key
    }
