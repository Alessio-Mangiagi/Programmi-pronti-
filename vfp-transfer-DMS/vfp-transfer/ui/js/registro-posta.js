// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: caselle collegate e posta ricevuta.
'use strict';

// ------------------------------------------------------------------ caselle collegate e posta ricevuta (impostazioni)

const ML_OUTCOME = {
  trasferita: ['b-ok', 'Trasferita'], riprovo: ['b-warn', 'Nuovo tentativo'],
  errore: ['b-err', 'Errore'], bloccata: ['b-err', 'Bloccata'], ignorata: ['b-mute', 'Senza allegati'],
};
const plural = (n, one, many) => `<b>${fmtNum(n)}</b> ${n === 1 ? one : many}`;
const mlBadge = (s) => { const [c, l] = ML_OUTCOME[s] || ['b-mute', s]; return `<span class="badge ${c}">${esc(l)}</span>`; };

function mlFilters() {
  const days = Number(state.mlPeriod);
  const dal = days ? localDay(new Date(Date.now() - (days - 1) * 864e5)) : '';
  return { dal, casella: state.mlSource || '', q: $('#mlSearch').value.trim() };
}

function updateXlsxLink() {
  const f = mlFilters();
  const p = new URLSearchParams();
  if (f.dal) p.set('dal', f.dal);
  if (f.casella) p.set('casella', f.casella);
  $('#btnXlsx').href = `/api/report.xlsx${p.toString() ? `?${p}` : ''}`;
  $('#btnXlsx').title = `Report Excel: ${f.casella || 'tutte le caselle'}, ${f.dal ? `dal ${new Date(f.dal).toLocaleDateString('it-IT')}` : 'tutto il periodo'}`;
}

async function loadMailLog() {
  const f = mlFilters();
  const p = new URLSearchParams({ limit: '500' });
  if (f.dal) p.set('dal', f.dal);
  if (f.casella) p.set('casella', f.casella);
  if (f.q) p.set('q', f.q);
  let d;
  try { d = await api(`/api/mail/log?${p}`); } catch (e) { toast(e.message, 'err'); return; }
  state.mlData = d;
  renderMailLog();
  updateXlsxLink();
}

function renderMailLog() {
  const d = state.mlData;
  if (!d) return;
  $('#mlSources').innerHTML = d.sources.map((s) => {
    const c = s.counts;
    const st = !s.active ? ['', 'Non attiva'] : s.last_error ? ['err', 'Errore'] : s.last_check ? ['ok', 'Collegata'] : ['', 'In attesa'];
    return `<button type="button" class="mbox ${state.mlSource === s.label ? 'is-active' : ''}" data-src="${esc(s.label)}">
      <span class="mbox-top"><span class="mbox-kind">${esc(KIND_LABEL[s.kind] || s.kind)}</span><span class="mbox-state ${st[0]}">${st[1]}</span></span>
      <span class="mbox-addr">${esc(s.address || s.label)}</span>
      <span class="mbox-counts"><span>${plural(c.totale, 'ricevuta', 'ricevute')}</span><span>${plural(c.trasferita, 'trasferita', 'trasferite')}</span>
        ${c.errore ? `<span class="c-err">${plural(c.errore, 'errore', 'errori')}</span>` : ''}${c.bloccata ? `<span class="c-err">${plural(c.bloccata, 'bloccata', 'bloccate')}</span>` : ''}${c.ignorata ? `<span>${plural(c.ignorata, 'senza allegati', 'senza allegati')}</span>` : ''}</span>
      <span class="mbox-meta">${s.active ? `Ultimo controllo: ${fmtWhen(s.last_check)}` : 'Casella non più attiva'}${s.last_mail ? ` · ultima email ${fmtWhen(s.last_mail)}` : ''}</span>
      ${s.last_error ? `<span class="mbox-err">${esc(s.last_error)}</span>` : ''}
    </button>`;
  }).join('') || '<p class="muted small">Nessuna casella collegata: attivale qui sotto, in "Caselle email".</p>';

  $('#mlBody').innerHTML = d.rows.map((r, i) => {
    const files = (r.allegati || '').split(' | ').filter(Boolean);
    return `<tr class="row-link" data-ml="${i}" title="Apri il dettaglio">
      <td class="nowrap mono small">${fmtWhen(r.ricevuta || r.data)}</td>
      <td class="small">${esc(r.indirizzo_casella || r.casella)}<span class="fdir">${esc(KIND_LABEL[r.tipo_casella] || '')}</span></td>
      <td class="cell-file"><span class="fname">${esc(r.mittente || '—')}</span></td>
      <td class="cell-msg">${protTag(r.protocollo, r.protocollo_origine)}${subjHtml(r.oggetto)}</td>
      <td class="cell-msg">${files.map(esc).join('<br>') || '—'}</td>
      <td>${mlBadge(r.esito)}${['errore', 'riprovo', 'bloccata'].includes(r.esito) ? `<span class="fdir">${esc(r.dettaglio)}</span>` : ''}</td>
      <td class="num mono">${r.esito === 'ignorata' ? '—' : fmtNum(r.tentativi)}</td>
    </tr>`;
  }).join('');
  $('#mlEmpty').hidden = d.rows.length > 0;
  $('#mlEmpty').textContent = d.all_total ? 'Nessuna email con questi filtri.' : 'Nessuna email ricevuta finora.';
  $('#mlCount').textContent = d.total > d.rows.length
    ? `${fmtNum(d.total)} email: mostrate le ${fmtNum(d.rows.length)} più recenti, nel report Excel ci sono tutte.`
    : `${fmtNum(d.total)} email${state.mlSource ? ` per ${state.mlSource}` : ''}.`;
}

$('#mlSources').addEventListener('click', (e) => {
  const b = e.target.closest('.mbox');
  if (!b) return;
  state.mlSource = state.mlSource === b.dataset.src ? '' : b.dataset.src;
  loadMailLog();
});
bindChips('#mlPeriod', 'mlPeriod', loadMailLog);
let mlSearchTimer = null;
$('#mlSearch').addEventListener('input', () => { clearTimeout(mlSearchTimer); mlSearchTimer = setTimeout(loadMailLog, 300); });
