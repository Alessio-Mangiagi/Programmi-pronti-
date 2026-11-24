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
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { creaImpronta, verificaPassword } from './password';

/**
 * Crea un amministratore se non ce n'è nessuno attivo. Senza amministratori nessuno potrebbe
 * creare account (es. tutti disattivati per errore, o database migrato da una versione senza
 * utenti). La password è quella indicata (LOGBOOK_ADMIN_PASSWORD) o quella di prova, e va
 * comunque cambiata al primo accesso. Restituisce il nome utente creato, o null.
 */
export async function assicuraAdmin(prisma: PrismaClient, password: string): Promise<string | null> {
  if ((await prisma.utente.count({ where: { ruolo: 'ADMIN', attivo: true } })) > 0) return null;
  const username = (await prisma.utente.findUnique({ where: { username: 'admin' } })) ? `admin${Date.now() % 10000}` : 'admin';
  await prisma.utente.create({ data: { username, passwordHash: await creaImpronta(password), ruolo: 'ADMIN', passwordDaCambiare: true } });
  return username;
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
