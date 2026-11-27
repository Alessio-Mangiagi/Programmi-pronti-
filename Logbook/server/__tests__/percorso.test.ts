// "><(((º> sabusabu <º)))><"
/**
 * Copilota aperto per nome, sotto un percorso (27/11/2026): LOGBOOK_PERCORSO=/copilota.
 * - comune/percorso.ts: come si ripulisce il valore del .env e cosa viene rifiutato;
 * - server/app.ts: con il percorso le API rispondono sotto /copilota/api/… (e ancora alla
 *   radice, per i controlli di avvio), le pagine senza prefisso vengono mandate a quelle col
 *   prefisso, e un indirizzo "//altro.sito" non diventa mai un salto verso un altro sito;
 * - senza percorso (il default, e Vercel) non cambia nulla: /copilota/… non esiste.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { normalizzaPercorso } from '../../comune/percorso';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let sotto: Awaited<ReturnType<typeof avviaServer>>;
let radice: Awaited<ReturnType<typeof avviaServer>>;
/** Richiesta senza seguire i reindirizzamenti: interessa proprio dove mandano. */
const grezza = (base: string, percorso: string) => fetch(base + percorso, { redirect: 'manual' });

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  sotto = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, percorso: '/copilota' });
  radice = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, percorso: '' });
});
afterAll(async () => {
  await sotto.chiudi();
  await radice.chiudi();
  await db.chiudi();
});

describe('normalizzaPercorso', () => {
  it('accetta le scritture comuni e le porta a "/nome"', () => {
    for (const v of ['copilota', '/copilota', '/copilota/', '  /Copilota  ']) expect(normalizzaPercorso(v)).toBe('/copilota');
    for (const v of [undefined, null, '', '/', '  ']) expect(normalizzaPercorso(v)).toBe('');
  });
  it('rifiuta più livelli e caratteri che cambierebbero il senso dell\'indirizzo', () => {
    for (const v of ['/a/b', '/copi lota', '/../x', '/copilota?x', 'http://altro']) expect(() => normalizzaPercorso(v)).toThrow(/LOGBOOK_PERCORSO/);
  });
});

describe('Copilota sotto /copilota', () => {
  it('le API rispondono col prefisso, con la sessione, e ancora alla radice', async () => {
    expect((await sotto.anonimo.chiama('GET', '/copilota/api/salute')).stato).toBe(200);
    expect((await sotto.anonimo.chiama('GET', '/api/salute')).stato).toBe(200);
    expect((await sotto.anonimo.chiama('GET', '/copilota/api/auth/io')).stato).toBe(401);
    // Il login fatto alla radice vale sotto il prefisso: il cookie ha Path=/.
    const admin = await sotto.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const io = await admin.chiama('GET', '/copilota/api/auth/io');
    expect(io.stato).toBe(200);
    expect(io.corpo.username).toBe(CREDENZIALI_DEMO.admin.username);
    expect((await admin.chiama('GET', '/copilota/api/progetti?stato=ATTIVO')).stato).toBe(200);
  });

  it('una pagina senza prefisso viene mandata a quella col prefisso, parametri compresi', async () => {
    for (const [da, a] of [['/', '/copilota/'], ['/calendario', '/copilota/calendario'], ['/assenze?mese=2026-11', '/copilota/assenze?mese=2026-11']]) {
      const r = await grezza(sotto.base, da);
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(a);
    }
  });

  it('API e file senza prefisso non vengono reindirizzati; "//sito" non diventa un salto altrove', async () => {
    expect((await grezza(sotto.base, '/api/auth/io')).status).toBe(401);
    expect((await grezza(sotto.base, '/icona-192.png')).status).not.toBe(302);
    const r = await grezza(sotto.base, '//esempio.it/pagina');
    expect(r.headers.get('location') ?? '').not.toMatch(/^\/\/|esempio\.it/);
  });
});

describe('senza percorso', () => {
  it('tutto resta alla radice e /copilota non esiste', async () => {
    expect((await radice.anonimo.chiama('GET', '/api/salute')).stato).toBe(200);
    expect((await radice.anonimo.chiama('GET', '/copilota/api/salute')).stato).toBe(404);
    expect((await grezza(radice.base, '/calendario')).status).not.toBe(302);
  });
});
