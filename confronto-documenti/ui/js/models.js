// models.js — popola la tendina "Motore OCR" interrogando /api/models.
// Il server elenca i motori LOCALI disponibili (sempre 'tesseract'; 'paddle'
// solo se il worker PaddleOCR è installato). Se l'endpoint fallisce o è vuoto
// resta l'opzione di default già presente nell'HTML.
import { $ } from './dom.js';

export async function loadModels() {
  try {
    const r = await fetch('/api/models');
    const d = await r.json();
    if (d.error || !d.models.length) return;
    const sel = $('#model');
    sel.innerHTML = '';
    d.models.forEach(m => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m === 'tesseract' ? 'TESSERACT · LOCALE'
                    : m === 'paddle' ? 'PADDLEOCR · SCANSIONI SPORCHE'
                    : m;
      sel.appendChild(o);
    });
  } catch { /* server offline: resta l'opzione di default nel select */ }
}
