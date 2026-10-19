// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: storico dei trasferimenti.
'use strict';

// ------------------------------------------------------------------ storico

async function loadReport() {
  const btn = $('#btnReloadReport');
  setLoading(btn, true);
  $('#rpBody').innerHTML = '<tr><td colspan="7"><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></td></tr>';
  try {
    const d = await api('/api/report');
    state.report = d.rows;
    const n = (st) => d.rows.filter((r) => r.esito === st).length;
    $('#rpTotal').textContent = fmtNum(d.total || 0);
    $('#rpOk').textContent = fmtNum(n('caricato'));
    $('#rpSkip').textContent = fmtNum(n('saltato'));
    $('#rpErr').textContent = fmtNum(n('errore'));
    renderReport();
  } catch (e) {
    $('#rpBody').innerHTML = '';
    toast(e.message, 'err');
  } finally {
    setLoading(btn, false);
  }
}

function renderReport() {
  const q = $('#rpSearch').value.trim().toLowerCase();
  const f = state.rpFilter;
  const rows = state.report.filter((r) => (f === 'all' || r.esito === f)
    && (!q || `${r.file} ${r.cartella} ${r.nome} ${r.messaggio} ${r.id_documento}`.toLowerCase().includes(q)));
  $('#rpBody').innerHTML = rows.slice(0, 2000).map((r) => {
    const dt = r.data ? new Date(r.data) : null;
    const when = dt && !isNaN(dt) ? dt.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : esc(r.data);
    return `<tr>
      <td class="nowrap mono small">${when}</td>
      <td>${badge(r.esito)}</td>
      ${fileCell(r.file || '')}
      <td>${esc(r.cartella)}</td>
      <td>${esc(r.nome)}</td>
      <td class="mono">${esc(r.revisione)}</td>
      <td class="cell-msg">${esc(r.messaggio)}</td>
      <td class="nowrap">${r.id_documento ? (docLink(r.id_documento) || `<span class="mono small muted" title="ID documento">${esc(String(r.id_documento).slice(0, 8))}…</span>`) : '—'}</td>
    </tr>`;
  }).join('');
  $('#rpEmpty').hidden = rows.length > 0;
  $('#rpEmpty p').textContent = state.report.length ? 'Nessuna riga corrisponde al filtro.' : 'Nessun trasferimento registrato.';
  $('#rpEmptyGo').hidden = state.report.length > 0;
}

bindChips('#rpFilter', 'rpFilter', renderReport);
$('#rpSearch').addEventListener('input', renderReport);
$('#btnReloadReport').addEventListener('click', loadReport);
