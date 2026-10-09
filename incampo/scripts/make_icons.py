"""Icone provvisorie InCampo nei colori Cosedil: pin bianco su blu, centro verde."""
import math, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mobile", "assets")
BLUE = (12, 69, 119, 255)     # #0c4577
GREEN = (101, 188, 123, 255)  # #65bc7b
WHITE = (255, 255, 255, 255)
SS = 4  # supersampling per bordi lisci


def pin(size, scale, body, hole, bg=(0, 0, 0, 0), hole_ratio=0.40, dy=0.0):
    """Pin centrato: `scale` = altezza del pin rispetto al lato dell'immagine."""
    S = size * SS
    im = Image.new('RGBA', (S, S), bg)
    d = ImageDraw.Draw(im)
    h = S * scale
    r = h / 3.1                       # raggio della testa
    cx = S / 2
    top = (S - h) / 2 + dy * S
    cy = top + r
    tip = (cx, top + h)
    # tangenti dalla punta al cerchio
    dist = tip[1] - cy
    # punti di tangenza: angolo theta dal centro, simmetrici
    theta = math.acos(r / dist)
    p_left = (cx - r * math.sin(theta), cy + r * math.cos(theta))
    p_right = (cx + r * math.sin(theta), cy + r * math.cos(theta))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=body)
    d.polygon([p_left, p_right, tip], fill=body)
    hr = r * hole_ratio
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=hole)
    return im.resize((size, size), Image.LANCZOS)


def save(im, name, mode='RGBA'):
    im.convert(mode).save(os.path.join(OUT, name), optimize=True)
    print('scritto', name, im.size)


# icona classica (iOS / legacy): quadrato blu pieno, pin grande
save(pin(1024, 0.62, WHITE, GREEN, bg=BLUE), 'icon.png', 'RGB')
# Android adattiva: sfondo blu pieno, pin nella zona sicura (cerchio ~61% centrale)
save(Image.new('RGBA', (512, 512), BLUE), 'android-icon-background.png')
save(pin(512, 0.46, WHITE, GREEN), 'android-icon-foreground.png')
# monocromatica (icone a tema Android 13+): sagoma bianca, foro trasparente
save(pin(432, 0.46, WHITE, (0, 0, 0, 0)), 'android-icon-monochrome.png')
# splash e favicon
save(pin(1024, 0.42, BLUE, GREEN), 'splash-icon.png')  # splash a fondo bianco: pin blu
save(pin(48, 0.72, WHITE, GREEN, bg=BLUE), 'favicon.png')
