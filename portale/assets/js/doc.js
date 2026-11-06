// "><(((º> sabusabu <º)))><"
// Visualizzatore della documentazione (/doc): scarica dal portale un file Markdown e lo mostra
// formattato. Renderer minimale, zero dipendenze, l'HTML della sorgente è sempre neutralizzato.
//
// Documenti (parametro ?f=):
//   guida               indice della guida utente con le immagini (docs/guida/README.md)
//   guida/NN-nome.md    un capitolo della guida (i link fra capitoli restano dentro /doc)
//   readme              README tecnico del portale
// Il server li dà da /docs/<f> (fileDocumentazione in server.js); le immagini della guida
// da /docs/guida/img/<file>. Fino al 06/11/2026 "guida" era il vecchio guida.md, superato.

// --- Markdown -> HTML (sottoinsieme: titoli con ancora, paragrafi su più righe, liste con
//     righe di continuazione, tabelle, codice, grassetto, corsivo, link, immagini, citazioni,
//     righe orizzontali; i commenti HTML, come la firma in cima ai file, spariscono). ---

// Ancora di un titolo come la calcola GitHub: minuscole, via la punteggiatura, spazi → "-".
// Serve ai link dei capitoli del tipo 01-entrare.md#18-una-password-per-tutti-i-programmi.
function ancora(testo) {
  return testo.toLowerCase()
    .replace(/[*`_]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

// Dove punta un link relativo scritto nel Markdown, visto da /doc. null = fuori dalla
// documentazione servita (per esempio la guida di un altro programma, ../../../incampo/...):
// lì si mostra solo il testo, così non ci sono link rotti.
function risolvi(u, inGuida) {
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (u.startsWith('#')) return u;
  const [percorso, frammento] = u.split('#');
  const hash = frammento ? '#' + frammento : '';
  // dal README tecnico la guida si chiama docs/guida/...
  const rel = inGuida ? percorso : percorso.replace(/^(\.\/)?docs\/guida\//, '');
  if (!inGuida && rel === percorso) return null;
  if (/^README\.md$/i.test(rel)) return '/doc?f=guida' + hash;
  if (/^\d{2}-[a-z0-9-]+\.md$/i.test(rel)) return '/doc?f=guida/' + rel + hash;
  if (/^img\/[A-Za-z0-9._-]+$/.test(rel)) return '/docs/guida/' + rel;
  return null;
}

function mdToHtml(src, inGuida) {
  const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function inline(s) {
    const codes = [];
    // Estrae il codice inline in un segnaposto (@@CODEn@@, che nel testo non
    // compare mai) così gli altri passaggi non lo toccano; poi lo reinserisce.
    s = escHtml(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '@@CODE' + (codes.length - 1) + '@@'; });
    // immagini prima dei link: ![alt](img/x.png) ha la stessa forma con il "!" davanti
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, u) => {
      const href = risolvi(u, inGuida);
      return href ? `<img src="${href.replace(/"/g, '&quot;')}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy">` : alt;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
         .replace(/\*([^*]+)\*/g, '<em>$1</em>')
         .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
           const href = risolvi(u, inGuida);
           if (!href) return t;
           const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '';
           return `<a href="${href.replace(/"/g, '&quot;')}"${ext}>${t}</a>`;
         });
    return s.replace(/@@CODE(\d+)@@/g, (_, i) => `<code>${codes[+i]}</code>`);
  }

  const celle = (riga) => riga.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const lines = src.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let html = '', inCode = false, codeBuf = [], listType = null, para = [], tab = [];
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  // righe consecutive di testo = un solo paragrafo (la guida va a capo a ~110 caratteri)
  const closePara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const closeTab = () => {
    if (!tab.length) return;
    const sep = tab.length > 1 && /^\|?\s*:?-{2,}/.test(tab[1].trim());
    const testa = sep ? `<thead><tr>${celle(tab[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : '';
    const corpo = (sep ? tab.slice(2) : tab)
      .map((r) => `<tr>${celle(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
    html += `<div class="tab-wrap"><table>${testa}<tbody>${corpo}</tbody></table></div>`;
    tab = [];
  };
  const closeAll = () => { closePara(); closeList(); closeTab(); };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (!inCode) { inCode = true; codeBuf = []; closeAll(); }
      else { inCode = false; html += `<pre><code>${escHtml(codeBuf.join('\n'))}</code></pre>`; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\s*\|/.test(line)) { closePara(); closeList(); tab.push(line); continue; }
    closeTab();
    if (/^\s*$/.test(line)) { closePara(); closeList(); continue; }
    if (/^\s*---+\s*$/.test(line)) { closeAll(); html += '<hr>'; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeAll();
      html += `<h${h[1].length} id="${ancora(h[2])}">${inline(h[2])}</h${h[1].length}>`;
      continue;
    }

    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) { closeAll(); html += `<blockquote>${inline(bq[1])}</blockquote>`; continue; }

    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) { closePara(); if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; } html += `<li>${inline(ol[1])}</li>`; continue; }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) { closePara(); if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; } html += `<li>${inline(ul[1])}</li>`; continue; }

    // riga rientrata subito dopo una voce di elenco: continua quella voce
    if (listType && /^\s{2,}\S/.test(line)) { html = html.replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>'); continue; }

    closeList();
    para.push(line.trim());
  }
  closeAll();
  if (inCode) html += `<pre><code>${escHtml(codeBuf.join('\n'))}</code></pre>`;
  return html;
}

// Quale documento chiede la pagina: la guida (indice o un capitolo) oppure il README.
function documento() {
  const f = (new URLSearchParams(location.search).get('f') || 'guida');
  if (/^readme$/i.test(f)) return { file: 'readme', titolo: 'README tecnico', tab: 'readme', inGuida: false };
  const cap = /^guida\/(\d{2}-[a-z0-9-]+\.md)$/i.exec(f);
  return { file: cap ? 'guida/' + cap[1] : 'guida', titolo: 'Guida d’uso', tab: 'guida', inGuida: true };
}

async function load() {
  const doc = documento();
  document.title = doc.titolo + ' — Portale Suite Cosedil';

  // Evidenzia la scheda attiva.
  document.querySelectorAll('.doc-tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === doc.tab);
  });

  const el = document.getElementById('doc');
  try {
    const r = await fetch('/docs/' + doc.file);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    el.innerHTML = mdToHtml(await r.text(), doc.inGuida);
    // il titolo del capitolo nella scheda del browser
    const h1 = el.querySelector('h1');
    if (h1) document.title = h1.textContent + ' — Portale Suite Cosedil';
    // link a un paragrafo (#18-...): l'ancora esiste solo ora che il testo è in pagina
    if (location.hash) {
      const dest = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (dest) dest.scrollIntoView();
    }
  } catch (e) {
    el.innerHTML = '<p>Impossibile caricare il documento. Riprova più tardi.</p>';
  }
}

load();
