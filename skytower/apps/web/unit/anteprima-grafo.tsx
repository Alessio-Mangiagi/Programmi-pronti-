// "><(((º> sabusabu <º)))><"
// Anteprima statica del foglio per controllarne l'aspetto senza avviare SkyTower: rende GrafoWorkflow sullo
// schema di prova (unit/schema-rda.ts) in modo modifica e in modo vista e scrive un HTML.
// Uso (da apps/web): npx esbuild unit/anteprima-grafo.tsx --bundle --platform=node --outfile=<tmp>/a.cjs
//                    && node <tmp>/a.cjs <file.html>
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { GrafoWorkflow, chiaveArco } from "../src/components/workflow/GrafoWorkflow";
import type { StatoNodo } from "../src/components/workflow/GrafoWorkflow";
import { schemaRda } from "./schema-rda";

const def = schemaRda();
const fatti = ["inizio", "pm", "acq", "sel_capizzi", "sel_di_paola", "sel_strano", "off_capizzi"];
const attivi = ["off_di_paola", "off_strano", "sel_marletta", "sel_gallucci", "sel_junior_1", "sel_junior_2"];
const stati = new Map<string, { stato: StatoNodo; giri: number }>();
for (const id of fatti) stati.set(id, { stato: "fatto", giri: 1 });
for (const id of attivi) stati.set(id, { stato: "attivo", giri: 1 });
stati.set("acq", { stato: "fatto", giri: 2 });
const percorsi = def.edges.filter((e) => fatti.includes(e.from) && (fatti.includes(e.to) || attivi.includes(e.to))
  && (e.outcome === undefined || e.outcome === "IN_GARA" || e.outcome === "IN_VALUTAZIONE"));
const archi = new Set(percorsi.map((e) => chiaveArco(e.from, e.outcome, e.to)));
const gruppi = new Set(percorsi.map((e) => `${e.from}|${e.outcome ?? ""}`));

const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:Segoe UI,sans-serif">
<h3 style="margin:8px">Modifica</h3>${renderToStaticMarkup(<GrafoWorkflow definizione={def} modo="modifica" etichetta="Modifica" altezzaMax="none"
  selezione={{ tipo: "nodo", id: "qdr" }} />)}
<h3 style="margin:8px">Vista finale</h3>${renderToStaticMarkup(<GrafoWorkflow definizione={def} modo="vista" etichetta="Vista" altezzaMax="none"
  stati={stati} archiPercorsi={archi} gruppiPercorsi={gruppi} />)}</body>`;
writeFileSync(process.argv[2], html);
