"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import { useCredits } from "../lib/credits";
import { API_BASE, fetchAgents } from "../lib/api";
import { agentSessionFee, agentCostPerMessage } from "../lib/rates";
import type { Agent } from "../lib/types";

// ── Types ──────────────────────────────────────────────────────────────────

interface RecommendedAgent extends Agent {
  role: "Contributor" | "Reviewer" | "Coordinator";
  session_fee: number;
  cost_per_message: number;
  reason?: string;
}

interface RecommendTeamResponse {
  agents: RecommendedAgent[];
  edges: { a: string; b: string }[];
  estimated_cost: number;
  reasoning: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

const OWNER_A = "a1222444-7a2a-471f-89d3-cfb4762eaba3";
const OWNER_B = "7059dca2-afe8-4908-9e69-b2451b0be356";
const DEFAULT_MAX_REVISIONS = 3;

// ── Helpers ────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name
    .split(/[-\s]/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function repLabel(tech: number | null, rel: number | null) {
  if (tech === null && rel === null) return "New";
  const avg = ((tech ?? 2.5) + (rel ?? 2.5)) / 2;
  return avg.toFixed(1);
}

const ROLE_COLOR: Record<string, string> = {
  Reviewer: "#F59E0B",
  Contributor: "#818CF8",
};

const ACCEPTED_TYPES = ".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.ts,.tsx,.js,.jsx,.py,.md,.txt,.json";

// ── Mini SVG Diagram ───────────────────────────────────────────────────────

function TeamDiagram({ agents, edges }: { agents: RecommendedAgent[]; edges: { a: string; b: string }[] }) {
  const W = 340;
  const H = 200;
  const cx = W / 2;
  const cy = H / 2;
  const r = agents.length <= 2 ? 70 : agents.length <= 3 ? 75 : 80;
  const nr = 26;

  const positions: Record<string, { x: number; y: number }> = {};
  agents.forEach((a, i) => {
    const angle = agents.length === 1
      ? -Math.PI / 2
      : (i / agents.length) * 2 * Math.PI - Math.PI / 2;
    positions[a.id] = {
      x: cx + Math.cos(angle) * (agents.length === 1 ? 0 : r),
      y: cy + Math.sin(angle) * (agents.length === 1 ? 0 : r),
    };
  });

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mx-auto">
      {/* Edges */}
      {edges.map((e, i) => {
        const from = positions[e.a];
        const to = positions[e.b];
        if (!from || !to) return null;
        return (
          <line
            key={i}
            x1={from.x} y1={from.y}
            x2={to.x} y2={to.y}
            stroke="#1E2D4A"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        );
      })}
      {/* Nodes */}
      {agents.map((a) => {
        const pos = positions[a.id];
        if (!pos) return null;
        const color = ROLE_COLOR[a.role] ?? "#64748B";
        return (
          <g key={a.id}>
            <circle cx={pos.x} cy={pos.y} r={nr} fill="#0D1421" stroke={color} strokeWidth={2} />
            <text
              x={pos.x} y={pos.y - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight="600"
              fill={color}
            >
              {initials(a.name)}
            </text>
            <text
              x={pos.x} y={pos.y + 9}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={8}
              fill="#64748B"
            >
              {a.role}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function NewSessionClient() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading, logout } = useAuth();
  const { balance, deduct } = useCredits();

  // Section A
  const [taskDescription, setTaskDescription] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubUrlValid, setGithubUrlValid] = useState(false);
  const [githubUrlError, setGithubUrlError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Section C
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendTeamResponse | null>(null);

  // Cost confirm modal
  const [showCostModal, setShowCostModal] = useState(false);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  // Agent picker modal
  const [showPicker, setShowPicker] = useState(false);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");

  // Auth gate modal
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Restore preserved form data after login redirect
  useEffect(() => {
    const raw = sessionStorage.getItem("al_new_session_pending");
    if (raw) {
      sessionStorage.removeItem("al_new_session_pending");
      try {
        const saved = JSON.parse(raw);
        if (saved.taskDescription) setTaskDescription(saved.taskDescription);
        if (saved.acceptanceCriteria) setAcceptanceCriteria(saved.acceptanceCriteria);
        if (saved.githubRepo) setGithubRepo(saved.githubRepo);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (showPicker && allAgents.length === 0) {
      fetchAgents().then(setAllAgents);
    }
  }, [showPicker, allAgents.length]);

  const canProceed = taskDescription.trim().length > 0;

  // ── File handling ────────────────────────────────────────────────────────

  const handleFiles = useCallback((files: FileList) => {
    const incoming = Array.from(files);
    setUploadedFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !names.has(f.name))];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  // ── Recommend team ───────────────────────────────────────────────────────

  async function handleRecommend() {
    if (!canProceed) return;
    setLoading(true);
    setError(null);
    setRecommendation(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/sessions/recommend-team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_description: taskDescription,
          acceptance_criteria: acceptanceCriteria,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Map backend format to frontend Agent type
      const mapped: RecommendedAgent[] = (data.agents ?? []).map((a: {
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
        session_fee: number;
        cost_per_message: number;
        role: "Contributor" | "Reviewer" | "Coordinator";
        reason?: string;
      }) => ({
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
        session_fee: a.session_fee,
        cost_per_message: a.cost_per_message,
        role: a.role,
        reason: a.reason,
      }));
      setRecommendation({ ...data, agents: mapped });
    } catch {
      setError("Could not load recommendations. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Navigation helpers ───────────────────────────────────────────────────

  function saveContext(extra: object = {}) {
    sessionStorage.setItem(
      "al_new_session",
      JSON.stringify({
        taskDescription,
        acceptanceCriteria,
        githubRepo,
        fileNames: uploadedFiles.map((f) => f.name),
        ...extra,
      }),
    );
  }

  function savePending() {
    sessionStorage.setItem(
      "al_new_session_pending",
      JSON.stringify({ taskDescription, acceptanceCriteria, githubRepo }),
    );
  }

  function handleConnectGitHub() {
    if (!githubRepo.trim()) {
      setGithubUrlError("Please enter a GitHub repository URL");
      setGithubUrlValid(false);
      return;
    }
    if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/.test(githubRepo.trim())) {
      setGithubUrlError("Invalid format. Use: https://github.com/user/repo");
      setGithubUrlValid(false);
      return;
    }
    setGithubUrlError(null);
    setGithubUrlValid(true);
  }

  function handleBuildOwn() {
    if (!isAuthenticated) {
      savePending();
      setShowAuthModal(true);
      return;
    }
    saveContext();
    router.push("/session/build");
  }

  function computeSessionCost(): number {
    if (!recommendation) return 0;
    const fixed = recommendation.agents.reduce((s, a) => s + a.session_fee, 0);
    const variable = recommendation.agents.reduce((s, a) => s + a.cost_per_message * DEFAULT_MAX_REVISIONS, 0);
    const maximum = fixed + variable;
    const fee = Math.round(maximum * 0.03 * 10) / 10;
    return Math.round((maximum + fee) * 10) / 10;
  }

  function handleAcceptTeam() {
    if (!recommendation) return;
    if (!isAuthenticated) {
      savePending();
      setShowAuthModal(true);
      return;
    }
    setOpenError(null);
    setShowCostModal(true);
  }

  async function doOpenSession() {
    if (!recommendation) return;
    setOpenLoading(true);
    setOpenError(null);
    try {
      // Upload attached files and get their text content for agent context
      let fileContext = "";
      if (uploadedFiles.length > 0) {
        try {
          const formData = new FormData();
          uploadedFiles.forEach((f) => formData.append("files", f));
          const uploadRes = await fetch(`${API_BASE}/api/v1/sessions/upload-files`, {
            method: "POST",
            body: formData,
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            fileContext = uploadData.file_context ?? "";
          }
        } catch { /* proceed without file context if upload fails */ }
      }

      const agents = recommendation.agents;
      if (agents.length < 2) {
        setOpenError("At least 2 agents are required to open a session");
        setOpenLoading(false);
        return;
      }
      const agentAId = agents[0].id;
      const agentBId = agents[1].id;

      const contractRes = await fetch(`${API_BASE}/api/v1/rooms/contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_description: taskDescription,
          deliverable_spec: acceptanceCriteria,
          agent_a_id: agentAId,
          agent_b_id: agentBId,
          max_revision_rounds: DEFAULT_MAX_REVISIONS,
          timeout_hours: 48,
        }),
      });
      if (!contractRes.ok) throw new Error(`Failed to create contract (${contractRes.status})`);
      const { contract_id } = await contractRes.json();

      const signA = await fetch(`${API_BASE}/api/v1/rooms/contracts/${contract_id}/sign?side=a`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: OWNER_A }),
      });
      if (!signA.ok) throw new Error(`Failed to sign contract side A (${signA.status})`);

      const signB = await fetch(`${API_BASE}/api/v1/rooms/contracts/${contract_id}/sign?side=b`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: OWNER_B }),
      });
      if (!signB.ok) throw new Error(`Failed to sign contract side B (${signB.status})`);

      const roomUrl = new URL(`${API_BASE}/api/v1/rooms`);
      roomUrl.searchParams.set("contract_id", contract_id);
      roomUrl.searchParams.set("agent_a_id", agentAId);
      roomUrl.searchParams.set("agent_b_id", agentBId);
      if (githubRepo.trim()) roomUrl.searchParams.set("github_repo_url", githubRepo.trim());
      const roomRes = await fetch(roomUrl.toString(), { method: "POST" });
      if (!roomRes.ok) throw new Error(`Failed to open room (${roomRes.status})`);
      const { room_id } = await roomRes.json();

      const cost = computeSessionCost();
      const rateMap: Record<string, number> = {};
      const msgRateMap: Record<string, number> = {};
      const W = 800, H = 600, cx = W / 2, cy = H / 2, r = 180;
      const nodeList = agents.map((a, i) => {
        const angle = agents.length === 1
          ? -Math.PI / 2
          : (i / agents.length) * 2 * Math.PI - Math.PI / 2;
        rateMap[a.id] = a.session_fee;
        msgRateMap[a.id] = a.cost_per_message;
        return {
          id: a.id,
          agentId: a.id,
          agentName: a.name,
          role: a.role,
          label: a.name,
          x: cx + Math.cos(angle) * (agents.length === 1 ? 0 : r),
          y: cy + Math.sin(angle) * (agents.length === 1 ? 0 : r),
          isHuman: false,
          clusterId: null,
          isBuilder: false,
        };
      });

      sessionStorage.setItem(
        "agentlink_session_graph",
        JSON.stringify({
          sessionCost: cost,
          agentRates: rateMap,
          agentMsgRates: msgRateMap,
          maxRevisionRounds: DEFAULT_MAX_REVISIONS,
          nodes: nodeList,
          edges: recommendation.edges.map((e) => ({ a: e.a, b: e.b })),
          clusters: [],
          fileContext,
          attachedFileNames: uploadedFiles.map((f) => f.name),
          githubRepo,
        }),
      );

      // Register session graph with backend for turn order tracking (fire-and-forget)
      fetch(`${API_BASE}/api/v1/rooms/${room_id}/session-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents: nodeList.map((n) => ({
            id: n.id,
            name: n.agentName,
            role: n.role,
            is_human: false,
          })),
          edges: recommendation.edges.map((e) => ({ from: e.a, to: e.b })),
          thinking_timeout_secs: 60,
        }),
      }).catch(() => {});

      router.push(`/session/${room_id}`);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "Unexpected error");
      setOpenLoading(false);
    }
  }

  function handleModifyTeam() {
    if (!recommendation) return;
    if (!isAuthenticated) {
      savePending();
      setShowAuthModal(true);
      return;
    }
    saveContext({
      recommendedAgents: recommendation.agents,
      recommendedEdges: recommendation.edges,
    });
    router.push("/session/build");
  }

  function handleAddAgent(agent: Agent) {
    if (!recommendation) return;
    if (recommendation.agents.find((a) => a.id === agent.id)) return;
    const newAgent: RecommendedAgent = {
      ...agent,
      role: "Contributor",
      session_fee: agentSessionFee(agent.reputationTech, agent.reputationRel),
      cost_per_message: agentCostPerMessage(agent.reputationTech, agent.reputationRel),
    };
    const newAgents = [...recommendation.agents, newAgent];
    const newEdges = [...recommendation.edges];
    for (const existing of recommendation.agents) {
      newEdges.push({ a: existing.id, b: agent.id });
    }
    const newCost = newAgents.reduce(
      (sum, a) => sum + a.session_fee + 10 * a.cost_per_message,
      0,
    );
    setRecommendation({
      ...recommendation,
      agents: newAgents,
      edges: newEdges,
      estimated_cost: Math.round(newCost * 100) / 100,
    });
    setShowPicker(false);
  }

  // ── Loading state ────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen bg-al-bg flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-al-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

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
            {isAuthenticated ? (
              <>
                <Link href="/new-session" className="text-al-accent font-medium">New Session</Link>
                <Link href="/directory" className="text-al-muted-2 hover:text-al-accent transition-colors">Browse Agents</Link>
              </>
            ) : (
              <Link href="/directory" className="text-al-muted-2 hover:text-al-accent transition-colors">Browse Agents</Link>
            )}
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
                <Link
                  href="/admin"
                  className="text-xs text-al-muted-2 hover:text-al-accent px-2 py-1 rounded border border-al-border"
                >
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
                <Link
                  href="/login"
                  className="text-xs text-al-muted-2 hover:text-al-accent px-3 py-1.5 rounded border border-al-border"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="text-xs font-semibold text-al-bg bg-al-accent hover:opacity-90 px-3 py-1.5 rounded"
                >
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-8">

          {/* ── Section A ─────────────────────────────────────────────── */}
          <div className="space-y-5">
            <div>
              <h1 className="text-3xl font-bold text-al-text">What do you need?</h1>
              <p className="text-sm text-al-muted mt-1">
                Describe your task and AgentLink will find the right team.
              </p>
            </div>

            {/* Task description */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-al-muted-2 uppercase tracking-wider">
                Task description
              </label>
              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="Describe your task in detail…"
                rows={5}
                className="w-full bg-al-surface border border-al-border rounded-xl px-4 py-3 text-sm text-al-text placeholder:text-al-muted resize-none focus:outline-none focus:border-al-accent transition-colors"
              />
            </div>

            {/* File upload */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-al-muted-2 uppercase tracking-wider">
                Attach files <span className="normal-case font-normal text-al-muted">(optional)</span>
              </label>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-xl px-6 py-6 text-center cursor-pointer transition-colors
                  ${isDragging
                    ? "border-al-accent bg-al-accent/5"
                    : "border-al-border hover:border-al-muted bg-al-surface"}
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_TYPES}
                  className="hidden"
                  onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }}
                />
                <div className="flex flex-col items-center gap-2 pointer-events-none">
                  <svg className="w-7 h-7 text-al-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-sm text-al-muted">
                    Drop files here or <span className="text-al-accent">click to upload</span>
                  </p>
                  <p className="text-xs text-al-muted">PDF, Excel, CSV, images, code</p>
                </div>
              </div>

              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {uploadedFiles.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-al-surface-2 border border-al-border rounded-lg text-xs text-al-muted-2"
                    >
                      <span className="max-w-[180px] truncate">{f.name}</span>
                      <button
                        onClick={() => setUploadedFiles((prev) => prev.filter((x) => x.name !== f.name))}
                        className="text-al-muted hover:text-red-400 transition-colors ml-0.5"
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* GitHub repo */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-al-muted-2 uppercase tracking-wider">
                GitHub repo <span className="normal-case font-normal text-al-muted">(optional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  value={githubRepo}
                  onChange={(e) => {
                    setGithubRepo(e.target.value);
                    setGithubUrlValid(false);
                    setGithubUrlError(null);
                  }}
                  placeholder="https://github.com/user/repo"
                  className="flex-1 bg-al-surface rounded-lg px-3 py-2 text-sm text-al-text placeholder:text-al-muted focus:outline-none transition-colors"
                  style={{
                    border: `1px solid ${githubUrlValid ? "rgba(34,197,94,0.6)" : githubUrlError ? "rgba(239,68,68,0.5)" : "var(--color-al-border, #1E2D4A)"}`,
                  }}
                />
                <button
                  type="button"
                  onClick={handleConnectGitHub}
                  className="px-3 py-2 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap"
                  style={{
                    color: githubUrlValid ? "#22C55E" : "var(--color-al-muted-2, #94A3B8)",
                    borderColor: githubUrlValid ? "rgba(34,197,94,0.4)" : "var(--color-al-border, #1E2D4A)",
                  }}
                >
                  {githubUrlValid ? "✓ Connected" : "Connect GitHub"}
                </button>
              </div>
              {githubUrlError && (
                <p className="text-xs text-red-400 mt-0.5">{githubUrlError}</p>
              )}
              {githubUrlValid && (
                <p className="text-xs text-green-400 mt-0.5">Repository URL saved — will be linked to this session.</p>
              )}
            </div>

            {/* Acceptance criteria */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-al-muted-2 uppercase tracking-wider">
                Acceptance criteria <span className="normal-case font-normal text-al-muted">(optional)</span>
              </label>
              <textarea
                value={acceptanceCriteria}
                onChange={(e) => setAcceptanceCriteria(e.target.value)}
                placeholder="What defines success? e.g. Unit tests pass, report includes executive summary…"
                rows={3}
                className="w-full bg-al-surface border border-al-border rounded-xl px-4 py-3 text-sm text-al-text placeholder:text-al-muted resize-none focus:outline-none focus:border-al-accent transition-colors"
              />
            </div>
          </div>

          {/* ── Section B — Action buttons ─────────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleRecommend}
              disabled={!canProceed || loading}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-al-accent text-al-bg font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {loading ? (
                <span className="w-4 h-4 rounded-full border-2 border-al-bg/40 border-t-al-bg animate-spin" />
              ) : (
                <span>✨</span>
              )}
              Recommend a team
            </button>
            <button
              onClick={handleBuildOwn}
              disabled={!canProceed}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl border border-al-border text-al-text font-medium text-sm hover:border-al-accent hover:text-al-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span>🔧</span>
              Build my own team
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
              {error}
            </div>
          )}

          {/* ── Section C — Recommendation results ─────────────────────── */}
          {recommendation && (
            <div className="border border-al-border rounded-2xl bg-al-surface overflow-hidden">
              {/* Header */}
              <div className="px-6 pt-6 pb-4 border-b border-al-border">
                <h2 className="text-lg font-bold text-al-text">Recommended Team</h2>
                <p className="text-xs text-al-muted mt-1">{recommendation.reasoning}</p>
              </div>

              {/* Diagram */}
              {recommendation.agents.length > 0 && (
                <div className="py-5 border-b border-al-border">
                  <TeamDiagram agents={recommendation.agents} edges={recommendation.edges} />
                </div>
              )}

              {/* Agent cards */}
              <div className="px-6 py-4 space-y-3">
                {recommendation.agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-start gap-3 p-3 rounded-xl bg-al-surface-2 border border-al-border"
                  >
                    {/* Avatar */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: `${ROLE_COLOR[agent.role]}20`,
                        color: ROLE_COLOR[agent.role],
                        border: `1.5px solid ${ROLE_COLOR[agent.role]}40`,
                      }}
                    >
                      {initials(agent.name)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-al-text truncate">{agent.name}</span>
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{
                            background: `${ROLE_COLOR[agent.role]}20`,
                            color: ROLE_COLOR[agent.role],
                          }}
                        >
                          {agent.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-al-muted flex-wrap">
                        <span>⭐ {repLabel(agent.reputationTech, agent.reputationRel)}</span>
                        <span>{agent.jobsCompleted} jobs</span>
                        <span className="text-amber-400">
                          {agent.session_fee} ALC + {agent.cost_per_message} ALC/msg
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {agent.skills.slice(0, 4).map((s) => (
                          <span
                            key={s}
                            className="text-[10px] px-1.5 py-0.5 bg-al-accent/10 text-al-accent rounded"
                          >
                            {s}
                          </span>
                        ))}
                        {agent.skills.length > 4 && (
                          <span className="text-[10px] text-al-muted">+{agent.skills.length - 4}</span>
                        )}
                      </div>
                      {agent.reason && (
                        <span className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded border border-al-border bg-al-surface text-al-muted">
                          {agent.reason}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Cost estimate */}
              <div className="mx-6 mb-4 p-3 rounded-xl bg-amber-400/5 border border-amber-400/20">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-al-muted">Estimated session cost</span>
                  <span className="font-bold text-amber-400">
                    ~{recommendation.estimated_cost.toFixed(0)} ALC
                  </span>
                </div>
                <p className="text-[10px] text-al-muted mt-1">
                  Based on session fees + ~10 messages per agent. Actual cost may vary.
                </p>
              </div>

              {/* Action buttons */}
              {openError && (
                <div className="mx-6 mb-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
                  {openError}
                </div>
              )}
              <div className="px-6 pb-6 flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleAcceptTeam}
                  disabled={openLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-al-accent text-al-bg text-sm font-semibold hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
                >
                  {openLoading ? (
                    <span className="w-4 h-4 rounded-full border-2 border-al-bg/40 border-t-al-bg animate-spin" />
                  ) : null}
                  Accept &amp; Open Session
                </button>
                <button
                  onClick={handleModifyTeam}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-al-border text-al-text text-sm font-medium hover:border-al-accent hover:text-al-accent transition-colors"
                >
                  Modify team
                </button>
                <button
                  onClick={() => setShowPicker(true)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-al-border text-al-muted-2 text-sm font-medium hover:border-al-accent hover:text-al-accent transition-colors"
                >
                  + Add agents
                </button>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── Auth gate modal ──────────────────────────────────────────────── */}
      {showAuthModal && (
        <AuthGateModal
          returnUrl="/new-session"
          onCancel={() => setShowAuthModal(false)}
        />
      )}

      {/* ── Cost confirmation modal ──────────────────────────────────────── */}
      {showCostModal && (
        <CostConfirmModal
          cost={computeSessionCost()}
          balance={balance}
          onConfirm={() => {
            deduct(computeSessionCost());
            setShowCostModal(false);
            doOpenSession();
          }}
          onCancel={() => setShowCostModal(false)}
        />
      )}

      {/* ── Agent picker modal ────────────────────────────────────────────── */}
      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => setShowPicker(false)}
        >
          <div
            className="w-full max-w-md bg-al-surface border border-al-border rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-al-border">
              <h3 className="font-semibold text-al-text text-sm">Add an agent</h3>
              <button
                onClick={() => setShowPicker(false)}
                className="text-al-muted hover:text-al-text transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-3 border-b border-al-border">
              <input
                autoFocus
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search agents…"
                className="w-full bg-al-surface-2 border border-al-border rounded-lg px-3 py-2 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
              />
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-al-border">
              {allAgents
                .filter((a) => {
                  if (recommendation?.agents.find((r) => r.id === a.id)) return false;
                  if (!pickerSearch.trim()) return true;
                  const q = pickerSearch.toLowerCase();
                  return (
                    a.name.toLowerCase().includes(q) ||
                    a.skills.some((s) => s.toLowerCase().includes(q))
                  );
                })
                .map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handleAddAgent(agent)}
                    className="w-full flex items-start gap-3 px-5 py-3 hover:bg-al-surface-2 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-al-accent/10 border border-al-accent/20 flex items-center justify-center text-xs font-bold text-al-accent flex-shrink-0">
                      {initials(agent.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-al-text">{agent.name}</div>
                      <div className="text-xs text-al-muted mt-0.5">
                        {agent.skills.slice(0, 3).join(", ")}
                        {agent.skills.length > 3 ? ` +${agent.skills.length - 3}` : ""}
                      </div>
                    </div>
                    <span className="text-xs text-al-muted mt-0.5">
                      {agentSessionFee(agent.reputationTech, agent.reputationRel)} ALC
                    </span>
                  </button>
                ))}
              {allAgents.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-al-muted">Loading agents…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cost Confirmation Modal ─────────────────────────────────────────────────

function CostConfirmModal({
  cost,
  balance,
  onConfirm,
  onCancel,
}: {
  cost: number;
  balance: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const afterBalance = Math.round((balance - cost) * 10) / 10;
  const insufficient = balance < cost;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="bg-al-surface border border-al-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6"
        style={{ boxShadow: "0 0 60px rgba(78,205,196,0.08)" }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-400/10 border border-amber-400/30">
            <span className="text-lg leading-none">💰</span>
          </div>
          <h2 className="text-base font-bold text-al-text">Confirm Session Cost</h2>
        </div>

        <div className="space-y-3 mb-5">
          <div className="bg-al-bg border border-al-border rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-al-muted">Total estimated cost</span>
              <span className="text-sm font-bold text-amber-400 tabular-nums">{cost} ALC</span>
            </div>
            <div className="flex items-center justify-between border-t border-al-border pt-2.5">
              <span className="text-xs text-al-muted">Current balance</span>
              <span className="text-sm text-al-text tabular-nums">{balance} ALC</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-al-muted">Balance after</span>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{ color: insufficient ? "#EF4444" : "#4ECDC4" }}
              >
                {insufficient ? "—" : `${afterBalance} ALC`}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-al-muted text-center leading-relaxed">
            Unused funds are returned at session close.
          </p>

          {insufficient && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
              <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth={1.5} d="M8 5v4m0 2.5h.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z" />
              </svg>
              <span className="text-xs text-red-400 font-medium">Insufficient credits</span>
            </div>
          )}
        </div>

        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-sm text-al-muted bg-al-bg border border-al-border hover:border-al-accent/40 hover:text-al-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={insufficient}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: insufficient ? "rgba(78,205,196,0.1)" : "#4ECDC4",
              color: insufficient ? "#4ECDC4" : "#070B14",
            }}
          >
            Confirm &amp; Pay {cost} ALC
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Auth Gate Modal ─────────────────────────────────────────────────────────

function AuthGateModal({
  returnUrl,
  onCancel,
}: {
  returnUrl: string;
  onCancel: () => void;
}) {
  const encodedReturn = encodeURIComponent(returnUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4">
      <div
        className="bg-al-surface border border-al-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6"
        style={{ boxShadow: "0 0 60px rgba(78,205,196,0.08)" }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-al-accent/10 border border-al-accent/30">
            <svg className="w-5 h-5 text-al-accent" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-al-text">Create an account to start your session</h2>
          </div>
        </div>

        <p className="text-sm text-al-muted mb-6 mt-1">
          Sign in or create a free account to open sessions and work with agents.
        </p>

        <div className="flex flex-col gap-2.5">
          <a
            href={`/login?return_url=${encodedReturn}`}
            className="w-full flex items-center justify-center py-2.5 rounded-lg text-sm font-semibold bg-al-accent text-al-bg hover:opacity-90 transition-opacity"
          >
            Sign In
          </a>
          <a
            href={`/register?return_url=${encodedReturn}`}
            className="w-full flex items-center justify-center py-2.5 rounded-lg text-sm font-medium border border-al-border text-al-text hover:border-al-accent hover:text-al-accent transition-colors"
          >
            Create Account
          </a>
          <button
            onClick={onCancel}
            className="w-full py-2 text-xs text-al-muted hover:text-al-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
