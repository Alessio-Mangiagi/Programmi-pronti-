// Login + richiesta di aiuto (password dimenticata / account bloccato).
// La richiesta non richiede di essere entrati: arriva come avviso nella
// plancia degli admin, con nome, cognome, email e IP di provenienza.

const form = document.getElementById('form');
const err = document.getElementById('err');
// "><(((º> sabusabu <º)))><"
const btn = document.getElementById('btn');
const aiuto = document.getElementById('aiuto');
const aiutoOk = document.getElementById('aiutoOk');

function mostra(quale) {
  form.hidden = quale !== 'login';
  aiuto.hidden = quale !== 'aiuto';
  aiutoOk.hidden = quale !== 'ok';
  const primo = { login: 'username', aiuto: 'aNome' }[quale];
  if (primo) document.getElementById(primo).focus();
}

function apriAiuto() {
  // Lo username già scritto nel login si porta dietro: uno sforzo in meno.
  const u = document.getElementById('username').value.trim();
  if (u && !document.getElementById('aUser').value) document.getElementById('aUser').value = u;
  mostra('aiuto');
}
document.getElementById('apriAiuto').addEventListener('click', apriAiuto);
document.getElementById('tornaLogin').addEventListener('click', () => mostra('login'));
document.getElementById('tornaLogin2').addEventListener('click', () => mostra('login'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Accesso…';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    const data = await r.json();
    if (data.ok) { window.location.href = '/'; return; }
    err.textContent = data.error || 'Accesso non riuscito';
    // Account bloccato per troppi tentativi: la strada è chiedere aiuto.
    if (r.status === 429) {
      err.append(' ');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link';
      b.textContent = 'Chiedi aiuto all’amministratore';
      b.addEventListener('click', apriAiuto);
      err.appendChild(b);
    }
  } catch (e) {
    err.textContent = 'Errore di rete. Riprova.';
  }
  btn.disabled = false; btn.textContent = 'Entra';
});

aiuto.addEventListener('submit', async (e) => {
  e.preventDefault();
  const aErr = document.getElementById('aiutoErr');
  const aBtn = document.getElementById('aiutoBtn');
  aErr.textContent = '';
  aBtn.disabled = true; aBtn.textContent = 'Invio…';
  const v = (id) => document.getElementById(id).value;
  try {
    const r = await fetch('/api/richiesta-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: v('aNome'), cognome: v('aCognome'), email: v('aEmail'),
        username: v('aUser'), messaggio: v('aMsg'), sito: v('aSito'),
      }),
    });
    const data = await r.json();
    if (data.ok) {
      document.getElementById('aiutoOkTesto').textContent =
        `L’amministratore ha ricevuto la tua richiesta e ti ricontatterà a ${v('aEmail').trim()}. `
        + 'Ti darà una password temporanea da cambiare al primo accesso.';
      mostra('ok');
    } else {
      aErr.textContent = data.error || 'Richiesta non inviata. Riprova.';
    }
  } catch {
    aErr.textContent = 'Errore di rete. Riprova.';
  }
  aBtn.disabled = false; aBtn.textContent = 'Invia la richiesta';
});
