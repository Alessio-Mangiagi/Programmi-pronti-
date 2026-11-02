// "><(((º> sabusabu <º)))><"
// Grafici in SVG puro per il Magazzino Operativo: colonne impilate, linee,
// barre orizzontali, diagramma di flusso, sparkline. Niente librerie: la LAN
// non ha sempre internet e i dati sono pochi.
//
// Regole seguite (skill dataviz): colori per entità in ordine fisso, mai
// ciclati; palette validata (carico verde, trasferimento blu, scarico ambra;
// rettifiche in grigio di contesto); marchi sottili, estremità arrotondate,
// 2px di spazio fra segmenti; legenda sempre con >= 2 serie; tooltip su
// ogni marchio; una vista tabella accanto a ogni grafico.
'use strict';

window.Grafici = (function () {
  const SERIE = {
    carico: { nome: 'Carichi', colore: '#3f8f55' },
    trasferimento: { nome: 'Trasferimenti', colore: '#1477b8' },
    scarico: { nome: 'Scarichi', colore: '#c9862a' },
    rettifica: { nome: 'Rettifiche', colore: '#9aa0a8' },
  };
  // Serie per le linee (ubicazioni di un articolo): stesso ordine fisso, una per ubicazione
  const LINEE = ['#1477b8', '#3f8f55', '#c9862a', '#6b7280'];
  const TESTO = '#333333', TESTO_MUTO = '#6b7280', GRIGLIA = '#e5e7eb';
  const FONT = "'Inter', Arial, sans-serif";

  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  const giornoBreve = (iso) => { const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }); };
  const giornoLungo = (iso) => { const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' }); };

  // Tick "puliti": 0 / 1 / 2 ... oppure 0 / 5 / 10 ... in base al massimo
  function ticks(max, n) {
    if (max <= 0) return [0];
    const grezzo = max / (n || 4);
    const pot = Math.pow(10, Math.floor(Math.log10(grezzo)));
    const passo = [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= grezzo) || pot * 10;
    const out = [];
    for (let v = 0; v <= max + passo * 0.999; v += passo) out.push(Math.round(v * 1000) / 1000);
    return out;
  }

  // ---------------------------------------------------------------- tooltip condiviso
  let tip = null;
  function tooltip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'grafico-tip';
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    return tip;
  }
  function mostraTip(ev, righe, titolo) {
    const t = tooltip();
    t.innerHTML = '';
    if (titolo) { const tt = document.createElement('div'); tt.className = 'tip-titolo'; tt.textContent = titolo; t.appendChild(tt); }
    righe.forEach((r) => {
      const riga = document.createElement('div'); riga.className = 'tip-riga';
      if (r.colore) { const k = document.createElement('span'); k.className = 'tip-chiave'; k.style.background = r.colore; riga.appendChild(k); }
      const v = document.createElement('strong'); v.textContent = r.valore; riga.appendChild(v);
      const l = document.createElement('span'); l.textContent = ' ' + r.nome; riga.appendChild(l);
      t.appendChild(riga);
    });
    t.hidden = false;
    posTip(ev);
  }
  function posTip(ev) {
    const t = tooltip();
    const x = Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8);
    const y = Math.min(ev.clientY + 14, window.innerHeight - t.offsetHeight - 8);
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function nascondiTip() { if (tip) tip.hidden = true; }

  function legenda(serie) {
    return `<div class="grafico-legenda">${serie.map((s) => `<span><i style="background:${s.colore}"></i>${h(s.nome)}</span>`).join('')}</div>`;
  }
  function vuoto(msg) { return `<div class="grafico-vuoto">${h(msg)}</div>`; }

  // ---------------------------------------------------------------- colonne impilate (movimenti per giorno)
  function colonneImpilate(el, dati, chiavi, opz) {
    opz = opz || {};
    const serie = chiavi.map((k) => ({ chiave: k, ...SERIE[k] }));
    const W = Math.max(el.clientWidth || 600, 320), H = opz.altezza || 220;
    const pad = { t: 12, r: 8, b: 28, l: 34 };
    const totali = dati.map((d) => chiavi.reduce((s, k) => s + (d[k] || 0), 0));
    const max = Math.max(...totali, 0);
    if (!max) { el.innerHTML = vuoto('Nessun movimento nel periodo'); return; }
    const tk = ticks(max);
    const yMax = tk[tk.length - 1];
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const slot = iw / dati.length;
    const bw = Math.min(24, Math.max(3, slot * 0.6));
    const y = (v) => pad.t + ih - (v / yMax) * ih;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" font-family="${FONT}" font-size="11" role="img" aria-label="${h(opz.titolo || 'Movimenti per giorno')}">`;
    tk.forEach((v) => { svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${GRIGLIA}" stroke-width="1"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" fill="${TESTO_MUTO}">${fmt(v)}</text>`; });
    // etichette asse x: non più di ~10
    const ogni = Math.ceil(dati.length / 10);
    dati.forEach((d, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2;
      if (i % ogni === 0 || i === dati.length - 1) svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" fill="${TESTO_MUTO}">${giornoBreve(d.data)}</text>`;
      let base = 0;
      chiavi.forEach((k, si) => {
        const v = d[k] || 0;
        if (!v) return;
        const y1 = y(base + v), y0 = y(base);
        const gap = base ? 2 : 0;
        const hh = Math.max(0, y0 - y1 - gap);
        const r = si === chiavi.length - 1 || chiavi.slice(si + 1).every((kk) => !d[kk]) ? 4 : 0; // arrotonda solo la cima
        svg += `<path d="${rettArrotondato(x, y1, bw, hh, r)}" fill="${SERIE[k].colore}" data-i="${i}" class="marchio"/>`;
        base += v;
      });
      svg += `<rect x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih}" fill="transparent" data-hit="${i}"/>`;
    });
    svg += '</svg>';
    el.innerHTML = legenda(serie) + svg;
    el.querySelectorAll('[data-hit]').forEach((r) => {
      const i = +r.dataset.hit;
      const on = (ev) => {
        el.querySelectorAll('.marchio').forEach((m) => { m.style.opacity = +m.dataset.i === i ? '1' : '0.45'; });
        mostraTip(ev, [{ valore: fmt(totali[i]), nome: 'movimenti' }, ...chiavi.filter((k) => dati[i][k]).map((k) => ({ valore: fmt(dati[i][k]), nome: SERIE[k].nome.toLowerCase(), colore: SERIE[k].colore }))], giornoLungo(dati[i].data));
      };
      r.addEventListener('pointerenter', on); r.addEventListener('pointermove', posTip);
      r.addEventListener('pointerleave', () => { el.querySelectorAll('.marchio').forEach((m) => { m.style.opacity = '1'; }); nascondiTip(); });
    });
  }

  function rettArrotondato(x, y, w, hh, r) {
    if (hh <= 0) return '';
    r = Math.min(r, w / 2, hh);
    return `M${x},${y + hh} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hh} Z`;
  }

  // ---------------------------------------------------------------- linee (andamento giacenza)
  function linee(el, date, serie, opz) {
    opz = opz || {};
    if (!serie.length || !date.length) { el.innerHTML = vuoto('Nessun movimento registrato'); return; }
    // > 4 ubicazioni: le prime 3 in colore, le altre sommate in "Altre" grigia (mai una 5ª tinta)
    let vis = serie;
    if (serie.length > 4) {
      const altre = date.map((_, i) => serie.slice(3).reduce((s, x) => s + (x.valori[i] || 0), 0));
      vis = [...serie.slice(0, 3), { nome: 'Altre ubicazioni', valori: altre }];
    }
    vis = vis.map((s, i) => ({ ...s, colore: LINEE[i] }));
    const W = Math.max(el.clientWidth || 600, 320), H = opz.altezza || 200;
    const pad = { t: 12, r: 150, b: 26, l: 40 };
    const tutti = vis.flatMap((s) => s.valori);
    const max = Math.max(...tutti, 0), min = Math.min(...tutti, 0);
    const tk = ticks(Math.max(max, Math.abs(min), 1));
    const yMax = tk[tk.length - 1], yMin = min < 0 ? -yMax : 0;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const x = (i) => pad.l + (date.length === 1 ? iw / 2 : (i / (date.length - 1)) * iw);
    const y = (v) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" font-family="${FONT}" font-size="11" role="img" aria-label="${h(opz.titolo || 'Andamento')}">`;
    const tkTutti = yMin < 0 ? [...tk.slice(1).map((v) => -v).reverse(), ...tk] : tk;
    tkTutti.forEach((v) => { svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#c9cdd3' : GRIGLIA}" stroke-width="1"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" fill="${TESTO_MUTO}">${fmt(v)}</text>`; });
    const ogni = Math.ceil(date.length / 8);
    date.forEach((d, i) => { if (i % ogni === 0 || i === date.length - 1) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" fill="${TESTO_MUTO}">${giornoBreve(d)}</text>`; });
    vis.forEach((s) => {
      const d = s.valori.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      svg += `<path d="${d}" fill="none" stroke="${s.colore}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const ult = s.valori[s.valori.length - 1];
      svg += `<circle cx="${x(date.length - 1)}" cy="${y(ult)}" r="4" fill="${s.colore}" stroke="#fff" stroke-width="2"/>`;
    });
    // etichette finali: una per serie, spostate se si sovrappongono (con filo di collegamento)
    const fin = vis.map((s) => ({ s, yv: y(s.valori[s.valori.length - 1]) })).sort((a, b) => a.yv - b.yv);
    let ultimoY = -99;
    fin.forEach((f) => {
      const yy = Math.max(f.yv, ultimoY + 13); ultimoY = yy;
      if (Math.abs(yy - f.yv) > 2) svg += `<line x1="${x(date.length - 1) + 5}" y1="${f.yv}" x2="${W - pad.r + 4}" y2="${yy}" stroke="${f.s.colore}" stroke-width="1"/>`;
      svg += `<text x="${W - pad.r + 8}" y="${yy + 4}" fill="${TESTO}" font-weight="600">${fmt(f.s.valori[f.s.valori.length - 1])}</text><text x="${W - pad.r + 8}" y="${yy + 4}" dx="${String(fmt(f.s.valori[f.s.valori.length - 1])).length * 6.5 + 4}" fill="${TESTO_MUTO}">${h(f.s.nome.length > 18 ? f.s.nome.slice(0, 17) + '…' : f.s.nome)}</text>`;
    });
    svg += `<line id="mirino" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke="#434549" stroke-width="1" visibility="hidden"/>`;
    svg += `<rect x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent" data-area="1"/></svg>`;
    el.innerHTML = (vis.length > 1 ? legenda(vis) : '') + svg;
    const area = el.querySelector('[data-area]'), mir = el.querySelector('#mirino');
    const svgEl = el.querySelector('svg');
    const on = (ev) => {
      const box = svgEl.getBoundingClientRect();
      const px = (ev.clientX - box.left) * (W / box.width);
      const i = Math.max(0, Math.min(date.length - 1, Math.round(((px - pad.l) / iw) * (date.length - 1))));
      mir.setAttribute('x1', x(i)); mir.setAttribute('x2', x(i)); mir.setAttribute('visibility', 'visible');
      mostraTip(ev, vis.map((s) => ({ valore: fmt(s.valori[i]) + (opz.um ? ' ' + opz.um : ''), nome: s.nome, colore: s.colore })), giornoLungo(date[i]));
    };
    area.addEventListener('pointerenter', on); area.addEventListener('pointermove', on);
    area.addEventListener('pointerleave', () => { mir.setAttribute('visibility', 'hidden'); nascondiTip(); });
  }

  // ---------------------------------------------------------------- barre orizzontali appaiate (entrate / uscite per ubicazione)
  function barreEntrateUscite(el, righe) {
    if (!righe.length) { el.innerHTML = vuoto('Nessuna ubicazione movimentata nel periodo'); return; }
    const max = Math.max(...righe.map((r) => Math.max(r.entrate, r.uscite)), 1);
    const serie = [{ nome: 'In entrata', colore: '#3f8f55' }, { nome: 'In uscita', colore: '#c9862a' }];
    let html = legenda(serie) + '<div class="barre">';
    righe.forEach((r) => {
      html += `<div class="barre-riga" data-id="${r.id}"><div class="barre-nome" title="${h(r.nome)}">${h(r.nome)}</div><div class="barre-corpo">
        <div class="barre-track"><div class="barre-fill" style="width:${(r.entrate / max) * 100}%;background:${serie[0].colore}"></div><span class="barre-val">${fmt(r.entrate)}</span></div>
        <div class="barre-track"><div class="barre-fill" style="width:${(r.uscite / max) * 100}%;background:${serie[1].colore}"></div><span class="barre-val">${fmt(r.uscite)}</span></div></div></div>`;
    });
    el.innerHTML = html + '</div>';
    el.querySelectorAll('.barre-riga').forEach((riga, i) => {
      const r = righe[i];
      riga.addEventListener('pointerenter', (ev) => mostraTip(ev, [{ valore: fmt(r.entrate), nome: 'movimenti in entrata', colore: serie[0].colore }, { valore: fmt(r.uscite), nome: 'movimenti in uscita', colore: serie[1].colore }], r.nome));
      riga.addEventListener('pointermove', posTip);
      riga.addEventListener('pointerleave', nascondiTip);
    });
  }

  // ---------------------------------------------------------------- diagramma di flusso (fornitori -> ubicazioni -> consumo)
  function flusso(el, archi) {
    if (!archi.length) { el.innerHTML = vuoto('Nessun carico, scarico o trasferimento nel periodo'); return; }
    // Nodi per colonna: 0 fornitori, 1 ubicazioni, 2 consumo. I trasferimenti vanno
    // da ubicazione a ubicazione: li disegniamo come archi curvi dentro la colonna centrale.
    const col = { fornitore: 0, ubicazione: 1, consumo: 2 };
    const nodi = new Map();
    const nodo = (n) => { const k = n.tipo + '|' + n.nome; if (!nodi.has(k)) nodi.set(k, { ...n, k, peso: 0 }); return nodi.get(k); };
    archi.forEach((a) => { nodo(a.da).peso += a.n; nodo(a.a).peso += a.n; });
    const colonne = [[], [], []];
    nodi.forEach((n) => colonne[col[n.tipo]].push(n));
    colonne.forEach((c) => c.sort((a, b) => b.peso - a.peso));
    const W = Math.max(el.clientWidth || 700, 480);
    const nw = Math.round(Math.min(200, (W - 60) / 3.8));   // larghezza dei riquadri
    const righeMax = Math.max(...colonne.map((c) => c.length), 1);
    const H = Math.max(200, Math.min(640, righeMax * 46 + 50));
    const cx = [16 + nw / 2, W / 2, W - 16 - nw / 2];
    const pos = new Map();
    colonne.forEach((c, ci) => {
      const passo = Math.max(44, (H - 36) / Math.max(c.length, 1));
      const inizio = 28 + ((H - 36) - passo * c.length) / 2;   // colonna centrata in verticale
      c.forEach((n, i) => pos.set(n.k, { x: cx[ci], y: inizio + passo * i + passo / 2 }));
    });
    const maxN = Math.max(...archi.map((a) => a.n), 1);
    const spessore = (n) => 2 + (n / maxN) * 14;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" font-family="${FONT}" font-size="11" role="img" aria-label="Flusso del materiale">`;
    ['Fornitori', 'Ubicazioni', 'Consumo'].forEach((t, i) => { svg += `<text x="${cx[i]}" y="11" text-anchor="middle" fill="${TESTO_MUTO}" font-weight="600" letter-spacing="0.06em">${t.toUpperCase()}</text>`; });
    archi.forEach((a, i) => {
      const p1 = pos.get(a.da.tipo + '|' + a.da.nome), p2 = pos.get(a.a.tipo + '|' + a.a.nome);
      const c = SERIE[a.tipo].colore;
      let d;
      if (a.tipo === 'trasferimento') {
        // ansa a sinistra della colonna centrale: a destra passano gli scarichi
        const dx = 50 + Math.abs(p2.y - p1.y) * 0.3;
        d = `M${p1.x - nw / 2},${p1.y} C${p1.x - nw / 2 - dx},${p1.y} ${p2.x - nw / 2 - dx},${p2.y} ${p2.x - nw / 2},${p2.y}`;
      } else {
        const x1 = p1.x + nw / 2, x2 = p2.x - nw / 2;
        const mx = (x1 + x2) / 2;
        d = `M${x1},${p1.y} C${mx},${p1.y} ${mx},${p2.y} ${x2},${p2.y}`;
      }
      svg += `<path d="${d}" fill="none" stroke="${c}" stroke-opacity="0.55" stroke-width="${spessore(a.n)}" stroke-linecap="round" data-arco="${i}" class="arco"/>`;
    });
    nodi.forEach((n) => {
      const p = pos.get(n.k);
      const w = nw;
      const maxCar = Math.floor((nw - 16) / 6.6);
      const nome = n.nome.length > maxCar ? n.nome.slice(0, maxCar - 1) + '…' : n.nome;
      svg += `<g data-nodo="${h(n.k)}"><rect x="${p.x - w / 2}" y="${p.y - 14}" width="${w}" height="28" rx="4" fill="#fff" stroke="#d2d6dc"/><text x="${p.x}" y="${p.y + 4}" text-anchor="middle" fill="${TESTO}" font-weight="600"><title>${h(n.nome)}</title>${h(nome)}</text></g>`;
    });
    svg += '</svg>';
    el.innerHTML = legenda(['carico', 'trasferimento', 'scarico'].map((k) => SERIE[k])) + svg;
    el.querySelectorAll('.arco').forEach((p) => {
      const a = archi[+p.dataset.arco];
      p.addEventListener('pointerenter', (ev) => {
        el.querySelectorAll('.arco').forEach((q) => { q.setAttribute('stroke-opacity', q === p ? '0.9' : '0.2'); });
        mostraTip(ev, [{ valore: fmt(a.n), nome: SERIE[a.tipo].nome.toLowerCase(), colore: SERIE[a.tipo].colore }, ...a.articoli.slice(0, 5).map((x) => ({ valore: fmt(x.quantita), nome: x.nome }))], `${a.da.nome} → ${a.a.nome}`);
      });
      p.addEventListener('pointermove', posTip);
      p.addEventListener('pointerleave', () => { el.querySelectorAll('.arco').forEach((q) => q.setAttribute('stroke-opacity', '0.55')); nascondiTip(); });
    });
  }

  // ---------------------------------------------------------------- sparkline (12-14 punti, stat tile)
  function sparkline(valori, colore, w, hh) {
    w = w || 120; hh = hh || 28;
    const max = Math.max(...valori, 1);
    const n = valori.length;
    const x = (i) => (n === 1 ? w / 2 : (i / (n - 1)) * (w - 4) + 2);
    const y = (v) => hh - 3 - (v / max) * (hh - 6);
    const d = valori.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ult = valori[n - 1];
    return `<svg viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}" aria-hidden="true"><path d="${d}" fill="none" stroke="#9aa0a8" stroke-width="2" stroke-linejoin="round"/><circle cx="${x(n - 1)}" cy="${y(ult)}" r="3.5" fill="${colore || '#1477b8'}" stroke="#fff" stroke-width="2"/></svg>`;
  }

  return { SERIE, colonneImpilate, linee, barreEntrateUscite, flusso, sparkline, legenda };
})();
