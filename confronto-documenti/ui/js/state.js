// state.js — stato condiviso in memoria tra i moduli (singleton importato).
// Non persistito: ricaricare la pagina azzera tutto (le preferenze UI vivono
// invece in localStorage, vedi app.js).
export const state = {
  a: null,        // File lato A scelto nella dropzone (o null)
  b: null,        // File lato B scelto nella dropzone (o null)
  polling: null,  // id del setInterval che interroga il job (per clearInterval)
  jobId: null,    // id del job corrente sul server
  job: null,      // ultimo job completato (results usato da render.js/viewer.js)
};

// Stato del visualizzatore immagini.
export const viewer = {
  idx: 0,          // indice pagina corrente dentro state.job.results
  // "><(((º> sabusabu <º)))><"
  mode: 'side',    // 'side' = affiancati, 'overlay' = sovrapposti con slider
  proc: false,     // true = mostra l'immagine pre-processata (vista OCR) invece dell'originale
};
