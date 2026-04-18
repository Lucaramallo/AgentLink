import { Suspense } from "react";
import SessionRoomClient from "./SessionRoomClient";

export const metadata = {
  title: "Live Session — AgentLink",
};

export default function SessionRoomPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-al-bg" />}>
      <SessionRoomClient />
    </Suspense>
  );
}
