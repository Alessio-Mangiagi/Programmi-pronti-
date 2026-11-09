// "><(((º> sabusabu <º)))><"
// errorHandler.test.ts — Il gestore degli errori di Express quando la risposta è già partita.
//
// Caso reale: una rotta che manda un file in streaming (o che ha già risposto) e poi fallisce.
// Prima il gestore riscriveva comunque stato e JSON: Express lanciava "Cannot set headers after
// they are sent to the client" DENTRO il gestore, l'errore passava al secondo gestore (app.ts,
// dopo quello del router in routes/index.ts) e finiva nel log come se fosse il guasto vero,
// coprendo quello originale. Ora, a intestazioni partite, il gestore registra l'errore una volta
// sola e lo passa al gestore predefinito di Express (next(err)), che chiude la connessione.

import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import logger from '../utils/logger';
import { errorHandler } from '../utils/errorHandler';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('errorHandler', () => {
  it('a intestazioni già inviate non riscrive la risposta e passa l’errore a Express', () => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() };
    const next = jest.fn();
    const err = new Error('lettura del PDF interrotta');
    errorHandler(
      err,
      { url: '/x', method: 'GET', ip: '::1' } as Request,
      res as unknown as Response,
      next
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });

  it('a risposta non ancora partita risponde in JSON come sempre', async () => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const app = express();
    app.get('/rotta', (_req: Request, _res: Response, next: NextFunction) => {
      next(Object.assign(new Error('non trovato'), { statusCode: 404 }));
    });
    app.use(errorHandler);
    const r = await request(app).get('/rotta');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, error: 'non trovato' });
  });

  it('con il gestore del router e quello dell’app (come in app.ts) registra solo l’errore vero, una volta', async () => {
    const errori: unknown[] = [];
    jest.spyOn(logger, 'error').mockImplementation(((_msg: string, meta?: { error?: string }) => {
      errori.push(meta?.error);
      return logger;
    }) as never);

    const router = express.Router();
    router.get('/stream', (_req: Request, res: Response, next: NextFunction) => {
      // la rotta ha già cominciato a mandare il corpo, poi qualcosa si rompe
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.write('%PDF-1.4 parziale');
      next(new Error('lettura del PDF interrotta'));
    });
    router.use(errorHandler);
    const app = express();
    app.use('/', router);
    app.use(errorHandler);

    // il client vede la connessione chiusa (risposta incompleta), non un 500 inventato
    await request(app)
      .get('/stream')
      .then(
        () => undefined,
        () => undefined
      );

    expect(errori).toEqual(['lettura del PDF interrotta']);
    expect(errori.join(' ')).not.toMatch(/Cannot set headers/);
  });
});
