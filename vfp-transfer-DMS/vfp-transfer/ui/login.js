// "><(((º> sabusabu <º)))><"
// Pagina di accesso all'interfaccia trasferimento VFP.
'use strict';

const form = document.getElementById('loginForm');
const err = document.getElementById('loginError');
const btn = document.getElementById('loginBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) {
    err.textContent = 'Inserisci nome utente e password.';
    err.hidden = false;
    return;
  }
  btn.disabled = true;
  btn.classList.add('is-loading');
  err.hidden = true;
  try {
    const res = await fetch('/api/session/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VFP-UI': '1' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
    window.location.replace('/');
  } catch (ex) {
    err.textContent = ex.message === 'Failed to fetch' ? 'Il programma non risponde.' : ex.message;
    err.hidden = false;
    form.password.value = '';
    form.password.focus();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
});
