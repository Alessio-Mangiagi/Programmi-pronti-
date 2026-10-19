// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: protocolli PEC e stato del programma.
'use strict';

// ------------------------------------------------------------------ registro posta: dettaglio dalla riga

$('#mlBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-ml]');
  if (tr && state.mlData) openFlowDrawer(groupFromLogRow(state.mlData.rows[Number(tr.dataset.ml)]));
});

// ------------------------------------------------------------------ protocolli PEC (panoramica)

async function loadProt() {
  try {
    state.prot = await api('/api/protocol/check');
  } catch { return; }
  renderProt();
}

function renderProt() {
  const d = state.prot;
  const card = $('#ovProt');
  if (!d || (!d.years.length && !d.pec_total)) { card.hidden = true; return; }
  card.hidden = false;
  const years = d.years.map((y) => String(y.anno));
  if (!years.includes(state.protYear)) state.protYear = years[0] || '';
  $('#ovProtYear').innerHTML = years.map((y) => `<button class="chip ${y === state.protYear ? 'is-active' : ''}" type="button" data-f="${y}">${y}</button>`).join('');
  $('#ovProtXlsx').href = `/api/protocolli.xlsx${state.protYear ? `?anno=${state.protYear}` : ''}`;
  const y = d.years.find((x) => String(x.anno) === state.protYear);
  const pad = (n) => String(n).padStart(3, '0');
  if (!y) {
    $('#ovProtStats').innerHTML = '';
    $('#ovProtIssues').innerHTML = `<p class="muted small">${fmtNum(d.pec_total)} PEC ricevute, nessuna con un numero di protocollo riconosciuto. Controlla la regola in Impostazioni › Protocollo PEC.</p>`;
    return;
  }
  const missing = y.sequenza ? y.mancanti_totale : null;
  $('#ovProtStats').innerHTML = `
    <div class="stat"><span class="stat-label">PEC con protocollo</span><span class="stat-value mono">${fmtNum(y.totale)}</span></div>
    <div class="stat"><span class="stat-label">Ultimo numero</span><span class="stat-value mono">${pad(y.ultimo)}</span></div>
    <div class="stat ${missing ? 'stat-err' : 'stat-ok'}"><span class="stat-label">Numeri mancanti</span><span class="stat-value mono">${missing === null ? '—' : fmtNum(missing)}</span></div>
    <div class="stat ${y.doppi.length ? 'stat-err' : 'stat-ok'}"><span class="stat-label">Numeri doppi</span><span class="stat-value mono">${fmtNum(y.doppi.length)}</span></div>`;
  const parts = [];
  if (!y.sequenza) parts.push('<p class="muted small">I numeri di quest’anno non formano una sequenza (probabilmente protocolli di enti diversi): il controllo dei mancanti non si applica.</p>');
  if (y.mancanti.length) {
    parts.push(`<p class="prot-line"><strong>Mancano:</strong> ${y.mancanti.map((n) => `<span class="prot-num">${pad(n)}</span>`).join('')}${y.mancanti_totale > y.mancanti.length ? ` <span class="muted small">e altri ${fmtNum(y.mancanti_totale - y.mancanti.length)}</span>` : ''}</p>`);
  }
  y.doppi.forEach((dup) => {
    parts.push(`<div class="prot-dup"><strong>Doppio ${pad(dup.numero)}:</strong><ul>${dup.email.map((e) => `<li>${fmtWhen(e.ricevuta)} · ${esc(e.mittente)} · ${subjHtml(e.oggetto)}</li>`).join('')}</ul></div>`);
  });
  if (!parts.length) parts.push(`<p class="prot-ok">${icon('check')}Numerazione completa da ${pad(y.primo)} a ${pad(y.ultimo)}, nessun doppio.</p>`);
  if (d.pec_without) parts.push(`<p class="muted small">${fmtNum(d.pec_without)} PEC senza protocollo riconosciuto: si possono correggere a mano dal dettaglio dell'email.</p>`);
  $('#ovProtIssues').innerHTML = parts.join('');
}

$('#ovProtYear').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  state.protYear = c.dataset.f;
  renderProt();
});

// ------------------------------------------------------------------ protocollo PEC (impostazioni): prova della regola

$('#protTest').addEventListener('click', async () => {
  const btn = $('#protTest');
  const out = $('#protTestOut');
  setLoading(btn, true);
  try {
    const r = await api('/api/protocol/test', { method: 'POST', body: { rule: $('#protRule').value.trim(), subject: $('#protSubject').value } });
    const head = r.subject ? `<p class="prot-result">${r.subject.protocollo ? `Protocollo trovato: <strong class="mono">${esc(r.subject.protocollo)}</strong>` : 'Nessun protocollo trovato in questo oggetto.'}</p>` : '';
    const rows = (r.samples || []).map((x) => `<tr class="${x.nuovo !== x.attuale ? 'changed' : ''}"><td class="cell-msg">${subjHtml(x.oggetto)}</td><td class="mono nowrap">${esc(x.attuale || '—')}</td><td class="mono nowrap">${esc(x.nuovo || '—')}</td></tr>`).join('');
    out.innerHTML = head + (rows ? `<p class="muted small">Ultime PEC ricevute: in evidenza quelle che cambierebbero salvando la regola.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Oggetto</th><th>Ora</th><th>Con la regola</th></tr></thead><tbody>${rows}</tbody></table></div>` : '');
    out.hidden = false;
  } catch (e) {
    out.innerHTML = `<p class="test-result err">${esc(e.message)}</p>`;
    out.hidden = false;
  } finally {
    setLoading(btn, false);
  }
});
$('#protSubject').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#protTest').click(); } });

// ------------------------------------------------------------------ stato del programma (impostazioni)

async function loadHealth() {
  const box = $('#healthBox');
  let d;
  try {
    const res = await fetch('/api/salute');
    d = await res.json();
  } catch {
    box.innerHTML = '<span class="badge b-err">Il programma non risponde</span>';
    return;
  }
  const m = d.posta || {};
  box.innerHTML = `<p>${d.stato === 'ok' ? '<span class="badge b-ok">Tutto regolare</span>' : '<span class="badge b-err">Da controllare</span>'}
      ${(d.problemi || []).map((x) => `<span class="badge b-warn">${esc(x)}</span>`).join(' ')}</p>
    <dl class="health-dl">
      <div><dt>Controllo posta</dt><dd>${m.attiva ? (m.thread_vivo ? 'attivo' : 'fermo') : 'disattivato'}</dd></div>
      <div><dt>Ultimo giro</dt><dd>${fmtWhen(m.ultimo_giro)}</dd></div>
      <div><dt>Trasferimento in corso</dt><dd>${d.trasferimento_in_corso ? 'sì' : 'no'}</dd></div>
      <div><dt>Versione</dt><dd class="mono small">${esc(d.versione)}</dd></div>
    </dl>`;
}
$('#btnHealth').addEventListener('click', loadHealth);
