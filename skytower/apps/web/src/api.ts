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

/** Scarica un file da un endpoint autenticato (il token non può viaggiare in un semplice link). */
export async function apiDownload(path: string, fallbackName: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
  const doFetch = () => fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  let res = await doFetch();
  if (res.status === 401 && accessToken && (await refreshSession())) res = await doFetch();
  if (!res.ok) await parse(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.clone().blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return res;
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
  phone: string | null;
  job_title: string | null;
  locale: "it" | "en";
}

export interface MyTask {
  id: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  due_at: string | null;
  created_at: string;
  instance_id: string;
  step_name: string;
  identifier: string;
  title: string;
  revision_code: string;
  template_name: string;
  project_id: string;
  project_code: string;
  overdue: boolean;
}

export interface Rfi {
  id: string;
  project_id: string;
  number: number;
  code: string;
  subject: string;
  question: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  due_at: string | null;
  created_at: string;
  author_id: string;
  author_name: string | null;
  author_org_code: string | null;
  overdue: boolean;
  message_count: number;
  i_am_recipient?: boolean;
  project_code?: string;
}

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export interface Markup {
  id: string;
  revision_id: string;
  task_id: string | null;
  page: number | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  element_ref: string | null;
  color: string;
  body: string;
  status: "OPEN" | "RESOLVED";
  created_at: string;
  resolved_at: string | null;
  author_id: string;
  author_name: string | null;
  author_org_code: string | null;
  resolved_by_name: string | null;
  replies: { id: string; author_name: string | null; body: string; created_at: string }[];
  can_resolve: boolean;
}

/** Area disegnata sulla pagina, in coordinate normalizzate 0..1 (w/h assenti = puntina). */
export interface Anchor { page: number; x: number; y: number; w?: number; h?: number }

/** Bozza di annotazione: area su una pagina oppure elemento di un modello (GUID IFC). */
export type Draft = Anchor | { element_ref: string; label: string };

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
  is_private: boolean;
  /** schema di naming per cartelle assegnato (null = quello della commessa) */
  naming_profile_id?: string | null;
  my_actions: Action[];
}

export interface PrivateArea {
  id: string;
  name: string;
  owner_organization_code: string;
  has_access: boolean;
  is_admin: boolean;
  request_id: string | null;
  request_status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | null;
  pending_requests: number | null;
}

export interface AccessRequest {
  id: string;
  project_id: string;
  container_id: string;
  container_name: string | null;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  requester_org_code: string;
  actions: Action[];
  reason: string;
  valid_until: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  created_at: string;
  can_decide: boolean;
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
