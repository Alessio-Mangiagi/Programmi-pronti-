# -*- coding: utf-8 -*-
"""
pulisci_ddt.py — Scarta le pagine inutili da un PDF di DDT prima di mandarlo a Claude.

Perche' esiste: nei registri scansionati solo ~40% delle pagine contiene un DDT
(il resto e' copertine, pagine bianche, certificati, doppioni). Quelle pagine
l'API le legge e le fa pagare uguale, e soprattutto fanno sforare il limite di
~100 pagine per PDF: un registro da 119 pagine viene rifiutato, le sue 40 pagine
utili no.

Come: rasterizza ogni pagina con pypdfium2, la legge con PaddleOCR, decide se
contiene un DDT, e riscrive un PDF con le sole pagine utili. L'originale non
viene mai toccato.

Protocollo (stdin/stdout a righe JSON, come ocr_worker.py del progetto OCR):
  stdin  <- {"id": 1, "input": "C:\\...\\registro.pdf", "output": "C:\\...\\pulito.pdf"}
  stdout -> {"ready": true, "engine": "..."}                    una volta, a modello caricato
  stdout -> {"id": 1, "tenute": 40, "scartate": 79, "pagine": [...]}
  stdout -> {"id": 1, "error": "..."}                           problema sul singolo file

Regola di prudenza: nel dubbio la pagina si tiene. Tenere una pagina inutile
costa frazioni di centesimo; scartare un DDT vero significa un carico di
calcestruzzo che sparisce dalla contabilita'.
"""
import argparse
import io
import json
import os
import re
import ssl
import sys
import tempfile

# stdout e' riservato al protocollo JSON: duplico il fd originale e dirotto
# stdout sui log, cosi' le stampe interne di Paddle non lo sporcano.
# (stessa tecnica di ocr_worker.py nel progetto OCR)
PROTO = io.TextIOWrapper(os.fdopen(os.dup(1), "wb"), encoding="utf-8", newline="\n")
os.dup2(2, 1)
sys.stdout = sys.stderr

# Rete aziendale con ispezione SSL: senza accorgimenti il primo scaricamento
# dei modelli fallisce ("No model hoster is available").
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")


def _modelli_in_cache():
    """True se i modelli OCR sono gia' scaricati: da li' in poi niente rete."""
    base = os.path.join(os.path.expanduser("~"), ".paddlex", "official_models")
    det = os.environ.get("PADDLE_DET_MODEL", "PP-OCRv5_mobile_det")
    rec = os.environ.get("PADDLE_REC_MODEL", "latin_PP-OCRv5_mobile_rec")
    return all(os.path.isdir(os.path.join(base, m)) for m in (det, rec))


# Bypass della verifica TLS: SOLO per il bootstrap dei modelli, mai a regime.
# - modelli gia' in cache (ogni avvio dopo il primo): nessun bypass, il processo
#   gira con la verifica TLS di default;
# - modelli da scaricare: la verifica viene disattivata solo per i domini
#   Baidu/Paddle da cui arrivano i modelli, non per il resto del traffico.
# (Il worker del progetto OCR usa ancora il bypass globale: qui e' ristretto.)
_HOST_MODELLI = (".bcebos.com", ".baidubce.com", ".paddlepaddle.org.cn")

if not _modelli_in_cache():
    # urllib (usato dal check dell'hoster di PaddleX) non offre un hook per
    # host: il default non verificato vale solo per questa esecuzione di
    # bootstrap, in cui il processo parla solo con gli host dei modelli.
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


def manda(obj):
    PROTO.write(json.dumps(obj, ensure_ascii=False) + "\n")
    PROTO.flush()


# ── Riconoscimento di una pagina DDT ─────────────────────────────────────────
# Gli stessi indizi che il prompt "ddt" chiede al modello di cercare:
# n°DDT, targa, m3, classe cls (es. C25/30), orari carico/arrivo/scarico, fornitore.

# Un solo indizio forte basta a tenere la pagina.
FORTI = [
    # classe di resistenza: C25/30, C 25/30, C28/35... e' la firma inconfondibile
    # di una bolla di calcestruzzo, non compare per caso altrove
    ("classe cls", re.compile(r"\bC\s?\d{2}\s*/\s*\d{2}\b", re.I)),
    # targa italiana: AB123CD, AB 123 CD
    ("targa", re.compile(r"\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b")),
    # numero di DDT/bolla esplicito
    ("n. DDT", re.compile(r"\b(?:d\.?d\.?t\.?|bolla|documento\s+di\s+trasporto)\b[^\n]{0,20}?\d", re.I)),
]

# Due indizi deboli insieme bastano: presi singolarmente compaiono anche
# in fatture o certificati, insieme no.
DEBOLI = [
    ("metri cubi", re.compile(r"\b\d+[.,]?\d*\s*(?:m3|mc|m³)\b", re.I)),
    ("calcestruzzo", re.compile(r"\b(?:calcestruzz[oi]|betoncino|cls)\b", re.I)),
    ("orario", re.compile(r"\b\d{1,2}[:.]\d{2}\b")),
    # i plurali italiani vanno accettati: l'OCR legge quello che c'e' scritto,
    # e nelle bolle compaiono sia "additivo" sia "additivi"
    ("componenti", re.compile(r"\b(?:cement[oi]|sabbia|ghiaia|inert[ei]|additiv[oi]|acqua)\b", re.I)),
    ("consegna", re.compile(r"\b(?:consegn[ae]|trasporto|carico|scarico|autobetoniera)\b", re.I)),
    ("intestazione", re.compile(r"\b(?:fornitor[ei]|client[ei]|cantier[ei]|destinazione)\b", re.I)),
]

# Sotto questa soglia di caratteri la pagina e' bianca o illeggibile: e' l'unico
# caso in cui si scarta senza aver trovato nulla di positivo.
MIN_CARATTERI = 25


def valuta(testo):
    """(tieni, motivo, indizi) per una pagina, dal testo che l'OCR ha letto."""
    compatto = " ".join(testo.split())

    # Gli indizi forti si controllano PRIMA della soglia "pagina bianca": una
    # scansione rovinata da cui l'OCR salva solo "C25/30" fa poche decine di
    # caratteri, ma e' una bolla, e buttarla farebbe sparire un carico.
    trovati = [nome for nome, rx in FORTI if rx.search(compatto)]
    if trovati:
        return True, "indizio forte: " + ", ".join(trovati), trovati

    if len(compatto) < MIN_CARATTERI:
        return False, "pagina bianca o illeggibile", []

    deboli = [nome for nome, rx in DEBOLI if rx.search(compatto)]
    if len(deboli) >= 2:
        return True, "indizi: " + ", ".join(deboli), deboli

    if deboli:
        return False, "un solo indizio debole (%s): non sembra un DDT" % deboli[0], deboli
    return False, "nessun dato da DDT nella pagina", []


# ── OCR ──────────────────────────────────────────────────────────────────────

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
    """Stessa configurazione del worker del progetto OCR: modelli mobile PP-OCRv5,
    piu' veloci E piu' accurati sull'italiano del medium multilingua."""
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
            # enable_mkldnn=False: su Windows CPU l'esecutore oneDNN di Paddle 3.3
            # fallisce l'inferenza (vedi ocr_worker.py del progetto OCR).
            ocr = PaddleOCR(
                **base,
                text_detection_model_name=det,
                text_recognition_model_name=rec,
                enable_mkldnn=False,
                device=device,
            )
            return ocr, "PaddleOCR %s (%s, %s)" % (versione, det.split("_")[0], device.upper())
        except Exception as e:
            print("[pulisci] device %s non utilizzabile: %s" % (device, e), file=sys.stderr)
    raise RuntimeError("PaddleOCR non inizializzabile ne' su GPU ne' su CPU")


def leggi_pagina(ocr, path):
    testi = []
    if hasattr(ocr, "predict"):  # API 3.x
        for res in ocr.predict(path) or []:
            testi.extend(t for t in res.get("rec_texts", []) if t)
    else:  # API 2.x
        for page in ocr.ocr(path, cls=False) or []:
            for _box, (txt, _score) in page or []:
                if txt:
                    testi.append(txt)
    return "\n".join(testi)


# ── Pulizia di un PDF ────────────────────────────────────────────────────────

# 150 DPI: sufficiente per leggere una bolla stampata, ~4x piu' veloce di 300.
DPI = int(os.environ.get("PULISCI_DPI", "150"))


def pulisci(ocr, path_in, path_out, tmpdir):
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(path_in)
    totale = len(doc)
    pagine = []
    tenere = []

    for i in range(totale):
        png = os.path.join(tmpdir, "p%05d.png" % i)
        try:
            doc[i].render(scale=DPI / 72).to_pil().save(png)
            testo = leggi_pagina(ocr, png)
            tieni, motivo, _indizi = valuta(testo)
        # "><(((º> sabusabu <º)))><"
        except Exception as e:
            # OCR o rendering in errore: la pagina si tiene. Non sappiamo cosa
            # contiene, e buttarla potrebbe far sparire un DDT.
            tieni, motivo, testo = True, "tenuta per prudenza (errore OCR: %s)" % e, ""
        finally:
            try:
                os.unlink(png)
            except OSError:
                pass

        if tieni:
            tenere.append(i)
        pagine.append({
            "n": i + 1,
            "tenuta": tieni,
            "motivo": motivo,
            # anteprima del testo letto: serve a controllare a mano perche' una
            # pagina e' stata scartata
            "testo": " ".join(testo.split())[:160],
        })

    # Nessuna pagina utile: quasi sempre vuol dire che il riconoscimento ha
    # toppato (PDF ruotato, scansione pessima), non che il registro sia vuoto.
    # Meglio mandare l'originale intero e pagarlo, che mandare un PDF vuoto.
    if not tenere:
        doc.close()
        return {
            "tenute": totale,
            "scartate": 0,
            "totale": totale,
            "usato_originale": True,
            "avviso": "nessuna pagina riconosciuta come DDT: mando il PDF originale intero",
            "pagine": pagine,
        }

    nuovo = pdfium.PdfDocument.new()
    nuovo.import_pages(doc, tenere)
    nuovo.save(path_out)
    nuovo.close()
    doc.close()

    return {
        "tenute": len(tenere),
        "scartate": totale - len(tenere),
        "totale": totale,
        "usato_originale": False,
        "pagine": pagine,
    }


def main():
    ap = argparse.ArgumentParser(description="Scarta le pagine non-DDT da un PDF")
    ap.parse_args()

    try:
        ocr, engine = costruisci_ocr()
    except Exception as e:
        manda({"fatal": "%s: %s" % (type(e).__name__, e)})
        return 1
    manda({"ready": True, "engine": engine, "dpi": DPI})

    stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8-sig")
    with tempfile.TemporaryDirectory(prefix="pulisci-ddt-") as tmpdir:
        for raw in stdin:
            raw = raw.strip()
            if not raw:
                continue
            req = {}
            try:
                req = json.loads(raw)
                esito = pulisci(ocr, req["input"], req["output"], tmpdir)
                esito["id"] = req["id"]
                manda(esito)
            except Exception as e:
                manda({"id": req.get("id"), "error": "%s: %s" % (type(e).__name__, e)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
