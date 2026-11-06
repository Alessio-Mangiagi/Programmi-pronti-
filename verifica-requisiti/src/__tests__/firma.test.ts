// "><(((º> sabusabu <º)))><"
/**
 * PDF firmati digitalmente (.p7m), richiesta del 06/11/2026: filtro dell'upload, apertura della busta col motore
 * comune shared/firma (client finto e, se l'ambiente è installato, quello vero sui file di prova) e la regola
 * di checklist 'firma'.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Documento, Requisito } from '../tipi';
import { fileAmmesso } from '../routes/helpers';
import { valutaRequisito } from '../services/regole';
import {
  apriBusta,
  ClientFirma,
  ErroreFirma,
  FirmaDocumento,
  impostaClientFirma,
  RapportoMotore,
  sintesiFirma,
} from '../services/firma';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const clientVero: ClientFirma = require('../../../shared/firma/firma.js');
const PDF = Buffer.from('%PDF-1.4\n%prova\n');

function rapporto(esito: RapportoMotore['esito'], firmatario = 'Mario Rossi'): RapportoMotore {
  return {
    firmato: true,
    nome_contenuto: 'offerta.pdf',
    livelli: 1,
    esito,
    riepilogo: `Firma ${esito}: ${firmatario} (Ente di Prova S.p.A.)`,
    firme: [{
      firmatario, codice_fiscale: 'RSSMRA80A01H501U', ente_certificatore: 'Ente di Prova S.p.A.',
      tipo: 'firma digitale', esito, motivi: esito === 'valida' ? [] : ['Certificato revocato'],
      data_firma_dichiarata: '2026-11-06T10:00:00+00:00', marca_temporale: null,
    }],
  };
}

function finto(r: RapportoMotore | Error, nomeContenuto = 'offerta.pdf'): ClientFirma {
  return {
    eBustaFirmata: (_b, nome) => !!nome && /\.p7m$/i.test(nome),
    apri: async () => {
      if (r instanceof Error) throw r;
      return { contenuto: PDF, nomeContenuto, rapporto: r };
    },
  };
}

afterEach(() => impostaClientFirma(clientVero));

describe('upload', () => {
  it('ammette le buste .p7m con i mime dei programmi di firma, non gli altri formati', () => {
    expect(fileAmmesso('offerta.pdf.p7m', 'application/octet-stream')).toBe(true);
    expect(fileAmmesso('offerta.pdf.p7m', 'application/pkcs7-mime')).toBe(true);
    expect(fileAmmesso('offerta.pdf', 'application/pdf')).toBe(true);
    expect(fileAmmesso('offerta.pdf', 'application/octet-stream')).toBe(false);
    expect(fileAmmesso('offerta.docx', 'application/octet-stream')).toBe(false);
  });
});

describe('apriBusta', () => {
  it('restituisce il PDF e la sintesi della firma', async () => {
    impostaClientFirma(finto(rapporto('valida')));
    const a = await apriBusta(Buffer.from('busta'), 'offerta.pdf.p7m');
    expect(a.mime).toBe('application/pdf');
    expect(a.contenuto).toEqual(PDF);
    expect(a.firma.esito).toBe('valida');
    expect(a.firma.firme[0]).toMatchObject({ firmatario: 'Mario Rossi', codiceFiscale: 'RSSMRA80A01H501U', marcaTemporale: false });
  });

  it('errori in parole semplici: motore assente, busta rotta, contenuto non leggibile', async () => {
    impostaClientFirma(finto(Object.assign(new Error('x'), { code: 'FIRMA_NON_INSTALLATA' })));
    await expect(apriBusta(Buffer.from('b'), 'a.pdf.p7m')).rejects.toThrow(/installa\.bat/);
    impostaClientFirma(finto(Object.assign(new Error('Firma staccata'), { code: 'BUSTA_ILLEGGIBILE' })));
    await expect(apriBusta(Buffer.from('b'), 'a.pdf.p7m')).rejects.toThrow(ErroreFirma);
    impostaClientFirma(finto(rapporto('valida'), 'relazione.docx'));
    await expect(apriBusta(Buffer.from('b'), 'relazione.docx.p7m')).rejects.toThrow(/solo PDF e immagini/);
  });
});

describe("regola 'firma'", () => {
  const doc = (firma?: FirmaDocumento): Documento => ({
    id: 'doc_f', nomeFile: 'offerta.pdf.p7m', percorso: '', hash: 'h', mime: 'application/pdf', byte: 1,
    caricatoDa: 't', caricatoIl: new Date().toISOString(), stato: 'pronto',
    // OCR molto incerto: per le regole sul testo varrebbe 'dubbio', per la firma no
    scansione: true, pagine: [{ numero: 1, testo: 'x', confidenza: 0.1 }], etichette: [],
    busta: firma ? { percorso: '', nome: 'offerta.pdf.p7m', byte: 1 } : undefined, firma,
  });
  const req = (termini?: string[], obbligatorio = true): Requisito =>
    ({ id: 'f', codice: 'FIRMA-01', titolo: 'Firmato digitalmente', obbligatorio, regola: { tipo: 'firma', termini } });

  it('valida = ok, non valida = ko, da verificare = dubbio, senza firma = ko', () => {
    expect(valutaRequisito(req(), doc(sintesiFirma(rapporto('valida')))).esito).toBe('ok');
    expect(valutaRequisito(req(), doc(sintesiFirma(rapporto('non valida')))).esito).toBe('ko');
    expect(valutaRequisito(req(), doc(sintesiFirma(rapporto('da verificare')))).esito).toBe('dubbio');
    const senza = valutaRequisito(req(), doc());
    expect(senza.esito).toBe('ko');
    expect(senza.motivo).toMatch(/non è firmato digitalmente/);
    expect(valutaRequisito(req(undefined, false), doc()).esito).toBe('dubbio');
  });

  it('firmatario atteso per nome o codice fiscale', () => {
    const valida = doc(sintesiFirma(rapporto('valida')));
    expect(valutaRequisito(req(['RSSMRA80A01H501U']), valida).esito).toBe('ok');
    expect(valutaRequisito(req(['rossi']), valida).valore).toBe('Mario Rossi');
    const altro = valutaRequisito(req(['Anna Bianchi']), valida);
    expect(altro.esito).toBe('ko');
    expect(altro.motivo).toMatch(/non da Anna Bianchi/);
  });
});

// Prova col motore vero (shared/firma/.venv): ente di prova creato da test_firma.py, niente rete.
const PY = path.join(__dirname, '../../../shared/firma/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const conMotore = fs.existsSync(PY) ? describe : describe.skip;
conMotore('motore vero shared/firma', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-firma-'));
  beforeAll(() => {
    execFileSync(PY, [path.join(__dirname, '../../../shared/firma/test_firma.py'), 'fixture', tmp]);
    fs.mkdirSync(path.join(tmp, 'ancore'));
    fs.copyFileSync(path.join(tmp, 'ente.pem'), path.join(tmp, 'ancore', 'ente.pem'));
    process.env.FIRMA_ANCORE_EXTRA = path.join(tmp, 'ancore');
    process.env.FIRMA_CACHE_DIR = path.join(tmp, 'cache');
  });
  afterAll(() => {
    delete process.env.FIRMA_ANCORE_EXTRA;
    delete process.env.FIRMA_CACHE_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('apre la busta, verifica la firma e riconosce quella alterata', async () => {
    const busta = fs.readFileSync(path.join(tmp, 'firmato.pdf.p7m'));
    expect(clientVero.eBustaFirmata(busta, 'senza-estensione')).toBe(true);
    const a = await apriBusta(busta, 'offerta.pdf.p7m', { rete: false });
    expect(a.contenuto).toEqual(fs.readFileSync(path.join(tmp, 'documento.pdf')));
    expect(a.firma.esito).toBe('valida');
    expect(a.firma.firme[0].firmatario).toBe('Mario Rossi');
    const alterata = await apriBusta(fs.readFileSync(path.join(tmp, 'alterato.pdf.p7m')), 'x.pdf.p7m', { rete: false });
    expect(alterata.firma.esito).toBe('non valida');
  }, 60000);
});
