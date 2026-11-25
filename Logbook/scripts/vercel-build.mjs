// "><(((º> sabusabu <º)))><"
/**
 * Build di Logbook per Vercel (Giorno 35, 25/11/2026). È il "Build Command" del progetto
 * (vercel.json) e produce la cartella .vercel/output nel formato che Vercel pubblica così
 * com'è (Build Output API v3):
 *
 *   .vercel/output/config.json              instradamento: /api/* alla funzione, il resto ai file
 *   .vercel/output/static/                  l'interfaccia compilata (vite build → dist/)
 *   .vercel/output/functions/api.func/      tutto il server in un solo file (esbuild)
 *
 * Passi:
 * 1. controlla che DATABASE_URL sia un PostgreSQL (su Vercel un file SQLite non dura);
 * 2. copia dello schema per PostgreSQL e client del database (prisma generate);
 * 3. struttura del database, primo amministratore e festività (scripts/prepara-db.ts);
 * 4. interfaccia (vite build);
 * 5. server impacchettato da server/vercel-funzione.ts.
 *
 * Variabili d'ambiente da impostare nel progetto Vercel: vedi docs/vercel.md.
 * Prova in locale: DATABASE_URL=postgres://… node scripts/vercel-build.mjs, poi
 * node scripts/vercel-prova.mjs (serve .vercel/output su una porta locale).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uscita = path.join(radice, '.vercel', 'output');
const bin = (nome, ...resto) => path.join(radice, 'node_modules', nome, ...resto);
const node = (file, argomenti = [], env = {}) => execFileSync(process.execPath, [file, ...argomenti], { cwd: radice, stdio: 'inherit', env: { ...process.env, ...env } });
const passo = (n, testo) => console.log(`\n[logbook] ${n}. ${testo}`);

// Le integrazioni di Vercel con Neon/Supabase/Postgres chiamano la variabile in modi diversi.
const url = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || '';
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error(
    '[logbook] ERRORE: manca DATABASE_URL con un indirizzo PostgreSQL (postgres://…).\n' +
      'Su Vercel il database non può essere un file: collegare un database PostgreSQL (es. Neon dal\n' +
      'Marketplace di Vercel) e impostare DATABASE_URL nelle variabili d\'ambiente del progetto.',
  );
  process.exit(1);
}
process.env.DATABASE_URL = url;
// Per creare le tabelle serve una connessione diretta, non quella "pooled", se il servizio le distingue.
const urlDiretto = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || url;

passo(1, 'schema per PostgreSQL e client del database');
node(path.join(radice, 'scripts', 'schema-postgres.mjs'));
node(bin('prisma', 'build', 'index.js'), ['generate']);

passo(2, 'struttura del database, primo amministratore, festività');
node(bin('tsx', 'dist', 'cli.mjs'), [path.join('scripts', 'prepara-db.ts'), '--produzione'], { DATABASE_URL: urlDiretto });

passo(3, 'interfaccia');
node(bin('vite', 'bin', 'vite.js'), ['build', '--logLevel', 'warn']);

passo(4, 'pacchetto per Vercel');
fs.rmSync(uscita, { recursive: true, force: true });
fs.mkdirSync(path.join(uscita, 'functions', 'api.func'), { recursive: true });
fs.cpSync(path.join(radice, 'dist'), path.join(uscita, 'static'), { recursive: true });

const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [path.join(radice, 'server', 'vercel-funzione.ts')],
  outfile: path.join(uscita, 'functions', 'api.func', 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Tutto dentro un file: la funzione non ha node_modules. Fuori solo i moduli che il codice
  // non carica mai su Vercel (SQLite nativo, driver facoltativi di pg).
  external: ['better-sqlite3', '@prisma/adapter-better-sqlite3', 'pg-native', 'pg-cloudflare'],
  // Molte librerie sono CommonJS: dentro un modulo ES servono require, __filename e __dirname.
  banner: {
    js: [
      "import { createRequire as __creaRequire } from 'node:module';",
      "import { fileURLToPath as __daUrl } from 'node:url';",
      "import { dirname as __cartella } from 'node:path';",
      'const require = __creaRequire(import.meta.url);',
      'const __filename = __daUrl(import.meta.url);',
      'const __dirname = __cartella(__filename);',
    ].join('\n'),
  },
  logLevel: 'warning',
  legalComments: 'none',
});
fs.writeFileSync(
  path.join(uscita, 'functions', 'api.func', '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 30, memory: 1024, regions: ['fra1'] }, null, 2),
);

// Stesse intestazioni di sicurezza che server/app.ts mette sulle pagine quando le serve lui.
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
  "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
fs.writeFileSync(
  path.join(uscita, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Tutte le API alla funzione (Express riceve l'indirizzo originale, es. /api/auth/login).
        { src: '^/api(?:/.*)?$', dest: '/api' },
        // File con l'impronta nel nome: in cache per sempre.
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        {
          src: '^/(?!api(?:/|$)).*$',
          headers: {
            'content-security-policy': csp,
            'x-frame-options': 'DENY',
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'same-origin',
            'strict-transport-security': 'max-age=31536000',
          },
          continue: true,
        },
        { handle: 'filesystem' },
        // Ogni altro indirizzo (es. /calendario ricaricato): la pagina unica, mai in cache.
        { src: '^/(?!api(?:/|$)).*$', dest: '/index.html', headers: { 'cache-control': 'no-cache' } },
      ],
    },
    null,
    2,
  ),
);
const mb = (fs.statSync(path.join(uscita, 'functions', 'api.func', 'index.mjs')).size / 1024 / 1024).toFixed(1);
console.log(`\n[logbook] pronto: .vercel/output (funzione ${mb} MB).`);
