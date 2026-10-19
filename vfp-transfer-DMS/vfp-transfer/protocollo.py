# "><(((º> sabusabu <º)))><"
"""
Numero di protocollo delle PEC: riconoscimento nell'oggetto, correzioni a mano, controllo della numerazione.

Il numero si ricava dall'oggetto ogni volta che serve (non e' salvato nel registro della posta): una regola
migliorata vale subito anche per le PEC gia' arrivate. Ordine:
  1. correzione a mano dell'amministratore (protocolli_manuali.json), se c'e';
  2. regola personalizzata PEC_PROTOCOL_REGEX delle Impostazioni, se compilata;
  3. regole predefinite (Prot. n. ..., numerazione annuale da 001, PG/aaaa/n, REGISTRO UFFICIALE...).
La numerazione riparte da 001 a ogni anno solare: se il numero non ha l'anno si aggiunge quello di arrivo
(001/2026), cosi' resta univoco. Il controllo della numerazione segnala numeri mancanti e doppi per anno.
"""

import json
import re
import threading
from datetime import datetime

import env_config

OVERRIDES_PATH = env_config.BASE_DIR / "protocolli_manuali.json"
MAX_RULE_LEN = 300
MAX_MISSING = 200  # numeri mancanti elencati per anno (oltre si indica solo quanti sono)

# prefissi che i gestori PEC e i programmi di posta aggiungono all'oggetto
_PREFIX = (r"(?:(?:posta\s+certificata|anomalia\s+messaggio|accettazione|avvenuta\s+consegna|consegna|"
           r"mancata\s+consegna|non\s+accettazione|presa\s+in\s+carico|re|r|fw|fwd|i)\s*:\s*)*")

BUILTIN_RULES = [
    # "Prot. n. 0012345/2026 del ...", "Protocollo N.123", "n. prot. 456", "Prot. U.0012345", "Protocollo: AOO_X-2026-1"
    re.compile(r"(?<![a-z])(?:n(?:um(?:ero)?)?\.?\s*(?:di\s+)?)?prot(?:ocollo)?\b\.?\s*(?:gen(?:erale)?\b\.?\s*)?"
               r"(?:(?:n(?:um(?:ero)?)?|nr)\b\.?\s*|n\s*[°º]\s*|[:#°º]\s*)*"
               r"(?P<n>(?:[a-z]{1,10}[._/-]?){0,3}\d[\w./-]*)", re.I),
    re.compile(r"\b(?P<n>PG[/.-]\d{4}[/.-]\d+)", re.I),
    re.compile(r"registro\s+ufficiale\W*(?P<r>[uei])\W+(?P<n>\d+)", re.I),
    # numerazione annuale da 001 (anche oltre 999), spesso senza "Prot.": numero in testa all'oggetto
    re.compile(r"^\s*" + _PREFIX + r"(?:n\b\.?\s*|n\s*[°º]\s*)?"
               r"(?P<n>\d{3,}(?:\s*/\s*(?:19|20)\d{2})?)(?![\w/.,-]*\d)", re.I),
    # oppure numero con zeri davanti in qualunque punto: "... 001 ...", "... 0042/2026 ..."
    re.compile(r"(?<![\w/.,-])(?P<n>0\d{2,}(?:/(?:19|20)\d{2})?)(?![\w/.,-]*\d)"),
]

_YEAR_RE = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")
_lock = threading.Lock()
_rule_cache = {}


# --------------------------------------------------------------------------- regola personalizzata

def compile_rule(rule):
    """Regola personalizzata compilata (None se vuota). Solleva ValueError se non valida."""
    rule = (rule or "").strip()
    if not rule:
        return None
    if rule not in _rule_cache:
        if len(rule) > MAX_RULE_LEN:
            raise ValueError(f"PEC_PROTOCOL_REGEX: massimo {MAX_RULE_LEN} caratteri")
        try:
            rx = re.compile(rule, re.I)
        except re.error as e:
            raise ValueError(f"PEC_PROTOCOL_REGEX non valida: {e}")
        _rule_cache.clear()  # una sola regola in uso alla volta
        _rule_cache[rule] = rx
    return _rule_cache[rule]


def _value(m):
    """Il numero dentro una corrispondenza: gruppo "n", altrimenti il primo gruppo, altrimenti tutto."""
    groups = m.groupdict()
    if groups.get("n"):
        reg = groups.get("r")
        return (f"{reg.upper()}." if reg else "") + groups["n"]
    if m.re.groups and m.group(1):
        return m.group(1)
    return m.group(0)


def extract(subject, rule=""):
    """Numero di protocollo presente nell'oggetto (senza anno aggiunto), "" se non c'e'."""
    subject = subject or ""
    rules = BUILTIN_RULES
    try:
        custom = compile_rule(rule)
    except ValueError:
        custom = None  # regola rovinata a mano nel .env: si usano quelle predefinite
    if custom:
        rules = [custom, *BUILTIN_RULES]
    for rx in rules:
        m = rx.search(subject)
        if m:
            n = re.sub(r"\s*/\s*", "/", _value(m)).strip(" ./-_:")
            if n:
                return n
    return ""


def with_year(n, received=""):
    """Aggiunge l'anno di arrivo se il numero non lo contiene: 001 -> 001/2026."""
    year = str(received or "")[:4]
    if n and year.isdigit() and not _YEAR_RE.search(n):
        return f"{n}/{year}"
    return n


def for_mail(kind, subject, received="", rule=""):
    """Protocollo ricavato dall'oggetto, solo per le PEC."""
    if kind != "pec":
        return ""
    return with_year(extract(subject, rule), received)


# --------------------------------------------------------------------------- correzioni a mano

def load_overrides():
    try:
        data = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def set_override(key, number, user):
    """Protocollo scritto a mano per un'email (chiave del registro). Numero vuoto = torna a quello automatico."""
    key = str(key or "").strip()
    number = re.sub(r"\s+", " ", str(number or "")).strip()
    if not re.fullmatch(r"[0-9a-f]{6,40}", key):
        raise ValueError("Email non valida")
    if len(number) > 60 or re.search(r"[\x00-\x1f<>\"]", number):
        raise ValueError("Numero di protocollo non valido (massimo 60 caratteri)")
    with _lock:
        data = load_overrides()
        if number:
            data[key] = {"n": number, "user": user, "t": datetime.now().isoformat(timespec="seconds")}
        else:
            data.pop(key, None)
        tmp = OVERRIDES_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
        tmp.replace(OVERRIDES_PATH)
    return number


def resolve(kind, subject, received, key, rule="", overrides=None):
    """(protocollo, origine) con origine "manuale", "automatico" o "" se non c'e'."""
    if kind != "pec":
        return "", ""
    manual = (load_overrides() if overrides is None else overrides).get(key or "")
    if manual and manual.get("n"):
        return with_year(manual["n"], received), "manuale"
    n = for_mail(kind, subject, received, rule)
    return n, ("automatico" if n else "")


# --------------------------------------------------------------------------- controllo della numerazione

def split_number(n):
    """(progressivo, anno) da "001/2026", "0012345/2026", "AOO-2026-0000123"; (None, anno) se non numerico."""
    n = n or ""
    year = None
    m = re.search(r"[/.-]\s*((?:19|20)\d{2})\s*$", n) or _YEAR_RE.search(n)
    if m:
        year = int(m.group(1) if m.re.groups else m.group(0))
        n = (n[:m.start()] + n[m.end():]).strip(" ./-_")
    runs = re.findall(r"\d+", n)
    return (int(runs[-1]) if runs else None), year


def check(rows):
    """
    Numeri mancanti e doppi, per anno. rows: email del registro (una per email, gia' raggruppate) con
    protocollo, tipo_casella, esito, chiave, ricevuta, mittente, oggetto. Le ricevute PEC non contano:
    portano lo stesso numero della PEC a cui si riferiscono.
    """
    years = {}
    for r in rows:
        if r.get("tipo_casella") != "pec" or r.get("esito") == "ricevuta" or not r.get("protocollo"):
            continue
        seq, year = split_number(r["protocollo"])
        if seq is None:
            continue
        year = year or int((r.get("ricevuta") or r.get("data") or "0")[:4] or 0)
        y = years.setdefault(year, {})
        y.setdefault(seq, []).append({"chiave": r.get("chiave"), "protocollo": r["protocollo"],
                                      "mittente": r.get("mittente", ""), "oggetto": r.get("oggetto", ""),
                                      "ricevuta": r.get("ricevuta", ""), "esito": r.get("esito", "")})
    out = []
    for year in sorted(years, reverse=True):
        nums = years[year]
        top = max(nums)
        missing_all = [n for n in range(1, top + 1) if n not in nums]
        # numeri di altri enti (es. 0012345) non formano una sequenza: il controllo dei mancanti non ha senso
        sparse = top > 50 and len(missing_all) > len(nums) * 4
        dup = [{"numero": n, "email": v} for n, v in sorted(nums.items()) if len(v) > 1]
        out.append({"anno": year, "totale": sum(len(v) for v in nums.values()), "primo": min(nums), "ultimo": top,
                    "sequenza": not sparse, "mancanti": [] if sparse else missing_all[:MAX_MISSING],
                    "mancanti_totale": 0 if sparse else len(missing_all), "doppi": dup})
    return out


def register_rows(rows, year=None):
    """Righe del registro dei protocolli (PEC con numero), ordinate per anno e progressivo."""
    out = []
    for r in rows:
        if r.get("tipo_casella") != "pec" or not r.get("protocollo"):
            continue
        seq, y = split_number(r["protocollo"])
        y = y or int((r.get("ricevuta") or r.get("data") or "0")[:4] or 0)
        if year and y != year:
            continue
        out.append({**r, "anno": y, "progressivo": seq})
    return sorted(out, key=lambda r: (r["anno"], r["progressivo"] if r["progressivo"] is not None else 10 ** 12,
                                      r.get("ricevuta") or ""))
