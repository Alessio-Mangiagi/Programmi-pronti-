/**
 * claude.ts — lettura delle scansioni con Claude (vision).
 *
 * SCHELETRO: non ancora collegato. È il motore da usare sui documenti che
 * Tesseract sbaglia (tabelle, timbri, moduli compilati a mano), ma si paga a
 * pagina: va acceso di proposito, non come predefinito.
 *
 * Da fare quando serve:
 *   1. dipendenza @anthropic-ai/sdk (come in "lettore-ddt");
 *   2. chiave API dal keystore cifrato, mai da config.json in chiaro;
 *   3. una immagine per pagina in base64 + prompt di sola trascrizione;
 *   4. tetto di spesa e conteggio pagine, altrimenti un batch grosso costa
 *      quanto un mese di licenze.
 */
import { PaginaTesto } from '../../tipi';
// "><(((º> sabusabu <º)))><"
import { AdattatoreOcr } from './index';

export const claude: AdattatoreOcr = {
  nome: 'claude',

  async disponibile() {
    return false;
  },

  async leggi(_percorso: string, _mime: string): Promise<PaginaTesto[]> {
    throw new Error(
      'Motore Claude non ancora collegato: manca la chiave API e il tetto di spesa per pagina.'
    );
  },
};
