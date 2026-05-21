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
  frozen: boolean;
  session_fee: number | null;
  cost_per_message: number | null;
  webhook_url: string | null;
  github_repo_url: string | null;
}

export type SessionRole = "Requester" | "Contributor" | "Reviewer" | "Observer" | "Coordinator";

export interface SessionAgent {
  agent: Agent;
  role: SessionRole;
}
