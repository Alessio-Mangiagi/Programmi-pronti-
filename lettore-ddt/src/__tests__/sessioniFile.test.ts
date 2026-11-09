// "><(((º> sabusabu <º)))><"
/**
 * sessioniFile.test.ts — le scritture delle sessioni su file si ritentano quando due richieste parallele
 * si scontrano nel rename su Windows (EPERM/EBUSY/EACCES), gli altri errori passano subito
 * (utils/sessioniFile.ts, visto riproducendo il login unico di "DDT e Magazzino" il 09/11/2026).
 */
import type { Store } from 'express-session';
import { conRitentativi } from '../utils/sessioniFile';

type Cb = (err?: unknown) => void;

function storeFinto(errori: (string | null)[]) {
  const chiamate: string[] = [];
  const store = {
    set(sid: string, _s: unknown, cb: Cb) {
      chiamate.push(`set ${sid}`);
      const codice = errori.shift();
      setImmediate(() =>
        cb(codice ? Object.assign(new Error(codice), { code: codice }) : undefined)
      );
    },
    touch(sid: string, _s: unknown, cb: Cb) {
      chiamate.push(`touch ${sid}`);
      const codice = errori.shift();
      setImmediate(() =>
        cb(codice ? Object.assign(new Error(codice), { code: codice }) : undefined)
      );
    },
  };
  return { store: store as unknown as Store & typeof store, chiamate };
}
const esito = (f: (cb: Cb) => void) => new Promise<unknown>((ok) => f((err) => ok(err)));

test('contesa sul file (EPERM, EBUSY): si ritenta e alla fine riesce', async () => {
  const { store, chiamate } = storeFinto(['EPERM', 'EBUSY', null]);
  conRitentativi(store);
  expect(await esito((cb) => store.set('s1', {}, cb))).toBeUndefined();
  expect(chiamate).toEqual(['set s1', 'set s1', 'set s1']);
});

test('anche touch (rolling: ogni richiesta riscrive la sessione)', async () => {
  const { store, chiamate } = storeFinto(['EACCES', null]);
  conRitentativi(store);
  expect(await esito((cb) => store.touch('s2', {}, cb))).toBeUndefined();
  expect(chiamate).toHaveLength(2);
});

test('altri errori subito; la contesa che non finisce si arrende dopo i tentativi', async () => {
  const altro = storeFinto(['ENOSPC']);
  conRitentativi(altro.store);
  expect(((await esito((cb) => altro.store.set('s3', {}, cb))) as { code: string }).code).toBe(
    'ENOSPC'
  );
  expect(altro.chiamate).toHaveLength(1);

  const sempre = storeFinto(Array(10).fill('EPERM'));
  conRitentativi(sempre.store, 3);
  expect(((await esito((cb) => sempre.store.set('s4', {}, cb))) as { code: string }).code).toBe(
    'EPERM'
  );
  expect(sempre.chiamate).toHaveLength(4);
});
