# "><(((º> sabusabu <º)))><"
"""ISO 19650: naming convention configurabile, codici di revisione e di idoneità."""
from .codes import ROLE_CODES, SUITABILITY_CODES, TYPE_CODES
from .naming import AutoNumbering, FieldError, FieldSpec, NamingScheme, ValidationResult, default_scheme
from .revisions import (
    is_valid_revision,
    next_wip_revision,
    parse_revision,
    published_code_for,
    shared_code_for,
    suitability_stage,
)

__all__ = [
    "ROLE_CODES", "SUITABILITY_CODES", "TYPE_CODES", "AutoNumbering", "FieldError", "FieldSpec", "NamingScheme",
    "ValidationResult", "default_scheme", "is_valid_revision", "next_wip_revision", "parse_revision",
    "published_code_for", "shared_code_for", "suitability_stage",
]
