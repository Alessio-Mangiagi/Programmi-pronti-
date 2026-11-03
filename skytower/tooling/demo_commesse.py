# "><(((º> sabusabu <º)))><"
"""Demo parlante di SkyTower: due commesse complete, create attraverso l'API viva come farebbero gli utenti.

    101-003    Sede Acireale      ristrutturazione uffici, Via Nazionale 120, Acireale (CT), cliente Cosedil S.p.A.
    C-2024-015 Scuola Via Roma    nuova scuola primaria, Via Roma 45, Catania, committente Comune di Catania

Stessi codici commessa del registro della suite, di InCampo e del Magazzino: InCampo prende le tavole
pubblicate come planimetrie, il Magazzino manda i report di giacenza, i documenti del Lettore DDT e di VFP
Transfer finiscono qui. Per ogni commessa: progetto copiato dal template PRJ01 (organizzazioni, persone,
cartelle, workflow), codice commessa nelle impostazioni, cartelle in piu', filigrana, tavole architettoniche
/ strutturali / impianti con cartiglio, relazioni, computo metrico, cronoprogramma, piano di sicurezza,
capitolato, elenco elaborati, modello IFC, foto di cantiere, verbali della DL (anche scansionati), contratto
in area riservata; revisioni multiple, passaggi WIP -> SHARED -> PUBLISHED con motivazione, una revisione
archiviata, documenti seguiti (= notifiche), annotazioni con risposte e chiusura, workflow di approvazione
(uno appena avviato, uno a meta', uno approvato fino alla pubblicazione, uno respinto), RFI con risposte e
chiusura, transmittal con presa visione, richiesta di accesso all'area riservata, prenotazione di numeri.

Idempotente: si puo' rilanciare, trova quello che c'e' (progetto per codice commessa, documenti per nome)
e aggiunge solo quello che manca. Tutto e' marcato: settings.demo = true sul progetto, "[DEMO]" negli
attributi dei documenti.

    .venv\\Scripts\\python tooling\\demo_commesse.py                       # API http://127.0.0.1:8100
    .venv\\Scripts\\python tooling\\demo_commesse.py --rimuovi             # archivia i progetti demo
    .venv\\Scripts\\python tooling\\demo_commesse.py --solo 101-003

Utenti: quelli del seed demo (password Cantiere-2026!, es. com.admin@com.example). L'account personale
(email non ".example") viene aggiunto come PROJECT_ADMIN ai progetti demo, mai modificato.
Solo sviluppo/collaudo.
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
API_DIR = HERE.parent / "apps" / "api"
sys.path.insert(0, str(API_DIR))

from cde_api.tooling import demo_content as dc  # generatori e Loader riusati
from cde_api.tooling import dxf_sample  # pianta DXF per il viewer DWG (ADR-41)

TEMPLATE = "PRJ01"
PDF, PNG, BIN, TXT = "application/pdf", "image/png", "application/octet-stream", "text/plain"
DXF = "image/vnd.dxf"          # disegno CAD: il viewer apre l'SVG preparato dal worker (ADR-41)
RUOLO_PERSONALE = "PROJECT_ADMIN"

COMMESSE = [
    {
        "commessa": "101-003", "codice": "ACI003", "nome": "Sede Acireale",
        "descrizione": "Ristrutturazione e adeguamento degli uffici della sede di Acireale: rifacimento impianti, "
                       "nuove partizioni interne, efficientamento energetico dell'involucro, adeguamento antincendio.",
        "indirizzo": "Via Nazionale 120, 95024 Acireale (CT)", "cliente": "Cosedil S.p.A.",
        "inizio": "2026-09-01", "fine": "2027-05-31", "importo": 1_280_000,
        "piani": [("Pianta piano terra", "00"), ("Pianta piano primo", "01"), ("Pianta copertura", "RF")],
        "locali": ["Reception", "Ufficio tecnico", "Ufficio gare", "Sala riunioni", "Direzione", "Archivio",
                   "Locale server", "Servizi", "Sala ristoro", "Magazzino", "Corridoio", "Locale tecnico"],
        "fasi": [("Allestimento cantiere", 0, 1), ("Demolizioni", 1, 2), ("Impianti", 2, 4), ("Partizioni", 3, 5),
                 ("Involucro e serramenti", 4, 6), ("Finiture", 6, 8), ("Collaudi", 8, 9)],
        "voci": [("01.A01.010", "Demolizione tramezzi in laterizio", "mc", 42.5, 48.0),
                 ("01.A02.020", "Rimozione pavimento e sottofondo", "mq", 610.0, 14.2),
                 ("02.B04.010", "Tramezzi in cartongesso sp. 12,5 cm", "mq", 480.0, 46.5),
                 ("03.C01.030", "Pavimento in gres porcellanato", "mq", 640.0, 58.0),
                 ("04.E11.010", "Impianto elettrico, punto luce", "cad", 186, 61.0),
                 ("04.E12.020", "Impianto dati cat. 6A, punto presa", "cad", 120, 74.5),
                 ("05.M01.010", "Unita' VRF 28 kW", "cad", 2, 9_850.0),
                 ("06.F02.010", "Serramenti in alluminio a taglio termico", "mq", 96.0, 520.0),
                 ("07.A01.010", "Tinteggiatura lavabile", "mq", 2_150.0, 7.8)],
        "settimane": [40, 41, 42, 43],
    },
    {
        "commessa": "C-2024-015", "codice": "SCU015", "nome": "Scuola Via Roma",
        "descrizione": "Nuova scuola primaria a due piani con palestra e mensa: struttura in c.a., involucro "
                       "nZEB, impianti a pompa di calore, area esterna attrezzata.",
        "indirizzo": "Via Roma 45, 95131 Catania", "cliente": "Comune di Catania",
        "inizio": "2026-03-15", "fine": "2027-12-20", "importo": 4_650_000,
        "piani": [("Pianta piano interrato", "B1"), ("Pianta piano terra", "00"), ("Pianta piano primo", "01"),
                  ("Pianta copertura", "RF")],
        "locali": ["Aula 1", "Aula 2", "Aula 3", "Aula 4", "Laboratorio", "Biblioteca", "Mensa", "Cucina",
                   "Palestra", "Spogliatoi", "Segreteria", "Servizi"],
        "fasi": [("Scavi e fondazioni", 0, 2), ("Struttura in elevazione", 2, 6), ("Copertura", 6, 7),
                 ("Involucro", 7, 10), ("Impianti", 8, 13), ("Finiture", 12, 16), ("Esterni", 15, 18),
                 ("Collaudi", 18, 20)],
        "voci": [("01.A05.010", "Scavo di sbancamento", "mc", 3_200.0, 6.4),
                 ("02.B01.010", "Calcestruzzo C28/35 per fondazioni", "mc", 410.0, 142.0),
                 ("02.B02.010", "Acciaio B450C", "kg", 61_500.0, 1.65),
                 ("02.B03.040", "Solaio in laterocemento h 24+5", "mq", 2_380.0, 78.0),
                 ("03.C02.010", "Copertura in legno lamellare", "mq", 1_240.0, 185.0),
                 ("04.E11.010", "Impianto elettrico, punto luce", "cad", 420, 61.0),
                 ("05.M02.010", "Pompa di calore 120 kW", "cad", 2, 38_500.0),
                 ("06.F02.010", "Serramenti in alluminio a taglio termico", "mq", 310.0, 520.0),
                 ("08.G01.010", "Pavimentazione esterna drenante", "mq", 900.0, 42.0)],
        "settimane": [12, 13, 14, 15],
    },
]


# ---------------------------------------------------------------------------------------------- generatori
def _cartiglio(pdf, x, y, w, progetto, titolo, codice, rev, scala, autore):
    pdf.set_line_width(0.4)
    pdf.rect(x, y, w, 32)
    pdf.line(x, y + 12, x + w, y + 12)
    pdf.line(x + w * 0.62, y + 12, x + w * 0.62, y + 32)
    pdf.set_font("Helvetica", "B", 9)
    pdf.text(x + 3, y + 5, progetto[:60])
    pdf.set_font("Helvetica", "B", 12)
    pdf.text(x + 3, y + 10.5, titolo[:48])
    pdf.set_font("Helvetica", "", 8)
    pdf.text(x + 3, y + 18, f"Codice: {codice}")
    pdf.text(x + 3, y + 23, f"Scala: {scala}")
    pdf.text(x + 3, y + 28, autore)
    pdf.set_font("Helvetica", "B", 16)
    pdf.text(x + w * 0.62 + 4, y + 24, f"Rev. {rev}")


def tavola_pdf(seed: int, progetto: str, titolo: str, codice: str, rev: str, locali: list[str], tipo: str = "arch",
               variant: int = 0, pages: int = 1, autore: str = "Studio Progettazione Srl") -> bytes:
    """Tavola A3 con cartiglio. tipo: arch (locali), strutt (pilastri e travi), imp (quadri e linee)."""
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
                cx, cy = ox + i * cw, oy + j * ch
                if tipo == "strutt":                                   # pilastri agli angoli, trave in mezzeria
                    for px, py in ((cx + 4, cy + 4), (cx + cw - 10, cy + 4), (cx + 4, cy + ch - 10), (cx + cw - 10, cy + ch - 10)):
                        pdf.rect(px, py, 6, 6, style="F")
                    pdf.set_line_width(0.3)
                    pdf.set_dash_pattern(dash=3, gap=2)
                    pdf.line(cx, cy + ch / 2, cx + cw, cy + ch / 2)
                    pdf.set_dash_pattern()
                    pdf.set_line_width(0.7)
                    pdf.text(cx + 4, cy + ch / 2 - 2, f"T{i + 1}.{j + 1} 30x50")
                    pdf.text(cx + 12, cy + 9, f"P{i * rows + j + 1} 40x40")
                elif tipo == "imp":                                    # quadro e linee verso le prese
                    pdf.rect(cx + 6, cy + 6, 10, 7)
                    pdf.text(cx + 6, cy + 18, f"Q{i + 1}{j + 1}")
                    for k in range(3):
                        ex, ey = cx + cw * (0.3 + 0.25 * k), cy + ch * 0.75
                        pdf.line(cx + 11, cy + 13, ex, ey)
                        pdf.ellipse(ex - 1.5, ey - 1.5, 3, 3)
                    pdf.text(cx + 4, cy + ch - 4, locali[(i * rows + j + seed) % len(locali)])
                else:
                    room = locali[(i * rows + j + seed + page) % len(locali)]
                    area = round(cw * ch / 100 * rnd.uniform(0.85, 1.0), 1)
                    pdf.text(cx + 4, cy + ch / 2, room)
                    pdf.text(cx + 4, cy + ch / 2 + 5, f"{area} mq")
                    pdf.line(cx + cw / 2 - 5, cy, cx + cw / 2 + 5, cy)                  # porta
        pdf.set_line_width(0.3)                                                           # quota generale
        pdf.line(ox, oy + 210, ox + 300, oy + 210)
        pdf.text(ox + 140, oy + 216, f"{300 / 10 * rnd.uniform(0.9, 1.1):.2f} m")
        if variant:                                                                       # nuvola di revisione
            pdf.set_line_width(1.0)
            pdf.ellipse(ox + cw * 0.3, oy + ch * 0.3, 22, 18)
            pdf.text(ox + cw * 0.3 + 2, oy + ch * 0.3 + 25, f"Modifica rev. {rev}")
            if variant > 1:
                pdf.rect(ox + 300 + 8, oy + 20, 40, 60)
                pdf.text(ox + 312, oy + 55, "Nuovo vano")
        pdf.set_font("Helvetica", "B", 9)
        pdf.text(360, 24, "N")
        pdf.line(362, 26, 362, 40)
        _cartiglio(pdf, 250, 250, 155, progetto, f"{titolo} ({page + 1}/{pages})" if pages > 1 else titolo, codice,
                   rev, rnd.choice(["1:50", "1:100", "1:20"]), autore)
    return bytes(pdf.output())


def relazione_pdf(seed: int, progetto: str, titolo: str, codice: str, rev: str, capitoli: list[str],
                  intro: str = "", righe_fisse: dict[str, list[str]] | None = None) -> bytes:
    from fpdf import FPDF

    rnd = random.Random(seed)
    pdf = FPDF(format="A4")
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20)
    pdf.ln(60)
    pdf.multi_cell(0, 10, titolo, align="C")
    pdf.set_font("Helvetica", "", 12)
    pdf.ln(10)
    pdf.multi_cell(0, 7, f"{progetto}\n{codice}\nRevisione {rev}", align="C")
    if intro:
        pdf.ln(12)
        pdf.set_font("Helvetica", "I", 10.5)
        pdf.multi_cell(0, 6, intro, new_x="LMARGIN", new_y="NEXT")
    for n, capitolo in enumerate(capitoli, start=1):
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 14)
        pdf.cell(0, 10, f"{n}. {capitolo}", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10.5)
        for riga in (righe_fisse or {}).get(capitolo, []):
            pdf.multi_cell(0, 5.5, f"- {riga}", new_x="LMARGIN", new_y="NEXT")
        for _ in range(rnd.randint(2, 4)):
            pdf.multi_cell(0, 5.5, dc.LOREM * rnd.randint(1, 3), new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)
    return bytes(pdf.output())


def computo_pdf(progetto: str, codice: str, rev: str, voci: list[tuple], ribasso: float = 0.0) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4")
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(0, 9, "Computo metrico estimativo", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9.5)
    pdf.cell(0, 6, f"{progetto} - {codice} - Rev. {rev}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    larg = [8, 24, 78, 12, 20, 24, 26]
    pdf.set_font("Helvetica", "B", 8.5)
    for w, h in zip(larg, ["N.", "Codice", "Descrizione", "U.M.", "Quantita'", "Prezzo", "Importo"]):
        pdf.cell(w, 7, h, border=1, align="C")
    pdf.ln()
    pdf.set_font("Helvetica", "", 8.5)
    totale = 0.0
    for n, (cod, descr, um, q, prezzo) in enumerate(voci, start=1):
        imp = q * prezzo
        totale += imp
        for w, v, a in zip(larg, [str(n), cod, descr, um, f"{q:,.2f}", f"{prezzo:,.2f}", f"{imp:,.2f}"],
                           ["C", "L", "L", "C", "R", "R", "R"]):
            pdf.cell(w, 6.5, v, border=1, align=a)
        pdf.ln()
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(sum(larg[:-1]), 7, "Totale lavori a misura", border=1, align="R")
    pdf.cell(larg[-1], 7, f"{totale:,.2f}", border=1, align="R")
    pdf.ln()
    sic = totale * 0.035
    pdf.cell(sum(larg[:-1]), 7, "Oneri della sicurezza (3,5%, non soggetti a ribasso)", border=1, align="R")
    pdf.cell(larg[-1], 7, f"{sic:,.2f}", border=1, align="R")
    pdf.ln()
    pdf.cell(sum(larg[:-1]), 7, "Importo complessivo (euro)", border=1, align="R")
    pdf.cell(larg[-1], 7, f"{totale + sic:,.2f}", border=1, align="R")
    pdf.ln(10)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(0, 5, "Prezzi dal Prezzario regionale Sicilia 2026 salvo analisi. Quantita' da computo sulle tavole "
                         "di progetto esecutivo; le lavorazioni sono contabilizzate a misura.")
    return bytes(pdf.output())


def cronoprogramma_pdf(progetto: str, codice: str, rev: str, fasi: list[tuple], mesi: int, inizio: str) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(orientation="L", format="A4")
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(0, 9, "Cronoprogramma dei lavori", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9.5)
    pdf.cell(0, 6, f"{progetto} - {codice} - Rev. {rev} - inizio lavori {inizio}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    x0, lw, mw, rh = 12, 70, max(8.0, 190 / max(mesi, 1)), 9
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(lw, rh, "Fase", border=1)
    for m in range(mesi):
        pdf.cell(mw, rh, f"M{m + 1}", border=1, align="C")
    pdf.ln()
    pdf.set_font("Helvetica", "", 8.5)
    for nome, da, a in fasi:
        y = pdf.get_y()
        pdf.cell(lw, rh, nome, border=1)
        for m in range(mesi):
            pdf.cell(mw, rh, "", border=1)
        pdf.set_fill_color(12, 69, 119)
        pdf.rect(x0 + lw + da * mw + 0.8, y + 2, max(a - da, 0.5) * mw - 1.6, rh - 4, style="F")
        pdf.ln()
    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 8)
    pdf.multi_cell(0, 5, "Barre = durata prevista. Le fasi si sovrappongono dove le lavorazioni sono compatibili; "
                         "i collaudi chiudono il programma.")
    return bytes(pdf.output())


# ---------------------------------------------------------------------------------------------- caricamento
class Carico(dc.Loader):
    """Loader con pazienza: l'API puo' riavviarsi durante la demo (503/connessione) e i token scadono (401)."""

    def call(self, user, method, path, ok=(200, 201), **kw):
        import httpx

        for tentativo in range(12):
            try:
                r = self.http.request(method, path, headers=self.as_(user), **kw)
            except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError):
                time.sleep(3)
                continue
            if r.status_code == 401 and tentativo == 0:
                self.h.pop(user, None)
                continue
            if r.status_code in (502, 503) and tentativo < 6:
                time.sleep(3)
                continue
            if r.status_code not in ok:
                self.log.append(f"{method} {path} come {user}: {r.status_code} {r.text[:160]}")
                return None
            return r.json() if r.content else {}
        self.log.append(f"{method} {path} come {user}: API non raggiungibile")
        return None

    def as_(self, user):
        import httpx

        for _ in range(12):
            try:
                return super().as_(user)
            except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError):
                time.sleep(3)
        raise SystemExit("API non raggiungibile: SkyTower e' acceso?")

    def upload(self, user, container, filename, data, content_type, title, expected=None, attributes=None,
               description=None):
        import base64
        import hashlib

        body = {"container_id": container, "filename": filename, "size_bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(), "content_type": content_type, "title": title,
                "attributes": {"demo": True, "origine": "[DEMO] demo_commesse", **(attributes or {})},
                **({"expected_revision": expected} if expected else {}),
                **({"description": description} if description else {})}
        up = self.call(user, "POST", "/uploads/initiate", json=body)
        if not up:
            return None
        size = up["part_size"]
        chunks = {i + 1: data[i * size:(i + 1) * size] for i in range(up["part_count"])}
        parts = self.call(user, "POST", f"/uploads/{up['upload_id']}/parts", json={"parts": [
            {"part_number": k, "checksum_sha256": base64.b64encode(hashlib.sha256(v).digest()).decode()}
            for k, v in chunks.items()]})
        if not parts:
            return None
        for p in parts["parts"]:
            self.s3.put(p["url"], content=chunks[p["part_number"]], headers=p["headers"]).raise_for_status()
        return self.call(user, "POST", f"/uploads/{up['upload_id']}/complete")


def _lista(x):
    return x.get("items", x) if isinstance(x, dict) else (x or [])


class Demo:
    def __init__(self, ld: Carico, spec: dict):
        self.ld, self.s = ld, spec
        self.progetto_nome = f"{spec['commessa']} - {spec['nome']}"
        self.pid = None
        self.f: dict[str, dict] = {}
        self.orgs: dict[str, str] = {}
        self.roles: dict[str, str] = {}
        self.docs: dict[str, dict] = {}        # chiave -> ultima revisione (con document_id)
        self.n = 0
        self.numeri = {"documenti": 0, "revisioni": 0, "annotazioni": 0, "workflow": 0, "rfi": 0, "transmittal": 0,
                       "accessi": 0, "seguiti": 0}

    # ---- progetto -------------------------------------------------------------------------------------
    def progetto(self):
        ld, s = self.ld, self.s
        progetti = _lista(ld.call("com_admin", "GET", "/projects"))
        # Prima il codice progetto (ACI003/SCU015), che e' unico; il codice commessa nei settings viene copiato
        # anche nei progetti creati "a partire da" quello demo (U43), quindi da solo non basta a riconoscerlo.
        attivi = [p for p in progetti if p.get("status") != "ARCHIVED"]
        mio = next((p for p in attivi if p["code"] == s["codice"]), None)             or next((p for p in attivi if (p.get("settings") or {}).get("commessa") == s["commessa"]
                     and (p.get("settings") or {}).get("demo")), None)
        if mio is None:
            tpl = next((p for p in progetti if p["code"] == TEMPLATE), None)
            body = {"code": s["codice"], "name": self.progetto_nome, "description": s["descrizione"],
                    "start_date": s["inizio"], "end_date": s["fine"]}
            if tpl:
                body.update(template_id=tpl["id"], with_organizations=True, with_members=True)
            mio = ld.call("com_admin", "POST", "/projects", json=body)
            if not mio:
                raise SystemExit(f"Progetto {s['codice']} non creato: {ld.log[-1:]}")
        self.pid = mio["id"]
        settings = dict(mio.get("settings") or {})
        settings.update(commessa=s["commessa"], demo=True, indirizzo=s["indirizzo"], cliente=s["cliente"],
                        importo_lavori=s["importo"])
        ld.call("com_admin", "PATCH", f"/projects/{self.pid}",
                json={"status": "ACTIVE", "settings": settings, "name": self.progetto_nome})
        self.orgs = {o["code"]: o["organization_id"] for o in ld.call("com_admin", "GET", f"/projects/{self.pid}/organizations") or []}
        self.roles = {r["code"]: r["id"] for r in ld.call("com_admin", "GET", f"/projects/{self.pid}/roles") or []}
        self._organizzazioni()
        self._persone()
        self._cartelle()
        self._nomenclatura()
        ld.call("com_admin", "PUT", f"/projects/{self.pid}/watermark",
                json={"states": ["SHARED"], "text": "CONDIVISO PER COORDINAMENTO - non valido per costruzione"})

    def _organizzazioni(self):
        """Se il template non c'era: tutte le organizzazioni del seed con il loro ruolo di parte."""
        ruoli = {"COM": "APPOINTING_PARTY", "GCO": "LEAD_APPOINTED_PARTY", "DES": "APPOINTED_PARTY",
                 "SUB1": "SUBCONTRACTOR", "SUB2": "SUBCONTRACTOR"}
        tutte = {o["code"]: o["id"] for o in _lista(self.ld.call("com_admin", "GET", "/organizations"))}
        for code, ruolo in ruoli.items():
            manca = code not in self.orgs and code in tutte
            if manca and self.ld.call("com_admin", "POST", f"/projects/{self.pid}/organizations",
                                      json={"organization_id": tutte[code], "party_role": ruolo}):
                self.orgs[code] = tutte[code]

    def _persone(self):
        """Membri: quelli del seed con il ruolo giusto se mancano, e l'account personale come PROJECT_ADMIN."""
        ld = self.ld
        membri = ld.call("com_admin", "GET", f"/projects/{self.pid}/members") or []
        presenti = {(m["user_id"], m["role_code"]) for m in membri}
        candidati = {c["email"]: c for c in ld.call("com_admin", "GET", f"/projects/{self.pid}/candidates") or []}
        voluti = {"com_admin": "PROJECT_ADMIN", "com_im": "INFORMATION_MANAGER", "com_dl": "DIRETTORE_LAVORI",
                  "des_admin": "ORG_ADMIN", "des_lead": "LEAD_DESIGNER", "des_designer": "DESIGNER",
                  "sub1_admin": "ORG_ADMIN", "sub1_user": "SUBCONTRACTOR", "sub2_user": "SUBCONTRACTOR",
                  "gc_admin": "LEAD_DESIGNER"}
        for utente, ruolo in voluti.items():
            c = candidati.get(dc.USERS[utente])
            if c and ruolo in self.roles and (c["id"], ruolo) not in presenti:   # manca: lo aggiungiamo
                ld.call("com_admin", "POST", f"/projects/{self.pid}/members", json={"user_id": c["id"], "role_id": self.roles[ruolo]})
        # account personale: l'unico utente che non e' del seed (.example) -> vede e amministra la demo
        for email, c in candidati.items():
            personale = not email.endswith(".example") and (c["id"], RUOLO_PERSONALE) not in presenti
            if personale and ld.call("com_admin", "POST", f"/projects/{self.pid}/members",
                                     json={"user_id": c["id"], "role_id": self.roles[RUOLO_PERSONALE]}):
                ld.log.append(f"{self.s['commessa']}: {email} aggiunto come {RUOLO_PERSONALE}")

    def _cartelle(self):
        ld = self.ld
        self.f = {c["name"]: c for c in ld.call("com_admin", "GET", f"/projects/{self.pid}/containers") or []}
        radici = {"DES": ("des_admin", "DES - Progetto architettonico"), "SUB1": ("sub1_admin", "SUB1 - Impianti elettrici"),
                  "SUB2": ("sub2_user", "SUB2 - Strutture metalliche"), "COM": ("com_admin", "COM - Documenti committente")}
        for org, (utente, nome) in radici.items():
            if nome not in self.f and org in self.orgs:   # radice dell'organizzazione assente: la creiamo
                self._nuova(utente, nome, None)
        volute = [("des_admin", "DES - Progetto architettonico", "Piante"),
                  ("des_admin", "DES - Progetto architettonico", "Prospetti e sezioni"),
                  ("des_admin", "DES - Progetto architettonico", "Dettagli costruttivi"),
                  ("des_admin", "DES - Progetto architettonico", "Progetto strutturale"),
                  ("des_admin", "DES - Progetto architettonico", "Modelli BIM"),
                  ("des_admin", "DES - Progetto architettonico", "Relazioni e capitolati"),
                  ("des_admin", "DES - Progetto architettonico", "Computi e cronoprogramma"),
                  ("sub1_admin", "SUB1 - Impianti elettrici", "Schemi unifilari"),
                  ("sub1_admin", "SUB1 - Impianti elettrici", "Relazioni impianti"),
                  ("com_admin", "COM - Documenti committente", "Verbali"),
                  ("com_admin", "COM - Documenti committente", "Foto di cantiere"),
                  ("com_admin", "COM - Documenti committente", "Sicurezza"),
                  ("com_admin", "COM - Documenti committente", "Direzione lavori")]
        for utente, padre, nome in volute:
            if nome not in self.f and padre in self.f:
                self._nuova(utente, nome, self.f[padre]["id"])
        if "Contratti e offerte" not in self.f:
            self._nuova("com_admin", "Contratti e offerte", None, private=True)

    def _nuova(self, utente, nome, parent, private=False):
        body = {"name": nome, "parent_id": parent, **({"is_private": True} if private else {})}
        c = self.ld.call(utente, "POST", f"/projects/{self.pid}/containers", json=body)
        if c:
            self.f[nome] = c

    def _nomenclatura(self):
        """Schema ISO 19650 della commessa: se il template non l'ha copiato, quello di PRJ01 con il codice nuovo.
        Poi accende la numerazione automatica (progressivo sul campo "number", serie per originatore/tipo/ruolo),
        senza la quale "Rinomina con progressivo", le prenotazioni e gli schemi per cartella non si possono provare
        (scenari U02, U03, U19b, U35): l'API risponde 409 auto_number_off."""
        ld = self.ld
        mio = ld.call("com_admin", "GET", f"/projects/{self.pid}/document-settings") or {}
        if mio.get("naming_scheme"):
            self._numerazione(mio)
            return
        tpl = next((p for p in _lista(ld.call("com_admin", "GET", "/projects")) if p["code"] == TEMPLATE), None)
        base = ld.call("com_admin", "GET", f"/projects/{tpl['id']}/document-settings") if tpl else None
        if not base or not base.get("naming_scheme"):
            return
        schema = base["naming_scheme"]
        for campo in schema.get("fields", []):
            if campo.get("key") == "project":
                campo["value"] = self.s["codice"]
        ld.call("com_admin", "PUT", f"/projects/{self.pid}/document-settings",
                json={"naming_scheme": schema, "auto_number": base.get("auto_number"), "metadata_schema": base.get("metadata_schema") or {"type": "object", "additionalProperties": True}})
        self._numerazione(ld.call("com_admin", "GET", f"/projects/{self.pid}/document-settings") or {})

    def _numerazione(self, imp):
        """Numerazione automatica accesa se manca: il progressivo riparte dal massimo gia' usato nella serie
        (funzione naming_series_max della migrazione 0015), quindi start=1 non crea conflitti con i documenti demo."""
        if imp.get("auto_number") or not imp.get("naming_scheme"):
            return
        self.ld.call("com_admin", "PUT", f"/projects/{self.pid}/document-settings",
                     json={"naming_scheme": imp["naming_scheme"],
                           "auto_number": {"field": "number", "start": 1, "series": ["originator", "type", "role"],
                                           "defaults": {"volume": "ZZ"}, "reservation_days": 30},
                           "metadata_schema": imp.get("metadata_schema") or {"type": "object", "additionalProperties": True}})

    # ---- documenti ------------------------------------------------------------------------------------
    def _nome(self, org, level, typ, role, ext):
        self.n += 1
        return f"{self.s['codice']}-{org}-ZZ-{level}-{typ}-{role}-{self.n:04d}.{ext}"

    def add(self, key, user, folder, org, level, typ, role, ext, ctype, title, make, fate, admin,
            seguito_da=(), attributi=None, descrizione=None, motivazione="Approvato in riunione di coordinamento"):
        """fate: WIP | SHARED | PUBLISHED | REV2 (pubblicato, nuova revisione condivisa) | REV3 (due nuove revisioni,
        l'ultima pubblicata) | ARCHIVIATO (pubblicato poi archiviato). seguito_da: utenti che seguono il documento
        prima dei cambi di stato (= notifiche)."""
        ld = self.ld
        if folder not in self.f:
            ld.log.append(f"cartella mancante: {folder}")
            return
        # Idempotenza per TITOLO e cartella, non per numero: i numeri progressivi dipendono dall'ordine delle
        # chiamate ad add(), quindi basta inserire un documento in mezzo alla lista (com'e' successo con la pianta
        # DXF il 03/11/2026) per far slittare tutti i nomi successivi e ricreare i documenti al secondo giro.
        esistente = self._per_titolo(user, folder, org, title)
        if esistente:
            self.docs[key] = esistente
            if esistente.get("state") != "WIP":
                self._segui(esistente["document_id"], seguito_da)
            return
        # Numero libero: se il nome e' gia' preso da un documento con un altro titolo si passa al successivo
        for _ in range(60):
            filename = self._nome(org, level, typ, role, ext)
            check = ld.call(user, "POST", f"/projects/{self.pid}/naming/validate", json={"name": filename})
            if not (check and check.get("existing_document_id")):
                break
        else:
            ld.log.append(f"nessun numero libero per {title}")
            return
        code = filename.rsplit(".", 1)[0]
        rev = ld.upload(user, self.f[folder]["id"], filename, make(code, "P01.01", 0), ctype, title,
                        attributes=attributi, description=descrizione)
        if not rev or not ld.wait_clean(user, rev["id"]):
            return
        self.numeri["documenti"] += 1
        self.numeri["revisioni"] += 1
        who = [user, admin]
        pubblica = ["com_dl", "com_admin"]
        if fate in ("SHARED", "PUBLISHED", "REV2", "REV3", "ARCHIVIATO"):
            rev = ld.transition(who, rev["id"], "SHARED", random.choice(["S2", "S3", "S4"])) or rev
            # da condiviso il documento si vede fuori dall'organizzazione: chi lo segue riceve le notifiche
            # dei passaggi di stato e delle revisioni successive
            self._segui(rev.get("document_id"), seguito_da)
        if fate in ("PUBLISHED", "REV2", "REV3", "ARCHIVIATO"):
            rev = ld.transition(pubblica + who, rev["id"], "PUBLISHED", random.choice(["A1", "A2", "B1"]), motivazione) or rev
        if fate == "ARCHIVIATO":
            rev = ld.transition(["com_admin"], rev["id"], "ARCHIVED", None, "Superato dal rilievo aggiornato dopo le demolizioni") or rev
        if fate in ("REV2", "REV3"):
            nxt = ld.upload(user, self.f[folder]["id"], filename, make(code, "P02.01", 1), ctype, title,
                            expected=rev.get("revision_code"), attributes=attributi)
            if nxt and ld.wait_clean(user, nxt["id"]):
                self.numeri["revisioni"] += 1
                rev = ld.transition(who, nxt["id"], "SHARED", "S3") or nxt
                if fate == "REV3":
                    rev = ld.transition(pubblica + who, rev["id"], "PUBLISHED", "A2", "Recepite le osservazioni della DL") or rev
                    n3 = ld.upload(user, self.f[folder]["id"], filename, make(code, "P03.01", 2), ctype, title,
                                   expected=rev.get("revision_code"), attributes=attributi)
                    if n3 and ld.wait_clean(user, n3["id"]):
                        self.numeri["revisioni"] += 1
                        rev = ld.transition(who, n3["id"], "SHARED", "S4") or n3
        rev.setdefault("document_id", rev.get("document_id"))
        self.docs[key] = rev

    def _per_titolo(self, user, folder, org, title):
        """L'ultima revisione del documento con questo titolo nella cartella (stesso originatore), o None.
        Legge l'elenco del progetto una volta sola (a pagine) e lo tiene in cache per il giro."""
        ld = self.ld
        # cache per utente: ognuno vede i WIP della propria organizzazione e le aree riservate a cui ha accesso,
        # quindi l'elenco letto come progettista non basta per il contratto del committente o le tavole di SUB1
        elenchi = self.__dict__.setdefault("_elenchi", {})
        if user not in elenchi:
            elenco, cursore = [], None
            while True:
                pagina = ld.call(user, "GET", f"/projects/{self.pid}/documents",
                                 params={"limit": 200, **({"after": cursore} if cursore else {})}) or {}
                elenco.extend(_lista(pagina))
                cursore = pagina.get("next_cursor") if isinstance(pagina, dict) else None
                if not cursore:
                    break
            elenchi[user] = elenco
        cid = self.f[folder]["id"]
        for d in elenchi[user]:
            if d.get("title") == title and d.get("container_id") == cid and d.get("originator_code") == org                     and not d.get("archived_at"):
                doc = ld.call(user, "GET", f"/documents/{d['id']}")
                if doc and doc.get("revisions"):
                    return dict(doc["revisions"][0], document_id=doc["id"])
        return None

    def documenti(self):
        s, P = self.s, self.progetto_nome
        loc = s["locali"]
        for i, (titolo, livello) in enumerate(s["piani"]):
            self.add(f"pianta{i}", "des_lead", "Piante", "DES", livello, "DR", "A", "pdf", PDF, titolo,
                     lambda c, r, v, i=i, t=titolo: tavola_pdf(10 + i, P, t, c, r, loc, "arch", v, pages=2 if i == 0 else 1),
                     ["REV3", "PUBLISHED", "PUBLISHED", "REV2"][i % 4], "des_admin", seguito_da=("com_admin", "com_im"),
                     attributi={"disciplina": "architettonico", "livello": livello})
        for i, titolo in enumerate(["Prospetti nord e sud", "Sezioni A-A e B-B"]):
            self.add(f"prosp{i}", "des_designer", "Prospetti e sezioni", "DES", "ZZ", "DR", "A", "pdf", PDF, titolo,
                     lambda c, r, v, i=i, t=titolo: tavola_pdf(30 + i, P, t, c, r, loc, "arch", v),
                     ["PUBLISHED", "SHARED"][i], "des_lead", seguito_da=("com_im",))
        # tavola CAD (DXF): il worker la converte in SVG per il viewer senza licenza (G44, ADR-41)
        self.add("cad0", "des_lead", "Piante", "DES", "00", "DR", "A", "dxf", DXF, "Pianta piano terra - file CAD (DXF)",
                 lambda c, r, v: dxf_sample.build(7 + v, f"{P} - Pianta piano terra", loc[:5]),
                 "PUBLISHED", "des_admin", attributi={"disciplina": "architettonico", "formato": "DXF", "livello": "00"},
                 descrizione="Stesso disegno della pianta in PDF, nel formato CAD: nel viewer si accendono i layer e si misurano le distanze.")
        self.add("dett0", "des_lead", "Dettagli costruttivi", "DES", "ZZ", "DR", "A", "pdf", PDF, "Dettaglio serramento e davanzale",
                 lambda c, r, v: tavola_pdf(40, P, "Dettaglio serramento e davanzale", c, r, loc, "arch", v), "WIP", "des_admin")
        self.add("fond", "des_lead", "Progetto strutturale", "DES", "00", "DR", "S", "pdf", PDF, "Carpenteria fondazioni e pilastri",
                 lambda c, r, v: tavola_pdf(50, P, "Carpenteria fondazioni e pilastri", c, r, loc, "strutt", v), "PUBLISHED", "des_admin",
                 seguito_da=("com_im",), attributi={"disciplina": "strutture"})
        self.add("solaio", "des_designer", "Progetto strutturale", "DES", "01", "DR", "S", "pdf", PDF, "Carpenteria solaio primo piano",
                 lambda c, r, v: tavola_pdf(51, P, "Carpenteria solaio primo piano", c, r, loc, "strutt", v), "SHARED", "des_lead",
                 attributi={"disciplina": "strutture"})
        self.add("calc", "des_lead", "Progetto strutturale", "DES", "ZZ", "CA", "S", "pdf", PDF, "Relazione di calcolo delle strutture",
                 lambda c, r, v: relazione_pdf(52, P, "Relazione di calcolo delle strutture", c, r,
                                               ["Normativa di riferimento", "Materiali", "Analisi dei carichi", "Azione sismica", "Verifiche"],
                                               "Zona sismica 2 - ag 0,25 g - classe d'uso III - vita nominale 50 anni."),
                 "SHARED", "des_admin")
        self.add("relaz", "des_lead", "Relazioni e capitolati", "DES", "ZZ", "RP", "A", "pdf", PDF, "Relazione tecnica generale",
                 lambda c, r, v: relazione_pdf(60, P, "Relazione tecnica generale", c, r,
                                               ["Premessa", "Stato dei luoghi", "Scelte progettuali", "Prestazioni energetiche", "Antincendio e accessibilita'"],
                                               s["descrizione"]), "REV2", "des_admin", seguito_da=("com_admin", "com_im"))
        self.add("computo", "des_lead", "Computi e cronoprogramma", "DES", "ZZ", "BQ", "A", "pdf", PDF, "Computo metrico estimativo",
                 lambda c, r, v: computo_pdf(P, c, r, s["voci"]), "PUBLISHED", "des_admin", seguito_da=("com_admin",),
                 attributi={"importo_lavori": s["importo"]}, motivazione="Validato dal RUP con verbale di verifica")
        mesi = max(a for _, _, a in s["fasi"])
        self.add("crono", "des_designer", "Computi e cronoprogramma", "DES", "ZZ", "PR", "A", "pdf", PDF, "Cronoprogramma dei lavori",
                 lambda c, r, v: cronoprogramma_pdf(P, c, r, s["fasi"], mesi, s["inizio"]), "PUBLISHED", "des_lead", seguito_da=("com_admin",))
        self.add("capit", "des_designer", "Relazioni e capitolati", "DES", "ZZ", "SP", "A", "txt", TXT, "Capitolato speciale d'appalto",
                 lambda c, r, v: dc.spec_txt(f"Capitolato speciale d'appalto - {P}",
                                             ["Qualita' dei materiali", "Opere in calcestruzzo", "Murature e tramezzi", "Pavimenti e rivestimenti",
                                              "Serramenti", "Impianti elettrici", "Impianti meccanici", "Tinteggiature", "Collaudi"]), "SHARED", "des_lead")
        self.add("elenco", "des_lead", "Relazioni e capitolati", "DES", "ZZ", "SH", "A", "csv", TXT, "Elenco elaborati",
                 lambda c, r, v: dc.schedule_csv(80, [(f"{s['codice']}-DES-ZZ-{lv}-DR-A-{k + 1:04d}", t) for k, (t, lv) in enumerate(s["piani"])]),
                 "SHARED", "des_admin")
        self.add("ifc", "des_lead", "Modelli BIM", "DES", "ZZ", "M3", "A", "ifc", BIN, "Modello architettonico IFC",
                 lambda c, r, v: dc.ifc_model(90 + v, storeys=len([p for p in s["piani"] if p[1] not in ("RF",)]))
                 .replace(b"'Nuovo Ospedale Nord'", f"'{s['nome']}'".encode()).replace(b"'Padiglione A'", b"'Edificio principale'"),
                 "REV2", "des_admin", seguito_da=("com_im",))
        self.add("unif", "sub1_user", "Schemi unifilari", "SUB1", "ZZ", "DR", "E", "pdf", PDF, "Schema unifilare quadro generale",
                 lambda c, r, v: tavola_pdf(100, P, "Schema unifilare quadro generale", c, r, loc, "imp", v, autore="Impianti Elettrici Srl"),
                 "SHARED", "sub1_admin", attributi={"disciplina": "impianti elettrici"})
        self.add("imp_pt", "sub1_user", "Schemi unifilari", "SUB1", "00", "DR", "E", "pdf", PDF, "Impianto elettrico piano terra",
                 lambda c, r, v: tavola_pdf(101, P, "Impianto elettrico piano terra", c, r, loc, "imp", v, autore="Impianti Elettrici Srl"),
                 "PUBLISHED", "sub1_admin", attributi={"disciplina": "impianti elettrici"})
        self.add("rel_el", "sub1_user", "Relazioni impianti", "SUB1", "ZZ", "RP", "E", "pdf", PDF, "Relazione tecnica impianti elettrici",
                 lambda c, r, v: relazione_pdf(110, P, "Relazione tecnica impianti elettrici", c, r,
                                               ["Dati di progetto", "Distribuzione", "Dimensionamento linee", "Protezioni", "Illuminazione"]),
                 "WIP", "sub1_admin")
        if "SUB2 - Strutture metalliche" in self.f:
            self.add("carp", "sub2_user", "SUB2 - Strutture metalliche", "SUB2", "RF", "DR", "S", "pdf", PDF, "Carpenteria metallica copertura",
                     lambda c, r, v: tavola_pdf(120, P, "Carpenteria metallica copertura", c, r, loc, "strutt", v, autore="Carpenterie Metalliche Srl"),
                     "WIP", "sub2_user")
        self.add("psc", "com_admin", "Sicurezza", "COM", "ZZ", "HS", "Z", "pdf", PDF, "Piano di sicurezza e coordinamento",
                 lambda c, r, v: relazione_pdf(130, P, "Piano di sicurezza e coordinamento", c, r,
                                               ["Identificazione dell'opera", "Soggetti", "Analisi dei rischi", "Organizzazione del cantiere", "Costi della sicurezza"],
                                               righe_fisse={"Soggetti": ["Committente: " + s["cliente"], "Coordinatore per l'esecuzione: ing. Marta Colombo",
                                                                         "Impresa affidataria: Cosedil S.p.A.", "Direttore dei lavori: ing. Fabio Restivo"]}),
                 "PUBLISHED", "com_admin", motivazione="Approvato dal coordinatore per l'esecuzione")
        self.add("rilievo", "com_im", "Direzione lavori", "COM", "ZZ", "SU", "Z", "pdf", PDF, "Rilievo dello stato di fatto",
                 lambda c, r, v: tavola_pdf(140, P, "Rilievo dello stato di fatto", c, r, loc, "arch", v, autore="Direzione lavori"),
                 "ARCHIVIATO", "com_admin", motivazione="Rilievo iniziale accettato")
        for i, settimana in enumerate(s["settimane"]):
            self.add(f"foto{i}", "com_im", "Foto di cantiere", "COM", "ZZ", "SU", "Z", "png", PNG, f"Avanzamento lavori - settimana {settimana}",
                     lambda c, r, v, i=i, w=settimana: dc.photo_png(200 + i + len(s["codice"]), f"{P} - avanzamento settimana {w}"),
                     "PUBLISHED", "com_admin", attributi={"settimana": settimana})
        for i, titolo in enumerate(["Verbale di consegna dei lavori", "Verbale di riunione di coordinamento n. 1",
                                    "Verbale di riunione di coordinamento n. 2"]):
            self.add(f"verb{i}", "com_im", "Verbali", "COM", "ZZ", "MI", "Z", "pdf", PDF, titolo,
                     lambda c, r, v, t=titolo, i=i: relazione_pdf(300 + i, P, t, c, r, ["Presenti", "Argomenti trattati", "Decisioni", "Prescrizioni"],
                                                                 righe_fisse={"Presenti": ["ing. Fabio Restivo (DL)", "geom. Salvatore Pappalardo (impresa)",
                                                                                           "arch. Giulia Leotta (progettista)"]}),
                     ["PUBLISHED", "PUBLISHED", "SHARED"][i], "com_admin")
        self.add("scan", "com_im", "Verbali", "COM", "ZZ", "MI", "Z", "pdf", PDF, "Verbale di sopralluogo (scansione firmata)",
                 lambda c, r, v: dc.scanned_pdf(500 + len(s["codice"]), f"Verbale di sopralluogo n. 3 - {s['nome']}", [
                     f"Documento {c} - copia firmata e scansionata", "Presenti: Direzione Lavori, Impresa, Progettista",
                     f"Sopralluogo presso {s['indirizzo']}.", "Si rileva una infiltrazione in copertura in corrispondenza del pluviale nord.",
                     "Prescrizione: ripristino della guaina entro dieci giorni.", "Prossimo sopralluogo: martedi alle ore 9:30."]),
                 "PUBLISHED", "com_admin")
        self.add("ods", "com_admin", "Direzione lavori", "COM", "ZZ", "CO", "Z", "pdf", PDF, "Ordine di servizio n. 1",
                 lambda c, r, v: relazione_pdf(600, P, "Ordine di servizio n. 1", c, r, ["Oggetto", "Disposizioni", "Termini"],
                                               "Il Direttore dei Lavori dispone quanto segue in esecuzione del contratto d'appalto."),
                 "PUBLISHED", "com_admin", motivazione="Emesso dalla Direzione Lavori")
        self.add("contr", "com_admin", "Contratti e offerte", "COM", "ZZ", "CO", "Z", "pdf", PDF, "Contratto d'appalto",
                 lambda c, r, v: relazione_pdf(400, P, "Contratto d'appalto", c, r, ["Oggetto", "Importo e pagamenti", "Termini", "Penali", "Garanzie"]),
                 "WIP", "com_admin", descrizione="Area riservata: visibile solo al committente")

    # ---- collaborazione -------------------------------------------------------------------------------
    def _segui(self, document_id, utenti):
        for chi in utenti:
            if document_id and self.ld.call(chi, "PUT", f"/documents/{document_id}/follow", ok=(204,)) is not None:
                self.numeri["seguiti"] += 1

    def _rev(self, key):
        return (self.docs.get(key) or {}).get("id")

    def annotazioni(self):
        ld = self.ld
        if self._rev("pianta0"):
            rid = self._rev("pianta0")
            esistenti = ld.call("com_im", "GET", f"/revisions/{rid}/markups") or []
            if not esistenti:
                m1 = ld.call("com_im", "POST", f"/revisions/{rid}/markups", json={"body": "Verificare la larghezza del corridoio: minimo 1,20 m per l'accessibilita'", "page": 1, "x": 0.3, "y": 0.35, "w": 0.2, "h": 0.12})
                m2 = ld.call("com_admin", "POST", f"/revisions/{rid}/markups", json={"body": "Indicare le uscite di sicurezza e i percorsi di esodo", "page": 1, "x": 0.62, "y": 0.2, "color": "#1e88e5"})
                ld.call("des_lead", "POST", f"/revisions/{rid}/markups", json={"body": "Quote aggiornate rispetto alla revisione precedente", "page": 1, "x": 0.1, "y": 0.75, "w": 0.4, "h": 0.06, "color": "#43a047"})
                self.numeri["annotazioni"] += 3
                if m1:
                    ld.call("des_lead", "POST", f"/markups/{m1['id']}/replies", json={"body": "Corridoio portato a 1,50 m, vedi nuvola di revisione."})
                    ld.call("com_im", "POST", f"/markups/{m1['id']}/replies", json={"body": "Verificato, va bene."})
                    ld.call("com_im", "POST", f"/markups/{m1['id']}/status", json={"status": "RESOLVED"})
                if m2:
                    ld.call("des_lead", "POST", f"/markups/{m2['id']}/replies", json={"body": "Le aggiungiamo nella prossima emissione insieme alla planimetria antincendio."})
        if self._rev("prosp0"):
            rid = self._rev("prosp0")
            if not ld.call("com_admin", "GET", f"/revisions/{rid}/markups"):
                ld.call("com_admin", "POST", f"/revisions/{rid}/markups", json={"body": "Colore della facciata da confermare con la committenza (campionatura in cantiere)", "page": 1, "x": 0.15, "y": 0.2, "w": 0.5, "h": 0.4, "color": "#fb8c00"})
                self.numeri["annotazioni"] += 1
        if self._rev("fond"):
            rid = self._rev("fond")
            if not ld.call("com_im", "GET", f"/revisions/{rid}/markups"):
                ld.call("com_im", "POST", f"/revisions/{rid}/markups", json={"body": "Pilastro P3: verificare il copriferro in zona di contatto con il terreno", "page": 1, "x": 0.4, "y": 0.5, "w": 0.1, "h": 0.1, "color": "#8e24aa"})
                self.numeri["annotazioni"] += 1

    def workflow(self):
        """Quattro revisioni condivise in approvazione: appena avviata, a meta', approvata fino alla pubblicazione, respinta."""
        ld = self.ld
        tpls = ld.call("com_admin", "GET", f"/projects/{self.pid}/workflow-templates") or []
        tpl = next((t for t in tpls if t.get("is_active")), None)
        if tpl is None:
            tpl = ld.call("com_admin", "POST", f"/projects/{self.pid}/workflow-templates", json={
                "code": "DEMO_REVISIONE", "name": "Revisione progetto", "definition": {
                    "steps": [{"name": "Verifica interna", "assignees": [{"type": "originator_role", "code": "LEAD_DESIGNER"}], "sla_hours": 48},
                              {"name": "Parere Direzione Lavori", "assignees": [{"type": "role", "code": "DIRETTORE_LAVORI"}], "sla_hours": 72},
                              {"name": "Approvazione committente", "assignees": [{"type": "role", "code": "PROJECT_ADMIN"}], "quorum": "ANY"}],
                    "on_approved": {"to_state": "PUBLISHED", "suitability": "A1"}}})
        if not tpl:
            return

        def avvia(key, passi, chi="des_lead"):
            rev = self.docs.get(key)
            if not rev or rev.get("state") != "SHARED":
                return
            doc = ld.call(chi, "GET", f"/documents/{rev['document_id']}/workflows") or []
            if any(w.get("status") in ("RUNNING", "APPROVED", "REJECTED", "COMPLETED") for w in _lista(doc)):
                return
            inst = ld.call(chi, "POST", f"/revisions/{rev['id']}/workflows", json={"template_id": tpl["id"], "comment": "Si chiede l'approvazione per la fase esecutiva."})
            if not inst:
                return
            self.numeri["workflow"] += 1
            for n, (utente, esito, commento) in enumerate(passi):
                task = next((t for t in ld.call(utente, "GET", "/me/tasks?status=OPEN") or [] if t.get("instance_id") == inst["id"]), None)
                if not task:
                    ld.log.append(f"workflow {key}: nessun compito aperto per {utente} al passo {n + 1}")
                    break
                ld.call(utente, "POST", f"/tasks/{task['id']}/complete", json={"outcome": esito, "comment": commento})

        avvia("prosp1", [])
        avvia("solaio", [("des_lead", "APPROVED", "Verifica interna conclusa.")])
        avvia("calc", [("des_lead", "APPROVED", "Verificata la coerenza con le carpenterie."),
                       ("com_dl", "APPROVED_WITH_COMMENTS", "Integrare la verifica a taglio del pilastro P3 nella prossima revisione."),
                       ("com_admin", "APPROVED", "Approvato per costruzione.")])
        avvia("capit", [("des_lead", "APPROVED", "Ok dal coordinamento."),
                        ("com_dl", "REJECTED", "Mancano le voci dei collaudi impiantistici: integrare e riemettere.")])

    def rfi(self):
        ld, o = self.ld, self.orgs
        if ld.call("des_lead", "GET", f"/projects/{self.pid}/rfis"):
            return
        voci = [("des_lead", "Altezza utile dei locali al piano terra", "Confermate un'altezza utile netta di 3,00 m al piano terra, compatibile con i controsoffitti impiantistici?", ["COM"], -3, "com_admin", True),
                ("sub1_user", "Posizione del quadro generale", "Il locale tecnico previsto al piano terra e' sufficiente per il quadro generale e il gruppo di continuita'?", ["DES"], 5, "des_lead", True),
                ("des_designer", "Finitura dei pavimenti", "Gres porcellanato o resina negli spazi comuni? Serve una decisione per chiudere il computo.", ["COM"], 10, "com_admin", False),
                ("com_dl", "Fase delle demolizioni", "Si chiede conferma della sequenza delle demolizioni rispetto alle attivita' che restano operative.", ["DES"], 2, "des_lead", False)]
        for utente, oggetto, domanda, a, giorni, risponde, chiudi in voci:
            allegati = [r for r in [self._rev("pianta0")] if r] if utente.startswith("des_") else []
            rfi = ld.call(utente, "POST", f"/projects/{self.pid}/rfis", json={
                "subject": oggetto, "question": domanda, "recipient_organization_ids": [o[c] for c in a if c in o],
                "revision_ids": allegati,
                "due_at": time.strftime("%Y-%m-%dT16:00:00Z", time.gmtime(time.time() + giorni * 86400))})
            if rfi:
                self.numeri["rfi"] += 1
                ld.call(risponde, "POST", f"/rfis/{rfi['id']}/messages", json={"body": "Confermiamo, vedere la tavola aggiornata nella prossima emissione.", "is_answer": chiudi})
                if chiudi:
                    ld.call(utente, "POST", f"/rfis/{rfi['id']}/close")

    def transmittal(self):
        ld, o = self.ld, self.orgs
        if ld.call("des_lead", "GET", f"/projects/{self.pid}/transmittals"):
            return
        emessi = [self._rev(k) for k in ("pianta0", "pianta1", "pianta2", "prosp0", "fond", "relaz", "computo", "crono") if self._rev(k)]
        if emessi and "COM" in o:
            t = ld.call("des_lead", "POST", f"/projects/{self.pid}/transmittals", json={
                "subject": "Emissione del progetto esecutivo", "purpose": "APPROVAL",
                "message": "Si trasmettono gli elaborati del progetto esecutivo per approvazione.",
                "recipient_organization_ids": [o["COM"]], "revision_ids": emessi[:8],
                "response_due_at": time.strftime("%Y-%m-%dT12:00:00Z", time.gmtime(time.time() + 15 * 86400))})
            if t:
                self.numeri["transmittal"] += 1
                ld.call("com_admin", "POST", f"/transmittals/{t['id']}/acknowledge")
        coord = [self._rev(k) for k in ("pianta0", "fond") if self._rev(k)]
        if coord and all(c in o for c in ("SUB1", "GCO")) and ld.call("des_lead", "POST", f"/projects/{self.pid}/transmittals", json={
                "subject": "Tavole per il coordinamento degli impianti", "purpose": "COMMENT",
                "recipient_organization_ids": [o["SUB1"], o["GCO"]], "revision_ids": coord}):
            self.numeri["transmittal"] += 1
        el = [self._rev(k) for k in ("imp_pt", "unif") if self._rev(k)]
        if el and "DES" in o and ld.call("sub1_user", "POST", f"/projects/{self.pid}/transmittals", json={
                "subject": "Progetto impianto elettrico - prima emissione", "purpose": "INFORMATION",
                "recipient_organization_ids": [o["DES"]], "revision_ids": el}):
            self.numeri["transmittal"] += 1

    def accessi(self):
        """L'impresa degli impianti chiede di vedere l'area riservata; il committente decide."""
        ld = self.ld
        riservata = self.f.get("Contratti e offerte")
        if not riservata:
            return
        if ld.call("com_admin", "GET", f"/projects/{self.pid}/access-requests"):
            return
        req = ld.call("sub1_user", "POST", f"/containers/{riservata['id']}/access-requests",
                      json={"reason": "Serve l'elenco prezzi allegato al contratto per i subappalti degli impianti.", "actions": ["READ", "DOWNLOAD"]})
        if req:
            self.numeri["accessi"] += 1
            approva = self.s["commessa"] == "101-003"
            ld.call("com_admin", "POST", f"/access-requests/{req['id']}/decide",
                    json={"approve": approva, "note": "Accesso concesso per 30 giorni." if approva else "Non pertinente: i prezzi vanno chiesti all'impresa affidataria.",
                          **({"valid_until": time.strftime("%Y-%m-%dT00:00:00Z", time.gmtime(time.time() + 30 * 86400))} if approva else {})})
        req2 = ld.call("des_designer", "POST", f"/containers/{riservata['id']}/access-requests",
                       json={"reason": "Verifica delle clausole tecniche del contratto.", "actions": ["READ"]})
        if req2:
            self.numeri["accessi"] += 1       # resta in attesa: si vede nella pagina Aree riservate

    def prenotazioni(self):
        ld = self.ld
        if ld.call("com_im", "GET", f"/projects/{self.pid}/naming/reservations"):
            return
        imp = ld.call("com_admin", "GET", f"/projects/{self.pid}/document-settings") or {}
        if not imp.get("auto_number"):
            return          # prenotazioni solo con la numerazione automatica (scelta del Project Admin)
        ld.call("des_lead", "POST", f"/projects/{self.pid}/naming/reservations",
                json={"fields": {"originator": "DES", "volume": "ZZ", "level": "02", "type": "DR", "role": "A"}, "count": 3,
                      "note": "Tavole del piano secondo in preparazione"})

    def rimuovi(self):
        ld = self.ld
        progetti = _lista(ld.call("com_admin", "GET", "/projects"))
        for p in progetti:
            st = p.get("settings") or {}
            if st.get("demo") and (st.get("commessa") == self.s["commessa"] or p["code"] == self.s["codice"]):
                st = dict(st, commessa_rimossa=st.get("commessa"))
                st.pop("commessa", None)
                ld.call("com_admin", "PATCH", f"/projects/{p['id']}", json={"status": "ARCHIVED", "settings": st, "name": f"[DEMO archiviata] {p['name']}"})
                print(f"{self.s['commessa']}: progetto {p['code']} archiviato e scollegato dalla commessa")

    def esegui(self):
        self.progetto()
        self.documenti()
        self.annotazioni()
        self.workflow()
        self.rfi()
        self.transmittal()
        self.accessi()
        self.prenotazioni()
        tot = _lista(self.ld.call("com_admin", "GET", f"/projects/{self.pid}/documents?limit=200"))
        return {"progetto": self.pid, "codice": self.s["codice"], "documenti_in_totale": len(tot), **self.numeri}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Demo parlante di SkyTower: due commesse complete via API")
    ap.add_argument("--api", default="http://127.0.0.1:8100")
    ap.add_argument("--password", default=dc.DEMO_PASSWORD)
    ap.add_argument("--solo", help="solo questa commessa (101-003 o C-2024-015)")
    ap.add_argument("--rimuovi", action="store_true", help="archivia i progetti demo e li scollega dal codice commessa")
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(errors="replace")
    ld = Carico(args.api, args.password)
    esiti = []
    for spec in COMMESSE:
        if args.solo and args.solo.replace(" ", "").upper() != spec["commessa"].upper():
            continue
        d = Demo(ld, spec)
        if args.rimuovi:
            d.rimuovi()
            continue
        e = d.esegui()
        esiti.append(e)
        print(f"{spec['commessa']} {spec['nome']} ({e['codice']}, progetto {e['progetto']}): "
              + ", ".join(f"{k} {v}" for k, v in e.items() if k not in ("progetto", "codice")))
    for riga in ld.log:
        print("  nota:", riga)
    return esiti


if __name__ == "__main__":
    main()
