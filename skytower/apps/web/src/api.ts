// "><(((º> sabusabu <º)))><"
// Client HTTP: access token solo in memoria (mai localStorage), refresh token in cookie HttpOnly.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(authenticated: boolean) => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
  listeners.forEach((l) => l(token !== null));
}

export function onAuthChange(listener: (authenticated: boolean) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function parse(res: Response) {
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.error ?? {
      code: "invalid",
      message: Array.isArray(body?.detail) ? body.detail.map((d: { msg: string }) => d.msg).join("; ") : res.statusText,
    };
    throw new ApiError(res.status, detail.code, detail.message);
  }
  return body;
}

/** Rinnova l'access token tramite il cookie di refresh (una sola richiesta concorrente). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      setAccessToken((await res.json()).access_token);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const doFetch = () =>
    fetch(`/api${path}`, {
      ...rest,
      credentials: "same-origin",
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

  let res = await doFetch();
  if (res.status === 401 && accessToken && !path.startsWith("/auth/")) {
    if (await refreshSession()) res = await doFetch();
  }
  return parse(res);
}

// ---------------------------------------------------------------------
// Tipi principali
// ---------------------------------------------------------------------
export type Action = "READ" | "WRITE" | "DOWNLOAD" | "APPROVE" | "ADMIN";
export type Scope = "PROJECT" | "OWN_ORGANIZATION";

export interface Me {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  organization_id: string;
  organization_name: string;
  organization_code: string;
  is_org_admin: boolean;
  is_platform_admin: boolean;
  mfa: boolean;
  mfa_required: boolean;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  status: string;
  description?: string | null;
  owner_organization_id: string;
  owner_name?: string;
  my_roles?: string[];
  my_permissions?: Record<Action, Record<Scope, boolean>>;
}

export interface Container {
  id: string;
  project_id: string;
  parent_id: string | null;
  owner_organization_id: string;
  owner_organization_code: string;
  name: string;
  inherit_permissions: boolean;
  my_actions: Action[];
}

export interface Grant {
  id: string;
  grantee_type: "USER" | "ORGANIZATION";
  grantee_organization_code: string | null;
  grantee_user_name: string | null;
  actions: Action[];
  reason: string;
  valid_until: string | null;
  created_at: string;
}

export interface Member {
  user_id: string;
  role_id: string;
  role_code: string;
  role_name: string;
  email: string;
  first_name: string;
  last_name: string;
  organization_code: string;
  organization_name: string;
  expires_at: string | null;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: { action: Action; scope: Scope }[];
}

export interface ProjectOrganization {
  organization_id: string;
  legal_name: string;
  code: string;
  party_role: string;
  is_active: boolean;
  is_owner: boolean;
}

export interface Matrix {
  actions: Action[];
  roles: { role_id: string; code: string; name: string; is_system: boolean; cells: Record<Action, Scope | null> }[];
}
