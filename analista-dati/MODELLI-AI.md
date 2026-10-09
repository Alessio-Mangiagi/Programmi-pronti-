# Modelli AI consigliati — Analista Dati (96 GB VRAM)

> Nota: raccomandazioni basate su conoscenza a **gennaio 2026**. Verifica su
> [ollama.com/library](https://ollama.com/library) se sono usciti coder più recenti
> (localmente risultano già manifests `glm-5.1`, `qwen3.5`, `gemma4`).

## Default attuale

<!-- "><(((º> sabusabu <º)))><" -->

`OLLAMA_MODEL=gemma4:12b` — 11,9B denso, Q4_K_M (~7,4 GB), multimodale (ha il
projector vision), richiede **Ollama ≥ 0.30.5** (renderer/parser `gemma4` nativi,
quindi function-calling nel `/api/chat`). Gira ovunque, anche senza 96 GB di VRAM.

```bash
ollama pull gemma4:12b
```

Non è un coder specializzato: su schemi DB molto grandi/SQL complesso il combo
qui sotto resta superiore.

## Setup consigliato: COMBO due modelli residenti

Con 96 GB di VRAM conviene tenere **due modelli caricati insieme**
(`OLLAMA_MAX_LOADED_MODELS=2` come variabile d'ambiente di Ollama):

| Ruolo | Modello | VRAM | Perché |
|---|---|---|---|
| **Generazione SQL** (chat, analisi) | `qwen3-coder:30b` (MoE 30B, ~3B attivi) | ~18–33 GB (Q4–Q8) | Coder specializzato, rapidissimo (pochi parametri attivi), SQL eccellente |
| **Pianificazione report + commento risultati** | `gpt-oss:120b` (MoE 117B, ~5.1B attivi) | ~63 GB (mxfp4 nativo) | Ragionamento forte, veloce per la sua taglia |

Totale: **~85 GB** → entrambi residenti, latenza bassa dove serve velocità,
cervello dove serve ragionamento.

```bash
ollama pull qwen3-coder:30b
ollama pull gpt-oss:120b
```

`.env`:
```
OLLAMA_MODEL=qwen3-coder:30b        # modello base (SQL)
OLLAMA_MODEL_REASON=gpt-oss:120b    # pianificazione report + sintesi risposte
```

## Alternative

| Modello | VRAM | Ruolo | Note |
|---|---|---|---|
| `glm-4.5-air` (106B, A12B) / tuo `glm-5.1` | ~60–65 GB Q4 | alternativa agentica al 120b | forte in tool-use |
| `qwen3:32b` (denso) | ~35 GB Q8 | tuttofare singolo | se preferisci UN solo modello medio |
| `llama3.3:70b` | ~40–75 GB | tuttofare | più vecchio e più lento (denso), sconsigliato |
| `qwen3.5:9b` (attuale) | ~6 GB | — | troppo piccolo per SQL complesso su schemi reali |

## Cosa evitare

- **Qwen3 235B-A22B**: anche quantizzato Q3 sta al pelo in 96 GB, niente
  margine per KV-cache/contesto → scarta.
- Modelli **vision** (`llama3.2-vision`, `qwen2.5vl`, `minicpm-v`): non adatti a SQL.

## Serving

- **Ollama** basta con `LLM_CONCURRENCY=3` (coda già gestita dal semaforo dell'agente).
- Tanti utenti simultanei con richieste pesanti → **vLLM** (continuous batching),
  già supportato dall'agente via `LOCAL_LLM_BASE` (endpoint OpenAI-compatibile).
- Contesto: con 96 GB puoi permetterti 32–64k di contesto → schema DB grandi
  interi nel prompt (`OLLAMA_CONTEXT_LENGTH` o `num_ctx`).
