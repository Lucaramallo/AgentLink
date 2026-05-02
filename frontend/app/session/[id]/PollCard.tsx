"use client";

import { useEffect, useRef, useState } from "react";

export interface PollVote {
  voter_id: string;
  voter_type: "agent" | "human";
  option_index: number;
  weight: number;
}

export interface PollResult {
  winning_option_index: number;
  winning_label: string;
  weighted_totals: number[];
  action_applied: boolean;
}

export interface PollType {
  poll_id: string;
  room_id: string;
  proposed_by: string;
  proposed_by_type: "agent" | "human";
  question: string;
  options: string[];
  votes: PollVote[];
  status: "OPEN" | "CLOSED" | "VETOED";
  scope: "ALL" | "CONTRIBUTORS_ONLY" | "REVIEWERS_ONLY";
  deadline_secs: number;
  action_type: string | null;
  action_params: Record<string, string> | null;
  result: PollResult | null;
  created_at: string;
  closed_at: string | null;
  signature: string;
  action_spec?: { action: string; params: Record<string, string>; winning_option: string };
}

const SCOPE_LABELS: Record<string, string> = {
  ALL: "All",
  CONTRIBUTORS_ONLY: "Contributors",
  REVIEWERS_ONLY: "Reviewers",
};

const ACTION_LABELS: Record<string, string> = {
  OPEN_ROUND: "Open extra round",
  SKIP_AGENT: "Skip agent",
  REASSIGN_BUILDER: "Reassign builder",
  CUSTOM_MESSAGE: "Custom message",
  CONSENSUS: "Consensus",
};

function useCountdown(createdAt: string, deadlineSecs: number, status: string): number {
  const [remaining, setRemaining] = useState<number>(() => {
    const elapsed = (Date.now() - new Date(createdAt).getTime()) / 1000;
    return Math.max(0, deadlineSecs - elapsed);
  });

  useEffect(() => {
    if (status !== "OPEN") return;
    const interval = setInterval(() => {
      const elapsed = (Date.now() - new Date(createdAt).getTime()) / 1000;
      setRemaining(Math.max(0, deadlineSecs - elapsed));
    }, 1000);
    return () => clearInterval(interval);
  }, [createdAt, deadlineSecs, status]);

  return remaining;
}

interface PollCardProps {
  poll: PollType;
  isHuman: boolean;
  isRequester: boolean;
  hasVoted?: boolean;
  onVote: (pollId: string, optionIndex: number) => void;
  onVeto: (pollId: string) => void;
  proposerName?: string;
}

export default function PollCard({
  poll,
  isHuman,
  isRequester,
  hasVoted = false,
  onVote,
  onVeto,
  proposerName,
}: PollCardProps) {
  const remaining = useCountdown(poll.created_at, poll.deadline_secs, poll.status);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  const weightedTotals = poll.result?.weighted_totals ?? poll.options.map((_, i) =>
    poll.votes.filter(v => v.option_index === i).reduce((s, v) => s + v.weight, 0)
  );
  const maxTotal = Math.max(...weightedTotals, 0.01);
  const totalVoters = poll.votes.length;
  const winnerIndex = poll.result?.winning_option_index ?? -1;

  const fmtSecs = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="rounded-xl border border-al-border bg-al-surface/60 overflow-hidden text-sm w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] uppercase tracking-wider text-al-muted font-semibold">
              Poll
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-al-border text-al-muted">
              {SCOPE_LABELS[poll.scope] ?? poll.scope}
            </span>
            {poll.action_type && poll.action_type !== "CONSENSUS" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-al-accent/10 text-al-accent">
                {ACTION_LABELS[poll.action_type] ?? poll.action_type}
              </span>
            )}
          </div>
          <p className="font-semibold text-al-text leading-snug">{poll.question}</p>
          {proposerName && (
            <p className="text-[11px] text-al-muted mt-0.5">
              Proposed by <span className="text-al-text">{proposerName}</span>
            </p>
          )}
        </div>

        {/* Status chip */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          {poll.status === "OPEN" && (
            <>
              <span className="flex items-center gap-1 text-[11px] text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Open
              </span>
              <span className="text-[11px] text-al-muted">{fmtSecs(remaining)}</span>
            </>
          )}
          {poll.status === "CLOSED" && (
            <span className="text-[11px] text-al-muted font-medium">Closed</span>
          )}
          {poll.status === "VETOED" && (
            <span className="text-[11px] text-red-400 font-medium">Vetoed</span>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="px-4 pb-2 space-y-2">
        {poll.options.map((opt, i) => {
          const pct = maxTotal > 0 ? (weightedTotals[i] / maxTotal) * 100 : 0;
          const isWinner = poll.status === "CLOSED" && i === winnerIndex;
          const rawCount = poll.votes.filter(v => v.option_index === i).length;

          return (
            <div key={i} className="space-y-0.5">
              <div className="flex justify-between items-center">
                <span
                  className={`text-[13px] font-medium ${
                    isWinner ? "text-al-accent" : "text-al-text"
                  }`}
                >
                  {isWinner && "✓ "}
                  {opt}
                </span>
                <span className="text-[11px] text-al-muted">
                  {weightedTotals[i].toFixed(1)} pts · {rawCount} vote{rawCount !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-al-border overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isWinner ? "bg-al-accent" : "bg-al-muted/40"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Quorum indicator */}
      <div className="px-4 pb-2">
        <span className="text-[11px] text-al-muted">
          {totalVoters} voter{totalVoters !== 1 ? "s" : ""} responded
        </span>
      </div>

      {/* Result banner */}
      {poll.status === "CLOSED" && poll.result && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-al-accent/10 border border-al-accent/20 text-[12px] text-al-accent">
          <span className="font-semibold">Result:</span> {poll.result.winning_label}
          {poll.result.action_applied && poll.action_type && (
            <span className="ml-1 text-al-muted">
              → {ACTION_LABELS[poll.action_type] ?? poll.action_type}
            </span>
          )}
        </div>
      )}

      {poll.status === "VETOED" && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[12px] text-red-400">
          Vetoed by Requester — poll result overridden.
        </div>
      )}

      {/* Human voting buttons */}
      {poll.status === "OPEN" && isHuman && !hasVoted && (
        <div className="px-4 pb-3 space-y-1">
          <p className="text-[11px] text-al-muted mb-1.5">Your vote:</p>
          <div className="flex flex-wrap gap-2">
            {poll.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => {
                  setSelectedOption(i);
                  onVote(poll.poll_id, i);
                }}
                className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition-colors ${
                  selectedOption === i
                    ? "bg-al-accent border-al-accent text-white"
                    : "bg-transparent border-al-border text-al-text hover:border-al-accent hover:text-al-accent"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

      {poll.status === "OPEN" && isHuman && hasVoted && (
        <div className="px-4 pb-3 text-[11px] text-al-muted">Your vote has been recorded.</div>
      )}

      {/* Requester veto */}
      {poll.status === "OPEN" && isRequester && (
        <div className="px-4 pb-3 flex justify-end">
          <button
            onClick={() => onVeto(poll.poll_id)}
            className="px-3 py-1 rounded-lg text-[12px] font-medium border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Veto
          </button>
        </div>
      )}
    </div>
  );
}
