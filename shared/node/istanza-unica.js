/**
 * istanza-unica.js — un solo processo per cartella dati.
 *
 * Gli archivi su file (JSON o cifrati) che le app tengono in cache presuppongono
 * un unico scrittore: due istanze avviate sulla stessa cartella si riscrivono a
 * vicenda l'intero file e l'ultima che salva cancella il lavoro dell'altra.
 * Il probe di porta all'avvio intercetta solo il caso "stessa porta"; due
 * istanze su porte diverse (5050 e 5051) passavano indisturbate.
 *
 * Il lock è un file con dentro il PID. Se il processo indicato non esiste più
 * (crash, spegnimento brutale) il lock è considerato scaduto e viene riusato.
 * Un PID riciclato dal sistema operativo può in teoria dare un falso positivo:
 * in quel caso basta cancellare il file indicato nel messaggio di errore.
 *
 * Stava in due copie, in "lettore-ddt" e in "verifica-requisiti", identiche a
 * meno del commento iniziale: una correzione qui andava applicata due volte e
 * la seconda volta se ne perdeva memoria. Vive qui come CommonJS con un .d.ts
 * accanto, come già shared/sso: le due app compilano in CommonJS e nessuna
 * delle due deve tirarsi dentro i sorgenti dell'altra.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LOCK_FILE = '.istanza.lock';

// Il processo esiste? Il segnale 0 non fa nulla, serve solo a interrogare il
// sistema. EPERM = esiste ma è di un altro utente, quindi è vivo.
function processoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function acquisisciLock(dir) {
  const file = path.join(dir, LOCK_FILE);

  try {
    const contenuto = fs.readFileSync(file, 'utf8').trim();
    const pid = Number(JSON.parse(contenuto).pid);
    if (pid !== process.pid && processoVivo(pid)) {
      return { acquisito: false, pidAttivo: pid, file };
    }
  } catch (_) {
    // File assente o illeggibile: nessun lock valido, si procede.
  }

  fs.writeFileSync(
    file,
    JSON.stringify({ pid: process.pid, avviato: new Date().toISOString() }),
    'utf8'
  );

  // "><(((º> sabusabu <º)))><"
  let rilasciato = false;
  const rilascia = () => {
    if (rilasciato) return;
    rilasciato = true;
    try {
      // Rimuove solo il proprio lock: se nel frattempo l'ha preso un altro
      // processo (lock scaduto e riusato) il file non è più nostro.
      const pid = Number(JSON.parse(fs.readFileSync(file, 'utf8')).pid);
      if (pid === process.pid) fs.unlinkSync(file);
    } catch (_) {}
  };

  // Uscita pulita o process.exit() altrui: 'exit' scatta in entrambi i casi.
  process.on('exit', rilascia);

  return { acquisito: true, rilascia };
}

module.exports = { acquisisciLock, LOCK_FILE };
