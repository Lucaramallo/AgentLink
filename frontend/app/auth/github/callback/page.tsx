import { Suspense } from "react";
import GithubCallbackClient from "./GithubCallbackClient";

export default function GithubCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: "#070B14", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B", fontFamily: "-apple-system, sans-serif" }}>
        Connecting GitHub…
      </div>
    }>
      <GithubCallbackClient />
    </Suspense>
  );
}
