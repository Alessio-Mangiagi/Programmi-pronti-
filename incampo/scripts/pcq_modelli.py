"""
PCQ approvati → Word nel formato dell'import → moduli (template) nel DB.

I PCQ approvati sono PDF (molti scansionati): i loro controlli sono trascritti in file
JSON, uno per famiglia, ciascuno con una lista di documenti:

    {"file": "PCQ01 - CLS - Opere in calcestruzzo", "title": "PCQ n°1 - CLS - ...",
     "intro": "...", "table_title": "Controlli del piano" (facoltativo),
     "header": ["POS.", "Controllo", ...], "rows": [["1", "Verifica ...", ...], ...]}

Due comandi:

    python -m scripts.pcq_modelli docx DATI_DIR OUT_DIR   # un .docx per documento
    python -m scripts.pcq_modelli load DOCX_DIR           # crea i moduli nel DB

"docx" scrive i Word con la stessa struttura dell'esempio di "Struttura PCQ"
(pcq_import.build_docx). "load" rilegge i Word con lo stesso parser dell'import e li
converte come fa l'editor web (web/src/forms/pcqToSchema.ts, qui portato in Python):
ogni riga è una domanda Conforme / Non conforme / Non applicabile, le altre colonne
l'aiuto, una sezione per fase (o per tabella) e in fondo la Chiusura. I moduli che
esistono già con lo stesso nome non si toccano.
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

from app import pcq_import

PCQ_OUTCOMES = ["Conforme", "Non conforme", "Non applicabile"]
CONTROL_RE = re.compile(r"controll|verific|prova|attivit|descrizion|ispezion|caratteristic|oggetto", re.I)
PHASE_RE = re.compile(r"^(fase|lavorazion|opera|wbs|categoria|elemento)", re.I)
INDEX_RE = re.compile(r"^(n\.?|n°|nr\.?|num(ero)?|#|pos\.?|id|cod(ice)?)$", re.I)
LABEL_MAX = 200
CATEGORY = "quality"


# ---------- Word ----------

def write_docx(data_dir: Path, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for src in sorted(data_dir.glob("*.json")):
        for doc in json.loads(src.read_text(encoding="utf-8")):
            rows = [doc["header"], *doc["rows"]]
            data = pcq_import.build_docx(doc["title"], doc.get("intro"), [(None, doc.get("table_title"), rows)])
            path = out_dir / f"{doc['file']}.docx"
            path.write_bytes(data)
            written.append(path)
            print(f"scritto {path.name} ({len(doc['rows'])} righe)")
    return written


# ---------- conversione (come pcqToSchema.ts) ----------

def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _cut(s: str) -> str:
    return s if len(s) <= LABEL_MAX else s[: LABEL_MAX - 1] + "…"


def slug_id(label: str, taken: set[str]) -> str:
    """Come web/src/forms/slug.ts: snake_case ASCII, al massimo 40 caratteri, univoco."""
    base = "".join(c for c in unicodedata.normalize("NFD", label) if not unicodedata.combining(c)).lower()
    base = re.sub(r"[^a-z0-9]+", "_", base).strip("_")
    base = re.sub(r"^[^a-z]+", "", base)[:40] or "campo"
    fid, n = base, 2
    while fid in taken:
        fid, n = f"{base}_{n}", n + 1
    return fid


def _columns(header: list[str]) -> tuple[int, int]:
    control = next((i for i, h in enumerate(header) if CONTROL_RE.search(h)), -1)
    phase = next((i for i, h in enumerate(header) if i != control and PHASE_RE.match(h.strip())), -1)
    if control >= 0:
        return control, phase
    first = next((i for i, h in enumerate(header) if h.strip() and not INDEX_RE.match(h.strip())), -1)
    return (first if first >= 0 else 0), -1


def to_schema(doc: pcq_import.PcqDocument, filename: str) -> tuple[str, dict, int]:
    """PCQ letto (solo .docx) → (nome, schema del modulo, n° di controlli)."""
    fields: list[dict] = []
    sections: list[dict] = []
    field_ids: set[str] = set()
    section_ids: set[str] = set()

    def section(title):
        sid = slug_id(title or "sezione", section_ids)
        section_ids.add(sid)
        s = {"id": sid, "columns": 1, "items": [], **({"title": _cut(_clean(title))} if title else {})}
        sections.append(s)
        return s

    def control(into, label, help_text):
        fid = slug_id(label, field_ids)
        field_ids.add(fid)
        fields.append({"id": fid, "type": "select", "label": _cut(label), "required": True,
                       "options": PCQ_OUTCOMES, **({"help": help_text} if help_text else {})})
        into["items"].append({"field": fid})

    for t in doc.tables:
        if len(t.rows) < 2:
            continue
        header, rows = t.rows[0], t.rows[1:]
        ci, pi = _columns(header)
        current, phase = None, ""
        for r in rows:
            cell = lambda i: _clean(r[i]) if i < len(r) else ""
            label = cell(ci)
            if pi >= 0 and cell(pi):
                phase = cell(pi)
            if not label:
                continue
            if current is None or (pi >= 0 and current.get("title") != _cut(phase)):
                current = section(phase if pi >= 0 else t.title)
            help_text = " · ".join(f"{_clean(h) or f'Colonna {i + 1}'}: {cell(i)}"
                                   for i, h in enumerate(header) if i not in (ci, pi) and cell(i))
            control(current, label, help_text)

    controls = len(fields)
    closing = section("Chiusura")
    for f in ({"id": "data_controllo", "type": "date", "label": "Data del controllo", "required": True, "default": "today"},
              {"id": "note", "type": "textarea", "label": "Note"},
              {"id": "firma", "type": "signature", "label": "Firma del responsabile", "required": True}):
        fid = slug_id(f["id"], field_ids)
        field_ids.add(fid)
        fields.append({**f, "id": fid})
        closing["items"].append({"field": fid})

    name = (doc.headings[0].strip() if doc.headings else "") or Path(filename).stem
    return _cut(_clean(name)), {"fields": fields, "layout": {"sections": sections}}, controls


# ---------- DB ----------

def load(docx_dir: Path) -> int:
    from app import models
    from app.database import SessionLocal
    from app.forms import validate_schema

    errors = 0
    with SessionLocal() as db:
        for path in sorted(docx_dir.glob("*.docx")):
            name, schema, controls = to_schema(pcq_import.parse(path.read_bytes(), path.name), path.name)
            problems = validate_schema(schema)
            if problems:
                print(f"ERRORE {path.name}: {problems}", file=sys.stderr)
                errors += 1
                continue
            if db.query(models.FormTemplate).filter(models.FormTemplate.name == name).first():
                print(f"esiste  {name}")
                continue
            db.add(models.FormTemplate(name=name, category=CATEGORY, schema_def=schema))
            print(f"creato  {name} ({controls} controlli)")
        db.commit()
    return 1 if errors else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PCQ approvati → Word → moduli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("docx", help="scrive un .docx per ogni documento dei JSON")
    p.add_argument("data_dir", type=Path)
    p.add_argument("out_dir", type=Path)
    p = sub.add_parser("load", help="crea i moduli dai .docx")
    p.add_argument("docx_dir", type=Path)
    args = parser.parse_args(argv)
    if args.cmd == "docx":
        write_docx(args.data_dir, args.out_dir)
        return 0
    return load(args.docx_dir)


if __name__ == "__main__":
    sys.exit(main())
