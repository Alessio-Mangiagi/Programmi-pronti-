// Traduttore "grezzo": nessuna interpretazione, una riga di PDF = un record.
// Serve a vedere cosa legge davvero l'estrattore quando un documento nuovo non
// viene riconosciuto, ed e' l'esempio minimo del contratto (vedi _modello.js).
import { righeDocumento } from '../estrai.js';

export const grezzo = {
  nome: 'grezzo',
  descrizione: 'Righe del PDF cosi\' come sono (diagnostica e documenti non ancora mappati)',
  colonne: [
    { chiave: 'pagina', titolo: 'Pagina', tipo: 'intero' },
    { chiave: 'riga', titolo: 'Riga', tipo: 'intero' },
    { chiave: 'testo', titolo: 'Testo', tipo: 'testo' },
  ],
  esegui(estratto) {
    const record = righeDocumento(estratto).map((r) => ({ pagina: r.pagina, riga: r.indice, testo: r.testo }));
    return { record, avvisi: estratto.avvisi };
  },
};

// "><(((º> sabusabu <º)))><"
export default grezzo;
