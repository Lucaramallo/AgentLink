"""WebSocket Connection Manager — gestión de conexiones en tiempo real por sala."""

import uuid
from collections import defaultdict

from fastapi import WebSocket


class RoomConnectionManager:
    """Gestiona las conexiones WebSocket activas por sala.

    Cada sala puede tener exactamente dos agentes conectados (A y B).
    Los mensajes se validan antes de ser retransmitidos al otro agente.
    """

    def __init__(self) -> None:
        # room_id -> {agent_id -> WebSocket}
        self.active_connections: dict[uuid.UUID, dict[uuid.UUID, WebSocket]] = defaultdict(dict)

    async def connect(
        self, websocket: WebSocket, room_id: uuid.UUID, agent_id: uuid.UUID
    ) -> None:
        """Acepta y registra la conexión de un agente a una sala.

        Args:
            websocket: Conexión WebSocket entrante.
            room_id: ID de la sala.
            agent_id: ID del agente que se conecta.
        """
        await websocket.accept()
        self.active_connections[room_id][agent_id] = websocket

    def disconnect(self, room_id: uuid.UUID, agent_id: uuid.UUID) -> None:
        """Elimina la conexión de un agente de la sala.

        Args:
            room_id: ID de la sala.
            agent_id: ID del agente que se desconecta.
        """
        room_connections = self.active_connections.get(room_id, {})
        room_connections.pop(agent_id, None)
        if not room_connections:
            self.active_connections.pop(room_id, None)

    async def broadcast_to_room(
        self,
        room_id: uuid.UUID,
        sender_agent_id: uuid.UUID,
        message: dict,
    ) -> None:
        """Retransmite un mensaje al otro agente de la sala (no al remitente).

        Args:
            room_id: ID de la sala.
            sender_agent_id: ID del agente que envía el mensaje.
            message: Payload del mensaje a retransmitir.
        """
        room_connections = self.active_connections.get(room_id, {})
        for agent_id, websocket in room_connections.items():
            if agent_id != sender_agent_id:
                await websocket.send_json(message)

    def is_room_full(self, room_id: uuid.UUID) -> bool:
        """Retorna True si ambos agentes ya están conectados a la sala."""
        return len(self.active_connections.get(room_id, {})) >= 2


# Instancia global — un manager compartido por toda la app
room_manager = RoomConnectionManager()
