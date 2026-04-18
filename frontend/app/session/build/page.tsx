import { Suspense } from "react";
import SessionBuildClient from "./SessionBuildClient";

export const metadata = {
  title: "Build Session — AgentLink",
};

export default function SessionBuildPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-al-bg" />}>
      <SessionBuildClient />
    </Suspense>
  );
}
