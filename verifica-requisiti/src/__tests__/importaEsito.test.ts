/**
 * Prove dell'import della risposta di Claude. Il testo arriva incollato a mano
 * da una chat: qui si prova che il disordine tipico (recinti ```json, frasi di
 * contorno, campi mancanti) non faccia fallire l'import, e che invece un esito
 * inventato venga rifiutato con un messaggio leggibile.
 */
import { ErroreImport, estraiJson, verificaDaRisposta } from '../services/importaEsito';

const OPZIONI = { eseguitaDa: 'mario' };

describe('estraiJson', () => {
  it('toglie i recinti markdown e le frasi attorno', () => {
    const testo = 'Ecco l\'esito:\n```json\n{"risultati":[]}\n```\nSpero sia utile!';
    expect(estraiJson(testo)).toEqual({ risultati: [] });
  });

  it('lo dice chiaramente se non c\'è JSON', () => {
    expect(() => estraiJson('Non sono riuscito a leggere il documento.')).toThrow(ErroreImport);
  });

  it('lo dice chiaramente se il JSON è rotto', () => {
    expect(() => estraiJson('{"risultati": [ }')).toThrow(/JSON non valido/);
  });
});

describe('verificaDaRisposta', () => {
  const risposta = {
    documento: 'durc-rossi.pdf',
    checklist: 'Idoneità fornitore',
    risultati: [
      {
        codice: 'DURC-01',
        titolo: 'Il documento è un DURC',
        esito: 'ok',
        motivo: 'Trovata la dicitura.',
        riscontri: [{ pagina: 2, estratto: 'Documento Unico di Regolarità Contributiva' }],
      },
      {
        codice: 'DURC-02',
        titolo: 'Non scaduto',
        esito: 'ko',
        valore: '01/01/2020',
        motivo: 'Scaduto.',
      },
    ],
  };

  it('costruisce la verifica e ne calcola l\'esito complessivo', () => {
    const v = verificaDaRisposta(risposta, OPZIONI);
    expect(v.esito).toBe('ko');
    expect(v.risultati).toHaveLength(2);
    expect(v.nomeFile).toBe('durc-rossi.pdf');
    expect(v.nomeSet).toBe('Idoneità fornitore');
    expect(v.eseguitaDa).toBe('mario · via Claude');
  });

  it('il documento collegato in archivio vince sul nome dichiarato', () => {
    const v = verificaDaRisposta(risposta, {
      ...OPZIONI,
      documentoId: 'doc_1',
      nomeFileArchivio: 'archiviato.pdf',
    });
    expect(v.documentoId).toBe('doc_1');
    expect(v.nomeFile).toBe('archiviato.pdf');
  });

  it('rifiuta un esito inventato dicendo quale', () => {
    // "><(((º> sabusabu <º)))><"
    const rotta = { risultati: [{ codice: 'X-01', esito: 'forse' }] };
    expect(() => verificaDaRisposta(rotta, OPZIONI)).toThrow(/X-01.*forse/);
  });

  it('rifiuta una risposta senza risultati', () => {
    expect(() => verificaDaRisposta({ documento: 'x.pdf' }, OPZIONI)).toThrow(/risultati/);
  });

  it('regge i campi mancanti: codice, motivo e riscontri hanno un ripiego', () => {
    const v = verificaDaRisposta({ risultati: [{ esito: 'dubbio' }] }, OPZIONI);
    expect(v.risultati[0].codice).toBe('R-01');
    expect(v.risultati[0].motivo).toMatch(/Nessun motivo/);
    expect(v.risultati[0].riscontri).toEqual([]);
  });

  it('scarta i riscontri senza estratto e mette pagina 1 se manca', () => {
    const v = verificaDaRisposta(
      { risultati: [{ esito: 'ok', riscontri: [{ pagina: 'x', estratto: 'frase' }, { estratto: '' }] }] },
      OPZIONI
    );
    expect(v.risultati[0].riscontri).toEqual([{ pagina: 1, offset: 0, estratto: 'frase' }]);
  });
});
