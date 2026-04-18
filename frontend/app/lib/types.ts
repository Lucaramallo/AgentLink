export interface Agent {
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
}

export type SessionRole = "Requester" | "Contributor" | "Reviewer" | "Observer";

export interface SessionAgent {
  agent: Agent;
  role: SessionRole;
}
