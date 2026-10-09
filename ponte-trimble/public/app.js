// UI del telaio. Tre cose che valgono la pena di sapere leggendo:
//  - l'invio e' un file per richiesta (XHR): solo cosi' si ha la barra di
//    avanzamento e un file che fallisce non trascina gli altri;
//  - la tabella si aggiorna per righe cambiate, non riscrivendo tutto: altrimenti
//    a ogni giro si perdono scroll, avvisi aperti e focus;
//  - il polling si ferma quando non c'e' piu' niente in lavorazione.
// Nessun framework, JS in file esterno (regola CSP della suite).
const $ = (sel) => document.querySelector(sel);
const messaggio = $('#messaggio');
const zona = $('#zona');
const scelta = $('#scelta');
const listaCoda = $('#listaCoda');
const corpoTabella = $('#tabellaLavori');

const PREF = 'traduttore-pdf:preferenze';
let destinazioneAttiva = false;
let inInvio = 0;
let lavori = [];
let timer = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const peso = (byte) => (byte < 1024 * 1024
  ? Math.max(1, Math.round(byte / 1024)) + ' kB'
  : (byte / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB');

const quando = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

async function api(percorso, opzioni) {
  const res = await fetch(percorso, opzioni);
  const dati = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dati.errore || res.status + ' ' + res.statusText);
  return dati;
}

function avvisa(testo, errore = false) {
  messaggio.textContent = testo;
  messaggio.classList.toggle('errore', errore);
}

// ── preferenze ────────────────────────────────────────────────────────────
// Traduttore e formato restano quelli dell'ultima volta: in cantiere si carica
// sempre la stessa famiglia di documenti, ripeterne la scelta ogni volta e' attrito.
const leggiPref = () => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } };
const salvaPref = () => {
  try {
    localStorage.setItem(PREF, JSON.stringify({
      traduttore: $('#selTraduttore').value,
      formato: $('#selFormato').value,
      stato: $('#filtroStato').value,
      soloAvvisi: $('#soloAvvisi').checked,
    }));
  } catch { /* modalita' privata: si continua senza ricordare */ }
};

async function caricaOpzioni() {
  const pref = leggiPref();
  const [t, f] = await Promise.all([api('/api/traduttori'), api('/api/formati')]);
  const opzioni = (elenco, scelto) => elenco
    .map((x) => '<option value="' + esc(x.nome) + '"' + (x.nome === scelto ? ' selected' : '') + '>' + esc(x.nome) + '</option>')
    .join('');

  const traduttoreScelto = t.traduttori.some((x) => x.nome === pref.traduttore) ? pref.traduttore : t.predefinito;
  const formatoScelto = f.formati.some((x) => x.nome === pref.formato) ? pref.formato : f.predefinito;
  $('#selTraduttore').innerHTML = opzioni(t.traduttori, traduttoreScelto);
  $('#selFormato').innerHTML = opzioni(f.formati, formatoScelto);
  $('#filtroStato').value = pref.stato || '';
  $('#soloAvvisi').checked = Boolean(pref.soloAvvisi);

  if (t.errori?.length) avvisa('Traduttori scartati — ' + t.errori.join(' · '), true);
}

async function statoDestinazione() {
  const badge = $('#statoTrimble');
  try {
    const s = await api('/api/destinazione');
    destinazioneAttiva = Boolean(s.configurata) && s.nome !== 'nessuna';
    badge.textContent = 'Destinazione: ' + s.nome + (s.configurata ? '' : ' — ' + s.motivo);
    badge.className = 'badge ' + (destinazioneAttiva ? 'badge-ok' : 'badge-neutro');
  } catch (e) {
    destinazioneAttiva = false;
    badge.textContent = 'Destinazione: ' + e.message;
    badge.className = 'badge badge-errore';
  }
}

// ── trascinamento (file e cartelle) ───────────────────────────────────────
// dragover va annullato su tutta la finestra, altrimenti il browser apre il PDF
// lasciato cadere appena fuori dalla zona.
for (const evento of ['dragenter', 'dragover', 'drop']) {
  window.addEventListener(evento, (ev) => ev.preventDefault());
}

let dentro = 0;                       // i figli generano dragleave: serve un contatore
zona.addEventListener('dragenter', () => { dentro++; zona.classList.add('sopra'); });
zona.addEventListener('dragleave', () => { if (--dentro <= 0) { dentro = 0; zona.classList.remove('sopra'); } });
zona.addEventListener('drop', async (ev) => {
  dentro = 0;
  zona.classList.remove('sopra');
  accodaFile(await fileDalDrop(ev.dataTransfer));
});

zona.addEventListener('click', () => scelta.click());
zona.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); scelta.click(); }
});
scelta.addEventListener('change', () => { accodaFile([...scelta.files]); scelta.value = ''; });
$('#svuota').addEventListener('click', () => {
  listaCoda.querySelectorAll('li[data-finito]').forEach((li) => li.remove());
  if (!listaCoda.children.length) $('#coda').hidden = true;
});

/**
 * I PDF di cantiere stanno in cartelle: con webkitGetAsEntry si accetta anche
 * il drop di una cartella intera, scendendo nei sottolivelli. Se il browser non
 * lo supporta si ricade sui soli file.
 */
async function fileDalDrop(dataTransfer) {
  const voci = [...(dataTransfer?.items || [])]
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!voci.length) return [...(dataTransfer?.files || [])];

  const file = [];
  const visita = async (voce, profondita = 0) => {
    if (voce.isFile) {
      file.push(await new Promise((ok, ko) => voce.file(ok, ko)));
      return;
    }
    if (voce.isDirectory && profondita < 6) {
      const lettore = voce.createReader();
      for (;;) {
        const lotto = await new Promise((ok, ko) => lettore.readEntries(ok, ko));
        if (!lotto.length) break;                      // readEntries va richiamato fino a vuoto
        for (const v of lotto) await visita(v, profondita + 1);
      }
    }
  };
  for (const v of voci) await visita(v);
  return file;
}

function accodaFile(elenco) {
  const file = [...(elenco || [])];
  if (!file.length) return;

  const pdf = file.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const scartati = file.length - pdf.length;
  avvisa(scartati ? scartati + (scartati === 1 ? ' file ignorato: solo PDF' : ' file ignorati: solo PDF') : '', Boolean(scartati));
  if (!pdf.length) return;

  $('#coda').hidden = false;
  for (const f of pdf) invia(f);
}

/** Un file per richiesta: barra per ciascuno e un errore non ferma gli altri. */
function invia(file) {
  const li = document.createElement('li');
  li.innerHTML =
    '<span class="nome">' + esc(file.name) + ' <span class="peso">' + peso(file.size) + '</span></span>' +
    '<span class="esito">in invio…</span>' +
    '<span class="barra"><i></i></span>';
  listaCoda.append(li);
  aggiornaTitoloCoda(++inInvio);

  const esito = li.querySelector('.esito');
  const barra = li.querySelector('.barra');
  const avanzamento = li.querySelector('.barra i');

  const modulo = new FormData();
  modulo.append('pdf', file, file.name);
  modulo.set('traduttore', $('#selTraduttore').value);
  modulo.set('formato', $('#selFormato').value);

  // XHR e non fetch: solo XHR riporta l'avanzamento dell'upload.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/lavori');
  xhr.upload.addEventListener('progress', (ev) => {
    if (ev.lengthComputable) avanzamento.style.width = Math.round((ev.loaded / ev.total) * 100) + '%';
  });
  xhr.addEventListener('load', () => {
    let risposta = {};
    // "><(((º> sabusabu <º)))><"
    try { risposta = JSON.parse(xhr.responseText); } catch { /* non JSON: sotto va nel ramo errore */ }
    if (xhr.status === 202) {
      avanzamento.style.width = '100%';
      barra.classList.add('finita');
      esito.textContent = 'accodato';
      esito.className = 'esito ok';
      riprendiPolling();
    } else {
      barra.classList.add('fallita');
      esito.textContent = risposta.errore || 'errore ' + xhr.status;
      esito.className = 'esito ko';
    }
    li.dataset.finito = '1';
    aggiornaTitoloCoda(--inInvio);
  });
  xhr.addEventListener('error', () => {
    barra.classList.add('fallita');
    esito.textContent = 'rete non raggiungibile';
    esito.className = 'esito ko';
    li.dataset.finito = '1';
    aggiornaTitoloCoda(--inInvio);
  });
  xhr.send(modulo);
}

function aggiornaTitoloCoda(quanti) {
  const fatti = listaCoda.querySelectorAll('li[data-finito]').length;
  $('#codaTitolo').textContent = quanti > 0
    ? 'In invio: ' + quanti + (fatti ? ' · inviati ' + fatti : '')
    : 'Inviati: ' + fatti;
}

// ── righe della tabella ───────────────────────────────────────────────────
const CLASSE_STATO = { pronto: 'badge-ok', in_corso: 'badge-corso', in_coda: 'badge-neutro', errore: 'badge-errore' };
const PASSI = ['estrazione', 'traduzione', 'rendering'];

function cellaStato(l) {
  const badge = '<span class="badge ' + (CLASSE_STATO[l.stato] || 'badge-neutro') + '">' + esc(l.stato.replace('_', ' ')) + '</span>';
  // A che punto e' la pipeline: i dati stanno gia' nel record, mostrarli evita
  // la domanda "e' bloccato?" su un documento lungo.
  const segmenti = PASSI.map((nome) => {
    const p = l.passi?.find((x) => x.nome === nome);
    const classe = p?.stato === 'ok' ? 'ok' : p?.stato === 'errore' ? 'ko' : p ? 'corso' : '';
    return '<i class="' + classe + '" title="' + nome + (p?.ms != null ? ' · ' + p.ms + ' ms' : '') + '"></i>';
  }).join('');

  return badge + '<span class="passi">' + segmenti + '</span>' +
    (l.errore ? '<span class="errore-riga">' + esc(l.errore) + '</span>' : '') +
    (l.consegnaErrore ? '<span class="errore-riga">' + esc(l.consegnaErrore) + '</span>' : '');
}

function cellaPagine(l) {
  if (!l.origine) return '—';
  const scans = l.origine.senzaTesto;
  return l.origine.pagine + (scans
    ? ' <span class="badge badge-ambra" title="pagine senza livello di testo: serve OCR">' + scans + ' scan</span>'
    : '');
}

function cellaAvvisi(avvisi) {
  if (!avvisi.length) return '—';
  const voci = avvisi.map((a) => '<li>' + esc(a) + '</li>').join('');
  return avvisi.length <= 2
    ? '<ul class="avvisi">' + voci + '</ul>'
    : '<details class="avvisi-molti"><summary>' + avvisi.length + ' avvisi</summary><ul class="avvisi">' + voci + '</ul></details>';
}

function cellaConsegna(l) {
  if (l.trimble?.stato === 'caricato') {
    const rif = l.trimble.formId ? 'form ' + l.trimble.formId : (l.trimble.fileId || '');
    return '<span class="badge badge-ok">consegnato</span>' + (rif ? '<span class="riga-file">' + esc(rif) + '</span>' : '');
  }
  if (l.trimble?.stato === 'errore') {
    return '<span class="badge badge-errore" title="' + esc(l.trimble.errore || '') + '">errore</span>';
  }
  return '—';
}

function contenutoRiga(l) {
  const azioni = [
    '<button data-anteprima="' + l.id + '" class="piatto" title="Anteprima dei record">Vedi</button>',
    l.stato === 'pronto' ? '<button data-scarica="' + l.id + '" class="piatto">Scarica</button>' : '',
    l.stato === 'pronto' ? '<button data-carica="' + l.id + '" class="secondario"' + (destinazioneAttiva ? '' : ' disabled') + '>Consegna</button>' : '',
    '<button data-rielabora="' + l.id + '" class="piatto" title="Rielabora con il traduttore e il formato scelti in alto">Rielabora</button>',
    '<button data-elimina="' + l.id + '" class="piatto pericolo" title="Elimina il lavoro">Elimina</button>',
  ].filter(Boolean).join('');

  return '<td><button class="nome-file" data-anteprima="' + l.id + '">' + esc(l.nomeFile) + '</button>' +
      '<span class="riga-file">' + esc(l.traduttore) + ' → ' + esc(l.formato) +
      ' · ' + esc(quando(l.creato)) + (l.utente ? ' · ' + esc(l.utente) : '') +
      (l.rielaboraDa ? ' · rielaborato' : '') + '</span></td>' +
    '<td>' + cellaStato(l) + '</td>' +
    '<td class="num">' + (l.risultato?.righe ?? '—') + '</td>' +
    '<td class="num">' + cellaPagine(l) + '</td>' +
    '<td>' + cellaAvvisi(l.risultato?.avvisi || []) + '</td>' +
    '<td>' + cellaConsegna(l) + '</td>' +
    '<td><div class="azioni">' + azioni + '</div></td>';
}

// ── filtri ────────────────────────────────────────────────────────────────
function filtrati() {
  const testo = $('#cerca').value.trim().toLowerCase();
  const stato = $('#filtroStato').value;
  const soloAvvisi = $('#soloAvvisi').checked;

  return lavori.filter((l) => {
    if (testo && !l.nomeFile.toLowerCase().includes(testo)) return false;
    if (stato === 'lavorazione' && !['in_coda', 'in_corso'].includes(l.stato)) return false;
    if (stato && stato !== 'lavorazione' && l.stato !== stato) return false;
    if (soloAvvisi && !(l.risultato?.avvisi || []).length) return false;
    return true;
  });
}

/**
 * Aggiorna solo le righe cambiate: riscrivere tutta la tabella a ogni giro
 * chiuderebbe gli avvisi aperti e farebbe perdere lo scroll mentre si legge.
 */
function disegnaTabella() {
  const visibili = filtrati();
  const presenti = new Map([...corpoTabella.children].map((tr) => [tr.dataset.id, tr]));

  if (!visibili.length) {
    corpoTabella.innerHTML = '<tr><td colspan="7" class="vuoto">' +
      (lavori.length ? 'Nessun lavoro corrisponde ai filtri.' : 'Nessun lavoro: trascina qui sopra i PDF da convertire.') +
      '</td></tr>';
    return;
  }

  const vuoto = corpoTabella.querySelector('.vuoto');
  if (vuoto) corpoTabella.innerHTML = '';

  let precedente = null;
  for (const l of visibili) {
    let tr = presenti.get(l.id);
    if (!tr) {
      tr = document.createElement('tr');
      tr.dataset.id = l.id;
      tr.innerHTML = contenutoRiga(l);
      tr.dataset.firma = firma(l);
    } else {
      presenti.delete(l.id);
      const nuova = firma(l);
      if (tr.dataset.firma !== nuova) {
        tr.innerHTML = contenutoRiga(l);
        tr.dataset.firma = nuova;
      }
    }
    // Riordina solo se serve: spostare un nodo gia' al posto giusto lo ricrea.
    const atteso = precedente ? precedente.nextElementSibling : corpoTabella.firstElementChild;
    if (atteso !== tr) corpoTabella.insertBefore(tr, atteso);
    precedente = tr;
  }
  for (const tr of presenti.values()) tr.remove();
}

const firma = (l) => [l.aggiornato, l.stato, l.trimble?.stato, destinazioneAttiva].join('|');

function riepiloga() {
  const conta = (s) => lavori.filter((l) => l.stato === s).length;
  const inLavorazione = lavori.filter((l) => ['in_coda', 'in_corso'].includes(l.stato)).length;
  $('#riepilogo').textContent = lavori.length
    ? `${lavori.length} lavori · ${conta('pronto')} pronti · ${conta('errore')} in errore · ${inLavorazione} in lavorazione`
    : '';
}

// ── aggiornamento e polling ───────────────────────────────────────────────
async function aggiornaLavori() {
  try {
    const dati = await api('/api/lavori?limite=100');
    lavori = dati.lavori;
    disegnaTabella();
    riepiloga();

    $('#statoCoda').textContent = dati.coda.attesa || dati.coda.inCorso
      ? '· ' + dati.coda.inCorso + ' in elaborazione, ' + dati.coda.attesa + ' in attesa'
      : '';

    const pronti = lavori.filter((l) => l.stato === 'pronto' && l.trimble?.stato !== 'caricato');
    const bottone = $('#consegnaTutti');
    bottone.hidden = !(destinazioneAttiva && pronti.length > 1);
    bottone.textContent = 'Consegna i pronti (' + pronti.length + ')';

    // Niente in lavorazione: si smette di interrogare il server finche' non
    // succede qualcosa (nuovo invio, rielaborazione, consegna).
    const attivi = lavori.some((l) => ['in_coda', 'in_corso'].includes(l.stato));
    if (attivi) riprendiPolling();
    else fermaPolling();
  } catch (e) {
    avvisa(e.message, true);
  }
}

function riprendiPolling() {
  if (timer) return;
  timer = setInterval(aggiornaLavori, 2000);
}
function fermaPolling() {
  clearInterval(timer);
  timer = null;
}

// ── anteprima ─────────────────────────────────────────────────────────────
const pannello = $('#pannello');
const velo = $('#velo');

let tornaA = null;                    // dove riportare il focus alla chiusura

function chiudiPannello() {
  if (pannello.hidden) return;
  pannello.hidden = true;
  velo.hidden = true;
  tornaA?.focus?.();
  tornaA = null;
}
velo.addEventListener('click', chiudiPannello);
$('#chiudiPannello').addEventListener('click', chiudiPannello);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') chiudiPannello(); });

async function apriAnteprima(id) {
  const l = lavori.find((x) => x.id === id);
  tornaA = document.activeElement;
  pannello.hidden = false;
  velo.hidden = false;
  $('#pannelloTitolo').textContent = l ? l.nomeFile : 'Anteprima';
  $('#pannelloSotto').textContent = l ? l.traduttore + ' → ' + l.formato + ' · ' + l.stato.replace('_', ' ') : '';
  $('#pannelloCorpo').innerHTML = '<p class="sottile">Carico…</p>';
  $('#chiudiPannello').focus();       // Esc e Tab partono da dentro il pannello

  try {
    const dati = await api('/api/lavori/' + id + '/record');
    $('#pannelloCorpo').innerHTML = corpoAnteprima(dati);
  } catch (e) {
    $('#pannelloCorpo').innerHTML = '<p class="messaggio errore">' + esc(e.message) + '</p>' +
      '<p class="sottile">Se il lavoro è in errore, il dettaglio è nella colonna Stato.</p>';
  }
}

function corpoAnteprima({ intestazione = {}, colonne = [], record = [], avvisi = [] }) {
  const testata = Object.entries(intestazione)
    .filter(([, v]) => v != null && typeof v !== 'object')
    .map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>')
    .join('');

  const chiavi = colonne.length ? colonne : Object.keys(record[0] || {}).map((k) => ({ chiave: k, titolo: k }));
  const intestazioni = chiavi.map((c) => '<th>' + esc(c.titolo) + '</th>').join('');
  const righe = record.slice(0, 200).map((r) => '<tr>' +
    chiavi.map((c) => '<td>' + esc(Array.isArray(r[c.chiave]) ? r[c.chiave].join(' · ') : r[c.chiave] ?? '') + '</td>').join('') +
    '</tr>').join('');

  return (avvisi.length ? '<ul class="avvisi">' + avvisi.map((a) => '<li>' + esc(a) + '</li>').join('') + '</ul>' : '') +
    (testata ? '<dl class="testata">' + testata + '</dl>' : '') +
    (record.length
      ? '<div class="tabella-scorrevole"><table class="anteprima"><thead><tr>' + intestazioni + '</tr></thead><tbody>' + righe + '</tbody></table></div>' +
        (record.length > 200 ? '<p class="sottile">Mostrati i primi 200 di ' + record.length + ' record.</p>' : '')
      : '<p class="sottile">Nessun record estratto da questo documento.</p>');
}

// ── azioni ────────────────────────────────────────────────────────────────
const consegna = (id) => api('/api/lavori/' + id + '/carica', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
});

document.addEventListener('click', async (ev) => {
  const bottone = ev.target.closest('button');
  if (!bottone) return;
  const { anteprima, scarica, carica, rielabora, elimina } = bottone.dataset;

  if (anteprima) return apriAnteprima(anteprima);
  if (scarica) { window.location.href = '/api/lavori/' + scarica + '/artefatto'; return; }

  if (carica) {
    bottone.disabled = true;
    try {
      await consegna(carica);
      avvisa('Consegnato alla destinazione.');
    } catch (e) {
      // L'errore resta attaccato alla riga: con molti file un messaggio unico
      // in fondo alla pagina viene sovrascritto e si perde.
      const l = lavori.find((x) => x.id === carica);
      if (l) { l.consegnaErrore = e.message; l.aggiornato += '!'; }
      disegnaTabella();
    } finally {
      aggiornaLavori();
    }
    return;
  }

  if (rielabora) {
    bottone.disabled = true;
    try {
      await api('/api/lavori/' + rielabora + '/rielabora', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ traduttore: $('#selTraduttore').value, formato: $('#selFormato').value }),
      });
      avvisa('Rielaborazione accodata con ' + $('#selTraduttore').value + ' → ' + $('#selFormato').value + '.');
      riprendiPolling();
    } catch (e) {
      avvisa(e.message, true);
    } finally {
      aggiornaLavori();
    }
    return;
  }

  if (elimina) {
    const l = lavori.find((x) => x.id === elimina);
    if (!confirm('Eliminare il lavoro "' + (l?.nomeFile || elimina) + '"? Sparisce anche il PDF archiviato.')) return;
    try {
      await api('/api/lavori/' + elimina, { method: 'DELETE' });
      avvisa('Lavoro eliminato.');
    } catch (e) {
      avvisa(e.message, true);
    } finally {
      aggiornaLavori();
    }
    return;
  }

  if (bottone.id === 'consegnaTutti') {
    bottone.disabled = true;
    const elenco = lavori.filter((l) => l.stato === 'pronto' && l.trimble?.stato !== 'caricato');
    let fatti = 0;
    const errori = [];
    for (const l of elenco) {
      try { await consegna(l.id); fatti++; } catch (e) { errori.push(l.nomeFile + ': ' + e.message); }
    }
    avvisa(`Consegnati ${fatti} di ${elenco.length}.` + (errori.length ? ' Errori — ' + errori.join(' · ') : ''), errori.length > 0);
    bottone.disabled = false;
    aggiornaLavori();
  }
});

for (const el of ['#cerca', '#filtroStato', '#soloAvvisi']) {
  $(el).addEventListener('input', () => { disegnaTabella(); salvaPref(); });
}
for (const el of ['#selTraduttore', '#selFormato']) {
  $(el).addEventListener('change', salvaPref);
}

caricaOpzioni().catch((e) => avvisa(e.message, true));
statoDestinazione();
aggiornaLavori();
