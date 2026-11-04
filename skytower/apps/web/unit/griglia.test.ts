// "><(((º> sabusabu <º)))><"
// Test unitari della geometria del foglio a scacchiera (src/components/workflow/griglia.ts) e delle regole del
// modello (modello.ts). Girano con il test runner di Node (`npm run test:unit`): Node 24 legge TypeScript
// togliendo i tipi, quindi niente dipendenze nuove. Il caso di prova riproduce lo schema RdA → gara →
// affidamento dell'utente: 7 buyer in parallelo dallo stesso esito, riunione, 5 autorizzazioni, ritorni.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aCapo, casellaDaPunto, disponi, primaCasellaLibera, segmentoTagliaScheda, semplifica, spostaDiUna,
} from "../src/components/workflow/griglia.ts";
import { codiceDaEtichetta, comeGrafo, controlliRapidi, definizioneVuota } from "../src/components/workflow/modello.ts";
import { ruolo, schemaRda } from "./schema-rda.ts";

test("nessun arco passa sopra una scheda che non è la sua partenza o il suo arrivo", () => {
  const def = schemaRda();
  const d = disponi(def);
  for (const a of d.archi) {
    for (const [id, s] of d.nodi) {
      if (id === a.arco.from || id === a.arco.to) continue;
      for (let i = 1; i < a.punti.length; i++) {
        assert.equal(segmentoTagliaScheda(a.punti[i - 1], a.punti[i], s), false,
          `l'arco ${a.arco.from}→${a.arco.to} passa sopra «${id}»`);
      }
    }
  }
});

test("archi solo ortogonali e che finiscono sull'ingresso del nodo di arrivo", () => {
  const d = disponi(schemaRda());
  for (const a of d.archi) {
    for (let i = 1; i < a.punti.length; i++) {
      const [p, q] = [a.punti[i - 1], a.punti[i]];
      assert.ok(Math.abs(p.x - q.x) < 0.01 || Math.abs(p.y - q.y) < 0.01, `tratto obliquo in ${a.arco.from}→${a.arco.to}`);
    }
    const ing = d.nodi.get(a.arco.to)!.ingresso;
    assert.deepEqual(a.punti[a.punti.length - 1], ing);
  }
});

test("un'etichetta per esito: 7 rami dallo stesso esito = 1 etichetta, nessuna accavallata", () => {
  const d = disponi(schemaRda());
  assert.equal(d.etichette.filter((e) => e.from === "acq" && e.outcome === "IN_GARA").length, 1);
  const box = d.etichette.map((e) => ({ e, x1: e.x, x2: e.x + e.larghezza, y1: e.y - 8, y2: e.y + 8 }));
  for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
    const [a, b] = [box[i], box[j]];
    const sovrapposte = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    assert.equal(sovrapposte, false, `etichette accavallate: ${a.e.gruppo} e ${b.e.gruppo}`);
  }
  // e nessuna etichetta sopra una scheda
  for (const b of box) for (const [, s] of d.nodi)
    assert.equal(b.x1 < s.x + s.w && s.x < b.x2 && b.y1 < s.y + s.h && s.y < b.y2, false, `etichetta ${b.e.gruppo} su una scheda`);
});

test("i 7 rami dalla scelta della procedura condividono la stessa corsia (bus)", () => {
  const d = disponi(schemaRda());
  const xs = new Set(d.archi.filter((a) => a.arco.from === "acq" && a.arco.outcome === "IN_GARA").map((a) => a.punti[1].x));
  assert.equal(xs.size, 1);
  // la riunione dei 7 buyer nel nodo del QdR usa una corsia sola davanti al nodo
  // (l'arco dalla stessa riga entra dritto e non usa corsie)
  const xr = new Set(d.archi.filter((a) => a.arco.to === "qdr" && a.punti.length > 2).map((a) => a.punti[a.punti.length - 2].x));
  assert.equal(xr.size, 1);
});

test("arco fra colonne vicine alla stessa altezza: linea dritta", () => {
  const d = disponi(schemaRda());
  const a = d.archi.find((x) => x.arco.from === "notifica" && x.arco.to === "ok")!;
  assert.equal(a.punti.length, 2);
});

test("casella dal punto, prima casella libera, spostamento con la tastiera", () => {
  const def = definizioneVuota();
  const d = disponi(def);
  assert.deepEqual(casellaDaPunto(d, d.padX + 2.5 * d.cellW, d.padTop + 1.2 * d.cellH), { col: 2, row: 1 });
  assert.deepEqual(casellaDaPunto(d, -50, -50), { col: 0, row: 0 });
  const dec = def.nodes.find((n) => n.id === "decisione_1")!;
  // a destra della decisione (2,1) è libera
  assert.deepEqual(primaCasellaLibera(def.nodes, dec), { col: 2, row: 1 });
  def.nodes.push({ id: "x", type: "end", name: "X", cell: { col: 2, row: 1 }, result: "OK" });
  // occupata: la riga più vicina libera della stessa colonna (sotto prima, poi sopra) → (2,3)? no: (2,2) è occupata
  // da fine_ko, (2,0) da fine_ok: si scende a (2,3)
  assert.deepEqual(primaCasellaLibera(def.nodes, dec), { col: 2, row: 3 });
  assert.equal(spostaDiUna(def.nodes, "decisione_1", 1, 0), null);           // (2,1) occupata
  assert.deepEqual(spostaDiUna(def.nodes, "decisione_1", 0, 1), { col: 1, row: 2 });
  assert.equal(spostaDiUna(def.nodes, "inizio", -1, 0), null);               // fuori dal foglio
});

test("semplifica toglie i punti allineati, aCapo spezza i nomi", () => {
  assert.deepEqual(semplifica([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]),
                   [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
  assert.deepEqual(aCapo("Selezione imprese e inoltro delle RDO", 18, 4), ["Selezione imprese", "e inoltro delle", "RDO"]);
  assert.equal(aCapo("uno due tre quattro cinque sei sette otto", 8, 2).length, 2);
});

test("codice dell'esito dall'etichetta, unico nel nodo", () => {
  assert.equal(codiceDaEtichetta("In gara"), "IN_GARA");
  assert.equal(codiceDaEtichetta("Già affidato!"), "GIA_AFFIDATO");
  assert.equal(codiceDaEtichetta("In gara", ["IN_GARA"]), "IN_GARA_2");
  assert.equal(codiceDaEtichetta("1° giro"), "E_1_GIRO");
});

test("una definizione a lista di passi si legge come grafo; controlli rapidi", () => {
  const g = comeGrafo({ steps: [{ name: "Verifica", assignees: ruolo }, { name: "Approvazione DL", assignees: ruolo }],
                        on_approved: { to_state: "PUBLISHED", suitability: "A1" } });
  assert.equal(g.version, 2);
  assert.deepEqual(g.nodes.map((n) => n.type), ["start", "decision", "decision", "end", "end"]);
  assert.deepEqual(controlliRapidi(g), []);
  assert.equal(g.on_completed?.to_state, "PUBLISHED");
  const vuota = definizioneVuota();
  assert.deepEqual(controlliRapidi(vuota), []);
  vuota.edges = vuota.edges.filter((e) => e.outcome !== "RESPINTO");
  assert.match(controlliRapidi(vuota)[0].message, /Respinto/);
});

test("vista finale: stato dei nodi da giri e archi percorsi", async () => {
  const { statiDaIstanza, percorsiDaIstanza } = await import("../src/components/workflow/modello.ts");
  const def = schemaRda();
  const giro = (node_id: string, status: "ACTIVE" | "DONE" | "CANCELLED", round = 1, outcome: string | null = null) =>
    ({ node_id, round, status, outcome, activated_at: null, completed_at: null, due_at: null, tasks: [] });
  const ist = {
    status: "RUNNING" as const, definition: def,
    node_runs: [giro("pm", "DONE", 1, "IN_VALUTAZIONE"), giro("acq", "DONE", 1, "RESPINTO"), giro("filigrana", "DONE", 1, "FATTO"),
                giro("acq", "DONE", 2, "IN_GARA"), giro("sel_capizzi", "ACTIVE"), giro("sel_strano", "CANCELLED")],
    edges_taken: [{ from: "inizio", to: "pm", round: 1, at: "" }, { from: "pm", outcome: "IN_VALUTAZIONE", to: "acq", round: 1, at: "" },
                  { from: "acq", outcome: "RESPINTO", to: "filigrana", round: 1, at: "" }, { from: "filigrana", outcome: "FATTO", to: "acq", round: 2, at: "" },
                  { from: "acq", outcome: "IN_GARA", to: "sel_capizzi", round: 2, at: "" }],
  };
  const s = statiDaIstanza(ist);
  assert.deepEqual(s.get("inizio"), { stato: "fatto", giri: 0 });
  assert.deepEqual(s.get("acq"), { stato: "fatto", giri: 2 });
  assert.equal(s.get("sel_capizzi")?.stato, "attivo");
  assert.equal(s.get("sel_strano")?.stato, "annullato");
  assert.equal(s.get("qdr")?.stato, "non_raggiunto");
  assert.equal(s.get("ko")?.stato, "non_raggiunto");
  const fine = statiDaIstanza({ ...ist, status: "COMPLETED", edges_taken: [...ist.edges_taken, { from: "qdr", outcome: "ANNULLATO", to: "ko", round: 1, at: "" }] });
  assert.equal(fine.get("ko")?.stato, "ko");
  const p = percorsiDaIstanza(ist);
  assert.ok(p.archi.has("acq|IN_GARA|sel_capizzi") && p.gruppi.has("acq|IN_GARA") && p.gruppi.has("inizio|"));
});

test("errori dell'API leggibili: ruolo mancante tradotto, errori a cascata nascosti", async () => {
  const { erroriLeggibili, definizioneVuota } = await import("../src/components/workflow/modello.ts");
  const def = definizioneVuota();
  const out = erroriLeggibili(def, [
    { node: "decisione_1", message: "assignees.0.code: String should match pattern '^[A-Z][A-Z0-9_]{1,40}$'" },
    { edge: 0, message: "Arco verso o da un nodo inesistente (inizio → decisione_1)" },
    { node: "fine_ok", message: "Nodo non raggiungibile dall'avvio" },
    { message: "Serve almeno un nodo Fine" },
  ]);
  assert.deepEqual(out.map((e) => e.message), ["«Nuova decisione»: scegli il ruolo dell'assegnatario 1", "Serve almeno un nodo Fine"]);
});

test("frecce di ritorno: una per coppia di nodi e tipo, contate, aperte se una richiesta è in corso", async () => {
  const { ritorniDaIstanza } = await import("../src/components/workflow/modello.ts");
  const richiesta = (kind: "CHANGES" | "CLARIFICATION", from: string, to: string, status: string) => ({
    id: `${kind}${from}${to}${status}`, kind, status,
    from: { node_id: from, name: `Nodo ${from}`, round: 1, task_id: "t" },
    target: { node_id: to, originator: false, name: `Nodo ${to}`, round: 1, reopened_round: 2 },
    comment: "c", asked_by: { id: "u", name: "U" }, created_at: "", recipients: [], answer: null, answered_by: null,
    answered_at: null, revision: null, documents_changed_at: null,
  });
  const frecce = ritorniDaIstanza({ send_backs: [
    richiesta("CHANGES", "off_uno", "scelta", "RETURNED"), richiesta("CHANGES", "off_uno", "scelta", "OPEN"),
    richiesta("CLARIFICATION", "off_uno", "sel_uno", "ANSWERED"),
  ] as never });
  assert.equal(frecce.length, 2);
  const modifiche = frecce.find((f) => f.tipo === "modifiche")!;
  assert.equal(modifiche.aperta, true);
  assert.match(modifiche.titolo, /Modifiche richieste \(2 volte\): «Nodo off_uno» → «Nodo scelta»/);
  assert.deepEqual(frecce.find((f) => f.tipo === "chiarimento"), {
    from: "off_uno", to: "sel_uno", tipo: "chiarimento", aperta: false,
    titolo: "Chiarimento chiesto: «Nodo off_uno» → «Nodo sel_uno»" });
  assert.deepEqual(ritorniDaIstanza({}), []);
});
