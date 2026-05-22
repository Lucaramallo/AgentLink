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


def build_role_system_prompt(
    role: str,
    round_number: int,
    max_rounds: int,
    team_agents: list[dict] | None = None,
    rn_context: str | None = None,
    is_builder: bool = False,
) -> str:
    """Return a role+round-specific instruction block appended to the base persona prompt."""
    is_final = round_number >= max_rounds
    teammates = ""
    if team_agents:
        parts = [f"{a.get('name', '?')} ({a.get('role', '?')})" for a in team_agents]
        teammates = "Team: " + ", ".join(parts) + "."

    base = (
        f"\n\n--- SESSION CONTEXT ---\n"
        f"Round: {round_number} of {max_rounds}. "
        f"Your role this session: {role}. "
        f"{teammates}\n"
    )

    r = role.lower()

    if is_builder and is_final:
        rn_block = ""
        if rn_context:
            rn_block = (
                "\n\nFinal round summaries from the team (use these to assemble the deliverable):\n\n"
                f"{rn_context}"
            )
        instructions = (
            "In this final round you are acting exclusively as the Builder. "
            "Your Contributor role is suspended. "
            "Your ONLY job is to assemble the final deliverable using all the summaries and context provided. "
            "Do not add new analysis. Do not comment on others' work. "
            "Produce the complete deliverable now and mark it as DELIVERABLE.\n\n"
            "If the deliverable contains multiple files, use this EXACT format for each file:\n"
            "## FILE 1: filename.ext\n"
            "```language\n"
            "...file content...\n"
            "```\n"
            "## FILE 2: filename2.ext\n"
            "```language\n"
            "...file content...\n"
            "```\n"
            "Use the actual filenames (e.g. pipeline.py, index.html, app.js). "
            "If there is only one file, output its content directly without the FILE N: headers."
            f"{rn_block}"
        )

    elif r == "coordinator":
        if round_number == 1:
            instructions = (
                "You are the COORDINATOR for this session. In Round 1 you must: "
                "(1) Introduce yourself as coordinator, "
                "(2) Acknowledge the task assignment plan, "
                "(3) Contribute your own perspective on the task. "
                "Be directive and clear about how the team should approach the work."
            )
        elif is_final:
            instructions = (
                "You are the COORDINATOR. This is the FINAL ROUND. "
                "Verify that the Builder has produced the correct deliverable. "
                "Emit a coordination summary: confirm the team met the deliverable spec, "
                "note any gaps, and close with your assessment. Be concise and authoritative."
            )
        else:
            instructions = (
                "You are the COORDINATOR. Actively monitor progress. "
                "Redirect agents who are going off-track. "
                "Keep the team focused on the deliverable spec. "
                "Call out drift, gaps, or contradictions you observe."
            )

    elif r == "contributor":
        if is_final:
            instructions = (
                "You are a CONTRIBUTOR. This is the FINAL ROUND. "
                "Produce a concise, structured executive summary of your contribution. "
                "Address it explicitly to the Builder (or the team if no Builder is set). "
                "Format: key findings, your recommendation, what the Builder needs from you. "
                "No rambling — clean, structured output only."
            )
        else:
            instructions = (
                "You are a CONTRIBUTOR. Participate fully and develop your position. "
                "Engage with colleagues, refine your analysis, and advance the work."
            )

    elif r == "reviewer":
        if is_final:
            instructions = (
                "You are the REVIEWER. This is the FINAL ROUND. "
                "Deliver a final quality assessment of all contributions before the Builder assembles. "
                "Do NOT produce content yourself — assess quality, identify gaps, "
                "flag risks, and confirm whether the work meets the deliverable spec. "
                "Be specific: name which contributions pass, which need revision, and why."
            )
        else:
            instructions = (
                "You are the REVIEWER. Do NOT produce content — act as an active advisor. "
                "Comment on others' work, identify gaps, suggest improvements, "
                "raise quality concerns. Be specific and constructive."
            )

    elif r == "builder":
        if is_final:
            rn_block = ""
            if rn_context:
                rn_block = (
                    "\n\nFinal round summaries from the team (use these to assemble the deliverable):\n\n"
                    f"{rn_context}"
                )
            instructions = (
                "You are the BUILDER. This is the FINAL ROUND. "
                "Your job is to assemble the final deliverable using your specialty. "
                "Use all Contributor summaries and Reviewer assessments provided below. "
                "Produce the complete, polished deliverable — not a summary, the actual artifact. "
                "Begin your response with the word DELIVERABLE on its own line, then the content.\n\n"
                "If the deliverable contains multiple files, use this EXACT format for each file:\n"
                "## FILE 1: filename.ext\n"
                "```language\n"
                "...file content...\n"
                "```\n"
                "## FILE 2: filename2.ext\n"
                "```language\n"
                "...file content...\n"
                "```\n"
                "Use the actual filenames (e.g. pipeline.py, index.html, app.js). "
                "If there is only one file, output its content directly without the FILE N: headers."
                f"{rn_block}"
            )
        else:
            instructions = (
                "You are the BUILDER. Participate as a specialist contributor. "
                "In earlier rounds, develop your understanding of the requirements. "
                "You will assemble the final deliverable in the last round."
            )

    elif r == "requester":
        instructions = (
            "You are the REQUESTER. You go first in each round when you participate. "
            "You can intervene at any point to clarify requirements, redirect the team, "
            "or add new constraints. Keep the team accountable to your original request."
        )

    else:
        instructions = f"Participate in Round {round_number} according to your role ({role})."

    return base + instructions


async def get_agent_response(
    agent_id: str,
    message: str,
    session_messages: list[dict],
    acting_as: dict | None = None,
    subtask: str | None = None,
    round_number: int | None = None,
    max_rounds: int | None = None,
    team_agents: list[dict] | None = None,
    rn_context: str | None = None,
    is_builder: bool = False,
    repo_context: str | None = None,
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
        if round_number is not None and max_rounds is not None:
            system += build_role_system_prompt(
                role=role,
                round_number=round_number,
                max_rounds=max_rounds,
                team_agents=team_agents,
                rn_context=rn_context,
                is_builder=is_builder,
            )
    if subtask:
        system = f"{system}\n\nYour assigned subtask for this session: {subtask}"
    if repo_context:
        system = f"{system}\n\n{repo_context}"

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
