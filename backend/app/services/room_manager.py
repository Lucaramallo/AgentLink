"""Servicio de gestión de salas — lógica de negocio del ciclo de vida de una sala."""

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.room import Message, MessageType, Room, RoomContract, RoomOutcome, RoomStatus


async def create_room(
    db: AsyncSession,
    agent_a_id: uuid.UUID,
    agent_b_id: uuid.UUID,
    contract: RoomContract,
) -> Room:
    """Crea una nueva sala de colaboración entre dos agentes.

    Requiere que el contrato ya esté firmado por ambos dueños.

    Args:
        db: Sesión de base de datos.
        agent_a_id: ID del agente solicitante (quien emite la llave de salida).
        agent_b_id: ID del agente proveedor.
        contract: Contrato firmado por ambos dueños.

    Returns:
        La sala recién creada con estado OPEN.

    Raises:
        ValueError: Si el contrato no está firmado por ambas partes.
    """
    if not (contract.owner_a_signed and contract.owner_b_signed):
        raise ValueError("El contrato debe estar firmado por ambos dueños antes de abrir la sala.")

    room = Room(
        agent_a_id=agent_a_id,
        agent_b_id=agent_b_id,
        contract_id=contract.contract_id,
        status=RoomStatus.OPEN,
        revision_count=0,
    )
    db.add(room)
    await db.flush()
    return room


async def process_deliverable(
    db: AsyncSession,
    room: Room,
    verdict: str,
    reason: str,
) -> Room:
    """Procesa el veredicto del Agente A sobre el entregable de B.

    Args:
        db: Sesión de base de datos.
        room: Sala en estado OPEN o REVISION.
        verdict: "CONFORME" o "NO_CONFORME".
        reason: Explicación del veredicto.

    Returns:
        La sala con el estado actualizado.
    """
    if verdict == "CONFORME":
        room.status = RoomStatus.CLOSED
        room.outcome = RoomOutcome.SUCCESS
        room.closed_at = datetime.now(timezone.utc)
    else:
        room.revision_count += 1
        contract = await db.get(RoomContract, room.contract_id)
        if room.revision_count > contract.max_revision_rounds:
            room.status = RoomStatus.DISPUTED
        else:
            room.status = RoomStatus.REVISION

    db.add(room)
    return room
