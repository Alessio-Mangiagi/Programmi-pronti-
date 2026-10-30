# "><(((º> sabusabu <º)))><"
"""
Dati di ESEMPIO in tutte le aree del programma (Documenti, Posta, Mezzi) e nel registro attivita', per mostrare
l'interfaccia piena senza Viewpoint, caselle email o DMS veri. Niente rete: scrive solo file locali.

    python strumenti_prova/crea_esempi.py             # crea gli esempi (se gia' presenti non li duplica)
    python strumenti_prova/crea_esempi.py --rimuovi   # toglie solo gli esempi, i dati veri restano

Cosa scrive (tutto riconoscibile dal marchio [ESEMPIO] o dall'utente "esempio"):
- Documenti: cartella esportata di prova strumenti_prova/esempi/esportazione (file finti + manifest.csv, da usare
  nella pagina Trasferimento con "Esegui prova") e righe nello Storico (report_trasferimento.csv);
- Posta: email nel registro (registro_posta.csv), nella cronologia del Flusso posta (stato_posta.json) e copia
  locale degli allegati (MAIL_ARCHIVE_DIR), con una casella Microsoft 365 e una PEC;
- Mezzi: cinque pratiche di mezzi a nolo (MODULI_ARCHIVIO/mezzi) con documenti e scheda, tre ditte in anagrafica,
  contratti compilati dai format veri (se MODELLI_SORGENTE e LibreOffice ci sono), una pratica gia' caricata in
  Viewpoint e archiviata nel DMS (solo segnata: nessuna chiamata a Viewpoint o al DMS);
- Attivita' utenti: qualche evento degli utenti esempio.* (registro a catena di impronte: con --rimuovi restano).

L'interfaccia rilegge i file a ogni richiesta: non serve riavviarla.
"""

import argparse
import csv
import hashlib
import json
import shutil
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import attivita  # noqa: E402
import env_config  # noqa: E402
import mezzi  # noqa: E402
import modelli_protetti  # noqa: E402
import moduli  # noqa: E402
import vfp_mail  # noqa: E402
import vfp_transfer as vt  # noqa: E402

MARCHIO = "[ESEMPIO]"
UTENTE = "esempio"
BASE = env_config.BASE_DIR
ESEMPI = BASE / "strumenti_prova" / "esempi"
ESPORTAZIONE = ESEMPI / "esportazione"
REPORT = BASE / "report_trasferimento.csv"
REGISTRO = BASE / "registro_posta.csv"
STATO_POSTA = BASE / "stato_posta.json"
ORA = datetime.now().replace(microsecond=0)
REPORT_COLONNE = ["data", "file", "cartella", "nome", "revisione", "esito", "id_documento", "messaggio"]


def chiave(nome):
    """Chiave stabile (come il digest delle email): la stessa a ogni esecuzione, cosi' --rimuovi la ritrova."""
    return hashlib.sha1(f"esempio:{nome}".encode()).hexdigest()[:10]


def guid(nome):
    return str(uuid.UUID(hashlib.md5(f"esempio:{nome}".encode()).hexdigest()))


def quando(giorni, ore=10, minuti=0):
    return (ORA - timedelta(days=giorni)).replace(hour=ore, minute=minuti, second=0)


def iso(d, spec="seconds"):
    return d.isoformat(timespec=spec)


def pdf(titolo, righe, piede=f"{MARCHIO} documento finto, generato da strumenti_prova/crea_esempi.py"):
    return moduli.scheda_pdf(titolo, righe, piede)


def file_finto(path, titolo, righe=()):
    """PDF vero (leggibile nel browser) per i .pdf; testo riconoscibile per gli altri formati."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".pdf":
        path.write_bytes(pdf(titolo, list(righe) or [("Documento", titolo)]))
    else:
        path.write_text(f"{MARCHIO} {titolo}\n" + "\n".join(f"{k}: {v}" for k, v in righe), encoding="utf-8")
    return path


def _leggi_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f, delimiter=";")
        return list(r.fieldnames or []), list(r)


def _scrivi_csv(path, colonne, righe):
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=colonne, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(righe)
    tmp.replace(path)


# --------------------------------------------------------------------------- Documenti

COMMESSA = "C-2024-015 Scuola Via Roma"
# (file nella cartella esportata, cartella VFP, nome, revisione, descrizione)
DOCUMENTI = [
    ("Architettonico/PL-001_rev0.pdf", "Architettonico/Piante", "PL-001 Pianta piano terra", "0", "Prima emissione"),
    ("Architettonico/PL-001_rev1.pdf", "Architettonico/Piante", "PL-001 Pianta piano terra", "1", "Aggiornamento quote"),
    ("Architettonico/PL-002_rev0.pdf", "Architettonico/Piante", "PL-002 Pianta primo piano", "0", "Prima emissione"),
    ("Architettonico/PR-001_rev0.pdf", "Architettonico/Prospetti", "PR-001 Prospetto nord", "0", "Prima emissione"),
    ("Strutture/ST-010_revA.dwg", "Strutture", "ST-010 Fondazioni", "A", "Emissione A"),
    ("Strutture/ST-010_revB.dwg", "Strutture", "ST-010 Fondazioni", "B", "Emissione B"),
    ("Strutture/Relazione di calcolo.pdf", "Strutture", "Relazione di calcolo", "1", "Relazione strutturale"),
    ("Impianti/EL-100 Schema quadro.pdf", "Impianti/Elettrico", "EL-100 Schema quadro generale", "0", ""),
    ("Impianti/ME-200 Schema termico.pdf", "Impianti/Meccanico", "ME-200 Schema impianto termico", "0", ""),
    ("Contratti/Computo metrico.xlsx", "Contratti", "Computo metrico", "2", "Definitivo"),
    ("Contratti/Contratto di appalto.pdf", "Contratti", "Contratto di appalto", "1", "Firmato"),
    ("Foto/Sopralluogo cantiere.jpg", "Foto cantiere", "Sopralluogo cantiere", "1", ""),
]
# righe dello Storico: (indice in DOCUMENTI, giorni fa, ora, esito, messaggio)
STORICO = [
    (0, 6, 9, "caricato", "documento creato in Viewpoint"),
    (1, 6, 9, "caricato", "nuova revisione del documento"),
    (2, 5, 11, "caricato", "documento creato in Viewpoint"),
    (3, 5, 11, "caricato", "documento creato in Viewpoint"),
    (4, 3, 15, "caricato", "documento creato in Viewpoint"),
    (5, 3, 15, "caricato", "nuova revisione del documento"),
    (6, 3, 15, "errore", "Viewpoint: 503 Service Unavailable (riprovare)"),
    (7, 1, 16, "caricato", "documento creato in Viewpoint"),
    (8, 1, 16, "saltato", "gia' presente in Viewpoint con la stessa revisione"),
    (9, 0, 8, "caricato", "documento creato in Viewpoint"),
    (10, 0, 8, "caricato", "documento creato in Viewpoint"),
    (11, 0, 9, "prova", "simulazione: nessuna scrittura in Viewpoint"),
    (6, 0, 9, "caricato", "documento creato in Viewpoint (secondo tentativo)"),
]


def crea_documenti():
    radice = ESPORTAZIONE / COMMESSA
    for rel, cartella, nome, rev, descr in DOCUMENTI:
        file_finto(radice / rel, nome, [("Commessa", COMMESSA), ("Cartella Viewpoint", cartella),
                                       ("Revisione", rev), ("Descrizione", descr or "-")])
    with open(radice / "manifest.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["file", "folder", "name", "revision", "description"])
        for rel, cartella, nome, rev, descr in DOCUMENTI:
            w.writerow([vt.csv_cell(v) for v in (rel.replace("/", "\\"), cartella, nome, rev, descr)])

    colonne, righe = _leggi_csv(REPORT) if REPORT.exists() else (REPORT_COLONNE, [])
    colonne = colonne or REPORT_COLONNE
    righe = [r for r in righe if not (r.get("messaggio") or "").startswith(MARCHIO)]
    for i, giorni, ore, esito, msg in STORICO:
        rel, cartella, nome, rev, _ = DOCUMENTI[i]
        doc_id = guid(f"{nome}|{rev}") if esito in ("caricato", "saltato") else ""
        righe.append({k: vt.csv_cell(v) for k, v in zip(REPORT_COLONNE, (
            iso(quando(giorni, ore, 5 + i)), str(radice / rel), cartella, nome, rev, esito, doc_id, f"{MARCHIO} {msg}"))})
    righe.sort(key=lambda r: r.get("data") or "")
    _scrivi_csv(REPORT, colonne, righe)
    return len(DOCUMENTI), len(STORICO)


def rimuovi_documenti():
    n = 0
    if REPORT.exists():
        colonne, righe = _leggi_csv(REPORT)
        tenute = [r for r in righe if not (r.get("messaggio") or "").startswith(MARCHIO)]
        n = len(righe) - len(tenute)
        if tenute:
            _scrivi_csv(REPORT, colonne, tenute)
        else:
            REPORT.unlink()
    return n


# --------------------------------------------------------------------------- Posta

CASELLE = {
    "graph": {"kind": "graph", "address": "esempio.documenti@cosedilspa.com",
              "key": "graph:esempio.documenti@cosedilspa.com", "label": "Microsoft 365 esempio.documenti@cosedilspa.com"},
    "pec": {"kind": "pec", "address": "esempio@pec.cosedilspa.com",
            "key": "pec:esempio@pec.cosedilspa.com@imaps.pec.aruba.it", "label": "PEC esempio@pec.cosedilspa.com"},
}


def _pec(tipo, n, destinatari=("esempio@pec.cosedilspa.com",), firma="valida"):
    return {"tipo": tipo, "identificativo": f"opec2101.{ORA:%Y%m%d}{n:06d}.{n:05d}.42.1.60@pec.aruba.it",
            "gestore": "Aruba PEC S.p.A.", "data": "", "msgid": "", "destinatari": list(destinatari), "consegna": "",
            "errore": "", "firma": firma, "firmatario": "Aruba PEC S.p.A." if firma else "", "firma_dettaglio": ""}


# ogni email: id, casella, mittente, oggetto, (giorni fa, ore, minuti), allegati, tentativi [(esito, dettaglio)], pec
EMAIL = [
    ("tavole", "graph", "Studio Tecnico Bianchi <studio@bianchi-ingegneria.it>",
     "Tavole architettoniche rev. 2 - Scuola Via Roma", (0, 8, 42), ["PL-001_rev2.pdf", "PL-002_rev2.pdf"],
     [("trasferita", "2 allegati caricati in Viewpoint")], {}),
    ("collaudo", "graph", "Impresa Verdi <ufficio@impresaverdi.it>",
     "Prot. 2026/0418 - Certificato di collaudo impianto elettrico", (0, 9, 15), ["Certificato collaudo.pdf"],
     [("trasferita", "1 allegato caricato in Viewpoint")], {}),
    ("newsletter", "graph", "Notizie Edilizia <noreply@newsletter-edilizia.it>", "Le novita' del mese", (1, 7, 30), [],
     [("ignorata", "nessun allegato ammesso")], {}),
    ("fattura", "graph", "Rossi Forniture <amministrazione@rossi-forniture.it>", "Fattura 2026/1187 e DDT 3312",
     (1, 16, 30), ["Fattura_1187.pdf", "DDT_3312.pdf"],
     [("riprovo", "Viewpoint non raggiungibile (timeout): nuovo tentativo al prossimo controllo"),
      ("trasferita", "2 allegati caricati in Viewpoint (tentativo 2)")], {}),
    ("spam", "graph", "sconosciuto@esempio-spam.net", "Documento urgente da aprire subito", (2, 3, 12), ["fattura.zip"],
     [("bloccata", "mittente non in MAIL_ALLOWED_SENDERS; archivio con eseguibile (.exe)")], {}),
    ("ods", "graph", "Direzione Lavori <dl@studio-dl.it>", "Ordine di servizio n. 12", (3, 10, 5), ["OdS_12.pdf"],
     [("errore", "Viewpoint: 403 - cartella di destinazione 'Posta in arrivo' non trovata o senza permessi")], {}),
    ("comune", "pec", "Comune di Catania <protocollo@pec.comune.catania.it>",
     "POSTA CERTIFICATA: Prot. n. 0045871/2026 - Richiesta integrazione documentale", (0, 11, 5),
     ["Richiesta_integrazione.pdf"], [("trasferita", "1 allegato caricato in Viewpoint")], _pec("posta-certificata", 1)),
    ("sal_acc", "pec", "posta-certificata@pec.aruba.it", "ACCETTAZIONE: Prot. 2026/0512 - Trasmissione SAL n. 3",
     (1, 12, 0), [], [("ricevuta", "ricevuta PEC di accettazione")],
     _pec("accettazione", 2, ("protocollo@pec.comune.catania.it",))),
    ("sal_cons", "pec", "posta-certificata@pec.aruba.it", "AVVENUTA CONSEGNA: Prot. 2026/0512 - Trasmissione SAL n. 3",
     (1, 12, 4), [], [("ricevuta", "ricevuta PEC di avvenuta consegna")],
     _pec("avvenuta-consegna", 3, ("protocollo@pec.comune.catania.it",))),
    ("sismica", "pec", "Genio Civile di Catania <geniocivile.ct@pec.regione.sicilia.it>",
     "POSTA CERTIFICATA: Autorizzazione sismica pratica n. 778/2026", (4, 9, 40), ["Autorizzazione_778.pdf"],
     [("trasferita", "1 allegato caricato in Viewpoint")], _pec("posta-certificata", 4)),
    ("firma", "pec", "mittente@pec.esempio-sconosciuto.it", "POSTA CERTIFICATA: Comunicazione", (5, 14, 20),
     ["Comunicazione.pdf"], [("bloccata", "firma della busta PEC non valida")],
     _pec("posta-certificata", 5, firma="non valida")),
]


def _chiavi_email():
    return {chiave(e[0]) for e in EMAIL}


def _docs(nome_id, ricevuta, allegati):
    prefisso = f"{ricevuta:%Y-%m-%d %H%M} "
    return [{"name": prefisso + Path(a).stem, "status": "caricato", "doc_id": guid(f"{nome_id}|{a}")} for a in allegati]


def crea_posta(s):
    archivio = vfp_mail.archive_dir(s)
    righe, cronologia = [], []
    for nome_id, cas, mittente, oggetto, (giorni, ore, minuti), allegati, tentativi, pec in EMAIL:
        mbx, key = CASELLE[cas], chiave(nome_id)
        ricevuta = quando(giorni, ore, minuti)
        msg_id = f"<esempio.{nome_id}@{mbx['address'].split('@')[-1]}>"
        if allegati and any(t[0] in ("trasferita", "riprovo", "errore") for t in tentativi):
            cartella = archivio / f"{ricevuta:%Y%m%d_%H%M%S}_{key}"
            for a in allegati:
                file_finto(cartella / a, Path(a).stem, [("Email da", mittente), ("Oggetto", oggetto),
                                                       ("Ricevuta", f"{ricevuta:%d/%m/%Y %H:%M}")])
        for n, (esito, dettaglio) in enumerate(tentativi):
            elaborata = ricevuta + timedelta(minutes=2 + 3 * n)
            docs = _docs(nome_id, ricevuta, allegati) if esito == "trasferita" else []
            dettaglio = f"{MARCHIO} {dettaglio}"
            righe.append({
                "data": iso(elaborata), "casella": mbx["label"], "tipo_casella": mbx["kind"],
                "indirizzo_casella": mbx["address"], "mittente": mittente, "oggetto": oggetto,
                "ricevuta": iso(ricevuta, "minutes"), "allegati": " | ".join(allegati), "esito": esito,
                "dettaglio": dettaglio, "chiave": key, "message_id": msg_id, "chiave_casella": mbx["key"],
                "documenti": " | ".join(f"{d['name']}={d['doc_id']}" for d in docs),
                "pec_tipo": pec.get("tipo", ""), "pec_id": pec.get("identificativo", ""),
                "pec_gestore": pec.get("gestore", ""), "pec_firma": pec.get("firma", ""),
                "pec_destinatari": ", ".join(pec.get("destinatari") or []),
            })
            cronologia.append({
                "time": iso(elaborata), "key": key, "kind": mbx["kind"], "source": mbx["label"], "mbx": mbx["key"],
                "msg_id": msg_id, "sender": mittente, "subject": oggetto, "received": iso(ricevuta, "minutes"),
                "files": list(allegati), "outcome": esito, "detail": dettaglio, "docs": docs, "pec": pec,
            })

    colonne, esistenti = _leggi_csv(REGISTRO) if REGISTRO.exists() else (vfp_mail.MAIL_LOG_FIELDS, [])
    colonne = list(colonne or vfp_mail.MAIL_LOG_FIELDS)
    for c in vfp_mail.MAIL_LOG_FIELDS:
        if c not in colonne:
            colonne.append(c)
    chiavi = _chiavi_email()
    esistenti = [r for r in esistenti if r.get("chiave") not in chiavi]
    esistenti.extend({k: vt.csv_cell(v) for k, v in r.items()} for r in righe)
    esistenti.sort(key=lambda r: r.get("data") or "")
    _scrivi_csv(REGISTRO, colonne, esistenti)

    st = _stato_posta()
    st["history"] = [h for h in st["history"] if h.get("key") not in chiavi] + cronologia
    st["history"].sort(key=lambda h: h.get("time") or "")
    _salva_stato_posta(st)
    return len(EMAIL), len(righe)


def _stato_posta():
    try:
        st = json.loads(STATO_POSTA.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        st = {}
    for k, v in (("ignored", {}), ("attempts", {}), ("history", [])):
        st.setdefault(k, v)
    return st


def _salva_stato_posta(st):
    tmp = STATO_POSTA.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATO_POSTA)


def rimuovi_posta(s):
    chiavi, n = _chiavi_email(), 0
    if REGISTRO.exists():
        colonne, righe = _leggi_csv(REGISTRO)
        tenute = [r for r in righe if r.get("chiave") not in chiavi]
        n = len(righe) - len(tenute)
        if tenute:
            _scrivi_csv(REGISTRO, colonne, tenute)
        else:
            REGISTRO.unlink()
    if STATO_POSTA.exists():
        st = _stato_posta()
        st["history"] = [h for h in st["history"] if h.get("key") not in chiavi]
        _salva_stato_posta(st)
    archivio = vfp_mail.archive_dir(s)
    if archivio.is_dir():
        for k in chiavi:
            for d in archivio.glob(f"*_{k}"):
                shutil.rmtree(d, ignore_errors=True)
    return n


# --------------------------------------------------------------------------- Mezzi

def piva_valida(radice):
    """Partita IVA finta ma con cifra di controllo giusta (normalizza la rifiuta altrimenti)."""
    for c in "0123456789":
        if moduli._piva_ok(radice + c):
            return radice + c
    raise RuntimeError("nessuna cifra di controllo valida")


def iban_valido(bban):
    """IBAN italiano finto con le cifre di controllo giuste (mod 97): normalizza rifiuta gli altri."""
    numeri = "".join(str(ord(c) - 55) if c.isalpha() else c for c in bban + "IT00")
    return f"IT{98 - int(numeri) % 97:02d}{bban}"


DITTE = {
    "edilnolo": {
        "ragione_sociale": "Edil Nolo Esempio S.r.l.", "piva": piva_valida("0987654321"),
        "sede": "Catania (CT), via Etnea n. 120", "rappresentante": "legale rappresentante Sig. Giuseppe Esempio",
        "nascita_rappresentante": "Catania il 12/05/1970", "pec": "edilnolo@pec.esempio.it",
        "white_list_dal": "15/03/2024", "white_list_prefettura": "Catania", "patente_crediti": "PC-2025-000123",
        "banca": "Banca di Credito Cooperativo di Esempio", "iban_dedicato": "IT60X0542811101000000123456",
        "delegati": "Giuseppe Esempio, nato a Catania il 12/05/1970, CF SMPGPP70E12C351X",
    },
    "siciliamacchine": {
        "ragione_sociale": "Sicilia Macchine Esempio S.p.A.", "piva": piva_valida("0123456789"),
        "sede": "Misterbianco (CT), zona industriale, VIII strada n. 7",
        "rappresentante": "amministratore unico Dott.ssa Anna Esempio", "nascita_rappresentante": "Acireale il 03/11/1978",
        "pec": "siciliamacchine@pec.esempio.it", "white_list_dal": "02/10/2023", "white_list_prefettura": "Catania",
        "patente_crediti": "PC-2025-000456", "banca": "Banca Esempio S.p.A.",
        "iban_dedicato": "IT42L1234512345123456789012",
        "delegati": "Anna Esempio, nata ad Acireale il 03/11/1978, CF SMPNNA78S43A028Y\n"
                    "Luca Esempio, nato a Catania il 21/02/1985, CF SMPLCU85B21C351Z",
    },
    "noleggietna": {
        "ragione_sociale": "Noleggi Etna Esempio S.r.l.", "piva": piva_valida("0555566667"),
        "sede": "Giarre (CT), via Callipoli n. 88", "rappresentante": "legale rappresentante Sig. Salvatore Esempio",
        "nascita_rappresentante": "Giarre il 30/08/1965", "pec": "noleggietna@pec.esempio.it",
        "white_list_dal": "20/06/2025", "white_list_prefettura": "Catania", "patente_crediti": "PC-2025-000789",
        "banca": "Credito Siciliano Esempio", "iban_dedicato": iban_valido("A0300203280123456789012"),
        "delegati": "Salvatore Esempio, nato a Giarre il 30/08/1965, CF SMPSVT65M30E017W",
    },
}
UTILIZZATRICE = {"utilizzatrice": "COSEDIL S.p.A.", "utilizzatrice_sede": "Roma (RM)",
                 "utilizzatrice_indirizzo": "Piazza della Marina n. 1", "utilizzatrice_piva": "00512340878",
                 "firmatario_utilizzatrice": "Procuratore Speciale Geom. Mario Esempio"}
# (ditta, dati del contratto e del mezzo, documenti [(tipo, titolo, scadenza in giorni da oggi o None)],
#  stato: contratto = compilato dal format vero della commessa; invio = gia' caricato in Viewpoint; dms = archiviato)
MEZZI = [
    ("edilnolo", {
        "tipo_nolo": "a freddo", "commessa": "101-003 SEDE ACIREALE", "codice_contratto": "2026_101-003 SEDE ACIREALE_004",
        "cup": "J31B20000000005", "cig": "A0123456789", "data_contratto": quando(12).date().isoformat(),
        "luogo_firma": "Santa Venerina", "data_inizio": quando(7).date().isoformat(),
        "data_fine": quando(-53).date().isoformat(), "pagamento": "30 gg. D.F.F.M.",
        "tipo_mezzo": "Escavatore cingolato", "marca": "Caterpillar", "modello": "320 GC", "matricola": "ESEMP0320GC00001",
        "anno": "2021", "attrezzature": "attacco rapido CR50, benna scavo 1200 mm, martello demolitore",
        "compenso": "MISURA", "um": "gg", "prezzo_unitario": "380,00", "quantita": "40", "oneri_sicurezza": "300,00",
        "oggetto_appalto": "Lavori di realizzazione della nuova sede di Acireale", "committente": "Comune di Acireale",
        "data_appalto": "10/01/2026", "oneri_proprietaria": "manutenzione ordinaria e straordinaria del mezzo",
        "oneri_utilizzatrice": "deposito entro l'area di cantiere; carburante; operatore del mezzo",
    }, [("assicurazione", "Polizza assicurativa RCT n. 4471/2026", 240), ("ce", "Dichiarazione CE di conformita'", None),
        ("manuale", "Manuale d'uso e manutenzione", None), ("verifiche", "Verbale verifica periodica", 120)],
     {"contratto": True, "invio": True, "dms": True}),
    ("siciliamacchine", {
        "tipo_nolo": "a caldo", "commessa": "101-003 SEDE ACIREALE", "codice_contratto": "2026_101-003 SEDE ACIREALE_007",
        "cup": "J31B20000000005", "cig": "A0123456789", "data_contratto": quando(5).date().isoformat(),
        "luogo_firma": "Santa Venerina", "data_inizio": quando(2).date().isoformat(),
        "data_fine": quando(-28).date().isoformat(), "pagamento": "60 gg. D.F.F.M.",
        "tipo_mezzo": "Autogru", "marca": "Liebherr", "modello": "LTM 1050-3.1", "matricola": "ESEMPLTM105000002",
        "targa": "FX123ES", "anno": "2019", "attrezzature": "jib 16 m, zavorra 12 t",
        "compenso": "MISURA", "um": "ore", "prezzo_unitario": "95,00", "quantita": "160", "oneri_sicurezza": "450,00",
        "oggetto_appalto": "Lavori di realizzazione della nuova sede di Acireale", "committente": "Comune di Acireale",
        "data_appalto": "10/01/2026", "cuc": "CUC-2026-000456",
        "oneri_proprietaria": "operatore abilitato, manutenzione e verifiche periodiche",
        "oneri_utilizzatrice": "area di stazionamento e piano di sollevamento",
    }, [("assicurazione", "Polizza assicurativa RCT n. 9920/2026", 300), ("libretto", "Carta di circolazione", None),
        ("ce", "Dichiarazione CE di conformita'", None), ("manuale", "Manuale d'uso e manutenzione", None),
        ("verifiche", "Verbale verifica periodica", 45), ("manutenzione", "Registro di controllo e manutenzione", None)],
     {"contratto": True}),
    ("noleggietna", {
        "tipo_nolo": "a freddo", "commessa": "101-006 RESIDENZE ACIREALE", "codice_contratto": "2026_101-006 RESIDENZE ACIREALE_011",
        "cup": "J31B20000000006", "cig": "A0987654321", "data_contratto": quando(20).date().isoformat(),
        "luogo_firma": "Santa Venerina", "data_inizio": quando(15).date().isoformat(),
        "data_fine": quando(-75).date().isoformat(), "pagamento": "30 gg. D.F.F.M.",
        "tipo_mezzo": "Pala gommata", "marca": "Volvo", "modello": "L90H", "matricola": "ESEMPL90H00004", "targa": "FY456ES",
        "anno": "2020", "attrezzature": "benna 3 mc, forche pallet",
        "compenso": "MISURA", "um": "settimane", "prezzo_unitario": "1.450,00", "quantita": "12", "oneri_sicurezza": "250,00",
        "oggetto_appalto": "Realizzazione di residenze ad Acireale", "committente": "Residenze Acireale S.r.l.",
        "data_appalto": "20/02/2026", "oneri_proprietaria": "manutenzione ordinaria e straordinaria del mezzo",
        "oneri_utilizzatrice": "carburante e operatore",
    }, [("assicurazione", "Polizza assicurativa RCT n. 1180/2026", 180), ("libretto", "Carta di circolazione", None),
        ("ce", "Dichiarazione CE di conformita'", None), ("manuale", "Manuale d'uso e manutenzione", None)],
     {"invio": True}),
    ("noleggietna", {
        "tipo_nolo": "a caldo", "commessa": "101-003 SEDE ACIREALE", "codice_contratto": "2026_101-003 SEDE ACIREALE_006",
        "cup": "J31B20000000005", "cig": "A0123456789", "data_contratto": quando(3).date().isoformat(),
        "luogo_firma": "Santa Venerina", "data_inizio": quando(1).date().isoformat(),
        "data_fine": quando(-14).date().isoformat(), "pagamento": "30 gg. D.F.F.M.",
        "tipo_mezzo": "Piattaforma aerea", "marca": "Haulotte", "modello": "HA20 RTJ PRO", "matricola": "ESEMPHA2000005",
        "anno": "2022", "attrezzature": "cestello 230 kg, 4x4",
        "compenso": "MISURA", "um": "gg", "prezzo_unitario": "260,00", "quantita": "10",
        "oggetto_appalto": "Lavori di realizzazione della nuova sede di Acireale", "committente": "Comune di Acireale",
        "data_appalto": "10/01/2026", "cuc": "CUC-2026-000123",
        "oneri_proprietaria": "operatore abilitato PLE, manutenzione e verifiche periodiche",
    }, [("assicurazione", "Polizza assicurativa RCT n. 2231/2026", 90), ("ce", "Dichiarazione CE di conformita'", None),
        ("manuale", "Manuale d'uso e manutenzione", None), ("verifiche", "Verbale verifica periodica", 30)],
     {}),
    ("edilnolo", {
        "tipo_nolo": "a freddo", "commessa": "101-003 SEDE ACIREALE", "codice_contratto": "2026_101-003 SEDE ACIREALE_005",
        "data_contratto": quando(1).date().isoformat(), "luogo_firma": "Santa Venerina",
        "data_inizio": quando(0).date().isoformat(), "data_fine": quando(-30).date().isoformat(),
        "pagamento": "30 gg. D.F.F.M.", "tipo_mezzo": "Miniescavatore", "marca": "Kubota", "modello": "U27-4",
        "matricola": "ESEMPU27400003", "anno": "2023", "compenso": "MISURA", "um": "gg", "prezzo_unitario": "120,00",
        "quantita": "30", "oggetto_appalto": "Lavori di realizzazione della nuova sede di Acireale",
        "committente": "Comune di Acireale", "data_appalto": "10/01/2026",
    }, [("ce", "Dichiarazione CE di conformita'", None)], {}),  # senza polizza e manuale: la pagina li segnala mancanti
]


def _matricole():
    return {m[1]["matricola"] for m in MEZZI}


def _modello_contratto(s, dati):
    """Format "nolo a freddo/caldo" della commessa del mezzo nella cartella condivisa (vuoto se non c'e')."""
    try:
        modelli = [m["rel"] for m in modelli_protetti.elenco_modelli(s) if m["gestito"]]
    except modelli_protetti.ModelloError:
        return ""
    codice, tipo = dati["commessa"].split(" ")[0], f"nolo {dati['tipo_nolo']}"
    buoni = [m for m in modelli if tipo in m.lower() and codice in m]
    return sorted(buoni)[0] if buoni else ""


def _compila_contratto(s, maschera, pr, rec):
    """Contratto compilato dal format vero, con i testi proposti dai dati (come il pulsante nella pagina Mezzi)."""
    modello = _modello_contratto(s, rec["valori"])
    if not modello:
        return "format della commessa non trovato in MODELLI_SORGENTE: contratto non compilato"
    try:
        anteprima = mezzi.anteprima_contratto(s, maschera, rec, modello)
        testi = {a["id"]: a["nuovo"] for a in anteprima["aree"] if a.get("regola")}
        mezzi.compila_contratto(s, pr, rec["id"], modello, testi, UTENTE)
    except (mezzi.MezziError, modelli_protetti.ModelloError, OSError) as e:
        return f"contratto non compilato ({e})"
    return f"contratto compilato da {Path(modello).name} ({len(testi)} aree)"


def _segna_invio_e_dms(maschera, pr, rec_id, stato):
    """Pratica gia' caricata in Viewpoint / archiviata nel DMS: solo i segni nel record, nessuna chiamata esterna."""
    rec = pr.leggi(rec_id)
    righe = mezzi.righe_dms(maschera, rec, pr._dir(rec_id))  # scrive anche la scheda PDF
    if stato.get("invio"):
        pr.segna_invio(rec_id, len(righe))
    if stato.get("dms"):
        esiti = [{"nome": r["name"], "cartella": r["folder"], "file": Path(r["file"]).name,
                  "esito": "nuova versione" if "Scheda" in r["name"] else "creato", "id": 9000 + i}
                 for i, r in enumerate(righe, 1)]
        pr.segna_dms(rec_id, {"data": iso(ORA - timedelta(hours=3)), "esiti": esiti})


def crea_mezzi(s):
    maschera, pr = mezzi.carica_maschera(s), mezzi.pratiche(s)
    presenti = {p["matricola"] for p in pr.elenco()}
    creati = []
    for ditta, dati, documenti, stato in MEZZI:
        if dati["matricola"] in presenti:
            continue
        grezzi = {**UTILIZZATRICE, **DITTE[ditta], **dati}
        if not moduli._piva_ok(grezzi["utilizzatrice_piva"]):
            grezzi.pop("utilizzatrice_piva")
        docs = []
        for tipo, titolo, giorni in documenti:
            path = file_finto(ESEMPI / "mezzi" / f"{dati['matricola']}_{tipo}.pdf", titolo,
                              [("Mezzo", f"{dati['tipo_mezzo']} {dati['marca']} {dati['modello']}"),
                               ("Matricola", dati["matricola"]), ("Proprietaria", DITTE[ditta]["ragione_sociale"])])
            docs.append({"tipo": tipo, "percorso": str(path),
                         "scadenza": quando(-giorni).date().isoformat() if giorni else "", "note": f"{MARCHIO} documento finto"})
        rec = pr.salva(maschera, "", grezzi, docs, utente=UTENTE)
        mezzi.scheda_pdf(maschera, rec, pr._dir(rec["id"]) / "scheda_mezzo.pdf")
        note = []
        if stato.get("contratto"):
            note.append(_compila_contratto(s, maschera, pr, rec))
        if stato.get("invio") or stato.get("dms"):
            _segna_invio_e_dms(maschera, pr, rec["id"], stato)
            segni = [n for n, k in (("caricata in Viewpoint", "invio"), ("archiviata nel DMS", "dms")) if stato.get(k)]
            note.append("segnata come " + " e ".join(segni))
        print(f"  - {dati['tipo_mezzo']} {dati['marca']} {dati['modello']}: pratica {rec['id']}"
              + (" - " + "; ".join(note) if note else ""))
        creati.append(rec["id"])
    return creati


def rimuovi_mezzi(s):
    pr = mezzi.pratiche(s)
    n = 0
    try:  # contratti compilati dagli esempi (MODELLI_LAVORO/<id>/)
        lavoro = modelli_protetti.pratiche(s)
        for p in lavoro.elenco(limite=100000):
            if p.get("utente") == UTENTE:
                shutil.rmtree(lavoro._dir(p["id"]), ignore_errors=True)
    except modelli_protetti.ModelloError:
        pass
    for p in pr.elenco(limite=100000):
        if p["utente"] == UTENTE or p["matricola"] in _matricole():
            shutil.rmtree(pr._dir(p["id"]), ignore_errors=True)
            n += 1
    for ditta in DITTE.values():
        f = pr.anagrafica.base / f"{ditta['piva']}.json"
        if f.is_file():
            try:
                scheda = json.loads(f.read_text(encoding="utf-8"))
            except ValueError:
                continue
            if all(x.get("utente") == UTENTE for x in scheda.get("storico", [])):
                f.unlink()
    shutil.rmtree(ESEMPI, ignore_errors=True)
    return n


# --------------------------------------------------------------------------- Attivita' utenti

EVENTI = [
    ("esempio.documenti", "utente", "accesso", "Accesso", "", "ok"),
    ("esempio.documenti", "utente", "report", "Report richiesto via email", "esempio.documenti@cosedilspa.com", "ok"),
    ("esempio.documenti", "utente", "confronto", "Confronto avviato", "Computo metrico rev1.pdf / Computo metrico rev2.pdf", "ok"),
    ("esempio.posta", "utente", "accesso", "Accesso", "", "ok"),
    ("esempio.posta", "utente", "sicurezza", "Richiesta rifiutata: area non consentita", "GET /api/report", "negato"),
    ("esempio.mezzi", "utente", "accesso", "Accesso", "", "ok"),
    ("esempio.mezzi", "utente", "modifica", "Pratica mezzo salvata", "Escavatore cingolato Caterpillar 320 GC", "ok"),
    ("esempio.sconosciuto", "", "accesso", "Accesso non riuscito", "Nome utente o password non corretti", "fallito"),
]


def crea_attivita():
    if attivita.query(user="esempio.documenti")[0]:
        return 0
    for utente, ruolo, categoria, azione, dettaglio, esito in EVENTI:
        attivita.record(utente, categoria, azione, f"{MARCHIO} {dettaglio}".strip(), outcome=esito, role=ruolo)
    return len(EVENTI)


# --------------------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description="Dati di esempio in tutte le aree (Documenti, Posta, Mezzi, Attivita').")
    p.add_argument("--rimuovi", action="store_true", help="toglie gli esempi e lascia i dati veri")
    args = p.parse_args()
    s = env_config.load_settings()
    if args.rimuovi:
        print(f"Documenti: tolte {rimuovi_documenti()} righe dallo Storico")
        print(f"Posta: tolte {rimuovi_posta(s)} righe dal registro, cronologia e allegati")
        print(f"Mezzi: tolte {rimuovi_mezzi(s)} pratiche (e le ditte registrate solo dagli esempi)")
        print("Attivita' utenti: gli eventi esempio.* restano (registro a catena di impronte, non si modifica)")
        return
    n_doc, n_storico = crea_documenti()
    print(f"Documenti: {n_doc} file in {ESPORTAZIONE / COMMESSA} (manifest.csv) e {n_storico} righe nello Storico")
    n_mail, n_righe = crea_posta(s)
    print(f"Posta: {n_mail} email ({n_righe} elaborazioni) in {REGISTRO.name}, {STATO_POSTA.name} e {vfp_mail.archive_dir(s).name}")
    print("Mezzi:")
    creati = crea_mezzi(s)
    print(f"  {len(creati)} pratiche create" + (" (gia' presenti: nessuna nuova)" if not creati else ""))
    print(f"Attivita' utenti: {crea_attivita()} eventi")
    print("Fatto: l'interfaccia li mostra subito (Panoramica, Storico, Flusso posta, Caselle email, Mezzi, Attivita').")


if __name__ == "__main__":
    main()
