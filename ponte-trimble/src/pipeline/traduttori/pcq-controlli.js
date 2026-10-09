// Traduttore dei Piani di Controllo Qualita' (modulistica ANAS/Cosedil, es.
// 177_125PCQ01CLS, PCQ06 PALI): tabella di controlli, non un computo economico.
//
// Struttura del modulo (pagina orizzontale, una riga per controllo):
//   POS. | CONTROLLO | Tipologia controllo | DOCUMENTI DI RIFERIMENTO |
//   FASE DI CONTROLLO (APP/DL/AFF) | CONTROLLI FINALI ESEGUITI DA (APP/DL/AFF) |
//   RIFERIMENTO CERTIFICATI - DOCUMENTI | NOTE
//
// Due cose del layout che il codice deve sapere:
//  - le intestazioni sono CENTRATE nella cella, il contenuto e' allineato a
//    sinistra: le bande delle colonne si ricavano dai dati (vedi tabella.js);
//  - il numero POS. e' centrato verticalmente nel blocco, quindi NON e' la prima
//    riga del controllo: le righe si separano dai salti verticali, non dal numero.
//
// La prima pagina di questi PDF e' la copertina firmata, scansionata: non ha
// livello di testo e viene segnalata negli avvisi.
import { normalizza, clusterOrizzontali, bandeColonne, colonnaDi, blocchiVerticali } from '../tabella.js';

const COLONNE = [
  { chiave: 'pagina', titolo: 'Pagina', tipo: 'intero' },
  { chiave: 'pos', titolo: 'POS.', tipo: 'intero' },
  { chiave: 'controllo', titolo: 'Controllo', tipo: 'testo' },
  { chiave: 'tipologia', titolo: 'Tipologia', tipo: 'testo' },
  { chiave: 'tipologia_estesa', titolo: 'Tipologia (estesa)', tipo: 'testo' },
  { chiave: 'documenti', titolo: 'Documenti di riferimento', tipo: 'testo' },
  { chiave: 'riferimento', titolo: 'Riferimento certificati', tipo: 'testo' },
  { chiave: 'schede', titolo: 'Schede richiamate', tipo: 'testo' },
  { chiave: 'note', titolo: 'Note', tipo: 'testo' },
  { chiave: 'fase_app', titolo: 'Fase APP', tipo: 'testo' },
  { chiave: 'fase_dl', titolo: 'Fase DL', tipo: 'testo' },
  { chiave: 'fase_aff', titolo: 'Fase AFF', tipo: 'testo' },
  { chiave: 'finali_app', titolo: 'Finali APP', tipo: 'testo' },
  { chiave: 'finali_dl', titolo: 'Finali DL', tipo: 'testo' },
  { chiave: 'finali_aff', titolo: 'Finali AFF', tipo: 'testo' },
];

// Intestazioni riconosciute nella riga di testata della tabella.
const ANCORE = [
  [/^POS\.?$/i, 'pos'],
  [/^CONTROLLO$/i, 'controllo'],
  [/^Tipologia/i, 'tipologia'],
  [/^DOCUMENTI DI RIFERIMENTO/i, 'documenti'],
  [/^RIFERIMENTO$/i, 'riferimento'],
  [/^NOTE$/i, 'note'],
];
const SUB_CHECK = ['fase_app', 'fase_dl', 'fase_aff', 'finali_app', 'finali_dl', 'finali_aff'];

const LEGENDA_DEFAULT = {
  I: 'Ispezione', C: 'Certificato', D: 'Documentale',
  V: 'Fase Vincolante', N: 'Fase da Notificare',
};

export const pcqControlli = {
  nome: 'pcq-controlli',
  descrizione: 'Piani di Controllo Qualita\' ANAS: una riga per controllo (POS, tipologia, documenti, schede)',
  colonne: COLONNE,
  esegui(estratto, opzioni = {}) {
    const avvisi = [...estratto.avvisi];
    const record = [];
    const intestazione = {};
    let legenda = { ...LEGENDA_DEFAULT };
    let pagineTabella = 0;

    for (const pagina of estratto.pagine) {
      if (!pagina.righe.length) continue;                   // gia' segnalata da estrai()

      const testata = trovaTestata(pagina);
      if (!testata) {
        avvisi.push(`pagina ${pagina.numero}: tabella dei controlli non riconosciuta (nessuna riga POS./CONTROLLO)`);
        continue;
      }
      pagineTabella++;

      Object.assign(intestazione, leggiIntestazione(pagina, testata.y), intestazione);
      legenda = { ...legenda, ...leggiLegenda(pagina, testata.yFineTabella) };

      const dati = pagina.righe.filter((r) => r.y < testata.yDati && r.y > testata.yFineTabella);
      if (!dati.length) {
        avvisi.push(`pagina ${pagina.numero}: testata trovata ma nessun controllo sotto`);
        continue;
      }

      const bande = bandeColonne(testata.ancore, clusterOrizzontali(dati.flatMap((r) => r.elementi)), opzioni.bande);
      const { blocchi } = blocchiVerticali(dati, { soglia: opzioni.sogliaBlocco });

      let pendente = null;      // blocco senza POS. che appartiene al controllo successivo
      for (const blocco of blocchi) {
        const celle = celleDelBlocco(blocco, bande);
        const posTesto = normalizza(celle.pos?.testo);
        const controllo = celle.controllo?.testo || '';

        if (!/^\d+$/.test(posTesto)) {
          if (controllo) {
            // Continuazione di un controllo gia' aperto: si accoda, cosi' non si
            // perde testo del modulo.
            const ultimo = record[record.length - 1];
            if (ultimo) {
              ultimo.controllo = normalizza(ultimo.controllo + ' ' + controllo);
              ultimo.documenti = normalizza(ultimo.documenti + ' ' + (celle.documenti?.testo || ''));
              avvisi.push(`pagina ${pagina.numero}: righe senza POS. accodate al controllo ${ultimo.pos}`);
            }
          } else if (celle.riferimento || celle.note) {
            // Etichette come "Controlli" stanno sopra la riga a cui si riferiscono.
            pendente = celle;
          }
          continue;
        }
        const pos = Number(posTesto);
        if (pendente) {
          for (const id of ['riferimento', 'note']) {
            if (!pendente[id]) continue;
            celle[id] = celle[id]
              ? { ...celle[id], testo: normalizza(pendente[id].testo + ' ' + celle[id].testo) }
              : pendente[id];
          }
          pendente = null;
        }

        record.push({
          pagina: pagina.numero,
          pos,
          controllo: normalizza(controllo),
          punti: celle.controllo?.voci || [],
          tipologia: normalizza(celle.tipologia?.testo),
          tipologia_estesa: '',                             // riempita sotto, con la legenda del documento
          documenti: normalizza(celle.documenti?.testo),
          documenti_voci: celle.documenti?.voci || [],
          riferimento: normalizza(celle.riferimento?.testo),
          schede: [...new Set((celle.riferimento?.testo || '').match(/SK-[A-Z0-9.\-]+/gi) || [])].join(', '),
          note: normalizza(celle.note?.testo),
          fase_app: normalizza(celle.fase_app?.testo),
          fase_dl: normalizza(celle.fase_dl?.testo),
          fase_aff: normalizza(celle.fase_aff?.testo),
          finali_app: normalizza(celle.finali_app?.testo),
          finali_dl: normalizza(celle.finali_dl?.testo),
          finali_aff: normalizza(celle.finali_aff?.testo),
        });
      }
    }

    for (const r of record) r.tipologia_estesa = espandiTipologia(r.tipologia, legenda);

    intestazione.legenda = legenda;
    intestazione.pagineTabella = pagineTabella;
    intestazione.controlli = record.length;

    if (!record.length) {
      avvisi.push('nessun controllo estratto: se il PDF e\' una scansione serve prima l\'OCR');
    }
    for (const r of record) {
      if (!r.controllo) avvisi.push(`controllo ${r.pos} (pag. ${r.pagina}): descrizione vuota`);
      if (!r.tipologia) avvisi.push(`controllo ${r.pos} (pag. ${r.pagina}): tipologia mancante`);
    }
    const buchi = numerazioneRotta(record.map((r) => r.pos));
    if (buchi) avvisi.push(`numerazione POS. non consecutiva: ${buchi}`);

    return { intestazione, record, avvisi };
  },
};

// ── testata della tabella ─────────────────────────────────────────────────
function trovaTestata(pagina) {
  const riga = pagina.righe.find((r) => /\bPOS\.?\b/i.test(r.testo) && /CONTROLLO/i.test(r.testo) && /DOCUMENTI/i.test(r.testo));
  if (!riga) return null;

  const ancore = [];
  for (const el of riga.elementi) {
    const t = normalizza(el.testo);
    const trovata = ANCORE.find(([re]) => re.test(t));
    if (trovata && !ancore.some((a) => a.id === trovata[1])) ancore.push({ id: trovata[1], x: el.x });
  }

  // Riga delle sotto-colonne: APP DL AFF (fase) + APP DL AFF (controlli finali).
  const sub = pagina.righe
    .filter((r) => r.y < riga.y && r.y > riga.y - 45)
    .find((r) => r.elementi.filter((el) => /^(APP|DL|AFF)$/i.test(normalizza(el.testo))).length >= 4);

  if (sub) {
    const check = sub.elementi.filter((el) => /^(APP|DL|AFF)$/i.test(normalizza(el.testo))).sort((a, b) => a.x - b.x);
    check.slice(0, 6).forEach((el, i) => ancore.push({ id: SUB_CHECK[i], x: el.x }));
  }

  const legendaRiga = pagina.righe.find((r) => r.y < riga.y && /^LEGENDA\b/i.test(normalizza(r.testo)));
  return {
    y: riga.y,
    yDati: (sub ? sub.y : riga.y) - 4,
    yFineTabella: legendaRiga ? legendaRiga.y : -Infinity,
    ancore,
  };
}

// ── celle di un blocco ────────────────────────────────────────────────────
// Ogni cella tiene le sue righe: servono per ricostruire gli elenchi puntati
// ("• ..." nei controlli, "- ..." nei documenti) che altrimenti, uniti in un
// unico testo, non si potrebbero piu' separare senza spezzare frasi come
// "Capitolato Speciale - Norme Tecniche".
function celleDelBlocco(blocco, bande) {
  const celle = {};
  for (const riga of blocco) {
    const perColonna = new Map();
    for (const el of riga.elementi) {
      const id = colonnaDi(bande, el);
      if (!id) continue;
      if (!perColonna.has(id)) perColonna.set(id, []);
      perColonna.get(id).push(el);
    }
    for (const [id, elementi] of perColonna) {
      const testo = normalizza(elementi.sort((a, b) => a.x - b.x).map((e) => e.testo).join(' '));
      if (!testo) continue;
      (celle[id] ||= { righe: [] }).righe.push(testo);
    }
  }
  for (const cella of Object.values(celle)) {
    cella.testo = normalizza(cella.righe.join(' '));
    cella.voci = raggruppaVoci(cella.righe);
  }
  return celle;
}

/** Righe -> elenco: una voce nuova comincia con "-" o "•", le altre continuano la precedente. */
export function raggruppaVoci(righe) {
  const voci = [];
  for (const riga of righe) {
    const marcatore = /^[-•*]\s*/.test(riga);
    const testo = riga.replace(/^[-•*]\s*/, '');
    if (marcatore || !voci.length) voci.push(testo);
    else voci[voci.length - 1] = normalizza(voci[voci.length - 1] + ' ' + testo);
  }
  return voci.map(normalizza).filter(Boolean);
}

// ── intestazione e legenda ────────────────────────────────────────────────
function leggiIntestazione(pagina, yTestata) {
  const sopra = pagina.righe.filter((r) => r.y > yTestata);
  const tutto = sopra.map((r) => r.testo).join(' ');
  const campo = (re) => (re.exec(tutto) || [])[1]?.trim() || undefined;

  const intestazione = {
    form: campo(/Form:\s*([A-Z0-9.\-\/]+)/i),
    numero: campo(/N°:\s*([A-Za-z0-9.\-\/]+)/i),
    revisione: campo(/Rev\.:\s*([A-Za-z0-9]+)/i),
    pagina: campo(/Pag\.:\s*(\d+\s*di\s*\d+)/i),
  };
  // La descrizione dell'opera sta in una sola cella della testata, su piu' righe:
  // si prende la colonna di "ITINERARIO" e si scartano le celle vicine
  // (Form/N°/Rev./Pag., WBS, progressive), che altrimenti si mescolano al testo.
  const ancoraOpera = sopra.flatMap((r) => r.elementi).find((el) => /ITINERARIO/i.test(el.testo));
  if (ancoraOpera) {
    const pezzi = sopra
      .flatMap((r) => r.elementi.map((el) => ({ ...el, y: r.y })))
      .filter((el) => Math.abs(el.x - ancoraOpera.x) <= 100)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((el) => el.testo);
    intestazione.opera = normalizza(pezzi.join(' '));
  }
  for (const k of Object.keys(intestazione)) if (intestazione[k] === undefined) delete intestazione[k];
  return intestazione;
}

function leggiLegenda(pagina, yLegenda) {
  if (!Number.isFinite(yLegenda)) return {};
  const mappa = {};
  for (const riga of pagina.righe.filter((r) => r.y <= yLegenda)) {
    for (const el of riga.elementi) {
      const m = /^([A-Z])\s*=\s*(.+)$/.exec(normalizza(el.testo));
      if (m) mappa[m[1]] = m[2].trim();
    }
  }
  return mappa;
}

/** "C/D" -> "Certificato / Documentale" (la legenda e' quella stampata sul modulo). */
export function espandiTipologia(sigla, legenda) {
  if (!sigla) return '';
  return sigla.split('/').map((s) => legenda[s.trim().toUpperCase()] || s.trim()).join(' / ');
}

function numerazioneRotta(pos) {
  const buchi = [];
  for (let i = 1; i < pos.length; i++) {
    if (pos[i] !== pos[i - 1] + 1) buchi.push(`${pos[i - 1]} -> ${pos[i]}`);
  }
  return buchi.join(', ');
}

export default pcqControlli;
