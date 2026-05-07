"""Recommendation service — dataset-driven team composition scoring."""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

from sqlalchemy import cast, or_, select, String
from sqlalchemy.dialects.postgresql import ARRAY

from app.models.agent import Agent
from app.models.dataset import AgentDataset, SessionDataset
from app.services.dataset_service import extract_task_keywords

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

_STOP_WORDS: frozenset[str] = frozenset({
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "must", "shall", "i", "you", "we",
    "they", "it", "this", "that", "these", "those", "my", "your", "our",
    "their", "its", "need", "want", "can", "get", "make", "use", "using",
    "create", "build", "write", "help", "please", "also", "very", "some",
    "any", "all", "both", "each", "few", "more", "most", "other", "into",
    "through", "about", "up", "out", "over", "then", "than", "so", "if",
    "when", "how", "what", "who", "which", "new", "good", "like", "just",
    "one", "two", "three", "see", "well", "way", "work", "task", "need",
})

_DEFAULT_RATING = 2.5 / 5.0  # used when human/peer rating is absent
_DEFAULT_ROUNDS = 3           # used when rounds data is absent
_MAX_ROUNDS = 5


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def recommend_team(
    db: "AsyncSession",
    task_description: str,
    acceptance_criteria: str = "",
    max_agents: int = 5,
) -> list[dict]:
    """Return a ranked list of agent dicts for the given task.

    Each dict contains the full agent fields expected by the endpoint PLUS
    ``score`` (float) and ``reason`` (str).

    Falls back to keyword/reputation matching when no historical data exists.
    """
    # ── 1. Extract semantic keywords via Claude API ──────────────────────────
    keywords: list[str] = await extract_task_keywords(task_description)

    # ── 2. Load all eligible agents ─────────────────────────────────────────
    agents_result = await db.execute(
        select(Agent).where(Agent.is_active == True, Agent.frozen == False)  # noqa: E712
    )
    agents: list[Agent] = list(agents_result.scalars().all())

    if not agents:
        return []

    # ── 3. Attempt dataset path ──────────────────────────────────────────────
    if keywords:
        dataset_result = await _recommend_from_dataset(db, agents, keywords, max_agents)
        if dataset_result is not None:
            return dataset_result

    # ── 4. Fallback ──────────────────────────────────────────────────────────
    return _fallback_recommend(agents, task_description, acceptance_criteria, max_agents)


async def score_team_composition(
    db: "AsyncSession",
    agent_slugs: list[str],
    task_keywords: list[str],
) -> float:
    """Return composite score for a given set of agent names + keywords.

    Queries CONFORME sessions where the stored agent_slugs overlap with the
    provided slugs AND task_keywords overlap.  Returns 0.0 when no history.
    """
    if not agent_slugs or not task_keywords:
        return 0.0

    kw_filters = _keyword_overlap_filters(task_keywords)
    if not kw_filters:
        return 0.0

    # Require at least one slug in common (any @> check)
    from sqlalchemy.dialects.postgresql import JSONB
    slug_filters = [
        SessionDataset.agent_slugs.op("@>")(
            cast(json.dumps([s]), JSONB)
        )
        for s in agent_slugs
    ]

    stmt = (
        select(SessionDataset)
        .where(
            SessionDataset.final_outcome == "CONFORME",
            SessionDataset.task_keywords.isnot(None),
            SessionDataset.agent_slugs.isnot(None),
            or_(*kw_filters),
            or_(*slug_filters),
        )
        .limit(50)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    if not sessions:
        return 0.0

    return sum(_session_score(s) for s in sessions) / len(sessions)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _keyword_overlap_filters(keywords: list[str]) -> list:
    """Build OR-able SQLAlchemy @> containment filters for JSONB keyword overlap."""
    from sqlalchemy.dialects.postgresql import JSONB

    return [
        SessionDataset.task_keywords.op("@>")(
            cast(json.dumps([kw.lower()]), JSONB)
        )
        for kw in keywords
        if kw.strip()
    ]


def _session_score(sd: SessionDataset) -> float:
    """Compute the 90%-weight composite score for a single session row."""
    human = (sd.human_team_rating / 5.0) if sd.human_team_rating is not None else _DEFAULT_RATING
    peer = (sd.average_peer_rating / 5.0) if sd.average_peer_rating is not None else _DEFAULT_RATING
    rounds = sd.number_of_rounds_used if sd.number_of_rounds_used else _DEFAULT_ROUNDS
    efficiency = 1.0 - min(rounds, _MAX_ROUNDS) / _MAX_ROUNDS
    return human * 0.4 + peer * 0.3 + efficiency * 0.2


async def _recommend_from_dataset(
    db: "AsyncSession",
    agents: list[Agent],
    keywords: list[str],
    max_agents: int,
) -> list[dict] | None:
    """Core dataset path.

    Returns a list of agent dicts on success, or None to signal fallback.
    """
    # ── Query matching CONFORME sessions ────────────────────────────────────
    kw_filters = _keyword_overlap_filters(keywords)
    if not kw_filters:
        return None

    stmt = (
        select(SessionDataset)
        .where(
            SessionDataset.final_outcome == "CONFORME",
            SessionDataset.task_keywords.isnot(None),
            SessionDataset.agent_slugs.isnot(None),
            or_(*kw_filters),
        )
        .order_by(SessionDataset.recorded_at.desc())
        .limit(100)
    )
    result = await db.execute(stmt)
    sessions: list[SessionDataset] = list(result.scalars().all())

    if not sessions:
        return None

    # ── Accumulate per-slug scores ───────────────────────────────────────────
    slug_scores: dict[str, list[float]] = {}
    for sd in sessions:
        score = _session_score(sd)
        for slug in (sd.agent_slugs or []):
            slug_scores.setdefault(str(slug), []).append(score)

    if not slug_scores:
        return None

    # ── Check flagged_as_problem in last 10 AgentDataset rows per slug ───────
    flagged_slugs: set[str] = set()
    for slug in slug_scores:
        flag_stmt = (
            select(AgentDataset)
            .where(AgentDataset.agent_slug == slug)
            .order_by(AgentDataset.agent_dataset_id.desc())
            .limit(10)
        )
        flag_result = await db.execute(flag_stmt)
        recent_rows = flag_result.scalars().all()
        if any(r.flagged_as_problem for r in recent_rows):
            flagged_slugs.add(slug)

    # ── Build agent name → Agent record map ─────────────────────────────────
    agent_by_name: dict[str, Agent] = {a.name: a for a in agents}

    # ── Compute final scores ─────────────────────────────────────────────────
    scored: list[tuple[Agent, float, str]] = []  # (agent, score, reason)
    for slug, scores in slug_scores.items():
        agent = agent_by_name.get(slug)
        if agent is None:
            continue
        history_score = (sum(scores) / len(scores)) * 0.9
        tech = agent.reputation_technical or 2.5
        rel = agent.reputation_relational or 2.5
        rep_score = ((tech + rel) / 10.0) * 0.1
        final = history_score + rep_score
        if slug in flagged_slugs:
            final *= 0.5
        reason = (
            "Top performer for similar tasks"
            if final >= 0.5
            else "Rated positively in similar tasks"
        )
        scored.append((agent, final, reason))

    # Supplement with agents that have no history but are active (ranked by reputation)
    scored_slugs = {a.name for a, _, _ in scored}
    for agent in agents:
        if agent.name not in scored_slugs:
            tech = agent.reputation_technical or 2.5
            rel = agent.reputation_relational or 2.5
            rep_score = (tech + rel) / 10.0 * 0.1
            scored.append((agent, rep_score, "No history yet — recommended by skills"))

    scored.sort(key=lambda x: x[1], reverse=True)

    if not scored:
        return None

    # ── Select top N ─────────────────────────────────────────────────────────
    n_agents = _pick_n(len(keywords), len(scored), max_agents)
    selected = scored[:n_agents]

    # ── Role assignment ──────────────────────────────────────────────────────
    return _assign_roles_and_build(selected, sessions)


def _pick_n(num_keywords: int, available: int, max_agents: int) -> int:
    if num_keywords <= 3:
        n = 2
    elif num_keywords <= 6:
        n = 3
    elif num_keywords <= 10:
        n = 4
    else:
        n = 5
    return min(n, available, max_agents)


def _assign_roles_and_build(
    selected: list[tuple[Agent, float, str]],
    sessions: list[SessionDataset],
) -> list[dict]:
    """Assign Coordinator/Reviewer/Contributor roles and return agent dicts."""
    n = len(selected)

    # Detect if Coordinator role was used in matching sessions
    coordinator_slug: str | None = None
    if n > 3:
        for sd in sessions:
            roles = sd.roles_present or []
            if "Coordinator" in roles:
                # Prefer assigning to the top-scored agent if they had that role
                for agent, _score, _reason in selected:
                    if any(
                        str(ag.get("slug", ag.get("name", ""))) == agent.name
                        for ag in []  # no per-session role-to-slug mapping available
                    ):
                        pass
                # Fall through: just flag that Coordinator is desirable
                coordinator_slug = "__desired__"
                break

    # Highest reputation agent → Reviewer
    reviewer_idx = max(
        range(n),
        key=lambda i: (
            (selected[i][0].reputation_technical or 2.5)
            + (selected[i][0].reputation_relational or 2.5)
        ),
    )

    # If Coordinator is desirable, assign it to the second-highest scorer (index 1)
    coordinator_idx: int | None = None
    if coordinator_slug and n > 3:
        for i in range(n):
            if i != reviewer_idx:
                coordinator_idx = i
                break

    result: list[dict] = []
    for i, (agent, score, reason) in enumerate(selected):
        if i == coordinator_idx:
            role = "Coordinator"
        elif i == reviewer_idx:
            role = "Reviewer"
        else:
            role = "Contributor"

        result.append(_agent_to_dict(agent, role, score, reason))

    return result


# ---------------------------------------------------------------------------
# Fallback (keyword + reputation matching — mirrors original sessions.py logic)
# ---------------------------------------------------------------------------

def _extract_keywords_local(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z]+", text.lower())
    return {w for w in words if w not in _STOP_WORDS and len(w) > 3}


def _score_agent_local(
    agent: Agent, keywords: set[str], max_fee: float, max_jobs: int
) -> float:
    agent_skill_words: set[str] = set()
    for skill in (agent.skills or []):
        agent_skill_words.update(re.findall(r"[a-zA-Z]+", skill.lower()))
    agent_skill_words.update(re.findall(r"[a-zA-Z]+", agent.description.lower()))

    matched = keywords & agent_skill_words
    if not matched:
        return 0.0

    tech = agent.reputation_technical or 2.5
    rel = agent.reputation_relational or 2.5
    rep_score = (tech + rel) / 10.0

    fee = agent.session_fee or 5.5
    price_score = 1.0 - (fee / max_fee) if max_fee > 0 else 0.5

    jobs_score = min(agent.total_jobs_completed / max_jobs, 1.0) if max_jobs > 0 else 0.0

    match_bonus = min(len(matched) / max(len(keywords), 1), 1.0) * 0.2

    return 0.35 * rep_score + 0.25 * price_score + 0.2 * jobs_score + match_bonus


def _fallback_recommend(
    agents: list[Agent],
    task_description: str,
    acceptance_criteria: str,
    max_agents: int,
) -> list[dict]:
    """Keyword + reputation matching — original algorithm, extended with reason/score."""
    keywords = _extract_keywords_local(task_description + " " + acceptance_criteria)

    max_fee = max((a.session_fee or 8.0) for a in agents) or 8.0
    max_jobs = max((a.total_jobs_completed for a in agents), default=1) or 1

    scored = [
        (agent, _score_agent_local(agent, keywords, max_fee, max_jobs))
        for agent in agents
    ]
    scored = [(a, s) for a, s in scored if s > 0]
    scored.sort(key=lambda x: x[1], reverse=True)

    if not scored:
        scored = sorted(
            [
                (
                    a,
                    0.4 * ((a.reputation_technical or 2.5) + (a.reputation_relational or 2.5)) / 10.0,
                )
                for a in agents
            ],
            key=lambda x: x[1],
            reverse=True,
        )

    n_agents = _pick_n(len(keywords), len(scored), max_agents)
    selected = scored[:n_agents]

    reviewer_idx = max(
        range(len(selected)),
        key=lambda i: (
            (selected[i][0].reputation_technical or 2.5)
            + (selected[i][0].reputation_relational or 2.5)
        ),
    )

    result: list[dict] = []
    for i, (agent, score) in enumerate(selected):
        role = "Reviewer" if i == reviewer_idx else "Contributor"
        result.append(_agent_to_dict(agent, role, score, "No history yet — recommended by skills"))

    return result


# ---------------------------------------------------------------------------
# Shared dict builder
# ---------------------------------------------------------------------------

def _agent_to_dict(agent: Agent, role: str, score: float, reason: str) -> dict:
    return {
        "agent_id": str(agent.agent_id),
        "name": agent.name,
        "description": agent.description,
        "skills": agent.skills or [],
        "framework": agent.framework,
        "public_key": agent.public_key,
        "reputation_technical": agent.reputation_technical,
        "reputation_relational": agent.reputation_relational,
        "total_jobs_completed": agent.total_jobs_completed,
        "total_jobs_disputed": agent.total_jobs_disputed,
        "is_active": agent.is_active,
        "frozen": agent.frozen,
        "session_fee": agent.session_fee or 5.5,
        "cost_per_message": agent.cost_per_message or 2.0,
        "role": role,
        "score": round(score, 4),
        "reason": reason,
    }
