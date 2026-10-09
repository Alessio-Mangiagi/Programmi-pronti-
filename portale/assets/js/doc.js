// Visualizzatore documentazione: scarica un file Markdown (guida/README) dal
// portale e lo mostra formattato. Renderer Markdown minimale, zero dipendenze.

// --- Markdown -> HTML (sottoinsieme: titoli, liste, codice, grassetto,
//     corsivo, link, citazioni, righe orizzontali). L'HTML della sorgente
//     viene sempre neutralizzato prima di applicare la formattazione. ---
function mdToHtml(src) {
  const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function inline(s) {
    const codes = [];
    // Estrae il codice inline in un segnaposto (@@CODEn@@, che nel testo non
    // compare mai) così gli altri passaggi non lo toccano; poi lo reinserisce.
    s = escHtml(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '@@CODE' + (codes.length - 1) + '@@'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
         .replace(/\*([^*]+)\*/g, '<em>$1</em>')
         .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
           const href = u.replace(/"/g, '&quot;');
           const ext = /^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : '';
           return `<a href="${href}"${ext}>${t}</a>`;
         });
    return s.replace(/@@CODE(\d+)@@/g, (_, i) => `<code>${codes[+i]}</code>`);
  }

  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let html = '', inCode = false, codeBuf = [], listType = null;
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (!inCode) { inCode = true; codeBuf = []; closeList(); }
      else { inCode = false; html += `<pre><code>${escHtml(codeBuf.join('\n'))}</code></pre>`; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\s*$/.test(line)) { closeList(); continue; }
    if (/^\s*---+\s*$/.test(line)) { closeList(); html += '<hr>'; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }

    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) { closeList(); html += `<blockquote>${inline(bq[1])}</blockquote>`; continue; }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) { if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; } html += `<li>${inline(ol[1])}</li>`; continue; }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) { if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; } html += `<li>${inline(ul[1])}</li>`; continue; }

    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  if (inCode) html += `<pre><code>${escHtml(codeBuf.join('\n'))}</code></pre>`;
  return html;
}

const DOCS = {
  guida:  { file: 'guida',  titolo: 'Guida d’uso' },
  readme: { file: 'readme', titolo: 'README tecnico' },
};

async function load() {
  const which = (new URLSearchParams(location.search).get('f') || 'guida').toLowerCase();
  const key = DOCS[which] ? which : 'guida';
  const doc = DOCS[key];
  document.title = doc.titolo + ' — Portale Suite Cosedil';

  // Evidenzia la scheda attiva.
  document.querySelectorAll('.doc-tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === key);
  });

  const el = document.getElementById('doc');
  try {
    const r = await fetch('/docs/' + doc.file);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    el.innerHTML = mdToHtml(await r.text());
  } catch (e) {
    el.innerHTML = '<p>Impossibile caricare il documento. Riprova più tardi.</p>';
  }
}

load();
