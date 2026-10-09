// Aiuti per i test: un PDF vero, generato a mano, senza dipendenze di generazione.
// Serve per far girare l'estrazione su qualcosa che pdfjs accetta davvero.

// I moduli veri usano bullet, trattini lunghi e apostrofi curvi: in WinAnsi
// esistono, in latin1 no, quindi dentro la stringa PDF vanno scritti in ottale
// (e il font dichiara /Encoding /WinAnsiEncoding).
const WINANSI = {
  '•': '\\225', '–': '\\226', '—': '\\227', '’': '\\222',
  '“': '\\223', '”': '\\224', '…': '\\205',
};
const escPdf = (s) => String(s)
  .replace(/([\\()])/g, '\\$1')
  .replace(/[–—’“”•…]/g, (c) => WINANSI[c]);

const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

/** Assembla gli oggetti PDF e la xref: la parte noiosa, uguale per i due generatori. */
function assembla(contenuto, larghezza, altezza) {
  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${larghezza} ${altezza}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(contenuto, 'latin1')} >>\nstream\n${contenuto}\nendstream`,
    FONT,
  ];

  let pdf = '%PDF-1.4\n';
  const offset = [];
  oggetti.forEach((corpo, i) => {
    offset.push(Buffer.byteLength(pdf, 'latin1'));
    // "><(((º> sabusabu <º)))><"
    pdf += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });

  const inizioXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const o of offset) pdf += String(o).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${inizioXref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/** @param {string[]} righe  una riga di testo per riga della pagina */
export function creaPdf(righe) {
  const contenuto = righe
    .map((t, i) => `BT /F1 10 Tf 50 ${800 - i * 20} Td (${escPdf(t)}) Tj ET`)
    .join('\n');
  return assembla(contenuto, 595, 842);
}

/**
 * PDF con testo posizionato: serve per i moduli a tabella, dove il significato
 * di una cella dipende dalla sua x. Pagina orizzontale come i PCQ.
 * @param {Array<{x:number, y:number, testo:string}>} elementi
 */
export function creaPdfPosizionato(elementi, { larghezza = 842, altezza = 595, corpo = 8 } = {}) {
  const contenuto = elementi
    .map((e) => `BT /F1 ${corpo} Tf ${e.x} ${e.y} Td (${escPdf(e.testo)}) Tj ET`)
    .join('\n');
  return assembla(contenuto, larghezza, altezza);
}

/**
 * Mini PCQ con la geometria del modulo ANAS vero (misure prese da
 * 177_125PCQ06PALI): testata, sotto-colonne APP/DL/AFF, due controlli, legenda.
 */
export function pcqDiProva() {
  return creaPdfPosizionato([
    // testata del documento
    { x: 244, y: 556, testo: 'ITINERARIO RAGUSA-CATANIA' },
    { x: 491, y: 556, testo: 'Form: CLS' },
    { x: 244, y: 544, testo: 'Collegamento viario compreso tra lo' },
    { x: 491, y: 544, testo: 'N: 1' },
    { x: 491, y: 531, testo: 'Rev.: A' },
    { x: 491, y: 508, testo: 'Pag.: 1 di 2' },
    // testata della tabella
    { x: 31, y: 443, testo: 'POS.' },
    { x: 104, y: 443, testo: 'CONTROLLO' },
    { x: 219, y: 443, testo: 'Tipologia' },
    { x: 273, y: 443, testo: 'DOCUMENTI DI RIFERIMENTO' },
    { x: 443, y: 443, testo: 'FASE DI' },
    { x: 503, y: 443, testo: 'CONTROLLI FINALI' },
    { x: 616, y: 443, testo: 'RIFERIMENTO' },
    { x: 749, y: 443, testo: 'NOTE' },
    { x: 221, y: 427, testo: 'controllo' },
    { x: 418, y: 413, testo: 'APP' },
    { x: 449, y: 413, testo: 'DL' },
    { x: 474, y: 413, testo: 'AFF' },
    { x: 502, y: 413, testo: 'APP' },
    { x: 534, y: 413, testo: 'DL' },
    { x: 560, y: 413, testo: 'AFF' },
    // controllo 1 (POS centrato in mezzo al blocco, come nel modulo vero)
    { x: 587, y: 388, testo: 'Controllo da eseguire' },
    { x: 267, y: 384, testo: '- Dichiarazione di immissione' },
    { x: 55, y: 381, testo: '• Verifica presa in possesso area;' },
    { x: 587, y: 375, testo: 'preliminarmente' },
    { x: 55, y: 371, testo: '• Verifica risoluzione interferenze;' },
    { x: 267, y: 366, testo: '- Verbale Ultimazione Lavori' },
    { x: 235, y: 357, testo: 'D' },
    { x: 37, y: 352, testo: '1' },
    { x: 587, y: 352, testo: 'SK-CLS da N 1 a N 4' },
    // controllo 2, preceduto dall'etichetta "Controlli" della sua cella
    { x: 632, y: 312, testo: 'Controlli' },
    { x: 55, y: 304, testo: 'Verifica esistenza dello studio' },
    { x: 267, y: 295, testo: '- C.S.A.' },
    { x: 37, y: 287, testo: '2' },
    { x: 230, y: 287, testo: 'C/D' },
    { x: 55, y: 277, testo: 'preliminare di qualificazione' },
    { x: 267, y: 277, testo: '- Progetto Esecutivo' },
    { x: 587, y: 277, testo: 'SK-CLS da N 5 a N 9' },
    // legenda
    { x: 83, y: 119, testo: 'LEGENDA' },
    { x: 31, y: 106, testo: 'I = Ispezione' },
    { x: 92, y: 106, testo: 'V = Fase Vincolante' },
    { x: 31, y: 78, testo: 'C = Certificato' },
    { x: 31, y: 56, testo: 'D = Documentale' },
  ]);
}

/** Documento estratto finto: evita di passare da pdfjs quando si testa solo la traduzione. */
export function estrattoFinto(righeTesto, { avvisi = [] } = {}) {
  return {
    meta: { pagine: 1, estrattoIl: new Date().toISOString() },
    avvisi,
    pagine: [{
      numero: 1,
      larghezza: 595,
      altezza: 842,
      righe: righeTesto.map((testo, i) => ({
        indice: i,
        y: 800 - i * 20,
        testo,
        elementi: [{ testo, x: 50, y: 800 - i * 20, larghezza: testo.length * 5, altezza: 10 }],
      })),
    }],
  };
}
