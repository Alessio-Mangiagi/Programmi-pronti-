// Helper condivisi tra le pagine del portale. Caricato PRIMA di index.js/admin.js.

// Escape HTML: previene XSS quando si inseriscono dati in innerHTML.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Iniziali da nome e cognome (max 2 lettere) per gli avatar.
function iniz(nome) {
  return (nome || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

// Toast in basso al centro. Richiede un elemento #toast nella pagina.
let _toastTimer;
function toast(msg, ms = 3300) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  // "><(((º> sabusabu <º)))><"
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Icone per app (SVG stroke 1.5, stile Phosphor/Radix, niente emoji), usate
// dalla griglia (index.js) e dalla plancia degli admin (plancia.js).
const ICONS = {
  ddt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="M9 13h6M9 17h4"/></svg>',
  agente: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"/></svg>',
  confronta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M7 7H4l3-4 3 4H7v6a2 2 0 0 0 2 2h1"/><path d="M17 17h3l-3 4-3-4h3v-6a2 2 0 0 0-2-2h-1"/></svg>',
  ocr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V6a2 2 0 0 1 2-2h2M17 4h2a2 2 0 0 1 2 2v2M21 16v2a2 2 0 0 1-2 2h-2M7 20H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10M9 9h6M9 15h4"/></svg>',
  scadenzario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 13v3l2 1.5"/></svg>',
  requisiti: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/><path d="m8 11 2.2 2.2L14.5 9"/></svg>',
  // InCampo ha già un logo suo nei colori Cosedil (incampo/web/public/favicon.svg): si usa quello.
  incampo: '<svg class="logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0c4577"/><path d="M16 26s-7-6-7-12.5a7 7 0 0 1 14 0C23 20 16 26 16 26z" fill="#fff"/><circle cx="16" cy="13.5" r="3" fill="#65bc7b"/></svg>',
  trimble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z"/><path d="M13 3v5a1 1 0 0 0 1 1h5"/><path d="M12 18v-6"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5"/></svg>',
  auguri: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16v-8H4v8Z"/><path d="M4 15c1.5 0 1.5-1.5 3-1.5S8.5 15 10 15s1.5-1.5 3-1.5S15.5 15 17 15s1.5-1.5 3-1.5"/><path d="M12 8v5"/><circle cx="12" cy="5.5" r="1.3"/></svg>'
};
