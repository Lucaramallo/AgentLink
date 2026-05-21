"""Router de Agentes — registro, consulta y gestión de identidades — Módulo 1."""

import uuid
from typing import Annotated

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.agent import Agent, HumanOwner
from app.models.user import User, UserRole
from app.services.identity import generate_keypair
from app.services.webhook_caller import call_agent_webhook

_WHITELISTED_EMAILS: frozenset[str] = frozenset({"owner@agentlink.ai", "admin@agentlink.ai"})


def _is_user_whitelisted(user: User) -> bool:
    if user.email in _WHITELISTED_EMAILS:
        return True
    return user.role == UserRole.SUPERADMIN

_fernet = Fernet(settings.github_token_encryption_key.encode())


def _decrypt_token(encrypted: str) -> str:
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except (InvalidToken, Exception):
        return ""

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


class AgentProfileResponse(BaseModel):
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
    frozen: bool

    model_config = {"from_attributes": True}


class AgentUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    skills: list[str] | None = None
    framework: str | None = None
    session_fee: float | None = None
    cost_per_message: float | None = None
    github_repo_url: str | None = None
    webhook_url: str | None = None


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
        raise HTTPException(status_code=409, detail="Email already registered.")

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
        raise HTTPException(status_code=404, detail="HumanOwner not found.")

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


@router.get("", response_model=list[AgentProfileResponse])
async def list_agents(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[AgentProfileResponse]:
    """Returns the public profile of all registered agents."""
    result = await db.execute(select(Agent))
    agents = result.scalars().all()
    return [AgentProfileResponse.model_validate(a) for a in agents]


@router.get("/{agent_id}", response_model=AgentPublicResponse)
async def get_agent(
    agent_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AgentPublicResponse:
    """Obtiene el perfil público de un agente."""
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    return AgentPublicResponse.model_validate(agent)


class RegenerateKeyOut(BaseModel):
    agent_id: uuid.UUID
    private_key_b64: str


@router.post("/{agent_id}/regenerate-key", response_model=RegenerateKeyOut)
async def regenerate_agent_key(
    agent_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RegenerateKeyOut:
    """Generates a new ed25519 keypair for an agent.

    Invalidates the current key. Returns the new private key once only.
    """
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    if agent.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You do not have permission to modify this agent.")

    keypair = generate_keypair()
    agent.public_key = keypair.public_key_b64
    await db.flush()

    return RegenerateKeyOut(agent_id=agent_id, private_key_b64=keypair.private_key_b64)


@router.put("/{agent_id}", status_code=status.HTTP_200_OK)
async def update_agent(
    agent_id: uuid.UUID,
    payload: AgentUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Actualiza los campos editables de un agente propio."""
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    if agent.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You do not have permission to edit this agent.")

    if payload.name is not None:
        agent.name = payload.name
    if payload.description is not None:
        agent.description = payload.description
    if payload.skills is not None:
        agent.skills = payload.skills
    if payload.framework is not None:
        agent.framework = payload.framework
    if payload.session_fee is not None:
        agent.session_fee = payload.session_fee
    if payload.cost_per_message is not None:
        agent.cost_per_message = payload.cost_per_message
    if payload.github_repo_url is not None:
        agent.github_repo_url = payload.github_repo_url
    if payload.webhook_url is not None:
        agent.webhook_url = payload.webhook_url

    await db.flush()
    return {"agent_id": str(agent_id), "status": "updated"}


# ── Register Owned Agent ───────────────────────────────────────────────────

class RegisterOwnedAgentIn(BaseModel):
    name: str
    description: str
    skills: list[str]
    framework: str
    session_fee: float | None = None
    cost_per_message: float | None = None
    github_repo_url: str
    webhook_url: str | None = None


class RegisterOwnedAgentOut(BaseModel):
    agent_id: uuid.UUID
    name: str
    description: str
    skills: list[str]
    framework: str
    github_repo_url: str | None
    webhook_url: str | None
    session_fee: float | None
    cost_per_message: float | None
    public_key: str
    private_key_b64: str

    model_config = {"from_attributes": True}


@router.post("/register-owned", status_code=status.HTTP_201_CREATED, response_model=RegisterOwnedAgentOut)
async def register_owned_agent(
    payload: RegisterOwnedAgentIn,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RegisterOwnedAgentOut:
    """Registers a new agent owned by the authenticated user.

    Requires GitHub to be connected. Verifies github_repo_url belongs to the user.
    Returns the new agent including the private key (shown once only).
    """
    whitelisted = _is_user_whitelisted(current_user)

    # Non-whitelisted users must supply a webhook_url
    if not whitelisted and not payload.webhook_url:
        raise HTTPException(
            status_code=400,
            detail="Webhook URL is required. External agents must have a reachable webhook URL configured.",
        )

    if not current_user.github_access_token:
        raise HTTPException(
            status_code=400,
            detail="You must connect your GitHub account before registering agents.",
        )

    access_token = _decrypt_token(current_user.github_access_token)
    if not access_token:
        raise HTTPException(status_code=400, detail="Invalid GitHub token. Please reconnect your account.")

    # Verify repo belongs to user via GitHub API
    # github_repo_url looks like https://github.com/owner/repo
    repo_path = payload.github_repo_url.rstrip("/").replace("https://github.com/", "")
    async with httpx.AsyncClient() as client:
        repo_resp = await client.get(
            f"https://api.github.com/repos/{repo_path}",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
            timeout=15,
        )

    if repo_resp.status_code == 404:
        raise HTTPException(status_code=400, detail="Repository not found or access denied.")
    if repo_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Error verifying repository on GitHub.")

    repo_data = repo_resp.json()
    repo_owner = repo_data.get("owner", {}).get("login", "")
    if repo_owner.lower() != (current_user.github_username or "").lower():
        raise HTTPException(
            status_code=403,
            detail=f"Repository does not belong to you. Owner: {repo_owner}",
        )

    # Test webhook reachability before creating the agent (non-whitelisted only)
    if payload.webhook_url and not whitelisted:
        test_body = {
            "room_id": "test",
            "message": "AgentLink webhook test. Please respond.",
            "session_messages": [],
            "agent_id": "test",
            "agent_name": payload.name,
        }
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(payload.webhook_url, json=test_body, timeout=15.0)
                resp.raise_for_status()
        except Exception:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Your webhook must be reachable to register your agent. "
                    "Please ensure it's running and try again."
                ),
            )

    # Find or create HumanOwner for this user
    result = await db.execute(select(HumanOwner).where(HumanOwner.email == current_user.email))
    owner = result.scalar_one_or_none()
    if not owner:
        owner = HumanOwner(email=current_user.email, verified=current_user.is_verified)
        db.add(owner)
        await db.flush()

    keypair = generate_keypair()

    agent = Agent(
        human_owner_id=owner.owner_id,
        user_id=current_user.id,
        name=payload.name,
        description=payload.description,
        skills=payload.skills,
        framework=payload.framework,
        public_key=keypair.public_key_b64,
        session_fee=payload.session_fee,
        cost_per_message=payload.cost_per_message,
        github_repo_url=payload.github_repo_url,
        webhook_url=payload.webhook_url,
    )
    db.add(agent)
    await db.flush()
    await db.refresh(agent)

    return RegisterOwnedAgentOut(
        agent_id=agent.agent_id,
        name=agent.name,
        description=agent.description,
        skills=agent.skills,
        framework=agent.framework,
        github_repo_url=agent.github_repo_url,
        webhook_url=agent.webhook_url,
        session_fee=agent.session_fee,
        cost_per_message=agent.cost_per_message,
        public_key=agent.public_key,
        private_key_b64=keypair.private_key_b64,
    )


# ── Webhook test ───────────────────────────────────────────────────────────

@router.post("/{agent_id}/test-webhook", status_code=status.HTTP_200_OK)
async def test_agent_webhook(
    agent_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Sends a test message to the agent's webhook_url to verify it is reachable.

    Returns the agent's response on success, or an error dict on failure.
    """
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    if agent.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You do not have permission to test this agent.")
    if not agent.webhook_url:
        raise HTTPException(status_code=400, detail="This agent does not have a webhook_url configured.")

    result = await call_agent_webhook(
        agent=agent,
        message="AgentLink webhook test. Please respond.",
        session_messages=[],
        room_id="test",
        db=db,
    )
    return result


# ── Reset webhook failures ─────────────────────────────────────────────────

@router.post("/{agent_id}/reset-failures", status_code=status.HTTP_200_OK)
async def reset_webhook_failures(
    agent_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Resets webhook_failures_count to 0 and re-activates the agent if auto-paused.

    Only the agent's owner can call this. Use after fixing the webhook endpoint.
    """
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    if agent.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You do not have permission to modify this agent.")

    agent.webhook_failures_count = 0
    agent.last_webhook_failure = None
    # Un-pause only if the agent was not frozen
    if not agent.frozen:
        agent.is_active = True
    await db.flush()
    return {"agent_id": str(agent_id), "status": "reset", "is_active": agent.is_active}
