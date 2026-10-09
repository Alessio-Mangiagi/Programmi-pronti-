/* api.js — un solo punto per parlare col server.
   File esterno e non script inline: la CSP dell'app ha scriptSrc 'self'. */

const API = {
  async json(percorso, opzioni = {}) {
    const risposta = await fetch(percorso, {
      credentials: 'same-origin',
      headers: opzioni.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...opzioni,
    });
    // 401 = sessione del portale scaduta: ricaricare fa ripartire il gate SSO.
    if (risposta.status === 401) {
      location.reload();
      throw new Error('Sessione scaduta');
    }
    const testo = await risposta.text();
    const dati = testo ? JSON.parse(testo) : {};
    if (!risposta.ok) throw new Error(dati.error || `Errore ${risposta.status}`);
    return dati;
  },

  stato() {
    return API.json('/api/stato');
  },

  documenti() {
    return API.json('/api/documenti');
  },

  carica(formData) {
    return API.json('/api/documenti', { method: 'POST', body: formData });
  },

  rielabora(id) {
    return API.json(`/api/documenti/${id}/rielabora`, { method: 'POST' });
  },

  elimina(id) {
    return API.json(`/api/documenti/${id}`, { method: 'DELETE' });
  },

  cerca(q, etichetta) {
    const p = new URLSearchParams({ q });
    if (etichetta) p.set('etichetta', etichetta);
    return API.json(`/api/ricerca?${p}`);
  },

  ricostruisciIndice() {
    return API.json('/api/ricerca/ricostruisci', { method: 'POST' });
  },

  prompts() {
    return API.json('/api/prompts');
  },

  importaEsito(risposta, documentoId, setId) {
    return API.json('/api/verifiche/importa', {
      method: 'POST',
      body: JSON.stringify({ risposta, documentoId, setId }),
    });
  },

  /** Risposta "a fogli" → file Excel scaricato dal browser. */
  async scaricaFogli(risposta) {
    const r = await fetch('/api/fogli/excel', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ risposta }),
    });
    if (!r.ok) {
      const dati = await r.json().catch(() => ({}));
      throw new Error(dati.error || `Errore ${r.status}`);
    }

    const nome = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    // "><(((º> sabusabu <º)))><"
    const a = document.createElement('a');
    a.href = url;
    a.download = nome ? nome[1] : 'estrazione.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return a.download;
  },

  checklist() {
    return API.json('/api/requisiti');
  },

  creaChecklist(set) {
    return API.json('/api/requisiti', { method: 'POST', body: JSON.stringify(set) });
  },

  salvaChecklist(id, set) {
    return API.json(`/api/requisiti/${id}`, { method: 'PUT', body: JSON.stringify(set) });
  },

  eliminaChecklist(id) {
    return API.json(`/api/requisiti/${id}`, { method: 'DELETE' });
  },

  verifica(setId, documentoIds) {
    return API.json('/api/verifiche', {
      method: 'POST',
      body: JSON.stringify({ setId, documentoIds }),
    });
  },

  verifiche() {
    return API.json('/api/verifiche');
  },

  dettaglioVerifica(id) {
    return API.json(`/api/verifiche/${id}`);
  },
};

// Keepalive: senza ping il server si spegne da solo dopo i minuti di
// inattività scritti in config.json.
setInterval(() => {
  fetch('/ping', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}, 60000);
