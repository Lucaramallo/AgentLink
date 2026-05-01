"""Agent engine — Claude API integration for AgentLink demo agents."""

import json
import os
import re

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
    acting_as: dict | None = None,
) -> str:
    """Call the Claude API as the specified agent and return its response."""
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

    if session_messages:
        messages = []
        for m in session_messages:
            mapped = _map_role(m)
            if mapped is None:
                continue
            messages.append({"role": mapped, "content": _get_content(m)})
    else:
        messages = [{"role": "user", "content": message}]

    if messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": message})

    system = agent["system"]
    if acting_as:
        name = acting_as.get("name", "")
        role = acting_as.get("role", "")
        system = (
            f"In this session you are acting as {name} with the role of {role}. "
            f"Respond accordingly.\n\n{system}"
        )

    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        system=system,
        messages=messages,
    )

    return next((block.text for block in response.content if block.type == "text"), "")


async def get_peer_review(
    agent_id: str,
    agent_name: str,
    session_messages: list[dict],
    other_agents: list[dict],
) -> dict[str, float]:
    """Have an agent rate each of its colleagues from 1–5 based on session contributions."""
    from app.config import settings
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key if settings.anthropic_api_key else None)

    others_list = ", ".join(f'"{a["id"]}" ({a["name"]})' for a in other_agents)
    other_ids = {a["id"] for a in other_agents}

    system = (
        f"You are {agent_name}. Rate each colleague's contribution in this session from 1-5. "
        "Consider: quality of analysis, usefulness of their input to the team, "
        "how much they contributed to the final deliverable. "
        f"Respond ONLY with valid JSON using agent IDs as keys: {{{others_list}}}"
    )

    context_lines = []
    for m in session_messages[-30:]:
        sender = m.get("agentName") or m.get("sender") or "Unknown"
        content = m.get("content") or ""
        if content:
            context_lines.append(f"{sender}: {content[:200]}")

    user_msg = (
        "Session conversation:\n" + "\n".join(context_lines) + "\n\n"
        "Rate each colleague from 1-5 using their agent IDs as keys. Respond ONLY with valid JSON."
    )

    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )

    text = next((block.text for block in response.content if block.type == "text"), "{}")

    json_match = re.search(r'\{[^}]+\}', text, re.DOTALL)
    if json_match:
        try:
            raw = json.loads(json_match.group())
            result = {}
            for k, v in raw.items():
                if k in other_ids:
                    try:
                        score = float(v)
                        result[k] = max(1.0, min(5.0, round(score, 1)))
                    except (TypeError, ValueError):
                        pass
            if result:
                return result
        except json.JSONDecodeError:
            pass

    import random
    return {a["id"]: round(random.uniform(3.0, 5.0), 1) for a in other_agents}
