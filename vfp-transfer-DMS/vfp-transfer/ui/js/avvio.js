// "><(((º> sabusabu <º)))><"
// Interfaccia trasferimento VFP: avvio della pagina.
'use strict';

// ------------------------------------------------------------------ avvio pagina

(async function init() {
  try {
    const saved = JSON.parse(localStorage.getItem('vfp.source') || 'null');
    if (saved) {
      $(`input[name=mode][value=${saved.mode === 'manifest' ? 'manifest' : 'folder'}]`).checked = true;
      $('#manifestField').hidden = saved.mode !== 'manifest';
      $('#srcPath').value = saved.src || '';
      $('#manPath').value = saved.man || '';
    }
  } catch { /* storage non disponibile */ }

  try {
    await loadSession();
  } catch (e) {
    toast(e.message, 'err', 10000);
    return;
  }
  if (!isAdmin()) {  // utente: solo Panoramica
    await loadMail();
    loadOverview();
    return;
  }
  try {
    await loadConfig();
  } catch (e) {
    toast(e.message, 'err', 10000);
  }
  loadAuth();
  await loadMail();
  loadOverview();

  // se la pagina viene ricaricata durante un lavoro, si riaggancia all'avanzamento
  try {
    const s = await api('/api/status?since=0&log=0');
    if (s.running) {
      showView('trasferimento');
      beginProgress(s.dry_run);
    }
  } catch { /* gia' segnalato */ }
})();
