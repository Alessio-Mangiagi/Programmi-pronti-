# "><(((º> sabusabu <º)))><"
"""Contenuti demo realistici per la commessa PRJ01: cartelle, tavole PDF con cartiglio, relazioni, foto e
render, modelli IFC, elenchi CSV e capitolati, con revisioni in stati diversi, annotazioni, approvazioni,
RFI e transmittal. Passa dall'API come un utente vero (caricamento, antivirus, permessi, registro), quindi
funziona su qualsiasi istanza con il seed demo: `cde demo-contenuti --api http://127.0.0.1:8100`.
Solo sviluppo/collaudo: usa gli utenti demo."""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import random
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

from . import glb_model, ifc_complex

_FIXED_DATE = datetime(2026, 10, 1, tzinfo=UTC)          # PDF demo deterministici

DEMO_PASSWORD = "Cantiere-2026!"  # noqa: S105 - utenti demo

USERS = {k: f"{k.replace('_', '.')}@{d}" for k, d in {
    "com_admin": "com.example", "com_im": "com.example", "com_dl": "com.example", "des_lead": "des.example",
    "des_designer": "des.example", "des_admin": "des.example", "sub1_user": "sub1.example",
    "sub1_admin": "sub1.example", "sub2_user": "sub2.example", "gc_admin": "gco.example"}.items()}

# cartelle aggiuntive: (organizzazione, utente che le crea, cartella padre (nome), nome)
FOLDERS = [
    ("DES", "des_admin", "Tavole architettoniche", "Piante"),
    ("DES", "des_admin", "Tavole architettoniche", "Prospetti e sezioni"),
    ("DES", "des_admin", "DES - Progetto architettonico", "Modelli BIM"),
    ("DES", "des_admin", "DES - Progetto architettonico", "Relazioni e capitolati"),
    ("SUB1", "sub1_admin", "SUB1 - Impianti elettrici", "Schemi unifilari"),
    ("SUB1", "sub1_admin", "SUB1 - Impianti elettrici", "Relazioni impianti"),
    ("COM", "com_admin", "COM - Documenti committente", "Verbali"),
    ("COM", "com_admin", "COM - Documenti committente", "Foto di cantiere"),
]

ROOMS = ["Ingresso", "Attesa", "Ambulatorio 1", "Ambulatorio 2", "Sala riunioni", "Archivio", "Locale tecnico",
         "Servizi", "Spogliatoio", "Deposito", "Ufficio", "Corridoio"]


# ---------------------------------------------------------------------
# Generatori di file
# ---------------------------------------------------------------------
def _title_block(pdf, x, y, w, project: str, title: str, code: str, rev: str, scale: str):
    pdf.set_line_width(0.4)
    pdf.rect(x, y, w, 32)
    pdf.line(x, y + 12, x + w, y + 12)
    pdf.line(x + w * 0.62, y + 12, x + w * 0.62, y + 32)
    pdf.set_font("Helvetica", "B", 9)
    pdf.text(x + 3, y + 5, project)
    pdf.set_font("Helvetica", "B", 12)
    pdf.text(x + 3, y + 10.5, title[:48])
    pdf.set_font("Helvetica", "", 8)
    pdf.text(x + 3, y + 18, f"Codice: {code}")
    pdf.text(x + 3, y + 23, f"Scala: {scale}")
    pdf.text(x + 3, y + 28, "Studio Progettazione Srl")
    pdf.set_font("Helvetica", "B", 16)
    pdf.text(x + w * 0.62 + 4, y + 24, f"Rev. {rev}")


def drawing_pdf(seed: int, title: str, code: str, rev: str, variant: int = 0, pages: int = 1,
                legend: list[str] | None = None) -> bytes:
    """Tavola A3 con il cartiglio; legend = elementi del modello BIM rappresentati (nomi come nell'IFC)."""
    from fpdf import FPDF

    rnd = random.Random(seed)
    pdf = FPDF(orientation="L", format="A3")
    pdf.set_auto_page_break(False)
    for page in range(pages):
        pdf.add_page()
        pdf.set_line_width(0.8)
        pdf.rect(10, 10, 400, 277)
        ox, oy, cols, rows = 30, 30, rnd.randint(3, 5), rnd.randint(2, 3)
        cw, ch = 300 / cols, 200 / rows
        pdf.set_line_width(1.4)
        pdf.rect(ox, oy, 300, 200)
        pdf.set_line_width(0.7)
        for i in range(1, cols):
            pdf.line(ox + i * cw, oy, ox + i * cw, oy + 200)
        for j in range(1, rows):
            pdf.line(ox, oy + j * ch, ox + 300, oy + j * ch)
        pdf.set_font("Helvetica", "", 9)
        for i in range(cols):
            for j in range(rows):
                room = ROOMS[(i * rows + j + seed + page) % len(ROOMS)]
                area = round(cw * ch / 100 * rnd.uniform(0.85, 1.0), 1)
                pdf.text(ox + i * cw + 4, oy + j * ch + ch / 2, room)
                pdf.text(ox + i * cw + 4, oy + j * ch + ch / 2 + 5, f"{area} mq")
                pdf.line(ox + i * cw + cw / 2 - 5, oy + j * ch, ox + i * cw + cw / 2 + 5, oy + j * ch)   # porta
        pdf.set_line_width(0.3)                                                                     # quote
        pdf.line(ox, oy + 210, ox + 300, oy + 210)
        pdf.text(ox + 140, oy + 216, f"{300 / 10 * rnd.uniform(0.9, 1.1):.2f} m")
        if variant:                                                                                 # modifiche di revisione
            pdf.set_line_width(1.0)
            pdf.rect(ox + 300 + 8, oy + 20, 40, 60)
            pdf.text(ox + 312, oy + 55, "Ampliamento")
            pdf.ellipse(ox + cw * 0.3, oy + ch * 0.3, 18, 18)
            pdf.text(ox + cw * 0.3 + 2, oy + ch * 0.3 + 25, f"Rev. {rev}")
        if legend:                                                                                  # elementi BIM
            pdf.set_font("Helvetica", "B", 8)
            pdf.text(338, 125, "Elementi BIM rappresentati")
            pdf.set_font("Helvetica", "", 7)
            for k, item in enumerate(legend[:20]):
                pdf.text(338, 131 + k * 4.5, f"- {item}")
        pdf.set_font("Helvetica", "B", 9)
        pdf.text(360, 24, "N")
        pdf.line(362, 26, 362, 40)
        _title_block(pdf, 250, 250, 155, "PRJ01 - Nuovo Ospedale Nord", f"{title} ({page + 1}/{pages})", code, rev,
                     rnd.choice(["1:50", "1:100", "1:20"]))
    return bytes(pdf.output())


LOREM = ("L'intervento prevede la realizzazione del nuovo edificio con struttura in calcestruzzo armato e "
         "tamponamenti in laterizio. Le scelte progettuali rispondono ai requisiti di sicurezza antincendio, "
         "accessibilità e contenimento energetico previsti dalla normativa vigente. Le lavorazioni sono "
         "organizzate per fasi in modo da mantenere operative le aree adiacenti. ")


def report_pdf(seed: int, title: str, code: str, rev: str, chapters: list[str]) -> bytes:
    from fpdf import FPDF

    rnd = random.Random(seed)
    pdf = FPDF(format="A4")
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20)
    pdf.ln(60)
    pdf.multi_cell(0, 10, title, align="C")
    pdf.set_font("Helvetica", "", 12)
    pdf.ln(10)
    pdf.multi_cell(0, 7, f"PRJ01 - Nuovo Ospedale Nord\n{code}\nRevisione {rev}", align="C")
    for n, chapter in enumerate(chapters, start=1):
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 14)
        pdf.cell(0, 10, f"{n}. {chapter}", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10.5)
        for _ in range(rnd.randint(3, 6)):
            pdf.multi_cell(0, 5.5, LOREM * rnd.randint(1, 3))
            pdf.ln(2)
    return bytes(pdf.output())


def scanned_pdf(seed: int, title: str, lines: list[str]) -> bytes:
    """PDF "scansionato": ogni pagina è solo un'immagine (testo dattiloscritto leggermente ruotato, grana di
    scansione), senza testo estraibile. Serve a provare l'OCR della ricerca nel contenuto (ADR-33)."""
    from fpdf import FPDF
    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    rnd = random.Random(seed)
    w, h = 1240, 1754                                                   # A4 a 150 dpi
    img = Image.new("L", (w, h), 250)
    d = ImageDraw.Draw(img)
    big, body = ImageFont.load_default(size=44), ImageFont.load_default(size=30)
    d.text((110, 140), title, fill=20, font=big)
    y = 260
    for line in lines:
        d.text((110, y), line, fill=rnd.randint(15, 45), font=body)
        y += 58
    for _ in range(1500):                                               # polvere del vetro dello scanner
        x, yy = rnd.randrange(w), rnd.randrange(h)
        d.point((x, yy), fill=rnd.randint(150, 210))
    img = img.rotate(rnd.uniform(-0.8, 0.8), fillcolor=250, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    buf.seek(0)
    pdf = FPDF(unit="mm", format="A4")
    pdf.set_creation_date(_FIXED_DATE)
    pdf.add_page()
    pdf.image(buf, x=0, y=0, w=210, h=297)
    return bytes(pdf.output())


def photo_png(seed: int, caption: str, render: bool = False) -> bytes:
    from PIL import Image, ImageDraw

    rnd = random.Random(seed)
    w, h = 1280, 860
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    sky = (120, 170, 220) if render else (rnd.randint(150, 190), rnd.randint(175, 205), rnd.randint(205, 230))
    for y in range(h // 2):                                            # cielo sfumato
        t = y / (h / 2)
        d.line([(0, y), (w, y)], fill=tuple(int(c * (1 - 0.25 * t) + 255 * 0.25 * t) for c in sky))
    d.rectangle([0, h // 2, w, h], fill=(150, 140, 120) if not render else (110, 150, 95))
    for _ in range(rnd.randint(2, 4)):                                 # volumi dell'edificio
        x0 = rnd.randint(60, w - 420)
        top = rnd.randint(140, 330)
        bw = rnd.randint(220, 420)
        color = (225, 222, 214) if render else (rnd.randint(150, 190),) * 3
        d.rectangle([x0, top, x0 + bw, h // 2 + 60], fill=color, outline=(80, 80, 80), width=3)
        for fy in range(top + 25, h // 2 + 30, 45):                    # finestre / solai
            for fx in range(x0 + 20, x0 + bw - 30, 50):
                d.rectangle([fx, fy, fx + 26, fy + 22], fill=(70, 100, 140) if render else (90, 90, 95))
    if not render:                                                     # gru e ponteggi
        cx = rnd.randint(200, w - 200)
        d.line([(cx, h // 2 + 60), (cx, 70)], fill=(230, 180, 20), width=10)
        d.line([(cx - 120, 90), (cx + 330, 90)], fill=(230, 180, 20), width=8)
        d.line([(cx + 250, 90), (cx + 250, 260)], fill=(60, 60, 60), width=3)
    d.rectangle([0, h - 56, w, h], fill=(0, 0, 0))
    d.text((20, h - 40), caption, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def ifc_model(seed: int, storeys: int = 2) -> bytes:
    """Edificio semplice IFC4: per ogni piano quattro muri perimetrali, un muro interno e un solaio."""
    rnd = random.Random(seed)
    lines: list[str] = []
    n = [100]

    def add(text: str) -> int:
        n[0] += 1
        lines.append(f"#{n[0]}={text};")
        return n[0]

    def guid() -> str:
        chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"
        return "".join(rnd.choice(chars) for _ in range(22))

    head = [f"#1=IFCPROJECT('{guid()}',$,'Nuovo Ospedale Nord',$,$,$,$,(#11),#7);",
            "#2=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);", "#7=IFCUNITASSIGNMENT((#2));",
            "#8=IFCCARTESIANPOINT((0.,0.,0.));", "#9=IFCAXIS2PLACEMENT3D(#8,$,$);",
            "#11=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,$);",
            "#12=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#11,$,.MODEL_VIEW.,$);",
            "#13=IFCDIRECTION((0.,0.,1.));", "#14=IFCDIRECTION((1.,0.,0.));"]
    site_pl = add("IFCLOCALPLACEMENT($,#9)")
    site = add(f"IFCSITE('{guid()}',$,'Lotto ospedaliero',$,$,#{site_pl},$,$,.ELEMENT.,$,$,$,$,$)")
    bld_pl = add(f"IFCLOCALPLACEMENT(#{site_pl},#9)")
    bld = add(f"IFCBUILDING('{guid()}',$,'Padiglione A',$,$,#{bld_pl},$,$,.ELEMENT.,$,$,$)")
    add(f"IFCRELAGGREGATES('{guid()}',$,$,$,#1,(#{site}))")
    add(f"IFCRELAGGREGATES('{guid()}',$,$,$,#{site},(#{bld}))")
    length, depth, height = rnd.choice([18., 24., 30.]), rnd.choice([12., 14., 16.]), 3.4
    storey_ids = []

    def box(placement_parent: int, x: float, y: float, z: float, dx: float, dy: float, dz: float) -> tuple[int, int]:
        pt = add(f"IFCCARTESIANPOINT(({x:.2f},{y:.2f},{z:.2f}))")
        ax = add(f"IFCAXIS2PLACEMENT3D(#{pt},$,$)")
        pl = add(f"IFCLOCALPLACEMENT(#{placement_parent},#{ax})")
        c2 = add(f"IFCCARTESIANPOINT(({dx / 2:.3f},{dy / 2:.3f}))")
        ax2 = add(f"IFCAXIS2PLACEMENT2D(#{c2},$)")
        prof = add(f"IFCRECTANGLEPROFILEDEF(.AREA.,$,#{ax2},{dx:.3f},{dy:.3f})")
        solid = add(f"IFCEXTRUDEDAREASOLID(#{prof},#9,#13,{dz:.3f})")
        rep = add(f"IFCSHAPEREPRESENTATION(#12,'Body','SweptSolid',(#{solid}))")
        return pl, add(f"IFCPRODUCTDEFINITIONSHAPE($,$,(#{rep}))")

    for s in range(storeys):
        st_pl = add(f"IFCLOCALPLACEMENT(#{bld_pl},#9)")
        name = "Piano terra" if s == 0 else f"Piano {s}"
        st = add(f"IFCBUILDINGSTOREY('{guid()}',$,'{name}',$,$,#{st_pl},$,$,.ELEMENT.,{s * height:.2f})")
        storey_ids.append(st)
        z = s * height
        elems = []
        walls = [(0, 0, length, 0.3, "Muro perimetrale sud"), (0, depth - 0.3, length, 0.3, "Muro perimetrale nord"),
                 (0, 0.3, 0.3, depth - 0.6, "Muro perimetrale ovest"), (length - 0.3, 0.3, 0.3, depth - 0.6, "Muro perimetrale est"),
                 (length / 2, 0.3, 0.15, depth - 0.6, "Tramezzo interno")]
        for x, y, dx, dy, wname in walls:
            pl, shape = box(st_pl, x, y, z, dx, dy, height - 0.3)
            elems.append(add(f"IFCWALL('{guid()}',$,'{wname} P{s}',$,$,#{pl},#{shape},$,.STANDARD.)"))
        pl, shape = box(st_pl, 0, 0, z + height - 0.3, length, depth, 0.3)
        slab = add(f"IFCSLAB('{guid()}',$,'Solaio P{s}',$,$,#{pl},#{shape},$,.FLOOR.)")
        elems.append(slab)
        add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{guid()}',$,$,$,({','.join(f'#{e}' for e in elems)}),#{st})")
        p1 = add("IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$)")
        p2 = add(f"IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('{rnd.choice(['REI 60', 'REI 90', 'REI 120'])}'),$)")
        p3 = add(f"IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE({rnd.uniform(0.18, 0.3):.2f}),$)")
        ps = add(f"IFCPROPERTYSET('{guid()}',$,'Pset_WallCommon',$,(#{p1},#{p2},#{p3}))")
        add(f"IFCRELDEFINESBYPROPERTIES('{guid()}',$,$,$,({','.join(f'#{e}' for e in elems[:4])}),#{ps})")
    add(f"IFCRELAGGREGATES('{guid()}',$,$,$,#{bld},({','.join(f'#{s}' for s in storey_ids)}))")
    body = "\n".join(head + lines)
    return ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');\n"
            "FILE_NAME('modello.ifc','2026-10-01T09:00:00',('CDE demo'),(''),'','','');\nFILE_SCHEMA(('IFC4'));\n"
            f"ENDSEC;\nDATA;\n{body}\nENDSEC;\nEND-ISO-10303-21;\n").encode()


WALLS = ["Muro perimetrale sud", "Muro perimetrale nord", "Muro perimetrale ovest", "Muro perimetrale est",
         "Tramezzo interno"]
# viste generali: quali elementi del modello citano (nel viewer IFC compaiono come "Citato in")
BIM_VIEWS = {
    "Prospetto sud": [f"Muro perimetrale sud P{s}" for s in range(3)],
    "Prospetto nord": [f"Muro perimetrale nord P{s}" for s in range(3)],
    "Sezione A-A": ["Solaio P0", "Solaio P1", "Tramezzo interno P0", "Tramezzo interno P1"],
    "Sezione B-B": ["Muro perimetrale ovest P0", "Muro perimetrale est P0", "Solaio P0"],
    "Nodo parete-solaio": ["Muro perimetrale nord P0", "Solaio P0"],
}


def bim_legend(level: str) -> list[str] | None:
    """Elementi dell'IFC demo in una pianta: livello 00 → piano P0, 01 → P1, ..."""
    if not level.isdigit():
        return None
    s = int(level)
    return [f"{w} P{s}" for w in WALLS] + [f"Solaio P{s}"]


def schedule_csv(seed: int, codes: list[tuple[str, str]]) -> bytes:
    rnd = random.Random(seed)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Codice", "Titolo", "Scala", "Formato", "Emissione prevista"])
    for code, title in codes:
        w.writerow([code, title, rnd.choice(["1:50", "1:100", "1:20"]), rnd.choice(["A1", "A2", "A3"]),
                    f"2026-{rnd.randint(9, 12):02d}-{rnd.randint(1, 28):02d}"])
    return buf.getvalue().encode("utf-8")


def spec_txt(title: str, items: list[str]) -> bytes:
    lines = [title.upper(), "=" * len(title), ""]
    for i, item in enumerate(items, start=1):
        lines += [f"Art. {i} - {item}", "  " + LOREM.strip(), ""]
    return "\n".join(lines).encode("utf-8")


# ---------------------------------------------------------------------
# Caricamento via API
# ---------------------------------------------------------------------
@dataclass
class Loader:
    api: str
    password: str = DEMO_PASSWORD
    log: list[str] = field(default_factory=list)

    def __post_init__(self):
        import httpx

        self.http = httpx.Client(base_url=self.api, timeout=120)
        self.s3 = httpx.Client(timeout=120)
        self.h: dict[str, dict] = {}

    def as_(self, user: str) -> dict:
        if user not in self.h:
            r = self.http.post("/auth/login", json={"email": USERS[user], "password": self.password})
            r.raise_for_status()
            self.h[user] = {"Authorization": f"Bearer {r.json()['access_token']}"}
        return self.h[user]

    def call(self, user: str, method: str, path: str, ok=(200, 201), **kw):
        r = self.http.request(method, path, headers=self.as_(user), **kw)
        if r.status_code not in ok:
            self.log.append(f"{method} {path} come {user}: {r.status_code} {r.text[:160]}")
            return None
        return r.json() if r.content else {}

    def upload(self, user: str, container: str, filename: str, data: bytes, content_type: str, title: str,
               expected: str | None = None) -> dict | None:
        body = {"container_id": container, "filename": filename, "size_bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(), "content_type": content_type, "title": title,
                **({"expected_revision": expected} if expected else {})}
        up = self.call(user, "POST", "/uploads/initiate", json=body)
        if not up:
            return None
        size = up["part_size"]
        chunks = {i + 1: data[i * size:(i + 1) * size] for i in range(up["part_count"])}
        parts = self.call(user, "POST", f"/uploads/{up['upload_id']}/parts", json={"parts": [
            {"part_number": k, "checksum_sha256": base64.b64encode(hashlib.sha256(v).digest()).decode()}
            for k, v in chunks.items()]})
        for p in parts["parts"]:
            self.s3.put(p["url"], content=chunks[p["part_number"]], headers=p["headers"]).raise_for_status()
        return self.call(user, "POST", f"/uploads/{up['upload_id']}/complete")

    def wait_clean(self, user: str, revision_id: str, timeout: float = 60) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            r = self.http.get(f"/revisions/{revision_id}/download", headers=self.as_(user))
            if r.status_code == 200:
                return True
            time.sleep(0.5)
        self.log.append(f"revisione {revision_id}: verifica antivirus non conclusa")
        return False

    def transition(self, users: list[str], revision_id: str, to: str, suitability: str, reason: str | None = None):
        for user in users:                                  # chi carica, altrimenti l'admin dell'organizzazione
            r = self.http.post(f"/revisions/{revision_id}/transitions", headers=self.as_(user),
                               json={"to_state": to, "suitability": suitability, "reason": reason})
            if r.status_code in (200, 201):
                return r.json()
        self.log.append(f"transizione {to} di {revision_id}: {r.status_code} {r.text[:160]}")
        return None


def populate(api: str, password: str = DEMO_PASSWORD) -> dict:
    ld = Loader(api, password)
    projects = ld.call("com_admin", "GET", "/projects")
    projects = projects.get("items", projects) if isinstance(projects, dict) else projects
    project = next(p for p in projects if p["code"] == "PRJ01")
    pid = project["id"]

    def folders() -> dict[str, dict]:
        return {c["name"]: c for c in ld.call("com_admin", "GET", f"/projects/{pid}/containers") or []}

    existing = folders()
    for _org, user, parent, name in FOLDERS:
        if name not in existing and parent in existing:
            ld.call(user, "POST", f"/projects/{pid}/containers", json={"name": name, "parent_id": existing[parent]["id"]})
    if "Contratti e offerte" not in existing:
        ld.call("com_admin", "POST", f"/projects/{pid}/containers", json={"name": "Contratti e offerte", "is_private": True})
    f = folders()
    orgs = {o["code"]: o["organization_id"] for o in ld.call("com_admin", "GET", f"/projects/{pid}/organizations")}

    counter = [100]
    docs: dict[str, dict] = {}

    def name(org: str, level: str, typ: str, role: str, ext: str) -> str:
        counter[0] += 1
        return f"PRJ01-{org}-ZZ-{level}-{typ}-{role}-{counter[0]:04d}.{ext}"

    def add(key: str, user: str, folder: str, org: str, level: str, typ: str, role: str, ext: str, ctype: str,
            title: str, make, fate: str, admin: str):
        """fate: WIP | SHARED | PUBLISHED | REV2 (pubblicato, poi nuova revisione condivisa)."""
        if folder not in f:
            ld.log.append(f"cartella mancante: {folder}")
            return
        filename = name(org, level, typ, role, ext)
        code = filename.rsplit(".", 1)[0]
        check = ld.call(user, "POST", f"/projects/{pid}/naming/validate", json={"name": filename})
        if check and check.get("existing_document_id"):          # già caricato da un giro precedente
            ld.log.append(f"{code} già presente: salto")
            return
        rev = ld.upload(user, f[folder]["id"], filename, make(code, "P01.01", 0), ctype, title)
        if not rev or not ld.wait_clean(user, rev["id"]):
            return
        who = [user, admin]
        if fate in ("SHARED", "PUBLISHED", "REV2"):
            rev = ld.transition(who, rev["id"], "SHARED", random.choice(["S2", "S3", "S4"])) or rev
        if fate in ("PUBLISHED", "REV2"):
            rev = ld.transition(who, rev["id"], "PUBLISHED", "A1", "Approvato in riunione di coordinamento") or rev
        if fate == "REV2":
            nxt = ld.upload(user, f[folder]["id"], filename, make(code, "P02.01", 1), ctype, title,
                            expected=rev.get("revision_code"))
            if nxt and ld.wait_clean(user, nxt["id"]):
                rev = ld.transition(who, nxt["id"], "SHARED", "S3") or nxt
        docs[key] = rev

    pdf, png, ifc = "application/pdf", "image/png", "application/octet-stream"
    plans = [("Pianta piano terra", "00"), ("Pianta piano primo", "01"), ("Pianta piano secondo", "02"),
             ("Pianta copertura", "RF"), ("Pianta piano interrato", "B1")]
    for i, (title, level) in enumerate(plans):
        add(f"pianta{i}", "des_lead", "Piante", "DES", level, "DR", "A", "pdf", pdf, title,
            lambda c, r, v, i=i, t=title, lv=level: drawing_pdf(10 + i, t, c, r, v, pages=2 if i == 0 else 1,
                                                                 legend=bim_legend(lv)),
            ["REV2", "PUBLISHED", "SHARED", "SHARED", "WIP"][i], "des_admin")
    for i, title in enumerate(["Prospetto sud", "Prospetto nord", "Sezione A-A", "Sezione B-B"]):
        add(f"prosp{i}", "des_designer", "Prospetti e sezioni", "DES", "ZZ", "DR", "A", "pdf", pdf, title,
            lambda c, r, v, i=i, t=title: drawing_pdf(30 + i, t, c, r, v, legend=BIM_VIEWS[t]),
            ["PUBLISHED", "SHARED", "SHARED", "WIP"][i], "des_lead")
    for i, title in enumerate(["Nodo parete-solaio", "Dettaglio serramento", "Dettaglio copertura"]):
        add(f"det{i}", "des_lead", "Dettagli costruttivi", "DES", "ZZ", "DR", "A", "pdf", pdf, title,
            lambda c, r, v, i=i, t=title: drawing_pdf(40 + i, t, c, r, v, legend=BIM_VIEWS.get(t)),
            ["SHARED", "WIP", "PUBLISHED"][i], "des_admin")
    add("ifc_arch", "des_lead", "Modelli BIM", "DES", "ZZ", "M3", "A", "ifc", ifc, "Modello architettonico",
        lambda c, r, v: ifc_model(50 + v, storeys=3 if v else 2), "REV2", "des_admin")
    add("ifc_str", "des_designer", "Modelli BIM", "DES", "ZZ", "M3", "S", "ifc", ifc, "Modello strutturale",
        lambda c, r, v: ifc_model(60, storeys=2), "SHARED", "des_lead")
    add("relaz", "des_lead", "Relazioni e capitolati", "DES", "ZZ", "RP", "A", "pdf", pdf, "Relazione tecnica generale",
        lambda c, r, v: report_pdf(70, "Relazione tecnica generale", c, r,
                                   ["Premessa", "Inquadramento", "Scelte progettuali", "Sicurezza antincendio", "Impianti"]),
        "PUBLISHED", "des_admin")
    add("capit", "des_designer", "Relazioni e capitolati", "DES", "ZZ", "SP", "A", "txt", "text/plain",
        "Capitolato speciale finiture", lambda c, r, v: spec_txt("Capitolato speciale finiture",
                                                                 ["Pavimenti", "Rivestimenti", "Controsoffitti", "Serramenti", "Tinteggiature"]),
        "SHARED", "des_lead")
    add("elenco", "des_lead", "Relazioni e capitolati", "DES", "ZZ", "SH", "A", "csv", "text/plain", "Elenco elaborati",
        lambda c, r, v: schedule_csv(80, [(f"PRJ01-DES-ZZ-0{k}-DR-A-{100 + k:04d}", t) for k, (t, _) in enumerate(plans)]),
        "SHARED", "des_admin")
    add("render", "des_lead", "Modelli BIM", "DES", "ZZ", "VS", "A", "png", png, "Render vista da sud-est",
        lambda c, r, v: photo_png(90, "Render vista da sud-est - PRJ01", render=True), "PUBLISHED", "des_admin")
    for i, title in enumerate(["Schema unifilare quadro generale", "Schema quadro piano terra", "Schema quadro piano primo"]):
        add(f"unif{i}", "sub1_user", "Schemi unifilari", "SUB1", ["ZZ", "00", "01"][i], "DR", "E", "pdf", pdf, title,
            lambda c, r, v, i=i, t=title: drawing_pdf(100 + i, t, c, r, v), ["SHARED", "WIP", "WIP"][i], "sub1_admin")
    add("rel_el", "sub1_user", "Relazioni impianti", "SUB1", "ZZ", "CA", "E", "pdf", pdf, "Calcolo impianto elettrico",
        lambda c, r, v: report_pdf(110, "Calcolo impianto elettrico", c, r, ["Dati di progetto", "Dimensionamento", "Verifiche"]),
        "SHARED", "sub1_admin")
    add("carp", "sub2_user", "SUB2 - Strutture metalliche", "SUB2", "RF", "DR", "S", "pdf", pdf, "Carpenteria copertura",
        lambda c, r, v: drawing_pdf(120, "Carpenteria copertura", c, r, v), "WIP", "sub2_user")   # SUB2 senza approvatore
    for i in range(4):
        add(f"foto{i}", "com_im", "Foto di cantiere", "COM", "ZZ", "SU", "Z", "png", png, f"Avanzamento lavori - settimana {38 + i}",
            lambda c, r, v, i=i: photo_png(200 + i, f"PRJ01 - Avanzamento lavori settimana {38 + i}"), "PUBLISHED", "com_admin")
    for i, title in enumerate(["Verbale di consegna lavori", "Verbale riunione di coordinamento n.1"]):
        add(f"verb{i}", "com_admin", "Verbali", "COM", "ZZ", "MI", "Z", "pdf", pdf, title,
            lambda c, r, v, t=title: report_pdf(300 + len(t), t, c, r, ["Presenti", "Argomenti trattati", "Decisioni"]),
            "PUBLISHED", "com_admin")
    add("contr", "com_admin", "Contratti e offerte", "COM", "ZZ", "CO", "Z", "pdf", pdf, "Contratto d'appalto",
        lambda c, r, v: report_pdf(400, "Contratto d'appalto", c, r, ["Oggetto", "Importi", "Penali", "Garanzie"]),
        "WIP", "com_admin")
    # aggiunte successive in fondo: la numerazione dei documenti già caricati non cambia (niente doppioni)
    add("ifc_full", "des_lead", "Modelli BIM", "DES", "ZZ", "M3", "A", "ifc", ifc, "Modello completo Padiglione B",
        lambda c, r, v: ifc_complex.build(), "SHARED", "des_admin")
    add("glb_vis", "des_designer", "Modelli BIM", "DES", "ZZ", "M3", "A", "glb", "model/gltf-binary",
        "Modello di studio Padiglione C (Blender)", lambda c, r, v: glb_model.build(), "SHARED", "des_lead")
    add("ifc_campus", "des_lead", "Modelli BIM", "DES", "ZZ", "M3", "A", "ifc", ifc, "Modello campus 4 padiglioni",
        lambda c, r, v: ifc_complex.build(padiglioni=4), "SHARED", "des_admin")      # pesante: derivato .glb (ADR-31)
    add("scan_sopr", "com_admin", "Verbali", "COM", "ZZ", "MI", "Z", "pdf", pdf, "Verbale di sopralluogo (scansione)",
        lambda c, r, v: scanned_pdf(500, "Verbale di sopralluogo n. 3", [
            f"Documento {c} - copia firmata e scansionata", "Presenti: Direzione Lavori, Impresa, Progettista",
            "Si rileva una fessura sul Muro perimetrale sud P0 in prossimita del pilastro P0-03.",
            "Il Solaio P1 risulta completato; getto di completamento previsto venerdi.",
            "Prescrizione: ripristino della fessura entro quindici giorni.",
            "Prossimo sopralluogo: martedi alle ore 9:30."]), "PUBLISHED", "com_admin")   # OCR (ADR-33)

    # annotazioni sulle tavole e sul modello
    if "pianta0" in docs:
        rid = docs["pianta0"]["id"]
        ld.call("com_im", "POST", f"/revisions/{rid}/markups", json={"body": "Verificare larghezza corridoio (min. 2,40 m)", "page": 1, "x": 0.3, "y": 0.35, "w": 0.2, "h": 0.12})
        ld.call("com_admin", "POST", f"/revisions/{rid}/markups", json={"body": "Indicare uscite di sicurezza", "page": 1, "x": 0.62, "y": 0.2, "color": "#1e88e5"})
        ld.call("des_lead", "POST", f"/revisions/{rid}/markups", json={"body": "Quote aggiornate rispetto a P01", "page": 2, "x": 0.1, "y": 0.75, "w": 0.4, "h": 0.06, "color": "#43a047"})
    if "prosp1" in docs:
        ld.call("com_admin", "POST", f"/revisions/{docs['prosp1']['id']}/markups", json={"body": "Colore facciata da confermare con la committenza", "page": 1, "x": 0.15, "y": 0.2, "w": 0.5, "h": 0.4, "color": "#fb8c00"})

    # approvazioni
    tpl = ld.call("com_admin", "POST", f"/projects/{pid}/workflow-templates", json={
        "code": "DEMO_REVISIONE", "name": "Revisione progetto", "definition": {
            "steps": [{"name": "Verifica interna", "assignees": [{"type": "originator_role", "code": "LEAD_DESIGNER"}], "sla_hours": 48},
                      {"name": "Parere Direzione Lavori", "assignees": [{"type": "role", "code": "DIRETTORE_LAVORI"}], "sla_hours": 72},
                      {"name": "Approvazione committente", "assignees": [{"type": "role", "code": "PROJECT_ADMIN"}], "quorum": "ANY"}],
            "on_approved": {"to_state": "PUBLISHED", "suitability": "A1"}}})
    if tpl:
        for key in ("pianta2", "prosp1", "det0", "ifc_str"):
            if key in docs and docs[key].get("state") == "SHARED":
                inst = ld.call("des_lead", "POST", f"/revisions/{docs[key]['id']}/workflows", json={"template_id": tpl["id"]})
                if inst and key == "prosp1":         # uno già avanti di uno step
                    task = next((t for t in ld.call("des_lead", "GET", "/me/tasks?status=OPEN") or []
                                 if t["instance_id"] == inst["id"]), None)
                    if task:
                        ld.call("des_lead", "POST", f"/tasks/{task['id']}/complete", json={"outcome": "APPROVED"})

    # RFI
    rfis = [("des_lead", "Altezza utile piano terra", "Confermate un'altezza utile di 3,20 m al piano terra?", ["COM"], -3, True),
            ("sub1_user", "Posizione quadro elettrico piano primo", "Il locale tecnico previsto è sufficiente per il quadro?", ["DES"], 5, True),
            ("des_designer", "Finitura pavimenti ambulatori", "Gres o vinilico negli ambulatori?", ["COM"], 10, False),
            ("sub2_user", "Carichi in copertura", "Confermate il carico neve di progetto per la copertura?", ["DES"], -1, False)]
    for user, subject, question, to, due_days, answer in rfis:
        rfi = ld.call(user, "POST", f"/projects/{pid}/rfis", json={
            "subject": subject, "question": question, "recipient_organization_ids": [orgs[o] for o in to],
            "due_at": time.strftime("%Y-%m-%dT16:00:00Z", time.gmtime(time.time() + due_days * 86400))})
        if rfi and answer:
            responder = "com_admin" if to == ["COM"] else "des_lead"
            ld.call(responder, "POST", f"/rfis/{rfi['id']}/messages", json={"body": "Confermiamo, vedere tavola aggiornata.", "is_answer": True})

    # transmittal
    shared = [d for d in docs.values() if d.get("state") in ("SHARED", "PUBLISHED")]
    des = [d["id"] for k, d in docs.items() if d in shared and k.startswith(("pianta", "prosp", "det", "ifc", "relaz"))]
    if des:
        ld.call("des_lead", "POST", f"/projects/{pid}/transmittals", json={
            "subject": "Emissione progetto architettonico - fase esecutiva", "purpose": "APPROVAL",
            "message": "Si trasmettono gli elaborati per approvazione.", "recipient_organization_ids": [orgs["COM"]],
            "revision_ids": des[:8]})
        ld.call("des_lead", "POST", f"/projects/{pid}/transmittals", json={
            "subject": "Tavole per coordinamento impianti", "purpose": "COMMENT",
            "recipient_organization_ids": [orgs["SUB1"], orgs["GCO"]], "revision_ids": des[:3]})
    el = [d["id"] for k, d in docs.items() if k in ("unif0", "rel_el") and d in shared]
    if el:
        ld.call("sub1_user", "POST", f"/projects/{pid}/transmittals", json={
            "subject": "Progetto impianto elettrico", "purpose": "INFORMATION", "recipient_organization_ids": [orgs["DES"]],
            "revision_ids": el})
    return {"project_id": pid, "documents": len(docs), "errors": ld.log}
