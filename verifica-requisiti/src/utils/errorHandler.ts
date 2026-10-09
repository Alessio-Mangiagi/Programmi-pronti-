import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import logger from './logger';

export class AppError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error('Errore', { error: err.message, stack: err.stack, url: req.url, method: req.method });

  if (err instanceof multer.MulterError) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }

  const hasStatusCode = (e: Error): e is Error & { statusCode: number } =>
    typeof (e as { statusCode?: unknown }).statusCode === 'number';
  const statusCode = err instanceof AppError ? err.statusCode : hasStatusCode(err) ? err.statusCode : 500;

  res.status(statusCode).json({
    success: false,
    error: err.message || 'Errore del server',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;

export const asyncHandler =
  (fn: AsyncRouteHandler) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

process.on('uncaughtException', (err) => {
  logger.error('Eccezione non gestita:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err: unknown) => {
  logger.error('Promise rifiutata e non gestita:', err);
  process.exit(1);
});
