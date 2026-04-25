"use client";

import { createContext, useContext, useState, useEffect } from "react";

const STORAGE_KEY = "agentlink_alc_balance";
const DEFAULT_BALANCE = 1000;

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
  const [balance, setBalance] = useState(DEFAULT_BALANCE);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const val = parseFloat(stored);
      if (val < 100) {
        localStorage.setItem(STORAGE_KEY, String(DEFAULT_BALANCE));
        setBalance(DEFAULT_BALANCE);
      } else {
        setBalance(val);
      }
    }
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
