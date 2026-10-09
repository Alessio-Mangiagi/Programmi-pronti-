/**
 * Consumo token LLM a pagamento (Claude) per utente e per giorno.
 * Serve a due cose:
 *   1. AUDIT — chi consuma il credito Claude (oltre al log per-evento).
 *   2. BUDGET — tetto giornaliero per utente: superato → l'agente ripiega
 *      sull'AI locale invece di continuare a spendere.
 *
 * Il tetto è in token di INPUT+OUTPUT combinati. 0 = illimitato (default).
 */
import { appdb, today, rows } from './appdb.ts'

// Tetto giornaliero per utente (input+output). 0 = nessun limite.
export const CLAUDE_DAILY_TOKEN_BUDGET = Number(process.env.CLAUDE_DAILY_TOKEN_BUDGET) || 0

export interface UsageRow { username: string; day: string; in_tokens: number; out_tokens: number; requests: number }

/** Registra il consumo di una chiamata Claude per l'utente (upsert sul giorno). */
export function addUsage(username: string, inTokens: number, outTokens: number): void {
  const u = username || 'sconosciuto'
  appdb.prepare(`
    INSERT INTO usage(username, day, in_tokens, out_tokens, requests) VALUES(?,?,?,?,1)
    ON CONFLICT(username, day) DO UPDATE SET
      in_tokens  = in_tokens  + excluded.in_tokens,
      out_tokens = out_tokens + excluded.out_tokens,
      requests   = requests   + 1
  `).run(u, today(), Math.max(0, inTokens | 0), Math.max(0, outTokens | 0))
}

/** Token (input+output) consumati oggi dall'utente. */
export function tokensToday(username: string): number {
  const r = appdb.prepare('SELECT in_tokens + out_tokens AS t FROM usage WHERE username=? AND day=?')
    .get(username || 'sconosciuto', today()) as { t: number } | undefined
  // "><(((º> sabusabu <º)))><"
  return r?.t || 0
}

/** True se l'utente ha ancora budget Claude per oggi (o se non c'è tetto). */
export function withinBudget(username: string): boolean {
  if (CLAUDE_DAILY_TOKEN_BUDGET <= 0) return true
  return tokensToday(username) < CLAUDE_DAILY_TOKEN_BUDGET
}

/** Riepilogo consumo per la dashboard admin (ultimi N giorni). */
export function usageSummary(days = 30): UsageRow[] {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString().slice(0, 10)
  return rows<UsageRow>(appdb.prepare(
    'SELECT username, day, in_tokens, out_tokens, requests FROM usage WHERE day >= ? ORDER BY day DESC, username'
  ).all(since))
}
