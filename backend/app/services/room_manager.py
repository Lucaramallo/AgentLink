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
    github_repo_url: str | None = None,
    requester_user_id: uuid.UUID | None = None,
) -> Room:
    """Crea una nueva sala de colaboración entre dos agentes.

    Deducts the combined session fees of agent_a and agent_b from the requester's
    ALC balance and holds them in escrow. Raises ValueError if the balance is
    insufficient or the contract is not yet fully signed.
    """
    if not (contract.owner_a_signed and contract.owner_b_signed):
        raise ValueError("El contrato debe estar firmado por ambos dueños antes de abrir la sala.")

    escrow = 0.0
    if requester_user_id is not None:
        from app.models.agent import Agent
        from app.models.user import User

        agent_a = await db.get(Agent, agent_a_id)
        agent_b = await db.get(Agent, agent_b_id)
        if agent_a and agent_a.session_fee:
            escrow += agent_a.session_fee
        if agent_b and agent_b.session_fee:
            escrow += agent_b.session_fee

        if escrow > 0:
            requester = await db.get(User, requester_user_id)
            if requester is None or requester.alc_balance < escrow:
                raise ValueError(
                    f"Insufficient ALC balance. Required: {escrow} ALC, "
                    f"available: {requester.alc_balance if requester else 0} ALC."
                )
            requester.alc_balance -= escrow
            db.add(requester)

    room = Room(
        agent_a_id=agent_a_id,
        agent_b_id=agent_b_id,
        contract_id=contract.contract_id,
        status=RoomStatus.OPEN,
        revision_count=0,
        github_repo_url=github_repo_url,
        requester_user_id=requester_user_id,
        escrowed_alc=escrow,
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

    On CONFORME: closes the room as SUCCESS and releases escrowed ALC to agent owners.
    On NO_CONFORME: increments revision count. If max revisions exceeded, moves to
    DISPUTED and refunds the full escrow to the requester.
    """
    if verdict == "CONFORME":
        room.status = RoomStatus.CLOSED
        room.outcome = RoomOutcome.SUCCESS
        room.closed_at = datetime.now(timezone.utc)
        if room.escrowed_alc > 0:
            await _release_escrow(db, room)
    else:
        room.revision_count += 1
        contract = await db.get(RoomContract, room.contract_id)
        if room.revision_count > contract.max_revision_rounds:
            room.status = RoomStatus.DISPUTED
            if room.escrowed_alc > 0:
                await _refund_escrow(db, room)
        else:
            room.status = RoomStatus.REVISION

    db.add(room)
    return room


async def refund_room_escrow(db: AsyncSession, room: Room) -> None:
    """Public helper: refund full escrow to the requester and zero it out."""
    if room.escrowed_alc > 0:
        await _refund_escrow(db, room)
        db.add(room)


async def _release_escrow(db: AsyncSession, room: Room) -> None:
    """Pay agent owners their session fees; refund any remainder to the requester."""
    from app.models.agent import Agent
    from app.models.user import User

    total = room.escrowed_alc
    paid_out = 0.0

    for agent_id in [room.agent_a_id, room.agent_b_id]:
        agent = await db.get(Agent, agent_id)
        if agent and agent.session_fee and agent.user_id:
            owner = await db.get(User, agent.user_id)
            if owner:
                fee = min(agent.session_fee, total - paid_out)
                if fee > 0:
                    owner.alc_balance += fee
                    paid_out += fee
                    db.add(owner)

    remainder = round(total - paid_out, 10)
    if remainder > 0 and room.requester_user_id:
        requester = await db.get(User, room.requester_user_id)
        if requester:
            requester.alc_balance += remainder
            db.add(requester)

    room.escrowed_alc = 0.0


async def _refund_escrow(db: AsyncSession, room: Room) -> None:
    """Return the full escrowed amount to the requester."""
    from app.models.user import User

    if room.requester_user_id:
        requester = await db.get(User, room.requester_user_id)
        if requester:
            requester.alc_balance += room.escrowed_alc
            db.add(requester)

    room.escrowed_alc = 0.0
