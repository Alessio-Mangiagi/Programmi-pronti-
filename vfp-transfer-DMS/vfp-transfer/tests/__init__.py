# "><(((º> sabusabu <º)))><"
"""
Test del programma. Dalla cartella vfp-transfer:  python -m unittest discover -s tests -t .
Non toccano Viewpoint, caselle email o file del programma: ogni test lavora in una cartella temporanea.
"""

import os
import sys
import tempfile
from pathlib import Path

# Gli avvisi per il Portale (avvisi_portale) finiscono qui, non nel Portale vero.
os.environ["SUITE_AVVISI_DIR"] = tempfile.mkdtemp(prefix="vfp_test_avvisi_")
# Dall'11/11/2026 ogni login chiede il profilo al portale (auth.profilo_portale): nei test il portale e' un indirizzo
# dove non risponde nessuno (porta 9, "discard"), cosi' un test che non lo sostituisce non tocca mai quello vero
# sul PC (localhost:8080) e il login prosegue come a portale spento. Va impostato prima di importare cosedil_sso.
os.environ["COSEDIL_PORTAL"] = "http://127.0.0.1:9"

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
