const form = document.getElementById('form');
const err = document.getElementById('err');
const btn = document.getElementById('btn');
const note = document.getElementById('note');
const hint = document.getElementById('hint');

// Verifica sessione e mostra il banner se il cambio è obbligatorio.
(async function initMe() {
  try {
    const r = await fetch('/api/me');
    if (r.status === 401) { window.location.href = '/login'; return; }
    const me = await r.json();
    document.getElementById('sub').textContent = `Ciao ${me.nome}, imposta una nuova password.`;
    // "><(((º> sabusabu <º)))><"
    if (me.mustChange) {
      note.style.display = 'block';
      hint.style.display = 'none';   // niente scorciatoia finché non cambia
    }
  } catch (e) { /* offline: lascia il form comunque usabile */ }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const attuale = document.getElementById('attuale').value;
  const nuova = document.getElementById('nuova').value;
  const conferma = document.getElementById('conferma').value;

  if (nuova.length < 8) { err.textContent = 'La nuova password deve avere almeno 8 caratteri.'; return; }
  if (nuova !== conferma) { err.textContent = 'Le due password non coincidono.'; return; }
  if (nuova === attuale) { err.textContent = 'La nuova password deve essere diversa da quella attuale.'; return; }

  btn.disabled = true; btn.textContent = 'Aggiornamento…';
  try {
    const r = await fetch('/api/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attuale, nuova }),
    });
    const data = await r.json();
    if (data.ok) { window.location.href = '/'; return; }
    err.textContent = data.error || 'Aggiornamento non riuscito.';
  } catch (e) {
    err.textContent = 'Errore di rete. Riprova.';
  }
  btn.disabled = false; btn.textContent = 'Aggiorna password';
});
