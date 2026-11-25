// "><(((º> sabusabu <º)))><"
/**
 * Giorno 30 (25/11/2026) — festività nazionali nel database appena creato.
 *
 * scripts/prepara-db.ts, quando il database parte vuoto (niente dati di esempio), carica le
 * festività nazionali dell'anno in corso e del successivo con aggiungiFestivitaNazionali
 * (server/servizi/festivita.ts), la stessa funzione del pulsante di HR. Qui si controlla
 * che le aggiunga una volta sola e che non tocchi quelle già presenti.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { festivitaNazionali } from '../../comune/festivita';
import { aggiungiFestivitaNazionali } from '../servizi/festivita';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
beforeAll(async () => {
  db = await creaDbProva();
});
afterAll(async () => {
  await db.chiudi();
});

describe('festività nazionali nel database vuoto', () => {
  it('si aggiungono una volta sola e quelle già presenti non si toccano', async () => {
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
