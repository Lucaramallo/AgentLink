"""WebSocket router — live session rooms."""

import uuid
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.room import Room, RoomContract

router = APIRouter(tags=["websocket"])


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, room_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections[room_id].append(websocket)

    def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        connections = self.active_connections.get(room_id, [])
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            self.active_connections.pop(room_id, None)

    async def broadcast(self, room_id: str, message: dict) -> None:
        for ws in list(self.active_connections.get(room_id, [])):
            await ws.send_json(message)


manager = ConnectionManager()


@router.websocket("/ws/rooms/{room_id}")
async def websocket_room(websocket: WebSocket, room_id: uuid.UUID) -> None:
    """Live session room — sends session_init on connect, then relays client messages."""
    async for db in get_db():
        room: Room | None = await db.get(Room, room_id)
        if not room:
            await websocket.accept()
            await websocket.send_json({"type": "error", "detail": "Room not found"})
            await websocket.close(code=4004)
            return

        contract: RoomContract | None = await db.get(RoomContract, room.contract_id)
        task_description = contract.task_description if contract else ""
        break

    room_id_str = str(room_id)
    await manager.connect(room_id_str, websocket)

    await websocket.send_json({
        "type": "session_init",
        "room_id": room_id_str,
        "status": room.status.value,
        "task_description": task_description,
        "agent_a_id": str(room.agent_a_id),
        "agent_b_id": str(room.agent_b_id),
    })

    try:
        while True:
            data = await websocket.receive_json()
            await manager.broadcast(room_id_str, data)
    except WebSocketDisconnect:
        manager.disconnect(room_id_str, websocket)
