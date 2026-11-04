# "><(((º> sabusabu <º)))><"
"""Definizione dei workflow a grafo (versione 2): modelli, conversione dalla versione 1, validazione.

Il contratto è in ``docs/workflow-grafo.md`` (ADR-48). Qui sta tutto ciò che si può controllare senza
database: la forma di nodi ed archi e le regole del grafo (un solo avvio, ogni nodo raggiungibile, da ogni
nodo si arriva a uno stato finale, ogni esito con almeno un arco...). Gli errori sono elenchi
``[{node, edge, message}]`` in italiano, così l'editor li evidenzia sul nodo o sull'arco giusto.
Il motore che esegue il grafo è nel database (migrazione 0039): la conversione dalla versione 1 qui e in
``cde.wf_convert_v1`` deve restare identica.
"""
from __future__ import annotations

import re
import uuid
from collections import deque
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

NODE_ID = r"^[a-z][a-z0-9_]{0,39}$"
OUTCOME_CODE = r"^[A-Z][A-Z0-9_]{1,30}$"
MAX_NODES, MAX_EDGES, MAX_ROUNDS = 60, 200, 20
DEFAULT_ACTIVITY_OUTCOMES = [{"code": "FATTO", "label": "Fatto", "color": "green"}]
V1_OUTCOMES = [{"code": "APPROVED", "label": "Approvato", "color": "green"},
               {"code": "APPROVED_WITH_COMMENTS", "label": "Approvato con commenti", "color": "green"},
               {"code": "REJECTED", "label": "Rifiutato", "color": "red"}]


class GraphInvalid(Exception):
    """Definizione non valida: ``errors`` è l'elenco per l'editor."""

    def __init__(self, errors: list[dict]):
        super().__init__("; ".join(e["message"] for e in errors[:5]))
        self.errors = errors


def err(message: str, node: str | None = None, edge: int | None = None) -> dict:
    return {"node": node, "edge": edge, "message": message}


# ---------------------------------------------------------------------
# Modelli
# ---------------------------------------------------------------------
class Assignee(BaseModel):
    """Chi riceve il compito (o la notifica): utente, ruolo nel progetto, ruolo nell'organizzazione autrice."""
    model_config = ConfigDict(extra="forbid")
    type: Literal["user", "role", "originator_role"]
    id: uuid.UUID | None = None                    # type = user
    code: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{1,40}$")   # role / originator_role
    organization_id: uuid.UUID | None = None       # role: limita a un'organizzazione

    @model_validator(mode="before")
    @classmethod
    def _alias(cls, data: Any):
        # nell'esempio del contratto compariva "user_id": lo si accetta come sinonimo di "id"
        if isinstance(data, dict) and "user_id" in data and "id" not in data:
            data = {**{k: v for k, v in data.items() if k != "user_id"}, "id": data["user_id"]}
        return data

    @model_validator(mode="after")
    def _shape(self):
        if self.type == "user" and not self.id:
            raise ValueError("Assegnatario utente: indicare id")
        if self.type != "user" and not self.code:
            raise ValueError("Assegnatario per ruolo: indicare code")
        return self


class QuorumN(BaseModel):
    n: int = Field(ge=1, le=50)


class Outcome(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(pattern=OUTCOME_CODE)
    label: str = Field(min_length=1, max_length=40)
    color: Literal["green", "yellow", "red"]


class Cell(BaseModel):
    model_config = ConfigDict(extra="forbid")
    col: int = Field(ge=0, le=39)
    row: int = Field(ge=0, le=39)


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=NODE_ID)
    type: Literal["start", "decision", "activity", "notification", "end"]
    name: str = Field(min_length=2, max_length=100)
    cell: Cell
    join: Literal["ANY", "ALL"] | None = None
    # decision / activity
    assignees: list[Assignee] | None = Field(default=None, max_length=20)
    quorum: Literal["ALL", "ANY"] | QuorumN | None = None
    sla_hours: int | None = Field(default=None, ge=1, le=24 * 90)
    outcomes: list[Outcome] | None = Field(default=None, max_length=8)
    # notification
    recipients: list[Assignee] | None = Field(default=None, max_length=20)
    message: str | None = Field(default=None, max_length=1000)
    # end
    result: Literal["OK", "KO"] | None = None

    @model_validator(mode="after")
    def _by_type(self):
        if self.type in ("decision", "activity"):
            if not self.assignees:
                raise ValueError("indicare almeno un assegnatario")
            if self.type == "decision" and not self.outcomes:
                raise ValueError("una decisione ha almeno un esito")
        elif self.assignees or self.outcomes or self.quorum or self.sla_hours:
            raise ValueError("assegnatari, esiti, quorum e scadenza valgono solo per decisioni e attività")
        if self.type == "notification" and not self.recipients:
            raise ValueError("indicare almeno un destinatario della notifica")
        if self.type != "notification" and (self.recipients or self.message):
            raise ValueError("destinatari e messaggio valgono solo per le notifiche")
        if self.type == "end" and not self.result:
            raise ValueError("uno stato finale ha result OK o KO")
        if self.type != "end" and self.result:
            raise ValueError("result vale solo per gli stati finali")
        return self

    def outcome_list(self) -> list[dict]:
        if self.outcomes:
            return [o.model_dump() for o in self.outcomes]
        return list(DEFAULT_ACTIVITY_OUTCOMES) if self.type == "activity" else []


class Edge(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    from_: str = Field(alias="from", pattern=NODE_ID)
    to: str = Field(pattern=NODE_ID)
    outcome: str | None = Field(default=None, pattern=OUTCOME_CODE)


class OnCompleted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    to_state: Literal["SHARED", "PUBLISHED"]
    suitability: str = Field(pattern=r"^(S[1-4]|A\d|B\d|CR)$")


# ---------------------------------------------------------------------
# Versione 1 → versione 2 (identica a cde.wf_convert_v1 della migrazione 0039)
# ---------------------------------------------------------------------
def convert_v1(definition: dict) -> dict:
    """Lista di passi in fila → grafo: avvio, un nodo decision per passo, stati finali Approvato/Rifiutato."""
    steps = definition["steps"]
    n = len(steps)
    nodes: list[dict] = [{"id": "inizio", "type": "start", "name": "Avvio", "cell": {"col": 0, "row": 0}}]
    edges: list[dict] = [{"from": "inizio", "to": "passo_1"}]
    for i, step in enumerate(steps, start=1):
        node = {"id": f"passo_{i}", "type": "decision", "name": step["name"], "assignees": step["assignees"],
                "quorum": step.get("quorum") or "ALL", "outcomes": [dict(o) for o in V1_OUTCOMES],
                "cell": {"col": i, "row": 0}}
        if step.get("sla_hours") is not None:
            node["sla_hours"] = step["sla_hours"]
        nodes.append(node)
        nxt = f"passo_{i + 1}" if i < n else "approvato"
        edges += [{"from": f"passo_{i}", "outcome": "APPROVED", "to": nxt},
                  {"from": f"passo_{i}", "outcome": "APPROVED_WITH_COMMENTS", "to": nxt},
                  {"from": f"passo_{i}", "outcome": "REJECTED", "to": "rifiutato"}]
    nodes += [{"id": "approvato", "type": "end", "name": "Approvato", "result": "OK", "cell": {"col": n + 1, "row": 0}},
              {"id": "rifiutato", "type": "end", "name": "Rifiutato", "result": "KO", "cell": {"col": n + 1, "row": 1}}]
    out: dict = {"version": 2, "subject": "DOCUMENT", "nodes": nodes, "edges": edges}
    if definition.get("on_approved"):
        out["on_completed"] = definition["on_approved"]
    if definition.get("escalation_user_id"):
        out["escalation_user_id"] = str(definition["escalation_user_id"])
    return out


def _v1(definition: dict) -> dict:
    """Valida una definizione versione 1 con i vincoli di prima (1–20 passi) prima di convertirla."""
    from .workflows import DefinitionV1  # import locale: evita il ciclo fra i due moduli

    try:
        return DefinitionV1.model_validate(definition).model_dump(mode="json", exclude_none=True)
    except ValidationError as exc:
        raise GraphInvalid([err(_pyd_message(e)) for e in exc.errors()]) from None


def _pyd_message(e: dict) -> str:
    loc = ".".join(str(x) for x in e.get("loc", ()) if x != "__root__")
    msg = str(e.get("msg", "valore non valido")).removeprefix("Value error, ")
    return f"{loc}: {msg}" if loc else msg


def _node_message(raw: Any, e: dict) -> str:
    """Errore di Pydantic su un nodo detto come lo direbbe chi disegna: «Nome»: cosa manca.

    Prima arrivava il messaggio tecnico ("assignees.0.code: String should match pattern…") e l'editor lo
    traduceva; ora la frase giusta parte già dall'API (ADR-50), riferita al nodo."""
    name = raw.get("name") if isinstance(raw, dict) else None
    label = f"«{name}»" if isinstance(name, str) and name.strip() else f"Il nodo {raw.get('id') if isinstance(raw, dict) else ''}".strip()
    loc = [x for x in e.get("loc", ()) if x != "__root__"]
    msg = str(e.get("msg", "valore non valido")).removeprefix("Value error, ")
    if loc and loc[0] in ("assignees", "recipients") and len(loc) >= 2 and isinstance(loc[1], int):
        chi = "dell'assegnatario" if loc[0] == "assignees" else "del destinatario"
        numero = f" n. {loc[1] + 1}" if loc[1] else ""
        campo = loc[2] if len(loc) > 2 else ("code" if "indicare code" in msg else "id" if "indicare id" in msg else None)
        if campo == "code":
            return f"{label}: scegliere il ruolo {chi}{numero}"
        if campo == "id":
            return f"{label}: scegliere la persona {chi}{numero}"
        return f"{label}: {'assegnatario' if loc[0] == 'assignees' else 'destinatario'}{numero} non valido ({msg})"
    if loc and loc[0] == "outcomes" and len(loc) >= 3 and isinstance(loc[1], int):
        cosa = {"label": "manca l'etichetta", "code": "codice non valido", "color": "colore non valido"}.get(str(loc[2]), msg)
        return f"{label}: esito n. {loc[1] + 1}, {cosa}"
    if loc == ["name"]:
        return f"{label}: il nome va da 2 a 100 caratteri"
    if not loc:
        return f"{label}: {msg}"
    return f"{label}: {'.'.join(str(x) for x in loc)}: {msg}"


def _placeholder(raw: Any) -> Node | None:
    """Segnaposto per un nodo che non ha passato la validazione (es. ruolo non scelto).

    Senza, il nodo sparirebbe dal grafo e porterebbe con sé errori a cascata ("arco verso un nodo inesistente",
    "nodo non raggiungibile") che nascondono quello vero. Il segnaposto tiene id, tipo, casella ed esiti validi,
    così gli archi e la raggiungibilità si controllano lo stesso; non finisce mai in una definizione salvata
    (c'è già un errore)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not re.match(NODE_ID, raw["id"]):
        return None
    if raw.get("type") not in ("start", "decision", "activity", "notification", "end"):
        return None
    try:
        cell = Cell.model_validate(raw.get("cell"))
    except ValidationError:
        cell = Cell.model_construct(col=-1, row=-1)   # fuori griglia: nessun conflitto di casella
    outcomes = []
    for o in raw.get("outcomes") or []:
        try:
            outcomes.append(Outcome.model_validate(o))
        except ValidationError:
            if isinstance(o, dict) and isinstance(o.get("code"), str) and re.match(OUTCOME_CODE, o["code"]):
                outcomes.append(Outcome.model_construct(code=o["code"], label=str(o.get("label") or o["code"]),
                                                        color=o.get("color") or "green"))
    return Node.model_construct(id=raw["id"], type=raw["type"], name=str(raw.get("name") or raw["id"]), cell=cell,
                                join=raw.get("join") if raw.get("join") in ("ANY", "ALL") else None,
                                outcomes=outcomes or None, assignees=None, recipients=None, quorum=None,
                                sla_hours=None, message=None, result=raw.get("result"))


def library_errors(nodes: list[Node], escalation_user_id: Any = None) -> list[dict]:
    """Regole dei modelli della libreria dell'organizzazione (ADR-50): assegnatari e destinatari solo per ruolo.

    Le persone cambiano da commessa a commessa: un modello di libreria dice "il Project Admin", "il Lead
    Designer", mai "Mario Rossi"; e un ruolo non si limita a un'organizzazione, che in un'altra commessa
    potrebbe non partecipare. Niente escalation verso una persona: se un compito scade sono avvisati i Project
    Admin della commessa e chi ha avviato."""
    errors: list[dict] = []
    for n in nodes:
        for key, chi in (("assignees", "gli assegnatari"), ("recipients", "i destinatari")):
            values = getattr(n, key) or []
            if any(a.type == "user" for a in values):
                errors.append(err(f"«{n.name}»: nella libreria {chi} si indicano per ruolo, non per persona", node=n.id))
            if any(a.type != "user" and a.organization_id for a in values):
                errors.append(err(f"«{n.name}»: nella libreria un ruolo non può essere limitato a un'organizzazione",
                                  node=n.id))
    if escalation_user_id:
        errors.append(err("Nella libreria niente escalation verso una persona: se un compito scade sono avvisati "
                          "i Project Admin della commessa"))
    return errors


# ---------------------------------------------------------------------
# Validazione
# ---------------------------------------------------------------------
def normalize(definition: dict, subject: str | None = None, library: bool = False) -> dict:
    """La definizione in versione 2, validata e ripulita; ``GraphInvalid`` con l'elenco degli errori.

    Accetta anche la versione 1 (``steps``), che converte. ``subject`` (se dato) prevale su quello nel JSON.
    ``library``: modello della libreria dell'organizzazione, con in più le regole di ``library_errors``."""
    if not isinstance(definition, dict):
        raise GraphInvalid([err("La definizione deve essere un oggetto JSON")])
    if "steps" in definition and "nodes" not in definition:
        definition = convert_v1(_v1(definition))
    errors: list[dict] = []
    top_extra = set(definition) - {"version", "subject", "nodes", "edges", "on_completed", "escalation_user_id"}
    if top_extra:
        errors.append(err(f"Campi non previsti: {', '.join(sorted(top_extra))}"))
    if definition.get("version", 2) != 2:
        errors.append(err("version deve essere 2"))
    subj = subject or definition.get("subject") or "DOCUMENT"
    if subj not in ("DOCUMENT", "PROCESS"):
        errors.append(err("subject: DOCUMENT o PROCESS"))
    raw_nodes, raw_edges = definition.get("nodes"), definition.get("edges")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise GraphInvalid(errors + [err("nodes ed edges devono essere elenchi")])
    if len(raw_nodes) > MAX_NODES:
        errors.append(err(f"Al massimo {MAX_NODES} nodi"))
    if len(raw_edges) > MAX_EDGES:
        errors.append(err(f"Al massimo {MAX_EDGES} archi"))

    nodes: dict[str, Node] = {}
    cells: dict[tuple[int, int], str] = {}
    valid: list[Node] = []          # nodi passati dalla validazione (per le regole della libreria)
    for raw in raw_nodes:
        nid = raw.get("id") if isinstance(raw, dict) else None
        try:
            node = Node.model_validate(raw)
            valid.append(node)
        except ValidationError as exc:
            msgs = list(dict.fromkeys(_node_message(raw, e) for e in exc.errors()))   # senza doppioni
            errors += [err(m, node=nid) for m in msgs]
            node = _placeholder(raw)   # resta nel grafo: niente errori a cascata su archi e raggiungibilità
            if node is None:
                continue
        if node.id in nodes:
            errors.append(err(f"Id «{node.id}» ripetuto", node=node.id))
            continue
        cell = (node.cell.col, node.cell.row)
        if cell in cells and cell != (-1, -1):
            errors.append(err(f"Casella {cell[0]},{cell[1]} già occupata da «{cells[cell]}»", node=node.id))
        cells[cell] = node.id
        codes = [o["code"] for o in node.outcome_list()]
        if len(codes) != len(set(codes)):
            errors.append(err("Codici di esito ripetuti", node=node.id))
        nodes[node.id] = node

    edges: list[Edge] = []
    for i, raw in enumerate(raw_edges):
        try:
            e = Edge.model_validate(raw)
        except ValidationError as exc:
            errors += [err(_pyd_message(x), edge=i) for x in exc.errors()]
            continue
        edges.append(e)
        src, dst = nodes.get(e.from_), nodes.get(e.to)
        if src is None or dst is None:
            errors.append(err(f"Arco verso o da un nodo inesistente ({e.from_} → {e.to})", edge=i))
            continue
        if dst.type == "start":
            errors.append(err("Nessun arco può entrare nel nodo di avvio", node=dst.id, edge=i))
        if src.type == "end":
            errors.append(err("Nessun arco esce da uno stato finale", node=src.id, edge=i))
        if src.type in ("start", "notification") and e.outcome:
            errors.append(err("Gli archi da avvio e notifica non hanno esito", node=src.id, edge=i))
        if src.type in ("decision", "activity"):
            if not e.outcome:
                errors.append(err("Ogni arco da una decisione o attività parte da un esito", node=src.id, edge=i))
            elif e.outcome not in {o["code"] for o in src.outcome_list()}:
                errors.append(err(f"Esito «{e.outcome}» non previsto dal nodo", node=src.id, edge=i))
    if len({(e.from_, e.outcome, e.to) for e in edges}) != len(edges):
        errors.append(err("Archi ripetuti"))

    starts = [n for n in nodes.values() if n.type == "start"]
    if len(starts) != 1:
        errors.append(err("Serve esattamente un nodo di avvio"))
    if not any(n.type == "end" for n in nodes.values()):
        errors.append(err("Serve almeno uno stato finale"))
    for n in nodes.values():
        if n.type in ("decision", "activity"):
            for o in n.outcome_list():
                if not any(e.from_ == n.id and e.outcome == o["code"] for e in edges):
                    errors.append(err(f"L'esito «{o['label']}» non porta da nessuna parte", node=n.id))
        if n.type in ("start", "notification") and not any(e.from_ == n.id for e in edges):
            errors.append(err("Manca l'arco in uscita", node=n.id))

    # raggiungibilità: dall'avvio a ogni nodo, e da ogni nodo a uno stato finale
    out_adj: dict[str, set[str]] = {k: set() for k in nodes}
    in_adj: dict[str, set[str]] = {k: set() for k in nodes}
    for e in edges:
        if e.from_ in nodes and e.to in nodes:
            out_adj[e.from_].add(e.to)
            in_adj[e.to].add(e.from_)
    if len(starts) == 1:
        seen = _bfs(starts[0].id, out_adj)
        for nid in nodes:
            if nid not in seen:
                errors.append(err("Nodo non raggiungibile dall'avvio", node=nid))
    ends = [k for k, n in nodes.items() if n.type == "end"]
    if ends:
        back: set[str] = set()
        for e_id in ends:
            back |= _bfs(e_id, in_adj)
        for nid in nodes:
            if nid not in back:
                errors.append(err("Da questo nodo non si arriva a nessuno stato finale", node=nid))

    on_completed = definition.get("on_completed")
    if on_completed is not None:
        if subj != "DOCUMENT":
            errors.append(err("on_completed vale solo per i workflow sui documenti"))
        else:
            try:
                on_completed = OnCompleted.model_validate(on_completed).model_dump()
            except ValidationError as exc:
                errors += [err("on_completed: " + _pyd_message(x)) for x in exc.errors()]
    esc = definition.get("escalation_user_id")
    if esc is not None:
        try:
            esc = str(uuid.UUID(str(esc)))
        except ValueError:
            errors.append(err("escalation_user_id non valido"))
    if library:
        errors += library_errors(valid, esc)

    if errors:
        raise GraphInvalid(errors)
    out: dict = {"version": 2, "subject": subj,
                 "nodes": [n.model_dump(mode="json", exclude_none=True) for n in nodes.values()],
                 "edges": [e.model_dump(mode="json", by_alias=True, exclude_none=True) for e in edges]}
    if on_completed:
        out["on_completed"] = on_completed
    if esc:
        out["escalation_user_id"] = esc
    return out


def _bfs(start: str, adj: dict[str, set[str]]) -> set[str]:
    seen, q = {start}, deque([start])
    while q:
        for nxt in adj.get(q.popleft(), ()):
            if nxt not in seen:
                seen.add(nxt)
                q.append(nxt)
    return seen


def node_of(definition: dict, node_id: str) -> dict | None:
    return next((n for n in definition.get("nodes", []) if n.get("id") == node_id), None)


def outcomes_of(node: dict | None) -> list[dict]:
    """Esiti di un nodo, col "Fatto" predefinito per le attività senza esiti dichiarati (come cde.wf_outcomes)."""
    if not node:
        return []
    if node.get("outcomes"):
        return node["outcomes"]
    return list(DEFAULT_ACTIVITY_OUTCOMES) if node.get("type") == "activity" else []


def task_nodes(definition: dict) -> list[dict]:
    """Nodi con compiti (decisioni e attività), nell'ordine della griglia: colonna, poi riga."""
    return sorted((n for n in definition.get("nodes", []) if n.get("type") in ("decision", "activity")),
                  key=lambda n: (n["cell"]["col"], n["cell"]["row"]))
