"""Router de Admin — endpoints de gestión para usuarios y superadmins."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_superadmin, get_current_user
from app.models.agent import Agent, HumanOwner
from app.models.reputation import FeedbackRelational, FeedbackTechnical
from app.models.room import Room, RoomOutcome, RoomStatus
from app.models.user import User, UserRole

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Schemas ────────────────────────────────────────────────────────────────

class AgentAdminOut(BaseModel):
    agent_id: uuid.UUID
    name: str
    description: str
    framework: str
    skills: list[str]
    is_active: bool
    frozen: bool
    reputation_technical: float | None
    reputation_relational: float | None
    total_jobs_completed: int
    total_jobs_disputed: int
    human_owner_id: uuid.UUID
    user_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class UserAdminOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    nationality: str
    role: UserRole
    alc_balance: float
    is_verified: bool
    agent_count: int

    model_config = {"from_attributes": True}


class OwnerAdminOut(BaseModel):
    owner_id: uuid.UUID
    email: str
    verified: bool
    agent_count: int
    total_jobs: int

    model_config = {"from_attributes": True}


class SessionAdminOut(BaseModel):
    room_id: uuid.UUID
    status: str
    outcome: str | None
    agent_a_id: uuid.UUID
    agent_b_id: uuid.UUID
    created_at: str
    closed_at: str | None

    model_config = {"from_attributes": True}


class GlobalStatsOut(BaseModel):
    total_agents: int
    active_agents: int
    paused_agents: int
    frozen_agents: int
    total_sessions: int
    open_sessions: int
    closed_sessions: int
    disputed_sessions: int
    total_owners: int
    avg_tech_reputation: float | None
    avg_rel_reputation: float | None


class MyStatsOut(BaseModel):
    total_agents: int
    active_agents: int
    frozen_agents: int
    total_sessions: int
    alc_balance: float


class RankingOut(BaseModel):
    rank: int
    agent_id: uuid.UUID
    name: str
    owner_id: uuid.UUID
    reputation_technical: float | None
    reputation_relational: float | None
    total_jobs_completed: int
    peer_review_avg: float | None
    human_review_avg: float | None


# ── Helpers ────────────────────────────────────────────────────────────────

async def _peer_avg(db: AsyncSession, agent_id: uuid.UUID) -> float | None:
    result = await db.execute(
        select(func.avg(
            (FeedbackTechnical.spec_compliance + FeedbackTechnical.communication_clarity + FeedbackTechnical.delivery_speed) / 3
        )).where(FeedbackTechnical.reviewed_agent_id == agent_id)
    )
    val = result.scalar_one_or_none()
    return round(float(val), 2) if val is not None else None


async def _human_avg(db: AsyncSession, agent_id: uuid.UUID) -> float | None:
    result = await db.execute(
        select(func.avg(
            (FeedbackRelational.trust_level + FeedbackRelational.coordination_quality) / 2
        )).where(FeedbackRelational.reviewed_agent_id == agent_id)
    )
    val = result.scalar_one_or_none()
    return round(float(val), 2) if val is not None else None


def _session_out(r: Room) -> SessionAdminOut:
    return SessionAdminOut(
        room_id=r.room_id,
        status=r.status.value,
        outcome=r.outcome.value if r.outcome else None,
        agent_a_id=r.agent_a_id,
        agent_b_id=r.agent_b_id,
        created_at=r.created_at.isoformat(),
        closed_at=r.closed_at.isoformat() if r.closed_at else None,
    )


# ── User-scoped endpoints (requieren JWT) ──────────────────────────────────

_SORT_COLUMN_MAP = {
    "jobs": Agent.total_jobs_completed,
    "total_jobs_completed": Agent.total_jobs_completed,
    "tech_rep": Agent.reputation_technical,
    "rel_rep": Agent.reputation_relational,
    "alc_earned": Agent.total_jobs_completed,  # no dedicated field yet
}


@router.get("/my-agents", response_model=list[AgentAdminOut])
async def my_agents(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    sort_by: str = "jobs",
    sort_order: Literal["asc", "desc"] = "desc",
) -> list[AgentAdminOut]:
    """Lista los agentes del usuario autenticado con soporte de ordenamiento."""
    col = _SORT_COLUMN_MAP.get(sort_by, Agent.total_jobs_completed)
    order = col.asc() if sort_order == "asc" else col.desc()
    result = await db.execute(
        select(Agent).where(Agent.user_id == current_user.id).order_by(order)
    )
    agents = result.scalars().all()
    return [AgentAdminOut.model_validate(a) for a in agents]


@router.get("/my-sessions", response_model=list[SessionAdminOut])
async def my_sessions(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SessionAdminOut]:
    """Historial de sesiones de los agentes del usuario autenticado."""
    owned_agent_ids = (await db.execute(
        select(Agent.agent_id).where(Agent.user_id == current_user.id)
    )).scalars().all()

    if not owned_agent_ids:
        return []

    result = await db.execute(
        select(Room)
        .where(or_(Room.agent_a_id.in_(owned_agent_ids), Room.agent_b_id.in_(owned_agent_ids)))
        .order_by(Room.created_at.desc())
    )
    return [_session_out(r) for r in result.scalars().all()]


@router.get("/my-stats", response_model=MyStatsOut)
async def my_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MyStatsOut:
    """Dashboard stats para el usuario autenticado."""
    agents_result = await db.execute(
        select(Agent).where(Agent.user_id == current_user.id)
    )
    agents = agents_result.scalars().all()
    agent_ids = [a.agent_id for a in agents]

    total_sessions = 0
    if agent_ids:
        total_sessions = (await db.execute(
            select(func.count(Room.room_id)).where(
                or_(Room.agent_a_id.in_(agent_ids), Room.agent_b_id.in_(agent_ids))
            )
        )).scalar_one()

    return MyStatsOut(
        total_agents=len(agents),
        active_agents=sum(1 for a in agents if a.is_active and not a.frozen),
        frozen_agents=sum(1 for a in agents if a.frozen),
        total_sessions=total_sessions,
        alc_balance=current_user.alc_balance,
    )


# ── Superadmin endpoints ───────────────────────────────────────────────────

@router.get("/global-stats", response_model=GlobalStatsOut)
async def global_stats(
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> GlobalStatsOut:
    total_agents = (await db.execute(select(func.count(Agent.agent_id)))).scalar_one()
    active_agents = (await db.execute(
        select(func.count(Agent.agent_id)).where(Agent.is_active == True, Agent.frozen == False)
    )).scalar_one()
    paused_agents = (await db.execute(
        select(func.count(Agent.agent_id)).where(Agent.is_active == False, Agent.frozen == False)
    )).scalar_one()
    frozen_agents = (await db.execute(
        select(func.count(Agent.agent_id)).where(Agent.frozen == True)
    )).scalar_one()
    total_sessions = (await db.execute(select(func.count(Room.room_id)))).scalar_one()
    open_sessions = (await db.execute(
        select(func.count(Room.room_id)).where(Room.status == RoomStatus.OPEN)
    )).scalar_one()
    closed_sessions = (await db.execute(
        select(func.count(Room.room_id)).where(Room.outcome == RoomOutcome.SUCCESS)
    )).scalar_one()
    disputed_sessions = (await db.execute(
        select(func.count(Room.room_id)).where(Room.status == RoomStatus.DISPUTED)
    )).scalar_one()
    total_owners = (await db.execute(select(func.count(HumanOwner.owner_id)))).scalar_one()
    avg_tech = (await db.execute(select(func.avg(Agent.reputation_technical)))).scalar_one_or_none()
    avg_rel = (await db.execute(select(func.avg(Agent.reputation_relational)))).scalar_one_or_none()

    return GlobalStatsOut(
        total_agents=total_agents,
        active_agents=active_agents,
        paused_agents=paused_agents,
        frozen_agents=frozen_agents,
        total_sessions=total_sessions,
        open_sessions=open_sessions,
        closed_sessions=closed_sessions,
        disputed_sessions=disputed_sessions,
        total_owners=total_owners,
        avg_tech_reputation=round(float(avg_tech), 2) if avg_tech else None,
        avg_rel_reputation=round(float(avg_rel), 2) if avg_rel else None,
    )


@router.get("/all-agents", response_model=list[AgentAdminOut])
async def all_agents(
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    owner_id: uuid.UUID | None = None,
) -> list[AgentAdminOut]:
    """Lista todos los agentes (superadmin)."""
    q = select(Agent)
    if owner_id:
        q = q.where(Agent.human_owner_id == owner_id)
    result = await db.execute(q)
    return [AgentAdminOut.model_validate(a) for a in result.scalars().all()]


@router.get("/all-users", response_model=list[UserAdminOut])
async def all_users(
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[UserAdminOut]:
    """Lista todos los usuarios registrados (superadmin)."""
    result = await db.execute(select(User))
    users = result.scalars().all()
    out = []
    for user in users:
        agent_count = (await db.execute(
            select(func.count(Agent.agent_id)).where(Agent.user_id == user.id)
        )).scalar_one()
        out.append(UserAdminOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            nationality=user.nationality,
            role=user.role,
            alc_balance=user.alc_balance,
            is_verified=user.is_verified,
            agent_count=agent_count,
        ))
    return out


@router.get("/agents", response_model=list[AgentAdminOut])
async def list_agents(
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    owner_id: uuid.UUID | None = None,
) -> list[AgentAdminOut]:
    """Lista agentes con filtro opcional (superadmin)."""
    q = select(Agent)
    if owner_id:
        q = q.where(Agent.human_owner_id == owner_id)
    result = await db.execute(q)
    return [AgentAdminOut.model_validate(a) for a in result.scalars().all()]


@router.get("/sessions", response_model=list[SessionAdminOut])
async def list_sessions(
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
    owner_id: uuid.UUID | None = None,
) -> list[SessionAdminOut]:
    """Lista sesiones con filtro opcional (superadmin)."""
    q = select(Room).order_by(Room.created_at.desc())
    if owner_id:
        owned_agents = (await db.execute(
            select(Agent.agent_id).where(Agent.human_owner_id == owner_id)
        )).scalars().all()
        q = q.where(or_(Room.agent_a_id.in_(owned_agents), Room.agent_b_id.in_(owned_agents)))
    result = await db.execute(q)
    return [_session_out(r) for r in result.scalars().all()]


@router.get("/owners", response_model=list[OwnerAdminOut])
async def list_owners(
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[OwnerAdminOut]:
    """Lista HumanOwners legacy (superadmin)."""
    owners_result = await db.execute(select(HumanOwner))
    owners = owners_result.scalars().all()
    out = []
    for owner in owners:
        agents_result = await db.execute(
            select(Agent).where(Agent.human_owner_id == owner.owner_id)
        )
        agents = agents_result.scalars().all()
        total_jobs = sum(a.total_jobs_completed for a in agents)
        out.append(OwnerAdminOut(
            owner_id=owner.owner_id,
            email=owner.email,
            verified=owner.verified,
            agent_count=len(agents),
            total_jobs=total_jobs,
        ))
    return out


@router.get("/rankings", response_model=list[RankingOut])
async def rankings(
    _: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    sort_by: str = "default",
) -> list[RankingOut]:
    """Ranking global de agentes — accesible a todos los usuarios autenticados."""
    result = await db.execute(select(Agent))
    agents = result.scalars().all()

    rows = []
    for agent in agents:
        peer = await _peer_avg(db, agent.agent_id)
        human = await _human_avg(db, agent.agent_id)
        rows.append({"agent": agent, "peer": peer, "human": human})

    if sort_by == "human_rep":
        rows.sort(key=lambda r: r["human"] or 0, reverse=True)
    elif sort_by == "tech_rep":
        rows.sort(key=lambda r: r["agent"].reputation_technical or 0, reverse=True)
    elif sort_by == "peer_rep":
        rows.sort(key=lambda r: r["peer"] or 0, reverse=True)
    elif sort_by == "jobs":
        rows.sort(key=lambda r: r["agent"].total_jobs_completed, reverse=True)
    else:
        # Default: human review first, then tech rep, then jobs
        rows.sort(
            key=lambda r: (
                r["agent"].reputation_relational or 0,
                r["agent"].reputation_technical or 0,
                r["agent"].total_jobs_completed,
            ),
            reverse=True,
        )

    return [
        RankingOut(
            rank=i + 1,
            agent_id=r["agent"].agent_id,
            name=r["agent"].name,
            owner_id=r["agent"].human_owner_id,
            reputation_technical=r["agent"].reputation_technical,
            reputation_relational=r["agent"].reputation_relational,
            total_jobs_completed=r["agent"].total_jobs_completed,
            peer_review_avg=r["peer"],
            human_review_avg=r["human"],
        )
        for i, r in enumerate(rows)
    ]


@router.post("/cleanup-sessions", status_code=status.HTTP_200_OK)
async def cleanup_sessions(
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Cierra todas las sesiones OPEN con más de 24 horas de antigüedad."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    result = await db.execute(
        update(Room)
        .where(Room.status == RoomStatus.OPEN, Room.created_at < cutoff)
        .values(
            status=RoomStatus.CLOSED,
            outcome=RoomOutcome.TIMEOUT,
            closed_at=datetime.now(timezone.utc),
        )
        .returning(Room.room_id)
    )
    closed_ids = result.scalars().all()
    await db.flush()
    return {"closed_sessions": len(closed_ids), "room_ids": [str(rid) for rid in closed_ids]}


@router.post("/agents/{agent_id}/freeze", status_code=status.HTTP_200_OK)
async def freeze_agent(
    agent_id: uuid.UUID,
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    agent.frozen = True
    await db.flush()
    return {"agent_id": str(agent_id), "status": "frozen"}


@router.post("/agents/{agent_id}/unfreeze", status_code=status.HTTP_200_OK)
async def unfreeze_agent(
    agent_id: uuid.UUID,
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    agent.frozen = False
    await db.flush()
    return {"agent_id": str(agent_id), "status": "active"}


@router.post("/agents/{agent_id}/ban", status_code=status.HTTP_200_OK)
async def ban_agent(
    agent_id: uuid.UUID,
    _: Annotated[User, Depends(get_current_superadmin)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    agent.is_active = False
    agent.frozen = False
    await db.flush()
    return {"agent_id": str(agent_id), "status": "banned"}
