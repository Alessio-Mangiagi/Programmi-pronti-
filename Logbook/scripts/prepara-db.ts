// "><(((º> sabusabu <º)))><"
/**
 * Prepara il database prima dell'avvio (eseguito da solo prima di `npm run dev` e, con
 * l'argomento --produzione, prima di `npm start` / avvia.bat).
 *
 * 1. Se manca il client Prisma generato (es. npm install con --ignore-scripts) lo genera.
 * 2. Applica le migrazioni mancanti (`prisma migrate deploy`): crea data/logbook.db la
 *    prima volta e aggiorna la struttura dopo un aggiornamento dell'app. Non cancella
 *    mai dati: le migrazioni sono solo quelle già scritte in prisma/migrations.
 * 3. Se non c'è nessun dipendente carica i dati di esempio (prisma/seed.ts), ma solo
 *    dove serve: di default in sviluppo sì, in produzione no (LOGBOOK_DATI_DEMO cambia
 *    la scelta, vedi server/dati-demo.ts).
 * 4. Se non c'è nessun amministratore attivo ne crea uno (vedi sotto).
 *
 * Così "npm run dev" su una copia appena scaricata parte già con dati da guardare,
 * l'installazione per HR parte vuota e su un database in uso non si tocca nulla.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RADICE_APP } from '../server/database-url';
import { decidiDatiDemo } from '../server/dati-demo';

// package.json: "prestart" passa --produzione, "predev" no.
const modo = process.argv.includes('--produzione') ? 'produzione' : 'sviluppo';

try {
  process.loadEnvFile(path.join(RADICE_APP, '.env'));
} catch {
  // Nessun .env: valgono i default.
}

/** Lancia la CLI di Prisma installata nell'app con lo stesso Node, senza passare da npx. */
function prismaCli(...argomenti: string[]) {
  const cli = path.join(RADICE_APP, 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [cli, ...argomenti], { cwd: RADICE_APP, stdio: 'inherit' });
}

if (!fs.existsSync(path.join(RADICE_APP, 'generated', 'prisma', 'client.ts'))) {
  console.log('[logbook] genero il client Prisma…');
  prismaCli('generate');
}

prismaCli('migrate', 'deploy');

// Import dinamici: il client generato esiste solo dopo il passo 1.
const { creaPrisma } = await import('../server/db');
const { semina } = await import('../prisma/seed');
const prisma = creaPrisma();
try {
  if ((await prisma.dipendente.count()) === 0) {
    const demo = decidiDatiDemo(process.env.LOGBOOK_DATI_DEMO, modo);
    if (demo.avviso) console.warn(`[logbook] ${demo.avviso}`);
    if (demo.carica) {
      const r = await semina(prisma);
      console.log(
        `[logbook] database vuoto: caricati i dati di esempio (${r.dipendenti} dipendenti, ${r.progetti} progetti, ` +
          `${r.registrazioni} fasce orarie dal ${r.periodo.da} al ${r.periodo.a}).`,
      );
    } else {
      console.log(
        `[logbook] database vuoto, nessun dato di esempio (${modo}): entrare come amministratore e inserire ` +
          'dipendenti e progetti. Per i dati di prova: LOGBOOK_DATI_DEMO=1.',
      );
    }
  } else {
    console.log('[logbook] database pronto.');
  }

  // Senza nessun amministratore nessuno potrebbe creare account: se manca (es. tutti
  // disattivati per errore, o database migrato da una versione senza utenti) se ne crea
  // uno con la password di LOGBOOK_ADMIN_PASSWORD o quella di prova, da cambiare subito.
  if ((await prisma.utente.count({ where: { ruolo: 'ADMIN', attivo: true } })) === 0) {
    const { creaImpronta } = await import('../server/auth/password');
    const password = process.env.LOGBOOK_ADMIN_PASSWORD || 'Admin2026!';
    const username = (await prisma.utente.findUnique({ where: { username: 'admin' } })) ? `admin${Date.now() % 10000}` : 'admin';
    await prisma.utente.create({ data: { username, passwordHash: await creaImpronta(password), ruolo: 'ADMIN' } });
    console.log(`[logbook] ATTENZIONE: creato l'amministratore "${username}". Cambiare subito la password dall'app.`);
  }
} finally {
  await prisma.$disconnect();
}
