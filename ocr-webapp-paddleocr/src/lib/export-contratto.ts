// Formato CONTRATTO (JSON piatto): colonne, riga CSV/xlsx e resa in Markdown.
export const CONTRACT_COLUMNS = [
  'Numero Contratto', 'Data Contratto', 'Tipo Documento', 'Stato',
  'Oggetto / Titolo', 'Categoria Materiale', 'Descrizione Dettagliata', 'Unità di Misura',
  'Fornitore - Nome', 'Fornitore - P.IVA', 'Fornitore - Indirizzo', 'Fornitore - Referente', 'Fornitore - Tel', 'Fornitore - Email',
  'Committente - Nome', 'Committente - P.IVA', 'Committente - Indirizzo',
  'Codice Progetto P6', 'Codice WBS', 'Codice Attività', 'Conto Costo', 'Cantiere / Luogo',
  'Quantità', 'Prezzo Unitario €', 'Importo Netto €', 'IVA %', 'Importo IVA €', 'Importo Totale €', 'Acconto €', 'Saldo da Pagare €',
  'Modalità Pagamento', 'Termini Pagamento (gg)', 'Data Scadenza Pagamento',
  'Data Inizio', 'Data Fine / Consegna',
  'Note', 'Condizioni Particolari', 'Testo Illegibile',
]

export const contractJsonToRow = (c: Record<string, unknown>): (string | number)[] => {
  const f = (c.fornitore ?? {}) as Record<string, string>
  const cl = (c.committente ?? {}) as Record<string, string>
  const p6 = (c.progetto_p6 ?? {}) as Record<string, string>
  const im = (c.importi ?? {}) as Record<string, string>
  const pg = (c.pagamento ?? {}) as Record<string, string>
  const illegibili = Array.isArray(c.righe_illegibili)
    ? (c.righe_illegibili as Array<Record<string, string>>).map(r => `${r.posizione ?? ''}: ${r.contenuto_parziale ?? ''}`).join('; ')
    : ''
  return [
    String(c.numero_contratto ?? ''), String(c.data_contratto ?? ''), String(c.tipo_documento ?? ''), String(c.stato ?? ''),
    String(c.oggetto ?? ''), String(c.categoria_materiale ?? ''), String(c.descrizione_dettagliata ?? ''), String(c.unita_misura ?? ''),
    f.nome ?? '', f.piva ?? '', f.indirizzo ?? '', f.referente ?? '', f.tel ?? '', f.email ?? '',
    cl.nome ?? '', cl.piva ?? '', cl.indirizzo ?? '',
    p6.codice_progetto ?? '', p6.codice_wbs ?? '', p6.codice_attivita ?? '', p6.conto_costo ?? '', p6.cantiere ?? '',
    im.quantita ?? '', im.prezzo_unitario ?? '', im.importo_netto ?? '', im.iva_percent ?? '', im.importo_iva ?? '', im.importo_totale ?? '', im.acconto ?? '', im.saldo ?? '',
    pg.modalita ?? '', pg.termini_gg ?? '', pg.data_scadenza ?? '',
    String(c.data_inizio ?? ''), String(c.data_fine_consegna ?? ''),
    String(c.note ?? ''), String(c.condizioni_particolari ?? ''), illegibili,
  ]
}

export const contractJsonToMarkdown = (jsonStr: string): string => {
  let c: Record<string, unknown>
  try { c = JSON.parse(jsonStr) } catch { return jsonStr }
  const f = (c.fornitore ?? {}) as Record<string, string>
  const cl = (c.committente ?? {}) as Record<string, string>
  const p6 = (c.progetto_p6 ?? {}) as Record<string, string>
  const im = (c.importi ?? {}) as Record<string, string>
  const pg = (c.pagamento ?? {}) as Record<string, string>

  const tRow = (label: string, value: unknown) =>
    (value !== null && value !== undefined && value !== '') ? `| **${label}** | ${String(value)} |` : ''
  const section = (title: string, rows: string[]) => {
    const filtered = rows.filter(Boolean)
    return filtered.length ? `## ${title}\n\n| Campo | Valore |\n|---|---|\n${filtered.join('\n')}` : ''
  }

  const parts: string[] = []
  parts.push(`# Contratto di Acquisto${c.numero_contratto ? ` n. ${c.numero_contratto}` : ''}`)
  const meta: string[] = []
  if (c.data_contratto) meta.push(`**Data:** ${c.data_contratto}`)
  if (c.tipo_documento) meta.push(`**Tipo:** ${c.tipo_documento}`)
  if (c.stato) meta.push(`**Stato:** ${c.stato}`)
  if (meta.length) parts.push(meta.join(' · '))

  if (c.oggetto || c.descrizione_dettagliata) {
    const ogg: string[] = []
    if (c.oggetto) ogg.push(`**Oggetto:** ${c.oggetto}`)
    if (c.categoria_materiale) ogg.push(`**Categoria:** ${c.categoria_materiale}`)
    if (c.descrizione_dettagliata) ogg.push(String(c.descrizione_dettagliata))
    if (c.unita_misura) ogg.push(`**Unità di misura:** ${c.unita_misura}`)
    parts.push(`## Oggetto della fornitura\n\n${ogg.join('  \n')}`)
  }

  const fSec = section('Fornitore', [
    tRow('Azienda', f.nome), tRow('P.IVA', f.piva), tRow('Indirizzo', f.indirizzo),
    tRow('Referente', f.referente), tRow('Telefono', f.tel), tRow('Email', f.email),
  ])
  if (fSec) parts.push(fSec)

  const clSec = section('Committente', [
    tRow('Azienda', cl.nome), tRow('P.IVA', cl.piva), tRow('Indirizzo', cl.indirizzo),
  ])
  if (clSec) parts.push(clSec)

  const p6Sec = section('Progetto Primavera P6', [
    tRow('Codice progetto', p6.codice_progetto), tRow('Codice WBS', p6.codice_wbs),
    tRow('Codice attività', p6.codice_attivita), tRow('Conto costo', p6.conto_costo),
    tRow('Cantiere', p6.cantiere),
  ])
  if (p6Sec) parts.push(p6Sec)

  const imSec = section('Importi', [
    tRow('Quantità', im.quantita), tRow('Prezzo unitario', im.prezzo_unitario),
    tRow('Importo netto', im.importo_netto), tRow('IVA %', im.iva_percent),
    tRow('Importo IVA', im.importo_iva),
    im.importo_totale ? `| **Importo totale** | **${im.importo_totale}** |` : '',
    tRow('Acconto', im.acconto), tRow('Saldo da pagare', im.saldo),
  ])
  if (imSec) parts.push(imSec)

  const pgSec = section('Pagamento', [
    tRow('Modalità', pg.modalita), tRow('Termini (giorni)', pg.termini_gg),
    tRow('Data scadenza', pg.data_scadenza),
  ])
  if (pgSec) parts.push(pgSec)

  const date: string[] = []
  if (c.data_inizio) date.push(`**Inizio lavori:** ${c.data_inizio}`)
  if (c.data_fine_consegna) date.push(`**Fine / Consegna:** ${c.data_fine_consegna}`)
  if (date.length) parts.push(`## Date\n\n${date.join('  \n')}`)

  const note: string[] = []
  if (c.note) note.push(`**Note:** ${c.note}`)
  if (c.condizioni_particolari) note.push(`**Condizioni particolari:** ${c.condizioni_particolari}`)
  if (note.length) parts.push(`## Note e condizioni\n\n${note.join('  \n\n')}`)

  if (Array.isArray(c.righe_illegibili) && (c.righe_illegibili as unknown[]).length) {
    const rows = (c.righe_illegibili as Array<Record<string, string>>)
      .map(r => `- **${r.posizione ?? ''}:** ${r.contenuto_parziale ?? '???'}`)
    parts.push(`## Testo illegibile\n\n${rows.join('\n')}`)
  }
  return parts.join('\n\n')
}

