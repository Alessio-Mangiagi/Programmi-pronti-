# "><(((º> sabusabu <º)))><"
"""Modello di processo "RdA → gara → affidamento" (workflow a grafo, ADR-48) e caricamento in un progetto.

Riproduce lo schema che l'utente usa oggi in un altro strumento (immagine del 03/11/2026): RdA con tutti i
buyer → approvazione del PM → scelta della procedura → selezione imprese e offerte per ogni buyer in parallelo →
riunione in "Offerte ricevute e redazione QdR" → autorizzazioni in parallelo → notifica → affidamento concluso;
ogni "Respinto" porta alla conformità (filigrana RIFIUTATO sulla RdA) e poi a "Fallito", ogni "Annullato" a
"Fallito". Le caselle sono disposte a colonne da sinistra a destra come nell'immagine.

Gli assegnatari sono il ruolo PROJECT_ADMIN con quorum ANY: le persone stanno nei nomi dei nodi e si
riassegnano dall'editor. Lo usano:
- ``cde workflow-rda --progetto GALFOR [--rimuovi]`` (modello completo, 7 buyer e 5 autorizzazioni, più un
  processo di prova portato fino alla fase dei buyer);
- la demo ``tooling/demo_commesse.py`` (versione ridotta sulla commessa 101-003).
Tutto passa dall'API come un utente qualunque; rilanciarlo non duplica nulla.
"""
from __future__ import annotations

import json
import re
import sys

CODICE = "RDA_GARA_AFFIDAMENTO"
NOME = "RdA → gara → affidamento"
BUYER = ["Capizzi", "Di Paola", "Strano", "Marletta", "Gallucci", "Buyer Junior 1", "Buyer Junior 2"]
AUTORIZZAZIONI = ["DC", "FM", "DT", "DO", "AD"]
PROVA = "[PROVA] RdA – Galleria Fortolese"

IN_VALUTAZIONE = {"code": "IN_VALUTAZIONE", "label": "In valutazione", "color": "yellow"}
IN_GARA = {"code": "IN_GARA", "label": "In gara", "color": "yellow"}
RESPINTO = {"code": "RESPINTO", "label": "Respinto", "color": "red"}
ANNULLATO = {"code": "ANNULLATO", "label": "Annullato", "color": "red"}
AFFIDATO = {"code": "AFFIDATO", "label": "Affidato", "color": "green"}
PA = [{"type": "role", "code": "PROJECT_ADMIN"}]


def slug(testo: str) -> str:
    """Nome → parte di un id di nodo (minuscole, cifre, trattino basso)."""
    return re.sub(r"[^a-z0-9]+", "_", testo.lower()).strip("_")


def definizione(buyer: list[str] | None = None, autorizzazioni: list[str] | None = None) -> dict:
    """La definizione versione 2 del processo, con le caselle a colonne come nell'immagine.

    Colonne: 0 avvio, 1 PM, 2 scelta procedura, 3 selezioni dei buyer, 4 offerte dei buyer, 5 redazione QdR,
    6 autorizzazioni, 7 notifica, 8 stati finali. Buyer sulle righe 0..n-1, autorizzazioni una riga sì e una
    no, PM/scelta/QdR sulla riga di mezzo dei buyer, conformità e "Fallito" sull'ultima riga in basso."""
    buyer = buyer or BUYER
    autorizzazioni = autorizzazioni or AUTORIZZAZIONI
    mezzo = (len(buyer) - 1) // 2
    fondo = max(len(buyer) - 1, 2 * (len(autorizzazioni) - 1)) + 1

    def nodo(nid, tipo, nome, col, row, **kw):
        return {"id": nid, "type": tipo, "name": nome, "cell": {"col": col, "row": row}, **kw}

    def decisione(nid, nome, col, row, esiti, **kw):
        return nodo(nid, "decision", nome, col, row, assignees=PA, quorum="ANY", outcomes=esiti, **kw)

    nodes = [nodo("rda", "start", "RdA con tutti i Buyer", 0, 0),
             decisione("approvazione_pm", "Approvazione RdA (PM)", 1, mezzo, [IN_VALUTAZIONE, RESPINTO]),
             decisione("scelta_procedura", "Scelta procedura affidamento (ACQ)", 2, mezzo, [IN_GARA, RESPINTO])]
    edges = [{"from": "rda", "to": "approvazione_pm"},
             {"from": "approvazione_pm", "outcome": "IN_VALUTAZIONE", "to": "scelta_procedura"},
             {"from": "approvazione_pm", "outcome": "RESPINTO", "to": "conformita"},
             {"from": "scelta_procedura", "outcome": "RESPINTO", "to": "conformita"}]
    for row, b in enumerate(buyer):
        sel, off = f"sel_{slug(b)}", f"off_{slug(b)}"
        nodes += [decisione(sel, f"Selezione imprese e inoltro delle RDO (AUA) - {b}", 3, row, [IN_GARA, RESPINTO]),
                  decisione(off, f"Offerte ricevute e redazione QdR (AUA) - {b}", 4, row, [IN_GARA, RESPINTO])]
        edges += [{"from": "scelta_procedura", "outcome": "IN_GARA", "to": sel},
                  {"from": sel, "outcome": "IN_GARA", "to": off}, {"from": sel, "outcome": "RESPINTO", "to": "conformita"},
                  {"from": off, "outcome": "IN_GARA", "to": "qdr"}, {"from": off, "outcome": "RESPINTO", "to": "conformita"}]
    nodes.append(decisione("qdr", "Offerte ricevute e redazione QdR", 5, mezzo, [IN_GARA, ANNULLATO], join="ALL"))
    edges.append({"from": "qdr", "outcome": "ANNULLATO", "to": "fallito"})
    for i, a in enumerate(autorizzazioni):
        aut = f"aut_{slug(a)}"
        nodes.append(decisione(aut, f"Autorizzazione {a}", 6, 2 * i, [AFFIDATO, ANNULLATO]))
        edges += [{"from": "qdr", "outcome": "IN_GARA", "to": aut},
                  {"from": aut, "outcome": "AFFIDATO", "to": "notifica"}, {"from": aut, "outcome": "ANNULLATO", "to": "fallito"}]
    nodes += [nodo("notifica", "notification", "Notifica affidamento", 7, 0, join="ALL", recipients=PA,
                   message="Affidamento concluso per {titolo}"),
              nodo("concluso", "end", "Affidamento concluso", 8, 0, result="OK"),
              nodo("conformita", "activity", "Conformità – Inserimento filigrana RIFIUTATO su RdA", 4, fondo,
                   assignees=PA, quorum="ANY", join="ANY",
                   outcomes=[{"code": "FATTO", "label": "Fatto", "color": "green"}]),
              nodo("fallito", "end", "Fallito", 8, fondo, result="KO", join="ANY")]
    edges += [{"from": "notifica", "to": "concluso"}, {"from": "conformita", "outcome": "FATTO", "to": "fallito"}]
    return {"version": 2, "subject": "PROCESS", "nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------------------------- caricamento
def _uguale(a: dict, b: dict) -> bool:
    """Stessa forma del grafo (nodi ed archi), a prescindere dall'ordine di chiavi, nodi e archi."""
    def chiave(d):
        return (sorted(json.dumps(n, sort_keys=True) for n in d["nodes"]),
                sorted(json.dumps(e, sort_keys=True) for e in d["edges"]))
    return chiave(a) == chiave(b)


def modello(ld, utente: str, pid: str, definizione_: dict, codice: str = CODICE, nome: str = NOME) -> dict | None:
    """Il modello attivo col codice dato; se manca o è diverso ne salva una nuova versione."""
    tpls = ld.call(utente, "GET", f"/projects/{pid}/workflow-templates?subject=PROCESS") or []
    attuale = next((t for t in tpls if t["code"] == codice and t.get("is_active")), None)
    if attuale and _uguale(attuale["definition"], definizione_):
        return attuale
    return ld.call(utente, "POST", f"/projects/{pid}/workflow-templates",
                   json={"code": codice, "name": nome, "subject": "PROCESS", "definition": definizione_})


def compito(ld, utente: str, iid: str, node_id: str) -> dict | None:
    return next((t for t in ld.call(utente, "GET", "/me/tasks?status=OPEN") or []
                 if t.get("instance_id") == iid and t.get("node_id") == node_id), None)


def avanza(ld, utente: str, iid: str, passi: list[tuple[str, str, str | None]]) -> None:
    """Completa in ordine i compiti (nodo, esito, commento) dell'utente; si ferma al primo che non trova."""
    for node_id, esito, commento in passi:
        t = compito(ld, utente, iid, node_id)
        if not t:
            ld.log.append(f"processo {iid}: nessun compito aperto su {node_id} per {utente}")
            return
        ld.call(utente, "POST", f"/tasks/{t['id']}/complete", json={"outcome": esito, "comment": commento})


def processo(ld, utente: str, pid: str, tpl: dict, titolo: str, descrizione: str,
             passi: list[tuple[str, str, str | None]]) -> dict | None:
    """Il processo in corso con quel titolo; se non c'è lo avvia e lo porta avanti con ``passi``."""
    for p in ld.call(utente, "GET", f"/projects/{pid}/processes?status=RUNNING") or []:
        if p["title"] == titolo:
            return p
    g = ld.call(utente, "POST", f"/projects/{pid}/processes",
                json={"template_id": tpl["id"], "title": titolo, "description": descrizione})
    if g:
        avanza(ld, utente, g["id"], passi)
    return g


def progetto(ld, utente: str, codice: str) -> dict:
    progetti = ld.call(utente, "GET", "/projects") or []
    progetti = progetti.get("items", progetti) if isinstance(progetti, dict) else progetti
    trovato = next((p for p in progetti if p["code"] == codice or str(p["id"]) == codice), None)
    if trovato is None:
        raise SystemExit(f"Progetto {codice} non trovato (o non visibile a {utente})")
    return trovato


def carica(api: str, password: str, codice_progetto: str, rimuovi: bool = False, utente: str = "com_admin") -> dict:
    """Modello completo (7 buyer, 5 autorizzazioni) e processo di prova nel progetto; con ``rimuovi`` li toglie."""
    from .demo_content import Loader

    ld = Loader(api, password)
    p = progetto(ld, utente, codice_progetto)
    pid = str(p["id"])
    if rimuovi:
        for x in ld.call(utente, "GET", f"/projects/{pid}/processes?status=RUNNING") or []:
            if x["title"] == PROVA:
                ld.call(utente, "POST", f"/workflow-instances/{x['id']}/cancel", json={"reason": "Processo di prova rimosso"})
                print(f"processo di prova {x['id']} annullato")
        for t in ld.call(utente, "GET", f"/projects/{pid}/workflow-templates?subject=PROCESS") or []:
            if t["code"] == CODICE and t.get("is_active"):
                ld.call(utente, "PATCH", f"/workflow-templates/{t['id']}", json={"is_active": False})
                print(f"modello {t['id']} disattivato")
        return {"progetto": pid}
    tpl = modello(ld, utente, pid, definizione())
    if not tpl:
        raise SystemExit("Modello non salvato: " + "; ".join(ld.log))
    g = processo(ld, utente, pid, tpl, PROVA,
                 "Processo di prova per vedere lo schema RdA → gara → affidamento nella vista finale. "
                 "Si toglie con: cde workflow-rda --progetto " + codice_progetto + " --rimuovi",
                 [("approvazione_pm", "IN_VALUTAZIONE", "RdA completa, si procede alla scelta della procedura."),
                  ("scelta_procedura", "IN_GARA", "Gara a inviti con tutti i buyer.")])
    nodi = len(tpl["definition"]["nodes"])
    print(f"{p['code']} ({p['name']}): modello {tpl['id']} v{tpl['version']} ({nodi} nodi), "
          f"processo di prova {g['id'] if g else '—'}")
    for riga in ld.log:
        print("  nota:", riga)
    return {"progetto": pid, "modello": tpl["id"], "versione": tpl["version"], "nodi": nodi,
            "processo": g["id"] if g else None}


def main(argv=None) -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Modello di processo RdA → gara → affidamento in un progetto")
    ap.add_argument("--progetto", required=True, help="codice (es. GALFOR) o id del progetto")
    ap.add_argument("--api", default="http://127.0.0.1:8100")
    ap.add_argument("--password", default="Cantiere-2026!", help="password dell'utente che carica (com_admin)")
    ap.add_argument("--rimuovi", action="store_true", help="annulla il processo di prova e disattiva il modello")
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(errors="replace")
    carica(args.api, args.password, args.progetto, args.rimuovi)


if __name__ == "__main__":
    main()
