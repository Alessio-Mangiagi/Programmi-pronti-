import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import logger from '../utils/logger';
import { encryptString, decryptString } from '../utils/secureStore';

export type UserRow = {
  id: string;
  username: string;
  passwordHash: string;
  commessaId: string;
  displayName: string;
  isAdmin?: boolean;
  disabled?: boolean;
  /** Codice commessa aziendale (es. "101-003"): con questo i DDT finiscono in SkyTower. */
  codiceCommessa?: string;
};

interface UsersFile {
  users: UserRow[];
}

// DDT_USERS_PATH esiste per i test (src/__tests__/env.ts): senza, ogni test che crea un account
// (test-user-…, admin finti) lo scriveva nell'archivio vero dell'installazione, che poi compariva
// nel pannello admin. Il vecchio users.json in chiaro si cerca accanto all'archivio scelto.
const USERS_PATH = process.env.DDT_USERS_PATH || path.join(__dirname, '..', '..', 'users.enc');
const LEGACY_USERS_PATH = path.join(path.dirname(USERS_PATH), 'users.json');

let usersCache: UsersFile | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function getUsersDb(): UsersFile {
  if (usersCache) return usersCache;

  // 1) File cifrato presente: decifra.
  if (fs.existsSync(USERS_PATH)) {
    try {
      const decrypted = decryptString(fs.readFileSync(USERS_PATH, 'utf8'));
      const parsed = JSON.parse(decrypted);
      usersCache = { users: parsed.users || [] };
      return usersCache;
    } catch (err) {
      logger.error('Impossibile decifrare users.enc (chiave errata o file corrotto):', err);
      throw new Error(
        'Archivio utenti non decifrabile: verifica la chiave DDT_USERS_KEY/.users.key'
      );
    }
  }

  // 2) Migrazione: esiste ancora il vecchio users.json in chiaro → cifra e rimuovi.
  if (fs.existsSync(LEGACY_USERS_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(LEGACY_USERS_PATH, 'utf8'));
      usersCache = { users: parsed.users || [] };
      persistUsersDbSync();
      fs.unlinkSync(LEGACY_USERS_PATH);
      logger.info('users.json migrato a users.enc (cifrato) e rimosso il file in chiaro.');
      return usersCache;
    } catch (err) {
      logger.error('Errore migrazione users.json → users.enc:', err);
    }
  }

  // 3) Nessun file: archivio vuoto.
  usersCache = { users: [] };
  return usersCache;
}

function persistUsersDbSync(): void {
  const snapshot = encryptString(JSON.stringify(usersCache, null, 2));
  const tmpPath = USERS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, snapshot, 'utf8');
  fs.renameSync(tmpPath, USERS_PATH);
}

function persistUsersDb(): void {
  const snapshot = encryptString(JSON.stringify(usersCache, null, 2));
  const tmpPath = USERS_PATH + '.tmp';
  writeQueue = writeQueue
    .then(() => fs.promises.writeFile(tmpPath, snapshot, 'utf8'))
    .then(() => fs.promises.rename(tmpPath, USERS_PATH))
    .catch((err) => {
      logger.error('Errore scrittura users.enc:', err);
    });
}

function findUserByUsername(username: string): UserRow | undefined {
  return getUsersDb().users.find((u) => u.username === username);
}

/** Come findUserByUsername ma senza badare alle maiuscole: lo username del portale è sempre minuscolo. */
function findUserByUsernameCI(username: string): UserRow | undefined {
  const u = String(username || '').toLowerCase();
  return getUsersDb().users.find((x) => x.username.toLowerCase() === u);
}

// Hash fittizio (password "·") per equalizzare i tempi quando l'utente non esiste:
// evita user-enumeration via timing.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function verifyPassword(username: string, password: string): UserRow | null {
  const user = findUserByUsername(username);
  if (!user) {
    bcrypt.compareSync(password, DUMMY_HASH); // tempo costante
    return null;
  }
  return bcrypt.compareSync(password, user.passwordHash) ? user : null;
}

export const MIN_PASSWORD_LENGTH = 8;

function createUser(
  id: string,
  username: string,
  password: string,
  commessaId: string,
  displayName: string,
  isAdmin: boolean = false,
  codiceCommessa: string = ''
): UserRow {
  const db = getUsersDb();
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri`);
  }
  if (db.users.some((u) => u.username === username)) {
    throw new Error(`Utente "${username}" già esistente`);
  }
  const record: UserRow = {
    id,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    commessaId,
    displayName,
    isAdmin,
  };
  if (codiceCommessa.trim()) record.codiceCommessa = codiceCommessa.trim();
  db.users.push(record);
  persistUsersDb();
  return record;
}

export type PublicUser = Omit<UserRow, 'passwordHash'>;

function listUsers(): PublicUser[] {
  return getUsersDb().users.map(({ passwordHash, ...rest }) => rest);
}

function findUserById(id: string): UserRow | undefined {
  return getUsersDb().users.find((u) => u.id === id);
}

// "><(((º> sabusabu <º)))><"
function deleteUser(id: string): UserRow | null {
  const db = getUsersDb();
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  const [removed] = db.users.splice(idx, 1);
  persistUsersDb();
  return removed;
}

function updatePassword(id: string, newPassword: string): boolean {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri`);
  }
  const user = getUsersDb().users.find((u) => u.id === id);
  if (!user) return false;
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  persistUsersDb();
  return true;
}

function setUserDisabled(id: string, disabled: boolean): UserRow | null {
  const user = getUsersDb().users.find((u) => u.id === id);
  if (!user) return null;
  user.disabled = disabled;
  persistUsersDb();
  return user;
}

/** Imposta (o toglie, con '') il codice commessa aziendale di un utente. */
function setCodiceCommessa(id: string, codiceCommessa: string): UserRow | null {
  const user = getUsersDb().users.find((u) => u.id === id);
  if (!user) return null;
  const c = String(codiceCommessa || '').trim();
  if (c) user.codiceCommessa = c;
  else delete user.codiceCommessa;
  persistUsersDb();
  return user;
}

export {
  setCodiceCommessa,
  findUserByUsername,
  findUserByUsernameCI,
  findUserById,
  verifyPassword,
  createUser,
  listUsers,
  deleteUser,
  updatePassword,
  setUserDisabled,
};
