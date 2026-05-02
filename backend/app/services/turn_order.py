"""Turn order logic for AgentLink sessions — pure functions, no I/O."""

from dataclasses import dataclass, field


@dataclass
class TurnGroup:
    agents: list[dict]
    parallel: bool
    label: str  # "contributors" | "reviewers" | "builders"


def get_turn_order(
    session_graph: dict,
    round_number: int,
    max_rounds: int,
) -> list[TurnGroup]:
    """Return ordered turn groups for a given round.

    R1:       Contributors + Builders (parallel) → Reviewers (sequential)
    R2..N-1:  Contributors + Builders (sequential, one at a time) → Reviewers (sequential)
    RN final: Builders only (sequential) — falls back to Contributors if none designated
    Observers and human Requester are excluded from all turn groups.
    """
    agents: list[dict] = session_graph.get("agents", [])
    # Exclude humans, Observers, and Coordinators from all turn groups
    non_human = [a for a in agents if not a.get("is_human", False) and a.get("role") != "Coordinator"]

    contributors = [a for a in non_human if a.get("role") == "Contributor"]
    builders     = [a for a in non_human if a.get("role") == "Builder"]
    reviewers    = [a for a in non_human if a.get("role") == "Reviewer"]
    # Observers intentionally excluded — they never block the flow

    if round_number >= max_rounds:
        final = builders if builders else contributors
        return [TurnGroup(agents=final, parallel=False, label="builders")]

    groups: list[TurnGroup] = []

    if round_number == 1:
        worker_agents = contributors + builders
        if worker_agents:
            groups.append(TurnGroup(agents=worker_agents, parallel=True, label="contributors"))
        if reviewers:
            groups.append(TurnGroup(agents=reviewers, parallel=False, label="reviewers"))
        return groups

    # R2 through N-1: each contributor/builder is its own sequential group
    for agent in contributors + builders:
        groups.append(TurnGroup(agents=[agent], parallel=False, label="contributors"))
    for agent in reviewers:
        groups.append(TurnGroup(agents=[agent], parallel=False, label="reviewers"))
    return groups


def validate_edge(session_graph: dict, sender_id: str, receiver_id: str) -> bool:
    """Return True if a direct edge exists between sender and receiver (undirected)."""
    for edge in session_graph.get("edges", []):
        a, b = edge.get("from", ""), edge.get("to", "")
        if (a == sender_id and b == receiver_id) or (a == receiver_id and b == sender_id):
            return True
    return False


def get_agent_neighbors(session_graph: dict, agent_id: str) -> set[str]:
    """Return the set of agent IDs directly connected to agent_id."""
    neighbors: set[str] = set()
    for edge in session_graph.get("edges", []):
        a, b = edge.get("from", ""), edge.get("to", "")
        if a == agent_id:
            neighbors.add(b)
        elif b == agent_id:
            neighbors.add(a)
    return neighbors
