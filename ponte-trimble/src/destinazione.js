// Dove finisce il file prodotto. I due prodotti Trimble parlano lingue diverse,
// quindi la scelta e' una voce di configurazione (DESTINAZIONE), non un if sparso
// nelle rotte:
//
//   fieldview  API SOAP di Viewpoint Field View: AddForm crea un form da un
//              template gia' esistente. ATTENZIONE: AddForm NON trasferisce ne'
//              il file prodotto ne' le risposte — con le operazioni note oggi il
//              file resta scaricabile dall'app (o si deposita su Connect).
//   connect    API REST di Trimble Connect: carica il file in una cartella.
//   nessuna    solo conversione: il file si scarica dall'app.
import { CONFIG } from './config.js';
import { caricaFile, ErroreTrimble } from './trimble/client.js';
import { aggiungiForm, fieldviewConfigurato, mancanzeFieldView, ErroreFieldView } from './trimble/fieldview.js';
import { trimbleConfigurato } from './config.js';

export const DESTINAZIONI = ['fieldview', 'connect', 'nessuna'];

/** Stato della destinazione attiva, senza chiamare niente all'esterno. */
export function statoDestinazione() {
  const nome = CONFIG.destinazione;
  if (nome === 'nessuna') return { nome, configurata: true, motivo: 'nessun invio: il file si scarica dall\'app' };
  if (nome === 'fieldview') {
    return {
      nome,
      configurata: fieldviewConfigurato(),
      motivo: fieldviewConfigurato() ? null : `manca ${mancanzeFieldView().join(' e ')} in .env`,
      url: CONFIG.fieldview.url,
      soap: CONFIG.fieldview.soap,
    };
  }
  if (nome === 'connect') {
    return {
      nome,
      configurata: trimbleConfigurato(),
      motivo: trimbleConfigurato() ? null : 'servono le credenziali TRIMBLE_* in .env',
      apiBase: CONFIG.trimble.apiBase,
    };
  }
  // "><(((º> sabusabu <º)))><"
  return { nome, configurata: false, motivo: `destinazione sconosciuta (valide: ${DESTINAZIONI.join(', ')})` };
}

/**
 * Consegna il risultato di un lavoro alla destinazione configurata.
 * @param {object} lavoro     record del lavoro (serve risultato.nome/mime)
 * @param {Buffer} contenuto  file prodotto
 * @param {object} opzioni    override dal corpo della richiesta API
 * @returns {Promise<object>} da salvare nel record del lavoro
 */
export async function consegna(lavoro, contenuto, opzioni = {}) {
  const stato = statoDestinazione();
  if (!stato.configurata) {
    const errore = stato.nome === 'fieldview' ? new ErroreFieldView(stato.motivo) : new ErroreTrimble(stato.motivo);
    throw errore;
  }

  if (stato.nome === 'nessuna') {
    return { tipo: 'nessuna', stato: 'non_previsto', nota: 'DESTINAZIONE=nessuna: il file si scarica dall\'app' };
  }

  if (stato.nome === 'fieldview') {
    const esito = await aggiungiForm(opzioni);
    return {
      tipo: 'fieldview',
      stato: 'caricato',
      formId: esito.formId,
      richiesta: esito.richiesta,
      caricatoIl: new Date().toISOString(),
      errore: null,
      nota: 'AddForm crea il form dal template: il file prodotto non viene trasferito',
    };
  }

  const esito = await caricaFile({
    nome: lavoro.risultato.nome,
    contenuto,
    mime: lavoro.risultato.mime,
    projectId: opzioni.projectId,
    folderId: opzioni.folderId,
  });
  return {
    tipo: 'connect',
    stato: 'caricato',
    fileId: esito.fileId,
    versionId: esito.versionId,
    caricatoIl: new Date().toISOString(),
    errore: null,
  };
}
