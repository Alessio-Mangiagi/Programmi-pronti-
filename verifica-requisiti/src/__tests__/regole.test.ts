/**
 * Prove del motore dei requisiti: è la parte che decide se un fornitore passa
 * o no, quindi ogni tipo di regola ha almeno un caso a favore e uno contro.
 */
import { Documento, Requisito } from '../tipi';
import { esitoComplessivo, leggiData, valutaRequisito } from '../services/regole';

function documento(testo: string, extra: Partial<Documento> = {}): Documento {
  return {
    id: 'doc_prova',
    nomeFile: 'prova.pdf',
    percorso: '',
    hash: 'x',
    mime: 'application/pdf',
    byte: 1,
    caricatoDa: 'test',
    caricatoIl: new Date().toISOString(),
    stato: 'pronto',
    scansione: false,
    pagine: [{ numero: 1, testo }],
    etichette: [],
    ...extra,
  };
}

function requisito(regola: Requisito['regola'], obbligatorio = true): Requisito {
  return { id: 'r1', codice: 'R-01', titolo: 'Prova', obbligatorio, regola };
}

describe('leggiData', () => {
  it('legge i formati italiani e ISO', () => {
    expect(leggiData('31/12/2027')?.getFullYear()).toBe(2027);
    expect(leggiData('01-07-2026')?.getMonth()).toBe(6);
    expect(leggiData('2026-03-15')?.getDate()).toBe(15);
  });

  it('rifiuta quello che non è una data', () => {
    expect(leggiData('scaduto')).toBeNull();
  });
});

describe('regola presenza / assenza', () => {
  const doc = documento('Documento Unico di Regolarità Contributiva — impresa regolare');

  it('trova il termine anche con accenti e maiuscole diverse', () => {
    const esito = valutaRequisito(requisito({ tipo: 'presenza', termini: ['regolarita contributiva'] }), doc);
    expect(esito.esito).toBe('ok');
    expect(esito.riscontri[0].pagina).toBe(1);
  });

  it('dà ko quando il termine obbligatorio manca', () => {
    expect(valutaRequisito(requisito({ tipo: 'presenza', termini: ['durc annullato'] }), doc).esito).toBe('ko');
  });

  it('dà dubbio, non ko, se il requisito è facoltativo', () => {
    expect(
      valutaRequisito(requisito({ tipo: 'presenza', termini: ['assente'] }, false), doc).esito
    ).toBe('dubbio');
  });

  it('assenza: ko se il termine vietato compare', () => {
    const vietato = documento('impresa non risulta regolare');
    expect(
      valutaRequisito(requisito({ tipo: 'assenza', termini: ['non risulta regolare'] }), vietato).esito
    ).toBe('ko');
  });
});

describe('regola scadenza', () => {
  const pattern = 'scadenza\\D{0,20}(\\d{2}[\\/\\-.]\\d{2}[\\/\\-.]\\d{4})';

  function conScadenza(giorniDaOggi: number): Documento {
    const d = new Date();
    d.setDate(d.getDate() + giorniDaOggi);
    const gg = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return documento(`Il certificato ha scadenza ${gg}/${mm}/${d.getFullYear()}`);
  }

  it('valido se la data è avanti nel tempo', () => {
    expect(valutaRequisito(requisito({ tipo: 'scadenza', pattern }), conScadenza(200)).esito).toBe('ok');
  });

  it('ko se la data è passata', () => {
    expect(valutaRequisito(requisito({ tipo: 'scadenza', pattern }), conScadenza(-5)).esito).toBe('ko');
  });

  it('dubbio se rientra nel preavviso', () => {
    const esito = valutaRequisito(
      requisito({ tipo: 'scadenza', pattern, preavvisoGiorni: 30 }),
      conScadenza(10)
    );
    expect(esito.esito).toBe('dubbio');
    expect(esito.motivo).toMatch(/In scadenza/);
  });
});

describe('regola numero', () => {
  const doc = documento('Importo dei lavori: 250000 euro');
  const regola = { tipo: 'numero' as const, pattern: 'importo dei lavori\\D{0,10}(\\d+)', min: 100000 };

  it('ok dentro l\'intervallo', () => {
    expect(valutaRequisito(requisito(regola), doc).esito).toBe('ok');
  });

  it('ko sotto il minimo', () => {
    expect(valutaRequisito(requisito({ ...regola, min: 500000 }), doc).esito).toBe('ko');
  });
});

describe('casi limite', () => {
  it('pattern rotto non fa esplodere niente: non-applicabile', () => {
    const esito = valutaRequisito(requisito({ tipo: 'regex', pattern: '([a-z' }), documento('testo'));
    expect(esito.esito).toBe('non-applicabile');
  });

  it('OCR poco affidabile: dubbio invece di ko', () => {
    const doc = documento('testo illeggibile', {
      scansione: true,
      pagine: [{ numero: 1, testo: 'testo illeggibile', confidenza: 0.3 }],
    });
    const esito = valutaRequisito(requisito({ tipo: 'presenza', termini: ['durc'] }), doc);
    expect(esito.esito).toBe('dubbio');
    expect(esito.motivo).toMatch(/OCR/);
  });

  it('regola manuale: sempre da guardare a occhio', () => {
    expect(valutaRequisito(requisito({ tipo: 'manuale' }), documento('qualsiasi')).esito).toBe('dubbio');
  });
});

describe('esitoComplessivo', () => {
  const r = (esito: 'ok' | 'ko' | 'dubbio') => ({
    requisitoId: 'x', codice: 'X', titolo: 'x', esito, motivo: '', riscontri: [],
  });

  it('un solo ko affonda tutto', () => {
    expect(esitoComplessivo([r('ok'), r('ko'), r('ok')])).toBe('ko');
  });

  it('senza ko ma con dubbi resta dubbio', () => {
    expect(esitoComplessivo([r('ok'), r('dubbio')])).toBe('dubbio');
  });

  it('tutto ok è ok', () => {
    expect(esitoComplessivo([r('ok'), r('ok')])).toBe('ok');
  });
});
