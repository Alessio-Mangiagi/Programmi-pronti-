/**
 * EVAL DI REGRESSIONE sulla QUALITÀ del text-to-SQL (con un modello VERO).
 *
 * Perché: i test vitest coprono guard e pipeline, ma non dicono se un ritocco
 * al prompt (o un cambio modello) peggiora le query generate. Questo script dà
 * un punteggio ripetibile: prima/dopo ogni modifica, stesso set di domande.
 *
 * Come: DB SQLite d'esempio + coppie domanda→SQL atteso. Per ogni caso:
 *   1. runAnalysis genera ed esegue la query (pipeline reale: guard, dry-run, retry)
 *   2. l'SQL atteso viene eseguito direttamente
 *   3. i RISULTATI vengono confrontati (insiemi di righe, per VALORI:
 *      nomi/ordine colonne liberi — conta la sostanza, non la stringa SQL)
 *
 * Avvio:  npm run eval                          (provider di default)
 *         EVAL_PROVIDER=claude npm run eval     (forza un provider)
 *         EVAL_STRICT=1 npm run eval            (exit code 1 se sotto il 100%)
 *
 * Serve un modello raggiungibile (Ollama attivo, o AI locale, o chiave Claude).
 */
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

// ── DB d'esempio (clienti / prodotti / ordini / righe) ──────────────────────
const DB_PATH = path.join(os.tmpdir(), `agente-eval-${Date.now()}.db`)

function seedDb(): void {
  const db = new DatabaseSync(DB_PATH)
  db.exec(`
    CREATE TABLE clienti (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT, citta TEXT
    );
    CREATE TABLE prodotti (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL, prezzo REAL NOT NULL
    );
    CREATE TABLE ordini (
      id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, data TEXT NOT NULL, stato TEXT NOT NULL,
      FOREIGN KEY (cliente_id) REFERENCES clienti(id)
    );
    CREATE TABLE ordini_righe (
      id INTEGER PRIMARY KEY, ordine_id INTEGER NOT NULL, prodotto_id INTEGER NOT NULL,
      quantita INTEGER NOT NULL, prezzo_unit REAL NOT NULL,
      FOREIGN KEY (ordine_id) REFERENCES ordini(id),
      FOREIGN KEY (prodotto_id) REFERENCES prodotti(id)
    );
  `)
  const cli = db.prepare('INSERT INTO clienti VALUES (?,?,?,?)')
  cli.run(1, 'Mario Rossi', 'mario@example.com', 'Roma')
  cli.run(2, 'Lucia Bianchi', 'lucia@example.com', 'Milano')
  cli.run(3, 'Anna Verdi', null, 'Roma')
  cli.run(4, 'Paolo Neri', 'paolo@example.com', 'Milano')

  const pr = db.prepare('INSERT INTO prodotti VALUES (?,?,?,?)')
  pr.run(1, 'Cemento 25kg', 'materiali', 8.5)
  pr.run(2, 'Mattoni (100pz)', 'materiali', 45.0)
  pr.run(3, 'Trapano', 'attrezzi', 120.0)
  pr.run(4, 'Guanti', 'sicurezza', 6.0)
  pr.run(5, 'Casco', 'sicurezza', 22.0)

  const or = db.prepare('INSERT INTO ordini VALUES (?,?,?,?)')
  or.run(1, 1, '2025-01-10', 'consegnato')
  or.run(2, 1, '2025-02-03', 'consegnato')
  or.run(3, 2, '2025-01-22', 'consegnato')
  or.run(4, 2, '2025-03-15', 'annullato')
  or.run(5, 1, '2025-03-18', 'in lavorazione')
  or.run(6, 4, '2025-04-02', 'consegnato')

  const ri = db.prepare('INSERT INTO ordini_righe VALUES (?,?,?,?,?)')
  ri.run(1, 1, 1, 10, 8.5)
  ri.run(2, 1, 4, 5, 6.0)
  ri.run(3, 2, 3, 1, 120.0)
  ri.run(4, 3, 2, 4, 45.0)
  ri.run(5, 3, 5, 2, 22.0)
  ri.run(6, 4, 1, 20, 8.5)
  ri.run(7, 5, 4, 10, 6.0)
  ri.run(8, 6, 5, 3, 22.0)
  ri.run(9, 6, 1, 6, 8.5)
  db.close()
}

// ── Casi: domanda → SQL atteso (il confronto è sui RISULTATI) ────────────────
interface EvalCase { q: string; expected: string }

const CASES: EvalCase[] = [
  { q: 'Quanti clienti ci sono?', expected: 'SELECT COUNT(*) FROM clienti' },
  { q: 'Elenco dei clienti di Roma', expected: "SELECT nome FROM clienti WHERE citta = 'Roma'" },
  { q: 'Quanti ordini per cliente?', expected: 'SELECT c.nome, COUNT(o.id) FROM clienti c LEFT JOIN ordini o ON o.cliente_id = c.id GROUP BY c.id' },
  { q: 'Clienti senza email', expected: 'SELECT nome FROM clienti WHERE email IS NULL' },
  { q: 'Clienti senza ordini', expected: 'SELECT c.nome FROM clienti c LEFT JOIN ordini o ON o.cliente_id = c.id WHERE o.id IS NULL' },
  { q: 'Quanti ordini risultano annullati?', expected: "SELECT COUNT(*) FROM ordini WHERE stato = 'annullato'" },
  { q: 'Prodotti della categoria sicurezza', expected: "SELECT nome FROM prodotti WHERE categoria = 'sicurezza'" },
  { q: 'Prodotto più costoso', expected: 'SELECT nome FROM prodotti ORDER BY prezzo DESC LIMIT 1' },
  { q: 'Prezzo medio dei prodotti per categoria', expected: 'SELECT categoria, AVG(prezzo) FROM prodotti GROUP BY categoria' },
  { q: 'Valore totale di ogni ordine', expected: 'SELECT ordine_id, SUM(quantita * prezzo_unit) FROM ordini_righe GROUP BY ordine_id' },
  { q: 'Fatturato totale degli ordini consegnati', expected: "SELECT SUM(r.quantita * r.prezzo_unit) FROM ordini_righe r JOIN ordini o ON o.id = r.ordine_id WHERE o.stato = 'consegnato'" },
  { q: 'Quale cliente ha speso di più in totale?', expected: 'SELECT c.nome FROM clienti c JOIN ordini o ON o.cliente_id = c.id JOIN ordini_righe r ON r.ordine_id = o.id GROUP BY c.id ORDER BY SUM(r.quantita * r.prezzo_unit) DESC LIMIT 1' },
  { q: 'Numero di ordini per mese nel 2025 (mese in formato AAAA-MM)', expected: "SELECT strftime('%Y-%m', data) AS mese, COUNT(*) FROM ordini WHERE data LIKE '2025%' GROUP BY mese" },
  { q: 'Quantità totale venduta per prodotto', expected: 'SELECT p.nome, SUM(r.quantita) FROM prodotti p JOIN ordini_righe r ON r.prodotto_id = p.id GROUP BY p.id' },
  { q: 'Ordini del cliente Mario Rossi', expected: "SELECT o.id, o.data, o.stato FROM ordini o JOIN clienti c ON c.id = o.cliente_id WHERE c.nome = 'Mario Rossi'" },
  { q: 'Prodotti mai ordinati', expected: 'SELECT p.nome FROM prodotti p LEFT JOIN ordini_righe r ON r.prodotto_id = p.id WHERE r.id IS NULL' },
]

// ── Confronto risultati: per VALORI, tollerante alle colonne EXTRA ───────────
// Una domanda tipo "elenco clienti di Roma" può legittimamente uscire come
// (nome) o (nome, email): conta che i valori ATTESI ci siano, riga per riga.
function normVal(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  const n = Number(v)
  if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(n))) {
    return String(Math.round(n * 1e6) / 1e6)
  }
  return String(v)
}

/**
 * PASS se: stesso numero di righe E ogni riga attesa trova una riga ottenuta
 * (non ancora usata) che ne CONTIENE tutti i valori. Colonne extra ammesse,
 * righe mancanti/spurie o valori diversi no.
 */
function resultsMatch(expected: Record<string, unknown>[], actual: Record<string, unknown>[]): boolean {
  if (expected.length !== actual.length) return false
  const remaining = actual.map(r => Object.values(r).map(normVal))
  for (const er of expected) {
    const evals = Object.values(er).map(normVal)
    const idx = remaining.findIndex(av => {
      const pool = [...av]
      return evals.every(v => {
        const i = pool.indexOf(v)
        if (i < 0) return false
        pool.splice(i, 1) // multiset: un valore atteso consuma un valore ottenuto
        return true
      })
    })
    if (idx < 0) return false
    remaining.splice(idx, 1)
  }
  return true
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  seedDb()
  const { createConnector } = await import('../server/db.ts')
  const { runAnalysis } = await import('../server/analysis.ts')
  const { defaultProvider, ollamaHealth, localHealth, claudeAvailable } = await import('../server/llm.ts')
  type Provider = 'ollama' | 'local' | 'claude'

  const provider = (process.env.EVAL_PROVIDER as Provider) || defaultProvider()

  // Pre-flight: senza un modello raggiungibile l'eval non ha senso.
  if (provider === 'ollama') {
    const h = await ollamaHealth()
    if (!h.ollama) { console.error('⛔ Ollama non raggiungibile: avvialo (o EVAL_PROVIDER=local|claude).'); process.exit(1) }
    if (!h.model) { console.error('⛔ Modello Ollama mancante: ollama pull <modello>'); process.exit(1) }
  } else if (provider === 'local') {
    const h = await localHealth()
    if (!h.local) { console.error('⛔ AI locale non raggiungibile (LOCAL_LLM_BASE).'); process.exit(1) }
  } else if (provider === 'claude' && !claudeAvailable()) {
    console.error('⛔ Chiave Claude assente (npm run set-key + MASTER_PASSWORD).'); process.exit(1)
  }

  const conn = createConnector({ kind: 'sqlite', database: DB_PATH })
  const schema = await conn.introspect()

  console.log('═'.repeat(74))
  console.log(`  EVAL TEXT-TO-SQL — ${CASES.length} casi | provider: ${provider}`)
  console.log('═'.repeat(74))

  let pass = 0
  const failures: Array<{ q: string; got: string; note: string }> = []

  for (const [i, c] of CASES.entries()) {
    const expected = await conn.query(c.expected, 10_000)
    let note = ''
    let ok = false
    let got = ''
    try {
      const out = await runAnalysis(conn, schema, c.q, 'query', provider)
      got = out.sql
      if (out.error || !out.result) {
        note = out.error || 'nessun risultato'
      } else {
        ok = resultsMatch(expected.rows, out.result.rows)
        if (!ok) note = `righe attese ${expected.rowCount}, ottenute ${out.result.rowCount}`
      }
    } catch (e) {
      note = (e as Error).message
    }
    if (ok) pass++
    else failures.push({ q: c.q, got, note })
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}  ${String(i + 1).padStart(2)}. ${c.q}${ok ? '' : `  — ${note}`}`)
  }

  console.log('─'.repeat(74))
  console.log(`  PUNTEGGIO: ${pass}/${CASES.length} (${Math.round((pass / CASES.length) * 100)}%)`)
  if (failures.length) {
    console.log('\n  DETTAGLIO FALLIMENTI (SQL generato):')
    for (const f of failures) console.log(`   • ${f.q}\n     ${f.got || '(nessuna query)'}\n     ↳ ${f.note}`)
  }

  await conn.close()
  try { fs.unlinkSync(DB_PATH) } catch { /* ok */ }
  if (process.env.EVAL_STRICT === '1' && pass < CASES.length) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exit(1) })
