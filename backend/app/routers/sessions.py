"""Router de Sesiones — recomendación de equipo de agentes."""

import re
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.agent import Agent

router = APIRouter(prefix="/sessions", tags=["sessions"])

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


class RecommendTeamRequest(BaseModel):
    task_description: str
    acceptance_criteria: str = ""
    budget_max: float | None = None


def _extract_keywords(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z]+", text.lower())
    return {w for w in words if w not in _STOP_WORDS and len(w) > 3}


def _score_agent(
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


@router.post("/recommend-team")
async def recommend_team(
    body: RecommendTeamRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    result = await db.execute(
        select(Agent).where(Agent.is_active == True, Agent.frozen == False)  # noqa: E712
    )
    agents = list(result.scalars().all())

    if not agents:
        return {
            "agents": [],
            "edges": [],
            "estimated_cost": 0,
            "reasoning": "No agents available.",
        }

    keywords = _extract_keywords(body.task_description + " " + body.acceptance_criteria)

    max_fee = max((a.session_fee or 8.0) for a in agents) or 8.0
    max_jobs = max((a.total_jobs_completed for a in agents), default=1) or 1

    scored = [
        (agent, _score_agent(agent, keywords, max_fee, max_jobs))
        for agent in agents
    ]
    scored = [(a, s) for a, s in scored if s > 0]
    scored.sort(key=lambda x: x[1], reverse=True)

    # Fall back to top agents by reputation if no skill matches
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

    # Select 2–5 agents based on task complexity
    num_keywords = len(keywords)
    if num_keywords <= 3:
        n_agents = 2
    elif num_keywords <= 6:
        n_agents = 3
    elif num_keywords <= 10:
        n_agents = 4
    else:
        n_agents = 5
    n_agents = min(n_agents, len(scored))

    selected = scored[:n_agents]

    # Highest rep agent becomes Reviewer
    highest_rep_idx = max(
        range(len(selected)),
        key=lambda i: (
            (selected[i][0].reputation_technical or 2.5)
            + (selected[i][0].reputation_relational or 2.5)
        ),
    )

    agent_list = []
    for i, (agent, _score) in enumerate(selected):
        role = "Reviewer" if i == highest_rep_idx else "Contributor"
        agent_list.append(
            {
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
            }
        )

    edges = [
        {"a": agent_list[i]["agent_id"], "b": agent_list[j]["agent_id"]}
        for i in range(len(agent_list))
        for j in range(i + 1, len(agent_list))
    ]

    estimated_msgs_per_agent = 10
    estimated_cost = sum(
        a["session_fee"] + estimated_msgs_per_agent * a["cost_per_message"]
        for a in agent_list
    )

    skill_hits = ", ".join(list(keywords)[:5]) if keywords else "general capabilities"
    reasoning = (
        f"Matched {len(agent_list)} agents based on task keywords ({skill_hits}). "
        f"Ranked by reputation (35%), price competitiveness (25%), experience (20%), and skill match (20%)."
    )

    return {
        "agents": agent_list,
        "edges": edges,
        "estimated_cost": round(estimated_cost, 2),
        "reasoning": reasoning,
    }
