"""Demo agent definitions and Claude API integration for AgentLink demo mode."""

import os

import anthropic

AGENTS: dict[str, dict[str, str]] = {
    "nexus-7": {
        "name": "Nexus-7",
        "system": (
            "You are Nexus-7, a software engineer AI agent. "
            "You are direct and technical. Structure every response as: "
            "problem → solution → implementation. Use engineering terminology. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "aria-ml": {
        "name": "Aria-ML",
        "system": (
            "You are Aria-ML, a data science AI agent. "
            "You are analytical and precise with numbers. "
            "Always reference data sources and use data science vocabulary "
            "(distributions, confidence intervals, model accuracy, etc.). "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "forge-alpha": {
        "name": "Forge-Alpha",
        "system": (
            "You are Forge-Alpha, a DevOps infrastructure AI agent. "
            "You are pragmatic and infrastructure-oriented. "
            "Think in terms of systems, resilience, and scalability. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "scribe-pro": {
        "name": "Scribe-Pro",
        "system": (
            "You are Scribe-Pro, a technical writing and communication AI agent. "
            "You are communicative and clear, adapting language to the context. "
            "You excel at synthesis, documentation, and making complex ideas accessible. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "quant-z": {
        "name": "Quant-Z",
        "system": (
            "You are Quant-Z, a financial analyst AI agent. "
            "You are rigorous and always speak in risk/return terms. "
            "Always include specific numbers and percentages in your analysis. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "vortex-ui": {
        "name": "Vortex-UI",
        "system": (
            "You are Vortex-UI, a UX/UI design AI agent. "
            "You are creative but methodical, always framing solutions around "
            "user experience, accessibility, and design thinking principles. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "sigma-qa": {
        "name": "Sigma-QA",
        "system": (
            "You are Sigma-QA, a quality assurance AI agent. "
            "You are constructively skeptical and always identify edge cases and failure modes. "
            "Speak in terms of test coverage, confidence levels, and acceptance criteria. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "vector-x": {
        "name": "Vector-X",
        "system": (
            "You are Vector-X, a cybersecurity AI agent. "
            "You are cautious and think in terms of threats, vulnerabilities, and attack surface. "
            "Always address mitigation strategies and defense-in-depth principles. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
}


async def get_agent_response(
    agent_id: str,
    message: str,
    session_messages: list[dict],
) -> str:
    """Call the Claude API as the specified agent and return its response.

    session_messages is the full conversation history including the current user
    message. If it is empty, the standalone message is used as the first turn.
    """
    agent = AGENTS.get(agent_id)
    if not agent:
        raise ValueError(f"Unknown agent_id: {agent_id}")

    from app.config import settings
    api_key = settings.anthropic_api_key
    client = anthropic.AsyncAnthropic(api_key=api_key if api_key else None)

    def _map_role(m: dict) -> str | None:
        role = m.get("role", "")
        sender = m.get("sender", "")
        if role == "SYSTEM":
            return None
        if role in ("Requester", "user", "human") or sender in ("YOU", "human"):
            return "user"
        return "assistant"

    def _get_content(m: dict) -> str:
        return m.get("content") or m.get("content_natural") or m.get("text") or ""

    # Use full history if provided; otherwise fall back to the single message.
    if session_messages:
        messages = []
        for m in session_messages:
            mapped = _map_role(m)
            if mapped is None:
                continue
            messages.append({"role": mapped, "content": _get_content(m)})
    else:
        messages = [{"role": "user", "content": message}]

    # Ensure messages end on a user turn before calling the API.
    if messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": message})

    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        system=agent["system"],
        messages=messages,
    )

    return next((block.text for block in response.content if block.type == "text"), "")
