# "><(((º> sabusabu <º)))><"
"""
Mezzi a nolo: una maschera sola per i dati del mezzo, della ditta proprietaria e del contratto, che finiscono
  1. nel contratto Word (modelli_protetti: solo le aree gialle del modello, l'originale non si tocca);
  2. nella documentazione del mezzo in Viewpoint (libretto, polizza, CE...: nome, cartella e descrizione dai dati).

La maschera e' un modulo di moduli.py (MODULI_DIR/mezzi_nolo.json) con in piu':
  "calcoli":   [{"campo": "importo", "prodotto": ["prezzo_unitario", "quantita"]}]  (solo se il campo e' vuoto)
  "contratto": {"modello_predefinito": "<rel>", "aree": [{"dopo": "<testo prima dell'area>", "testo": "..."}]}
  "dms":       {"cartella": [...], "nome": "...", "descrizione": "...", "documenti": [{"id", "nome", "scadenza",
                "obbligatorio", "automatico": "contratto"|"scheda"}]}
Nei testi: {campo}, {campo:lettere} (importo in lettere, come nei contratti: "millecinquanta/00") e [[ ... ]],
parte che sparisce se manca uno dei dati al suo interno. Un'area gialla del modello che contiene {{campo}} si
compila da sola, senza regola.

I dati della ditta (campi con ambito "fornitore") vanno nell'anagrafica fornitori dei moduli, riconosciuta dalla
partita IVA: un dato registrato diverso da quello scritto (es. un IBAN cambiato) si sostituisce solo con una
conferma esplicita, e resta lo storico.

Ogni pratica e' MODULI_ARCHIVIO/mezzi/<id>/: record.json, documenti/ (copie dei file scelti), scheda_mezzo.pdf e
manifest.csv per il trasferimento in Viewpoint (vfp_transfer.Transfer, come un export del vecchio DMS).

Prova da riga di comando:
  python mezzi.py elenco
  python mezzi.py aree --modello <file .docx> [--pratica <id>]   aree gialle e testo proposto per ognuna
"""

import argparse
import csv
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import threading
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import env_config
import modelli_protetti
import moduli

log = logging.getLogger("mezzi")

MASCHERA = "mezzi_nolo"
ESTENSIONI_DOC = {".pdf", ".p7m", ".docx", ".doc", ".xlsx", ".xls", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".zip"}
MAX_MB_DOC = 200
AUTOMATICI = ("contratto", "scheda")
VARIABILI_DMS = {"documento", "scadenza"}  # valori del singolo documento, oltre ai campi della maschera
_REC_RE = re.compile(r"\d{8}-\d{6}-[0-9a-f]{6}")
_SEGNAPOSTO = re.compile(r"\{([a-z0-9][a-z0-9_-]{0,63})(?::(lettere))?\}")
_SEGNAPOSTO_DOCX = re.compile(r"\{\{\s*([a-z0-9][a-z0-9_-]{0,63})\s*\}\}")
_OPZIONALE = re.compile(r"\[\[(.*?)\]\]", re.S)
_NOME_VIETATO = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


class MezziError(ValueError):
    pass


# --------------------------------------------------------------------------- importi in lettere

_UNITA = ["", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici",
          "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove"]
_DECINE = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"]


def _sotto_mille(n):
    centinaia, resto = divmod(n, 100)
    parole = "" if not centinaia else "cento" if centinaia == 1 else _UNITA[centinaia] + "cento"
    if resto < 20:
        parole += _UNITA[resto]
    else:
        decine, unita = divmod(resto, 10)
        d = _DECINE[decine]
        parole += (d[:-1] if unita in (1, 8) else d) + _UNITA[unita]  # ventuno, trentotto
    return parole


def in_lettere(valore):
    """'1050.00' -> 'millecinquanta/00', come negli importi dei contratti (cento senza elisione: seicentoottanta)."""
    try:
        d = Decimal(str(valore)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise MezziError(f"importo non valido: {valore}")
    if d < 0:
        raise MezziError("importo negativo")
    intero, cent = divmod(int(d * 100), 100)
    if intero >= 10 ** 12:
        raise MezziError("importo troppo grande")
    parole = ""
    for scala, uno, molti in ((10 ** 9, "unmiliardo", "miliardi"), (10 ** 6, "unmilione", "milioni"),
                              (1000, "mille", "mila")):
        q, intero = divmod(intero, scala)
        if q:
            parole += uno if q == 1 else _sotto_mille(q) + molti
    parole += _sotto_mille(intero)
    if parole.endswith("tre") and parole != "tre":
        parole = parole[:-3] + "tré"  # ventitré, duemilatré (ma tremila, ventitremila)
    return f"{parole or 'zero'}/{cent:02d}"


# --------------------------------------------------------------------------- maschera

def _usati(testo):
    return {m.group(1) for m in _SEGNAPOSTO.finditer(testo or "")}


def carica_maschera(s, maschera_id=MASCHERA):
    """Il modulo dei mezzi, con i controlli delle parti in piu' (calcoli, contratto, dms)."""
    try:
        m = moduli.carica_modulo(s, maschera_id)
    except moduli.ModuloError as e:
        raise MezziError(str(e))
    campi = {c["id"]: c for c in m["campi"]}
    for calc in m.get("calcoli", []):
        fattori = calc.get("prodotto") or []
        if calc.get("campo") not in campi or len(fattori) < 2 or any(f not in campi for f in fattori):
            raise MezziError(f"{maschera_id}: calcolo non valido {calc}")
    for coppia in m.get("contratto", {}).get("sostituzioni", []):
        if not (isinstance(coppia, list) and len(coppia) == 2 and coppia[0]):
            raise MezziError(f"{maschera_id}: ogni sostituzione e' [\"da\", \"a\"]")
        try:
            _rx(coppia[0])
        except re.error as e:
            raise MezziError(f"{maschera_id}: sostituzione {coppia[0][:40]!r} non valida ({e})")
        if _usati(coppia[1]) - set(campi):
            raise MezziError(f"{maschera_id}: sostituzione con campi inesistenti {sorted(_usati(coppia[1]) - set(campi))}")
    for regola in m.get("contratto", {}).get("aree", []):
        if not str(regola.get("dopo", "")).strip() or len(regola["dopo"]) > 80:
            raise MezziError(f"{maschera_id}: ogni regola del contratto vuole 'dopo' (al massimo 80 caratteri)")
        if _usati(regola.get("testo")) - set(campi):
            raise MezziError(f"{maschera_id}: regola dopo {regola['dopo']!r} con campi inesistenti "
                             f"{sorted(_usati(regola.get('testo')) - set(campi))}")
    dms = m.get("dms") or {}
    if not dms.get("cartella") or not dms.get("nome") or not dms.get("documenti"):
        raise MezziError(f"{maschera_id}: la parte 'dms' vuole cartella, nome e documenti")
    for testo in [*dms["cartella"], dms["nome"], dms.get("descrizione", "")]:
        if _usati(testo) - set(campi) - VARIABILI_DMS:
            raise MezziError(f"{maschera_id}: dms con campi inesistenti {sorted(_usati(testo) - set(campi) - VARIABILI_DMS)}")
    visti = set()
    for doc in dms["documenti"]:
        if not re.fullmatch(r"[a-z0-9_]{1,32}", str(doc.get("id", ""))) or doc["id"] in visti or not doc.get("nome"):
            raise MezziError(f"{maschera_id}: documento con id non valido o doppio: {doc.get('id')!r}")
        if doc.get("automatico") and doc["automatico"] not in AUTOMATICI:
            raise MezziError(f"{maschera_id}: documento {doc['id']}: automatico solo {', '.join(AUTOMATICI)}")
        visti.add(doc["id"])
    return m


def normalizza_valori(maschera, grezzi):
    """({campo: valore nel formato del campo}, {campo: errore}); i fissi dalla maschera, i calcoli se mancano."""
    valori, errori = {}, {}
    for c in maschera["campi"]:
        if c.get("ambito") == "fisso":
            valori[c["id"]] = str(c["valore"])
            continue
        try:
            v = moduli.normalizza(c, (grezzi or {}).get(c["id"], ""))
        except moduli.ModuloError as e:
            errori[c["id"]] = str(e)
            continue
        if v:
            valori[c["id"]] = v
    campi = {c["id"]: c for c in maschera["campi"]}
    for calc in maschera.get("calcoli", []):
        if valori.get(calc["campo"]) or not all(valori.get(f) for f in calc["prodotto"]):
            continue
        prodotto = Decimal(1)
        for f in calc["prodotto"]:
            prodotto *= Decimal(valori[f])
        valori[calc["campo"]] = moduli.normalizza(campi[calc["campo"]], str(prodotto).replace(".", ","))
    return valori, errori


def mancanti(maschera, valori):
    return [c["etichetta"] for c in maschera["campi"] if c.get("obbligatorio") and not valori.get(c["id"])]


def riempi(testo, maschera, valori, vuoto=moduli.VUOTO, extra=None):
    """Testo con i dati: {campo} nel formato per le persone, {campo:lettere}, [[...]] tolto se manca un dato."""
    campi = {c["id"]: c for c in maschera["campi"]}
    extra = extra or {}

    def valore(cid, modo):
        if cid in extra:
            return extra[cid]
        v = valori.get(cid, "")
        if v and modo == "lettere":
            return in_lettere(v)
        return moduli.mostra(campi[cid], v) if cid in campi and v else ""

    def opzionale(m):
        parte = m.group(1)
        return parte if all(valore(c, modo) for c, modo in _SEGNAPOSTO.findall(parte)) else ""

    testo = _OPZIONALE.sub(opzionale, testo or "")
    return _SEGNAPOSTO.sub(lambda m: valore(m.group(1), m.group(2)) or vuoto, testo)


# --------------------------------------------------------------------------- contratto (aree gialle)

def _norm(t):
    t = t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = t.replace("–", "-").replace("—", "-").replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip().casefold()


def _adatta(nuovo, attuale, paragrafi):
    """Una riga per paragrafo dell'area: righe in piu' unite all'ultima, quelle mancanti restano come sono."""
    righe = nuovo.split("\n")
    if len(righe) > paragrafi:
        righe = righe[:paragrafi - 1] + [" ".join(righe[paragrafi - 1:])]
    return "\n".join(righe + attuale.split("\n")[len(righe):paragrafi])


def _rx(da):
    """'re:...' = espressione regolare; altrimenti testo in cui ogni serie di ___ vale per qualsiasi lunghezza e
    apostrofi e virgolette dritti o tipografici sono uguali."""
    if da.startswith("re:"):
        return re.compile(da[3:])
    parti = []
    for pezzo in re.split(r"(_{2,})", da):
        if pezzo.startswith("__"):
            parti.append(r"_{2,}")
        else:
            parti.append("".join("['’]" if ch in "'’" else '["“”]' if ch in '"“”' else re.escape(ch) for ch in pezzo))
    return re.compile("".join(parti))


def sostituisci(testo, maschera, valori):
    """Testo dell'area con i buchi riempiti dalle sostituzioni della maschera, e quante ne sono state usate.
    Una sostituzione si salta se manca un dato che usa, o se cambierebbe il numero dei paragrafi."""
    usate = 0
    for da, a in maschera.get("contratto", {}).get("sostituzioni", []):
        rx = _rx(da)
        if not rx.search(testo):
            continue
        val = riempi(a, maschera, valori, vuoto="\x00")
        if "\x00" in val:
            continue
        val = re.sub(r"\s*\n\s*", "; ", val.strip())  # un dato su piu' righe resta nel suo paragrafo
        nuovo = rx.sub(lambda _m: val, testo)
        if nuovo.count("\n") == testo.count("\n"):
            testo, usate = nuovo, usate + 1
    return testo, usate


def proposte_aree(maschera, valori, aree):
    """Per ogni area gialla: testo attuale, testo proposto dai dati (None = da lasciare com'e') e regola usata."""
    campi = {c["id"]: c for c in maschera["campi"]}
    regole = maschera.get("contratto", {}).get("aree", [])
    out = []
    for a in aree:
        nuovo, regola = None, ""
        if _SEGNAPOSTO_DOCX.search(a["testo"]):
            nuovo = _SEGNAPOSTO_DOCX.sub(
                lambda m: moduli.mostra(campi[m.group(1)], valori.get(m.group(1), "")) if m.group(1) in campi
                else m.group(0), a["testo"])
            regola = "segnaposto {{...}} nel modello"
        else:
            prima = _norm(a["prima"])
            for r in regole:
                if prima.endswith(_norm(r["dopo"])):
                    nuovo = _adatta(riempi(r["testo"], maschera, valori), a["testo"], a["paragrafi"])
                    regola = f"dopo \"{r['dopo']}\""
                    break
            if nuovo is None:
                testo, usate = sostituisci(a["testo"], maschera, valori)
                if usate and testo != a["testo"]:
                    nuovo, regola = testo, f"{usate} {'dato' if usate == 1 else 'dati'} al posto dei ___"
        out.append({"id": a["id"], "prima": a["prima"], "testo": a["testo"], "paragrafi": a["paragrafi"],
                    "nuovo": nuovo, "regola": regola})
    return out


# --------------------------------------------------------------------------- pratiche

def _scrivi_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while blocco := f.read(1024 * 1024):
            h.update(blocco)
    return h.hexdigest()


def nome_vfp(testo, ripiego="senza nome"):
    """Nome di cartella o documento in Viewpoint: niente / \\ : * ? \" < > | e niente spazi doppi."""
    t = re.sub(r"\s+", " ", _NOME_VIETATO.sub("-", testo or "")).strip(" .-")
    return t[:120] or ripiego


class Pratiche:
    """Un mezzo per cartella: <base>/<id>/record.json + documenti/ + scheda_mezzo.pdf + manifest.csv."""

    def __init__(self, base, anagrafica=None):
        self.base = Path(base)
        self.anagrafica = anagrafica
        self._lock = threading.Lock()

    def _dir(self, rec_id):
        if not _REC_RE.fullmatch(rec_id or ""):
            raise MezziError("identificativo della pratica non valido")
        return self.base / rec_id

    def leggi(self, rec_id):
        p = self._dir(rec_id) / "record.json"
        if not p.is_file():
            raise MezziError("pratica del mezzo non trovata")
        return json.loads(p.read_text(encoding="utf-8"))

    def elenco(self, limite=300):
        out = []
        if not self.base.is_dir():
            return out
        for d in sorted((d for d in self.base.iterdir() if _REC_RE.fullmatch(d.name)), reverse=True)[:limite]:
            try:
                r = json.loads((d / "record.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            v = r.get("valori", {})
            out.append({"id": r["id"], "aggiornato": r.get("aggiornato") or r.get("creato"), "utente": r.get("utente", ""),
                        "mezzo": " ".join(x for x in (v.get("tipo_mezzo"), v.get("marca"), v.get("modello")) if x),
                        "matricola": v.get("matricola", ""), "targa": v.get("targa", ""),
                        "proprietaria": v.get("ragione_sociale", ""), "commessa": v.get("commessa", ""),
                        "contratto": bool(r.get("contratto")), "documenti": len(r.get("documenti", [])),
                        "inviato": (r.get("invio") or {}).get("data", ""), "archiviato": (r.get("dms") or {}).get("data", "")})
        return out

    def fornitore(self, piva):
        """Dati della ditta gia' registrati per quella partita IVA (vuoto se nuova)."""
        try:
            chiave = moduli.normalizza({"tipo": "piva"}, piva)
        except moduli.ModuloError as e:
            raise MezziError(str(e))
        scheda = self.anagrafica.leggi(chiave) if (self.anagrafica and chiave) else None
        return {"chiave": chiave, "registrato": bool(scheda), "nome": (scheda or {}).get("nome", ""),
                "valori": (scheda or {}).get("valori", {}), "aggiornato": (scheda or {}).get("aggiornato", "")}

    def salva(self, maschera, rec_id, grezzi, documenti, utente="", aggiorna_anagrafica=False):
        """
        Crea (rec_id vuoto) o aggiorna una pratica. documenti: [{"tipo", "file" gia' in pratica oppure "percorso" sul
        PC, "scadenza", "note"}]; i file nuovi vengono copiati nella pratica. I dati della ditta vanno in anagrafica:
        se cambiano dati gia' registrati serve aggiorna_anagrafica=True.
        """
        valori, errori = normalizza_valori(maschera, grezzi)
        campi = {c["id"]: c for c in maschera["campi"]}
        if errori:
            raise MezziError("; ".join(f"{campi[k]['etichetta']}: {m}" for k, m in errori.items()))
        tipi = {d["id"]: d for d in maschera["dms"]["documenti"] if not d.get("automatico")}
        with self._lock:
            nuova = not rec_id
            if nuova:
                rec_id = f"{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(3)}"
                rec = {"id": rec_id, "maschera": maschera["id"], "creato": datetime.now().isoformat(timespec="seconds"),
                       "documenti": []}
            else:
                rec = self.leggi(rec_id)
            d = self._dir(rec_id)
            chiave = valori.get(maschera.get("chiave_fornitore") or "", "")
            dati_ditta = {k: v for k, v in valori.items() if campi[k].get("ambito") == "fornitore"}
            if self.anagrafica and chiave:
                diverse = self.anagrafica.differenze(chiave, dati_ditta)
                if diverse and not aggiorna_anagrafica:
                    raise MezziError("ANAGRAFICA: dati della ditta diversi da quelli registrati (" +
                                     ", ".join(campi[k]["etichetta"] for k in diverse) +
                                     "). Verificarli con la ditta prima di confermare la sostituzione.")
            elenco = self._documenti(d, rec.get("documenti", []), documenti, tipi)
            if nuova:
                d.mkdir(parents=True)
            self._copia(d, elenco)
            if self.anagrafica and chiave:
                self.anagrafica.registra(chiave, valori.get(maschera.get("nome_fornitore") or "", ""), dati_ditta,
                                         utente, rec_id, consenti_modifiche=aggiorna_anagrafica)
            rec.update(valori=valori, documenti=elenco, mancanti=mancanti(maschera, valori), utente=utente,
                       aggiornato=datetime.now().isoformat(timespec="seconds"))
            _scrivi_json(d / "record.json", rec)
            log.info("Pratica mezzo %s %s da %s", rec_id, "creata" if nuova else "aggiornata", utente or "?")
            return rec

    @staticmethod
    def _documenti(d, attuali, richiesti, tipi):
        """Elenco nuovo dei documenti; i file da copiare restano in "_da_copiare" fino a _copia."""
        presenti = {x["file"]: x for x in attuali}
        out = []
        for r in richiesti or []:
            tipo = str(r.get("tipo") or "")
            if tipo not in tipi:
                raise MezziError(f"tipo di documento non previsto: {tipo!r}")
            scad = ""
            if r.get("scadenza"):
                try:
                    scad = moduli.normalizza({"tipo": "data"}, r["scadenza"])
                except moduli.ModuloError as e:
                    raise MezziError(f"{tipi[tipo]['nome']}: {e}")
            voce = {"tipo": tipo, "scadenza": scad, "note": str(r.get("note") or "").strip()[:300]}
            if r.get("file") in presenti:  # gia' nella pratica: cambiano solo scadenza e note
                out.append({**presenti[r["file"]], **voce})
                continue
            p = Path(str(r.get("percorso") or "").strip())
            if not p.is_absolute() or not p.is_file():
                raise MezziError(f"{tipi[tipo]['nome']}: file non trovato ({p})")
            if p.suffix.lower() not in ESTENSIONI_DOC:
                raise MezziError(f"{p.name}: formato non ammesso ({', '.join(sorted(ESTENSIONI_DOC))})")
            if p.stat().st_size > MAX_MB_DOC * 1024 * 1024:
                raise MezziError(f"{p.name}: piu' di {MAX_MB_DOC} MB")
            if d.exists() and p.resolve().is_relative_to(d.resolve()):
                raise MezziError(f"{p.name}: scegliere il file originale, non quello gia' nella pratica")
            import estrai_dms
            nome = f"{tipo}_{secrets.token_hex(2)}_{estrai_dms.nome_sicuro(p.name)}"
            out.append({**voce, "file": nome, "originale": str(p), "nome_file": p.name, "byte": p.stat().st_size,
                        "caricato_il": date.today().isoformat(), "_da_copiare": str(p)})
        return out

    @staticmethod
    def _copia(d, elenco):
        cartella = d / "documenti"
        cartella.mkdir(exist_ok=True)
        tenuti = {x["file"] for x in elenco}
        for x in elenco:
            sorgente = x.pop("_da_copiare", None)
            if sorgente:
                shutil.copyfile(sorgente, cartella / x["file"])
                x["sha256"] = _sha256(cartella / x["file"])
        for p in cartella.iterdir():  # documenti tolti dalla maschera
            if p.is_file() and p.name not in tenuti:
                p.unlink()

    def allega(self, maschera, rec_id, tipo, nome_file, sorgente, scadenza="", utente=""):
        """Documento caricato dal browser (gia' scritto in sorgente, dentro la pratica): diventa un documento del mezzo."""
        tipi = {d["id"]: d for d in maschera["dms"]["documenti"] if not d.get("automatico")}
        sorgente = Path(sorgente)
        try:
            if tipo not in tipi:
                raise MezziError(f"tipo di documento non previsto: {tipo!r}")
            nome_file = Path(str(nome_file or "")).name.strip()
            if Path(nome_file).suffix.lower() not in ESTENSIONI_DOC:
                raise MezziError(f"{nome_file or 'file'}: formato non ammesso ({', '.join(sorted(ESTENSIONI_DOC))})")
            scad = moduli.normalizza({"tipo": "data"}, scadenza) if scadenza else ""
        except moduli.ModuloError as e:
            sorgente.unlink(missing_ok=True)
            raise MezziError(f"{tipi[tipo]['nome']}: {e}")
        except MezziError:
            sorgente.unlink(missing_ok=True)
            raise
        import estrai_dms
        with self._lock:
            rec = self.leggi(rec_id)
            cartella = self._dir(rec_id) / "documenti"
            cartella.mkdir(exist_ok=True)
            nome = f"{tipo}_{secrets.token_hex(2)}_{estrai_dms.nome_sicuro(nome_file)}"
            os.replace(sorgente, cartella / nome)
            rec["documenti"].append({"tipo": tipo, "scadenza": scad, "note": "", "file": nome, "originale": "caricato dal browser",
                                     "nome_file": nome_file, "byte": (cartella / nome).stat().st_size,
                                     "caricato_il": date.today().isoformat(), "sha256": _sha256(cartella / nome)})
            rec.update(utente=utente or rec.get("utente", ""), aggiornato=datetime.now().isoformat(timespec="seconds"))
            _scrivi_json(self._dir(rec_id) / "record.json", rec)
            return rec

    def cartella_upload(self, rec_id):
        """Cartella dove scrivere un file in arrivo dal browser prima di allega (dentro la pratica)."""
        self.leggi(rec_id)
        d = self._dir(rec_id) / "in_arrivo"
        d.mkdir(exist_ok=True)
        return d

    def segna_dms(self, rec_id, esito):
        with self._lock:
            rec = self.leggi(rec_id)
            rec["dms"] = esito
            _scrivi_json(self._dir(rec_id) / "record.json", rec)
            return rec

    def collega_contratto(self, rec_id, info):
        with self._lock:
            rec = self.leggi(rec_id)
            rec["contratto"] = info
            _scrivi_json(self._dir(rec_id) / "record.json", rec)
            return rec

    def segna_invio(self, rec_id, n):
        with self._lock:
            rec = self.leggi(rec_id)
            rec["invio"] = {"data": datetime.now().isoformat(timespec="seconds"), "file": n}
            _scrivi_json(self._dir(rec_id) / "record.json", rec)


def pratiche(s):
    base = env_config.resolve_path(s.get("MODULI_ARCHIVIO") or "moduli_compilati")
    return Pratiche(base / "mezzi", moduli.Anagrafica(base / "fornitori"))


# --------------------------------------------------------------------------- contratto della pratica

def anteprima_contratto(s, maschera, rec, modello_rel):
    """Aree gialle del modello scelto con il testo proposto dai dati della pratica."""
    try:
        modello = modelli_protetti.modello_docx(s, modelli_protetti.risolvi_modello(s, modello_rel))
        info = modelli_protetti.leggi_aree(modello)
    except modelli_protetti.ModelloError as e:
        raise MezziError(str(e))
    if not info["aree"]:
        raise MezziError(f"{modello.name}: nessuna area gialla (consentita) nel modello")
    return {"modello": modello_rel, "protezione": info["protezione"],
            "aree": proposte_aree(maschera, rec.get("valori", {}), info["aree"])}


def compila_contratto(s, pr, rec_id, modello_rel, testi, utente=""):
    """Contratto della pratica: copia del modello con le aree gialle compilate (testi: {id area: testo})."""
    rec = pr.leggi(rec_id)
    lavoro = modelli_protetti.pratiche(s)
    try:
        modello = modelli_protetti.modello_docx(s, modelli_protetti.risolvi_modello(s, modello_rel))
        aree = {a["id"]: a for a in modelli_protetti.leggi_aree(modello)["aree"]}
        sconosciute = sorted(set(map(str, testi or {})) - set(aree))
        if sconosciute:
            raise MezziError("aree inesistenti nel modello: " + ", ".join(sconosciute))
        testi = {k: _adatta(str(v).replace("\r\n", "\n"), aree[k]["testo"], aree[k]["paragrafi"])
                 for k, v in (testi or {}).items()}
        attuale = rec.get("contratto") or {}
        if attuale.get("modello") == modello_rel and attuale.get("pratica"):
            try:
                lavoro.leggi(attuale["pratica"])
                pid = attuale["pratica"]
            except modelli_protetti.ModelloError:
                pid = lavoro.nuova(modello, utente)["id"]
        else:
            pid = lavoro.nuova(modello, utente)["id"]
        fatta = lavoro.compila(pid, testi, utente)
    except modelli_protetti.ModelloError as e:
        raise MezziError(str(e))
    info = {"modello": modello_rel, "pratica": pid, "file": str(lavoro.base / pid / fatta["compilato"]),
            "nome_file": fatta["compilato"], "aree": len(fatta["aree_cambiate"]),
            "aggiornato": datetime.now().isoformat(timespec="seconds")}
    log.info("Contratto della pratica mezzo %s compilato da %s (%s aree)", rec_id, modello_rel, info["aree"])
    return pr.collega_contratto(rec_id, info)


# --------------------------------------------------------------------------- documentazione per Viewpoint

def _valori_moduli(valori):
    return {k: {"valore": v} for k, v in valori.items()}


def scheda_pdf(maschera, rec, out):
    """PDF con tutti i dati della maschera e l'elenco dei documenti del mezzo."""
    tipi = {d["id"]: d["nome"] for d in maschera["dms"]["documenti"]}
    blocchi = moduli.blocchi_scheda(maschera, _valori_moduli(rec.get("valori", {})))
    blocchi.append(("sezione", "Documentazione"))
    for x in rec.get("documenti", []):
        dettaglio = x.get("nome_file", x["file"])
        if x.get("scadenza"):
            dettaglio += f"  -  scadenza {moduli.mostra({'tipo': 'data'}, x['scadenza'])}"
        blocchi.append(("campo", tipi.get(x["tipo"], x["tipo"]), dettaglio))
    if rec.get("contratto"):
        blocchi.append(("campo", tipi.get("contratto", "Contratto"), rec["contratto"]["nome_file"]))
    piede = f"Pratica {rec['id']}  -  aggiornata il {rec.get('aggiornato') or rec['creato']}  -  {rec.get('utente', '')}"
    Path(out).write_bytes(moduli.scheda_pdf(maschera["nome"], blocchi, piede))
    return out


def righe_dms(maschera, rec, d):
    """Righe del manifest (file, cartella, nome, revisione, descrizione, sha256) per i documenti del mezzo."""
    import vfp_transfer as vt
    dms = maschera["dms"]
    valori = rec.get("valori", {})
    cartella = "/".join(nome_vfp(riempi(p, maschera, valori, vuoto="")) for p in dms["cartella"])
    righe = []

    def riga(tipo, file, revisione, scadenza=""):
        extra = {"documento": tipo["nome"], "scadenza": moduli.mostra({"tipo": "data"}, scadenza)}
        righe.append({"file": str(file), "folder": cartella, "scadenza": scadenza,
                      "name": nome_vfp(riempi(dms["nome"], maschera, valori, vuoto="", extra=extra)),
                      "revision": revisione, "sha256": vt.file_sha256(file),
                      "description": re.sub(r"\s+", " ", riempi(dms.get("descrizione", ""), maschera, valori, vuoto="",
                                                                 extra=extra)).strip()[:200]})

    oggi = date.today().isoformat()
    for tipo in dms["documenti"]:
        if tipo.get("automatico") == "scheda":
            riga(tipo, scheda_pdf(maschera, rec, d / "scheda_mezzo.pdf"), (rec.get("aggiornato") or oggi)[:10])
        elif tipo.get("automatico") == "contratto" and rec.get("contratto"):
            file = Path(rec["contratto"]["file"])
            if not file.is_file():
                raise MezziError("contratto compilato non trovato: compilarlo di nuovo")
            riga(tipo, file, rec["contratto"]["aggiornato"][:10])
        for x in (v for v in rec.get("documenti", []) if v["tipo"] == tipo["id"] and not tipo.get("automatico")):
            file = d / "documenti" / x["file"]
            if not file.is_file() or (x.get("sha256") and vt.file_sha256(file) != x["sha256"]):
                raise MezziError(f"{tipo['nome']}: copia del file mancante o cambiata ({x.get('nome_file', x['file'])})")
            riga(tipo, file, x.get("caricato_il") or oggi, x.get("scadenza", ""))
    return righe


def prepara_caricamento(s, maschera, pr, rec_id):
    """Scrive manifest.csv della pratica: restituisce (cartella, manifest, righe) per vfp_gui.api_start."""
    import vfp_transfer as vt
    rec = pr.leggi(rec_id)
    vuoti = mancanti(maschera, rec.get("valori", {}))
    if vuoti:
        raise MezziError("prima di caricare completare: " + ", ".join(vuoti))
    d = pr._dir(rec_id)
    righe = righe_dms(maschera, rec, d)
    manifest = d / "manifest.csv"
    tmp = manifest.with_suffix(".tmp")
    colonne = ["file", "folder", "name", "revision", "description", "sha256"]
    with open(tmp, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(colonne)
        for r in righe:
            w.writerow([vt.csv_cell(r[c]) for c in colonne])
    os.replace(tmp, manifest)
    return d, manifest, righe


# --------------------------------------------------------------------------- archiviazione nel DMS aziendale

class ScritturaDms:
    """
    Client del DMS (SeedDMS restapi) per i soli mezzi: separato da estrai_dms.LetturaSicura, che resta in sola lettura.
    Ammesse: login/logout, letture di cartelle, creazione di cartelle, caricamento di documenti e nuove versioni,
    e queste ultime solo nella cartella radice dei mezzi o in cartelle trovate/create sotto di essa.
    """
    AMMESSE = (("POST", r"/login"), ("GET", r"/logout"), ("GET", r"/folder/\d+(?:/children)?"),
               ("POST", r"/folder/\d+/folder"), ("POST", r"/folder/\d+/document"), ("POST", r"/document/\d+/update"))

    def __init__(self, base_url, radice, timeout=120, session=None):
        import estrai_dms
        import requests
        self.base_url = estrai_dms.controlla_url(base_url)
        self.radice = int(radice)
        self.consentite = {self.radice}
        self.timeout = timeout
        self.http = session or requests.Session()
        self.http.headers["User-Agent"] = "vfp-transfer mezzi (archiviazione)"

    def _chiama(self, metodo, path, **kw):
        if not any(metodo == m and re.fullmatch(p, path) for m, p in self.AMMESSE):
            raise MezziError(f"{metodo} {path}: operazione sul DMS non ammessa")
        r = self.http.request(metodo, self.base_url + path, timeout=self.timeout, allow_redirects=False, **kw)
        try:
            body = r.json()
        except ValueError:
            raise MezziError(f"DMS: risposta non valida su {path} (HTTP {r.status_code})")
        return r.status_code, body

    def _dati(self, metodo, path, **kw):
        stato, body = self._chiama(metodo, path, **kw)
        if stato >= 300 or not body.get("success"):
            raise MezziError(f"DMS: {body.get('message') or f'HTTP {stato}'} ({path})")
        return body.get("data")

    def login(self, utente, password):
        stato, body = self._chiama("POST", "/login", data={"user": utente, "pass": password})
        if stato >= 300 or not body.get("success"):
            raise MezziError(f"DMS: accesso rifiutato per {utente}")

    def logout(self):
        try:
            self._chiama("GET", "/logout")
        except Exception:  # uscita di cortesia: la sessione scade comunque
            pass
        self.http.close()

    def _figli(self, folder_id):
        return self._dati("GET", f"/folder/{int(folder_id)}/children") or []

    def cartella(self, percorso):
        """Id della cartella radice/percorso (parti separate da /), creando quelle che mancano."""
        fid = self.radice
        for nome in [p for p in percorso.split("/") if p]:
            trovata = next((int(d["id"]) for d in self._figli(fid) if d.get("type") == "folder" and d.get("name") == nome), None)
            if trovata is None:
                self._dati("POST", f"/folder/{fid}/folder", data={"name": nome, "comment": "creata dalla pagina Mezzi"})
                trovata = next(int(d["id"]) for d in self._figli(fid) if d.get("type") == "folder" and d.get("name") == nome)
            self.consentite.add(trovata)
            fid = trovata
        return fid

    def archivia(self, folder_id, nome, file, commento="", scadenza=""):
        """("creato" | "nuova versione" | "gia' presente", id documento)."""
        if folder_id not in self.consentite:
            raise MezziError("cartella del DMS fuori da quella dei mezzi")
        file = Path(file)
        esistente = next((int(d["id"]) for d in self._figli(folder_id) if d.get("type") == "document" and d.get("name") == nome), None)
        with open(file, "rb") as f:
            if esistente is None:
                dati = {"name": nome, "comment": commento, "origfilename": file.name}
                if scadenza:
                    dati["expdate"] = scadenza  # AAAA-MM-GG: il DMS segnala la scadenza (es. polizza)
                self._dati("POST", f"/folder/{folder_id}/document", data=dati, files={"file": (file.name, f)})
                doc = next(int(d["id"]) for d in self._figli(folder_id) if d.get("type") == "document" and d.get("name") == nome)
                return "creato", doc
            stato, body = self._chiama("POST", f"/document/{esistente}/update",
                                       data={"origfilename": file.name, "comment": commento}, files={"file": (file.name, f)})
        if stato < 300 and body.get("success"):
            return "nuova versione", esistente
        if "identical" in str(body.get("message", "")):
            return "gia' presente", esistente
        raise MezziError(f"DMS: {body.get('message') or f'HTTP {stato}'} ({nome})")


def archivia_nel_dms(s, maschera, pr, rec_id, sessione=None):
    """Documenti del mezzo, contratto compilato e scheda nel DMS aziendale, nella stessa struttura usata per Viewpoint."""
    if not (s.get("DMS_URL") and s.get("DMS_USER") and s.get("DMS_PASSWORD")):
        raise MezziError("DMS non configurato: indirizzo, utente e password del DMS nelle impostazioni")
    rec = pr.leggi(rec_id)
    vuoti = mancanti(maschera, rec.get("valori", {}))
    if vuoti:
        raise MezziError("prima di archiviare completare: " + ", ".join(vuoti))
    righe = righe_dms(maschera, rec, pr._dir(rec_id))
    dms = ScritturaDms(s["DMS_URL"], s.get("DMS_MEZZI_CARTELLA") or 1, session=sessione)
    dms.login(s["DMS_USER"], s["DMS_PASSWORD"])
    esiti = []
    try:
        cartelle = {}
        for r in righe:
            voce = {"nome": r["name"], "cartella": r["folder"], "file": Path(r["file"]).name}
            try:
                if r["folder"] not in cartelle:
                    cartelle[r["folder"]] = dms.cartella(r["folder"])
                voce["esito"], voce["id"] = dms.archivia(cartelle[r["folder"]], r["name"], r["file"], r["description"],
                                                         r.get("scadenza", ""))
            except (MezziError, OSError) as e:
                voce.update(esito="errore", errore=str(e))
            esiti.append(voce)
    finally:
        dms.logout()
    log.info("Pratica mezzo %s nel DMS: %s", rec_id, ", ".join(f"{v['nome']}={v['esito']}" for v in esiti))
    return pr.segna_dms(rec_id, {"data": datetime.now().isoformat(timespec="seconds"), "esiti": esiti})


def documenti_mancanti(maschera, rec):
    """Documenti obbligatori della maschera non ancora allegati (avviso, non blocca il caricamento)."""
    presenti = {x["tipo"] for x in rec.get("documenti", [])} | ({"contratto"} if rec.get("contratto") else set())
    return [d["nome"] for d in maschera["dms"]["documenti"] if d.get("obbligatorio") and d["id"] not in presenti]


# --------------------------------------------------------------------------- CLI di prova

def main():
    p = argparse.ArgumentParser(description="Mezzi a nolo: maschera unica per contratto e documentazione in Viewpoint.")
    p.add_argument("azione", choices=("elenco", "aree"))
    p.add_argument("--modello", help="modello .docx: relativo alla cartella condivisa dei modelli, oppure assoluto")
    p.add_argument("--pratica", help="id della pratica da cui prendere i dati (facoltativo)")
    p.add_argument("--env", default=None)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s = env_config.load_settings(args.env or env_config.ENV_PATH)
    try:
        maschera = carica_maschera(s)
        pr = pratiche(s)
        if args.azione == "elenco":
            for r in pr.elenco():
                print(f"  {r['id']}  {r['mezzo']:<40} {r['matricola']:<18} {r['proprietaria']}")
            return
        if not args.modello:
            raise MezziError("indicare --modello")
        rec = pr.leggi(args.pratica) if args.pratica else {"valori": {}}
        info = anteprima_contratto(s, maschera, rec, args.modello)
        print(f"\n{args.modello}: protezione {info['protezione'] or 'NON attiva'}, {len(info['aree'])} aree gialle")
        for a in info["aree"]:
            print(f"\n  [{a['id']}] dopo: ...{a['prima'][-60:]}")
            print(f"      ora:   {a['testo'][:110]!r}")
            print(f"      nuovo: {a['nuovo'][:110]!r}  ({a['regola']})" if a["nuovo"] is not None else "      nessuna regola")
    except (MezziError, moduli.ModuloError, modelli_protetti.ModelloError) as e:
        raise SystemExit(f"Errore: {e}")


if __name__ == "__main__":
    main()
