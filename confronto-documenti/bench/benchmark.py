# "><(((º> sabusabu <º)))><"
"""
Banco di prova dell'affidabilità di Confronto Documenti.

Genera coppie di documenti di cantiere sintetici (computo metrico, capitolato,
contratto) con differenze NOTE inserite apposta nel documento B, li produce
come PDF nativo (testo selezionabile) e come scansioni simulate (buona e
scadente), li confronta con lo stesso motore dell'app (collect_texts ->
align_pages -> apply_ignore -> line_ops) e misura:

  - differenze vere trovate (recall), anche per tipo di modifica;
  - segnalazioni finte (righe segnalate che non corrispondono a nessuna
    modifica vera) e pagine identiche segnalate per errore;
  - modifiche "critiche" perse (numeri, date, negazioni, codici).

Uso (dalla cartella confronto-documenti, con il .venv dell'app):
    .venv\\Scripts\\python.exe bench\\benchmark.py               # completo
    .venv\\Scripts\\python.exe bench\\benchmark.py --coppie 4    # rapido
Il report va in bench/risultati.md (e .json). La cache OCR del banco è
separata da quella dell'app (cartella di lavoro temporanea).
"""

import argparse
import difflib
import io
import json
import random
import re
import sys
import tempfile
import time
from pathlib import Path

import pymupdf as fitz
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import confronta_pdf as c  # noqa: E402

# --------------------------------------------------------------------------
# Contenuti sintetici
# --------------------------------------------------------------------------

LAVORAZIONI = [
    ("Scavo di sbancamento in terreno di qualsiasi natura", "m³"),
    ("Scavo a sezione obbligata per fondazioni continue", "m³"),
    ("Rinterro con materiale proveniente dagli scavi", "m³"),
    ("Calcestruzzo per fondazioni classe C25/30", "m³"),
    ("Calcestruzzo per strutture in elevazione C30/37", "m³"),
    ("Acciaio in barre per armature B450C", "kg"),
    ("Casseforme in legname per getti in opera", "m²"),
    ("Muratura in blocchi di laterizio spessore 30 cm", "m²"),
    ("Intonaco civile per interni a tre strati", "m²"),
    ("Massetto in sabbia e cemento spessore 6 cm", "m²"),
    ("Pavimento in gres porcellanato 30x60", "m²"),
    ("Impermeabilizzazione con guaina bituminosa", "m²"),
    ("Isolamento termico in pannelli EPS 12 cm", "m²"),
    ("Tubazione in PVC per scarichi diametro 125", "m"),
    ("Pozzetto prefabbricato in cls 60x60", "cad"),
    ("Cordolo in calcestruzzo armato per recinzione", "m"),
    ("Tinteggiatura con idropittura traspirante", "m²"),
    ("Serramento in alluminio a taglio termico", "m²"),
    ("Ponteggio metallico fisso compreso montaggio", "m²"),
    ("Trasporto a discarica di materiale di risulta", "t"),
]

FRASI = [
    "L'appaltatore è tenuto a eseguire le opere secondo le prescrizioni del presente capitolato.",
    "Tutti i materiali devono essere accompagnati dalla documentazione di qualità del produttore.",
    "La direzione lavori può ordinare prove sui materiali a carico dell'impresa.",
    "Gli oneri per la sicurezza non sono soggetti a ribasso d'asta.",
    "Il cantiere deve essere recintato e segnalato per tutta la durata dei lavori.",
    "Le lavorazioni rumorose sono consentite dalle ore 8 alle ore 18 dei giorni feriali.",
    "L'impresa deve mantenere pulite le aree di cantiere e le strade di accesso.",
    "Eventuali varianti devono essere autorizzate per iscritto dal committente.",
    "Il getto del calcestruzzo non può avvenire con temperature inferiori a 5 gradi.",
    "La consegna dei lavori risulta da apposito verbale sottoscritto dalle parti.",
    "Il ritardo nell'ultimazione comporta una penale giornaliera pari all'uno per mille.",
    "I pagamenti avvengono per stati di avanzamento al raggiungimento delle soglie previste.",
    "La ritenuta di garanzia è svincolata dopo l'approvazione del collaudo.",
    "L'appaltatore risponde dei danni causati a persone o cose durante l'esecuzione.",
    "Le misurazioni sono eseguite in contraddittorio tra direzione lavori e impresa.",
    "I rifiuti prodotti devono essere smaltiti secondo la normativa vigente.",
    "Il subappalto è ammesso nei limiti fissati dal codice dei contratti.",
    "Le opere provvisionali restano a carico dell'impresa esecutrice.",
    "Il personale impiegato deve essere munito di tessera di riconoscimento.",
    "La documentazione as built va consegnata entro trenta giorni dalla fine lavori.",
    "Le prove di carico sui solai sono eseguite alla presenza del collaudatore.",
    "Il committente può sospendere i lavori per ragioni di pubblico interesse.",
    "Il programma esecutivo deve essere aggiornato a ogni variazione sostanziale.",
    "L'impresa deve garantire la continuità dei servizi esistenti nelle aree interessate.",
]

TITOLI = [
    "Oneri a carico dell'appaltatore", "Qualità dei materiali", "Sicurezza in cantiere",
    "Tempi di esecuzione", "Pagamenti e garanzie", "Collaudo delle opere",
    "Varianti in corso d'opera", "Penali", "Subappalto", "Responsabilità e danni",
]

SOSTITUZIONI = [  # parola -> sostituta plausibile (cambio di significato)
    ("calcestruzzo", "conglomerato"), ("impresa", "ditta"), ("scritto", "voce"),
    ("giorni", "settimane"), ("committente", "progettista"), ("trenta", "sessanta"),
    ("collaudo", "certificato"), ("feriali", "festivi"), ("laterizio", "cemento"),
    ("alluminio", "PVC"), ("interni", "esterni"), ("fondazioni", "elevazioni"),
    ("8", "7"), ("18", "20"), ("tessera", "divisa"), ("pulite", "sgombre"),
]


def _euro(x: float) -> str:
    s = f"{x:,.2f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def pagina_computo(rnd: random.Random, n: int) -> list[str]:
    righe = [f"COMPUTO METRICO ESTIMATIVO - Lotto {rnd.randint(1, 9)}",
             f"Commessa {rnd.randint(2020, 2026)}/{rnd.randint(10, 99)} - foglio {n}", ""]
    tot = 0.0
    for k in rnd.sample(range(len(LAVORAZIONI)), 14):
        desc, um = LAVORAZIONI[k]
        q = round(rnd.uniform(5, 900), 2)
        p = round(rnd.uniform(3, 180), 2)
        imp = round(q * p, 2)
        tot += imp
        codice = f"{rnd.choice('ABCE')}.{rnd.randint(1, 20):02d}.{rnd.randint(1, 120):03d}"
        righe.append(f"{codice} {desc}")
        righe.append(f"{um} {_euro(q)} x {_euro(p)} = {_euro(imp)}")
    righe += ["", f"Totale foglio {n}: euro {_euro(tot)}"]
    return righe


def _wrap(testo: str, larg: int = 88) -> list[str]:
    out, cur = [], ""
    for w in testo.split():
        if cur and len(cur) + 1 + len(w) > larg:
            out.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        out.append(cur)
    return out


def pagina_capitolato(rnd: random.Random, n: int) -> list[str]:
    righe = [f"CAPITOLATO SPECIALE D'APPALTO - parte {n}", ""]
    for t in rnd.sample(TITOLI, 4):
        righe.append(f"Art. {rnd.randint(1, 60)} - {t}")
        righe += _wrap(" ".join(rnd.sample(FRASI, 3)))
        righe.append("")
    return righe


def pagina_contratto(rnd: random.Random, n: int) -> list[str]:
    g, m, a = rnd.randint(1, 28), rnd.randint(1, 12), rnd.randint(2024, 2026)
    righe = [f"CONTRATTO DI APPALTO N. {rnd.randint(100, 999)}/{a}", "",
             f"Stipulato in data {g:02d}/{m:02d}/{a} tra il committente e l'impresa esecutrice.",
             f"Importo dei lavori a corpo: euro {_euro(rnd.uniform(50_000, 2_000_000))}",
             f"Oneri per la sicurezza: euro {_euro(rnd.uniform(2_000, 60_000))}",
             f"Durata dei lavori: {rnd.choice([90, 120, 180, 240, 365])} giorni naturali e consecutivi.",
             f"Inizio lavori previsto il {rnd.randint(1, 28):02d}/{rnd.randint(1, 12):02d}/{a}.", ""]
    righe += _wrap(" ".join(rnd.sample(FRASI, 6)))
    righe += ["", f"Penale per ritardo: euro {_euro(rnd.uniform(100, 2000))} per ogni giorno.",
              f"Cauzione definitiva pari al {rnd.randint(5, 10)} per cento dell'importo.", ""]
    righe += _wrap(" ".join(rnd.sample(FRASI, 5)))
    return righe


GENERATORI = [pagina_computo, pagina_capitolato, pagina_contratto]

# --------------------------------------------------------------------------
# Modifiche note (verità di riferimento)
# --------------------------------------------------------------------------

def _cambia_cifra(riga: str, rnd: random.Random) -> str | None:
    pos = [m.start() for m in re.finditer(r"\d", riga)]
    if not pos:
        return None
    i = rnd.choice(pos)
    nuova = rnd.choice([d for d in "0123456789" if d != riga[i]])
    return riga[:i] + nuova + riga[i + 1:]


def modifica(tipo: str, riga: str, rnd: random.Random) -> str | None:
    """Ritorna la riga modificata, o None se il tipo non si applica."""
    if tipo == "numero":
        if not re.search(r"\d+,\d\d", riga):
            return None
        return _cambia_cifra(riga, rnd)
    if tipo == "data":
        m = re.search(r"\b(\d\d)/(\d\d)/(\d{4})\b", riga)
        if not m:
            return None
        g = (int(m.group(1)) % 27) + 1
        return riga[:m.start(1)] + f"{g:02d}" + riga[m.end(1):]
    if tipo == "codice":
        m = re.match(r"([ABCE])\.(\d\d)\.(\d{3}) ", riga)
        if not m:
            return None
        return f"{m.group(1)}.{m.group(2)}.{(int(m.group(3)) % 119) + 1:03d}" + riga[m.end() - 1:]
    if tipo == "negazione":
        for a, b in ((" è tenuto", " non è tenuto"), (" non sono", " sono"),
                     (" deve ", " non deve "), (" non può", " può"), (" può ", " non può ")):
            if a in riga:
                return riga.replace(a, b, 1)
        return None
    if tipo == "parola":
        cand = [(a, b) for a, b in SOSTITUZIONI if re.search(rf"\b{re.escape(a)}\b", riga)]
        if not cand:
            return None
        a, b = rnd.choice(cand)
        return re.sub(rf"\b{re.escape(a)}\b", b, riga, count=1)
    raise ValueError(tipo)


TIPI_RIGA = ["numero", "numero", "parola", "negazione", "data", "codice"]
CRITICI = {"numero", "data", "negazione", "codice"}


def genera_coppia(seed: int, n_pag: int, n_mod: int, aggiungi_pagina: bool):
    rnd = random.Random(seed)
    pagine_a = [rnd.choice(GENERATORI)(rnd, i + 1) for i in range(n_pag)]
    pagine_b = [list(p) for p in pagine_a]
    verita = []
    usate = set()
    tentativi = 0
    while len(verita) < n_mod and tentativi < 2000:
        tentativi += 1
        pi = rnd.randrange(n_pag)
        righe = pagine_b[pi]
        li = rnd.randrange(len(righe))
        if (pi, li) in usate or not righe[li].strip():
            continue
        tipo = rnd.choice(TIPI_RIGA + ["riga_tolta", "riga_aggiunta"])
        if tipo == "riga_tolta":
            if righe[li].startswith(("COMPUTO", "CAPITOLATO", "CONTRATTO")):
                continue
            verita.append({"tipo": tipo, "pag_a": pi, "a": righe[li], "b": None})
            righe[li] = None  # tolta dopo, per non spostare gli indici
        elif tipo == "riga_aggiunta":
            nuova = rnd.choice(FRASI)
            if any(nuova == r for r in righe if r):
                continue
            verita.append({"tipo": tipo, "pag_a": pi, "a": None, "b": nuova})
            righe[li] = (righe[li], nuova)  # inserita dopo la riga li
        else:
            if not isinstance(righe[li], str):
                continue
            nuova = modifica(tipo, righe[li], rnd)
            if nuova is None or nuova == righe[li]:
                continue
            verita.append({"tipo": tipo, "pag_a": pi, "a": righe[li], "b": nuova})
            righe[li] = nuova
        usate.add((pi, li))
    # applica tolte/aggiunte
    finali_b = []
    for righe in pagine_b:
        out = []
        for r in righe:
            if r is None:
                continue
            if isinstance(r, tuple):
                out += [r[0], r[1]]
            else:
                out.append(r)
        finali_b.append(out)
    if aggiungi_pagina:
        pos = rnd.randrange(1, n_pag)
        extra = pagina_capitolato(rnd, 99)
        finali_b.insert(pos, extra)
        verita.append({"tipo": "pagina_aggiunta", "pag_b": pos, "a": None, "b": None})
    return pagine_a, finali_b, verita

# --------------------------------------------------------------------------
# Produzione PDF: nativo e scansioni simulate
# --------------------------------------------------------------------------

def pdf_nativo(pagine: list[list[str]], path: Path):
    doc = fitz.open()
    for righe in pagine:
        pg = doc.new_page(width=595, height=842)
        y = 60
        for r in righe:
            if r:
                pg.insert_text((50, y), r, fontsize=9.5, fontname="helv")
            y += 15.5
    doc.save(path)
    doc.close()


SCANSIONI = {
    # dpi di "scansione", rotazione max, sfocatura, rumore, contrasto, jpeg
    "scansione_buona":   dict(dpi=300, rot=0.4, blur=0.5, noise=6, contrast=0.95, jpeg=88, macchie=0),
    "scansione_scarsa":  dict(dpi=200, rot=1.6, blur=1.1, noise=20, contrast=0.70, jpeg=50, macchie=400),
}


def degrada(img: Image.Image, p: dict, rnd: random.Random) -> Image.Image:
    g = img.convert("L")
    g = g.rotate(rnd.uniform(-p["rot"], p["rot"]), resample=Image.BICUBIC, expand=False, fillcolor=255)
    if p["blur"]:
        g = g.filter(ImageFilter.GaussianBlur(p["blur"]))
    a = np.asarray(g).astype(np.float32)
    a = 255 - (255 - a) * p["contrast"]          # inchiostro sbiadito
    a += np.random.default_rng(rnd.randrange(1 << 30)).normal(0, p["noise"], a.shape)
    if p["macchie"]:
        rng = np.random.default_rng(rnd.randrange(1 << 30))
        ys = rng.integers(0, a.shape[0], p["macchie"])
        xs = rng.integers(0, a.shape[1], p["macchie"])
        a[ys, xs] = rng.integers(0, 120, p["macchie"])
    g = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    g.save(buf, "JPEG", quality=p["jpeg"])
    return Image.open(io.BytesIO(buf.getvalue()))


def pdf_scansione(nativo: Path, path: Path, p: dict, rnd: random.Random):
    src = fitz.open(nativo)
    out = fitz.open()
    for pg in src:
        pix = pg.get_pixmap(dpi=p["dpi"])
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        img = degrada(img, p, rnd)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=p["jpeg"])
        np_ = out.new_page(width=pg.rect.width, height=pg.rect.height)
        np_.insert_image(np_.rect, stream=buf.getvalue())
    out.save(path)
    out.close()
    src.close()

# --------------------------------------------------------------------------
# Confronto con il motore dell'app e valutazione
# --------------------------------------------------------------------------

def _norm(s: str) -> str:
    return " ".join(s.lower().split())


def _sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(a=_norm(a), b=_norm(b), autojunk=False).ratio()


def confronta(pa: Path, pb: Path, dpi: int, tolerant: bool, preprocess: bool):
    """Stesso flusso di server.py/_run_job, restituisce le segnalazioni."""
    da, db = c.open_document(pa), c.open_document(pb)
    ta, _ = c.collect_texts(da, "tesseract", dpi=dpi, lang="ita+eng", preprocess=preprocess)
    tb, _ = c.collect_texts(db, "tesseract", dpi=dpi, lang="ita+eng", preprocess=preprocess)
    segn = []
    # come l'app con "Ignora intestazioni ripetute" acceso (default)
    ra = [c.normalize_lines(t) for t in ta]
    rb = [c.normalize_lines(t) for t in tb]
    chiavi = c.righe_ripetute(ra, rb)
    for ia, ib in c.align_pages(ta, tb, tolerant=tolerant):
        if ia is None or ib is None:
            segn.append({"pagina": True, "pag_a": ia, "pag_b": ib, "a": "", "b": "", "incerta": False})
            continue
        ops = c.line_ops(c.togli_ripetute(ra[ia], chiavi)[0], c.togli_ripetute(rb[ib], chiavi)[0],
                         tolerant=tolerant)
        for op in ops:
            if op["type"] in ("equal", "moved"):   # spostata = stesso testo
                continue
            if op["type"] == "change":
                a = " ".join(s["s"] for s in op["a"])
                b = " ".join(s["s"] for s in op["b"])
                # parole evidenziate come cambiate (quelle che l'utente vede)
                da = " ".join(s["s"] for s in op["a"] if not s["eq"])
                dbb = " ".join(s["s"] for s in op["b"] if not s["eq"])
            else:
                a = op["text"] if op["type"] == "del" else ""
                b = op["text"] if op["type"] == "add" else ""
                da, dbb = a, b
            segn.append({"pagina": False, "pag_a": ia, "pag_b": ib, "a": a, "b": b,
                         "diff_a": da, "diff_b": dbb, "incerta": bool(op.get("incerta"))})
    return segn, len(ta)


SOGLIA = 0.72   # somiglianza minima tra riga segnalata e riga modificata


def _parole_cambiate(a: str, b: str) -> tuple[list[str], list[str]]:
    """Parole che differiscono tra la riga originale e quella modificata."""
    aw, bw = a.split(), b.split()
    sa, sb = [], []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=aw, b=bw, autojunk=False).get_opcodes():
        if tag != "equal":
            sa += aw[i1:i2]
            sb += bw[j1:j2]
    return sa, sb


def _colpita(parole: list[str], evidenziato: str) -> bool:
    """True se una delle parole cambiate compare (anche letta male) tra quelle
    evidenziate: la differenza è segnalata proprio dove sta, non per caso."""
    ev = evidenziato.split()
    return any(_sim(p, w) >= 0.7 for p in parole for w in ev)


def valuta(segn: list[dict], verita: list[dict], n_pag_a: int) -> dict:
    """Abbina segnalazioni e modifiche vere. Una modifica trovata solo da
    segnalazioni "incerte" (grigie nel report) conta come trovata_incerta: è
    visibile ma declassata, quindi un difetto da tenere a zero."""
    trovate = [False] * len(verita)
    certe = [False] * len(verita)
    usata = [False] * len(segn)
    for vi, v in enumerate(verita):
        if v["tipo"] == "pagina_aggiunta":
            for si, s in enumerate(segn):
                if s["pagina"] and s["pag_a"] is None and s["pag_b"] == v["pag_b"]:
                    trovate[vi] = certe[vi] = usata[si] = True
            continue
        for si, s in enumerate(segn):
            if s["pagina"] or s["pag_a"] != v["pag_a"]:
                continue
            ok = ((v["a"] and s["a"] and _sim(s["a"], v["a"]) >= SOGLIA) or
                  (v["b"] and s["b"] and _sim(s["b"], v["b"]) >= SOGLIA))
            if ok and v["a"] and v["b"]:   # riga modificata: deve colpire le parole cambiate
                pa, pb = _parole_cambiate(v["a"], v["b"])
                ok = _colpita(pa, s["diff_a"]) or _colpita(pb, s["diff_b"])
            if ok:
                trovate[vi] = usata[si] = True
                certe[vi] = certe[vi] or not s["incerta"]
    # pagine aggiunte: le righe interne non sono "finte"
    pag_extra = {v["pag_b"] for v in verita if v["tipo"] == "pagina_aggiunta"}
    libere = [s for si, s in enumerate(segn) if not usata[si] and s["pag_b"] not in pag_extra]
    finte = [s for s in libere if not s["incerta"]]
    return {
        "verita": [dict(v, trovata=t, trovata_incerta=t and not ce)
                   for v, t, ce in zip(verita, trovate, certe)],
        "finte": len(finte),
        "finte_incerte": len(libere) - len(finte),
        "esempi_finte": [(s["a"], s["b"]) for s in finte[:4]],
        "pagine": n_pag_a,
    }

# --------------------------------------------------------------------------
# Esecuzione
# --------------------------------------------------------------------------

CONFIG = [  # (variante, dpi, tollerante, migliora scansioni)
    ("nativo", 200, False, True),
    ("nativo", 200, True, True),
    ("scansione_buona", 200, False, True),
    ("scansione_buona", 200, True, True),
    ("scansione_buona", 300, True, True),
    ("scansione_scarsa", 200, False, True),
    ("scansione_scarsa", 200, True, True),
    ("scansione_scarsa", 300, False, True),
    ("scansione_scarsa", 300, True, True),
    ("scansione_scarsa", 300, True, False),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--coppie", type=int, default=12)
    ap.add_argument("--pagine", type=int, default=3)
    ap.add_argument("--modifiche", type=int, default=8, help="modifiche per coppia")
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--lavoro", type=Path, default=None, help="cartella di lavoro (default: temporanea)")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "risultati")
    ap.add_argument("--solo-nativi", action="store_true",
                    help="solo PDF nativi: niente OCR, pochi secondi (per la CI)")
    ap.add_argument("--verifica", action="store_true",
                    help="esce con errore se sui PDF nativi una modifica vera è persa "
                         "o compare una segnalazione finta")
    args = ap.parse_args()

    lavoro = args.lavoro or Path(tempfile.mkdtemp(prefix="bench_confronto_"))
    lavoro.mkdir(parents=True, exist_ok=True)
    print(f"Cartella di lavoro: {lavoro}")

    coppie = []
    for k in range(args.coppie):
        pa_, pb_, ver = genera_coppia(args.seed + k, args.pagine, args.modifiche,
                                      aggiungi_pagina=(k % 4 == 3))
        files = {}
        for lato, pag in (("a", pa_), ("b", pb_)):
            nat = lavoro / f"c{k:02d}_{lato}_nativo.pdf"
            pdf_nativo(pag, nat)
            files[("nativo", lato)] = nat
            for nome, p in ({} if args.solo_nativi else SCANSIONI).items():
                dst = lavoro / f"c{k:02d}_{lato}_{nome}.pdf"
                pdf_scansione(nat, dst, p, random.Random(f"{args.seed}-{k}-{lato}-{nome}"))
                files[(nome, lato)] = dst
        coppie.append((files, ver, len(pa_)))
    print(f"Generate {len(coppie)} coppie, {sum(len(v) for _, v, _ in coppie)} modifiche note.")

    risultati = []
    for variante, dpi, tol, pre in CONFIG:
        if args.solo_nativi and variante != "nativo":
            continue
        t0 = time.time()
        agg = {"variante": variante, "dpi": dpi, "tollerante": tol, "migliora": pre,
               "per_tipo": {}, "vere": 0, "trovate": 0, "trovate_incerte": 0, "finte": 0,
               "finte_incerte": 0, "pagine": 0, "critiche_perse": [], "esempi_finte": []}
        c.CACHE_DIR = lavoro / "cache_ocr"   # separata da quella dell'app
        for k, (files, ver, n_a) in enumerate(coppie):
            segn, _ = confronta(files[(variante, "a")], files[(variante, "b")], dpi, tol, pre)
            v = valuta(segn, ver, n_a)
            for r in v["verita"]:
                t = agg["per_tipo"].setdefault(r["tipo"], [0, 0])
                t[0] += 1
                t[1] += r["trovata"]
                agg["vere"] += 1
                agg["trovate"] += r["trovata"]
                agg["trovate_incerte"] += r["trovata_incerta"]
                if not r["trovata"] and r["tipo"] in CRITICI:
                    agg["critiche_perse"].append({"coppia": k, "tipo": r["tipo"], "a": r["a"], "b": r["b"]})
            agg["finte"] += v["finte"]
            agg["finte_incerte"] += v["finte_incerte"]
            agg["pagine"] += v["pagine"]
            if len(agg["esempi_finte"]) < 6:
                agg["esempi_finte"] += v["esempi_finte"][:2]
        agg["secondi"] = round(time.time() - t0, 1)
        agg["recall"] = agg["trovate"] / agg["vere"] if agg["vere"] else 0
        # precisione delle segnalazioni piene (non incerte): quanto di ciò che il
        # report mette in evidenza è una differenza vera
        piene = agg["trovate"] - agg["trovate_incerte"]
        agg["precisione"] = piene / (piene + agg["finte"]) if piene + agg["finte"] else 1
        risultati.append(agg)
        print(f"{variante:17s} {dpi}dpi tol={'sì' if tol else 'no'} pre={'sì' if pre else 'no'}: "
              f"trovate {agg['trovate']}/{agg['vere']} ({agg['recall']:.0%}, incerte {agg['trovate_incerte']}), "
              f"finte {agg['finte'] / agg['pagine']:.1f}/pag + incerte "
              f"{agg['finte_incerte'] / agg['pagine']:.1f}/pag, precisione {agg['precisione']:.0%}, "
              f"{agg['secondi']}s", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.with_suffix(".json").write_text(json.dumps(risultati, ensure_ascii=False, indent=1), encoding="utf-8")
    scrivi_report(risultati, args, args.out.with_suffix(".md"))
    print(f"Report: {args.out.with_suffix('.md')}")
    if args.verifica:
        male = [a for a in risultati if a["variante"] == "nativo"
                and (a["trovate"] < a["vere"] or a["finte"] or a["trovate_incerte"])]
        for a in male:
            print(f"VERIFICA FALLITA: nativo tollerante={a['tollerante']}: "
                  f"{a['trovate']}/{a['vere']} trovate, {a['finte']} finte, "
                  f"{a['trovate_incerte']} vere segnalate solo come incerte", file=sys.stderr)
        return 1 if male else 0
    return 0


def scrivi_report(ris: list[dict], args, path: Path):
    r = [f"<!-- \"><(((º> sabusabu <º)))><\" -->",
         "# Banco di prova — Confronto Documenti", "",
         f"{args.coppie} coppie di documenti sintetici da {args.pagine} pagine, "
         f"{args.modifiche} modifiche note per coppia (+1 pagina aggiunta in una coppia su 4), "
         f"seed {args.seed}. Generato da `bench/benchmark.py`.", "",
         "*Trovate*: modifiche vere segnalate (tra parentesi quante solo come incerte, in grigio). "
         "*Finte / pag*: segnalazioni piene che non corrispondono a modifiche vere. "
         "*Incerte / pag*: segnalazioni grigie \"probabile errore di lettura\" (solo in modo "
         "tollerante). *Precisione*: quota di segnalazioni piene che sono differenze vere.", "",
         "| Documenti | DPI | Tollerante | Migliora | Trovate | Finte / pag | Incerte / pag | Precisione |",
         "|---|---|---|---|---|---|---|---|"]
    for a in ris:
        inc = f", {a['trovate_incerte']} incerte" if a["trovate_incerte"] else ""
        r.append(f"| {a['variante']} | {a['dpi']} | {'sì' if a['tollerante'] else 'no'} | "
                 f"{'sì' if a['migliora'] else 'no'} | {a['trovate']}/{a['vere']} ({a['recall']:.0%}{inc}) | "
                 f"{a['finte'] / a['pagine']:.1f} | {a['finte_incerte'] / a['pagine']:.1f} | "
                 f"{a['precisione']:.0%} |")
    r += ["", "## Per tipo di modifica (trovate / totali)", ""]
    tipi = sorted({t for a in ris for t in a["per_tipo"]})
    r.append("| Configurazione | " + " | ".join(tipi) + " |")
    r.append("|---|" + "---|" * len(tipi))
    for a in ris:
        cfg = f"{a['variante']} {a['dpi']} {'tol' if a['tollerante'] else ''}{'' if a['migliora'] else ' no-migliora'}"
        r.append(f"| {cfg} | " + " | ".join(
            f"{a['per_tipo'].get(t, [0, 0])[1]}/{a['per_tipo'].get(t, [0, 0])[0]}" for t in tipi) + " |")
    r += ["", "## Modifiche critiche perse (esempi)", ""]
    for a in ris:
        if a["critiche_perse"]:
            r.append(f"**{a['variante']} {a['dpi']} dpi, tollerante {'sì' if a['tollerante'] else 'no'}**")
            for p in a["critiche_perse"][:5]:
                r.append(f"- {p['tipo']}: `{p['a']}` → `{p['b']}`")
            r.append("")
    r += ["## Segnalazioni finte (esempi)", ""]
    for a in ris:
        if a["esempi_finte"]:
            r.append(f"**{a['variante']} {a['dpi']} dpi, tollerante {'sì' if a['tollerante'] else 'no'}**")
            for x, y in a["esempi_finte"][:4]:
                r.append(f"- A: `{x[:90]}` · B: `{y[:90]}`")
            r.append("")
    path.write_text("\n".join(r) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
