// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: ricerca unica.
'use strict';

// ------------------------------------------------------------------ ricerca unica

function openSearch() {
  if (!isAdmin()) return;
  $('#searchModal').hidden = false;
  $('#searchInput').focus();
  $('#searchInput').select();
}
function closeSearch() { $('#searchModal').hidden = true; }

async function runSearch() {
  const q = $('#searchInput').value.trim();
  const out = $('#searchResults');
  if (q.length < 2) {
    out.innerHTML = '<p class="muted small search-hint">Scrivi almeno 2 caratteri. Cerca in tutte le email ricevute e in tutti i documenti trasferiti.</p>';
    return;
  }
  try {
    const d = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if ($('#searchInput').value.trim() !== q) return;  // nel frattempo l'utente ha scritto altro
    state.searchData = d;
    const emails = d.emails.map((e, i) => `<button type="button" class="search-item" data-email="${i}">
        <span class="si-ic">${icon('mail')}</span>
        <span class="si-txt"><strong>${protTag(e.protocollo, e.protocollo_origine)}${esc(subjText(e.oggetto))}</strong>
        <small>${esc(e.mittente)} · ${fmtWhen(e.ricevuta || e.data)} · ${esc(KIND_LABEL[e.tipo_casella] || '')}</small></span>${mailBadge(e.esito)}</button>`).join('');
    const docs = d.documents.map((r, i) => `<button type="button" class="search-item" data-doc="${i}">
        <span class="si-ic">${icon('file')}</span>
        <span class="si-txt"><strong>${esc(r.nome || r.nome_file)}</strong><small>${esc(r.cartella || '(radice)')} · ${fmtWhen(r.data)}</small></span>${badge(r.esito)}</button>`).join('');
    const more = (n, shown) => (n > shown ? `<p class="muted small">Mostrati ${shown} di ${fmtNum(n)}: affina la ricerca.</p>` : '');
    out.innerHTML = (emails ? `<h3>Email <span class="muted">${fmtNum(d.emails_total)}</span></h3>${emails}${more(d.emails_total, d.emails.length)}` : '')
      + (docs ? `<h3>Documenti <span class="muted">${fmtNum(d.documents_total)}</span></h3>${docs}${more(d.documents_total, d.documents.length)}` : '')
      || '<p class="muted small search-hint">Nessun risultato.</p>';
  } catch (e) {
    out.innerHTML = `<p class="test-result err">${esc(e.message)}</p>`;
  }
}

$('#btnSearch').addEventListener('click', openSearch);
$$('#searchModal [data-close]').forEach((b) => b.addEventListener('click', closeSearch));
$('#searchInput').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(runSearch, 250); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
  else if (e.key === 'Escape' && !$('#searchModal').hidden) closeSearch();
});
$('#searchResults').addEventListener('click', async (e) => {
  const it = e.target.closest('.search-item');
  if (!it || !state.searchData) return;
  if (it.dataset.email !== undefined) {
    closeSearch();
    openFlowDrawer(groupFromLogRow(state.searchData.emails[Number(it.dataset.email)]));
  } else {
    const r = state.searchData.documents[Number(it.dataset.doc)];
    closeSearch();
    showView('storico');
    $('#rpSearch').value = r.id_documento || r.nome || r.nome_file;
  }
});
