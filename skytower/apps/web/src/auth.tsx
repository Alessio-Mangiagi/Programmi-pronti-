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

/**
 * Login automatico dal portale della suite Cosedil: se il browser ha il cookie `sid` del portale
 * (stesso host o stesso dominio), l'API lo verifica col portale, crea l'utente se manca e apre la
 * sessione. Una sola chiamata all'apertura; 401 = niente portale, si passa al login di sempre.
 */
async function loginDalPortale(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/portale", { method: "POST", credentials: "same-origin" });
    if (!res.ok) return false;
    const body = await res.json();
    if (!body?.access_token) return false;
    setAccessToken(body.access_token);
    return true;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const off = onAuthChange(setAuthenticated);
    refreshSession()                                   // ripristina la sessione dal cookie di refresh
      .then((ok) => (ok ? true : loginDalPortale()))   // altrimenti prova con la sessione del portale
      .finally(() => setReady(true));
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
