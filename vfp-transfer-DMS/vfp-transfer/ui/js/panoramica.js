// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: cronologia posta e panoramica.
'use strict';

// ------------------------------------------------------------------ cronologia posta: un elemento per email

const KIND_LABEL = { graph: 'Microsoft 365', imap: 'IMAP', pec: 'PEC' };

function mailKey(h) {
  return h.key || `${h.sender}|${h.subject}|${h.received}`;
}

function mailKind(h) {
  if (h.kind) return h.kind;
  const s = (h.source || '').toLowerCase();
  return s.startsWith('pec') ? 'pec' : s.startsWith('imap') ? 'imap' : 'graph';
}

// raggruppa la cronologia (piu' recenti prima) per email: esito attuale = ultimo tentativo
function mailGroups(history) {
  const groups = new Map();
  for (const h of history || []) {
    const k = mailKey(h);
    if (!groups.has(k)) groups.set(k, { key: k, latest: h, attempts: [] });
    groups.get(k).attempts.push(h);
  }
  return [...groups.values()];
}

const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function fmtCountdown(m) {
  if (!m || !m.enabled) return null;
  if (m.busy) return 'in corso';
  if (!m.next_cycle) return '—';
  const secs = Math.max(0, Math.round(m.next_cycle - (Date.now() + (state.mailClockSkew || 0)) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ stato posta nella barra laterale

function renderSideMail() {
  const m = state.mail;
  const pill = $('#sideMail');
  if (!m || !m.available) return;
  const nSources = Object.keys(m.sources || {}).length;
  let cls = '', label = 'Posta disattivata';
  if (m.enabled && (m.problems || []).length) { cls = 'warn'; label = 'Posta da configurare'; }
  else if (m.enabled && m.login_needed) { cls = 'warn'; label = 'Posta in attesa di accesso'; }
  else if (m.enabled && Object.values(m.sources || {}).some((s) => s.last_error)) { cls = 'err'; label = 'Posta: errore casella'; }
  else if (m.enabled && m.busy) { cls = 'busy'; label = 'Posta: controllo in corso'; }
  else if (m.enabled) { cls = 'ok'; label = `Posta attiva · ${nSources || '—'} ${nSources === 1 ? 'casella' : 'caselle'}`; }
  pill.className = `auth-pill ${cls}`;
  $('.side-mail-label', pill).textContent = label;
  const errors = mailGroups(m.history).filter((g) => isProblem(g.latest.outcome)).length;
  $('#flCount').hidden = !errors;
  $('#flCount').textContent = errors;
}

// ------------------------------------------------------------------ panoramica

async function loadOverview() {
  let report = { rows: [] };
  try {
    [report] = await Promise.all([api('/api/report'), state.mail ? Promise.resolve() : loadMail()]);
  } catch (e) {
    toast(e.message, 'err');
  }
  state.ovReport = report.rows || [];
  renderOverview();
  if (isAdmin()) loadProt();
  clearTimeout(state.ovTimer);
  if (!$('#view-panoramica').hidden) state.ovTimer = setTimeout(loadOverview, 20000);
}

function renderOverview() {
  const now = new Date();
  const day = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#ovDate').innerHTML = `${esc(day.charAt(0).toUpperCase() + day.slice(1))}<span class="ov-year">${now.getFullYear()}</span>`;

  const rows = state.ovReport || [];
  const loaded = rows.filter((r) => r.esito === 'caricato');
  const perDay = {};
  loaded.forEach((r) => { const d = (r.data || '').slice(0, 10); perDay[d] = (perDay[d] || 0) + 1; });
  const today = localDay(now);
  const yest = localDay(new Date(now.getTime() - 864e5));
  const nToday = perDay[today] || 0;
  const diff = nToday - (perDay[yest] || 0);
  $('#ovDocs').textContent = fmtNum(nToday);
  const sub = $('#ovDocsSub');
  sub.textContent = rows.length ? `${diff >= 0 ? '+' : ''}${fmtNum(diff)} rispetto a ieri` : 'Nessun trasferimento registrato';
  sub.classList.toggle('up', diff > 0);

  // grafico ultimi 7 giorni
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 864e5);
    days.push({ key: localDay(d), label: i === 0 ? 'Oggi' : d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '') });
  }
  const max = Math.max(1, ...days.map((d) => perDay[d.key] || 0));
  const weekTotal = days.reduce((a, d) => a + (perDay[d.key] || 0), 0);
  $('#ovWeekTotal').textContent = `totale ${fmtNum(weekTotal)}`;
  $('#ovBars').innerHTML = days.map((d, i) => {
    const v = perDay[d.key] || 0;
    return `<div class="bar ${i === 6 ? 'today' : ''}" title="${esc(d.key)}: ${v} documenti"><b>${fmtNum(v)}</b><span style="height:${(v / max) * 100}%;animation-delay:${i * 60}ms"></span><small>${esc(d.label)}</small></div>`;
  }).join('');

  // posta
  const m = state.mail || {};
  const groups = mailGroups(m.history);
  const mailsToday = groups.filter((g) => g.latest.outcome === 'trasferita' && (g.latest.time || '').startsWith(today)).length;
  const errs = groups.filter((g) => isProblem(g.latest.outcome));
  const nSources = Object.keys(m.sources || {}).length;
  $('#ovMails').textContent = fmtNum(mailsToday);
  $('#ovMailsSub').textContent = m.enabled ? `${nSources} ${nSources === 1 ? 'casella attiva' : 'caselle attive'}` : 'Posta automatica disattivata';
  $('#ovErr').textContent = fmtNum(errs.length);
  $('#ovErrSub').textContent = errs.length ? subjText(errs[0].latest.subject) : 'Nessuna email da verificare ✓';
  $('#ovErrSub').classList.toggle('up', !errs.length);
  $('#ovErrCard').classList.toggle('has-items', errs.length > 0);
  $('#ovQuickMail').textContent = errs.length
    ? `${errs.length} ${errs.length === 1 ? 'email da verificare' : 'email da verificare'}.`
    : 'Email in attesa, in caricamento e trasferite.';
  updateOverviewCountdown();

  // attivita' recente: file del report + email elaborate, dalla piu' recente
  const feed = [
    ...rows.slice(0, 30).filter((r) => r.esito !== 'saltato').map((r) => ({
      t: r.data, k: r.esito === 'caricato' ? 'ok' : 'err', icon: r.esito === 'caricato' ? 'check' : 'alert',
      text: `${r.nome || splitPath(r.file || '')[1]} ${r.esito === 'caricato' ? 'caricato' : 'non caricato'}`,
      sub: r.esito === 'caricato' ? (r.cartella || '') : r.messaggio,
    })),
    ...(m.history || []).slice(0, 20).map((x) => ({
      t: x.time, k: x.outcome === 'trasferita' ? 'info' : x.outcome === 'errore' ? 'err' : 'warn', icon: 'mail',
      text: subjText(x.subject), who: x.sender,
      sub: { trasferita: 'trasferita', riprovo: 'nuovo tentativo', errore: 'da verificare', bloccata: 'bloccata per sicurezza' }[x.outcome] || x.outcome,
    })),
  ].sort((a, b) => String(b.t).localeCompare(String(a.t))).slice(0, 7);
  $('#ovFeed').innerHTML = feed.map((f) => `<li><span class="fi ${f.k}">${icon(f.icon)}</span>
      <span class="ft">${f.who ? `<strong>${esc(f.who)}</strong> ` : ''}${esc(f.text)}${f.sub ? `<small>${esc(f.sub)}</small>` : ''}</span><time title="${esc(fmtFull(f.t))}">${fmtAgo(f.t)}</time></li>`).join('');
  $('#ovFeedEmpty').hidden = feed.length > 0;

  // ultime email
  const last = groups.slice(0, 8);
  $('#ovMailBody').innerHTML = last.map((g) => {
    const x = g.latest;
    return `<tr><td class="nowrap small" title="${esc(fmtFull(x.time))}">${fmtAgo(x.time)}</td><td>${mailBadge(x.outcome)}</td>
      <td><strong>${esc(x.sender)}</strong></td><td class="cell-msg">${protTag(x.protocol, x.protocol_source)}${subjHtml(x.subject)}</td>
      <td class="num mono">${(x.files || []).length}</td><td class="small">${esc(KIND_LABEL[mailKind(x)] || x.source)}</td></tr>`;
  }).join('');
  $('#ovMailEmpty').hidden = last.length > 0;
}

function updateOverviewCountdown() {
  const m = state.mail;
  const cd = fmtCountdown(m);
  const off = !m || !m.enabled;
  $('#ovNext').textContent = off ? 'Spenta' : (cd ?? '—');
  $('#ovNext').classList.toggle('kpi-off', off);
  $('#ovNextSub').innerHTML = off
    ? (isAdmin() ? '<a href="#" data-goto="impostazioni" data-anchor="cardMail">Attiva la posta automatica</a>' : 'Posta automatica disattivata')
    : m.login_needed ? 'In attesa dell’accesso a Viewpoint' : `ogni ${Math.round((state.env?.MAIL_POLL_SECONDS || 120) / 60 * 10) / 10} minuti`;
  // pillola della bacheca
  const live = $('#flLive');
  if (!m || !m.available) return;
  let cls = '', txt = 'Posta automatica disattivata';
  if (m.enabled && (m.problems || []).length) { cls = 'warn'; txt = 'Configurazione posta da completare'; }
  else if (m.enabled && m.login_needed) { cls = 'warn'; txt = 'In attesa dell’accesso a Viewpoint'; }
  else if (m.enabled && m.busy) { cls = 'busy'; txt = 'Controllo della posta in corso…'; }
  else if (m.enabled) { cls = 'ok'; txt = `Controllo automatico attivo · prossimo tra ${cd}`; }
  live.className = `live-pill ${cls}`;
  $('span', live).textContent = txt;
}
setInterval(updateOverviewCountdown, 1000);

$('#ovCheck').addEventListener('click', () => $('#btnMailCheck').click());
