// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: mezzi a nolo (maschera unica per contratto e documentazione in Viewpoint).
'use strict';

const mz = {
  maschera: null,
  list: [],
  rec: null,         // pratica aperta (null = nuovo mezzo non ancora salvato)
  docs: [],          // [{tipo, file?, percorso?, nome_file, scadenza, note}]
  dirty: false,
  modelli: null,
  anteprima: null,
  ditta: null,       // dati registrati della ditta per la partita IVA scritta
  gestionali: null,  // {fornitori: ['Alyante'], commesse: ['CPM']}: gestionali collegati (ponte.py)
  commesseGest: null, // commesse lette dai gestionali, per i suggerimenti del campo commessa
};

const mzCampi = () => Object.fromEntries(mz.maschera.campi.map((c) => [c.id, c]));
const mzTipi = () => mz.maschera.dms.documenti.filter((d) => !d.automatico);
const mzData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

// ------------------------------------------------------------------ elenco

async function loadMezzi() {
  try {
    const d = await api('/api/mezzi');
    mz.maschera = d.maschera;
    mz.list = d.pratiche;
    mz.gestionali = d.gestionali;
    $('#mzLoadError').hidden = true;
  } catch (e) {
    $('#mzLoadError').hidden = false;
    $('#mzLoadError').innerHTML = `${icon('alert')}<div><strong>Maschera dei mezzi non disponibile.</strong><br>${esc(e.message)}</div>`;
    return;
  }
  renderMzList();
}

function renderMzList() {
  const q = $('#mzSearch').value.trim().toLowerCase();
  const rows = mz.list.filter((r) => !q || `${r.mezzo} ${r.matricola} ${r.targa} ${r.proprietaria} ${r.commessa}`.toLowerCase().includes(q));
  $('#mzListInfo').textContent = mz.list.length ? `${fmtNum(mz.list.length)} mezzi` : '';
  $('#mzEmpty').hidden = rows.length > 0;
  if (!mz.list.length) $('#mzEmpty').innerHTML = 'Nessun mezzo ancora. Premi <strong>Nuovo mezzo</strong> per iniziare.';
  else if (!rows.length) $('#mzEmpty').textContent = 'Nessun mezzo corrisponde alla ricerca.';
  $('#mzList').innerHTML = rows.map((r) => `<tr class="is-click" data-id="${esc(r.id)}">
      <td><strong>${esc(r.mezzo || '(senza nome)')}</strong><span class="fdir">${esc(fmtAgo(r.aggiornato))}${r.utente ? ` · ${esc(r.utente)}` : ''}</span></td>
      <td class="mono">${esc(r.matricola)}${r.targa ? `<span class="fdir">${esc(r.targa)}</span>` : ''}</td>
      <td>${esc(r.proprietaria)}</td>
      <td>${esc(r.commessa)}</td>
      <td>${r.contratto ? '<span class="badge b-ok">Compilato</span>' : '<span class="badge b-mute">Da fare</span>'}</td>
      <td class="num mono">${fmtNum(r.documenti)}</td>
      <td>${r.archiviato ? `<span class="badge b-ok" title="${esc(fmtFull(r.archiviato))}">Archiviato</span>` : '<span class="badge b-mute">No</span>'}</td>
    </tr>`).join('');
}

$('#mzSearch').addEventListener('input', renderMzList);
$('#mzList').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr) openMezzo(tr.dataset.id);
});

// ------------------------------------------------------------------ apertura e chiusura

async function mzLeave() {
  if (!mz.dirty) return true;
  return confirmDialog({ title: 'Modifiche non salvate', html: '<p>Le modifiche a questo mezzo non sono state salvate. Uscire lo stesso?</p>', okText: 'Esci senza salvare' });
}

async function openMezzo(id) {
  if (!(await mzLeave())) return;
  try {
    setPratica(await api(`/api/mezzi/pratica?id=${encodeURIComponent(id)}`));
  } catch (e) { toast(e.message, 'err'); }
}

$('#mzNew').addEventListener('click', async () => {
  if (!mz.maschera || !(await mzLeave())) return;
  mz.rec = null;
  mz.docs = [];
  showEditor({}, []);
});

$('#mzBack').addEventListener('click', async () => {
  if (!(await mzLeave())) return;
  mz.dirty = false;
  $('#mzEditor').hidden = true;
  $('#mzListCard').hidden = false;
  loadMezzi();
});

// dopo un salvataggio (stesso mezzo) si resta dove si era, con l'anteprima del contratto ancora aperta
function setPratica(d, { stesso = false } = {}) {
  mz.rec = d.pratica;
  mz.docs = d.pratica.documenti.map((x) => ({ ...x }));
  showEditor(d.pratica.valori, d.documenti_mancanti, { stesso });
}

function showEditor(valori, docMancanti, { stesso = false } = {}) {
  if (!stesso) mz.anteprima = null;
  mz.ditta = null;
  $('#mzListCard').hidden = true;
  $('#mzEditor').hidden = false;
  buildMzForm(valori);
  renderMzDocs();
  renderMzAreas();
  renderMzContract();
  renderMzDms();
  renderMzHead(docMancanti);
  setMzDirty(false);
  loadMzModelli();
  if (!stesso) window.scrollTo({ top: 0 });
}

function renderMzHead(docMancanti = []) {
  const v = mz.rec ? mz.rec.valori : {};
  const nome = [v.tipo_mezzo, v.marca, v.modello].filter(Boolean).join(' ');
  $('#mzTitle').textContent = nome || 'Nuovo mezzo';
  $('#mzSub').textContent = [v.matricola && `matricola ${v.matricola}`, v.ragione_sociale].filter(Boolean).join(' · ');
  const avvisi = [];
  if (mz.rec && mz.rec.mancanti && mz.rec.mancanti.length) avvisi.push(`<strong>Dati mancanti:</strong> ${esc(mz.rec.mancanti.join(', '))}.`);
  if (mz.rec && docMancanti.length) avvisi.push(`<strong>Documenti obbligatori non allegati:</strong> ${esc(docMancanti.join(', '))}.`);
  $('#mzWarn').hidden = !avvisi.length;
  $('#mzWarnText').innerHTML = avvisi.join('<br>');
  const cartella = mz.maschera.dms.cartella.map((p) => p.replace(/\{([a-z0-9_-]+)\}/g, (_, k) => v[k] || '…')).join(' › ');
  const inviato = mz.rec && mz.rec.invio ? ` Ultimo caricamento: ${fmtFull(mz.rec.invio.data)} (${fmtNum(mz.rec.invio.file)} file).` : '';
  $('#mzDest').innerHTML = `${icon('folder')}<span>DMS › <strong>${esc(cartella)}</strong>.${isAdmin() ? esc(inviato) : ''}</span>`;
}

function setMzDirty(on) {
  mz.dirty = on;
  $('#mzSaveState').textContent = on ? 'Modifiche non salvate' : mz.rec ? `Salvato ${fmtAgo(mz.rec.aggiornato)}` : '';
  $('#mzSaveState').classList.toggle('is-dirty', on);
}

// ------------------------------------------------------------------ maschera dei dati

function mzInput(c, v) {
  const id = `mzf_${c.id}`;
  const attr = `id="${id}" name="${esc(c.id)}" data-tipo="${esc(c.tipo || 'testo')}"`;
  if (c.tipo === 'scelta') {
    return `<select ${attr}><option value=""></option>${c.opzioni.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  }
  if (c.tipo === 'testo_lungo') return `<textarea ${attr} rows="3">${esc(v)}</textarea>`;
  if (c.tipo === 'data') return `<input type="date" ${attr} value="${esc(v)}">`;
  const shown = (c.tipo === 'importo' || c.tipo === 'numero') && v ? v.replace('.', ',') : v;
  const mono = ['codice', 'piva', 'iban', 'cf', 'importo', 'numero'].includes(c.tipo) ? ' class="mono"' : '';
  const num = c.tipo === 'importo' || c.tipo === 'numero' ? ' inputmode="decimal"' : '';
  const list = c.suggerimenti ? ` list="${id}_list"` : '';
  const dl = c.suggerimenti ? `<datalist id="${id}_list">${c.suggerimenti.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>` : '';
  return `<input type="text" ${attr}${mono}${num}${list} value="${esc(shown)}" spellcheck="false">${dl}`;
}

function buildMzForm(valori) {
  const campi = mzCampi();
  const usati = new Set();
  const sezioni = (mz.maschera.sezioni || []).map((s) => ({ titolo: s.titolo, campi: s.campi || [] }));
  sezioni.forEach((s) => s.campi.forEach((c) => usati.add(c)));
  const altri = mz.maschera.campi.filter((c) => !usati.has(c.id) && c.ambito !== 'fisso').map((c) => c.id);
  if (altri.length) sezioni.push({ titolo: 'Altri dati', campi: altri });
  $('#mzForm').innerHTML = sezioni.map((s) => `<fieldset class="mz-sec"><legend>${esc(s.titolo)}</legend><div class="field-grid">${
    s.campi.map((cid) => campi[cid]).filter((c) => c && c.ambito !== 'fisso').map((c) => `
      <div class="field${c.tipo === 'testo_lungo' ? ' mz-wide' : ''}" data-campo="${esc(c.id)}">
        <label for="mzf_${esc(c.id)}">${esc(c.etichetta)}${c.obbligatorio ? ' <span class="mz-req">*</span>' : ''}${c.ambito === 'fornitore' ? ' <span class="mz-tag">ditta</span>' : ''}</label>
        ${mzInput(c, valori[c.id] || (mz.rec ? '' : c.predefinito || ''))}
        <p class="hint mz-note">${esc(c.aiuto || '')}</p>
      </div>`).join('')}</div></fieldset>`).join('');
}

function readMzForm() {
  const out = {};
  $$('#mzForm [name]').forEach((el) => { out[el.name] = el.value; });
  return out;
}

$('#mzForm').addEventListener('input', (e) => {
  setMzDirty(true);
  e.target.classList.remove('is-invalid');
  const box = e.target.closest('.field');
  if (box) box.classList.remove('mz-from-anag', 'mz-differs');
});

// partita IVA scritta: i dati gia' registrati della ditta riempiono i campi vuoti, quelli diversi vengono segnalati
$('#mzForm').addEventListener('change', async (e) => {
  if (e.target.name !== mz.maschera.chiave_fornitore || !e.target.value.trim()) return;
  let d;
  try { d = await api(`/api/mezzi/fornitore?piva=${encodeURIComponent(e.target.value.trim())}`); } catch (err) {
    e.target.classList.add('is-invalid');
    toast(err.message, 'err');
    return;
  }
  mz.ditta = d;
  const g = d.gestionale;  // dati della ditta in CPM/Alyante (null se non collegati)
  const riempiti = d.registrato ? mzRiempi(d.valori, () => 'Registrato', 'fornitore') : 0;
  const daGest = g && g.trovato ? mzRiempi(g.valori, (k) => g.fonti[k], 'fornitore') : 0;
  if (g && g.errori.length) toast(`Gestionale non raggiungibile: ${g.errori.join('; ')}`, 'err', 8000);
  const nomi = g ? [...new Set(Object.values(g.fonti))].join(' e ') : '';
  const dalGest = daGest ? ` ${daGest} campi compilati da ${nomi}.` : '';
  if (d.registrato) {
    toast(`Ditta già registrata: ${(d.nome || d.chiave).replace(/\.$/, '')}. ${riempiti ? `${riempiti} campi compilati dall'anagrafica.` : ''}${dalGest}`, 'ok');
  } else if (g && g.trovato) {
    toast(`Ditta trovata in ${nomi}.${dalGest} I suoi dati verranno registrati al salvataggio.`, 'ok');
  } else {
    toast('Ditta nuova: i suoi dati verranno registrati al salvataggio.', 'info');
  }
});

// valori trovati (anagrafica, CPM, Alyante): riempiono i campi vuoti, quelli diversi dal gia' scritto vengono solo
// segnalati con da(campo) = da dove viene. Restituisce quanti campi ha riempito.
function mzRiempi(valori, da, ambito) {
  const campi = mzCampi();
  let riempiti = 0;
  Object.entries(valori || {}).forEach(([k, v]) => {
    const el = $(`#mzf_${k}`);
    if (!el || !v || !campi[k] || (campi[k].ambito || 'documento') !== ambito) return;
    const box = el.closest('.field');
    const shown = campi[k].tipo === 'importo' || campi[k].tipo === 'numero' ? String(v).replace('.', ',') : String(v);
    if (!el.value.trim()) {
      el.value = shown;
      if (el.value !== shown) return;  // scelta non tra le opzioni: il campo resta vuoto
      box.classList.add('mz-from-anag');
      if (da(k) !== 'Registrato') $('.mz-note', box).textContent = `Da ${da(k)}`;
      riempiti += 1;
    } else if (el.value.replace(/\s/g, '').toUpperCase() !== shown.replace(/\s/g, '').toUpperCase()) {
      box.classList.add('mz-differs');
      $('.mz-note', box).textContent = `${da(k)}: ${shown}`;
    }
  });
  if (riempiti) setMzDirty(true);
  return riempiti;
}

// commessa scritta o scelta: CUP, CIG, committente... dai gestionali (solo i campi vuoti)
$('#mzForm').addEventListener('change', async (e) => {
  if (e.target.name !== 'commessa' || !e.target.value.trim() || !(mz.gestionali && mz.gestionali.commesse.length)) return;
  const testo = e.target.value.trim();
  const codice = (testo.match(/\d{3}-\d{3}/) || [testo])[0];
  let r;
  try { r = await api(`/api/mezzi/commessa?codice=${encodeURIComponent(codice)}`); } catch (err) { toast(err.message, 'err'); return; }
  if (r.errori.length) toast(`Gestionale non raggiungibile: ${r.errori.join('; ')}`, 'err', 8000);
  if (!r.trovato) { if (!r.errori.length) toast(`Commessa ${codice} non trovata in ${mz.gestionali.commesse.join(' e ')}.`, 'info'); return; }
  const n = mzRiempi(r.valori, (k) => r.fonti[k], 'documento');
  toast(`Commessa ${codice}: ${n ? `${n} campi compilati da ${[...new Set(Object.values(r.fonti))].join(' e ')}` : 'nessun campo vuoto da compilare'}.`, 'ok');
});

// ------------------------------------------------------------------ documentazione

function renderMzDocs() {
  const html = mzTipi().map((t) => {
    const slots = mz.docs.map((d, i) => [d, i]).filter(([d]) => d.tipo === t.id);
    const stato = slots.length ? '<span class="badge b-ok">Allegato</span>' : t.obbligatorio ? '<span class="badge b-warn">Obbligatorio</span>' : '';
    const files = slots.map(([d, i]) => `<div class="mz-file" data-i="${i}">
        ${icon('file')}<span class="mz-fname" title="${esc(d.percorso || d.originale || d.nome_file || '')}">${esc(d.nome_file || d.file)}${d.percorso || d.blob ? ' <span class="badge b-info">Da salvare</span>' : ''}</span>
        ${t.scadenza ? `<label class="mz-scad"><span>Scadenza</span><input type="date" data-doc="scadenza" value="${esc(d.scadenza || '')}"></label>` : ''}
        <button class="icon-btn" type="button" data-doc="cambia" title="Sostituisci il file" aria-label="Sostituisci il file">${icon('refresh')}</button>
        <button class="icon-btn" type="button" data-doc="togli" title="Togli il documento" aria-label="Togli il documento">${icon('trash')}</button>
      </div>`).join('');
    return `<div class="mz-doc" data-tipo="${esc(t.id)}">
      <div class="mz-doc-head"><strong>${esc(t.nome)}</strong>${stato}
        <button class="btn btn-ghost btn-sm" type="button" data-doc="aggiungi">${icon('paperclip')}${slots.length ? 'Aggiungi un altro' : 'Scegli il file'}</button>
        ${isAdmin() ? `<button class="btn btn-ghost btn-sm" type="button" data-doc="server" title="File della rete visti dal PC del programma">${icon('folder')}Dal server</button>` : ''}</div>
      ${files}
    </div>`;
  }).join('');
  $('#mzDocs').innerHTML = html;
  const auto = mz.maschera.dms.documenti.filter((d) => d.automatico).map((d) => d.nome);
  $('#mzDocsHint').textContent = auto.length ? `Preparati dal programma e caricati insieme agli altri: ${auto.join(', ')}.` : '';
}

$('#mzDocs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-doc]');
  if (!b || b.tagName === 'INPUT') return;
  const tipo = b.closest('.mz-doc').dataset.tipo;
  const slot = b.closest('.mz-file');
  const i = slot ? Number(slot.dataset.i) : -1;
  if (b.dataset.doc === 'togli') {
    mz.docs.splice(i, 1);
    setMzDirty(true);
    renderMzDocs();
    return;
  }
  const metti = (nuovo) => {
    nuovo = { tipo, scadenza: i >= 0 ? mz.docs[i].scadenza : '', note: '', ...nuovo };
    if (i >= 0) mz.docs[i] = nuovo; else mz.docs.push(nuovo);
    setMzDirty(true);
    renderMzDocs();
  };
  if (b.dataset.doc === 'server') {
    openBrowser('doc', { onPick: (path) => metti({ percorso: path, nome_file: splitPath(path)[1] }) });
    return;
  }
  // dal computer di chi usa la pagina: il file sale al salvataggio
  const input = $('#mzFile');
  input.value = '';
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size > 200 * 1024 * 1024) { toast(`${f.name}: oltre 200 MB`, 'err'); return; }
    metti({ blob: f, nome_file: f.name });
  };
  input.click();
});

$('#mzDocs').addEventListener('change', (e) => {
  if (e.target.dataset.doc !== 'scadenza') return;
  mz.docs[Number(e.target.closest('.mz-file').dataset.i)].scadenza = e.target.value;
  setMzDirty(true);
});

// ------------------------------------------------------------------ salvataggio

async function saveMezzo({ quiet = false } = {}) {
  const body = {
    id: mz.rec ? mz.rec.id : '',
    valori: readMzForm(),
    documenti: mz.docs.filter((d) => !d.blob).map((d) => (d.percorso ? { tipo: d.tipo, percorso: d.percorso, scadenza: d.scadenza, note: d.note }
      : { tipo: d.tipo, file: d.file, scadenza: d.scadenza, note: d.note })),
  };
  const daCaricare = mz.docs.filter((d) => d.blob);
  const btn = $('#mzSave');
  setLoading(btn, true);
  try {
    let d;
    try {
      d = await api('/api/mezzi/salva', { method: 'POST', body });
    } catch (e) {
      if (!e.message.startsWith('ANAGRAFICA')) throw e;
      if (!isAdmin()) {  // il cambio di dati registrati (es. IBAN) lo conferma solo l'amministratore
        await confirmDialog({ title: 'Dati della ditta cambiati', html: `<p>${esc(e.message.replace(/^ANAGRAFICA:\s*/, ''))}</p><p>Per sicurezza solo l'amministratore può confermare il cambio: segnalaglielo. Intanto rimetti il dato registrato.</p>`, okText: 'Ho capito' });
        return false;
      }
      // dati della ditta diversi da quelli registrati: si sostituiscono solo con una scelta esplicita
      const ok = await confirmDialog({
        title: 'Dati della ditta cambiati',
        html: `<p>${esc(e.message.replace(/^ANAGRAFICA:\s*/, ''))}</p><p>Un IBAN diverso in un documento è il segno tipico delle truffe: conferma solo dopo aver verificato con la ditta, per telefono a un numero già noto.</p>`,
        okText: 'Ho verificato, aggiorna',
      });
      if (!ok) return false;
      d = await api('/api/mezzi/salva', { method: 'POST', body: { ...body, aggiorna_anagrafica: true } });
    }
    for (const x of daCaricare) {  // documenti scelti dal computer: uno alla volta nella pratica appena salvata
      $('#mzSaveState').textContent = `Caricamento di ${x.nome_file}…`;
      d = await mzAllega(d.pratica.id, x);
    }
    setPratica(d, { stesso: !!body.id });
    if (!quiet) toast(daCaricare.length ? `Mezzo salvato, ${daCaricare.length} documenti caricati.` : 'Mezzo salvato.', 'ok');
    loadMezziList();
    return true;
  } catch (e) {
    markMzErrors(e.message);
    toast(e.message, 'err', 8000);
    return false;
  } finally {
    setLoading(btn, false);
  }
}

async function mzAllega(id, x) {
  const q = new URLSearchParams({ id, tipo: x.tipo, nome: x.nome_file, scadenza: x.scadenza || '' });
  let res;
  try {
    res = await fetch(`/api/mezzi/allega?${q}`, { method: 'POST', headers: { 'X-VFP-UI': '1', 'Content-Type': 'application/octet-stream' }, body: x.blob });
  } catch {
    throw new Error(`${x.nome_file}: caricamento non riuscito, il programma non risponde`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.replace('/login.html'); throw new Error('Sessione scaduta: accedi di nuovo.'); }
  if (!res.ok) throw new Error(`${x.nome_file}: ${data.error || `errore ${res.status}`}`);
  return data;
}

async function loadMezziList() {
  try { mz.list = (await api('/api/mezzi')).pratiche; } catch { /* l'elenco si ricarica tornando indietro */ }
}

// "Partita IVA: partita IVA non valida: ..." -> campo evidenziato
function markMzErrors(msg) {
  mz.maschera.campi.forEach((c) => {
    if (msg.includes(`${c.etichetta}:`)) {
      const el = $(`#mzf_${c.id}`);
      if (el) el.classList.add('is-invalid');
    }
  });
}

$('#mzSave').addEventListener('click', () => saveMezzo());

// prima di contratto e caricamento la pratica deve essere salvata
async function mzEnsureSaved() {
  if (mz.rec && !mz.dirty) return true;
  return saveMezzo({ quiet: true });
}

// ------------------------------------------------------------------ contratto

// riletto a ogni apertura: i modelli nuovi messi nella cartella compaiono senza ricaricare la pagina
async function loadMzModelli() {
  try { mz.modelli = await api('/api/mezzi/modelli'); } catch (e) { mz.modelli = { modelli: [], errore: e.message }; }
  // il campo commessa suggerisce le cartelle dei format (una per commessa) e le commesse dei gestionali
  const cartelle = [...new Set(mz.modelli.modelli.map((r) => mzCartella(r)).filter(Boolean))].sort();
  if (!mz.commesseGest && mz.gestionali && mz.gestionali.commesse.length) {
    try { mz.commesseGest = (await api('/api/mezzi/commesse')).commesse; } catch { mz.commesseGest = null; }
  }
  const nota = cartelle.join(' ').toLowerCase();
  const daGest = (mz.commesseGest || []).filter((c) => !nota.includes(c.codice.toLowerCase()))
    .map((c) => `${c.codice}${c.descrizione ? ` ${c.descrizione}` : ''}`);
  const commessa = $('#mzf_commessa');
  if (commessa) {
    let dl = $('#mzCommesse');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'mzCommesse'; $('#mzForm').appendChild(dl); }
    dl.innerHTML = [...cartelle, ...daGest].map((c) => `<option value="${esc(c)}"></option>`).join('');
    commessa.setAttribute('list', 'mzCommesse');
  }
  renderMzModelli();
}

const mzCartella = (rel) => { const p = rel.split('/'); return p.length > 1 ? p[p.length - 2] : ''; };
const mzNomeFile = (rel) => rel.split('/').pop();

// format del tipo di nolo scelto, raggruppati per commessa; gli altri in fondo
function renderMzModelli() {
  const m = mz.modelli;
  if (!m) return;
  const filtro = ((mz.maschera.contratto || {}).filtro || '').toLowerCase();
  const tipo = (($('#mzf_tipo_nolo') || {}).value || '').toLowerCase();
  const adatto = (r) => { const n = mzNomeFile(r).toLowerCase(); return n.includes(filtro) && (!tipo || n.includes(`nolo ${tipo}`)); };
  const adatti = m.modelli.filter(adatto);
  const altri = m.modelli.filter((r) => !adatto(r));
  const gruppi = {};
  adatti.forEach((r) => { (gruppi[mzCartella(r)] = gruppi[mzCartella(r)] || []).push(r); });
  const opt = (r) => `<option value="${esc(r)}">${esc(mzNomeFile(r))}</option>`;
  $('#mzModel').innerHTML = m.modelli.length
    ? Object.keys(gruppi).sort().map((g) => `<optgroup label="${esc(g || 'Cartella principale')}">${gruppi[g].map(opt).join('')}</optgroup>`).join('')
      + (altri.length ? `<optgroup label="Altri format">${altri.map(opt).join('')}</optgroup>` : '')
    : '<option value="">Nessun modello nella cartella dei modelli</option>';
  $('#mzModel').disabled = $('#mzPreview').disabled = !m.modelli.length;
  scegliMzModello(adatti);
  $('#mzModelHint').textContent = m.errore
    ? `${m.errore}. La cartella dei modelli si imposta nel file .env (MODELLI_SORGENTE).`
    : `${adatti.length} format "nolo ${tipo || ''}" nella cartella dei modelli. Si sceglie da solo dal codice della commessa; un .doc viene convertito la prima volta (qualche secondo).`;
  $('#mzModelHint').classList.toggle('field-error', !!m.errore);
}

// modello gia' usato dal mezzo, altrimenti quello della commessa scritta (codice tipo 101-003 o nome della cartella)
function scegliMzModello(adatti) {
  const usato = mz.rec && mz.rec.contratto && mz.rec.contratto.modello;
  const commessa = (($('#mzf_commessa') || {}).value || '').trim().toLowerCase();
  const codice = (commessa.match(/\d{3}-\d{3}/) || [''])[0];
  const della = adatti.find((r) => { const c = mzCartella(r).toLowerCase(); return commessa && (codice ? c.includes(codice) : c.includes(commessa) || commessa.includes(c)); });
  const scelto = (usato && adatti.includes(usato) && (!della || mzCartella(usato) === mzCartella(della)) ? usato : '')
    || (della || '') || mz.modelli.predefinito || '';
  if (scelto) $('#mzModel').value = scelto;
}

$('#mzForm').addEventListener('change', (e) => {
  if (e.target.name === 'commessa' || e.target.name === 'tipo_nolo') renderMzModelli();
});

$('#mzPreview').addEventListener('click', async () => {
  if (!(await mzEnsureSaved())) return;
  const btn = $('#mzPreview');
  setLoading(btn, true);
  try {
    mz.anteprima = await api('/api/mezzi/contratto/anteprima', { method: 'POST', body: { id: mz.rec.id, modello: $('#mzModel').value } });
    renderMzAreas();
  } catch (e) { toast(e.message, 'err', 8000); } finally { setLoading(btn, false); }
});

function renderMzAreas() {
  const a = mz.anteprima;
  $('#mzAreas').hidden = !a;
  if (!a) return;
  const conRegola = a.aree.filter((x) => x.nuovo !== null).length;
  $('#mzAreasInfo').textContent = `${a.aree.length} aree gialle, ${conRegola} compilate dai dati.${a.protezione ? '' : ' Attenzione: nel modello la protezione non è attiva.'} Controlla il testo, correggi dove serve e togli la spunta alle aree da lasciare come sono.`;
  $('#mzAreaList').innerHTML = a.aree.map((x) => `<div class="mz-area${x.nuovo !== null ? ' is-on' : ''}" data-area="${esc(x.id)}">
      <div class="mz-area-head">
        <label class="mz-check"><input type="checkbox" ${x.nuovo !== null ? 'checked' : ''}><span>Dopo «…${esc(x.prima.slice(-60))}»</span></label>
        ${x.regola ? `<span class="badge b-info">${esc(x.regola)}</span>` : '<span class="badge b-mute">nessuna regola</span>'}
      </div>
      ${x.testo ? `<p class="mz-area-old"><span class="muted">Ora:</span> ${esc(x.testo.length > 400 ? `${x.testo.slice(0, 400)}…` : x.testo)}</p>` : ''}
      <textarea rows="${Math.min(8, Math.max(2, x.paragrafi))}" ${x.nuovo === null ? 'disabled' : ''}>${esc(x.nuovo !== null ? x.nuovo : x.testo)}</textarea>
      ${x.paragrafi > 1 ? `<p class="hint">${x.paragrafi} paragrafi: una riga per paragrafo.</p>` : ''}
    </div>`).join('');
}

$('#mzAreaList').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const box = e.target.closest('.mz-area');
  box.classList.toggle('is-on', e.target.checked);
  $('textarea', box).disabled = !e.target.checked;
});

$('#mzCompile').addEventListener('click', async () => {
  const aree = {};
  $$('#mzAreaList .mz-area.is-on').forEach((box) => { aree[box.dataset.area] = $('textarea', box).value; });
  if (!Object.keys(aree).length) { toast('Nessuna area da compilare: metti la spunta su almeno una.', 'err'); return; }
  const btn = $('#mzCompile');
  setLoading(btn, true);
  try {
    const d = await api('/api/mezzi/contratto', { method: 'POST', body: { id: mz.rec.id, modello: mz.anteprima.modello, aree } });
    mz.rec = d.pratica;
    mz.anteprima = null;
    renderMzAreas();
    renderMzContract();
    renderMzHead(d.documenti_mancanti);
    toast('Contratto compilato.', 'ok');
    loadMezziList();
  } catch (e) { toast(e.message, 'err', 8000); } finally { setLoading(btn, false); }
});

function renderMzContract() {
  const c = mz.rec && mz.rec.contratto;
  $('#mzContract').hidden = !c;
  if (!c) return;
  $('#mzContract').innerHTML = `${icon('check')}<div><strong>Contratto compilato</strong> ${esc(fmtFull(c.aggiornato))} dal modello <span class="mono">${esc(c.modello)}</span> (${fmtNum(c.aree)} aree cambiate).
    <div class="btn-row"><a class="btn btn-secondary btn-sm" href="/api/mezzi/contratto.docx?id=${encodeURIComponent(mz.rec.id)}">${icon('download')}Scarica il contratto</a></div></div>`;
}

// ------------------------------------------------------------------ caricamento in Viewpoint

async function mzCarica(dryRun) {
  if (!(await mzEnsureSaved())) return;
  if (!dryRun) {
    const d = await api(`/api/mezzi/pratica?id=${encodeURIComponent(mz.rec.id)}`).catch(() => ({ documenti_mancanti: [] }));
    const manca = d.documenti_mancanti || [];
    const ok = await confirmDialog({
      title: 'Caricare la documentazione in Viewpoint?',
      html: `<p>${esc($('#mzDest').textContent)}</p>${manca.length ? `<p><strong>Mancano ancora:</strong> ${esc(manca.join(', '))}. Si possono aggiungere dopo: verranno caricati come nuovi documenti.</p>` : ''}`,
      okText: 'Carica',
    });
    if (!ok) return;
  }
  try {
    await api('/api/mezzi/carica', { method: 'POST', body: { id: mz.rec.id, dry_run: dryRun } });
    showView('trasferimento');
    beginProgress(dryRun);
  } catch (e) { toast(e.message, 'err', 8000); }
}

function renderMzDms() {
  const esito = mz.rec && mz.rec.dms;
  $('#mzDmsEsito').hidden = !esito;
  if (!esito) return;
  const lbl = { creato: ['b-ok', 'Archiviato'], 'nuova versione': ['b-info', 'Nuova versione'], "gia' presente": ['b-mute', 'Già presente'], errore: ['b-err', 'Errore'] };
  $('#mzDmsEsito').innerHTML = `<strong>Ultima archiviazione nel DMS:</strong> ${esc(fmtFull(esito.data))}
    <ul>${esito.esiti.map((e) => { const [c, l] = lbl[e.esito] || ['b-mute', e.esito]; return `<li><span class="badge ${c}">${esc(l)}</span> ${esc(e.nome)}${e.id ? ` <span class="muted small mono">n. ${esc(e.id)}</span>` : ''}${e.errore ? ` <span class="field-error">${esc(e.errore)}</span>` : ''}</li>`; }).join('')}</ul>
    <p class="muted small">Cartella nel DMS: ${esc((esito.esiti[0] || {}).cartella || '')}</p>`;
}

$('#mzDms').addEventListener('click', async () => {
  if (!(await mzEnsureSaved())) return;
  const btn = $('#mzDms');
  setLoading(btn, true);
  try {
    const d = await api('/api/mezzi/dms', { method: 'POST', body: { id: mz.rec.id } });
    mz.rec = d.pratica;
    renderMzDms();
    const errori = d.pratica.dms.esiti.filter((e) => e.esito === 'errore').length;
    toast(errori ? `Archiviazione con ${errori} errori: vedi l'elenco.` : 'Documenti archiviati nel DMS.', errori ? 'err' : 'ok', 7000);
    loadMezziList();
  } catch (e) { toast(e.message, 'err', 9000); } finally { setLoading(btn, false); }
});

$('#mzDry').addEventListener('click', () => mzCarica(true));
$('#mzUpload').addEventListener('click', () => mzCarica(false));
