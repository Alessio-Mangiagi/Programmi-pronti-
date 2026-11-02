// "><(((º> sabusabu <º)))><"
// Lettura della targa da una foto, nel browser: Tesseract.js (OCR) caricato dal
// CDN alla prima richiesta, foto ridotta e messa in bianco e nero prima del
// riconoscimento, poi si cercano i formati delle targhe italiane nel testo letto
// e si propongono i candidati. Chi scansiona conferma: l'OCR sbaglia O/0, B/8, S/5.
'use strict';

window.Targa = (function () {
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js';
  // Lettere ammesse sulle targhe italiane (niente I, O, Q, U)
  const LETTERE = 'ABCDEFGHJKLMNPRSTVWXYZ';
  // Formati: L = lettera, D = cifra. Ordine = priorità.
  const FORMATI = [
    { nome: 'auto / autocarro', maschera: 'LLDDDLL' },
    { nome: 'rimorchio', maschera: 'XLDDDLL' },
    { nome: 'macchina operatrice', maschera: 'LLLDDD' },
    { nome: 'macchina agricola', maschera: 'LLDDDL' },
    { nome: 'moto / ciclomotore', maschera: 'LLDDDDD' },
    { nome: 'vecchio formato', maschera: 'LLDDDDDD' },
  ];
  const A_LETTERA = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B' };
  const A_CIFRA = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', A: '4', S: '5', G: '6', T: '7', B: '8' };

  let caricamento = null;
  function libreria() {
    if (window.Tesseract) return Promise.resolve();
    if (!caricamento) {
      caricamento = new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = CDN;
        s.onload = ok; s.onerror = () => { caricamento = null; ko(new Error('Lettore OCR non scaricabile: serve la connessione a internet')); };
        document.head.appendChild(s);
      });
    }
    return caricamento;
  }

  // Ridimensiona a max 1800 px, scala di grigi e contrasto: Tesseract legge meglio.
  function prepara(file) {
    return new Promise((ok, ko) => {
      const img = new Image();
      img.onload = () => {
        const max = 1800;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const p = d.data;
        for (let i = 0; i < p.length; i += 4) {
          let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
          p[i] = p[i + 1] = p[i + 2] = g;
        }
        ctx.putImageData(d, 0, 0);
        URL.revokeObjectURL(img.src);
        ok(c);
      };
      img.onerror = () => ko(new Error('Immagine non leggibile'));
      img.src = URL.createObjectURL(file);
    });
  }

  // Prova a far combaciare una sequenza con una maschera, correggendo le confusioni OCR.
  function adatta(seq, maschera) {
    if (seq.length !== maschera.length) return null;
    let out = '', correzioni = 0;
    for (let i = 0; i < maschera.length; i++) {
      const ch = seq[i], m = maschera[i];
      if (m === 'X') { if (ch !== 'X') return null; out += 'X'; continue; }
      if (m === 'L') {
        const l = /[A-Z]/.test(ch) ? ch : A_LETTERA[ch];
        if (!l || !LETTERE.includes(l)) return null;
        if (l !== ch) correzioni++;
        out += l;
      } else {
        const c = /[0-9]/.test(ch) ? ch : A_CIFRA[ch];
        if (!c) return null;
        if (c !== ch) correzioni++;
        out += c;
      }
    }
    // Troppe correzioni = parola qualunque che per caso somiglia a una targa.
    if (correzioni > (maschera.length >= 7 ? 2 : 1)) return null;
    return { targa: out, correzioni };
  }

  function candidati(testo) {
    const pulito = testo.toUpperCase().replace(/[^A-Z0-9\n ]+/g, ' ');
    const trovati = new Map();
    // Sequenze contigue (senza spazi) e sequenze con spazi tolti riga per riga
    const pezzi = new Set();
    pulito.split(/\n/).forEach((riga) => {
      const senza = riga.replace(/\s+/g, '');
      for (let len = 6; len <= 8; len++) for (let i = 0; i + len <= senza.length; i++) pezzi.add(senza.slice(i, i + len));
    });
    pezzi.forEach((seq) => {
      FORMATI.forEach((f, priorita) => {
        const r = adatta(seq, f.maschera);
        if (r && (!trovati.has(r.targa) || trovati.get(r.targa).correzioni > r.correzioni)) {
          trovati.set(r.targa, { targa: r.targa, formato: f.nome, priorita, correzioni: r.correzioni, corretta: r.correzioni > 0 });
        }
      });
    });
    let lista = [...trovati.values()].sort((a, b) => a.correzioni - b.correzioni || a.priorita - b.priorita);
    // Se c'e' una lettura pulita nel formato auto, le varianti "corrette" sono quasi sempre rumore.
    if (lista.some((c) => c.correzioni === 0 && c.priorita === 0)) lista = lista.filter((c) => c.correzioni === 0);
    return lista.slice(0, 5);
  }

  async function leggi(file, avanzamento) {
    await libreria();
    const canvas = await prepara(file);
    const worker = await window.Tesseract.createWorker('eng', 1, {
      logger: (m) => { if (avanzamento && m.status === 'recognizing text') avanzamento(Math.round((m.progress || 0) * 100)); },
    });
    try {
      await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ', preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(canvas);
      return { testo: data.text || '', candidati: candidati(data.text || '') };
    } finally {
      await worker.terminate();
    }
  }

  return { leggi, candidati };
})();
