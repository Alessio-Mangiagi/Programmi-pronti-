# "><(((º> sabusabu <º)))><"
import pytest
from iso19650 import (
    AutoNumbering,
    FieldSpec,
    NamingScheme,
    default_scheme,
    is_valid_revision,
    next_wip_revision,
    parse_revision,
    published_code_for,
    shared_code_for,
    suitability_stage,
)
from pydantic import ValidationError

ORGS = {"ABC": "Studio ABC", "DES": "Progettista", "SUB1": "Impianti"}


@pytest.fixture
def scheme():
    return default_scheme("PRJ01", ORGS)


# ---------------------------------------------------------------------
# Nomi validi
# ---------------------------------------------------------------------
@pytest.mark.parametrize("name", [
    "PRJ01-ABC-ZZ-01-DR-A-0001",
    "PRJ01-ABC-ZZ-01-DR-A-0001.pdf",
    "PRJ01-DES-B1-B1-M3-S-000123.IFC",
    "PRJ01-SUB1-XX-RF-SP-E-1234.docx",
    "PRJ01-ABC-V01-M2-SH-Z-99999",
])
def test_nomi_validi(scheme, name):
    r = scheme.validate_name(name)
    assert r.valid, r.errors
    assert r.identifier == name.rsplit(".", 1)[0] if "." in name else name


def test_campi_estratti_ed_estensione(scheme):
    r = scheme.validate_name("PRJ01-ABC-ZZ-01-DR-A-0001.PDF")
    assert r.extension == "pdf"
    assert r.fields == {"project": "PRJ01", "originator": "ABC", "volume": "ZZ", "level": "01",
                        "type": "DR", "role": "A", "number": "0001"}


# ---------------------------------------------------------------------
# Nomi non conformi
# ---------------------------------------------------------------------
@pytest.mark.parametrize("name, field, suggestion", [
    ("PRJ02-ABC-ZZ-01-DR-A-0001", "project", "PRJ01"),
    ("PRJ01-XYZ-ZZ-01-DR-A-0001", "originator", None),
    ("PRJ01-ABC-ZZ-01-DX-A-0001", "type", "DR"),
    ("PRJ01-ABC-ZZ-01-DR-Q1-0001", "role", None),
    ("PRJ01-ABC-ZZ-1-DR-A-0001", "level", None),
    ("PRJ01-ABC-ZZ-01-DR-A-01", "number", None),
    ("PRJ01-ABC-ZZ-01-DR-A-12AB", "number", None),
    ("PRJ01-abc-ZZ-01-DR-A-0001", "originator", "ABC"),
    ("PRJ01-ABC-ZZZZ-01-DR-A-0001", "volume", None),
])
def test_errori_per_campo(scheme, name, field, suggestion):
    r = scheme.validate_name(name)
    assert not r.valid and r.identifier is None
    assert [e.field for e in r.errors] == [field]
    if suggestion:
        assert suggestion in r.errors[0].suggestions


def test_numero_campi_errato_suggerisce_esempio(scheme):
    r = scheme.validate_name("PRJ01-ABC-0001.pdf")
    assert r.errors[0].field == "_structure"
    assert r.errors[0].suggestions == ["PRJ01-ABC-ZZ-00-AF-A-0001"]


def test_errori_multipli_riportati_tutti(scheme):
    r = scheme.validate_name("PRJ09-ABC-ZZ-01-XX-QQ-0001")
    assert {e.field for e in r.errors} == {"project", "type", "role"}


def test_restrizione_originatore_a_organizzazione_utente(scheme):
    r = scheme.validate_name("PRJ01-ABC-ZZ-01-DR-A-0001", extra_codes={"originator": {"DES"}})
    assert not r.valid
    assert r.errors[0].message == "Codice non ammesso"
    assert r.errors[0].suggestions == ["DES"]
    assert scheme.validate_name("PRJ01-DES-ZZ-01-DR-A-0001", extra_codes={"originator": {"DES"}}).valid


def test_restrizione_su_campo_regex():
    s = default_scheme("PRJ01")  # originatore libero (regex)
    assert s.validate_name("PRJ01-QWE-ZZ-01-DR-A-0001").valid
    r = s.validate_name("PRJ01-QWE-ZZ-01-DR-A-0001", extra_codes={"originator": {"DES"}})
    assert r.errors[0].message == "Valore non ammesso per questo utente"


def test_lunghezza_campo_fisso():
    s = default_scheme("PRJ01", ORGS)
    r = s.validate_name("PRJ0001-ABC-ZZ-01-DR-A-0001")
    assert "Lunghezza" in r.errors[0].message


# ---------------------------------------------------------------------
# Schemi personalizzati
# ---------------------------------------------------------------------
def test_schema_personalizzato_con_underscore():
    s = NamingScheme(separator="_", fields=[
        FieldSpec(key="project", label="Progetto", kind="fixed", value="H01"),
        FieldSpec(key="discipline", label="Disciplina", kind="list", codes={"AR": "Arch", "ST": "Strutture"}),
        FieldSpec(key="number", label="Numero", kind="regex", pattern=r"\d{3}", min_length=3, max_length=3),
    ])
    assert s.validate_name("H01_ST_001.dwg").valid
    assert s.example() == "H01_AR_000"
    assert s.field("discipline").codes["ST"] == "Strutture"


def test_esempio_campo_regex_non_numerico():
    s = NamingScheme(fields=[
        FieldSpec(key="project", label="P", kind="fixed", value="AB"),
        FieldSpec(key="zone", label="Zona", kind="regex", pattern=r"[A-Z]{2}", min_length=2, max_length=2),
    ])
    assert s.example() == "AB-XX"


@pytest.mark.parametrize("bad", [
    dict(key="xx", label="x", kind="fixed"),
    dict(key="x1", label="x", kind="fixed", value="A"),
    dict(key="xx", label="x", kind="list"),
    dict(key="xx", label="x", kind="regex"),
    dict(key="xx", label="x", kind="regex", pattern="("),
    dict(key="xx", label="x", kind="regex", pattern="a", min_length=5, max_length=2),
])
def test_specifiche_di_campo_non_valide(bad):
    with pytest.raises((ValidationError, ValueError)):
        FieldSpec(**bad)


def test_chiavi_duplicate_rifiutate():
    f = FieldSpec(key="project", label="P", kind="fixed", value="AB")
    with pytest.raises(ValidationError):
        NamingScheme(fields=[f, f])


def test_schema_serializzabile_e_ricaricabile(scheme):
    again = NamingScheme.model_validate(scheme.model_dump())
    assert again.validate_name("PRJ01-ABC-ZZ-01-DR-A-0001").valid


# ---------------------------------------------------------------------
# Revisioni e idoneità
# ---------------------------------------------------------------------
@pytest.mark.parametrize("prev, nxt", [
    (None, "P01.01"), ("P01.01", "P01.02"), ("P01.09", "P01.10"), ("P02", "P03.01"), ("C01", "P01.01"),
])
def test_prossima_revisione_wip(prev, nxt):
    assert next_wip_revision(prev) == nxt


@pytest.mark.parametrize("prev", ["P01.99", "P99"])
def test_limiti_revisione(prev):
    with pytest.raises(ValueError):
        next_wip_revision(prev)


def test_parse_e_validita():
    assert parse_revision("P03.07") == ("P03.07", "WIP", 3, 7)
    assert parse_revision("P03").stage == "SHARED"
    assert parse_revision("C02").stage == "PUBLISHED"
    assert is_valid_revision("C10") and not is_valid_revision("P1.1") and not is_valid_revision("X01")


def test_ricodifica_shared_e_published():
    assert shared_code_for("P02.05") == "P02"
    with pytest.raises(ValueError):
        shared_code_for("P02")
    assert published_code_for(None) == "C01"
    assert published_code_for("C03") == "C04"
    with pytest.raises(ValueError):
        published_code_for("P01")


def test_idoneita():
    assert suitability_stage("S0") == "WIP"
    assert suitability_stage("S3") == "SHARED"
    assert suitability_stage("A1") == "PUBLISHED"
    assert suitability_stage("CR") == "PUBLISHED"
    with pytest.raises(ValueError):
        suitability_stage("S9")


# ---------------------------------------------------------------------
# Rinomina automatica: progressivo deciso dall'admin
# ---------------------------------------------------------------------
VALUES = {"originator": "DES", "volume": "ZZ", "level": "01", "type": "DR", "role": "A"}


def test_compose_e_formato_numero(scheme):
    auto = AutoNumbering()
    name = scheme.compose({**VALUES, "number": scheme.format_number(auto, 7)}, "pdf")
    assert name == "PRJ01-DES-ZZ-01-DR-A-0007.pdf"
    assert scheme.validate_name(name).valid
    assert scheme.compose(VALUES) == "PRJ01-DES-ZZ-01-DR-A-"
    assert scheme.format_number(auto, 123456) == "123456"
    with pytest.raises(ValueError, match="oltre le 6 cifre"):
        scheme.format_number(auto, 1_000_000)


def test_serie_di_numerazione(scheme):
    assert scheme.series(AutoNumbering(), VALUES) == VALUES   # campi assenti (qui il fisso) ignorati
    tutti = scheme.series(AutoNumbering(), {"project": "PRJ01", **VALUES})
    assert tutti == {"project": "PRJ01", **VALUES}
    assert scheme.series(AutoNumbering(series=["originator", "type"]), VALUES) == {"originator": "DES", "type": "DR"}
    assert scheme.series(AutoNumbering(series=[]), VALUES) == {}


def test_configurazione_valida(scheme):
    scheme.check_auto_numbering(AutoNumbering(start=1, series=["originator"], defaults={"volume": "ZZ", "level": "ZZ"}))


@pytest.mark.parametrize(("auto", "message"), [
    (AutoNumbering(field="assente"), "assente nella naming convention"),
    (AutoNumbering(field="type"), "non accetta numeri progressivi"),
    (AutoNumbering(field="originator"), "non accetta numeri progressivi"),
    (AutoNumbering(series=["inventato"]), "Campi non validi"),
    (AutoNumbering(series=["number"]), "Campi non validi"),
    (AutoNumbering(defaults={"inventato": "X"}), "Campi non validi"),
    (AutoNumbering(defaults={"type": "QQ"}), "Valore predefinito di 'Tipo'"),
])
def test_configurazione_non_valida(scheme, auto, message):
    with pytest.raises(ValueError, match=message):
        scheme.check_auto_numbering(auto)


def test_progressivo_su_campo_non_numerico():
    scheme = NamingScheme(fields=[
        FieldSpec(key="project", label="Progetto", kind="fixed", value="P1", min_length=2, max_length=2),
        FieldSpec(key="code", label="Codice", kind="regex", pattern="[A-Z]{4}", min_length=4, max_length=4),
    ])
    with pytest.raises(ValueError, match="non accetta numeri progressivi"):
        scheme.check_auto_numbering(AutoNumbering(field="code"))
