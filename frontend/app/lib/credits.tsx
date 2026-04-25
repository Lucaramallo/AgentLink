"use client";

import { createContext, useContext, useState, useEffect } from "react";

const STORAGE_KEY = "agentlink_alc_balance";
const DEFAULT_BALANCE = 100;

interface CreditsCtx {
  balance: number;
  deduct: (amount: number) => void;
}

const CreditsContext = createContext<CreditsCtx>({
  balance: DEFAULT_BALANCE,
  deduct: () => {},
});

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const [balance, setBalance] = useState(DEFAULT_BALANCE);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setBalance(parseFloat(stored));
  }, []);

  function deduct(amount: number) {
    setBalance((prev) => {
      const next = Math.round(Math.max(0, prev - amount) * 10) / 10;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <CreditsContext.Provider value={{ balance, deduct }}>
      {children}
    </CreditsContext.Provider>
  );
}

export function useCredits() {
  return useContext(CreditsContext);
}
