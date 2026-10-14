// "><(((º> sabusabu <º)))><"
// Password dimenticata: se l'indirizzo dell'amministratore è configurato, la
// frase diventa un link che apre la posta. /api/contatti risponde anche senza login.
fetch('/api/contatti').then((r) => r.json()).then(({ emailAdmin }) => {
  if (!emailAdmin) return;
  const p = document.getElementById('dimenticata');
  const a = document.createElement('a');
  a.href = `mailto:${emailAdmin}?subject=${encodeURIComponent('Portale Suite Cosedil — credenziali')}`;
  a.textContent = 'Scrivi all’amministratore';
  p.textContent = 'Password dimenticata o account bloccato? ';
  p.appendChild(a);
}).catch(() => { /* resta la frase generica */ });

const form = document.getElementById('form');
const err = document.getElementById('err');
// "><(((º> sabusabu <º)))><"
const btn = document.getElementById('btn');
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
  } catch (e) {
    err.textContent = 'Errore di rete. Riprova.';
  }
  btn.disabled = false; btn.textContent = 'Entra';
});
