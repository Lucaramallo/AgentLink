"""Agent respond router — live AI agent responses with Redis-backed rate limiting."""

import uuid as _uuid_mod

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.services.agent_engine import AGENTS, get_agent_response, get_peer_review
from app.services.webhook_caller import call_agent_webhook

router = APIRouter(prefix="/agents", tags=["agent_respond"])

_MAX_MESSAGES = 25
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


_AGENT_ALIASES: dict[str, str] = {
    "legalagent": "scribe-pro",
    "legal": "scribe-pro",
    "financeagent": "quant-z",
    "finance": "quant-z",
    "quantz": "quant-z",
    "nexus7": "nexus-7",
    "nexus": "nexus-7",
    "ariaml": "aria-ml",
    "aria": "aria-ml",
    "forgealpha": "forge-alpha",
    "forge": "forge-alpha",
    "devops": "forge-alpha",
    "scribepro": "scribe-pro",
    "scribe": "scribe-pro",
    "vortexui": "vortex-ui",
    "vortex": "vortex-ui",
    "ux": "vortex-ui",
    "sigmaqa": "sigma-qa",
    "sigma": "sigma-qa",
    "qa": "sigma-qa",
    "vectorx": "vector-x",
    "vector": "vector-x",
    "security": "vector-x",
}


def _normalize_agent_id(agent_id: str) -> str:
    key = agent_id.lower().replace("-", "").replace(" ", "")
    return _AGENT_ALIASES.get(key, "quant-z")


def _is_uuid(value: str) -> bool:
    try:
        _uuid_mod.UUID(value)
        return True
    except ValueError:
        return False


@router.post("/respond", response_model=DemoResponse)
async def agent_respond(
    payload: DemoRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = _client_ip(request)
    r = _redis()

    try:
        # ── Try DB agent first (external agents with webhook_url) ──────────
        if _is_uuid(payload.agent_id):
            from app.models.agent import Agent as AgentModel
            db_agent = await db.get(AgentModel, _uuid_mod.UUID(payload.agent_id))

            if db_agent and db_agent.webhook_url:
                result = await call_agent_webhook(
                    agent=db_agent,
                    message=payload.message,
                    session_messages=payload.session_messages,
                    room_id=payload.room_id,
                    db=db,
                )
                if "error" in result:
                    return JSONResponse(
                        status_code=503,
                        content=result,
                    )
                return DemoResponse(
                    response=result["response"],
                    agent_id=payload.agent_id,
                    agent_name=db_agent.name,
                    messages_remaining=-1,  # external agents have no demo limit
                )

        # ── Fall through to built-in demo agents ───────────────────────────
        agent_id = _normalize_agent_id(payload.agent_id)
        if agent_id not in AGENTS:
            return JSONResponse(
                status_code=400,
                content={"error": "unknown_agent", "message": f"Agent '{payload.agent_id}' could not be resolved."},
            )

        session_key = f"demo_session:{ip}"
        session_id = await r.get(session_key)

        if not session_id:
            session_id = str(_uuid_mod.uuid4())
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
            agent_id=agent_id,
            message=payload.message,
            session_messages=payload.session_messages,
        )

        agent = AGENTS[agent_id]
        return DemoResponse(
            response=text,
            agent_id=agent_id,
            agent_name=agent["name"],
            messages_remaining=_MAX_MESSAGES - new_count,
        )
    finally:
        await r.aclose()


# ── Peer review ────────────────────────────────────────────────────────────

_ROLE_WEIGHTS: dict[str, float] = {
    "Requester": 1.5,
    "Reviewer": 1.3,
    "Contributor": 1.0,
    "Builder": 1.0,
    "Observer": 0.5,
}


class PeerReviewAgent(BaseModel):
    id: str
    name: str
    role: str = "Contributor"


class PeerReviewMessage(BaseModel):
    agentId: str = ""
    agentName: str = ""
    role: str = ""
    content: str = ""
    isHuman: bool = False


class PeerReviewRequest(BaseModel):
    agents: list[PeerReviewAgent] = []
    messages: list[PeerReviewMessage] = []


@router.post("/sessions/{room_id}/peer-review")
async def session_peer_review(room_id: str, payload: PeerReviewRequest):
    non_human = [a for a in payload.agents]
    if len(non_human) < 2:
        return {"reviews": [], "weighted_averages": {a.id: 0.0 for a in non_human}}

    messages_dicts = [m.model_dump() for m in payload.messages]
    reviews = []
    totals: dict[str, float] = {a.id: 0.0 for a in non_human}
    weights: dict[str, float] = {a.id: 0.0 for a in non_human}

    for agent in non_human:
        others = [a for a in non_human if a.id != agent.id]
        scores = await get_peer_review(
            agent_id=agent.id,
            agent_name=agent.name,
            session_messages=messages_dicts,
            other_agents=[{"id": a.id, "name": a.name} for a in others],
        )
        role_weight = _ROLE_WEIGHTS.get(agent.role, 1.0)
        reviews.append({
            "voter": agent.name,
            "voter_id": agent.id,
            "voter_role": agent.role,
            "scores": scores,
        })
        for aid, score in scores.items():
            totals[aid] = totals.get(aid, 0.0) + score * role_weight
            weights[aid] = weights.get(aid, 0.0) + role_weight

    weighted_averages = {
        aid: round(totals[aid] / weights[aid], 2) if weights.get(aid, 0) > 0 else 0.0
        for aid in totals
    }
    return {"reviews": reviews, "weighted_averages": weighted_averages}
