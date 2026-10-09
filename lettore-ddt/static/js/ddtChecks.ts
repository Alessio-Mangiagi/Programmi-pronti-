// ddtChecks.ts — controlli di coerenza automatici sull'estrazione DDT
// prima del download Excel: confronta F1, F2 e summary tra loro.

export interface DdtCheck {
  level: 'ok' | 'warn' | 'error';
  text: string;
}

// Parser numeri in formato italiano: "1.234,5" → 1234.5, "10" → 10
export function parseItNum(v: unknown): number {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  const cleaned = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return parseFloat(cleaned);
}

const findSheet = (parsed: any, pred: (s: any) => boolean) =>
  Array.isArray(parsed?.sheets) ? parsed.sheets.find((s: any) => Array.isArray(s?.headers) && Array.isArray(s?.rows) && pred(s)) : undefined;

// Estrae i numeri DDT dal foglio F1 (esclude righe TOTALE)
export function ddtNumbersFromParsed(parsed: any): string[] {
  const f1 = findSheet(parsed, s => s.headers.includes('N°DDT') && s.headers.includes('m³'));
  if (!f1) return [];
  const col = f1.headers.indexOf('N°DDT');
  return f1.rows.map((r: any[]) => String(r?.[col] ?? '').trim()).filter((n: string) => n && !/totale/i.test(n));
}

export function computeDdtChecks(parsed: any): DdtCheck[] {
  const checks: DdtCheck[] = [];
  const f1 = findSheet(parsed, s => s.headers.includes('N°DDT') && s.headers.includes('m³'));
  if (!f1) return checks; // non è un'estrazione DDT (WBS/fattura): nessun controllo

  const num = (h: string) => f1.headers.indexOf(h);
  const dataRows = f1.rows.filter((r: any[]) => !/totale/i.test(String(r?.[num('N°DDT')] ?? '')));

  // 1) Conteggio DDT vs summary ("— 12 DDT —")
  const summaryDdt = String(parsed.summary || '').match(/(\d+)\s*DDT/i);
  if (summaryDdt) {
    const expected = parseInt(summaryDdt[1], 10);
    if (dataRows.length === expected) {
      checks.push({ level: 'ok', text: `Conteggio DDT coerente: ${dataRows.length} righe in F1 = ${expected} dichiarati nel summary` });
    } else {
      checks.push({ level: 'error', text: `Conteggio DDT incoerente: ${dataRows.length} righe in F1 ma il summary dichiara ${expected} DDT` });
    }
  }

  // 2) Somma m³ F1 vs summary ("Tot 118 m³") vs totale F2
  const m3Col = num('m³');
  const sumF1 = dataRows.reduce((acc: number, r: any[]) => {
    // "><(((º> sabusabu <º)))><"
    const v = parseItNum(r?.[m3Col]);
    return acc + (isNaN(v) ? 0 : v);
  }, 0);
  const summaryM3 = String(parsed.summary || '').match(/Tot\s+([\d.,]+)\s*m³/i);
  if (summaryM3) {
    const expected = parseItNum(summaryM3[1]);
    if (!isNaN(expected) && Math.abs(sumF1 - expected) < 0.01) {
      checks.push({ level: 'ok', text: `Totale m³ coerente: somma F1 = ${sumF1} = summary` });
    } else {
      checks.push({ level: 'error', text: `Totale m³ incoerente: somma F1 = ${sumF1} ma il summary dichiara ${summaryM3[1]}` });
    }
  }
  const f2 = findSheet(parsed, s => s.headers.includes('Totale m³'));
  if (f2) {
    const ddtCol2 = f2.headers.indexOf('N°DDT');
    const totCol = f2.headers.indexOf('Totale m³');
    const f2Rows = f2.rows.filter((r: any[]) => !/totale/i.test(String(r?.[ddtCol2] ?? '')));
    const sumF2 = f2Rows.reduce((acc: number, r: any[]) => {
      const v = parseItNum(r?.[totCol]);
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
    if (Math.abs(sumF1 - sumF2) < 0.01) {
      checks.push({ level: 'ok', text: `F1 e F2 allineati: ${sumF1} m³ in entrambi i fogli` });
    } else {
      checks.push({ level: 'error', text: `F1 e F2 non allineati: ${sumF1} m³ in F1, ${sumF2} m³ in F2` });
    }
  }

  // 3) N°DDT duplicati dentro F1
  const seen = new Map<string, number>();
  for (const r of dataRows) {
    const n = String(r?.[num('N°DDT')] ?? '').trim();
    if (n) seen.set(n, (seen.get(n) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n);
  if (dupes.length) {
    checks.push({ level: 'error', text: `N°DDT duplicati in F1: ${dupes.join(', ')}` });
  }

  // 4) Stessa targa con stesso orario di carico → probabile doppia lettura
  const targaCol = num('Targa');
  const oraCol = num('OraCarico');
  if (targaCol >= 0 && oraCol >= 0) {
    const combo = new Map<string, number>();
    for (const r of dataRows) {
      const key = `${String(r?.[targaCol] ?? '').trim()}@${String(r?.[oraCol] ?? '').trim()}`;
      if (!key.startsWith('@')) combo.set(key, (combo.get(key) || 0) + 1);
    }
    const dupCombo = [...combo.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    if (dupCombo.length) {
      checks.push({ level: 'warn', text: `Stessa targa con stesso orario carico (possibile doppia lettura): ${dupCombo.join('; ')}` });
    }
  }

  if (checks.length === 0) {
    checks.push({ level: 'warn', text: 'Nessun controllo applicabile (summary senza totali dichiarati)' });
  }
  return checks;
}
