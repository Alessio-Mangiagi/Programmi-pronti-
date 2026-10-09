# -*- coding: utf-8 -*-
"""
notifiche.py — Motore notifiche per Scadenzario Compliance Cosedil.

Funzioni (firme vincolate dalla SPEC):
  - scadenze_da_notificare() : scadenze arricchite con stato 'scaduta' o 'in_scadenza', non chiuse
  - esegui_notifiche()       : canale in_app → scrive su notifiche_log con esito 'ok';
                               email e whatsapp → stub disattivati, loggano esito 'disabilitato'
  - formatta_messaggio(scadenza) : testo notifica, es.
        "⚠ Visita medica idoneità di Mario Rossi scade il 01/07/2026 (18 giorni)"

Canali:
  - in_app   : sempre attivo (il log è mostrato nella vista Impostazioni della SPA).
  - email    : STUB disattivato. Per attivarlo: configurare un server SMTP aziendale
               (smtplib stdlib), aggiungere le costanti SMTP_HOST/SMTP_PORT/SMTP_USER/
               SMTP_PASSWORD in config.py e sostituire il corpo di _invia_email().
  - whatsapp : STUB disattivato. Per attivarlo si riusa il bot Node whatsapp-web.js già
               esistente nel progetto "whatss'app_web_Compleanni": quel bot espone l'invio
               messaggi via WhatsApp Web; basta avviarlo e fare una POST HTTP locale al suo
               endpoint di invio (numero + testo) dentro _invia_whatsapp(), oppure accodare
               i messaggi in un file/coda condivisa che il bot legge.
"""

import sqlite3
from datetime import date, datetime

import config
import database

# Nome soggetto per le scadenze aziendali (soggetto_tipo='azienda', soggetto_id NULL)
NOME_AZIENDA = "Cosedil S.p.A."


# ---------------------------------------------------------------------------
# Lettura scadenze arricchite
# ---------------------------------------------------------------------------

def _arricchisci_riga(riga, oggi):
    """Trasforma una riga SQL (scadenze + join) nel dict 'scadenza arricchita' della SPEC."""
    scadenza = dict(riga)

    # soggetto_nome e cantiere in base al tipo di soggetto
    tipo_soggetto = scadenza["soggetto_tipo"]
    if tipo_soggetto == "dipendente":
        nome = scadenza.pop("dip_nome", None)
        cognome = scadenza.pop("dip_cognome", None)
        scadenza["soggetto_nome"] = f"{nome} {cognome}".strip() if (nome or cognome) else None
        scadenza["cantiere"] = scadenza.pop("dip_cantiere", None)
    elif tipo_soggetto == "subappaltatore":
        scadenza["soggetto_nome"] = scadenza.pop("sub_ragione_sociale", None)
        scadenza["cantiere"] = None
    elif tipo_soggetto == "attrezzatura":
        descrizione = scadenza.pop("att_descrizione", None)
        matricola = scadenza.pop("att_matricola", None)
        if descrizione and matricola:
            scadenza["soggetto_nome"] = f"{descrizione} ({matricola})"
        else:
            scadenza["soggetto_nome"] = descrizione
        scadenza["cantiere"] = scadenza.pop("att_cantiere", None)
    elif tipo_soggetto == "sistema_ia":
        scadenza["soggetto_nome"] = scadenza.pop("si_nome", None)
        scadenza["cantiere"] = scadenza.pop("si_cantiere", None)
    else:  # azienda
        scadenza["soggetto_nome"] = NOME_AZIENDA
        scadenza["cantiere"] = None

    # Campi di join residui non previsti dal contratto
    for chiave in ("dip_nome", "dip_cognome", "dip_cantiere", "sub_ragione_sociale",
                   "att_descrizione", "att_matricola", "att_cantiere",
                   "si_nome", "si_cantiere"):
        scadenza.pop(chiave, None)

    # Stato calcolato server-side (mai salvato) — regole SPEC
    data_scadenza = datetime.strptime(scadenza["data_scadenza"], "%Y-%m-%d").date()
    giorni_rimanenti = (data_scadenza - oggi).days
    preavviso = scadenza.get("preavviso_giorni") or 0
    if scadenza["chiusa"]:
        stato = "chiusa"
    elif data_scadenza < oggi:
        stato = "scaduta"
    elif giorni_rimanenti <= preavviso:
        stato = "in_scadenza"
    else:
        stato = "valida"

    scadenza["stato"] = stato
    scadenza["giorni_rimanenti"] = giorni_rimanenti
    return scadenza


def scadenze_da_notificare() -> list:
    """Ritorna le scadenze arricchite con stato 'scaduta' o 'in_scadenza' (chiusa=0),
    ordinate per data_scadenza crescente."""
    con = database.get_db()
    con.row_factory = sqlite3.Row  # garantisce righe accessibili per nome colonna
    cur = con.cursor()
    righe = cur.execute(
        """SELECT s.id, s.tipo_id, t.nome AS tipo_nome, t.categoria,
                  s.soggetto_tipo, s.soggetto_id,
                  s.data_rilascio, s.data_scadenza, s.documento_rif, s.referente, s.note, s.chiusa,
                  t.preavviso_giorni,
                  d.nome AS dip_nome, d.cognome AS dip_cognome, d.cantiere AS dip_cantiere,
                  sub.ragione_sociale AS sub_ragione_sociale,
                  a.descrizione AS att_descrizione, a.matricola AS att_matricola,
                  a.cantiere AS att_cantiere,
                  si.nome AS si_nome, si.cantiere AS si_cantiere
           FROM scadenze s
           JOIN tipi_scadenza t ON t.id = s.tipo_id
           LEFT JOIN dipendenti d
                  ON s.soggetto_tipo = 'dipendente' AND d.id = s.soggetto_id
           LEFT JOIN subappaltatori sub
                  ON s.soggetto_tipo = 'subappaltatore' AND sub.id = s.soggetto_id
           LEFT JOIN attrezzature a
                  ON s.soggetto_tipo = 'attrezzatura' AND a.id = s.soggetto_id
           LEFT JOIN sistemi_ia si
                  ON s.soggetto_tipo = 'sistema_ia' AND si.id = s.soggetto_id
           WHERE s.chiusa = 0
           ORDER BY s.data_scadenza ASC"""
    ).fetchall()

    oggi = date.today()
    risultato = []
    for riga in righe:
        scadenza = _arricchisci_riga(riga, oggi)
        if scadenza["stato"] in ("scaduta", "in_scadenza"):
            risultato.append(scadenza)
    return risultato


# ---------------------------------------------------------------------------
# Formattazione messaggio
# ---------------------------------------------------------------------------

def formatta_messaggio(scadenza: dict) -> str:
    """Formatta il testo della notifica per una scadenza arricchita.

    Esempi:
      "⚠ Visita medica idoneità di Mario Rossi scade il 01/07/2026 (18 giorni)"
      "⚠ DURC di Edil Sud S.r.l. scaduta il 01/06/2026 (12 giorni fa)"
    """
    tipo_nome = scadenza.get("tipo_nome") or "Scadenza"
    soggetto = scadenza.get("soggetto_nome") or NOME_AZIENDA
    data_it = datetime.strptime(scadenza["data_scadenza"], "%Y-%m-%d").strftime("%d/%m/%Y")
    giorni = scadenza.get("giorni_rimanenti", 0)

    if giorni < 0:
        return f"⚠ {tipo_nome} di {soggetto} scaduta il {data_it} ({-giorni} giorni fa)"
    if giorni == 0:
        return f"⚠ {tipo_nome} di {soggetto} scade oggi ({data_it})"
    return f"⚠ {tipo_nome} di {soggetto} scade il {data_it} ({giorni} giorni)"


# ---------------------------------------------------------------------------
# Canali di invio
# ---------------------------------------------------------------------------

def _invia_email(scadenza, messaggio):
    """Invia la notifica via email (SMTP stdlib) se il canale è configurato.

    Attivazione (nessuna credenziale nel codice): impostare le variabili
    d'ambiente EMAIL_ABILITATA=1, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
    EMAIL_DA, EMAIL_A (destinatari separati da virgola). Vedi config.py.

    Ritorna ('ok', testo) se inviata, ('errore', dettaglio) se l'invio fallisce,
    ('disabilitato', testo) se il canale non è configurato.
    """
    if not config.EMAIL_ABILITATA or not config.SMTP_HOST or not config.EMAIL_A:
        return ("disabilitato", messaggio)
    try:
        import smtplib
        from email.message import EmailMessage

        msg = EmailMessage()
        soggetto = scadenza.get("soggetto_nome") or NOME_AZIENDA
        tipo_nome = scadenza.get("tipo_nome") or "Scadenza"
        msg["Subject"] = f"[Scadenzario Cosedil] {tipo_nome} — {soggetto}"
        msg["From"] = config.EMAIL_DA or config.SMTP_USER
        msg["To"] = ", ".join(config.EMAIL_A)
        corpo = messaggio
        if scadenza.get("referente"):
            corpo += f"\nReferente: {scadenza['referente']}"
        msg.set_content(corpo)

        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as server:
            if config.SMTP_STARTTLS:
                server.starttls()
            if config.SMTP_USER:
                server.login(config.SMTP_USER, config.SMTP_PASSWORD)
            server.send_message(msg)
        return ("ok", messaggio)
    except Exception as exc:  # rete/SMTP/auth: non deve mai far crashare il giro
        return ("errore", f"{messaggio} [invio email fallito: {exc}]")


def _invia_whatsapp(scadenza, messaggio):
    """STUB WhatsApp — canale disattivato.

    Per attivarlo si riusa il bot whatsapp-web.js già esistente nel progetto
    "whatss'app_web_Compleanni" (Node + WhatsApp Web):
      1. avviare il bot Node (sessione WhatsApp Web già autenticata);
      2. esporre/usare il suo endpoint HTTP locale di invio messaggi e da qui fare
         una POST con urllib.request (numero destinatario = scadenza['telefono'] del
         soggetto, testo = messaggio), oppure accodare {numero, testo} su un file JSON
         condiviso che il bot legge periodicamente;
      3. far restituire ('ok', messaggio) se l'invio riesce, ('errore', dettaglio) altrimenti.
    """
    return ("disabilitato", messaggio)


# ---------------------------------------------------------------------------
# Esecuzione notifiche
# ---------------------------------------------------------------------------

def _banda_preavviso(scadenza) -> tuple:
    """Determina la 'banda' di preavviso di una scadenza per l'escalation multi-step.

    Ritorna (contesto, per_giorno):
      - per le scadute: ('scaduta', True) → notifica ripetuta una volta al giorno;
      - per le imminenti: ('soglia_<T>', False) dove T è la soglia più stretta
        (la più piccola >= giorni_rimanenti) tra config.SOGLIE_PREAVVISO_GIORNI →
        notifica una sola volta per soglia (finché non si rinnova la scadenza);
      - (None, False) se la scadenza non è ancora entrata in nessuna soglia.
    """
    giorni = scadenza.get("giorni_rimanenti", 0)
    if giorni < 0:
        return ("scaduta", True)
    soglie_valide = [s for s in config.SOGLIE_PREAVVISO_GIORNI if s >= giorni]
    if not soglie_valide:
        return (None, False)
    return (f"soglia_{min(soglie_valide)}", False)


def esegui_notifiche() -> dict:
    """Esegue il giro di notifiche con preavviso multi-step (escalation).

    Per ogni scadenza scaduta o in scadenza si calcola la 'banda' di preavviso
    (vedi _banda_preavviso). La notifica in-app viene registrata:
      - una sola volta per ciascuna soglia attraversata (180/90/60/30/14/7/1/0 gg),
        così l'utente riceve avvisi ripetuti man mano che la scadenza si avvicina;
      - una volta al giorno finché la scadenza resta scaduta.
    Il canale 'email' è reale se configurato (vedi _invia_email), altrimenti logga
    'disabilitato'; 'whatsapp' resta uno stub disattivato.

    Ritorna: {"inviate": N, "log": [ {scadenza_id, canale, messaggio, esito, contesto}, ... ]}
    """
    con = database.get_db()
    cur = con.cursor()
    da_notificare = scadenze_da_notificare()
    log = []
    inviate = 0

    for scadenza in da_notificare:
        contesto, per_giorno = _banda_preavviso(scadenza)
        if contesto is None:
            continue

        # Dedup: per le soglie una volta sola (per scadenza+banda); per lo stato
        # 'scaduta' una volta al giorno.
        if per_giorno:
            gia_notificata = cur.execute(
                """SELECT 1 FROM notifiche_log
                   WHERE scadenza_id = ? AND canale = 'in_app' AND contesto = ?
                     AND date(inviata_il) = date('now','localtime') LIMIT 1""",
                (scadenza["id"], contesto)).fetchone()
        else:
            gia_notificata = cur.execute(
                """SELECT 1 FROM notifiche_log
                   WHERE scadenza_id = ? AND canale = 'in_app' AND contesto = ? LIMIT 1""",
                (scadenza["id"], contesto)).fetchone()
        if gia_notificata:
            continue

        messaggio = formatta_messaggio(scadenza)
        cur.execute(
            """INSERT INTO notifiche_log (scadenza_id, canale, messaggio, esito, contesto)
               VALUES (?, 'in_app', ?, 'ok', ?)""",
            (scadenza["id"], messaggio, contesto))
        inviate += 1
        log.append({"scadenza_id": scadenza["id"], "canale": "in_app",
                    "messaggio": messaggio, "esito": "ok", "contesto": contesto})

        # Canale email (reale se configurato) e whatsapp (stub disattivato)
        for canale, invia in (("email", _invia_email), ("whatsapp", _invia_whatsapp)):
            esito, testo = invia(scadenza, messaggio)
            cur.execute(
                """INSERT INTO notifiche_log (scadenza_id, canale, messaggio, esito, contesto)
                   VALUES (?, ?, ?, ?, ?)""",
                (scadenza["id"], canale, testo, esito, contesto))
            log.append({"scadenza_id": scadenza["id"], "canale": canale,
                        "messaggio": testo, "esito": esito, "contesto": contesto})

    con.commit()
    return {"inviate": inviate, "log": log}


if __name__ == "__main__":
    # Test manuale: python notifiche.py
    import json
    print(json.dumps(esegui_notifiche(), ensure_ascii=False, indent=2))
