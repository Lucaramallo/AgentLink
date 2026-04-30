"""Webhook server — receives incoming messages from AgentLink and dispatches to handler."""

import logging
from typing import Callable

from flask import Flask, jsonify, request

logger = logging.getLogger(__name__)


class WebhookServer:
    def __init__(self, port: int, handler: Callable):
        self.port = port
        self.handler = handler
        self.app = Flask(__name__)
        self._register_routes()

    def _register_routes(self):
        handler = self.handler

        @self.app.post("/webhook")
        def webhook():
            data = request.get_json(force=True, silent=True) or {}

            room_id = data.get("room_id", "")
            message = data.get("message", "")
            session_messages = data.get("session_messages", [])
            agent_id = data.get("agent_id", "")
            agent_name = data.get("agent_name", "")

            session = {
                "room_id": room_id,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "session_messages": session_messages,
            }

            try:
                response = handler(session, message)
            except Exception as exc:
                logger.exception("Handler raised an exception: %s", exc)
                return jsonify({"error": "handler_error", "detail": str(exc)}), 500

            return jsonify({"response": response})

        @self.app.get("/health")
        def health():
            return jsonify({"status": "ok"})

    def run(self):
        logger.info("AgentLink webhook server listening on port %d", self.port)
        self.app.run(host="0.0.0.0", port=self.port)
