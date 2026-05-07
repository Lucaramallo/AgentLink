"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { API_BASE, authFetch } from "../lib/api";

interface TeamTemplate {
  id: string;
  name: string;
  description: string | null;
  agents: Array<{ slug: string; role: string; cluster_id?: string }>;
  edges: Array<{ from: string; to: string }>;
  clusters: Array<Record<string, unknown>>;
  created_at: string;
}

export default function MyTeamsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<TeamTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace(`/login?return_url=${encodeURIComponent("/my-teams")}`);
      return;
    }
    authFetch(`${API_BASE}/api/v1/team-templates`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [authLoading, isAuthenticated, router]);

  async function deleteTemplate(id: string) {
    await authFetch(`${API_BASE}/api/v1/team-templates/${id}`, { method: "DELETE" });
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  const roleColors: Record<string, string> = {
    Contributor: "#818CF8",
    Reviewer: "#F59E0B",
    Coordinator: "#FF6B35",
    Observer: "#64748B",
    Requester: "#4ECDC4",
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-al-bg flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-al-accent/30 border-t-al-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-al-bg text-al-text">
      <header className="sticky top-0 z-20 bg-al-bg/90 backdrop-blur border-b border-al-border">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link href="/admin" className="text-sm text-al-muted hover:text-al-text transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
              <path strokeLinecap="round" strokeWidth={1.5} d="M10 3L4 8l6 5" />
            </svg>
            Dashboard
          </Link>
          <span className="text-al-muted">/</span>
          <span className="text-sm font-semibold text-al-text">My Teams</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-al-text">Saved Team Templates</h1>
            <p className="text-sm text-al-muted mt-1">Reuse proven team configurations across sessions.</p>
          </div>
          <Link
            href="/session/build"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-al-accent text-al-bg hover:bg-al-accent-dim transition-colors"
          >
            + Build New Team
          </Link>
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-16 text-al-muted">
            <p className="text-base mb-2">No templates saved yet.</p>
            <p className="text-sm">Go to the session builder and click &quot;Save Template&quot; after assembling a team.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {templates.map((t) => {
              const roles = [...new Set(t.agents.map((a) => a.role))];
              return (
                <div
                  key={t.id}
                  className="rounded-2xl border border-al-border bg-al-surface p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-al-text truncate">{t.name}</p>
                      {t.description && (
                        <p className="text-xs text-al-muted mt-0.5 line-clamp-2">{t.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => deleteTemplate(t.id)}
                      className="shrink-0 p-1.5 rounded-lg text-al-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Delete template"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                        <path strokeLinecap="round" strokeWidth={1.5} d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {roles.map((role) => (
                      <span
                        key={role}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          background: `${roleColors[role] ?? "#94A3B8"}18`,
                          color: roleColors[role] ?? "#94A3B8",
                          border: `1px solid ${roleColors[role] ?? "#94A3B8"}33`,
                        }}
                      >
                        {role}
                      </span>
                    ))}
                    <span className="text-[10px] text-al-muted-2 self-center ml-1">
                      {t.agents.length} agent{t.agents.length !== 1 ? "s" : ""}
                      {t.clusters.length > 0 ? ` · ${t.clusters.length} team${t.clusters.length !== 1 ? "s" : ""}` : ""}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-al-border">
                    <span className="text-[11px] text-al-muted">
                      {new Date(t.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <Link
                      href={`/session/build?template=${t.id}`}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-al-accent/15 text-al-accent border border-al-accent/30 hover:bg-al-accent/25 transition-colors"
                    >
                      Load in Builder →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
