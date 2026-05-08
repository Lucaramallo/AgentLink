"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Agent, SessionAgent, SessionRole } from "../lib/types";
import AgentCard from "../components/AgentCard";
import BuildSessionPanel from "../components/BuildSessionPanel";
import { useAuth } from "../lib/auth";

const API_BASE = "http://192.168.0.108:8000/api/v1";

interface TeamTemplate {
  id: string;
  name: string;
  description: string | null;
  agents: Array<{ slug: string; role: SessionRole; is_human?: boolean }>;
  created_at: string;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("agentlink_token");
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });
}

const FRAMEWORKS = ["All", "Claude", "LangChain", "AutoGen", "Custom"];

interface DirectoryClientProps {
  agents: Agent[];
}

export default function DirectoryClient({ agents }: DirectoryClientProps) {
  const [searchSkill, setSearchSkill] = useState("");
  const [framework, setFramework] = useState("All");
  const [sessionAgents, setSessionAgents] = useState<SessionAgent[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
  const router = useRouter();

  // My Teams modal
  const [showTeamsModal, setShowTeamsModal] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<TeamTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  async function openTeamsModal() {
    if (!isAuthenticated) {
      router.push(`/login?return_url=${encodeURIComponent("/directory")}`);
      return;
    }
    setShowTeamsModal(true);
    setTemplatesLoading(true);
    try {
      const res = await apiFetch("/team-templates");
      if (res.ok) setSavedTemplates(await res.json());
    } catch { /* ignore */ }
    setTemplatesLoading(false);
  }

  const filtered = useMemo(() => {
    return agents.filter((a) => {
      const matchesSkill =
        searchSkill.trim() === "" ||
        a.skills.some((s) => s.toLowerCase().includes(searchSkill.toLowerCase())) ||
        a.name.toLowerCase().includes(searchSkill.toLowerCase());
      const matchesFramework = framework === "All" || a.framework === framework;
      return matchesSkill && matchesFramework;
    });
  }, [agents, searchSkill, framework]);

  function toggleAgent(agent: Agent) {
    setSessionAgents((prev) => {
      const exists = prev.find((sa) => sa.agent.id === agent.id);
      if (exists) return prev.filter((sa) => sa.agent.id !== agent.id);
      const role: SessionRole = prev.length === 0 ? "Requester" : "Contributor";
      return [...prev, { agent, role }];
    });
  }

  function changeRole(agentId: string, role: SessionRole) {
    setSessionAgents((prev) =>
      prev.map((sa) => (sa.agent.id === agentId ? { ...sa, role } : sa))
    );
  }

  function removeAgent(agentId: string) {
    setSessionAgents((prev) => prev.filter((sa) => sa.agent.id !== agentId));
  }

  const selectedIds = new Set(sessionAgents.map((sa) => sa.agent.id));

  return (
    <div className="min-h-screen bg-al-bg text-al-text flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-30 bg-al-bg/90 backdrop-blur border-b border-al-border">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/new-session" className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-al-accent flex items-center justify-center">
              <svg className="w-4 h-4 text-al-bg" fill="none" viewBox="0 0 16 16">
                <circle cx="5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="11" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 6.5l2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <span className="font-bold text-al-text tracking-tight">AgentLink</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-6 text-sm">
            {isAuthenticated && (
              <Link href="/new-session" className="text-al-muted-2 hover:text-al-accent transition-colors">New Session</Link>
            )}
            <Link href="/directory" className="text-al-accent font-medium">Browse Agents</Link>
          </nav>

          <div className="hidden sm:flex items-center gap-3">
            {isAuthenticated && user ? (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/30">
                  <span className="text-base leading-none">💰</span>
                  <span className="text-sm font-semibold text-amber-400">
                    {user.alc_balance.toLocaleString()} ALC
                  </span>
                </div>
                <span className="text-sm text-al-muted">{user.full_name}</span>
                <Link href="/admin" className="text-xs text-al-muted-2 hover:text-al-accent px-2 py-1 rounded border border-al-border">
                  My Agents
                </Link>
                <button
                  onClick={logout}
                  className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-400/30"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-xs text-al-muted-2 hover:text-al-accent px-3 py-1.5 rounded border border-al-border">
                  Login
                </Link>
                <Link href="/register" className="text-xs font-semibold text-al-bg bg-al-accent hover:opacity-90 px-3 py-1.5 rounded">
                  Register
                </Link>
              </>
            )}
          </div>

          {/* Mobile panel toggle */}
          <button
            className="sm:hidden flex items-center gap-1.5 text-xs text-al-muted-2 border border-al-border rounded-lg px-3 py-1.5"
            onClick={() => setPanelOpen(true)}
          >
            <span className="w-4 h-4 rounded-full bg-al-accent/20 text-al-accent text-[10px] flex items-center justify-center font-bold">
              {sessionAgents.length}
            </span>
            Session
          </button>
        </div>
      </header>

      <div className="flex flex-1 max-w-screen-2xl mx-auto w-full">
        {/* Main content */}
        <main className="flex-1 min-w-0 px-6 py-6">
          {/* Page title */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-al-text">Agent Directory</h1>
            <p className="text-sm text-al-muted mt-1">
              {agents.length} verified agents · Select to build a session
            </p>
          </div>

          {/* Search + filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6 items-start sm:items-center">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-al-muted"
                fill="none" viewBox="0 0 16 16" stroke="currentColor"
              >
                <circle cx="7" cy="7" r="4.5" strokeWidth="1.5" />
                <path d="M10.5 10.5l3 3" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search by skill or name…"
                value={searchSkill}
                onChange={(e) => setSearchSkill(e.target.value)}
                className="w-full bg-al-surface border border-al-border rounded-lg pl-9 pr-4 py-2 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
              />
              {searchSkill && (
                <button
                  onClick={() => setSearchSkill("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-al-muted hover:text-al-text"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                    <path strokeLinecap="round" strokeWidth={1.5} d="M3 3l8 8M11 3l-8 8" />
                  </svg>
                </button>
              )}
            </div>

            {/* Framework filter */}
            <div className="flex gap-1.5 flex-wrap">
              {FRAMEWORKS.map((fw) => (
                <button
                  key={fw}
                  onClick={() => setFramework(fw)}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${framework === fw
                      ? "bg-al-accent text-al-bg"
                      : "bg-al-surface border border-al-border text-al-muted-2 hover:border-al-accent/40 hover:text-al-text"
                    }
                  `}
                >
                  {fw}
                </button>
              ))}
            </div>

            {/* My Teams button */}
            <button
              onClick={openTeamsModal}
              className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-al-surface border border-al-border text-al-muted-2 hover:border-al-accent/40 hover:text-al-text transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                <rect x="2" y="3" width="12" height="10" rx="2" strokeWidth={1.5} />
                <path strokeLinecap="round" strokeWidth={1.5} d="M5 7h6M5 10h4" />
              </svg>
              My Teams
            </button>
          </div>

          {/* Results count */}
          {(searchSkill || framework !== "All") && (
            <p className="text-xs text-al-muted mb-4">
              Showing {filtered.length} of {agents.length} agents
            </p>
          )}

          {/* Agent grid */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-al-surface border border-al-border flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-al-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
              </div>
              <p className="text-al-muted-2 font-medium">No agents found</p>
              <p className="text-xs text-al-muted mt-1">Try a different skill or framework</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={selectedIds.has(agent.id)}
                  onToggle={toggleAgent}
                  searchSkill={searchSkill}
                />
              ))}
            </div>
          )}
        </main>

        {/* Sticky side panel — desktop */}
        <aside className="hidden sm:flex w-80 flex-shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] border-l border-al-border overflow-hidden flex-col">
          <BuildSessionPanel
            sessionAgents={sessionAgents}
            onRoleChange={changeRole}
            onRemove={removeAgent}
          />
        </aside>
      </div>

      {/* My Teams modal */}
      {showTeamsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-al-border bg-al-surface p-6 flex flex-col gap-4 max-h-[80vh]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-al-text">My Teams</h2>
              <button onClick={() => setShowTeamsModal(false)} className="text-al-muted hover:text-al-text transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {templatesLoading ? (
                <div className="flex items-center justify-center py-10 gap-2">
                  <svg className="w-4 h-4 animate-spin text-al-accent" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span className="text-sm text-al-muted">Loading…</span>
                </div>
              ) : savedTemplates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <svg className="w-8 h-8 text-al-border" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth={1.5} />
                    <path strokeLinecap="round" strokeWidth={1.5} d="M7 9h10M7 13h6" />
                  </svg>
                  <p className="text-sm text-al-muted font-medium">No saved teams yet.</p>
                  <p className="text-xs text-al-muted-2">Build a session and save your team.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {savedTemplates.map((t) => {
                    const agentCount = t.agents.filter((a) => !a.is_human).length;
                    const roles = [...new Set(t.agents.filter((a) => !a.is_human).map((a) => a.role))];
                    return (
                      <div key={t.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border border-al-border bg-al-bg">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-al-text truncate">{t.name}</p>
                          {t.description && (
                            <p className="text-[11px] text-al-muted-2 truncate mt-0.5">{t.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-al-muted">
                            <span>{agentCount} agent{agentCount !== 1 ? "s" : ""}</span>
                            {roles.length > 0 && (
                              <>
                                <span className="text-al-border">·</span>
                                <span>{roles.join(", ")}</span>
                              </>
                            )}
                            <span className="text-al-border">·</span>
                            <span>{new Date(t.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <Link
                          href={`/session/build?template=${t.id}`}
                          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-al-accent/15 text-al-accent border border-al-accent/30 hover:bg-al-accent/25 transition-colors whitespace-nowrap"
                          onClick={() => setShowTeamsModal(false)}
                        >
                          Load in Builder →
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile slide-over panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setPanelOpen(false)}
          />
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-al-surface border-l border-al-border flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-al-border">
              <span className="text-sm font-semibold text-al-text">Build Session</span>
              <button
                onClick={() => setPanelOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded text-al-muted hover:text-al-text"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <BuildSessionPanel
                sessionAgents={sessionAgents}
                onRoleChange={changeRole}
                onRemove={removeAgent}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
