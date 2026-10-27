# "><(((º> sabusabu <º)))><"
"""Motore di validazione della naming convention ISO 19650, configurabile per progetto.

Uno schema è una sequenza ordinata di campi separati da un separatore. Ogni campo è:
  * ``fixed``  — valore imposto (es. codice progetto);
  * ``list``   — valore preso da una lista di codici (es. Tipo, Ruolo, Originatore);
  * ``regex``  — valore che rispetta un'espressione regolare (es. Numero progressivo).
"""
from __future__ import annotations

import difflib
import re
from functools import cached_property
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .codes import ROLE_CODES, TYPE_CODES

FieldKind = Literal["fixed", "list", "regex"]


class FieldSpec(BaseModel):
    key: str = Field(pattern=r"^[a-z_]{2,30}$")
    label: str
    kind: FieldKind
    min_length: int = Field(default=1, ge=1, le=20)
    max_length: int = Field(default=20, ge=1, le=20)
    value: str | None = None                       # kind = fixed
    codes: dict[str, str] = Field(default_factory=dict)  # kind = list
    pattern: str | None = None                     # kind = regex (ancorata implicitamente)
    example: str | None = None                     # valore mostrato negli esempi/suggerimenti
    help: str | None = None

    @model_validator(mode="after")
    def _consistent(self) -> FieldSpec:
        if self.min_length > self.max_length:
            raise ValueError(f"{self.key}: min_length > max_length")
        if self.kind == "fixed" and not self.value:
            raise ValueError(f"{self.key}: un campo fisso richiede 'value'")
        if self.kind == "list" and not self.codes:
            raise ValueError(f"{self.key}: un campo a lista richiede 'codes'")
        if self.kind == "regex":
            if not self.pattern:
                raise ValueError(f"{self.key}: un campo regex richiede 'pattern'")
            try:
                re.compile(self.pattern)
            except re.error as exc:
                raise ValueError(f"{self.key}: espressione regolare non valida ({exc})") from None
        return self


class FieldError(BaseModel):
    field: str
    label: str
    value: str | None
    message: str
    suggestions: list[str] = Field(default_factory=list)


class ValidationResult(BaseModel):
    name: str
    valid: bool
    identifier: str | None = None
    extension: str | None = None
    fields: dict[str, str] = Field(default_factory=dict)
    errors: list[FieldError] = Field(default_factory=list)


class NamingScheme(BaseModel):
    separator: str = Field(default="-", min_length=1, max_length=1, pattern=r"^[-_.]$")
    fields: list[FieldSpec] = Field(min_length=2, max_length=12)

    @model_validator(mode="after")
    def _unique_keys(self) -> NamingScheme:
        keys = [f.key for f in self.fields]
        if len(keys) != len(set(keys)):
            raise ValueError("Chiavi di campo duplicate")
        return self

    @cached_property
    def _by_key(self) -> dict[str, FieldSpec]:
        return {f.key: f for f in self.fields}

    def field(self, key: str) -> FieldSpec:
        return self._by_key[key]

    def example(self) -> str:
        parts = []
        for f in self.fields:
            if f.kind == "fixed":
                parts.append(f.value)
            elif f.kind == "list":
                parts.append(next(iter(f.codes)))
            elif f.example:
                parts.append(f.example)
            else:
                parts.append(("0" if "\\d" in (f.pattern or "") else "X") * f.min_length)
        return self.separator.join(parts)

    def validate_name(self, name: str, *, extra_codes: dict[str, set[str]] | None = None) -> ValidationResult:
        """Valida un nome file (estensione opzionale). ``extra_codes`` restringe ulteriormente
        i valori ammessi di un campo (es. originatore = solo l'organizzazione di chi carica)."""
        raw = name.strip()
        stem, ext = raw, None
        m = re.match(r"^(.*?)\.([A-Za-z0-9]{1,10})$", raw)
        if m and self.separator != ".":
            stem, ext = m.group(1), m.group(2).lower()

        result = ValidationResult(name=raw, valid=False, extension=ext)
        parts = stem.split(self.separator)
        if len(parts) != len(self.fields):
            result.errors.append(FieldError(
                field="_structure", label="Struttura", value=stem,
                message=f"Attesi {len(self.fields)} campi separati da '{self.separator}', trovati {len(parts)}",
                suggestions=[self.example()],
            ))
            return result

        for spec, value in zip(self.fields, parts, strict=True):
            error = _check_field(spec, value, (extra_codes or {}).get(spec.key))
            if error:
                result.errors.append(error)
            else:
                result.fields[spec.key] = value

        if not result.errors:
            result.valid = True
            result.identifier = stem
        return result


def _check_field(spec: FieldSpec, value: str, restrict: set[str] | None) -> FieldError | None:
    def err(message: str, suggestions: list[str] | None = None) -> FieldError:
        return FieldError(field=spec.key, label=spec.label, value=value, message=message,
                          suggestions=suggestions or [])

    if value != value.upper():
        return err("Usare solo lettere maiuscole", [value.upper()])
    if not (spec.min_length <= len(value) <= spec.max_length):
        size = (f"{spec.min_length}" if spec.min_length == spec.max_length
                else f"{spec.min_length}–{spec.max_length}")
        return err(f"Lunghezza {len(value)}: attesi {size} caratteri")

    if spec.kind == "fixed":
        if value != spec.value:
            return err(f"Valore atteso: {spec.value}", [spec.value])
    elif spec.kind == "list":
        allowed = set(spec.codes)
        if restrict is not None:
            allowed &= restrict
        if value not in allowed:
            close = difflib.get_close_matches(value, sorted(allowed), n=3, cutoff=0.4)
            return err("Codice non ammesso" if value in spec.codes else "Codice sconosciuto",
                       close or sorted(allowed)[:5])
    elif not re.fullmatch(spec.pattern, value):
        return err(spec.help or f"Formato non valido ({spec.pattern})")

    if restrict is not None and spec.kind != "list" and value not in restrict:
        return err("Valore non ammesso per questo utente", sorted(restrict)[:5])
    return None


def default_scheme(project_code: str, originators: dict[str, str] | None = None) -> NamingScheme:
    """Schema ISO 19650-2 UK NA: Progetto-Originatore-Volume-Livello-Tipo-Ruolo-Numero.

    Esempio: ``PRJ01-ABC-ZZ-01-DR-A-0001``.
    """
    origin_field = (
        FieldSpec(key="originator", label="Originatore", kind="list", min_length=3, max_length=6, codes=originators)
        if originators else
        FieldSpec(key="originator", label="Originatore", kind="regex", min_length=3, max_length=6,
                  pattern=r"[A-Z0-9]{3,6}", help="Codice organizzazione di 3–6 caratteri")
    )
    return NamingScheme(fields=[
        FieldSpec(key="project", label="Progetto", kind="fixed", min_length=2, max_length=6, value=project_code),
        origin_field,
        FieldSpec(key="volume", label="Volume / Sistema", kind="regex", min_length=1, max_length=3,
                  pattern=r"ZZ|XX|[A-Z0-9]{1,3}", example="ZZ", help="ZZ = tutti i volumi, XX = nessuno"),
        FieldSpec(key="level", label="Livello / Posizione", kind="regex", min_length=2, max_length=3,
                  pattern=r"ZZ|XX|RF|\d{2}|B\d|M\d", example="00", help="00–99, B1–B9 interrati, M1–M9 mezzanini, RF copertura, ZZ, XX"),
        FieldSpec(key="type", label="Tipo", kind="list", min_length=2, max_length=2, codes=TYPE_CODES),
        FieldSpec(key="role", label="Ruolo", kind="list", min_length=1, max_length=2, codes=ROLE_CODES),
        FieldSpec(key="number", label="Numero", kind="regex", min_length=4, max_length=6,
                  pattern=r"\d{4,6}", example="0001", help="Progressivo di 4–6 cifre"),
    ])
