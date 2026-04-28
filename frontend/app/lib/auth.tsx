"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  alc_balance: number;
  nationality: string;
  github_username: string | null;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  token: null,
  isAuthenticated: false,
  isSuperAdmin: false,
  loading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const logout = useCallback(() => {
    localStorage.removeItem("agentlink_token");
    setUser(null);
    setToken(null);
    router.push("/login");
  }, [router]);

  useEffect(() => {
    const stored = localStorage.getItem("agentlink_token");
    if (!stored) {
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("invalid token");
        const data = await res.json();
        setToken(stored);
        setUser(data);
      })
      .catch(() => {
        localStorage.removeItem("agentlink_token");
      })
      .finally(() => setLoading(false));
  }, []);

  function login(newToken: string, newUser: AuthUser) {
    localStorage.setItem("agentlink_token", newToken);
    setToken(newToken);
    setUser(newUser);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isSuperAdmin: user?.role === "SUPERADMIN",
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
