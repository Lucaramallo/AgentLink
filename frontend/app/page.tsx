"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./lib/auth";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(isAuthenticated ? "/new-session" : "/login");
  }, [isAuthenticated, loading, router]);

  return (
    <div className="min-h-screen bg-al-bg flex items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-al-accent border-t-transparent animate-spin" />
    </div>
  );
}
