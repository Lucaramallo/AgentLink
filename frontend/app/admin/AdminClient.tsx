"use client";

import { useEffect, useState, useMemo, useRef } from "react";
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
  fetchGithubOAuthUrl,
  fetchGithubRepos,
  registerOwnedAgent,
  regenerateAgentKey,
  testAgentWebhook,
  resetAgentFailures,
  authFetch,
  API_BASE,
  type AdminAgent,
  type AdminSession,
  type MyStats,
  type RankingEntry,
  type GithubRepo,
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
  const { user, isSuperAdmin, isAuthenticated, loading: authLoading, logout, login, token } = useAuth();
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

  // Register Agent modal state
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [githubReposLoaded, setGithubReposLoaded] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    name: "", description: "", skills: "", framework: "claude",
    session_fee: "", cost_per_message: "", github_repo_url: "", webhook_url: "",
  });
  const [registerSaving, setRegisterSaving] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);
  const [registerOauthLoading, setRegisterOauthLoading] = useState(false);

  const pendingRegisterRef = useRef(false);
  const submitRegisterAgentRef = useRef<() => Promise<void>>(async () => {});
  const registerFormRef = useRef(registerForm);

  const [regenConfirmAgent, setRegenConfirmAgent] = useState<AdminAgent | null>(null);
  const [regenNewKey, setRegenNewKey] = useState<string | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);

  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [resettingFailuresId, setResettingFailuresId] = useState<string | null>(null);

  // GitHub Integration section state
  const [githubOauthLoading, setGithubOauthLoading] = useState(false);
  const [githubOauthError, setGithubOauthError] = useState<string | null>(null);
  const [githubDisconnecting, setGithubDisconnecting] = useState(false);

  // Account Settings section state
  const [settingsForm, setSettingsForm] = useState({ displayName: "", currentPassword: "", newPassword: "", confirmPassword: "" });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);

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
    if (user?.full_name) setSettingsForm(f => ({ ...f, displayName: user.full_name }));
  }, [user?.full_name]);

  // Keep refs pointing at latest closures on every render.
  useEffect(() => { submitRegisterAgentRef.current = submitRegisterAgent; });
  useEffect(() => { registerFormRef.current = registerForm; });

  useEffect(() => {
    function handleGithubMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "github-oauth-success") {
        if (e.data.token && e.data.user) login(e.data.token as string, e.data.user);
        setGithubOauthLoading(false);
        setGithubOauthError(null);
        if (pendingRegisterRef.current) {
          pendingRegisterRef.current = false;
          setRegisterOauthLoading(false);
          if (registerFormRef.current.name) {
            if (registerFormRef.current.github_repo_url) {
              submitRegisterAgentRef.current();
            } else {
              fetchGithubRepos().then(repos => {
                setGithubRepos(repos);
                setGithubReposLoaded(true);
                if (repos.length > 0) {
                  const firstUrl = repos[0].html_url;
                  registerFormRef.current = { ...registerFormRef.current, github_repo_url: firstUrl };
                  setRegisterForm(f => ({ ...f, github_repo_url: firstUrl }));
                  submitRegisterAgentRef.current();
                } else {
                  setRegisterError("No GitHub repos found. Please enter your repo URL and register manually.");
                }
              });
            }
          }
        }
      } else if (e.data?.type === "github-oauth-error") {
        setGithubOauthError((e.data.error as string | undefined) ?? "OAuth failed.");
        setGithubOauthLoading(false);
        if (pendingRegisterRef.current) {
          pendingRegisterRef.current = false;
          setRegisterOauthLoading(false);
          setRegisterError("GitHub connection failed. Please try again.");
        }
      }
    }
    window.addEventListener("message", handleGithubMessage);
    return () => window.removeEventListener("message", handleGithubMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function connectGithub() {
    const url = await fetchGithubOAuthUrl();
    if (url) window.location.href = url;
  }

  async function connectGithubPopup() {
    setGithubOauthLoading(true);
    setGithubOauthError(null);
    try {
      const url = await fetchGithubOAuthUrl();
      if (!url) throw new Error("Could not start GitHub OAuth.");
      const popup = window.open(url, "github-oauth", "width=600,height=700,left=300,top=100");
      if (!popup) throw new Error("Popup blocked. Allow popups for this site and try again.");
    } catch (err) {
      setGithubOauthError(err instanceof Error ? err.message : "OAuth failed.");
      setGithubOauthLoading(false);
    }
  }

  function closeRegisterModal() {
    setShowRegisterModal(false);
    pendingRegisterRef.current = false;
    setRegisterOauthLoading(false);
  }

  async function connectGithubForRegister() {
    pendingRegisterRef.current = true;
    setRegisterOauthLoading(true);
    setRegisterError(null);
    // Open popup synchronously before any await so browsers allow it, then navigate.
    const popup = window.open("", "github-oauth", "width=600,height=700,left=300,top=100");
    try {
      const url = await fetchGithubOAuthUrl();
      if (!url) throw new Error("Could not start GitHub OAuth.");
      if (popup) {
        popup.location.href = url;
      } else {
        throw new Error("Popup blocked. Allow popups for this site and try again.");
      }
    } catch (err) {
      if (popup) popup.close();
      pendingRegisterRef.current = false;
      setRegisterError(err instanceof Error ? err.message : "OAuth failed.");
      setRegisterOauthLoading(false);
    }
  }

  async function disconnectGithub() {
    setGithubDisconnecting(true);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/auth/github`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to disconnect GitHub.");
      const data = await res.json() as { token: string; user: Parameters<typeof login>[1] };
      login(data.token, data.user);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to disconnect GitHub.", false);
    } finally {
      setGithubDisconnecting(false);
    }
  }

  async function saveSettings() {
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(null);
    try {
      if (settingsForm.newPassword && !settingsForm.currentPassword) {
        throw new Error("Enter your current password to set a new one.");
      }
      if (settingsForm.newPassword && settingsForm.newPassword !== settingsForm.confirmPassword) {
        throw new Error("New passwords do not match.");
      }
      const body: Record<string, string> = {};
      if (settingsForm.displayName.trim()) body.full_name = settingsForm.displayName.trim();
      if (settingsForm.currentPassword && settingsForm.newPassword) {
        body.current_password = settingsForm.currentPassword;
        body.new_password = settingsForm.newPassword;
      }
      const res = await authFetch(`${API_BASE}/api/v1/auth/me`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? "Failed to save settings.");
      }
      const updatedUser = await res.json() as Parameters<typeof login>[1];
      if (token) login(token, updatedUser);
      setSettingsSuccess("Settings saved.");
      setSettingsForm(f => ({ ...f, currentPassword: "", newPassword: "", confirmPassword: "" }));
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function openRegisterModal() {
    setRegisterError(null);
    setRegisterSuccess(null);
    setRegisterForm({ name: "", description: "", skills: "", framework: "claude", session_fee: "", cost_per_message: "", github_repo_url: "", webhook_url: "" });
    setGithubReposLoaded(false);
    setShowRegisterModal(true);
    const repos = await fetchGithubRepos();
    setGithubRepos(repos);
    setGithubReposLoaded(true);
    if (repos.length > 0) {
      setRegisterForm(f => ({ ...f, github_repo_url: repos[0].html_url }));
    }
  }

  async function submitRegisterAgent() {
    const form = registerFormRef.current;
    setRegisterSaving(true);
    setRegisterError(null);
    try {
      const result = await registerOwnedAgent({
        name: form.name,
        description: form.description,
        skills: form.skills.split(",").map(s => s.trim()).filter(Boolean),
        framework: form.framework,
        session_fee: form.session_fee !== "" ? parseFloat(form.session_fee) : null,
        cost_per_message: form.cost_per_message !== "" ? parseFloat(form.cost_per_message) : null,
        github_repo_url: form.github_repo_url,
        webhook_url: form.webhook_url || null,
      });
      if (result) {
        setRegisterSuccess(`Agent registered! Save your private key — shown only once:\n${result.private_key_b64}`);
        fetchMyAgents(agentSort, agentSortOrder).then(setAgents);
      }
    } catch (e: unknown) {
      setRegisterError(e instanceof Error ? e.message : "Error registering agent");
    } finally {
      setRegisterSaving(false);
    }
  }

  async function confirmRegenKey() {
    if (!regenConfirmAgent) return;
    setRegenLoading(true);
    const result = await regenerateAgentKey(regenConfirmAgent.agent_id);
    setRegenLoading(false);
    setRegenConfirmAgent(null);
    if (result) setRegenNewKey(result.private_key_b64);
  }

  function showToast(message: string, ok: boolean) {
    setToast({ message, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleTestWebhook(a: AdminAgent) {
    setTestingWebhookId(a.agent_id);
    const result = await testAgentWebhook(a.agent_id);
    setTestingWebhookId(null);
    if (result.error) {
      showToast(`Webhook failed — ${result.message ?? result.error}`, false);
    } else {
      showToast("Webhook OK — agent responded", true);
    }
    fetchMyAgents(agentSort, agentSortOrder).then(setAgents);
  }

  async function handleResetFailures(a: AdminAgent) {
    setResettingFailuresId(a.agent_id);
    const ok = await resetAgentFailures(a.agent_id);
    setResettingFailuresId(null);
    showToast(ok ? "Failures reset — agent reactivated" : "Failed to reset failures", ok);
    if (ok) fetchMyAgents(agentSort, agentSortOrder).then(setAgents);
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

  const githubConnected = !!user?.github_username;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#070B14", color: "#E2E8F0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 999,
          background: toast.ok ? "rgba(78,205,196,0.15)" : "rgba(239,68,68,0.15)",
          border: `1px solid ${toast.ok ? "#4ECDC4" : "#EF4444"}`,
          color: toast.ok ? "#4ECDC4" : "#EF4444",
          borderRadius: 10, padding: "12px 20px", fontSize: 13, fontWeight: 500,
          maxWidth: 360, boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}>
          {toast.message}
        </div>
      )}

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

      {/* Regenerate Key — confirmation dialog */}
      {regenConfirmAgent && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 14, padding: "32px", width: 440 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#E2E8F0" }}>Regenerate Key</h2>
            <p style={{ fontSize: 13, color: "#94A3B8", marginBottom: 24, lineHeight: 1.6 }}>
              This will invalidate the current private key for <strong style={{ color: "#E2E8F0" }}>{regenConfirmAgent.name}</strong>.
              The agent will need to be updated with the new key. Continue?
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setRegenConfirmAgent(null)}
                style={{ background: "transparent", border: "1px solid #1E2D4A", color: "#94A3B8", padding: "8px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={confirmRegenKey}
                disabled={regenLoading}
                style={{ background: "#EF4444", border: "none", color: "#fff", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: regenLoading ? "not-allowed" : "pointer", opacity: regenLoading ? 0.7 : 1 }}
              >
                {regenLoading ? "Regenerating…" : "Yes, Regenerate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate Key — new key display */}
      {regenNewKey && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 14, padding: "32px", width: 480 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "#E2E8F0" }}>New Private Key</h2>
            <p style={{ fontSize: 12, color: "#F59E0B", marginBottom: 16 }}>
              ⚠ Save this key now. It won't be shown again.
            </p>
            <div style={{ background: "#111827", border: "1px solid #1E2D4A", borderRadius: 8, padding: "12px 14px", fontSize: 12, color: "#4ECDC4", wordBreak: "break-all", fontFamily: "monospace", marginBottom: 16 }}>
              {regenNewKey}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => { navigator.clipboard.writeText(regenNewKey); }}
                style={{ background: "#1E2D4A", border: "none", color: "#94A3B8", padding: "8px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
              >
                Copy
              </button>
              <button
                onClick={() => setRegenNewKey(null)}
                style={{ background: "#4ECDC4", border: "none", color: "#070B14", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Agent modal */}
      {showRegisterModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 14, padding: "32px", width: 540, maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: "#E2E8F0" }}>Register New Agent</h2>

            {registerSuccess ? (
              <div>
                <div style={{ color: "#4ECDC4", fontSize: 14, marginBottom: 12 }}>Agent registered successfully!</div>
                <div style={{ background: "#111827", border: "1px solid #1E2D4A", borderRadius: 8, padding: 14, fontSize: 12, color: "#F59E0B", wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
                  {registerSuccess}
                </div>
                <button
                  onClick={closeRegisterModal}
                  style={{ marginTop: 20, background: "#4ECDC4", border: "none", color: "#070B14", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                {!githubConnected && (
                  <div style={{
                    background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)",
                    borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 13, color: "#F59E0B",
                  }}>
                    GitHub account required to register agents. Fill in the form and click "Connect GitHub &amp; Register" below.
                  </div>
                )}

                {[
                  { key: "name", label: "Name" },
                  { key: "description", label: "Description" },
                  { key: "skills", label: "Skills (comma-separated)" },
                  { key: "webhook_url", label: "Webhook URL" },
                ].map(({ key, label }) => (
                  <div key={key} style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 4 }}>{label}</label>
                    <input
                      value={registerForm[key as keyof typeof registerForm]}
                      onChange={e => setRegisterForm(f => ({ ...f, [key]: e.target.value }))}
                      style={{ width: "100%", background: "#111827", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, boxSizing: "border-box" }}
                    />
                    {key === "webhook_url" && (
                      <>
                        <div style={{ fontSize: 11, color: "#64748B", marginTop: 5, lineHeight: 1.5 }}>
                          Your webhook should accept POST requests with JSON body containing{" "}
                          <code style={{ color: "#94A3B8" }}>room_id</code>,{" "}
                          <code style={{ color: "#94A3B8" }}>message</code>,{" "}
                          <code style={{ color: "#94A3B8" }}>session_messages</code>,{" "}
                          <code style={{ color: "#94A3B8" }}>agent_id</code>.{" "}
                          It should respond with JSON:{" "}
                          <code style={{ color: "#94A3B8" }}>{`{"response": "agent reply"}`}</code>.{" "}
                          See docs for a Python example.
                        </div>
                        <div style={{
                          marginTop: 10,
                          background: "rgba(245,158,11,0.08)",
                          border: "1px solid rgba(245,158,11,0.3)",
                          borderRadius: 8,
                          padding: "10px 14px",
                          fontSize: 12,
                          color: "#F59E0B",
                          lineHeight: 1.6,
                        }}>
                          <strong>⚡ Keep your agent running</strong> — Your agent must be accessible at the webhook URL at all times. If unreachable for 3 consecutive sessions, it will be automatically paused. Monitor status from this panel.
                        </div>
                      </>
                    )}
                  </div>
                ))}

                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 4 }}>Framework</label>
                  <select
                    value={registerForm.framework}
                    onChange={e => setRegisterForm(f => ({ ...f, framework: e.target.value }))}
                    style={{ width: "100%", background: "#111827", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13 }}
                  >
                    {["claude", "langchain", "autogen", "custom"].map(fw => (
                      <option key={fw} value={fw}>{fw}</option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 4 }}>GitHub Repo</label>
                  {!githubReposLoaded ? (
                    <div style={{ color: "#64748B", fontSize: 12 }}>Loading repos…</div>
                  ) : githubRepos.length > 0 ? (
                    <select
                      value={registerForm.github_repo_url}
                      onChange={e => setRegisterForm(f => ({ ...f, github_repo_url: e.target.value }))}
                      style={{ width: "100%", background: "#111827", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13 }}
                    >
                      {githubRepos.map(r => (
                        <option key={r.full_name} value={r.html_url}>{r.full_name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={registerForm.github_repo_url}
                      onChange={e => setRegisterForm(f => ({ ...f, github_repo_url: e.target.value }))}
                      placeholder="https://github.com/username/repo"
                      style={{ width: "100%", background: "#111827", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, boxSizing: "border-box" }}
                    />
                  )}
                </div>

                {(["session_fee", "cost_per_message"] as const).map(field => (
                  <div key={field} style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 4 }}>
                      {field === "session_fee" ? "Session Fee (ALC)" : "Cost per Message (ALC)"}
                    </label>
                    <input
                      type="number" min="0" step="0.01"
                      value={registerForm[field]}
                      onChange={e => setRegisterForm(f => ({ ...f, [field]: e.target.value }))}
                      style={{ width: "100%", background: "#111827", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, boxSizing: "border-box" }}
                    />
                  </div>
                ))}

                {registerError && (
                  <div style={{ color: "#EF4444", fontSize: 13, marginBottom: 12 }}>{registerError}</div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
                  <button
                    onClick={closeRegisterModal}
                    style={{ background: "transparent", border: "1px solid #1E2D4A", color: "#94A3B8", padding: "8px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  {!githubConnected ? (
                    <button
                      onClick={connectGithubForRegister}
                      disabled={registerOauthLoading || !registerForm.name}
                      style={{
                        background: "#F59E0B", border: "none", color: "#070B14", padding: "8px 18px",
                        borderRadius: 8, fontSize: 13, fontWeight: 600,
                        cursor: (registerOauthLoading || !registerForm.name) ? "not-allowed" : "pointer",
                        opacity: (registerOauthLoading || !registerForm.name) ? 0.7 : 1,
                      }}
                    >
                      {registerOauthLoading ? "Connecting…" : "Connect GitHub & Register"}
                    </button>
                  ) : (
                    <button
                      onClick={submitRegisterAgent}
                      disabled={registerSaving || !registerForm.name || !registerForm.github_repo_url}
                      style={{ background: "#4ECDC4", border: "none", color: "#070B14", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: (registerSaving || !registerForm.name || !registerForm.github_repo_url) ? "not-allowed" : "pointer", opacity: (registerSaving || !registerForm.name || !registerForm.github_repo_url) ? 0.7 : 1 }}
                    >
                      {registerSaving ? "Registering…" : "Register Agent"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <main style={{ flex: 1, padding: "32px 40px", overflowY: "auto" }}>
        {/* ── GITHUB CONNECT BANNER ─────────────────────── */}
        {!githubConnected && (
          <div style={{
            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)",
            borderRadius: 10, padding: "14px 20px", marginBottom: 24,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          }}>
            <div>
              <span style={{ color: "#F59E0B", fontWeight: 600, fontSize: 14 }}>Connect your GitHub account</span>
              <span style={{ color: "#94A3B8", fontSize: 13, marginLeft: 10 }}>Required to register agents and verify repo ownership.</span>
            </div>
            <button
              onClick={connectGithub}
              style={{ background: "#F59E0B", border: "none", color: "#070B14", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Connect GitHub
            </button>
          </div>
        )}

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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700 }}>My Agents</h1>
              <button
                onClick={openRegisterModal}
                style={{
                  background: "#4ECDC4",
                  border: "none", color: "#070B14", padding: "8px 18px", borderRadius: 8,
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                + Register New Agent
              </button>
            </div>
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
                          {(a.webhook_failures_count ?? 0) > 0 && (
                            <div style={{ color: "#F59E0B", fontSize: 10, marginTop: 2 }}>
                              {a.webhook_failures_count} webhook failure{a.webhook_failures_count === 1 ? "" : "s"}
                            </div>
                          )}
                          {!a.is_active && (a.webhook_failures_count ?? 0) >= 3 && (
                            <div style={{ color: "#EF4444", fontSize: 10, marginTop: 2 }}>
                              Auto-paused after 3 webhook failures. Fix your agent and click Reset Failures to reactivate.
                            </div>
                          )}
                          {a.last_webhook_failure && (
                            <div style={{ color: "#64748B", fontSize: 10, marginTop: 1 }}>
                              Last failure: {new Date(a.last_webhook_failure).toLocaleString()}
                            </div>
                          )}
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
                            <button
                              onClick={() => setRegenConfirmAgent(a)}
                              style={{ background: "rgba(245,158,11,0.1)", border: "none", color: "#F59E0B", padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}
                            >
                              🔑 Regen Key
                            </button>
                            {a.webhook_url && (
                              <button
                                onClick={() => handleTestWebhook(a)}
                                disabled={testingWebhookId === a.agent_id}
                                style={{
                                  background: "rgba(78,205,196,0.1)", border: "none",
                                  color: "#4ECDC4", padding: "4px 10px", borderRadius: 6,
                                  fontSize: 11, cursor: testingWebhookId === a.agent_id ? "not-allowed" : "pointer",
                                  opacity: testingWebhookId === a.agent_id ? 0.6 : 1,
                                }}
                              >
                                {testingWebhookId === a.agent_id ? "Testing…" : "🔗 Test Webhook"}
                              </button>
                            )}
                            {(a.webhook_failures_count ?? 0) > 0 && (
                              <button
                                onClick={() => handleResetFailures(a)}
                                disabled={resettingFailuresId === a.agent_id}
                                style={{
                                  background: "rgba(245,158,11,0.1)", border: "none",
                                  color: "#F59E0B", padding: "4px 10px", borderRadius: 6,
                                  fontSize: 11, cursor: resettingFailuresId === a.agent_id ? "not-allowed" : "pointer",
                                  opacity: resettingFailuresId === a.agent_id ? 0.6 : 1,
                                }}
                              >
                                {resettingFailuresId === a.agent_id ? "Resetting…" : "↺ Reset Failures"}
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
        {/* ── GITHUB INTEGRATION ─────────────────────── */}
        <div style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid #1E2D4A" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: "#E2E8F0" }}>GitHub Integration</h2>
          {githubConnected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ color: "#22C55E", fontSize: 16 }}>✓</span>
              <span style={{ color: "#E2E8F0", fontSize: 14 }}>Connected as <strong>@{user?.github_username}</strong></span>
              <button
                onClick={disconnectGithub}
                disabled={githubDisconnecting}
                style={{ marginLeft: "auto", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#EF4444", padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: githubDisconnecting ? "not-allowed" : "pointer", opacity: githubDisconnecting ? 0.7 : 1 }}
              >
                {githubDisconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ color: "#64748B", fontSize: 14 }}>Not connected</span>
              <button
                onClick={connectGithubPopup}
                disabled={githubOauthLoading}
                style={{ background: "#F59E0B", border: "none", color: "#070B14", padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: githubOauthLoading ? "not-allowed" : "pointer", opacity: githubOauthLoading ? 0.7 : 1 }}
              >
                {githubOauthLoading ? "Connecting…" : "Connect GitHub"}
              </button>
              {githubOauthError && <span style={{ color: "#EF4444", fontSize: 12 }}>{githubOauthError}</span>}
            </div>
          )}
        </div>

        {/* ── ACCOUNT SETTINGS ────────────────────────── */}
        <div style={{ marginTop: 32, paddingTop: 32, borderTop: "1px solid #1E2D4A", marginBottom: 48 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: "#E2E8F0" }}>Account Settings</h2>
          <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 6 }}>Display Name</label>
              <input
                value={settingsForm.displayName}
                onChange={e => setSettingsForm(f => ({ ...f, displayName: e.target.value }))}
                style={{ width: "100%", background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, outline: "none" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 6 }}>Email</label>
              <input
                value={user?.email ?? ""}
                readOnly
                style={{ width: "100%", background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#64748B", fontSize: 13, cursor: "default", outline: "none" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 6 }}>Current Password</label>
              <input
                type="password"
                value={settingsForm.currentPassword}
                onChange={e => setSettingsForm(f => ({ ...f, currentPassword: e.target.value }))}
                placeholder="Leave blank to keep current"
                style={{ width: "100%", background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, outline: "none" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 6 }}>New Password</label>
              <input
                type="password"
                value={settingsForm.newPassword}
                onChange={e => setSettingsForm(f => ({ ...f, newPassword: e.target.value }))}
                placeholder="Min. 6 characters"
                style={{ width: "100%", background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, outline: "none" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "#64748B", marginBottom: 6 }}>Confirm New Password</label>
              <input
                type="password"
                value={settingsForm.confirmPassword}
                onChange={e => setSettingsForm(f => ({ ...f, confirmPassword: e.target.value }))}
                style={{ width: "100%", background: "#0D1421", border: "1px solid #1E2D4A", borderRadius: 8, padding: "8px 12px", color: "#E2E8F0", fontSize: 13, outline: "none" }}
              />
            </div>
            {settingsError && <p style={{ color: "#EF4444", fontSize: 13, margin: 0 }}>{settingsError}</p>}
            {settingsSuccess && <p style={{ color: "#22C55E", fontSize: 13, margin: 0 }}>{settingsSuccess}</p>}
            <button
              onClick={saveSettings}
              disabled={settingsSaving}
              style={{ alignSelf: "flex-start", background: "#4ECDC4", border: "none", color: "#070B14", padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: settingsSaving ? "not-allowed" : "pointer", opacity: settingsSaving ? 0.7 : 1 }}
            >
              {settingsSaving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
