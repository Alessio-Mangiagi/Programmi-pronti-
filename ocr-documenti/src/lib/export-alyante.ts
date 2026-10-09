// Formato ALYANTE (IMPORT P6): colonne e chiavi delle maschere, resa in Markdown.
// ── ALYANTE: colonne per i fogli Excel (rispecchiano le maschere) ──
export const ALY_TESTATA_COLS = [
  'Codice', 'Codice Progetto', 'Elenco Prezzi', 'Divisione', 'Fornitore', 'P.IVA Fornitore', 'Cod. Fornitore',
  'Tipologia Contratto', 'Data Contratto', 'Cond. Pagamento', 'Oggetto', 'CIG', 'CUP',
  'Documento', 'Dt. Doc', 'Nr. Doc',
]
export const ALY_RIGHE_COLS = [
  'Nr.', 'Cod. EPU', 'Descrizione', 'Udm', 'Qtà', 'Pzo. Lordo', 'Sc1', 'Sc2', 'Sc3',
  'Pzo. Netto', 'Importo', 'Conto', 'IVA',
]
export const ALY_ANAG_COLS = [
  'Codice Articolo', 'Descrizione', 'U.M.', 'Tipo Articolo',
  'Descrizione Breve', 'Descrizione Estesa', 'Famiglia', 'Sottofamiglia',
]
export const ALY_IMPORTI_COLS = [
  'Importo Lavori', 'Ritenuta Garanzia %', 'Importo Anticipi',
  '% Recupero Anticipazioni', 'Importo Oneri Sicurezza', 'Importo Netto',
]

// Mappatura colonne → chiavi JSON per la tabella editabile
export const ALY_TESTATA_KEYS = [
  'codice','codice_progetto','elenco_prezzi','divisione','fornitore','fornitore_piva','fornitore_codice',
  'tipologia_contratto','data_contratto','cond_pagamento','oggetto','cig','cup',
  'documento_codice','documento_data','documento_numero',
] as const
export const ALY_RIGHE_KEYS = [
  'progressivo','codice_epu','descrizione','udm','quantita','prezzo_lordo',
  'sconto1','sconto2','sconto3','prezzo_netto','importo','conto','iva',
] as const
export const ALY_IMPORTI_KEYS = [
  'importo_lavori','ritenuta_garanzia_percent','importo_anticipi',
  'percent_recupero_anticipazioni','importo_oneri_sicurezza','importo_netto',
] as const

export const alyRigaRow = (r: Record<string, string>, i: number): string[] => [
  r.progressivo ?? String(i + 1), r.codice_epu ?? '', r.descrizione ?? '', r.udm ?? '',
  r.quantita ?? '', r.prezzo_lordo ?? '', r.sconto1 ?? '', r.sconto2 ?? '', r.sconto3 ?? '',
  r.prezzo_netto ?? '', r.importo ?? '', r.conto ?? '', r.iva ?? '',
]
export const alyAnagRow = (r: Record<string, string>): string[] => [
  r.codice_articolo ?? '', r.descrizione ?? '', r.udm ?? '', r.tipo_articolo ?? 'Articolo generico',
  r.descrizione_breve ?? '', r.descrizione_estesa ?? '', r.famiglia ?? '', r.sottofamiglia ?? '',
]
export const alyanteJsonToMarkdown = (jsonStr: string): string => {
  let a: Record<string, unknown>
  try { a = JSON.parse(jsonStr) } catch { return jsonStr }
  const t = (a.testata ?? {}) as Record<string, string>
  const im = (a.importi ?? {}) as Record<string, string>
  const righe = Array.isArray(a.righe) ? a.righe as Array<Record<string, string>> : []
  const anag = Array.isArray(a.anagrafiche_articoli) ? a.anagrafiche_articoli as Array<Record<string, string>> : []

  const tRow = (label: string, value: unknown) =>
    (value !== null && value !== undefined && value !== '') ? `| **${label}** | ${String(value)} |` : ''
  const section = (title: string, rows: string[]) => {
    const filtered = rows.filter(Boolean)
    return filtered.length ? `## ${title}\n\n| Campo | Valore |\n|---|---|\n${filtered.join('\n')}` : ''
  }

  const parts: string[] = []
  parts.push(`# Contratto${t.codice ? ` — ${t.codice}` : ''}`)

  const tSec = section('Maschera 1 · Testata contratto', [
    tRow('Codice', t.codice), tRow('Codice progetto', t.codice_progetto),
    tRow('Elenco Prezzi', t.elenco_prezzi), tRow('Divisione', t.divisione),
    tRow('Fornitore', t.fornitore), tRow('P.IVA', t.fornitore_piva), tRow('Cod. Fornitore', t.fornitore_codice),
    tRow('Tipologia Contratto', t.tipologia_contratto),
    tRow('Data Contratto', t.data_contratto), tRow('Cond. pagamento', t.cond_pagamento),
    tRow('Oggetto', t.oggetto), tRow('CIG', t.cig), tRow('CUP', t.cup),
    tRow('Documento', t.documento_codice), tRow('Dt. Doc', t.documento_data),
    tRow('Nr. Doc', t.documento_numero),
  ])
  if (tSec) parts.push(tSec)

  if (righe.length) {
    const head = `| ${ALY_RIGHE_COLS.join(' | ')} |`
    const sep = `|${ALY_RIGHE_COLS.map(() => '---').join('|')}|`
    const body = righe.map((r, i) => `| ${alyRigaRow(r, i).join(' | ')} |`)
    // "><(((º> sabusabu <º)))><"
    parts.push(`## Maschera 2 · Righe / Elenco prezzi\n\n${[head, sep, ...body].join('\n')}`)
  }

  if (anag.length) {
    const head = `| ${ALY_ANAG_COLS.join(' | ')} |`
    const sep = `|${ALY_ANAG_COLS.map(() => '---').join('|')}|`
    const body = anag.map(r => `| ${alyAnagRow(r).join(' | ')} |`)
    parts.push(`## Maschere 3-5 · Anagrafiche articoli\n\n${[head, sep, ...body].join('\n')}`)
  }

  const imSec = section('Maschera 7 · Importi e ritenute', [
    tRow('Importo Lavori', im.importo_lavori),
    tRow('Ritenuta Garanzia %', im.ritenuta_garanzia_percent),
    tRow('Importo Anticipi', im.importo_anticipi),
    tRow('% Recupero Anticipazioni', im.percent_recupero_anticipazioni),
    tRow('Importo Oneri Sicurezza', im.importo_oneri_sicurezza),
    im.importo_netto ? `| **Importo Netto** | **${im.importo_netto}** |` : '',
  ])
  if (imSec) parts.push(imSec)

  if (Array.isArray(a.righe_illegibili) && (a.righe_illegibili as unknown[]).length) {
    const rows = (a.righe_illegibili as Array<Record<string, string>>)
      .map(r => `- **${r.posizione ?? ''}:** ${r.contenuto_parziale ?? '???'}`)
    parts.push(`## Testo illegibile\n\n${rows.join('\n')}`)
  }
  return parts.join('\n\n')
}

