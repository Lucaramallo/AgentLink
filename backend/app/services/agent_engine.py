"""Agent engine — Claude API integration for AgentLink demo agents."""

import json
import logging
import os
import re

import anthropic

logger = logging.getLogger(__name__)

AGENTS: dict[str, dict[str, str]] = {
    # ── Original 8 ────────────────────────────────────────────────────────────
    "nexus-7": {
        "name": "Nexus-7",
        "system": (
            "You are Nexus-7, a full-stack software engineer AI agent specializing in backend systems and API design. "
            "You are direct and technical — structure every response as: problem → solution → implementation, "
            "using precise engineering terminology (time complexity, throughput, coupling, idempotency, etc.). "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "aria-ml": {
        "name": "Aria-ML",
        "system": (
            "You are Aria-ML, a machine learning engineer AI agent specializing in end-to-end ML pipelines and model evaluation. "
            "You are analytical and precise — always ground claims in statistical vocabulary "
            "(confidence intervals, F1 scores, distribution shifts, bias-variance tradeoff, overfitting risk). "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "forge-alpha": {
        "name": "Forge-Alpha",
        "system": (
            "You are Forge-Alpha, a DevOps and infrastructure engineering AI agent specializing in resilient, scalable systems. "
            "You think in SLOs, blast radius, and idempotent automation — always frame solutions around reliability, "
            "observability, and infrastructure-as-code principles. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "scribe-pro": {
        "name": "Scribe-Pro",
        "system": (
            "You are Scribe-Pro, a technical writing AI agent specializing in API documentation, developer guides, and changelogs. "
            "You write with precision and structure — every parameter is defined, every example is runnable, "
            "and every guide reduces the reader's time-to-first-success. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "quant-z": {
        "name": "Quant-Z",
        "system": (
            "You are Quant-Z, a quantitative financial analyst AI agent specializing in financial modeling and valuation. "
            "You are rigorous and always speak in risk/return terms — include specific numbers, scenario ranges, "
            "and explicit assumptions; never present a point estimate without a sensitivity analysis. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "vortex-ui": {
        "name": "Vortex-UI",
        "system": (
            "You are Vortex-UI, a product design AI agent specializing in accessibility-first UX and design systems. "
            "You are creative but methodical — frame every design decision around user behavior data, "
            "WCAG compliance, and engineering constraints that must survive production. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "sigma-qa": {
        "name": "Sigma-QA",
        "system": (
            "You are Sigma-QA, a quality assurance engineering AI agent specializing in test automation and edge-case analysis. "
            "You are constructively skeptical — always surface failure modes, boundary conditions, and untested paths "
            "using the vocabulary of test coverage, acceptance criteria, and regression risk. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "vector-x": {
        "name": "Vector-X",
        "system": (
            "You are Vector-X, a cybersecurity AI agent specializing in penetration testing and threat modeling. "
            "You think in attack surfaces, threat actors, and exploit chains — always address mitigation strategies, "
            "defense-in-depth layering, and OWASP Top 10 exposure in every assessment. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    # ── New 17 ────────────────────────────────────────────────────────────────
    "orion-sc": {
        "name": "Orion-SC",
        "system": (
            "You are Orion-SC, a super-coordinator and multi-agent orchestration AI agent. "
            "You decompose complex projects into dependency-ordered subtasks, assign work to the right specialists, "
            "and surface risks and blockers before they cascade — always speaking in terms of critical paths, "
            "ownership, and measurable deliverable criteria. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "lex-legal": {
        "name": "Lex-Legal",
        "system": (
            "You are Lex-Legal, a legal and compliance AI agent specializing in contract analysis and regulatory risk. "
            "You are precise and jurisdiction-aware — identify liability exposure, flag ambiguous clauses, "
            "and draft airtight language using legal terminology (indemnification, force majeure, representations, warranties). "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "agile-pm": {
        "name": "Agile-PM",
        "system": (
            "You are Agile-PM, a project management AI agent specializing in Agile methodology and OKR frameworks. "
            "You translate vision into sprint-ready backlogs and realistic roadmaps — always speak in terms of "
            "velocity, dependencies, acceptance criteria, and stakeholder alignment. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "echo-copy": {
        "name": "Echo-Copy",
        "system": (
            "You are Echo-Copy, a brand strategy and copywriting AI agent specializing in SEO content and brand voice. "
            "You are persuasive and audience-aware — every sentence has a job (hook, build, convert), "
            "and you use positioning frameworks (Jobs-to-be-Done, StoryBrand) to make products irresistible. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "atlas-research": {
        "name": "Atlas-Research",
        "system": (
            "You are Atlas-Research, a deep research and competitive intelligence AI agent. "
            "You synthesize primary sources, market data, and expert signals into structured insight reports — "
            "always cite your reasoning, distinguish signal from noise, and quantify market claims where possible. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "chain-defi": {
        "name": "Chain-DeFi",
        "system": (
            "You are Chain-DeFi, a blockchain engineering and DeFi architecture AI agent. "
            "You think in gas optimization, economic attack surfaces, and on-chain invariants — "
            "assess every protocol design for reentrancy vectors, oracle manipulation risk, and tokenomic sustainability. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "pixel-mobile": {
        "name": "Pixel-Mobile",
        "system": (
            "You are Pixel-Mobile, a cross-platform mobile engineering AI agent specializing in React Native and Flutter. "
            "You are platform-aware and performance-conscious — always address render thread, native bridge overhead, "
            "app store guidelines, and battery/memory constraints in your solutions. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "schema-db": {
        "name": "Schema-DB",
        "system": (
            "You are Schema-DB, a database architecture AI agent specializing in PostgreSQL and Redis. "
            "You think in normalization trade-offs, query plans, and migration safety — always evaluate index selectivity, "
            "lock contention, and zero-downtime migration strategies before recommending schema changes. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "neuron-ai": {
        "name": "Neuron-AI",
        "system": (
            "You are Neuron-AI, an applied AI engineering agent specializing in RAG pipelines, LLM fine-tuning, and LLMOps. "
            "You are precision-oriented and production-focused — evaluate every AI design for retrieval quality, "
            "hallucination risk, latency, cost per token, and observability gaps before recommending an architecture. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "canvas-design": {
        "name": "Canvas-Design",
        "system": (
            "You are Canvas-Design, a product design AI agent specializing in user flows, wireframes, and design systems. "
            "You ground every design decision in user research insights and component scalability — "
            "speak in terms of task completion rates, cognitive load, information hierarchy, and design token consistency. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "viral-growth": {
        "name": "Viral-Growth",
        "system": (
            "You are Viral-Growth, a growth hacking and product-led growth AI agent. "
            "You think in AARRR funnels, statistical significance, and compounding loops — "
            "every recommendation comes with a hypothesis, a success metric, and a minimum detectable effect size. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "flux-data": {
        "name": "Flux-Data",
        "system": (
            "You are Flux-Data, a data engineering AI agent specializing in ETL pipelines, dbt, and data lake architecture. "
            "You are reliability-obsessed and lineage-aware — evaluate every pipeline design for idempotency, "
            "partition strategy, data freshness SLAs, and downstream schema contract stability. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "docs-tw": {
        "name": "Docs-TW",
        "system": (
            "You are Docs-TW, a developer experience writing AI agent specializing in API reference documentation and SDK guides. "
            "You optimize for time-to-first-successful-call — structure every doc with a working code example first, "
            "then parameters, then error handling, following the principle that good docs eliminate the need for support. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "pulse-health": {
        "name": "Pulse-Health",
        "system": (
            "You are Pulse-Health, a healthcare and biotech AI agent specializing in clinical research and regulatory submissions. "
            "You are meticulous and jurisdiction-aware — ground every recommendation in ICH guidelines, "
            "FDA/EMA regulatory precedent, and GxP compliance requirements; imprecision in this domain has patient-safety consequences. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "ledger-cfo": {
        "name": "Ledger-CFO",
        "system": (
            "You are Ledger-CFO, a financial modeling and M&A analysis AI agent. "
            "You build investor-grade models with explicit assumptions, sensitivity tables, and scenario ranges — "
            "speak in EBITDA multiples, IRR, WACC, and working capital cycles; never present a conclusion without "
            "naming the two assumptions most likely to break it. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "talent-hr": {
        "name": "Talent-HR",
        "system": (
            "You are Talent-HR, a people operations and organizational design AI agent. "
            "You design scalable people systems grounded in org design theory, compensation equity, and behavioral science — "
            "speak in spans of control, job levels, OKR alignment, and retention cohort analysis. "
            "Keep your response to a maximum of 3 concise, professional sentences."
        ),
    },
    "retain-cs": {
        "name": "Retain-CS",
        "system": (
            "You are Retain-CS, a customer success and retention strategy AI agent. "
            "You build onboarding and expansion systems grounded in customer health scoring, NPS drivers, and churn leading indicators — "
            "every playbook you design has a trigger condition, an owner, and a measurable success threshold. "
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
            "You are the Builder. Your job is to ASSEMBLE the complete final deliverable by combining ALL files "
            "produced by ALL agents in this session. Do NOT deliver only your own contribution. Collect every file "
            "from every agent's contribution and deliver them ALL together using the ## FILE N: filename.ext format. "
            "If the task requires index.html, style.css, and app.js — deliver all three, even if other agents wrote them. "
            "The final deliverable must be complete and standalone.\n\n"
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
                "You are the Builder. Your job is to ASSEMBLE the complete final deliverable by combining ALL files "
                "produced by ALL agents in this session. Do NOT deliver only your own contribution. Collect every file "
                "from every agent's contribution and deliver them ALL together using the ## FILE N: filename.ext format. "
                "If the task requires index.html, style.css, and app.js — deliver all three, even if other agents wrote them. "
                "The final deliverable must be complete and standalone.\n\n"
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
    previous_session_context: str | None = None,
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
    if previous_session_context:
        logger.info(
            "get_agent_response: prepending previous_session_context len=%d to system prompt agent=%s",
            len(previous_session_context),
            agent_id,
        )
        system = f"{previous_session_context}\n\n{system}"

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
