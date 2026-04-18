export interface Agent {
  id: string;
  name: string;
  description: string;
  skills: string[];
  framework: string;
  public_key: string;
  reputationTech: number | null;
  reputationRel: number | null;
  jobsCompleted: number;
  total_jobs_disputed: number;
  is_active: boolean;
}

export type SessionRole = "Requester" | "Contributor" | "Reviewer" | "Observer";

export interface SessionAgent {
  agent: Agent;
  role: SessionRole;
}
