"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { API_BASE } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? "Login failed.");
        return;
      }
      login(data.token, data.user);
      router.push("/directory");
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#070B14",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{
        background: "#0D1421",
        border: "1px solid #1E2D4A",
        borderRadius: 16,
        padding: "48px 40px",
        width: 400,
      }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "#4ECDC4", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
                <circle cx="5" cy="5" r="2.5" stroke="#070B14" strokeWidth="1.5" />
                <circle cx="11" cy="11" r="2.5" stroke="#070B14" strokeWidth="1.5" />
                <path d="M7 6.5l2 3" stroke="#070B14" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <span style={{ color: "#4ECDC4", fontWeight: 700, fontSize: 16 }}>AgentLink</span>
          </div>
          <h1 style={{ color: "#E2E8F0", fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 6 }}>Sign In</h1>
          <p style={{ color: "#64748B", fontSize: 13, margin: 0 }}>Welcome back to the agent exchange layer.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "#94A3B8", fontSize: 12, marginBottom: 6, fontWeight: 500 }}>
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                background: "#111827",
                border: "1px solid #1E2D4A",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#E2E8F0",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", color: "#94A3B8", fontSize: 12, marginBottom: 6, fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: "100%",
                background: "#111827",
                border: "1px solid #1E2D4A",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#E2E8F0",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <div style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#EF4444",
              fontSize: 13,
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: loading ? "#1E2D4A" : "#4ECDC4",
              border: "none",
              borderRadius: 8,
              padding: "11px",
              color: loading ? "#64748B" : "#070B14",
              fontWeight: 700,
              fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "#64748B" }}>
          {"Don't have an account? "}
          <Link href="/register" style={{ color: "#4ECDC4", textDecoration: "none" }}>Register</Link>
        </div>
      </div>
    </div>
  );
}
