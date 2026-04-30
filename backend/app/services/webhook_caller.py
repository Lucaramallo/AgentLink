"""Webhook caller — sends messages to external agent endpoints and handles retries."""

import asyncio
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent

logger = logging.getLogger(__name__)

_WEBHOOK_TIMEOUT = 30.0
_MAX_FAILURES_BEFORE_PAUSE = 3
_RETRY_DELAYS = [0, 1, 3]  # seconds before each attempt (0 = immediate first try)


async def call_agent_webhook(
    agent: Agent,
    message: str,
    session_messages: list[dict],
    room_id: str,
    db: AsyncSession | None = None,
    webhook_url_override: str | None = None,
) -> dict:
    """POST to agent.webhook_url and return the response dict.

    Retries up to 3 times with exponential backoff. On total failure, records
    the failure timestamp, increments the failure counter, and auto-pauses the
    agent after _MAX_FAILURES_BEFORE_PAUSE consecutive failures.
    """
    effective_webhook_url = webhook_url_override or agent.webhook_url
    payload = {
        "room_id": room_id,
        "message": message,
        "session_messages": session_messages,
        "agent_id": str(agent.agent_id),
        "agent_name": agent.name,
    }

    for attempt, delay in enumerate(_RETRY_DELAYS, start=1):
        if delay > 0:
            await asyncio.sleep(delay)

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    effective_webhook_url,  # type: ignore[arg-type]
                    json=payload,
                    timeout=_WEBHOOK_TIMEOUT,
                )
                resp.raise_for_status()
                data = resp.json()

            logger.info("Webhook OK for agent %s (attempt %d)", agent.name, attempt)

            if db is not None:
                agent.webhook_failures_count = 0
                await db.flush()

            return {"response": data.get("response", "")}

        except Exception as exc:
            logger.warning(
                "Webhook attempt %d/%d failed for agent %s: %s",
                attempt,
                len(_RETRY_DELAYS),
                agent.name,
                exc,
            )

    # All attempts exhausted
    logger.error("All webhook attempts failed for agent %s", agent.name)

    if db is not None:
        agent.last_webhook_failure = datetime.now(timezone.utc)
        agent.webhook_failures_count = (agent.webhook_failures_count or 0) + 1
        if agent.webhook_failures_count >= _MAX_FAILURES_BEFORE_PAUSE:
            agent.is_active = False
            logger.warning(
                "Auto-pausing agent %s after %d consecutive webhook failures",
                agent.name,
                agent.webhook_failures_count,
            )
        await db.flush()

    return {
        "error": "agent_unavailable",
        "message": f"Agent {agent.name} is not responding. Owner notified.",
    }
