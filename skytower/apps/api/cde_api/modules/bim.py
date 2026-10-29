# "><(((º> sabusabu <º)))><"
"""Dal modello BIM alle tavole: per l'elemento selezionato nel viewer IFC, i documenti che lo citano e le tavole
del suo piano.

  citato in      revisioni il cui testo (indice di ADR-26) contiene il nome dell'elemento o il suo GUID IFC,
                 come frase esatta, con l'estratto evidenziato; esclusi gli altri modelli (M2, M3, MR);
  stesso piano   tavole (tipo DR della naming convention) con lo stesso codice livello del piano dell'elemento.

Tutto passa dalla RLS: si vedono solo i documenti e i testi delle revisioni visibili a chi chiede.
"""
from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, Query

from ..deps import Ctx, ctx, require_project
from .documents import DOCUMENT_SQL

router = APIRouter(tags=["documents"])
LIMIT = 30
LEVEL_RE = re.compile(r"^[A-Z0-9]{2,3}$")
MODEL_TYPES = ["M2", "M3", "MR"]          # altri modelli: il loro testo (STEP) ripete i nomi, non sono tavole


def _ocr_variant(name: str) -> str:
    """Il nome come lo scrive spesso l'OCR: lo zero dentro un codice (P0, B01) letto come la lettera O."""
    return re.sub(r"\b([A-Z]+)(\d+)\b", lambda m: m.group(1) + m.group(2).replace("0", "O"), name)


@router.get("/projects/{project_id}/model-element/documents")
def element_documents(project_id: uuid.UUID,
                      name: str | None = Query(default=None, max_length=200, description="nome dell'elemento"),
                      guid: str | None = Query(default=None, max_length=64, description="GlobalId IFC"),
                      level: str | None = Query(default=None, max_length=3, description="codice livello del piano"),
                      exclude: uuid.UUID | None = Query(default=None, description="il modello stesso"),
                      c: Ctx = Depends(ctx)):
    terms = [t.strip() for t in (name, guid) if t and t.strip()]
    if name and _ocr_variant(name.strip()) != name.strip():
        terms.append(_ocr_variant(name.strip()))      # tavole scansionate: l'OCR legge "P0" come "PO"
    level = level.upper() if level and LEVEL_RE.match(level.upper()) else None
    with c.tx() as conn:
        require_project(conn, project_id)
        cited: list[dict] = []
        if terms:
            # frase esatta: "Muro perimetrale sud P0" non trova "Muro perimetrale sud P1"
            tsq = " || ".join(["phraseto_tsquery('italian', %s)"] * len(terms))
            hits = conn.execute(
                f"""SELECT DISTINCT ON (t.document_id) t.document_id, r.revision_code,
                           ts_headline('italian', t.body, {tsq},
                                       'StartSel=⟦, StopSel=⟧, MaxFragments=2, MaxWords=18, MinWords=6, FragmentDelimiter=" … "')
                           AS snippet
                    FROM cde.revision_text t JOIN cde.document_revisions r ON r.id = t.revision_id
                         JOIN cde.documents d ON d.id = t.document_id
                    WHERE t.project_id = %s AND t.content @@ ({tsq}) AND t.document_id IS DISTINCT FROM %s
                      AND coalesce(d.naming_fields->>'type', '') <> ALL(%s)
                    ORDER BY t.document_id, r.sequence DESC""",
                [*terms, project_id, *terms, exclude, MODEL_TYPES]).fetchall()
            found = {h["document_id"]: h for h in hits}
            if found:
                cited = conn.execute(DOCUMENT_SQL + " WHERE d.id = ANY(%s) AND d.archived_at IS NULL"
                                     " ORDER BY d.identifier LIMIT %s", [list(found), LIMIT]).fetchall()
                for d in cited:
                    d["match_snippet"] = found[d["id"]]["snippet"]
                    d["match_revision"] = found[d["id"]]["revision_code"]
        same_level: list[dict] = []
        if level:
            same_level = conn.execute(
                DOCUMENT_SQL + """ WHERE d.project_id = %s AND d.archived_at IS NULL
                                     AND d.naming_fields->>'type' = 'DR' AND d.naming_fields->>'level' = %s
                                   ORDER BY d.identifier LIMIT %s""", [project_id, level, LIMIT]).fetchall()
    return {"cited": cited, "same_level": same_level, "level": level}
