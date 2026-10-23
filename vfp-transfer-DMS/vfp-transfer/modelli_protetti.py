# "><(((º> sabusabu <º)))><"
"""
Modelli Word protetti (es. contratti di trasporto): il documento e' bloccato ("Limita modifica" in sola lettura)
tranne le aree consentite, che Word mostra con il fondo giallo. Si compilano solo quelle aree.

Gli originali stanno in una cartella condivisa in sola lettura (MODELLI_SORGENTE): li' non si scrive mai.
Ogni pratica e' una cartella interna MODELLI_LAVORO/<id>/ con:
  originale_<nome>.docx  copia intatta dell'originale (con la sua impronta SHA-256 nel record)
  <nome>.docx            copia compilata, rifatta ogni volta dall'originale con tutti i valori della pratica
  record.json            origine, impronta, valori delle aree, utente, date

Nel file .docx un'area consentita e' il tratto tra <w:permStart w:id="N"/> e <w:permEnd w:id="N"/>. Si cambia
solo il testo dei <w:t> in quel tratto (minima differenza: la formattazione delle parti non toccate resta), poi si
controlla che il testo fuori dalle aree e tutte le altre parti del file siano identici all'originale.
I .doc (Word 97-2003) non si gestiscono: la conversione senza Word perde le aree consentite. Vanno salvati in .docx.

Prova da riga di comando:
  python modelli_protetti.py elenco
  python modelli_protetti.py aree --file contratto.docx
  python modelli_protetti.py compila --file contratto.docx --valori valori.json [--utente nome]
  valori.json: {"<id area>": "nuovo testo (una riga per paragrafo)", "<id area>": [["da", "a"], ...]}
"""

import argparse
import hashlib
import html
import json
import logging
import os
import re
import secrets
import shutil
import threading
import zipfile
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

import env_config

log = logging.getLogger("modelli_protetti")

MAX_MB = 50
MAX_XML_MB = 50
_REC_RE = re.compile(r"\d{8}-\d{6}-[0-9a-f]{6}")
_PERM_START = re.compile(r"<w:permStart\b[^>]*?\bw:id=\"(-?\d+)\"[^>]*/>")
_T = re.compile(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>")
_FINE_P = "</w:p>"
_INIZIO_P = re.compile(r"<w:p[\s>]")
_PARTI = re.compile(r"word/(document|header\d*|footer\d*|footnotes|endnotes)\.xml")


class ModelloError(ValueError):
    pass


def cartella_sorgente(s):
    v = (s.get("MODELLI_SORGENTE") or "").strip()
    return Path(v) if v else None


def cartella_lavoro(s):
    return env_config.resolve_path(s.get("MODELLI_LAVORO") or "modelli_compilati")


# --------------------------------------------------------------------------- lettura del .docx

def _apri(path):
    """{nome parte: byte} delle parti con testo, piu' l'elenco delle ZipInfo per riscrivere il file uguale."""
    path = Path(path)
    if path.suffix.lower() == ".doc":
        raise ModelloError(f"{path.name}: formato Word 97-2003 (.doc). Aprirlo in Word e salvarlo come .docx: "
                           "la conversione automatica perde le aree consentite")
    if path.suffix.lower() != ".docx":
        raise ModelloError(f"{path.name}: serve un documento Word .docx")
    if not path.is_file():
        raise ModelloError(f"file non trovato: {path.name}")
    if path.stat().st_size > MAX_MB * 1024 * 1024:
        raise ModelloError(f"{path.name}: piu' di {MAX_MB} MB")
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            dati = {}
            for i in infos:
                if i.file_size > MAX_XML_MB * 1024 * 1024:
                    raise ModelloError(f"{path.name}: parte {i.filename} troppo grande")
                dati[i.filename] = z.read(i)
    except (zipfile.BadZipFile, OSError) as e:
        raise ModelloError(f"{path.name}: DOCX non leggibile ({e.__class__.__name__})")
    if "word/document.xml" not in dati:
        raise ModelloError(f"{path.name}: DOCX senza word/document.xml")
    for nome in dati:
        if _PARTI.fullmatch(nome) or nome == "word/settings.xml":
            if b"<!DOCTYPE" in dati[nome] or b"<!ENTITY" in dati[nome]:
                raise ModelloError(f"{path.name}: DOCX non ammesso (DOCTYPE)")
    return infos, dati


def protezione(settings_xml):
    """'readOnly', 'forms', ... se la protezione e' attiva, altrimenti ''."""
    m = re.search(r"<w:documentProtection\b[^>]*>", settings_xml or "")
    if not m or not re.search(r"w:enforcement=\"(1|true|on)\"", m.group()):
        return ""
    e = re.search(r"w:edit=\"([A-Za-z]+)\"", m.group())
    return e.group(1) if e else "readOnly"


def _aree_parte(xml):
    """[(id, inizio, fine)]: posizioni nel testo XML del tratto tra permStart (escluso) e permEnd (escluso)."""
    out = []
    for m in _PERM_START.finditer(xml):
        fine = re.compile(r"<w:permEnd\b[^>]*?\bw:id=\"" + m.group(1) + r"\"[^>]*/>").search(xml, m.end())
        if not fine:
            raise ModelloError(f"area {m.group(1)} senza fine (permEnd)")
        out.append((m.group(1), m.end(), fine.start()))
    for (a, _, fa), (b, ib, _) in zip(out, out[1:]):
        if ib < fa:
            raise ModelloError(f"aree {a} e {b} sovrapposte: modello non gestito")
    return out


def _paragrafi(xml, inizio, fine):
    """Testi del tratto divisi per paragrafo: [[(inizio_tag, fine_tag, testo), ...], ...]."""
    gruppi = [[]]
    pos = inizio
    for m in _T.finditer(xml, inizio, fine):
        gruppi[-1:] = [gruppi[-1]] + [[] for _ in range(xml.count(_FINE_P, pos, m.start()))]
        gruppi[-1].append((m.start(), m.end(), html.unescape(m.group(1))))
        pos = m.end()
    gruppi[-1:] = [gruppi[-1]] + [[] for _ in range(xml.count(_FINE_P, pos, fine))]
    if len(gruppi) > 1 and not gruppi[-1] and not _dentro_paragrafo(xml, fine):
        gruppi.pop()  # il tratto finisce dopo </w:p>: non c'e' un paragrafo in piu'
    return gruppi


def _testo(gruppi):
    return "\n".join("".join(t for _, _, t in g) for g in gruppi)


def _testo_tutto(xml, inizio=0, fine=None):
    return _testo(_paragrafi(xml, inizio, len(xml) if fine is None else fine))


def _testo_fuori(xml):
    """Testo del documento con le aree consentite tolte: deve restare identico dopo la compilazione."""
    parti, pos = [], 0
    for aid, inizio, fine in _aree_parte(xml):
        parti.append(_testo_tutto(xml, pos, inizio))
        parti.append(f"[area {aid}]")
        pos = fine
    parti.append(_testo_tutto(xml, pos))
    return "".join(parti)


def leggi_aree(path):
    """{"protezione", "aree": [{"id", "parte", "testo", "prima", "paragrafi"}]} nell'ordine del documento."""
    _, dati = _apri(path)
    aree, visti = [], set()
    for nome in sorted((n for n in dati if _PARTI.fullmatch(n)), key=lambda n: (n != "word/document.xml", n)):
        xml = dati[nome].decode("utf-8")
        for aid, inizio, fine in _aree_parte(xml):
            if aid in visti:
                raise ModelloError(f"area {aid} ripetuta: modello non gestito")
            visti.add(aid)
            gruppi = _paragrafi(xml, inizio, fine)
            prima = re.sub(r"\s+", " ", _testo_tutto(xml, max(0, inizio - 4000), inizio)).strip()
            aree.append({"id": aid, "parte": nome, "testo": _testo(gruppi), "prima": prima[-80:],
                         "paragrafi": len(gruppi)})
    return {"protezione": protezione(dati.get("word/settings.xml", b"").decode("utf-8", "replace")), "aree": aree}


# --------------------------------------------------------------------------- scrittura delle aree

def _riscrivi_paragrafo(gruppo, nuovo):
    """Modifiche [(inizio, fine, xml)] per portare il testo del paragrafo a `nuovo`, toccando il minimo."""
    vecchio = "".join(t for _, _, t in gruppo)
    if vecchio == nuovo:
        return []
    if not gruppo:
        raise ModelloError("paragrafo dell'area senza testo da sostituire")
    p = 0
    while p < min(len(vecchio), len(nuovo)) and vecchio[p] == nuovo[p]:
        p += 1
    s = 0
    while s < min(len(vecchio), len(nuovo)) - p and vecchio[-1 - s] == nuovo[-1 - s]:
        s += 1
    tolto_fine = len(vecchio) - s
    # run che riceve il testo nuovo: quello del primo carattere tolto, altrimenti quello prima del punto di inserimento
    pos, dove = 0, 0
    for i, (_, _, t) in enumerate(gruppo):
        if pos <= p < pos + len(t) and p < tolto_fine or (pos < p <= pos + len(t) and p == tolto_fine):
            dove = i
            break
        pos += len(t)
    modifiche, pos = [], 0
    for i, (a, b, t) in enumerate(gruppo):
        da, a_ = max(p, pos) - pos, min(tolto_fine, pos + len(t)) - pos
        t2 = t[:da] + t[max(da, a_):] if da < a_ else t
        if i == dove:
            cut = p - pos
            t2 = t2[:cut] + nuovo[p:len(nuovo) - s] + t2[cut:]
        if t2 != t:
            modifiche.append((a, b, f'<w:t xml:space="preserve">{escape(t2)}</w:t>'))
        pos += len(t)
    return modifiche


def _dentro_paragrafo(xml, pos):
    ultimo_inizio = max((m.start() for m in _INIZIO_P.finditer(xml, 0, pos)), default=-1)
    return ultimo_inizio > xml.rfind(_FINE_P, 0, pos)


def _modifiche_area(xml, aid, inizio, fine, valore):
    gruppi = _paragrafi(xml, inizio, fine)
    vecchie = [("".join(t for _, _, t in g)) for g in gruppi]
    if isinstance(valore, list):  # sostituzioni [[da, a], ...] dentro l'area
        nuove = list(vecchie)
        for coppia in valore:
            if not (isinstance(coppia, (list, tuple)) and len(coppia) == 2 and coppia[0]):
                raise ModelloError(f"area {aid}: sostituzioni come [[\"da\", \"a\"], ...]")
            da, a = str(coppia[0]), str(coppia[1])
            if not any(da in r for r in nuove):
                raise ModelloError(f"area {aid}: testo da sostituire non trovato: {da!r}")
            nuove = [r.replace(da, a) for r in nuove]
    else:
        nuove = str(valore).replace("\r\n", "\n").split("\n")
        if len(nuove) != len(gruppi):
            raise ModelloError(f"area {aid}: ha {len(gruppi)} paragrafi, il testo nuovo {len(nuove)} righe "
                               "(una riga per paragrafo, oppure usare le sostituzioni)")
    if any("\n" in r for r in nuove):
        raise ModelloError(f"area {aid}: una sostituzione non puo' aggiungere paragrafi")
    if not any(gruppi) and nuove[0]:
        # area vuota (es. dopo "l'Impresa"): un run nuovo subito dopo permStart, se l'area sta dentro un paragrafo
        if len(gruppi) != 1 or not _dentro_paragrafo(xml, inizio):
            raise ModelloError(f"area {aid}: area vuota fuori da un paragrafo, da compilare in Word")
        return [(inizio, inizio, f'<w:r><w:t xml:space="preserve">{escape(nuove[0])}</w:t></w:r>')]
    modifiche = []
    for g, nuovo in zip(gruppi, nuove):
        try:
            modifiche += _riscrivi_paragrafo(g, nuovo)
        except ModelloError as e:
            raise ModelloError(f"area {aid}: {e}")
    return modifiche


def compila_file(origine, dest, valori):
    """Scrive in dest la copia di origine con le aree compilate. Restituisce gli id delle aree cambiate."""
    origine, dest = Path(origine), Path(dest)
    if origine.resolve() == dest.resolve():
        raise ModelloError("il file compilato non puo' sostituire l'originale")
    infos, dati = _apri(origine)
    valori = {str(k): v for k, v in (valori or {}).items()}
    nuovi, cambiate, trovate = {}, [], set()
    for nome in dati:
        if not _PARTI.fullmatch(nome):
            continue
        xml = dati[nome].decode("utf-8")
        modifiche = []
        for aid, inizio, fine in _aree_parte(xml):
            trovate.add(aid)
            if aid in valori:
                m = _modifiche_area(xml, aid, inizio, fine, valori[aid])
                if m:
                    cambiate.append(aid)
                modifiche += m
        if not modifiche:
            continue
        nuovo = xml
        for a, b, testo in sorted(modifiche, reverse=True):
            nuovo = nuovo[:a] + testo + nuovo[b:]
        if _testo_fuori(nuovo) != _testo_fuori(xml):  # garanzia: fuori dalle aree non cambia nulla
            raise ModelloError(f"{nome}: la compilazione cambierebbe testo fuori dalle aree consentite")
        nuovi[nome] = nuovo.encode("utf-8")
    sconosciute = sorted(set(valori) - trovate)
    if sconosciute:
        raise ModelloError("aree inesistenti nel modello: " + ", ".join(sconosciute))
    tmp = dest.with_name(dest.name + ".tmp")
    with zipfile.ZipFile(tmp, "w") as z:
        for info in infos:  # stesse parti, stesso ordine e compressione: cambiano solo quelle con aree compilate
            z.writestr(info, nuovi.get(info.filename, dati[info.filename]))
    os.replace(tmp, dest)
    return cambiate


# --------------------------------------------------------------------------- cartella condivisa e pratiche

def elenco_modelli(s, max_file=500, profondita=6):
    """Modelli nella cartella condivisa: [{"rel", "byte", "gestito"}] (i .doc compaiono ma non sono gestiti)."""
    root = cartella_sorgente(s)
    if not root:
        raise ModelloError("cartella dei modelli non impostata (MODELLI_SORGENTE)")
    if not root.is_dir():
        raise ModelloError(f"cartella dei modelli non raggiungibile: {root}")
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        d = Path(dirpath)
        if len(d.relative_to(root).parts) >= profondita:
            dirnames[:] = []
        dirnames[:] = sorted(n for n in dirnames if not n.startswith("."))
        for n in sorted(filenames):
            ext = Path(n).suffix.lower()
            if ext in (".docx", ".doc") and not n.startswith(("~$", ".")):
                p = d / n
                out.append({"rel": p.relative_to(root).as_posix(), "byte": p.stat().st_size, "gestito": ext == ".docx"})
                if len(out) >= max_file:
                    return out
    return out


def _sotto(figlio, padre):
    try:
        Path(figlio).resolve().relative_to(Path(padre).resolve())
        return True
    except ValueError:
        return False


def risolvi_modello(s, nome):
    """Percorso del modello: relativo alla cartella condivisa (senza uscirne) oppure assoluto (riga di comando)."""
    p = Path(nome)
    if p.is_absolute():
        return p
    root = cartella_sorgente(s)
    if not root:
        raise ModelloError("cartella dei modelli non impostata (MODELLI_SORGENTE)")
    p = root / p
    if not _sotto(p, root):
        raise ModelloError("percorso fuori dalla cartella dei modelli")
    return p


def _scrivi_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


class Pratiche:
    """Copie di lavoro dei modelli: MODELLI_LAVORO/<id>/ (originale intatto + copia compilata + record.json)."""

    def __init__(self, base, sorgente=None):
        self.base = Path(base)
        self.sorgente = Path(sorgente) if sorgente else None
        self._lock = threading.Lock()
        if self.sorgente and _sotto(self.base, self.sorgente):
            raise ModelloError("la cartella di lavoro non puo' stare dentro la cartella condivisa dei modelli")

    def _dir(self, rec_id):
        if not _REC_RE.fullmatch(rec_id or ""):
            raise ModelloError("identificativo della pratica non valido")
        return self.base / rec_id

    def nuova(self, origine, utente=""):
        """Copia il modello nella cartella interna (in sola lettura sull'originale) e ne legge le aree."""
        origine = Path(origine)
        info = leggi_aree(origine)  # controlla formato e aree prima di copiare
        if not info["aree"]:
            raise ModelloError(f"{origine.name}: nessuna area consentita (fondo giallo) nel documento")
        import estrai_dms
        nome = estrai_dms.nome_sicuro(origine.name)
        rec_id = f"{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(3)}"
        d = self._dir(rec_id)
        d.mkdir(parents=True)
        copia = d / f"originale_{nome}"
        shutil.copyfile(origine, copia)  # copyfile: non porta con se' l'attributo di sola lettura
        impronta = hashlib.sha256(copia.read_bytes()).hexdigest()
        if impronta != hashlib.sha256(origine.read_bytes()).hexdigest():
            raise ModelloError(f"{origine.name}: copia diversa dall'originale, riprovare")
        rec = {"id": rec_id, "stato": "bozza", "creato": datetime.now().isoformat(timespec="seconds"), "aggiornato": "",
               "utente": utente, "origine": {"file": str(origine), "nome_file": origine.name, "sha256": impronta},
               "originale": copia.name, "compilato": nome, "protezione": info["protezione"], "valori": {},
               "aree_cambiate": []}
        compila_file(copia, d / nome, {})
        with self._lock:
            _scrivi_json(d / "record.json", rec)
        log.info("Pratica %s da %s (%s aree)", rec_id, origine.name, len(info["aree"]))
        return rec

    def leggi(self, rec_id):
        p = self._dir(rec_id) / "record.json"
        if not p.is_file():
            raise ModelloError("pratica non trovata")
        return json.loads(p.read_text(encoding="utf-8"))

    def aree(self, rec_id):
        """Aree della copia compilata (testo attuale)."""
        rec = self.leggi(rec_id)
        return leggi_aree(self._dir(rec_id) / rec["compilato"])

    def compila(self, rec_id, valori, utente=""):
        """Aggiunge i valori a quelli della pratica e rifa' la copia compilata partendo dall'originale intatto."""
        with self._lock:
            rec = self.leggi(rec_id)
            d = self._dir(rec_id)
            originale = d / rec["originale"]
            if hashlib.sha256(originale.read_bytes()).hexdigest() != rec["origine"]["sha256"]:
                raise ModelloError("la copia dell'originale e' stata modificata: creare una nuova pratica")
            tutti = {**rec["valori"], **{str(k): v for k, v in (valori or {}).items()}}
            rec["aree_cambiate"] = compila_file(originale, d / rec["compilato"], tutti)
            rec.update(valori=tutti, aggiornato=datetime.now().isoformat(timespec="seconds"),
                       utente=utente or rec.get("utente", ""))
            _scrivi_json(d / "record.json", rec)
            return rec

    def elenco(self, limite=200):
        out = []
        if not self.base.is_dir():
            return out
        for d in sorted((d for d in self.base.iterdir() if _REC_RE.fullmatch(d.name)), reverse=True)[:limite]:
            try:
                r = json.loads((d / "record.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            out.append({k: r.get(k) for k in ("id", "stato", "creato", "aggiornato", "utente", "compilato")} |
                       {"nome_file": r["origine"].get("nome_file"), "aree_cambiate": len(r.get("aree_cambiate", []))})
        return out


def pratiche(s):
    return Pratiche(cartella_lavoro(s), cartella_sorgente(s))


# --------------------------------------------------------------------------- CLI di prova

def main():
    p = argparse.ArgumentParser(description="Modelli Word protetti: si compilano solo le aree consentite (fondo giallo).")
    p.add_argument("azione", choices=("elenco", "aree", "compila"))
    p.add_argument("--file", help="modello: percorso relativo alla cartella condivisa, oppure assoluto")
    p.add_argument("--valori", help="file JSON {id area: testo oppure [[da, a], ...]}")
    p.add_argument("--utente", default="")
    p.add_argument("--env", default=None)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s = env_config.load_settings(args.env or env_config.ENV_PATH)
    try:
        if args.azione == "elenco":
            for m in elenco_modelli(s):
                print(f"  {m['rel']}" + ("" if m["gestito"] else "   (.doc: salvarlo come .docx)"))
            return
        if not args.file:
            raise ModelloError("indicare --file")
        modello = risolvi_modello(s, args.file)
        if args.azione == "aree":
            info = leggi_aree(modello)
            print(f"\n{modello.name}: protezione {info['protezione'] or 'NON attiva'}, {len(info['aree'])} aree consentite")
            for a in info["aree"]:
                testo = a["testo"].replace("\n", " / ")
                print(f"\n  [{a['id']}] dopo: ...{a['prima'][-50:]}\n      {a['paragrafi']} par.: "
                      f"{testo[:120]}{'...' if len(testo) > 120 else ''}")
            return
        if not args.valori:
            raise ModelloError("indicare --valori")
        valori = json.loads(Path(args.valori).read_text(encoding="utf-8"))
        pr = pratiche(s)
        rec = pr.nuova(modello, args.utente)
        rec = pr.compila(rec["id"], valori, args.utente)
        print(f"\nPratica {rec['id']}: {len(rec['aree_cambiate'])} aree compilate")
        print(f"File compilato: {pr.base / rec['id'] / rec['compilato']}")
    except (ModelloError, ValueError) as e:
        raise SystemExit(f"Errore: {e}")


if __name__ == "__main__":
    main()
