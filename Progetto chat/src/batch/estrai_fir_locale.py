# -*- coding: utf-8 -*-
"""
estrai_fir_locale.py — Estrazione locale (PaddleOCR, no API) dei Formulari di
Identificazione Rifiuti (FIR/DUD), stessi campi del prompt "registro-fir" di
prompts.ts.

Perche' esiste: un'alternativa gratuita a Claude per moduli a campi fissi come
il FIR. NON e' pari qualita': niente comprensione del contesto, solo OCR +
regex ancorate alle etichette del modulo. Su un FIR standard, ben scansionato,
regge bene. Su scansioni storte, moduli non standard o campi manoscritti, va
peggio del prompt via API — li' un umano deve ricontrollare l'output.

Uso da riga di comando:
    python estrai_fir_locale.py <PDF-o-cartella> [-o output.json] [--csv]

Un PDF -> un'estrazione. Una cartella -> tutti i .pdf dentro, righe impilate
in un'unica tabella (stessa logica del bottone "tabella unica" della pagina web).

Uso come worker dell'app (--worker): stesso protocollo stdin/stdout a righe
JSON di pulisci_ddt.py, cosi' src/batch/estraiLocale.ts puo' pilotarlo e il
modello si carica una volta sola per tutti i PDF del job, non uno a PDF.
  stdin  <- {"id": 1, "input": "C:\\...\\file.pdf"}
  stdout -> {"ready": true, "engine": "..."}             una volta, a modello caricato
  stdout -> {"id": 1, "summary": "...", "fileName": "...", "sheets": [...]}
  stdout -> {"id": 1, "error": "..."}                     problema sul singolo file

Output (CLI e worker): stesso JSON del prompt "registro-fir"
  {"summary": "...", "fileName": "...", "sheets": [{"name": "Registro FIR",
   "headers": [...19 colonne...], "rows": [[...], ...]}]}
cosi' e' compatibile con ExcelService (src/services/excelService.ts).
"""
import argparse
import io
import json
import os
import re
import ssl
import sys
from datetime import datetime

# ── Bootstrap OCR (stessa tecnica di pulisci_ddt.py: rete aziendale con
# ispezione SSL, bypass ristretto ai soli host dei modelli PaddleOCR) ────────

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")


def _modelli_in_cache():
    base = os.path.join(os.path.expanduser("~"), ".paddlex", "official_models")
    det = os.environ.get("PADDLE_DET_MODEL", "PP-OCRv5_mobile_det")
    rec = os.environ.get("PADDLE_REC_MODEL", "latin_PP-OCRv5_mobile_rec")
    return all(os.path.isdir(os.path.join(base, m)) for m in (det, rec))


_HOST_MODELLI = (".bcebos.com", ".baidubce.com", ".paddlepaddle.org.cn")

if not _modelli_in_cache():
    ssl._create_default_https_context = ssl._create_unverified_context
    try:
        from urllib.parse import urlparse

        import requests
        import urllib3

        urllib3.disable_warnings()
        _request_originale = requests.Session.request

        def _request_verifica_ristretta(self, method, url, *args, **kwargs):
            host = urlparse(str(url)).hostname or ""
            if host.endswith(_HOST_MODELLI):
                kwargs["verify"] = False
            return _request_originale(self, method, url, *args, **kwargs)

        requests.Session.request = _request_verifica_ristretta
    except ImportError:
        pass


def log(msg):
    print(msg, file=sys.stderr)


def rileva_device():
    forzato = os.environ.get("PADDLE_DEVICE")
    if forzato:
        return forzato
    try:
        import paddle

        if paddle.device.is_compiled_with_cuda() and paddle.device.cuda.device_count() > 0:
            return "gpu"
    except Exception:
        pass
    return "cpu"


def costruisci_ocr():
    from paddleocr import PaddleOCR

    try:
        import paddleocr

        versione = getattr(paddleocr, "__version__", "?")
    except Exception:
        versione = "?"

    base = dict(
        lang="it",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    det = os.environ.get("PADDLE_DET_MODEL", "PP-OCRv5_mobile_det")
    rec = os.environ.get("PADDLE_REC_MODEL", "latin_PP-OCRv5_mobile_rec")
    for device in dict.fromkeys([rileva_device(), "cpu"]):
        try:
            ocr = PaddleOCR(
                **base,
                text_detection_model_name=det,
                text_recognition_model_name=rec,
                enable_mkldnn=False,
                device=device,
            )
            log("[estrai] motore: PaddleOCR %s (%s, %s)" % (versione, det.split("_")[0], device.upper()))
            return ocr
        except Exception as e:
            log("[estrai] device %s non utilizzabile: %s" % (device, e))
    raise RuntimeError("PaddleOCR non inizializzabile ne' su GPU ne' su CPU")


def leggi_pagina_frammenti(ocr, path):
    """Testo OCR di una pagina come lista di frammenti (una entry per riga
    riconosciuta), ordine di lettura di PaddleOCR. Non unito in un blob unico:
    l'estrazione per etichetta ha bisogno di sapere dove finisce una riga e
    inizia la successiva."""
    frammenti = []
    if hasattr(ocr, "predict"):  # API 3.x
        for res in ocr.predict(path) or []:
            frammenti.extend(t.strip() for t in res.get("rec_texts", []) if t and t.strip())
    else:  # API 2.x
        for page in ocr.ocr(path, cls=False) or []:
            for _box, (txt, _score) in page or []:
                if txt and txt.strip():
                    frammenti.append(txt.strip())
    return frammenti


# ── Riconoscimento pagine FIR ────────────────────────────────────────────────
# Un P.IVA piu' un secondo indizio (CER, o le parole FIR/DUD/formulario):
# preso da solo un P.IVA compare anche in fatture o certificati.

RX_PIVA = re.compile(r"\b\d{11}\b")
RX_CER = re.compile(r"\b\d{2}\s?\d{2}\s?\d{2}\*?\b")
RX_FIR_KEYWORD = re.compile(r"\b(?:f\.?i\.?r\.?|d\.?u\.?d\.?|formulario)\b", re.I)


def pagina_e_fir(frammenti):
    blob = " ".join(frammenti)
    return bool(RX_PIVA.search(blob)) and bool(RX_CER.search(blob) or RX_FIR_KEYWORD.search(blob))


# ── Estrazione campi (etichetta -> valore vicino, stessa logica di chi legge
# un modulo a mano: trova la parola, guarda cosa c'e' subito dopo) ───────────

RX_TARGA = re.compile(r"\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b")
RX_DATA = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")
RX_ORA = re.compile(r"\b([01]?\d|2[0-3])[:.]([0-5]\d)\b")
RX_VOLUME = re.compile(r"(\d+[.,]\d+|\d+)\s*(?:m3|mc|m³)\b", re.I)
RX_PESO = re.compile(r"(\d+[.,]\d+|\d+)\s*kg\b", re.I)
RX_DUD = re.compile(r"\b[A-Z0-9]{6,}\b")

# \w* dopo il tema: quando etichetta e valore sono un unico frammento OCR
# ("PRODUTTORE: Cosedil S.p.A."), il pezzo tolto deve portarsi via l'intera
# parola (con desinenza), non solo il tema, altrimenti resta un avanzo
# ("E Cosedil S.p.A." invece di "Cosedil S.p.A.").
ETICHETTE = {
    "produttore": re.compile(r"\bproduttor\w*", re.I),
    "destinatario": re.compile(r"\bdestinatari\w*", re.I),
    "trasportatore": re.compile(r"\btrasportator\w*", re.I),
    # "N." dopo la parola e' quasi sempre parte dell'etichetta ("Autorizzazione N."),
    # non del valore: va tolto anche lui, altrimenti resta davanti al valore vero.
    "autorizzazione": re.compile(r"\bautorizzazion\w*(?:\s*n\.?\s*)?|\biscrizion\w*", re.I),
    "conducente": re.compile(r"\bconducent\w*|\bautist\w*", re.I),
    # "denominazione/descrizione rifiuto", non il generico "rifiuto": quella
    # parola compare gia' nel titolo del modulo ("...identificazione rifiuto"),
    # e una regex troppo larga prenderebbe il titolo come etichetta.
    # Non-greedy (.{0,25}?): con un secondo "rifiuto" piu' avanti nella riga
    # (il valore stesso, es. "...RIFIUTO Rifiuti misti..."), una regex greedy
    # si estenderebbe fino a quello, mangiandosi mezzo valore.
    "rifiuto": re.compile(r"(?:denominazion|descrizion|tipologia)\w*.{0,25}?rifiut\w*", re.I),
    "dud": re.compile(r"\bn\.?\s*(?:fir|dud|formulario)\w*|numero\s+(?:fir|dud)\w*", re.I),
    "inizio": re.compile(r"\binizio|partenza|carico", re.I),
    "fine": re.compile(r"\bfine|arrivo|scarico", re.I),
}

MANCANTE = "mancante"
ILLEGGIBILE = "(illeggibile)"


def indice_etichetta(frammenti, rx):
    for i, f in enumerate(frammenti):
        if rx.search(f):
            return i
    return None


def e_etichetta(frammento):
    """Vero se il frammento e' verosimilmente un'etichetta di modulo (poche
    parole, spesso maiuscole/con ':'), non un valore da restituire."""
    return len(frammento) <= 3 or frammento.rstrip().endswith(":") and len(frammento) < 30


def valore_dopo(frammenti, i_etichetta, rx_etichetta=None, finestra=3, pattern=None):
    """Primo valore utile entro `finestra` frammenti dopo l'etichetta: se
    `pattern` e' dato deve anche rispettarlo (es. solo P.IVA). Per i campi
    senza pattern, controlla anche lo stesso frammento dell'etichetta: l'OCR
    legge spesso "ETICHETTA: valore" come un unico blocco, non due righe."""
    if i_etichetta is None:
        return None
    for j in range(i_etichetta, min(i_etichetta + 1 + finestra, len(frammenti))):
        f = frammenti[j]
        if pattern:
            m = pattern.search(f)
            if m:
                return m.group(0)
            continue
        if j == i_etichetta:
            residuo = rx_etichetta.sub("", f, count=1).strip(" :\t-") if rx_etichetta else ""
            if residuo and not e_etichetta(residuo):
                return residuo
            continue
        if not e_etichetta(f):
            return f
    return None


def mese_italiano(data_ddmmyyyy):
    MESI = [
        "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
        "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
    ]
    m = RX_DATA.search(data_ddmmyyyy or "")
    if not m:
        return MANCANTE
    try:
        mese = int(m.group(2))
        return MESI[mese - 1] if 1 <= mese <= 12 else ILLEGGIBILE
    except ValueError:
        return ILLEGGIBILE


def durata_trasporto(ora_inizio, ora_fine):
    mi = RX_ORA.search(ora_inizio or "")
    mf = RX_ORA.search(ora_fine or "")
    if not mi or not mf:
        return MANCANTE
    minuti_inizio = int(mi.group(1)) * 60 + int(mi.group(2))
    minuti_fine = int(mf.group(1)) * 60 + int(mf.group(2))
    diff = minuti_fine - minuti_inizio
    if diff < 0:
        diff += 24 * 60  # trasporto a cavallo della mezzanotte
    return "%dh%02d" % (diff // 60, diff % 60)


# Ordine e nomi identici a prompts.ts (registro-fir): un output diverso
# renderebbe questo script e il prompt via API non intercambiabili.
HEADERS = [
    "DUD", "Produttore - Denominazione", "Produttore - P.IVA",
    "Destinatario - Denominazione", "Destinatario - P.IVA",
    "Trasportatore - Denominazione", "Trasportatore - P.IVA",
    "N. Autorizzazione", "Conducente", "Targa Mezzo",
    "Data Trasporto", "Ora Inizio Trasporto", "Ora Fine Trasporto",
    "Mese", "Durata Trasporto",
    "Rifiuto - Denominazione", "CER", "Volume [mc]", "Q.TA' [kg]",
]


def estrai_riga(frammenti):
    blob = " ".join(frammenti)

    def campo(nome_etichetta, pattern=None, finestra=3):
        rx = ETICHETTE[nome_etichetta]
        i = indice_etichetta(frammenti, rx)
        v = valore_dopo(frammenti, i, rx_etichetta=rx, finestra=finestra, pattern=pattern)
        return v if v else MANCANTE

    def piva_di(nome_etichetta):
        rx = ETICHETTE[nome_etichetta]
        i = indice_etichetta(frammenti, rx)
        v = valore_dopo(frammenti, i, rx_etichetta=rx, finestra=5, pattern=RX_PIVA)
        return v if v else MANCANTE

    m_data = RX_DATA.search(blob)
    data_trasporto = m_data.group(0) if m_data else MANCANTE

    ora_inizio = valore_dopo(frammenti, indice_etichetta(frammenti, ETICHETTE["inizio"]), finestra=3, pattern=RX_ORA) or MANCANTE
    ora_fine = valore_dopo(frammenti, indice_etichetta(frammenti, ETICHETTE["fine"]), finestra=3, pattern=RX_ORA) or MANCANTE

    volume_m = RX_VOLUME.search(blob)
    peso_m = RX_PESO.search(blob)
    cer_m = RX_CER.search(blob)
    targa_m = RX_TARGA.search(blob)

    return [
        campo("dud"),
        campo("produttore"),
        piva_di("produttore"),
        campo("destinatario"),
        piva_di("destinatario"),
        campo("trasportatore"),
        piva_di("trasportatore"),
        campo("autorizzazione"),
        campo("conducente"),
        targa_m.group(0) if targa_m else MANCANTE,
        data_trasporto,
        ora_inizio,
        ora_fine,
        mese_italiano(data_trasporto),
        durata_trasporto(ora_inizio, ora_fine),
        campo("rifiuto"),
        cer_m.group(0) if cer_m else MANCANTE,
        volume_m.group(1) if volume_m else MANCANTE,
        peso_m.group(1) if peso_m else MANCANTE,
    ]


# ── PDF -> righe ─────────────────────────────────────────────────────────────

DPI = int(os.environ.get("ESTRAI_DPI", "200"))  # piu' della pulizia (150): qui serve leggere i valori, non solo classificare


def righe_da_pdf(ocr, path_pdf):
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(path_pdf)
    righe = []
    scartate = 0
    for i in range(len(doc)):
        frammenti = []
        try:
            img = doc[i].render(scale=DPI / 72).to_pil()
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                img.save(tmp.name)
                tmp_path = tmp.name
            try:
                frammenti = leggi_pagina_frammenti(ocr, tmp_path)
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        except Exception as e:
            log("  pagina %d: errore OCR (%s), saltata" % (i + 1, e))
            continue

        if not pagina_e_fir(frammenti):
            scartate += 1
            continue

        riga = estrai_riga(frammenti)
        righe.append(riga)
        log("  pagina %d: FIR %s — %s" % (i + 1, riga[0], riga[1]))

    doc.close()
    log("%s: %d righe estratte, %d pagine scartate (non riconosciute come FIR)" % (
        os.path.basename(path_pdf), len(righe), scartate,
    ))
    return righe


def risultato_pdf(pdf_path, righe):
    return {
        "summary": "Registro FIR (estrazione locale) — %d righe" % len(righe),
        "fileName": os.path.basename(pdf_path),
        "sheets": [{
            "name": "Registro FIR",
            "description": "un rigo per FIR — estratto in locale con PaddleOCR, non con l'API",
            "headers": HEADERS,
            "rows": righe,
        }],
    }


def elabora(pdf_paths):
    ocr = costruisci_ocr()
    tutte_le_righe = []
    for p in pdf_paths:
        tutte_le_righe.extend(righe_da_pdf(ocr, p))

    nomi = " + ".join(os.path.basename(p) for p in pdf_paths)
    return {
        "summary": "Registro FIR (estrazione locale) — %d PDF, %d righe" % (len(pdf_paths), len(tutte_le_righe)),
        "fileName": nomi,
        "sheets": [{
            "name": "Registro FIR",
            "description": "un rigo per FIR — estratto in locale con PaddleOCR, non con l'API",
            "headers": HEADERS,
            "rows": tutte_le_righe,
        }],
    }


def scrivi_csv(dati, path_csv):
    import csv

    with open(path_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(HEADERS)
        w.writerows(dati["sheets"][0]["rows"])


# ── Modalità worker (per l'app: src/batch/estraiLocale.ts) ──────────────────

def main_worker():
    # stdout riservato al protocollo JSON: stessa tecnica di pulisci_ddt.py,
    # duplica il fd originale e dirotta stdout sui log, cosi' le stampe interne
    # di Paddle (che scrivono su stdout, non stderr) non lo sporcano.
    proto = io.TextIOWrapper(os.fdopen(os.dup(1), "wb"), encoding="utf-8", newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    def manda(obj):
        proto.write(json.dumps(obj, ensure_ascii=False) + "\n")
        proto.flush()

    try:
        ocr = costruisci_ocr()
    except Exception as e:
        manda({"fatal": "%s: %s" % (type(e).__name__, e)})
        return 1
    manda({"ready": True, "engine": "PaddleOCR (estrazione FIR locale)", "dpi": DPI})

    stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8-sig")
    for raw in stdin:
        raw = raw.strip()
        if not raw:
            continue
        req = {}
        try:
            req = json.loads(raw)
            righe = righe_da_pdf(ocr, req["input"])
            manda({"id": req["id"], **risultato_pdf(req["input"], righe)})
        except Exception as e:
            manda({"id": req.get("id"), "error": "%s: %s" % (type(e).__name__, e)})
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="Estrazione locale (PaddleOCR, senza API) dei FIR da un PDF o una cartella di PDF."
    )
    ap.add_argument("input", nargs="?", help="PDF o cartella di PDF (non serve con --worker)")
    ap.add_argument("-o", "--output", help="JSON di output (default: accanto all'input)")
    ap.add_argument("--csv", action="store_true", help="scrive anche un .csv (comodo per un'occhiata veloce)")
    ap.add_argument(
        "--worker", action="store_true",
        help="protocollo stdin/stdout a righe JSON per l'integrazione con l'app, invece della CLI"
    )
    args = ap.parse_args()

    if args.worker:
        return main_worker()

    if not args.input:
        ap.error("serve un PDF o una cartella (oppure --worker)")

    if os.path.isdir(args.input):
        pdf_paths = sorted(
            os.path.join(args.input, n) for n in os.listdir(args.input) if n.lower().endswith(".pdf")
        )
        if not pdf_paths:
            log("Nessun PDF in %s" % args.input)
            return 1
        default_out = os.path.join(args.input, "registro-fir-locale.json")
    else:
        if not os.path.isfile(args.input):
            log("File non trovato: %s" % args.input)
            return 1
        pdf_paths = [args.input]
        default_out = os.path.splitext(args.input)[0] + ".fir-locale.json"

    out_path = args.output or default_out

    dati = elabora(pdf_paths)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(dati, f, ensure_ascii=False, indent=2)
    log("JSON scritto in %s" % out_path)

    if args.csv:
        csv_path = os.path.splitext(out_path)[0] + ".csv"
        scrivi_csv(dati, csv_path)
        log("CSV scritto in %s" % csv_path)

    log(dati["summary"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
