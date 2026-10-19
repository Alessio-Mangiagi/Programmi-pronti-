# "><(((º> sabusabu <º)))><"
"""
Test del programma. Dalla cartella vfp-transfer:  python -m unittest discover -s tests -t .
Non toccano Viewpoint, caselle email o file del programma: ogni test lavora in una cartella temporanea.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
