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

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
