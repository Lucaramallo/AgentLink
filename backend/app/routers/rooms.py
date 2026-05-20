"""Router de Salas — creación, mensajes y cierre de salas de colaboración — Módulos 2 y 3."""

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

log = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.agent import Agent
from app.models.room import (
    Message,
    MessageType,
    Poll,
    PollActionType,
    PollScope,
    Room,
    RoomContract,
    RoomOutcome,
    RoomStatus,
)
from app.models.user import User
from app.services.github_delivery import deliver_to_github
from app.services.identity import sign_message, verify_signature
from app.services.room_manager import create_room, process_deliverable
from app.services.round_state import (
    get_round_state,
    initialize_round,
    mark_timed_out,
    set_agent_state,
)
from app.services.turn_order import get_turn_order
from app.services.poll_service import (
    apply_result,
    cast_vote,
    close_poll,
    create_poll,
    serialize_poll,
    sign_poll_server,
    veto_poll,
)
from app.websocket.room_handler import room_manager

router = APIRouter(prefix="/rooms", tags=["rooms"])


# --- Schemas Pydantic ---

class ContractCreate(BaseModel):
    agent_a_id: uuid.UUID
    agent_b_id: uuid.UUID
    task_description: str
    deliverable_spec: str
    max_revision_rounds: int = 2
    timeout_hours: int = 48


class ContractSignPayload(BaseModel):
    owner_id: uuid.UUID


class MessageCreate(BaseModel):
    sender_agent_id: uuid.UUID
    private_key_b64: str
    content_natural: str
    content_structured: dict = {}
    message_type: MessageType


class DeliverableVerdict(BaseModel):
    verdict: str  # "CONFORME" o "NO_CONFORME"
    reason: str


# --- Endpoints REST ---

@router.get("/{room_id}")
async def get_room(
    room_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    result = await db.execute(
        select(Room).options(selectinload(Room.contract)).where(Room.room_id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Sala no encontrada.")
    return {
        "room_id": str(room.room_id),
        "status": room.status,
        "task_description": room.contract.task_description,
        "agent_a_id": str(room.agent_a_id),
        "agent_b_id": str(room.agent_b_id),
        "github_repo_url": room.github_repo_url,
        "session_graph": room.session_graph,
    }


def _agent_snapshot(agent: Agent) -> dict:
    return {
        "agent_id": str(agent.agent_id),
        "name": agent.name,
        "description": agent.description,
        "skills": agent.skills,
        "framework": agent.framework,
        "session_fee": agent.session_fee,
        "cost_per_message": agent.cost_per_message,
        "webhook_url": agent.webhook_url,
        "public_key": agent.public_key,
    }


@router.post("/contracts", status_code=status.HTTP_201_CREATED)
async def create_contract(
    payload: ContractCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Crea el borrador de contrato de sala. Ambos dueños deben firmarlo antes de abrir la sala."""
    agent_a = await db.get(Agent, payload.agent_a_id)
    if not agent_a:
        raise HTTPException(status_code=404, detail="Agente A no encontrado.")
    agent_b = await db.get(Agent, payload.agent_b_id)
    if not agent_b:
        raise HTTPException(status_code=404, detail="Agente B no encontrado.")

    contract = RoomContract(
        task_description=payload.task_description,
        deliverable_spec=payload.deliverable_spec,
        max_revision_rounds=payload.max_revision_rounds,
        timeout_hours=payload.timeout_hours,
        agent_snapshots={
            "agent_a": _agent_snapshot(agent_a),
            "agent_b": _agent_snapshot(agent_b),
        },
    )
    db.add(contract)
    await db.flush()
    return {"contract_id": str(contract.contract_id)}


@router.post("/contracts/{contract_id}/sign")
async def sign_contract(
    contract_id: uuid.UUID,
    payload: ContractSignPayload,
    side: str,  # "a" o "b"
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Firma el contrato de sala como dueño A o B."""
    contract = await db.get(RoomContract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato no encontrado.")

    if side == "a":
        contract.owner_a_signed = True
    elif side == "b":
        contract.owner_b_signed = True
    else:
        raise HTTPException(status_code=400, detail="side debe ser 'a' o 'b'.")

    db.add(contract)
    return {"signed": True, "both_signed": contract.owner_a_signed and contract.owner_b_signed}


@router.post("", status_code=status.HTTP_201_CREATED)
async def open_room(
    contract_id: uuid.UUID,
    agent_a_id: uuid.UUID,
    agent_b_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    github_repo_url: str | None = Query(None),
) -> dict:
    """Abre la sala cuando el contrato está firmado por ambos dueños."""
    contract = await db.get(RoomContract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato no encontrado.")

    try:
        room = await create_room(db, agent_a_id, agent_b_id, contract, github_repo_url=github_repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"room_id": str(room.room_id), "status": room.status}


@router.post("/{room_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_message(
    room_id: uuid.UUID,
    payload: MessageCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Envía un mensaje a la sala. La firma ed25519 es obligatoria y se valida."""
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Sala no encontrada.")

    agent = await db.get(Agent, payload.sender_agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado.")

    # Generar firma con la clave privada provista
    signature = sign_message(
        private_key_b64=payload.private_key_b64,
        message=payload.content_natural,
    )

    # Verificar firma contra la clave pública registrada del agente
    is_valid = verify_signature(
        public_key_b64=agent.public_key,
        message=payload.content_natural,
        signature_b64=signature,
    )
    if not is_valid:
        raise HTTPException(status_code=403, detail="Firma ed25519 inválida.")

    message = Message(
        room_id=room_id,
        sender_agent_id=payload.sender_agent_id,
        content_natural=payload.content_natural,
        content_structured=payload.content_structured,
        signature=signature,
        message_type=payload.message_type,
    )
    db.add(message)
    await db.flush()
    return {"message_id": str(message.message_id)}


@router.post("/{room_id}/verdict")
async def submit_verdict(
    room_id: uuid.UUID,
    payload: DeliverableVerdict,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Agente A emite veredicto sobre el entregable de B."""
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Sala no encontrada.")

    if payload.verdict not in ("CONFORME", "NO_CONFORME"):
        raise HTTPException(status_code=400, detail="Veredicto debe ser CONFORME o NO_CONFORME.")

    room = await process_deliverable(db, room, payload.verdict, payload.reason)

    if payload.verdict == "CONFORME":
        from app.services.dataset_service import collect_session_data as _collect
        import asyncio as _asyncio
        _asyncio.create_task(_collect(room_id=room_id, outcome="CONFORME"))

    return {"room_id": str(room.room_id), "status": room.status, "outcome": room.outcome}


@router.get("/{room_id}/contract-snapshot")
async def get_contract_snapshot(
    room_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Retorna el snapshot inmutable de los agentes tal como fueron al firmar el contrato."""
    result = await db.execute(
        select(Room).options(selectinload(Room.contract)).where(Room.room_id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Sala no encontrada.")
    if not room.contract or not room.contract.agent_snapshots:
        raise HTTPException(status_code=404, detail="Snapshot de contrato no disponible.")
    return {
        "contract_id": str(room.contract.contract_id),
        "signed_at": room.contract.signed_at.isoformat() if room.contract.signed_at else None,
        "agent_snapshots": room.contract.agent_snapshots,
    }


# --- Agent dropped ---

class AgentDroppedPayload(BaseModel):
    agent_id: str
    action: str  # "continue_without" | "close_session"


@router.post("/{room_id}/agent-dropped")
async def agent_dropped(
    room_id: uuid.UUID,
    payload: AgentDroppedPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Called when a Requester decides how to proceed after an agent fails mid-session.

    continue_without: marks the agent as dropped (stored in room.dropped_agents).
    close_session: closes the room as INCOMPLETE and returns full escrow to Requester.
    """
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Sala no encontrada.")

    if payload.action == "continue_without":
        current = list(room.dropped_agents or [])
        if payload.agent_id not in current:
            current.append(payload.agent_id)
            room.dropped_agents = current
            flag_modified(room, "dropped_agents")
        await db.flush()
        return {"status": "agent_dropped", "dropped_agents": room.dropped_agents}

    elif payload.action == "close_session":
        room.status = RoomStatus.CLOSED
        room.outcome = RoomOutcome.INCOMPLETE
        room.closed_at = datetime.now(timezone.utc)
        # Also mark the agent as dropped for audit trail
        current = list(room.dropped_agents or [])
        if payload.agent_id not in current:
            current.append(payload.agent_id)
            room.dropped_agents = current
            flag_modified(room, "dropped_agents")
        await db.flush()
        return {
            "status": "closed",
            "outcome": "INCOMPLETE",
            "refund": "full",
        }

    raise HTTPException(status_code=400, detail="action must be 'continue_without' or 'close_session'.")


# --- GitHub Delivery ---

class DeliverGitHubPayload(BaseModel):
    deliverable_content: str
    session_log: str
    agents_contributions: list[dict]
    github_repo_url: str | None = None


@router.post("/{room_id}/deliver-github")
async def deliver_github(
    room_id: uuid.UUID,
    payload: DeliverGitHubPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Push session deliverable to GitHub. Room must be CLOSED+SUCCESS if it exists in DB."""
    if not current_user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected.")

    room = await db.get(Room, room_id)
    if room and not (room.status == RoomStatus.CLOSED and room.outcome == RoomOutcome.SUCCESS):
        raise HTTPException(status_code=400, detail="Room must be CLOSED with SUCCESS outcome.")

    existing_repo_url = payload.github_repo_url or (room.github_repo_url if room else None)

    try:
        result = await deliver_to_github(
            github_access_token=current_user.github_access_token,
            github_username=current_user.github_username or "",
            room_id=room_id,
            deliverable_content=payload.deliverable_content,
            session_log=payload.session_log,
            agents_contributions=payload.agents_contributions,
            existing_repo_url=existing_repo_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub delivery failed: {exc}")

    if room:
        room.github_delivery_url = result["branch_url"]
        await db.flush()

    return result


# --- Turn order & round state ---

def _redis() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


class SessionGraphPayload(BaseModel):
    agents: list[dict]
    edges: list[dict]
    thinking_timeout_secs: int = 60


class RoundStateUpdate(BaseModel):
    round: int
    agent_id: str
    state: str  # PENDING | THINKING | RESPONDED | SKIPPED


@router.post("/{room_id}/session-graph")
async def set_session_graph(
    room_id: uuid.UUID,
    payload: SessionGraphPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Persist the session graph (agents + edges) used for turn order and edge validation."""
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")

    room.session_graph = {"agents": payload.agents, "edges": payload.edges}
    room.thinking_timeout_secs = max(10, min(300, payload.thinking_timeout_secs))
    await db.flush()

    non_human_ids = [a["id"] for a in payload.agents if not a.get("is_human", False)]
    r = _redis()
    try:
        await initialize_round(r, str(room_id), 1, non_human_ids)
    finally:
        await r.aclose()

    return {"ok": True, "agent_count": len(non_human_ids)}


@router.get("/{room_id}/turn-order")
async def get_room_turn_order(
    room_id: uuid.UUID,
    round: int,
    max_rounds: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Return ordered turn groups for the given round based on the stored session graph."""
    room = await db.get(Room, room_id)
    if not room or not room.session_graph:
        raise HTTPException(status_code=404, detail="Session graph not set for this room.")

    groups = get_turn_order(room.session_graph, round, max_rounds)
    return {
        "round": round,
        "max_rounds": max_rounds,
        "groups": [
            {"agents": g.agents, "parallel": g.parallel, "label": g.label}
            for g in groups
        ],
    }


@router.get("/{room_id}/round-state")
async def get_room_round_state(
    room_id: uuid.UUID,
    round: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Return per-agent states for a round. Times out any stale THINKING agents first."""
    room = await db.get(Room, room_id)
    timeout_secs = room.thinking_timeout_secs if room else 60

    r = _redis()
    try:
        timed_out = await mark_timed_out(r, str(room_id), round, timeout_secs)
        states = await get_round_state(r, str(room_id), round)
    finally:
        await r.aclose()

    return {"round": round, "states": states, "timed_out": timed_out}


@router.post("/{room_id}/round-state")
async def update_round_state(
    room_id: uuid.UUID,
    payload: RoundStateUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Update one agent's state in a round and broadcast agent_state_change over WS."""
    valid = {"PENDING", "THINKING", "RESPONDED", "SKIPPED"}
    if payload.state not in valid:
        raise HTTPException(status_code=400, detail=f"state must be one of {sorted(valid)}.")

    room = await db.get(Room, room_id)
    timeout_secs = room.thinking_timeout_secs if room else 60

    r = _redis()
    try:
        if payload.state == "THINKING":
            await mark_timed_out(r, str(room_id), payload.round, timeout_secs)
        await set_agent_state(r, str(room_id), payload.round, payload.agent_id, payload.state)
    finally:
        await r.aclose()

    # Broadcast to all frontend connections in this room
    from app.routers.websocket import manager as ws_manager
    await ws_manager.broadcast(str(room_id), {
        "type": "agent_state_change",
        "data": {
            "agent_id": payload.agent_id,
            "state": payload.state,
            "round": payload.round,
        },
    })

    return {"ok": True}


# --- Polls ---

class PollCreate(BaseModel):
    proposed_by: str  # agent UUID string or "human"
    proposed_by_type: str  # "agent" | "human"
    question: str
    options: list[str]
    deadline_secs: int = 120
    scope: str = "ALL"
    action_type: str | None = None
    action_params: dict | None = None
    signature: str | None = None  # required for agent proposals; omit for human (server signs)


class PollVotePayload(BaseModel):
    voter_id: str
    voter_type: str  # "agent" | "human"
    option_index: int


class PollVetoPayload(BaseModel):
    requester_id: str


def _system_agent_id(room: Room) -> uuid.UUID:
    """Return agent_a as the system signer for POLL_EVENT messages."""
    return room.agent_a_id


async def _insert_poll_event(
    db: AsyncSession,
    room: Room,
    event_name: str,
    poll_data: dict,
) -> None:
    """Insert an immutable POLL_EVENT system message into the session log."""
    from app.services.identity import sign_message as _sign
    content = f"[POLL_EVENT:{event_name}] {poll_data['question']}"
    canonical = content
    sig = _sign(settings.server_signing_key, canonical)
    msg = Message(
        room_id=room.room_id,
        sender_agent_id=_system_agent_id(room),
        content_natural=content,
        content_structured={"event": event_name, "poll": poll_data},
        signature=sig,
        message_type=MessageType.POLL_EVENT,
    )
    db.add(msg)
    await db.flush()


@router.post("/{room_id}/polls", status_code=status.HTTP_201_CREATED)
async def create_room_poll(
    room_id: uuid.UUID,
    payload: PollCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Create a new poll in the session. Agent polls require a valid ed25519 signature."""
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    if not room.session_graph:
        raise HTTPException(status_code=400, detail="Session graph not set for this room.")

    scope = PollScope(payload.scope)
    action_type = PollActionType(payload.action_type) if payload.action_type else None

    # For human proposals the server generates the signature
    if payload.proposed_by_type == "human":
        poll_id_tmp = uuid.uuid4()
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        sig = sign_poll_server(
            str(poll_id_tmp), str(room_id), payload.proposed_by,
            payload.question, payload.options, now_iso,
        )
        # We pass the pre-generated sig; create_poll will skip re-verification for humans
        final_sig = sig
    else:
        if not payload.signature:
            raise HTTPException(status_code=400, detail="Agent proposals require a signature.")
        final_sig = payload.signature

    try:
        poll = await create_poll(
            db=db,
            room_id=room_id,
            proposed_by=payload.proposed_by,
            proposed_by_type=payload.proposed_by_type,
            question=payload.question,
            options=payload.options,
            deadline_secs=payload.deadline_secs,
            scope=scope,
            action_type=action_type,
            action_params=payload.action_params,
            session_graph=room.session_graph,
            signature=final_sig,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    poll_data = serialize_poll(poll)

    await _insert_poll_event(db, room, "poll_created", poll_data)
    await db.commit()

    from app.routers.websocket import manager as ws_manager
    await ws_manager.broadcast(str(room_id), {"type": "poll_created", "data": poll_data})

    return poll_data


@router.post("/{room_id}/polls/{poll_id}/vote")
async def vote_on_poll(
    room_id: uuid.UUID,
    poll_id: uuid.UUID,
    payload: PollVotePayload,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Cast a vote on an open poll. Weight is computed server-side."""
    room = await db.get(Room, room_id)
    if not room or not room.session_graph:
        raise HTTPException(status_code=404, detail="Room not found or session graph missing.")

    poll = await db.get(Poll, poll_id)
    if not poll or str(poll.room_id) != str(room_id):
        raise HTTPException(status_code=404, detail="Poll not found.")

    try:
        poll, quorum_reached = await cast_vote(
            db=db,
            poll=poll,
            voter_id=payload.voter_id,
            voter_type=payload.voter_type,
            option_index=payload.option_index,
            session_graph=room.session_graph,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    from app.routers.websocket import manager as ws_manager

    if quorum_reached:
        poll = await close_poll(db, poll)
        action_spec = apply_result(poll)
        poll_data = serialize_poll(poll)
        if action_spec:
            poll_data["action_spec"] = action_spec
        await _insert_poll_event(db, room, "poll_closed", poll_data)
        await db.commit()
        await ws_manager.broadcast(str(room_id), {"type": "poll_closed", "data": poll_data})
    else:
        poll_data = serialize_poll(poll)
        await db.commit()
        await ws_manager.broadcast(str(room_id), {"type": "poll_updated", "data": poll_data})

    return poll_data


@router.get("/{room_id}/polls")
async def list_room_polls(
    room_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Return all polls for this room, most recent first."""
    from sqlalchemy import desc
    result = await db.execute(
        select(Poll).where(Poll.room_id == room_id).order_by(desc(Poll.created_at))
    )
    polls = result.scalars().all()
    return {"polls": [serialize_poll(p) for p in polls]}


@router.post("/{room_id}/polls/{poll_id}/veto")
async def veto_room_poll(
    room_id: uuid.UUID,
    poll_id: uuid.UUID,
    payload: PollVetoPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Requester veto — overrides any poll result immediately."""
    room = await db.get(Room, room_id)
    if not room or not room.session_graph:
        raise HTTPException(status_code=404, detail="Room not found or session graph missing.")

    # Verify requester_id has Requester role in session graph
    agents: list[dict] = room.session_graph.get("agents", [])
    is_requester = any(
        str(a.get("id", "")) == payload.requester_id
        and a.get("role", "").lower() == "requester"
        for a in agents
    )
    # Also allow human node with no explicit role restriction
    is_human_requester = payload.requester_id == "human"
    if not is_requester and not is_human_requester:
        raise HTTPException(status_code=403, detail="Only the Requester can veto a poll.")

    poll = await db.get(Poll, poll_id)
    if not poll or str(poll.room_id) != str(room_id):
        raise HTTPException(status_code=404, detail="Poll not found.")
    from app.models.room import PollStatus as _PollStatus
    if poll.status != _PollStatus.OPEN:
        raise HTTPException(status_code=400, detail="Only open polls can be vetoed.")

    poll = await veto_poll(db, poll)
    poll_data = serialize_poll(poll)

    await _insert_poll_event(db, room, "poll_vetoed", poll_data)
    await db.commit()

    from app.routers.websocket import manager as ws_manager
    await ws_manager.broadcast(str(room_id), {"type": "poll_vetoed", "data": poll_data})

    return poll_data


# --- Coordinator ---

class CoordinatorPlanUpdate(BaseModel):
    assignments: list[dict]
    summary: str


class CoordinatorGenerateRequest(BaseModel):
    agent_ids: list[str] | None = None
    coordinator_id: str | None = None


@router.post("/{room_id}/coordinator/generate")
async def generate_coordinator_plan_endpoint(
    room_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    payload: CoordinatorGenerateRequest = CoordinatorGenerateRequest(),
) -> dict:
    """Generate a scoped coordinator plan and merge it into room.coordinator_plan.

    When agent_ids is provided, only those agents are assigned.  Existing
    assignments for other agents are preserved so multiple coordinators can
    each call this endpoint without overwriting each other's work.
    """
    from app.services.coordinator_service import generate_coordinator_plan
    try:
        new_plan = await generate_coordinator_plan(db, room_id, agent_ids=payload.agent_ids)
    except ValueError as exc:
        log.error("coordinator/generate bad request room=%s: %s", room_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        log.error("coordinator/generate failed room=%s: %s", room_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Coordinator plan generation failed: {exc}")

    # Merge into existing plan without overwriting existing assignments.
    room = await db.get(Room, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found.")

    existing = room.coordinator_plan or {"assignments": [], "summary": ""}
    existing_ids = {a["agent_id"] for a in existing.get("assignments", [])}

    merged_assignments = list(existing.get("assignments", []))
    for a in new_plan.get("assignments", []):
        if a["agent_id"] not in existing_ids:
            merged_assignments.append(a)

    # Build a combined summary
    existing_summary = existing.get("summary", "")
    new_summary = new_plan.get("summary", "")
    if existing_summary and new_summary and existing_summary != new_summary:
        combined_summary = f"{existing_summary}\n\n{new_summary}"
    else:
        combined_summary = new_summary or existing_summary

    merged_plan = {"assignments": merged_assignments, "summary": combined_summary}
    if payload.coordinator_id:
        # Tag which coordinator produced this batch so the frontend can tab by coordinator
        merged_plan.setdefault("coordinator_plans", {})[payload.coordinator_id] = {
            "assignments": new_plan.get("assignments", []),
            "summary": new_summary,
        }
        # Carry forward any existing per-coordinator plans
        for cid, cp in existing.get("coordinator_plans", {}).items():
            if cid != payload.coordinator_id:
                merged_plan["coordinator_plans"][cid] = cp

    room.coordinator_plan = merged_plan
    flag_modified(room, "coordinator_plan")
    await db.flush()
    await db.commit()
    return merged_plan


@router.put("/{room_id}/coordinator/plan")
async def update_coordinator_plan(
    room_id: uuid.UUID,
    payload: CoordinatorPlanUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Persist a (possibly human-edited) coordinator plan and insert it as an immutable SYSTEM message."""
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    plan = {"assignments": payload.assignments, "summary": payload.summary}
    room.coordinator_plan = plan
    flag_modified(room, "coordinator_plan")
    await db.flush()

    # Insert immutable signed SYSTEM message into the chat log
    lines = ["**Coordinator Plan**", ""]
    for a in payload.assignments:
        agent_name = a.get("agent_name", a.get("agent_id", "?"))
        subtask = a.get("subtask", "—")
        lines.append(f"• **{agent_name}** → {subtask}")
    if payload.summary:
        lines = [f"*{payload.summary}*", ""] + lines
    content = "\n".join(lines)
    sig = sign_message(settings.server_signing_key, content)
    msg = Message(
        room_id=room_id,
        sender_agent_id=_system_agent_id(room),
        content_natural=content,
        content_structured={"type": "coordinator_plan", "coordinator_plan": plan},
        signature=sig,
        message_type=MessageType.SYSTEM,
    )
    db.add(msg)
    await db.flush()
    await db.commit()

    # Broadcast via WebSocket to all connected frontend clients
    try:
        from app.routers.websocket import manager as ws_manager
        await ws_manager.broadcast(str(room_id), {
            "type": "message",
            "data": {
                "id": str(msg.message_id),
                "agentId": str(msg.sender_agent_id),
                "agentName": "Coordinator",
                "agentOrg": "AgentLink",
                "role": "Coordinator",
                "type": "SYSTEM",
                "content": msg.content_natural,
                "sigValid": True,
                "ts": msg.timestamp.isoformat() if msg.timestamp else None,
                "contentStructured": msg.content_structured,
            },
        })
    except Exception:
        pass

    return plan


# --- GitHub Repo Active Input ---

class RepoInitPayload(BaseModel):
    strategy: str = "branch"  # "branch" | "main"


class RepoCommitPayload(BaseModel):
    file_path: str
    content: str
    commit_message: str
    agent_id: str


@router.post("/{room_id}/repo/init")
async def init_repo(
    room_id: uuid.UUID,
    payload: RepoInitPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Initialize repo access for a session: create branch (or use main), fetch tree."""
    from app.services.github_repo import (
        create_session_branch,
        get_repo_tree,
    )
    from datetime import timezone

    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    if not room.github_repo_url:
        raise HTTPException(status_code=400, detail="No GitHub repo URL set for this room.")
    if not current_user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected.")

    strategy = payload.strategy if payload.strategy in ("branch", "main") else "branch"

    try:
        tree_data = await get_repo_tree(current_user.github_access_token, room.github_repo_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub tree fetch failed: {exc}")

    if strategy == "branch":
        try:
            branch = await create_session_branch(
                current_user.github_access_token, room.github_repo_url, str(room_id)
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Branch creation failed: {exc}")
    else:
        branch = tree_data["default_branch"]

    now_iso = datetime.now(timezone.utc).isoformat()
    room.repo_branch = branch
    room.repo_branch_strategy = strategy
    room.repo_tree = {
        "items": tree_data["items"],
        "truncated": tree_data["truncated"],
        "fetched_at": now_iso,
    }

    repo_path = room.github_repo_url.rstrip("/").replace("https://github.com/", "").removesuffix(".git")
    if strategy == "branch":
        branch_url = f"https://github.com/{repo_path}/tree/{branch}"
    else:
        branch_url = f"https://github.com/{repo_path}"

    # Log immutable SYSTEM message
    event_text = (
        f"[REPO_INIT] GitHub repository linked.\n"
        f"Repo: {room.github_repo_url}\n"
        f"Branch: {branch}\n"
        f"Strategy: {strategy}\n"
        f"Files indexed: {len(tree_data['items'])}"
        f"{' (truncated)' if tree_data['truncated'] else ''}"
    )
    sig = sign_message(settings.server_signing_key, event_text)
    sys_msg = Message(
        room_id=room_id,
        sender_agent_id=_system_agent_id(room),
        content_natural=event_text,
        content_structured={"type": "repo_init", "branch": branch, "strategy": strategy, "branch_url": branch_url},
        signature=sig,
        message_type=MessageType.SYSTEM,
    )
    db.add(sys_msg)
    await db.flush()
    await db.commit()

    try:
        from app.routers.websocket import manager as ws_manager
        await ws_manager.broadcast(str(room_id), {
            "type": "message",
            "data": {
                "id": str(sys_msg.message_id),
                "agentId": str(sys_msg.sender_agent_id),
                "agentName": "AgentLink",
                "agentOrg": "Protocol",
                "role": "Observer",
                "type": "SYSTEM",
                "content": event_text,
                "sigValid": True,
                "ts": sys_msg.timestamp.isoformat() if sys_msg.timestamp else None,
                "contentStructured": sys_msg.content_structured,
            },
        })
    except Exception:
        pass

    return {
        "branch": branch,
        "branch_url": branch_url,
        "strategy": strategy,
        "tree_items": tree_data["items"],
        "truncated": tree_data["truncated"],
    }


@router.get("/{room_id}/repo/tree")
async def get_repo_tree_endpoint(
    room_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Return the cached repo tree for this room."""
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    if not room.repo_tree:
        return {"branch": room.repo_branch, "items": [], "truncated": False}
    return {
        "branch": room.repo_branch,
        "strategy": room.repo_branch_strategy,
        "items": room.repo_tree.get("items", []),
        "truncated": room.repo_tree.get("truncated", False),
        "fetched_at": room.repo_tree.get("fetched_at"),
    }


@router.get("/{room_id}/repo/file")
async def get_repo_file(
    room_id: uuid.UUID,
    path: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Fetch content of a specific file from the session repo branch."""
    from app.services.github_repo import get_file_content

    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    if not room.github_repo_url or not room.repo_branch:
        raise HTTPException(status_code=400, detail="Repo not initialized for this session.")
    if not current_user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected.")

    try:
        content = await get_file_content(
            current_user.github_access_token, room.github_repo_url, path, room.repo_branch
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"File fetch failed: {exc}")

    return {"path": path, "content": content, "branch": room.repo_branch}


@router.post("/{room_id}/repo/commit")
async def commit_to_repo(
    room_id: uuid.UUID,
    payload: RepoCommitPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Commit a file to the session branch. Logs immutable SYSTEM message and broadcasts WS event."""
    from app.services.github_repo import commit_file

    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    if not room.github_repo_url or not room.repo_branch:
        raise HTTPException(status_code=400, detail="Repo not initialized for this session.")
    if not current_user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected.")

    # Resolve agent name/role from session graph
    agent_name = "Agent"
    agent_role = "Contributor"
    if room.session_graph:
        agents: list[dict] = room.session_graph.get("agents", [])
        agent_node = next((a for a in agents if str(a.get("id", "")) == payload.agent_id), None)
        if agent_node:
            agent_name = agent_node.get("name", "Agent")
            agent_role = agent_node.get("role", "Contributor")

    try:
        commit_sha = await commit_file(
            github_token_encrypted=current_user.github_access_token,
            repo_url=room.github_repo_url,
            branch=room.repo_branch,
            file_path=payload.file_path,
            content=payload.content,
            agent_name=agent_name,
            agent_role=agent_role,
            message=payload.commit_message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Commit failed: {exc}")

    repo_path = room.github_repo_url.rstrip("/").replace("https://github.com/", "").removesuffix(".git")
    commit_url = f"https://github.com/{repo_path}/commit/{commit_sha}" if commit_sha else ""

    event_text = (
        f"[REPO_COMMIT] {agent_name} ({agent_role}) committed {payload.file_path}\n"
        f"Message: {payload.commit_message}\n"
        f"SHA: {commit_sha[:7] if commit_sha else 'unknown'}"
    )
    sig = sign_message(settings.server_signing_key, event_text)
    sys_msg = Message(
        room_id=room_id,
        sender_agent_id=_system_agent_id(room),
        content_natural=event_text,
        content_structured={
            "type": "repo_commit",
            "agent_name": agent_name,
            "agent_role": agent_role,
            "file_path": payload.file_path,
            "commit_message": payload.commit_message,
            "commit_sha": commit_sha,
            "commit_url": commit_url,
            "branch": room.repo_branch,
        },
        signature=sig,
        message_type=MessageType.SYSTEM,
    )
    db.add(sys_msg)
    await db.flush()
    await db.commit()

    commit_data = {
        "agent_name": agent_name,
        "agent_role": agent_role,
        "file_path": payload.file_path,
        "commit_message": payload.commit_message,
        "commit_sha": commit_sha,
        "commit_url": commit_url,
        "branch": room.repo_branch,
        "message_id": str(sys_msg.message_id),
        "ts": sys_msg.timestamp.isoformat() if sys_msg.timestamp else None,
    }

    try:
        from app.routers.websocket import manager as ws_manager
        await ws_manager.broadcast(str(room_id), {"type": "repo_commit", "data": commit_data})
        # Also broadcast the SYSTEM message into the chat
        await ws_manager.broadcast(str(room_id), {
            "type": "message",
            "data": {
                "id": str(sys_msg.message_id),
                "agentId": str(sys_msg.sender_agent_id),
                "agentName": agent_name,
                "agentOrg": agent_role,
                "role": "Observer",
                "type": "SYSTEM",
                "content": event_text,
                "sigValid": True,
                "ts": sys_msg.timestamp.isoformat() if sys_msg.timestamp else None,
                "contentStructured": sys_msg.content_structured,
            },
        })
    except Exception:
        pass

    return {"commit_sha": commit_sha, "branch": room.repo_branch, "file_path": payload.file_path, "commit_url": commit_url}


@router.post("/{room_id}/repo/merge")
async def merge_repo_branch(
    room_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Merge the session branch into main. Requires room to be CLOSED+SUCCESS."""
    from app.services.github_repo import merge_branch_to_main

    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    if not room.github_repo_url or not room.repo_branch:
        raise HTTPException(status_code=400, detail="Repo not initialized for this session.")
    if room.repo_branch_strategy != "branch":
        raise HTTPException(status_code=400, detail="Session is not using a separate branch.")
    if not current_user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub account not connected.")
    if not (room.status == RoomStatus.CLOSED and room.outcome == RoomOutcome.SUCCESS):
        raise HTTPException(status_code=400, detail="Room must be CLOSED with SUCCESS outcome to merge.")

    try:
        merge_sha = await merge_branch_to_main(
            current_user.github_access_token, room.github_repo_url, room.repo_branch
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Merge failed: {exc}")

    event_text = (
        f"[REPO_MERGE] Session branch merged to main.\n"
        f"Branch: {room.repo_branch}\n"
        f"SHA: {merge_sha[:7] if merge_sha else 'up-to-date'}"
    )
    sig = sign_message(settings.server_signing_key, event_text)
    sys_msg = Message(
        room_id=room_id,
        sender_agent_id=_system_agent_id(room),
        content_natural=event_text,
        content_structured={"type": "repo_merge", "branch": room.repo_branch, "merge_sha": merge_sha},
        signature=sig,
        message_type=MessageType.SYSTEM,
    )
    db.add(sys_msg)
    await db.flush()
    await db.commit()

    repo_path = room.github_repo_url.rstrip("/").replace("https://github.com/", "").removesuffix(".git")
    return {
        "merge_sha": merge_sha,
        "branch": room.repo_branch,
        "main_url": f"https://github.com/{repo_path}",
    }


class RoomPatch(BaseModel):
    github_repo_url: str


@router.patch("/{room_id}")
async def patch_room(
    room_id: uuid.UUID,
    payload: RoomPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Update mutable room fields. Currently supports github_repo_url."""
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    room.github_repo_url = payload.github_repo_url
    await db.flush()
    await db.commit()
    return {"ok": True}


# --- WebSocket ---

@router.websocket("/{room_id}/ws/{agent_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: uuid.UUID,
    agent_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Endpoint WebSocket para comunicación en tiempo real dentro de una sala."""
    if room_manager.is_room_full(room_id):
        await websocket.close(code=4003, reason="Sala llena.")
        return

    await room_manager.connect(websocket, room_id, agent_id)
    try:
        while True:
            data = await websocket.receive_json()
            # Retransmitir al otro agente de la sala
            await room_manager.broadcast_to_room(room_id, agent_id, data)
    except WebSocketDisconnect:
        room_manager.disconnect(room_id, agent_id)
