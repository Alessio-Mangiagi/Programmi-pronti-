// "><(((º> sabusabu <º)))><"
// Test di carico di Copilota (istanza di prova su una COPIA del database).
// Mai contro il Copilota vero: riempie registro e timbrature (vedi docs/test-di-carico.md).
// Uso: node scripts/carico/carico.mjs <fase> [base]   fasi: login | portata | realistico | picco | pesanti
// Ogni utente virtuale ha la sua connessione (keep-alive), il suo cookie e un suo indirizzo
// (X-Forwarded-For, accettato perché la richiesta arriva da 127.0.0.1: 'trust proxy' loopback).
import http from 'node:http';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const fase = process.argv[2];
const BASE = new URL(process.argv[3] ?? 'http://127.0.0.1:5299');
const PASSWORD = 'Carico2026!prova';
const N_UTENTI = 300;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const caso = (a, b) => a + Math.random() * (b - a);
const ERRORI_RETE = {};
const scegli = (a) => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------------------------------
class Utente {
  constructor(nome, ip) {
    this.nome = nome;
    this.ip = ip;
    this.cookie = '';
    this.agente = new http.Agent({ keepAlive: true, maxSockets: 6 });
  }
  /** Una richiesta; restituisce { stato, ms, byte, corpo }. stato 0 = errore di rete. */
  chiama(metodo, percorso, corpo, tieniCorpo = false, ritentata = false) {
    const inizio = performance.now();
    return new Promise((fine) => {
      const dati = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
      const req = http.request(
        {
          host: BASE.hostname, port: BASE.port, path: percorso, method: metodo, agent: this.agente,
          headers: {
            'X-Forwarded-For': this.ip, 'X-Logbook': '1', Accept: 'application/json',
            ...(this.cookie ? { Cookie: this.cookie } : {}),
            ...(dati ? { 'Content-Type': 'application/json', 'Content-Length': dati.length } : {}),
          },
          timeout: 60000,
        },
        (res) => {
          const sc = res.headers['set-cookie'];
          if (sc) {
            const mappa = new Map(this.cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c]));
            for (const c of sc) { const kv = c.split(';')[0]; mappa.set(kv.split('=')[0], kv); }
            this.cookie = [...mappa.values()].join('; ');
          }
          let byte = 0; const pezzi = [];
          res.on('data', (d) => { byte += d.length; if (tieniCorpo) pezzi.push(d); });
          res.on('end', () => fine({ stato: res.statusCode, ms: performance.now() - inizio, byte, corpo: tieniCorpo ? Buffer.concat(pezzi).toString() : '' }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      // Connessione keep-alive che il server ha chiuso per inattività (5 secondi in Node): il
      // browser in questo caso riprova da solo su una connessione nuova, e così fa la prova.
      req.on('error', (e) => {
        if (req.reusedSocket && e.code === 'ECONNRESET' && !ritentata) return fine(this.chiama(metodo, percorso, corpo, tieniCorpo, true).then((r) => ({ ...r, ms: performance.now() - inizio })));
        ERRORI_RETE[e.code ?? e.message] = (ERRORI_RETE[e.code ?? e.message] ?? 0) + 1;
        fine({ stato: 0, ms: performance.now() - inizio, byte: 0, corpo: '' });
      });
      if (dati) req.write(dati);
      req.end();
    });
  }
  login() { return this.chiama('POST', '/api/auth/login', { username: this.nome, password: PASSWORD }); }
  chiudi() { this.agente.destroy(); }
}

// ---------------------------------------------------------------------------------------
class Misure {
  constructor() { this.voci = new Map(); this.inizio = performance.now(); }
  segna(etichetta, r, atteso = [200, 201]) {
    let v = this.voci.get(etichetta);
    if (!v) this.voci.set(etichetta, (v = { ms: [], errori: 0, stati: {} }));
    v.ms.push(r.ms);
    if (!atteso.includes(r.stato)) { v.errori++; v.stati[r.stato] = (v.stati[r.stato] ?? 0) + 1; }
  }
  static pct(ordinati, p) { return ordinati.length ? ordinati[Math.min(ordinati.length - 1, Math.floor((p / 100) * ordinati.length))] : 0; }
  riepilogo(durataS) {
    const tutte = []; let errori = 0; const perVoce = {}; const stati = {};
    for (const [k, v] of this.voci) {
      const o = [...v.ms].sort((a, b) => a - b);
      tutte.push(...o); errori += v.errori;
      for (const [s, n] of Object.entries(v.stati)) stati[s] = (stati[s] ?? 0) + n;
      perVoce[k] = { n: o.length, p50: Math.round(Misure.pct(o, 50)), p95: Math.round(Misure.pct(o, 95)), max: Math.round(o.at(-1) ?? 0), errori: v.errori };
    }
    tutte.sort((a, b) => a - b);
    const s = durataS ?? (performance.now() - this.inizio) / 1000;
    return {
      richieste: tutte.length, alSecondo: Math.round((tutte.length / s) * 10) / 10,
      p50: Math.round(Misure.pct(tutte, 50)), p95: Math.round(Misure.pct(tutte, 95)), p99: Math.round(Misure.pct(tutte, 99)), max: Math.round(tutte.at(-1) ?? 0),
      errori, erroriPct: tutte.length ? Math.round((errori / tutte.length) * 10000) / 100 : 0, stati, perVoce,
    };
  }
}

/** Processo del server (da netstat) e suo consumo: secondi di CPU e memoria. */
const PID = (() => {
  try {
    const riga = execSync('netstat -ano -p TCP').toString().split(/\r?\n/).find((r) => r.includes(`:${BASE.port} `) && /LISTENING|ASCOLTO/.test(r));
    return riga ? Number(riga.trim().split(/\s+/).at(-1)) : null;
  } catch { return null; }
})();
function consumo() {
  if (!PID) return null;
  try {
    const [cpu, mem] = execSync(`powershell -NoProfile -Command "$p = Get-Process -Id ${PID}; '{0};{1}' -f $p.CPU.ToString([cultureinfo]::InvariantCulture), $p.WorkingSet64"`).toString().trim().split(';').map(Number);
    return { cpuS: cpu, memMB: Math.round(mem / 1048576) };
  } catch { return null; }
}
/** Esegue `lavoro` e aggiunge quanta CPU del server è servita (100% = un core intero). */
async function conConsumo(lavoro) {
  const prima = consumo(); const t0 = performance.now();
  const esito = await lavoro();
  const dopo = consumo(); const s = (performance.now() - t0) / 1000;
  return { ...esito, durataS: Math.round(s * 10) / 10, cpuServerPct: prima && dopo ? Math.round(((dopo.cpuS - prima.cpuS) / s) * 100) : null, memMB: dopo?.memMB ?? null };
}

async function apriSessioni(n, prefisso = 'carico', da = 1) {
  const utenti = [];
  for (let i = 0; i < n; i++) utenti.push(new Utente(`${prefisso}${prefisso === 'hr' ? da + i : String(da + i).padStart(3, '0')}`, `10.${prefisso === 'hr' ? 2 : 1}.${Math.floor((da + i) / 250)}.${((da + i) % 250) + 1}`));
  // A gruppi di 20: qui serve solo avere le sessioni, il login si misura nella fase "login".
  for (let i = 0; i < utenti.length; i += 20) {
    const r = await Promise.all(utenti.slice(i, i + 20).map((u) => u.login()));
    const ko = r.filter((x) => x.stato !== 200);
    if (ko.length) throw new Error(`login non riuscito: stato ${ko[0].stato}`);
  }
  return utenti;
}

// Pagine del dipendente: le chiamate che il browser fa aprendo quella pagina (in parallelo).
const MESI = ['2026-09', '2026-10', '2026-11'];
const finoA = (m) => `${m}-${m.endsWith('09') || m.endsWith('11') ? '30' : '31'}`;
const PAGINE_DIPENDENTE = [
  { peso: 4, nome: 'dashboard', chiamate: () => [['GET', '/api/auth/io'], ['GET', '/api/oggi'], ['GET', '/api/dashboard']] },
  { peso: 3, nome: 'calendario', chiamate: () => { const m = scegli(MESI); return [['GET', `/api/calendario?da=${m}-01&a=${finoA(m)}`], ['GET', '/api/progetti']]; } },
  { peso: 2, nome: 'timbra', chiamate: () => [['GET', '/api/timbrature/mie']] },
  { peso: 1, nome: 'assenze', chiamate: () => [['GET', '/api/assenze'], ['GET', '/api/saldi']] },
  { peso: 1, nome: 'note-spese', chiamate: () => [['GET', '/api/note-spese']] },
];
const PAGINE_HR = [
  { peso: 3, nome: 'hr-dashboard', chiamate: () => [['GET', '/api/auth/io'], ['GET', '/api/dashboard'], ['GET', '/api/timbrature']] },
  { peso: 3, nome: 'hr-calendario', chiamate: () => { const m = scegli(MESI); return [['GET', `/api/calendario?da=${m}-01&a=${finoA(m)}`]]; } },
  { peso: 2, nome: 'hr-dipendenti', chiamate: () => [['GET', '/api/dipendenti']] },
  { peso: 2, nome: 'hr-costi', chiamate: () => [['GET', '/api/costi-progetti']] },
  { peso: 1, nome: 'hr-excel-mese', chiamate: () => [['POST', '/api/esporta/consulente', { da: '2026-10-01', a: '2026-10-31', dipendenteIds: [], progettoIds: [] }]] },
];
const pesata = (pagine) => { const tot = pagine.reduce((s, p) => s + p.peso, 0); let x = Math.random() * tot; return pagine.find((p) => (x -= p.peso) < 0) ?? pagine[0]; };
async function apriPagina(u, pagine, misure) {
  const p = pesata(pagine); const t0 = performance.now();
  const r = await Promise.all(p.chiamate().map(([m, url, corpo]) => u.chiama(m, url, corpo).then((x) => { misure.segna(`${m} ${url.split('?')[0]}`, x); return x; })));
  misure.segna(`pagina ${p.nome}`, { stato: r.every((x) => x.stato === 200 || x.stato === 201) ? 200 : 500, ms: performance.now() - t0 });
}
/** Solo le voci "pagina …" contano come tempo percepito; le altre sono le singole chiamate. */
const soloChiamate = (m) => { const c = new Misure(); for (const [k, v] of m.voci) if (!k.startsWith('pagina ')) c.voci.set(k, v); return c; };
const solePagine = (m) => { const c = new Misure(); for (const [k, v] of m.voci) if (k.startsWith('pagina ')) c.voci.set(k, v); return c; };

// ---------------------------------------------------------------------------------------
const fasi = {
  /** Quanti accessi insieme: ogni login costa una verifica scrypt (CPU). */
  async login() {
    const esiti = [];
    for (const n of [25, 100, 300]) {
      const utenti = Array.from({ length: n }, (_, i) => new Utente(`carico${String(i + 1).padStart(3, '0')}`, `10.1.${Math.floor(i / 250)}.${(i % 250) + 1}`));
      const m = new Misure();
      const r = await conConsumo(async () => { await Promise.all(utenti.map((u) => u.login().then((x) => m.segna('login', x)))); return {}; });
      esiti.push({ insieme: n, ...r, ...m.riepilogo(r.durataS), perVoce: undefined });
      utenti.forEach((u) => u.chiudi());
      await pausa(1500);
    }
    // Stesso indirizzo per tutti (ufficio dietro un solo router, o proxy che non passa l'indirizzo vero).
    const stessi = Array.from({ length: 60 }, (_, i) => new Utente(`carico${String(i + 1).padStart(3, '0')}`, '10.9.9.9'));
    const m = new Misure();
    await Promise.all(stessi.map((u) => u.login().then((x) => m.segna('login', x))));
    esiti.push({ insieme: '60 dallo stesso indirizzo', ...m.riepilogo(), perVoce: undefined });
    stessi.forEach((u) => u.chiudi());
    return esiti;
  },

  /** Portata massima: N utenti che chiedono senza pause. Dice quante richieste al secondo regge il server. */
  async portata() {
    const utenti = await apriSessioni(N_UTENTI);
    const esiti = [];
    for (const n of [1, 10, 50, 100, 200, 300]) {
      const m = new Misure(); const fine = performance.now() + 12000;
      const r = await conConsumo(async () => {
        await Promise.all(utenti.slice(0, n).map(async (u) => {
          while (performance.now() < fine) { const p = pesata(PAGINE_DIPENDENTE); for (const [met, url] of p.chiamate()) m.segna(`${met} ${url.split('?')[0]}`, await u.chiama(met, url)); }
        }));
        return {};
      });
      esiti.push({ contemporanei: n, ...r, ...m.riepilogo(r.durataS) });
      await pausa(1000);
    }
    return esiti;
  },

  /** Uso vero: ogni utente apre una pagina, la guarda 3-10 secondi, ne apre un'altra. 2% sono HR. */
  async realistico() {
    const dip = await apriSessioni(N_UTENTI);
    const hr = await apriSessioni(5, 'hr');
    const esiti = [];
    for (const n of [100, 300, 600, 1000, 1500, 2500]) {
      const nHr = Math.max(1, Math.round(n * 0.02)); const m = new Misure(); const durata = 40000; const fine = performance.now() + durata;
      const r = await conConsumo(async () => {
        const giro = async (u, pagine) => { await pausa(caso(0, 6500)); while (performance.now() < fine) { await apriPagina(u, pagine, m); await pausa(caso(3000, 10000)); } };
        await Promise.all([
          ...Array.from({ length: n - nHr }, (_, i) => giro(dip[i % dip.length], PAGINE_DIPENDENTE)),
          ...Array.from({ length: nHr }, (_, i) => giro(hr[i % hr.length], PAGINE_HR)),
        ]);
        return {};
      });
      const chiamate = soloChiamate(m).riepilogo(r.durataS); const pagine = solePagine(m).riepilogo(r.durataS);
      esiti.push({ utenti: n, diCuiHr: nHr, ...r, chiamateAlSecondo: chiamate.alSecondo, chiamata: { p50: chiamate.p50, p95: chiamate.p95, p99: chiamate.p99, max: chiamate.max }, pagina: { n: pagine.richieste, p50: pagine.p50, p95: pagine.p95, p99: pagine.p99, max: pagine.max }, errori: chiamate.errori, erroriPct: chiamate.erroriPct, stati: chiamate.stati, piuLente: Object.entries(chiamate.perVoce).sort((a, b) => b[1].p95 - a[1].p95).slice(0, 4).map(([k, v]) => `${k}: p95 ${v.p95} ms (n ${v.n})`) });
      // Oltre il limite non serve insistere: con pagine oltre i 5 secondi il punto è già trovato.
      if (pagine.p95 > 5000 || chiamate.erroriPct > 5) break;
      await pausa(2000);
    }
    return esiti;
  },

  /** Picco del mattino: tutti timbrano. Scritture sul database, che in SQLite passano una alla volta. */
  async picco() {
    const dip = await apriSessioni(N_UTENTI);
    const progetto = new Map();
    await Promise.all(dip.map(async (u) => { const r = await u.chiama('GET', '/api/timbrature/mie', undefined, true); progetto.set(u, JSON.parse(r.corpo).progetti[0]?.id); }));
    const giro = async (etichetta, verso, sparsiMs) => {
      const m = new Misure();
      const r = await conConsumo(async () => {
        await Promise.all(dip.map(async (u) => { if (sparsiMs) await pausa(caso(0, sparsiMs)); m.segna(verso, await u.chiama('POST', `/api/timbrature/${verso}`, verso === 'entrata' ? { progettoId: progetto.get(u) } : {})); }));
        return {};
      });
      const x = m.riepilogo(r.durataS);
      return { prova: etichetta, ...r, p50: x.p50, p95: x.p95, max: x.max, errori: x.errori, stati: x.stati };
    };
    return [
      await giro('300 entrate sparse in 30 secondi', 'entrata', 30000),
      await giro('300 uscite nello stesso istante', 'uscita', 0),
      await giro('300 entrate nello stesso istante', 'entrata', 0),
      await giro('300 uscite sparse in 5 secondi', 'uscita', 5000),
    ];
  },

  /** Operazioni pesanti di HR e quanto fermano gli altri: intanto un dipendente chiede l'ora ogni 25 ms. */
  async pesanti() {
    const [hr] = await apriSessioni(1, 'hr'); const [dip] = await apriSessioni(1);
    const prove = [
      ['calendario di tutti, un mese', 'GET', '/api/calendario?da=2026-10-01&a=2026-10-31'],
      ['Excel consulente, un mese', 'POST', '/api/esporta/consulente', { da: '2026-10-01', a: '2026-10-31', dipendenteIds: [], progettoIds: [] }],
      ['Excel calendario lavorato, un mese', 'POST', '/api/esporta/calendario', { da: '2026-10-01', a: '2026-10-31', dipendenteIds: [], progettoIds: [] }],
      ['Excel consulente, tre mesi', 'POST', '/api/esporta/consulente', { da: '2026-09-01', a: '2026-11-26', dipendenteIds: [], progettoIds: [] }],
      ['estratto del mese a schermo', 'POST', '/api/esporta/mese', { mese: '2026-10', dipendenteIds: [], progettoIds: [] }],
      ['costi dei progetti', 'GET', '/api/costi-progetti'],
      ['elenco dipendenti', 'GET', '/api/dipendenti'],
    ];
    const esiti = [];
    for (const [nome, met, url, corpo] of prove) {
      let attivo = true; const attese = [];
      const sonda = (async () => { while (attivo) { attese.push((await dip.chiama('GET', '/api/oggi')).ms); await pausa(25); } })();
      await pausa(200);
      const r = await hr.chiama(met, url, corpo);
      attivo = false; await sonda;
      esiti.push({ operazione: nome, stato: r.stato, ms: Math.round(r.ms), kB: Math.round(r.byte / 1024), altriFermiFinoAMs: Math.round(Math.max(...attese)) });
      await pausa(500);
    }
    return esiti;
  },
};

if (!fasi[fase]) { console.error('fase sconosciuta'); process.exit(1); }
const esito = await fasi[fase]();
writeFileSync(new URL(`./esito-${fase}.json`, import.meta.url), JSON.stringify(esito, null, 1));
for (const riga of esito) console.log(JSON.stringify({ ...riga, perVoce: undefined }));
if (Object.keys(ERRORI_RETE).length) console.log('errori di rete', JSON.stringify(ERRORI_RETE));
process.exit(0);
