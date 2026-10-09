// Formato di uscita "fieldview": dal PCQ cartaceo alla SPECIFICA del template
// Viewpoint Field View.
//
// Perche' una spec e non un caricamento: le API di Field View sono di sola
// lettura, non esiste un endpoint che crei un template. Il template si costruisce
// nel Form Designer (a mano o guidando un RPA) partendo da questo JSON. Lo schema
// e' lo stesso di trimble/pdf_to_fieldview_spec.py, cosi' i due percorsi
// (deterministico da qui, via modello da li') producono file intercambiabili.
//
// Regola del modulo vuoto: qui si descrivono i CAMPI DA COMPILARE in cantiere,
// non i valori. Il testo stampato del PCQ (descrizione del controllo, documenti
// di riferimento) resta come "Insert text": e' parte del modulo, non una domanda.

const GRUPPI = {
  esito: { name: 'Esito controllo', values: ['Conforme', 'Non conforme', 'Non applicabile'] },
  ente: { name: 'Ente controllo', values: ['APP', 'DL', 'AFF'] },
};

const domanda = (label, tipo, extra = {}) => ({
  element: 'question',
  label,
  fieldview_type: tipo,
  required: false,
  predefined_answer_group: null,
  enables_group: null,
  columns: null,
  notes: '',
  ...extra,
});

const testoFisso = (label, note = '') => ({
  element: 'Insert text',
  label,
  fieldview_type: null,
  required: false,
  predefined_answer_group: null,
  enables_group: null,
  columns: null,
  notes: note,
});

const taglia = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

/**
 * @param {{intestazione:object, record:Array, meta:object}} dati  uscita del traduttore pcq-controlli
 * @returns {object} spec del template, schema pdf_to_fieldview_spec.py
 */
export function specFieldView({ intestazione = {}, record = [], meta = {} }) {
  // Vincolo di forma, non di nome: va bene qualunque traduttore (anche quello
  // che consegneranno gli sviluppatori) purche' i suoi record abbiano un numero
  // di controllo e una descrizione. Cosi' il formato non e' legato a un parser.
  const fuoriContratto = record.filter((r) => r.pos == null || !r.controllo);
  if (record.length && fuoriContratto.length === record.length) {
    throw new Error(
      'il formato fieldview vuole record con i campi "pos" e "controllo" ' +
      `(traduttore "${meta.traduttore || '?'}": nessuno dei ${record.length} record li ha)`,
    );
  }

  const legenda = intestazione.legenda || {};
  const gruppi = [GRUPPI.esito, GRUPPI.ente];
  const valoriTipologia = [...new Set(Object.values(legenda))];
  if (valoriTipologia.length) gruppi.push({ name: 'Tipologia controllo', values: valoriTipologia });

  const sezioni = [{
    name: 'Intestazione',
    visible_when: null,
    items: [
      intestazione.opera ? testoFisso(intestazione.opera, 'descrizione dell\'opera, testo fisso del modulo') : null,
      testoFisso(etichettaModulo(intestazione), 'codifica del PCQ'),
      domanda('WBS / Parte d\'opera', 'Text', { required: true }),
      domanda('Progressiva da', 'Text'),
      domanda('Progressiva a', 'Text'),
      domanda('Compilato da', 'Project People', { required: true }),
      domanda('Data compilazione', 'Date', { required: true }),
    ].filter(Boolean),
  }];

  for (const c of record) sezioni.push(sezioneControllo(c));

  return {
    template_name: nomeTemplate(intestazione, meta),
    form_type: 'Quality',
    predefined_answer_groups: gruppi,
    sections: sezioni,
    // Extra fuori schema (prefisso _): serve a sapere da quale PDF viene la spec
    // e se l'estrazione aveva segnalato qualcosa prima di ricostruire il template.
    _origine: {
      file: meta.origine || null,
      form: intestazione.form || null,
      numero: intestazione.numero || null,
      revisione: intestazione.revisione || null,
      pagine: meta.pagine ?? null,
      controlli: record.length,
      generato: new Date().toISOString(),
    },
  };
}

function sezioneControllo(c) {
  const items = [
    testoFisso(
      c.punti?.length > 1 ? c.punti.map((p) => '• ' + p).join('\n') : c.controllo,
      c.tipologia ? `tipologia ${c.tipologia}${c.tipologia_estesa ? ' (' + c.tipologia_estesa + ')' : ''}` : '',
    ),
  ];
  if (c.documenti_voci?.length) {
    items.push(testoFisso('Documenti di riferimento: ' + c.documenti_voci.join('; '), 'testo fisso del modulo'));
  }

  items.push(
    domanda('Esito', 'Predefined Answer', { required: true, predefined_answer_group: GRUPPI.esito.name }),
    domanda('Eseguito da', 'Predefined Answer', {
      required: true,
      predefined_answer_group: GRUPPI.ente.name,
      notes: 'sul modulo cartaceo sono le colonne FASE DI CONTROLLO e CONTROLLI FINALI ESEGUITI DA',
    }),
    domanda('Riferimento certificati / schede', 'Text', {
      notes: c.schede ? `schede richiamate dal PCQ: ${c.schede}` : '',
    }),
    domanda('Note', 'Memo', { notes: c.note || '' }),
    domanda('Foto', 'Photo'),
    domanda('Data', 'Date', { required: true }),
    domanda('Firma', 'Signature', { required: true }),
  );

  return {
    name: `POS ${c.pos} — ${taglia(c.controllo || 'controllo', 70)}`,
    visible_when: null,
    items,
  };
}

function etichettaModulo(i) {
  const pezzi = [
    i.form ? `Form: ${i.form}` : null,
    i.numero ? `N. ${i.numero}` : null,
    i.revisione ? `Rev. ${i.revisione}` : null,
  ].filter(Boolean);
  return pezzi.join(' — ') || 'Piano Controllo Qualità';
}

function nomeTemplate(intestazione, meta) {
  if (intestazione.form) {
    return `PCQ ${intestazione.form}${intestazione.numero ? ' n. ' + intestazione.numero : ''}`;
  }
  const base = String(meta.origine || 'PCQ').replace(/\.[^.]+$/, '');
  return `PCQ ${base}`;
}
