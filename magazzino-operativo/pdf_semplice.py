# "><(((º> sabusabu <º)))><"
"""PDF di sole tabelle, scritto a mano: nessuna dipendenza, font Helvetica di base.

Serve per i report che il Magazzino manda a SkyTower (giacenze e mezzi di un
cantiere). Testo in WinAnsi (Latin-1): i caratteri fuori tabella diventano "?".
Più sezioni (ognuna parte su una pagina nuova), più pagine, intestazione di
tabella ripetuta, colonne numeriche a destra."""
from datetime import datetime

A4 = (595.28, 841.89)
MARGINE = 40.0
RIGA = 14.0


def _esc(testo):
    b = str(testo or "").encode("cp1252", "replace")
    return b.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _larghezza(testo, dim):
    # Helvetica: stima media 0.52 em per carattere (bastante per tagliare le celle)
    return len(str(testo or "")) * dim * 0.52


def _taglia(testo, dim, max_pt):
    t = str(testo or "")
    if _larghezza(t, dim) <= max_pt:
        return t
    while t and _larghezza(t + "…", dim) > max_pt:
        t = t[:-1]
    return t + "…"


class _Pagine:
    """Accumula il contenuto pagina per pagina."""

    def __init__(self):
        self.pagine = []
        self.corrente = []
        self.y = A4[1] - MARGINE

    def nuova(self):
        if self.corrente:
            self.pagine.append(b"\n".join(self.corrente))
            self.corrente = []
        self.y = A4[1] - MARGINE

    def chiudi(self):
        if self.corrente or not self.pagine:
            self.pagine.append(b"\n".join(self.corrente))
            self.corrente = []
        return self.pagine

    def testo(self, t, dim, x, yy, grassetto=False, grigio=False, destra=False, larg=None):
        if destra and larg is not None:
            x = x + larg - _larghezza(t, dim)
        font = b"/F2" if grassetto else b"/F1"
        colore = b"0.42 0.42 0.42 rg" if grigio else b"0.13 0.14 0.15 rg"
        self.corrente.append(b"BT " + colore + b" " + font + b" %.1f Tf %.2f %.2f Td (" % (dim, x, yy) + _esc(t) + b") Tj ET")

    def rettangolo(self, x, y, w, h, grigio="0.949 0.953 0.961"):
        self.corrente.append(f"{grigio} rg".encode() + b" %.2f %.2f %.2f %.2f re f" % (x, y, w, h))

    def linea(self, x1, y1, x2, y2):
        self.corrente.append(b"0.90 0.91 0.93 RG 0.5 w %.2f %.2f m %.2f %.2f l S" % (x1, y1, x2, y2))


def _sezione(p, titolo, intestazioni, righe, sottotitolo="", numeriche=(), larghezze=None):
    larg_utile = A4[0] - 2 * MARGINE
    n = len(intestazioni)
    pesi = list(larghezze) if larghezze else [1] * n
    tot = float(sum(pesi)) or 1.0
    col = [larg_utile * pp / tot for pp in pesi]

    def testata():
        p.testo(titolo, 15, MARGINE, p.y - 15, grassetto=True)
        p.y -= 22
        if sottotitolo:
            p.testo(sottotitolo, 9.5, MARGINE, p.y - 10, grigio=True)
            p.y -= 16
        p.y -= 6
        p.rettangolo(MARGINE, p.y - RIGA - 3, larg_utile, RIGA + 4)
        x = MARGINE + 4
        for i, h in enumerate(intestazioni):
            p.testo(_taglia(h.upper(), 7.5, col[i] - 8), 7.5, x, p.y - RIGA + 1, grassetto=True, grigio=True,
                    destra=i in numeriche, larg=col[i] - 8)
            x += col[i]
        p.y -= RIGA + 6

    testata()
    for r in righe:
        if p.y < MARGINE + RIGA * 2:
            p.nuova()
            testata()
        x = MARGINE + 4
        for i in range(n):
            v = r[i] if i < len(r) else ""
            p.testo(_taglia(v, 9, col[i] - 8), 9, x, p.y - RIGA + 3, destra=i in numeriche, larg=col[i] - 8)
            x += col[i]
        p.linea(MARGINE, p.y - RIGA, MARGINE + larg_utile, p.y - RIGA)
        p.y -= RIGA
    if not righe:
        p.testo("Nessuna riga.", 9.5, MARGINE + 4, p.y - RIGA + 3, grigio=True)
        p.y -= RIGA


def documento_pdf(sezioni, piede=""):
    """PDF A4 con una o più sezioni: ognuna {titolo, intestazioni, righe, sottotitolo?, numeriche?, larghezze?}
    e parte su una pagina nuova. Ritorna i byte."""
    p = _Pagine()
    for i, s in enumerate(sezioni):
        if i:
            p.nuova()
        _sezione(p, s["titolo"], s["intestazioni"], s["righe"], s.get("sottotitolo", ""),
                 tuple(s.get("numeriche") or ()), s.get("larghezze"))
    pagine = p.chiudi()

    # Oggetti: 1 catalogo, 2 pagine, 3 font normale, 4 font grassetto, poi (pagina, contenuto) per ogni pagina
    oggetti = [b"<< /Type /Catalog /Pages 2 0 R >>", b"",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]
    kids = []
    for i, corpo in enumerate(pagine):
        piede_t = f"{piede or ''}   Pagina {i + 1} di {len(pagine)}".strip()
        corpo += b"\nBT 0.42 0.42 0.42 rg /F1 7.5 Tf %.2f %.2f Td (" % (MARGINE, MARGINE - 16) + _esc(piede_t) + b") Tj ET"
        n_pag = len(oggetti) + 1
        kids.append(b"%d 0 R" % n_pag)
        oggetti.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents %d 0 R >>" % (A4[0], A4[1], n_pag + 1))
        oggetti.append(b"<< /Length %d >>\nstream\n" % len(corpo) + corpo + b"\nendstream")
    oggetti[1] = b"<< /Type /Pages /Kids [" + b" ".join(kids) + b"] /Count %d >>" % len(kids)

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offset = []
    for i, o in enumerate(oggetti):
        offset.append(len(out))
        out += b"%d 0 obj\n" % (i + 1) + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(oggetti) + 1)
    for off in offset:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(oggetti) + 1, xref)
    return bytes(out)


def tabella_pdf(titolo, intestazioni, righe, sottotitolo="", numeriche=(), larghezze=None, piede=""):
    """Una sola tabella (scorciatoia di documento_pdf)."""
    return documento_pdf([{"titolo": titolo, "intestazioni": intestazioni, "righe": righe, "sottotitolo": sottotitolo,
                           "numeriche": numeriche, "larghezze": larghezze}], piede)


def data_it(d=None):
    return (d or datetime.now()).strftime("%d/%m/%Y %H:%M")
