# "><(((º> sabusabu <º)))><"
"""Riga di comando del motore della firma digitale, usata da tutti i programmi della suite (Node e Python)
con l'ambiente Python di `shared/firma/.venv` (le librerie di verifica stanno solo lì).

  python firma.py apri FILE [--nome NOME] [--estrai USCITA] [--senza-rete] [--senza-verifica] [--ancore CARTELLA]
      Apre una busta .p7m: scrive il documento contenuto in USCITA e stampa su stdout il rapporto in JSON
      (stessi campi di firma_digitale.apri, senza i byte; in più "file_estratto"). Un file non firmato dà
      {"firmato": false} e, con --estrai, viene copiato com'è.
  python firma.py aggiorna-elenchi [--fonte eu|it]
      Scarica di nuovo gli elenchi ufficiali degli enti fiduciari nella cache (lo fanno da soli i programmi
      quando la cache ha più di FIRMA_ELENCHI_ORE ore).
  python firma.py controlla FILE [--nome NOME]
      Esce con 0 se il file è una busta firmata, 1 altrimenti (senza librerie pesanti).

Uscita: 0 riuscito (anche se la firma risulta non valida: lo dice il rapporto), 2 busta illeggibile
({"errore": "..."} su stdout), 1 errore inatteso. Variabili: FIRMA_ELENCHI, FIRMA_ELENCHI_ORE, FIRMA_CACHE_DIR
(vedi elenchi_fiduciari.py), FIRMA_ANCORE_EXTRA = cartella di certificati di fiducia in più.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _ancore(cartella: str | None) -> list:
    cartella = cartella or os.environ.get("FIRMA_ANCORE_EXTRA")
    if not cartella:
        return []
    import elenchi_fiduciari
    return [elenchi_fiduciari.carica_certificato(p) for p in sorted(Path(cartella).iterdir())
            if p.suffix.lower() in (".cer", ".crt", ".pem", ".der")]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Firma digitale CAdES (.p7m) della suite Cosedil")
    sub = ap.add_subparsers(dest="comando", required=True)
    a = sub.add_parser("apri")
    a.add_argument("file")
    a.add_argument("--nome", help="nome originale del file (se il file su disco è temporaneo)")
    a.add_argument("--estrai", help="dove scrivere il documento contenuto")
    a.add_argument("--senza-rete", action="store_true")
    a.add_argument("--senza-verifica", action="store_true")
    a.add_argument("--ancore", help="cartella di certificati di fiducia in più")
    g = sub.add_parser("aggiorna-elenchi")
    g.add_argument("--fonte", choices=["eu", "it"])
    c = sub.add_parser("controlla")
    c.add_argument("file")
    c.add_argument("--nome")
    args = ap.parse_args(argv)

    if args.comando == "controlla":
        from busta import e_busta_firmata                               # riconoscimento leggero, senza asn1crypto
        return 0 if e_busta_firmata(Path(args.file).read_bytes(), args.nome or args.file) else 1

    if args.comando == "aggiorna-elenchi":
        import elenchi_fiduciari
        lock = Path(elenchi_fiduciari._cartella()) / "aggiornamento.lock"
        try:
            dati = elenchi_fiduciari.scarica(args.fonte)
            print(json.dumps({"aggiornato": dati["aggiornato"], "fonte": dati["fonte"], "elenchi": dati["elenchi"],
                              "servizi": len(dati["servizi"]), "errori": dati["errori"]}, ensure_ascii=False))
            return 0
        finally:
            lock.unlink(missing_ok=True)

    import firma_digitale
    dati = Path(args.file).read_bytes()
    try:
        esito = firma_digitale.apri(dati, args.nome or Path(args.file).name, verifica=not args.senza_verifica,
                                    rete=not args.senza_rete, ancore_extra=_ancore(args.ancore))
    except firma_digitale.FirmaErrore as e:
        print(json.dumps({"errore": str(e)}, ensure_ascii=False))
        return 2
    contenuto = esito.pop("contenuto")
    if args.estrai:
        Path(args.estrai).write_bytes(contenuto)
        esito["file_estratto"] = args.estrai
    esito["dimensione_contenuto"] = len(contenuto)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(esito, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
