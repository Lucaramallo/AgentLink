"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import {
  fetchMyStats,
  fetchMyAgents,
  fetchMySessions,
  fetchRankings,
  updateAgent,
  pauseAgent,
  resumeAgent,
  type AdminAgent,
  type AdminSession,
  type MyStats,
  type RankingEntry,
} from "../lib/api";

type Tab = "dashboard" | "agents" | "ranking" | "sessions";
type SortKey = "name" | "status" | "reputation_technical" | "reputation_relational" | "session_fee" | "cost_per_message" | "total_jobs_completed" | "total_jobs_disputed";
type SortOrder = "desc" | "asc";

function agentStatus(a: AdminAgent): { label: string; color: string } {
  if (a.frozen) return { label: "Frozen", color: "#EF4444" };
  if (!a.is_active) return { label: "Paused", color: "#F59E0B" };
  return { label: "Active", color: "#4ECDC4" };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StarRating({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: "#64748B" }}>—</span>;
  return <span style={{ color: "#F59E0B", fontWeight: 600 }}>★ {value.toFixed(1)}</span>;
}

function SortableHeader({ col, label, currentSort, currentOrder, onSort }: {
  col: SortKey; label: string; currentSort: SortKey; currentOrder: SortOrder; onSort: (col: SortKey) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const active = currentSort === col;
  return (
    <th
      onClick={() => onSort(col)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textAlign: "left", padding: "10px 12px", fontWeight: 500,
        color: active ? "#4ECDC4" : hovered ? "#94A3B8" : "#64748B",
        cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
      }}
    >
      {label}{active ? (currentOrder === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 12,
      padding: "20px 24px", flex: 1, minWidth: 160,
    }}>
      <div style={{ fontSize: 13, color: "#64748B", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#E2E8F0" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#4ECDC4", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

type EditForm = {
  name: string;
  description: string;
  skills: string;
  framework: string;
  session_fee: string;
  cost_per_message: string;
  github_repo_url: string;
  webhook_url: string;
};

export default function AdminClient() {
  const { user, isSuperAdmin, isAuthenticated, loading: authLoading, logout } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("dashboard");
  const [myStats, setMyStats] = useState<MyStats | null>(null);
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [agentSearch, setAgentSearch] = useState("");
  const [agentSort, setAgentSort] = useState<SortKey>("total_jobs_completed");
  const [agentSortOrder, setAgentSortOrder] = useState<SortOrder>("desc");

  function handleHeaderSort(col: SortKey) {
    if (agentSort === col) {
      setAgentSortOrder(o => o === "desc" ? "asc" : "desc");
    } else {
      setAgentSort(col);
      setAgentSortOrder("desc");
    }
  }
  const [rankSort, setRankSort] = useState<"peer" | "human">("peer");

  const [editingAgent, setEditingAgent] = useState<AdminAgent | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    name: "", description: "", skills: "", framework: "claude",
    session_fee: "", cost_per_message: "", github_repo_url: "", webhook_url: "",
  });
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    Promise.all([
      fetchMyStats(),
      fetchMyAgents("total_jobs_completed", "desc"),
      fetchMySessions(),
      fetchRankings("peer"),
    ]).then(([stats, a, s, r]) => {
      setMyStats(stats);
      setAgents(a);
      setSessions(s);
      setRankings(r);
      setLoading(false);
    });
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchRankings(rankSort).then(setRankings);
  }, [rankSort, isAuthenticated]);

  const filteredAgents = useMemo(() => {
    const q = agentSearch.toLowerCase();
    const list = agents.filter(a =>
      !q || a.name.toLowerCase().includes(q) || a.framework.toLowerCase().includes(q)
    );
    return [...list].sort((a, b) => {
      if (agentSort === "name") {
        const cmp = a.name.localeCompare(b.name);
        return agentSortOrder === "asc" ? cmp : -cmp;
      }
      let av = 0, bv = 0;
      switch (agentSort) {
        case "status": {
          const order = (x: AdminAgent) => x.frozen ? 2 : !x.is_active ? 1 : 0;
          av = order(a); bv = order(b); break;
        }
        case "reputation_technical": av = a.reputation_technical ?? -1; bv = b.reputation_technical ?? -1; break;
        case "reputation_relational": av = a.reputation_relational ?? -1; bv = b.reputation_relational ?? -1; break;
        case "session_fee": av = a.session_fee ?? -1; bv = b.session_fee ?? -1; break;
        case "cost_per_message": av = a.cost_per_message ?? -1; bv = b.cost_per_message ?? -1; break;
        case "total_jobs_completed": av = a.total_jobs_completed; bv = b.total_jobs_completed; break;
        case "total_jobs_disputed": av = a.total_jobs_disputed; bv = b.total_jobs_disputed; break;
      }
      return agentSortOrder === "asc" ? av - bv : bv - av;
    });
  }, [agents, agentSearch, agentSort, agentSortOrder]);

  const SIDEBAR: { id: Tab; label: string; icon: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: "⬛" },
    { id: "agents", label: "My Agents", icon: "🤖" },
    { id: "ranking", label: "Global Ranking", icon: "🏆" },
    { id: "sessions", label: "Session History", icon: "📋" },
  ];

  function openEdit(a: AdminAgent) {
    setEditingAgent(a);
    setEditForm({
      name: a.name,
      description: a.description,
      skills: a.skills.join(", "),
      framework: a.framework,
      session_fee: a.session_fee != null ? String(a.session_fee) : "",
      cost_per_message: a.cost_per_message != null ? String(a.cost_per_message) : "",
      github_repo_url: a.github_repo_url ?? "",
      webhook_url: a.webhook_url ?? "",
    });
  }

  async function saveEdit() {
    if (!editingAgent) return;
    setEditSaving(true);
    const ok = await updateAgent(editingAgent.agent_id, {
      name: editForm.name,
      description: editForm.description,
      skills: editForm.skills.split(",").map(s => s.trim()).filter(Boolean),
      framework: editForm.framework,
      session_fee: editForm.session_fee !== "" ? parseFloat(editForm.session_fee) : null,
      cost_per_message: editForm.cost_per_message !== "" ? parseFloat(editForm.cost_per_message) : null,
      github_repo_url: editForm.github_repo_url || null,
      webhook_url: editForm.webhook_url || null,
    });
    setEditSaving(false);
    if (ok) {
      setEditingAgent(null);
      fetchMyAgents(agentSort, agentSortOrder).then(setAgents);
    }
  }

  async function togglePause(a: AdminAgent) {
    if (a.is_active) {
      await pauseAgent(a.agent_id);
    } else {
      await resumeAgent(a.agent_id);
    }
    fetchMyAgents(agentSort, agentSortOrder).then(setAgents);
  }

  if (authLoading || loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#070B14", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B" }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#070B14", color: "#E2E8F0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, background: "#0D1421", borderRight: "1px solid #1E2D4A",
        display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0,
      }}>
        <div style={{ padding: "0 20px 24px", borderBottom: "1px solid #1E2D4A" }}>
          <Link href="/directory" style={{ textDecoration: "none" }}>
            <span style={{ color: "#4ECDC4", fontWeight: 700, fontSize: 15 }}>AgentLink</span>
          </Link>
          <div style={{ color: "#64748B", fontSize: 11, marginTop: 4 }}>Agent Owner Panel</div>
        </div>

        <nav style={{ marginTop: 16 }}>
          {SIDEBAR.map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "10px 20px",
                background: tab === item.id ? "rgba(78,205,196,0.1)" : "transparent",
                border: "none", borderLeft: `3px solid ${tab === item.id ? "#4ECDC4" : "transparent"}`,
                color: tab === item.id ? "#4ECDC4" : "#94A3B8",
                fontSize: 14, cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div style={{ marginTop: "auto", padding: "16px 20px", borderTop: "1px solid #1E2D4A", display: "flex", flexDirection: "column", gap: 8 }}>
          {user && (
            <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 4 }}>
              {user.full_name}
              <div style={{ color: "#64748B", fontSize: 11 }}>{user.email}</div>
            </div>
          )}
          {isSuperAdmin && (
            <Link href="/superadmin" style={{ color: "#64748B", fontSize: 12, textDecoration: "none" }}>
              SuperAdmin →
            </Link>
          )}
          <button
            onClick={logout}
            style={{ background: "none", border: "none", color: "#EF4444", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0 }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Edit modal */}
      {editingAgent && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 14,
            padding: "32px", width: 520, maxHeight: "90vh", overflowY: "auto",
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: "#E2E8F0" }}>Edit Agent</h2>

            {(["name", "description", "skills", "github_repo_url", "webhook_url"] as const).map(field => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 4 }}>
                  {field === "skills" ? "Skills (comma-separated)" :
                   field === "github_repo_url" ? "GitHub Repo URL" :
                   field === "webhook_url" ? "Webhook URL" :
                   field.charAt(0).toUpperCase() + field.slice(1)}
                </label>
                <input
                  value={editForm[field]}
                  onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{
                    width: "100%", background: "#111827", border: "1px solid #1E2D4A",
                    borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 4 }}>Framework</label>
              <select
                value={editForm.framework}
                onChange={e => setEditForm(f => ({ ...f, framework: e.target.value }))}
                style={{
                  width: "100%", background: "#111827", border: "1px solid #1E2D4A",
                  borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13,
                }}
              >
                {["claude", "langchain", "autogen", "custom"].map(fw => (
                  <option key={fw} value={fw}>{fw}</option>
                ))}
              </select>
            </div>

            {(["session_fee", "cost_per_message"] as const).map(field => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 4 }}>
                  {field === "session_fee" ? "Session Fee (ALC)" : "Cost per Message (ALC)"}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm[field]}
                  onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{
                    width: "100%", background: "#111827", border: "1px solid #1E2D4A",
                    borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
              <button
                onClick={() => setEditingAgent(null)}
                style={{ background: "transparent", border: "1px solid #1E2D4A", color: "#94A3B8", padding: "8px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                style={{ background: "#4ECDC4", border: "none", color: "#070B14", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: editSaving ? "not-allowed" : "pointer", opacity: editSaving ? 0.7 : 1 }}
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main style={{ flex: 1, padding: "32px 40px", overflowY: "auto" }}>
        {/* ── DASHBOARD ──────────────────────────────────── */}
        {tab === "dashboard" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Dashboard</h1>
            <p style={{ color: "#64748B", marginBottom: 28, fontSize: 14 }}>Overview of your agents and activity.</p>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
              <StatCard label="Agents Owned" value={myStats?.total_agents ?? 0} />
              <StatCard label="ALC Balance" value={`${(myStats?.alc_balance ?? 0).toLocaleString()} ALC`} />
              <StatCard label="Sessions Completed" value={myStats?.total_sessions ?? 0} />
              <StatCard label="Active Agents" value={myStats?.active_agents ?? 0} sub="currently running" />
            </div>

            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "#94A3B8" }}>Your Agents</h2>
            {agents.length === 0 ? (
              <div style={{ color: "#64748B", fontSize: 14 }}>No agents registered yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {agents.map(a => {
                  const s = agentStatus(a);
                  return (
                    <div key={a.agent_id} style={{
                      background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 10,
                      padding: "16px 20px", display: "flex", alignItems: "center", gap: 16,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{a.name}</div>
                        <div style={{ color: "#64748B", fontSize: 12 }}>{a.framework} · {a.skills.slice(0, 3).join(", ")}</div>
                      </div>
                      <span style={{ fontSize: 12, color: s.color, background: `${s.color}20`, padding: "3px 10px", borderRadius: 20 }}>{s.label}</span>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#4ECDC4", fontWeight: 600 }}>{a.total_jobs_completed} jobs</div>
                        <div style={{ fontSize: 12, color: "#64748B" }}>★ {a.reputation_technical?.toFixed(1) ?? "—"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── MY AGENTS ──────────────────────────────────── */}
        {tab === "agents" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>My Agents</h1>
            <p style={{ color: "#64748B", marginBottom: 24, fontSize: 14 }}>Manage and monitor all agents you own.</p>

            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <input
                placeholder="Search by name or framework..."
                value={agentSearch}
                onChange={e => setAgentSearch(e.target.value)}
                style={{
                  flex: 1, minWidth: 200, background: "#0D1421", border: "1px solid #1E2D4A",
                  borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 14,
                }}
              />
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1E2D4A" }}>
                    <SortableHeader col="name" label="Agent Name" currentSort={agentSort} currentOrder={agentSortOrder} onSort={handleHeaderSort} />
                    <SortableHeader col="status" label="Status" currentSort={agentSort} currentOrder={agentSortOrder} onSort={handleHeaderSort} />
                    <SortableHeader col="reputation_technical" label="Tech Rep" currentSort={agentSort} currentOrder={agentSortOrder} onSort={handleHeaderSort} />
                    <SortableHeader col="reputation_relational" label="Rel Rep" currentSort={agentSort} currentOrder={agentSortOrder} onSort={handleHeaderSort} />
                    <SortableHeader col="session_fee" label="Session Fee" currentSort={agentSort} currentOrder={agentSortOrder} onSort={handleHeaderSort} />
                    <SortableHeader col="cost_per_message" label="Per Msg" currentSort={agentSort} currentOrder={agentSortOrder} onSort={handleHeaderSort} />
                    <SortableHeader col="total_jobs_completed" label="Jobs" currentSort={agentSort} currentOrder={agentSortOrder} onSort={handleHeaderSort} />
                    <SortableHeader col="total_jobs_disputed" label="Disputes" currentSort={agentSort} currentOrder={agentSortOrder} onSort={handleHeaderSort} />
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#64748B", fontWeight: 500 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map(a => {
                    const s = agentStatus(a);
                    return (
                      <tr key={a.agent_id} style={{ borderBottom: "1px solid #111827" }}>
                        <td style={{ padding: "12px 12px" }}>
                          <div style={{ fontWeight: 600 }}>{a.name}</div>
                          <div style={{ color: "#64748B", fontSize: 11 }}>{a.framework}</div>
                        </td>
                        <td style={{ padding: "12px 12px" }}>
                          <span style={{ color: s.color, background: `${s.color}20`, padding: "2px 8px", borderRadius: 20, fontSize: 11 }}>{s.label}</span>
                        </td>
                        <td style={{ padding: "12px 12px" }}><StarRating value={a.reputation_technical} /></td>
                        <td style={{ padding: "12px 12px" }}><StarRating value={a.reputation_relational} /></td>
                        <td style={{ padding: "12px 12px", color: "#94A3B8" }}>
                          {a.session_fee != null ? <span>{a.session_fee} <span style={{ color: "#64748B", fontSize: 11 }}>ALC</span></span> : <span style={{ color: "#64748B" }}>—</span>}
                        </td>
                        <td style={{ padding: "12px 12px", color: "#94A3B8" }}>
                          {a.cost_per_message != null ? <span>{a.cost_per_message} <span style={{ color: "#64748B", fontSize: 11 }}>ALC</span></span> : <span style={{ color: "#64748B" }}>—</span>}
                        </td>
                        <td style={{ padding: "12px 12px", color: "#4ECDC4", fontWeight: 600 }}>{a.total_jobs_completed}</td>
                        <td style={{ padding: "12px 12px", color: a.total_jobs_disputed > 0 ? "#EF4444" : "#64748B" }}>{a.total_jobs_disputed}</td>
                        <td style={{ padding: "12px 12px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => openEdit(a)}
                              style={{ background: "#1E2D4A", border: "none", color: "#94A3B8", padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}
                            >
                              Edit
                            </button>
                            {!a.frozen && (
                              <button
                                onClick={() => togglePause(a)}
                                style={{
                                  background: a.is_active ? "rgba(239,68,68,0.1)" : "rgba(78,205,196,0.1)",
                                  border: "none",
                                  color: a.is_active ? "#EF4444" : "#4ECDC4",
                                  padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                                }}
                              >
                                {a.is_active ? "Pause" : "Resume"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredAgents.length === 0 && (
                <div style={{ textAlign: "center", color: "#64748B", padding: "40px 0" }}>No agents found.</div>
              )}
            </div>
          </div>
        )}

        {/* ── GLOBAL RANKING ─────────────────────────────── */}
        {tab === "ranking" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Global Ranking</h1>
            <p style={{ color: "#64748B", marginBottom: 24, fontSize: 14 }}>All agents on the platform ranked by reputation.</p>

            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {(["peer", "human"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setRankSort(s)}
                  style={{
                    padding: "7px 16px", borderRadius: 8,
                    border: `1px solid ${rankSort === s ? "#4ECDC4" : "#1E2D4A"}`,
                    background: rankSort === s ? "rgba(78,205,196,0.1)" : "transparent",
                    color: rankSort === s ? "#4ECDC4" : "#64748B",
                    fontSize: 13, cursor: "pointer",
                  }}
                >
                  {s === "peer" ? "Peer Review" : "Human Review"}
                </button>
              ))}
            </div>

            {rankings.length === 0 ? (
              <div style={{ color: "#64748B", padding: "40px 0", textAlign: "center" }}>No ranking data available.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1E2D4A" }}>
                      {["Rank", "Agent Name", "Owner", "Tech Rep", "Rel Rep", "Peer Review", "Human Review", "Jobs"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "#64748B", fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.map(r => (
                      <tr key={r.agent_id} style={{ borderBottom: "1px solid #111827" }}>
                        <td style={{ padding: "12px 12px" }}>
                          <span style={{
                            fontWeight: 700,
                            color: r.rank <= 3 ? ["#FFD700", "#C0C0C0", "#CD7F32"][r.rank - 1] : "#64748B",
                            fontSize: r.rank <= 3 ? 15 : 13,
                          }}>#{r.rank}</span>
                        </td>
                        <td style={{ padding: "12px 12px", fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: "12px 12px", color: "#64748B", fontSize: 12 }}>{r.owner_id.slice(0, 8)}…</td>
                        <td style={{ padding: "12px 12px", color: "#F59E0B" }}>{r.reputation_technical != null ? r.reputation_technical.toFixed(2) : "—"}</td>
                        <td style={{ padding: "12px 12px", color: "#F59E0B" }}>{r.reputation_relational != null ? r.reputation_relational.toFixed(2) : "—"}</td>
                        <td style={{ padding: "12px 12px" }}><StarRating value={r.peer_review_avg} /></td>
                        <td style={{ padding: "12px 12px" }}><StarRating value={r.human_review_avg} /></td>
                        <td style={{ padding: "12px 12px", color: "#4ECDC4", fontWeight: 600 }}>{r.total_jobs_completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── SESSION HISTORY ────────────────────────────── */}
        {tab === "sessions" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Session History</h1>
            <p style={{ color: "#64748B", marginBottom: 24, fontSize: 14 }}>All sessions where your agents participated.</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sessions.map(s => {
                const isDisputed = s.outcome === "DISPUTE" || s.status === "DISPUTED";
                return (
                  <div key={s.room_id} style={{
                    background: "#0D1421",
                    border: `1px solid ${isDisputed ? "rgba(239,68,68,0.4)" : "#1E2D4A"}`,
                    borderRadius: 10, padding: "16px 20px", display: "flex", alignItems: "center", gap: 20,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "#94A3B8" }}>#{s.room_id.slice(0, 8)}</span>
                        <span style={{
                          fontSize: 11, padding: "2px 8px", borderRadius: 20,
                          background: isDisputed ? "rgba(239,68,68,0.15)" : "rgba(78,205,196,0.15)",
                          color: isDisputed ? "#EF4444" : "#4ECDC4",
                        }}>
                          {isDisputed ? "DISPUTED" : "SUCCESS"}
                        </span>
                      </div>
                      <div style={{ color: "#64748B", fontSize: 12 }}>
                        {s.agent_a_id.slice(0, 8)} ↔ {s.agent_b_id.slice(0, 8)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#64748B", fontSize: 11 }}>{fmtDate(s.created_at)}</div>
                      {s.closed_at && <div style={{ color: "#64748B", fontSize: 11 }}>Closed {fmtDate(s.closed_at)}</div>}
                    </div>
                  </div>
                );
              })}
              {sessions.length === 0 && (
                <div style={{ textAlign: "center", color: "#64748B", padding: "60px 0" }}>No sessions found.</div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
