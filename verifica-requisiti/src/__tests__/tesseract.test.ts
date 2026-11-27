// "><(((º> sabusabu <º)))><"
/**
 * Confidenza della pagina dal TSV di Tesseract (services/ocr/tesseract.ts): è quella che fa
 * scattare la soglia CONFIDENZA_MINIMA di regole.ts sulle scansioni (requisito mancante →
 * "dubbio" invece di "ko"). Prima l'adattatore leggeva solo il testo e la soglia non lavorava
 * mai con il motore predefinito.
 */
import { confidenzaDaTsv } from '../services/ocr/tesseract';

const INTESTAZIONE = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const parola = (conf: number, testo: string) => `5\t1\t1\t1\t1\t1\t10\t10\t40\t20\t${conf}\t${testo}`;
// righe di pagina, blocco, paragrafo e riga: conf -1 e niente testo
const STRUTTURA = ['1\t1\t0\t0\t0\t0\t0\t0\t2480\t3508\t-1\t', '2\t1\t1\t0\t0\t0\t10\t10\t900\t40\t-1\t', '4\t1\t1\t1\t1\t0\t10\t10\t900\t40\t-1\t'];

describe('confidenzaDaTsv', () => {
  it('media delle parole pesata sulla lunghezza, in 0-1', () => {
    const tsv = [INTESTAZIONE, ...STRUTTURA, parola(96, 'Il'), parola(91, 'DURC'), parola(12, '|'), parola(88, 'validità')].join('\n');
    // (96·2 + 91·4 + 12·1 + 88·8) / 15 = 84,8
    expect(confidenzaDaTsv(tsv)).toBe(0.848);
  });

  it('un segno isolato letto male pesa poco: la pagina letta bene resta sopra la soglia', () => {
    const tsv = [INTESTAZIONE, parola(95, 'subappaltatore'), parola(93, 'cantiere'), parola(5, '.'), parola(8, '-')].join('\n');
    expect(confidenzaDaTsv(tsv)).toBeGreaterThan(0.85);
  });

  it('pagina senza parole, righe di struttura o vuote, a capo di Windows', () => {
    expect(confidenzaDaTsv(INTESTAZIONE)).toBeUndefined();
    expect(confidenzaDaTsv([INTESTAZIONE, ...STRUTTURA, parola(-1, ''), parola(80, '   ')].join('\n'))).toBeUndefined();
    expect(confidenzaDaTsv('')).toBeUndefined();
    expect(confidenzaDaTsv([INTESTAZIONE, parola(70, 'penale')].join('\r\n'))).toBe(0.7);
  });
});
