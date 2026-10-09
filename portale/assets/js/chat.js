// Assistente della suite: widget in basso a destra.
// Caricato DOPO index.js, di cui riusa la variabile globale `apps` e le card
// già in pagina. Le risposte arrivano da POST /api/chat: qui non c'è nessuna
// conoscenza sulle app, così i non-admin non leggono nel sorgente quello che
// il server non vorrebbe dirgli.

const CHAT_ICON = '<svg class="icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>';
const CHAT_CLOSE = '<svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';

const SUGGERIMENTI = [
  'Quali app ci sono?',
  'Cosa fa l\'OCR?',
  'Quale app per i PDF scansionati?',
  'Come si avvia il DDT?',
];

let chatLog, chatPanel, chatFab, chatInput;

function chatMostraMsg(testo, chi) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + chi;
  div.textContent = testo;          // textContent: niente HTML dalle risposte
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

// Pulsanti agganciati a una risposta. Non rifanno l'avvio: girano il click alla
// card corrispondente, così la logica di avvio resta una sola (quella di index.js)
// e lo stato mostrato è sempre quello vero della card.
function chatMostraAzioni(ids) {
  const validi = (ids || []).filter((id) => document.querySelector(`.card[data-id="${id}"]`));
  if (!validi.length) return;
  const box = document.createElement('div');
  box.className = 'chat-azioni';
  for (const id of validi) {
    const app = apps.find((a) => a.id === id);
    if (!app) continue;
    const card = document.querySelector(`.card[data-id="${id}"]`);

    const avvia = document.createElement('button');
    avvia.className = 'chat-azione';
    avvia.textContent = validi.length > 1 ? `Avvia ${app.nome}` : 'Avvia';
    avvia.addEventListener('click', () => {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.querySelector('[data-launch]').click();
    });
    box.appendChild(avvia);

    const apri = document.createElement('button');
    apri.className = 'chat-azione';
    apri.textContent = validi.length > 1 ? `Apri ${app.nome}` : 'Apri';
    apri.addEventListener('click', () => {
      const link = card.querySelector('[data-open]');
      // Card "Spento": il link è disabilitato e un click non farebbe nulla.
      // Meglio dirlo che lasciare un pulsante morto.
      if (link.classList.contains('disabled')) {
        toast(app.nome + ' è spento: premi "Avvia".');
        return;
      }
      link.click();
    });
    box.appendChild(apri);
  }
  chatLog.appendChild(box);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function chatMostraChips() {
  const box = document.createElement('div');
  box.className = 'chat-chips';
  for (const s of SUGGERIMENTI) {
    const b = document.createElement('button');
    b.className = 'chat-chip';
    b.textContent = s;
    b.addEventListener('click', () => { box.remove(); chatChiedi(s); });
    box.appendChild(b);
  }
  chatLog.appendChild(box);
}

let chatInCorso = false;
async function chatChiedi(domanda) {
  const q = String(domanda || '').trim();
  if (!q || chatInCorso) return;
  chatInCorso = true;
  chatMostraMsg(q, 'io');
  chatInput.value = '';
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domanda: q }),
    });
    if (r.status === 401) { window.location.href = '/login'; return; }
    const data = await r.json();
    chatMostraMsg(data.risposta, 'bot');
    chatMostraAzioni(data.apps);
  } catch {
    chatMostraMsg('Non riesco a rispondere: il portale non risponde. Riprova tra poco.', 'bot');
  } finally {
    chatInCorso = false;
  }
}

function chatApri(apri) {
  chatPanel.classList.toggle('aperto', apri);
  chatFab.classList.toggle('aperto', apri);
  chatFab.setAttribute('aria-expanded', String(apri));
  if (apri) chatInput.focus();
}

function chatInit() {
  const fab = document.createElement('button');
  fab.className = 'chat-fab';
  fab.id = 'chatFab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Assistente della suite');
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'chatPanel');
  fab.innerHTML = CHAT_ICON + CHAT_CLOSE;

  const panel = document.createElement('section');
  panel.className = 'chat-panel';
  panel.id = 'chatPanel';
  panel.setAttribute('aria-label', 'Assistente della suite');
  panel.innerHTML = `
    <div class="chat-head">
      <h2>Assistente della suite</h2>
      <p>Rispondo solo sulle app e su cosa fanno</p>
    </div>
    <div class="chat-log" id="chatLog"></div>
    <form class="chat-form" id="chatForm">
      <input class="chat-input" id="chatInput" type="text" autocomplete="off"
             placeholder="Chiedi qualcosa sulle app…" aria-label="La tua domanda" maxlength="500" />
      <button class="chat-send" type="submit" aria-label="Invia">${SEND_ICON}</button>
    </form>`;

  document.body.append(fab, panel);

  chatFab = fab;
  chatPanel = panel;
  chatLog = document.getElementById('chatLog');
  chatInput = document.getElementById('chatInput');

  chatMostraMsg('Ciao. Ti dico cosa fanno le app della suite e quale usare. Su altro non so rispondere.', 'bot');
  chatMostraChips();

  fab.addEventListener('click', () => chatApri(!chatPanel.classList.contains('aperto')));
  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    chatChiedi(chatInput.value);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && chatPanel.classList.contains('aperto')) chatApri(false);
  });
}

chatInit();
