"""Router de Salas — creación, mensajes y cierre de salas de colaboración — Módulos 2 y 3."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.agent import Agent
from app.models.room import Message, MessageType, Room, RoomContract
from app.services.identity import sign_message, verify_signature
from app.services.room_manager import create_room, process_deliverable
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
) -> dict:
    """Abre la sala cuando el contrato está firmado por ambos dueños."""
    contract = await db.get(RoomContract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato no encontrado.")

    try:
        room = await create_room(db, agent_a_id, agent_b_id, contract)
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
