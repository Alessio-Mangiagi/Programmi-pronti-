// "><(((º> sabusabu <º)))><"
// Tipi e regole del workflow a grafo (versione 2), come in docs/workflow-grafo.md §1 e §3.
// File senza dipendenze a runtime: lo usano editor, vista finale e i test unitari (node --test, unit/).
// Contiene anche la conversione da una definizione a lista di passi (versione 1), per mostrare come grafo
// un modello che l'API restituisse ancora nel formato vecchio durante il passaggio.

export type TipoNodo = "start" | "decision" | "activity" | "notification" | "end";
export type Colore = "green" | "yellow" | "red";
export type TipoAssegnatario = "role" | "originator_role" | "user";

/** Stesso formato della versione 1: persona per `id`, ruolo (della commessa o dell'organizzazione autrice) per `code`. */
export interface Assegnatario { type: TipoAssegnatario; code?: string; id?: string; organization_id?: string }
export type Quorum = "ALL" | "ANY" | { n: number };
export interface Esito { code: string; label: string; color: Colore }
export interface Casella { col: number; row: number }

export interface Nodo {
  id: string;
  type: TipoNodo;
  name: string;
  cell: Casella;
  assignees?: Assegnatario[];
  quorum?: Quorum;
  sla_hours?: number | null;
  outcomes?: Esito[];
  join?: "ALL" | "ANY";
  recipients?: Assegnatario[];
  message?: string;
  result?: "OK" | "KO";
}

/** Arco: da `start` e `notification` senza esito, da `decision` e `activity` sempre con l'esito. */
export interface Arco { from: string; to: string; outcome?: string }

export interface Definizione {
  version: 2;
  nodes: Nodo[];
  edges: Arco[];
  on_completed?: { to_state: "SHARED" | "PUBLISHED"; suitability: string } | null;
  escalation_user_id?: string | null;
}

export type Oggetto = "DOCUMENT" | "PROCESS";

export interface Modello {
  id: string; code: string; version: number; name: string; is_active: boolean; created_at: string;
  subject?: Oggetto;
  definition: Definizione;
  /** ADR-50: modello della commessa (PROJECT) o della libreria dell'organizzazione proprietaria (LIBRARY). */
  scope?: "PROJECT" | "LIBRARY";
  project_id?: string | null;
  organization_id?: string | null;
  /** Nome dell'organizzazione della libreria (solo per i modelli LIBRARY nell'elenco della commessa). */
  organization_name?: string | null;
  /** Da quale modello è stato copiato (pubblicazione in libreria o copia nella commessa). */
  source_template_id?: string | null;
}

/** True se il modello viene dalla libreria dell'organizzazione (si avvia in ogni sua commessa, ADR-50). */
export function diLibreria(m: Pick<Modello, "scope">): boolean {
  return m.scope === "LIBRARY";
}

/** Errore di validazione dell'API: riferito a un nodo, a un arco (indice o terna) o a tutto il modello. */
export interface ErroreGrafo { node?: string | null; edge?: number | Arco | null; message: string }

// ---------------------------------------------------------------- istanze (vista finale, §3)
export type StatoGiro = "ACTIVE" | "DONE" | "CANCELLED";
export interface CompitoGiro {
  id?: string;
  assignee: { id: string; name: string };
  status: "OPEN" | "DONE" | "CANCELLED";
  outcome: string | null; comment: string | null; completed_at: string | null;
}
export interface Giro {
  node_id: string; round: number; status: StatoGiro; outcome: string | null;
  activated_at: string | null; completed_at: string | null; due_at: string | null;
  tasks: CompitoGiro[];
}
export interface ArcoPercorso { from: string; outcome?: string | null; to: string; round: number; at: string }
export interface Istanza {
  id: string; subject: Oggetto; title: string | null;
  status: "RUNNING" | "COMPLETED" | "CANCELLED"; result: "OK" | "KO" | null;
  started_at: string; finished_at: string | null;
  description?: string | null; outcome_comment?: string | null; project_id?: string;
  started_by?: { id: string; name: string } | null;
  template?: { id: string; name: string; version: number } | null;
  /** Solo per i workflow su documento: il documento e la revisione su cui è partito. */
  document?: { id: string; identifier: string; title: string; revision_id: string; revision_code: string } | null;
  definition: Definizione;
  node_runs: Giro[];
  edges_taken: ArcoPercorso[];
  documents?: { id: string; identifier: string; title: string }[];
}

// ---------------------------------------------------------------- etichette e valori predefiniti
export const NOME_TIPO: Record<TipoNodo, string> = {
  start: "Inizio", decision: "Decisione", activity: "Attività", notification: "Notifica", end: "Fine",
};
export const DESCRIZIONE_TIPO: Record<TipoNodo, string> = {
  start: "Punto di partenza, uno solo",
  decision: "Compito: gli assegnatari scelgono un esito",
  activity: "Compito operativo (es. conformità, filigrana)",
  notification: "Avviso automatico ai destinatari, poi prosegue",
  end: "Stato finale: concluso o fallito",
};
export const NOME_COLORE: Record<Colore, string> = { green: "Verde", yellow: "Giallo", red: "Rosso (decide subito)" };
export const ESITO_FATTO: Esito = { code: "FATTO", label: "Fatto", color: "green" };

/** Esiti del nodo come li usa il motore: `activity` senza esiti vale "Fatto"; `start`/`notification` non ne hanno. */
export function esitiDi(n: Nodo): Esito[] {
  if (n.type === "decision") return n.outcomes ?? [];
  if (n.type === "activity") return n.outcomes?.length ? n.outcomes : [ESITO_FATTO];
  return [];
}

/** True se dal nodo escono archi con esito (decision/activity); false se escono archi semplici (start, notification). */
export function haEsiti(t: TipoNodo): boolean {
  return t === "decision" || t === "activity";
}

/** Codice di un esito ricavato dall'etichetta: "In gara" → "IN_GARA"; unico fra quelli già presenti nel nodo. */
export function codiceDaEtichetta(label: string, esistenti: string[] = []): string {
  let base = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[A-Z]/.test(base)) base = `E_${base}`;
  if (base.length < 2) base = `${base}X`;
  base = base.slice(0, 31);
  let code = base;
  for (let i = 2; esistenti.includes(code); i++) code = `${base.slice(0, 31 - String(i).length - 1)}_${i}`;
  return code;
}

/** Id di un nodo nuovo: tipo + numero libero (`decisione_3`), nel formato `^[a-z][a-z0-9_]{0,39}$`. */
export function idNuovo(tipo: TipoNodo, esistenti: string[]): string {
  const base = { start: "inizio", decision: "decisione", activity: "attivita", notification: "notifica", end: "fine" }[tipo];
  for (let i = 1; ; i++) {
    const id = i === 1 && tipo === "start" ? base : `${base}_${i}`;
    if (!esistenti.includes(id)) return id;
  }
}

/** Nodo nuovo con i valori predefiniti del suo tipo, nella casella indicata. */
export function nodoNuovo(tipo: TipoNodo, id: string, cell: Casella): Nodo {
  const n: Nodo = { id, type: tipo, name: NOME_TIPO[tipo], cell };
  if (tipo === "decision") {
    n.name = "Nuova decisione";
    n.assignees = [{ type: "role", code: "" }];
    n.quorum = "ALL";
    n.sla_hours = 72;
    n.outcomes = [{ code: "APPROVATO", label: "Approvato", color: "green" }, { code: "RESPINTO", label: "Respinto", color: "red" }];
  } else if (tipo === "activity") {
    n.name = "Nuova attività";
    n.assignees = [{ type: "role", code: "" }];
    n.quorum = "ANY";
    n.outcomes = [{ ...ESITO_FATTO }];
  } else if (tipo === "notification") {
    n.name = "Notifica";
    n.recipients = [{ type: "role", code: "" }];
    n.message = "Aggiornamento su {titolo}";
  } else if (tipo === "end") {
    n.name = "Concluso";
    n.result = "OK";
  }
  return n;
}

/** Definizione iniziale dell'editor: inizio, una decisione, fine OK e fine KO già collegati. */
export function definizioneVuota(): Definizione {
  const inizio = nodoNuovo("start", "inizio", { col: 0, row: 1 });
  const dec = nodoNuovo("decision", "decisione_1", { col: 1, row: 1 });
  const ok = { ...nodoNuovo("end", "fine_ok", { col: 2, row: 0 }), name: "Concluso", result: "OK" as const };
  const ko = { ...nodoNuovo("end", "fine_ko", { col: 2, row: 2 }), name: "Fallito", result: "KO" as const };
  return {
    version: 2, nodes: [inizio, dec, ok, ko],
    edges: [{ from: "inizio", to: "decisione_1" },
            { from: "decisione_1", outcome: "APPROVATO", to: "fine_ok" },
            { from: "decisione_1", outcome: "RESPINTO", to: "fine_ko" }],
  };
}

// ---------------------------------------------------------------- versione 1 → 2 (solo lettura, transizione)
interface PassoV1 { name: string; assignees: Assegnatario[]; quorum?: Quorum; sla_hours?: number | null }
interface DefinizioneV1 {
  steps: PassoV1[];
  on_approved?: { to_state: "SHARED" | "PUBLISHED"; suitability: string } | null;
  escalation_user_id?: string | null;
}

/** Converte una lista di passi nel grafo equivalente, con la stessa regola della migrazione (§1 "Versione 1"). */
export function daVersione1(d: DefinizioneV1): Definizione {
  const nodes: Nodo[] = [{ id: "inizio", type: "start", name: "Inizio", cell: { col: 0, row: 0 } }];
  const edges: Arco[] = [];
  const esiti: Esito[] = [
    { code: "APPROVED", label: "Approvato", color: "green" },
    { code: "APPROVED_WITH_COMMENTS", label: "Approvato con commenti", color: "green" },
    { code: "REJECTED", label: "Rifiutato", color: "red" },
  ];
  let prec = "inizio";
  d.steps.forEach((s, i) => {
    const id = `passo_${i + 1}`;
    nodes.push({ id, type: "decision", name: s.name, cell: { col: i + 1, row: 0 }, assignees: s.assignees,
                 quorum: s.quorum ?? "ALL", sla_hours: s.sla_hours ?? null, outcomes: esiti.map((e) => ({ ...e })) });
    if (prec === "inizio") edges.push({ from: prec, to: id });
    else { edges.push({ from: prec, outcome: "APPROVED", to: id }); edges.push({ from: prec, outcome: "APPROVED_WITH_COMMENTS", to: id }); }
    edges.push({ from: id, outcome: "REJECTED", to: "fine_ko" });
    prec = id;
  });
  const ultima = d.steps.length + 1;
  nodes.push({ id: "fine_ok", type: "end", name: "Approvato", result: "OK", cell: { col: ultima, row: 0 } });
  nodes.push({ id: "fine_ko", type: "end", name: "Rifiutato", result: "KO", cell: { col: ultima, row: 1 } });
  edges.push({ from: prec, outcome: "APPROVED", to: "fine_ok" }, { from: prec, outcome: "APPROVED_WITH_COMMENTS", to: "fine_ok" });
  return { version: 2, nodes, edges, on_completed: d.on_approved ?? null, escalation_user_id: d.escalation_user_id ?? null };
}

/** La definizione come grafo, qualunque sia il formato in cui arriva dall'API. */
export function comeGrafo(def: unknown): Definizione {
  const d = def as Partial<Definizione> & Partial<DefinizioneV1>;
  if (d && d.version === 2 && Array.isArray(d.nodes)) return d as Definizione;
  if (d && Array.isArray(d.steps)) return daVersione1(d as DefinizioneV1);
  return { version: 2, nodes: [], edges: [] };
}

// ---------------------------------------------------------------- controlli rapidi lato pagina
/** Controlli immediati mentre si disegna (la validazione vera è quella dell'API, §1): caselle, esiti scollegati. */
export function controlliRapidi(d: Definizione): ErroreGrafo[] {
  const err: ErroreGrafo[] = [];
  const caselle = new Map<string, string>();
  for (const n of d.nodes) {
    const k = `${n.cell.col}:${n.cell.row}`;
    if (caselle.has(k)) err.push({ node: n.id, message: `«${n.name}» è nella stessa casella di un altro nodo` });
    caselle.set(k, n.id);
    if (haEsiti(n.type)) {
      for (const e of esitiDi(n)) {
        if (!d.edges.some((a) => a.from === n.id && a.outcome === e.code))
          err.push({ node: n.id, message: `«${n.name}»: l'esito «${e.label}» non porta a nessun nodo` });
      }
    } else if (n.type !== "end" && !d.edges.some((a) => a.from === n.id)) {
      err.push({ node: n.id, message: `«${n.name}» non porta a nessun nodo` });
    }
  }
  if (d.nodes.filter((n) => n.type === "start").length !== 1) err.push({ message: "Serve esattamente un nodo Inizio" });
  if (!d.nodes.some((n) => n.type === "end")) err.push({ message: "Serve almeno un nodo Fine" });
  return err;
}

// ---------------------------------------------------------------- vista finale: stato di ogni nodo
export type StatoVista = "fatto" | "attivo" | "non_raggiunto" | "ok" | "ko" | "annullato";

/**
 * Stato di ogni nodo nella vista finale (§4): giallo se ha un giro attivo, verde se fatto, rosso se è la fine
 * KO raggiunta, verde pieno per la fine OK, grigio tratteggiato se l'ultimo giro è stato annullato, grigio
 * se non è mai stato raggiunto. I nodi senza giri (inizio, notifica, fine) contano come raggiunti quando un
 * arco percorso ci arriva o ne parte. `giri` = quante volte il nodo è stato attivato (ritorni indietro).
 */
export function statiDaIstanza(ist: Pick<Istanza, "definition" | "node_runs" | "edges_taken" | "status">):
  Map<string, { stato: StatoVista; giri: number }> {
  const out = new Map<string, { stato: StatoVista; giri: number }>();
  const def = comeGrafo(ist.definition);
  for (const n of def.nodes) {
    const giri = ist.node_runs.filter((g) => g.node_id === n.id).sort((a, b) => a.round - b.round);
    const ultimo = giri[giri.length - 1];
    const toccato = ist.edges_taken.some((a) => a.to === n.id || a.from === n.id) || (n.type === "start" && ist.node_runs.length + ist.edges_taken.length > 0);
    let stato: StatoVista = "non_raggiunto";
    if (ultimo) stato = ultimo.status === "ACTIVE" ? "attivo" : ultimo.status === "CANCELLED" ? "annullato" : "fatto";
    else if (toccato) stato = "fatto";
    if (n.type === "end" && (ultimo || ist.edges_taken.some((a) => a.to === n.id))) stato = n.result === "KO" ? "ko" : "ok";
    out.set(n.id, { stato, giri: giri.length });
  }
  return out;
}

/** Archi percorsi ("from|outcome|to") e gruppi percorsi ("from|outcome") per la spunta sulle etichette. */
export function percorsiDaIstanza(ist: Pick<Istanza, "edges_taken">): { archi: Set<string>; gruppi: Set<string> } {
  return {
    archi: new Set(ist.edges_taken.map((a) => `${a.from}|${a.outcome ?? ""}|${a.to}`)),
    gruppi: new Set(ist.edges_taken.map((a) => `${a.from}|${a.outcome ?? ""}`)),
  };
}

/**
 * Errori dell'API resi leggibili per chi disegna. Quando un nodo è incompleto (es. ruolo non scelto) il motore
 * lo scarta e segnala anche gli archi "verso un nodo inesistente" e i nodi "non raggiungibili" che ne derivano:
 * se l'errore vero del nodo c'è, quelli a cascata si nascondono. I messaggi tecnici di validazione sugli
 * assegnatari diventano una frase in italiano.
 */
export function erroriLeggibili(def: Definizione, errori: ErroreGrafo[]): ErroreGrafo[] {
  const ids = new Set(def.nodes.map((n) => n.id));
  const nome = (id?: string | null) => def.nodes.find((n) => n.id === id)?.name ?? id ?? "";
  const nodiIncompleti = new Set(errori.filter((e) => e.node && /^(assignees|recipients|outcomes)\.\d+/.test(e.message)).map((e) => e.node!));
  return errori.flatMap((e): ErroreGrafo[] => {
    const cascata = /nodo inesistente \((.+) → (.+)\)/.exec(e.message);
    if (cascata && ids.has(cascata[1]) && ids.has(cascata[2]) && nodiIncompleti.size) return [];
    if (/non raggiungibile/i.test(e.message) && nodiIncompleti.size) return [];
    const ass = /^(assignees|recipients)\.(\d+)\.(code|id)/.exec(e.message);
    if (ass) {
      const chi = ass[1] === "assignees" ? "dell'assegnatario" : "del destinatario";
      const cosa = ass[3] === "code" ? "scegli il ruolo" : "scegli la persona";
      return [{ ...e, message: `«${nome(e.node)}»: ${cosa} ${chi} ${Number(ass[2]) + 1}` }];
    }
    return [e];
  });
}
