"""Router for team template CRUD — save/load canvas configurations."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.team_template import TeamTemplate
from app.models.user import User

router = APIRouter(prefix="/team-templates", tags=["team-templates"])


# ── Schemas ────────────────────────────────────────────────────────────────

class TeamTemplateCreate(BaseModel):
    name: str
    description: str | None = None
    agents: list[dict]
    edges: list[dict]
    clusters: list[dict]


class TeamTemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    agents: list[dict]
    edges: list[dict]
    clusters: list[dict]
    created_at: str

    @classmethod
    def from_orm(cls, t: TeamTemplate) -> "TeamTemplateOut":
        return cls(
            id=t.id,
            name=t.name,
            description=t.description,
            agents=t.agents or [],
            edges=t.edges or [],
            clusters=t.clusters or [],
            created_at=t.created_at.isoformat(),
        )


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.post("", response_model=TeamTemplateOut)
async def create_template(
    payload: TeamTemplateCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TeamTemplateOut:
    """Save the current canvas state as a reusable team template."""
    template = TeamTemplate(
        id=uuid.uuid4(),
        user_id=current_user.id,
        name=payload.name.strip(),
        description=payload.description,
        agents=payload.agents,
        edges=payload.edges,
        clusters=payload.clusters,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return TeamTemplateOut.from_orm(template)


@router.get("", response_model=list[TeamTemplateOut])
async def list_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[TeamTemplateOut]:
    """Return all templates belonging to the authenticated user."""
    result = await db.execute(
        select(TeamTemplate)
        .where(TeamTemplate.user_id == current_user.id)
        .order_by(TeamTemplate.created_at.desc())
    )
    return [TeamTemplateOut.from_orm(t) for t in result.scalars().all()]


@router.get("/{template_id}", response_model=TeamTemplateOut)
async def get_template(
    template_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TeamTemplateOut:
    """Fetch a single template by ID (must be owned by current user)."""
    template = await db.get(TeamTemplate, template_id)
    if not template or template.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Template not found.")
    return TeamTemplateOut.from_orm(template)


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Delete a template owned by the current user."""
    template = await db.get(TeamTemplate, template_id)
    if not template or template.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Template not found.")
    await db.delete(template)
    await db.commit()
