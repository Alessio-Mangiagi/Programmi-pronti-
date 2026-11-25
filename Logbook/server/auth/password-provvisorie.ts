// "><(((º> sabusabu <º)))><"
/**
 * Password provvisorie da cambiare al primo accesso (Giorno 24, risposta 1a del 24/11/2026,
 * dopo la verifica di sicurezza del Giorno 23).
 *
 * Il problema: se manca un amministratore l'avvio ne creava uno con "Admin2026!", scritta
 * nel README; chiunque in rete poteva entrare come HR. Gli account di esempio hanno
 * "Logbook2026!", anche questa pubblica. Ora:
 * - l'amministratore creato all'avvio nasce con Utente.passwordDaCambiare = true;
 * - all'avvio in produzione (scripts/prepara-db.ts) ogni account che ha ancora una password
 *   pubblicata viene segnato allo stesso modo;
 * - quando HR crea un account o ne reimposta la password, vale lo stesso
 *   (server/rotte/dipendenti.ts).
 * Finché il segno c'è, le API rispondono 403 tranne /api/auth (server/middleware.ts) e
 * l'interfaccia mostra solo la pagina per cambiarla (src/pagine/PasswordProvvisoria.tsx).
 */
import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { controllaPasswordNuova, creaImpronta, verificaPassword } from './password';

/**
 * Crea un amministratore se non ce n'è nessuno attivo. Senza amministratori nessuno potrebbe
 * creare account (es. tutti disattivati per errore, o database migrato da una versione senza
 * utenti). Nome utente e password sono quelli scelti all'installazione (InstallaLogbook.exe,
 * InstallaSuite.exe: LOGBOOK_ADMIN_USERNAME / LOGBOOK_ADMIN_PASSWORD passati solo a quel
 * comando) e allora la password è definitiva; altrimenti "admin" con una password casuale
 * provvisoria. Restituisce il nome utente creato (e la password, se generata), o null.
 */
export async function assicuraAdmin(
  prisma: PrismaClient,
  scelte: { username?: string; password?: string; definitiva?: boolean } = {},
): Promise<{ username: string; passwordGenerata?: string } | null> {
  if ((await prisma.utente.count({ where: { ruolo: 'ADMIN', attivo: true } })) > 0) return null;
  const voluto = (scelte.username || 'admin').trim().toLowerCase();
  const username = (await prisma.utente.findUnique({ where: { username: voluto } })) ? `${voluto}${Date.now() % 10000}` : voluto;
  // Giorno 34: senza una password indicata se ne genera una a caso, mostrata una volta sola
  // nella finestra di avvio. Niente più "Admin2026!" uguale su ogni installazione.
  const passwordGenerata = scelte.password ? undefined : randomBytes(12).toString('base64url');
  const password = scelte.password ?? passwordGenerata!;
  // Definitiva solo se l'ha scelta chi installa (installatore): quella generata o scritta
  // nel .env è provvisoria e va cambiata al primo accesso.
  const passwordDaCambiare = !(scelte.definitiva && scelte.password);
  await prisma.utente.create({ data: { username, passwordHash: await creaImpronta(password), ruolo: 'ADMIN', passwordDaCambiare } });
  return { username, passwordGenerata };
}

/**
 * Recupero dell'amministratore quando la password è persa (25/11/2026, nato per Vercel: la
 * password provvisoria generata compare una volta sola nel log della build). Si usa mettendo
 * LOGBOOK_ADMIN_REIMPOSTA=1 insieme a LOGBOOK_ADMIN_USERNAME e LOGBOOK_ADMIN_PASSWORD e
 * rilanciando la preparazione del database (scripts/prepara-db.ts; su Vercel: Redeploy).
 * - Se l'account esiste: nuova password, ruolo amministratore, riattivato, sessioni chiuse.
 * - Se non esiste: viene creato come amministratore.
 * La password è provvisoria (al primo accesso Logbook chiede di sceglierne un'altra), a meno
 * che chi la imposta dica che è definitiva (LOGBOOK_ADMIN_DEFINITIVA=1): è il caso in cui
 * la password l'ha scelta il proprietario stesso.
 * Chi può scrivere queste variabili ha già in mano il database, quindi non apre porte nuove;
 * la variabile LOGBOOK_ADMIN_REIMPOSTA va comunque tolta subito dopo.
 * Solleva un errore se la password non rispetta le regole degli amministratori.
 */
export async function reimpostaAdmin(prisma: PrismaClient, usernameVoluto: string, password: string, definitiva = false): Promise<{ username: string; creato: boolean }> {
  const username = usernameVoluto.trim().toLowerCase();
  if (!username) throw new Error('LOGBOOK_ADMIN_USERNAME è vuota');
  const problema = controllaPasswordNuova(password, 'ADMIN');
  if (problema) throw new Error(`LOGBOOK_ADMIN_PASSWORD non va bene: ${problema}`);
  const passwordHash = await creaImpronta(password);
  const esistente = await prisma.utente.findUnique({ where: { username } });
  if (!esistente) {
    await prisma.utente.create({ data: { username, passwordHash, ruolo: 'ADMIN', passwordDaCambiare: !definitiva } });
    return { username, creato: true };
  }
  await prisma.utente.update({ where: { id: esistente.id }, data: { passwordHash, ruolo: 'ADMIN', attivo: true, passwordDaCambiare: !definitiva } });
  // Chi era dentro con la password vecchia esce.
  await prisma.sessione.deleteMany({ where: { utenteId: esistente.id } });
  return { username, creato: false };
}

/**
 * Segna "da cambiare" gli account attivi che hanno ancora una password pubblicata.
 * `pubblicate`: per ogni password, quali account controllare (pochi di proposito: ogni
 * verifica costa circa 50 ms di scrypt, e si ripete a ogni avvio finché la password resta
 * quella). Restituisce i nomi utente segnati.
 */
export async function segnaPasswordPubblicate(
  prisma: PrismaClient,
  pubblicate: { password: string; utenti: Prisma.UtenteWhereInput }[],
): Promise<string[]> {
  const segnati: string[] = [];
  for (const { password, utenti } of pubblicate) {
    const candidati = await prisma.utente.findMany({ where: { AND: [utenti, { attivo: true, passwordDaCambiare: false }] } });
    for (const u of candidati) {
      if (!(await verificaPassword(password, u.passwordHash))) continue;
      await prisma.utente.update({ where: { id: u.id }, data: { passwordDaCambiare: true } });
      segnati.push(u.username);
    }
  }
  return segnati;
}
