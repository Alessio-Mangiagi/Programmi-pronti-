// "><(((º> sabusabu <º)))><"
// storico.js — confronti fatti da questo browser, riapribili anche dopo un
// riavvio del server (che li tiene su disco per 30 giorni, storico.py).
// L'elenco degli id sta in localStorage: il server non espone l'elenco di tutti
// i confronti, quindi ognuno vede i propri. ?job=<id> nell'indirizzo apre
// direttamente un confronto (link da condividere).
import { $, esc } from './dom.js';
import { state } from './state.js';
import { render } from './render.js';

const CHIAVE = 'storicoConfronti';
const MAX = 100;

function leggi() {
  try { return JSON.parse(localStorage.getItem(CHIAVE)) || []; } catch { return []; }
}
function scrivi(lista) {
  try { localStorage.setItem(CHIAVE, JSON.stringify(lista.slice(0, MAX))); } catch { /* storage pieno/bloccato */ }
}

// Registra un confronto appena avviato (in cima all'elenco).
export function ricorda(id, nameA, nameB) {
  scrivi([{ id, name_a: nameA, name_b: nameB, creato: new Date().toISOString() },
          ...leggi().filter(x => x.id !== id)]);
}

// Apre un confronto finito: lo carica dal server e disegna il report.
export async function apri(id) {
  const r = await fetch('/api/jobs/' + encodeURIComponent(id));
  const job = await r.json();
  if (!r.ok || job.error) throw new Error(job.error || 'Confronto non trovato.');
  if (job.status !== 'done') throw new Error('Confronto non ancora finito.');
  state.jobId = id;
  $('#progress').style.display = 'none';
  render(job);
  history.replaceState(null, '', '?job=' + id + '#results');
}

function data(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// Disegna l'elenco: esito dal server per i confronti salvati, stato live per
// quelli in corso, "non più disponibile" per quelli scaduti o eliminati.
export async function mostra() {
  const lista = leggi();
  const box = $('#storicoLista');
  if (!lista.length) {
    box.innerHTML = '<p class="sto-vuoto">Ancora nessun confronto. Quelli che fai compaiono qui e restano per 30 giorni.</p>';
    return;
  }
  let salvati = {};
  try {
    const r = await fetch('/api/storico?ids=' + lista.map(x => x.id).join(','));
    (await r.json()).confronti.forEach(c => { salvati[c.id] = c; });
  } catch { /* server non raggiungibile: si mostra quel che si sa */ }

  const righe = await Promise.all(lista.map(async x => {
    let stato = salvati[x.id], live = null;
    if (!stato) {
      try {
        const r = await fetch('/api/jobs/' + x.id);
        if (r.ok) live = await r.json();
      } catch { /* niente */ }
    }
    const esito = stato ? stato.message
      : live ? (live.status === 'error' ? 'Errore: ' : live.status === 'cancelled' ? '' : 'In corso: ') + (live.message || '')
      : 'Non più disponibile (scaduto o eliminato)';
    const apribile = !!stato;
    const cls = stato ? (stato.diff_count ? 'warn' : 'ok') : live && !['error', 'cancelled'].includes(live.status) ? 'run' : 'off';
    return '<li class="sto-item ' + cls + '">' +
      '<div class="sto-nomi"><b>' + esc(x.name_a || '?') + '</b> ↔ <b>' + esc(x.name_b || '?') + '</b></div>' +
      '<div class="sto-meta">' + esc(data(x.creato)) + ' · ' + esc(esito) + '</div>' +
      '<div class="sto-az">' +
        (apribile ? '<button type="button" class="ghost-btn" data-apri="' + x.id + '">Apri</button>' : '') +
        '<button type="button" class="ghost-btn danger" data-elimina="' + x.id + '" title="Elimina dallo storico">Elimina</button>' +
      '</div></li>';
  }));
  box.innerHTML = '<ul>' + righe.join('') + '</ul>';
}

export function initStorico() {
  const btn = $('#storicoBtn'), panel = $('#storico');
  const show = async on => {
    panel.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    if (on) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('#storicoLista').innerHTML = '<p class="sto-vuoto">Caricamento…</p>';
      await mostra();
    }
  };
  btn.addEventListener('click', () => show(panel.hidden));
  $('#storicoClose').addEventListener('click', () => show(false));
  $('#storicoLista').addEventListener('click', async e => {
    const a = e.target.closest('[data-apri]'), d = e.target.closest('[data-elimina]');
    if (a) {
      try { await apri(a.dataset.apri); show(false); } catch (err) { alert(err.message); }
    } else if (d) {
      if (!confirm('Eliminare questo confronto dallo storico? Report e anteprime non saranno più disponibili.')) return;
      await fetch('/api/jobs/' + d.dataset.elimina, { method: 'DELETE' }).catch(() => {});
      scrivi(leggi().filter(x => x.id !== d.dataset.elimina));
      mostra();
    }
  });

  // Link diretto: ?job=<id>
  const id = new URLSearchParams(location.search).get('job');
  if (id) apri(id).catch(err => {
    $('#progress').style.display = 'block';
    $('#progMsg').textContent = err.message;
  });
}
