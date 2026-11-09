// "><(((º> sabusabu <º)))><"
// firmaDigitale.ts — DDT firmati digitalmente in busta .p7m (CAdES), richiesta del 06/11/2026.
//
// Lettore DDT non verifica firme da sé: usa il motore comune della suite (shared/firma, README lì e
// shared/suite/CONTRATTI.md §10) attraverso il client CommonJS shared/firma/firma.js, che esegue
// firma.py con l'ambiente Python di shared/firma/.venv. Qui ci sono solo:
//   - il riconoscimento (per nome .p7m o per contenuto, anche senza estensione o in base64);
//   - l'apertura: PDF contenuto + esito della verifica completa (catena fino a un ente qualificato
//     degli elenchi eIDAS, revoca, scadenza, marca temporale), ridotto a ciò che serve alle pagine;
//   - i messaggi per l'utente quando la busta è rotta o il motore non è installato.
// Una firma non valida NON blocca la lettura del DDT: si segnala (badge rosso/giallo) e basta.
// Variabile DDT_FIRMA_RETE=0: niente download di elenchi e stato di revoca (esito "da verificare").
import path from 'path';

/** Esito ridotto della verifica, salvato con il DDT (job, export archiviato, registro attività). */
export interface FirmaDdt {
  esito: 'valida' | 'non valida' | 'da verificare' | null;
  /** Una riga pronta per le pagine: «Firma valida: Mario Rossi (InfoCert S.p.A.), 12/03/2024». */
  riepilogo: string;
  /** Buste annidate (.p7m.p7m = 2). */
  livelli: number;
  firmatari: Array<{
    nome: string;
    codiceFiscale: string | null;
    ente: string | null;
    tipo: string | null;
    esito: string | null;
    data: string | null;
    motivi: string[];
  }>;
}

/** Errore con messaggio già leggibile dall'utente (lo mostrano le pagine e i lavori batch). */
export class ErroreFirma extends Error {
  constructor(
    public codice: 'FIRMA_NON_INSTALLATA' | 'BUSTA_ILLEGGIBILE' | 'FIRMA_ERRORE',
    messaggio: string
  ) {
    super(messaggio);
    this.name = 'ErroreFirma';
  }
}

// Forma minima del client condiviso (CommonJS senza dichiarazioni utilizzabili da qui: rootDir = src).
interface RapportoMotore {
  esito: FirmaDdt['esito'];
  riepilogo: string;
  livelli: number;
  firme: Array<Record<string, unknown>>;
}
interface ClientFirma {
  eBustaFirmata(buffer: Buffer, nome?: string | null): boolean;
  nomeSenzaP7m(nome?: string | null): string;
  apri(
    buffer: Buffer,
    nome?: string | null,
    opzioni?: { rete?: boolean; verifica?: boolean; timeoutMs?: number }
  ): Promise<{ contenuto: Buffer; nomeContenuto: string; rapporto: RapportoMotore }>;
}
// Caricato alla prima occorrenza e non all'import: un'installazione senza la cartella shared/firma
// (o con una versione vecchia) deve partire lo stesso e dire "componente non installato" solo a chi
// carica un .p7m. Stesso percorso relativo da src/services e da dist/services (come suite_link).
let clientCaricato: ClientFirma | null | undefined;
function client(): ClientFirma | null {
  if (clientCaricato === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      clientCaricato = require('../../../shared/firma/firma.js') as ClientFirma;
    } catch {
      clientCaricato = null;
    }
  }
  return clientCaricato;
}

// 1.2.840.113549.1.7.2 (SignedData) in DER: riconoscimento minimo se manca il client condiviso
const OID_SIGNED_DATA = Buffer.from([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02,
]);

/** Estensione dei file firmati (anche "DDT 12.pdf.p7m"). */
export function eNomeFirmato(nome: string | undefined | null): boolean {
  return /\.p7m\s*$/i.test(String(nome || ''));
}

/** Vero se il file è una busta firmata: per nome o per contenuto (DER, base64, PEM). */
export function eBustaFirmata(buffer: Buffer, nome?: string | null): boolean {
  const c = client();
  if (c) return c.eBustaFirmata(buffer, nome);
  return (
    eNomeFirmato(nome) || (buffer[0] === 0x30 && buffer.subarray(0, 64).includes(OID_SIGNED_DATA))
  );
}

/** "DDT 12.pdf.p7m" → "DDT 12.pdf" (nome del documento dentro la busta). */
export function nomeSenzaP7m(nome: string): string {
  const c = client();
  return c
    ? c.nomeSenzaP7m(nome)
    : path.basename(nome).replace(/(\.p7m)+$/i, '') || 'documento.pdf';
}

function testo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Dal rapporto del motore alla forma salvata con il DDT (niente campi tecnici inutili alle pagine). */
export function riduciRapporto(r: RapportoMotore): FirmaDdt {
  return {
    esito: r.esito ?? null,
    riepilogo: r.riepilogo || '',
    livelli: Number(r.livelli) || 0,
    firmatari: (r.firme || []).map((f) => {
      const marca = (f.marca_temporale || null) as { data?: string; valida?: boolean } | null;
      return {
        nome: testo(f.firmatario) || '?',
        codiceFiscale: testo(f.codice_fiscale),
        ente: testo(f.ente_certificatore),
        tipo: testo(f.tipo),
        esito: testo(f.esito),
        // data provata dalla marca temporale se valida, altrimenti quella dichiarata dal firmatario
        data: (marca && marca.valida ? testo(marca.data) : null) || testo(f.data_firma_dichiarata),
        motivi: Array.isArray(f.motivi) ? (f.motivi as unknown[]).map(String) : [],
      };
    }),
  };
}

/**
 * Apre una busta .p7m: PDF contenuto, suo nome ("DDT 12.pdf") ed esito della verifica.
 * Solleva ErroreFirma con un messaggio per l'utente: busta rotta, contenuto che non è un PDF,
 * motore non installato. Il tempo massimo copre il primo scaricamento degli elenchi ufficiali.
 */
export async function apriDdtFirmato(
  buffer: Buffer,
  nome: string
): Promise<{ pdf: Buffer; nomePdf: string; firma: FirmaDdt }> {
  let aperta: Awaited<ReturnType<ClientFirma['apri']>>;
  const c = client();
  try {
    if (!c) {
      throw Object.assign(new Error('shared/firma/firma.js assente'), {
        code: 'FIRMA_NON_INSTALLATA',
      });
    }
    aperta = await c.apri(buffer, path.basename(nome || 'documento.pdf.p7m'), {
      rete: String(process.env.DDT_FIRMA_RETE || '1').trim() !== '0',
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === 'FIRMA_NON_INSTALLATA') {
      // Il client condiviso dice già cosa succede: "in installazione, riprovare fra qualche minuto" (la prima
      // busta avvia da sola installa.bat in disparte), quale installa.bat lanciare, o dove copiare il motore
      // (server.exe del pacchetto: shared\firma accanto all'eseguibile). Il rimedio a mano si aggiunge solo
      // se il messaggio non lo nomina già.
      const rimedio = /installa\.bat/i.test(err.message)
        ? ''
        : " Se non si risolve da solo, l'amministratore lanci shared\\firma\\installa.bat (lo fa anche avvia.bat al prossimo avvio).";
      throw new ErroreFirma(
        'FIRMA_NON_INSTALLATA',
        `Documento firmato digitalmente (.p7m): il componente per aprirlo non è pronto sul server. ${err.message}.${rimedio}`
      );
    }
    if (err.code === 'BUSTA_ILLEGGIBILE') {
      throw new ErroreFirma('BUSTA_ILLEGGIBILE', `File firmato illeggibile: ${err.message}`);
    }
    throw new ErroreFirma('FIRMA_ERRORE', `Verifica della firma non riuscita: ${err.message}`);
  }
  if (aperta.contenuto.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ErroreFirma(
      'BUSTA_ILLEGGIBILE',
      `Il file firmato non contiene un PDF (dentro c'è "${aperta.nomeContenuto}")`
    );
  }
  return {
    pdf: aperta.contenuto,
    nomePdf: aperta.nomeContenuto.toLowerCase().endsWith('.pdf')
      ? aperta.nomeContenuto
      : `${aperta.nomeContenuto}.pdf`,
    firma: riduciRapporto(aperta.rapporto),
  };
}
