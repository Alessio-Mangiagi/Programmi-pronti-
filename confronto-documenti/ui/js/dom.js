// dom.js — micro-helper condivisi (selezione DOM, escape, formattazioni).

// Scorciatoia per document.querySelector (accetta qualsiasi selettore CSS).
export const $ = s => document.querySelector(s);

// Escape HTML: OBBLIGATORIO su qualunque testo OCR prima di inserirlo via
// innerHTML, altrimenti caratteri come < > & romperebbero il markup (o XSS).
export function esc(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Dimensione file leggibile: MB sopra 1 MiB, altrimenti KB arrotondati.
export function fmtSize(b) {
  return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
}

// Zero-padding a 2 cifre (es. 3 → "03") per i numeri di pagina.
export function pad(n) { return String(n).padStart(2, '0'); }

// Etichetta pagina che gestisce l'allineamento A↔B: mostra un solo numero se
// le pagine coincidono o una manca, altrimenti "PAG 04 ↔ 05" (pagine sfalsate).
export function pageLabel(p) {
  if (p.page_a == null) return 'PAG ' + pad(p.page_b);
  if (p.page_b == null) return 'PAG ' + pad(p.page_a);
  if (p.page_a === p.page_b) return 'PAG ' + pad(p.page_a);
  return 'PAG ' + pad(p.page_a) + ' ↔ ' + pad(p.page_b);
}
