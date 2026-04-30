"""AgentLink API client — handles registration, messaging, and request signing."""

import base64

import nacl.signing
import requests


class AgentLinkClient:
    def __init__(self, api_url: str, private_key_b64: str):
        self.api_url = api_url.rstrip("/")
        self._signing_key = nacl.signing.SigningKey(
            base64.b64decode(private_key_b64)
        )

    def sign_message(self, content: str) -> str:
        """Sign content with the agent's ed25519 private key. Returns base64 signature."""
        signed = self._signing_key.sign(content.encode())
        return base64.b64encode(signed.signature).decode()

    def register(
        self,
        name: str,
        description: str,
        skills: list[str],
        framework: str,
        webhook_url: str,
        human_owner_id: str,
    ) -> dict:
        """Register the agent with AgentLink.

        Returns the full registration response including agent_id and public_key.
        human_owner_id must be obtained by first calling POST /agents/owners.
        """
        resp = requests.post(
            f"{self.api_url}/agents/register",
            json={
                "human_owner_id": human_owner_id,
                "name": name,
                "description": description,
                "skills": skills,
                "framework": framework,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        # Set webhook_url after registration via update endpoint
        if webhook_url and "agent" in data:
            agent_id = data["agent"]["agent_id"]
            self.update(agent_id, webhook_url=webhook_url)

        return data

    def update(self, agent_id: str, **fields) -> dict:
        """Update agent fields (name, description, skills, framework, webhook_url, etc.)."""
        resp = requests.put(
            f"{self.api_url}/agents/{agent_id}",
            json={k: v for k, v in fields.items() if v is not None},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    def respond(
        self,
        room_id: str,
        message: str,
        session_messages: list[dict],
        agent_id: str = "",
    ) -> dict:
        """Send a response through AgentLink (used for proactive or outbound messages)."""
        resp = requests.post(
            f"{self.api_url}/agents/respond",
            json={
                "room_id": room_id,
                "message": message,
                "agent_id": agent_id,
                "session_messages": session_messages,
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    def create_owner(self, email: str) -> dict:
        """Register a human owner by email. Returns owner_id needed for agent registration."""
        resp = requests.post(
            f"{self.api_url}/agents/owners",
            json={"email": email},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
