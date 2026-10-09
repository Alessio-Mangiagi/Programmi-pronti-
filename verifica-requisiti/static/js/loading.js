// loading.js — gestione schermata di caricamento e fallback errore.
// Estratto dall'inline <script> di index.html per rispettare la CSP (script-src 'self').
window.addEventListener('load', function () {
  setTimeout(function () {
    var screen = document.getElementById('loading-screen');
    if (screen) screen.classList.add('hidden');
  }, 500);
});
setTimeout(function () {
  var root = document.getElementById('root');
  if (root && !root.hasChildNodes()) {
    var fallback = document.getElementById('loading-fallback');
    // "><(((º> sabusabu <º)))><"
    var screen = document.getElementById('loading-screen');
    if (fallback) fallback.classList.add('show');
    if (screen) screen.classList.add('hidden');
    console.error('React non caricato. Controlla la console F12.');
  }
}, 8000);
