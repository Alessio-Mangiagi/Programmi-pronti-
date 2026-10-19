// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: accesso a Viewpoint.
'use strict';

// ------------------------------------------------------------------ accesso Viewpoint

async function loadAuth() {
  let a;
  try { a = await api('/api/auth'); } catch { return; }
  const pill = $('#authPill');
  const st = $('#authState');
  pill.className = 'auth-pill';
  st.className = 'auth-state';
  let label, detail, cls;
  if (a.login_running) {
    cls = 'busy'; label = 'Accesso in corso…';
    detail = 'Completa il login nella scheda del browser che si è aperta.';
  } else if (a.logged_in) {
    const exp = a.expires_at ? new Date(a.expires_at * 1000) : null;
    const valid = exp && exp > new Date();
    cls = valid || a.has_refresh ? 'ok' : 'warn';
    label = cls === 'ok' ? 'Collegato a Viewpoint' : 'Sessione scaduta';
    detail = valid
      ? `Sessione valida fino alle ${exp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}${a.has_refresh ? ', rinnovo automatico attivo' : ''}.`
      : a.has_refresh ? 'La sessione verrà rinnovata in automatico al prossimo trasferimento.' : 'Serve un nuovo accesso.';
  } else {
    cls = 'warn'; label = 'Non collegato';
    detail = 'L\'accesso verrà chiesto al primo trasferimento, oppure puoi farlo ora.';
  }
  if (a.login_error) detail = `Ultimo tentativo non riuscito: ${a.login_error}`;
  if (a.mail_login_needed && !a.login_running) {
    cls = 'warn'; label = 'Accesso necessario';
    detail = 'La posta automatica è ferma: l’accesso a Viewpoint è scaduto. Premi "Accedi a Viewpoint".';
  }
  pill.classList.add(cls);
  st.classList.add(cls);
  $('.auth-label', pill).textContent = label;
  st.textContent = label;
  $('#authDetail').textContent = detail;
  $('#btnLogin').disabled = a.login_running;
  // in Panoramica: se manca l'accesso, avviso con il pulsante (prima era solo la pillola in fondo alla barra)
  $('#ovLoginBanner').hidden = cls === 'ok' || cls === 'busy';
  $('#ovLoginText').textContent = a.mail_login_needed ? 'La posta automatica è ferma finché non rifai l’accesso.' : detail;
  $('#ovLoginTitle').textContent = a.mail_login_needed ? 'Accesso a Viewpoint scaduto.' : `${label}.`;
  $('#stDone').textContent = fmtNum(a.state.completati);
  $('#stPending').textContent = fmtNum(a.state.in_sospeso);

  clearTimeout(state.authTimer);
  state.authTimer = setTimeout(loadAuth, a.login_running ? 2000 : 30000);
}

$('#btnLogin').addEventListener('click', async () => {
  if (state.dirty) { toast('Salva prima le impostazioni.', 'err'); return; }
  try {
    await api('/api/login', { method: 'POST' });
    toast('Si apre il browser per l\'accesso a Viewpoint.');
    setTimeout(loadAuth, 400);
  } catch (e) { toast(e.message, 'err'); }
});

$('#ovLoginBtn').addEventListener('click', () => $('#btnLogin').click());

$('#btnLogout').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
    toast('Disconnesso da Viewpoint.', 'ok');
    loadAuth();
  } catch (e) { toast(e.message, 'err'); }
});

$('#btnResetState').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Azzerare la ripresa?',
    html: '<p>Il programma dimenticherà quali file ha già caricato: al prossimo avvio li <strong>ricaricherà tutti</strong> come nuove revisioni.</p><p>Viene conservata una copia di sicurezza del file di stato.</p>',
    okText: 'Azzera',
  });
  if (!ok) return;
  try {
    await api('/api/state/reset', { method: 'POST' });
    toast('Ripresa azzerata.', 'ok');
    loadAuth();
    invalidatePreview();
  } catch (e) { toast(e.message, 'err'); }
});
