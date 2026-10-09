const form = document.getElementById('form');
const err = document.getElementById('err');
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
