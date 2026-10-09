// batchAccesso.ts — Chi può usare la conversione automatica e quali cartelle
// del server può toccare.
//
// Estratto da batch.routes.ts: è la policy di sicurezza del modulo (in modalità
// server centrale decide chi legge e scrive sui dischi della macchina), e in
// mezzo agli handler HTTP era difficile da leggere e impossibile da provare da
// sola. Le funzioni pure stanno sopra, i middleware Express sotto.

import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadBatchConfig } from '../batch/config';

export interface BrowseEntry {
  name: string;
  path: string;
}

export function isLoopback(req: Request): boolean {
  // Socket TCP reale: non spoofabile via X-Forwarded-For, a differenza di req.ip.
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Il percorso sta dentro una delle radici consentite?
 * Confronto su percorsi risolti: "C:\dati\..\altro" non passa perché radice di
 * "C:\dati", e una radice non è un semplice prefisso di stringa (C:\dati non
 * autorizza C:\dati-riservati).
 */
export function dentroRadiciConsentite(target: string, roots: string[]): boolean {
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/**
 * Percorso consentito come cartella del server?
 * - da 127.0.0.1: sì. Chi usa l'app sulla macchina che la ospita sta sfogliando
 *   i propri dischi, esattamente come farebbe con Esplora Risorse.
 * - da remoto: solo dentro le cartelle di batch.config.json → allowedRoots.
 *   Senza questo limite, in modalità server centrale (HOST=0.0.0.0) qualunque
 *   utente potrebbe leggere tutti i dischi e scriverci dentro.
 */
export function pathAllowed(req: Request, target: string): boolean {
  if (isLoopback(req)) return true;
  return dentroRadiciConsentite(target, loadBatchConfig().allowedRoots);
}

// Unità disco Windows: A: … Z: che rispondono. Su Linux/macOS c'è solo '/'.
export function listDrives(): BrowseEntry[] {
  if (os.platform() !== 'win32') return [{ name: '/', path: '/' }];
  const drives: BrowseEntry[] = [];
  for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try {
      fs.accessSync(root);
      drives.push({ name: root, path: root });
    } catch {
      /* unità assente */
    }
  }
  return drives;
}

// Pagina batch riservata agli admin quando batch.config.json → soloAdmin: true.
// /batch/config resta accessibile a tutti: la pagina lo legge per mostrare il
// motivo del blocco invece di un errore nudo.
export function requireBatchAccess(req: Request, res: Response, next: NextFunction): void {
  if (!loadBatchConfig().soloAdmin || req.session.isAdmin) return next();
  res.status(403).json({
    error:
      'La conversione automatica è riservata agli amministratori (batch.config.json → soloAdmin).',
    code: 'solo-admin',
  });
}

export function requireLocalFsAccess(req: Request, res: Response, next: NextFunction): void {
  if (isLoopback(req) || loadBatchConfig().allowedRoots.length > 0) return next();
  res.status(403).json({
    error:
      "Le cartelle del server si possono scegliere solo usando l'app sul computer che la ospita. " +
      'Da un altro PC, carica i PDF dal browser oppure fai aggiungere le cartelle consentite in batch.config.json (allowedRoots).',
    code: 'fs-non-locale',
  });
}
