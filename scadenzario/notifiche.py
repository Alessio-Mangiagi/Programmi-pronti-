# -*- coding: utf-8 -*-
"""
notifiche.py — Motore notifiche per Scadenzario Cosedil.

Funzioni (firme vincolate dalla SPEC):
  - scadenze_da_notificare() : scadenze arricchite con stato 'scaduta' o 'in_scadenza', non chiuse
  - esegui_notifiche()       : canale in_app → scrive su notifiche_log con esito 'ok';
                               email → un riepilogo per giro (se configurata); whatsapp → stub 'disabilitato'
  - formatta_messaggio(scadenza) : testo notifica, es.
        "⚠ Visita medica idoneità di Mario Rossi scade il 01/07/2026 (18 giorni)"

Canali:
  - in_app   : sempre attivo (il log è mostrato nella vista Impostazioni della SPA).
  - email    : attiva se configurata da variabili d'ambiente (vedi config.py):
               una sola email di riepilogo per ogni giro di notifiche.
  - whatsapp : STUB disattivato. Per attivarlo si riusa il bot Node whatsapp-web.js già
               esistente nel progetto "auguri": quel bot espone l'invio
               messaggi via WhatsApp Web; basta avviarlo e fare una POST HTTP locale al suo
               endpoint di invio (numero + testo) dentro _invia_whatsapp(), oppure accodare
               i messaggi in un file/coda condivisa che il bot legge.
"""

from datetime import datetime

import config
import database
import scadenze

# Nome soggetto per le scadenze aziendali (soggetto_tipo='azienda', soggetto_id NULL)
NOME_AZIENDA = scadenze.NOME_AZIENDA


# ---------------------------------------------------------------------------
# Lettura scadenze da notificare
# ---------------------------------------------------------------------------

# "><(((º> sabusabu <º)))><"
def _da_notificare(conn, oggi=None) -> list:
    """Scadenze aperte, scadute o in scadenza, di soggetti ancora attivi."""
    return [s for s in scadenze.carica(conn, "s.chiusa = 0", oggi=oggi)
            if s["stato"] in ("scaduta", "in_scadenza")
            and s.get("soggetto_attivo") != 0]


def scadenze_da_notificare() -> list:
    """Ritorna le scadenze arricchite con stato 'scaduta' o 'in_scadenza' (chiusa=0),
    ordinate per data_scadenza crescente. Esclusi i soggetti disattivati in anagrafica."""
    conn = database.get_db()
    try:
        return _da_notificare(conn)
    finally:
        conn.close()


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

def _invia_email_riepilogo(nuove):
    """Invia UNA email con tutte le notifiche nuove del giro (SMTP stdlib).

    Attivazione (nessuna credenziale nel codice): impostare le variabili
    d'ambiente EMAIL_ABILITATA=1, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
    EMAIL_DA, EMAIL_A (destinatari separati da virgola). Vedi config.py.

    nuove = lista di (scadenza, messaggio). Ritorna ('ok'|'errore'|'disabilitato', dettaglio).
    """
    if not config.EMAIL_ABILITATA or not config.SMTP_HOST or not config.EMAIL_A:
        return ("disabilitato", "")
    try:
        import smtplib
        from email.message import EmailMessage

        msg = EmailMessage()
        msg["Subject"] = (f"[Scadenzario Cosedil] {len(nuove)} "
                          f"{'scadenza' if len(nuove) == 1 else 'scadenze'} da verificare")
        msg["From"] = config.EMAIL_DA or config.SMTP_USER
        msg["To"] = ", ".join(config.EMAIL_A)
        righe = []
        for scadenza, messaggio in nuove:
            riga = "- " + messaggio
            if scadenza.get("referente"):
                riga += f" (referente: {scadenza['referente']})"
            righe.append(riga)
        msg.set_content("Riepilogo scadenze dallo Scadenzario Cosedil:\n\n" + "\n".join(righe))

        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as server:
            if config.SMTP_STARTTLS:
                server.starttls()
            if config.SMTP_USER:
                server.login(config.SMTP_USER, config.SMTP_PASSWORD)
            server.send_message(msg)
        return ("ok", "")
    except Exception as exc:  # rete/SMTP/auth: non deve mai far crashare il giro
        return ("errore", f"[invio email fallito: {exc}]")


def _invia_whatsapp(scadenza, messaggio):
    """STUB WhatsApp — canale disattivato.

    Per attivarlo si riusa il bot whatsapp-web.js già esistente nel progetto
    "auguri" (Node + WhatsApp Web):
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
    Le notifiche nuove del giro partono in UNA sola email di riepilogo (se il
    canale è configurato, vedi _invia_email_riepilogo); 'whatsapp' resta uno stub.

    Ritorna: {"inviate": N, "log": [ {scadenza_id, canale, messaggio, esito, contesto}, ... ]}
    """
    conn = database.get_db()
    try:
        log = []
        nuove = []   # (scadenza, messaggio, contesto)

        for scadenza in _da_notificare(conn):
            contesto, per_giorno = _banda_preavviso(scadenza)
            if contesto is None:
                continue

            # Dedup: per le soglie una volta sola (per scadenza+banda); per lo stato
            # 'scaduta' una volta al giorno.
            sql_dedup = ("SELECT 1 FROM notifiche_log WHERE scadenza_id = ? "
                         "AND canale = 'in_app' AND contesto = ?")
            if per_giorno:
                sql_dedup += " AND date(inviata_il) = date('now','localtime')"
            if conn.execute(sql_dedup + " LIMIT 1", (scadenza["id"], contesto)).fetchone():
                continue

            messaggio = formatta_messaggio(scadenza)
            conn.execute(
                """INSERT INTO notifiche_log (scadenza_id, canale, messaggio, esito, contesto)
                   VALUES (?, 'in_app', ?, 'ok', ?)""",
                (scadenza["id"], messaggio, contesto))
            log.append({"scadenza_id": scadenza["id"], "canale": "in_app",
                        "messaggio": messaggio, "esito": "ok", "contesto": contesto})
            nuove.append((scadenza, messaggio, contesto))

        if nuove:
            esito_email, dettaglio = _invia_email_riepilogo([(s, m) for s, m, _ in nuove])
            for scadenza, messaggio, contesto in nuove:
                esito_wa, testo_wa = _invia_whatsapp(scadenza, messaggio)
                for canale, esito, testo in (
                        ("email", esito_email, (messaggio + " " + dettaglio).strip()),
                        ("whatsapp", esito_wa, testo_wa)):
                    conn.execute(
                        """INSERT INTO notifiche_log (scadenza_id, canale, messaggio, esito, contesto)
                           VALUES (?, ?, ?, ?, ?)""",
                        (scadenza["id"], canale, testo, esito, contesto))
                    log.append({"scadenza_id": scadenza["id"], "canale": canale,
                                "messaggio": testo, "esito": esito, "contesto": contesto})

        conn.execute(
            "INSERT OR REPLACE INTO meta (chiave, valore) "
            "VALUES ('ultimo_giro_notifiche', datetime('now','localtime'))")
        conn.commit()
        return {"inviate": len(nuove), "log": log}
    finally:
        conn.close()


def ultimo_giro():
    """Timestamp dell'ultimo giro di notifiche (stringa) o None."""
    conn = database.get_db()
    try:
        riga = conn.execute(
            "SELECT valore FROM meta WHERE chiave = 'ultimo_giro_notifiche'").fetchone()
        return riga[0] if riga else None
    finally:
        conn.close()


if __name__ == "__main__":
    # Test manuale: python notifiche.py
    import json
    print(json.dumps(esegui_notifiche(), ensure_ascii=False, indent=2))
