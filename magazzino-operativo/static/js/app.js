// "><(((º> sabusabu <º)))><"
// Magazzino Operativo — pagina unica senza build: hash routing, fetch alle API.
'use strict';

(function () {
  // ------------------------------------------------------------------ utilità
  const $ = (sel, el) => (el || document).querySelector(sel);
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => (n == null ? '' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 3 }));
  const fmtData = (iso) => {
    if (!iso) return '';
    const d = new Date(iso.includes('T') || iso.includes(' ') ? iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z') : iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return iso.length > 10 ? d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : d.toLocaleDateString('it-IT');
  };
  let me = { admin: false, qr: false };
  let ubicazioniCache = null;

  async function api(url, opt) {
    const o = Object.assign({ headers: {} }, opt || {});
    if (o.body && !(o.body instanceof FormData)) {
      o.headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(o.body);
    }
    const r = await fetch(url, o);
    let dati = null;
    try { dati = await r.json(); } catch (_) { /* risposta vuota */ }
    if (!r.ok) {
      const e = new Error((dati && dati.errore) || `Errore ${r.status}`);
      e.status = r.status; e.dati = dati;
      throw e;
    }
    return dati;
  }

  function toast(msg, tipo) {
    const el = document.createElement('div');
    el.className = 'toast' + (tipo ? ' toast-' + tipo : '');
    el.textContent = msg;
    $('#toast').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function modale(titolo, html, dopo) {
    $('#modale-titolo').textContent = titolo;
    $('#modale-corpo').innerHTML = html;
    $('#modale').hidden = false;
    if (dopo) dopo($('#modale-corpo'));
    const primo = $('#modale-corpo input, #modale-corpo select');
    if (primo) primo.focus();
  }
  function chiudiModale() { $('#modale').hidden = true; $('#modale-corpo').innerHTML = ''; }
  $('#modale-chiudi').onclick = chiudiModale;
  $('#modale').addEventListener('click', (e) => { if (e.target === $('#modale')) chiudiModale(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modale').hidden) chiudiModale(); });

  async function ubicazioni(forza) {
    if (!ubicazioniCache || forza) ubicazioniCache = await api('/api/ubicazioni');
    return ubicazioniCache;
  }
  const opzioniUbicazioni = (lista, sel, vuoto) =>
    (vuoto ? `<option value="">${h(vuoto)}</option>` : '') +
    lista.map((u) => `<option value="${u.id}" ${u.id == sel ? 'selected' : ''}>${h(u.nome)}</option>`).join('');

  const campo = (label, inner, cls) => `<div class="campo ${cls || ''}"><label>${h(label)}</label>${inner}</div>`;
  const input = (nome, val, attr) => `<input name="${nome}" value="${h(val == null ? '' : val)}" ${attr || ''}>`;
  const select = (nome, opzioni, sel) => `<select name="${nome}">${opzioni.map(([v, t]) => `<option value="${v}" ${v == sel ? 'selected' : ''}>${h(t)}</option>`).join('')}</select>`;

  function datiForm(form) {
    const d = {};
    new FormData(form).forEach((v, k) => { d[k] = typeof v === 'string' ? v.trim() : v; });
    return d;
  }

  const badgeStato = (s) => {
    const m = { disponibile: ['verde', 'Disponibile'], in_uso: ['blu', 'In uso'], manutenzione: ['ambra', 'Manutenzione'], fermo: ['rosso', 'Fermo'], restituito: ['', 'Restituito'] };
    const [c, t] = m[s] || ['', s];
    return `<span class="badge ${c ? 'badge-' + c : ''}">${h(t)}</span>`;
  };
  const badgeTipoMov = (t) => {
    const m = { carico: 'verde', scarico: 'rosso', trasferimento: 'blu', rettifica: 'ambra', inventario: 'ambra' };
    return `<span class="badge badge-${m[t] || ''}">${h(t)}</span>`;
  };
  const badgeOrigine = (o) => `<span class="badge">${h({ ddt: 'DDT', vfp: 'VFP', scansione: 'scansione', manuale: 'manuale' }[o] || o)}</span>`;
  // Google Maps: coordinate se ci sono, altrimenti l'indirizzo; niente -> nessun link.
  const urlMappa = (u, indicazioni) => {
    if (!u) return null;
    const q = u.lat != null && u.lng != null && u.lat !== '' ? `${u.lat},${u.lng}` : (u.indirizzo || '').trim();
    if (!q) return null;
    return indicazioni ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  };
  const btnMappa = (u, cls) => { const url = urlMappa(u); return url ? `<a class="btn btn-sec ${cls || 'btn-piccolo'}" href="${h(url)}" target="_blank" rel="noopener" title="Apri su Google Maps">${ICONE_MAPPA} Mappa</a>` : `<span class="muto" title="Aggiungi indirizzo o coordinate all'ubicazione">senza indirizzo</span>`; };
  const ICONE_FOTO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const ICONE_MAPPA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const ETICH_TIPO_UBI = { deposito: 'Deposito', cantiere: 'Cantiere', officina: 'Officina', fornitore: 'Fornitore', altro: 'Altro' };

  const ICONE = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
    scan: '<svg viewBox="0 0 24 24"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M11 8v8M14 8v8M17 8v8"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/></svg>',
    lista: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M1 6h13v10H1zM14 10h5l4 4v2h-9z"/><circle cx="5" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    swap: '<svg viewBox="0 0 24 24"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>',
    flow: '<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6M20 15v-9"/></svg>',
    import: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
    utenti: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3"/></svg>',
    vuoto: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    cerca: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    operatore: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    altro: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    freccia: '<svg class="freccia" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  };
  // Sotto i 768 px la pagina lavora in modalità telefono: barra tab in basso, menu a scorrimento, tabelle a schede.
  const MOBILE = window.matchMedia('(max-width: 768px)');
  const vuoto = (msg) => `<div class="vuoto">${ICONE.vuoto}<div>${h(msg)}</div></div>`;
  const skeleton = (n) => `<div class="card">${'<div class="skeleton"></div>'.repeat(n || 5)}</div>`;

  // ------------------------------------------------------------------ navigazione
  const VISTE = [
    ['operatore', 'Operatore', 'operatore'], ['dashboard', 'Riepilogo', 'home'], ['scansione', 'Scansione', 'scan'], ['cerca', 'Cerca', 'cerca'], ['giacenze', 'Giacenze', 'box'],
    ['movimenti', 'Movimenti', 'swap'], ['flussi', 'Flussi', 'flow'], ['sez', 'Anagrafiche'], ['articoli', 'Articoli', 'lista'], ['mezzi', 'Mezzi', 'truck'],
    ['ubicazioni', 'Ubicazioni', 'pin'], ['sez', 'Strumenti'], ['importazioni', 'Importazioni', 'import'], ['etichette', 'Etichette', 'tag'], ['amministrazione', 'Amministrazione', 'utenti', 'admin'],
  ];
  function disegnaSidebar(attiva) {
    $('#sidebar').innerHTML = '<div class="sidebar-brand"><strong>Cosedil S.p.A.</strong><span>Costruiamo il tuo domani</span></div>' + VISTE.filter(([, , , solo]) => !solo || me.admin).map(([id, nome, icona]) =>
      id === 'sez' ? `<div class="sezione">${nome}</div>` :
        `<a href="#${id}" class="${id === attiva ? 'attiva' : ''}" title="${nome}">${ICONE[icona]}<span>${nome}</span></a>`).join('') + '<div class="sidebar-piede">Suite Cosedil · Magazzino Operativo</div>';
  }
  const apriMenu = (aperto) => { $('#sidebar').classList.toggle('aperta', aperto); document.body.classList.toggle('menu-aperto', aperto); };
  $('#btn-menu').onclick = () => apriMenu(!$('#sidebar').classList.contains('aperta'));
  $('#sidebar').addEventListener('click', () => apriMenu(false));
  $('#sidebar-velo').onclick = () => apriMenu(false);
  // Cambio di fascia (rotazione, finestra ridimensionata): il menu aperto si richiude.
  MOBILE.addEventListener('change', () => apriMenu(false));
  window.matchMedia('(max-width: 1024px)').addEventListener('change', () => apriMenu(false));
  const TAB = [['operatore', 'Inizio', 'operatore'], ['cerca', 'Cerca', 'cerca'], ['scansione', 'Scansiona', 'scan', true], ['mezzi', 'Mezzi', 'truck']];
  function disegnaTabbar(attiva) {
    $('#tabbar').innerHTML = TAB.map(([id, nome, icona, grande]) => `<a href="#${id}${grande ? '/camera' : ''}" class="${id === attiva ? 'attiva' : ''}">${grande ? `<span class="cerchio">${ICONE[icona]}</span>` : ICONE[icona]}<span>${nome}</span></a>`).join('')
      + `<button type="button" id="tab-altro" class="${TAB.some(([id]) => id === attiva) ? '' : 'attiva'}">${ICONE.altro}<span>Altro</span></button>`;
    $('#tab-altro').onclick = () => apriMenu(true);
  }

  async function naviga() {
    const [vista, arg] = location.hash.replace('#', '').split('/');
    const nome = vista || (MOBILE.matches ? 'operatore' : 'dashboard');
    disegnaSidebar(nome);
    disegnaTabbar(nome);
    apriMenu(false);
    const fn = viste[nome] || viste.dashboard;
    const cont = $('#contenuto');
    cont.innerHTML = skeleton(6);
    try {
      await fn(cont, arg);
      adattaTabelle(cont);
      cont.classList.remove('reveal'); void cont.offsetWidth; cont.classList.add('reveal');
    } catch (e) {
      cont.innerHTML = `<div class="avviso avviso-errore">${h(e.message)}</div>`;
    }
  }
  window.addEventListener('hashchange', naviga);

  // Presenza: dice al server che la pagina è aperta e su quale vista (per gli admin).
  const battito = () => { fetch('/api/presenza', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vista: (location.hash.replace('#', '').split('/')[0] || 'dashboard') }) }).catch(() => {}); };
  setInterval(battito, 30000);
  window.addEventListener('hashchange', battito);

  const viste = {};

  // ------------------------------------------------------------------ riepilogo
  viste.dashboard = async (cont) => {
    const d = await api('/api/dashboard');
    cont.innerHTML = `
      <div class="vista-testa"><div><div class="sopratitolo">Magazzino operativo</div><h2>Riepilogo</h2></div>
        <div class="azioni"><a class="btn" href="#scansione">${ICONE.scan} Scansiona</a></div></div>
      <div class="griglia griglia-4">
        <div class="card kpi"><div class="etichetta">Articoli</div><div class="valore">${d.articoli}</div></div>
        <div class="card kpi"><div class="etichetta">Mezzi attivi</div><div class="valore">${d.mezzi}</div></div>
        <div class="card kpi"><div class="etichetta">Ubicazioni</div><div class="valore">${d.ubicazioni}</div></div>
        <div class="card kpi"><div class="etichetta">Movimenti oggi</div><div class="valore">${d.movimenti_oggi}</div></div>
      </div>
      <div style="height:1.25rem"></div>
      <div class="griglia griglia-2">
        <div class="card"><div class="card-testa"><h3>Dove sta cosa</h3><a href="#ubicazioni" class="muto">Tutte le ubicazioni</a></div>
          ${d.per_ubicazione.length ? `<div class="tabella-wrap"><table><thead><tr><th>Ubicazione</th><th>Tipo</th><th class="num">Articoli</th><th class="num">Mezzi</th></tr></thead><tbody>
          ${d.per_ubicazione.map((u) => `<tr class="riga-link" onclick="location.hash='#scansione/${h(u.id)}:ubicazione'"><td>${h(u.nome)}</td><td><span class="badge">${h(ETICH_TIPO_UBI[u.tipo] || u.tipo)}</span></td><td class="num">${u.articoli}</td><td class="num">${u.mezzi}</td></tr>`).join('')}
          </tbody></table></div>` : vuoto('Nessuna ubicazione')}
        </div>
        <div class="card"><div class="card-testa"><h3>Sotto scorta</h3></div>
          ${d.sotto_scorta.length ? `<div class="tabella-wrap"><table><thead><tr><th>Articolo</th><th class="num">Giacenza</th><th class="num">Minimo</th></tr></thead><tbody>
          ${d.sotto_scorta.map((a) => `<tr class="riga-link" onclick="location.hash='#scansione/${h(a.codice)}'"><td>${h(a.descrizione)} <span class="muto mono">${h(a.codice)}</span></td><td class="num" style="color:var(--rosso)">${fmtN(a.totale)} ${h(a.um)}</td><td class="num">${fmtN(a.scorta_minima)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muto">Nessun articolo sotto la scorta minima. Le soglie si impostano nella scheda articolo.</p>'}
        </div>
      </div>
      <div style="height:1.25rem"></div>
      <div class="card"><div class="card-testa"><h3>Ultimi movimenti</h3><a href="#movimenti" class="muto">Tutti i movimenti</a>
        ${d.ultima_importazione ? `<span class="muto">Ultima importazione: ${fmtData(d.ultima_importazione.ts)} (${h(d.ultima_importazione.sorgente)}, ${h(d.ultima_importazione.esito)})</span>` : ''}</div>
        ${tabellaMovimenti(d.ultimi_movimenti)}</div>`;
  };

  function tabellaMovimenti(lista, conAzioni) {
    if (!lista.length) return vuoto('Nessun movimento');
    return `<div class="tabella-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Articolo</th><th class="num">Quantità</th><th>Da</th><th>A</th><th>Riferimento</th><th>Origine</th>${conAzioni && me.admin ? '<th></th>' : ''}</tr></thead><tbody>
      ${lista.map((m) => `<tr><td class="muto" style="white-space:nowrap">${fmtData(m.data || m.ts)}</td><td>${badgeTipoMov(m.tipo)}</td>
        <td><a href="#scansione/${h(m.codice)}">${h(m.descrizione)}</a> <span class="muto mono">${h(m.codice)}</span></td>
        <td class="num">${fmtN(m.quantita)} ${h(m.um)}</td><td>${h(m.da_nome || (m.tipo === 'carico' ? m.fornitore || '' : ''))}</td><td>${h(m.a_nome || '')}</td>
        <td class="muto">${h(m.riferimento || '')}${m.note ? ` <span title="${h(m.note)}">·</span>` : ''}</td><td>${badgeOrigine(m.origine)}</td>
        ${conAzioni && me.admin ? `<td><button class="btn btn-rosso btn-piccolo" data-del-mov="${m.id}">Elimina</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>`;
  }

  // ------------------------------------------------------------------ scansione
  let lettoreCamera = null;
  viste.scansione = async (cont, arg) => {
    cont.innerHTML = `
      <div class="vista-testa"><div><div class="sopratitolo">Codice a barre</div><h2>Scansione</h2></div></div>
      <div class="scanner">
        <form id="form-scan" class="scanner-riga">
          <input id="codice" autocomplete="off" placeholder="Scansiona o digita un codice (MAG-00001, targa, matricola...)" aria-label="Codice">
          <button class="btn" type="submit">Cerca</button>
          <button class="btn btn-sec" type="button" id="btn-camera">Fotocamera</button>
        </form>
        <div class="scanner-stato"><span class="punto"></span><span id="scan-stato">Pronto: il lettore può scansionare, il campo resta a fuoco.</span></div>
        <div id="lettore-camera" hidden></div>
      </div>
      <div id="risultato"></div>`;
    const inp = $('#codice');
    // Sul telefono il fuoco automatico aprirebbe la tastiera sopra la fotocamera: lo si dà solo dal computer.
    if (!MOBILE.matches) inp.focus();
    // Il lettore USB scrive come una tastiera: il campo deve restare a fuoco anche
    // dopo un click sulla pagina, a meno che l'utente non stia compilando un form.
    cont.addEventListener('click', (e) => {
      if (!MOBILE.matches && !e.target.closest('input, select, textarea, button, a, .modale')) inp.focus();
    });
    $('#form-scan').onsubmit = (e) => { e.preventDefault(); cerca(inp.value); };
    $('#btn-camera').onclick = avviaCamera;
    if (arg === 'camera') avviaCamera();
    else if (arg) {
      if (arg.endsWith(':ubicazione')) mostraUbicazione(parseInt(arg, 10));
      else { inp.value = arg; cerca(arg); }
    }

    async function cerca(codice) {
      codice = (codice || '').trim();
      if (!codice) return;
      $('#scan-stato').textContent = `Cerco ${codice}...`;
      const ris = $('#risultato');
      ris.innerHTML = skeleton(4);
      try {
        const d = await api('/api/scansione?codice=' + encodeURIComponent(codice));
        $('#scan-stato').textContent = `Trovato: ${codice}`;
        mostraRisultato(d);
      } catch (e) {
        $('#scan-stato').textContent = `Nessun risultato per ${codice}`;
        const s = (e.dati && e.dati.suggerimenti) || { articoli: [], mezzi: [] };
        ris.innerHTML = `<div class="card reveal"><div class="avviso avviso-errore">Codice <span class="mono">${h(codice)}</span> non riconosciuto.</div>
          ${s.articoli.length || s.mezzi.length ? `<h4>Forse cercavi</h4><ul class="suggerimenti">
            ${s.articoli.map((a) => `<li data-cod="${h(a.codice)}">${h(a.descrizione)} <span class="muto mono">${h(a.codice)}</span></li>`).join('')}
            ${s.mezzi.map((m) => `<li data-cod="${h(m.codice)}">${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))} <span class="muto mono">${h(m.targa || m.codice)}</span></li>`).join('')}
          </ul>` : ''}
          <div class="azioni-rapide"><button class="btn btn-sec" id="nuovo-art">Nuovo articolo con questo codice</button><button class="btn btn-sec" id="nuovo-mezzo">Nuovo mezzo con questa targa</button></div></div>`;
        ris.querySelectorAll('[data-cod]').forEach((li) => { li.onclick = () => { inp.value = li.dataset.cod; cerca(li.dataset.cod); }; });
        $('#nuovo-art').onclick = () => formArticolo({ codice_esterno: codice }, () => cerca(codice));
        $('#nuovo-mezzo').onclick = () => formMezzo({ targa: codice }, () => cerca(codice));
      }
      inp.select();
    }

    async function mostraUbicazione(id) {
      const lista = await ubicazioni();
      const u = lista.find((x) => x.id === id);
      if (u) { inp.value = u.codice; cerca(u.codice); }
    }

    function mostraRisultato(d) {
      const ris = $('#risultato');
      if (d.tipo === 'articolo') ris.innerHTML = cardArticolo(d);
      else if (d.tipo === 'mezzo') ris.innerHTML = cardMezzo(d);
      else ris.innerHTML = cardUbicazione(d);
      ris.querySelectorAll('[data-azione]').forEach((b) => { b.onclick = () => azioneRapida(b.dataset.azione, d); });
      const mod = ris.querySelector('[data-modifica]');
      if (mod) mod.onclick = () => (d.tipo === 'articolo' ? formArticolo(d.articolo, () => cerca(d.articolo.codice)) : formMezzo(d.mezzo, () => cerca(d.mezzo.codice)));
      if (d.tipo === 'articolo') {
        ris.querySelectorAll('[data-gg]').forEach((b) => { b.onclick = () => caricaAndamento(d.articolo, +b.dataset.gg); });
        caricaAndamento(d.articolo, 90);
      }
      if (d.tipo === 'mezzo') {
        agganciaGalleria(ris, d.mezzo, () => cerca(d.mezzo.codice));
        const seg = ris.querySelector('[data-segnala]');
        if (seg) seg.onclick = async () => {
          const m = d.mezzo;
          const nome = [m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' ');
          let cantieri = [];
          try { cantieri = (await api(`/api/incampo/commessa/${encodeURIComponent(m.ubicazione_commessa)}`)).cantieri || []; } catch (e) { toast(e.message, 'errore'); return; }
          modaleSegnalaInCampo(m.ubicazione_commessa, { mezzo_id: m.id, cantieri, titolo: `${nome}${m.targa ? ' ' + m.targa : ''}: `, descrizione: `Segnalazione dal Magazzino sul mezzo ${nome} (${m.targa || m.codice}), ora in ${m.ubicazione || 'ubicazione non registrata'}.` });
        };
      }
      if (d.tipo === 'ubicazione' && d.ubicazione.commessa) caricaPannelliSuite(ris, d.ubicazione.commessa, { ubicazione_id: d.ubicazione.id });
    }

    async function caricaAndamento(a, giorni) {
      const box = $('#andamento');
      if (!box) return;
      box.querySelectorAll('[data-gg]').forEach((b) => b.classList.toggle('attivo', +b.dataset.gg === giorni));
      const g = $('#g-andamento');
      g.style.opacity = '0.5';
      try {
        const d = await api(`/api/articoli/${a.id}/andamento?giorni=${giorni}`);
        window.Grafici.linee(g, d.date, d.serie, { um: a.um, titolo: 'Andamento della giacenza' });
        const t = $('#t-andamento');
        t.innerHTML = d.serie.length ? `<table><thead><tr><th>Ubicazione</th><th class="num">Inizio periodo</th><th class="num">Oggi</th></tr></thead><tbody>${d.serie.map((s) => `<tr><td>${h(s.nome)}</td><td class="num">${fmtN(s.valori[0])} ${h(a.um)}</td><td class="num">${fmtN(s.finale)} ${h(a.um)}</td></tr>`).join('')}</tbody></table>` : '';
      } catch (e) { g.innerHTML = `<div class="grafico-vuoto">${h(e.message)}</div>`; }
      g.style.opacity = '1';
    }

    function cardArticolo(d) {
      const a = d.articolo;
      return `<div class="card reveal"><div class="card-testa"><div class="risultato-titolo"><span class="badge badge-blu">Articolo</span><h3>${h(a.descrizione)}</h3><span class="codice">${h(a.codice)}</span>${a.codice_esterno ? `<span class="muto mono">EAN ${h(a.codice_esterno)}</span>` : ''}</div>
          <div class="azioni"><button class="btn btn-sec btn-piccolo" data-modifica>Modifica</button><a class="btn btn-sec btn-piccolo" href="/etichette?tipo=articoli&ids=${a.id}" target="_blank">Etichetta</a></div></div>
        <div class="griglia griglia-2">
          <div><div class="totale-grande">${fmtN(d.totale)} <small>${h(a.um)} in totale</small></div>
            <p class="muto">${a.categoria ? h(a.categoria) + ' · ' : ''}${a.fornitore ? 'Fornitore ' + h(a.fornitore) : ''}${a.scorta_minima != null ? ` · scorta minima ${fmtN(a.scorta_minima)}` : ''}</p>
            <div class="azioni-rapide"><button class="btn btn-verde" data-azione="carico">Carico</button><button class="btn" data-azione="scarico">Scarico</button><button class="btn btn-sec" data-azione="trasferimento">Trasferimento</button><button class="btn btn-sec" data-azione="inventario">Inventario</button></div></div>
          <div><h4>Dove sta</h4>${d.giacenze.length ? `<table><thead><tr><th>Ubicazione</th><th class="num">Quantità</th><th>Ultimo mov.</th></tr></thead><tbody>
            ${d.giacenze.map((g) => `<tr><td>${h(g.ubicazione)} <span class="badge">${h(ETICH_TIPO_UBI[g.tipo] || g.tipo)}</span>${urlMappa(g) ? ` <a href="${h(urlMappa(g))}" target="_blank" rel="noopener" title="Apri su Google Maps" class="link-mappa">${ICONE_MAPPA}</a>` : ''}</td><td class="num"><strong>${fmtN(g.quantita)}</strong> ${h(a.um)}</td><td class="muto">${fmtData(g.ultimo_movimento)}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muto">Nessuna giacenza: registra un carico.</p>'}</div>
        </div>
        <div id="andamento" style="margin-top:1.25rem"><div class="card-testa"><h4>Andamento della giacenza</h4><div class="segmenti">${[[30, '30 gg'], [90, '90 gg'], [365, '1 anno']].map(([g, t]) => `<button type="button" data-gg="${g}">${t}</button>`).join('')}</div></div><div class="grafico" id="g-andamento"></div><div class="tabella-grafico" id="t-andamento"></div></div>
        <h4 style="margin-top:1.25rem">Ultimi movimenti</h4>${tabellaMovimenti(d.movimenti)}</div>`;
    }

    function cardMezzo(d) {
      const m = d.mezzo;
      const principale = (d.foto || []).find((f) => f.principale) || (d.foto || [])[0];
      return `<div class="card reveal"><div class="card-testa"><div class="risultato-titolo">${principale ? `<a href="/api/mezzi/${m.id}/foto/${principale.id}" target="_blank" rel="noopener"><img class="foto-mini" src="/api/mezzi/${m.id}/foto/${principale.id}?dim=min" alt="foto del mezzo"></a>` : ''}<span class="badge badge-blu">Mezzo</span><h3>${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))}</h3><span class="codice">${h(m.codice)}</span></div>
          <div class="azioni"><button class="btn btn-sec btn-piccolo" data-modifica>Modifica</button><a class="btn btn-sec btn-piccolo" href="/etichette?tipo=mezzi&ids=${m.id}" target="_blank">Etichetta</a></div></div>
        <div class="griglia griglia-2">
          <div><div class="totale-grande" style="font-size:1.6rem">${h(m.ubicazione || 'Ubicazione non registrata')}</div>
            <p>${badgeStato(m.stato)} <span class="badge">${m.proprieta === 'nolo' ? 'A nolo' : 'Di proprietà'}</span>${m.assegnato_a ? ` <span class="badge badge-blu">In uso da ${h(m.assegnato_a)}</span>` : ''}</p>
            <p class="muto">${m.targa ? 'Targa ' + h(m.targa) + ' · ' : ''}${m.matricola ? 'Matricola ' + h(m.matricola) : ''}${m.ditta ? '<br>' + h(m.ditta) : ''}${m.nolo_dal || m.nolo_al ? `<br>Nolo ${fmtData(m.nolo_dal)} – ${fmtData(m.nolo_al)}` : ''}${m.note ? '<br>' + h(m.note) : ''}</p>
            <div class="azioni-rapide"><button class="btn" data-azione="sposta">Sposta / cambia stato</button>${urlMappa({ indirizzo: m.ubicazione_indirizzo, lat: m.ubicazione_lat, lng: m.ubicazione_lng }) ? `<a class="btn btn-sec" href="${h(urlMappa({ indirizzo: m.ubicazione_indirizzo, lat: m.ubicazione_lat, lng: m.ubicazione_lng }))}" target="_blank" rel="noopener">${ICONE_MAPPA} Mappa</a>` : ''}${m.ubicazione_commessa ? `<button class="btn btn-sec" type="button" data-segnala title="Apre un task in InCampo sul cantiere ${h(m.ubicazione_commessa)}">Segnala in InCampo</button>` : ''}</div></div>
          <div><h4>Storico spostamenti</h4>${d.storico.length ? `<table><thead><tr><th>Data</th><th>Da</th><th>A</th><th>Stato</th><th>Chi</th></tr></thead><tbody>
            ${d.storico.map((s) => `<tr><td class="muto" style="white-space:nowrap">${fmtData(s.ts)}</td><td>${h(s.da_nome || '—')}</td><td>${h(s.a_nome || '—')}</td><td>${s.stato ? badgeStato(s.stato) : ''}</td><td class="muto">${h(s.utente || '')}${s.note ? ` <span title="${h(s.note)}">·</span>` : ''}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muto">Nessuno spostamento registrato.</p>'}</div>
        </div>${galleriaMezzo(m, d.foto)}</div>`;
    }

    function cardUbicazione(d) {
      const u = d.ubicazione;
      return `<div class="card reveal"><div class="card-testa"><div class="risultato-titolo"><span class="badge badge-blu">Ubicazione</span><h3>${h(u.nome)}</h3><span class="codice">${h(u.codice)}</span><span class="badge">${h(ETICH_TIPO_UBI[u.tipo] || u.tipo)}</span></div>
          <div class="azioni">${urlMappa(u) ? `<a class="btn btn-piccolo" href="${h(urlMappa(u))}" target="_blank" rel="noopener">${ICONE_MAPPA} Mappa</a><a class="btn btn-sec btn-piccolo" href="${h(urlMappa(u, true))}" target="_blank" rel="noopener">Indicazioni</a>` : ''}<a class="btn btn-sec btn-piccolo" href="/etichette?tipo=ubicazioni&ids=${u.id}" target="_blank">Etichetta</a></div></div>
        ${u.indirizzo ? `<p class="muto">${h(u.indirizzo)}</p>` : ''}
        <div class="griglia griglia-2">
          <div><h4>Materiale (${d.giacenze.length})</h4>${d.giacenze.length ? `<table><thead><tr><th>Articolo</th><th class="num">Quantità</th></tr></thead><tbody>
            ${d.giacenze.map((g) => `<tr class="riga-link" onclick="location.hash='#scansione/${h(g.codice)}'"><td>${h(g.descrizione)} <span class="muto mono">${h(g.codice)}</span></td><td class="num">${fmtN(g.quantita)} ${h(g.um)}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muto">Nessun materiale qui.</p>'}</div>
          <div><h4>Mezzi (${d.mezzi.length})</h4>${d.mezzi.length ? `<table><thead><tr><th>Mezzo</th><th>Targa</th><th>Stato</th></tr></thead><tbody>
            ${d.mezzi.map((m) => `<tr class="riga-link" onclick="location.hash='#scansione/${h(m.codice)}'"><td>${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))}</td><td class="mono">${h(m.targa || '')}</td><td>${badgeStato(m.stato)}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muto">Nessun mezzo qui.</p>'}</div>
        </div>${u.commessa ? pannelliSuite(u.commessa) : '<p class="muto" style="margin-top:1rem">Senza codice commessa l\'ubicazione non si collega a InCampo e SkyTower: aggiungilo in Modifica.</p>'}</div>`;
    }

    async function azioneRapida(tipo, d) {
      if (d.tipo === 'mezzo') return formSpostaMezzo(d.mezzo, () => cerca(d.mezzo.codice));
      return formMovimento(tipo, d.articolo, d.giacenze, () => cerca(d.articolo.codice), 'scansione');
    }

    async function avviaCamera() {
      const box = $('#lettore-camera');
      if (lettoreCamera) {
        try { await lettoreCamera.stop(); } catch (_) { /* già fermo */ }
        lettoreCamera = null; box.hidden = true; box.innerHTML = ''; $('#btn-camera').textContent = 'Fotocamera';
        return;
      }
      if (!window.isSecureContext) {
        toast('La fotocamera funziona solo su https o localhost. Dal telefono usa l\'indirizzo https del portale.', 'errore');
        return;
      }
      if (!window.Html5Qrcode) {
        $('#scan-stato').textContent = 'Carico il lettore...';
        await new Promise((ok, ko) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
          s.onload = ok; s.onerror = () => ko(new Error('Libreria non scaricabile (serve internet)'));
          document.head.appendChild(s);
        }).catch((e) => { toast(e.message, 'errore'); });
        if (!window.Html5Qrcode) return;
      }
      box.hidden = false; box.innerHTML = '<div id="camera-view"></div>';
      lettoreCamera = new window.Html5Qrcode('camera-view');
      $('#btn-camera').textContent = 'Chiudi fotocamera';
      try {
        // Riquadro di lettura proporzionato allo schermo: largo quasi tutto sul telefono.
        const qrbox = (w, hh) => ({ width: Math.min(Math.round(w * 0.85), 360), height: Math.min(Math.round(hh * 0.5), 200) });
        await lettoreCamera.start({ facingMode: 'environment' }, { fps: 10, qrbox, aspectRatio: MOBILE.matches ? 1.333 : 1.777 },
          (testo) => { inp.value = testo; cerca(testo); if (navigator.vibrate) navigator.vibrate(60); },
          () => { /* nessun codice nel frame */ });
        $('#scan-stato').textContent = 'Fotocamera attiva: inquadra il codice.';
      } catch (e) {
        toast('Fotocamera non disponibile: ' + (e.message || e), 'errore');
        lettoreCamera = null; box.hidden = true; $('#btn-camera').textContent = 'Fotocamera';
      }
    }
  };

  // ------------------------------------------------------------------ form movimento (condiviso)
  async function formMovimento(tipo, articolo, giacenze, dopo, origine) {
    const lista = await ubicazioni();
    const conGiac = (giacenze || []).filter((g) => g.quantita > 0);
    const daOpz = conGiac.length ? conGiac.map((g) => [g.ubicazione_id, `${g.ubicazione} (${fmtN(g.quantita)} ${articolo.um})`]) : lista.map((u) => [u.id, u.nome]);
    const titoli = { carico: 'Carico', scarico: 'Scarico', trasferimento: 'Trasferimento', rettifica: 'Rettifica', inventario: 'Inventario (conteggio reale)' };
    const html = `<form id="f" class="form">
      <div class="pieno"><strong>${h(articolo.descrizione)}</strong> <span class="muto mono">${h(articolo.codice)}</span></div>
      ${tipo === 'carico' || tipo === 'trasferimento' || tipo === 'rettifica' || tipo === 'inventario' ? '' : ''}
      ${['scarico', 'trasferimento'].includes(tipo) ? campo('Da ubicazione', select('da_ubicazione_id', daOpz)) : ''}
      ${['carico', 'trasferimento', 'rettifica', 'inventario'].includes(tipo) ? campo(tipo === 'trasferimento' ? 'A ubicazione' : 'Ubicazione', `<select name="a_ubicazione_id">${opzioniUbicazioni(lista, lista[0] && lista[0].id)}</select>`) : ''}
      ${campo(tipo === 'inventario' ? `Conteggio reale (${articolo.um})` : tipo === 'rettifica' ? `Quantità con segno (${articolo.um})` : `Quantità (${articolo.um})`, input('quantita', '', 'type="number" step="any" required inputmode="decimal"'))}
      ${tipo === 'carico' ? campo('Fornitore', input('fornitore', articolo.fornitore || '')) : campo('Data', input('data', new Date().toISOString().slice(0, 10), 'type="date"'))}
      ${campo('Riferimento (DDT, ordine, bolla...)', input('riferimento', ''))}
      ${campo('Note', input('note', ''))}
      <div class="form-azioni"><button class="btn btn-sec" type="button" id="annulla">Annulla</button><button class="btn" type="submit">Registra ${h(titoli[tipo].toLowerCase())}</button></div></form>`;
    modale(titoli[tipo], html, (box) => {
      $('#annulla', box).onclick = chiudiModale;
      $('#f', box).onsubmit = async (e) => {
        e.preventDefault();
        const d = datiForm(e.target);
        d.tipo = tipo; d.articolo_id = articolo.id; d.origine = origine || 'manuale';
        try {
          await api('/api/movimenti', { method: 'POST', body: d });
          toast(`${titoli[tipo]} registrato`, 'ok'); chiudiModale(); dopo && dopo();
        } catch (err) {
          if (/insufficiente/.test(err.message) && confirm(err.message + '\n\nRegistrare comunque?')) {
            d.forza = true;
            try { await api('/api/movimenti', { method: 'POST', body: d }); toast('Registrato', 'ok'); chiudiModale(); dopo && dopo(); } catch (e2) { toast(e2.message, 'errore'); }
          } else toast(err.message, 'errore');
        }
      };
    });
  }

  async function formSpostaMezzo(m, dopo) {
    const lista = await ubicazioni();
    const html = `<form id="f" class="form">
      <div class="pieno"><strong>${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))}</strong> <span class="muto mono">${h(m.targa || m.codice)}</span><br><span class="muto">Ora: ${h(m.ubicazione || '—')}</span></div>
      ${campo('Nuova ubicazione', `<select name="a_ubicazione_id">${opzioniUbicazioni(lista, m.ubicazione_id, 'Lascia dove sta')}</select>`)}
      ${campo('Stato', select('stato', [['disponibile', 'Disponibile'], ['in_uso', 'In uso'], ['manutenzione', 'In manutenzione'], ['fermo', 'Fermo'], ['restituito', 'Restituito al noleggiatore']], m.stato))}
      ${campo('In uso da (operatore / squadra)', input('assegnato_a', m.assegnato_a || '', 'maxlength="80" placeholder="es. Geom. Restivo, squadra B"'), 'pieno')}
      ${campo('Note', input('note', ''), 'pieno')}
      <div class="form-azioni"><button class="btn btn-sec" type="button" id="annulla">Annulla</button><button class="btn" type="submit">Registra</button></div></form>`;
    modale('Sposta mezzo', html, (box) => {
      $('#annulla', box).onclick = chiudiModale;
      $('#f', box).onsubmit = async (e) => {
        e.preventDefault();
        const d = datiForm(e.target);
        if (!d.a_ubicazione_id) delete d.a_ubicazione_id;
        d.origine = 'scansione';
        try { await api(`/api/mezzi/${m.id}/sposta`, { method: 'POST', body: d }); toast('Spostamento registrato', 'ok'); chiudiModale(); dopo && dopo(); }
        catch (err) { toast(err.message, 'errore'); }
      };
    });
  }

  // ------------------------------------------------------------------ giacenze
  viste.giacenze = async (cont) => {
    const lista = await ubicazioni();
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Materiale</div><h2>Giacenze</h2></div>
      <div class="azioni"><button class="btn btn-sec" id="btn-csv">Esporta CSV</button></div></div>
      <div class="filtri"><input id="q" placeholder="Cerca articolo o ubicazione..."><select id="ubi">${opzioniUbicazioni(lista, '', 'Tutte le ubicazioni')}</select></div>
      <div class="card" id="tab"></div>`;
    let righe = [];
    const carica = async () => {
      righe = await api(`/api/giacenze?q=${encodeURIComponent($('#q').value)}&ubicazione_id=${$('#ubi').value}`);
      $('#tab').innerHTML = righe.length ? `<div class="tabella-wrap"><table><thead><tr><th>Codice</th><th>Articolo</th><th>Ubicazione</th><th class="num">Quantità</th><th>Ultimo movimento</th></tr></thead><tbody>
        ${righe.map((g) => `<tr class="riga-link" onclick="location.hash='#scansione/${h(g.codice)}'"><td class="mono">${h(g.codice)}</td><td>${h(g.descrizione)}${g.categoria ? ` <span class="badge">${h(g.categoria)}</span>` : ''}</td><td>${h(g.ubicazione)}</td>
          <td class="num" ${g.quantita < 0 ? 'style="color:var(--rosso)"' : ''}><strong>${fmtN(g.quantita)}</strong> ${h(g.um)}</td><td class="muto">${fmtData(g.ultimo_movimento)}</td></tr>`).join('')}
        </tbody></table></div>` : vuoto('Nessuna giacenza: importa i DDT o registra un carico.');
    };
    let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(carica, 250); };
    $('#ubi').onchange = carica;
    $('#btn-csv').onclick = () => {
      const csv = ['Codice;Articolo;UM;Ubicazione;Quantita', ...righe.map((g) => [g.codice, g.descrizione, g.um, g.ubicazione, String(g.quantita).replace('.', ',')].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';'))].join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'giacenze.csv'; a.click();
    };
    await carica();
  };

  // ------------------------------------------------------------------ movimenti
  viste.movimenti = async (cont) => {
    const lista = await ubicazioni();
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Storico</div><h2>Movimenti</h2></div>
      <div class="azioni"><button class="btn" id="btn-nuovo">Nuovo movimento</button></div></div>
      <div class="filtri"><input id="q" placeholder="Cerca articolo, riferimento, fornitore..."><select id="tipo"><option value="">Tutti i tipi</option>${['carico', 'scarico', 'trasferimento', 'rettifica', 'inventario'].map((t) => `<option>${t}</option>`).join('')}</select>
      <select id="origine"><option value="">Tutte le origini</option><option value="ddt">DDT</option><option value="scansione">Scansione</option><option value="manuale">Manuale</option></select>
      <select id="ubi">${opzioniUbicazioni(lista, '', 'Tutte le ubicazioni')}</select></div>
      <div class="card" id="tab"></div>`;
    const carica = async () => {
      const m = await api(`/api/movimenti?q=${encodeURIComponent($('#q').value)}&tipo=${$('#tipo').value}&origine=${$('#origine').value}&ubicazione_id=${$('#ubi').value}&limite=300`);
      $('#tab').innerHTML = tabellaMovimenti(m, true);
      $('#tab').querySelectorAll('[data-del-mov]').forEach((b) => {
        b.onclick = async () => { if (!confirm('Eliminare questo movimento? La giacenza si ricalcola.')) return; try { await api('/api/movimenti/' + b.dataset.delMov, { method: 'DELETE' }); toast('Eliminato', 'ok'); carica(); } catch (e) { toast(e.message, 'errore'); } };
      });
    };
    let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(carica, 250); };
    ['tipo', 'origine', 'ubi'].forEach((id) => { $('#' + id).onchange = carica; });
    $('#btn-nuovo').onclick = () => scegliArticoloPoi((a) => scegliTipoMovimento(a, carica));
    await carica();
  };

  function scegliArticoloPoi(poi) {
    modale('Scegli l\'articolo', `<div class="campo"><label>Cerca</label><input id="cerca-art" placeholder="Descrizione o codice" autocomplete="off"></div><ul class="suggerimenti" id="lista-art"></ul>`, (box) => {
      const inp = $('#cerca-art', box);
      const aggiorna = async () => {
        const l = await api('/api/articoli?q=' + encodeURIComponent(inp.value));
        $('#lista-art', box).innerHTML = l.slice(0, 15).map((a) => `<li data-id="${a.id}">${h(a.descrizione)} <span class="muto mono">${h(a.codice)}</span> <span class="muto">${fmtN(a.totale)} ${h(a.um)}</span></li>`).join('') || '<li class="muto">Nessun articolo</li>';
        box.querySelectorAll('[data-id]').forEach((li) => { li.onclick = () => { const a = l.find((x) => x.id == li.dataset.id); chiudiModale(); poi(a); }; });
      };
      let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(aggiorna, 200); };
      aggiorna();
    });
  }
  function scegliTipoMovimento(a, dopo) {
    modale('Tipo di movimento', `<div class="azioni-rapide">${['carico', 'scarico', 'trasferimento', 'rettifica', 'inventario'].map((t) => `<button class="btn ${t === 'carico' ? 'btn-verde' : t === 'scarico' ? '' : 'btn-sec'}" data-t="${t}">${t}</button>`).join('')}</div>`, (box) => {
      box.querySelectorAll('[data-t]').forEach((b) => { b.onclick = async () => { const d = await api('/api/articoli/' + a.id); formMovimento(b.dataset.t, d.articolo, d.giacenze, dopo); }; });
    });
  }

  // ------------------------------------------------------------------ articoli
  viste.articoli = async (cont) => {
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Anagrafica</div><h2>Articoli</h2></div>
      <div class="azioni"><a class="btn btn-sec" href="/etichette?tipo=articoli" target="_blank">Stampa tutte le etichette</a><button class="btn" id="btn-nuovo">Nuovo articolo</button></div></div>
      <div class="filtri"><input id="q" placeholder="Cerca per descrizione, codice, categoria..."><label class="muto"><input type="checkbox" id="tutti"> anche disattivati</label></div>
      <div class="card" id="tab"></div>`;
    const carica = async () => {
      const l = await api(`/api/articoli?q=${encodeURIComponent($('#q').value)}&tutti=${$('#tutti').checked ? 1 : 0}`);
      $('#tab').innerHTML = l.length ? `<div class="tabella-wrap"><table><thead><tr><th>Codice</th><th>Descrizione</th><th>UM</th><th>Categoria</th><th>Fornitore</th><th class="num">Giacenza</th><th></th></tr></thead><tbody>
        ${l.map((a) => `<tr ${a.attivo ? '' : 'style="opacity:.55"'}><td class="mono"><a href="#scansione/${h(a.codice)}">${h(a.codice)}</a>${a.codice_esterno ? `<br><span class="muto">${h(a.codice_esterno)}</span>` : ''}</td><td>${h(a.descrizione)}</td><td>${h(a.um)}</td><td>${h(a.categoria || '')}</td><td>${h(a.fornitore || '')}</td>
          <td class="num" ${a.scorta_minima != null && a.totale < a.scorta_minima ? 'style="color:var(--rosso)"' : ''}>${fmtN(a.totale)}</td>
          <td style="white-space:nowrap"><button class="btn btn-sec btn-piccolo" data-mod="${a.id}">Modifica</button> ${me.admin ? `<button class="btn btn-rosso btn-piccolo" data-del="${a.id}">Elimina</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : vuoto('Nessun articolo. Importa i DDT o creane uno.');
      $('#tab').querySelectorAll('[data-mod]').forEach((b) => { b.onclick = () => formArticolo(l.find((x) => x.id == b.dataset.mod), carica); });
      $('#tab').querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => { if (!confirm('Eliminare l\'articolo? Se ha movimenti viene solo disattivato.')) return; try { const r = await api('/api/articoli/' + b.dataset.del, { method: 'DELETE' }); toast(r.messaggio || 'Eliminato', 'ok'); carica(); } catch (e) { toast(e.message, 'errore'); } };
      });
    };
    let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(carica, 250); };
    $('#tutti').onchange = carica;
    $('#btn-nuovo').onclick = () => formArticolo(null, carica);
    await carica();
  };

  function formArticolo(a, dopo) {
    a = a || {};
    const html = `<form id="f" class="form">
      ${campo('Descrizione', input('descrizione', a.descrizione, 'required maxlength="200"'), 'pieno')}
      ${campo('Unità di misura', input('um', a.um || 'pz', 'list="um-list"') + '<datalist id="um-list"><option>pz<option>m³<option>kg<option>ton<option>m<option>m²<option>l<option>colli<option>sacchi</datalist>')}
      ${campo('Codice esterno (EAN / fornitore)', input('codice_esterno', a.codice_esterno))}
      ${campo('Categoria', input('categoria', a.categoria))}
      ${campo('Fornitore abituale', input('fornitore', a.fornitore))}
      ${campo('Scorta minima', input('scorta_minima', a.scorta_minima, 'type="number" step="any" min="0"'))}
      ${a.id ? campo('Attivo', select('attivo', [['1', 'Sì'], ['0', 'No (disattivato)']], a.attivo ? '1' : '0')) : ''}
      ${campo('Note', `<textarea name="note">${h(a.note || '')}</textarea>`, 'pieno')}
      <div class="form-azioni"><button class="btn btn-sec" type="button" id="annulla">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`;
    modale(a.id ? `Modifica ${a.codice}` : 'Nuovo articolo', html, (box) => {
      $('#annulla', box).onclick = chiudiModale;
      $('#f', box).onsubmit = async (e) => {
        e.preventDefault();
        try {
          const d = datiForm(e.target);
          await api(a.id ? '/api/articoli/' + a.id : '/api/articoli', { method: a.id ? 'PUT' : 'POST', body: d });
          toast('Articolo salvato', 'ok'); chiudiModale(); dopo && dopo();
        } catch (err) { toast(err.message, 'errore'); }
      };
    });
  }

  // ------------------------------------------------------------------ mezzi
  viste.mezzi = async (cont) => {
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Anagrafica</div><h2>Mezzi</h2></div>
      <div class="azioni"><a class="btn btn-sec" href="/etichette?tipo=mezzi" target="_blank">Stampa tutte le etichette</a><button class="btn btn-sec" id="btn-vfp">Importa da VFP Transfer</button><button class="btn" id="btn-nuovo">Nuovo mezzo</button></div></div>
      <div class="filtri"><input id="q" placeholder="Cerca tipo, marca, targa, matricola, ditta..."><select id="stato"><option value="">Tutti gli stati</option>${['disponibile', 'in_uso', 'manutenzione', 'fermo', 'restituito'].map((s) => `<option value="${s}">${s.replace('_', ' ')}</option>`).join('')}</select>
      <select id="prop"><option value="">Proprietà e nolo</option><option value="proprio">Di proprietà</option><option value="nolo">A nolo</option></select></div>
      <div class="card" id="tab"></div>`;
    const carica = async () => {
      const l = await api(`/api/mezzi?q=${encodeURIComponent($('#q').value)}&stato=${$('#stato').value}&proprieta=${$('#prop').value}`);
      $('#tab').innerHTML = l.length ? `<div class="tabella-wrap"><table><thead><tr><th>Codice</th><th>Mezzo</th><th>Targa / matricola</th><th>Proprietà</th><th>Ubicazione</th><th>Stato</th><th>Nolo fino al</th><th></th></tr></thead><tbody>
        ${l.map((m) => `<tr><td class="mono"><a href="#scansione/${h(m.codice)}">${h(m.codice)}</a></td><td><div style="display:flex;align-items:center;gap:.6rem">${m.foto_id ? `<img class="foto-mini" src="/api/mezzi/${m.id}/foto/${m.foto_id}?dim=min" alt="" loading="lazy">` : `<a class="foto-mini foto-vuota" href="${h(urlRicercaMezzo(m))}" target="_blank" rel="noopener" title="Nessuna foto: cerca su internet">${ICONE_FOTO}</a>`}<span>${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))}${m.n_foto ? `<br><span class="muto">${m.n_foto} foto</span>` : ''}</span></div></td><td class="mono">${h(m.targa || '')}${m.matricola ? `<br><span class="muto">${h(m.matricola)}</span>` : ''}</td>
          <td>${m.proprieta === 'nolo' ? `<span class="badge badge-ambra">Nolo</span><br><span class="muto">${h(m.ditta || '')}</span>` : '<span class="badge badge-verde">Proprio</span>'}</td><td>${h(m.ubicazione || '—')}</td><td>${badgeStato(m.stato)}${m.assegnato_a ? `<br><span class="muto">${h(m.assegnato_a)}</span>` : ''}</td>
          <td class="muto">${m.nolo_al ? fmtData(m.nolo_al) : ''}</td>
          <td style="white-space:nowrap"><button class="btn btn-piccolo" data-sposta="${m.id}">Sposta</button> <button class="btn btn-sec btn-piccolo" data-mod="${m.id}">Modifica</button> ${me.admin ? `<button class="btn btn-rosso btn-piccolo" data-del="${m.id}">Elimina</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : vuoto('Nessun mezzo. Importa le pratiche di nolo o registrane uno.');
      $('#tab').querySelectorAll('[data-mod]').forEach((b) => { b.onclick = () => formMezzo(l.find((x) => x.id == b.dataset.mod), carica); });
      $('#tab').querySelectorAll('[data-sposta]').forEach((b) => { b.onclick = () => formSpostaMezzo(l.find((x) => x.id == b.dataset.sposta), carica); });
      $('#tab').querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => { if (!confirm('Eliminare il mezzo e il suo storico?')) return; try { await api('/api/mezzi/' + b.dataset.del, { method: 'DELETE' }); toast('Eliminato', 'ok'); carica(); } catch (e) { toast(e.message, 'errore'); } };
      });
    };
    let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(carica, 250); };
    $('#stato').onchange = carica; $('#prop').onchange = carica;
    $('#btn-nuovo').onclick = () => formMezzo(null, carica);
    $('#btn-vfp').onclick = async () => { try { const r = await api('/api/importazioni/mezzi', { method: 'POST', body: {} }); toast(`Importazione mezzi: ${r.totale} pratiche lette`, 'ok'); carica(); } catch (e) { toast(e.message, 'errore'); } };
    await carica();
  };

  async function formMezzo(m, dopo) {
    m = m || {};
    const lista = await ubicazioni();
    const html = `<form id="f" class="form">
      ${campo('Tipo di mezzo', input('tipo_mezzo', m.tipo_mezzo, 'required list="tipi-mezzo"') + '<datalist id="tipi-mezzo"><option>Escavatore cingolato<option>Escavatore gommato<option>Miniescavatore<option>Pala gommata<option>Terna<option>Autocarro<option>Autobetoniera<option>Gru a torre<option>Autogru<option>Piattaforma aerea<option>Rullo compattatore<option>Furgone<option>Generatore</datalist>')}
      ${campo('Proprietà', select('proprieta', [['proprio', 'Di proprietà'], ['nolo', 'A nolo']], m.proprieta || 'proprio'))}
      ${campo('Marca', input('marca', m.marca))}
      ${campo('Modello', input('modello', m.modello))}
      ${campo('Targa', `<div style="display:flex;gap:.4rem">${input('targa', m.targa, 'style="text-transform:uppercase;flex:1"')}<button class="btn btn-sec btn-piccolo" type="button" id="btn-targa-foto" title="Leggi la targa da una foto">${ICONE_FOTO}</button></div>`)}
      ${campo('Matricola / n. di serie', input('matricola', m.matricola))}
      ${campo('Ditta proprietaria (nolo)', input('ditta', m.ditta))}
      ${campo('Partita IVA', input('piva', m.piva))}
      ${campo('Nolo dal', input('nolo_dal', m.nolo_dal, 'type="date"'))}
      ${campo('Nolo al', input('nolo_al', m.nolo_al, 'type="date"'))}
      ${!m.id ? campo('Ubicazione iniziale', `<select name="ubicazione_id">${opzioniUbicazioni(lista, '', 'Non ancora assegnata')}</select>`) : ''}
      ${!m.id ? campo('Stato', select('stato', [['disponibile', 'Disponibile'], ['in_uso', 'In uso'], ['manutenzione', 'In manutenzione'], ['fermo', 'Fermo']], 'disponibile')) : campo('Attivo', select('attivo', [['1', 'Sì'], ['0', 'No (dismesso)']], m.attivo ? '1' : '0'))}
      ${campo('Note', `<textarea name="note">${h(m.note || '')}</textarea>`, 'pieno')}
      <div class="form-azioni"><button class="btn btn-sec" type="button" id="annulla">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`;
    modale(m.id ? `Modifica ${m.codice}` : 'Nuovo mezzo', html, (box) => {
      $('#annulla', box).onclick = chiudiModale;
      $('#btn-targa-foto', box).onclick = () => {
        // La modale della targa sostituisce quella del form: alla scelta si riapre il form con la targa compilata.
        const dati = datiForm($('#f', box));
        modaleLeggiTarga((targa) => { chiudiModale(); formMezzo(Object.assign({}, m, dati, { targa }), dopo); }, null);
      };
      $('#f', box).onsubmit = async (e) => {
        e.preventDefault();
        try {
          const d = datiForm(e.target);
          await api(m.id ? '/api/mezzi/' + m.id : '/api/mezzi', { method: m.id ? 'PUT' : 'POST', body: d });
          toast('Mezzo salvato', 'ok'); chiudiModale(); dopo && dopo();
        } catch (err) { toast(err.message, 'errore'); }
      };
    });
  }

  // ------------------------------------------------------------------ ubicazioni
  viste.ubicazioni = async (cont) => {
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Anagrafica</div><h2>Ubicazioni</h2></div>
      <div class="azioni"><a class="btn btn-sec" href="/etichette?tipo=ubicazioni" target="_blank">Stampa etichette</a><button class="btn btn-sec" id="btn-incampo" title="Crea un'ubicazione di tipo cantiere per ogni cantiere di InCampo, con codice commessa e indirizzo">Importa cantieri da InCampo</button><button class="btn" id="btn-nuovo">Nuova ubicazione</button></div></div>
      <div class="card" id="tab"></div>`;
    $('#btn-incampo').onclick = async () => {
      const b = $('#btn-incampo'); b.disabled = true;
      try {
        const r = await api('/api/incampo/importa-cantieri', { method: 'POST', body: {} });
        toast(`InCampo: ${r.nuove} cantieri nuovi, ${r.aggiornate} aggiornati (${r.commesse} commesse)`, 'ok');
        await carica();
      } catch (e) { toast(e.message, 'errore'); }
      b.disabled = false;
    };
    const carica = async () => {
      const l = await api('/api/ubicazioni?tutte=1');
      ubicazioniCache = l.filter((u) => u.attivo);
      $('#tab').innerHTML = `<div class="tabella-wrap"><table><thead><tr><th>Codice</th><th>Nome</th><th>Tipo</th><th>Commessa</th><th class="num">Articoli</th><th class="num">Mezzi</th><th></th></tr></thead><tbody>
        ${l.map((u) => `<tr ${u.attivo ? '' : 'style="opacity:.55"'}><td class="mono"><a href="#scansione/${h(u.codice)}">${h(u.codice)}</a></td><td>${h(u.nome)}${u.indirizzo ? `<br><span class="muto">${h(u.indirizzo)}</span>` : ''}</td><td><span class="badge">${h(ETICH_TIPO_UBI[u.tipo] || u.tipo)}</span></td><td class="muto">${h(u.commessa || '')}</td><td class="num">${u.articoli}</td><td class="num">${u.mezzi}</td>
          <td style="white-space:nowrap">${btnMappa(u)} <button class="btn btn-sec btn-piccolo" data-mod="${u.id}">Modifica</button> ${me.admin ? `<button class="btn btn-rosso btn-piccolo" data-del="${u.id}">Elimina</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
      $('#tab').querySelectorAll('[data-mod]').forEach((b) => { b.onclick = () => formUbicazione(l.find((x) => x.id == b.dataset.mod), carica); });
      $('#tab').querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => { if (!confirm('Eliminare l\'ubicazione? Se ha movimenti o mezzi viene solo disattivata.')) return; try { const r = await api('/api/ubicazioni/' + b.dataset.del, { method: 'DELETE' }); toast(r.messaggio || 'Eliminata', 'ok'); carica(); } catch (e) { toast(e.message, 'errore'); } };
      });
    };
    $('#btn-nuovo').onclick = () => formUbicazione(null, carica);
    await carica();
  };

  function formUbicazione(u, dopo) {
    u = u || {};
    const html = `<form id="f" class="form">
      ${campo('Nome', input('nome', u.nome, 'required maxlength="120"'), 'pieno')}
      ${campo('Tipo', select('tipo', Object.entries(ETICH_TIPO_UBI), u.tipo || 'cantiere'))}
      ${campo('Commessa (cartella del Lettore DDT)', input('commessa', u.commessa))}
      ${campo('Indirizzo (per Google Maps)', input('indirizzo', u.indirizzo, 'placeholder="es. Via Etnea 120, Catania"'), 'pieno')}
      ${campo('Latitudine', input('lat', u.lat, 'type="number" step="any" min="-90" max="90" placeholder="37.5079"'))}
      ${campo('Longitudine', input('lng', u.lng, 'type="number" step="any" min="-180" max="180" placeholder="15.0830"'))}
      <div class="pieno muto" id="anteprima-mappa"></div>
      ${u.id ? campo('Attiva', select('attivo', [['1', 'Sì'], ['0', 'No']], u.attivo ? '1' : '0')) : ''}
      ${campo('Note', `<textarea name="note">${h(u.note || '')}</textarea>`, 'pieno')}
      <div class="form-azioni"><button class="btn btn-sec" type="button" id="annulla">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`;
    modale(u.id ? `Modifica ${u.codice}` : 'Nuova ubicazione', html, (box) => {
      $('#annulla', box).onclick = chiudiModale;
      const anteprima = () => {
        const d = datiForm($('#f', box));
        const url = urlMappa({ indirizzo: d.indirizzo, lat: d.lat, lng: d.lng });
        $('#anteprima-mappa', box).innerHTML = url ? `Verifica: <a href="${h(url)}" target="_blank" rel="noopener">apri su Google Maps</a> (le coordinate, se ci sono, vincono sull'indirizzo)` : 'Con indirizzo o coordinate compare il bottone Mappa.';
      };
      ['indirizzo', 'lat', 'lng'].forEach((n) => { $(`[name="${n}"]`, box).oninput = anteprima; });
      anteprima();
      $('#f', box).onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api(u.id ? '/api/ubicazioni/' + u.id : '/api/ubicazioni', { method: u.id ? 'PUT' : 'POST', body: datiForm(e.target) });
          ubicazioniCache = null; toast('Ubicazione salvata', 'ok'); chiudiModale(); dopo && dopo();
        } catch (err) { toast(err.message, 'errore'); }
      };
    });
  }

  // ------------------------------------------------------------------ importazioni (quadro vivo)
  let timerImport = null;
  viste.importazioni = async (cont) => {
    clearInterval(timerImport);
    const info = await api('/api/importazioni');
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Alimentazione automatica</div><h2>Importazioni</h2></div>
      <div class="azioni"><span class="stato-ciclo" id="stato-ciclo"><span class="punto punto-grigio"></span><span>…</span></span></div></div>
      <div class="griglia griglia-4" id="kpi-import"></div>
      <div style="height:1.25rem"></div>
      <div class="griglia griglia-2">
        <div class="card"><div class="card-testa"><h3>DDT dal Lettore DDT</h3>${info.ddt_dir_ok ? '<span class="badge badge-verde">Cartella trovata</span>' : '<span class="badge badge-rosso">Cartella assente</span>'}</div>
          <p class="muto mono" style="word-break:break-all">${h(info.ddt_dir)}</p>
          <div class="azioni-rapide"><button class="btn" id="imp-ddt">Leggi adesso</button><button class="btn btn-sec" id="imp-ddt-forza">Rileggi tutto</button></div>
          <div id="commesse"></div></div>
        <div class="card"><div class="card-testa"><h3>Mezzi da VFP Transfer</h3>${info.mezzi_dir_ok ? '<span class="badge badge-verde">Cartella trovata</span>' : '<span class="badge badge-rosso">Cartella assente</span>'}</div>
          <p class="muto mono" style="word-break:break-all">${h(info.mezzi_dir)}</p>
          <div class="azioni-rapide"><button class="btn" id="imp-mezzi">Leggi adesso</button><button class="btn btn-sec" id="imp-mezzi-forza">Rileggi tutto</button></div>
          <div id="pratiche"></div></div>
      </div>
      <div style="height:1.25rem"></div>
      <div class="griglia griglia-2">
        <div class="card"><h3>Carica un JSON a mano</h3><p class="muto">Accetta il <span class="mono">consegne.json</span> di una commessa oppure un export del Lettore DDT (<span class="mono">json_exports/*.json</span>).</p>
          <form id="f-up" class="form"><div class="campo"><label>File JSON</label><input type="file" name="file" accept=".json,application/json" required></div><div class="campo"><label>Commessa / cantiere (per gli export grezzi)</label><input name="commessa" placeholder="es. demo-augusta"></div>
          <div class="form-azioni"><button class="btn" type="submit">Importa</button></div></form><div id="esito-up"></div></div>
        <div class="card"><div class="card-testa"><h3>Errori recenti</h3></div><div id="errori"></div></div>
      </div>
      <div class="card"><div class="card-testa"><h3>Storico importazioni</h3><button class="btn btn-sec btn-piccolo" id="mostra-storico">Mostra</button></div><div id="storico" hidden></div></div>`;

    const badgeImp = (s) => ({ letto: '<span class="badge badge-verde">Letto</span>', da_leggere: '<span class="badge badge-ambra">Da leggere</span>', errore: '<span class="badge badge-rosso">Errore</span>' }[s] || `<span class="badge">${h(s)}</span>`);
    let ultimoStato = null;

    const disegna = (s) => {
      ultimoStato = s;
      const c = s.ciclo;
      const ciclo = $('#stato-ciclo');
      if (c.in_corso) ciclo.innerHTML = `<span class="punto"></span><span>Lettura ${h(c.in_corso)} in corso…</span>`;
      else if (!c.attivo) ciclo.innerHTML = `<span class="punto punto-grigio"></span><span>Lettura automatica spenta (solo a mano)</span>`;
      else ciclo.innerHTML = `<span class="punto"></span><span>In attesa · ogni ${c.intervallo_sec} s${c.ultimo_fine ? ` · ultimo giro ${fmtData(c.ultimo_fine)}` : ''}${c.prossimo ? ` · prossimo ${fmtData(c.prossimo)}` : ''}</span>`;
      const nExp = s.ddt.reduce((n, co) => n + co.export.length, 0);
      const daLeggere = s.ddt.reduce((n, co) => n + co.export.filter((e) => e.stato === 'da_leggere').length, 0) + s.mezzi.da_leggere;
      const erroriN = s.ddt.reduce((n, co) => n + co.export.filter((e) => e.stato === 'errore').length, 0) + s.mezzi.errori + (s.ddt.filter((co) => co.errore).length);
      const nuoveOggi = s.per_giorno.length ? s.per_giorno[s.per_giorno.length - 1].nuove : 0;
      $('#kpi-import').innerHTML = `
        <div class="card kpi"><div class="etichetta">Export DDT seguiti</div><div class="valore">${nExp}</div><div class="muto">${s.ddt.length} commesse</div></div>
        <div class="card kpi"><div class="etichetta">Pratiche mezzi</div><div class="valore">${s.mezzi.pratiche}</div><div class="muto">${s.mezzi.importate} importate</div></div>
        <div class="card kpi"><div class="etichetta">Da leggere</div><div class="valore" ${daLeggere ? 'style="color:var(--ambra)"' : ''}>${daLeggere}</div><div class="muto">${erroriN ? `<span style="color:var(--rosso)">${erroriN} in errore</span>` : 'nessun errore'}</div></div>
        <div class="card kpi"><div class="etichetta">Righe nuove oggi</div><div class="valore">${nuoveOggi}</div><div class="kpi-trend">${window.Grafici.sparkline(s.per_giorno.map((g) => g.nuove), '#1477b8')}<span class="muto">ultimi 14 giorni</span></div></div>`;
      $('#commesse').innerHTML = s.ddt.length ? s.ddt.map((co) => `<div class="commessa">
          <div class="commessa-testa"><strong>${h(co.commessa)}</strong><span class="muto">registro del ${fmtData(co.modificato)}${co.ultima_lettura ? ` · letto ${fmtData(co.ultima_lettura)}` : ''}</span></div>
          ${co.errore ? `<div class="avviso avviso-errore">${h(co.errore)}</div>` : ''}
          ${co.export.length ? `<table class="tabella-mini"><tbody>${co.export.map((e) => `<tr><td>${h(e.export)}<br><span class="muto">salvato ${fmtData(e.salvato_il)} · ${e.righe_registro} righe nel registro</span>${e.dettaglio ? `<br><span class="muto" style="color:var(--ambra)">${h(e.dettaglio)}</span>` : ''}</td><td class="num">${e.importato_il ? `${e.righe} righe<br><span class="muto">${e.nuove} nuove</span>` : '—'}</td><td>${badgeImp(e.stato)}</td></tr>`).join('')}</tbody></table>` : '<p class="muto">Nessun export nel registro.</p>'}
        </div>`).join('') : '<p class="muto">Nessuna commessa con registro consegne.</p>';
      $('#pratiche').innerHTML = s.mezzi.voci.length ? `<table class="tabella-mini"><tbody>${s.mezzi.voci.map((v) => `<tr><td>${v.mezzo ? `<a href="#scansione/${h(v.mezzo.codice)}">${h([v.mezzo.tipo_mezzo, v.mezzo.marca, v.mezzo.modello].filter(Boolean).join(' '))}</a>` : '<span class="muto">non ancora importato</span>'}<br><span class="muto mono">${h(v.pratica)}</span>${v.dettaglio ? `<br><span class="muto" style="color:var(--ambra)">${h(v.dettaglio)}</span>` : ''}</td><td class="muto">${v.importato_il ? fmtData(v.importato_il) : ''}</td><td>${badgeImp(v.stato)}</td></tr>`).join('')}</tbody></table>` : '<p class="muto">Nessuna pratica mezzi trovata.</p>';
      $('#errori').innerHTML = s.errori.length ? `<table class="tabella-mini"><tbody>${s.errori.map((e) => `<tr><td class="muto" style="white-space:nowrap">${fmtData(e.ts)}</td><td>${badgeOrigine(e.sorgente)} ${h(e.chiave || '')}<br><span class="muto">${h(e.dettaglio || '')}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muto">Nessun errore: tutte le letture sono andate a buon fine.</p>';
    };

    const aggiorna = async () => {
      try { disegna(await api('/api/importazioni/stato')); } catch (e) { $('#stato-ciclo').innerHTML = `<span class="punto punto-rosso"></span><span>${h(e.message)}</span>`; }
    };
    const lancia = (sorgente, forza) => async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Lettura…';
      try { const r = await api('/api/importazioni/' + sorgente, { method: 'POST', body: { forza } }); toast(`${sorgente}: ${r.totale} voci lette`, 'ok'); ubicazioniCache = null; }
      catch (e) { toast(e.message, 'errore'); }
      b.disabled = false; b.textContent = forza ? 'Rileggi tutto' : 'Leggi adesso';
      aggiorna();
    };
    $('#imp-ddt').onclick = lancia('ddt', false); $('#imp-ddt-forza').onclick = lancia('ddt', true);
    $('#imp-mezzi').onclick = lancia('mezzi', false); $('#imp-mezzi-forza').onclick = lancia('mezzi', true);
    $('#f-up').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/importazioni/upload', { method: 'POST', body: new FormData(e.target) });
        $('#esito-up').innerHTML = `<div class="avviso avviso-ok">${r.esiti.map((x) => `${h(x.export)}: ${x.righe} righe, ${x.nuove} nuove${x.scartate ? `, ${x.scartate} scartate` : ''}`).join('<br>')}</div>`;
        ubicazioniCache = null; toast('Importato', 'ok'); aggiorna();
      } catch (err) { $('#esito-up').innerHTML = `<div class="avviso avviso-errore">${h(err.message)}</div>`; }
    };
    $('#mostra-storico').onclick = async (ev) => {
      const box = $('#storico');
      if (!box.hidden) { box.hidden = true; ev.currentTarget.textContent = 'Mostra'; return; }
      const d = await api('/api/importazioni');
      box.innerHTML = d.storico.length ? `<div class="tabella-wrap"><table><thead><tr><th>Quando</th><th>Sorgente</th><th>Chiave</th><th class="num">Righe</th><th class="num">Nuove</th><th>Esito</th></tr></thead><tbody>
        ${d.storico.map((s) => `<tr><td class="muto" style="white-space:nowrap">${fmtData(s.ts)}</td><td>${badgeOrigine(s.sorgente)}</td><td>${h(s.chiave || s.file)}${s.dettaglio ? `<br><span class="muto">${h(s.dettaglio)}</span>` : ''}</td><td class="num">${s.righe}</td><td class="num">${s.nuove}</td><td>${s.esito === 'ok' ? '<span class="badge badge-verde">ok</span>' : '<span class="badge badge-rosso">errore</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muto">Nessuna importazione ancora.</p>';
      box.hidden = false; ev.currentTarget.textContent = 'Nascondi';
    };
    await aggiorna();
    // Polling finché la vista resta aperta: il ciclo di sfondo cambia stato da solo.
    timerImport = setInterval(() => { if (location.hash.startsWith('#importazioni')) aggiorna(); else clearInterval(timerImport); }, 5000);
  };

  // ------------------------------------------------------------------ flussi (grafici dei movimenti)
  viste.flussi = async (cont) => {
    const lista = await ubicazioni();
    const stato = { giorni: 30, ubi: '' };
    try { Object.assign(stato, JSON.parse(localStorage.getItem('flussi-filtri') || '{}')); } catch (_) { /* niente */ }
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Spostamenti del materiale</div><h2>Flussi</h2></div></div>
      <div class="filtri" id="filtri">
        <div class="segmenti" id="periodo">${[[7, '7 giorni'], [30, '30 giorni'], [90, '90 giorni'], [365, 'Un anno']].map(([g, t]) => `<button type="button" data-g="${g}" class="${g == stato.giorni ? 'attivo' : ''}">${t}</button>`).join('')}</div>
        <select id="ubi">${opzioniUbicazioni(lista, stato.ubi, 'Tutte le ubicazioni')}</select>
        <label class="muto"><input type="checkbox" id="tabelle"> mostra tabelle</label></div>
      <div class="griglia griglia-4" id="kpi"></div>
      <div style="height:1.25rem"></div>
      <div class="card"><div class="card-testa"><div><h3>Movimenti per giorno</h3><p class="muto" style="margin:0">Quanti movimenti al giorno, per tipo. Le quantità non si sommano fra articoli diversi: qui si contano i movimenti.</p></div></div>
        <div class="grafico" id="g-giorni"></div><div class="tabella-grafico" id="t-giorni" hidden></div></div>
      <div class="card"><div class="card-testa"><div><h3>Da dove a dove</h3><p class="muto" style="margin:0">Fornitori → ubicazioni (carichi), fra ubicazioni (trasferimenti), ubicazioni → consumo (scarichi). Spessore = numero di movimenti.</p></div></div>
          <div class="grafico" id="g-flusso"></div><div class="tabella-grafico" id="t-flusso" hidden></div></div>
      <div class="card"><div class="card-testa"><div><h3>Ubicazioni più movimentate</h3><p class="muto" style="margin:0">Movimenti in entrata e in uscita per ubicazione.</p></div></div>
          <div class="grafico" id="g-ubi"></div><div class="tabella-grafico" id="t-ubi" hidden></div></div>`;
    const carica = async () => {
      localStorage.setItem('flussi-filtri', JSON.stringify(stato));
      cont.querySelectorAll('.grafico').forEach((g) => { g.style.opacity = '0.5'; });
      const d = await api(`/api/statistiche?giorni=${stato.giorni}&ubicazione_id=${stato.ubi}`);
      const t = d.totali;
      $('#kpi').innerHTML = `
        <div class="card kpi"><div class="etichetta">Movimenti</div><div class="valore">${t.totale}</div><div class="muto">${t.articoli_mossi} articoli mossi</div></div>
        <div class="card kpi"><div class="etichetta">Carichi</div><div class="valore">${t.carico}</div><div class="kpi-trend">${window.Grafici.sparkline(d.per_giorno.slice(-14).map((g) => g.carico), window.Grafici.SERIE.carico.colore)}<span class="muto">ultimi 14 gg</span></div></div>
        <div class="card kpi"><div class="etichetta">Scarichi</div><div class="valore">${t.scarico}</div><div class="kpi-trend">${window.Grafici.sparkline(d.per_giorno.slice(-14).map((g) => g.scarico), window.Grafici.SERIE.scarico.colore)}<span class="muto">ultimi 14 gg</span></div></div>
        <div class="card kpi"><div class="etichetta">Trasferimenti</div><div class="valore">${t.trasferimento}</div><div class="muto">${t.rettifica + t.inventario} rettifiche e inventari</div></div>`;
      window.Grafici.colonneImpilate($('#g-giorni'), d.per_giorno, ['carico', 'trasferimento', 'scarico', 'rettifica']);
      window.Grafici.flusso($('#g-flusso'), d.flussi);
      window.Grafici.barreEntrateUscite($('#g-ubi'), d.ubicazioni);
      const conDati = d.per_giorno.filter((g) => g.carico || g.scarico || g.trasferimento || g.rettifica);
      $('#t-giorni').innerHTML = conDati.length ? `<table><thead><tr><th>Giorno</th><th class="num">Carichi</th><th class="num">Trasferimenti</th><th class="num">Scarichi</th><th class="num">Rettifiche</th></tr></thead><tbody>${conDati.map((g) => `<tr><td>${fmtData(g.data)}</td><td class="num">${g.carico}</td><td class="num">${g.trasferimento}</td><td class="num">${g.scarico}</td><td class="num">${g.rettifica}</td></tr>`).join('')}</tbody></table>` : '<p class="muto">Nessun dato.</p>';
      $('#t-flusso').innerHTML = d.flussi.length ? `<table><thead><tr><th>Da</th><th>A</th><th>Tipo</th><th class="num">Movimenti</th><th>Articoli</th></tr></thead><tbody>${d.flussi.map((a) => `<tr><td>${h(a.da.nome)}</td><td>${h(a.a.nome)}</td><td>${badgeTipoMov(a.tipo)}</td><td class="num">${a.n}</td><td class="muto">${a.articoli.slice(0, 3).map((x) => `${h(x.nome)}: ${fmtN(x.quantita)}`).join('; ')}${a.articoli.length > 3 ? '…' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muto">Nessun dato.</p>';
      $('#t-ubi').innerHTML = d.ubicazioni.length ? `<table><thead><tr><th>Ubicazione</th><th class="num">In entrata</th><th class="num">In uscita</th></tr></thead><tbody>${d.ubicazioni.map((u) => `<tr><td><a href="#scansione/${u.id}:ubicazione">${h(u.nome)}</a></td><td class="num">${u.entrate}</td><td class="num">${u.uscite}</td></tr>`).join('')}</tbody></table>` : '<p class="muto">Nessun dato.</p>';
      cont.querySelectorAll('.grafico').forEach((g) => { g.style.opacity = '1'; });
    };
    $('#periodo').querySelectorAll('button').forEach((b) => { b.onclick = () => { stato.giorni = +b.dataset.g; $('#periodo').querySelectorAll('button').forEach((x) => x.classList.toggle('attivo', x === b)); carica(); }; });
    $('#ubi').value = stato.ubi; $('#ubi').onchange = () => { stato.ubi = $('#ubi').value; carica(); };
    $('#tabelle').onchange = () => { cont.querySelectorAll('.tabella-grafico').forEach((t) => { t.hidden = !$('#tabelle').checked; }); };
    let ridisegna; window.addEventListener('resize', () => { if (!location.hash.startsWith('#flussi')) return; clearTimeout(ridisegna); ridisegna = setTimeout(carica, 300); });
    await carica();
  };

  // ------------------------------------------------------------------ amministrazione (chi ha fatto cosa, chi usa cosa)
  const AZIONI = { scansione: ['', 'Scansione'], movimento: ['verde', 'Movimento'], crea: ['blu', 'Creazione'], modifica: ['blu', 'Modifica'],
    elimina: ['rosso', 'Eliminazione'], elimina_movimento: ['rosso', 'Movimento eliminato'], disattiva: ['ambra', 'Disattivazione'],
    sposta: ['blu', 'Spostamento mezzo'], importazione: ['ambra', 'Importazione'] };
  const badgeAzione = (a) => { const [c, t] = AZIONI[a] || ['', a]; return `<span class="badge ${c ? 'badge-' + c : ''}">${h(t)}</span>`; };
  let timerAdmin = null;
  viste.amministrazione = async (cont) => {
    clearInterval(timerAdmin);
    if (!me.admin) { cont.innerHTML = '<div class="avviso avviso-errore">Area riservata agli amministratori del magazzino.</div>'; return; }
    const stato = { giorni: 30 };
    const utentiNoti = await api('/api/admin/utenti');
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Amministrazione</div><h2>Chi fa cosa</h2></div>
      <div class="azioni"><span class="stato-ciclo" id="adm-live"><span class="punto"></span><span>aggiornamento ogni 15 s</span></span></div></div>
      <div class="filtri"><div class="segmenti" id="adm-periodo">${[[1, 'Oggi'], [7, '7 giorni'], [30, '30 giorni'], [90, '90 giorni']].map(([g, t]) => `<button type="button" data-g="${g}" class="${g === stato.giorni ? 'attivo' : ''}">${t}</button>`).join('')}</div></div>
      <div class="griglia griglia-4" id="adm-kpi"></div>
      <div style="height:1.25rem"></div>
      <div class="griglia griglia-2">
        <div class="card"><div class="card-testa"><div><h3>Collegati adesso</h3><p class="muto" style="margin:0">Chi ha la pagina aperta e cosa sta guardando (ultimi 2 minuti).</p></div></div><div id="adm-presenze"></div></div>
        <div class="card"><div class="card-testa"><div><h3>Chi sta usando i mezzi</h3><p class="muto" style="margin:0">Mezzi in stato "in uso": operatore, ubicazione, chi lo ha registrato.</p></div></div><div id="adm-mezzi"></div></div>
      </div>
      <div style="height:1.25rem"></div>
      <div class="card"><div class="card-testa"><div><h3>Chi ha caricato cosa</h3><p class="muto" style="margin:0">Per utente, nel periodo: movimenti per tipo, scansioni, importazioni, modifiche alle anagrafiche.</p></div></div>
        <div id="adm-utenti"></div></div>
      <div class="card"><div class="card-testa"><div><h3>Registro attività</h3><p class="muto" style="margin:0">Ogni azione con utente, indirizzo IP, oggetto e dettaglio.</p></div>
        <div class="azioni"><button class="btn btn-sec btn-piccolo" id="adm-csv">Esporta CSV</button></div></div>
        <div class="filtri"><select id="adm-utente"><option value="">Tutti gli utenti</option>${utentiNoti.map((u) => `<option>${h(u)}</option>`).join('')}</select>
          <select id="adm-azione"><option value="">Tutte le azioni</option>${Object.entries(AZIONI).map(([k, v]) => `<option value="${k}">${v[1]}</option>`).join('')}</select>
          <select id="adm-oggetto"><option value="">Tutti gli oggetti</option><option value="articolo">Articoli</option><option value="mezzo">Mezzi</option><option value="ubicazione">Ubicazioni</option><option value="ddt">Import DDT</option><option value="mezzi">Import mezzi</option><option value="upload">Upload</option></select>
          <input id="adm-q" placeholder="Cerca nel dettaglio, utente, IP..."></div>
        <div id="adm-registro"></div></div>`;
    let registro = [];
    const caricaRiepilogo = async () => {
      const d = await api(`/api/admin/riepilogo?giorni=${stato.giorni}`);
      const top = d.utenti[0];
      $('#adm-kpi').innerHTML = `
        <div class="card kpi"><div class="etichetta">Collegati adesso</div><div class="valore">${d.collegati.length}</div><div class="muto">${d.collegati.map((p) => h(p.nome)).join(', ') || 'nessuno'}</div></div>
        <div class="card kpi"><div class="etichetta">Utenti attivi</div><div class="valore">${d.utenti_attivi}</div><div class="muto">nel periodo</div></div>
        <div class="card kpi"><div class="etichetta">Azioni oggi</div><div class="valore">${d.attivita_oggi}</div><div class="muto">registrate</div></div>
        <div class="card kpi"><div class="etichetta">Più attivo</div><div class="valore" style="font-size:1.3rem">${top ? h(top.utente) : '—'}</div><div class="muto">${top ? `${top.movimenti} movimenti · ${top.scansioni} scansioni` : ''}</div></div>`;
      $('#adm-presenze').innerHTML = d.collegati.length ? `<table class="tabella-mini"><thead><tr><th>Utente</th><th>Vista</th><th>IP</th><th>Dal</th></tr></thead><tbody>${d.collegati.map((p) => `<tr><td><strong>${h(p.nome)}</strong>${p.admin ? ' <span class="badge badge-blu">admin</span>' : ''}</td><td>${h(p.vista || '—')}</td><td class="mono muto">${h(p.ip)}</td><td class="muto">${fmtData(p.dal)}</td></tr>`).join('')}</tbody></table>` : '<p class="muto">Nessun altro collegato in questo momento.</p>';
      $('#adm-mezzi').innerHTML = d.mezzi_in_uso.length ? `<table class="tabella-mini"><thead><tr><th>Mezzo</th><th>In uso da</th><th>Dove</th><th>Registrato da</th></tr></thead><tbody>${d.mezzi_in_uso.map((m) => `<tr><td><a href="#scansione/${h(m.codice)}">${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))}</a><br><span class="muto mono">${h(m.targa || m.codice)}</span></td><td>${m.assegnato_a ? `<strong>${h(m.assegnato_a)}</strong>` : '<span class="badge badge-ambra">non indicato</span>'}</td><td>${h(m.ubicazione || '—')}</td><td class="muto">${h(m.registrato_da || '')}<br>${fmtData(m.dal)}</td></tr>`).join('')}</tbody></table>` : '<p class="muto">Nessun mezzo in uso.</p>';
      $('#adm-utenti').innerHTML = d.utenti.length ? `<div class="tabella-wrap"><table><thead><tr><th>Utente</th><th class="num">Carichi</th><th class="num">Scarichi</th><th class="num">Trasferimenti</th><th class="num">Rettifiche</th><th class="num">Scansioni</th><th class="num">Importazioni</th><th class="num">Anagrafiche</th><th>Ultima attività</th><th></th></tr></thead><tbody>
        ${d.utenti.map((u) => `<tr><td><strong>${h(u.utente)}</strong></td><td class="num">${u.carico}</td><td class="num">${u.scarico}</td><td class="num">${u.trasferimento}</td><td class="num">${u.rettifica}</td><td class="num">${u.scansioni}</td><td class="num">${u.importazioni}</td><td class="num">${u.anagrafiche}</td><td class="muto">${fmtData(u.ultima)}</td><td><button class="btn btn-sec btn-piccolo" data-utente="${h(u.utente)}">Dettaglio</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muto">Nessuna attività nel periodo.</p>';
      $('#adm-utenti').querySelectorAll('[data-utente]').forEach((b) => { b.onclick = () => { $('#adm-utente').value = b.dataset.utente; caricaRegistro(); $('#adm-registro').scrollIntoView({ behavior: 'smooth' }); }; });
    };
    const caricaRegistro = async () => {
      registro = await api(`/api/admin/attivita?giorni=${stato.giorni}&utente=${encodeURIComponent($('#adm-utente').value)}&azione=${$('#adm-azione').value}&oggetto=${$('#adm-oggetto').value}&q=${encodeURIComponent($('#adm-q').value)}`);
      $('#adm-registro').innerHTML = registro.length ? `<div class="tabella-wrap"><table><thead><tr><th>Quando</th><th>Utente</th><th>IP</th><th>Azione</th><th>Oggetto</th><th>Dettaglio</th></tr></thead><tbody>
        ${registro.map((a) => `<tr><td class="muto" style="white-space:nowrap">${fmtData(a.ts)}</td><td><strong>${h(a.utente)}</strong></td><td class="mono muto">${h(a.ip || '')}</td><td>${badgeAzione(a.azione)}</td>
          <td>${a.oggetto_codice ? `<a href="#scansione/${h(a.oggetto_codice)}">${h(a.oggetto_nome || a.oggetto_codice)}</a> <span class="muto mono">${h(a.oggetto_codice)}</span>` : h(a.oggetto || '')}</td><td class="muto">${h(a.descrizione || '')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muto">Nessuna attività con questi filtri.</p>';
    };
    $('#adm-periodo').querySelectorAll('button').forEach((b) => { b.onclick = () => { stato.giorni = +b.dataset.g; $('#adm-periodo').querySelectorAll('button').forEach((x) => x.classList.toggle('attivo', x === b)); caricaRiepilogo(); caricaRegistro(); }; });
    ['adm-utente', 'adm-azione', 'adm-oggetto'].forEach((id) => { $('#' + id).onchange = caricaRegistro; });
    let t; $('#adm-q').oninput = () => { clearTimeout(t); t = setTimeout(caricaRegistro, 250); };
    $('#adm-csv').onclick = () => {
      const csv = ['Quando;Utente;IP;Azione;Oggetto;Codice;Dettaglio', ...registro.map((a) => [a.ts, a.utente, a.ip, a.azione, a.oggetto_nome || a.oggetto || '', a.oggetto_codice || '', a.descrizione || ''].map((x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(';'))].join('\r\n');
      const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); el.download = 'registro-attivita.csv'; el.click();
    };
    await Promise.all([caricaRiepilogo(), caricaRegistro()]);
    timerAdmin = setInterval(() => { if (location.hash.startsWith('#amministrazione')) caricaRiepilogo(); else clearInterval(timerAdmin); }, 15000);
  };

  // ------------------------------------------------------------------ foto dei mezzi e lettura targa
  const urlRicercaMezzo = (m) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent([m.marca, m.modello, m.tipo_mezzo].filter(Boolean).join(' '))}`;

  function galleriaMezzo(m, foto) {
    const lista = foto || [];
    return `<div id="galleria" style="margin-top:1.25rem"><div class="card-testa"><h4>Foto del mezzo${lista.length ? ` (${lista.length})` : ''}</h4>
        <div class="azioni"><label class="btn btn-sec btn-piccolo" style="cursor:pointer">${ICONE_FOTO} Aggiungi foto<input type="file" id="foto-input" accept="image/*" multiple hidden></label>
          <button class="btn btn-sec btn-piccolo" type="button" data-leggi-targa>Leggi targa da foto</button>
          <a class="btn ${lista.length ? 'btn-sec' : ''} btn-piccolo" href="${h(urlRicercaMezzo(m))}" target="_blank" rel="noopener" title="Cerca immagini di questo mezzo su internet">Cerca su internet</a></div></div>
      ${lista.length ? `<div class="galleria">${lista.map((f) => `<figure class="foto ${f.principale ? 'principale' : ''}">
          <a href="/api/mezzi/${m.id}/foto/${f.id}" target="_blank" rel="noopener"><img src="/api/mezzi/${m.id}/foto/${f.id}?dim=min" alt="${h(f.nota || f.nome_originale || 'foto')}" loading="lazy"></a>
          <figcaption><span class="muto">${fmtData(f.caricato_il)}${f.utente ? ' · ' + h(f.utente) : ''}${f.nota ? '<br>' + h(f.nota) : ''}</span>
            <span class="foto-azioni">${f.principale ? '<span class="badge badge-blu">Principale</span>' : `<button class="btn btn-sec btn-piccolo" data-foto-principale="${f.id}">Principale</button>`}${me.admin ? ` <button class="btn btn-rosso btn-piccolo" data-foto-elimina="${f.id}">Elimina</button>` : ''}</span></figcaption></figure>`).join('')}</div>`
        : `<p class="muto">Nessuna foto: aggiungine una dal telefono oppure <a href="${h(urlRicercaMezzo(m))}" target="_blank" rel="noopener">cerca il mezzo su internet</a> (${h([m.marca, m.modello, m.tipo_mezzo].filter(Boolean).join(' '))}).</p>`}
      <div id="foto-esito"></div></div>`;
  }

  async function caricaFotoMezzo(mezzoId, files, nota) {
    const fd = new FormData();
    [...files].forEach((f) => fd.append('foto', f));
    if (nota) fd.append('nota', nota);
    return api(`/api/mezzi/${mezzoId}/foto`, { method: 'POST', body: fd });
  }

  function agganciaGalleria(box, m, dopo) {
    const inp = $('#foto-input', box);
    if (inp) inp.onchange = async () => {
      if (!inp.files.length) return;
      $('#foto-esito', box).innerHTML = '<div class="avviso">Caricamento foto…</div>';
      try {
        const r = await caricaFotoMezzo(m.id, inp.files);
        toast(`${r.salvate.length} foto salvate`, 'ok');
        if (r.errori.length) toast(r.errori.map((e) => `${e.file}: ${e.errore}`).join('; '), 'errore');
        dopo();
      } catch (e) { $('#foto-esito', box).innerHTML = `<div class="avviso avviso-errore">${h(e.message)}</div>`; }
    };
    box.querySelectorAll('[data-foto-principale]').forEach((b) => { b.onclick = async () => { try { await api(`/api/mezzi/${m.id}/foto/${b.dataset.fotoPrincipale}/principale`, { method: 'POST', body: {} }); dopo(); } catch (e) { toast(e.message, 'errore'); } }; });
    box.querySelectorAll('[data-foto-elimina]').forEach((b) => { b.onclick = async () => { if (!confirm('Eliminare questa foto?')) return; try { await api(`/api/mezzi/${m.id}/foto/${b.dataset.fotoElimina}`, { method: 'DELETE' }); toast('Foto eliminata', 'ok'); dopo(); } catch (e) { toast(e.message, 'errore'); } }; });
    const lt = box.querySelector('[data-leggi-targa]');
    if (lt) lt.onclick = () => modaleLeggiTarga(async (targa, file, salvaFoto) => {
      try {
        const dati = Object.assign({}, m, { targa });
        await api(`/api/mezzi/${m.id}`, { method: 'PUT', body: dati });
        if (salvaFoto && file) await caricaFotoMezzo(m.id, [file], 'foto targa');
        toast(`Targa ${targa} salvata`, 'ok'); chiudiModale(); dopo();
      } catch (e) { toast(e.message, 'errore'); }
    }, m);
  }

  // Modale: scegli/scatta una foto, l'OCR propone le targhe trovate, l'utente conferma.
  function modaleLeggiTarga(onScelta, mezzo) {
    const html = `<div class="form">
      <div class="campo pieno"><label>Foto della targa (inquadrala da vicino, dritta e ben illuminata)</label><input type="file" id="targa-file" accept="image/*" capture="environment"></div>
      <div class="pieno" id="targa-anteprima"></div>
      <div class="pieno" id="targa-stato" class="muto">In attesa della foto.</div>
      <div class="pieno" id="targa-candidati"></div>
      <div class="campo pieno"><label>Oppure scrivila a mano</label><div style="display:flex;gap:.5rem"><input id="targa-manuale" placeholder="AA123BB" style="text-transform:uppercase;font-family:var(--font-mono)"><button class="btn btn-piccolo" type="button" id="targa-usa-manuale">Usa</button></div></div>
      ${mezzo ? `<label class="pieno muto"><input type="checkbox" id="targa-salva-foto" checked> salva anche la foto fra quelle del mezzo</label>` : ''}
    </div>`;
    modale('Leggi la targa da una foto', html, (box) => {
      let fileCorrente = null;
      const scegli = (t) => onScelta(t, fileCorrente, mezzo ? $('#targa-salva-foto', box).checked : false);
      $('#targa-usa-manuale', box).onclick = () => { const t = $('#targa-manuale', box).value.replace(/\s+/g, '').toUpperCase(); if (t) scegli(t); };
      $('#targa-manuale', box).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#targa-usa-manuale', box).click(); } };
      $('#targa-file', box).onchange = async () => {
        const f = $('#targa-file', box).files[0];
        if (!f) return;
        fileCorrente = f;
        $('#targa-anteprima', box).innerHTML = `<img src="${URL.createObjectURL(f)}" alt="anteprima" style="max-width:100%;max-height:220px;border-radius:4px;border:1px solid var(--cosedil-border)">`;
        const stato = $('#targa-stato', box);
        stato.innerHTML = '<div class="avviso">Lettura in corso… <span id="targa-pct">0</span>% <span class="muto">(la prima volta scarica il lettore OCR, qualche secondo)</span></div>';
        $('#targa-candidati', box).innerHTML = '';
        try {
          const r = await window.Targa.leggi(f, (p) => { const el = $('#targa-pct', box); if (el) el.textContent = p; });
          if (r.candidati.length) {
            stato.innerHTML = `<div class="avviso avviso-ok">Targhe trovate: scegli quella giusta.</div>`;
            $('#targa-candidati', box).innerHTML = `<div class="candidati">${r.candidati.map((c) => `<button type="button" class="candidato" data-t="${h(c.targa)}"><span class="mono">${h(c.targa)}</span><small>${h(c.formato)}${c.corretta ? ' · corretta O/0, B/8…' : ''}</small></button>`).join('')}</div><details class="muto"><summary>Testo letto</summary><pre style="white-space:pre-wrap">${h(r.testo.trim() || '(vuoto)')}</pre></details>`;
            box.querySelectorAll('.candidato').forEach((b) => { b.onclick = () => scegli(b.dataset.t); });
            $('#targa-manuale', box).value = r.candidati[0].targa;
          } else {
            stato.innerHTML = `<div class="avviso">Nessuna targa riconosciuta: riprova più da vicino o scrivila a mano.</div>` + (r.testo.trim() ? `<details class="muto"><summary>Testo letto</summary><pre style="white-space:pre-wrap">${h(r.testo.trim())}</pre></details>` : '');
          }
        } catch (e) { stato.innerHTML = `<div class="avviso avviso-errore">${h(e.message)}</div>`; }
      };
    });
  }

  // ------------------------------------------------------------------ mobile: operatore, cerca, installazione
  // Pagina di partenza sul telefono: pochi tasti grandi, i movimenti di oggi dell'operatore
  // e lo stato della connessione. Dal computer resta raggiungibile dal menu.
  let promptInstallazione = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); promptInstallazione = e;
    // Se la vista Operatore è già disegnata, il banner compare adesso con il suo tasto.
    const b = $('#installa-avviso');
    if (b) { b.hidden = false; if (!$('#btn-installa')) { b.insertAdjacentHTML('beforeend', '<button class="btn btn-piccolo" id="btn-installa" type="button">Installa</button>'); $('#btn-installa').onclick = installa; } }
  });
  async function installa() { const p = promptInstallazione; if (!p) return; p.prompt(); await p.userChoice; promptInstallazione = null; const b = $('#installa-avviso'); if (b) b.hidden = true; }

  viste.operatore = async (cont) => {
    const oggi = new Date().toISOString().slice(0, 10);
    const [d, miei] = await Promise.all([api('/api/dashboard'), api(`/api/movimenti?utente=${encodeURIComponent(me.username || '')}&data=${oggi}&limite=20`).catch(() => [])]);
    const nome = me.nome || me.username || 'Operatore';
    const iniziali = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    cont.innerHTML = `
      <div class="operatore-saluto"><span class="avatar">${h(iniziali)}</span><div><strong>Ciao, ${h(nome.split(/\s+/)[0])}</strong><span class="muto">${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div></div>
      <div class="chip-riga">
        <span class="chip chip-stato ${navigator.onLine ? '' : 'offline'}" id="chip-rete">${navigator.onLine ? 'In linea' : 'Senza rete'}</span>
        <a class="chip" href="#movimenti"><b>${d.movimenti_oggi}</b> movimenti oggi</a>
        ${d.sotto_scorta.length ? `<a class="chip rosso" href="#dashboard"><b>${d.sotto_scorta.length}</b> sotto scorta</a>` : ''}
      </div>
      <div class="installa-avviso" id="installa-avviso" ${promptInstallazione || (iOS && !standalone) ? '' : 'hidden'}>
        ${ICONE.scan}<span>${iOS && !promptInstallazione ? 'Per averla come app: Condividi, poi "Aggiungi alla schermata Home".' : 'Aggiungi il Magazzino alla schermata Home del telefono.'}</span>
        ${promptInstallazione ? '<button class="btn btn-piccolo" id="btn-installa" type="button">Installa</button>' : ''}
      </div>
      <div class="tasti-grandi">
        <a class="tasto-grande primario" href="#scansione/camera">${ICONE.camera}Scansiona<small>Inquadra il codice a barre o il QR con la fotocamera</small></a>
        <a class="tasto-grande" href="#cerca">${ICONE.cerca}Cerca<small>Articolo, mezzo, targa o ubicazione</small></a>
        <a class="tasto-grande" href="#scansione">${ICONE.scan}Digita codice<small>Lettore Bluetooth o codice a mano</small></a>
        <a class="tasto-grande" href="#mezzi">${ICONE.truck}Mezzi<small>Dove sono e chi li usa</small></a>
        <a class="tasto-grande" href="#ubicazioni">${ICONE.pin}Cantieri<small>Ubicazioni e mappa</small></a>
      </div>
      <div class="card"><div class="card-testa"><h3>Le tue registrazioni di oggi</h3><a href="#movimenti" class="muto">Tutte</a></div>
        ${miei.length ? `<ul class="elenco">${miei.map((m) => `<li data-cod="${h(m.codice)}"><span class="icona-tipo">${ICONE.box}</span><div class="testo"><strong>${h(m.descrizione)}</strong><span>${h(m.tipo)} · ${h(m.a_nome || m.da_nome || m.fornitore || '')} · ${fmtData(m.ts).split(',')[1] || ''}</span></div><div class="destra">${fmtN(m.quantita)}<small>${h(m.um)}</small></div>${ICONE.freccia}</li>`).join('')}</ul>`
          : '<p class="muto">Niente ancora: scansiona un codice e registra carico, scarico o spostamento.</p>'}</div>
      <div style="height:1rem"></div>
      <div class="card"><div class="card-testa"><h3>Dove sta cosa</h3><a href="#ubicazioni" class="muto">Tutte</a></div>
        ${d.per_ubicazione.length ? `<ul class="elenco">${d.per_ubicazione.map((u) => `<li data-ubi="${u.id}"><span class="icona-tipo">${ICONE.pin}</span><div class="testo"><strong>${h(u.nome)}</strong><span>${h(ETICH_TIPO_UBI[u.tipo] || u.tipo)}</span></div><div class="destra">${u.articoli}<small>articoli</small></div><div class="destra">${u.mezzi}<small>mezzi</small></div>${ICONE.freccia}</li>`).join('')}</ul>` : vuoto('Nessuna ubicazione')}</div>`;
    cont.querySelectorAll('[data-cod]').forEach((li) => { li.onclick = () => { location.hash = '#scansione/' + li.dataset.cod; }; });
    cont.querySelectorAll('[data-ubi]').forEach((li) => { li.onclick = () => { location.hash = `#scansione/${li.dataset.ubi}:ubicazione`; }; });
    const bi = $('#btn-installa');
    if (bi) bi.onclick = installa;
  };

  // Ricerca unica: articoli, mezzi e ubicazioni in un elenco da dito, tocchi e vai alla scheda.
  viste.cerca = async (cont, arg) => {
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Trova</div><h2>Cerca</h2></div></div>
      <div class="cerca-grande">${ICONE.cerca}<input id="q" placeholder="Articolo, mezzo, targa, cantiere..." autocomplete="off" autocapitalize="off" value="${h(arg ? decodeURIComponent(arg) : '')}"></div>
      <div id="esiti"></div>`;
    const inp = $('#q');
    const esiti = $('#esiti');
    const riga = (cod, icona, titolo, sotto, destra) => `<li data-cod="${h(cod)}"><span class="icona-tipo">${icona}</span><div class="testo"><strong>${h(titolo)}</strong><span>${h(sotto)}</span></div>${destra ? `<div class="destra">${destra}</div>` : ''}${ICONE.freccia}</li>`;
    const carica = async () => {
      const q = inp.value.trim();
      if (q.length < 2) { esiti.innerHTML = '<p class="muto">Scrivi almeno due lettere: descrizione, codice, targa, matricola o nome del cantiere.</p>'; return; }
      esiti.innerHTML = skeleton(4);
      const ql = q.toLowerCase();
      const [arts, mezzi, ubi] = await Promise.all([api(`/api/articoli?q=${encodeURIComponent(q)}`), api(`/api/mezzi?q=${encodeURIComponent(q)}`), ubicazioni()]);
      const u = ubi.filter((x) => [x.nome, x.codice, x.commessa, x.indirizzo].some((v) => v && String(v).toLowerCase().includes(ql)));
      if (inp.value.trim() !== q) return;
      if (!arts.length && !mezzi.length && !u.length) { esiti.innerHTML = vuoto(`Niente per "${q}"`); return; }
      esiti.innerHTML = `<div class="card">
        ${arts.length ? `<div class="cerca-sezione">Articoli (${arts.length})</div><ul class="elenco">${arts.slice(0, 30).map((a) => riga(a.codice, ICONE.box, a.descrizione, [a.codice, a.categoria, a.fornitore].filter(Boolean).join(' · '), a.totale != null ? `${fmtN(a.totale)}<small>${h(a.um)}</small>` : '')).join('')}</ul>` : ''}
        ${mezzi.length ? `<div class="cerca-sezione">Mezzi (${mezzi.length})</div><ul class="elenco">${mezzi.slice(0, 30).map((m) => riga(m.codice, m.foto_id ? `<img src="/api/mezzi/${m.id}/foto/${m.foto_id}?dim=min" alt="">` : ICONE.truck, [m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '), [m.targa, m.ubicazione, m.assegnato_a ? 'in uso da ' + m.assegnato_a : ''].filter(Boolean).join(' · '), badgeStato(m.stato))).join('')}</ul>` : ''}
        ${u.length ? `<div class="cerca-sezione">Ubicazioni (${u.length})</div><ul class="elenco">${u.slice(0, 30).map((x) => riga(x.codice, ICONE.pin, x.nome, [ETICH_TIPO_UBI[x.tipo] || x.tipo, x.commessa, x.indirizzo].filter(Boolean).join(' · '))).join('')}</ul>` : ''}
      </div>`;
      esiti.querySelectorAll('[data-cod]').forEach((li) => { li.onclick = () => { location.hash = '#scansione/' + li.dataset.cod; }; });
    };
    let t; inp.oninput = () => { clearTimeout(t); t = setTimeout(carica, 250); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); carica(); } };
    if (!MOBILE.matches || arg) inp.focus();
    await carica();
  };

  // Tabelle larghe sul telefono: ogni cella si porta dietro l'etichetta della colonna
  // (il CSS a schede la mostra sopra il valore); l'ultima colonna di soli bottoni diventa la riga delle azioni.
  function adattaTabelle(cont) {
    cont.querySelectorAll('.tabella-wrap > table').forEach((t) => {
      const th = [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim());
      if (th.length < 4) return;
      t.classList.add('schede-mobile');
      t.querySelectorAll('tbody tr').forEach((tr) => {
        [...tr.children].forEach((td, i) => {
          td.dataset.l = th[i] || '';
          if (!th[i] && td.children.length && [...td.children].every((c) => c.classList.contains('btn'))) td.classList.add('cella-azioni');
        });
      });
    });
  }

  // ------------------------------------------------------------------ dialogo con InCampo e SkyTower
  // Nella scheda di un'ubicazione con codice commessa: task e non conformità del cantiere (InCampo),
  // documenti pubblicati (SkyTower), segnalazioni e invio del report giacenze. Le altre app possono
  // essere spente: il pannello lo dice e basta, il resto della scheda funziona.
  const MARCHIO = (n) => `<span class="suite-marchio">${h(n)}</span>`;
  const fmtStatoTask = (s) => ({ open: 'Aperto', assigned: 'Assegnato', resolved: 'Risolto', verified: 'Verificato' }[s] || s);

  function pannelliSuite(commessa) {
    return `<div class="griglia griglia-2 suite-pannelli" data-commessa="${h(commessa)}">
      <div class="suite-pannello" id="suite-incampo"><div class="card-testa"><h4>${MARCHIO('InCampo')} Cantiere</h4></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div class="suite-pannello" id="suite-skytower"><div class="card-testa"><h4>${MARCHIO('SkyTower')} Documenti pubblicati</h4></div><div class="skeleton"></div><div class="skeleton"></div></div>
    </div>`;
  }

  async function caricaPannelliSuite(box, commessa, contesto) {
    const inc = $('#suite-incampo', box), sky = $('#suite-skytower', box);
    if (!inc || !sky) return;
    const errore = (el, e, nome) => { el.innerHTML = `<div class="card-testa"><h4>${MARCHIO(nome)}</h4></div><p class="muto">${h(e.message)}</p>`; };
    api(`/api/incampo/commessa/${encodeURIComponent(commessa)}`).then((d) => {
      const cant = d.cantieri || [];
      inc.innerHTML = `<div class="card-testa"><h4>${MARCHIO('InCampo')} ${h(d.commessa && d.commessa.name || 'Cantiere')}</h4>
          <div class="azioni"><button class="btn btn-piccolo" type="button" id="btn-segnala">Segnala in InCampo</button>${d.commessa && d.commessa.url ? `<a class="btn btn-sec btn-piccolo" href="${h(d.commessa.url)}" target="_blank" rel="noopener">Apri</a>` : ''}</div></div>
        ${cant.length ? `<div class="chip-riga">${cant.map((c) => `<a class="chip" href="${h(c.url || '#')}" target="_blank" rel="noopener" title="${h(c.address || '')}">${h(c.name)} <b>${c.task_aperti}</b> task · <b>${c.nc_aperte}</b> NC</a>`).join('')}</div>` : '<p class="muto">Nessun cantiere InCampo con questa commessa.</p>'}
        <h4 style="margin-top:.5rem">Task aperti (${(d.task || []).length})</h4>
        ${(d.task || []).length ? `<ul class="elenco">${d.task.slice(0, 8).map((t) => `<li onclick="window.open('${h(t.url || '#')}','_blank')"><div class="testo"><strong>${h(t.title)}</strong><span>${fmtStatoTask(t.status)}${t.assigned_to_name ? ' · ' + h(t.assigned_to_name) : ''}${t.due_date ? ' · scade ' + fmtData(t.due_date) : ''}${t.plan_name ? ' · ' + h(t.plan_name) : ''}${t.pin_label ? ' / ' + h(t.pin_label) : ''}</span></div>${ICONE.freccia}</li>`).join('')}</ul>${d.task.length > 8 ? `<p class="muto">e altri ${d.task.length - 8}</p>` : ''}` : '<p class="muto">Nessun task aperto.</p>'}
        <h4 style="margin-top:.75rem">Non conformità (${(d.nc || []).length})</h4>
        ${(d.nc || []).length ? `<ul class="elenco">${d.nc.slice(0, 8).map((n) => `<li onclick="window.open('${h(n.url || '#')}','_blank')"><div class="testo"><strong>${h(n.template_name || 'Modulo')}${n.value ? ' · ' + h(n.value) : ''}</strong><span>${fmtData(n.created_at)}${n.plan_name ? ' · ' + h(n.plan_name) : ''}${n.pin_label ? ' / ' + h(n.pin_label) : ''}${n.submitted_by_name ? ' · ' + h(n.submitted_by_name) : ''}</span></div>${ICONE.freccia}</li>`).join('')}</ul>` : '<p class="muto">Nessuna non conformità aperta.</p>'}`;
      $('#btn-segnala', inc).onclick = () => modaleSegnalaInCampo(commessa, Object.assign({ cantieri: cant }, contesto || {}));
    }).catch((e) => errore(inc, e, 'InCampo'));
    api(`/api/skytower/commessa/${encodeURIComponent(commessa)}/documenti`).then((d) => {
      const voci = d.items || [];
      sky.innerHTML = `<div class="card-testa"><h4>${MARCHIO('SkyTower')} ${h(d.project && d.project.name || 'Documenti pubblicati')}</h4>
          <div class="azioni"><button class="btn btn-piccolo" type="button" id="btn-report">Invia report giacenze</button>${d.project && d.project.url ? `<a class="btn btn-sec btn-piccolo" href="${h(d.project.url)}" target="_blank" rel="noopener">Apri</a>` : ''}</div></div>
        ${voci.length ? `<ul class="elenco">${voci.slice(0, 8).map((v) => `<li onclick="window.open('${h(v.url || '#')}','_blank')"><div class="testo"><strong>${h(v.title)}</strong><span class="mono">${h(v.identifier)} · ${h(v.revision_code || '')}${v.updated_at ? ' · ' + fmtData(v.updated_at) : ''}</span></div>${ICONE.freccia}</li>`).join('')}</ul>${voci.length > 8 ? `<p class="muto">e altri ${voci.length - 8}: aprili in SkyTower</p>` : ''}` : '<p class="muto">Nessun documento pubblicato per questa commessa.</p>'}`;
      $('#btn-report', sky).onclick = () => inviaReportSkyTower(commessa, $('#btn-report', sky));
    }).catch((e) => errore(sky, e, 'SkyTower'));
  }

  // Apre un task in InCampo sul cantiere della commessa (es. mezzo fermo, materiale finito).
  function modaleSegnalaInCampo(commessa, pre) {
    const cantieri = (pre && pre.cantieri) || [];
    const html = `<form id="f" class="form">
      ${cantieri.length > 1 ? campo('Cantiere', select('project_id', cantieri.map((c) => [c.id, c.name]), pre.project_id), 'pieno') : ''}
      ${campo('Titolo', input('titolo', (pre && pre.titolo) || '', 'required maxlength="200"'), 'pieno')}
      ${campo('Descrizione', `<textarea name="descrizione" rows="4">${h((pre && pre.descrizione) || '')}</textarea>`, 'pieno')}
      <p class="muto pieno">Il task nasce in InCampo sul cantiere, aperto e non assegnato: chi segue il cantiere lo prende in carico da lì.</p>
      <div class="form-azioni"><button class="btn btn-sec" type="button" id="annulla">Annulla</button><button class="btn" type="submit">Apri il task in InCampo</button></div></form>`;
    modale(`Segnala in InCampo · ${commessa}`, html, (box) => {
      $('#annulla', box).onclick = chiudiModale;
      $('#f', box).onsubmit = async (e) => {
        e.preventDefault();
        const d = datiForm(e.target);
        if (pre && pre.mezzo_id) d.mezzo_id = pre.mezzo_id;
        if (pre && pre.ubicazione_id) d.ubicazione_id = pre.ubicazione_id;
        if (!d.project_id && cantieri.length === 1) d.project_id = cantieri[0].id;
        try {
          const r = await api(`/api/incampo/commessa/${encodeURIComponent(commessa)}/task`, { method: 'POST', body: d });
          toast(`Task aperto in InCampo: ${r.title || d.titolo}`, 'ok'); chiudiModale();
          const pan = document.querySelector('.suite-pannelli');
          if (pan) caricaPannelliSuite(pan.parentElement, commessa, pre);
        } catch (err) { toast(err.message, 'errore'); }
      };
    });
  }

  async function inviaReportSkyTower(commessa, btn) {
    if (!confirm(`Creare su SkyTower un documento PDF con giacenze e mezzi della commessa ${commessa}?`)) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Invio in corso…'; }
    try {
      const r = await api(`/api/skytower/commessa/${encodeURIComponent(commessa)}/report`, { method: 'POST', body: {} });
      toast(`Report caricato su SkyTower: ${r.identifier || ''} (${r.revision_code || 'WIP'})`, 'ok');
      if (r.url) window.open(r.url, '_blank');
    } catch (e) { toast(e.message, 'errore'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Invia report giacenze'; }
  }

  // ------------------------------------------------------------------ etichette
  viste.etichette = async (cont) => {
    cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Stampa</div><h2>Etichette</h2></div></div>
      ${me.qr ? '' : '<div class="avviso">Il pacchetto <span class="mono">segno</span> non è installato: le etichette hanno solo il Code 128, niente QR. Esegui installa.bat.</div>'}
      <div class="card"><p class="muto">Scegli cosa stampare: si apre un foglio A4 con 24 etichette (70×37 mm), ognuna con Code 128${me.qr ? ' e QR' : ''}. Il lettore USB legge il Code 128, il telefono preferisce il QR.</p>
      <div class="filtri"><select id="tipo"><option value="articoli">Articoli</option><option value="mezzi">Mezzi</option><option value="ubicazioni">Ubicazioni</option></select><input id="q" placeholder="Filtra..."><button class="btn btn-sec btn-piccolo" id="tutti">Seleziona tutti</button><button class="btn btn-sec btn-piccolo" id="nessuno">Nessuno</button></div>
      <div class="lista-check" id="lista"></div>
      <div class="form-azioni"><button class="btn" id="stampa">Apri foglio etichette</button></div></div>`;
    let voci = [];
    const carica = async () => {
      const tipo = $('#tipo').value;
      voci = await api(tipo === 'ubicazioni' ? '/api/ubicazioni' : `/api/${tipo}?q=${encodeURIComponent($('#q').value)}`);
      const q = $('#q').value.toLowerCase();
      $('#lista').innerHTML = voci.filter((v) => !q || JSON.stringify(v).toLowerCase().includes(q)).map((v) => {
        const t = tipo === 'articoli' ? v.descrizione : tipo === 'mezzi' ? [v.tipo_mezzo, v.marca, v.modello, v.targa].filter(Boolean).join(' ') : v.nome;
        return `<label><input type="checkbox" value="${v.id}"><span class="mono muto">${h(v.codice)}</span> ${h(t)}</label>`;
      }).join('') || '<p class="muto">Niente da stampare.</p>';
    };
    $('#tipo').onchange = carica; let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(carica, 250); };
    $('#tutti').onclick = () => $('#lista').querySelectorAll('input').forEach((c) => { c.checked = true; });
    $('#nessuno').onclick = () => $('#lista').querySelectorAll('input').forEach((c) => { c.checked = false; });
    $('#stampa').onclick = () => {
      const ids = [...$('#lista').querySelectorAll('input:checked')].map((c) => c.value);
      if (!ids.length) return toast('Seleziona almeno una voce', 'errore');
      window.open(`/etichette?tipo=${$('#tipo').value}&ids=${ids.join(',')}`, '_blank');
    };
    await carica();
  };

  // ------------------------------------------------------------------ avvio
  (async () => {
    try {
      me = await api('/api/me');
      const nomeUtente = me.nome || me.username || '';
      const iniziali = nomeUtente.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
      $('#testata-utente').innerHTML = `<span class="avatar">${h(iniziali)}</span><span>${h(nomeUtente)}${me.admin ? ' · admin' : ''}</span>`;
    } catch (_) { /* senza identità si lavora lo stesso */ }
    naviga();
    battito();
    // Installabile sul telefono: il service worker tiene la pagina anche senza rete (le API no).
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const rete = () => { const c = $('#chip-rete'); if (c) { c.classList.toggle('offline', !navigator.onLine); c.textContent = navigator.onLine ? 'In linea' : 'Senza rete'; } if (!navigator.onLine) toast('Connessione assente: le registrazioni non partono finché non torna la rete.', 'errore'); };
    window.addEventListener('online', rete); window.addEventListener('offline', rete);
  })();
})();
