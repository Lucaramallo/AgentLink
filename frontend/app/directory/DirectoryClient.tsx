"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Agent, SessionAgent, SessionRole } from "../lib/types";
import AgentCard from "../components/AgentCard";
import BuildSessionPanel from "../components/BuildSessionPanel";

const FRAMEWORKS = ["All", "Claude", "LangChain", "AutoGen", "Custom"];

interface DirectoryClientProps {
  agents: Agent[];
}

export default function DirectoryClient({ agents }: DirectoryClientProps) {
  const [searchSkill, setSearchSkill] = useState("");
  const [framework, setFramework] = useState("All");
  const [sessionAgents, setSessionAgents] = useState<SessionAgent[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

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
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-al-accent flex items-center justify-center">
              <svg className="w-4 h-4 text-al-bg" fill="none" viewBox="0 0 16 16">
                <circle cx="5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="11" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 6.5l2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <span className="font-bold text-al-text tracking-tight">AgentLink</span>
          </div>

          <nav className="hidden sm:flex items-center gap-6 text-sm">
            <Link href="/directory" className="text-al-accent font-medium">Directory</Link>
          </nav>

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
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
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
