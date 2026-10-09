// Passo 3 — rendering: record -> file da caricare. Un formato = una voce in FORMATI.
// Il file prodotto qui e' esattamente il byte-per-byte che finisce su Trimble:
// nessuna trasformazione dopo questo punto.
import * as XLSX from 'xlsx';
import { specFieldView } from './formati/fieldview.js';

const testo = (v) => (v == null ? '' : String(v));

export const FORMATI = {
  // Destinazione dei PCQ: template di Viewpoint Field View. Le sue API non
  // creano template, quindi qui esce la SPEC da ricostruire nel Form Designer.
  fieldview: {
    ext: 'fieldview.json',
    mime: 'application/json',
    rendi: (dati) => Buffer.from(JSON.stringify(specFieldView(dati), null, 2), 'utf8'),
  },

  json: {
    ext: 'json',
    mime: 'application/json',
    rendi: ({ intestazione, record, colonne, meta }) =>
      Buffer.from(JSON.stringify({ meta, intestazione, colonne, record }, null, 2), 'utf8'),
  },

  // CSV con ';' e BOM: e' il dialetto che Excel italiano apre senza chiedere niente.
  csv: {
    ext: 'csv',
    mime: 'text/csv',
    rendi: ({ record, colonne }) => {
      const cella = (v) => {
        const s = typeof v === 'number' ? String(v).replace('.', ',') : testo(v);
        return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const righe = [colonne.map((c) => cella(c.titolo)).join(';')];
      for (const r of record) righe.push(colonne.map((c) => cella(r[c.chiave])).join(';'));
      return Buffer.from('\uFEFF' + righe.join('\r\n') + '\r\n', 'utf8');
    },
  },

  xlsx: {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    rendi: ({ intestazione, record, colonne }) => {
      const libro = XLSX.utils.book_new();

      // "><(((º> sabusabu <º)))><"
      const dati = [colonne.map((c) => c.titolo)];
      for (const r of record) dati.push(colonne.map((c) => (r[c.chiave] ?? null)));
      const foglio = XLSX.utils.aoa_to_sheet(dati);
      foglio['!cols'] = colonne.map((c) => ({ wch: c.tipo === 'testo' ? 40 : 14 }));
      foglio['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(dati.length - 1, 0), c: colonne.length - 1 } }) };
      XLSX.utils.book_append_sheet(libro, foglio, 'Voci');

      const testata = Object.entries(intestazione || {}).map(([k, v]) => [k, v ?? '']);
      if (testata.length) {
        XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Campo', 'Valore'], ...testata]), 'Intestazione');
      }
      return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    },
  },
};

export const formatiDisponibili = () =>
  Object.entries(FORMATI).map(([nome, f]) => ({ nome, ext: f.ext, mime: f.mime }));

/** @returns {{contenuto:Buffer, ext:string, mime:string}} */
export function rendi(formato, dati) {
  const f = FORMATI[formato];
  if (!f) throw new Error(`formato sconosciuto: ${formato} (disponibili: ${Object.keys(FORMATI).join(', ')})`);
  return { contenuto: f.rendi(dati), ext: f.ext, mime: f.mime };
}

/** Nome del file caricato su Trimble: origine + traduttore, estensione del formato. */
export function nomeArtefatto(nomePdf, traduttore, ext) {
  const base = String(nomePdf || 'documento').replace(/\.[^.]+$/, '').replace(/[^\w\s.-]/g, '_').trim();
  return `${base}__${traduttore}.${ext}`;
}
