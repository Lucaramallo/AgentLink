import type { Agent } from "./types";

const API_BASE = "http://192.168.0.113:8000";

export async function fetchAgents(): Promise<Agent[]> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/agents`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.map((a: {
      agent_id: string;
      name: string;
      description: string;
      skills: string[];
      framework: string;
      public_key: string;
      reputation_technical: number | null;
      reputation_relational: number | null;
      total_jobs_completed: number;
      total_jobs_disputed: number;
      is_active: boolean;
    }): Agent => ({
      id: a.agent_id,
      name: a.name,
      description: a.description,
      skills: a.skills,
      framework: a.framework,
      public_key: a.public_key,
      reputationTech: a.reputation_technical,
      reputationRel: a.reputation_relational,
      jobsCompleted: a.total_jobs_completed,
      total_jobs_disputed: a.total_jobs_disputed,
      is_active: a.is_active,
    }));
  } catch {
    return [];
  }
}
