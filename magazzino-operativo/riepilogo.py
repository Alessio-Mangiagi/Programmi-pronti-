# "><(((º> sabusabu <º)))><"
"""Riepilogo giornaliero dei movimenti di magazzino, caricato in SkyTower nella commessa.

Decisione del 09/11/2026 (programma unico "DDT e Magazzino"): in SkyTower va "tutto" — il PDF
del DDT e l'Excel della conversione li manda il Lettore DDT, il Magazzino aggiunge per ogni
commessa che ha avuto movimenti nel giorno un riepilogo in due documenti WIP:
  * PDF  con i movimenti del giorno (ora, tipo, articolo, quantità, da → a, DDT di provenienza,
         fornitore, chi) e le giacenze del cantiere a fine giornata;
  * Excel con le stesse due tabelle, per chi vuole filtrarle o sommarle.

Quando parte:
  * in automatico, una volta al giorno dopo MAGAZZINO_RIEPILOGO_ORA (default 19:00; vuoto, "off"
    o "0" = spento). Il thread controlla ogni 5 minuti: se SkyTower è spenta riprova al giro dopo,
    senza segnare errori. Al riavvio del server si recupera anche il giorno prima, se non era partito;
  * a richiesta, dal pulsante della pagina (amministratore, o chi lavora in quella commessa nel
    programma unico): POST /api/riepiloghi/invia in suite_rotte.py.

Niente doppioni: SkyTower dalla suite crea sempre un documento nuovo (non ha una rotta "nuova
revisione"), quindi ogni invio si segna nella tabella `riepiloghi` con l'impronta (hash di
movimenti e giacenze). Stessa impronta già inviata per quel giorno = si salta; impronta cambiata
(movimenti arrivati dopo) = un documento in più con "(aggiornamento hh:mm)" nel titolo. Un PDF
già caricato non si rimanda se all'invio precedente era mancato solo l'Excel.
Un errore "definitivo" di SkyTower (commessa senza progetto, nome non componibile: 4xx) non si
ritenta in automatico finché i movimenti non cambiano; uno "temporaneo" (503, rete) sì.
"""
import hashlib
import json
import logging
import re
import threading
import time
import urllib.parse
from datetime import date, datetime, timedelta

import config
import pdf_semplice
import xlsx_semplice

log = logging.getLogger("magazzino.riepilogo")

_lock = threading.Lock()          # un invio alla volta (thread automatico e pulsante insieme)


# --------------------------------------------------------------------------- impostazioni

def ora_automatica():
    """(ore, minuti) di MAGAZZINO_RIEPILOGO_ORA, o None se il riepilogo automatico è spento."""
    v = (config.RIEPILOGO_ORA or "").strip().lower()
    if v in ("", "off", "0", "no", "spento"):
        return None
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?$", v)
    if not m or int(m.group(1)) > 23 or int(m.group(2) or 0) > 59:
        log.warning("MAGAZZINO_RIEPILOGO_ORA=%r non valida (formato HH:MM): riepilogo automatico spento", v)
        return None
    return int(m.group(1)), int(m.group(2) or 0)


def _normalizza(codice):
    return re.sub(r"\s+", "", str(codice or "")).upper()


# --------------------------------------------------------------------------- dati

def commesse_del_giorno(conn, giorno):
    """Codici commessa (come scritti sull'ubicazione) con almeno un movimento registrato nel giorno.

    Il giorno è quello di registrazione (ts, ora locale), non la data del DDT: il riepilogo dice
    cosa è successo in magazzino quel giorno. Commesse uguali a meno di spazi/maiuscole sono una."""
    viste = {}
    for r in conn.execute(
            "SELECT DISTINCT u.commessa FROM movimenti m JOIN ubicazioni u "
            "ON u.id IN (m.a_ubicazione_id, m.da_ubicazione_id) "
            "WHERE date(m.ts, 'localtime') = ? AND u.commessa IS NOT NULL AND trim(u.commessa) <> '' "
            "ORDER BY u.commessa", (giorno,)):
        viste.setdefault(_normalizza(r["commessa"]), r["commessa"].strip())
    return list(viste.values())


def dati(conn, commessa, giorno):
    """Movimenti del giorno e giacenze attuali delle ubicazioni della commessa, più l'impronta."""
    chiave = _normalizza(commessa)
    ubi = [dict(r) for r in conn.execute("SELECT id, codice, nome, commessa FROM ubicazioni "
                                         "WHERE commessa IS NOT NULL AND trim(commessa) <> '' ORDER BY nome")
           if _normalizza(r["commessa"]) == chiave]
    ids = [u["id"] for u in ubi]
    movimenti, giacenze = [], []
    if ids:
        segna = ",".join("?" * len(ids))
        movimenti = [dict(r) for r in conn.execute(
            f"SELECT m.id, time(m.ts, 'localtime') AS ora, m.tipo, a.codice, a.descrizione, a.um, m.quantita, "
            f"ud.nome AS da_nome, ua.nome AS a_nome, m.riferimento, m.fornitore, m.origine, m.utente, m.data "
            f"FROM movimenti m JOIN articoli a ON a.id = m.articolo_id "
            f"LEFT JOIN ubicazioni ud ON ud.id = m.da_ubicazione_id LEFT JOIN ubicazioni ua ON ua.id = m.a_ubicazione_id "
            f"WHERE date(m.ts, 'localtime') = ? AND (m.a_ubicazione_id IN ({segna}) OR m.da_ubicazione_id IN ({segna})) "
            f"ORDER BY m.ts, m.id", [giorno, *ids, *ids])]
        giacenze = [dict(r) for r in conn.execute(
            f"SELECT a.codice, a.descrizione, a.um, u.nome AS ubicazione, g.quantita "
            f"FROM giacenze g JOIN articoli a ON a.id = g.articolo_id JOIN ubicazioni u ON u.id = g.ubicazione_id "
            f"WHERE g.ubicazione_id IN ({segna}) AND abs(g.quantita) > 1e-9 ORDER BY a.descrizione, u.nome", ids)]
    impronta = hashlib.sha256(json.dumps(
        {"m": [[m["id"], m["tipo"], m["quantita"], m["da_nome"], m["a_nome"], m["riferimento"]] for m in movimenti],
         "g": [[g["codice"], g["ubicazione"], round(g["quantita"], 6)] for g in giacenze]},
        sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:32]
    nome = ubi[0]["commessa"].strip() if ubi else str(commessa).strip()
    return {"commessa": nome, "giorno": giorno, "ubicazioni": ubi, "movimenti": movimenti,
            "giacenze": giacenze, "impronta": impronta}


def _data_it(giorno):
    return datetime.strptime(giorno, "%Y-%m-%d").strftime("%d/%m/%Y")


def _qta(q, um):
    """12.5, "ton" -> "12,5 ton" (virgola decimale, come si legge in cantiere)."""
    return f"{q:g} {um or ''}".replace(".", ",").strip()


def _da_a(m):
    """"Deposito › Cantiere" per un trasferimento, "› Cantiere" per un carico, "Cantiere ›" per uno scarico.
    › e non → : il PDF è in WinAnsi (pdf_semplice) e la freccia diventerebbe "?"."""
    da, a = m["da_nome"] or "", m["a_nome"] or ""
    return f"{da} › {a}".strip()


# Nel PDF la colonna Tipo è stretta: "trasferimento" si accorcia (nell'Excel resta intero).
TIPO_BREVE = {"trasferimento": "trasfer.", "inventario": "inventario", "rettifica": "rettifica"}
TITOLI_MOV = ["Ora", "Tipo", "Codice", "Articolo", "Quantità", "Da", "A", "Riferimento (DDT)", "Fornitore", "Chi"]
TITOLI_GIAC = ["Codice", "Articolo", "Ubicazione", "Quantità", "UM"]


def pdf(d, autore=""):
    """PDF del riepilogo: movimenti del giorno e giacenze a fine giornata, una sezione ciascuno.
    Larghezze in punti tipografici sui 515 utili dell'A4 (pdf_semplice taglia le celle troppo lunghe): per stare
    in pagina il PDF non ha la colonna "Chi", che resta nell'Excel insieme a fornitore e origine."""
    sotto = (f"Magazzino Operativo Cosedil · {_data_it(d['giorno'])} · "
             + (", ".join(u["nome"] for u in d["ubicazioni"]) or "nessuna ubicazione con questa commessa"))
    righe_mov = [[(m["ora"] or "")[:5], TIPO_BREVE.get(m["tipo"], m["tipo"]), m["descrizione"], _qta(m["quantita"], m["um"]),
                  _da_a(m), (m["riferimento"] or "") + (f" · {m['fornitore']}" if m["fornitore"] else "")]
                 for m in d["movimenti"]]
    righe_giac = [[g["codice"], g["descrizione"], g["ubicazione"], _qta(g["quantita"], g["um"])] for g in d["giacenze"]]
    return pdf_semplice.documento_pdf([
        {"titolo": f"Movimenti del {_data_it(d['giorno'])} — commessa {d['commessa']}", "sottotitolo": sotto,
         # "Q.tà" e non "Quantità": pdf_semplice allinea a destra stimando la larghezza del testo e il maiuscolo
         # grassetto "QUANTITÀ" sborderebbe sulla colonna dopo
         "intestazioni": ["Ora", "Tipo", "Articolo", "Q.tà", "Da › A", "DDT / riferimento"], "righe": righe_mov,
         "numeriche": (3,), "larghezze": (32, 50, 128, 60, 125, 120)},
        {"titolo": f"Giacenze a fine giornata — commessa {d['commessa']}", "sottotitolo": sotto,
         "intestazioni": ["Codice", "Articolo", "Ubicazione", "Q.tà"], "righe": righe_giac,
         "numeriche": (3,), "larghezze": (1.1, 3.2, 2.2, 1.2)},
    ], piede=f"Riepilogo {'automatico' if not autore else 'inviato da ' + autore} del Magazzino Operativo")


def xlsx(d):
    """Excel del riepilogo: foglio Movimenti e foglio Giacenze, quantità come numeri."""
    return xlsx_semplice.documento_xlsx([
        {"nome": f"Movimenti {d['giorno']}", "intestazioni": ["Data"] + TITOLI_MOV + ["Origine", "Data documento"],
         "righe": [[d["giorno"], m["ora"][:5], m["tipo"], m["codice"], m["descrizione"], m["quantita"], m["da_nome"] or "",
                    m["a_nome"] or "", m["riferimento"] or "", m["fornitore"] or "", m["utente"] or "", m["origine"],
                    m["data"] or ""] for m in d["movimenti"]],
         "larghezze": [11, 7, 12, 12, 34, 10, 22, 22, 26, 26, 14, 10, 13]},
        {"nome": "Giacenze", "intestazioni": TITOLI_GIAC,
         "righe": [[g["codice"], g["descrizione"], g["ubicazione"], round(g["quantita"], 6), g["um"] or ""] for g in d["giacenze"]],
         "larghezze": [12, 40, 26, 12, 8]},
    ])


# --------------------------------------------------------------------------- registro degli invii

def ultimo(conn, commessa, giorno):
    r = conn.execute("SELECT * FROM riepiloghi WHERE chiave = ? AND giorno = ? ORDER BY id DESC LIMIT 1",
                     (_normalizza(commessa), giorno)).fetchone()
    return dict(r) if r else None


def elenco(conn, commessa=None, limite=30):
    sql, p = "SELECT * FROM riepiloghi", []
    if commessa:
        sql += " WHERE chiave = ?"
        p.append(_normalizza(commessa))
    sql += " ORDER BY id DESC LIMIT ?"
    p.append(max(1, min(int(limite or 30), 200)))
    return [dict(r) for r in conn.execute(sql, p)]


def _segna(conn, d, esito, automatico, utente, stato_http=None, pdf_id=None, xlsx_id=None, url=None, dettaglio=None):
    conn.execute(
        "INSERT INTO riepiloghi (giorno, commessa, chiave, impronta, movimenti, esito, stato_http, pdf, xlsx, url, "
        "automatico, utente, dettaglio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (d["giorno"], d["commessa"], _normalizza(d["commessa"]), d["impronta"], len(d["movimenti"]), esito, stato_http,
         pdf_id, xlsx_id, url, 1 if automatico else 0, utente, (dettaglio or "")[:500] or None))
    conn.commit()


# --------------------------------------------------------------------------- invio

def _q(codice):
    return urllib.parse.quote(str(codice or "").strip(), safe="")


def invia(conn, commessa, giorno=None, utente=None, forza=False, automatico=False, chiama=None):
    """Manda in SkyTower il riepilogo di una commessa per un giorno (default oggi). Non solleva mai.

    Ritorna {"esito": "ok"|"gia_inviato"|"vuoto"|"errore"|"rimandato", "messaggio", ...}.
    `chiama` = suite_link.chiama (sostituibile nei test con una SkyTower finta)."""
    import suite_link  # shared/suite: lo mette nel sys.path suite_rotte / importa_ddt
    chiama = chiama or suite_link.chiama
    giorno = giorno or date.today().isoformat()
    with _lock:
        d = dati(conn, commessa, giorno)
        if not d["ubicazioni"]:
            return {"esito": "errore", "messaggio": f"Nessuna ubicazione del Magazzino ha il codice commessa {commessa}"}
        if not d["movimenti"] and not forza:
            return {"esito": "vuoto", "messaggio": f"Nessun movimento il {_data_it(giorno)} per la commessa {d['commessa']}"}
        prima = ultimo(conn, d["commessa"], giorno)
        ok_prima = conn.execute("SELECT * FROM riepiloghi WHERE chiave = ? AND giorno = ? AND esito = 'ok' "
                                "ORDER BY id DESC LIMIT 1", (_normalizza(d["commessa"]), giorno)).fetchone()
        if ok_prima and ok_prima["impronta"] == d["impronta"] and not forza:
            return {"esito": "gia_inviato", "pdf": ok_prima["pdf"], "xlsx": ok_prima["xlsx"], "url": ok_prima["url"],
                    "messaggio": f"Riepilogo del {_data_it(giorno)} per {d['commessa']} già in SkyTower "
                                 f"({ok_prima['pdf']}): nessun movimento nuovo da allora"}
        if automatico and prima and prima["esito"] == "errore" and prima["impronta"] == d["impronta"] \
                and prima["stato_http"] and 400 <= prima["stato_http"] < 500:
            # errore "definitivo" (es. commessa senza progetto in SkyTower): non si ritenta ogni 5 minuti
            return {"esito": "errore", "messaggio": prima["dettaglio"] or "errore precedente", "ritentato": False}
        # PDF già caricato all'invio precedente (stessi dati) ma Excel mancato: si rimanda solo l'Excel.
        pdf_gia = prima["pdf"] if prima and prima["esito"] == "parziale" and prima["impronta"] == d["impronta"] else None
        aggiornamento = bool(ok_prima)
        adesso = datetime.now()
        titolo = f"Riepilogo magazzino {d['commessa']} {_data_it(giorno).replace('/', '-')}" + \
            (f" (aggiornamento {adesso:%H:%M})" if aggiornamento else "")
        base_nome = f"riepilogo-magazzino-{_normalizza(d['commessa']).lower()}-{giorno.replace('-', '')}" + \
            (f"-{adesso:%H%M}" if aggiornamento else "")
        descrizione = (f"Riepilogo {'automatico' if automatico else 'a richiesta'} del Magazzino Operativo: "
                       f"{len(d['movimenti'])} movimenti del {_data_it(giorno)}, {len(d['giacenze'])} righe di giacenza "
                       f"({', '.join(u['nome'] for u in d['ubicazioni'])}).")
        attributi = json.dumps({"origine": "magazzino", "tipo": "riepilogo_giornaliero", "commessa": d["commessa"],
                                "giorno": giorno, "generato_il": adesso.isoformat(timespec="seconds")})
        risultati = {}
        try:
            if pdf_gia:
                risultati["pdf"] = {"identifier": pdf_gia, "url": prima["url"]}
            else:
                risultati["pdf"] = chiama("skytower", "POST", f"/suite/commesse/{_q(d['commessa'])}/documenti",
                                          parametri={"title": titolo, "description": descrizione, "tipo": "RP",
                                                     "attributes": attributi},
                                          corpo_file=(pdf(d, None if automatico else utente), "application/pdf", base_nome + ".pdf"),
                                          utente=utente or "magazzino", nome="Magazzino Operativo", timeout=60)
            risultati["xlsx"] = chiama("skytower", "POST", f"/suite/commesse/{_q(d['commessa'])}/documenti",
                                       parametri={"title": titolo + " (Excel)", "description": descrizione, "tipo": "RP",
                                                  "attributes": attributi},
                                       corpo_file=(xlsx(d), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                                   base_nome + ".xlsx"),
                                       utente=utente or "magazzino", nome="Magazzino Operativo", timeout=60)
        except Exception as e:  # noqa: BLE001 — SuiteError (SkyTower spenta, 4xx) o rete: mai un'eccezione fuori
            stato = getattr(e, "stato", None)
            testo = getattr(e, "messaggio", None) or str(e)
            pdf_id = (risultati.get("pdf") or {}).get("identifier")
            if stato == 503 and automatico and not pdf_id:
                # SkyTower spenta: niente riga nel registro (sarebbe rumore ogni 5 minuti), si riprova al giro dopo
                log.info("riepilogo %s %s: SkyTower non risponde, riprovo più tardi", d["commessa"], giorno)
                return {"esito": "rimandato", "messaggio": "SkyTower non risponde: il riepilogo partirà appena è accesa"}
            esito = "parziale" if pdf_id else "errore"
            _segna(conn, d, esito, automatico, utente, stato_http=stato, pdf_id=pdf_id,
                   url=(risultati.get("pdf") or {}).get("url"), dettaglio=testo)
            log.warning("riepilogo %s %s non inviato del tutto: %s", d["commessa"], giorno, testo)
            return {"esito": "errore", "messaggio": f"Riepilogo non caricato in SkyTower: {testo}", "pdf": pdf_id}
        p, x = risultati["pdf"], risultati["xlsx"]
        _segna(conn, d, "ok", automatico, utente, pdf_id=p.get("identifier"), xlsx_id=x.get("identifier"),
               url=p.get("url"))
        log.info("riepilogo %s %s in SkyTower: %s, %s", d["commessa"], giorno, p.get("identifier"), x.get("identifier"))
        return {"esito": "ok", "pdf": p.get("identifier"), "xlsx": x.get("identifier"), "url": p.get("url"),
                "aggiornamento": aggiornamento, "movimenti": len(d["movimenti"]),
                "messaggio": f"Riepilogo del {_data_it(giorno)} per {d['commessa']} caricato in SkyTower: "
                             f"{p.get('identifier')} e {x.get('identifier')}"}


# --------------------------------------------------------------------------- giro automatico

def giorni_da_fare(adesso, ora):
    """Giorni da riepilogare in automatico a quest'ora: ieri sempre (recupero dopo un server spento
    all'ora del riepilogo; se era già partito l'impronta lo fa saltare), oggi dopo l'ora impostata."""
    giorni = [(adesso.date() - timedelta(days=1)).isoformat()]
    if (adesso.hour, adesso.minute) >= ora:
        giorni.append(adesso.date().isoformat())
    return giorni


def giro(conn, adesso=None, chiama=None, raggiungibile=None):
    """Un passaggio del riepilogo automatico. Ritorna la lista degli esiti (per log e test)."""
    ora = ora_automatica()
    if ora is None:
        return []
    import suite_link
    raggiungibile = raggiungibile or suite_link.raggiungibile
    adesso = adesso or datetime.now()
    esiti = []
    for giorno in giorni_da_fare(adesso, ora):
        commesse = commesse_del_giorno(conn, giorno)
        if not commesse:
            continue
        if not raggiungibile("skytower"):
            log.info("riepilogo automatico: SkyTower non risponde, riprovo al prossimo giro")
            return esiti
        for commessa in commesse:
            # ieri: solo se quel giorno non è mai partito niente (niente "aggiornamenti" di un giorno chiuso)
            if giorno != adesso.date().isoformat() and conn.execute(
                    "SELECT 1 FROM riepiloghi WHERE chiave = ? AND giorno = ? AND esito IN ('ok', 'parziale')",
                    (_normalizza(commessa), giorno)).fetchone():
                continue
            esiti.append(dict(invia(conn, commessa, giorno, utente="riepilogo automatico", automatico=True, chiama=chiama),
                              commessa=commessa, giorno=giorno))
    return esiti


def avvia_di_sfondo(intervallo=300):
    """Thread del riepilogo automatico (da app.avvia_importazioni_di_sfondo, solo col server vero)."""
    if ora_automatica() is None:
        log.info("riepilogo automatico verso SkyTower spento (MAGAZZINO_RIEPILOGO_ORA)")
        return

    def ciclo():
        import database
        time.sleep(30)
        while True:
            conn = database.get_db()
            try:
                giro(conn)
            except Exception as e:  # noqa: BLE001 — il thread non deve morire
                log.error("riepilogo automatico: %s", e)
            finally:
                conn.close()
            time.sleep(intervallo)

    threading.Thread(target=ciclo, daemon=True, name="riepilogo").start()
