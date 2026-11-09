# -*- coding: utf-8 -*-
"""
Worker OCR persistente basato su PaddleOCR (PP-OCRv4/v5).

Il server Node lo avvia UNA volta: il modello si carica una sola volta (~5-10s),
poi ogni pagina costa solo l'inferenza. Protocollo a righe JSON:
  stdin  → {"id": 1, "path": "C:\\...\\pagina.png"}
  stdout → {"id": 1, "lines": [{"text": "...", "conf": 98.5, "x":.., "y":.., "w":.., "h":..}]}
           (+ "rotazione": 180 se la pagina era capovolta ed è stata riletta raddrizzata)
           (+ "griglia": {"xs": [...], "ys": [...]} linee della tabella con i bordi, o null)
  stdin  → {"id": 2, "path": "...", "solo_griglia": true, "rotazione": 0}
  stdout → {"id": 2, "griglia": {...} | null}   pagina già in cache: solo le linee
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


def prova_lettura(ocr):
    """Prova di lettura su un'immagine generata qui (testo nero su bianco, ben leggibile).
    False = il motore non ha ritrovato il testo scritto ("CONTRATTO 2026 PROVA").

    Perché: su GPU troppo nuove per i kernel del paddle installato (es. RTX serie 50,
    compute capability 12.0, con paddle CUDA 12.6) l'inferenza non solleva errori ma il
    rilevamento restituisce zero box: ogni pagina usciva vuota ("txt:0ch blocchi:0") e il
    contratto risultava senza dati, in silenzio. Con questa prova il worker se ne accorge
    all'avvio e ripiega sulla CPU. Se la prova stessa non si può fare (PIL o font
    mancanti, errore imprevisto) si risponde True: meglio non bloccare un motore buono.

    Non basta "almeno un blocco": a volte la stessa GPU restituisce UN blocco grande
    quanto l'immagine con caratteri a caso ('v�v�.�^1{15s…', confidenza 100), memoria
    non inizializzata. Contarlo come lettura riuscita teneva la GPU (06/11/2026: un banco
    di prova intero a pagine vuote, e lo stesso poteva capitare al server). Si pretende di
    ritrovare almeno una delle parole scritte; una lettera sbagliata dall'OCR non basta a
    perderle tutte e tre."""
    try:
        import tempfile
        from PIL import Image, ImageDraw, ImageFont
        try:
            font = ImageFont.truetype("arial.ttf", 72)
        except OSError:
            return True              # senza un font vero il testo sarebbe troppo piccolo
        img = Image.new("RGB", (1200, 240), "white")
        ImageDraw.Draw(img).text((40, 70), "CONTRATTO 2026 PROVA", fill="black", font=font)
        fd, png = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        try:
            img.save(png)
            letto = " ".join(b["text"] for b in ocr_pagina(ocr, png))
            # solo lettere e cifre maiuscole: "CONTRATTO2026PROVA" o "CONTRATT0 2026 PROVA"
            pulito = "".join(c for c in letto.upper() if c.isascii() and c.isalnum())
            return any(parola in pulito for parola in ("CONTRATTO", "2026", "PROVA"))
        finally:
            os.remove(png)
    except Exception as e:
        print(f"[worker] prova di lettura non eseguita: {e}", file=sys.stderr)
        return True


def costruisci_ocr():
    """PaddleOCR 3.x (PP-OCRv5) se disponibile, altrimenti 2.x (PP-OCRv4)."""
    from paddleocr import PaddleOCR
    try:
        import paddleocr
        versione = getattr(paddleocr, "__version__", "?")
    except Exception:
        versione = "?"
    # 3.x: pipeline di pre-analisi documento spente — senza è più veloce e il modello
    # d'orientamento non va scaricato. Le rare pagine scansionate capovolte le raddrizza
    # ocr_orientato(), che rilegge ruotata solo la pagina con confidenza troppo bassa.
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
            # GPU che "funziona" ma non legge nulla (vedi prova_lettura) → si passa alla CPU
            if device != "cpu" and not prova_lettura(ocr):
                print(f"[worker] device {device}: testo di prova non ritrovato sull'immagine "
                      f"(GPU non supportata da questo paddle?) — passo alla CPU", file=sys.stderr)
                continue
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
                    if device != "cpu" and not prova_lettura(ocr):
                        print(f"[worker] device {device}: testo di prova non ritrovato sull'immagine — passo alla CPU", file=sys.stderr)
                        continue
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


# ── Pagine capovolte o di traverso ──────────────────────────────────────────
# Il classificatore d'orientamento di PaddleOCR è spento (vedi costruisci_ocr) e il suo
# modello andrebbe scaricato. Le pagine scansionate al contrario però esistono: l'elenco
# prezzi del subappalto Progetto Costruzioni Ragusana ha 12 pagine capovolte, lette così
# al 39-48% di confidenza media e illeggibili per i parser (misura del 09/11/2026 sui 31
# contratti: tutte le altre pagine stanno sopra l'85%). Ruotata di 180° la stessa pagina
# sale all'82%. Si rilegge quindi ruotata SOLO la pagina sotto soglia e si tiene la
# lettura migliore: le pagine normali non costano nulla in più.
# PADDLE_SOGLIA_ROTAZIONE=0 spegne la prova.
SOGLIA_ROTAZIONE = float(os.environ.get("PADDLE_SOGLIA_ROTAZIONE", "60"))
# Sotto questo numero di blocchi la pagina è quasi vuota (firme, timbri): la confidenza
# bassa non dice nulla sull'orientamento e rileggerla 3 volte costerebbe minuti per niente.
MIN_BLOCCHI_ROTAZIONE = 20
# Una rotazione si tiene solo se legge almeno il 25% di testo sicuro in più (vedi
# testo_sicuro): una pagina brutta ma dritta (fotocopia sbiadita) non deve finire girata
# per poco.
MARGINE_ROTAZIONE = 1.25


def confidenza_media(lines):
    """Media della confidenza (0-100) sui blocchi con almeno due lettere o cifre:
    i segni isolati ("|", ".", "-") hanno confidenza alta anche sulle pagine capovolte
    e alzerebbero la media senza motivo."""
    utili = [b["conf"] for b in lines if sum(c.isalnum() for c in b["text"]) >= 2]
    return sum(utili) / len(utili) if utili else 0.0


def testo_sicuro(lines):
    """Lettere e cifre lette, pesate con la loro confidenza: misura QUANTO testo si legge
    bene, non solo quanto bene. La sola confidenza media ingannava: una pagina girata di
    traverso dava 67 blocchi corti (numeri) al 66%, contro i 191 al 44% della pagina
    com'era, e "vinceva" perdendo due terzi del testo (Ragusana, pag. 39)."""
    return sum(sum(c.isalnum() for c in b["text"]) * b["conf"] / 100 for b in lines
               if sum(c.isalnum() for c in b["text"]) >= 2)


def ocr_orientato(ocr, path):
    """OCR della pagina come arriva; se la lettura è sotto SOGLIA_ROTAZIONE la si rifà
    ruotata di 180°, poi di 90° e 270° solo se non basta. Vince la rotazione con più
    testo letto bene (testo_sicuro), se supera la pagina com'era di MARGINE_ROTAZIONE.
    Restituisce (blocchi, gradi): gradi = rotazione antioraria applicata all'immagine
    (0 = nessuna). Le coordinate dei blocchi sono quelle dell'immagine ruotata, cioè della
    pagina raddrizzata: i parser e la ricostruzione delle tabelle lavorano solo sulle
    posizioni relative (e la griglia della tabella si calcola sulla stessa immagine)."""
    lines = ocr_pagina(ocr, path)
    media = confidenza_media(lines)
    if SOGLIA_ROTAZIONE <= 0 or len(lines) < MIN_BLOCCHI_ROTAZIONE or media >= SOGLIA_ROTAZIONE:
        return lines, 0
    base = testo_sicuro(lines)
    migliore = (base, 0, lines, media)
    for gradi in (180, 90, 270):
        ruotata = ruota_su_file(path, gradi)
        try:
            letta = ocr_pagina(ocr, ruotata)
        finally:
            os.remove(ruotata)
        punti, m = testo_sicuro(letta), confidenza_media(letta)
        if punti > migliore[0]:
            migliore = (punti, gradi, letta, m)
        if migliore[1] and migliore[3] >= SOGLIA_ROTAZIONE and migliore[0] >= base * MARGINE_ROTAZIONE:
            break                    # pagina raddrizzata: le altre rotazioni non servono
    if migliore[1] and migliore[0] >= base * MARGINE_ROTAZIONE:
        print(f"[worker] pagina ruotata di {migliore[1]}°: confidenza {media:.0f}% → {migliore[3]:.0f}%, "
              f"testo letto bene {base:.0f} → {migliore[0]:.0f}", file=sys.stderr)
        return migliore[2], migliore[1]
    return lines, 0


# ── Linee della tabella (celle) ─────────────────────────────────────────────
# L'OCR restituisce righe di testo, non celle: nelle tabelle con i bordi le colonne si
# perdono (prezzo "P.U. lavori" e "P.U. oneri" confusi, celle su più righe mescolate:
# docs/RICERCA_OCR_SOLUZIONE.md §3). Le linee però sono nell'immagine: con OpenCV (già
# installato con PaddleOCR) si trovano per morfologia, come fa img2table, e il server
# mette ogni blocco OCR nella cella che lo contiene (server/tabella-griglia.ts).
# Niente modelli in più, niente AI: ~0,3 s a pagina. PADDLE_GRIGLIA=0 spegne il passo.
def _posizioni(profilo, minimo):
    """Coordinate delle linee: indici dove il profilo supera la soglia, raggruppati."""
    gruppi = []
    for i, v in enumerate(profilo):
        if v <= minimo:
            continue
        if gruppi and i - gruppi[-1][-1] <= 3:
            gruppi[-1].append(i)
        else:
            gruppi.append([i])
    return [int(sum(g) / len(g)) for g in gruppi]


def griglia_tabella(path):
    """{"xs": [...], "ys": [...]} = linee verticali e orizzontali della tabella più grande
    della pagina (coordinate dell'immagine, come i blocchi), o None se la pagina non ha una
    tabella con i bordi (almeno 3 linee per verso). Si cercano prima le verticali lunghe
    almeno 1/25 della pagina; la tabella è il gruppo di verticali che si sovrappongono in
    altezza con più linee; le orizzontali valide sono quelle dentro quell'altezza che
    coprono almeno il 30% della larghezza della tabella (le linee sottili escono
    tratteggiate dalla soglia: misurate al 40-50% su un subappalto con tutti i bordi)."""
    if os.environ.get("PADDLE_GRIGLIA") == "0":
        return None
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None
    # imdecode e non imread: imread non apre i percorsi Windows con caratteri non ASCII
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    alt, larg = img.shape
    bw = cv2.adaptiveThreshold(~img, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, -2)
    vert = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, alt // 40)))
    oriz = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (larg // 40, 1)))
    # verticali: x con abbastanza pixel di linea, e per ognuna l'estensione in altezza
    linee_v = []
    for x in _posizioni((vert > 0).sum(axis=0), alt / 25):
        colonna = vert[:, max(0, x - 2):x + 3].max(axis=1)
        righe = np.where(colonna > 0)[0]
        if len(righe):
            linee_v.append((x, int(righe[0]), int(righe[-1])))
    # gruppi di verticali che si sovrappongono in altezza = tabelle diverse della pagina
    gruppi = []
    for v in sorted(linee_v, key=lambda t: t[1]):
        for g in gruppi:
            if v[1] <= g["fondo"] and v[2] >= g["cima"]:
                g["linee"].append(v)
                g["cima"], g["fondo"] = min(g["cima"], v[1]), max(g["fondo"], v[2])
                break
        else:
            gruppi.append({"linee": [v], "cima": v[1], "fondo": v[2]})
    if not gruppi:
        return None
    tab = max(gruppi, key=lambda g: len(g["linee"]))
    xs = sorted({v[0] for v in tab["linee"]})
    if len(xs) < 3:
        return None
    x0, x1 = xs[0], xs[-1]
    fascia = oriz[max(0, tab["cima"] - 10):tab["fondo"] + 11, x0:x1 + 1]
    ys = [y + max(0, tab["cima"] - 10) for y in _posizioni((fascia > 0).sum(axis=1), (x1 - x0) * 0.3)]
    if len(ys) < 3:
        return None
    return {"xs": xs, "ys": ys}


def griglia_sicura(path):
    """griglia_tabella senza mai far fallire la pagina: la griglia è un aiuto in più."""
    try:
        return griglia_tabella(path)
    except Exception as e:
        print(f"[worker] griglia non calcolata: {e}", file=sys.stderr)
        return None


def ruota_su_file(path, gradi):
    """Copia temporanea dell'immagine ruotata (per calcolare la griglia sulla pagina
    raddrizzata, nello stesso sistema di coordinate dei blocchi)."""
    import tempfile
    from PIL import Image
    fd, ruotata = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    with Image.open(path) as img:
        img.rotate(gradi, expand=True).save(ruotata)
    return ruotata


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
            # solo la griglia: pagina già letta e in cache, manca il passo delle celle
            # (cache scritta prima che esistesse). Niente OCR, pochi decimi di secondo.
            if req.get("solo_griglia"):
                gradi = int(req.get("rotazione") or 0)
                path = ruota_su_file(req["path"], gradi) if gradi else req["path"]
                try:
                    manda({"id": req["id"], "griglia": griglia_sicura(path)})
                finally:
                    if gradi:
                        os.remove(path)
                continue
            lines, gradi = ocr_orientato(ocr, req["path"])
            risposta = {"id": req["id"], "lines": lines}
            if gradi:
                risposta["rotazione"] = gradi     # pagina raddrizzata: coordinate ruotate
            path = ruota_su_file(req["path"], gradi) if gradi else req["path"]
            try:
                risposta["griglia"] = griglia_sicura(path)
            finally:
                if gradi:
                    os.remove(path)
            manda(risposta)
        except Exception as e:
            manda({"id": req.get("id"), "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
