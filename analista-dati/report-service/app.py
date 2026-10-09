"""
Report worker (Python) — dove Python vince: elaborati Excel ricchi.

Riceve dal backend TS l'elenco di analisi (colonne + righe già pronte) e produce
un .xlsx con quello che SheetJS community NON sa fare:
  - GRAFICI nativi (barre / linea auto per serie a 2 colonne)
  - intestazioni formattate, autofilter, freeze pane, larghezze colonna
  - foglio "Riepilogo" con indice

È un servizio isolato: se è spento, il backend TS ripiega su SheetJS (solo tabelle).
Avvio:  uvicorn app:app --port 8000     (vedi avvia.bat)
"""
import io
import re
from typing import Any

import xlsxwriter
from fastapi import FastAPI, Response
from pydantic import BaseModel

# "><(((º> sabusabu <º)))><"
app = FastAPI(title="Agente DB — Report worker")


class Section(BaseModel):
    title: str
    columns: list[str] = []
    rows: list[dict[str, Any]] = []
    sql: str | None = None
    error: str | None = None
    truncated: bool = False
    rowCount: int | None = None


class BuildReq(BaseModel):
    title: str
    dbKind: str = ""
    sections: list[Section]


@app.get("/health")
def health() -> dict:
    return {"ok": True, "engine": "python/xlsxwriter"}


_BAD_SHEET = re.compile(r"[\[\]:*?/\\]")
_TEMPORAL = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$|^\d{4}[-/]\d{1,2}$")


def _sheet_name(raw: str, used: set[str]) -> str:
    base = (_BAD_SHEET.sub(" ", raw or "Foglio").strip() or "Foglio")[:31]
    name, n = base, 2
    while name.lower() in used:
        suf = f" ({n})"
        n += 1
        name = base[: 31 - len(suf)] + suf
    used.add(name.lower())
    return name


def _is_number(v: Any) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


@app.post("/build")
def build(req: BuildReq) -> Response:
    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    f_hdr = wb.add_format({"bold": True, "bg_color": "#2563eb", "font_color": "#ffffff", "border": 1})
    f_title = wb.add_format({"bold": True, "font_size": 15})
    f_key = wb.add_format({"bold": True})
    f_err = wb.add_format({"font_color": "#dc2626"})

    used: set[str] = {"riepilogo"}  # riserva il nome del foglio indice
    names = [_sheet_name(s.title or f"Analisi {i + 1}", used) for i, s in enumerate(req.sections)]

    # ── Foglio Riepilogo ──
    rs = wb.add_worksheet("Riepilogo")
    for col, w in [(0, 6), (1, 34), (2, 12), (3, 16), (4, 70)]:
        rs.set_column(col, col, w)
    rs.write(0, 0, req.title, f_title)
    rs.write(2, 0, "Database", f_key)
    rs.write(2, 1, req.dbKind)
    rs.write_row(4, 0, ["#", "Foglio", "Righe", "Esito", "Query"], f_hdr)
    for i, s in enumerate(req.sections):
        esito = f"ERRORE: {s.error}" if s.error else ("troncato" if s.truncated else "ok")
        rc = s.rowCount if s.rowCount is not None else len(s.rows)
        rs.write_row(5 + i, 0, [i + 1, names[i], rc, esito, s.sql or ""])

    # ── Un foglio per analisi ──
    for i, s in enumerate(req.sections):
        ws = wb.add_worksheet(names[i])
        cols = s.columns
        if not cols:
            ws.write(0, 0, "Nessun dato", f_key)
            if s.error:
                ws.write(1, 0, s.error, f_err)
            continue

        ws.write_row(0, 0, cols, f_hdr)
        for ri, row in enumerate(s.rows):
            for ci, c in enumerate(cols):
                v = row.get(c)
                if v is None:
                    ws.write_blank(ri + 1, ci, None)
                elif isinstance(v, bool):
                    ws.write_boolean(ri + 1, ci, v)
                elif isinstance(v, (int, float)):
                    ws.write_number(ri + 1, ci, v)
                else:
                    ws.write_string(ri + 1, ci, str(v))

        n = len(s.rows)
        if n:
            ws.freeze_panes(1, 0)
            ws.autofilter(0, 0, n, len(cols) - 1)
            sample = s.rows[:60]
            for ci, c in enumerate(cols):
                width = max([len(str(c))] + [len(str(r.get(c, ""))) for r in sample])
                ws.set_column(ci, ci, min(max(width + 2, 10), 55))

        # GRAFICO: serie a 2 colonne con 2ª numerica → linea (se temporale) o barre
        if len(cols) == 2 and 0 < n <= 100 and all(_is_number(r.get(cols[1])) for r in s.rows):
            temporal = all(_TEMPORAL.match(str(r.get(cols[0]))) for r in s.rows)
            chart = wb.add_chart({"type": "line" if temporal else "column"})
            chart.add_series({
                "name": cols[1],
                "categories": [names[i], 1, 0, n, 0],
                "values": [names[i], 1, 1, n, 1],
                "data_labels": {"value": True} if n <= 20 else None,
            })
            chart.set_title({"name": s.title})
            chart.set_legend({"none": True})
            chart.set_size({"x_scale": 1.5, "y_scale": 1.4})
            ws.insert_chart(1, len(cols) + 1, chart)

    wb.close()
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
