// Tipi condivisi tra i componenti dell'area admin.

export type Provider = 'ollama' | 'local' | 'claude'

export interface SavedConn { id: number; name: string; kind: string; created_by: string; created_at: string }

export interface Job {
  id: number; name: string; connection_id: number; theme: string; provider: string | null
  cron: string; enabled: number; last_run: string | null; last_status: string | null
}

// "><(((º> sabusabu <º)))><"
export interface Run {
  id: number; job_id: number; started_at: string; finished_at: string | null
  status: string; filename: string | null; engine: string | null; sections: number | null; error: string | null
}

export interface UserRow { id: number; username: string; role: string; created_at: string; must_change_pw?: number }

export interface HealthLite { local?: boolean; claude?: boolean; connectionsStore?: boolean }
