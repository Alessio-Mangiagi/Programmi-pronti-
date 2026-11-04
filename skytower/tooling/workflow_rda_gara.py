# "><(((º> sabusabu <º)))><"
r"""Carica in un progetto il processo "RdA → gara → affidamento" (workflow a grafo, ADR-48) e un processo di prova.

Script comodo da lanciare senza il comando ``cde``: fa la stessa cosa di ``cde workflow-rda``.

    .venv\Scripts\python tooling\workflow_rda_gara.py --progetto GALFOR            # modello + processo di prova
    .venv\Scripts\python tooling\workflow_rda_gara.py --progetto GALFOR --rimuovi  # li toglie

La logica (definizione dei 27 nodi e caricamento via API) sta in ``cde_api/tooling/workflow_rda.py``.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from cde_api.tooling import workflow_rda

if __name__ == "__main__":
    workflow_rda.main()
