// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: stato della posta in arrivo (pagina Caselle email).
'use strict';

// ------------------------------------------------------------------ posta in arrivo

const MAIL_BADGES = {
  trasferita: ['b-ok', 'Trasferita'], riprovo: ['b-warn', 'Nuovo tentativo'], errore: ['b-err', 'Errore'], bloccata: ['b-err', 'Bloccata'],
  rimessa: ['b-info', 'Rimessa in coda'], ricevuta: ['b-info', 'Ricevuta PEC'], ignorata: ['b-mute', 'Senza allegati'],
};
const isProblem = (o) => o === 'errore' || o === 'bloccata';
// numero di protocollo delle PEC (ricavato dall'oggetto dal server)
const protTag = (p, src) => p ? `<span class="prot${src === 'manuale' ? ' manual' : ''}" title="${src === 'manuale' ? 'Protocollo corretto a mano' : 'Numero di protocollo'}">Prot. ${esc(p)}</span>` : '';
// link al documento in Viewpoint (VFP_DOC_URL delle impostazioni, con {id})
const docUrl = (id) => {
  const t = state.env?.VFP_DOC_URL || '';
  return id && t.includes('{id}') && /^https:\/\//.test(t) ? t.split('{id}').join(encodeURIComponent(id)) : '';
};
const docLink = (id, label = 'Apri') => {
  const u = docUrl(id);
  return u ? `<a class="link-ext" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon('link')}${esc(label)}</a>` : '';
};
const PEC_TYPE = {
  'posta-certificata': 'Posta certificata', accettazione: 'Accettazione', 'non-accettazione': 'Mancata accettazione',
  'presa-in-carico': 'Presa in carico', 'avvenuta-consegna': 'Avvenuta consegna', 'errore-consegna': 'Mancata consegna',
  'preavviso-errore-consegna': 'Preavviso di mancata consegna', 'rilevazione-virus': 'Rilevazione virus', anomalia: 'Anomalia (non certificata)',
};
const SIGN_BADGE = { valida: ['b-ok', 'Firma valida'], 'non valida': ['b-err', 'Firma NON valida'], assente: ['b-warn', 'Senza firma'], 'non verificabile': ['b-mute', 'Firma non verificata'] };
const signBadge = (s) => { if (!s) return ''; const [c, l] = SIGN_BADGE[s] || ['b-mute', s]; return `<span class="badge ${c}">${esc(l)}</span>`; };
const mailBadge = (s) => { const [c, l] = MAIL_BADGES[s] || ['b-mute', s]; return `<span class="badge ${c}">${esc(l)}</span>`; };

function fmtWhen(ts) {
  if (!ts) return 'mai';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d)) return esc(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `oggi ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function loadMail() {
  let m;
  try { m = await api('/api/mail'); } catch { return; }
  state.mail = m;
  state.mailClockSkew = m.now ? m.now * 1000 - Date.now() : 0;
  renderMail();
  clearTimeout(state.mailTimer);
  const watching = !$('#view-posta').hidden || !$('#view-flusso').hidden;
  state.mailTimer = setTimeout(loadMail, watching ? 4000 : 20000);
}

function renderMail() {
  const m = state.mail;
  if (!m || !m.available) return;
  const loginNeeded = !!m.login_needed;
  const problems = m.problems || [];
  let cls = 'off', label = 'Disattivato';
  if (m.enabled && problems.length) { cls = 'warn'; label = 'Da completare nelle impostazioni'; }
  else if (m.enabled && loginNeeded) { cls = 'warn'; label = 'In attesa dell\'accesso a Viewpoint'; }
  else if (m.enabled && m.busy) { cls = 'busy'; label = 'Controllo in corso…'; }
  else if (m.enabled) { cls = 'ok'; label = 'Attivo'; }
  $('#mpDot').className = `state-dot ${cls}`;
  $('#mpState').textContent = label;
  $('#mailDot').hidden = !(m.enabled && (problems.length || loginNeeded || Object.values(m.sources || {}).some((s) => s.last_error)));
  updateMailCountdown();

  $('#mailLoginBanner').hidden = !(m.enabled && loginNeeded);
  $('#mailProblems').hidden = !(m.enabled && problems.length);
  $('#mailProblemsText').textContent = problems.join('. ') + (problems.length ? '.' : '');
  $('#btnMailCheck').disabled = !m.enabled;

  const hist = m.history || [];
  const n = (o) => hist.filter((h) => h.outcome === o).length;
  $('#mpOk').textContent = fmtNum(n('trasferita'));
  $('#mpRetry').textContent = fmtNum(n('riprovo'));
  $('#mpErr').textContent = fmtNum(n('errore') + n('bloccata'));

  const sources = Object.values(m.sources || {});
  $('#mpSources').innerHTML = sources.map((s) => `
    <article class="card source-card ${s.last_error ? 'has-error' : ''}">
      <div class="source-head">
        <span class="source-kind">${esc({ graph: 'Microsoft 365', imap: 'IMAP', pec: 'PEC' }[s.kind] || s.kind)}</span>
        ${s.last_error ? '<span class="badge b-err">Errore</span>' : s.last_check ? '<span class="badge b-ok">Collegata</span>' : '<span class="badge b-mute">In attesa</span>'}
      </div>
      <strong class="source-name">${esc(s.label)}</strong>
      <dl class="source-meta">
        <div><dt>Ultimo controllo</dt><dd>${fmtWhen(s.last_check)}</dd></div>
        <div><dt>Email trasferite</dt><dd class="mono">${fmtNum(s.transferred)}</dd></div>
      </dl>
      ${s.last_error ? `<p class="source-error">${esc(s.last_error)}</p>` : ''}
    </article>`).join('');
  renderMailRows();
  renderSideMail();
  renderFlow();
  if (!$('#view-panoramica').hidden && state.ovReport) renderOverview();
}

function updateMailCountdown() {
  const m = state.mail;
  if (!m) return;
  let txt = '';
  if (m.enabled && !m.busy && m.next_cycle) {
    const secs = Math.max(0, Math.round(m.next_cycle - (Date.now() + (state.mailClockSkew || 0)) / 1000));
    txt = secs > 0 ? `Prossimo controllo tra ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : 'Controllo imminente…';
    if (m.last_cycle) txt += ` · ultimo ${fmtWhen(m.last_cycle)}`;
  } else if (!m.enabled) {
    txt = 'Attivalo in Impostazioni > Posta in arrivo.';
  }
  $('#mpNext').textContent = txt;
}
setInterval(updateMailCountdown, 1000);

function renderMailRows() {
  const f = state.mpFilter || 'all';
  const rows = (state.mail.history || []).filter((h) => f === 'all' || h.outcome === f || (f === 'errore' && h.outcome === 'bloccata'));
  $('#mpBody').innerHTML = rows.map((h) => `<tr>
      <td class="nowrap mono small">${fmtWhen(h.time)}</td>
      <td>${mailBadge(h.outcome)}</td>
      <td class="cell-file">${protTag(h.protocol, h.protocol_source)}<span class="fname">${subjHtml(h.subject)}</span><span class="fdir">${esc(h.sender)}</span></td>
      <td class="cell-msg">${(h.files || []).map(esc).join('<br>')}</td>
      <td class="small">${esc(h.source)}</td>
      <td class="cell-msg">${esc(h.detail)}</td>
    </tr>`).join('');
  $('#mpEmpty').hidden = rows.length > 0;
  $('#mpEmpty p').textContent = (state.mail.history || []).length ? 'Nessuna email con questo esito.' : 'Nessuna email elaborata finora.';
}

bindChips('#mpFilter', 'mpFilter', () => state.mail && renderMailRows());

$('#btnMailCheck').addEventListener('click', async () => {
  try {
    await api('/api/mail/check', { method: 'POST' });
    toast('Controllo posta avviato.');
    setTimeout(loadMail, 800);
  } catch (e) { toast(e.message, 'err'); }
});

$('#btnMailLogin').addEventListener('click', () => $('#btnLogin').click());
