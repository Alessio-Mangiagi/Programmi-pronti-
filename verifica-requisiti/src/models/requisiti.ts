/**
 * requisiti.ts — le checklist da controllare sui documenti.
 *
 * Un SetRequisiti è una checklist ("Documenti di cantiere", "Fornitore nuovo",
 * "Idoneità tecnico-professionale"): l'utente la compila una volta e la
 * riapplica a ogni documento. Il set di esempio serve a far vedere come si
 * scrivono le regole; si può cancellare.
 */
import { Requisito, SetRequisiti } from '../tipi';
import { leggiJson, scriviJson, nuovoId } from './store';

const FILE = 'requisiti.json';

function setDiEsempio(): SetRequisiti {
  return {
    id: 'set_esempio',
    nome: 'Esempio — idoneità fornitore',
    descrizione:
      'Checklist dimostrativa: mostra i cinque tipi di regola disponibili. Duplicala e adattala.',
    creatoIl: new Date().toISOString(),
    requisiti: [
      {
        id: 'req_durc',
        codice: 'DURC-01',
        titolo: 'Il documento è un DURC',
        obbligatorio: true,
        regola: {
          tipo: 'presenza',
          termini: ['documento unico di regolarità contributiva', 'durc'],
        },
      },
      {
        id: 'req_scadenza',
        codice: 'DURC-02',
        titolo: 'DURC non scaduto',
        descrizione: 'Cattura la data di scadenza e la confronta con oggi.',
        obbligatorio: true,
        regola: {
          tipo: 'scadenza',
          pattern: 'scadenza\\D{0,20}(\\d{2}[\\/\\-\\.]\\d{2}[\\/\\-\\.]\\d{4})',
          gruppo: 1,
          preavvisoGiorni: 30,
        },
      },
      {
        id: 'req_piva',
        codice: 'ANA-01',
        titolo: 'Partita IVA presente',
        obbligatorio: true,
        regola: {
          tipo: 'regex',
          pattern: '(?:partita\\s*iva|p\\.?\\s*iva)\\D{0,10}(\\d{11})',
          gruppo: 1,
        },
      },
      {
        id: 'req_esito',
        codice: 'ANA-02',
        titolo: 'Nessuna irregolarità dichiarata',
        obbligatorio: true,
        regola: { tipo: 'assenza', termini: ['non risulta regolare', 'irregolare'] },
      },
      {
        id: 'req_firma',
        codice: 'FIR-01',
        titolo: 'Firma leggibile del responsabile',
        descrizione: 'La firma non si controlla da testo: la guarda una persona.',
        obbligatorio: false,
        regola: { tipo: 'manuale' },
      },
    ],
  };
}

function tutti(): SetRequisiti[] {
  const elenco = leggiJson<SetRequisiti[]>(FILE, []);
  if (elenco.length === 0) {
    const iniziale = [setDiEsempio()];
    scriviJson(FILE, iniziale);
    return iniziale;
  }
  // "><(((º> sabusabu <º)))><"
  return elenco;
}

export function elencaSet(): SetRequisiti[] {
  return tutti();
}

export function trovaSet(id: string): SetRequisiti | undefined {
  return tutti().find((s) => s.id === id);
}

export function creaSet(dati: { nome: string; descrizione?: string; requisiti?: Requisito[] }): SetRequisiti {
  const set: SetRequisiti = {
    id: nuovoId('set'),
    nome: dati.nome,
    descrizione: dati.descrizione,
    creatoIl: new Date().toISOString(),
    requisiti: (dati.requisiti ?? []).map(conId),
  };
  scriviJson(FILE, [...tutti(), set]);
  return set;
}

export function aggiornaSet(
  id: string,
  patch: Partial<Pick<SetRequisiti, 'nome' | 'descrizione' | 'requisiti'>>
): SetRequisiti | undefined {
  const elenco = tutti();
  const i = elenco.findIndex((s) => s.id === id);
  if (i === -1) return undefined;
  elenco[i] = {
    ...elenco[i],
    ...patch,
    requisiti: patch.requisiti ? patch.requisiti.map(conId) : elenco[i].requisiti,
    id: elenco[i].id,
  };
  scriviJson(FILE, elenco);
  return elenco[i];
}

export function eliminaSet(id: string): boolean {
  const elenco = tutti();
  if (!elenco.some((s) => s.id === id)) return false;
  scriviJson(
    FILE,
    elenco.filter((s) => s.id !== id)
  );
  return true;
}

/** I requisiti arrivano dal frontend anche senza id (righe appena aggiunte). */
function conId(r: Requisito): Requisito {
  return r.id ? r : { ...r, id: nuovoId('req') };
}
