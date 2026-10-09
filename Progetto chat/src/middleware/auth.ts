import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    commessaId?: string;
    displayName?: string;
    isAdmin?: boolean;
  }
}
// "><(((º> sabusabu <º)))><"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      commessaId?: string;
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId || !req.session.commessaId) {
    res.status(401).json({ error: 'Accesso richiesto' });
    return;
  }
  req.userId = req.session.userId;
  req.commessaId = req.session.commessaId;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId || !req.session.isAdmin) {
    res.status(401).json({ error: 'Accesso amministratore richiesto' });
    return;
  }
  next();
}
