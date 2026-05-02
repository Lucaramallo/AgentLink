"""Poll service — create, vote, quorum check, close, and veto polls."""

import base64
import json
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import nacl.signing

from app.config import settings
from app.models.room import Poll, PollActionType, PollScope, PollStatus
from app.services.identity import sign_message, verify_signature

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# Roles that carry 1.5x vote weight
_HEAVY_ROLES: frozenset[str] = frozenset({"Requester", "requester"})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_eligible_voters(session_graph: dict, scope: PollScope) -> list[dict]:
    """Return agents eligible to vote for this poll scope.

    Excludes Observers and human nodes (humans are tracked separately).
    """
    agents: list[dict] = session_graph.get("agents", [])
    result: list[dict] = []
    for a in agents:
        role: str = a.get("role", "")
        if role.lower() == "observer":
            continue
        if a.get("is_human", False):
            continue
        if scope == PollScope.CONTRIBUTORS_ONLY and role.lower() not in (
            "contributor", "builder"
        ):
            continue
        if scope == PollScope.REVIEWERS_ONLY and role.lower() != "reviewer":
            continue
        result.append(a)
    return result


def _has_human_node(session_graph: dict) -> bool:
    return any(a.get("is_human", False) for a in session_graph.get("agents", []))


def get_voter_weight(voter_id: str, voter_type: str, session_graph: dict) -> float:
    """Return 1.5 for Requester role or human node; 1.0 for all others."""
    if voter_type == "human":
        return 1.5
    agents: list[dict] = session_graph.get("agents", [])
    for a in agents:
        if str(a.get("id", "")) == voter_id:
            if a.get("role", "").lower() in ("requester",):
                return 1.5
            return 1.0
    return 1.0


def canonical_poll_string(
    poll_id: str,
    room_id: str,
    proposed_by: str,
    question: str,
    options: list[str],
    created_at_iso: str,
) -> str:
    options_json = json.dumps(options, ensure_ascii=False, separators=(",", ":"))
    return f"{poll_id}|{room_id}|{proposed_by}|{question}|{options_json}|{created_at_iso}"


def sign_poll_server(
    poll_id: str,
    room_id: str,
    proposed_by: str,
    question: str,
    options: list[str],
    created_at_iso: str,
) -> str:
    """Sign a poll with the server signing key (used for human-proposed polls)."""
    message = canonical_poll_string(poll_id, room_id, proposed_by, question, options, created_at_iso)
    return sign_message(settings.server_signing_key, message)


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

async def create_poll(
    db: "AsyncSession",
    room_id: uuid.UUID,
    proposed_by: str,
    proposed_by_type: str,
    question: str,
    options: list[str],
    deadline_secs: int,
    scope: PollScope,
    action_type: PollActionType | None,
    action_params: dict | None,
    session_graph: dict,
    signature: str,
) -> Poll:
    """Validate and persist a new poll.

    For agent-proposed polls the caller supplies a signature; we verify it here.
    For human-proposed polls the signature is produced by the backend (sign_poll_server).
    """
    if not (2 <= len(options) <= 4):
        raise ValueError("A poll must have between 2 and 4 options.")

    eligible = get_eligible_voters(session_graph, scope)
    has_human = _has_human_node(session_graph)
    if not eligible and not has_human:
        raise ValueError("No eligible voters for the given scope.")

    now = datetime.now(timezone.utc)
    poll_id = uuid.uuid4()
    created_at_iso = now.isoformat()

    # Verify agent signature; human polls are pre-signed by the server
    if proposed_by_type == "agent":
        agents: list[dict] = session_graph.get("agents", [])
        public_key: str | None = None
        for a in agents:
            if str(a.get("id", "")) == proposed_by:
                public_key = a.get("public_key")
                break
        if not public_key:
            raise ValueError(f"Agent {proposed_by} not found in session graph.")
        canonical = canonical_poll_string(
            str(poll_id), str(room_id), proposed_by, question, options, created_at_iso
        )
        if not verify_signature(public_key, canonical, signature):
            raise ValueError("Invalid poll signature.")

    poll = Poll(
        poll_id=poll_id,
        room_id=room_id,
        proposed_by=proposed_by,
        proposed_by_type=proposed_by_type,
        question=question,
        options=options,
        votes=[],
        status=PollStatus.OPEN,
        scope=scope,
        deadline_secs=deadline_secs,
        action_type=action_type,
        action_params=action_params,
        result=None,
        created_at=now,
        closed_at=None,
        signature=signature,
    )
    db.add(poll)
    await db.flush()
    return poll


async def cast_vote(
    db: "AsyncSession",
    poll: Poll,
    voter_id: str,
    voter_type: str,
    option_index: int,
    session_graph: dict,
) -> tuple[Poll, bool]:
    """Append a vote. Returns (updated_poll, quorum_reached).

    Idempotent: silently ignores duplicate voter_id.
    Weight is computed server-side from session_graph.
    """
    if poll.status != PollStatus.OPEN:
        raise ValueError("Poll is not open.")

    if not (0 <= option_index < len(poll.options)):
        raise ValueError(f"option_index {option_index} out of range.")

    # Reject duplicate votes
    existing_voter_ids = {v["voter_id"] for v in (poll.votes or [])}
    if voter_id in existing_voter_ids:
        return poll, False

    # Validate eligibility
    if voter_type == "agent":
        eligible_ids = {str(a["id"]) for a in get_eligible_voters(session_graph, poll.scope)}
        if voter_id not in eligible_ids:
            raise ValueError(f"Agent {voter_id} is not eligible for this poll's scope.")
    elif voter_type == "human":
        if not _has_human_node(session_graph):
            raise ValueError("No human node in this session.")
    else:
        raise ValueError(f"Unknown voter_type: {voter_type}")

    weight = get_voter_weight(voter_id, voter_type, session_graph)
    vote_entry = {
        "voter_id": voter_id,
        "voter_type": voter_type,
        "option_index": option_index,
        "weight": weight,
    }

    # JSONB mutation requires reassigning the list
    current_votes: list = list(poll.votes or [])
    current_votes.append(vote_entry)
    poll.votes = current_votes

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(poll, "votes")

    quorum = check_quorum(poll, session_graph)
    return poll, quorum


def check_quorum(poll: Poll, session_graph: dict) -> bool:
    """Return True if ≥51% of eligible voters (by count) have voted."""
    eligible_count = len(get_eligible_voters(session_graph, poll.scope))
    if _has_human_node(session_graph):
        eligible_count += 1
    if eligible_count == 0:
        return False
    votes_cast = len(poll.votes or [])
    return votes_cast / eligible_count >= 0.51


async def close_poll(db: "AsyncSession", poll: Poll) -> Poll:
    """Tally weighted votes, set result, mark CLOSED."""
    totals = [0.0] * len(poll.options)
    for v in (poll.votes or []):
        idx = v.get("option_index", 0)
        if 0 <= idx < len(totals):
            totals[idx] += v.get("weight", 1.0)

    winning_index = totals.index(max(totals))
    poll.result = {
        "winning_option_index": winning_index,
        "winning_label": poll.options[winning_index],
        "weighted_totals": totals,
        "action_applied": poll.action_type is not None and poll.action_type != PollActionType.CONSENSUS,
    }
    poll.status = PollStatus.CLOSED
    poll.closed_at = datetime.now(timezone.utc)
    return poll


async def veto_poll(db: "AsyncSession", poll: Poll) -> Poll:
    """Mark poll as VETOED."""
    poll.status = PollStatus.VETOED
    poll.closed_at = datetime.now(timezone.utc)
    return poll


def apply_result(poll: Poll) -> dict | None:
    """Return an action spec dict, or None if poll has no mechanical action."""
    if not poll.result or not poll.action_type:
        return None
    if poll.action_type == PollActionType.CONSENSUS:
        return None
    if not poll.result.get("action_applied"):
        return None
    return {
        "action": poll.action_type.value,
        "params": poll.action_params or {},
        "winning_option": poll.result["winning_label"],
    }


def serialize_poll(poll: Poll) -> dict:
    """Return a JSON-serializable dict of a Poll."""
    return {
        "poll_id": str(poll.poll_id),
        "room_id": str(poll.room_id),
        "proposed_by": poll.proposed_by,
        "proposed_by_type": poll.proposed_by_type,
        "question": poll.question,
        "options": poll.options,
        "votes": poll.votes or [],
        "status": poll.status.value,
        "scope": poll.scope.value,
        "deadline_secs": poll.deadline_secs,
        "action_type": poll.action_type.value if poll.action_type else None,
        "action_params": poll.action_params,
        "result": poll.result,
        "created_at": poll.created_at.isoformat() if poll.created_at else None,
        "closed_at": poll.closed_at.isoformat() if poll.closed_at else None,
        "signature": poll.signature,
    }
