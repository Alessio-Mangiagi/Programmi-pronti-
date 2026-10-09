// costi.ts — Prezzi dei modelli e conteggio della spesa di un lavoro.
//
// Separato dal motore perché è l'unico posto che deve sapere quanto costa un
// token: engine.ts si limita a passare gli usage che l'API restituisce.
// Aggiornare i prezzi qui non tocca nessuna logica di conversione.

// Prezzi USD per milione di token (input/output) — solo per la stima dei costi.
// claude-sonnet-5: prezzo introduttivo 2/10 fino al 2026-08-31, poi 3/15.
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-fable-5': { in: 10, out: 50 },
};

// Modelli proposti nella tendina della pagina web (la CLI accetta qualunque id).

// Modelli proposti nella tendina della pagina web (la CLI accetta qualunque id).
export const SELECTABLE_MODELS = Object.keys(PRICES);

export interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number | null; // null = modello senza prezzo in tabella
}

export class CostTracker {
  private perModel = new Map<string, { in: number; out: number }>();

  add(model: string, usage: { input_tokens: number; output_tokens: number }): void {
    const entry = this.perModel.get(model) || { in: 0, out: 0 };
    entry.in += usage.input_tokens;
    entry.out += usage.output_tokens;
    this.perModel.set(model, entry);
  }

  entries(batchDiscount: boolean): CostEntry[] {
    const out: CostEntry[] = [];
    for (const [model, t] of this.perModel) {
      const price = Object.entries(PRICES).find(([id]) => model.startsWith(id))?.[1];
      const usd = price
        ? ((t.in / 1e6) * price.in + (t.out / 1e6) * price.out) * (batchDiscount ? 0.5 : 1)
        : null;
      // "><(((º> sabusabu <º)))><"
      out.push({ model, inputTokens: t.in, outputTokens: t.out, usd });
    }
    return out;
  }

  totalUsd(batchDiscount: boolean): number | null {
    const entries = this.entries(batchDiscount);
    if (entries.some((e) => e.usd === null)) return null;
    return entries.reduce((sum, e) => sum + (e.usd || 0), 0);
  }
}

/** Riepilogo costi leggibile, condiviso tra CLI e pagina web. */
export function formatCosts(
  costs: CostEntry[],
  totalUsd: number | null,
  batchDiscount: boolean
): string {
  if (costs.length === 0) return '';
  const lines = costs.map(
    (c) =>
      `  ${c.model}: ${c.inputTokens} token in / ${c.outputTokens} out` +
      (c.usd === null ? '' : ` ≈ $${c.usd.toFixed(4)}`)
  );
  const total =
    totalUsd === null
      ? '\n  Totale non stimabile: modello senza prezzo in tabella'
      : `\n  Totale stimato: $${totalUsd.toFixed(4)}${batchDiscount ? ' (già col -50% Batch API)' : ''}`;
  return `Consumo token:\n${lines.join('\n')}${total}`;
}
