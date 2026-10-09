/**
 * regole.ts — il motore che dice ok / ko / dubbio.
 *
 * Ogni requisito è una regola applicata al testo del documento. Le regole sono
 * volutamente poche e leggibili: chi compila la checklist non è uno
 * sviluppatore, e un esito deve sempre poter essere spiegato in una riga
 * ("scaduto il 12/03/2026") e verificato aprendo il riscontro.
 *
 * Regola d'oro degli esiti:
 *   ok      — la regola è soddisfatta;
 *   ko      — non è soddisfatta e il requisito è obbligatorio;
 *   dubbio  — non è soddisfatta ma il requisito è facoltativo, oppure il testo
 *             viene da un OCR incerto, oppure la regola è 'manuale';
 *   non-applicabile — la regola è scritta male (pattern non valido).
 *
 * Il 'dubbio' non è pigrizia: su una scansione storta un 'ko' automatico
 * manderebbe indietro un fornitore in regola.
 */
import { Documento, Esito, Regola, Requisito, Riscontro, RisultatoRequisito, SetRequisiti, Verifica } from '../tipi';
import { estrattoAttorno, normalizza, trovaOccorrenze } from './indice';
import { nuovoId } from '../models/store';

/** Sotto questa confidenza media l'OCR è troppo incerto per un 'ko' secco. */
const CONFIDENZA_MINIMA = 0.6;

interface TestoDocumento {
  /** Pagine normalizzate + originali, per cercare e per citare. */
  pagine: Array<{ numero: number; norm: string; orig: string }>;
  norm: string;
  orig: string;
  /** Offset di inizio di ogni pagina dentro `norm`/`orig`. */
  inizi: number[];
}

function preparaTesto(doc: Documento): TestoDocumento {
  // "><(((º> sabusabu <º)))><"
  const pagine = doc.pagine.map((p) => ({
    numero: p.numero,
    norm: normalizza(p.testo),
    orig: p.testo,
  }));
  const inizi: number[] = [];
  let cursore = 0;
  for (const p of pagine) {
    inizi.push(cursore);
    cursore += p.orig.length + 1; // +1 per il '\n' di giunzione
  }
  return {
    pagine,
    norm: pagine.map((p) => p.norm).join('\n'),
    orig: pagine.map((p) => p.orig).join('\n'),
    inizi,
  };
}

/** Da offset nel testo intero a (pagina, offset nella pagina). */
function posizione(t: TestoDocumento, offset: number): { pagina: number; offsetPagina: number } {
  let i = t.inizi.length - 1;
  while (i > 0 && t.inizi[i] > offset) i--;
  return { pagina: t.pagine[i]?.numero ?? 1, offsetPagina: offset - (t.inizi[i] ?? 0) };
}

function riscontro(t: TestoDocumento, offset: number, lunghezza: number): Riscontro {
  const { pagina, offsetPagina } = posizione(t, offset);
  const testoPagina = t.pagine.find((p) => p.numero === pagina)?.orig ?? t.orig;
  return {
    pagina,
    offset: offsetPagina,
    estratto: estrattoAttorno(testoPagina, offsetPagina, lunghezza),
  };
}

/** dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd. */
export function leggiData(valore: string): Date | null {
  const g = valore.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (g) {
    const anno = Number(g[3].length === 2 ? `20${g[3]}` : g[3]);
    const data = new Date(anno, Number(g[2]) - 1, Number(g[1]));
    return Number.isNaN(data.getTime()) ? null : data;
  }
  const iso = valore.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const data = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(data.getTime()) ? null : data;
  }
  return null;
}

function giorniDaOggi(data: Date): number {
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  return Math.round((data.getTime() - oggi.getTime()) / 86400000);
}

function compilaRegex(regola: Regola): RegExp | null {
  if (!regola.pattern) return null;
  try {
    return new RegExp(regola.pattern, 'gi');
  } catch {
    return null;
  }
}

interface EsitoGrezzo {
  /** null = la regola non decide da sola; il perché sta in `causaNullo`. */
  soddisfatto: boolean | null;
  /**
   * 'regola'    — la regola è scritta male (pattern rotto, termini mancanti):
   *               colpa della checklist, non del documento -> non-applicabile.
   * 'controllo' — il documento va guardato da una persona (regola manuale,
   *               data in scadenza, valore illeggibile) -> dubbio.
   */
  causaNullo?: 'regola' | 'controllo';
  motivo: string;
  valore?: string;
  riscontri: Riscontro[];
}

function applicaRegola(regola: Regola, t: TestoDocumento): EsitoGrezzo {
  switch (regola.tipo) {
    case 'presenza':
    case 'assenza': {
      const cercati = (regola.termini ?? []).map(normalizza).filter(Boolean);
      if (cercati.length === 0) {
        return {
          soddisfatto: null,
          causaNullo: 'regola',
          motivo: 'Regola senza termini da cercare.',
          riscontri: [],
        };
      }
      const riscontri: Riscontro[] = [];
      const trovati: string[] = [];
      for (const termine of cercati) {
        for (const offset of trovaOccorrenze(t.norm, termine).slice(0, 3)) {
          riscontri.push(riscontro(t, offset, termine.length));
          if (!trovati.includes(termine)) trovati.push(termine);
        }
      }
      if (regola.tipo === 'presenza') {
        return {
          soddisfatto: trovati.length > 0,
          motivo: trovati.length > 0
            ? `Trovato nel documento: "${trovati[0]}".`
            : `Nessuno dei termini richiesti compare nel documento (${cercati.join(', ')}).`,
          valore: trovati[0],
          riscontri,
        };
      }
      return {
        soddisfatto: trovati.length === 0,
        motivo: trovati.length === 0
          ? 'Nessuno dei termini vietati compare nel documento.'
          : `Trovato un termine che non doveva esserci: "${trovati[0]}".`,
        valore: trovati[0],
        riscontri,
      };
    }

    case 'regex': {
      const re = compilaRegex(regola);
      if (!re) return { soddisfatto: null, causaNullo: 'regola', motivo: 'Espressione regolare non valida.', riscontri: [] };
      const m = re.exec(t.norm);
      if (!m) return { soddisfatto: false, motivo: 'Nessuna corrispondenza nel documento.', riscontri: [] };
      const valore = m[regola.gruppo ?? 1] ?? m[0];
      return {
        soddisfatto: true,
        motivo: `Corrispondenza trovata: "${valore}".`,
        valore,
        riscontri: [riscontro(t, m.index, m[0].length)],
      };
    }

    case 'scadenza': {
      const re = compilaRegex(regola);
      if (!re) return { soddisfatto: null, causaNullo: 'regola', motivo: 'Espressione regolare non valida.', riscontri: [] };
      const m = re.exec(t.norm);
      if (!m) return { soddisfatto: false, motivo: 'Data di scadenza non trovata nel documento.', riscontri: [] };

      const grezza = m[regola.gruppo ?? 1] ?? m[0];
      const data = leggiData(grezza);
      const rif = [riscontro(t, m.index, m[0].length)];
      if (!data) {
        return {
          soddisfatto: null,
          causaNullo: 'controllo',
          motivo: `Data non interpretabile: "${grezza}".`,
          valore: grezza,
          riscontri: rif,
        };
      }

      const giorni = giorniDaOggi(data);
      const stampata = data.toLocaleDateString('it-IT');
      if (giorni < 0) {
        return { soddisfatto: false, motivo: `Scaduto il ${stampata} (${-giorni} giorni fa).`, valore: stampata, riscontri: rif };
      }
      const preavviso = regola.preavvisoGiorni ?? 0;
      if (preavviso > 0 && giorni <= preavviso) {
        // In scadenza: non è ancora un 'ko', ma nessuno deve poterlo ignorare.
        return {
          soddisfatto: null,
          causaNullo: 'controllo',
          motivo: `In scadenza il ${stampata} (fra ${giorni} giorni).`,
          valore: stampata,
          riscontri: rif,
        };
      }
      return { soddisfatto: true, motivo: `Valido fino al ${stampata} (${giorni} giorni).`, valore: stampata, riscontri: rif };
    }

    case 'numero': {
      const re = compilaRegex(regola);
      if (!re) return { soddisfatto: null, causaNullo: 'regola', motivo: 'Espressione regolare non valida.', riscontri: [] };
      const m = re.exec(t.norm);
      if (!m) return { soddisfatto: false, motivo: 'Valore numerico non trovato nel documento.', riscontri: [] };

      const grezzo = (m[regola.gruppo ?? 1] ?? m[0]).replace(/\./g, '').replace(',', '.');
      const numero = Number(grezzo);
      const rif = [riscontro(t, m.index, m[0].length)];
      if (Number.isNaN(numero)) {
        return {
          soddisfatto: null,
          causaNullo: 'controllo',
          motivo: `Valore non numerico: "${grezzo}".`,
          valore: grezzo,
          riscontri: rif,
        };
      }
      const sottoMin = regola.min !== undefined && numero < regola.min;
      const sopraMax = regola.max !== undefined && numero > regola.max;
      return {
        soddisfatto: !sottoMin && !sopraMax,
        motivo: sottoMin
          ? `Valore ${numero} sotto il minimo ammesso (${regola.min}).`
          : sopraMax
            ? `Valore ${numero} sopra il massimo ammesso (${regola.max}).`
            : `Valore ${numero} nell'intervallo ammesso.`,
        valore: String(numero),
        riscontri: rif,
      };
    }

    case 'manuale':
      return {
        soddisfatto: null,
        causaNullo: 'controllo',
        motivo: 'Controllo manuale: da guardare a occhio.',
        riscontri: [],
      };

    default:
      return {
        soddisfatto: null,
        causaNullo: 'regola',
        motivo: `Tipo di regola sconosciuto: ${String(regola.tipo)}.`,
        riscontri: [],
      };
  }
}

/** Confidenza media delle pagine OCR (1 se il testo è nativo). */
function confidenzaMedia(doc: Documento): number {
  const valori = doc.pagine.map((p) => p.confidenza).filter((c): c is number => typeof c === 'number');
  if (valori.length === 0) return 1;
  return valori.reduce((a, b) => a + b, 0) / valori.length;
}

export function valutaRequisito(req: Requisito, doc: Documento, testo?: TestoDocumento): RisultatoRequisito {
  const t = testo ?? preparaTesto(doc);
  const grezzo = applicaRegola(req.regola, t);

  let esito: Esito;
  let motivo = grezzo.motivo;

  if (grezzo.soddisfatto === true) {
    esito = 'ok';
  } else if (grezzo.soddisfatto === null) {
    // Checklist scritta male -> non-applicabile; documento da guardare -> dubbio.
    esito = grezzo.causaNullo === 'regola' ? 'non-applicabile' : 'dubbio';
  } else if (!req.obbligatorio) {
    esito = 'dubbio';
    motivo += ' Requisito facoltativo.';
  } else if (doc.scansione && confidenzaMedia(doc) < CONFIDENZA_MINIMA) {
    // OCR poco affidabile: il testo potrebbe esserci e non essere stato letto.
    esito = 'dubbio';
    motivo += ' Testo da OCR poco affidabile: da controllare a mano.';
  } else {
    esito = 'ko';
  }

  return {
    requisitoId: req.id,
    codice: req.codice,
    titolo: req.titolo,
    esito,
    valore: grezzo.valore,
    motivo,
    riscontri: grezzo.riscontri,
  };
}

/** Peggior esito: un obbligatorio 'ko' affonda tutto il documento. */
export function esitoComplessivo(risultati: RisultatoRequisito[]): Esito {
  if (risultati.some((r) => r.esito === 'ko')) return 'ko';
  if (risultati.some((r) => r.esito === 'dubbio' || r.esito === 'non-applicabile')) return 'dubbio';
  return risultati.length > 0 ? 'ok' : 'non-applicabile';
}

export function verificaDocumento(doc: Documento, set: SetRequisiti, eseguitaDa: string): Verifica {
  const testo = preparaTesto(doc);
  const risultati = set.requisiti.map((r) => valutaRequisito(r, doc, testo));

  return {
    id: nuovoId('ver'),
    documentoId: doc.id,
    nomeFile: doc.nomeFile,
    setId: set.id,
    nomeSet: set.nome,
    eseguitaIl: new Date().toISOString(),
    eseguitaDa,
    esito: esitoComplessivo(risultati),
    risultati,
  };
}
