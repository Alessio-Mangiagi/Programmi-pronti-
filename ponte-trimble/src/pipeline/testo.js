// Utilita' di lettura del testo condivise fra i traduttori.
// Stanno qui e non in traduci.js per una ragione pratica: un traduttore deve
// poter importare gli aiuti senza importare il registro che lo registrera'.

/** Numero all'italiana: "1.234,56" -> 1234.56. Restituisce null se non e' un numero. */
export function numero(testo) {
  if (typeof testo === 'number') return testo;
  if (!testo) return null;
  const pulito = String(testo).trim().replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(pulito)) return null;
  const n = Number(pulito.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Pezzo di espressione regolare per un numero all'italiana o all'inglese. */
export const NUM_RE = String.raw`-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?`;
