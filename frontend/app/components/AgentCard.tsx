"use client";

import type { Agent } from "../lib/types";
import SkillTag from "./SkillTag";

interface AgentCardProps {
  agent: Agent;
  selected: boolean;
  onToggle: (agent: Agent) => void;
  searchSkill: string;
}

function RepScore({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[10px] text-al-muted uppercase tracking-wide">{label}</span>
        <span className="text-xs text-al-muted">—</span>
      </div>
    );
  }
  const filled = Math.round(value);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] text-al-muted uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={`text-xs ${i < filled ? "text-al-accent" : "text-al-border"}`}
          >
            ●
          </span>
        ))}
        <span className="text-xs text-al-muted-2 ml-1">{value.toFixed(1)}</span>
      </div>
    </div>
  );
}

function FrameworkBadge({ framework }: { framework: string }) {
  const colors: Record<string, string> = {
    Claude: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    LangChain: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    AutoGen: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    Custom: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  };
  const cls = colors[framework] ?? "bg-al-border/40 text-al-muted-2 border-al-border";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${cls}`}>
      {framework}
    </span>
  );
}

function AgentAvatar({ name }: { name: string }) {
  const initials = name
    .split(/[-\s]/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="w-10 h-10 rounded-full bg-al-accent/20 border border-al-accent/30 flex items-center justify-center flex-shrink-0">
      <span className="text-sm font-bold text-al-accent">{initials}</span>
    </div>
  );
}

export default function AgentCard({ agent, selected, onToggle, searchSkill }: AgentCardProps) {
  const hasHistory = agent.jobsCompleted > 0;

  return (
    <div
      onClick={() => onToggle(agent)}
      className={`
        relative flex flex-col gap-3 p-4 rounded-xl border cursor-pointer
        transition-all duration-150 select-none
        ${selected
          ? "border-al-accent bg-al-accent/5 shadow-[0_0_0_1px_theme(colors.al-accent/30)]"
          : "border-al-border bg-al-surface hover:border-al-accent/40 hover:bg-al-surface-2"
        }
      `}
    >
      {/* Selected check */}
      {selected && (
        <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-al-accent flex items-center justify-center">
          <svg className="w-3 h-3 text-al-bg" fill="none" viewBox="0 0 12 12">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 pr-6">
        <AgentAvatar name={agent.name} />
        <div className="min-w-0">
          <div className="font-semibold text-al-text truncate">{agent.name}</div>
          <FrameworkBadge framework={agent.framework} />
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-al-muted-2 leading-relaxed line-clamp-2">{agent.description}</p>

      {/* Skills */}
      <div className="flex flex-wrap gap-1.5">
        {agent.skills.map((skill) => (
          <SkillTag
            key={skill}
            skill={skill}
            highlight={searchSkill.length > 0 && skill.toLowerCase().includes(searchSkill.toLowerCase())}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-al-border/60">
        <div className="flex gap-4">
          <RepScore label="Tech" value={agent.reputationTech} />
          <RepScore label="Rel" value={agent.reputationRel} />
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] text-al-muted uppercase tracking-wide">Jobs</span>
          {hasHistory ? (
            <span className="text-sm font-semibold text-al-text">{agent.jobsCompleted}</span>
          ) : (
            <span className="text-xs text-al-muted italic">New</span>
          )}
        </div>
      </div>
    </div>
  );
}
