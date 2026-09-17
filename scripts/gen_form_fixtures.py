"""
Genera packages/form-core/fixtures/cases.json: casi di schema e submission con
gli errori attesi calcolati da app/forms.py (implementazione di riferimento).

    python -m scripts.gen_form_fixtures

Il file è committato e verificato sia da pytest (tests/test_forms_fixtures.py)
sia da vitest (packages/form-core/test/fixtures.test.ts): se il validatore
Python cambia, il test Python fallisce e si rigenera consapevolmente; se il
porting TS diverge, fallisce vitest.
"""
import json
from pathlib import Path

from app.forms import validate_schema, validate_submission

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "packages" / "form-core" / "fixtures" / "cases.json"
EXAMPLE = json.loads((ROOT / "form_schema_example.json").read_text(encoding="utf-8"))["schema_def"]


def field(**kw):
    base = {"id": "f", "type": "text", "label": "F"}
    base.update(kw)
    return {"fields": [base]}


SCHEMAS = {
    "example": EXAMPLE,
    "not_object": None,
    "list": [],
    "empty_object": {},
    "empty_fields": {"fields": []},
    "fields_not_list": {"fields": "x"},
    "field_not_object": {"fields": ["x"]},
    "id_empty": field(id=""),
    "id_uppercase": field(id="Esito"),
    "id_starts_digit": field(id="1a"),
    "id_dash": field(id="a-b"),
    "id_missing": field(id=None),
    "id_too_long": field(id="a" * 65),
    "id_duplicate": {"fields": [{"id": "a", "type": "text", "label": "A"},
                                {"id": "a", "type": "number", "label": "A2"}]},
    "type_unknown": field(type="radio"),
    "type_missing": field(type=None),
    "type_number_value": field(type=5),
    "label_blank": field(label="  "),
    "label_missing": {"fields": [{"id": "f", "type": "text"}]},
    "required_not_bool": field(required="yes"),
    "help_not_string": field(help=3),
    "props_not_allowed": field(type="checkbox", options=["a"], foo=1),
    "select_options_missing": field(type="select"),
    "select_options_empty": field(type="select", options=[]),
    "select_options_blank": field(type="select", options=["a", ""]),
    "select_options_dup": field(type="select", options=["a", "a"]),
    "select_options_string": field(type="select", options="a"),
    "select_default_ok": field(type="select", options=["a", "b"], default="a"),
    "select_default_bad": field(type="select", options=["a", "b"], default="z"),
    "multiselect_default_bad": field(type="multiselect", options=["a", "b"], default=["a", "z"]),
    "multiselect_default_ok": field(type="multiselect", options=["a", "b"], default=["b"]),
    "number_min_gt_max": field(type="number", min=5, max=1),
    "number_min_string": field(type="number", min="1"),
    "number_integer_string": field(type="number", integer="yes"),
    "number_default_string": field(type="number", default="3"),
    "number_ok": field(type="number", min=0, max=10, integer=True, default=3),
    "number_float_bounds": field(type="number", min=0.5, max=1.5),
    "date_today": field(type="date", default="today"),
    "date_iso": field(type="date", default="2026-01-31"),
    "date_bad": field(type="date", default="31/01/2026"),
    "date_invalid_calendar": field(type="date", default="2026-02-30"),
    "text_max_length_zero": field(max_length=0),
    "text_max_length_float": field(max_length=2.5),
    "text_default_number": field(default=1),
    "checkbox_default_string": field(type="checkbox", default="no"),
    "photo_multiple_string": field(type="photo", multiple="si"),
    "photo_multiple_ok": field(type="photo", multiple=True),
    "signature_extra_prop": field(type="signature", default="x"),
    "geolocation_ok": field(type="geolocation", help="Posizione"),
    "many_errors_same_field": field(type="number", min="a", max="b", integer=1, default="c", label=""),
}

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

MINIMAL = {"area": "x", "esito": "Conforme", "firma_ispettore": "s", "data_ispezione": "2026-09-14"}


def with_(**kw):
    d = dict(VALID_DATA)
    d.update(kw)
    return d


SUBMISSIONS = {
    "valid": with_(),
    "not_object": [1],
    "null": None,
    "optional_omitted_or_empty": {**MINIMAL, "note": "", "rischi": [], "foto": None},
    "required_missing": {"note": "solo note"},
    "required_empty_string": with_(area=""),
    "required_null": with_(esito=None),
    "unknown_field": with_(extra=1, altro="x"),
    "text_not_string": with_(area=5),
    "text_too_long": with_(area="x" * 121),
    "text_exact_max": with_(area="x" * 120),
    "number_string": with_(persone_presenti="3"),
    "number_bool": with_(persone_presenti=True),
    "number_float_for_integer": with_(persone_presenti=2.5),
    "number_below_min": with_(persone_presenti=-1),
    "number_zero_ok": with_(persone_presenti=0),
    "checkbox_string": with_(dpi_indossati="si"),
    "select_not_option": with_(esito="Boh"),
    "select_number": with_(esito=1),
    "multiselect_string": with_(rischi="Elettrico"),
    "multiselect_not_option": with_(rischi=["Elettrico", "Nucleare"]),
    "multiselect_duplicates": with_(rischi=["Elettrico", "Elettrico"]),
    "multiselect_non_strings": with_(rischi=[1]),
    "date_bad_format": with_(data_ispezione="14/09/2026"),
    "date_invalid_calendar": with_(data_ispezione="2026-02-30"),
    "date_compact_format": with_(data_ispezione="20260914"),
    "photo_string": with_(foto="11111111-1111-4111-8111-111111111111"),
    "photo_two_when_single": with_(foto=["a", "b"]),
    "photo_empty_id": with_(foto=[""]),
    "signature_empty": with_(firma_ispettore=""),
    "signature_number": with_(firma_ispettore=7),
    "geolocation_missing_lng": with_(posizione={"lat": 45.0}),
    "geolocation_out_of_range": with_(posizione={"lat": 91, "lng": 0}),
    "geolocation_accuracy_string": with_(posizione={"lat": 1, "lng": 2, "accuracy": "8"}),
    "geolocation_extra_key": with_(posizione={"lat": 1, "lng": 2, "alt": 100}),
    "geolocation_list": with_(posizione=[45.0, 9.0]),
    "geolocation_edges_ok": with_(posizione={"lat": -90, "lng": 180}),
    "many_errors_ordered": {"zzz": 1, "area": 5, "esito": "Boh", "rischi": "x", "persone_presenti": "n",
                            "firma_ispettore": "", "data_ispezione": "x"},
}


def main():
    assert validate_schema(EXAMPLE) == []
    cases = {
        "schema_cases": [
            {"name": name, "schema": schema, "errors": validate_schema(schema)}
            for name, schema in SCHEMAS.items()
        ],
        "submission_schema": EXAMPLE,
        "submission_cases": [
            {"name": name, "data": data, "errors": validate_submission(EXAMPLE, data)}
            for name, data in SUBMISSIONS.items()
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    n_err = sum(bool(c["errors"]) for c in cases["schema_cases"] + cases["submission_cases"])
    print(f"scritto {OUT}: {len(SCHEMAS)} schemi, {len(SUBMISSIONS)} submission, {n_err} casi con errori")


if __name__ == "__main__":
    main()
