# Genera Confronta_file.ico dall'immagine PNG (icona dei collegamenti).
# Pad a quadrato per non deformare e salva i formati multipli richiesti da Windows.
from pathlib import Path

from PIL import Image

here = Path(__file__).parent
# "><(((º> sabusabu <º)))><"
src = here / "Confronta_file.png"
out = here / "Confronta_file.ico"

img = Image.open(src).convert("RGBA")
side = max(img.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
canvas.save(out, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("Icona creata:", out)
