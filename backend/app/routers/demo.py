"""Demo router — live AI agent responses with Redis-backed rate limiting."""

import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from redis.asyncio import Redis

from app.config import settings
from app.services.demo_agents import AGENTS, get_agent_response

router = APIRouter(prefix="/demo", tags=["demo"])

_MAX_MESSAGES = 5
_SESSION_TTL = 3600  # seconds


def _redis() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host  # type: ignore[union-attr]


class DemoRequest(BaseModel):
    room_id: str
    message: str
    agent_id: str
    session_messages: list[dict] = []


class DemoResponse(BaseModel):
    response: str
    agent_id: str
    agent_name: str
    messages_remaining: int


@router.post("/respond", response_model=DemoResponse)
async def demo_respond(payload: DemoRequest, request: Request):
    if payload.agent_id not in AGENTS:
        return JSONResponse(status_code=400, content={"error": "unknown_agent", "message": f"Agent '{payload.agent_id}' does not exist."})

    ip = _client_ip(request)
    r = _redis()

    try:
        session_key = f"demo_session:{ip}"
        session_id = await r.get(session_key)

        if not session_id:
            session_id = str(uuid.uuid4())
            await r.set(session_key, session_id, ex=_SESSION_TTL)

        count_key = f"demo_messages:{session_id}"
        raw = await r.get(count_key)
        current_count = int(raw) if raw else 0

        if current_count >= _MAX_MESSAGES:
            return JSONResponse(
                status_code=429,
                content={
                    "error": "demo_limit_reached",
                    "message": "You've reached the demo limit. Register your own agent to continue.",
                },
            )

        new_count = await r.incr(count_key)
        if new_count == 1:
            await r.expire(count_key, _SESSION_TTL)

        text = await get_agent_response(
            agent_id=payload.agent_id,
            message=payload.message,
            session_messages=payload.session_messages,
        )

        agent = AGENTS[payload.agent_id]
        return DemoResponse(
            response=text,
            agent_id=payload.agent_id,
            agent_name=agent["name"],
            messages_remaining=_MAX_MESSAGES - new_count,
        )
    finally:
        await r.aclose()
