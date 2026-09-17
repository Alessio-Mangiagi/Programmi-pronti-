"""
Validazione dei moduli dinamici.

Due funzioni pure (nessun accesso al DB), così la stessa logica è
replicabile 1:1 in `packages/form-core` per web e mobile:

- validate_schema(schema)            -> errori sulla DEFINIZIONE del modulo
- validate_submission(schema, data)  -> errori sulle RISPOSTE rispetto al modulo

Entrambe restituiscono una lista di {"field": <id campo o "$">, "message": str}.
Lista vuota = valido. Il formato dello schema è documentato in docs/form-schema.md.
"""
import re
from datetime import date
from typing import Any

FIELD_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # fromisoformat accetterebbe anche "20260914"

FIELD_TYPES = {
    "text", "textarea", "number", "checkbox", "select", "multiselect",
    "date", "photo", "signature", "geolocation",
}

# Proprietà ammesse per ogni tipo, oltre a quelle comuni (id, type, label, required, help).
TYPE_PROPS = {
    "text": {"max_length", "default"},
    "textarea": {"max_length", "default"},
    "number": {"min", "max", "integer", "default"},
    "checkbox": {"default"},
    "select": {"options", "default"},
    "multiselect": {"options", "default"},
    "date": {"default"},
    "photo": {"multiple"},
    "signature": set(),
    "geolocation": set(),
}
COMMON_PROPS = {"id", "type", "label", "required", "help"}


def _err(field: str, message: str) -> dict:
    return {"field": field, "message": message}


# ---------- Schema ----------

def validate_schema(schema: Any) -> list[dict]:
    errors: list[dict] = []
    if not isinstance(schema, dict):
        return [_err("$", "schema must be an object")]

    fields = schema.get("fields")
    if not isinstance(fields, list) or not fields:
        return [_err("$", "'fields' must be a non-empty list")]

    seen: set[str] = set()
    for i, f in enumerate(fields):
        where = f"fields[{i}]"
        if not isinstance(f, dict):
            errors.append(_err(where, "field must be an object"))
            continue

        fid = f.get("id")
        if not isinstance(fid, str) or not FIELD_ID_RE.match(fid):
            errors.append(_err(where, "'id' must match ^[a-z][a-z0-9_]{0,63}$"))
        elif fid in seen:
            errors.append(_err(fid, "duplicate field id"))
        else:
            seen.add(fid)
        where = fid if isinstance(fid, str) else where

        ftype = f.get("type")
        if ftype not in FIELD_TYPES:
            errors.append(_err(where, f"unknown type {ftype!r}"))
            continue

        if not isinstance(f.get("label"), str) or not f["label"].strip():
            errors.append(_err(where, "'label' is required"))
        if "required" in f and not isinstance(f["required"], bool):
            errors.append(_err(where, "'required' must be a boolean"))
        if "help" in f and not isinstance(f["help"], str):
            errors.append(_err(where, "'help' must be a string"))

        extra = set(f) - COMMON_PROPS - TYPE_PROPS[ftype]
        if extra:
            errors.append(_err(where, f"properties not allowed for type {ftype}: {sorted(extra)}"))

        errors.extend(_validate_type_props(where, ftype, f))

    return errors


def _validate_type_props(where: str, ftype: str, f: dict) -> list[dict]:
    errors: list[dict] = []

    if ftype in ("select", "multiselect"):
        opts = f.get("options")
        if (not isinstance(opts, list) or not opts
                or not all(isinstance(o, str) and o.strip() for o in opts)):
            errors.append(_err(where, "'options' must be a non-empty list of strings"))
        elif len(set(opts)) != len(opts):
            errors.append(_err(where, "'options' contains duplicates"))
        elif "default" in f:
            d = f["default"]
            if ftype == "select" and d not in opts:
                errors.append(_err(where, "'default' must be one of options"))
            if ftype == "multiselect" and (not isinstance(d, list) or not set(d) <= set(opts)):
                errors.append(_err(where, "'default' must be a subset of options"))

    if ftype in ("text", "textarea"):
        if "max_length" in f and (not isinstance(f["max_length"], int) or f["max_length"] < 1):
            errors.append(_err(where, "'max_length' must be a positive integer"))
        if "default" in f and not isinstance(f["default"], str):
            errors.append(_err(where, "'default' must be a string"))

    if ftype == "number":
        for k in ("min", "max"):
            if k in f and not _is_number(f[k]):
                errors.append(_err(where, f"'{k}' must be a number"))
        if _is_number(f.get("min")) and _is_number(f.get("max")) and f["min"] > f["max"]:
            errors.append(_err(where, "'min' must be <= 'max'"))
        if "integer" in f and not isinstance(f["integer"], bool):
            errors.append(_err(where, "'integer' must be a boolean"))
        if "default" in f and not _is_number(f["default"]):
            errors.append(_err(where, "'default' must be a number"))

    if ftype == "checkbox" and "default" in f and not isinstance(f["default"], bool):
        errors.append(_err(where, "'default' must be a boolean"))

    if ftype == "date" and "default" in f:
        if f["default"] != "today" and not _is_iso_date(f["default"]):
            errors.append(_err(where, "'default' must be 'today' or YYYY-MM-DD"))

    if ftype == "photo" and "multiple" in f and not isinstance(f["multiple"], bool):
        errors.append(_err(where, "'multiple' must be a boolean"))

    return errors


# ---------- Submission ----------

def validate_submission(schema: dict, data: Any) -> list[dict]:
    """
    Assume `schema` già valido. Controlla che `data` (chiave = field id)
    rispetti required e tipo di ogni campo. Chiavi sconosciute = errore,
    così un client con un template vecchio non salva dati silenziosamente persi.
    """
    if not isinstance(data, dict):
        return [_err("$", "data must be an object")]

    errors: list[dict] = []
    fields = {f["id"]: f for f in schema["fields"]}

    for key in data:
        if key not in fields:
            errors.append(_err(key, "unknown field"))

    for fid, f in fields.items():
        value = data.get(fid)
        if _is_empty(value):
            if f.get("required"):
                errors.append(_err(fid, "required"))
            continue
        msg = _check_value(f, value)
        if msg:
            errors.append(_err(fid, msg))

    return errors


def _check_value(f: dict, v: Any) -> str | None:
    t = f["type"]

    if t in ("text", "textarea"):
        if not isinstance(v, str):
            return "must be a string"
        if "max_length" in f and len(v) > f["max_length"]:
            return f"longer than {f['max_length']} characters"

    elif t == "number":
        if not _is_number(v):
            return "must be a number"
        if f.get("integer") and int(v) != v:
            return "must be an integer"
        if "min" in f and v < f["min"]:
            return f"must be >= {f['min']}"
        if "max" in f and v > f["max"]:
            return f"must be <= {f['max']}"

    elif t == "checkbox":
        if not isinstance(v, bool):
            return "must be a boolean"

    elif t == "select":
        if v not in f["options"]:
            return "not one of options"

    elif t == "multiselect":
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            return "must be a list of strings"
        if not set(v) <= set(f["options"]):
            return "contains values not in options"
        if len(set(v)) != len(v):
            return "contains duplicates"

    elif t == "date":
        if not _is_iso_date(v):
            return "must be a date YYYY-MM-DD"

    elif t == "photo":
        # Lista di attachment id (UUID generati dal client); l'esistenza
        # dell'attachment è verificata dal sync, non qui.
        if not isinstance(v, list) or not all(isinstance(x, str) and x for x in v):
            return "must be a list of attachment ids"
        if not f.get("multiple") and len(v) > 1:
            return "only one photo allowed"

    elif t == "signature":
        if not isinstance(v, str) or not v:
            return "must be an attachment id"

    elif t == "geolocation":
        if not isinstance(v, dict) or not _is_number(v.get("lat")) or not _is_number(v.get("lng")):
            return "must be an object with numeric lat and lng"
        if not (-90 <= v["lat"] <= 90 and -180 <= v["lng"] <= 180):
            return "lat/lng out of range"
        if "accuracy" in v and not _is_number(v["accuracy"]):
            return "'accuracy' must be a number"
        if set(v) - {"lat", "lng", "accuracy"}:
            return "only lat, lng, accuracy allowed"

    return None


# ---------- Helpers ----------

def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_iso_date(v: Any) -> bool:
    if not isinstance(v, str) or not ISO_DATE_RE.match(v):
        return False
    try:
        date.fromisoformat(v)
        return True
    except ValueError:
        return False


def _is_empty(v: Any) -> bool:
    return v is None or v == "" or v == []
