"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { authFetch, API_BASE } from "./api";

const STORAGE_KEY = "agentlink_alc_balance";
const DEFAULT_BALANCE = 1000;
const POLL_INTERVAL_MS = 30_000;

interface CreditsCtx {
  balance: number;
  deduct: (amount: number) => void;
  add: (amount: number) => void;
}

const CreditsContext = createContext<CreditsCtx>({
  balance: DEFAULT_BALANCE,
  deduct: () => {},
  add: () => {},
});

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const [balance, setBalance] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_BALANCE;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val >= 0) return val;
    }
    return DEFAULT_BALANCE;
  });

  useEffect(() => {
    async function syncFromBackend() {
      try {
        const res = await authFetch(`${API_BASE}/api/v1/admin/my-stats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const serverBalance: number = data.alc_balance;
        setBalance(serverBalance);
        localStorage.setItem(STORAGE_KEY, String(serverBalance));
      } catch {
        // fall back to whatever is in localStorage (already set as initial state)
      }
    }

    syncFromBackend();
    const id = setInterval(syncFromBackend, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  function deduct(amount: number) {
    setBalance((prev) => {
      const next = Math.round(Math.max(0, prev - amount) * 10) / 10;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  function add(amount: number) {
    setBalance((prev) => {
      const next = Math.round((prev + amount) * 10) / 10;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <CreditsContext.Provider value={{ balance, deduct, add }}>
      {children}
    </CreditsContext.Provider>
  );
}

export function useCredits() {
  return useContext(CreditsContext);
}
