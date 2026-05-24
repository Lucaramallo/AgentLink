"""Agent respond router — live AI agent responses with Redis-backed rate limiting."""

import logging
import uuid as _uuid_mod

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import UserRole
from app.services.agent_engine import AGENTS, get_agent_response, get_peer_review
from app.services.webhook_caller import call_agent_webhook

logger = logging.getLogger(__name__)

_WHITELISTED_EMAILS: frozenset[str] = frozenset({"owner@agentlink.ai", "admin@agentlink.ai"})


def _is_whitelisted_user(user: object | None) -> bool:
    if user is None:
        return False
    if getattr(user, "email", "") in _WHITELISTED_EMAILS:
        return True
    return getattr(user, "role", None) == UserRole.SUPERADMIN

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
    acting_as: dict | None = None
    session_messages: list[dict] = []
    subtask: str | None = None
    round_number: int | None = None
    max_rounds: int | None = None
    team_agents: list[dict] | None = None
    rn_context: str | None = None
    is_builder: bool = False
    repo_context: str | None = None


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


def _strip_node_prefix(agent_id: str) -> str:
    """Session graph nodes use 'node-{uuid}' as their ID. Strip the prefix to get the raw UUID."""
    if agent_id.startswith("node-"):
        return agent_id[5:]
    return agent_id


@router.post("/respond", response_model=DemoResponse)
async def agent_respond(
    payload: DemoRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = _client_ip(request)
    r = _redis()

    # Normalise agent_id: strip the 'node-' prefix the session graph adds so the
    # UUID check below works even when the caller passes the full node_id.
    raw_agent_id = _strip_node_prefix(payload.agent_id)
    # Registered name from DB record; set when a DB agent falls through to the
    # built-in demo path so agent_name in the response always comes from the
    # agent record rather than whatever the demo-agent alias lookup returns.
    registered_agent_name: str | None = None

    try:
        # ── Resolve previous session context (applies to all agent types) ──
        subtask = payload.subtask
        previous_session_context: str | None = None
        if _is_uuid(payload.room_id):
            from app.models.room import Room as _RoomModel, Message as _Message, MessageType as _MessageType
            from app.services.coordinator_service import get_agent_subtask as _get_subtask
            from sqlalchemy.future import select as _sa_select
            _room = await db.get(_RoomModel, _uuid_mod.UUID(payload.room_id))
            logger.info(
                "agent_respond: room_id=%s found=%s continue_from_room_id=%s",
                payload.room_id,
                _room is not None,
                _room.continue_from_room_id if _room else None,
            )
            if _room:
                if subtask is None and _is_uuid(raw_agent_id) and _room.coordinator_plan:
                    subtask = _get_subtask(_room, raw_agent_id)
                if _room.continue_from_room_id:
                    logger.info(
                        "agent_respond: fetching previous DELIVERABLE messages from room=%s",
                        _room.continue_from_room_id,
                    )
                    _prev_res = await db.execute(
                        _sa_select(_Message)
                        .where(
                            _Message.room_id == _room.continue_from_room_id,
                            _Message.message_type == _MessageType.DELIVERABLE,
                        )
                        .order_by(_Message.timestamp.asc())
                        .limit(5)
                    )
                    _prev_msgs = _prev_res.scalars().all()
                    logger.info(
                        "agent_respond: previous DELIVERABLE messages found=%d",
                        len(_prev_msgs),
                    )
                    if _prev_msgs:
                        _deliverable = "\n\n---\n\n".join(m.content_natural for m in _prev_msgs)
                        previous_session_context = (
                            f"## Previous Session Context\n"
                            f"Session ID: {_room.continue_from_room_id}\n\n"
                            f"Deliverable:\n{_deliverable}\n\n"
                            f"The requester has additional instructions for this continuation session."
                        )
                        logger.info(
                            "agent_respond: previous_session_context built len=%d first_100=%r",
                            len(previous_session_context),
                            previous_session_context[:100],
                        )
                    else:
                        logger.info(
                            "agent_respond: no previous DELIVERABLE messages found — context will be None"
                        )
                    # Inject project files from the previous session's GitHub branch
                    _prev_room = await db.get(_RoomModel, _room.continue_from_room_id)
                    if (
                        _prev_room
                        and _prev_room.github_repo_url
                        and _prev_room.repo_branch
                    ):
                        from app.models.user import User as _UserModel
                        from app.services.github_repo import get_project_files as _get_project_files
                        from app.services.github_delivery import _decrypt_token as _decrypt_github_token
                        _session_owner = None
                        if _room.requester_user_id:
                            _session_owner = await db.get(_UserModel, _room.requester_user_id)
                        if _session_owner and _session_owner.github_access_token:
                            _gh_token = _decrypt_github_token(_session_owner.github_access_token)
                            _project_files = await _get_project_files(
                                repo_url=_prev_room.github_repo_url,
                                branch=_prev_room.repo_branch,
                                session_id=str(_room.continue_from_room_id),
                                github_token=_gh_token,
                            )
                            logger.info(
                                "agent_respond: project files fetched count=%d from prev_room=%s",
                                len(_project_files),
                                _room.continue_from_room_id,
                            )
                            if _project_files:
                                _files_section = "\n\n## Previous Session Project Files\n"
                                for _pf in _project_files:
                                    _ext = _pf["filename"].rsplit(".", 1)[-1] if "." in _pf["filename"] else ""
                                    _files_section += f"\n### {_pf['filename']}\n```{_ext}\n{_pf['content']}\n```\n"
                                if previous_session_context:
                                    previous_session_context += _files_section
                                else:
                                    previous_session_context = _files_section
        else:
            logger.info("agent_respond: room_id=%s is not a valid UUID — skipping context lookup", payload.room_id)

        # ── Try DB agent first (external agents with webhook_url) ──────────
        if _is_uuid(raw_agent_id):
            from app.models.agent import Agent as AgentModel
            from app.models.room import Room as RoomModel
            from sqlalchemy.orm import selectinload
            from sqlalchemy.future import select as sa_select

            db_agent = await db.get(AgentModel, _uuid_mod.UUID(raw_agent_id))

            if db_agent and db_agent.webhook_url:
                # Use snapshot webhook_url if this call is part of a real room session
                snapshot_webhook_url: str | None = None
                if _is_uuid(payload.room_id):
                    res = await db.execute(
                        sa_select(RoomModel)
                        .options(selectinload(RoomModel.contract))
                        .where(RoomModel.room_id == _uuid_mod.UUID(payload.room_id))
                    )
                    room = res.scalar_one_or_none()
                    if room and room.contract and room.contract.agent_snapshots:
                        snapshots = room.contract.agent_snapshots
                        for key in ("agent_a", "agent_b"):
                            snap = snapshots.get(key, {})
                            if snap.get("agent_id") == raw_agent_id:
                                snapshot_webhook_url = snap.get("webhook_url")
                                break

                # Prepend previous session context to the message so webhook
                # agents receive the prior deliverable in their payload.
                effective_message = payload.message
                if previous_session_context:
                    effective_message = f"{previous_session_context}\n\n{payload.message}"
                    logger.info(
                        "agent_respond: injecting previous_session_context into webhook message agent_id=%s",
                        raw_agent_id,
                    )

                result = await call_agent_webhook(
                    agent=db_agent,
                    message=effective_message,
                    session_messages=payload.session_messages,
                    room_id=payload.room_id,
                    db=db,
                    webhook_url_override=snapshot_webhook_url,
                )
                if "error" in result:
                    return JSONResponse(
                        status_code=503,
                        content={
                            "error": "agent_unavailable",
                            "agent_id": str(db_agent.agent_id),
                            "agent_name": db_agent.name,
                            "message": f"Agent {db_agent.name} is not responding. Owner has been notified.",
                        },
                    )
                return DemoResponse(
                    response=result["response"],
                    agent_id=raw_agent_id,
                    agent_name=db_agent.name,
                    messages_remaining=-1,  # external agents have no demo limit
                )

            if db_agent and not db_agent.webhook_url:
                # Only whitelisted owners may use the built-in agent_engine
                from app.models.user import User as UserModel
                owner_user = None
                if db_agent.user_id:
                    owner_user = await db.get(UserModel, db_agent.user_id)
                if not _is_whitelisted_user(owner_user):
                    return JSONResponse(
                        status_code=400,
                        content={
                            "error": "no_webhook",
                            "message": "External agents must have a webhook URL configured",
                        },
                    )
                # Record the registered name so the response uses it, not the
                # demo fallback alias.  Also drives persona selection below.
                registered_agent_name = db_agent.name

        # ── Fall through to built-in demo agents ───────────────────────────
        # Normalise using the registered DB name when available so the right
        # built-in persona is selected (e.g. "Nexus-7" → "nexus-7", not the
        # UUID which would default to "quant-z").
        agent_id = _normalize_agent_id(registered_agent_name or raw_agent_id)
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

        logger.info(
            "agent_respond: calling get_agent_response agent_id=%s previous_session_context=%s",
            agent_id,
            previous_session_context is not None,
        )
        text = await get_agent_response(
            agent_id=agent_id,
            message=payload.message,
            session_messages=payload.session_messages,
            acting_as=payload.acting_as,
            subtask=subtask,
            round_number=payload.round_number,
            max_rounds=payload.max_rounds,
            team_agents=payload.team_agents,
            rn_context=payload.rn_context,
            is_builder=payload.is_builder,
            repo_context=payload.repo_context,
            previous_session_context=previous_session_context,
        )

        agent = AGENTS[agent_id]
        return DemoResponse(
            response=text,
            agent_id=agent_id,
            agent_name=registered_agent_name or agent["name"],
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
    """Run automated peer review between agents; always returns 200 with fallback on error."""
    non_human = [a for a in payload.agents]
    if len(non_human) < 2:
        return {"reviews": [], "weighted_averages": {a.id: 0.0 for a in non_human}}

    messages_dicts = [m.model_dump() for m in payload.messages]
    reviews = []
    totals: dict[str, float] = {a.id: 0.0 for a in non_human}
    weights: dict[str, float] = {a.id: 0.0 for a in non_human}

    for agent in non_human:
        others = [a for a in non_human if a.id != agent.id]
        try:
            scores = await get_peer_review(
                agent_id=agent.id,
                agent_name=agent.name,
                session_messages=messages_dicts,
                other_agents=[{"id": a.id, "name": a.name} for a in others],
            )
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error(
                "peer_review failed for %s: %s: %s",
                agent.name, type(exc).__name__, exc,
            )
            scores = {a.id: None for a in others}
        role_weight = _ROLE_WEIGHTS.get(agent.role, 1.0)
        reviews.append({
            "voter": agent.name,
            "voter_id": agent.id,
            "voter_role": agent.role,
            "scores": scores,
        })
        for aid, score in scores.items():
            if score is not None:
                totals[aid] = totals.get(aid, 0.0) + score * role_weight
                weights[aid] = weights.get(aid, 0.0) + role_weight

    weighted_averages = {
        aid: round(totals[aid] / weights[aid], 2) if weights.get(aid, 0) > 0 else None
        for aid in totals
    }
    return {"reviews": reviews, "weighted_averages": weighted_averages}
