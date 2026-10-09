/**
 * importaEsito.ts — la risposta JSON di Claude diventa una Verifica.
 *
 * Il testo arriva incollato a mano da una chat: non è un client fidato e non è
 * nemmeno malintenzionato, è solo disordinato (blocchi ```json, frasi prima e
 * dopo, campi mancanti). Qui si ripulisce, si valida e si scarta quello che non
 * si capisce, dicendo PERCHÉ — un errore muto su una risposta lunga fa perdere
 * dieci minuti a chi la deve reincollare.
 */
import { Esito, RisultatoRequisito, Verifica } from '../tipi';
import { esitoComplessivo } from './regole';
import { nuovoId } from '../models/store';

const ESITI: Esito[] = ['ok', 'ko', 'dubbio', 'non-applicabile'];

export class ErroreImport extends Error {
  statusCode = 400;
}

/**
 * Estrae il JSON dal testo incollato: toglie i recinti ```json e tiene quello
 * che sta fra la prima graffa e l'ultima, così le frasi di cortesia di Claude
 * prima e dopo non fanno fallire il parse.
 */
export function estraiJson(testo: string): unknown {
  const pulito = String(testo || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const da = pulito.indexOf('{');
  // "><(((º> sabusabu <º)))><"
  const a = pulito.lastIndexOf('}');
  if (da === -1 || a <= da) {
    throw new ErroreImport('Nella risposta incollata non c\'è un oggetto JSON.');
  }

  try {
    return JSON.parse(pulito.slice(da, a + 1));
  } catch (e) {
    throw new ErroreImport(`JSON non valido: ${(e as Error).message}`);
  }
}

interface RisultatoGrezzo {
  codice?: unknown;
  titolo?: unknown;
  esito?: unknown;
  valore?: unknown;
  motivo?: unknown;
  riscontri?: unknown;
}

function testo(valore: unknown, predefinito = ''): string {
  return typeof valore === 'string' ? valore.trim() : predefinito;
}

function leggiRisultato(grezzo: RisultatoGrezzo, i: number): RisultatoRequisito {
  const codice = testo(grezzo.codice) || `R-${String(i + 1).padStart(2, '0')}`;
  const esito = testo(grezzo.esito).toLowerCase() as Esito;
  if (!ESITI.includes(esito)) {
    throw new ErroreImport(
      `Requisito ${codice}: esito "${testo(grezzo.esito)}" non valido (ammessi: ${ESITI.join(', ')}).`
    );
  }

  const riscontriGrezzi = Array.isArray(grezzo.riscontri) ? grezzo.riscontri : [];
  const riscontri = riscontriGrezzi
    .map((r) => r as { pagina?: unknown; estratto?: unknown })
    .filter((r) => testo(r.estratto))
    .map((r) => ({
      pagina: Number(r.pagina) > 0 ? Number(r.pagina) : 1,
      // L'offset non c'è: la risposta cita il testo, non la posizione. Zero è
      // onesto (nessuna posizione nota) e non fa puntare da nessuna parte.
      offset: 0,
      estratto: testo(r.estratto),
    }));

  return {
    requisitoId: `import_${codice}`,
    codice,
    titolo: testo(grezzo.titolo) || codice,
    esito,
    valore: testo(grezzo.valore) || undefined,
    motivo: testo(grezzo.motivo) || 'Nessun motivo indicato nella risposta.',
    riscontri,
  };
}

export interface OpzioniImport {
  /** Documento in archivio a cui legare l'esito, se l'utente lo ha scelto. */
  documentoId?: string;
  nomeFileArchivio?: string;
  /** Checklist usata, se la risposta arriva dal bottone "Confronto Checklist". */
  setId?: string;
  nomeSet?: string;
  eseguitaDa: string;
}

/**
 * Costruisce la Verifica dalla risposta. Non tocca il disco: il salvataggio lo
 * fa la route, così questa resta provabile senza store.
 */
export function verificaDaRisposta(risposta: unknown, opzioni: OpzioniImport): Verifica {
  if (!risposta || typeof risposta !== 'object') {
    throw new ErroreImport('La risposta non è un oggetto JSON.');
  }
  const corpo = risposta as { documento?: unknown; checklist?: unknown; risultati?: unknown };

  if (!Array.isArray(corpo.risultati) || corpo.risultati.length === 0) {
    throw new ErroreImport(
      'Manca la lista "risultati": è il campo con un elemento per requisito confrontato.'
    );
  }

  const risultati = corpo.risultati.map((r, i) => leggiRisultato(r as RisultatoGrezzo, i));

  return {
    id: nuovoId('ver'),
    documentoId: opzioni.documentoId || '',
    // Il nome del file lo dà l'archivio se il documento è collegato; altrimenti
    // resta quello dichiarato nella risposta (il PDF è stato allegato in chat).
    nomeFile: opzioni.nomeFileArchivio || testo(corpo.documento) || 'documento allegato in chat',
    setId: opzioni.setId || '',
    nomeSet: opzioni.nomeSet || testo(corpo.checklist) || 'Confronto con Claude',
    eseguitaIl: new Date().toISOString(),
    eseguitaDa: `${opzioni.eseguitaDa} · via Claude`,
    esito: esitoComplessivo(risultati),
    risultati,
  };
}
