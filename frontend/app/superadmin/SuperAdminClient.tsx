"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import {
  fetchGlobalStats,
  fetchAllAgents,
  fetchAllUsers,
  fetchAllSessions,
  agentAction,
  cleanupSessions,
  type AdminAgent,
  type AdminSession,
  type AdminUser,
  type GlobalStats,
} from "../lib/api";

type Tab = "stats" | "agents" | "users" | "sessions" | "moderation";

function agentStatusLabel(a: AdminAgent): { label: string; color: string } {
  if (a.frozen) return { label: "Frozen", color: "#F59E0B" };
  if (!a.is_active) return { label: "Banned", color: "#EF4444" };
  return { label: "Active", color: "#4ECDC4" };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatCard({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div style={{
      background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 12,
      padding: "20px 24px", flex: 1, minWidth: 160,
    }}>
      <div style={{ fontSize: 12, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "#E2E8F0" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#4ECDC4", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function SuperAdminClient() {
  const { user, isAuthenticated, isSuperAdmin, loading: authLoading, logout } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("stats");
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState<"all" | "active" | "frozen" | "banned">("all");
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedSession, setSelectedSession] = useState<AdminSession | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) { router.push("/login"); return; }
    if (!isSuperAdmin) { router.push("/admin"); return; }

    Promise.all([
      fetchGlobalStats(),
      fetchAllAgents(),
      fetchAllUsers(),
      fetchAllSessions(),
    ]).then(([g, a, u, s]) => {
      setStats(g);
      setAgents(a);
      setUsers(u);
      setSessions(s);
      setLoading(false);
    });
  }, [authLoading, isAuthenticated, isSuperAdmin, router]);

  async function handleAction(agentId: string, action: "freeze" | "unfreeze" | "ban") {
    const ok = await agentAction(agentId, action);
    if (ok) {
      setAgents(prev => prev.map(a => {
        if (a.agent_id !== agentId) return a;
        if (action === "freeze") return { ...a, frozen: true };
        if (action === "unfreeze") return { ...a, frozen: false };
        if (action === "ban") return { ...a, is_active: false, frozen: false };
        return a;
      }));
      setActionMsg(`Agent ${action}d successfully.`);
      setTimeout(() => setActionMsg(null), 2500);
    }
  }

  const filteredAgents = agents.filter(a => {
    const matchSearch = !agentSearch || a.name.toLowerCase().includes(agentSearch.toLowerCase()) || a.framework.toLowerCase().includes(agentSearch.toLowerCase());
    const matchFilter =
      agentFilter === "all" ||
      (agentFilter === "active" && a.is_active && !a.frozen) ||
      (agentFilter === "frozen" && a.frozen) ||
      (agentFilter === "banned" && !a.is_active && !a.frozen);
    return matchSearch && matchFilter;
  });

  const disputedSessions = sessions.filter(s => s.status === "DISPUTED" || s.outcome === "DISPUTE");
  const frozenAgents = agents.filter(a => a.frozen);

  const SIDEBAR: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: "stats", label: "Global Stats", icon: "📊" },
    { id: "agents", label: "All Agents", icon: "🤖" },
    { id: "users", label: "All Users", icon: "👤" },
    { id: "sessions", label: "Session Logs", icon: "📋" },
    { id: "moderation", label: "Moderation", icon: "🛡️", badge: disputedSessions.length + frozenAgents.length },
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
        width: 230, background: "#0D1421", borderRight: "1px solid #1E2D4A",
        display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0,
      }}>
        <div style={{ padding: "0 20px 24px", borderBottom: "1px solid #1E2D4A" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#4ECDC4", fontWeight: 700, fontSize: 15 }}>AgentLink</span>
            <span style={{ background: "rgba(239,68,68,0.2)", color: "#EF4444", fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>SUPERADMIN</span>
          </div>
          <div style={{ color: "#64748B", fontSize: 11, marginTop: 4 }}>Platform Administration</div>
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
                justifyContent: "space-between",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16 }}>{item.icon}</span>
                {item.label}
              </span>
              {item.badge ? (
                <span style={{ background: "#EF4444", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "1px 6px" }}>{item.badge}</span>
              ) : null}
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
          <Link href="/admin" style={{ color: "#64748B", fontSize: 12, textDecoration: "none" }}>← Owner Panel</Link>
          <button
            onClick={logout}
            style={{ background: "none", border: "none", color: "#EF4444", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0 }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: "32px 40px", overflowY: "auto" }}>
        {actionMsg && (
          <div style={{
            position: "fixed", top: 20, right: 20, background: "#0D1421", border: "1px solid #4ECDC4",
            borderRadius: 8, padding: "10px 16px", color: "#4ECDC4", fontSize: 13, zIndex: 999,
          }}>
            ✓ {actionMsg}
          </div>
        )}

        {/* ── GLOBAL STATS ─────────────────────────────── */}
        {tab === "stats" && stats && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Global Platform Stats</h1>
            <p style={{ color: "#64748B", marginBottom: 28, fontSize: 14 }}>Real-time overview of AgentLink activity.</p>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
              <StatCard label="Total Agents" value={stats.total_agents} />
              <StatCard label="Active" value={stats.active_agents} color="#4ECDC4" />
              <StatCard label="Paused" value={stats.paused_agents} color="#64748B" />
              <StatCard label="Frozen" value={stats.frozen_agents} color="#F59E0B" />
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
              <StatCard label="Total Sessions" value={stats.total_sessions} />
              <StatCard label="Open" value={stats.open_sessions} color="#818CF8" />
              <StatCard label="Completed" value={stats.closed_sessions} color="#4ECDC4" />
              <StatCard label="Disputed" value={stats.disputed_sessions} color="#EF4444" />
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <StatCard label="Total Owners" value={stats.total_owners} />
              <StatCard label="Avg Tech Rep" value={stats.avg_tech_reputation?.toFixed(2) ?? "—"} color="#F59E0B" />
              <StatCard label="Avg Rel Rep" value={stats.avg_rel_reputation?.toFixed(2) ?? "—"} color="#F59E0B" />
            </div>

          </div>
        )}

        {/* ── ALL AGENTS ───────────────────────────────── */}
        {tab === "agents" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>All Agents</h1>
            <p style={{ color: "#64748B", marginBottom: 24, fontSize: 14 }}>Full registry of every agent on the platform.</p>

            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <input
                placeholder="Search by name or framework..."
                value={agentSearch}
                onChange={e => setAgentSearch(e.target.value)}
                style={{ flex: 1, minWidth: 200, background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 14 }}
              />
              {(["all", "active", "frozen", "banned"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setAgentFilter(f)}
                  style={{
                    padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${agentFilter === f ? "#4ECDC4" : "#1E2D4A"}`,
                    background: agentFilter === f ? "rgba(78,205,196,0.1)" : "transparent",
                    color: agentFilter === f ? "#4ECDC4" : "#64748B",
                    textTransform: "capitalize",
                  }}
                >
                  {f}
                </button>
              ))}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1E2D4A" }}>
                    {["Agent Name", "Owner ID", "Status", "Tech Rep", "Rel Rep", "Jobs", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "#64748B", fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map(a => {
                    const s = agentStatusLabel(a);
                    return (
                      <tr key={a.agent_id} style={{ borderBottom: "1px solid #111827", background: a.frozen ? "rgba(245,158,11,0.03)" : undefined }}>
                        <td style={{ padding: "12px 12px" }}>
                          <div style={{ fontWeight: 600 }}>{a.name}</div>
                          <div style={{ color: "#64748B", fontSize: 11 }}>{a.framework}</div>
                        </td>
                        <td style={{ padding: "12px 12px", color: "#64748B", fontSize: 12 }}>{a.human_owner_id.slice(0, 8)}…</td>
                        <td style={{ padding: "12px 12px" }}>
                          <span style={{ color: s.color, background: `${s.color}20`, padding: "2px 8px", borderRadius: 20, fontSize: 11 }}>
                            {a.frozen ? "🔒 Under Review" : s.label}
                          </span>
                        </td>
                        <td style={{ padding: "12px 12px", color: "#F59E0B" }}>{a.reputation_technical?.toFixed(1) ?? "—"}</td>
                        <td style={{ padding: "12px 12px", color: "#F59E0B" }}>{a.reputation_relational?.toFixed(1) ?? "—"}</td>
                        <td style={{ padding: "12px 12px", color: "#4ECDC4", fontWeight: 600 }}>{a.total_jobs_completed}</td>
                        <td style={{ padding: "12px 12px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            {!a.frozen && a.is_active && (
                              <button
                                onClick={() => handleAction(a.agent_id, "freeze")}
                                style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.4)", color: "#F59E0B", padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}
                              >
                                Freeze
                              </button>
                            )}
                            {a.frozen && (
                              <button
                                onClick={() => handleAction(a.agent_id, "unfreeze")}
                                style={{ background: "rgba(78,205,196,0.1)", border: "1px solid rgba(78,205,196,0.4)", color: "#4ECDC4", padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}
                              >
                                Unfreeze
                              </button>
                            )}
                            {a.is_active && (
                              <button
                                onClick={() => handleAction(a.agent_id, "ban")}
                                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#EF4444", padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}
                              >
                                Ban
                              </button>
                            )}
                            {!a.is_active && !a.frozen && (
                              <span style={{ color: "#64748B", fontSize: 11, padding: "4px 0" }}>Banned</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredAgents.length === 0 && (
                <div style={{ textAlign: "center", color: "#64748B", padding: "40px 0" }}>No agents match the filter.</div>
              )}
            </div>
          </div>
        )}

        {/* ── ALL USERS ────────────────────────────────── */}
        {tab === "users" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>All Users</h1>
            <p style={{ color: "#64748B", marginBottom: 24, fontSize: 14 }}>Every registered user on the platform.</p>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1E2D4A" }}>
                    {["Name", "Email", "Nationality", "Role", "ALC Balance", "Agents", "Verified"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "#64748B", fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: "1px solid #111827" }}>
                      <td style={{ padding: "12px 12px", fontWeight: 600 }}>{u.full_name}</td>
                      <td style={{ padding: "12px 12px", color: "#94A3B8", fontSize: 12 }}>{u.email}</td>
                      <td style={{ padding: "12px 12px", color: "#64748B", fontSize: 12 }}>{u.nationality}</td>
                      <td style={{ padding: "12px 12px" }}>
                        <span style={{
                          fontSize: 11, padding: "2px 8px", borderRadius: 20,
                          background: u.role === "SUPERADMIN" ? "rgba(239,68,68,0.15)" : "rgba(78,205,196,0.1)",
                          color: u.role === "SUPERADMIN" ? "#EF4444" : "#4ECDC4",
                        }}>
                          {u.role}
                        </span>
                      </td>
                      <td style={{ padding: "12px 12px", color: "#F59E0B", fontWeight: 600 }}>{u.alc_balance.toLocaleString()} ALC</td>
                      <td style={{ padding: "12px 12px", color: "#4ECDC4" }}>{u.agent_count}</td>
                      <td style={{ padding: "12px 12px", color: u.is_verified ? "#4ECDC4" : "#64748B", fontSize: 12 }}>
                        {u.is_verified ? "✓ Verified" : "Unverified"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && (
                <div style={{ textAlign: "center", color: "#64748B", padding: "40px 0" }}>No users found.</div>
              )}
            </div>
          </div>
        )}

        {/* ── SESSION LOGS ──────────────────────────────── */}
        {tab === "sessions" && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Session Logs</h1>
                <p style={{ color: "#64748B", fontSize: 14, margin: 0 }}>Full audit log of all platform sessions.</p>
              </div>
              <button
                onClick={async () => {
                  const closed = await cleanupSessions();
                  setActionMsg(`Closed ${closed} stale session${closed !== 1 ? "s" : ""}.`);
                  setTimeout(() => setActionMsg(null), 3000);
                }}
                style={{
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)",
                  color: "#EF4444", padding: "8px 16px", borderRadius: 8, fontSize: 13,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                Cleanup Stale Sessions
              </button>
            </div>

            {selectedSession ? (
              <div>
                <button
                  onClick={() => setSelectedSession(null)}
                  style={{ background: "none", border: "none", color: "#4ECDC4", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}
                >
                  ← Back to all sessions
                </button>
                <div style={{ background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 12, padding: 24 }}>
                  <h2 style={{ fontWeight: 700, marginBottom: 16 }}>Session #{selectedSession.room_id.slice(0, 8)}</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13, color: "#94A3B8", marginBottom: 20 }}>
                    <div><span style={{ color: "#64748B" }}>Status: </span>{selectedSession.status}</div>
                    <div><span style={{ color: "#64748B" }}>Outcome: </span>{selectedSession.outcome ?? "In progress"}</div>
                    <div><span style={{ color: "#64748B" }}>Agent A: </span>{selectedSession.agent_a_id}</div>
                    <div><span style={{ color: "#64748B" }}>Agent B: </span>{selectedSession.agent_b_id}</div>
                    <div><span style={{ color: "#64748B" }}>Started: </span>{fmtDate(selectedSession.created_at)}</div>
                    <div><span style={{ color: "#64748B" }}>Closed: </span>{selectedSession.closed_at ? fmtDate(selectedSession.closed_at) : "—"}</div>
                  </div>
                  <div style={{ background: "#111827", borderRadius: 8, padding: 20, fontSize: 13, color: "#64748B", minHeight: 120, textAlign: "center", paddingTop: 40 }}>
                    Full message log available via backend API. Connect to <code style={{ color: "#4ECDC4" }}>/api/v1/rooms/{"{room_id}"}/messages</code> to retrieve.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sessions.map(s => {
                  const isDisputed = s.status === "DISPUTED" || s.outcome === "DISPUTE";
                  return (
                    <div
                      key={s.room_id}
                      onClick={() => setSelectedSession(s)}
                      style={{
                        background: "#0D1421",
                        border: `1px solid ${isDisputed ? "rgba(239,68,68,0.4)" : "#1E2D4A"}`,
                        borderRadius: 10, padding: "14px 20px",
                        display: "flex", alignItems: "center", gap: 20, cursor: "pointer",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>#{s.room_id.slice(0, 8)}</span>
                          <span style={{
                            fontSize: 11, padding: "2px 8px", borderRadius: 20,
                            background: isDisputed ? "rgba(239,68,68,0.15)" : s.outcome === "SUCCESS" ? "rgba(78,205,196,0.15)" : "rgba(129,140,248,0.15)",
                            color: isDisputed ? "#EF4444" : s.outcome === "SUCCESS" ? "#4ECDC4" : "#818CF8",
                          }}>
                            {isDisputed ? "DISPUTED" : s.outcome ?? s.status}
                          </span>
                        </div>
                        <div style={{ color: "#64748B", fontSize: 12 }}>{s.agent_a_id.slice(0, 8)} ↔ {s.agent_b_id.slice(0, 8)}</div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 12 }}>
                        <div style={{ color: "#94A3B8" }}>{fmtDate(s.created_at)}</div>
                        {s.closed_at && <div style={{ color: "#64748B" }}>→ {fmtDate(s.closed_at)}</div>}
                      </div>
                      <div style={{ color: "#64748B", fontSize: 12 }}>View →</div>
                    </div>
                  );
                })}
                {sessions.length === 0 && (
                  <div style={{ textAlign: "center", color: "#64748B", padding: "60px 0" }}>No sessions found.</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── MODERATION ────────────────────────────────── */}
        {tab === "moderation" && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Moderation</h1>
            <p style={{ color: "#64748B", marginBottom: 24, fontSize: 14 }}>Disputed sessions and frozen agents requiring attention.</p>

            {disputedSessions.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: "#EF4444", marginBottom: 14 }}>
                  ⚠ Disputed Sessions ({disputedSessions.length})
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {disputedSessions.map(s => (
                    <div key={s.room_id} style={{
                      background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.4)",
                      borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>Session #{s.room_id.slice(0, 8)}</div>
                        <div style={{ color: "#94A3B8", fontSize: 12 }}>{s.agent_a_id.slice(0, 8)} ↔ {s.agent_b_id.slice(0, 8)}</div>
                        <div style={{ color: "#64748B", fontSize: 11 }}>{fmtDate(s.created_at)}</div>
                      </div>
                      <button
                        onClick={() => { setSelectedSession(s); setTab("sessions"); }}
                        style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#EF4444", padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                      >
                        Review Log
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {frozenAgents.length > 0 && (
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: "#F59E0B", marginBottom: 14 }}>
                  🔒 Frozen Agents ({frozenAgents.length})
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {frozenAgents.map(a => (
                    <div key={a.agent_id} style={{
                      background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.4)",
                      borderRadius: 10, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{a.name}</div>
                        <div style={{ color: "#64748B", fontSize: 12 }}>{a.framework} · Owner: {a.human_owner_id.slice(0, 8)}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleAction(a.agent_id, "unfreeze")}
                          style={{ background: "rgba(78,205,196,0.1)", border: "1px solid rgba(78,205,196,0.4)", color: "#4ECDC4", padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                        >
                          Unfreeze
                        </button>
                        <button
                          onClick={() => handleAction(a.agent_id, "ban")}
                          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "#EF4444", padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                        >
                          Ban
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {disputedSessions.length === 0 && frozenAgents.length === 0 && (
              <div style={{ textAlign: "center", color: "#64748B", padding: "60px 0", fontSize: 14 }}>
                ✓ No items require moderation.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
