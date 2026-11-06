# "><(((º> sabusabu <º)))><"
"""Messaggi d'errore per chi usa il Magazzino, separati dal dettaglio tecnico.

Perché esiste: scrivendo la guida (04/11/2026) nelle pagine Importazioni e nei pannelli della suite comparivano
testi da programmatore ("[WinError 10061] Impossibile stabilire la connessione…", "Expecting value: line 1
column 1", "forza=true"). Ora l'utente legge una frase che dice cosa fare; il testo originale va nel log
(magazzino.log) per chi deve indagare. Usato da importa_ddt.py, importa_mezzi.py e suite_rotte.py.
"""
import json


class ErroreParlante(ValueError):
    """Errore il cui testo è già scritto per l'utente (si mostra così com'è). Le classi di dominio
    (importa_ddt.ImportError_, foto.FotoError) ne derivano."""


def per_utente(e):
    """Una frase in italiano per l'utente, dato un errore qualsiasi di lettura di file o di importazione."""
    if isinstance(e, ErroreParlante):
        return str(e)
    if isinstance(e, FileNotFoundError):
        return "File non trovato: forse è stato spostato o cancellato. Verrà riletto al prossimo giro."
    if isinstance(e, PermissionError):
        return "File non accessibile: è aperto in un altro programma o mancano i permessi sulla cartella."
    if isinstance(e, OSError):
        return "File o cartella non leggibile in questo momento: riprova più tardi."
    if isinstance(e, json.JSONDecodeError):
        return "File non completo o non in formato JSON (forse è ancora in scrittura): verrà riletto al prossimo giro."
    if isinstance(e, UnicodeDecodeError):
        return "File con caratteri non leggibili: va salvato di nuovo dal programma che lo produce."
    return "Contenuto del file non riconosciuto: controlla che sia l'export giusto (dettagli nel log del Magazzino)."
