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
  - email    : attiva se configurata da variabili d'ambiente (vedi config.py). Dal 06/11/2026 ogni
               scadenza va al suo referente (vedi destinatari()): ogni referente riceve UNA email con le sue
               scadenze nuove del giro; i destinatari fissi EMAIL_A ricevono il riepilogo completo (copia) o
               solo le scadenze senza referente (EMAIL_A_RICEVE=senza_referente). La stessa scadenza non
               parte due volte verso la stessa persona nello stesso giorno (notifiche_log.destinatario).
  - whatsapp : STUB disattivato. Per attivarlo si riusa il bot Node whatsapp-web.js già
               esistente nel progetto "auguri": quel bot espone l'invio
               messaggi via WhatsApp Web; basta avviarlo e fare una POST HTTP locale al suo
               endpoint di invio (numero + testo) dentro _invia_whatsapp(), oppure accodare
               i messaggi in un file/coda condivisa che il bot legge.
"""

import os
import re
import sys
from datetime import datetime

import config
import database
import scadenze

# Avvisi per gli admin del Portale (shared/avvisi, cartella sorella come shared/sso).
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shared", "avvisi"))
import avvisi  # noqa: E402

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

# Indirizzo email "ragionevole": basta a riconoscerlo dentro un testo libero e a scartare i refusi evidenti.
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")


def estrai_email(testo) -> list:
    """Le email contenute in un testo (minuscole, senza doppioni, nell'ordine in cui compaiono).
    Serve sia per i campi email (anche più indirizzi separati da virgola o punto e virgola) sia per il vecchio
    campo "referente", dove qualcuno ha già scritto un'email invece di un nome."""
    visti = []
    for e in EMAIL_RE.findall(testo or ""):
        e = e.lower()
        if e not in visti:
            visti.append(e)
    return visti


def destinatari(scadenza: dict) -> list:
    """Referenti con email di una scadenza, in ordine di precedenza (il primo campo che ne contiene vince):
      1. scadenze.referente_email (impostata sulla scadenza);
      2. un'email scritta nel campo testo "referente" (compatibilità con i dati già inseriti);
      3. tipi_scadenza.referente_email (referente predefinito del tipo, es. medico competente per le visite).
    Lista vuota = nessun referente: la scadenza va solo ai destinatari fissi EMAIL_A (ripiego)."""
    for campo in ("referente_email", "referente", "tipo_referente_email"):
        trovati = estrai_email(scadenza.get(campo))
        if trovati:
            return trovati
    return []


def email_attiva() -> bool:
    """Canale email configurato (credenziali solo da variabili d'ambiente, vedi config.py)."""
    return bool(config.EMAIL_ABILITATA and config.SMTP_HOST)


def _fissi() -> tuple:
    return tuple(e.lower() for e in config.EMAIL_A)


def piano_email(nuove) -> dict:
    """Chi riceve cosa: {destinatari (tupla): [(scadenza, messaggio), ...]}.

    Ogni referente è una chiave a sé (riceve una sola email con tutte le sue scadenze); i destinatari fissi
    EMAIL_A sono una chiave unica (una email a tutti loro, come prima). Un referente che è anche fra i fissi,
    con EMAIL_A_RICEVE=tutte, non riceve un'email in più: ha già il riepilogo completo."""
    fissi = _fissi()
    copia_completa = config.EMAIL_A_RICEVE == "tutte"
    piano = {}
    for scadenza, messaggio in nuove:
        referenti = destinatari(scadenza)
        for r in referenti:
            if copia_completa and r in fissi:
                continue
            piano.setdefault((r,), []).append((scadenza, messaggio))
        if fissi and (copia_completa or not referenti):
            piano.setdefault(fissi, []).append((scadenza, messaggio))
    return piano


def anteprima_destinatari(scadenza: dict) -> list:
    """A chi andrebbe l'email di questa scadenza al prossimo giro (per la pagina Impostazioni, senza inviare)."""
    piano = piano_email([(scadenza, "")])
    return [indirizzo for chiave in piano for indirizzo in chiave]


def _url_scadenzario() -> str | None:
    """Indirizzo pubblico dello Scadenzario per il link nelle email (shared/suite, se caricato da app.py)."""
    try:
        import suite_link
        return suite_link.url_pubblico("scadenzario")
    except Exception:  # noqa: BLE001 - modulo assente (uso da riga di comando): email senza link
        return None


def _componi(chiave: tuple, righe: list):
    """Testo dell'email: per un referente solo le sue scadenze, per i fissi il riepilogo col referente di ognuna."""
    from email.message import EmailMessage

    msg = EmailMessage()
    n = len(righe)
    msg["Subject"] = f"[Scadenzario Cosedil] {n} {'scadenza' if n == 1 else 'scadenze'} da verificare"
    msg["From"] = config.EMAIL_DA or config.SMTP_USER
    msg["To"] = ", ".join(chiave)
    if chiave == _fissi():
        testa = "Riepilogo scadenze dallo Scadenzario Cosedil:"
        elenco = []
        for scadenza, messaggio in righe:
            riga = "- " + messaggio
            chi = scadenza.get("referente") or ", ".join(destinatari(scadenza))
            if chi:
                riga += f" (referente: {chi})"
            elenco.append(riga)
    else:
        testa = ("Buongiorno,\nlo Scadenzario Cosedil ti indica come referente di queste scadenze, "
                 "che richiedono attenzione:")
        elenco = ["- " + messaggio for _, messaggio in righe]
    url = _url_scadenzario()
    piede = f"\n\nApri lo Scadenzario: {url}" if url else ""
    msg.set_content(testa + "\n\n" + "\n".join(elenco) + piede +
                    "\n\n-- \nEmail automatica dello Scadenzario Cosedil: per cambiare chi la riceve, modifica "
                    "il referente della scadenza o del tipo di scadenza.")
    return msg


def _invia_email(piano: dict) -> dict:
    """Invia un'email per ogni chiave del piano con una sola connessione SMTP (stdlib).

    Attivazione (nessuna credenziale nel codice): EMAIL_ABILITATA=1, SMTP_HOST, SMTP_PORT, SMTP_USER,
    SMTP_PASSWORD, EMAIL_DA, EMAIL_A. Ritorna {chiave: ('ok'|'errore'|'disabilitato', dettaglio)}: un
    indirizzo rifiutato non ferma gli altri, una connessione che non parte li segna tutti in errore."""
    if not email_attiva():
        return {chiave: ("disabilitato", "") for chiave in piano}
    import smtplib

    esiti = {}
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as server:
            if config.SMTP_STARTTLS:
                server.starttls()
            if config.SMTP_USER:
                server.login(config.SMTP_USER, config.SMTP_PASSWORD)
            for chiave, righe in piano.items():
                try:
                    server.send_message(_componi(chiave, righe))
                    esiti[chiave] = ("ok", "")
                except Exception as exc:  # noqa: BLE001 - destinatario rifiutato: gli altri partono
                    esiti[chiave] = ("errore", f"[invio a {', '.join(chiave)} fallito: {exc}]")
    except Exception as exc:  # rete/SMTP/auth: non deve mai far crashare il giro
        for chiave in piano:
            esiti.setdefault(chiave, ("errore", f"[invio email fallito: {exc}]"))
    return esiti


def _gia_inviate_oggi(conn, destinatario: str) -> set:
    """Scadenze già arrivate oggi a questo destinatario (email 'ok'): non si rimandano nello stesso giorno,
    nemmeno se qualcuno rilancia "Esegui notifiche ora"."""
    return {r[0] for r in conn.execute(
        "SELECT scadenza_id FROM notifiche_log WHERE canale = 'email' AND esito = 'ok' AND destinatario = ? "
        "AND date(inviata_il) = date('now','localtime')", (destinatario,))}


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
    Le notifiche nuove del giro partono per email secondo piano_email (una email per
    referente con le sue scadenze, il riepilogo ai destinatari fissi EMAIL_A), se il
    canale è configurato; 'whatsapp' resta uno stub.

    Ritorna: {"inviate": N, "email_inviate": E,
              "log": [ {scadenza_id, canale, messaggio, esito, contesto, destinatario}, ... ]}
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

        errori_email, email_inviate = [], 0
        if nuove:
            contesti = {s["id"]: c for s, _, c in nuove}
            coperte = set()        # scadenze con almeno un destinatario email in questo giro
            if email_attiva():
                piano = piano_email([(s, m) for s, m, _ in nuove])
                # niente doppioni nello stesso giorno verso la stessa persona
                for chiave in list(piano):
                    gia = _gia_inviate_oggi(conn, ", ".join(chiave))
                    piano[chiave] = [(s, m) for s, m in piano[chiave] if s["id"] not in gia]
                    if not piano[chiave]:
                        del piano[chiave]
                esiti = _invia_email(piano)
                for chiave, righe in piano.items():
                    esito, dettaglio = esiti[chiave]
                    dest = ", ".join(chiave)
                    if esito == "ok":
                        email_inviate += 1
                    elif dettaglio:
                        errori_email.append(dettaglio)
                    for scadenza, messaggio in righe:
                        coperte.add(scadenza["id"])
                        testo = f"{messaggio} → {dest}" + (f" {dettaglio}" if dettaglio else "")
                        _registra(conn, log, scadenza["id"], "email", testo, esito, contesti[scadenza["id"]], dest)
            for scadenza, messaggio, contesto in nuove:
                if scadenza["id"] not in coperte:
                    # email spenta, oppure nessun referente con email e nessun destinatario fisso
                    motivo = "" if not email_attiva() else " (nessun destinatario email)"
                    _registra(conn, log, scadenza["id"], "email", messaggio + motivo, "disabilitato", contesto)
                esito_wa, testo_wa = _invia_whatsapp(scadenza, messaggio)
                _registra(conn, log, scadenza["id"], "whatsapp", testo_wa, esito_wa, contesto)

        conn.execute(
            "INSERT OR REPLACE INTO meta (chiave, valore) "
            "VALUES ('ultimo_giro_notifiche', datetime('now','localtime'))")
        conn.commit()
        if nuove:
            _avvisa_portale(nuove, errori_email)
        return {"inviate": len(nuove), "email_inviate": email_inviate, "log": log}
    finally:
        conn.close()


def _registra(conn, log, scadenza_id, canale, testo, esito, contesto, destinatario=None):
    """Una riga del registro notifiche (anche nella risposta del giro, per la pagina)."""
    conn.execute(
        """INSERT INTO notifiche_log (scadenza_id, canale, messaggio, esito, contesto, destinatario)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (scadenza_id, canale, testo, esito, contesto, destinatario))
    log.append({"scadenza_id": scadenza_id, "canale": canale, "messaggio": testo, "esito": esito,
                "contesto": contesto, "destinatario": destinatario})


def _avvisa_portale(nuove, errori_email):
    """Le scadenze nuove del giro diventano un avviso nel Portale (pagina Avvisi
    dell'admin), come già finiscono nelle email. Un'email non partita è un avviso
    a parte: senza, nessuno saprebbe che un referente non è stato avvisato."""
    scadute = sum(1 for _, _, c in nuove if c == "scaduta")
    righe = [m for _, m, _ in nuove]
    testo = "\n".join(righe[:30]) + (f"\n… e altre {len(righe) - 30}" if len(righe) > 30 else "")
    avvisi.segnala("scadenzario",
                   f"{len(nuove)} {'scadenza' if len(nuove) == 1 else 'scadenze'} da verificare"
                   + (f" ({scadute} già scadut{'a' if scadute == 1 else 'e'})" if scadute else ""),
                   testo, livello="errore" if scadute else "attenzione", chiave="scadenze")
    if errori_email:
        avvisi.segnala("scadenzario", "Email delle scadenze non inviate", "\n".join(errori_email)[:1000],
                       livello="errore", chiave="email")


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
