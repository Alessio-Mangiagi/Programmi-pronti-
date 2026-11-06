# "><(((º> sabusabu <º)))><"
"""Foto dei mezzi: salvataggio su disco e miniature.

Le foto arrivano dal telefono (grandi, spesso ruotate via EXIF): qui si
raddrizzano, si riducono a FOTO_LATO_MAX px sul lato lungo e si salvano in
JPEG, con una miniatura per le liste. Sul disco: FOTO_DIR/mezzi/<id>/<file>.
Il database (tabella foto_mezzi) tiene nome, dimensioni e chi l'ha caricata.
"""
import io
import os
import secrets

from PIL import Image, ImageOps, UnidentifiedImageError

import config
import messaggi

# Tetto ai pixel di un'immagine: un PNG di pochi KB può dichiarare 20000x20000 pixel e far esplodere la
# memoria in decodifica ("decompression bomb"); oltre questo limite Pillow rifiuta di aprirla.
Image.MAX_IMAGE_PIXELS = 50_000_000

ESTENSIONI = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif"}


class FotoError(messaggi.ErroreParlante):
    pass


def cartella_mezzo(mezzo_id):
    p = os.path.join(config.FOTO_DIR, "mezzi", str(int(mezzo_id)))
    os.makedirs(p, exist_ok=True)
    return p


def _apri(dati):
    try:
        img = Image.open(io.BytesIO(dati))
        # dimensioni lette dall'intestazione prima di decodificare: niente decodifica di immagini assurde
        if img.size[0] * img.size[1] > Image.MAX_IMAGE_PIXELS:
            raise FotoError(f"immagine troppo grande: {img.size[0]}x{img.size[1]} pixel")
        img.load()
    except Image.DecompressionBombError:
        raise FotoError("immagine troppo grande: riducila o scatta una foto a risoluzione normale") from None
    except (UnidentifiedImageError, OSError, ValueError):
        # il testo di Pillow ("cannot identify image file <_io.BytesIO …>") non serve a chi carica la foto
        raise FotoError("immagine non leggibile: carica una foto JPG o PNG") from None
    img = ImageOps.exif_transpose(img)  # raddrizza le foto del telefono
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def _riduci(img, lato):
    img = img.copy()
    img.thumbnail((lato, lato), Image.LANCZOS)
    return img


def salva(mezzo_id, dati, nome_originale=""):
    """Salva foto + miniatura. Ritorna dict con file, larghezza, altezza, byte."""
    if len(dati) > config.FOTO_MAX_BYTE:
        raise FotoError(f"foto oltre {config.FOTO_MAX_BYTE // (1024 * 1024)} MB")
    ext = os.path.splitext(nome_originale or "")[1].lower()
    if ext and ext not in ESTENSIONI:
        raise FotoError(f"formato non ammesso: {ext}")
    img = _apri(dati)
    base = f"{secrets.token_hex(6)}"
    cartella = cartella_mezzo(mezzo_id)
    grande = _riduci(img, config.FOTO_LATO_MAX)
    grande.save(os.path.join(cartella, base + ".jpg"), "JPEG", quality=86, optimize=True)
    _riduci(img, config.FOTO_LATO_MINIATURA).save(os.path.join(cartella, base + ".min.jpg"), "JPEG", quality=80)
    return {"file": base + ".jpg", "larghezza": grande.width, "altezza": grande.height,
            "byte": os.path.getsize(os.path.join(cartella, base + ".jpg"))}


def percorso(mezzo_id, file, miniatura=False):
    """Percorso assoluto della foto (o della miniatura), dentro la cartella del mezzo."""
    nome = os.path.basename(file)
    if miniatura:
        nome = nome[:-4] + ".min.jpg" if nome.endswith(".jpg") else nome + ".min.jpg"
    p = os.path.join(cartella_mezzo(mezzo_id), nome)
    return p if os.path.isfile(p) else None


def elimina(mezzo_id, file):
    for p in (percorso(mezzo_id, file), percorso(mezzo_id, file, miniatura=True)):
        if p:
            try:
                os.remove(p)
            except OSError:
                pass


def elimina_tutte(mezzo_id):
    cartella = os.path.join(config.FOTO_DIR, "mezzi", str(int(mezzo_id)))
    if not os.path.isdir(cartella):
        return
    for nome in os.listdir(cartella):
        try:
            os.remove(os.path.join(cartella, nome))
        except OSError:
            pass
    try:
        os.rmdir(cartella)
    except OSError:
        pass
