# -*- coding: utf-8 -*-
"""
Worker OCR persistente basato su PaddleOCR (PP-OCRv4/v5).

Il server Node lo avvia UNA volta: il modello si carica una sola volta (~5-10s),
poi ogni pagina costa solo l'inferenza. Protocollo a righe JSON:
  stdin  → {"id": 1, "path": "C:\\...\\pagina.png"}
  stdout → {"id": 1, "lines": [{"text": "...", "conf": 98.5, "x":.., "y":.., "w":.., "h":..}]}
  stdout → {"id": 1, "error": "..."}          in caso di problema sulla singola pagina
  stdout → {"ready": true, "engine": "..."}   una volta, a modello caricato

Le coordinate sono i rettangoli dei blocchi di testo rilevati (equivalente
"riga/cella" del TSV di Tesseract); il server li converte in TSV compatibile.
Al primo avvio assoluto PaddleOCR scarica i modelli (~30 MB) nella home utente.
"""
import io
import json
import os
import ssl
import sys

# stdout è riservato al protocollo JSON: duplico il fd originale per il protocollo
# e dirotto stdout sui log (stderr), così le stampe interne di Paddle non lo sporcano.
PROTO = io.TextIOWrapper(os.fdopen(os.dup(1), "wb"), encoding="utf-8", newline="\n")
os.dup2(2, 1)
sys.stdout = sys.stderr

# Rete aziendale con ispezione SSL (stesso motivo del --trusted-host di pip):
# senza questi accorgimenti il download automatico dei modelli fallisce
# (PaddleX: "No model hoster is available"). Serve SOLO al primo scaricamento:
# una volta in cache (~/.paddlex) non c'è più rete da fare, e disattivare la
# verifica dei certificati per tutto il processo a ogni avvio era una porta
# aperta senza motivo. Forzatura esplicita: PADDLE_INSECURE_SSL=1 (sempre) / 0 (mai).
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")


def _serve_ssl_insicuro():
    forzato = os.environ.get("PADDLE_INSECURE_SSL")
    if forzato in ("0", "1"):
        return forzato == "1"
    return not os.path.isdir(os.path.expanduser("~/.paddlex"))


if _serve_ssl_insicuro():
    ssl._create_default_https_context = ssl._create_unverified_context
    try:
        import requests
        import urllib3

        urllib3.disable_warnings()
        _request_originale = requests.Session.request

        def _request_senza_verifica(self, *args, **kwargs):
            kwargs["verify"] = False
            return _request_originale(self, *args, **kwargs)

        requests.Session.request = _request_senza_verifica
    # "><(((º> sabusabu <º)))><"
    except ImportError:
        pass


def manda(obj):
    PROTO.write(json.dumps(obj, ensure_ascii=False) + "\n")
    PROTO.flush()


def rileva_device():
    """"gpu" se il paddle installato è compilato CUDA e vede una GPU, altrimenti "cpu".
    Override esplicito via PADDLE_DEVICE (es. "cpu" per escludere la GPU)."""
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
    """PaddleOCR 3.x (PP-OCRv5) se disponibile, altrimenti 2.x (PP-OCRv4)."""
    from paddleocr import PaddleOCR
    try:
        import paddleocr
        versione = getattr(paddleocr, "__version__", "?")
    except Exception:
        versione = "?"
    # 3.x: pipeline di pre-analisi documento spente — le pagine arrivano già
    # raddrizzate dal rendering PDF del frontend, e senza queste è più veloce.
    base = dict(
        lang="it",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    # Modelli PP-OCRv5 mobile di default: misurati su contratto reale sono ~3.4×
    # più veloci del PP-OCRv6 medium E più accurati sull'italiano (il rec "latin"
    # è specializzato, il medium è multilingua generico). Override via env.
    det = os.environ.get("PADDLE_DET_MODEL", "PP-OCRv5_mobile_det")
    rec = os.environ.get("PADDLE_REC_MODEL", "latin_PP-OCRv5_mobile_rec")
    # GPU se disponibile (misurato: la CPU senza oneDNN fa ~55s/pagina, inutilizzabile);
    # se la costruzione GPU fallisce si riprova in CPU più sotto.
    for device in dict.fromkeys([rileva_device(), "cpu"]):
        # Tuning throughput (stessi modelli, stessa accuratezza — cambia solo lo scheduling):
        # - cpu_threads: il server lo imposta a cores/POOL così N worker non si contendono
        #   i core (di default ogni processo Paddle ne prenderebbe troppi);
        # - text_recognition_batch_size: crop di testo riconosciuti a lotti anziché uno
        #   alla volta; sulla GPU ammortizza i lanci kernel (default 16), sulla CPU 8.
        extra = {}
        cpu_threads = os.environ.get("PADDLE_CPU_THREADS")
        if cpu_threads and device == "cpu":
            extra["cpu_threads"] = int(cpu_threads)
        rec_batch = os.environ.get("PADDLE_REC_BATCH") or ("16" if device == "gpu" else "8")
        extra["text_recognition_batch_size"] = int(rec_batch)
        try:
            # enable_mkldnn=False: su Windows CPU l'esecutore oneDNN di Paddle 3.3
            # fallisce l'inferenza (NotImplementedError ConvertPirAttribute2RuntimeAttribute).
            ocr = PaddleOCR(
                **base,
                text_detection_model_name=det,
                text_recognition_model_name=rec,
                enable_mkldnn=False,
                device=device,
                **extra,
            )
            return ocr, f"PaddleOCR {versione} ({det.split('_')[0]}, {device.upper()})"
        except TypeError:
            if extra:
                # firma senza i parametri di tuning (paddleocr più vecchio) → riprova liscio
                try:
                    ocr = PaddleOCR(
                        **base,
                        text_detection_model_name=det,
                        text_recognition_model_name=rec,
                        enable_mkldnn=False,
                        device=device,
                    )
                    return ocr, f"PaddleOCR {versione} ({det.split('_')[0]}, {device.upper()})"
                except TypeError:
                    break   # firma 3.x assente → prova le API vecchie
                except Exception as e:
                    print(f"[worker] device {device} non utilizzabile: {e}", file=sys.stderr)
                    continue
            break   # firma 3.x assente → prova le API vecchie
        except Exception as e:
            print(f"[worker] device {device} non utilizzabile: {e}", file=sys.stderr)
    try:
        return PaddleOCR(**base), f"PaddleOCR {versione}"
    except TypeError:
        ocr = PaddleOCR(lang="it", use_angle_cls=False, show_log=False)
        return ocr, f"PaddleOCR {versione} (PP-OCRv4)"


def rettangolo(poly):
    xs = [float(p[0]) for p in poly]
    ys = [float(p[1]) for p in poly]
    x, y = min(xs), min(ys)
    return int(x), int(y), int(max(xs) - x), int(max(ys) - y)


def ocr_pagina(ocr, path):
    lines = []
    if hasattr(ocr, "predict"):            # API 3.x
        for res in ocr.predict(path) or []:
            polys = res.get("rec_polys")
            if polys is None:
                polys = res.get("dt_polys", [])
            for txt, score, poly in zip(res["rec_texts"], res["rec_scores"], polys):
                txt = (txt or "").strip()
                if not txt:
                    continue
                x, y, w, h = rettangolo(poly)
                lines.append({"text": txt, "conf": round(float(score) * 100, 1),
                              "x": x, "y": y, "w": w, "h": h})
    else:                                  # API 2.x
        for page in ocr.ocr(path, cls=False) or []:
            for box, (txt, score) in page or []:
                txt = (txt or "").strip()
                if not txt:
                    continue
                x, y, w, h = rettangolo(box)
                lines.append({"text": txt, "conf": round(float(score) * 100, 1),
                              "x": x, "y": y, "w": w, "h": h})
    return lines


def spiega_errore_avvio(e):
    """Messaggio umano per il server (campo `fatal`): la traccia Python la vede solo
    chi legge i log. WinError 4551 = Windows App Control (WDAC) rifiuta di caricare
    una DLL non firmata del venv: non c'è nulla da reinstallare, deve intervenire
    l'IT (whitelist della cartella o della firma)."""
    testo = f"{type(e).__name__}: {e}"
    if "4551" in testo or "criterio di controllo dell'applicazione" in testo:
        return ("Windows App Control (WDAC) blocca le librerie del venv PaddleOCR "
                "(WinError 4551, DLL non firmata). Non dipende dall'installazione: "
                "chiedere all'IT di autorizzare la cartella del programma. " + testo)
    return testo


def main():
    try:
        # `import paddle` esplicito PRIMA di paddleocr: se fallisce qui l'errore è quello
        # vero (es. la DLL bloccata). Dentro paddleocr un primo import fallito lascia il
        # modulo a metà e il secondo tentativo dà solo "partially initialized module".
        import paddle  # noqa: F401
        ocr, engine = costruisci_ocr()
    except BaseException as e:   # anche SystemExit/ImportError: il server deve sapere PERCHE'
        import traceback
        traceback.print_exc()
        manda({"fatal": spiega_errore_avvio(e)})
        sys.exit(1)
    manda({"ready": True, "engine": engine})
    # utf-8-sig: tollera il BOM che PowerShell/Windows a volte antepone allo stream
    stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8-sig")
    for raw in stdin:
        raw = raw.strip()
        if not raw:
            continue
        req = {}
        try:
            req = json.loads(raw)
            manda({"id": req["id"], "lines": ocr_pagina(ocr, req["path"])})
        except Exception as e:
            manda({"id": req.get("id"), "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
