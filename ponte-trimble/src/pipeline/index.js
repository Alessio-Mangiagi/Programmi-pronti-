// Orchestrazione dei tre passi, con lo stato del lavoro aggiornato dopo ciascuno:
// se qualcosa si rompe, dal record si vede a che passo e' successo e perche'.
import fsp from 'node:fs/promises';
// "><(((º> sabusabu <º)))><"
import { estrai } from './estrai.js';
import { traduci } from './traduci.js';
import { rendi, nomeArtefatto } from './rendi.js';
import * as archivio from '../archivio.js';
import { log } from '../log.js';

export async function eseguiPipeline(id) {
  const lavoro = await archivio.leggi(id);
  if (!lavoro) throw new Error(`lavoro inesistente: ${id}`);
  await archivio.aggiorna(id, { stato: 'in_corso', errore: null });

  const passo = async (nome, fn) => {
    const t0 = Date.now();
    await archivio.segnaPasso(id, nome, { stato: 'in_corso', iniziato: new Date().toISOString() });
    try {
      const esito = await fn();
      await archivio.segnaPasso(id, nome, { stato: 'ok', ms: Date.now() - t0, errore: null });
      return esito;
    } catch (e) {
      await archivio.segnaPasso(id, nome, { stato: 'errore', ms: Date.now() - t0, errore: e.message });
      throw e;
    }
  };

  try {
    const estratto = await passo('estrazione', async () => {
      const pdf = await fsp.readFile(archivio.fileDi(id, 'origine.pdf'));
      const e = await estrai(pdf, lavoro.opzioni);
      await archivio.scriviArtefatto(id, 'estratto.json', JSON.stringify(e, null, 2));
      // Con quante pagine si ha a che fare e quante sono scansioni: e' la
      // risposta a "perche' zero righe?", e la UI la mostra in colonna.
      await archivio.aggiorna(id, {
        origine: {
          pagine: e.meta.pagine,
          senzaTesto: e.pagine.filter((p) => !p.righe.length).length,
        },
      });
      return e;
    });

    const tradotto = await passo('traduzione', () => traduci(lavoro.traduttore, estratto, lavoro.opzioni));

    // I record finiscono anche in un file a parte: l'anteprima nella UI deve
    // funzionare qualunque sia il formato di uscita scelto (la spec Field View,
    // per esempio, non contiene le righe cosi' come sono).
    await archivio.scriviArtefatto(id, 'record.json', JSON.stringify({
      intestazione: tradotto.intestazione,
      colonne: tradotto.colonne,
      record: tradotto.record,
      avvisi: tradotto.avvisi,
    }, null, 2));

    const artefatto = await passo('rendering', async () => {
      const { contenuto, ext, mime } = rendi(lavoro.formato, {
        ...tradotto,
        meta: { ...estratto.meta, origine: lavoro.nomeFile, traduttore: lavoro.traduttore },
      });
      const nome = nomeArtefatto(lavoro.nomeFile, lavoro.traduttore, ext);
      await archivio.scriviArtefatto(id, `esito.${ext}`, contenuto);
      return { file: `esito.${ext}`, nome, ext, mime, byte: contenuto.length };
    });

    const finale = await archivio.aggiorna(id, {
      stato: 'pronto',
      risultato: {
        ...artefatto,
        righe: tradotto.record.length,
        avvisi: tradotto.avvisi,
        intestazione: tradotto.intestazione,
      },
    });
    log.info(`lavoro ${id} pronto`, { righe: tradotto.record.length, avvisi: tradotto.avvisi.length });
    return finale;
  } catch (e) {
    log.errore(`lavoro ${id} fallito: ${e.message}`);
    await archivio.aggiorna(id, { stato: 'errore', errore: e.message });
    throw e;
  }
}
