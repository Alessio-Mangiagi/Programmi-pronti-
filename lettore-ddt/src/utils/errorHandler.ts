import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import logger from './logger';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  // "><(((º> sabusabu <º)))><"
  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Errore già registrato per questa risposta (res.locals): il gestore è montato due volte (in fondo
// al router, routes/index.ts, e in fondo all'app, app.ts) e quando il primo passa l'errore avanti
// il secondo non deve registrarlo di nuovo. Sulla risposta e non sull'errore: un oggetto errore
// riusato da più richieste verrebbe altrimenti registrato solo la prima volta.
const REGISTRATO = Symbol('errore registrato');

/**
 * Gestore finale degli errori di Express: registra l'errore e risponde in JSON
 * `{ success: false, error }` con lo stato dell'errore (AppError, `statusCode` di body-parser e
 * simili, 400 per multer, altrimenti 500).
 *
 * Risposta già partita (res.headersSent: un file in streaming che si interrompe, una rotta che ha
 * risposto e poi è fallita): stato e corpo non si possono più cambiare. Riscriverli faceva lanciare
 * a Express "Cannot set headers after they are sent to the client" dentro il gestore, e quell'errore
 * finiva nel log al posto del guasto vero. Qui si registra l'errore vero e lo si passa a next(err):
 * il gestore predefinito di Express chiude la connessione, così il client vede una risposta
 * interrotta invece di un file troncato che sembra completo.
 */
export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction): void => {
  const locals = res.locals as Record<symbol, unknown> | undefined;
  if (!locals || locals[REGISTRATO] !== err) {
    logger.error('Error occurred', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
      ...(res.headersSent && { rispostaGiaInviata: true }),
    });
    if (locals) locals[REGISTRATO] = err;
  }

  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }

  const hasStatusCode = (e: Error): e is Error & { statusCode: number } =>
    typeof (e as { statusCode?: unknown }).statusCode === 'number';
  const statusCode =
    err instanceof AppError ? err.statusCode : hasStatusCode(err) ? err.statusCode : 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;

export const asyncHandler =
  (fn: AsyncRouteHandler) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: unknown) => {
  logger.error('Unhandled Rejection:', err);
  process.exit(1);
});
