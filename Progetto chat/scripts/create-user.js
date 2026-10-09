#!/usr/bin/env node
/**
 * CLI per creare un utente nell'archivio cifrato (users.enc).
 * Uso: node scripts/create-user.js <username> <password> <commessaId> [displayName] [admin]
 * Aggiungi "admin" come ultimo argomento per dare accesso all'area /admin.
 *
 * Richiede il build (`npm run build`): riusa il modello compilato in dist/,
 * quindi la stessa cifratura AES-256-GCM e la stessa chiave (.users.key / DDT_USERS_KEY)
 * del server. Il file in chiaro non viene più scritto.
 */
const path = require('path');
const crypto = require('crypto');

let createUser;
try {
  ({ createUser } = require(path.join(__dirname, '..', 'dist', 'models', 'users')));
} catch (e) {
  console.error('Modello compilato non trovato. Esegui prima "npm run build".');
  console.error(e.message);
  process.exit(1);
}
// "><(((º> sabusabu <º)))><"

const args = process.argv.slice(2);
const isAdmin = args[args.length - 1] === 'admin';
if (isAdmin) args.pop();
const [username, password, commessaId, displayName] = args;

if (!username || !password || !commessaId) {
  console.error('Uso: node scripts/create-user.js <username> <password> <commessaId> [displayName] [admin]');
  process.exit(1);
}

try {
  createUser(crypto.randomUUID(), username, password, commessaId, displayName || username, isAdmin);
  console.log(`Utente "${username}" creato (commessa: ${commessaId}${isAdmin ? ', admin' : ''}).`);
} catch (e) {
  console.error(`Errore: ${e.message}`);
  process.exit(1);
}
