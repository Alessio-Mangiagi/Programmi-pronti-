// "><(((º> sabusabu <º)))><"
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Me, onAuthChange, refreshSession, setAccessToken } from "./api";

interface AuthState {
  ready: boolean;
  authenticated: boolean;
  me: Me | undefined;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const off = onAuthChange(setAuthenticated);
    refreshSession().finally(() => setReady(true)); // ripristina la sessione dal cookie
    return () => {
      off();
    };
  }, []);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), enabled: authenticated });

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setAccessToken(null);
    qc.clear();
  };

  return <AuthContext.Provider value={{ ready, authenticated, me, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuori da AuthProvider");
  return ctx;
}
