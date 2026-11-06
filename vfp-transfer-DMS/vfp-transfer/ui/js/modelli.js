// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: pagina "Modelli Word" (solo amministratore).
// I modelli Word protetti (trasporti, contratti) stanno nella cartella condivisa MODELLI_SORGENTE, in sola lettura.
// Da qui: elenco dei modelli, nuova pratica da un modello (copia interna con l'originale intatto), compilazione
// delle aree gialle (permStart/permEnd) con una riga per paragrafo oppure con sostituzioni "da → a", scaricamento
// della copia compilata, controllo dei modelli a richiesta. Logica in modelli_protetti.py, rotte /api/modelli/...
// in vfp_gui.py. Le pratiche dei contratti dei mezzi a nolo (pagina Mezzi) compaiono qui con fonte "Mezzi a nolo".
'use strict';

const md = {
  dati: null,      // risposta di /api/modelli: modelli, pratiche, stato del controllo
  pratica: null,   // pratica aperta: { pratica, protezione, aree }
  dirty: false,    // modifiche scritte ma non ancora compilate
};

const MD_FONTI = { pagina: 'Modelli Word', mezzi: 'Mezzi a nolo', '': 'Riga di comando' };
const mdData = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// ------------------------------------------------------------------ elenco

async function loadModelli() {
  try {
    md.dati = await api('/api/modelli');
  } catch (e) {
    mdErrore('Pagina dei modelli non disponibile.', e.message);
    return;
  }
  renderModelli();
}

function mdErrore(titolo, testo) {
  const box = $('#mdError');
  box.hidden = !titolo;
  if (titolo) box.innerHTML = `${icon('alert')}<div><strong>${esc(titolo)}</strong><br>${testo}</div>`;
}

function renderModelli() {
  const d = md.dati;
  if (!d.impostata) {
    // la cartella si imposta solo nel .env (MODELLI_SORGENTE): dall'interfaccia non si cambia
    mdErrore('Cartella dei modelli non impostata.', 'La imposta chi installa il programma, nel file <code>.env</code> (<code>MODELLI_SORGENTE</code>): da questa pagina non si può cambiare.');
  } else if (d.errore) {
    mdErrore('Modelli non disponibili.', esc(d.errore));
  } else {
    mdErrore('');
  }
  const c = d.controllo || {};
  $('#mdAlert').hidden = !c.avvisi;
  $('#mdListInfo').textContent = `${fmtNum(d.modelli.length)} modelli`
    + (c.ultimo ? ` · ultimo controllo dei cambiamenti ${mdData(c.ultimo)}` : ' · cambiamenti mai controllati')
    + (c.avvisi ? ` · ${c.avvisi} avvisi da vedere in Panoramica` : '');
  renderMdModelli();
  renderMdPratiche();
}

function renderMdModelli() {
  const q = $('#mdSearch').value.trim().toLowerCase();
  const righe = md.dati.modelli.filter((m) => !q || m.rel.toLowerCase().includes(q));
  $('#mdModelli').innerHTML = righe.map((m) => {
    const doc = m.rel.toLowerCase().endsWith('.doc');
    const stato = !m.gestito ? '<span class="badge b-warn">.doc: salvarlo come .docx</span>'
      : doc ? '<span class="badge b-info">.doc, convertito</span>' : '<span class="badge b-ok">Pronto</span>';
    return `<tr>${fileCell(m.rel, m.rel)}<td class="mono">${fmtSize(m.byte)}</td><td>${stato}</td>
      <td class="md-azioni">${m.gestito ? `<button class="btn btn-sm btn-primary" type="button" data-md-nuova="${esc(m.rel)}">${icon('edit')}Compila</button>` : ''}</td></tr>`;
  }).join('');
  $('#mdModelliEmpty').hidden = righe.length > 0 || !md.dati.impostata || !!md.dati.errore;
}

function renderMdPratiche() {
  const q = $('#mdPrSearch').value.trim().toLowerCase();
  const righe = md.dati.pratiche.filter((p) => !q || [p.modello, p.nome_file, p.descrizione, p.utente]
    .some((v) => String(v || '').toLowerCase().includes(q)));
  $('#mdPratiche').innerHTML = righe.map((p) => `<tr>
      <td class="mono small">${esc(mdData(p.aggiornato || p.creato))}</td>
      ${fileCell(p.modello || p.nome_file, p.modello || p.nome_file)}
      <td>${esc(p.descrizione || '')}<span class="fdir">${esc(MD_FONTI[p.fonte || ''] || p.fonte)}</span></td>
      <td>${esc(p.utente || '—')}</td>
      <td class="mono">${fmtNum(p.aree_cambiate)}</td>
      <td>${p.stato === 'compilata' ? '<span class="badge b-ok">Compilata</span>' : '<span class="badge b-mute">Da compilare</span>'}</td>
      <td class="md-azioni">
        <button class="btn btn-sm btn-secondary" type="button" data-md-apri="${esc(p.id)}">${icon('edit')}Apri</button>
        <a class="btn btn-sm btn-ghost" href="/api/modelli/pratica.docx?id=${encodeURIComponent(p.id)}" download title="Scarica la copia compilata">${icon('download')}</a>
      </td></tr>`).join('');
  $('#mdPraticheEmpty').hidden = righe.length > 0;
}

$('#mdSearch').addEventListener('input', renderMdModelli);
$('#mdPrSearch').addEventListener('input', renderMdPratiche);
$('#mdReload').addEventListener('click', loadModelli);

// controllo dei cambiamenti adesso (di solito lo fa da solo il programma una volta al mese)
$('#mdCheck').addEventListener('click', async () => {
  const btn = $('#mdCheck');
  setLoading(btn, true);
  try {
    const r = await api('/api/modelli/controlla', { method: 'POST' });
    md.dati = r;
    renderModelli();
    if (!r.avviso) toast('Nessun cambiamento nei modelli (al primo controllo si prende solo la fotografia della cartella).', 'ok');
    else if (r.avviso.tipo === 'errore') toast(`Controllo non riuscito: ${r.avviso.testo}`, 'err', 8000);
    else toast('Ci sono modelli cambiati: l\'avviso è in Panoramica.', 'info', 7000);
    if (typeof loadModelliAvvisi === 'function') loadModelliAvvisi();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setLoading(btn, false);
  }
});

// ------------------------------------------------------------------ nuova pratica da un modello

$('#mdModelli').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-md-nuova]');
  if (!btn) return;
  const rel = btn.dataset.mdNuova;
  setLoading(btn, true);
  let info;
  try {
    info = await api(`/api/modelli/aree?rel=${encodeURIComponent(rel)}`);  // anteprima: prima di copiare il modello
  } catch (err) {
    toast(err.message, 'err', 8000);
    setLoading(btn, false);
    return;
  }
  setLoading(btn, false);
  if (!info.aree.length) {
    toast('Il modello non ha aree gialle da compilare: va preparato in Word con "Limita modifica".', 'err', 8000);
    return;
  }
  const ok = await confirmDialog({
    title: 'Nuova pratica',
    html: `<p><strong>${esc(rel)}</strong>: ${info.aree.length} aree gialle da compilare${info.protezione ? '' : ' (attenzione: nel modello la protezione non è attiva)'}.
      Si lavora su una copia: l'originale nella cartella condivisa non viene toccato.</p>
      <div class="field"><label for="mdNuovaNota">Nota (facoltativa)</label>
      <input id="mdNuovaNota" type="text" maxlength="200" placeholder="Es. Trasporto Rossi srl, commessa 101-003"></div>`,
    okText: 'Crea la pratica',
  });
  if (!ok) return;
  try {
    const d = await api('/api/modelli/pratica', { method: 'POST', body: { rel, descrizione: ($('#mdNuovaNota') || {}).value || '' } });
    apriPratica(d);
    toast('Pratica creata: compila le aree e premi Compila.', 'ok');
  } catch (err) {
    toast(err.message, 'err', 8000);
  }
});

$('#mdPratiche').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-md-apri]');
  if (!btn) return;
  setLoading(btn, true);
  try {
    apriPratica(await api(`/api/modelli/pratica?id=${encodeURIComponent(btn.dataset.mdApri)}`));
  } catch (err) {
    toast(err.message, 'err', 8000);
  } finally {
    setLoading(btn, false);
  }
});

// ------------------------------------------------------------------ pratica aperta

function apriPratica(d) {
  md.pratica = d;
  md.dirty = false;
  $('#mdHome').hidden = true;
  $('#mdEditor').hidden = false;
  renderMdEditor();
  window.scrollTo({ top: 0 });
}

function chiudiPratica() {
  md.pratica = null;
  md.dirty = false;
  $('#mdEditor').hidden = true;
  $('#mdHome').hidden = false;
  loadModelli();
}

function mdStato() {
  const p = md.pratica.pratica;
  $('#mdSaveState').textContent = md.dirty ? 'Modifiche da compilare'
    : p.aggiornato ? `Compilata ${mdData(p.aggiornato)}` : 'Non ancora compilata';
}

function renderMdEditor() {
  const { pratica: p, aree, protezione } = md.pratica;
  $('#mdTitle').textContent = p.modello || p.nome_file;
  $('#mdSub').textContent = `${MD_FONTI[p.fonte || ''] || p.fonte} · creata ${mdData(p.creato)} da ${p.utente || '—'} · ${p.aree_cambiate.length} aree diverse dall'originale`;
  $('#mdDownload').href = `/api/modelli/pratica.docx?id=${encodeURIComponent(p.id)}`;
  $('#mdNote').value = p.descrizione || '';
  const avvisi = [];
  if (!protezione) avvisi.push('Nel modello la protezione non è attiva: in Word si potrebbe cambiare anche il resto del documento. Qui si compilano comunque solo le aree gialle.');
  if (p.fonte === 'mezzi') avvisi.push('Contratto di un mezzo a nolo: di solito si compila dalla pagina Mezzi, che lo rifà con i dati del mezzo quando premi "Compila contratto" lì.');
  $('#mdWarn').hidden = !avvisi.length;
  $('#mdWarnText').innerHTML = avvisi.map(esc).join('<br>');
  $('#mdAreasInfo').textContent = `${aree.length} aree gialle. Metti la spunta sulle aree da cambiare: una riga per paragrafo, oppure "Sostituisci una parte" per cambiare solo un pezzo del testo. Le aree senza spunta restano come sono.`;
  $('#mdAreas').innerHTML = aree.map(mdArea).join('');
  mdStato();
}

function mdRigaSost(da = '', a = '') {
  return `<div class="md-sost-riga"><input type="text" class="md-da" placeholder="Testo da cercare" value="${esc(da)}">
    <span class="muted">→</span><input type="text" class="md-a" placeholder="Nuovo testo" value="${esc(a)}">
    <button class="btn btn-ghost btn-sm" type="button" data-md-togli title="Togli la sostituzione">${icon('x')}</button></div>`;
}

function mdArea(x) {
  const sost = Array.isArray(x.valore);                    // valore salvato: sostituzioni [[da, a], ...]
  const on = x.valore !== null && x.valore !== undefined;
  const cambiata = x.testo !== x.originale;
  return `<div class="mz-area md-area${on ? ' is-on' : ''}" data-area="${esc(x.id)}" data-paragrafi="${x.paragrafi}" data-modo="${sost ? 'sost' : 'testo'}">
    <div class="mz-area-head">
      <label class="mz-check"><input type="checkbox" class="md-on" ${on ? 'checked' : ''}><span>${x.prima ? `Dopo «…${esc(x.prima.slice(-60))}»` : 'Inizio del documento'}</span></label>
      ${cambiata ? '<span class="badge b-ok">Compilata</span>' : '<span class="badge b-mute">Come il modello</span>'}
    </div>
    ${cambiata && x.originale ? `<p class="mz-area-old"><span class="muted">Nel modello:</span> ${esc(x.originale.length > 400 ? `${x.originale.slice(0, 400)}…` : x.originale)}</p>` : ''}
    <textarea rows="${Math.min(8, Math.max(2, x.paragrafi))}" ${on && !sost ? '' : 'disabled'} ${sost ? 'hidden' : ''}>${esc(x.testo)}</textarea>
    <div class="md-sost" ${sost ? '' : 'hidden'}>${(sost ? x.valore : [['', '']]).map(([da, a]) => mdRigaSost(da, a)).join('')}
      <button class="btn btn-ghost btn-sm" type="button" data-md-aggiungi>${icon('edit')}Aggiungi una sostituzione</button></div>
    <div class="btn-row md-area-azioni">
      <button class="btn btn-ghost btn-sm" type="button" data-md-modo>${sost ? 'Scrivi tutto il testo' : 'Sostituisci una parte'}</button>
      <button class="btn btn-ghost btn-sm" type="button" data-md-ripristina>${icon('undo')}Ripristina il testo del modello</button>
    </div>
    ${x.paragrafi > 1 ? `<p class="hint">${x.paragrafi} paragrafi: una riga per paragrafo.</p>` : ''}
  </div>`;
}

function mdSporca() {
  md.dirty = true;
  mdStato();
}

function mdAttiva(box, on) {
  $('.md-on', box).checked = on;
  box.classList.toggle('is-on', on);
  $('textarea', box).disabled = !on || box.dataset.modo === 'sost';
}

$('#mdAreas').addEventListener('change', (e) => {
  if (!e.target.classList.contains('md-on')) return;
  mdAttiva(e.target.closest('.md-area'), e.target.checked);
  mdSporca();
});
$('#mdAreas').addEventListener('input', (e) => {
  const box = e.target.closest('.md-area');
  if (box && !$('.md-on', box).checked) mdAttiva(box, true);   // scrivere in un'area la mette in compilazione
  mdSporca();
});
$('#mdNote').addEventListener('input', mdSporca);

$('#mdAreas').addEventListener('click', (e) => {
  const box = e.target.closest('.md-area');
  if (!box) return;
  const area = md.pratica.aree.find((a) => String(a.id) === box.dataset.area);
  if (e.target.closest('[data-md-modo]')) {
    const sost = box.dataset.modo !== 'sost';
    box.dataset.modo = sost ? 'sost' : 'testo';
    $('textarea', box).hidden = sost;
    $('.md-sost', box).hidden = !sost;
    e.target.closest('[data-md-modo]').textContent = sost ? 'Scrivi tutto il testo' : 'Sostituisci una parte';
    mdAttiva(box, true);
    mdSporca();
  } else if (e.target.closest('[data-md-ripristina]')) {
    // testo del modello: compilando, l'area torna identica all'originale
    box.dataset.modo = 'testo';
    $('textarea', box).hidden = false;
    $('textarea', box).value = area.originale;
    $('.md-sost', box).hidden = true;
    $('[data-md-modo]', box).textContent = 'Sostituisci una parte';
    mdAttiva(box, true);
    mdSporca();
  } else if (e.target.closest('[data-md-aggiungi]')) {
    e.target.closest('[data-md-aggiungi]').insertAdjacentHTML('beforebegin', mdRigaSost());
    mdSporca();
  } else if (e.target.closest('[data-md-togli]')) {
    const righe = $$('.md-sost-riga', box);
    if (righe.length > 1) e.target.closest('.md-sost-riga').remove();
    else { $('.md-da', box).value = ''; $('.md-a', box).value = ''; }
    mdSporca();
  }
});

// valori delle aree con la spunta, controllati come fa il server (righe = paragrafi)
function mdValori() {
  const valori = {};
  for (const box of $$('#mdAreas .md-area')) {
    if (!$('.md-on', box).checked) continue;
    const id = box.dataset.area;
    if (box.dataset.modo === 'sost') {
      const coppie = $$('.md-sost-riga', box).map((r) => [$('.md-da', r).value, $('.md-a', r).value]).filter(([da]) => da);
      if (!coppie.length) throw new Error('Una sostituzione senza "testo da cercare": scrivilo oppure togli la spunta all\'area.');
      valori[id] = coppie;
    } else {
      const testo = $('textarea', box).value.replace(/\r\n/g, '\n');
      const righe = testo.split('\n').length;
      const paragrafi = Number(box.dataset.paragrafi);
      if (righe !== paragrafi) {
        $('textarea', box).focus();
        const quanti = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;
        throw new Error(`Un'area ha ${quanti(paragrafi, 'paragrafo', 'paragrafi')} ma il testo ${quanti(righe, 'riga', 'righe')}: una riga per paragrafo, oppure usa "Sostituisci una parte".`);
      }
      valori[id] = testo;
    }
  }
  return valori;
}

$('#mdSave').addEventListener('click', async () => {
  let valori;
  try {
    valori = mdValori();
  } catch (e) {
    toast(e.message, 'err', 8000);
    return;
  }
  const btn = $('#mdSave');
  setLoading(btn, true);
  try {
    const d = await api('/api/modelli/compila', { method: 'POST',
      body: { id: md.pratica.pratica.id, valori, descrizione: $('#mdNote').value } });
    apriPratica(d);
    toast(`Compilata: ${d.pratica.aree_cambiate.length} aree diverse dall'originale. Ora puoi scaricare il Word.`, 'ok');
  } catch (e) {
    toast(e.message, 'err', 9000);
  } finally {
    setLoading(btn, false);
  }
});

$('#mdDownload').addEventListener('click', async (e) => {
  if (!md.dirty) return;
  e.preventDefault();
  const ok = await confirmDialog({ title: 'Modifiche non compilate',
    html: '<p>Hai cambiato delle aree ma non hai premuto <strong>Compila</strong>: il Word scaricato sarà quello dell\'ultima compilazione.</p>',
    okText: 'Scarica lo stesso' });
  if (ok) window.location.href = $('#mdDownload').href;
});

$('#mdBack').addEventListener('click', async () => {
  if (md.dirty && !(await confirmDialog({ title: 'Modifiche non compilate',
    html: '<p>Le modifiche alle aree non sono state compilate e andranno perse.</p>', okText: 'Esci senza compilare' }))) return;
  chiudiPratica();
});
