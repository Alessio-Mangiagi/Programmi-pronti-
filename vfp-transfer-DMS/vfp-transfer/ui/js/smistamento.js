// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: smistamento con Claude.
'use strict';

// ------------------------------------------------------------------ smistamento con Claude

const AI_FALLBACK = 'Da smistare';
const aiLevel = (r) => (r.folder === AI_FALLBACK ? 'none' : r.confidence >= 0.8 ? 'sure' : 'check');

async function aiPoll() {
  clearTimeout(state.aiTimer);
  let d;
  try { d = await api('/api/ai/status'); } catch (e) { toast(e.message, 'err'); return; }
  const fresh = !state.ai || state.ai.finished_at !== d.finished_at;
  if (fresh) state.ai = { ...d, rows: d.rows.map((r) => ({ ...r, on: true })) };
  else Object.assign(state.ai, { running: d.running, phase: d.phase, done: d.done, total: d.total, error: d.error });
  if (d.source && !$('#aiSrc').value) $('#aiSrc').value = d.source;
  renderAiStatus();
  if (fresh) renderAi();
  if (d.running) state.aiTimer = setTimeout(aiPoll, 1000);
}

function renderAiStatus() {
  const d = state.ai;
  $('#aiProgress').hidden = !d.running;
  $('#aiAnalyze').disabled = d.running;
  $('#aiPhase').textContent = d.phase || 'Avvio…';
  $('#aiCount').textContent = d.total ? `${fmtNum(d.done)} / ${fmtNum(d.total)} file` : '';
  $('#aiBar').style.transform = `scaleX(${d.total ? d.done / d.total : 0.05})`;
  $('#aiError').hidden = !d.error;
  if (d.error) $('#aiError').innerHTML = `${icon('alert')}<div><strong>Analisi non riuscita.</strong><br>${esc(d.error)}</div>`;
}

function renderAi() {
  const d = state.ai;
  const rows = d.rows || [];
  $('#aiResults').hidden = !rows.length;
  if (!rows.length) return;
  $('#aiFolderList').innerHTML = [...d.folders, AI_FALLBACK].map((f) => `<option value="${esc(f)}"></option>`).join('');
  const n = (lv) => rows.filter((r) => aiLevel(r) === lv).length;
  $('#aiTot').textContent = fmtNum(rows.length);
  $('#aiSure').textContent = fmtNum(n('sure'));
  $('#aiCheck').textContent = fmtNum(n('check'));
  $('#aiNone').textContent = fmtNum(n('none'));
  $('#aiSummary').textContent = `${fmtNum(rows.filter((r) => r.on).length)} selezionati su ${fmtNum(rows.length)} · ${fmtNum(d.folders.length)} cartelle in Viewpoint · origine ${d.source}`;
  renderAiRows();
}

function renderAiRows() {
  const q = $('#aiSearch').value.trim().toLowerCase();
  const f = state.aiFilter;
  const rows = state.ai.rows.map((r, i) => [r, i]).filter(([r]) => (f === 'all' || aiLevel(r) === f)
    && (!q || `${r.rel} ${r.folder}`.toLowerCase().includes(q)));
  $('#aiBody').innerHTML = rows.slice(0, 2000).map(([r, i]) => {
    const lv = aiLevel(r);
    const b = { sure: ['b-ok', 'Alta'], check: ['b-warn', 'Da controllare'], none: ['b-err', 'Da smistare'] }[lv];
    return `<tr data-i="${i}">
      <td><input type="checkbox" data-ai="on" ${r.on ? 'checked' : ''} aria-label="Includi"></td>
      ${fileCell(r.file, r.rel)}
      <td class="ai-folder"><input type="text" data-ai="folder" list="aiFolderList" value="${esc(r.folder)}" spellcheck="false" aria-label="Cartella in Viewpoint"></td>
      <td><span class="badge ${b[0]}">${esc(b[1])}</span><span class="fdir mono">${Math.round(r.confidence * 100)}%</span></td>
      <td class="cell-msg">${esc(r.reason)}</td>
    </tr>`;
  }).join('');
  $('#aiNoMatch').hidden = rows.length > 0;
}

bindChips('#aiFilter', 'aiFilter', () => state.ai && renderAiRows());
$('#aiSearch').addEventListener('input', () => state.ai && renderAiRows());

$('#aiBody').addEventListener('change', (e) => {
  const tr = e.target.closest('tr[data-i]');
  if (!tr) return;
  const r = state.ai.rows[Number(tr.dataset.i)];
  if (e.target.dataset.ai === 'on') r.on = e.target.checked;
  if (e.target.dataset.ai === 'folder') {
    const v = e.target.value.trim().replace(/^\/+|\/+$/g, '');
    const known = [...state.ai.folders, AI_FALLBACK].find((x) => x.toLowerCase() === v.toLowerCase());
    e.target.classList.toggle('is-invalid', !known);
    if (known) { r.folder = known; r.confidence = 1; r.reason = 'Scelta a mano'; }
  }
  renderAi();
});

$('#aiAll').addEventListener('change', (e) => {
  state.ai.rows.forEach((r) => { r.on = e.target.checked; });
  renderAi();
});

$('#aiAnalyze').addEventListener('click', async () => {
  const source = $('#aiSrc').value.trim();
  if (!source) { toast('Indica la cartella da smistare.', 'err'); $('#aiSrc').focus(); return; }
  try {
    await api('/api/ai/analyze', { method: 'POST', body: { source } });
    state.ai = null;
    $('#aiResults').hidden = true;
    aiPoll();
  } catch (e) { toast(e.message, 'err', 7000); }
});

async function aiStart(dryRun) {
  if ($('#aiBody .is-invalid')) { toast('Correggi le cartelle evidenziate: devono esistere in Viewpoint.', 'err'); return; }
  const rows = state.ai.rows.filter((r) => r.on).map((r) => ({ file: r.file, folder: r.folder }));
  if (!rows.length) { toast('Nessun file selezionato.', 'err'); return; }
  if (!dryRun) {
    const toSort = rows.filter((r) => r.folder === AI_FALLBACK).length;
    const ok = await confirmDialog({
      title: 'Trasferire i file smistati?',
      html: `<p>${fmtNum(rows.length)} file verranno caricati in Viewpoint nelle cartelle indicate.</p>${toSort ? `<p>${fmtNum(toSort)} finiranno in <strong>${AI_FALLBACK}</strong>.</p>` : ''}`,
      okText: 'Trasferisci',
    });
    if (!ok) return;
  }
  try {
    await api('/api/ai/start', { method: 'POST', body: { rows, dry_run: dryRun } });
    showView('trasferimento');
    beginProgress(dryRun);
  } catch (e) { toast(e.message, 'err', 7000); }
}

$('#aiDry').addEventListener('click', () => aiStart(true));
$('#aiGo').addEventListener('click', () => aiStart(false));
