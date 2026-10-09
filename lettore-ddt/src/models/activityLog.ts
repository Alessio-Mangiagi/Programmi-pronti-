import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

export type ActivityEvent = {
  timestamp: string;
  type:
    | 'login_success'
    | 'login_failed'
    | 'logout'
    | 'user_created'
    | 'user_deleted'
    | 'login_locked'
    | 'password_changed'
    | 'password_reset'
    | 'account_disabled'
    | 'account_enabled'
    | 'apikey_updated'
    | 'apikey_deleted';
  username: string;
  commessaId: string | null;
  ip: string;
};

interface LogFile {
  events: ActivityEvent[];
}

// DDT_ACTIVITY_LOG_PATH esiste per i test: senza override ogni login finto
// finiva nel registro attività reale mostrato nel pannello admin.
const LOG_PATH =
  process.env.DDT_ACTIVITY_LOG_PATH || path.join(__dirname, '..', '..', 'activity_log.json');
const MAX_EVENTS = 5000;

let logCache: LogFile | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function getLogDb(): LogFile {
  if (!logCache) {
    if (!fs.existsSync(LOG_PATH)) {
      logCache = { events: [] };
    } else {
      const raw = fs.readFileSync(LOG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      logCache = { events: parsed.events || [] };
    }
  }
  return logCache;
}

// Scritture accodate e accorpate (come in database.ts): con una scrittura già
// in attesa non ne serve una seconda, prenderà comunque lo stato più recente.
let writePending = false;

function persistLogDb(): void {
  if (writePending) return;
  writePending = true;
  const tmpPath = LOG_PATH + '.tmp';
  writeQueue = writeQueue
    .then(async () => {
      writePending = false;
      await fs.promises.writeFile(tmpPath, JSON.stringify(logCache, null, 2), 'utf8');
      await fs.promises.rename(tmpPath, LOG_PATH);
    })
    .catch((err) => {
      writePending = false;
      logger.error('Errore scrittura activity_log.json:', err);
    });
}

function logActivity(
  type: ActivityEvent['type'],
  username: string,
  commessaId: string | null,
  ip: string
): void {
  const db = getLogDb();
  db.events.push({ timestamp: new Date().toISOString(), type, username, commessaId, ip });
  if (db.events.length > MAX_EVENTS) {
    db.events = db.events.slice(db.events.length - MAX_EVENTS);
  }
  persistLogDb();
}

function getRecentActivity(limit: number = 200): ActivityEvent[] {
  const events = getLogDb().events;
  return events.slice(Math.max(0, events.length - limit)).reverse();
}

type ActiveAccount = {
  username: string;
  commessaId: string | null;
  lastLogin: string;
};

function getActiveAccounts(days: number = 30): ActiveAccount[] {
  // "><(((º> sabusabu <º)))><"
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const byUser = new Map<string, ActiveAccount>();
  for (const ev of getLogDb().events) {
    if (ev.type !== 'login_success') continue;
    if (new Date(ev.timestamp).getTime() < cutoff) continue;
    const existing = byUser.get(ev.username);
    if (!existing || existing.lastLogin < ev.timestamp) {
      byUser.set(ev.username, {
        username: ev.username,
        commessaId: ev.commessaId,
        lastLogin: ev.timestamp,
      });
    }
  }
  return Array.from(byUser.values()).sort((a, b) => b.lastLogin.localeCompare(a.lastLogin));
}

export { logActivity, getRecentActivity, getActiveAccounts };
