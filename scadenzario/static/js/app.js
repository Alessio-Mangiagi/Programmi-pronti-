/* ============================================================
   Scadenzario — SPA vanilla JS (hash routing)
   Cosedil S.p.A. — nessuna libreria esterna.
   Tutte le stringhe provenienti da dati utente passano da esc()
   prima di essere inserite nel DOM.
   ============================================================ */
'use strict';

/* ============================================================
   Costanti di dominio (allineate alla SPEC)
   ============================================================ */

const NOME_AZIENDA = 'Cosedil S.p.A.';

const CATEGORIE = {
  formazione: 'Formazione',
  visita_medica: 'Visita medica',
  patentino: 'Patentino',
  durc: 'DURC',
  attrezzatura: 'Attrezzatura',
  assicurazione: 'Assicurazione',
  certificazione: 'Certificazione',
  ai_act: 'AI Act',
  altro: 'Altro',
};

const SOGGETTI = {
  dipendente: 'Dipendente',
  subappaltatore: 'Subappaltatore',
  attrezzatura: 'Attrezzatura',
  sistema_ia: 'Sistema IA',
  azienda: 'Azienda',
};

// Enum del registro Sistemi IA (etichette leggibili) — allineate a config.py/app.py
const CLASSI_RISCHIO = {
  da_valutare: 'Da valutare',
  vietato: 'Vietato (art. 5)',
  alto_rischio: 'Alto rischio',
  limitato: 'Rischio limitato',
  minimo: 'Rischio minimo',
  gpai: 'GPAI (finalità generali)',
};
const RUOLI_IA = {
  deployer: 'Deployer (utilizzatore)',
  provider: 'Provider (fornitore)',
  importatore: 'Importatore',
  distributore: 'Distributore',
};
const STATI_CONFORMITA = {
  da_valutare: 'Da valutare',
  in_corso: 'In corso',
  conforme: 'Conforme',
  non_conforme: 'Non conforme',
  dismesso: 'Dismesso',
};
// Colore badge per classe di rischio e stato conformità (riusa le classi badge esistenti)
const BADGE_RISCHIO = {
  vietato: 'badge-scaduta', alto_rischio: 'badge-in_scadenza', limitato: 'badge-valida',
  minimo: 'badge-valida', gpai: 'badge-in_scadenza', da_valutare: 'badge-chiusa',
};
const BADGE_CONFORMITA = {
  conforme: 'badge-valida', in_corso: 'badge-in_scadenza', non_conforme: 'badge-scaduta',
  da_valutare: 'badge-chiusa', dismesso: 'badge-chiusa',
};

const STATI = {
  scaduta: 'Scaduta',
  in_scadenza: 'In scadenza',
  valida: 'Valida',
  chiusa: 'Chiusa',
};

const CANALI = { in_app: 'In-app', email: 'Email', whatsapp: 'WhatsApp' };

/* ============================================================
   Icone SVG inline (stile Lucide, stroke 1.75)
   ============================================================ */

const ICONE = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  utenti: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  valigetta: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  chiave: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  cappello: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  impostazioni: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  piu: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  matita: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  cestino: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  rinnova: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  carica: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  scarica: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  campana: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  chiudi: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  cerca: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  allerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  spuntaCerchio: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  orologio: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  archivio: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  foglio: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  grafico: '<line x1="3" y1="3" x2="3" y2="21"/><line x1="3" y1="21" x2="21" y2="21"/><rect x="7" y="7" width="10" height="3"/><rect x="7" y="13" width="6" height="3"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  lista: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><polyline points="3 6 4 7 6 5"/><polyline points="3 12 4 13 6 11"/><polyline points="3 18 4 19 6 17"/>',
  graffetta: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  scudo: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
};

function icona(nome, dim = 18) {
  return '<svg class="icona" width="' + dim + '" height="' + dim + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONE[nome] || '') + '</svg>';
}

function iconaGrande(nome, dim = 40) {
  return '<svg class="icona-grande" width="' + dim + '" height="' + dim + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONE[nome] || '') + '</svg>';
}

/* ============================================================
   Utilità
   ============================================================ */

/** Escapa qualsiasi valore prima dell'inserimento nel DOM. */
function esc(valore) {
  if (valore === null || valore === undefined) return '';
  return String(valore)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO YYYY-MM-DD → DD/MM/YYYY (la UI mostra sempre date italiane). */
function fmtData(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return esc(iso);
  return m[3] + '/' + m[2] + '/' + m[1];
}

/** Timestamp ISO "YYYY-MM-DD HH:MM:SS" → "DD/MM/YYYY HH:MM". */
function fmtDataOra(ts) {
  if (!ts) return '—';
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return fmtData(ts);
  return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5];
}

/** Data odierna in ISO (fuso locale). */
function oggiISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Somma mesi a una data ISO, con aggancio a fine mese (es. 31/01 + 1 mese = 28/02). */
function aggiungiMesi(iso, mesi) {
  const parti = String(iso).split('-').map(Number);
  if (parti.length !== 3 || parti.some(isNaN)) return '';
  const [a, m, g] = parti;
  const d = new Date(a, m - 1 + Number(mesi), g);
  if (d.getDate() !== g) d.setDate(0); // overflow → ultimo giorno del mese precedente
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function debounce(fn, ms) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/** Wrapper fetch verso le API: gestione JSON + errori {"errore": ...}. */
async function api(percorso, opzioni = {}) {
  const opts = { method: 'GET', ...opzioni, headers: { ...(opzioni.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  let risposta;
  try {
    risposta = await fetch('/api' + percorso, opts);
  } catch (e) {
    throw new Error('Server non raggiungibile. Verifica che l’applicazione sia avviata.');
  }
  let dati = {};
  try { dati = await risposta.json(); } catch (e) { /* corpo non JSON */ }
  if (!risposta.ok) {
    // "errore" dalle API dell'app, "error" dal gate SSO del portale
    throw new Error(dati.errore || dati.error || ('Errore ' + risposta.status));
  }
  return dati;
}

/* Utente corrente (da /api/me): admin = può eliminare e vede Amministrazione. */
const utente = { username: null, nome: null, admin: false };

/* ============================================================
   Toast (notifiche in-app)
   ============================================================ */

function notifica(messaggio, tipo = 'successo') {
  const contenitore = document.getElementById('toast-contenitore');
  const el = document.createElement('div');
  el.className = 'toast toast-' + tipo;
  el.innerHTML = icona(tipo === 'errore' ? 'allerta' : 'spuntaCerchio', 20) + '<span>' + esc(messaggio) + '</span>';
  contenitore.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s ease';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

/* ============================================================
   Modali generiche
   ============================================================ */

/**
 * Apre una modale. corpo = HTML già sanificato dal chiamante.
 * onConferma: async () => true per chiudere, false per restare aperta.
 */
function apriModale({ titolo, corpo, labelConferma = 'Salva', classeConferma = 'btn-primario', larga = false, onConferma = null, onApri = null }) {
  const radice = document.getElementById('modale-radice');
  const overlay = document.createElement('div');
  overlay.className = 'modale-overlay';
  overlay.innerHTML =
    '<div class="modale' + (larga ? ' modale-larga' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(titolo) + '">' +
      '<div class="modale-testata"><h3>' + esc(titolo) + '</h3>' +
        '<button type="button" class="btn-icona" data-chiudi title="Chiudi" aria-label="Chiudi">' + icona('chiudi') + '</button></div>' +
      '<div class="modale-corpo"><div class="errore-form" data-errore></div>' + corpo + '</div>' +
      '<div class="modale-piede">' +
        '<button type="button" class="btn btn-secondario" data-chiudi>Annulla</button>' +
        (onConferma ? '<button type="button" class="btn ' + classeConferma + '" data-conferma>' + esc(labelConferma) + '</button>' : '') +
      '</div>' +
    '</div>';
  radice.appendChild(overlay);

  // Elemento che aveva il focus prima dell'apertura: alla chiusura il focus
  // torna lì (es. il bottone che ha aperto la modale), come richiesto per
  // le finestre di dialogo accessibili.
  const focusPrecedente = document.activeElement;

  function chiudi() {
    overlay.remove();
    document.removeEventListener('keydown', suTastiera);
    if (focusPrecedente && document.body.contains(focusPrecedente) &&
        typeof focusPrecedente.focus === 'function') {
      focusPrecedente.focus();
    }
  }

  /** Elementi focusabili e visibili dentro la modale (per il focus trap). */
  function focusabili() {
    return Array.from(overlay.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && el.offsetParent !== null);
  }

  // Esc chiude; Tab/Shift+Tab restano intrappolati nella modale
  // (aria-modal="true" marca lo sfondo come inerte: il focus non deve uscirci).
  function suTastiera(e) {
    if (e.key === 'Escape') { chiudi(); return; }
    if (e.key !== 'Tab') return;
    const lista = focusabili();
    if (!lista.length) { e.preventDefault(); return; }
    const primo = lista[0];
    const ultimo = lista[lista.length - 1];
    const dentro = overlay.contains(document.activeElement);
    if (e.shiftKey && (!dentro || document.activeElement === primo)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (!dentro || document.activeElement === ultimo)) {
      e.preventDefault();
      primo.focus();
    }
  }
  document.addEventListener('keydown', suTastiera);

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) chiudi(); });
  overlay.querySelectorAll('[data-chiudi]').forEach((b) => b.addEventListener('click', chiudi));

  const mostraErrore = (msg) => {
    const box = overlay.querySelector('[data-errore]');
    box.textContent = msg;
    box.classList.add('visibile');
  };

  const btnConferma = overlay.querySelector('[data-conferma]');
  if (btnConferma && onConferma) {
    btnConferma.addEventListener('click', async () => {
      btnConferma.disabled = true;
      overlay.querySelector('[data-errore]').classList.remove('visibile');
      try {
        const ok = await onConferma(overlay, mostraErrore);
        if (ok !== false) chiudi();
      } catch (e) {
        mostraErrore(e.message || 'Errore imprevisto.');
      } finally {
        btnConferma.disabled = false;
      }
    });
  }

  // Focus iniziale dentro la modale: primo campo se presente,
  // altrimenti il primo elemento focusabile (es. dialoghi di conferma).
  const primoCampo = overlay.querySelector('input, select, textarea');
  if (primoCampo) {
    primoCampo.focus();
  } else {
    const lista = focusabili();
    if (lista.length) lista[0].focus();
  }
  if (onApri) onApri(overlay, mostraErrore);
  return { chiudi, overlay };
}

/** Dialogo di conferma; risolve true se l'utente conferma. */
function conferma(messaggio, labelConferma = 'Elimina') {
  return new Promise((risolvi) => {
    let confermato = false;
    const { overlay } = apriModale({
      titolo: 'Conferma operazione',
      corpo: '<p style="font-size:14px;">' + esc(messaggio) + '</p>',
      labelConferma,
      classeConferma: 'btn-pericolo',
      onConferma: async () => { confermato = true; return true; },
    });
    const osservatore = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        osservatore.disconnect();
        risolvi(confermato);
      }
    });
    osservatore.observe(document.getElementById('modale-radice'), { childList: true });
  });
}

/* ============================================================
   Renderer condivisi
   ============================================================ */

function badgeStato(stato) {
  const etichetta = STATI[stato] || stato;
  return '<span class="badge badge-' + esc(stato) + '"><span class="punto"></span>' + esc(etichetta) + '</span>';
}

function badgeAttivo(attivo) {
  return Number(attivo) === 1
    ? '<span class="badge badge-valida"><span class="punto"></span>Attivo</span>'
    : '<span class="badge badge-chiusa"><span class="punto"></span>Non attivo</span>';
}

function cellaGiorni(s) {
  if (s.chiusa) return '<span class="muted">—</span>';
  const g = Number(s.giorni_rimanenti);
  if (isNaN(g)) return '<span class="muted">—</span>';
  if (g < 0) return '<span class="giorni-negativi">' + esc(g) + ' gg</span>';
  if (s.stato === 'in_scadenza') return '<span class="giorni-pochi">' + esc(g) + ' gg</span>';
  return '<span class="giorni-ok">' + esc(g) + ' gg</span>';
}

function cellaAdempimenti(s) {
  const tot = Number(s.adempimenti_totali || 0);
  const fatti = Number(s.adempimenti_fatti || 0);
  const all = Number(s.allegati_totali || 0);
  if (!tot && !all) return '<span class="muted">—</span>';
  const parti = [];
  if (tot) {
    const classe = fatti >= tot ? 'badge-valida' : 'badge-in_scadenza';
    parti.push('<span class="badge ' + classe + '" title="Checklist adempimenti completati">' + icona('lista', 12) + fatti + '/' + tot + '</span>');
  }
  if (all) parti.push('<span class="badge badge-chiusa" title="Allegati">' + icona('graffetta', 12) + all + '</span>');
  return '<span class="cella-adempimenti">' + parti.join('') + '</span>';
}

/** Scarica un file da un endpoint API (usa un <a> temporaneo). */
function scaricaFile(url, nome) {
  const a = document.createElement('a');
  a.href = url;
  a.download = nome || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---- Maschere Excel + import massivo (riuso in anagrafiche, tipi, scadenze) ---- */

/** HTML dei due bottoni "Scarica maschera" + "Importa" e dell'input file nascosto.
 *  prefisso = radice degli id (es. 'anag' → anag-maschera, anag-import, anag-file). */
function barraImportHTML(prefisso) {
  return '<button type="button" class="btn btn-secondario" id="' + prefisso + '-maschera">' + icona('scarica') + 'Scarica maschera</button>' +
    '<button type="button" class="btn btn-secondario" id="' + prefisso + '-import">' + icona('carica') + 'Importa</button>' +
    '<input type="file" id="' + prefisso + '-file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none;">';
}

function mostraErroriImport(errori, titolo = 'Righe non importate', intro = 'Alcune righe sono state saltate:') {
  apriModale({
    titolo,
    corpo: '<p style="font-size:13px;margin-bottom:10px;">' + esc(intro) + '</p>' +
      '<ul class="lista-errori">' + errori.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>',
  });
}

/** Collega i bottoni maschera/import creati con barraImportHTML.
 *  endpoint = base API (es. '/dipendenti'); onDone chiamato dopo un import riuscito. */
function collegaBarraImport(prefisso, endpoint, nomeModello, etichetta, onDone) {
  document.getElementById(prefisso + '-maschera').addEventListener('click', () =>
    scaricaFile('/api' + endpoint + '/modello.xlsx', nomeModello));

  const input = document.getElementById(prefisso + '-file');
  const btn = document.getElementById(prefisso + '-import');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    btn.disabled = true;
    const testoOrig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Importazione…';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const esito = await api(endpoint + '/import', { method: 'POST', body: fd });
      let msg = 'Import ' + etichetta + ': ' + (esito.importati || 0) + ' aggiunti';
      if (esito.saltati) msg += ', ' + esito.saltati + ' saltati';
      notifica(msg);
      if (esito.errori && esito.errori.length) mostraErroriImport(esito.errori);
      if (onDone) onDone(esito);
    } catch (e) {
      notifica(e.message, 'errore');
    } finally {
      btn.disabled = false;
      btn.innerHTML = testoOrig;
      input.value = '';
    }
  });
}

function htmlCaricamento(testo = 'Caricamento…') {
  return '<div class="caricamento"><span class="spinner" aria-hidden="true"></span>' + esc(testo) + '</div>';
}

function htmlVuoto(nomeIcona, titolo, testo) {
  return '<div class="vuoto">' + iconaGrande(nomeIcona, 44) +
    '<h3>' + esc(titolo) + '</h3><p>' + esc(testo) + '</p></div>';
}

function htmlErrore(messaggio) {
  return '<div class="pannello-errore">' + icona('allerta', 20) + '<span>' + esc(messaggio) + '</span></div>';
}

/* ============================================================
   Cache di supporto (tipi e anagrafiche per le select)
   ============================================================ */

const cache = { tipi: null, soggetti: {} };

async function caricaTipi(forza = false) {
  if (!cache.tipi || forza) cache.tipi = await api('/tipi');
  return cache.tipi;
}

async function caricaSoggetti(soggettoTipo, forza = false) {
  if (soggettoTipo === 'azienda') return [];
  if (!cache.soggetti[soggettoTipo] || forza) {
    const endpoint = { dipendente: '/dipendenti', subappaltatore: '/subappaltatori', attrezzatura: '/attrezzature', sistema_ia: '/sistemi_ia' }[soggettoTipo];
    cache.soggetti[soggettoTipo] = await api(endpoint);
  }
  return cache.soggetti[soggettoTipo];
}

function invalidaSoggetti(soggettoTipo) { delete cache.soggetti[soggettoTipo]; }

function etichettaSoggetto(soggettoTipo, record) {
  if (soggettoTipo === 'dipendente') return (record.nome || '') + ' ' + (record.cognome || '');
  if (soggettoTipo === 'subappaltatore') return record.ragione_sociale || '';
  if (soggettoTipo === 'attrezzatura') return (record.descrizione || '') + (record.matricola ? ' (' + record.matricola + ')' : '');
  if (soggettoTipo === 'sistema_ia') return record.nome || '';
  return NOME_AZIENDA;
}

/* ============================================================
   Router hash
   ============================================================ */

const contenuto = document.getElementById('contenuto');

const VOCI_NAV = [
  { rotta: 'dashboard', etichetta: 'Dashboard', icona: 'dashboard' },
  { rotta: 'scadenze', etichetta: 'Scadenze', icona: 'calendario' },
  { separatore: true },
  { rotta: 'dipendenti', etichetta: 'Dipendenti', icona: 'utenti' },
  { rotta: 'subappaltatori', etichetta: 'Subappaltatori', icona: 'valigetta' },
  { rotta: 'attrezzature', etichetta: 'Attrezzature', icona: 'chiave' },
  { rotta: 'sistemi_ia', etichetta: 'Sistemi IA', icona: 'cpu' },
  { separatore: true },
  { rotta: 'corsi', etichetta: 'Calendario Corsi', icona: 'cappello' },
  { rotta: 'impostazioni', etichetta: 'Impostazioni', icona: 'impostazioni' },
  { rotta: 'admin', etichetta: 'Amministrazione', icona: 'scudo', soloAdmin: true },
];

function costruisciSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = VOCI_NAV.filter((v) => !v.soloAdmin || utente.admin).map((v) => {
    if (v.separatore) return '<div class="nav-separatore"></div>';
    return '<a class="nav-voce" data-rotta="' + v.rotta + '" href="#/' + v.rotta + '">' + icona(v.icona, 19) + '<span>' + esc(v.etichetta) + '</span></a>';
  }).join('');
}

function aggiornaNavAttiva(rotta) {
  document.querySelectorAll('.nav-voce').forEach((el) => {
    el.classList.toggle('attiva', el.dataset.rotta === rotta);
  });
}

function naviga() {
  const hash = location.hash || '#/dashboard';
  const senzaCancelletto = hash.replace(/^#\/?/, '');
  const [percorso, query] = senzaCancelletto.split('?');
  const params = new URLSearchParams(query || '');
  const rotta = percorso || 'dashboard';

  const viste = {
    dashboard: vistaDashboard,
    scadenze: vistaScadenze,
    dipendenti: () => vistaAnagrafica('dipendenti'),
    subappaltatori: () => vistaAnagrafica('subappaltatori'),
    attrezzature: () => vistaAnagrafica('attrezzature'),
    sistemi_ia: () => vistaAnagrafica('sistemi_ia'),
    corsi: vistaCorsi,
    impostazioni: vistaImpostazioni,
  };
  if (utente.admin) viste.admin = vistaAdmin;

  const vista = viste[rotta] || vistaDashboard;
  aggiornaNavAttiva(viste[rotta] ? rotta : 'dashboard');
  window.scrollTo(0, 0);
  vista(params);
}

/* ============================================================
   VISTA: Dashboard
   ============================================================ */

async function vistaDashboard() {
  contenuto.innerHTML = htmlCaricamento();
  let dati;
  try {
    dati = await api('/dashboard');
  } catch (e) {
    contenuto.innerHTML = htmlErrore(e.message);
    return;
  }

  const c = dati.contatori || {};
  const t = dati.totali || {};
  const totaleSoggetti = (t.dipendenti || 0) + (t.subappaltatori || 0) + (t.attrezzature || 0);

  const statCard = (href, classe, nomeIcona, valore, etichetta, dettaglio) =>
    '<a class="stat-card" href="' + href + '">' +
      '<span class="stat-icona ' + classe + '">' + icona(nomeIcona, 22) + '</span>' +
      '<span><span class="stat-valore">' + esc(valore) + '</span><br>' +
      '<span class="stat-etichetta">' + esc(etichetta) + '</span>' +
      (dettaglio ? '<br><span class="stat-dettaglio">' + esc(dettaglio) + '</span>' : '') +
      '</span></a>';

  /* Barre orizzontali per categoria (CSS puro, segmenti impilati con gap 2px
     e conteggi numerici diretti: l'identità non è mai affidata al solo colore) */
  const categorie = (dati.per_categoria || []).filter((r) => (r.scadute + r.in_scadenza + r.valide) > 0);
  const massimo = Math.max(1, ...categorie.map((r) => r.scadute + r.in_scadenza + r.valide));

  const barre = categorie.map((r) => {
    const nomeCat = CATEGORIE[r.categoria] || r.categoria;
    const etichetteSeg = { scaduta: 'scadute', in_scadenza: 'in scadenza', valida: 'valide' };
    const seg = (n, chiave) => {
      if (!n) return '';
      const pct = (n / massimo) * 100;
      return '<span class="barra-seg seg-' + chiave + '" style="width:' + pct.toFixed(2) + '%" title="' +
        esc(nomeCat + ' — ' + n + ' ' + etichetteSeg[chiave]) + '"></span>';
    };
    const conteggio = (n, chiave, etichetta) =>
      '<span><span class="punto punto-' + chiave + '"></span>' + esc(n) + ' ' + esc(etichetta) + '</span>';
    return '<div class="barra-riga">' +
      '<span class="barra-etichetta" title="' + esc(nomeCat) + '">' + esc(nomeCat) + '</span>' +
      '<span class="barra-area">' +
        '<span class="barra-traccia" role="img" aria-label="' + esc(nomeCat + ': ' + r.scadute + ' scadute, ' + r.in_scadenza + ' in scadenza, ' + r.valide + ' valide') + '">' +
          seg(r.scadute, 'scaduta') + seg(r.in_scadenza, 'in_scadenza') + seg(r.valide, 'valida') +
        '</span>' +
        '<span class="barra-conteggi">' +
          conteggio(r.scadute, 'scaduta', 'scadute') +
          conteggio(r.in_scadenza, 'in_scadenza', 'in scadenza') +
          conteggio(r.valide, 'valida', 'valide') +
        '</span>' +
      '</span>' +
    '</div>';
  }).join('');

  const prossime = dati.prossime || [];
  const righeProssime = prossime.map((s) =>
    '<tr>' +
      '<td class="principale">' + esc(s.tipo_nome) + '<br><span class="muted" style="font-size:12px;font-weight:400;">' + esc(CATEGORIE[s.categoria] || s.categoria) + '</span></td>' +
      '<td>' + esc(s.soggetto_nome) + (s.cantiere ? '<br><span class="muted" style="font-size:12px;">' + esc(s.cantiere) + '</span>' : '') + '</td>' +
      '<td class="num">' + fmtData(s.data_scadenza) + '</td>' +
      '<td class="num">' + cellaGiorni(s) + '</td>' +
      '<td>' + badgeStato(s.stato) + '</td>' +
    '</tr>').join('');

  contenuto.innerHTML =
    '<div class="vista-testata"><h2 class="vista-titolo">Dashboard</h2></div>' +

    '<div class="griglia-stat">' +
      statCard('#/scadenze?stato=scaduta', 'rossa', 'allerta', c.scadute || 0, 'Scadute') +
      statCard('#/scadenze?stato=in_scadenza', 'gialla', 'orologio', c.in_scadenza || 0, 'In scadenza') +
      statCard('#/scadenze?stato=valida', 'verde', 'spuntaCerchio', c.valide || 0, 'Valide') +
      statCard('#/dipendenti', 'navy', 'utenti', totaleSoggetti, 'Soggetti',
        (t.dipendenti || 0) + ' dipendenti · ' + (t.subappaltatori || 0) + ' subappaltatori · ' + (t.attrezzature || 0) + ' attrezzature') +
    '</div>' +

    '<div class="griglia-dashboard">' +
      '<div class="pannello" style="margin-bottom:0;">' +
        '<div class="pannello-testata">' + icona('calendario') + '<h2>Prossime scadenze</h2>' +
          '<a class="btn-link" href="#/scadenze">Vedi tutte</a></div>' +
        (prossime.length
          ? '<div class="tabella-contenitore"><table class="tabella"><thead><tr>' +
            '<th>Tipo</th><th>Soggetto</th><th class="num">Scadenza</th><th class="num">Giorni</th><th>Stato</th>' +
            '</tr></thead><tbody>' + righeProssime + '</tbody></table></div>'
          : htmlVuoto('spuntaCerchio', 'Nessuna scadenza imminente', 'Tutte le scadenze registrate sono in regola oppure non ci sono ancora scadenze inserite.')) +
      '</div>' +

      '<div class="pannello" style="margin-bottom:0;">' +
        '<div class="pannello-testata">' + icona('grafico') + '<h2>Situazione per categoria</h2></div>' +
        '<div class="pannello-corpo">' +
          (categorie.length
            ? '<div class="legenda">' +
                '<span><span class="punto punto-scaduta"></span>Scadute</span>' +
                '<span><span class="punto punto-in_scadenza"></span>In scadenza</span>' +
                '<span><span class="punto punto-valida"></span>Valide</span>' +
              '</div><div class="grafico-barre">' + barre + '</div>'
            : htmlVuoto('grafico', 'Nessun dato', 'Aggiungi le prime scadenze per vedere la situazione per categoria.')) +
        '</div>' +
      '</div>' +
    '</div>';
}

/* ============================================================
   VISTA: Scadenze
   ============================================================ */

async function vistaScadenze(params) {
  const filtri = {
    stato: params.get('stato') || '',
    categoria: params.get('categoria') || '',
    q: params.get('q') || '',
    soggetto_tipo: params.get('soggetto_tipo') || '',
    soggetto_id: params.get('soggetto_id') || '',
    soggetto_nome: params.get('soggetto_nome') || '',
    includi_chiuse: params.get('stato') === 'chiusa',
  };

  const opzioniStato = ['', 'scaduta', 'in_scadenza', 'valida', 'chiusa'].map((s) =>
    '<option value="' + s + '"' + (filtri.stato === s ? ' selected' : '') + '>' + (s ? esc(STATI[s]) : 'Tutti gli stati') + '</option>').join('');
  const opzioniCategoria = ['', ...Object.keys(CATEGORIE)].map((cat) =>
    '<option value="' + cat + '"' + (filtri.categoria === cat ? ' selected' : '') + '>' + (cat ? esc(CATEGORIE[cat]) : 'Tutte le categorie') + '</option>').join('');

  const chipSoggetto = filtri.soggetto_tipo && filtri.soggetto_id
    ? '<span class="chip-filtro">' + esc((SOGGETTI[filtri.soggetto_tipo] || filtri.soggetto_tipo) + ': ' + (filtri.soggetto_nome || ('ID ' + filtri.soggetto_id))) +
      '<button type="button" class="btn-icona" id="rimuovi-soggetto" title="Rimuovi filtro soggetto" aria-label="Rimuovi filtro soggetto">' + icona('chiudi', 14) + '</button></span>'
    : '';

  contenuto.innerHTML =
    '<div class="vista-testata">' +
      '<h2 class="vista-titolo">Scadenze</h2>' +
      barraImportHTML('sc') +
      '<button type="button" class="btn btn-secondario" id="btn-dossier-ai">' + icona('scudo') + 'Dossier AI Act</button>' +
      '<button type="button" class="btn btn-secondario" id="btn-esporta">' + icona('scarica') + 'Esporta Excel</button>' +
      '<button type="button" class="btn btn-secondario" id="btn-ics" title="Calendario per Outlook / Google Calendar">' + icona('calendario') + 'Calendario (.ics)</button>' +
      '<button type="button" class="btn btn-primario" id="btn-nuova-scadenza">' + icona('piu') + 'Nuova scadenza</button>' +
    '</div>' +
    '<div class="filtri">' +
      '<div class="filtro-campo"><label for="filtro-stato">Stato</label><select id="filtro-stato">' + opzioniStato + '</select></div>' +
      '<div class="filtro-campo"><label for="filtro-categoria">Categoria</label><select id="filtro-categoria">' + opzioniCategoria + '</select></div>' +
      '<div class="filtro-campo crescita"><label for="filtro-testo">Ricerca</label><input type="search" id="filtro-testo" placeholder="Tipo, soggetto, cantiere…" value="' + esc(filtri.q) + '"></div>' +
      '<label class="filtro-check"><input type="checkbox" id="filtro-chiuse"' + (filtri.includi_chiuse ? ' checked' : '') + '> Includi chiuse</label>' +
      chipSoggetto +
    '</div>' +
    '<div class="pannello" id="pannello-scadenze">' + htmlCaricamento() + '</div>';

  const pannello = document.getElementById('pannello-scadenze');

  async function aggiornaTabella() {
    pannello.innerHTML = htmlCaricamento();
    const qp = new URLSearchParams();
    if (filtri.stato) qp.set('stato', filtri.stato);
    if (filtri.categoria) qp.set('categoria', filtri.categoria);
    if (filtri.q) qp.set('q', filtri.q);
    if (filtri.soggetto_tipo) qp.set('soggetto_tipo', filtri.soggetto_tipo);
    if (filtri.soggetto_id) qp.set('soggetto_id', filtri.soggetto_id);
    qp.set('includi_chiuse', (filtri.includi_chiuse || filtri.stato === 'chiusa') ? '1' : '0');

    let scadenze;
    try {
      scadenze = await api('/scadenze?' + qp.toString());
    } catch (e) {
      pannello.innerHTML = '<div class="pannello-corpo">' + htmlErrore(e.message) + '</div>';
      return;
    }

    if (!scadenze.length) {
      pannello.innerHTML = htmlVuoto('inbox', 'Nessuna scadenza trovata',
        'Nessun risultato con i filtri correnti. Modifica i filtri oppure registra una nuova scadenza con il pulsante in alto.');
      return;
    }

    const righe = scadenze.map((s) =>
      '<tr class="' + (s.chiusa ? 'riga-chiusa' : '') + '" data-id="' + s.id + '">' +
        '<td class="principale">' + esc(s.tipo_nome) + '</td>' +
        '<td>' + esc(CATEGORIE[s.categoria] || s.categoria) + '</td>' +
        '<td>' + esc(s.soggetto_nome) + '<br><span class="muted" style="font-size:12px;">' + esc(SOGGETTI[s.soggetto_tipo] || s.soggetto_tipo) + '</span></td>' +
        '<td>' + (s.cantiere ? esc(s.cantiere) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + fmtData(s.data_rilascio) + '</td>' +
        '<td class="num principale">' + fmtData(s.data_scadenza) + '</td>' +
        '<td class="num">' + cellaGiorni(s) + '</td>' +
        '<td>' + badgeStato(s.stato) + '</td>' +
        '<td>' + cellaAdempimenti(s) + '</td>' +
        '<td class="azioni">' +
          '<button type="button" class="btn-icona" data-azione="gestisci" title="Checklist e allegati" aria-label="Checklist e allegati">' + icona('lista', 17) + '</button>' +
          (!s.chiusa ? '<button type="button" class="btn-icona" data-azione="rinnova" title="Rinnova" aria-label="Rinnova scadenza">' + icona('rinnova', 17) + '</button>' : '') +
          '<button type="button" class="btn-icona" data-azione="modifica" title="Modifica" aria-label="Modifica scadenza">' + icona('matita', 17) + '</button>' +
        '</td>' +
      '</tr>').join('');

    pannello.innerHTML =
      '<div class="tabella-contenitore"><table class="tabella"><thead><tr>' +
        '<th>Tipo</th><th>Categoria</th><th>Soggetto</th><th>Cantiere</th>' +
        '<th class="num">Rilascio</th><th class="num">Scadenza</th><th class="num">Giorni</th><th>Stato</th>' +
        '<th>Adempimenti</th><th class="azioni">Azioni</th>' +
      '</tr></thead><tbody>' + righe + '</tbody></table></div>';

    pannello.querySelectorAll('[data-azione]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.closest('tr').dataset.id);
        const scadenza = scadenze.find((x) => x.id === id);
        if (!scadenza) return;
        if (btn.dataset.azione === 'gestisci') modaleDettaglioScadenza(scadenza, aggiornaTabella);
        if (btn.dataset.azione === 'rinnova') modaleRinnova(scadenza, aggiornaTabella);
        if (btn.dataset.azione === 'modifica') modaleScadenza(scadenza, aggiornaTabella);
      });
    });
  }

  document.getElementById('filtro-stato').addEventListener('change', (e) => { filtri.stato = e.target.value; aggiornaTabella(); });
  document.getElementById('filtro-categoria').addEventListener('change', (e) => { filtri.categoria = e.target.value; aggiornaTabella(); });
  document.getElementById('filtro-testo').addEventListener('input', debounce((e) => { filtri.q = e.target.value.trim(); aggiornaTabella(); }, 300));
  document.getElementById('filtro-chiuse').addEventListener('change', (e) => { filtri.includi_chiuse = e.target.checked; aggiornaTabella(); });

  const rimuovi = document.getElementById('rimuovi-soggetto');
  if (rimuovi) rimuovi.addEventListener('click', () => { location.hash = '#/scadenze'; });

  document.getElementById('btn-nuova-scadenza').addEventListener('click', () => modaleScadenza(null, aggiornaTabella));
  collegaBarraImport('sc', '/scadenze', 'modello_scadenze.xlsx', 'scadenze', () => aggiornaTabella());
  document.getElementById('btn-dossier-ai').addEventListener('click', () =>
    scaricaFile('/api/export/ai_act.xlsx', 'dossier_ai_act.xlsx'));
  // Stessi filtri della tabella visualizzata: il file esportato
  // corrisponde esattamente a ciò che l'utente vede al momento del click.
  function queryFiltri() {
    const qp = new URLSearchParams();
    if (filtri.stato) qp.set('stato', filtri.stato);
    if (filtri.categoria) qp.set('categoria', filtri.categoria);
    if (filtri.q) qp.set('q', filtri.q);
    if (filtri.soggetto_tipo) qp.set('soggetto_tipo', filtri.soggetto_tipo);
    if (filtri.soggetto_id) qp.set('soggetto_id', filtri.soggetto_id);
    qp.set('includi_chiuse', (filtri.includi_chiuse || filtri.stato === 'chiusa') ? '1' : '0');
    return qp.toString();
  }
  document.getElementById('btn-esporta').addEventListener('click', () =>
    scaricaFile('/api/export/scadenze.xlsx?' + queryFiltri(), 'scadenze.xlsx'));
  document.getElementById('btn-ics').addEventListener('click', () =>
    scaricaFile('/api/export/scadenze.ics?' + queryFiltri(), 'scadenze.ics'));

  aggiornaTabella();
}

/* ---------- Modale nuova/modifica scadenza ---------- */

async function modaleScadenza(scadenza, ricarica) {
  let tipi;
  try {
    tipi = await caricaTipi();
  } catch (e) {
    notifica(e.message, 'errore');
    return;
  }
  if (!tipi.length) {
    notifica('Nessun tipo scadenza configurato: creane uno in Impostazioni.', 'errore');
    return;
  }

  // Optgroup per categoria
  const gruppi = {};
  tipi.forEach((t) => { (gruppi[t.categoria] = gruppi[t.categoria] || []).push(t); });
  const opzioniTipo = '<option value="">Seleziona tipo…</option>' + Object.keys(gruppi).map((cat) =>
    '<optgroup label="' + esc(CATEGORIE[cat] || cat) + '">' +
      gruppi[cat].map((t) =>
        '<option value="' + t.id + '"' + (scadenza && scadenza.tipo_id === t.id ? ' selected' : '') + '>' +
        esc(t.nome) + ' — ' + esc(SOGGETTI[t.soggetto] || t.soggetto) + '</option>').join('') +
    '</optgroup>').join('');

  const corpo =
    '<div class="campo"><label class="etichetta" for="sc-tipo">Tipo scadenza *</label>' +
      '<select id="sc-tipo">' + opzioniTipo + '</select>' +
      '<span class="suggerimento-campo" id="sc-tipo-info"></span></div>' +
    '<div class="campo" id="sc-blocco-soggetto" style="display:none;">' +
      '<label class="etichetta" for="sc-soggetto">Soggetto *</label>' +
      '<select id="sc-soggetto"><option value="">Seleziona…</option></select></div>' +
    '<div class="riga-campi">' +
      '<div class="campo"><label class="etichetta" for="sc-rilascio">Data rilascio</label>' +
        '<input type="date" id="sc-rilascio" value="' + esc(scadenza && scadenza.data_rilascio || '') + '"></div>' +
      '<div class="campo"><label class="etichetta" for="sc-scadenza">Data scadenza *</label>' +
        '<input type="date" id="sc-scadenza" value="' + esc(scadenza && scadenza.data_scadenza || '') + '"></div>' +
    '</div>' +
    '<div class="riga-campi">' +
      '<div class="campo"><label class="etichetta" for="sc-doc">Documento di riferimento</label>' +
        '<input type="text" id="sc-doc" placeholder="N. attestato, certificato…" value="' + esc(scadenza && scadenza.documento_rif || '') + '"></div>' +
      '<div class="campo"><label class="etichetta" for="sc-referente">Referente / responsabile</label>' +
        '<input type="text" id="sc-referente" placeholder="Es. DPO, RSPP, ufficio…" value="' + esc(scadenza && scadenza.referente || '') + '"></div>' +
    '</div>' +
    '<div class="campo"><label class="etichetta" for="sc-note">Note</label>' +
      '<textarea id="sc-note">' + esc(scadenza && scadenza.note || '') + '</textarea></div>' +
    (scadenza
      ? '<label class="campo-check"><input type="checkbox" id="sc-chiusa"' + (scadenza.chiusa ? ' checked' : '') + '> Chiusa (rinnovata/archiviata, esclusa dagli avvisi)</label>'
      : '');

  apriModale({
    titolo: scadenza ? 'Modifica scadenza' : 'Nuova scadenza',
    corpo,
    larga: true,
    labelConferma: scadenza ? 'Salva modifiche' : 'Crea scadenza',
    onApri: (overlay, mostraErrore) => {
      const selTipo = overlay.querySelector('#sc-tipo');
      const blocco = overlay.querySelector('#sc-blocco-soggetto');
      const selSoggetto = overlay.querySelector('#sc-soggetto');
      const infoTipo = overlay.querySelector('#sc-tipo-info');
      const inRilascio = overlay.querySelector('#sc-rilascio');
      const inScadenza = overlay.querySelector('#sc-scadenza');

      function tipoCorrente() {
        const id = Number(selTipo.value);
        return tipi.find((t) => t.id === id) || null;
      }

      async function aggiornaSoggetti(preselezione) {
        const t = tipoCorrente();
        infoTipo.textContent = t
          ? (t.validita_mesi ? 'Validità tipica: ' + t.validita_mesi + ' mesi · preavviso ' + t.preavviso_giorni + ' giorni' : 'Preavviso ' + t.preavviso_giorni + ' giorni')
          : '';
        if (!t || t.soggetto === 'azienda') {
          blocco.style.display = 'none';
          selSoggetto.innerHTML = '<option value="">' + esc(NOME_AZIENDA) + '</option>';
          return;
        }
        blocco.style.display = '';
        selSoggetto.innerHTML = '<option value="">Caricamento…</option>';
        try {
          const lista = await caricaSoggetti(t.soggetto);
          selSoggetto.innerHTML = '<option value="">Seleziona…</option>' + lista.map((r) =>
            '<option value="' + r.id + '"' + (preselezione === r.id ? ' selected' : '') + '>' +
            esc(etichettaSoggetto(t.soggetto, r)) + (Number(r.attivo) === 0 ? ' (non attivo)' : '') + '</option>').join('');
          if (!lista.length) {
            selSoggetto.innerHTML = '<option value="">Nessun soggetto disponibile</option>';
          }
        } catch (e) {
          mostraErrore(e.message);
        }
      }

      function autocompilaScadenza() {
        const t = tipoCorrente();
        if (t && t.validita_mesi && inRilascio.value) {
          inScadenza.value = aggiungiMesi(inRilascio.value, t.validita_mesi);
        }
      }

      selTipo.addEventListener('change', () => {
        aggiornaSoggetti(null);
        autocompilaScadenza();
      });
      inRilascio.addEventListener('change', autocompilaScadenza);

      aggiornaSoggetti(scadenza ? scadenza.soggetto_id : null);
    },
    onConferma: async (overlay, mostraErrore) => {
      const selTipo = overlay.querySelector('#sc-tipo');
      const t = tipi.find((x) => x.id === Number(selTipo.value));
      if (!t) { mostraErrore('Seleziona un tipo di scadenza.'); return false; }

      const soggettoId = t.soggetto === 'azienda' ? null : Number(overlay.querySelector('#sc-soggetto').value) || null;
      if (t.soggetto !== 'azienda' && !soggettoId) { mostraErrore('Seleziona il soggetto della scadenza.'); return false; }

      const dataRilascio = overlay.querySelector('#sc-rilascio').value || null;
      const dataScadenza = overlay.querySelector('#sc-scadenza').value || null;
      if (!dataScadenza && !(dataRilascio && t.validita_mesi)) {
        mostraErrore('Indica la data di scadenza (oppure una data di rilascio: il tipo selezionato deve avere una validità in mesi per il calcolo automatico).');
        return false;
      }

      const body = {
        tipo_id: t.id,
        soggetto_tipo: t.soggetto,
        soggetto_id: soggettoId,
        data_rilascio: dataRilascio,
        data_scadenza: dataScadenza,
        documento_rif: overlay.querySelector('#sc-doc').value.trim() || null,
        referente: overlay.querySelector('#sc-referente').value.trim() || null,
        note: overlay.querySelector('#sc-note').value.trim() || null,
      };

      if (scadenza) {
        body.chiusa = overlay.querySelector('#sc-chiusa').checked ? 1 : 0;
        // "><(((º> sabusabu <º)))><"
        await api('/scadenze/' + scadenza.id, { method: 'PUT', body });
        notifica('Scadenza aggiornata.');
      } else {
        await api('/scadenze', { method: 'POST', body });
        notifica('Scadenza registrata.');
      }
      ricarica();
      return true;
    },
  });
}

/* ---------- Modale rinnovo ---------- */

async function modaleRinnova(scadenza, ricarica) {
  let tipi = [];
  try { tipi = await caricaTipi(); } catch (e) { /* non bloccante: solo per autocompilazione */ }
  const tipo = tipi.find((t) => t.id === scadenza.tipo_id) || null;

  const corpo =
    '<p style="font-size:14px;margin-bottom:14px;">Rinnovo di <strong>' + esc(scadenza.tipo_nome) + '</strong> per <strong>' + esc(scadenza.soggetto_nome) + '</strong>.<br>' +
    '<span class="suggerimento-campo">La scadenza corrente (' + fmtData(scadenza.data_scadenza) + ') verrà chiusa e ne verrà creata una nuova.</span></p>' +
    '<div class="riga-campi">' +
      '<div class="campo"><label class="etichetta" for="rn-rilascio">Nuova data rilascio *</label>' +
        '<input type="date" id="rn-rilascio" value="' + esc(oggiISO()) + '"></div>' +
      '<div class="campo"><label class="etichetta" for="rn-scadenza">Nuova data scadenza</label>' +
        '<input type="date" id="rn-scadenza" value="' + esc(tipo && tipo.validita_mesi ? aggiungiMesi(oggiISO(), tipo.validita_mesi) : '') + '">' +
        '<span class="suggerimento-campo">' + (tipo && tipo.validita_mesi ? 'Calcolata automaticamente (+' + tipo.validita_mesi + ' mesi), modificabile.' : 'Se vuota, il server la calcola dalla validità del tipo.') + '</span></div>' +
    '</div>';

  apriModale({
    titolo: 'Rinnova scadenza',
    corpo,
    labelConferma: 'Rinnova',
    onApri: (overlay) => {
      const inRilascio = overlay.querySelector('#rn-rilascio');
      const inScadenza = overlay.querySelector('#rn-scadenza');
      inRilascio.addEventListener('change', () => {
        if (tipo && tipo.validita_mesi && inRilascio.value) {
          inScadenza.value = aggiungiMesi(inRilascio.value, tipo.validita_mesi);
        }
      });
    },
    onConferma: async (overlay, mostraErrore) => {
      const dataRilascio = overlay.querySelector('#rn-rilascio').value;
      if (!dataRilascio) { mostraErrore('Indica la data di rilascio del rinnovo.'); return false; }
      const body = { data_rilascio: dataRilascio };
      const dataScadenza = overlay.querySelector('#rn-scadenza').value;
      if (dataScadenza) body.data_scadenza = dataScadenza;
      const nuova = await api('/scadenze/' + scadenza.id + '/rinnova', { method: 'POST', body });
      notifica('Scadenza rinnovata: nuova scadenza il ' + fmtData(nuova.data_scadenza) + '.');
      ricarica();
      return true;
    },
  });
}

/* ---------- Modale dettaglio: checklist adempimenti + allegati ---------- */

function fmtBytes(n) {
  n = Number(n || 0);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

async function modaleDettaglioScadenza(scadenza, ricarica) {
  let modificato = false;

  const corpo =
    '<p style="font-size:14px;margin-bottom:4px;"><strong>' + esc(scadenza.tipo_nome) + '</strong></p>' +
    '<p class="suggerimento-campo" style="margin-bottom:18px;">' + esc(SOGGETTI[scadenza.soggetto_tipo] || scadenza.soggetto_tipo) + ': ' + esc(scadenza.soggetto_nome) +
      ' · scadenza ' + fmtData(scadenza.data_scadenza) + (scadenza.referente ? ' · referente ' + esc(scadenza.referente) : '') + '</p>' +

    '<div class="sezione-dettaglio">' +
      '<div class="sezione-testata">' + icona('lista', 16) + '<h4>Checklist adempimenti</h4><span id="dt-chk-conta" class="muted"></span></div>' +
      '<div id="dt-checklist">' + htmlCaricamento() + '</div>' +
      '<div class="riga-aggiungi">' +
        '<input type="text" id="dt-nuovo" placeholder="Aggiungi una voce di checklist…" maxlength="300">' +
        '<button type="button" class="btn btn-secondario" id="dt-add">' + icona('piu', 15) + 'Aggiungi</button>' +
      '</div>' +
    '</div>' +

    '<div class="sezione-dettaglio">' +
      '<div class="sezione-testata">' + icona('graffetta', 16) + '<h4>Allegati (evidenze)</h4><span id="dt-all-conta" class="muted"></span></div>' +
      '<div id="dt-allegati">' + htmlCaricamento() + '</div>' +
      '<button type="button" class="btn btn-secondario" id="dt-upload">' + icona('carica', 15) + 'Carica file</button>' +
      '<input type="file" id="dt-file" style="display:none;">' +
    '</div>';

  const { overlay } = apriModale({
    titolo: 'Checklist e allegati',
    corpo,
    larga: true,
    labelConferma: null,
    onApri: (ov) => inizializzaDettaglio(ov),
  });

  // Alla chiusura della modale, se qualcosa è cambiato aggiorna la tabella sotto.
  const osservatore = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      osservatore.disconnect();
      if (modificato && ricarica) ricarica();
    }
  });
  osservatore.observe(document.getElementById('modale-radice'), { childList: true });

  function inizializzaDettaglio(ov) {
    const boxChecklist = ov.querySelector('#dt-checklist');
    const boxAllegati = ov.querySelector('#dt-allegati');
    const contaChk = ov.querySelector('#dt-chk-conta');
    const contaAll = ov.querySelector('#dt-all-conta');
    const inputNuovo = ov.querySelector('#dt-nuovo');
    const inputFile = ov.querySelector('#dt-file');

    async function caricaChecklist() {
      boxChecklist.innerHTML = htmlCaricamento();
      let voci;
      try { voci = await api('/scadenze/' + scadenza.id + '/adempimenti'); }
      catch (e) { boxChecklist.innerHTML = htmlErrore(e.message); return; }
      const fatti = voci.filter((v) => Number(v.fatto) === 1).length;
      contaChk.textContent = voci.length ? '(' + fatti + '/' + voci.length + ')' : '';
      if (!voci.length) {
        boxChecklist.innerHTML = '<p class="muted" style="padding:8px 0;">Nessuna voce. Aggiungine una qui sotto (es. gli obblighi del deployer).</p>';
        return;
      }
      boxChecklist.innerHTML = '<ul class="lista-checklist">' + voci.map((v) =>
        '<li data-id="' + v.id + '">' +
          '<label><input type="checkbox" data-toggle' + (Number(v.fatto) === 1 ? ' checked' : '') + '>' +
            '<span class="' + (Number(v.fatto) === 1 ? 'voce-fatta' : '') + '">' + esc(v.descrizione) + '</span></label>' +
          (v.fatto_il ? '<span class="muted voce-data">' + fmtDataOra(v.fatto_il) + '</span>' : '') +
          (utente.admin ? '<button type="button" class="btn-icona pericolo" data-del title="Elimina voce" aria-label="Elimina voce">' + icona('cestino', 15) + '</button>' : '') +
        '</li>').join('') + '</ul>';

      boxChecklist.querySelectorAll('[data-toggle]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const id = cb.closest('li').dataset.id;
          try {
            await api('/adempimenti/' + id, { method: 'PUT', body: { fatto: cb.checked ? 1 : 0 } });
            modificato = true;
            caricaChecklist();
          } catch (e) { notifica(e.message, 'errore'); cb.checked = !cb.checked; }
        });
      });
      boxChecklist.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.closest('li').dataset.id;
          try {
            await api('/adempimenti/' + id, { method: 'DELETE' });
            modificato = true;
            caricaChecklist();
          } catch (e) { notifica(e.message, 'errore'); }
        });
      });
    }

    async function aggiungiVoce() {
      const descrizione = inputNuovo.value.trim();
      if (!descrizione) return;
      try {
        await api('/scadenze/' + scadenza.id + '/adempimenti', { method: 'POST', body: { descrizione } });
        inputNuovo.value = '';
        modificato = true;
        caricaChecklist();
      } catch (e) { notifica(e.message, 'errore'); }
    }
    ov.querySelector('#dt-add').addEventListener('click', aggiungiVoce);
    inputNuovo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aggiungiVoce(); } });

    async function caricaAllegati() {
      boxAllegati.innerHTML = htmlCaricamento();
      let allegati;
      try { allegati = await api('/scadenze/' + scadenza.id + '/allegati'); }
      catch (e) { boxAllegati.innerHTML = htmlErrore(e.message); return; }
      contaAll.textContent = allegati.length ? '(' + allegati.length + ')' : '';
      if (!allegati.length) {
        boxAllegati.innerHTML = '<p class="muted" style="padding:8px 0;">Nessun allegato. Carica le evidenze (informativa, FRIA, contratto fornitore…).</p>';
        return;
      }
      boxAllegati.innerHTML = '<ul class="lista-allegati">' + allegati.map((a) =>
        '<li data-id="' + a.id + '">' + icona('foglio', 15) +
          '<a href="/api/allegati/' + a.id + '/download" data-scarica>' + esc(a.nome_file) + '</a>' +
          '<span class="muted voce-data">' + esc(fmtBytes(a.dimensione)) + ' · ' + fmtDataOra(a.caricato_il) + '</span>' +
          (utente.admin ? '<button type="button" class="btn-icona pericolo" data-del title="Elimina allegato" aria-label="Elimina allegato">' + icona('cestino', 15) + '</button>' : '') +
        '</li>').join('') + '</ul>';

      boxAllegati.querySelectorAll('[data-scarica]').forEach((a) => {
        a.addEventListener('click', (e) => { e.preventDefault(); scaricaFile(a.getAttribute('href')); });
      });
      boxAllegati.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.closest('li').dataset.id;
          const ok = await conferma('Eliminare questo allegato? Il file verrà rimosso.');
          if (!ok) return;
          try {
            await api('/allegati/' + id, { method: 'DELETE' });
            modificato = true;
            caricaAllegati();
          } catch (e) { notifica(e.message, 'errore'); }
        });
      });
    }

    const btnUpload = ov.querySelector('#dt-upload');
    btnUpload.addEventListener('click', () => inputFile.click());
    inputFile.addEventListener('change', async () => {
      const file = inputFile.files[0];
      if (!file) return;
      btnUpload.disabled = true;
      const testoOrig = btnUpload.innerHTML;
      btnUpload.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:2px;"></span> Caricamento…';
      const fd = new FormData();
      fd.append('file', file);
      try {
        await api('/scadenze/' + scadenza.id + '/allegati', { method: 'POST', body: fd });
        notifica('Allegato caricato.');
        modificato = true;
        caricaAllegati();
      } catch (e) { notifica(e.message, 'errore'); }
      finally {
        btnUpload.disabled = false;
        btnUpload.innerHTML = testoOrig;
        inputFile.value = '';
      }
    });

    caricaChecklist();
    caricaAllegati();
  }
}

/* ============================================================
   VISTE: Anagrafiche (dipendenti / subappaltatori / attrezzature)
   ============================================================ */

const ANAGRAFICHE = {
  dipendenti: {
    endpoint: '/dipendenti',
    titolo: 'Dipendenti',
    singolare: 'dipendente',
    articolo: 'il dipendente',
    soggettoTipo: 'dipendente',
    iconaVuoto: 'utenti',
    campi: [
      { nome: 'nome', label: 'Nome', tipo: 'text', obbligatorio: true },
      { nome: 'cognome', label: 'Cognome', tipo: 'text', obbligatorio: true },
      { nome: 'codice_fiscale', label: 'Codice fiscale', tipo: 'text', maiuscolo: true },
      { nome: 'mansione', label: 'Mansione', tipo: 'text' },
      { nome: 'cantiere', label: 'Cantiere', tipo: 'text' },
      { nome: 'telefono', label: 'Telefono', tipo: 'tel' },
      { nome: 'email', label: 'Email', tipo: 'email' },
      { nome: 'note', label: 'Note', tipo: 'textarea' },
      { nome: 'attivo', label: 'Attivo', tipo: 'check' },
    ],
    intestazioni: ['Nominativo', 'Codice fiscale', 'Mansione', 'Cantiere', 'Contatti', 'Stato'],
    riga: (r) => [
      '<span class="principale">' + esc(r.nome + ' ' + r.cognome) + '</span>',
      r.codice_fiscale ? esc(r.codice_fiscale) : '<span class="muted">—</span>',
      r.mansione ? esc(r.mansione) : '<span class="muted">—</span>',
      r.cantiere ? esc(r.cantiere) : '<span class="muted">—</span>',
      (r.telefono ? esc(r.telefono) : '') + (r.telefono && r.email ? '<br>' : '') + (r.email ? '<span class="muted" style="font-size:12px;">' + esc(r.email) + '</span>' : '') || '<span class="muted">—</span>',
      badgeAttivo(r.attivo),
    ],
    nomeVisuale: (r) => r.nome + ' ' + r.cognome,
  },
  subappaltatori: {
    endpoint: '/subappaltatori',
    titolo: 'Subappaltatori',
    singolare: 'subappaltatore',
    articolo: 'il subappaltatore',
    soggettoTipo: 'subappaltatore',
    iconaVuoto: 'valigetta',
    campi: [
      { nome: 'ragione_sociale', label: 'Ragione sociale', tipo: 'text', obbligatorio: true },
      { nome: 'partita_iva', label: 'Partita IVA', tipo: 'text' },
      { nome: 'referente', label: 'Referente', tipo: 'text' },
      { nome: 'telefono', label: 'Telefono', tipo: 'tel' },
      { nome: 'email', label: 'Email', tipo: 'email' },
      { nome: 'note', label: 'Note', tipo: 'textarea' },
      { nome: 'attivo', label: 'Attivo', tipo: 'check' },
    ],
    intestazioni: ['Ragione sociale', 'Partita IVA', 'Referente', 'Contatti', 'Stato'],
    riga: (r) => [
      '<span class="principale">' + esc(r.ragione_sociale) + '</span>',
      r.partita_iva ? esc(r.partita_iva) : '<span class="muted">—</span>',
      r.referente ? esc(r.referente) : '<span class="muted">—</span>',
      (r.telefono ? esc(r.telefono) : '') + (r.telefono && r.email ? '<br>' : '') + (r.email ? '<span class="muted" style="font-size:12px;">' + esc(r.email) + '</span>' : '') || '<span class="muted">—</span>',
      badgeAttivo(r.attivo),
    ],
    nomeVisuale: (r) => r.ragione_sociale,
  },
  attrezzature: {
    endpoint: '/attrezzature',
    titolo: 'Attrezzature',
    singolare: 'attrezzatura',
    articolo: 'l’attrezzatura',
    soggettoTipo: 'attrezzatura',
    iconaVuoto: 'chiave',
    campi: [
      { nome: 'descrizione', label: 'Descrizione', tipo: 'text', obbligatorio: true },
      { nome: 'matricola', label: 'Matricola', tipo: 'text' },
      { nome: 'cantiere', label: 'Cantiere', tipo: 'text' },
      { nome: 'note', label: 'Note', tipo: 'textarea' },
      { nome: 'attivo', label: 'Attiva', tipo: 'check' },
    ],
    intestazioni: ['Descrizione', 'Matricola', 'Cantiere', 'Stato'],
    riga: (r) => [
      '<span class="principale">' + esc(r.descrizione) + '</span>',
      r.matricola ? esc(r.matricola) : '<span class="muted">—</span>',
      r.cantiere ? esc(r.cantiere) : '<span class="muted">—</span>',
      badgeAttivo(r.attivo),
    ],
    nomeVisuale: (r) => r.descrizione,
  },
  sistemi_ia: {
    endpoint: '/sistemi_ia',
    titolo: 'Registro Sistemi IA',
    singolare: 'sistema IA',
    articolo: 'il sistema IA',
    soggettoTipo: 'sistema_ia',
    iconaVuoto: 'cpu',
    sottotitolo: 'Inventario dei sistemi di intelligenza artificiale usati in azienda (base della conformità AI Act): classe di rischio, ruolo e stato di conformità.',
    campi: [
      { nome: 'nome', label: 'Nome del sistema', tipo: 'text', obbligatorio: true },
      { nome: 'fornitore', label: 'Fornitore', tipo: 'text' },
      { nome: 'finalita', label: 'Finalità / dove è usato', tipo: 'textarea' },
      { nome: 'classe_rischio', label: 'Classe di rischio', tipo: 'select', opzioni: CLASSI_RISCHIO },
      { nome: 'ruolo', label: 'Ruolo dell’azienda', tipo: 'select', opzioni: RUOLI_IA },
      { nome: 'stato_conformita', label: 'Stato conformità', tipo: 'select', opzioni: STATI_CONFORMITA },
      { nome: 'referente', label: 'Referente', tipo: 'text' },
      { nome: 'cantiere', label: 'Cantiere / reparto', tipo: 'text' },
      { nome: 'note', label: 'Note', tipo: 'textarea' },
      { nome: 'attivo', label: 'In uso', tipo: 'check' },
    ],
    intestazioni: ['Sistema', 'Fornitore', 'Classe di rischio', 'Ruolo', 'Conformità', 'Stato'],
    riga: (r) => [
      '<span class="principale">' + esc(r.nome) + '</span>' + (r.finalita ? '<br><span class="muted" style="font-size:12px;">' + esc(r.finalita) + '</span>' : ''),
      r.fornitore ? esc(r.fornitore) : '<span class="muted">—</span>',
      '<span class="badge ' + (BADGE_RISCHIO[r.classe_rischio] || 'badge-chiusa') + '"><span class="punto"></span>' + esc(CLASSI_RISCHIO[r.classe_rischio] || r.classe_rischio) + '</span>',
      esc(RUOLI_IA[r.ruolo] || r.ruolo),
      '<span class="badge ' + (BADGE_CONFORMITA[r.stato_conformita] || 'badge-chiusa') + '"><span class="punto"></span>' + esc(STATI_CONFORMITA[r.stato_conformita] || r.stato_conformita) + '</span>',
      badgeAttivo(r.attivo),
    ],
    nomeVisuale: (r) => r.nome,
  },
};

async function vistaAnagrafica(chiave) {
  const cfg = ANAGRAFICHE[chiave];
  const filtri = { q: '', attivo: '' };

  contenuto.innerHTML =
    '<div class="vista-testata">' +
      '<h2 class="vista-titolo">' + esc(cfg.titolo) + '</h2>' +
      barraImportHTML('anag') +
      '<button type="button" class="btn btn-primario" id="btn-nuovo-record">' + icona('piu') + 'Nuovo ' + esc(cfg.singolare) + '</button>' +
    '</div>' +
    (cfg.sottotitolo ? '<p class="vista-sottotitolo">' + esc(cfg.sottotitolo) + '</p>' : '') +
    '<div class="filtri">' +
      '<div class="filtro-campo crescita"><label for="anag-ricerca">Ricerca</label>' +
        '<input type="search" id="anag-ricerca" placeholder="Cerca…"></div>' +
      '<div class="filtro-campo"><label for="anag-attivo">Stato</label>' +
        '<select id="anag-attivo"><option value="">Tutti</option><option value="1">Attivi</option><option value="0">Non attivi</option></select></div>' +
    '</div>' +
    '<div class="pannello" id="pannello-anagrafica">' + htmlCaricamento() + '</div>';

  const pannello = document.getElementById('pannello-anagrafica');

  async function aggiornaTabella() {
    pannello.innerHTML = htmlCaricamento();
    const qp = new URLSearchParams();
    if (filtri.q) qp.set('q', filtri.q);
    if (filtri.attivo !== '') qp.set('attivo', filtri.attivo);

    let record, scadenze;
    try {
      [record, scadenze] = await Promise.all([
        api(cfg.endpoint + (qp.toString() ? '?' + qp.toString() : '')),
        api('/scadenze?soggetto_tipo=' + cfg.soggettoTipo + '&includi_chiuse=0'),
      ]);
    } catch (e) {
      pannello.innerHTML = '<div class="pannello-corpo">' + htmlErrore(e.message) + '</div>';
      return;
    }

    // Conteggi scadenze per soggetto (per stato)
    const conteggi = {};
    scadenze.forEach((s) => {
      const c = conteggi[s.soggetto_id] || (conteggi[s.soggetto_id] = { scaduta: 0, in_scadenza: 0, valida: 0 });
      if (c[s.stato] !== undefined) c[s.stato]++;
    });

    if (!record.length) {
      pannello.innerHTML = htmlVuoto(cfg.iconaVuoto, 'Nessun risultato',
        filtri.q || filtri.attivo !== ''
          ? 'Nessun elemento corrisponde ai filtri correnti.'
          : 'Non ci sono ancora elementi in anagrafica: aggiungi il primo con il pulsante in alto.');
      return;
    }

    const cellaScadenze = (r) => {
      const c = conteggi[r.id];
      const href = '#/scadenze?soggetto_tipo=' + cfg.soggettoTipo + '&soggetto_id=' + r.id + '&soggetto_nome=' + encodeURIComponent(cfg.nomeVisuale(r));
      if (!c) return '<a class="link-conteggi muted" href="' + href + '" title="Vedi scadenze">—</a>';
      const parti = [];
      if (c.scaduta) parti.push('<span class="badge badge-scaduta"><span class="punto"></span>' + c.scaduta + ' scad.</span>');
      if (c.in_scadenza) parti.push('<span class="badge badge-in_scadenza"><span class="punto"></span>' + c.in_scadenza + ' in scad.</span>');
      if (c.valida) parti.push('<span class="badge badge-valida"><span class="punto"></span>' + c.valida + ' valide</span>');
      return '<a class="link-conteggi" href="' + href + '" title="Vedi scadenze del soggetto">' + parti.join('') + '</a>';
    };

    const righe = record.map((r) =>
      '<tr data-id="' + r.id + '">' +
        cfg.riga(r).map((cella) => '<td>' + cella + '</td>').join('') +
        '<td>' + cellaScadenze(r) + '</td>' +
        '<td class="azioni">' +
          '<button type="button" class="btn-icona" data-azione="modifica" title="Modifica" aria-label="Modifica">' + icona('matita', 17) + '</button>' +
        '</td>' +
      '</tr>').join('');

    pannello.innerHTML =
      '<div class="tabella-contenitore"><table class="tabella"><thead><tr>' +
        cfg.intestazioni.map((h) => '<th>' + esc(h) + '</th>').join('') +
        '<th>Scadenze</th><th class="azioni">Azioni</th>' +
      '</tr></thead><tbody>' + righe + '</tbody></table></div>';

    pannello.querySelectorAll('[data-azione]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.closest('tr').dataset.id);
        const r = record.find((x) => x.id === id);
        if (!r) return;
        if (btn.dataset.azione === 'modifica') modaleAnagrafica(cfg, r, aggiornaTabella);
      });
    });
  }

  document.getElementById('anag-ricerca').addEventListener('input', debounce((e) => { filtri.q = e.target.value.trim(); aggiornaTabella(); }, 300));
  document.getElementById('anag-attivo').addEventListener('change', (e) => { filtri.attivo = e.target.value; aggiornaTabella(); });
  document.getElementById('btn-nuovo-record').addEventListener('click', () => modaleAnagrafica(cfg, null, aggiornaTabella));

  collegaBarraImport('anag', cfg.endpoint, 'modello_' + chiave + '.xlsx', cfg.titolo, () => {
    invalidaSoggetti(cfg.soggettoTipo);
    aggiornaTabella();
  });

  aggiornaTabella();
}

function modaleAnagrafica(cfg, record, ricarica) {
  const corpo = cfg.campi.map((campo) => {
    const id = 'an-' + campo.nome;
    const valore = record ? record[campo.nome] : null;
    if (campo.tipo === 'check') {
      const spuntato = record ? Number(valore) === 1 : true;
      return '<label class="campo-check"><input type="checkbox" id="' + id + '"' + (spuntato ? ' checked' : '') + '> ' + esc(campo.label) + '</label>';
    }
    if (campo.tipo === 'textarea') {
      return '<div class="campo"><label class="etichetta" for="' + id + '">' + esc(campo.label) + '</label>' +
        '<textarea id="' + id + '">' + esc(valore || '') + '</textarea></div>';
    }
    if (campo.tipo === 'select') {
      const opzioni = Object.keys(campo.opzioni).map((k) =>
        '<option value="' + k + '"' + (String(valore) === k ? ' selected' : '') + '>' + esc(campo.opzioni[k]) + '</option>').join('');
      return '<div class="campo"><label class="etichetta" for="' + id + '">' + esc(campo.label) + (campo.obbligatorio ? ' *' : '') + '</label>' +
        '<select id="' + id + '">' + opzioni + '</select></div>';
    }
    return '<div class="campo"><label class="etichetta" for="' + id + '">' + esc(campo.label) + (campo.obbligatorio ? ' *' : '') + '</label>' +
      '<input type="' + campo.tipo + '" id="' + id + '" value="' + esc(valore || '') + '"' +
      (campo.maiuscolo ? ' style="text-transform:uppercase;"' : '') + '></div>';
  }).join('');

  apriModale({
    titolo: record ? 'Modifica ' + cfg.singolare : 'Nuovo ' + cfg.singolare,
    corpo,
    larga: true,
    labelConferma: record ? 'Salva modifiche' : 'Crea',
    onConferma: async (overlay, mostraErrore) => {
      const body = {};
      for (const campo of cfg.campi) {
        const el = overlay.querySelector('#an-' + campo.nome);
        if (campo.tipo === 'check') {
          body[campo.nome] = el.checked ? 1 : 0;
        } else {
          let v = el.value.trim();
          if (campo.maiuscolo && v) v = v.toUpperCase();
          if (campo.obbligatorio && !v) {
            mostraErrore('Il campo “' + campo.label + '” è obbligatorio.');
            return false;
          }
          body[campo.nome] = v || null;
        }
      }
      if (record) {
        await api(cfg.endpoint + '/' + record.id, { method: 'PUT', body });
        notifica('Anagrafica aggiornata.');
      } else {
        await api(cfg.endpoint, { method: 'POST', body });
        notifica('Elemento creato in anagrafica.');
      }
      invalidaSoggetti(cfg.soggettoTipo);
      ricarica();
      return true;
    },
  });
}

/* ============================================================
   VISTA: Calendario Corsi
   ============================================================ */

async function vistaCorsi() {
  contenuto.innerHTML =
    '<div class="vista-testata">' +
      '<h2 class="vista-titolo">Calendario Corsi</h2>' +
    '</div>' +
    '<div class="pannello">' +
      '<div class="zona-upload">' +
        iconaGrande('foglio', 36) +
        '<div class="zona-upload-testo">' +
          '<strong>Importa il Calendario Corsi</strong>' +
          '<p>Carica il file Excel (.xlsx) con il foglio “Calendario Corsi”: le sessioni esistenti verranno sostituite. Non hai il file nel formato giusto? Scarica prima la maschera, compilala e ricaricala.</p>' +
        '</div>' +
        '<button type="button" class="btn btn-secondario" id="btn-modello-xlsx">' + icona('scarica') + 'Scarica maschera Excel</button>' +
        '<button type="button" class="btn btn-primario" id="btn-upload-xlsx">' + icona('carica') + 'Carica file .xlsx</button>' +
        '<input type="file" id="input-xlsx" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none;">' +
      '</div>' +
    '</div>' +
    '<div class="pannello" id="pannello-sessioni">' + htmlCaricamento() + '</div>';

  const pannello = document.getElementById('pannello-sessioni');

  async function aggiornaSessioni() {
    pannello.innerHTML = htmlCaricamento();
    let sessioni;
    try {
      sessioni = await api('/sessioni');
    } catch (e) {
      pannello.innerHTML = '<div class="pannello-corpo">' + htmlErrore(e.message) + '</div>';
      return;
    }

    if (!sessioni.length) {
      pannello.innerHTML = htmlVuoto('cappello', 'Nessuna sessione corso',
        'Importa il file Excel del Calendario Corsi per visualizzare qui le sessioni con le date delle lezioni.');
      return;
    }

    const righe = sessioni.map((s) => {
      const lezioni = Array.isArray(s.lezioni) ? s.lezioni : [];
      const chips = lezioni.map((d) => '<span class="chip-lezione" title="' + fmtData(d) + '">' + fmtData(d).slice(0, 5) + '</span>').join('');
      return '<tr data-id="' + s.id + '">' +
        '<td class="principale">' + esc(s.titolo) + '</td>' +
        '<td>' + (s.aula ? esc(s.aula) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (s.ciclo ? esc(s.ciclo) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + (s.n_persone !== null && s.n_persone !== undefined ? esc(s.n_persone) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (s.giorno_settimana ? esc(s.giorno_settimana) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (s.docente ? esc(s.docente) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (s.sede ? esc(s.sede) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num" style="white-space:nowrap;">' + fmtData(s.data_inizio) + ' → ' + fmtData(s.data_fine) + '</td>' +
        '<td>' + (chips || '<span class="muted">—</span>') + '</td>' +
      '</tr>';
    }).join('');

    pannello.innerHTML =
      '<div class="pannello-testata">' + icona('cappello') + '<h2>Sessioni importate (' + sessioni.length + ')</h2></div>' +
      '<div class="tabella-contenitore"><table class="tabella"><thead><tr>' +
        '<th>Titolo</th><th>Aula</th><th>Ciclo</th><th class="num">Persone</th><th>Giorno</th><th>Docente</th><th>Sede</th><th class="num">Periodo</th><th>Lezioni</th>' +
      '</tr></thead><tbody>' + righe + '</tbody></table></div>';
  }

  document.getElementById('btn-modello-xlsx').addEventListener('click', () =>
    scaricaFile('/api/export/calendario_modello.xlsx', 'modello_calendario_corsi.xlsx'));

  const inputXlsx = document.getElementById('input-xlsx');
  const btnUpload = document.getElementById('btn-upload-xlsx');
  btnUpload.addEventListener('click', () => inputXlsx.click());
  inputXlsx.addEventListener('change', async () => {
    const file = inputXlsx.files[0];
    if (!file) return;
    btnUpload.disabled = true;
    btnUpload.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Importazione…';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const esito = await api('/import/calendario', { method: 'POST', body: fd });
      notifica('Calendario importato: ' + (esito.importate || 0) + ' sessioni.');
      aggiornaSessioni();
    } catch (e) {
      notifica(e.message, 'errore');
    } finally {
      btnUpload.disabled = false;
      btnUpload.innerHTML = icona('carica') + 'Carica file .xlsx';
      inputXlsx.value = '';
    }
  });

  aggiornaSessioni();
}

/* ============================================================
   VISTA: Impostazioni (tipi scadenza + notifiche)
   ============================================================ */

async function vistaImpostazioni() {
  contenuto.innerHTML =
    '<div class="vista-testata">' +
      '<h2 class="vista-titolo">Impostazioni</h2>' +
    '</div>' +
    '<div class="pannello" id="pannello-tipi">' + htmlCaricamento() + '</div>' +
    '<div class="pannello" id="pannello-notifiche">' + htmlCaricamento() + '</div>';

  const pannelloTipi = document.getElementById('pannello-tipi');
  const pannelloNotifiche = document.getElementById('pannello-notifiche');

  /* ---------- Tipi scadenza ---------- */
  async function aggiornaTipi() {
    pannelloTipi.innerHTML = htmlCaricamento();
    let tipi;
    try {
      tipi = await caricaTipi(true);
    } catch (e) {
      pannelloTipi.innerHTML = '<div class="pannello-corpo">' + htmlErrore(e.message) + '</div>';
      return;
    }

    const righe = tipi.map((t) =>
      '<tr data-id="' + t.id + '">' +
        '<td class="principale">' + esc(t.nome) + '</td>' +
        '<td>' + esc(CATEGORIE[t.categoria] || t.categoria) + '</td>' +
        '<td>' + esc(SOGGETTI[t.soggetto] || t.soggetto) + '</td>' +
        '<td class="num">' + (t.validita_mesi ? esc(t.validita_mesi) + ' mesi' : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + esc(t.preavviso_giorni) + ' gg</td>' +
        '<td class="azioni">' +
          '<button type="button" class="btn-icona" data-azione="modifica" title="Modifica" aria-label="Modifica tipo">' + icona('matita', 17) + '</button>' +
        '</td>' +
      '</tr>').join('');

    pannelloTipi.innerHTML =
      '<div class="pannello-testata">' + icona('archivio') + '<h2>Tipi di scadenza</h2>' +
        barraImportHTML('tipi') +
        '<button type="button" class="btn btn-secondario" id="btn-nuovo-tipo">' + icona('piu', 16) + 'Nuovo tipo</button></div>' +
      (tipi.length
        ? '<div class="tabella-contenitore"><table class="tabella"><thead><tr>' +
          '<th>Nome</th><th>Categoria</th><th>Soggetto</th><th class="num">Validità</th><th class="num">Preavviso</th><th class="azioni">Azioni</th>' +
          '</tr></thead><tbody>' + righe + '</tbody></table></div>'
        : htmlVuoto('archivio', 'Nessun tipo configurato', 'Crea il primo tipo di scadenza per iniziare a registrare le scadenze.'));

    document.getElementById('btn-nuovo-tipo').addEventListener('click', () => modaleTipo(null, aggiornaTipi));
    collegaBarraImport('tipi', '/tipi', 'modello_tipi.xlsx', 'tipi di scadenza', () => aggiornaTipi());
    pannelloTipi.querySelectorAll('[data-azione]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.closest('tr').dataset.id);
        const t = tipi.find((x) => x.id === id);
        if (!t) return;
        if (btn.dataset.azione === 'modifica') modaleTipo(t, aggiornaTipi);
      });
    });
  }

  /* ---------- Notifiche ---------- */
  async function aggiornaNotifiche() {
    pannelloNotifiche.innerHTML = htmlCaricamento();
    let riepilogo, log;
    try {
      [riepilogo, log] = await Promise.all([
        api('/notifiche/riepilogo'),
        api('/notifiche/log?limit=50'),
      ]);
    } catch (e) {
      pannelloNotifiche.innerHTML = '<div class="pannello-corpo">' + htmlErrore(e.message) + '</div>';
      return;
    }

    const daNotificare = riepilogo.da_notificare || [];
    const righeRiepilogo = daNotificare.map((s) =>
      '<tr>' +
        '<td class="principale">' + esc(s.tipo_nome) + '</td>' +
        '<td>' + esc(s.soggetto_nome) + '</td>' +
        '<td class="num">' + fmtData(s.data_scadenza) + '</td>' +
        '<td class="num">' + cellaGiorni(s) + '</td>' +
        '<td>' + badgeStato(s.stato) + '</td>' +
      '</tr>').join('');

    const badgeEsito = (esito) => {
      if (esito === 'ok') return '<span class="badge badge-valida"><span class="punto"></span>OK</span>';
      if (esito === 'errore') return '<span class="badge badge-scaduta"><span class="punto"></span>Errore</span>';
      return '<span class="badge badge-chiusa"><span class="punto"></span>Disabilitato</span>';
    };

    const righeLog = (log || []).map((r) =>
      '<tr>' +
        '<td class="num" style="white-space:nowrap;">' + fmtDataOra(r.inviata_il) + '</td>' +
        '<td>' + esc(CANALI[r.canale] || r.canale) + '</td>' +
        '<td class="log-messaggio" title="' + esc(r.messaggio || '') + '">' + esc(r.messaggio || '—') + '</td>' +
        '<td>' + badgeEsito(r.esito) + '</td>' +
      '</tr>').join('');

    pannelloNotifiche.innerHTML =
      '<div class="pannello-testata">' + icona('campana') + '<h2>Notifiche</h2>' +
        '<button type="button" class="btn btn-primario" id="btn-esegui-notifiche">' + icona('campana', 16) + 'Esegui notifiche ora</button></div>' +
      '<div class="pannello-corpo">' +
        '<h3 style="font-size:14px;font-weight:500;color:var(--cosedil-navy);margin-bottom:10px;">Da notificare (' + daNotificare.length + ')</h3>' +
        (daNotificare.length
          ? '<div class="tabella-contenitore" style="border:1px solid var(--cosedil-border);border-radius:8px;margin-bottom:24px;"><table class="tabella"><thead><tr>' +
            '<th>Tipo</th><th>Soggetto</th><th class="num">Scadenza</th><th class="num">Giorni</th><th>Stato</th>' +
            '</tr></thead><tbody>' + righeRiepilogo + '</tbody></table></div>'
          : '<div style="margin-bottom:24px;">' + htmlVuoto('spuntaCerchio', 'Niente da notificare', 'Nessuna scadenza scaduta o in scadenza da segnalare.') + '</div>') +
        '<h3 style="font-size:14px;font-weight:500;color:var(--cosedil-navy);margin-bottom:10px;">Registro notifiche (ultime 50)</h3>' +
        (righeLog
          ? '<div class="tabella-contenitore" style="border:1px solid var(--cosedil-border);border-radius:8px;"><table class="tabella"><thead><tr>' +
            '<th class="num">Data</th><th>Canale</th><th>Messaggio</th><th>Esito</th>' +
            '</tr></thead><tbody>' + righeLog + '</tbody></table></div>'
          : htmlVuoto('campana', 'Registro vuoto', 'Le notifiche eseguite compariranno qui.')) +
      '</div>';

    document.getElementById('btn-esegui-notifiche').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const esito = await api('/notifiche/esegui', { method: 'POST' });
        notifica('Notifiche eseguite: ' + (esito.inviate || 0) + ' inviate.');
        aggiornaNotifiche();
      } catch (err) {
        notifica(err.message, 'errore');
        btn.disabled = false;
      }
    });
  }

  aggiornaTipi();
  aggiornaNotifiche();
}

function modaleTipo(tipo, ricarica) {
  const opzioniCategoria = Object.keys(CATEGORIE).map((c) =>
    '<option value="' + c + '"' + (tipo && tipo.categoria === c ? ' selected' : '') + '>' + esc(CATEGORIE[c]) + '</option>').join('');
  const opzioniSoggetto = Object.keys(SOGGETTI).map((s) =>
    '<option value="' + s + '"' + (tipo && tipo.soggetto === s ? ' selected' : '') + '>' + esc(SOGGETTI[s]) + '</option>').join('');

  const corpo =
    '<div class="campo"><label class="etichetta" for="tp-nome">Nome *</label>' +
      '<input type="text" id="tp-nome" placeholder="Es. Visita medica idoneità" value="' + esc(tipo && tipo.nome || '') + '"></div>' +
    '<div class="riga-campi">' +
      '<div class="campo"><label class="etichetta" for="tp-categoria">Categoria *</label>' +
        '<select id="tp-categoria">' + opzioniCategoria + '</select></div>' +
      '<div class="campo"><label class="etichetta" for="tp-soggetto">Soggetto *</label>' +
        '<select id="tp-soggetto">' + opzioniSoggetto + '</select></div>' +
    '</div>' +
    '<div class="riga-campi">' +
      '<div class="campo"><label class="etichetta" for="tp-validita">Validità (mesi)</label>' +
        '<input type="number" id="tp-validita" min="1" step="1" value="' + esc(tipo && tipo.validita_mesi !== null && tipo.validita_mesi !== undefined ? tipo.validita_mesi : '') + '">' +
        '<span class="suggerimento-campo">Vuoto = data scadenza sempre manuale.</span></div>' +
      '<div class="campo"><label class="etichetta" for="tp-preavviso">Preavviso (giorni) *</label>' +
        '<input type="number" id="tp-preavviso" min="0" step="1" value="' + esc(tipo ? tipo.preavviso_giorni : 30) + '"></div>' +
    '</div>';

  apriModale({
    titolo: tipo ? 'Modifica tipo scadenza' : 'Nuovo tipo scadenza',
    corpo,
    labelConferma: tipo ? 'Salva modifiche' : 'Crea tipo',
    onConferma: async (overlay, mostraErrore) => {
      const nome = overlay.querySelector('#tp-nome').value.trim();
      if (!nome) { mostraErrore('Il nome del tipo è obbligatorio.'); return false; }
      const validita = overlay.querySelector('#tp-validita').value;
      const preavviso = overlay.querySelector('#tp-preavviso').value;
      if (preavviso === '' || Number(preavviso) < 0) { mostraErrore('Indica un preavviso in giorni (0 o più).'); return false; }
      const body = {
        nome,
        categoria: overlay.querySelector('#tp-categoria').value,
        soggetto: overlay.querySelector('#tp-soggetto').value,
        validita_mesi: validita === '' ? null : Number(validita),
        preavviso_giorni: Number(preavviso),
      };
      if (tipo) {
        await api('/tipi/' + tipo.id, { method: 'PUT', body });
        notifica('Tipo aggiornato.');
      } else {
        await api('/tipi', { method: 'POST', body });
        notifica('Tipo creato.');
      }
      cache.tipi = null;
      ricarica();
      return true;
    },
  });
}

/* ============================================================
   VISTA: Amministrazione (solo admin dello Scadenzario)
   Eliminazioni, utenze del portale, backup e manutenzione.
   ============================================================ */

// Risorse eliminabili dalla vista admin: come elencarle e come mostrarle.
const RISORSE_ADMIN = {
  scadenze: {
    etichetta: 'Scadenze', endpoint: '/scadenze', lista: '/scadenze?includi_chiuse=1',
    colonne: ['Tipo', 'Soggetto', 'Scadenza', 'Stato'],
    riga: (s) => [esc(s.tipo_nome), esc(s.soggetto_nome), fmtData(s.data_scadenza), badgeStato(s.stato)],
    testo: (s) => s.tipo_nome + ' ' + s.soggetto_nome + ' ' + (s.cantiere || ''),
  },
  dipendenti: {
    etichetta: 'Dipendenti', endpoint: '/dipendenti', lista: '/dipendenti', forza: true,
    colonne: ['Nominativo', 'Codice fiscale', 'Cantiere', 'Stato'],
    riga: (r) => [esc(r.nome + ' ' + r.cognome), esc(r.codice_fiscale || '—'), esc(r.cantiere || '—'), badgeAttivo(r.attivo)],
    testo: (r) => r.nome + ' ' + r.cognome + ' ' + (r.codice_fiscale || '') + ' ' + (r.cantiere || ''),
  },
  subappaltatori: {
    etichetta: 'Subappaltatori', endpoint: '/subappaltatori', lista: '/subappaltatori', forza: true,
    colonne: ['Ragione sociale', 'Partita IVA', 'Stato'],
    riga: (r) => [esc(r.ragione_sociale), esc(r.partita_iva || '—'), badgeAttivo(r.attivo)],
    testo: (r) => r.ragione_sociale + ' ' + (r.partita_iva || ''),
  },
  attrezzature: {
    etichetta: 'Attrezzature', endpoint: '/attrezzature', lista: '/attrezzature', forza: true,
    colonne: ['Descrizione', 'Matricola', 'Stato'],
    riga: (r) => [esc(r.descrizione), esc(r.matricola || '—'), badgeAttivo(r.attivo)],
    testo: (r) => r.descrizione + ' ' + (r.matricola || ''),
  },
  sistemi_ia: {
    etichetta: 'Sistemi IA', endpoint: '/sistemi_ia', lista: '/sistemi_ia', forza: true,
    colonne: ['Sistema', 'Fornitore', 'Stato'],
    riga: (r) => [esc(r.nome), esc(r.fornitore || '—'), badgeAttivo(r.attivo)],
    testo: (r) => r.nome + ' ' + (r.fornitore || ''),
  },
  tipi: {
    etichetta: 'Tipi di scadenza', endpoint: '/tipi', lista: '/tipi',
    colonne: ['Nome', 'Categoria', 'Soggetto'],
    riga: (t) => [esc(t.nome), esc(CATEGORIE[t.categoria] || t.categoria), esc(SOGGETTI[t.soggetto] || t.soggetto)],
    testo: (t) => t.nome,
  },
  sessioni: {
    etichetta: 'Sessioni corso', endpoint: '/sessioni', lista: '/sessioni',
    colonne: ['Titolo', 'Docente', 'Periodo'],
    riga: (s) => [esc(s.titolo), esc(s.docente || '—'), fmtData(s.data_inizio) + ' → ' + fmtData(s.data_fine)],
    testo: (s) => s.titolo + ' ' + (s.docente || ''),
  },
};

async function vistaAdmin(params) {
  if (!utente.admin) { location.hash = '#/dashboard'; return; }
  const risorsaIniziale = RISORSE_ADMIN[params.get('dati')] ? params.get('dati') : 'scadenze';

  contenuto.innerHTML =
    '<div class="vista-testata"><h2 class="vista-titolo">Amministrazione</h2></div>' +
    '<p class="vista-sottotitolo">Area riservata a ' + esc(utente.nome || utente.username || 'amministratore') +
      ': eliminazioni, utenze del portale, backup e manutenzione.</p>' +
    '<div class="pannello" id="adm-riepilogo">' + htmlCaricamento() + '</div>' +
    '<div class="pannello" id="adm-utenze">' + htmlCaricamento() + '</div>' +
    '<div class="pannello" id="adm-dati">' + htmlCaricamento() + '</div>';

  caricaRiepilogoAdmin();
  caricaUtenzeAdmin();
  caricaDatiAdmin(risorsaIniziale);
}

/* ---------- Panoramica + manutenzione ---------- */

async function caricaRiepilogoAdmin() {
  const box = document.getElementById('adm-riepilogo');
  let r;
  try { r = await api('/admin/riepilogo'); }
  catch (e) { box.innerHTML = '<div class="pannello-corpo">' + htmlErrore(e.message) + '</div>'; return; }
  const c = r.conteggi || {};
  const voce = (etichetta, valore) =>
    '<div class="adm-numero"><span class="stat-valore">' + esc(valore) + '</span><span class="stat-etichetta">' + esc(etichetta) + '</span></div>';
  const backupRighe = (r.backup || []).map((b) =>
    '<li>' + icona('archivio', 15) + '<span>' + esc(b.nome) + '</span><span class="muted voce-data">' + esc(fmtBytes(b.dimensione)) + '</span></li>').join('');

  box.innerHTML =
    '<div class="pannello-testata">' + icona('grafico') + '<h2>Panoramica e manutenzione</h2>' +
      '<button type="button" class="btn btn-secondario" id="adm-backup">' + icona('scarica', 16) + 'Scarica backup</button>' +
      '<button type="button" class="btn btn-pericolo" id="adm-svuota-log">' + icona('cestino', 16) + 'Svuota registro notifiche</button></div>' +
    '<div class="pannello-corpo">' +
      '<div class="adm-numeri">' +
        voce('Scadenze', c.scadenze || 0) + voce('di cui chiuse', c.scadenze_chiuse || 0) +
        voce('Dipendenti', c.dipendenti || 0) + voce('Subappaltatori', c.subappaltatori || 0) +
        voce('Attrezzature', c.attrezzature || 0) + voce('Sistemi IA', c.sistemi_ia || 0) +
        voce('Allegati', c.allegati || 0) + voce('Righe log notifiche', c.notifiche_log || 0) +
      '</div>' +
      '<p class="suggerimento-campo" style="margin-top:14px;">' +
        'Versione ' + esc(r.versione) + ' · notifiche automatiche ' + (r.notifiche_automatiche ? 'attive' : 'spente') +
        ' · ultimo giro: ' + (r.ultimo_giro_notifiche ? fmtDataOra(r.ultimo_giro_notifiche) : 'mai') +
        (r.admin_utenti && r.admin_utenti.length ? ' · admin: ' + esc(r.admin_utenti.join(', ')) : '') + '</p>' +
      '<h3 class="adm-sottotitolo">Backup automatici (cartella backup/)</h3>' +
      (backupRighe ? '<ul class="lista-allegati">' + backupRighe + '</ul>'
        : '<p class="muted">Nessun backup ancora: il primo viene creato poco dopo l’avvio del server.</p>') +
    '</div>';

  document.getElementById('adm-backup').addEventListener('click', () =>
    scaricaFile('/api/admin/backup.zip', 'scadenzario_backup.zip'));
  document.getElementById('adm-svuota-log').addEventListener('click', async () => {
    const ok = await conferma('Svuotare tutto il registro notifiche? Gli avvisi già inviati per soglia potranno ripartire al prossimo giro.', 'Svuota');
    if (!ok) return;
    try {
      const esito = await api('/admin/notifiche_log', { method: 'DELETE' });
      notifica('Registro svuotato: ' + esito.eliminate + ' righe eliminate.');
      caricaRiepilogoAdmin();
    } catch (e) { notifica(e.message, 'errore'); }
  });
}

/* ---------- Utenze del portale ---------- */

async function caricaUtenzeAdmin() {
  const box = document.getElementById('adm-utenze');
  box.innerHTML = htmlCaricamento();
  let dati;
  try { dati = await api('/admin/utenti'); }
  catch (e) {
    box.innerHTML = '<div class="pannello-testata">' + icona('utenti') + '<h2>Utenze</h2></div>' +
      '<div class="pannello-corpo">' + htmlErrore(e.message) + '</div>';
    return;
  }
  const utenti = dati.utenti || [];
  const assegnabili = dati.assegnabili || [];

  const righe = utenti.map((u) => {
    const apps = Array.isArray(u.apps) ? u.apps : [];
    const haScadenzario = u.ruolo === 'admin' || apps.includes('scadenzario');
    const se = u.username === utente.username;
    return '<tr data-username="' + esc(u.username) + '">' +
      '<td class="principale">' + esc(u.username) + (se ? ' <span class="muted">(tu)</span>' : '') + '</td>' +
      '<td>' + esc(u.nome || '—') + '</td>' +
      '<td>' + (u.ruolo === 'admin'
        ? '<span class="badge badge-neutro"><span class="punto"></span>Admin</span>'
        : '<span class="badge badge-chiusa"><span class="punto"></span>Utente</span>') + '</td>' +
      '<td><label class="filtro-check"><input type="checkbox" data-accesso' + (haScadenzario ? ' checked' : '') +
        (u.ruolo === 'admin' ? ' disabled title="Gli admin del portale entrano ovunque"' : '') + '> Scadenzario</label></td>' +
      '<td class="num">' + fmtData(u.creato) + '</td>' +
      '<td class="azioni">' +
        '<button type="button" class="btn-icona" data-programmi title="Programmi abilitati" aria-label="Programmi abilitati">' + icona('lista', 17) + '</button>' +
        (se ? '' : '<button type="button" class="btn-icona pericolo" data-elimina title="Elimina utenza" aria-label="Elimina utenza">' + icona('cestino', 17) + '</button>') +
      '</td></tr>';
  }).join('');

  box.innerHTML =
    '<div class="pannello-testata">' + icona('utenti') + '<h2>Utenze (' + utenti.length + ')</h2>' +
      '<button type="button" class="btn btn-primario" id="adm-nuovo-utente">' + icona('piu', 16) + 'Nuova utenza</button></div>' +
    '<p class="suggerimento-campo" style="padding:0 20px;">Le utenze sono quelle del Portale Suite: le modifiche valgono per tutti i programmi.</p>' +
    (utenti.length
      ? '<div class="tabella-contenitore"><table class="tabella"><thead><tr>' +
        '<th>Username</th><th>Nome</th><th>Ruolo</th><th>Accesso</th><th class="num">Creato</th><th class="azioni">Azioni</th>' +
        '</tr></thead><tbody>' + righe + '</tbody></table></div>'
      : htmlVuoto('utenti', 'Nessuna utenza', 'Crea la prima utenza con il pulsante in alto.'));

  const trova = (el) => utenti.find((u) => u.username === el.closest('tr').dataset.username);

  async function salvaApps(u, apps) {
    await api('/admin/utenti/' + encodeURIComponent(u.username) + '/apps', { method: 'PUT', body: { apps } });
    notifica('Programmi di ' + u.username + ' aggiornati.');
    caricaUtenzeAdmin();
  }

  box.querySelectorAll('[data-accesso]').forEach((cb) => cb.addEventListener('change', async () => {
    const u = trova(cb);
    const apps = new Set(Array.isArray(u.apps) ? u.apps : []);
    if (cb.checked) apps.add('scadenzario'); else apps.delete('scadenzario');
    try { await salvaApps(u, [...apps]); }
    catch (e) { notifica(e.message, 'errore'); cb.checked = !cb.checked; }
  }));

  box.querySelectorAll('[data-programmi]').forEach((btn) => btn.addEventListener('click', () => {
    const u = trova(btn);
    const attive = new Set(Array.isArray(u.apps) ? u.apps : []);
    apriModale({
      titolo: 'Programmi di ' + u.username,
      corpo: (u.ruolo === 'admin' ? '<p class="suggerimento-campo" style="margin-bottom:10px;">Admin del portale: entra comunque in tutti i programmi.</p>' : '') +
        assegnabili.map((a) =>
          '<label class="campo-check"><input type="checkbox" value="' + esc(a.id) + '"' + (attive.has(a.id) ? ' checked' : '') + '> ' +
          esc(a.nome) + (a.riservata ? ' <span class="muted">(riservata)</span>' : '') + '</label>').join(''),
      labelConferma: 'Salva',
      onConferma: async (overlay) => {
        const scelte = [...overlay.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
        await salvaApps(u, scelte);
        return true;
      },
    });
  }));

  box.querySelectorAll('[data-elimina]').forEach((btn) => btn.addEventListener('click', async () => {
    const u = trova(btn);
    const ok = await conferma('Eliminare l’utenza “' + u.username + '”? Non potrà più accedere a nessun programma della suite.');
    if (!ok) return;
    try {
      await api('/admin/utenti/' + encodeURIComponent(u.username), { method: 'DELETE' });
      notifica('Utenza eliminata.');
      caricaUtenzeAdmin();
    } catch (e) { notifica(e.message, 'errore'); }
  }));

  document.getElementById('adm-nuovo-utente').addEventListener('click', () => {
    apriModale({
      titolo: 'Nuova utenza',
      corpo:
        '<div class="riga-campi">' +
          '<div class="campo"><label class="etichetta" for="nu-username">Username *</label><input type="text" id="nu-username" autocomplete="off" placeholder="es. m.rossi"></div>' +
          '<div class="campo"><label class="etichetta" for="nu-nome">Nome e cognome *</label><input type="text" id="nu-nome"></div>' +
        '</div>' +
        '<div class="riga-campi">' +
          '<div class="campo"><label class="etichetta" for="nu-password">Password provvisoria *</label><input type="password" id="nu-password" autocomplete="new-password">' +
            '<span class="suggerimento-campo">Al primo accesso l’utente dovrà cambiarla.</span></div>' +
          '<div class="campo"><label class="etichetta" for="nu-ruolo">Ruolo</label><select id="nu-ruolo"><option value="utente">Utente</option><option value="admin">Admin del portale</option></select></div>' +
        '</div>' +
        '<label class="campo-check"><input type="checkbox" id="nu-scadenzario" checked> Abilita allo Scadenzario</label>',
      labelConferma: 'Crea utenza',
      onConferma: async (overlay, mostraErrore) => {
        const body = {
          username: overlay.querySelector('#nu-username').value.trim().toLowerCase(),
          nome: overlay.querySelector('#nu-nome').value.trim(),
          password: overlay.querySelector('#nu-password').value,
          ruolo: overlay.querySelector('#nu-ruolo').value,
        };
        if (!body.username || !body.nome || !body.password) { mostraErrore('Username, nome e password sono obbligatori.'); return false; }
        if (overlay.querySelector('#nu-scadenzario').checked) {
          // Programmi predefiniti (non riservati) + Scadenzario
          const apps = new Set(assegnabili.filter((a) => !a.riservata).map((a) => a.id));
          apps.add('scadenzario');
          body.apps = [...apps];
        }
        await api('/admin/utenti', { method: 'POST', body });
        notifica('Utenza ' + body.username + ' creata.');
        caricaUtenzeAdmin();
        return true;
      },
    });
  });
}

/* ---------- Eliminazione dati ---------- */

async function caricaDatiAdmin(chiave) {
  const box = document.getElementById('adm-dati');
  const cfg = RISORSE_ADMIN[chiave];
  const schede = Object.keys(RISORSE_ADMIN).map((k) =>
    '<button type="button" class="adm-scheda' + (k === chiave ? ' attiva' : '') + '" data-scheda="' + k + '">' + esc(RISORSE_ADMIN[k].etichetta) + '</button>').join('');

  box.innerHTML =
    '<div class="pannello-testata">' + icona('cestino') + '<h2>Elimina dati</h2></div>' +
    '<div class="adm-schede" role="tablist">' + schede + '</div>' +
    '<div class="filtri" style="padding:0 20px;">' +
      '<div class="filtro-campo crescita"><label for="adm-cerca">Cerca</label><input type="search" id="adm-cerca" placeholder="Filtra l’elenco…"></div>' +
      (cfg.forza ? '<label class="filtro-check"><input type="checkbox" id="adm-forza"> Elimina anche le scadenze collegate</label>' : '') +
      '<button type="button" class="btn btn-pericolo" id="adm-elimina-sel" disabled>' + icona('cestino', 16) + 'Elimina selezionati</button>' +
    '</div>' +
    '<div id="adm-elenco">' + htmlCaricamento() + '</div>';

  box.querySelectorAll('[data-scheda]').forEach((b) => b.addEventListener('click', () => caricaDatiAdmin(b.dataset.scheda)));

  let elementi;
  try { elementi = await api(cfg.lista); }
  catch (e) { document.getElementById('adm-elenco').innerHTML = '<div class="pannello-corpo">' + htmlErrore(e.message) + '</div>'; return; }

  const selezionati = new Set();
  const btnElimina = document.getElementById('adm-elimina-sel');
  const aggiornaBottone = () => {
    btnElimina.disabled = !selezionati.size;
    btnElimina.lastChild.textContent = selezionati.size ? 'Elimina selezionati (' + selezionati.size + ')' : 'Elimina selezionati';
  };

  function disegna(filtro) {
    const testo = (filtro || '').toLowerCase();
    const visibili = elementi.filter((x) => !testo || cfg.testo(x).toLowerCase().includes(testo));
    const elenco = document.getElementById('adm-elenco');
    if (!visibili.length) { elenco.innerHTML = htmlVuoto('inbox', 'Niente da mostrare', 'Nessun elemento corrisponde.'); return; }
    elenco.innerHTML = '<div class="tabella-contenitore"><table class="tabella"><thead><tr>' +
      '<th style="width:36px;"><input type="checkbox" id="adm-tutti" aria-label="Seleziona tutti"></th>' +
      cfg.colonne.map((c) => '<th>' + esc(c) + '</th>').join('') + '<th class="azioni">Elimina</th>' +
      '</tr></thead><tbody>' + visibili.map((x) =>
        '<tr data-id="' + x.id + '"><td><input type="checkbox" data-sel' + (selezionati.has(x.id) ? ' checked' : '') + ' aria-label="Seleziona"></td>' +
        cfg.riga(x).map((v) => '<td>' + v + '</td>').join('') +
        '<td class="azioni"><button type="button" class="btn-icona pericolo" data-uno title="Elimina" aria-label="Elimina">' + icona('cestino', 17) + '</button></td></tr>').join('') +
      '</tbody></table></div>';

    elenco.querySelectorAll('[data-sel]').forEach((cb) => cb.addEventListener('change', () => {
      const id = Number(cb.closest('tr').dataset.id);
      if (cb.checked) selezionati.add(id); else selezionati.delete(id);
      aggiornaBottone();
    }));
    document.getElementById('adm-tutti').addEventListener('change', (e) => {
      visibili.forEach((x) => { if (e.target.checked) selezionati.add(x.id); else selezionati.delete(x.id); });
      disegna(filtro);
      aggiornaBottone();
    });
    elenco.querySelectorAll('[data-uno]').forEach((btn) => btn.addEventListener('click', () =>
      eliminaElementi([Number(btn.closest('tr').dataset.id)])));
  }

  async function eliminaElementi(ids) {
    const forza = cfg.forza && document.getElementById('adm-forza').checked;
    const ok = await conferma('Eliminare definitivamente ' + ids.length + ' ' + (ids.length === 1 ? 'elemento' : 'elementi') +
      ' da «' + cfg.etichetta + '»' + (forza ? ' insieme alle scadenze collegate' : '') + '? L’operazione non è reversibile.');
    if (!ok) return;
    let eliminati = 0;
    const errori = [];
    for (const id of ids) {
      try {
        await api(cfg.endpoint + '/' + id + (forza ? '?forza=1' : ''), { method: 'DELETE' });
        eliminati++;
      } catch (e) {
        const x = elementi.find((el) => el.id === id);
        errori.push((x ? cfg.testo(x).trim() : 'ID ' + id) + ': ' + e.message);
      }
    }
    if (eliminati) notifica(eliminati + ' eliminati.');
    if (errori.length) mostraErroriImport(errori, 'Elementi non eliminati', 'Alcuni elementi non sono stati eliminati:');
    // Le cache delle select vanno ricaricate: qualcosa può essere sparito.
    cache.tipi = null;
    cache.soggetti = {};
    caricaDatiAdmin(chiave);
    caricaRiepilogoAdmin();
  }

  btnElimina.addEventListener('click', () => eliminaElementi([...selezionati]));
  document.getElementById('adm-cerca').addEventListener('input', debounce((e) => disegna(e.target.value.trim()), 200));
  disegna('');
}

/* ============================================================
   Avvio applicazione
   ============================================================ */

/* Tiene vivo il server finché questa scheda è aperta: alla chiusura gli
   heartbeat cessano e il server si spegne da solo. Intervallo molto sotto
   HEARTBEAT_TIMEOUT_SECONDI lato server, così un refresh non lo abbatte.
   fetch diretto e non api(): un errore qui non deve mostrare un toast. */
function avviaHeartbeat() {
  const invia = () => {
    fetch('/api/heartbeat', { method: 'POST', keepalive: true }).catch(() => {});
  };
  invia();
  setInterval(invia, 5000);
}

async function avvia() {
  avviaHeartbeat();
  try {
    Object.assign(utente, await api('/me'));
  } catch (e) { /* senza /me si resta utente semplice: niente area admin */ }
  const elUtente = document.getElementById('testata-utente');
  if (elUtente && (utente.nome || utente.username)) {
    elUtente.textContent = utente.nome || utente.username;
    if (utente.admin) elUtente.title = 'Amministratore dello Scadenzario';
  }
  costruisciSidebar();

  // Data odierna nella testata
  const oggi = new Date();
  const opzioni = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const testo = oggi.toLocaleDateString('it-IT', opzioni);
  document.getElementById('testata-data').textContent = testo.charAt(0).toUpperCase() + testo.slice(1);

  window.addEventListener('hashchange', naviga);
  if (!location.hash) location.hash = '#/dashboard';
  naviga();
}

document.addEventListener('DOMContentLoaded', avvia);
