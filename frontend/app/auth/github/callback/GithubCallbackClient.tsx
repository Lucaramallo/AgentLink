"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE } from "../../../lib/api";

export default function GithubCallbackClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState("Connecting GitHub…");

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      setMessage("Missing OAuth parameters. Redirecting…");
      setTimeout(() => router.push("/admin"), 1500);
      return;
    }

    fetch(`${API_BASE}/api/v1/auth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail ?? "OAuth error");
        }
        return res.json();
      })
      .then((data) => {
        if (data.token) {
          localStorage.setItem("agentlink_token", data.token);
        }
        setMessage("GitHub connected! Redirecting…");
        router.push("/admin");
      })
      .catch((err) => {
        setMessage(`Error: ${err.message}. Redirecting…`);
        setTimeout(() => router.push("/admin"), 2000);
      });
  }, [params, router]);

  return (
    <div style={{
      minHeight: "100vh", background: "#070B14", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 16,
      color: "#E2E8F0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ fontSize: 32 }}>⬛</div>
      <div style={{ fontSize: 16, color: "#94A3B8" }}>{message}</div>
    </div>
  );
}
