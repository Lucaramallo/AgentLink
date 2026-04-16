"""Router de Agentes — registro, consulta y gestión de identidades — Módulo 1."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.agent import Agent, HumanOwner
from app.services.identity import generate_keypair

router = APIRouter(prefix="/agents", tags=["agents"])


# --- Schemas Pydantic ---

class HumanOwnerCreate(BaseModel):
    email: EmailStr


class AgentCreate(BaseModel):
    human_owner_id: uuid.UUID
    name: str
    description: str
    skills: list[str]
    framework: str


class AgentPublicResponse(BaseModel):
    agent_id: uuid.UUID
    name: str
    description: str
    skills: list[str]
    framework: str
    public_key: str
    reputation_technical: float | None
    reputation_relational: float | None
    total_jobs_completed: int
    total_jobs_disputed: int
    is_active: bool

    model_config = {"from_attributes": True}


class AgentRegisterResponse(BaseModel):
    """Respuesta de registro — incluye private_key que se entrega UNA SOLA VEZ."""
    agent: AgentPublicResponse
    private_key_b64: str  # ¡Guardar de inmediato! No se puede recuperar.


# --- Endpoints ---

@router.post("/owners", status_code=status.HTTP_201_CREATED)
async def create_owner(
    payload: HumanOwnerCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Registra un nuevo dueño humano."""
    result = await db.execute(
        select(HumanOwner).where(HumanOwner.email == payload.email)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email ya registrado.")

    owner = HumanOwner(email=payload.email)
    db.add(owner)
    await db.flush()
    return {"owner_id": str(owner.owner_id), "email": owner.email}


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=AgentRegisterResponse)
async def register_agent(
    payload: AgentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AgentRegisterResponse:
    """Registra un nuevo agente y emite su keypair.

    La private_key se retorna UNA SOLA VEZ. No se almacena en el sistema.
    El dueño debe guardarla de inmediato para configurar su agente.
    """
    # Verificar que el owner existe
    owner = await db.get(HumanOwner, payload.human_owner_id)
    if not owner:
        raise HTTPException(status_code=404, detail="HumanOwner no encontrado.")

    keypair = generate_keypair()

    agent = Agent(
        human_owner_id=payload.human_owner_id,
        name=payload.name,
        description=payload.description,
        skills=payload.skills,
        framework=payload.framework,
        public_key=keypair.public_key_b64,
    )
    db.add(agent)
    await db.flush()

    return AgentRegisterResponse(
        agent=AgentPublicResponse.model_validate(agent),
        private_key_b64=keypair.private_key_b64,
    )


@router.get("/{agent_id}", response_model=AgentPublicResponse)
async def get_agent(
    agent_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AgentPublicResponse:
    """Obtiene el perfil público de un agente."""
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente no encontrado.")
    return AgentPublicResponse.model_validate(agent)
