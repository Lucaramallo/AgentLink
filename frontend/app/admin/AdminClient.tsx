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
  type AdminAgent,
  type AdminSession,
  type MyStats,
  type RankingEntry,
} from "../lib/api";

type Tab = "dashboard" | "agents" | "ranking" | "sessions";
type SortKey = "total_jobs_completed" | "reputation_technical" | "reputation_relational" | "alc_earned";
type SortOrder = "desc" | "asc";

function agentStatus(a: AdminAgent): { label: string; color: string } {
  if (a.frozen) return { label: "Frozen", color: "#F59E0B" };
  if (!a.is_active) return { label: "Paused", color: "#64748B" };
  return { label: "Active", color: "#4ECDC4" };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StarRating({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: "#64748B" }}>—</span>;
  return <span style={{ color: "#F59E0B", fontWeight: 600 }}>★ {value.toFixed(1)}</span>;
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

export default function AdminClient() {
  const { user, isAuthenticated, loading: authLoading, logout } = useAuth();
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
  const [rankSort, setRankSort] = useState<"peer" | "human">("peer");

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

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMyAgents(agentSort, agentSortOrder).then(setAgents);
  }, [agentSort, agentSortOrder, isAuthenticated]);

  const filteredAgents = useMemo(() => {
    const q = agentSearch.toLowerCase();
    return agents.filter(a =>
      !q || a.name.toLowerCase().includes(q) || a.framework.toLowerCase().includes(q)
    );
  }, [agents, agentSearch]);

  const SIDEBAR: { id: Tab; label: string; icon: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: "⬛" },
    { id: "agents", label: "My Agents", icon: "🤖" },
    { id: "ranking", label: "Global Ranking", icon: "🏆" },
    { id: "sessions", label: "Session History", icon: "📋" },
  ];

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
          <Link href="/superadmin" style={{ color: "#64748B", fontSize: 12, textDecoration: "none" }}>
            SuperAdmin →
          </Link>
          <button
            onClick={logout}
            style={{ background: "none", border: "none", color: "#EF4444", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0 }}
          >
            Logout
          </button>
        </div>
      </aside>

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
              <select
                value={agentSort}
                onChange={e => setAgentSort(e.target.value as SortKey)}
                style={{ background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#94A3B8", fontSize: 13, cursor: "pointer" }}
              >
                <option value="total_jobs_completed">Sort: Jobs</option>
                <option value="reputation_technical">Sort: Tech Rep</option>
                <option value="reputation_relational">Sort: Rel Rep</option>
                <option value="alc_earned">Sort: ALC Earned</option>
              </select>
              <button
                onClick={() => setAgentSortOrder(o => o === "desc" ? "asc" : "desc")}
                style={{
                  background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 8,
                  padding: "8px 12px", color: "#94A3B8", fontSize: 13, cursor: "pointer",
                  minWidth: 42, textAlign: "center",
                }}
                title={agentSortOrder === "desc" ? "Descending" : "Ascending"}
              >
                {agentSortOrder === "desc" ? "↓" : "↑"}
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1E2D4A" }}>
                    {["Agent Name", "Status", "Tech Rep", "Rel Rep", "Jobs", "Disputes", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "#64748B", fontWeight: 500 }}>{h}</th>
                    ))}
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
                        <td style={{ padding: "12px 12px", color: "#4ECDC4", fontWeight: 600 }}>{a.total_jobs_completed}</td>
                        <td style={{ padding: "12px 12px", color: a.total_jobs_disputed > 0 ? "#EF4444" : "#64748B" }}>{a.total_jobs_disputed}</td>
                        <td style={{ padding: "12px 12px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button style={{ background: "#1E2D4A", border: "none", color: "#94A3B8", padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
                              Edit
                            </button>
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
