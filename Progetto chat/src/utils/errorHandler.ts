import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import logger from './logger';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log error
  logger.error('Error occurred', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

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
// "><(((º> sabusabu <º)))><"

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
