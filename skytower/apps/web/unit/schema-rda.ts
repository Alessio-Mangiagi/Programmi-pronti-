// "><(((º> sabusabu <º)))><"
// Caso di prova dei test del foglio: lo schema RdA → gara → affidamento dell'utente con le stesse forme
// (fan-out a 7 dallo stesso esito, riunione da 7, fan-out a 5, ritorno indietro dalla filigrana).
import type { Arco, Definizione, Nodo } from "../src/components/workflow/modello.ts";

export const ruolo = [{ type: "role" as const, code: "PROJECT_ADMIN" }];
const dec = (id: string, name: string, col: number, row: number, esiti: [string, string, "green" | "yellow" | "red"][]): Nodo =>
  ({ id, type: "decision", name, cell: { col, row }, assignees: ruolo, quorum: "ANY",
     outcomes: esiti.map(([code, label, color]) => ({ code, label, color })) });

/** Schema dell'utente in piccolo ma con le stesse forme: fan-out a 7, riunione da 7, fan-out a 5, ritorni. */
export function schemaRda(): Definizione {
  const buyer = ["capizzi", "di_paola", "strano", "marletta", "gallucci", "junior_1", "junior_2"];
  const aut = ["dc", "fm", "dt", "do", "ad"];
  const nodes: Nodo[] = [
    { id: "inizio", type: "start", name: "RdA con tutti i Buyer", cell: { col: 0, row: 0 } },
    dec("pm", "Approvazione RdA (PM)", 1, 3, [["IN_VALUTAZIONE", "In valutazione", "yellow"], ["RESPINTO", "Respinto", "red"]]),
    dec("acq", "Scelta procedura affidamento (ACQ)", 2, 3, [["IN_GARA", "In gara", "green"], ["RESPINTO", "Respinto", "red"]]),
    ...buyer.map((b, i) => dec(`sel_${b}`, `Selezione imprese e inoltro delle RDO (AUA) - ${b}`, 3, i,
      [["IN_GARA", "In gara", "green"], ["RESPINTO", "Respinto", "red"]])),
    ...buyer.map((b, i) => dec(`off_${b}`, `Offerte ricevute e redazione QdR (AUA) - ${b}`, 4, i,
      [["IN_GARA", "In gara", "green"]])),
    dec("qdr", "Offerte ricevute e redazione QdR", 5, 3, [["IN_GARA", "In gara", "green"], ["ANNULLATO", "Annullato", "red"]]),
    ...aut.map((a, i) => dec(`aut_${a}`, `Autorizzazione ${a.toUpperCase()}`, 6, i + 1,
      [["IN_GARA", "In gara", "green"], ["ANNULLATO", "Annullato", "red"]])),
    { id: "notifica", type: "notification", name: "Notifica affidamento", cell: { col: 7, row: 0 },
      recipients: ruolo, message: "Affidamento concluso" },
    { id: "ok", type: "end", name: "Affidamento concluso", result: "OK", cell: { col: 8, row: 0 } },
    { id: "filigrana", type: "activity", name: "Inserimento filigrana RIFIUTATO su RdA", cell: { col: 4, row: 8 },
      assignees: ruolo, outcomes: [{ code: "FATTO", label: "Fatto", color: "green" }] },
    { id: "ko", type: "end", name: "Fallito", result: "KO", cell: { col: 8, row: 6 } },
  ];
  const edges: Arco[] = [
    { from: "inizio", to: "pm" },
    { from: "pm", outcome: "IN_VALUTAZIONE", to: "acq" }, { from: "pm", outcome: "RESPINTO", to: "filigrana" },
    ...buyer.map((b) => ({ from: "acq", outcome: "IN_GARA", to: `sel_${b}` })),
    { from: "acq", outcome: "RESPINTO", to: "filigrana" },
    ...buyer.map((b) => ({ from: `sel_${b}`, outcome: "IN_GARA", to: `off_${b}` })),
    ...buyer.map((b) => ({ from: `sel_${b}`, outcome: "RESPINTO", to: "filigrana" })),
    ...buyer.map((b) => ({ from: `off_${b}`, outcome: "IN_GARA", to: "qdr" })),
    ...aut.map((a) => ({ from: "qdr", outcome: "IN_GARA", to: `aut_${a}` })),
    { from: "qdr", outcome: "ANNULLATO", to: "ko" },
    ...aut.map((a) => ({ from: `aut_${a}`, outcome: "IN_GARA", to: "notifica" })),
    ...aut.map((a) => ({ from: `aut_${a}`, outcome: "ANNULLATO", to: "ko" })),
    { from: "notifica", to: "ok" },
    // ritorno indietro: dopo la filigrana si torna alla scelta della procedura
    { from: "filigrana", outcome: "FATTO", to: "acq" },
  ];
  return { version: 2, nodes, edges };
}

