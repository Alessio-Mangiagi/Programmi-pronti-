"""
Esporta lo schema OpenAPI dell'API in web/openapi.json, da cui il frontend
genera i tipi TypeScript (`npm run api:types` in web/).

    python -m scripts.export_openapi
"""
import json
from pathlib import Path

from app.main import app

OUT = Path(__file__).resolve().parent.parent / "web" / "openapi.json"


def main():
    OUT.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"scritto {OUT}")


if __name__ == "__main__":
    main()
