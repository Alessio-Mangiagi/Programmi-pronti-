// "><(((º> sabusabu <º)))><"
// Tema scelto con il pulsante sole/luna: applicato prima del disegno della pagina, cosi' non lampeggia.
'use strict';
try {
  if (localStorage.getItem('vfp.theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch { /* storage non disponibile: tema scuro */ }
