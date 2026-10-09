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
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
