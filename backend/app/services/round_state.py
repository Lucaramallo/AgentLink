"""Redis-backed per-agent state tracking for session rounds."""

import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from redis.asyncio import Redis

_HASH_TTL = 86_400  # 24 h — same as session TTL

VALID_STATES: frozenset[str] = frozenset({"PENDING", "THINKING", "RESPONDED", "SKIPPED"})


def _hash_key(room_id: str, round_number: int) -> str:
    return f"agent_state:{room_id}:{round_number}"


def _thinking_key(room_id: str, round_number: int, agent_id: str) -> str:
    return f"agent_thinking_start:{room_id}:{round_number}:{agent_id}"


async def initialize_round(
    redis: "Redis",
    room_id: str,
    round_number: int,
    agent_ids: list[str],
) -> None:
    """Set all agents to PENDING for the round. Safe to call multiple times — never overwrites an existing state."""
    key = _hash_key(room_id, round_number)
    existing: dict[str, str] = await redis.hgetall(key)
    mapping = {aid: "PENDING" for aid in agent_ids if aid not in existing}
    if mapping:
        await redis.hset(key, mapping=mapping)
    await redis.expire(key, _HASH_TTL)


async def set_agent_state(
    redis: "Redis",
    room_id: str,
    round_number: int,
    agent_id: str,
    state: str,
) -> None:
    """Update one agent's state. Records thinking start timestamp when state == THINKING."""
    key = _hash_key(room_id, round_number)
    await redis.hset(key, agent_id, state)
    await redis.expire(key, _HASH_TTL)

    tkey = _thinking_key(room_id, round_number, agent_id)
    if state == "THINKING":
        await redis.set(tkey, str(time.time()), ex=_HASH_TTL)
    else:
        await redis.delete(tkey)


async def get_round_state(
    redis: "Redis",
    room_id: str,
    round_number: int,
) -> dict[str, str]:
    """Return {agent_id: state} for all agents tracked in this round."""
    return await redis.hgetall(_hash_key(room_id, round_number))


async def mark_timed_out(
    redis: "Redis",
    room_id: str,
    round_number: int,
    timeout_secs: int,
) -> list[str]:
    """Move any THINKING agent that exceeded timeout_secs to SKIPPED.

    Returns the list of agent_ids that were timed out.
    """
    state_map = await get_round_state(redis, room_id, round_number)
    now = time.time()
    timed_out: list[str] = []

    for agent_id, state in state_map.items():
        if state != "THINKING":
            continue
        raw_ts = await redis.get(_thinking_key(room_id, round_number, agent_id))
        if raw_ts is None or now - float(raw_ts) >= timeout_secs:
            timed_out.append(agent_id)

    for agent_id in timed_out:
        await set_agent_state(redis, room_id, round_number, agent_id, "SKIPPED")

    return timed_out
