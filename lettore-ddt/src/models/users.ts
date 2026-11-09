import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
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
  /**
   * Commesse che l'account può scegliere all'ingresso in "DDT e Magazzino" (decisione del 09/11/2026,
   * opzione b): codici del registro della suite e/o cartelle precedenti di data/. Le imposta un
   * amministratore dalla pagina admin. Assente o vuoto = la commessa di sempre dell'account
   * (commessaId e codiceCommessa), cioè come prima del programma unico: nessuno vede di più senza
   * che un amministratore lo decida. Gli amministratori vedono comunque tutte le commesse.
   */
  commesseAbilitate?: string[];
  /**
   * Account creato da solo al primo ingresso dal portale (09/11/2026, un solo login per "DDT e
   * Magazzino"): niente password propria (vale quella unica del portale), nessuna commessa finché un
   * amministratore non gliene abilita (commessaId vuoto).
   */
  creatoDalPortale?: boolean;
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

/**
 * Crea l'account DDT di una persona del portale al suo primo ingresso in "DDT e Magazzino" (decisione
 * dell'utente del 09/11/2026: un solo login, supera la regola del 06/11 "il DDT non crea account").
 * Non amministratore, legato allo username del portale, senza commessa (gliele abilita un admin) e
 * senza una password utilizzabile: l'hash è di un segreto casuale che nessuno conosce, si entra solo
 * dal portale (ingressoDalPortale). Se l'account c'è già lo restituisce com'è.
 */
function creaAccountDalPortale(username: string, nome: string): UserRow {
  const esistente = findUserByUsernameCI(username);
  if (esistente) return esistente;
  const db = getUsersDb();
  const record: UserRow = {
    id: randomUUID(),
    username,
    passwordHash: bcrypt.hashSync(randomBytes(32).toString('base64url'), 10),
    commessaId: '',
    displayName: nome || username,
    isAdmin: false,
    creatoDalPortale: true,
  };
  db.users.push(record);
  persistUsersDb();
  return record;
}

/**
 * Imposta l'elenco delle commesse abilitate di un utente (codici del registro / cartelle precedenti,
 * già validati dalla rotta admin). Elenco vuoto = torna alla commessa di sempre dell'account.
 */
function setCommesseAbilitate(id: string, commesse: string[]): UserRow | null {
  const user = getUsersDb().users.find((u) => u.id === id);
  if (!user) return null;
  const pulite = [...new Set((commesse || []).map((c) => String(c || '').trim()).filter(Boolean))];
  if (pulite.length) user.commesseAbilitate = pulite;
  else delete user.commesseAbilitate;
  persistUsersDb();
  return user;
}

export {
  creaAccountDalPortale,
  setCommesseAbilitate,
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
