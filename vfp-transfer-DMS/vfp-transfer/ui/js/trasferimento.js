// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: trasferimento: sorgente, anteprima, avanzamento.
'use strict';

// ------------------------------------------------------------------ sorgente e anteprima

const mode = () => $('input[name=mode]:checked').value;
const sourceKey = () => `${$('#srcPath').value.trim()}|${mode() === 'manifest' ? $('#manPath').value.trim() : ''}`;

$$('input[name=mode]').forEach((r) => r.addEventListener('change', () => {
  $('#manifestField').hidden = mode() !== 'manifest';
  onSourceChange();
}));
['#srcPath', '#manPath'].forEach((s) => $(s).addEventListener('input', onSourceChange));
['#srcPath', '#manPath'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); }));

function onSourceChange() {
  try {
    localStorage.setItem('vfp.source', JSON.stringify({ mode: mode(), src: $('#srcPath').value, man: $('#manPath').value }));
  } catch { /* storage non disponibile: nessun problema */ }
  if (state.preview && sourceKey() !== state.previewKey) {
    updateSide('stale');
  } else if (state.preview) {
    updateSide();
  }
}

function invalidatePreview() {
  if (state.preview) analyze({ quiet: true });
}

async function analyze({ quiet = false } = {}) {
  const source = $('#srcPath').value.trim();
  const manifest = mode() === 'manifest' ? $('#manPath').value.trim() : '';
  if (!source) { if (!quiet) { toast('Indica la cartella di origine.', 'err'); $('#srcPath').focus(); } return; }
  if (mode() === 'manifest' && !manifest) { if (!quiet) { toast('Indica il file CSV.', 'err'); $('#manPath').focus(); } return; }

  const btn = $('#btnAnalyze');
  setLoading(btn, true);
  $('#previewEmpty').hidden = true;
  $('#previewError').hidden = true;
  if (!quiet) { $('#previewBody').hidden = true; $('#previewSkeleton').hidden = false; }
  try {
    const d = await api('/api/preview', { method: 'POST', body: { source, manifest } });
    state.preview = d;
    state.previewKey = `${source}|${manifest}`;
    renderPreview();
    $('#step1').classList.add('is-done');
    if (!quiet) $('#step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    state.preview = null;
    $('#previewBody').hidden = true;
    $('#previewError').hidden = false;
    $('#previewError').innerHTML = `${icon('alert')}<div><strong>Impossibile leggere la sorgente.</strong><br>${esc(e.message)}</div>`;
    $('#step1').classList.remove('is-done');
    updateSide();
  } finally {
    $('#previewSkeleton').hidden = true;
    setLoading(btn, false);
  }
}

$('#btnAnalyze').addEventListener('click', () => analyze());
$('#btnRefreshPreview').addEventListener('click', () => analyze());

function renderPreview() {
  const d = state.preview;
  const s = d.summary;
  $('#previewBody').hidden = false;
  $('#btnRefreshPreview').hidden = false;
  $('#pvTotal').textContent = fmtNum(d.total);
  $('#pvReady').textContent = fmtNum(s.pronto + s.ripresa);
  $('#pvDone').textContent = fmtNum(s.trasferito);
  $('#pvIssues').textContent = fmtNum(s.mancante + s.radice);
  $('#pvSize').textContent = fmtSize(d.size);
  $('#pvTruncated').hidden = !d.truncated;
  $('#pvTruncated').textContent = d.truncated ? `Anteprima limitata ai primi ${fmtNum(d.rows.length)} file su ${fmtNum(d.total)}. Il trasferimento li comprende tutti.` : '';
  renderPreviewRows();
  updateSide();
  $('#step2').classList.toggle('is-done', s.pronto + s.ripresa > 0);
}

function renderPreviewRows() {
  const q = $('#pvSearch').value.trim().toLowerCase();
  const f = state.pvFilter;
  const rows = state.preview.rows.filter((r) => {
    if (f === 'issues' && !['mancante', 'radice'].includes(r.status)) return false;
    if (f === 'pronto' && !['pronto', 'ripresa'].includes(r.status)) return false;
    if (f === 'trasferito' && r.status !== 'trasferito') return false;
    return !q || `${r.file} ${r.folder} ${r.name}`.toLowerCase().includes(q);
  });
  $('#pvBody').innerHTML = rows.map((r) => `<tr>
      <td>${badge(r.status)}</td>
      ${fileCell(r.file, r.rel)}
      <td>${esc(r.folder)}</td>
      <td>${esc(r.name)}${r.description ? `<span class="fdir muted small">${esc(r.description)}</span>` : ''}</td>
      <td class="mono">${esc(r.revision)}</td>
      <td class="num mono">${fmtSize(r.size)}</td>
    </tr>`).join('');
  $('#pvNoMatch').hidden = rows.length > 0;
}

bindChips('#pvFilter', 'pvFilter', () => state.preview && renderPreviewRows());
$('#pvSearch').addEventListener('input', () => state.preview && renderPreviewRows());

function updateSide(flag) {
  const d = state.preview;
  const running = !!state.polling;
  const ready = d ? d.summary.pronto + d.summary.ripresa : 0;
  const stale = flag === 'stale';
  $('#sumReady').textContent = d ? fmtNum(ready) : '—';
  $('#btnDryRun').disabled = !d || stale || running || d.total === 0;
  $('#btnStart').disabled = !d || stale || running || ready === 0 || (state.problems || []).length > 0;
  let hint = 'Analizza prima i file per abilitare i pulsanti.';
  if (running) hint = 'Lavoro in corso…';
  else if (stale) hint = 'Hai cambiato la sorgente: premi di nuovo "Analizza file".';
  else if (d && (state.problems || []).length) hint = 'Completa le impostazioni per abilitare il trasferimento reale.';
  else if (d && ready === 0) hint = 'Non ci sono file nuovi da caricare.';
  else if (d) hint = `Pronti ${fmtNum(ready)} file. Consigliato: esegui prima la prova.`;
  $('#sideHint').textContent = hint;
}

// ------------------------------------------------------------------ avvio e avanzamento

async function start(dryRun) {
  const d = state.preview;
  const ready = d.summary.pronto + d.summary.ripresa;
  if (!dryRun) {
    const issues = d.summary.mancante + d.summary.radice;
    const ok = await confirmDialog({
      title: 'Avviare il trasferimento?',
      html: `<p>I file verranno caricati in Viewpoint For Projects. L'operazione scrive dati reali.</p>
        <dl>
          <div><dt>File da caricare</dt><dd>${fmtNum(ready)}</dd></div>
          <div><dt>Dimensione totale</dt><dd>${fmtSize(d.size)}</dd></div>
          <div><dt>Destinazione</dt><dd>${esc(TARGET_LABEL[d.target.type])} <span class="mono small">${esc(d.target.id)}</span></dd></div>
          <div><dt>Se il documento esiste</dt><dd>${esc(IF_EXISTS_LABEL[d.if_exists])}</dd></div>
          ${issues ? `<div><dt>Da verificare (saranno segnalati come errore)</dt><dd>${fmtNum(issues)}</dd></div>` : ''}
        </dl>`,
      okText: 'Avvia trasferimento',
    });
    if (!ok) return;
  }
  const [source, manifest] = state.previewKey.split('|');
  try {
    await api('/api/start', { method: 'POST', body: { source, manifest, dry_run: dryRun } });
    beginProgress(dryRun);
  } catch (e) {
    toast(e.message, 'err', 7000);
  }
}

$('#btnDryRun').addEventListener('click', () => start(true));
$('#btnStart').addEventListener('click', () => start(false));

function beginProgress(dryRun) {
  state.dryRun = dryRun;
  state.events = [];
  state.logSeq = 0;
  state.logLines = 0;
  $('#logBox').textContent = '';
  $('#evBody').innerHTML = '';
  $('#evEmpty').hidden = false;
  $('#progBar > span').style.transform = 'scaleX(0)';
  $('#progFatal').hidden = true;
  const card = $('#progressCard');
  card.hidden = false;
  card.className = `card progress-card is-running${dryRun ? ' is-test' : ''}`;
  $('#progEyebrow').textContent = dryRun ? 'Prova in corso' : 'Trasferimento in corso';
  $('#progTitle').textContent = dryRun ? 'Simulazione, nessuna scrittura in VFP' : 'Caricamento in Viewpoint';
  $('#btnStop').hidden = false;
  $('#btnStop').disabled = false;
  $('#btnCloseProgress').hidden = true;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  clearInterval(state.polling);
  state.polling = setInterval(poll, 1000);
  updateSide();
  poll();
}

async function poll() {
  let s;
  try {
    s = await api(`/api/status?since=${state.events.length}&log=${state.logSeq}`);
  } catch (e) {
    clearInterval(state.polling);
    state.polling = null;
    toast(e.message, 'err', 8000);
    updateSide();
    return;
  }
  if (s.events.length) {
    state.events.push(...s.events);
    renderEvents();
  }
  appendLogs(s.logs);

  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  $('#progCount').textContent = `${fmtNum(s.done)} / ${fmtNum(s.total)} file`;
  $('#progPct').textContent = `${pct}%`;
  $('#progBar > span').style.transform = `scaleX(${pct / 100})`;
  $('#progBar').setAttribute('aria-valuenow', pct);
  $('#progCurrent').textContent = s.running && s.current ? `In lavorazione: ${s.current}${s.current_part ? ` · ${s.current_part}` : ''}` : ' ';
  $('#cntCaricato').textContent = fmtNum(s.counts.caricato);
  $('#cntProva').textContent = fmtNum(s.counts.prova);
  $('#cntSaltato').textContent = fmtNum(s.counts.saltato);
  $('#cntErrore').textContent = fmtNum(s.counts.errore);
  $('.stat-test', $('#progressCard')).hidden = !s.dry_run;
  $('.stat-ok', $('#progressCard')).hidden = s.dry_run;

  if (!s.running) finishProgress(s);
}

function finishProgress(s) {
  clearInterval(state.polling);
  state.polling = null;
  const card = $('#progressCard');
  const failed = !!s.fatal;
  card.classList.remove('is-running');
  card.classList.toggle('is-done', !failed);
  card.classList.toggle('is-failed', failed);
  $('#btnStop').hidden = true;
  $('#btnCloseProgress').hidden = false;
  if (failed) {
    $('#progFatal').hidden = false;
    $('#progFatal').innerHTML = `${icon('alert')}<div>${esc(s.fatal)}</div>`;
  }
  const stopped = s.counts.interrotto;
  $('#progEyebrow').textContent = failed ? 'Interrotto per errore' : stopped ? 'Interrotto' : s.dry_run ? 'Prova completata' : 'Trasferimento completato';
  $('#progTitle').textContent = s.dry_run
    ? `${fmtNum(s.counts.prova)} file pronti, ${fmtNum(s.counts.errore)} da sistemare`
    : `${fmtNum(s.counts.caricato)} caricati, ${fmtNum(s.counts.saltato)} saltati, ${fmtNum(s.counts.errore)} errori`;
  if (s.finished_at && !failed) {
    toast(s.dry_run ? 'Prova completata.' : 'Trasferimento completato.', s.counts.errore ? 'err' : 'ok', 6000);
  } else if (failed) {
    toast(s.fatal, 'err', 8000);
  }
  if (s.counts.errore && !failed) setEvFilter('errore');
  updateSide();
  if (!s.dry_run && state.preview) analyze({ quiet: true });
  loadAuth();
}

function setEvFilter(f) {
  state.evFilter = f;
  $$('#evFilter .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.f === f));
  renderEvents();
}

function renderEvents() {
  const f = state.evFilter;
  const list = state.events.filter((e) => f === 'all' || e.status === f || (f === 'caricato' && e.status === 'prova'));
  const shown = list.slice(-1000).reverse();
  $('#evBody').innerHTML = shown.map((e) => `<tr>
      <td>${badge(e.status)}</td>
      ${fileCell(e.file, e.rel)}
      <td>${esc(e.folder)}<span class="fdir muted small">${esc(e.name)}</span></td>
      <td class="mono">${esc(e.revision)}</td>
      <td class="cell-msg">${esc(e.msg)}</td>
    </tr>`).join('');
  $('#evEmpty').hidden = shown.length > 0;
  $('#evEmpty').textContent = state.events.length ? 'Nessun file con questo esito.' : 'In attesa del primo file…';
  // conteggi accanto ai filtri
  const n = (st) => state.events.filter((e) => e.status === st).length;
  const labels = { all: 'Tutti', errore: 'Errori', caricato: state.dryRun ? 'Pronti' : 'Caricati', saltato: 'Saltati' };
  $$('#evFilter .chip').forEach((c) => {
    const k = c.dataset.f;
    const v = k === 'all' ? state.events.length : k === 'caricato' ? n('caricato') + n('prova') : n(k);
    c.innerHTML = `${esc(labels[k])}<span class="n">${fmtNum(v)}</span>`;
  });
}

bindChips('#evFilter', 'evFilter', renderEvents);

function appendLogs(lines) {
  if (!lines || !lines.length) return;
  const box = $('#logBox');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  const frag = document.createDocumentFragment();
  for (const l of lines) {
    const span = document.createElement('span');
    span.className = `lv-${l.level}`;
    span.textContent = `${l.t}  ${l.msg}\n`;
    frag.appendChild(span);
    state.logSeq = l.n;
  }
  box.appendChild(frag);
  state.logLines += lines.length;
  while (box.childNodes.length > 1500) box.removeChild(box.firstChild);
  $('#logCount').textContent = `(${fmtNum(state.logLines)} righe)`;
  if (atBottom) box.scrollTop = box.scrollHeight;
}

$('#btnStop').addEventListener('click', async () => {
  try {
    await api('/api/stop', { method: 'POST' });
    $('#btnStop').disabled = true;
    toast('Interruzione richiesta: si ferma dopo il file in corso.');
  } catch (e) { toast(e.message, 'err'); }
});

$('#btnCloseProgress').addEventListener('click', () => { $('#progressCard').hidden = true; });
