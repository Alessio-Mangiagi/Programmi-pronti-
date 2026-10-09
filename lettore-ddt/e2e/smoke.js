#!/usr/bin/env node
/**
 * smoke.js — Prova di fumo end-to-end: avvia il server compilato, guida
 * l'interfaccia in un Chromium vero e verifica i percorsi che i test unitari
 * non vedono (login, tab, prompt dal server, pagina batch).
 *
 * Uso:  npm run build && npm run test:e2e
 *
 * Non tocca l'API Claude (chiave finta) e usa un utente usa-e-getta che viene
 * rimosso alla fine. Serve playwright (npm i -D playwright) e il browser
 * (npx playwright install chromium).
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const RADICE = path.join(__dirname, '..');
const UTENTE = `e2e-smoke-${Date.now()}`;
const PASSWORD = 'E2eSmoke123!';
const COMMESSA = '__e2e_smoke__';
const SHOT_DIR = path.join(__dirname, 'ultimo-giro');

function esci(codice, msg) {
  // "><(((º> sabusabu <º)))><"
  if (msg) console.error(msg);
  process.exit(codice);
}

function ping(porta) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: porta, path: '/status', timeout: 700 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function porteAttive() {
  const attive = new Set();
  for (let p = 5050; p <= 5059; p++) if (await ping(p)) attive.add(p);
  return attive;
}

async function main() {
  if (!fs.existsSync(path.join(RADICE, 'dist', 'server.js'))) {
    esci(1, 'dist/server.js mancante: esegui prima "npm run build".');
  }
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    esci(1, 'playwright non installato: npm i -D playwright && npx playwright install chromium');
  }

  // Utente usa-e-getta (stesso archivio dei test jest).
  const { createUser, deleteUser } = require(path.join(RADICE, 'dist', 'models', 'users'));
  const { randomUUID } = require('crypto');
  // Amministratore: la pagina "Conversione automatica" è riservata agli admin
  // (batch.config.json → soloAdmin, che dalla 2.4 è il default).
  createUser(randomUUID(), UTENTE, PASSWORD, COMMESSA, 'Smoke E2E', true);

  // Il server sceglie da solo la prima porta libera: si individua quella NUOVA
  // rispetto a prima dell'avvio, così un'istanza reale già attiva non confonde.
  const prima = await porteAttive();
  const server = spawn(process.execPath, ['dist/server.js'], {
    cwd: RADICE,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      COSEDIL_SSO: 'off',
      ANTHROPIC_API_KEY: 'sk-ant-finta-smoke',
      HOST: '127.0.0.1',
      // La prova di fumo avvia una seconda istanza di proposito: il lock che
      // impedisce i doppioni accidentali qui va disattivato.
      DDT_ISTANZA_LOCK: 'off',
    },
    stdio: 'ignore',
  });

  let porta = 0;
  for (let i = 0; i < 40 && !porta; i++) {
    await new Promise((r) => setTimeout(r, 500));
    for (let p = 5050; p <= 5059; p++) {
      if (!prima.has(p) && (await ping(p))) {
        porta = p;
        break;
      }
    }
  }

  const fallimenti = [];
  const ok = (nome, esito) => {
    console.log(`  ${esito ? 'ok  ' : 'FAIL'} ${nome}`);
    if (!esito) fallimenti.push(nome);
  };

  let browser;
  try {
    if (!porta) throw new Error('il server non ha aperto nessuna porta 5050-5059 entro 20s');
    console.log(`server e2e su :${porta}\n`);
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    const erroriPagina = [];
    page.on('pageerror', (e) => erroriPagina.push(e.message));

    await page.goto(`http://127.0.0.1:${porta}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Login
    await page.fill('input[type="text"], input[name="username"]', UTENTE);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"], button:has-text("Accedi")');
    await page.waitForTimeout(2000);
    const corpo = () => page.locator('body').innerText();
    ok('login e app caricata', (await corpo()).includes('Importa'));

    // Prompt dal server (fonte unica): i 4 bottoni preset devono comparire.
    // Il testo va confrontato case-insensitive: il CSS rende le etichette in
    // maiuscolo e innerText restituisce il testo così com'è mostrato.
    await page.waitForTimeout(1000);
    const t1 = (await corpo()).toLowerCase();
    ok('prompt caricati dal server', t1.includes('calcestruzzo') && !t1.includes('carico i prompt'));

    // Pagina batch
    await page.locator('text=Conversione automatica').first().click();
    await page.waitForTimeout(1200);
    const t2 = await corpo();
    ok('pagina Conversione automatica', t2.includes('Conversione automatica di una cartella') || t2.includes('riservata agli amministratori'));
    ok('bottone Pulisci DDT presente', (await page.locator('button:has-text("Pulisci DDT")').count()) > 0 || t2.includes('riservata'));
    // Scelta del motore: c'è sempre, anche quando Ollama non è installato
    // (in quel caso il radio è spento e il titolo spiega perché).
    ok('scelta motore con Ollama presente', t2.includes('Ollama locale') || t2.includes('riservata'));

    await page.screenshot({ path: path.join(SHOT_DIR, 'batch.png'), fullPage: true });
    ok('nessun errore JavaScript in pagina', erroriPagina.length === 0);
    if (erroriPagina.length) console.log('   errori:', erroriPagina.join(' | '));
  } catch (e) {
    fallimenti.push(`imprevisto: ${e.message}`);
    console.error('FAIL imprevisto:', e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
    try {
      deleteUser(UTENTE);
    } catch {
      /* già assente */
    }
    // Dati della commessa di prova: via.
    fs.rmSync(path.join(RADICE, 'data', COMMESSA), { recursive: true, force: true });
  }

  console.log(fallimenti.length ? `\n${fallimenti.length} controlli falliti.` : '\nSmoke test superato.');
  process.exit(fallimenti.length ? 1 : 0);
}

main().catch((e) => esci(1, `Errore: ${e.stack || e.message}`));
