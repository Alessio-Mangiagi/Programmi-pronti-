"""
I casi condivisi con packages/form-core (fixtures/cases.json) devono dare
esattamente gli errori registrati: se questo test fallisce, il validatore
Python è cambiato -> rigenerare con `python -m scripts.gen_form_fixtures`
e far passare anche vitest in packages/form-core.
"""
import json
from pathlib import Path

import pytest

from app.forms import validate_schema, validate_submission

CASES = json.loads(
    (Path(__file__).parent.parent / "packages" / "form-core" / "fixtures" / "cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES["schema_cases"], ids=lambda c: c["name"])
def test_schema_case(case):
    assert validate_schema(case["schema"]) == case["errors"]


@pytest.mark.parametrize("case", CASES["submission_cases"], ids=lambda c: c["name"])
def test_submission_case(case):
    assert validate_submission(CASES["submission_schema"], case["data"]) == case["errors"]
