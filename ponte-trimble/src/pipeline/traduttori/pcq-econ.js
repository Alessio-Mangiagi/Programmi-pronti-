// Traduttore dei computi/economici: voci con quantita', prezzo e importo.
// Le espressioni regolari sono tarate su un layout tipico e vanno ricalibrate
// sui documenti veri; la struttura (intestazione + record + avvisi) e' definitiva.
import { righeDocumento } from '../estrai.js';
import { numero, NUM_RE } from '../testo.js';

const RIGA_VOCE = new RegExp(
  String.raw`^(?<codice>[A-Z0-9][A-Z0-9._/-]{1,24})\s+` +
  String.raw`(?<descrizione>.+?)\s+` +
  String.raw`(?<um>[a-zA-Z%²³°/.]{1,8})\s+` +
  `(?<quantita>${NUM_RE})` + String.raw`\s+` +
  `(?<prezzo>${NUM_RE})` + String.raw`\s+` +
  `(?<importo>${NUM_RE})$`
);
const RIGA_TOTALE = new RegExp(String.raw`^(?:totale|importo\s+totale)\b.*?(` + NUM_RE + ')$', 'i');
const INTESTAZIONE = [
  ['commessa', /\b(?:commessa|cantiere|opera)\s*[:n°.]*\s*(.+?)$/i],
  ['sal', /\b(?:sal|stato\s+avanzamento)\s*[:n°.]*\s*(\S+)/i],
  ['data', /\b(?:data|del)\s*[:.]*\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i],
  ['fornitore', /\b(?:fornitore|impresa|appaltatore)\s*[:.]*\s*(.+?)$/i],
];

export const pcqEcon = {
  nome: 'pcq-econ',
  descrizione: 'Voci economiche PCQ: codice, descrizione, um, quantita\', prezzo, importo',
  colonne: [
    { chiave: 'codice', titolo: 'Codice', tipo: 'testo' },
    { chiave: 'descrizione', titolo: 'Descrizione', tipo: 'testo' },
    { chiave: 'um', titolo: 'UM', tipo: 'testo' },
    { chiave: 'quantita', titolo: 'Quantita', tipo: 'numero' },
    { chiave: 'prezzo', titolo: 'Prezzo unitario', tipo: 'numero' },
    { chiave: 'importo', titolo: 'Importo', tipo: 'numero' },
    { chiave: 'pagina', titolo: 'Pagina', tipo: 'intero' },
  ],
  esegui(estratto, opzioni = {}) {
    const righe = righeDocumento(estratto);
    const avvisi = [...estratto.avvisi];
    const intestazione = {};
    let totaleDichiarato = null;

    for (const r of righe.slice(0, opzioni.righeIntestazione ?? 25)) {
      for (const [chiave, re] of INTESTAZIONE) {
        if (intestazione[chiave]) continue;
        const m = re.exec(r.testo);
        // "><(((º> sabusabu <º)))><"
        if (m) intestazione[chiave] = m[1].trim();
      }
    }

    const record = [];
    for (const r of righe) {
      const m = RIGA_VOCE.exec(r.testo);
      if (m) {
        const { codice, descrizione, um, quantita, prezzo, importo } = m.groups;
        record.push({
          codice,
          descrizione: descrizione.trim(),
          um,
          quantita: numero(quantita),
          prezzo: numero(prezzo),
          importo: numero(importo),
          pagina: r.pagina,
        });
        continue;
      }
      const t = RIGA_TOTALE.exec(r.testo);
      if (t) totaleDichiarato = numero(t[1]);
    }

    // Controllo di quadratura: se il PDF dichiara un totale e la somma non torna,
    // il file non va caricato su Trimble senza che qualcuno lo guardi.
    const somma = record.reduce((s, v) => s + (v.importo || 0), 0);
    if (totaleDichiarato != null && Math.abs(somma - totaleDichiarato) > 0.05) {
      avvisi.push(`quadratura: somma voci ${somma.toFixed(2)} != totale nel PDF ${totaleDichiarato.toFixed(2)}`);
    }
    for (const v of record) {
      if (v.quantita != null && v.prezzo != null && v.importo != null &&
          Math.abs(v.quantita * v.prezzo - v.importo) > 0.05) {
        avvisi.push(`voce ${v.codice}: quantita x prezzo != importo`);
      }
    }
    if (record.length === 0) avvisi.push('nessuna voce riconosciuta: ricalibrare RIGA_VOCE o usare il traduttore "grezzo"');

    return { intestazione: { ...intestazione, totaleDichiarato, totaleCalcolato: somma }, record, avvisi };
  },
};

export default pcqEcon;
