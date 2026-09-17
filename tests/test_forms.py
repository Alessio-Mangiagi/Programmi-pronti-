"""
Test del validatore dei moduli dinamici (app/forms.py) e dell'endpoint
POST /form-templates. Gli stessi casi vanno replicati in packages/form-core.
"""
import json
from pathlib import Path

import pytest

from app.forms import validate_schema, validate_submission

EXAMPLE = json.loads(
    (Path(__file__).parent.parent / "form_schema_example.json").read_text(encoding="utf-8")
)
SCHEMA = EXAMPLE["schema_def"]


def field(**kw):
    base = {"id": "f", "type": "text", "label": "F"}
    base.update(kw)
    return {"fields": [base]}


def messages(errors, fid):
    return [e["message"] for e in errors if e["field"] == fid]


# ---------- validate_schema ----------

def test_example_schema_is_valid():
    assert validate_schema(SCHEMA) == []


@pytest.mark.parametrize("schema", [None, [], {}, {"fields": []}, {"fields": "x"}])
def test_schema_needs_non_empty_fields(schema):
    errs = validate_schema(schema)
    assert errs and errs[0]["field"] == "$"


@pytest.mark.parametrize("bad_id", ["", "Esito", "1a", "a-b", None, "a" * 65])
def test_schema_field_id_format(bad_id):
    errs = validate_schema(field(id=bad_id))
    assert any("'id'" in e["message"] for e in errs)


def test_schema_duplicate_id():
    schema = {"fields": [
        {"id": "a", "type": "text", "label": "A"},
        {"id": "a", "type": "number", "label": "A2"},
    ]}
    assert messages(validate_schema(schema), "a") == ["duplicate field id"]


def test_schema_unknown_type_and_missing_label():
    assert messages(validate_schema(field(type="radio")), "f") == ["unknown type 'radio'"]
    assert "'label' is required" in messages(validate_schema(field(label="  ")), "f")


def test_schema_rejects_props_not_allowed_for_type():
    errs = validate_schema(field(type="checkbox", options=["a"]))
    assert any("not allowed for type checkbox" in m for m in messages(errs, "f"))


@pytest.mark.parametrize("opts", [None, [], ["a", ""], ["a", "a"], "a"])
def test_schema_select_options(opts):
    assert messages(validate_schema(field(type="select", options=opts)), "f")


def test_schema_select_default_must_be_option():
    ok = field(type="select", options=["a", "b"], default="a")
    ko = field(type="select", options=["a", "b"], default="z")
    assert validate_schema(ok) == []
    assert messages(validate_schema(ko), "f") == ["'default' must be one of options"]
    ko2 = field(type="multiselect", options=["a", "b"], default=["a", "z"])
    assert messages(validate_schema(ko2), "f") == ["'default' must be a subset of options"]


def test_schema_number_constraints():
    assert messages(validate_schema(field(type="number", min=5, max=1)), "f") == ["'min' must be <= 'max'"]
    assert messages(validate_schema(field(type="number", min="1")), "f") == ["'min' must be a number"]
    assert messages(validate_schema(field(type="number", integer="yes")), "f") == ["'integer' must be a boolean"]
    assert validate_schema(field(type="number", min=0, max=10, integer=True, default=3)) == []


def test_schema_date_default():
    assert validate_schema(field(type="date", default="today")) == []
    assert validate_schema(field(type="date", default="2026-01-31")) == []
    assert messages(validate_schema(field(type="date", default="31/01/2026")), "f")


def test_schema_text_max_length_and_photo_multiple():
    assert messages(validate_schema(field(max_length=0)), "f")
    assert messages(validate_schema(field(type="photo", multiple="si")), "f")
    assert validate_schema(field(type="photo", multiple=True)) == []


# ---------- validate_submission ----------

VALID_DATA = {
    "area": "Piano 2, vano scala",
    "esito": "Non conforme",
    "rischi": ["Elettrico", "Altro"],
    "persone_presenti": 3,
    "dpi_indossati": True,
    "note": "Quadro aperto",
    "foto": ["11111111-1111-4111-8111-111111111111"],
    "posizione": {"lat": 45.46, "lng": 9.19, "accuracy": 8.5},
    "firma_ispettore": "22222222-2222-4222-8222-222222222222",
    "data_ispezione": "2026-09-14",
}


def test_submission_valid():
    assert validate_submission(SCHEMA, VALID_DATA) == []


def test_submission_optional_fields_can_be_omitted_or_empty():
    data = {"area": "x", "esito": "Conforme", "firma_ispettore": "s",
            "data_ispezione": "2026-09-14", "note": "", "rischi": [], "foto": None}
    assert validate_submission(SCHEMA, data) == []


def test_submission_missing_required():
    errs = validate_submission(SCHEMA, {"esito": "Conforme"})
    missing = sorted(e["field"] for e in errs if e["message"] == "required")
    assert missing == ["area", "data_ispezione", "firma_ispettore"]


def test_submission_empty_string_counts_as_missing():
    errs = validate_submission(SCHEMA, {**VALID_DATA, "area": ""})
    assert messages(errs, "area") == ["required"]


def test_submission_unknown_field():
    errs = validate_submission(SCHEMA, {**VALID_DATA, "colore": "rosso"})
    assert messages(errs, "colore") == ["unknown field"]


def test_submission_not_an_object():
    assert validate_submission(SCHEMA, [1, 2])[0]["field"] == "$"


@pytest.mark.parametrize("fid,value,expected", [
    ("area", 123, "must be a string"),
    ("area", "x" * 121, "longer than 120 characters"),
    ("esito", "Boh", "not one of options"),
    ("rischi", "Elettrico", "must be a list of strings"),
    ("rischi", ["Nucleare"], "contains values not in options"),
    ("rischi", ["Altro", "Altro"], "contains duplicates"),
    ("persone_presenti", "3", "must be a number"),
    ("persone_presenti", 2.5, "must be an integer"),
    ("persone_presenti", -1, "must be >= 0"),
    ("persone_presenti", True, "must be a number"),
    ("dpi_indossati", "si", "must be a boolean"),
    ("data_ispezione", "14/09/2026", "must be a date YYYY-MM-DD"),
    ("data_ispezione", "2026-02-30", "must be a date YYYY-MM-DD"),
    ("foto", "abc", "must be a list of attachment ids"),
    ("firma_ispettore", 5, "must be an attachment id"),
    ("posizione", {"lat": 1}, "must be an object with numeric lat and lng"),
    ("posizione", {"lat": 91, "lng": 0}, "lat/lng out of range"),
    ("posizione", {"lat": 1, "lng": 1, "alt": 3}, "only lat, lng, accuracy allowed"),
])
def test_submission_type_errors(fid, value, expected):
    errs = validate_submission(SCHEMA, {**VALID_DATA, fid: value})
    assert messages(errs, fid) == [expected]


def test_submission_single_photo_limit():
    schema = field(type="photo")
    assert validate_submission(schema, {"f": ["a"]}) == []
    assert messages(validate_submission(schema, {"f": ["a", "b"]}), "f") == ["only one photo allowed"]


# ---------- endpoint ----------

def test_post_form_template_accepts_example(client):
    r = client.post("/form-templates", json=EXAMPLE)
    assert r.status_code == 201, r.text
    assert r.json()["schema_def"] == SCHEMA


def test_post_form_template_rejects_invalid_schema(client):
    r = client.post("/form-templates", json={"name": "X", "schema_def": {"fields": [{"id": "A"}]}})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert isinstance(detail, list) and detail[0]["field"] == "fields[0]"


# ---------- gestione template (form builder) ----------

def test_template_patch_archive_and_schema_lock(client, project, pin, users):
    tpl = project["template"]
    url = f"/form-templates/{tpl['id']}"
    assert client.get(url).json()["submissions_count"] == 0
    # rinomina + schema modificabile finché non ci sono submission
    new_schema = {"fields": [{"id": "esito", "type": "select", "label": "Esito", "required": True,
                              "options": ["Conforme", "Non conforme"]}]}
    r = client.patch(url, json={"name": "Ispezione v2", "category": "safety", "schema_def": new_schema})
    assert r.status_code == 200 and r.json()["name"] == "Ispezione v2" and r.json()["schema_def"] == new_schema
    assert client.patch(url, json={"schema_def": {"fields": []}}).status_code == 422
    assert client.patch(url, json={"name": " "}).status_code == 422
    # field non può gestire template
    assert client.patch(url, headers=users["field"]["headers"], json={"name": "x"}).status_code == 403
    # con una submission lo schema si blocca (409), nome no
    client.post("/submissions", json={"template_id": tpl["id"], "pin_id": pin, "data_json": {"esito": "Conforme"}})
    assert client.get(url).json()["submissions_count"] == 1
    assert client.patch(url, json={"schema_def": new_schema}).status_code == 409
    assert client.patch(url, json={"name": "Ispezione v3"}).status_code == 200
    # archivia: sparisce dalla lista, resta con include_archived, niente nuove submission
    r = client.patch(url, json={"archived": True})
    assert r.status_code == 200 and r.json()["archived_at"]
    assert tpl["id"] not in {t["id"] for t in client.get("/form-templates").json()}
    assert tpl["id"] in {t["id"] for t in client.get("/form-templates", params={"include_archived": True}).json()}
    r = client.post("/submissions", json={"template_id": tpl["id"], "pin_id": pin, "data_json": {"esito": "Conforme"}})
    assert r.status_code == 409
    assert client.patch(url, json={"archived": False}).json()["archived_at"] is None
    assert client.patch("/form-templates/nope", json={"name": "x"}).status_code == 404
    assert client.get("/form-templates/nope").status_code == 404
