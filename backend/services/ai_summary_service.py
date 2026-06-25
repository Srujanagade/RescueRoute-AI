from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from models.disaster import Disaster

logger = logging.getLogger(__name__)

AI_SUMMARY_CACHE_TTL_SECONDS = int(os.getenv("AI_SUMMARY_CACHE_TTL_SECONDS", "600"))
AI_SUMMARY_TIMEOUT_SECONDS = float(os.getenv("AI_SUMMARY_TIMEOUT_SECONDS", "20"))

PROMPT_TEMPLATE = """You are an AI assistant for a disaster navigation system.

Convert the following disaster data into a short, clear summary for travelers.

Focus on:
- What happened
- When it happened
- Impact severity
- Confidence level of the data
- How it affects nearby roads or travel

Keep it under 80 words.
Use simple language.
Avoid technical jargon.

Disaster Data:
{json_payload}

Output:
Plain text summary"""

_summary_cache: dict[str, tuple[float, "DisasterSummaryResult"]] = {}
_summary_cache_lock = asyncio.Lock()


@dataclass(frozen=True)
class DisasterSummaryResult:
    summary: str
    used_fallback: bool
    provider: str


def _serialize_disaster(disaster: Disaster) -> dict[str, Any]:
    return {
        "id": disaster.id,
        "type": disaster.type,
        "title": disaster.title,
        "location": disaster.location,
        "timestamp": disaster.timestamp.astimezone(UTC).isoformat(),
        "severity": disaster.severity,
        "source": disaster.source,
        "confidence": disaster.confidence,
        "description": disaster.description,
    }


def _cache_key(disaster: Disaster) -> str:
    if disaster.id:
        fingerprint = "|".join(
            [
                disaster.id,
                disaster.timestamp.astimezone(UTC).isoformat(),
                str(disaster.severity),
                disaster.title or "",
                disaster.location or "",
                disaster.confidence,
                disaster.description or "",
            ]
        )
    else:
        fingerprint = json.dumps(_serialize_disaster(disaster), sort_keys=True)

    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def _infer_provider() -> str:
    configured_provider = os.getenv("AI_SUMMARY_PROVIDER", "").strip().lower()
    if configured_provider:
        return configured_provider

    if os.getenv("GEMINI_API_KEY"):
        return "gemini"

    if os.getenv("AI_SUMMARY_API_KEY") or os.getenv("OPENAI_API_KEY"):
        return "openai-compatible"

    return "fallback"


def _relative_time_label(timestamp: datetime) -> str:
    event_time = timestamp.astimezone(UTC) if timestamp.tzinfo else timestamp.replace(tzinfo=UTC)
    delta_seconds = max(0, int((datetime.now(tz=UTC) - event_time).total_seconds()))

    if delta_seconds < 3600:
        minutes = max(1, delta_seconds // 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    if delta_seconds < 86400:
        hours = max(1, delta_seconds // 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    if delta_seconds < 172800:
        return "yesterday"

    days = max(2, delta_seconds // 86400)
    return f"{days} days ago"


def _severity_label(severity: float | None) -> str:
    if severity is None:
        return "unknown"
    if severity >= 80:
        return "high"
    if severity >= 50:
        return "moderate"
    return "lower"


def _travel_impact(disaster: Disaster) -> str:
    match disaster.type:
        case "flood":
            return "Low-lying roads may flood, so expect detours and slower traffic."
        case "fire":
            return "Smoke, emergency closures, or poor visibility may affect nearby roads."
        case "earthquake":
            return "Road inspections, debris, or surface damage may slow travel nearby."
        case "weather":
            return "Heavy rain, wind, or poor visibility may make nearby roads slower or unsafe."
        case _:
            return "Travel near the incident area may face delays or temporary restrictions."


def _normalize_summary_text(text: str) -> str:
    collapsed = " ".join(str(text or "").split())
    if not collapsed:
        return ""

    words = collapsed.split()
    if len(words) <= 80:
        return collapsed

    shortened = " ".join(words[:80]).rstrip(".,;: ")
    return f"{shortened}..."


def _fallback_summary(disaster: Disaster) -> str:
    location = disaster.location or "this area"
    title = disaster.title or disaster.type.replace("_", " ").title()
    when = _relative_time_label(disaster.timestamp)
    severity = _severity_label(disaster.severity)
    impact = _travel_impact(disaster)
    description = " ".join((disaster.description or "").split())

    description_text = ""
    if description:
        description_words = description.split()
        description_text = " " + " ".join(description_words[:14]).rstrip(".,;: ")
        if len(description_words) > 14:
            description_text += "..."

    summary = (
        f"{title} was reported {when} near {location}. "
        f"Severity appears {severity} and data confidence is {disaster.confidence}."
        f"{description_text} {impact}"
    )
    return _normalize_summary_text(summary)


def _prompt(disaster: Disaster) -> str:
    return PROMPT_TEMPLATE.format(
        json_payload=json.dumps(_serialize_disaster(disaster), indent=2, sort_keys=True)
    )


def _extract_openai_text(payload: dict[str, Any]) -> str | None:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None

    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        return None

    content = message.get("content")
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text" and item.get("text"):
                parts.append(str(item["text"]))
        return "\n".join(parts) if parts else None

    return None


def _extract_gemini_text(payload: dict[str, Any]) -> str | None:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return None

    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        return None

    text_parts = []
    for item in parts:
        if isinstance(item, dict) and item.get("text"):
            text_parts.append(str(item["text"]))

    return "\n".join(text_parts) if text_parts else None


async def _generate_with_openai_compatible(disaster: Disaster) -> DisasterSummaryResult:
    api_key = os.getenv("AI_SUMMARY_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing API key for OpenAI-compatible summary provider.")

    base_url = (
        os.getenv("AI_SUMMARY_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    ).rstrip("/")
    model = (
        os.getenv("AI_SUMMARY_MODEL")
        or os.getenv("OPENAI_MODEL")
        or "gpt-4.1-mini"
    )

    async with httpx.AsyncClient(timeout=httpx.Timeout(AI_SUMMARY_TIMEOUT_SECONDS)) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "temperature": 0.2,
                "messages": [
                    {
                        "role": "user",
                        "content": _prompt(disaster),
                    }
                ],
            },
        )
        response.raise_for_status()
        payload = response.json()

    summary = _normalize_summary_text(_extract_openai_text(payload) or "")
    if not summary:
        raise ValueError("OpenAI-compatible provider returned an empty summary.")

    return DisasterSummaryResult(summary=summary, used_fallback=False, provider="openai-compatible")


async def _generate_with_gemini(disaster: Disaster) -> DisasterSummaryResult:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("AI_SUMMARY_API_KEY")
    if not api_key:
        raise RuntimeError("Missing API key for Gemini summary provider.")

    model = os.getenv("GEMINI_MODEL") or os.getenv("AI_SUMMARY_MODEL") or "gemini-2.0-flash"
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent"
    )

    async with httpx.AsyncClient(timeout=httpx.Timeout(AI_SUMMARY_TIMEOUT_SECONDS)) as client:
        response = await client.post(
            url,
            params={"key": api_key},
            json={
                "generationConfig": {"temperature": 0.2},
                "contents": [
                    {
                        "parts": [{"text": _prompt(disaster)}],
                    }
                ],
            },
        )
        response.raise_for_status()
        payload = response.json()

    summary = _normalize_summary_text(_extract_gemini_text(payload) or "")
    if not summary:
        raise ValueError("Gemini provider returned an empty summary.")

    return DisasterSummaryResult(summary=summary, used_fallback=False, provider="gemini")


async def _generate_without_cache(disaster: Disaster) -> DisasterSummaryResult:
    provider = _infer_provider()

    try:
        if provider == "gemini":
            return await _generate_with_gemini(disaster)
        if provider in {"openai", "openai-compatible", "grok"}:
            return await _generate_with_openai_compatible(disaster)
    except (httpx.HTTPError, RuntimeError, ValueError) as exc:
        logger.warning("AI summary generation failed for %s: %s", disaster.id, exc)

    return DisasterSummaryResult(
        summary=_fallback_summary(disaster),
        used_fallback=True,
        provider="fallback",
    )


async def generate_disaster_summary_result(
    disaster: Disaster,
    force_refresh: bool = False,
) -> DisasterSummaryResult:
    key = _cache_key(disaster)
    now = time.monotonic()

    if not force_refresh:
        cached = _summary_cache.get(key)
        if cached and cached[0] > now:
            return cached[1]

    async with _summary_cache_lock:
        cached = _summary_cache.get(key)
        if not force_refresh and cached and cached[0] > time.monotonic():
            return cached[1]

        result = await _generate_without_cache(disaster)
        _summary_cache[key] = (time.monotonic() + AI_SUMMARY_CACHE_TTL_SECONDS, result)
        return result


async def generate_disaster_summary(disaster: Disaster) -> str:
    result = await generate_disaster_summary_result(disaster)
    return result.summary
