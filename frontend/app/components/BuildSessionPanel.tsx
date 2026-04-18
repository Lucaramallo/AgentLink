"use client";

import { useRouter } from "next/navigation";
import type { Agent, SessionAgent, SessionRole } from "../lib/types";

const ROLES: SessionRole[] = ["Requester", "Contributor", "Reviewer", "Observer"];

interface BuildSessionPanelProps {
  sessionAgents: SessionAgent[];
  onRoleChange: (agentId: string, role: SessionRole) => void;
  onRemove: (agentId: string) => void;
}

function AgentInitials({ name }: { name: string }) {
  const initials = name
    .split(/[-\s]/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="w-8 h-8 rounded-full bg-al-accent/20 border border-al-accent/30 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-al-accent">{initials}</span>
    </div>
  );
}

export default function BuildSessionPanel({ sessionAgents, onRoleChange, onRemove }: BuildSessionPanelProps) {
  const router = useRouter();
  const canNavigate = sessionAgents.length >= 1;

  function handleOpenSession() {
    const ids = sessionAgents.map((sa) => sa.agent.agent_id).join(",");
    router.push(`/session/build?agents=${ids}`);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-al-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-al-accent" />
          <h2 className="font-semibold text-al-text">Build Session</h2>
        </div>
        <p className="text-xs text-al-muted mt-1">
          {sessionAgents.length === 0
            ? "Select agents from the directory"
            : `${sessionAgents.length} agent${sessionAgents.length > 1 ? "s" : ""} selected`}
        </p>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {sessionAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <div className="w-12 h-12 rounded-full bg-al-border/30 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-al-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <p className="text-xs text-al-muted">Click agents to add them here</p>
          </div>
        ) : (
          sessionAgents.map((sa) => (
            <div
              key={sa.agent.agent_id}
              className="flex items-center gap-2 p-2 rounded-lg bg-al-bg border border-al-border hover:border-al-border/80 transition-colors"
            >
              <AgentInitials name={sa.agent.name} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-al-text truncate">{sa.agent.name}</div>
                <select
                  value={sa.role}
                  onChange={(e) => onRoleChange(sa.agent.agent_id, e.target.value as SessionRole)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5 w-full bg-al-surface border border-al-border rounded text-[11px] text-al-muted-2 px-1.5 py-0.5 focus:outline-none focus:border-al-accent cursor-pointer"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(sa.agent.agent_id); }}
                className="w-6 h-6 flex items-center justify-center rounded text-al-muted hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                aria-label="Remove agent"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>


      {/* Footer */}
      <div className="px-4 py-4 border-t border-al-border">
        <button
          onClick={handleOpenSession}
          disabled={!canNavigate}
          className={`
            w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-150
            ${canNavigate
              ? "bg-al-accent text-al-bg hover:bg-al-accent-dim active:scale-[0.98] shadow-[0_0_16px_theme(colors.al-accent/20)]"
              : "bg-al-surface border border-al-border text-al-muted cursor-not-allowed"
            }
          `}
        >
          Build Session →
        </button>
        {sessionAgents.length === 0 && (
          <p className="text-[11px] text-al-muted text-center mt-2">Select agents to continue</p>
        )}
      </div>
    </div>
  );
}
