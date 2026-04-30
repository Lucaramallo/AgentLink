import type { Agent } from "./types";

export const API_BASE = "http://192.168.0.122:8000";

// ── Auth helpers ───────────────────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("agentlink_token");
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers, cache: "no-store" });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("agentlink_token");
      window.location.href = "/login";
    }
  }

  return res;
}

// ── Agents ─────────────────────────────────────────────────────────────────

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
      frozen: boolean;
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
      frozen: a.frozen,
    }));
  } catch {
    return [];
  }
}

// ── Admin types ────────────────────────────────────────────────────────────

export interface AdminAgent {
  agent_id: string;
  name: string;
  description: string;
  framework: string;
  skills: string[];
  is_active: boolean;
  frozen: boolean;
  reputation_technical: number | null;
  reputation_relational: number | null;
  total_jobs_completed: number;
  total_jobs_disputed: number;
  human_owner_id: string;
  session_fee: number | null;
  cost_per_message: number | null;
  github_repo_url: string | null;
  webhook_url: string | null;
  last_webhook_failure: string | null;
  webhook_failures_count: number;
}

export interface AdminOwner {
  owner_id: string;
  email: string;
  verified: boolean;
  agent_count: number;
  total_jobs: number;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  nationality: string;
  role: string;
  alc_balance: number;
  is_verified: boolean;
  agent_count: number;
}

export interface AdminSession {
  room_id: string;
  status: string;
  outcome: string | null;
  agent_a_id: string;
  agent_b_id: string;
  created_at: string;
  closed_at: string | null;
}

export interface GlobalStats {
  total_agents: number;
  active_agents: number;
  paused_agents: number;
  frozen_agents: number;
  total_sessions: number;
  open_sessions: number;
  closed_sessions: number;
  disputed_sessions: number;
  total_owners: number;
  avg_tech_reputation: number | null;
  avg_rel_reputation: number | null;
}

export interface MyStats {
  total_agents: number;
  active_agents: number;
  frozen_agents: number;
  total_sessions: number;
  alc_balance: number;
}

export interface RankingEntry {
  rank: number;
  agent_id: string;
  name: string;
  owner_id: string;
  reputation_technical: number | null;
  reputation_relational: number | null;
  total_jobs_completed: number;
  peer_review_avg: number | null;
  human_review_avg: number | null;
}

// ── Admin API ──────────────────────────────────────────────────────────────

export async function fetchMyStats(): Promise<MyStats | null> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/my-stats`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchMyAgents(sort_by?: string, sort_order?: string): Promise<AdminAgent[]> {
  try {
    const params = new URLSearchParams();
    if (sort_by) params.set("sort_by", sort_by);
    if (sort_order) params.set("sort_order", sort_order);
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await authFetch(`${API_BASE}/api/v1/admin/my-agents${query}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchMySessions(): Promise<AdminSession[]> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/my-sessions`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchRankings(sort_by: string = "peer"): Promise<RankingEntry[]> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/rankings?sort_by=${sort_by}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchGlobalStats(): Promise<GlobalStats | null> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/global-stats`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchAllAgents(): Promise<AdminAgent[]> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/all-agents`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchAllUsers(): Promise<AdminUser[]> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/all-users`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchAllSessions(): Promise<AdminSession[]> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/sessions`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function cleanupSessions(): Promise<number> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/cleanup-sessions`, { method: "POST" });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.closed ?? data.count ?? 0;
  } catch {
    return 0;
  }
}

export async function agentAction(agent_id: string, action: "freeze" | "unfreeze" | "ban"): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/agents/${agent_id}/${action}`, {
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function updateAgent(
  agent_id: string,
  data: Partial<Pick<AdminAgent, "name" | "description" | "skills" | "framework" | "session_fee" | "cost_per_message" | "github_repo_url" | "webhook_url">>
): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/agents/${agent_id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pauseAgent(agent_id: string): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/agents/${agent_id}/pause`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resumeAgent(agent_id: string): Promise<boolean> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/admin/agents/${agent_id}/resume`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

// ── GitHub OAuth ────────────────────────────────────────────────────────────

export interface GithubRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
}

export async function fetchGithubOAuthUrl(): Promise<string | null> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/auth/github`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.url ?? null;
  } catch {
    return null;
  }
}

export async function fetchGithubRepos(): Promise<GithubRepo[]> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/auth/github/repos`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export interface RegisterOwnedAgentIn {
  name: string;
  description: string;
  skills: string[];
  framework: string;
  session_fee: number | null;
  cost_per_message: number | null;
  github_repo_url: string;
  webhook_url: string | null;
}

export interface RegisterOwnedAgentOut {
  agent_id: string;
  name: string;
  private_key_b64: string;
}

export async function regenerateAgentKey(agent_id: string): Promise<{ private_key_b64: string } | null> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/agents/${agent_id}/regenerate-key`, { method: "POST" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function testAgentWebhook(agent_id: string): Promise<{ response?: string; error?: string; message?: string }> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/agents/${agent_id}/test-webhook`, { method: "POST" });
    return res.json();
  } catch {
    return { error: "network_error", message: "Could not reach the server." };
  }
}

export async function registerOwnedAgent(data: RegisterOwnedAgentIn): Promise<RegisterOwnedAgentOut | null> {
  try {
    const res = await authFetch(`${API_BASE}/api/v1/agents/register-owned`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? "Error registering agent");
    }
    return res.json();
  } catch (e) {
    throw e;
  }
}
