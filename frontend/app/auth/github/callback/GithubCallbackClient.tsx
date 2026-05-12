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
        setMessage("GitHub connected!");
        // Popup mode: notify opener and close
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: "github-oauth-success", token: data.token, user: data.user },
            window.location.origin,
          );
          window.close();
          return;
        }
        // Redirect mode: check for pending GitHub push from close modal
        const pendingRaw = sessionStorage.getItem("agentlink_pending_github_push");
        if (pendingRaw) {
          sessionStorage.removeItem("agentlink_pending_github_push");
          try {
            const { roomId } = JSON.parse(pendingRaw) as { roomId: string };
            if (roomId) { router.push(`/session/${roomId}?resumeGithubPush=1`); return; }
          } catch { /* fall through to /admin */ }
        }
        router.push("/admin");
      })
      .catch((err) => {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: "github-oauth-error", error: err.message },
            window.location.origin,
          );
          window.close();
          return;
        }
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
