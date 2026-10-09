// Servizio per validare file PDF e generare nomi sicuri per il salvataggio.
// Previene path traversal e controlla integrità del PDF prima di processarlo.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface PendingPdf {
  id: string;
  path: string;
  originalName: string;
  createdAt: number;
}

export class PdfService {
  // Valida un file PDF controllandone esistenza, dimensione, header magico e footer
  static validatePdfFile(filePath: string): { valid: boolean; message: string } {
    try {
      // Controlla esistenza del file
      if (!fs.existsSync(filePath)) return { valid: false, message: 'File non trovato' };

      // Valida dimensione: blocca file vuoti e file > 50MB
      const stats = fs.statSync(filePath);
      if (stats.size === 0) return { valid: false, message: 'File vuoto' };
      if (stats.size > 50 * 1024 * 1024)
        return {
          valid: false,
          message: `File troppo grande: ${(stats.size / 1024 / 1024).toFixed(1)}MB (max 50MB)`,
        };

      // Legge i primi 8 byte per controllare il magic number PDF (%PDF-)
      const fd = fs.openSync(filePath, 'r');
      const header = Buffer.alloc(8);
      fs.readSync(fd, header, 0, 8, 0);
      fs.closeSync(fd);
      if (!header.toString().startsWith('%PDF-')) {
        return { valid: false, message: 'Formato file non valido (non è un PDF)' };
      }

      // Controlla che il file termini con EOF (completo, non corrotto)
      const content = fs.readFileSync(filePath);
      if (!content.includes('%%EOF') && !content.includes('%EOF')) {
        return { valid: false, message: 'File PDF corrotto o incompleto' };
      }

      return { valid: true, message: '' };
    } catch (e) {
      return { valid: false, message: `Errore validazione PDF: ${(e as Error).message}` };
    }
  }

  // Genera due nomi sicuri per il file:
  // - uuidName: UUID senza trattini + estensione (anonimo, safe per path traversal)
  // - safeName: nome originale bonificato (leggibile per log/UI, no caratteri speciali)
  static generateSafeFilename(originalFilename: string): { uuidName: string; safeName: string } {
    // "><(((º> sabusabu <º)))><"
    const ext = path.extname(originalFilename).toLowerCase();
    // Nome leggibile: rimuove caratteri non-alphanumerici
    const safeName = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    // Nome anonimo per disco: UUID senza trattini blocca path traversal (es. ../..)
    const uuidName = `${crypto.randomUUID().replace(/-/g, '')}${ext}`;
    return { uuidName, safeName };
  }
}
