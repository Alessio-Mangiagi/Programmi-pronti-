#!/usr/bin/env node
/**
 * Installa/aggiorna un account amministratore in TUTTI gli store di credenziali
 * della suite. Idempotente: rieseguirlo aggiorna la password dell'account.
 *
 * Uso: lanciare installa-credenziali.bat (legge username/password e li passa
 * qui via env CRED_USER / CRED_PASS / CRED_NAME — mai su argv, così la
 * password non compare nella command line dei processi).
 *
 * Store toccati (gli unici con utenti propri):
 *   1. portale/data/utenti.json      — scrypt, salt separato (fonte SSO)
 *   2. analista-dati/app.db          — SQLite, hash "scrypt$salt$hash"
 *   3. lettore-ddt/users.enc       — AES-256-GCM, dentro bcrypt (DDT)
 *
 * Le altre app (confronta, ocr, scadenzario, requisiti, trimble, auguri) non hanno
 * utenti locali: usano il gate SSO condiviso, e un utente con ruolo "admin" nel
 * portale è admin anche lì (vedi shared/sso/README.md).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const username = (process.env.CRED_USER || '').toLowerCase().trim();
const password = process.env.CRED_PASS || '';
const displayName = (process.env.CRED_NAME || '').trim() || username;

// Vincoli più stretti della suite (agente): valgono per tutti gli store.
if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error(`[ERR]  Username non valido: "${username}" (ammessi a-z 0-9 . _ -, da 3 a 32 caratteri)`);
  process.exit(1);
}
if (password.length < 8) {
  console.error('[ERR]  Password troppo corta (minimo 8 caratteri)');
  process.exit(1);
}
if (password.toLowerCase() === username) {
  console.error('[ERR]  La password non può essere uguale allo username');
  process.exit(1);
}

let errori = 0;
function step(nome, fn) {
  try {
    console.log(`[OK]   ${nome}: ${fn()}`);
  } catch (e) {
    errori++;
    console.error(`[ERR]  ${nome}: ${e.message}`);
  }
}
function writeFileAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// 1) PORTALE — data/utenti.json (stesso formato di makeUser in portale/server.js)
// ---------------------------------------------------------------------------
step('portale (data/utenti.json)', () => {
  // Stessa risoluzione di portale/server.js: DATA_DIR, se impostata, sposta i dati.
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'portale', 'data');
  const file = path.join(dataDir, 'utenti.json');
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  const esistente = list.find((u) => u.username === username);
  let msg;
  if (esistente) {
    esistente.salt = salt;
    esistente.hash = hash;
    esistente.ruolo = 'admin';
    esistente.mustChange = false;
    // bump della session-version: invalida i cookie emessi con la vecchia password
    esistente.sv = (esistente.sv || 1) + 1;
    msg = 'aggiornato (password + ruolo admin, vecchie sessioni invalidate)';
  } else {
    list.push({
      username, nome: displayName, ruolo: 'admin',
      salt, hash,
      mustChange: false, creato: new Date().toISOString(), sv: 1,
    });
    msg = 'creato';
  }
  writeFileAtomic(file, JSON.stringify(list, null, 2));
  return msg;
});

// ---------------------------------------------------------------------------
// 2) AGENTE — app.db, tabella users (schema e hash di analista-dati/server/auth.ts)
// ---------------------------------------------------------------------------
step('agente (app.db)', () => {
  const { DatabaseSync } = require('node:sqlite'); // Node >= 22.5
  // Stessa risoluzione di analista-dati/server/appdb.ts.
  const db = new DatabaseSync(process.env.APP_DB_PATH || path.join(ROOT, 'analista-dati', 'app.db'));
  try {
    // Stesso DDL di appdb.ts: se il DB non esiste ancora lo prepara, se esiste
    // non tocca nulla (IF NOT EXISTS + migrazione idempotente della colonna).
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE,
      pass_hash  TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    )`);
    const cols = db.prepare('PRAGMA table_info(users)').all();
    if (!cols.some((c) => c.name === 'must_change_pw')) {
      db.exec('ALTER TABLE users ADD COLUMN must_change_pw INTEGER NOT NULL DEFAULT 0');
    }

    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    const passHash = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;

    const info = db.prepare(`
      INSERT INTO users(username, pass_hash, role, created_at, must_change_pw)
      VALUES (?, ?, 'admin', ?, 0)
      ON CONFLICT(username) DO UPDATE SET
        pass_hash = excluded.pass_hash,
        role = 'admin',
        must_change_pw = 0
    `).run(username, passHash, new Date().toISOString());
    // Come il cambio password dell'app (auth.ts): via le sessioni aperte, o chi
    // aveva la vecchia password resterebbe dentro fino alla scadenza del cookie.
    // La tabella manca solo se l'agente non è mai partito: niente da invalidare.
    const haSessioni = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    const chiuse = haSessioni ? db.prepare('DELETE FROM sessions WHERE username = ?').run(username).changes : 0;
    return (info.lastInsertRowid ? 'creato/aggiornato' : 'aggiornato')
      + (chiuse ? `, ${chiuse} sessioni invalidate` : '');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 3) DDT (lettore-ddt) — users.enc: AES-256-GCM (secureStore.ts) + bcrypt
// ---------------------------------------------------------------------------
step('DDT "lettore-ddt" (users.enc)', () => {
  const dir = path.join(ROOT, 'lettore-ddt');

  // bcryptjs: pure-JS, presa dal node_modules dell'app; se manca la installa da sola.
  let bcrypt;
  const bcryptPath = path.join(dir, 'node_modules', 'bcryptjs');
  try {
    bcrypt = require(bcryptPath);
  } catch {
    const r = spawnSync('npm install bcryptjs --no-save --no-audit --no-fund', {
      cwd: dir, shell: true, stdio: 'ignore', timeout: 120000,
    });
    if (r.status !== 0) throw new Error('bcryptjs non presente e "npm install bcryptjs" fallito (rete assente?)');
    bcrypt = require(bcryptPath);
  }

  // Chiave: identica a secureStore.ts — env DDT_USERS_KEY (sha256) oppure
  // keyfile .users.key (hex), generato qui se assente.
  const keyPath = path.join(dir, '.users.key');
  let key;
  if (process.env.DDT_USERS_KEY) {
    key = crypto.createHash('sha256').update(process.env.DDT_USERS_KEY, 'utf8').digest();
  } else if (fs.existsSync(keyPath)) {
    key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
  } else {
    key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  }
  const encrypt = (plain) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  };
  const decrypt = (payload) => {
    const raw = Buffer.from(payload, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  };

  const encPath = path.join(dir, 'users.enc');
  const legacyPath = path.join(dir, 'users.json');
  let dbu = { users: [] };
  let daMigrare = false;
  if (fs.existsSync(encPath)) {
    dbu = { users: JSON.parse(decrypt(fs.readFileSync(encPath, 'utf8'))).users || [] };
  } else if (fs.existsSync(legacyPath)) {
    // stessa migrazione che farebbe l'app: cifra e rimuove il file in chiaro
    dbu = { users: JSON.parse(fs.readFileSync(legacyPath, 'utf8')).users || [] };
    daMigrare = true;
  }

  const esistente = dbu.users.find((u) => u.username === username);
  let msg;
  if (esistente) {
    esistente.passwordHash = bcrypt.hashSync(password, 10);
    esistente.isAdmin = true;
    esistente.disabled = false;
    msg = 'aggiornato (password + admin)';
  } else {
    dbu.users.push({
      id: crypto.randomUUID(),
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      commessaId: 'default',
      displayName,
      isAdmin: true,
    });
    msg = 'creato (commessa: default)';
  }
  writeFileAtomic(encPath, encrypt(JSON.stringify(dbu, null, 2)));
  if (daMigrare) fs.unlinkSync(legacyPath);
  // "><(((º> sabusabu <º)))><"
  return msg + (daMigrare ? ', users.json migrato a users.enc' : '');
});

console.log('');
if (errori) {
  console.error(`Completato con ${errori} errore/i (vedi sopra).`);
  process.exit(1);
}
console.log(`Fatto. "${username}" è admin su portale, agente e DDT.`);
console.log('Le altre app (confronta, ocr, scadenzario, requisiti, trimble, auguri) usano il login SSO');
console.log('del portale: l\'account admin vale anche per loro, senza store locali.');
