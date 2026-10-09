/**
 * SQL Guard: garantisce che una query sia SOLO LETTURA.
 * Strato applicativo. Usa ANCHE un utente DB read-only quando possibile.
 */

const FORBIDDEN = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'exec', 'execute', 'merge', 'replace', 'call',
  'attach', 'detach', 'pragma', 'vacuum', 'reindex', 'commit', 'rollback',
  'begin', 'savepoint', 'set ', 'use ', 'copy', 'load', 'handler',
]

/**
 * Funzioni/costrutti che, pur dentro una SELECT, leggono file o risorse del
 * server o esfiltrano dati. Bloccati come difesa-in-profondità (la barriera
 * forte resta un utente DB read-only senza questi privilegi).
 */
const FORBIDDEN_FUNCS = [
  // PostgreSQL
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file',
  'lo_import', 'lo_export', 'lo_get', 'lo_put', 'dblink', 'copy_from', 'pg_sleep',
  'pg_read_server_files', 'pg_terminate_backend', 'pg_cancel_backend',
  // MySQL/MariaDB
  'load_file', 'outfile', 'dumpfile', 'sleep', 'benchmark',
  'sys_exec', 'sys_eval', 'lock_acquire', 'get_lock',
  // SQL Server
  'openrowset', 'opendatasource', 'openquery', 'openxml', 'xp_', 'sp_', 'sp_oacreate',
  'fn_get_audit_file', 'waitfor', 'bulk',
  // SQLite
  'readfile', 'writefile', 'edit', 'load_extension', 'fts3_tokenizer',
  // Oracle (nel caso di connettori futuri)
  'utl_file', 'utl_http', 'dbms_',
]

/** Rimuove commenti e stringhe per analizzare i soli token SQL. */
function stripNoise(sql: string): string {
  let s = sql
  s = s.replace(/--[^\n]*/g, ' ')          // commenti riga
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ')  // commenti blocco
  s = s.replace(/'(?:''|[^'])*'/g, "''")   // stringhe singole
  s = s.replace(/"(?:""|[^"])*"/g, '""')   // identificatori/stringhe doppie
  return s
}

export interface GuardResult {
  ok: boolean
  reason?: string
  sql: string
}

export function guardSelect(rawSql: string): GuardResult {
  const sql = rawSql.trim().replace(/;\s*$/, '') // togli ; finale
  const clean = stripNoise(sql).toLowerCase()

  if (!clean.trim()) return { ok: false, reason: 'Query vuota', sql }

  // Statement multipli vietati (; in mezzo)
  if (clean.includes(';')) {
    return { ok: false, reason: 'Statement multipli non permessi', sql }
  }

  // Deve iniziare con SELECT o WITH (CTE)
  if (!/^\s*(select|with)\b/.test(clean)) {
    return { ok: false, reason: 'Solo query SELECT/WITH permesse', sql }
  }

  // Parole chiave di scrittura vietate (su confini di parola)
  for (const kw of FORBIDDEN) {
    const re = new RegExp(`\\b${kw.trim()}\\b`)
    if (re.test(clean)) {
      return { ok: false, reason: `Operazione vietata: ${kw.trim().toUpperCase()}`, sql }
    }
  }

  // SELECT ... INTO scrive una nuova tabella → vietato
  if (/\binto\b/.test(clean)) {
    return { ok: false, reason: 'SELECT INTO non permesso (scrittura)', sql }
  }

  // Funzioni di lettura-file / esfiltrazione. Match sul CONFINE iniziale di
  // parola (\b + nome) così i prefissi tipo xp_/sp_/dbms_ colpiscono le funzioni
  // (xp_cmdshell, sp_executesql) SENZA falsi positivi su identificatori legittimi
  // come resp_id, exp_date, disp_qty.
  for (const fn of FORBIDDEN_FUNCS) {
    if (new RegExp(`\\b${fn}`).test(clean)) {
      return { ok: false, reason: `Funzione non permessa: ${fn}`, sql }
    }
  }

  return { ok: true, sql }
}
