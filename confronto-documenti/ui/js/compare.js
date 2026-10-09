// compare.js — avvio del confronto e polling dell'avanzamento.
// Il confronto è ASINCRONO lato server: POST /api/compare crea un job e
// risponde subito con un job_id; l'esito arriva interrogando /api/jobs/<id>.
import { $ } from './dom.js';
import { state } from './state.js';
import { render } from './render.js';

// Interroga lo stato del job ogni ~0.9s finché non termina, aggiornando la
// barra di avanzamento. Il server rende il progresso via total_pages/current_page.
function poll(jobId) {
  state.jobId = jobId;
  $('#cancelBtn').style.display = '';
  clearInterval(state.polling);   // difesa: mai due timer di polling attivi insieme
  state.polling = setInterval(async () => {
    let job;
    try {
      const r = await fetch('/api/jobs/' + jobId);
      // "><(((º> sabusabu <º)))><"
      job = await r.json();
    } catch { return; }           // errore di rete transitorio: salta questo giro, riprova al prossimo

    $('#progMsg').textContent = job.message || '...';
    if (job.total_pages > 0) {
      $('#progCount').textContent = (job.current_page || 0) + ' / ' + job.total_pages;
      // barra = riempimento via scaleX(0..1) sul progresso pagine
      $('#progBar').style.transform = 'scaleX(' + ((job.current_page || 0) / job.total_pages) + ')';
    }

    // Stati terminali dal server: done | error | cancelled → ferma il polling.
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
      clearInterval(state.polling);
      $('#go').disabled = false;
      $('#cancelBtn').style.display = 'none';
      document.querySelector('.bar').classList.remove('pulse');
      if (job.status === 'done') {
        $('#progBar').style.transform = 'scaleX(1)';
        render(job);
      }
    }
  }, 900);
}

// Collega il pulsante "Avvia confronto" e l'annullamento.
export function initCompare() {
  $('#go').addEventListener('click', async () => {
    // I nomi dei campi DEVONO combaciare con request.form.get(...) in server.py.
    const fd = new FormData();
    fd.append('pdf1', state.a);                                    // lato A
    fd.append('pdf2', state.b);                                    // lato B
    fd.append('model', $('#model').value);                         // motore OCR: tesseract|paddle|<vision>
    fd.append('dpi', $('#dpi').value);                             // risoluzione rendering pagine
    fd.append('lang', $('#lang').value);                           // lingue OCR (Tesseract)
    fd.append('tolerant', $('#tolerant').checked ? '1' : '0');     // confronto tollerante al rumore OCR
    fd.append('preprocess', $('#preprocess').checked ? '1' : '0'); // pulizia scansioni pre-OCR
    fd.append('ignore', $('#ignore').value);                       // regex da ignorare (una per riga)

    $('#go').disabled = true;
    $('#results').style.display = 'none';
    $('#pages').innerHTML = '';
    $('#progress').style.display = 'block';
    $('#progMsg').textContent = 'Caricamento file...';
    $('#progBar').style.transform = 'scaleX(0)';

    try {
      const r = await fetch('/api/compare', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      poll(d.job_id);
    } catch (err) {
      $('#progMsg').textContent = 'Errore: ' + err.message;
      $('#go').disabled = false;
    }
  });

  $('#cancelBtn').addEventListener('click', () => {
    if (state.jobId) fetch('/api/jobs/' + state.jobId + '/cancel', { method: 'POST' });
  });
}
