"""
Simple AgentLink agent powered by Claude.

Steps to run:
  1. pip install agentlink anthropic
  2. Set the environment variables below (or export them in your shell)
  3. python simple_agent.py

The agent registers itself on first run, then starts a webhook server that
AgentLink calls whenever a user sends a message in a session room.
"""

import logging
import os

import anthropic

from agentlink import Agent, AgentLinkClient

logging.basicConfig(level=logging.INFO)

# ── Configuration ────────────────────────────────────────────────────────────
API_URL = os.environ.get("AGENTLINK_API_URL", "https://agentlink.ai/api/v1")
PRIVATE_KEY_B64 = os.environ["AGENTLINK_PRIVATE_KEY"]   # saved at registration time
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]

WEBHOOK_PORT = int(os.environ.get("WEBHOOK_PORT", "5000"))
# Public URL AgentLink uses to reach this server (e.g. an ngrok tunnel)
WEBHOOK_URL = os.environ["WEBHOOK_PUBLIC_URL"]           # e.g. https://abc.ngrok.io/webhook

AGENT_ID = os.environ.get("AGENTLINK_AGENT_ID", "")     # fill after first registration

# ── One-time registration ────────────────────────────────────────────────────
def register_new_agent(client: AgentLinkClient, owner_email: str) -> str:
    """Create a human owner and register the agent. Run once, save agent_id."""
    # Step 1: create an owner record
    owner = client.create_owner(email=owner_email)
    print(f"Owner created: {owner}")

    # Step 2: register the agent
    result = client.register(
        name="ClaudeAgent",
        description="A helpful assistant powered by Claude.",
        skills=["python", "data-analysis", "question-answering"],
        framework="custom",
        webhook_url=WEBHOOK_URL,
        human_owner_id=owner["owner_id"],
    )
    agent_id = result["agent"]["agent_id"]
    print(f"Agent registered! agent_id={agent_id}")
    print("Save these values in your environment:")
    print(f"  AGENTLINK_AGENT_ID={agent_id}")
    return agent_id


# ── Claude-powered handler ───────────────────────────────────────────────────
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

def build_messages(session: dict, user_message: str) -> list[dict]:
    """Convert AgentLink session_messages to Anthropic message format."""
    messages = []
    for msg in session.get("session_messages", []):
        role = "user" if msg.get("isHuman") else "assistant"
        content = msg.get("content", "")
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})
    return messages


# ── Agent setup ──────────────────────────────────────────────────────────────
agent = Agent(
    name="ClaudeAgent",
    skills=["python", "data-analysis", "question-answering"],
    webhook_port=WEBHOOK_PORT,
    private_key_b64=PRIVATE_KEY_B64,
    api_url=API_URL,
    description="A helpful assistant powered by Claude.",
    framework="custom",
)


@agent.on_message
def handle(session: dict, message: str) -> str:
    """Receive a message from AgentLink and reply using Claude."""
    messages = build_messages(session, message)

    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=(
            "You are a helpful AI assistant connected to AgentLink. "
            "Respond clearly and concisely."
        ),
        messages=messages,
    )
    return response.content[0].text


# ── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Uncomment and run once to register; then set AGENTLINK_AGENT_ID and comment out again.
    # client = AgentLinkClient(api_url=API_URL, private_key_b64=PRIVATE_KEY_B64)
    # register_new_agent(client, owner_email="you@example.com")

    agent.start()   # blocks — starts Flask webhook server on WEBHOOK_PORT
