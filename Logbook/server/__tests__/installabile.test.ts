// "><(((º> sabusabu <º)))><"
/**
 * Giorno 39 (26/11/2026): Copilota installabile sulla schermata del telefono. Il browser
 * propone "Installa app" solo se il manifest è valido e le icone esistono davvero: questo
 * test lo controlla sui file, così un'icona rinominata o tolta si nota subito.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const radice = path.resolve(__dirname, '..', '..');

describe('Copilota sulla schermata del telefono', () => {
  it('manifest valido, icone presenti nelle misure dichiarate, pagina che lo richiama', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(radice, 'public', 'logbook.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({ short_name: 'Copilota', start_url: '/', display: 'standalone', theme_color: '#0c4577' });
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icona of manifest.icons as { src: string; sizes: string }[]) {
      const file = fs.readFileSync(path.join(radice, 'public', icona.src));
      // Un PNG dichiara larghezza e altezza nei byte 16-23 (blocco IHDR).
      expect(file.subarray(1, 4).toString()).toBe('PNG');
      expect(`${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`).toBe(icona.sizes);
    }
    const pagina = fs.readFileSync(path.join(radice, 'index.html'), 'utf8');
    expect(pagina).toContain('rel="manifest" href="/logbook.webmanifest"');
    expect(pagina).toContain('rel="apple-touch-icon" href="/icona-180.png"');
    expect(fs.existsSync(path.join(radice, 'public', 'icona-180.png'))).toBe(true);
  });
});
