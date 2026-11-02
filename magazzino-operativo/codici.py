# "><(((º> sabusabu <º)))><"
"""Codici a barre e riconoscimento delle scansioni.

- Code 128 (set B) disegnato in SVG con un encoder nostro: niente librerie,
  l'etichetta la stampa il browser.
- QR con `segno` (pure Python) se installato: un telefono legge meglio un QR
  che un Code 128 stampato piccolo. Senza segno l'etichetta ha solo il Code 128.
- Codici interni progressivi per articoli, mezzi e ubicazioni (MAG-00001...).
- `risolvi` dice cosa c'è dietro un codice scansionato: codice interno, codice
  esterno del fornitore (EAN), targa o matricola di un mezzo.
"""
import re
import unicodedata

try:
    import segno
except ImportError:  # pragma: no cover - dipende dall'ambiente
    segno = None

# Larghezze barre/spazi dei 107 simboli Code 128 (0-102 dati, 103-105 start, 106 stop)
_CODE128 = (
    "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 "
    "122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 "
    "322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 "
    "112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 "
    "331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 "
    "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 "
    "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 "
    "411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split()
_START_B = 104
_STOP = 106


class CodiceError(ValueError):
    pass


def code128_valori(testo):
    """Valori dei simboli (set B) con start e checksum, senza lo stop."""
    if not testo:
        raise CodiceError("testo vuoto")
    valori = [_START_B]
    for i, ch in enumerate(testo, start=1):
        v = ord(ch) - 32
        if not 0 <= v <= 95:
            raise CodiceError(f"carattere non codificabile in Code 128 B: {ch!r}")
        valori.append(v)
    somma = _START_B + sum(i * v for i, v in enumerate(valori[1:], start=1))
    valori.append(somma % 103)
    return valori


def code128_svg(testo, altezza=48, modulo=2, quiet=10, testo_sotto=True):
    """SVG del Code 128 B di `testo`. Larghezza in unità = moduli."""
    valori = code128_valori(testo) + [_STOP]
    x = quiet
    barre = []
    for v in valori:
        for i, w in enumerate(_CODE128[v]):
            w = int(w)
            if i % 2 == 0:  # posizioni pari = barre, dispari = spazi
                barre.append(f'<rect x="{x * modulo}" y="0" width="{w * modulo}" height="{altezza}"/>')
            x += w
    x += quiet
    larghezza = x * modulo
    h_tot = altezza + (14 if testo_sotto else 0)
    etichetta = ""
    if testo_sotto:
        etichetta = (f'<text x="{larghezza / 2}" y="{altezza + 11}" text-anchor="middle" '
                     f'font-family="monospace" font-size="11">{_xml(testo)}</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {larghezza} {h_tot}" '
            f'width="{larghezza}" height="{h_tot}" shape-rendering="crispEdges" fill="#212326">'
            f'{"".join(barre)}{etichetta}</svg>')


def qr_svg(testo, scala=3):
    """SVG del QR di `testo`, o stringa vuota se `segno` non è installato."""
    if segno is None:
        return ""
    qr = segno.make(testo, error="m")
    return qr.svg_inline(scale=scala, border=2, dark="#212326")


def _xml(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


# --------------------------------------------------------------------------- normalizzazione

def normalizza(testo):
    """Chiave di confronto: minuscolo, senza accenti, spazi e punteggiatura compressi.
    'Calcestruzzo C25/30 ' e 'calcestruzzo c25/30' sono lo stesso articolo."""
    t = unicodedata.normalize("NFKD", str(testo or ""))
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = re.sub(r"[^a-z0-9/]+", " ", t)
    return " ".join(t.split())


def normalizza_codice(codice):
    """Il lettore può aggiungere a capo o spazi; le targhe arrivano anche minuscole."""
    return re.sub(r"\s+", "", str(codice or "")).upper()


def prossimo_codice(conn, tabella, prefisso):
    """MAG-00001, MAG-00002... dal massimo progressivo già in tabella."""
    riga = conn.execute(
        f"SELECT codice FROM {tabella} WHERE codice LIKE ? ORDER BY CAST(substr(codice, ?) AS INTEGER) DESC LIMIT 1",
        (f"{prefisso}-%", len(prefisso) + 2)).fetchone()
    n = 0
    if riga:
        try:
            n = int(riga["codice"].split("-", 1)[1])
        except (IndexError, ValueError):
            n = 0
    return f"{prefisso}-{n + 1:05d}"


# --------------------------------------------------------------------------- scansione

def risolvi(conn, codice):
    """Cosa c'è dietro un codice: {'tipo': 'articolo'|'mezzo'|'ubicazione', 'id': ...}
    oppure None. Ordine: codice interno, codice esterno, targa, matricola."""
    c = normalizza_codice(codice)
    if not c:
        return None
    for tabella, tipo in (("articoli", "articolo"), ("mezzi", "mezzo"), ("ubicazioni", "ubicazione")):
        r = conn.execute(f"SELECT id FROM {tabella} WHERE upper(codice) = ?", (c,)).fetchone()
        if r:
            return {"tipo": tipo, "id": r["id"]}
    r = conn.execute("SELECT id FROM articoli WHERE upper(codice_esterno) = ? AND attivo = 1", (c,)).fetchone()
    if r:
        return {"tipo": "articolo", "id": r["id"]}
    r = conn.execute(
        "SELECT id FROM mezzi WHERE (upper(replace(targa, ' ', '')) = ? OR upper(matricola) = ?) AND attivo = 1 "
        "ORDER BY id DESC",
        (c, c)).fetchone()
    if r:
        return {"tipo": "mezzo", "id": r["id"]}
    return None
