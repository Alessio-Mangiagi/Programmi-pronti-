# "><(((º> sabusabu <º)))><"
"""
Chiamata alla Messages API di Anthropic con risposta JSON garantita da uno schema (output_config.format).

Usata da ai_smistamento.py e moduli.py. Indirizzo fisso nel codice: la chiave non puo' essere mandata altrove.
Niente tool_choice forzato: sui modelli attuali (es. claude-opus-5-5) restituisce errore 400.
"""

import json
import logging

import requests

log = logging.getLogger("claude_json")

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
MODELLO_PREDEFINITO = "claude-opus-5-5"
# modelli che accettano il ripiego automatico su un altro modello se la richiesta viene rifiutata
_FALLBACK_OK = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AiError(Exception):
    pass


def chiedi_json(s, system, content, schema, max_tokens=16000, effort="medium", timeout=300):
    """
    content: testo oppure lista di blocchi (document, image, text). schema: JSON Schema dell'oggetto atteso
    (additionalProperties false). Restituisce (dict, usage).
    """
    if not s.get("ANTHROPIC_API_KEY"):
        raise AiError("Chiave API di Claude (ANTHROPIC_API_KEY) non impostata nelle Impostazioni")
    model = s.get("CLAUDE_MODEL") or MODELLO_PREDEFINITO
    headers = {"x-api-key": s["ANTHROPIC_API_KEY"], "anthropic-version": API_VERSION, "content-type": "application/json"}
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        "messages": [{"role": "user", "content": content}],
    }
    if model in _FALLBACK_OK:
        headers["anthropic-beta"] = _FALLBACK_BETA
        body["fallbacks"] = "default"
    try:
        r = requests.post(API_URL, timeout=timeout, headers=headers, json=body)
    except requests.RequestException as e:
        raise AiError(f"Claude non raggiungibile: {e}")
    if not r.ok:
        try:
            msg = r.json().get("error", {}).get("message", "")
        except ValueError:
            msg = r.text[:200]
        raise AiError(f"Claude ha risposto {r.status_code}: {msg}")
    risposta = r.json()
    stop = risposta.get("stop_reason")
    if stop == "refusal":
        raise AiError("Claude ha rifiutato la richiesta")
    if stop == "max_tokens":
        raise AiError("risposta di Claude troncata (troppo lunga)")
    testo = next((b.get("text", "") for b in risposta.get("content", []) if b.get("type") == "text"), "")
    try:
        dati = json.loads(testo)
    except ValueError:
        raise AiError("Claude non ha restituito dati leggibili")
    if not isinstance(dati, dict):
        raise AiError("Claude non ha restituito dati leggibili")
    usage = risposta.get("usage", {})
    log.info("Claude (%s): token in %s, out %s", risposta.get("model", model), usage.get("input_tokens"), usage.get("output_tokens"))
    return dati, usage
