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
  const ETICH_TIPO_UBI = { deposito: 'Deposito', cantiere: 'Cantiere', officina: 'Officina', fornitore: 'Fornitore', altro: 'Altro' };

  const ICONE = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
    scan: '<svg viewBox="0 0 24 24"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M11 8v8M14 8v8M17 8v8"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/></svg>',
    lista: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M1 6h13v10H1zM14 10h5l4 4v2h-9z"/><circle cx="5" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    swap: '<svg viewBox="0 0 24 24"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>',
    import: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
    vuoto: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/></svg>',
  };
  const vuoto = (msg) => `<div class="vuoto">${ICONE.vuoto}<div>${h(msg)}</div></div>`;
  const skeleton = (n) => `<div class="card">${'<div class="skeleton"></div>'.repeat(n || 5)}</div>`;

  // ------------------------------------------------------------------ navigazione
  const VISTE = [
    ['dashboard', 'Riepilogo', 'home'], ['scansione', 'Scansione', 'scan'], ['giacenze', 'Giacenze', 'box'],
    ['movimenti', 'Movimenti', 'swap'], ['sez', 'Anagrafiche'], ['articoli', 'Articoli', 'lista'], ['mezzi', 'Mezzi', 'truck'],
    ['ubicazioni', 'Ubicazioni', 'pin'], ['sez', 'Strumenti'], ['importazioni', 'Importazioni', 'import'], ['etichette', 'Etichette', 'tag'],
  ];
  function disegnaSidebar(attiva) {
    $('#sidebar').innerHTML = VISTE.map(([id, nome, icona]) =>
      id === 'sez' ? `<div class="sezione">${nome}</div>` :
        `<a href="#${id}" class="${id === attiva ? 'attiva' : ''}">${ICONE[icona]}<span>${nome}</span></a>`).join('');
  }
  $('#btn-menu').onclick = () => $('#sidebar').classList.toggle('aperta');
  $('#sidebar').addEventListener('click', () => $('#sidebar').classList.remove('aperta'));

  async function naviga() {
    const [vista, arg] = location.hash.replace('#', '').split('/');
    const nome = vista || 'dashboard';
    disegnaSidebar(nome);
    const fn = viste[nome] || viste.dashboard;
    const cont = $('#contenuto');
    cont.innerHTML = skeleton(6);
    try {
      await fn(cont, arg);
      cont.classList.remove('reveal'); void cont.offsetWidth; cont.classList.add('reveal');
    } catch (e) {
      cont.innerHTML = `<div class="avviso avviso-errore">${h(e.message)}</div>`;
    }
  }
  window.addEventListener('hashchange', naviga);

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
    inp.focus();
    // Il lettore USB scrive come una tastiera: il campo deve restare a fuoco anche
    // dopo un click sulla pagina, a meno che l'utente non stia compilando un form.
    cont.addEventListener('click', (e) => {
      if (!e.target.closest('input, select, textarea, button, a, .modale')) inp.focus();
    });
    $('#form-scan').onsubmit = (e) => { e.preventDefault(); cerca(inp.value); };
    $('#btn-camera').onclick = avviaCamera;
    if (arg) {
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
            ${d.giacenze.map((g) => `<tr><td>${h(g.ubicazione)} <span class="badge">${h(ETICH_TIPO_UBI[g.tipo] || g.tipo)}</span></td><td class="num"><strong>${fmtN(g.quantita)}</strong> ${h(a.um)}</td><td class="muto">${fmtData(g.ultimo_movimento)}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muto">Nessuna giacenza: registra un carico.</p>'}</div>
        </div>
        <h4 style="margin-top:1.25rem">Ultimi movimenti</h4>${tabellaMovimenti(d.movimenti)}</div>`;
    }

    function cardMezzo(d) {
      const m = d.mezzo;
      return `<div class="card reveal"><div class="card-testa"><div class="risultato-titolo"><span class="badge badge-blu">Mezzo</span><h3>${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))}</h3><span class="codice">${h(m.codice)}</span></div>
          <div class="azioni"><button class="btn btn-sec btn-piccolo" data-modifica>Modifica</button><a class="btn btn-sec btn-piccolo" href="/etichette?tipo=mezzi&ids=${m.id}" target="_blank">Etichetta</a></div></div>
        <div class="griglia griglia-2">
          <div><div class="totale-grande" style="font-size:1.6rem">${h(m.ubicazione || 'Ubicazione non registrata')}</div>
            <p>${badgeStato(m.stato)} <span class="badge">${m.proprieta === 'nolo' ? 'A nolo' : 'Di proprietà'}</span></p>
            <p class="muto">${m.targa ? 'Targa ' + h(m.targa) + ' · ' : ''}${m.matricola ? 'Matricola ' + h(m.matricola) : ''}${m.ditta ? '<br>' + h(m.ditta) : ''}${m.nolo_dal || m.nolo_al ? `<br>Nolo ${fmtData(m.nolo_dal)} – ${fmtData(m.nolo_al)}` : ''}${m.note ? '<br>' + h(m.note) : ''}</p>
            <div class="azioni-rapide"><button class="btn" data-azione="sposta">Sposta / cambia stato</button></div></div>
          <div><h4>Storico spostamenti</h4>${d.storico.length ? `<table><thead><tr><th>Data</th><th>Da</th><th>A</th><th>Stato</th><th>Chi</th></tr></thead><tbody>
            ${d.storico.map((s) => `<tr><td class="muto" style="white-space:nowrap">${fmtData(s.ts)}</td><td>${h(s.da_nome || '—')}</td><td>${h(s.a_nome || '—')}</td><td>${s.stato ? badgeStato(s.stato) : ''}</td><td class="muto">${h(s.utente || '')}${s.note ? ` <span title="${h(s.note)}">·</span>` : ''}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muto">Nessuno spostamento registrato.</p>'}</div>
        </div></div>`;
    }

    function cardUbicazione(d) {
      const u = d.ubicazione;
      return `<div class="card reveal"><div class="card-testa"><div class="risultato-titolo"><span class="badge badge-blu">Ubicazione</span><h3>${h(u.nome)}</h3><span class="codice">${h(u.codice)}</span><span class="badge">${h(ETICH_TIPO_UBI[u.tipo] || u.tipo)}</span></div>
          <div class="azioni"><a class="btn btn-sec btn-piccolo" href="/etichette?tipo=ubicazioni&ids=${u.id}" target="_blank">Etichetta</a></div></div>
        <div class="griglia griglia-2">
          <div><h4>Materiale (${d.giacenze.length})</h4>${d.giacenze.length ? `<table><thead><tr><th>Articolo</th><th class="num">Quantità</th></tr></thead><tbody>
            ${d.giacenze.map((g) => `<tr class="riga-link" onclick="location.hash='#scansione/${h(g.codice)}'"><td>${h(g.descrizione)} <span class="muto mono">${h(g.codice)}</span></td><td class="num">${fmtN(g.quantita)} ${h(g.um)}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muto">Nessun materiale qui.</p>'}</div>
          <div><h4>Mezzi (${d.mezzi.length})</h4>${d.mezzi.length ? `<table><thead><tr><th>Mezzo</th><th>Targa</th><th>Stato</th></tr></thead><tbody>
            ${d.mezzi.map((m) => `<tr class="riga-link" onclick="location.hash='#scansione/${h(m.codice)}'"><td>${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))}</td><td class="mono">${h(m.targa || '')}</td><td>${badgeStato(m.stato)}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muto">Nessun mezzo qui.</p>'}</div>
        </div></div>`;
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
        await lettoreCamera.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 160 } },
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
        ${l.map((m) => `<tr><td class="mono"><a href="#scansione/${h(m.codice)}">${h(m.codice)}</a></td><td>${h([m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' '))}</td><td class="mono">${h(m.targa || '')}${m.matricola ? `<br><span class="muto">${h(m.matricola)}</span>` : ''}</td>
          <td>${m.proprieta === 'nolo' ? `<span class="badge badge-ambra">Nolo</span><br><span class="muto">${h(m.ditta || '')}</span>` : '<span class="badge badge-verde">Proprio</span>'}</td><td>${h(m.ubicazione || '—')}</td><td>${badgeStato(m.stato)}</td>
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
      ${campo('Targa', input('targa', m.targa, 'style="text-transform:uppercase"'))}
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
      <div class="azioni"><a class="btn btn-sec" href="/etichette?tipo=ubicazioni" target="_blank">Stampa etichette</a><button class="btn" id="btn-nuovo">Nuova ubicazione</button></div></div>
      <div class="card" id="tab"></div>`;
    const carica = async () => {
      const l = await api('/api/ubicazioni?tutte=1');
      ubicazioniCache = l.filter((u) => u.attivo);
      $('#tab').innerHTML = `<div class="tabella-wrap"><table><thead><tr><th>Codice</th><th>Nome</th><th>Tipo</th><th>Commessa</th><th class="num">Articoli</th><th class="num">Mezzi</th><th></th></tr></thead><tbody>
        ${l.map((u) => `<tr ${u.attivo ? '' : 'style="opacity:.55"'}><td class="mono"><a href="#scansione/${h(u.codice)}">${h(u.codice)}</a></td><td>${h(u.nome)}${u.indirizzo ? `<br><span class="muto">${h(u.indirizzo)}</span>` : ''}</td><td><span class="badge">${h(ETICH_TIPO_UBI[u.tipo] || u.tipo)}</span></td><td class="muto">${h(u.commessa || '')}</td><td class="num">${u.articoli}</td><td class="num">${u.mezzi}</td>
          <td style="white-space:nowrap"><button class="btn btn-sec btn-piccolo" data-mod="${u.id}">Modifica</button> ${me.admin ? `<button class="btn btn-rosso btn-piccolo" data-del="${u.id}">Elimina</button>` : ''}</td></tr>`).join('')}
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
      ${campo('Indirizzo', input('indirizzo', u.indirizzo), 'pieno')}
      ${u.id ? campo('Attiva', select('attivo', [['1', 'Sì'], ['0', 'No']], u.attivo ? '1' : '0')) : ''}
      ${campo('Note', `<textarea name="note">${h(u.note || '')}</textarea>`, 'pieno')}
      <div class="form-azioni"><button class="btn btn-sec" type="button" id="annulla">Annulla</button><button class="btn" type="submit">Salva</button></div></form>`;
    modale(u.id ? `Modifica ${u.codice}` : 'Nuova ubicazione', html, (box) => {
      $('#annulla', box).onclick = chiudiModale;
      $('#f', box).onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api(u.id ? '/api/ubicazioni/' + u.id : '/api/ubicazioni', { method: u.id ? 'PUT' : 'POST', body: datiForm(e.target) });
          ubicazioniCache = null; toast('Ubicazione salvata', 'ok'); chiudiModale(); dopo && dopo();
        } catch (err) { toast(err.message, 'errore'); }
      };
    });
  }

  // ------------------------------------------------------------------ importazioni
  viste.importazioni = async (cont) => {
    const carica = async () => {
      const d = await api('/api/importazioni');
      cont.innerHTML = `<div class="vista-testa"><div><div class="sopratitolo">Alimentazione automatica</div><h2>Importazioni</h2></div></div>
        <div class="griglia griglia-2">
          <div class="card"><div class="card-testa"><h3>DDT dal Lettore DDT</h3>${d.ddt_dir_ok ? '<span class="badge badge-verde">Cartella trovata</span>' : '<span class="badge badge-rosso">Cartella assente</span>'}</div>
            <p class="muto mono" style="word-break:break-all">${h(d.ddt_dir)}</p>
            <p class="muto">Commesse con registro consegne: ${d.commesse.length ? d.commesse.map((c) => `<span class="badge badge-blu">${h(c)}</span>`).join(' ') : 'nessuna'}.<br>Ogni ${d.intervallo_sec || '—'} secondi il server rilegge da solo i registri; qui si forza la lettura.</p>
            <div class="azioni-rapide"><button class="btn" id="imp-ddt">Leggi adesso</button><button class="btn btn-sec" id="imp-ddt-forza">Rileggi tutto</button></div></div>
          <div class="card"><div class="card-testa"><h3>Mezzi da VFP Transfer</h3>${d.mezzi_dir_ok ? '<span class="badge badge-verde">Cartella trovata</span>' : '<span class="badge badge-rosso">Cartella assente</span>'}</div>
            <p class="muto mono" style="word-break:break-all">${h(d.mezzi_dir)}</p>
            <p class="muto">Le pratiche dei mezzi a nolo (record.json) diventano mezzi del magazzino, nel cantiere della commessa del contratto.</p>
            <div class="azioni-rapide"><button class="btn" id="imp-mezzi">Leggi adesso</button><button class="btn btn-sec" id="imp-mezzi-forza">Rileggi tutto</button></div></div>
        </div>
        <div style="height:1.25rem"></div>
        <div class="card"><h3>Carica un JSON a mano</h3><p class="muto">Accetta il <span class="mono">consegne.json</span> di una commessa oppure un export del Lettore DDT (<span class="mono">json_exports/*.json</span>).</p>
          <form id="f-up" class="form"><div class="campo"><label>File JSON</label><input type="file" name="file" accept=".json,application/json" required></div><div class="campo"><label>Commessa / cantiere (per gli export grezzi)</label><input name="commessa" placeholder="es. demo-augusta"></div>
          <div class="form-azioni"><button class="btn" type="submit">Importa</button></div></form><div id="esito-up"></div></div>
        <div class="card"><h3>Storico importazioni</h3>${d.storico.length ? `<div class="tabella-wrap"><table><thead><tr><th>Quando</th><th>Sorgente</th><th>Chiave</th><th class="num">Righe</th><th class="num">Nuove</th><th>Esito</th></tr></thead><tbody>
          ${d.storico.map((s) => `<tr><td class="muto" style="white-space:nowrap">${fmtData(s.ts)}</td><td>${badgeOrigine(s.sorgente)}</td><td>${h(s.chiave || s.file)}${s.dettaglio ? `<br><span class="muto">${h(s.dettaglio)}</span>` : ''}</td><td class="num">${s.righe}</td><td class="num">${s.nuove}</td><td>${s.esito === 'ok' ? '<span class="badge badge-verde">ok</span>' : '<span class="badge badge-rosso">errore</span>'}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muto">Nessuna importazione ancora.</p>'}</div>`;
      const lancia = (sorgente, forza) => async () => {
        try { const r = await api('/api/importazioni/' + sorgente, { method: 'POST', body: { forza } }); toast(`${sorgente}: ${r.totale} voci lette`, 'ok'); ubicazioniCache = null; carica(); } catch (e) { toast(e.message, 'errore'); }
      };
      $('#imp-ddt').onclick = lancia('ddt', false); $('#imp-ddt-forza').onclick = lancia('ddt', true);
      $('#imp-mezzi').onclick = lancia('mezzi', false); $('#imp-mezzi-forza').onclick = lancia('mezzi', true);
      $('#f-up').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api('/api/importazioni/upload', { method: 'POST', body: new FormData(e.target) });
          $('#esito-up').innerHTML = `<div class="avviso avviso-ok">${r.esiti.map((x) => `${h(x.export)}: ${x.righe} righe, ${x.nuove} nuove${x.scartate ? `, ${x.scartate} scartate` : ''}`).join('<br>')}</div>`;
          ubicazioniCache = null; toast('Importato', 'ok');
        } catch (err) { $('#esito-up').innerHTML = `<div class="avviso avviso-errore">${h(err.message)}</div>`; }
      };
    };
    await carica();
  };

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
      $('#testata-utente').textContent = (me.nome || me.username || '') + (me.admin ? ' · admin' : '');
    } catch (_) { /* senza identità si lavora lo stesso */ }
    naviga();
  })();
})();
