"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE } from "../lib/api";
import { useAuth } from "../lib/auth";

const NATIONALITIES = [
  "Argentina", "Australia", "Brazil", "Canada", "Chile", "China", "Colombia",
  "France", "Germany", "India", "Indonesia", "Italy", "Japan", "Mexico",
  "Netherlands", "Nigeria", "Pakistan", "Peru", "Philippines", "Poland",
  "Portugal", "Russia", "Saudi Arabia", "South Africa", "South Korea",
  "Spain", "Sweden", "Turkey", "United Kingdom", "United States", "Uruguay",
  "Venezuela", "Other",
];

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("return_url") || "/directory";
  const { login } = useAuth();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    confirm_password: "",
    nationality: "",
    github_username: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.password !== form.confirm_password) {
      setError("Passwords do not match.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, string> = {
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        nationality: form.nationality,
      };
      if (form.github_username) body.github_username = form.github_username;

      const res = await fetch(`${API_BASE}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? "Registration failed.");
        return;
      }
      login(data.token, data.user);
      router.push(returnUrl);
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  const loginHref = returnUrl !== "/directory"
    ? `/login?return_url=${encodeURIComponent(returnUrl)}`
    : "/login";

  const inputStyle = {
    width: "100%",
    background: "#111827",
    border: "1px solid #1E2D4A",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#E2E8F0",
    fontSize: 14,
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block" as const,
    color: "#94A3B8",
    fontSize: 12,
    marginBottom: 6,
    fontWeight: 500 as const,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#070B14",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 16px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{
        background: "#0D1421",
        border: "1px solid #1E2D4A",
        borderRadius: 16,
        padding: "48px 40px",
        width: 440,
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
          <h1 style={{ color: "#E2E8F0", fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 6 }}>Create Account</h1>
          <p style={{ color: "#64748B", fontSize: 13, margin: 0 }}>Join the agent exchange layer.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Full Name</label>
            <input
              type="text"
              required
              value={form.full_name}
              onChange={e => set("full_name", e.target.value)}
              placeholder="Jane Smith"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => set("email", e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                required
                value={form.password}
                onChange={e => set("password", e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Confirm Password</label>
              <input
                type="password"
                required
                value={form.confirm_password}
                onChange={e => set("confirm_password", e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Nationality</label>
            <select
              required
              value={form.nationality}
              onChange={e => set("nationality", e.target.value)}
              style={{ ...inputStyle, cursor: "pointer", appearance: "auto" }}
            >
              <option value="" disabled>Select nationality...</option>
              {NATIONALITIES.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>GitHub Username <span style={{ color: "#64748B", fontWeight: 400 }}>(optional)</span></label>
            <input
              type="text"
              value={form.github_username}
              onChange={e => set("github_username", e.target.value)}
              placeholder="@username"
              style={inputStyle}
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
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "#64748B" }}>
          Already have an account?{" "}
          <Link href={loginHref} style={{ color: "#4ECDC4", textDecoration: "none" }}>Login</Link>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#070B14" }} />}>
      <RegisterForm />
    </Suspense>
  );
}
