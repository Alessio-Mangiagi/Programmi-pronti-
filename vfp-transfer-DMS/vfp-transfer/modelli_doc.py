# "><(((º> sabusabu <º)))><"
"""
Modelli Word 97-2003 (.doc) protetti: conversione in .docx tenendo le aree consentite (gialle).

Senza Word sul PC la conversione la fa LibreOffice, che pero' perde le aree e la protezione. Qui:
  1. il .doc si legge in sola lettura (contenitore OLE, FIB, tabella dei pezzi di testo e le tabelle della
     protezione per intervalli PlcfBkfProt/PlcfBklProt): testo e posizione di ogni area;
  2. LibreOffice converte il resto (testo, formattazione, tabelle, intestazioni);
  3. ogni area si ritrova nel .docx cercando il suo testo preceduto da un pezzo del testo che la precede
     (deve risultare in un solo punto) e si rimettono <w:permStart>/<w:permEnd>, piu' la protezione in sola lettura;
  4. controllo finale: le aree lette dal .docx devono avere esattamente il testo di quelle del .doc. Se un'area non si
     ritrova o non torna, il modello non si usa (ModelloError): meglio nessun contratto che uno con le aree sbagliate.

La copia convertita sta in MODELLI_LAVORO/_convertiti/<impronta del .doc>/<nome>.docx: si rifa' solo se il .doc cambia.
L'originale nella cartella condivisa non viene mai scritto. La password della protezione non si porta nel .docx
(protezione senza password, come aiuto contro le modifiche per errore).

Prova da riga di comando:
  python modelli_doc.py aree --file modello.doc       aree lette dal .doc
  python modelli_doc.py prova [--cartella X]          converte tutti i .doc della cartella dei modelli e dice l'esito
"""

import argparse
import hashlib
import html
import json
import logging
import os
import re
import shutil
import struct
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import env_config

log = logging.getLogger("modelli_doc")

PARTI = re.compile(r"word/(document|header\d*|footer\d*)\.xml")
SPECIALI = set("\t\x0b\x0c\x01\x02\x03\x04\x05\x08\x1e\x1f\r\x07")  # nel .docx non sono testo dei <w:t>
_T = re.compile(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>")
_TOK = re.compile(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:txbxContent\b|</w:txbxContent>|<mc:Fallback\b|</mc:Fallback>")
CONTESTI = (40, 80, 160, 300, 20, 10, 5)
MAX_MB = 50
_LOCK = threading.Lock()  # una conversione alla volta: LibreOffice e' pesante


class DocError(ValueError):
    pass


# --------------------------------------------------------------------------- lettura del .doc

class _Cfb:
    """Contenitore OLE (Compound File Binary), solo lettura."""

    def __init__(self, data):
        if data[:8] != b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1":
            raise DocError("non e' un documento Word 97-2003")
        self.d = data
        self.ss = 1 << struct.unpack_from("<H", data, 0x1E)[0]
        self.mss = 1 << struct.unpack_from("<H", data, 0x20)[0]
        nfat, dir_start, _, self.cutoff, minifat_start, nminifat, difat_start, ndifat = struct.unpack_from("<8I", data, 0x2C)
        difat = list(struct.unpack_from("<109I", data, 0x4C))
        s = difat_start
        for _ in range(ndifat):
            vals = struct.unpack_from(f"<{self.ss // 4}I", self._sec(s))
            difat += vals[:-1]
            s = vals[-1]
        self.fat = []
        for s in difat[:nfat]:
            self.fat += struct.unpack_from(f"<{self.ss // 4}I", self._sec(s))
        dirdata = self._catena(dir_start)
        self.voci = []
        for i in range(len(dirdata) // 128):
            e = dirdata[i * 128:(i + 1) * 128]
            nlen = struct.unpack_from("<H", e, 64)[0]
            start, size = struct.unpack_from("<IQ", e, 116)
            self.voci.append((e[:max(0, nlen - 2)].decode("utf-16-le", "replace"), e[66], start, size))
        self.ministream = self._catena(self.voci[0][2])
        mf = self._catena(minifat_start) if nminifat else b""
        self.minifat = struct.unpack_from(f"<{len(mf) // 4}I", mf) if mf else ()

    def _sec(self, n):
        o = (n + 1) * self.ss
        if o + self.ss > len(self.d):
            raise DocError("documento troncato")
        return self.d[o:o + self.ss]

    def _catena(self, start):
        out, s, giri = bytearray(), start, 0
        while s < 0xFFFFFFFA:
            if giri > len(self.fat):
                raise DocError("catena di settori non valida")
            out += self._sec(s)
            s = self.fat[s]
            giri += 1
        return bytes(out)

    def flusso(self, nome):
        for n, tipo, start, size in self.voci:
            if n == nome and tipo == 2:
                if size < self.cutoff:
                    out, s = bytearray(), start
                    while s < 0xFFFFFFFA and len(out) < size:
                        out += self.ministream[s * self.mss:(s + 1) * self.mss]
                        s = self.minifat[s]
                    return bytes(out[:size])
                return self._catena(start)[:size]
        raise DocError(f"flusso {nome} mancante")


class DocWord:
    """Testo e aree consentite di un .doc (Word 97-2003), in sola lettura."""

    def __init__(self, path):
        path = Path(path)
        if path.stat().st_size > MAX_MB * 1024 * 1024:
            raise DocError(f"{path.name}: piu' di {MAX_MB} MB")
        cfb = _Cfb(path.read_bytes())
        w = cfb.flusso("WordDocument")
        if struct.unpack_from("<H", w, 0)[0] != 0xA5EC:
            raise DocError("intestazione Word (FIB) non valida")
        if struct.unpack_from("<H", w, 0x0A)[0] & 0x0100:
            raise DocError("documento cifrato con password")
        self.w = w
        self.tabella = cfb.flusso("1Table" if struct.unpack_from("<H", w, 0x0A)[0] & 0x0200 else "0Table")
        pos = 32
        pos += 2 + struct.unpack_from("<H", w, pos)[0] * 2
        cslw = struct.unpack_from("<H", w, pos)[0]
        self.rglw = struct.unpack_from(f"<{cslw}i", w, pos + 2)
        pos += 2 + cslw * 4
        n = struct.unpack_from("<H", w, pos)[0]
        self.fclcb = [struct.unpack_from("<II", w, pos + 2 + i * 8) for i in range(n)]
        self._pezzi()
        self.testo = self.leggi(0, self.pezzi[-1][1]) if self.pezzi else ""

    def _blob(self, i):
        if i >= len(self.fclcb):
            return b""
        fc, lcb = self.fclcb[i]
        return self.tabella[fc:fc + lcb] if lcb else b""

    def _pezzi(self):
        clx, i = self._blob(33), 0  # fcClx
        while i < len(clx) and clx[i] == 1:  # Prc da saltare
            i += 3 + struct.unpack_from("<H", clx, i + 1)[0]
        if i >= len(clx) or clx[i] != 2:
            raise DocError("tabella dei pezzi di testo non trovata")
        lcb = struct.unpack_from("<I", clx, i + 1)[0]
        plc = clx[i + 5:i + 5 + lcb]
        n = (lcb - 4) // 12
        cps = struct.unpack_from(f"<{n + 1}I", plc)
        self.pezzi = []
        for k in range(n):
            fcv = struct.unpack_from("<I", plc, 4 * (n + 1) + k * 8 + 2)[0]
            compresso = bool(fcv & 0x40000000)
            fc = (fcv & 0x3FFFFFFF) // 2 if compresso else fcv & 0x3FFFFFFF
            self.pezzi.append((cps[k], cps[k + 1], fc, compresso))

    def leggi(self, a, b):
        out = []
        for c0, c1, fc, compresso in self.pezzi:
            lo, hi = max(a, c0), min(b, c1)
            if lo < hi:
                if compresso:
                    out.append(self.w[fc + lo - c0:fc + hi - c0].decode("cp1252", "replace"))
                else:
                    out.append(self.w[fc + 2 * (lo - c0):fc + 2 * (hi - c0)].decode("utf-16-le", "replace"))
        return "".join(out)

    def aree(self):
        """[(inizio, fine)] delle aree consentite in posizioni di carattere (FibRgFcLcb2003: PlcfBkfProt, PlcfBklProt)."""
        if len(self.fclcb) < 144:
            return []
        bkf, bkl = self._blob(142), self._blob(143)
        if not bkf or not bkl:
            return []
        if (len(bkf) - 4) % 10:
            raise DocError("tabella delle aree consentite non riconosciuta")
        n = (len(bkf) - 4) // 10  # n+1 posizioni e n FBKFD da 6 byte
        inizi = struct.unpack_from(f"<{n}I", bkf)
        if len(bkl) != 4 * (n + 1):
            raise DocError("fini delle aree consentite non riconosciute")
        fini = struct.unpack_from(f"<{n}I", bkl)
        out = []
        for i, cp in enumerate(inizi):
            ibkl = struct.unpack_from("<H", bkf, 4 * (n + 1) + i * 6)[0]
            if ibkl >= n or fini[ibkl] < cp:
                raise DocError("area consentita senza fine valida")
            out.append((cp, fini[ibkl]))
        # aree una dentro l'altra o accavallate (Word le ammette, es. permessi per persone diverse): si uniscono,
        # l'area unita copre esattamente lo stesso testo modificabile
        unite = []
        for a, b in sorted(out):
            if unite and a < unite[-1][1]:
                unite[-1] = (unite[-1][0], max(unite[-1][1], b))
            else:
                unite.append((a, b))
        return unite

    def inizi_storie(self):
        """Posizioni di inizio di testo, note, intestazioni, commenti...: il contesto di un'area resta nella sua."""
        out, pos = [], 0
        for lung in self.rglw[3:11]:
            out.append(pos)
            pos += max(0, lung)
        return out


def norm(testo):
    """Testo del .doc come appare nei <w:t> del .docx: senza codici di campo e senza segni speciali o a capo."""
    out, pila = [], []
    for ch in testo:
        if ch == "\x13":
            pila.append("codice")
        elif ch == "\x14":
            if pila:
                pila[-1] = "risultato"
        elif ch == "\x15":
            if pila:
                pila.pop()
        elif "codice" not in pila and ch not in SPECIALI:
            out.append(ch)
    return "".join(out)


# --------------------------------------------------------------------------- aree nel .docx

def piatto(xml):
    """Testo dei <w:t> della parte (fuori da caselle di testo e alternative VML), con (inizio, fine tag, k) per carattere."""
    out, mappa, salta = [], [], 0
    for m in _TOK.finditer(xml):
        tok = m.group(0)
        if tok.startswith(("<w:txbxContent", "<mc:Fallback")):
            salta += 1
        elif tok.startswith(("</w:txbxContent", "</mc:Fallback")):
            salta -= 1
        elif not salta:
            for k, ch in enumerate(html.unescape(m.group(1))):
                out.append(ch)
                mappa.append((m.start(), m.end(), k))
    return "".join(out), mappa


def trova_aree(doc, parti):
    """[{"corpo", "posti": [(parte, i0, i1)]}] per ogni area del .doc; posti vuoto = non ritrovata con certezza."""
    piatti = {n: piatto(x) for n, x in parti.items()}
    storie = doc.inizi_storie()
    esiti = []
    for a, b in doc.aree():
        corpo = norm(doc.testo[a:b])
        storia = max(s for s in storie if s <= a)
        prima = norm(doc.testo[max(storia, a - 600):a])
        posti = []
        for k in CONTESTI:
            if k > len(prima) and k != CONTESTI[-1]:
                continue
            chiave = prima[-k:] + corpo
            trovati = []
            for n, (txt, _) in piatti.items():
                j = txt.find(chiave)
                while j >= 0:
                    trovati.append((n, j + len(chiave) - len(corpo), j + len(chiave)))
                    j = txt.find(chiave, j + 1)
            if trovati and len({t[0] for t in trovati}) == len(trovati):  # unico, o uno per intestazione ripetuta
                posti = trovati
                break
        esiti.append({"corpo": corpo, "posti": posti})
    return esiti, piatti


def _run_di(xml, pos):
    a = max(xml.rfind("<w:r>", 0, pos), xml.rfind("<w:r ", 0, pos))
    b = xml.find("</w:r>", pos) + len("</w:r>")
    rpr = re.search(r"<w:rPr>.*?</w:rPr>|<w:rPr/>", xml[a:pos], re.S)
    return a, b, rpr.group(0) if rpr else ""


def metti_aree(parti, esiti, piatti, primo_id=1000):
    """permStart/permEnd nelle parti: tra due run se il confine coincide, altrimenti il run si divide (stesso rPr)."""
    per_parte, nid = {}, primo_id
    for e in esiti:
        for n, i0, i1 in e["posti"] if e["corpo"] else ():
            per_parte.setdefault(n, []).append((i0, i1, nid))
            nid += 1
    for n, aree in per_parte.items():
        xml, mappa = parti[n], piatti[n][1]
        modifiche, tagli = [], {}
        for i0, i1, aid in aree:
            for idx, fine in ((i0, False), (i1, True)):
                segno = f'<w:permEnd w:id="{aid}"/>' if fine else f'<w:permStart w:id="{aid}" w:edGrp="everyone"/>'
                ordine = 0 if fine else 1  # nello stesso punto: prima la fine di un'area, poi l'inizio dell'altra
                t0, t1, k = mappa[idx - 1] if fine else mappa[idx]
                k += 1 if fine else 0
                lung = len(html.unescape(_T.match(xml, t0).group(1)))
                ra, rb, _ = _run_di(xml, t0)
                if k == 0 and xml.rfind("<w:t", ra, t0) < 0:
                    modifiche.append((ra, ra, segno, ordine))
                elif k == lung and xml.find("<w:t", t1, rb) < 0:
                    modifiche.append((rb, rb, segno, ordine))
                else:
                    tagli.setdefault((t0, t1), []).append((k, ordine, segno))
        for (t0, t1), punti in tagli.items():
            testo = html.unescape(_T.match(xml, t0).group(1))
            rpr = _run_di(xml, t0)[2]
            pezzi, prec = [], 0
            for k, _, segno in sorted(punti):
                pezzi.append(f'<w:t xml:space="preserve">{escape(testo[prec:k])}</w:t></w:r>{segno}<w:r>{rpr}')
                prec = k
            pezzi.append(f'<w:t xml:space="preserve">{escape(testo[prec:])}</w:t>')
            modifiche.append((t0, t1, "".join(pezzi), 0))
        for a, b, testo, _ in sorted(modifiche, key=lambda m: (m[0], m[3]), reverse=True):
            xml = xml[:a] + testo + xml[b:]
        parti[n] = xml
    return parti


def proteggi(settings_xml):
    """Protezione in sola lettura (tranne le aree consentite), senza password."""
    s = re.sub(r"<w:documentProtection\b[^>]*/>", "", settings_xml)
    return re.sub(r"(<w:settings\b[^>]*>)", r'\1<w:documentProtection w:edit="readOnly" w:enforcement="1"/>', s, count=1)


# --------------------------------------------------------------------------- conversione

def soffice(s=None):
    """Percorso di LibreOffice (LIBREOFFICE nelle variabili d'ambiente, altrimenti le cartelle di installazione)."""
    for p in (os.environ.get("LIBREOFFICE"), r"C:\Program Files\LibreOffice\program\soffice.exe",
              r"C:\Program Files (x86)\LibreOffice\program\soffice.exe", shutil.which("soffice")):
        if p and Path(p).is_file():
            return Path(p)
    return None


def _libreoffice(doc_path, cartella):
    exe = soffice()
    if not exe:
        raise DocError("LibreOffice non installato: serve per usare i modelli .doc (oppure salvarli come .docx in Word)")
    profilo = Path(cartella) / "profilo"
    copia = Path(cartella) / "modello.doc"
    shutil.copyfile(doc_path, copia)  # LibreOffice lavora su una copia: l'originale resta solo letto
    try:
        subprocess.run([str(exe), f"-env:UserInstallation={profilo.as_uri()}", "--headless", "--norestore",
                        "--convert-to", "docx:MS Word 2007 XML", "--outdir", str(cartella), str(copia)],
                       check=True, capture_output=True, timeout=240,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise DocError("LibreOffice non ha finito la conversione in 4 minuti")
    except subprocess.CalledProcessError as e:
        raise DocError(f"conversione non riuscita ({e.returncode})")
    out = Path(cartella) / "modello.docx"
    if not out.is_file():
        raise DocError("LibreOffice non ha prodotto il .docx")
    return out


def converti(doc_path, dest):
    """Scrive in dest il .docx con le aree consentite del .doc. Restituisce il resoconto; DocError se non torna."""
    from modelli_protetti import leggi_aree  # import qui: modelli_protetti usa questo modulo
    doc = DocWord(doc_path)
    aree_doc = doc.aree()
    if not aree_doc:
        raise DocError(f"{Path(doc_path).name}: nessuna area consentita (gialla) nel documento")
    with tempfile.TemporaryDirectory(prefix="vfp_doc_") as tmp:
        docx = _libreoffice(doc_path, tmp)
        with zipfile.ZipFile(docx) as z:
            infos = z.infolist()
            dati = {i.filename: z.read(i) for i in infos}
    parti = {n: dati[n].decode("utf-8") for n in dati if PARTI.fullmatch(n)}
    # il testo del contratto (corpo) deve essere identico, carattere per carattere, a quello del .doc
    if norm(doc.testo[:max(0, doc.rglw[3])]) != piatto(parti.get("word/document.xml", ""))[0]:
        raise DocError(f"{Path(doc_path).name}: la conversione cambierebbe il testo del contratto")
    esiti, piatti = trova_aree(doc, parti)
    vuote = sum(1 for e in esiti if not e["corpo"])
    perse = [e["corpo"][:60] or "(vuota)" for e in esiti if e["corpo"] and not e["posti"]]
    if perse:
        raise DocError(f"{Path(doc_path).name}: aree non ritrovate dopo la conversione: " + " | ".join(perse[:5]))
    parti = metti_aree(parti, esiti, piatti)
    dest = Path(dest)
    tmp_dest = dest.with_name(dest.stem + ".tmp.docx")
    with zipfile.ZipFile(tmp_dest, "w", zipfile.ZIP_DEFLATED) as z:
        for i in infos:
            data = parti[i.filename].encode("utf-8") if i.filename in parti else dati[i.filename]
            if i.filename == "word/settings.xml":
                data = proteggi(data.decode("utf-8")).encode("utf-8")
            z.writestr(i, data)
    # controllo finale: ogni area del .docx ha il testo di un'area del .doc, e ci sono tutte
    attese = sorted(e["corpo"] for e in esiti for _ in e["posti"] if e["corpo"])
    lette = sorted(a["testo"].replace("\n", "") for a in leggi_aree(tmp_dest)["aree"])
    if attese != lette:
        tmp_dest.unlink()
        raise DocError(f"{Path(doc_path).name}: dopo la conversione le aree non corrispondono all'originale")
    os.replace(tmp_dest, dest)
    return {"aree": len(aree_doc), "inserite": len(lette), "vuote": vuote}


def cartella_cache(s):
    return env_config.resolve_path(s.get("MODELLI_LAVORO") or "modelli_compilati") / "_convertiti"


def docx_di(s, doc_path):
    """Il .docx da usare al posto del .doc (convertito una volta, rifatto solo se il .doc cambia)."""
    doc_path = Path(doc_path)
    impronta = hashlib.sha256(doc_path.read_bytes()).hexdigest()
    d = cartella_cache(s) / impronta[:24]
    import estrai_dms
    dest = d / (estrai_dms.nome_sicuro(doc_path.stem) + ".docx")
    if dest.is_file():
        return dest
    with _LOCK:
        if dest.is_file():
            return dest
        d.mkdir(parents=True, exist_ok=True)
        log.info("Conversione del modello %s in .docx", doc_path.name)
        esito = converti(doc_path, dest)
        (d / "conversione.json").write_text(json.dumps({"origine": str(doc_path), "sha256": impronta, **esito},
                                                       ensure_ascii=False, indent=1), encoding="utf-8")
    return dest


# --------------------------------------------------------------------------- CLI di prova

def main():
    p = argparse.ArgumentParser(description="Modelli .doc protetti: aree consentite e conversione in .docx.")
    p.add_argument("azione", choices=("aree", "prova"))
    p.add_argument("--file", help=".doc da leggere (aree)")
    p.add_argument("--cartella", help="cartella dei .doc da provare (predefinita: MODELLI_SORGENTE)")
    p.add_argument("--filtro", default="", help="solo i file con questo testo nel nome (prova)")
    p.add_argument("--env", default=None)
    args = p.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    if args.azione == "aree":
        doc = DocWord(args.file)
        for i, (a, b) in enumerate(doc.aree()):
            print(f"[{i}] {norm(doc.testo[a:b])[:150]!r}")
        return
    if args.cartella:
        root = Path(args.cartella)
    else:
        root = Path(env_config.read_env_file(args.env or env_config.ENV_PATH).get("MODELLI_SORGENTE", ""))
    file = [f for f in sorted(root.rglob("*.doc")) if args.filtro.lower() in f.name.lower()]
    ok, ko = 0, []
    with tempfile.TemporaryDirectory(prefix="vfp_prova_") as tmp:
        for i, f in enumerate(file, 1):
            try:
                esito = converti(f, Path(tmp) / f"{i}.docx")
                ok += 1
                print(f"ok  {esito['inserite']:3d} aree  {f.relative_to(root)}", flush=True)
            except (DocError, OSError, ValueError) as e:
                ko.append((f, e))
                print(f"NO  {f.relative_to(root)}: {e}", flush=True)
    print(f"\n{ok} convertiti su {len(file)}; {len(ko)} non utilizzabili")


if __name__ == "__main__":
    main()
