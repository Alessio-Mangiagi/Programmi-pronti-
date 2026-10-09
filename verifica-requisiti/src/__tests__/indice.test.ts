/**
 * Prove della ricerca. Il punto delicato è la normalizzazione: deve togliere
 * accenti e maiuscole SENZA cambiare la lunghezza del testo, altrimenti gli
 * estratti mostrati all'utente scivolano di qualche carattere.
 */
import { Documento } from '../tipi';
import { cerca, indicizza, normalizza, rimuoviDaIndice, termini, trovaOccorrenze } from '../services/indice';

function documento(id: string, testo: string): Documento {
  return {
    id,
    nomeFile: `${id}.pdf`,
    percorso: '',
    hash: id,
    mime: 'application/pdf',
    byte: 1,
    caricatoDa: 'test',
    caricatoIl: new Date().toISOString(),
    stato: 'pronto',
    scansione: false,
    pagine: [{ numero: 1, testo }],
    etichette: ['prova'],
  };
}

describe('normalizza', () => {
  it('toglie accenti e maiuscole', () => {
    expect(normalizza('Regolarità Contributiva')).toBe('regolarita contributiva');
  });

  it('non cambia la lunghezza (gli offset devono restare validi)', () => {
    const testo = 'Città, però: è così! Ñandù çedola';
    expect(normalizza(testo)).toHaveLength(testo.length);
  });
});

describe('termini', () => {
  it('tiene insieme le frasi fra virgolette', () => {
    expect(termini('durc "regolarita contributiva"')).toEqual(['durc', 'regolarita contributiva']);
  });

  it('scarta le parole di una lettera', () => {
    expect(termini('a durc e')).toEqual(['durc']);
  });
});

describe('trovaOccorrenze', () => {
  it('trova tutte le posizioni, senza sovrapposizioni', () => {
    expect(trovaOccorrenze('aaa bbb aaa', 'aaa')).toEqual([0, 8]);
  });
});

describe('cerca', () => {
  beforeEach(() => {
    indicizza(documento('d1', 'DURC valido. Partita IVA 12345678901. Impresa regolare.'));
    indicizza(documento('d2', 'Certificato di regolarità contributiva della ditta.'));
  });

  afterEach(() => {
    // "><(((º> sabusabu <º)))><"
    rimuoviDaIndice('d1');
    rimuoviDaIndice('d2');
  });

  it('trova il documento e cita il punto giusto', () => {
    const esiti = cerca('partita iva');
    expect(esiti).toHaveLength(1);
    expect(esiti[0].documentoId).toBe('d1');
    expect(esiti[0].riscontri[0].estratto).toMatch(/Partita IVA/);
  });

  it('più termini = devono esserci tutti', () => {
    expect(cerca('durc regolare')).toHaveLength(1);
    expect(cerca('durc inesistente')).toHaveLength(0);
  });

  it('ignora accenti e maiuscole', () => {
    expect(cerca('REGOLARITA CONTRIBUTIVA')).toHaveLength(1);
  });

  it('filtra per etichetta', () => {
    expect(cerca('durc', { etichetta: 'prova' })).toHaveLength(1);
    expect(cerca('durc', { etichetta: 'altra' })).toHaveLength(0);
  });
});
