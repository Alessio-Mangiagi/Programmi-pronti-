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
 *    la scelta, vedi server/dati-demo.ts). Se resta vuoto e non ha nessuna festività,
 *    carica le festività nazionali dell'anno in corso e del successivo.
 * 4. Se non c'è nessun amministratore attivo ne crea uno (vedi sotto).
 *
 * Così "npm run dev" su una copia appena scaricata parte già con dati da guardare,
 * l'installazione per HR parte vuota e su un database in uso non si tocca nulla.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { oggiIso } from '../comune/date';
import { RADICE_APP, suPostgres } from '../server/database-url';
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

// Giorno 35: su PostgreSQL (Vercel) non ci sono le migrazioni SQL di SQLite: la struttura si
// allinea allo schema con `db push`, che crea ciò che manca e si ferma (senza toccare nulla)
// se una modifica farebbe perdere dati.
if (suPostgres()) prismaCli('db', 'push');
else prismaCli('migrate', 'deploy');

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
      // Il database parte senza dati finti ma con le festività nazionali (25/11/2026): sono
      // date vere e servono da subito a calendario, estratti e conteggio delle ferie. Solo
      // se non ce n'è nessuna, così quelle tolte o aggiunte da HR non tornano indietro.
      if ((await prisma.festivita.count()) === 0) {
        const { aggiungiFestivitaNazionali } = await import('../server/servizi/festivita');
        const anno = Number(oggiIso().slice(0, 4));
        let aggiunte = 0;
        for (const a of [anno, anno + 1]) aggiunte += await aggiungiFestivitaNazionali(prisma, a);
        console.log(`[logbook] caricate le festività nazionali ${anno} e ${anno + 1} (${aggiunte} giorni).`);
      }
    }
  } else {
    console.log('[logbook] database pronto.');
  }

  // Senza nessun amministratore nessuno potrebbe creare account: se manca se ne crea uno con
  // la password di LOGBOOK_ADMIN_PASSWORD o quella di prova. Dal Giorno 24 (risposta 1a)
  // Logbook obbliga a cambiarla al primo accesso (server/auth/password-provvisorie.ts).
  const { assicuraAdmin, reimpostaAdmin, segnaPasswordPubblicate } = await import('../server/auth/password-provvisorie');
  const { CREDENZIALI_DEMO, USERNAME_DEMO } = await import('../prisma/seed');
  // Giorno 34: il primo amministratore nasce con le credenziali scelte all'installazione
  // (l'installatore le passa solo a questo comando, non le scrive nel .env). Senza, "admin"
  // con una password casuale mostrata qui una volta sola e da cambiare al primo accesso.
  const creato = await assicuraAdmin(prisma, {
    username: process.env.LOGBOOK_ADMIN_USERNAME,
    password: process.env.LOGBOOK_ADMIN_PASSWORD || undefined,
    definitiva: process.env.LOGBOOK_ADMIN_DEFINITIVA === '1',
  });
  if (creato?.passwordGenerata) {
    console.log(`[logbook] ATTENZIONE: creato l'amministratore "${creato.username}" con la password provvisoria  ${creato.passwordGenerata}`);
    console.log('[logbook] Annotarla ORA: non viene più mostrata. Al primo accesso Logbook chiede di cambiarla.');
  } else if (creato) {
    console.log(`[logbook] creato l'amministratore "${creato.username}" con la password scelta all'installazione.`);
  }
  // Recupero dell'amministratore (25/11/2026): con LOGBOOK_ADMIN_REIMPOSTA=1 la password di
  // LOGBOOK_ADMIN_USERNAME diventa LOGBOOK_ADMIN_PASSWORD, provvisoria. Serve quando la
  // password è persa (su Vercel quella generata si vede solo nel log della prima build).
  if (!creato && process.env.LOGBOOK_ADMIN_REIMPOSTA === '1') {
    if (!process.env.LOGBOOK_ADMIN_USERNAME || !process.env.LOGBOOK_ADMIN_PASSWORD) {
      throw new Error('LOGBOOK_ADMIN_REIMPOSTA=1 richiede LOGBOOK_ADMIN_USERNAME e LOGBOOK_ADMIN_PASSWORD');
    }
    const definitiva = process.env.LOGBOOK_ADMIN_DEFINITIVA === '1';
    const r = await reimpostaAdmin(prisma, process.env.LOGBOOK_ADMIN_USERNAME, process.env.LOGBOOK_ADMIN_PASSWORD, definitiva);
    console.log(`[logbook] amministratore "${r.username}" ${r.creato ? 'creato' : 'reimpostato'} con la password di LOGBOOK_ADMIN_PASSWORD (${definitiva ? 'definitiva' : 'provvisoria'}).`);
    console.log('[logbook] Togliere ora LOGBOOK_ADMIN_REIMPOSTA dalle variabili.');
  }
  // In produzione (Logbook raggiungibile in rete) chi ha ancora una password scritta nel
  // README la deve cambiare al prossimo accesso: amministratori e account di esempio.
  if (modo === 'produzione') {
    const segnati = await segnaPasswordPubblicate(prisma, [
      { password: CREDENZIALI_DEMO.admin.password, utenti: { ruolo: 'ADMIN' } },
      { password: CREDENZIALI_DEMO.passwordDipendenti, utenti: { username: { in: USERNAME_DEMO } } },
    ]);
    if (segnati.length) console.log(`[logbook] password di prova ancora in uso, da cambiare al prossimo accesso: ${segnati.join(', ')}`);
  }
} finally {
  await prisma.$disconnect();
}
