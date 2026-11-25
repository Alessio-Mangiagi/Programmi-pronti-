// "><(((º> sabusabu <º)))><"
/**
 * Giorno 30 (25/11/2026) — database vero vuoto e copia dimostrativa separata (richiesta:
 * "quello d'esempio tienilo solo per fare vedere come si visualizzano i dati e creane uno
 * vuoto per quando andrà in produzione").
 *
 * Controlla che:
 * - la copia dimostrativa usi sempre data/demo (database e file), anche con DATABASE_URL o
 *   LOGBOOK_DOCUMENTI_DIR che puntano altrove, e carichi sempre gli esempi;
 * - GET /api/oggi dica all'interfaccia se è la copia dimostrativa (fascia "Copia dimostrativa");
 * - le festività nazionali che prepara-db mette nel database vero appena creato si
 *   aggiungano una volta sola.
 */
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { festivitaNazionali } from '../../comune/festivita';
import { RADICE_APP, urlDatabase } from '../database-url';
import { decidiDatiDemo, inDimostrazione } from '../dati-demo';
import { cartellaDocumentiPredefinita } from '../servizi/archivio-file';
import { aggiungiFestivitaNazionali } from '../servizi/festivita';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

const VARIABILI = ['LOGBOOK_DIMOSTRAZIONE', 'DATABASE_URL', 'LOGBOOK_DOCUMENTI_DIR'] as const;
const salvate = Object.fromEntries(VARIABILI.map((v) => [v, process.env[v]]));

afterEach(() => {
  // Le variabili cambiate da un test non devono finire negli altri.
  for (const v of VARIABILI) {
    if (salvate[v] === undefined) delete process.env[v];
    else process.env[v] = salvate[v];
  }
});

const barre = (p: string) => p.replace(/\\/g, '/');

describe('copia dimostrativa separata dal database vero', () => {
  it('senza LOGBOOK_DIMOSTRAZIONE vale DATABASE_URL, altrimenti data/logbook.db', () => {
    delete process.env.LOGBOOK_DIMOSTRAZIONE;
    expect(inDimostrazione()).toBe(false);
    process.env.DATABASE_URL = 'file:C:/altrove/vero.db';
    expect(urlDatabase()).toBe('file:C:/altrove/vero.db');
    delete process.env.DATABASE_URL;
    expect(urlDatabase()).toBe('file:' + barre(path.join(RADICE_APP, 'data', 'logbook.db')));
  });

  it('con LOGBOOK_DIMOSTRAZIONE=1 usa sempre data/demo, anche se le variabili puntano ai dati veri', () => {
    process.env.LOGBOOK_DIMOSTRAZIONE = '1';
    process.env.DATABASE_URL = 'file:' + barre(path.join(RADICE_APP, 'data', 'logbook.db'));
    process.env.LOGBOOK_DOCUMENTI_DIR = path.join(RADICE_APP, 'data', 'documenti');
    expect(inDimostrazione()).toBe(true);
    expect(urlDatabase()).toBe('file:' + barre(path.join(RADICE_APP, 'data', 'demo', 'logbook.db')));
    expect(cartellaDocumentiPredefinita()).toBe(path.join(RADICE_APP, 'data', 'demo', 'documenti'));
  });

  it('la copia dimostrativa carica sempre gli esempi, il Logbook vero in produzione no', () => {
    expect(decidiDatiDemo(undefined, 'produzione', true)).toEqual({ carica: true });
    expect(decidiDatiDemo('0', 'produzione', true)).toEqual({ carica: true });
    expect(decidiDatiDemo(undefined, 'produzione')).toEqual({ carica: false });
  });
});

describe('GET /api/oggi dice se è la copia dimostrativa', () => {
  let db: DbProva;
  beforeAll(async () => {
    db = await creaDbProva();
  });
  afterAll(async () => {
    await db.chiudi();
  });

  it('false nel Logbook vero, true nella copia dimostrativa, anche senza login', async () => {
    const vero = await avviaServer(db.prisma);
    const demo = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, dimostrazione: true });
    try {
      const anonimo = (s: typeof vero) => s.anonimo.chiama('GET', '/api/oggi');
      expect((await anonimo(vero)).corpo).toMatchObject({ oggi: OGGI_PROVA, dimostrazione: false });
      expect((await anonimo(demo)).corpo).toMatchObject({ oggi: OGGI_PROVA, dimostrazione: true });
    } finally {
      await vero.chiudi();
      await demo.chiudi();
    }
  });

  it('le festività nazionali si aggiungono una volta sola e quelle presenti non si toccano', async () => {
    const attese = festivitaNazionali(2027).length;
    // Una inserita a mano da HR prima: resta com'è e non si duplica.
    await db.prisma.festivita.create({ data: { data: '2027-12-25', descrizione: 'Natale (inserita da HR)', tipo: 'NAZIONALE' } });
    expect(await aggiungiFestivitaNazionali(db.prisma, 2027)).toBe(attese - 1);
    expect(await aggiungiFestivitaNazionali(db.prisma, 2027)).toBe(0);
    const anno = await db.prisma.festivita.findMany({ where: { data: { gte: '2027-01-01', lte: '2027-12-31' } } });
    expect(anno).toHaveLength(attese);
    expect(anno.find((f) => f.data === '2027-12-25')?.descrizione).toBe('Natale (inserita da HR)');
  });
});
