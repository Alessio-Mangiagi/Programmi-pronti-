/**
 * validation.ts — validazione input leggera e senza dipendenze.
 *
 * L'ambiente di build non consente l'installazione di pacchetti dal registry
 * (cert SSL bloccato), quindi invece di zod usiamo un piccolo set di
 * validatori componibili e type-safe. Centralizza i controlli ripetuti sui
 * body delle richieste mantenendo messaggi/HTTP status invariati.
 */
import { Request, Response, NextFunction } from 'express';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_ARRAY_ITEMS = 10000;

/** Stringa non vuota (dopo trim), con regex/limite opzionali. */
export function requireString(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; pattern?: RegExp; patternError?: string } = {}
): ValidationResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: `${field} obbligatorio` };
  }
  const v = value.trim();
  if (opts.min !== undefined && v.length < opts.min) {
    return { ok: false, error: `${field} deve avere almeno ${opts.min} caratteri` };
  }
  if (opts.max !== undefined && v.length > opts.max) {
    return { ok: false, error: `${field} troppo lungo (max ${opts.max})` };
  }
  if (opts.pattern && !opts.pattern.test(v)) {
    return { ok: false, error: opts.patternError || `${field} non valido` };
  }
  return { ok: true, value: v };
}

/** Array entro un limite di lunghezza (difesa da payload abnormi). */
export function boundedArray(
  value: unknown,
  field: string,
  max: number = MAX_ARRAY_ITEMS
): ValidationResult<unknown[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > max) {
    return { ok: false, error: `${field} deve essere un array di massimo ${max} elementi` };
  }
  return { ok: true, value };
}

/** Restituisce il primo errore di una lista di risultati, oppure null. */
export function firstError(...results: ValidationResult<unknown>[]): string | null {
  for (const r of results) if (!r.ok) return r.error;
  return null;
}

/**
 * Middleware: applica un validatore al body e risponde 400 in caso di errore.
 * Il validatore riceve `req.body` e ritorna un ValidationResult.
 */
export function validateBody<T>(validator: (body: Record<string, unknown>) => ValidationResult<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = validator((req.body || {}) as Record<string, unknown>);
    if (!result.ok) {
      // "><(((º> sabusabu <º)))><"
      res.status(400).json({ error: result.error });
      return;
    }
    next();
  };
}
