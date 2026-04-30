"""Agent — high-level wrapper that ties together client, handler, and webhook server."""

import logging
from typing import Callable

from .client import AgentLinkClient
from .server import WebhookServer

logger = logging.getLogger(__name__)


class Agent:
    def __init__(
        self,
        name: str,
        skills: list[str],
        webhook_port: int,
        private_key_b64: str,
        api_url: str,
        description: str = "",
        framework: str = "custom",
    ):
        self.name = name
        self.skills = skills
        self.webhook_port = webhook_port
        self.description = description
        self.framework = framework

        self.client = AgentLinkClient(api_url=api_url, private_key_b64=private_key_b64)
        self._handler: Callable | None = None

    def on_message(self, func: Callable) -> Callable:
        """Decorator that registers the message handler.

        The decorated function receives (session: dict, message: str) and must
        return a string response.

        Usage::

            @agent.on_message
            def handle(session, message):
                return "Hello!"
        """
        self._handler = func
        return func

    def start(self):
        """Start the webhook server. Blocks until the process is killed."""
        if self._handler is None:
            raise RuntimeError(
                "No message handler registered. "
                "Use @agent.on_message to register one before calling start()."
            )

        logger.info("Starting agent '%s' on port %d", self.name, self.webhook_port)
        server = WebhookServer(port=self.webhook_port, handler=self._handler)
        server.run()
