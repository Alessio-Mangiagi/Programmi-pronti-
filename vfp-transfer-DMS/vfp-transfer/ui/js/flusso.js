// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: flusso posta e dettaglio di un'email.
'use strict';

// ------------------------------------------------------------------ flusso posta (bacheca)

const FLOW_COLS = [
  ['attesa', 'In attesa', '#9aa0a8', 'Nuovo tentativo al prossimo controllo'],
  ['caricamento', 'In caricamento', 'var(--blue)', ''],
  ['trasferita', 'Trasferite', 'var(--green)', ''],
  ['errore', 'Da verificare', 'var(--red)', 'Spostate nella cartella errori o di quarantena della casella'],
];

function renderFlow() {
  const m = state.mail;
  if (!m || !m.available) return;
  const f = state.flFilter || 'all';
  const groups = mailGroups(m.history).filter((g) => f === 'all' || mailKind(g.latest) === f);
  const cur = m.current && (f === 'all' || m.current.kind === f) ? m.current : null;
  const byCol = {
    attesa: groups.filter((g) => g.latest.outcome === 'riprovo' && (!cur || g.key !== cur.key)),
    caricamento: cur ? [{ key: cur.key, latest: { ...cur, outcome: 'caricamento', time: new Date(cur.started * 1000).toISOString() }, attempts: [] }] : [],
    trasferita: groups.filter((g) => g.latest.outcome === 'trasferita'),
    errore: groups.filter((g) => isProblem(g.latest.outcome)),
  };
  state.flGroups = Object.values(byCol).flat();
  const EMPTY = { attesa: 'Nessuna email in attesa', caricamento: 'Nessun caricamento in corso', trasferita: 'Nessuna email trasferita', errore: 'Nessuna email da verificare ✓' };
  $('#flBoard').innerHTML = FLOW_COLS.map(([k, label, color, hint]) => {
    const all = byCol[k];
    // le trasferite sono tante e tutte a posto: si mostrano le ultime 10, il resto a richiesta
    const list = k === 'trasferita' && !state.flAllDone ? all.slice(0, 10) : all;
    return `<section class="col" aria-label="${esc(label)}">
      <div class="col-head"><span class="bar-c" style="background:${color}"></span>${esc(label)}<span class="n ${k === 'errore' && all.length ? 'n-err' : ''}">${all.length}</span></div>
      ${hint && list.length ? `<p class="col-hint">${esc(hint)}</p>` : ''}
      ${list.map((g, i) => {
        const x = g.latest;
        const canRetry = isAdmin() && x.key && (x.outcome === 'errore' || x.outcome === 'riprovo');
        return `<div role="button" tabindex="0" class="mcard ${k === 'errore' ? 'err' : k === 'attesa' ? 'retry' : ''}" data-key="${esc(g.key)}" style="animation-delay:${Math.min(i, 8) * 60}ms">
          <div class="row1"><span>${esc(KIND_LABEL[mailKind(x)] || '')}</span><span title="${esc(fmtFull(x.received || x.time))}">${fmtAgo(x.received || x.time)}</span></div>
          <div class="from">${esc(x.sender || 'mittente sconosciuto')}</div>
          ${protTag(x.protocol, x.protocol_source)}<div class="subj">${subjHtml(x.subject)}</div>
          <div class="atts">${(x.files || []).map((n) => `<span class="att" title="${esc(n)}">${icon('paperclip')}${esc(n)}</span>`).join('')}</div>
          ${k === 'caricamento' ? '<div class="mprog"><span></span></div>' : ''}
          ${k !== 'trasferita' && k !== 'caricamento' && x.detail ? `<div class="merr">${esc(x.detail)}</div>` : ''}
          ${canRetry ? `<button type="button" class="btn btn-secondary btn-sm mcard-retry" data-retry="${esc(x.key)}">${icon('refresh')}Riprova adesso</button>` : ''}
        </div>`;
      }).join('') || `<p class="empty-col ${k === 'errore' ? 'empty-ok' : ''}">${EMPTY[k]}</p>`}
      ${k === 'trasferita' && all.length > 10 ? `<button type="button" class="btn btn-ghost btn-sm btn-block" id="flMore">${state.flAllDone ? 'Mostra solo le ultime 10' : `Mostra tutte (${fmtNum(all.length)})`}</button>` : ''}
    </section>`;
  }).join('');
}

bindChips('#flFilter', 'flFilter', renderFlow);
$('#flCheck').addEventListener('click', () => $('#btnMailCheck').click());
$('#flDCheck').addEventListener('click', () => $('#btnMailCheck').click());

$('#flBoard').addEventListener('click', (e) => {
  if (e.target.closest('#flMore')) { state.flAllDone = !state.flAllDone; renderFlow(); return; }
  const r = e.target.closest('[data-retry]');
  if (r) { retryMail(r.dataset.retry, r); return; }
  const c = e.target.closest('.mcard');
  if (!c) return;
  const g = (state.flGroups || []).find((x) => x.key === c.dataset.key);
  if (g) openFlowDrawer(g);
});
$('#flBoard').addEventListener('keydown', (e) => {
  const c = e.target.closest('.mcard');
  if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.click(); }
});

// "Riprova adesso" (scheda o dettaglio): rimette in coda l'email in errore
async function retryMail(key, btn) {
  setLoading(btn, true);
  try {
    const r = await api('/api/mail/retry', { method: 'POST', body: { key } });
    toast(r.message, 'ok', 7000);
    closeFlowDrawer();
    setTimeout(loadMail, 3000);
  } catch (err) {
    toast(err.message, 'err', 8000);
  } finally {
    setLoading(btn, false);
  }
}

function openFlowDrawer(g) {
  state.drawerGroup = g;
  const x = g.latest;
  const outcome = x.outcome;
  const kind = mailKind(x);
  const p = x.pec || {};
  $('#flDBox').textContent = `${KIND_LABEL[kind] || ''} · ${x.source || ''}`;
  $('#flDSubj').textContent = subjText(x.subject);
  $('#flDSubj').title = x.subject || '';
  const steps = [...g.attempts].reverse().map((a) => {
    const cls = a.outcome === 'trasferita' ? '' : a.outcome === 'errore' ? 'e' : a.outcome === 'rimessa' ? 'i' : 'w';
    const what = {
      trasferita: 'Allegati caricati in Viewpoint', riprovo: 'Caricamento non riuscito, nuovo tentativo previsto',
      errore: 'Caricamento non riuscito: email spostata tra gli errori', bloccata: 'Bloccata dai controlli di sicurezza: nessun file caricato',
      rimessa: 'Rimessa nella cartella controllata per un nuovo caricamento', ricevuta: 'Ricevuta PEC registrata', ignorata: 'Nessun allegato da caricare',
    }[a.outcome] || a.outcome;
    return `<li class="${cls}"><time>${fmtWhen(a.time)}</time>${esc(what)}${a.detail ? `<br><span class="muted small">${esc(a.detail)}</span>` : ''}</li>`;
  });
  const canPreview = x.key && !['bloccata', 'caricamento'].includes(outcome);
  const fileUrl = (n, dl) => `/api/mail/file?key=${encodeURIComponent(x.key)}&name=${encodeURIComponent(n)}${dl ? '&download=1' : ''}`;
  const isImg = (n) => /\.(png|jpe?g|gif)$/i.test(n);
  const files = (x.files || []).map((n) => canPreview
    ? `<li><span class="att-name">${icon('paperclip')}${esc(n)}</span><span class="att-acts">
        <a href="${fileUrl(n)}" target="_blank" rel="noopener" title="Anteprima">${icon('eye')}</a>
        <a href="${fileUrl(n, true)}" title="Scarica" download>${icon('download')}</a></span>
        ${isImg(n) ? `<img class="att-thumb" src="${fileUrl(n)}" alt="" loading="lazy">` : ''}</li>`
    : `<li><span class="att-name">${icon('paperclip')}${esc(n)}</span></li>`).join('');
  const docs = (x.docs || []).filter((d) => d.doc_id).map((d) => `<li><span class="att-name">${esc(d.name)}</span>
      <span class="att-acts">${badge(d.status)} ${docLink(d.doc_id) || `<span class="mono small muted">${esc(d.doc_id)}</span>`}</span></li>`).join('');
  const protRow = kind === 'pec' ? `<div><dt>Protocollo</dt><dd>
      <span id="flDProt">${x.protocol ? `<span class="mono">${esc(x.protocol)}</span>${x.protocol_source === 'manuale' ? ' <span class="muted small">(corretto a mano)</span>' : ''}` : '<span class="muted">non trovato</span>'}</span>
      ${x.key ? '<button class="btn-link" type="button" id="flDProtEdit">Correggi</button>' : ''}</dd></div>` : '';
  $('#flDBody').innerHTML = `<dl>
      <div><dt>Mittente</dt><dd>${esc(x.sender || '—')}</dd></div>
      ${protRow}
      <div><dt>Ricevuta</dt><dd>${fmtWhen(x.received)}</dd></div>
      <div><dt>Stato</dt><dd>${outcome === 'caricamento' ? '<span class="badge b-info">In caricamento</span>' : mailBadge(outcome)}</dd></div>
      <div><dt>Cartella Viewpoint</dt><dd>${esc(state.env?.MAIL_VFP_FOLDER || '—')}</dd></div>
    </dl>
    ${p.tipo ? `<h3>Busta PEC</h3><dl>
      <div><dt>Tipo</dt><dd>${esc(PEC_TYPE[p.tipo] || p.tipo)}</dd></div>
      <div><dt>Firma del gestore</dt><dd>${signBadge(p.firma)}${p.firmatario ? `<br><span class="muted small">${esc(p.firmatario)}</span>` : ''}</dd></div>
      ${p.gestore ? `<div><dt>Gestore</dt><dd>${esc(p.gestore)}</dd></div>` : ''}
      ${p.data ? `<div><dt>Data certificata</dt><dd class="mono small">${esc(p.data)}</dd></div>` : ''}
      ${p.identificativo ? `<div><dt>Identificativo</dt><dd class="mono small">${esc(p.identificativo)}</dd></div>` : ''}
      ${p.destinatari && p.destinatari.length ? `<div><dt>Destinatari</dt><dd>${esc([].concat(p.destinatari).join(', '))}</dd></div>` : ''}
    </dl>` : ''}
    <h3>Allegati</h3>
    ${files ? `<ul class="att-list">${files}</ul>` : '<p class="muted small">Nessun allegato.</p>'}
    ${docs ? `<h3>Documenti in Viewpoint</h3><ul class="att-list">${docs}</ul>` : ''}
    <h3>Cronologia</h3>
    <ol class="timeline">
      <li class="i"><time>${fmtWhen(x.received)}</time>Email ricevuta nella casella</li>
      ${outcome === 'caricamento' ? `<li class="i"><time>${fmtWhen(x.time)}</time>Caricamento degli allegati in corso</li>` : steps.join('')}
    </ol>`;
  $('#flDRetry').hidden = !(isAdmin() && x.key && ['errore', 'riprovo'].includes(outcome));
  $('#flDrawer').hidden = false;
  $('[data-close-drawer].icon-btn', $('#flDrawer')).focus();
}

// email dal registro (Caselle collegate, ricerca) nello stesso formato della cronologia
function groupFromLogRow(r) {
  const docs = (r.documenti || '').split(' | ').filter(Boolean).map((d) => {
    const i = d.lastIndexOf('=');
    return { name: d.slice(0, i), doc_id: d.slice(i + 1), status: 'caricato' };
  });
  const latest = {
    key: r.chiave, sender: r.mittente, subject: r.oggetto, received: r.ricevuta, time: r.data,
    files: (r.allegati || '').split(' | ').filter(Boolean), outcome: r.esito, detail: r.dettaglio,
    protocol: r.protocollo, protocol_source: r.protocollo_origine, kind: r.tipo_casella, source: r.casella, docs,
    pec: r.pec_tipo ? { tipo: r.pec_tipo, identificativo: r.pec_id, gestore: r.pec_gestore, firma: r.pec_firma,
      destinatari: r.pec_destinatari ? r.pec_destinatari.split(', ') : [] } : {},
  };
  return { key: r.chiave, latest, attempts: [latest] };
}

$('#flDBody').addEventListener('click', async (e) => {
  if (e.target.id !== 'flDProtEdit') return;
  const x = state.drawerGroup.latest;
  const ok = await confirmDialog({
    title: 'Correggi il protocollo',
    html: `<p>Protocollo di questa PEC. Lascia vuoto per tornare a quello letto dall'oggetto.</p>
      <div class="field"><label for="protEditInput">Numero di protocollo</label>
      <input id="protEditInput" type="text" class="mono" maxlength="60" spellcheck="false" value="${esc(x.protocol_source === 'manuale' ? x.protocol : (x.protocol || ''))}" placeholder="001/${new Date().getFullYear()}"></div>`,
    okText: 'Salva',
  });
  if (!ok) return;
  try {
    const value = ($('#protEditInput') || {}).value || '';
    const r = await api('/api/protocol/set', { method: 'POST', body: { key: x.key, protocol: value.trim() } });
    toast(r.protocol ? `Protocollo salvato: ${r.protocol}` : 'Protocollo riportato a quello automatico.', 'ok');
    await loadMail();
    const g = mailGroups(state.mail.history).find((y) => y.key === x.key);
    if (g) openFlowDrawer(g);
    else closeFlowDrawer();
    if (!$('#view-impostazioni').hidden) loadMailLog();
    loadProt();
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#flDRetry').addEventListener('click', () => {
  const x = state.drawerGroup && state.drawerGroup.latest;
  if (x) retryMail(x.key, $('#flDRetry'));
});

function closeFlowDrawer() { $('#flDrawer').hidden = true; }
$$('[data-close-drawer]').forEach((b) => b.addEventListener('click', closeFlowDrawer));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#flDrawer').hidden) closeFlowDrawer(); });
