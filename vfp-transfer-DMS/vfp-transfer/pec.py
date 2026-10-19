# "><(((º> sabusabu <º)))><"
"""
Busta PEC: dati di certificazione (daticert.xml) e firma del gestore (smime.p7s).

Ogni messaggio PEC e' una busta firmata dal gestore che contiene:
  postacert.eml   il messaggio originale (solo nella "posta-certificata", non nelle ricevute)
  daticert.xml    i dati di certificazione: tipo, mittente, destinatari, oggetto, data, identificativo, gestore
  smime.p7s       la firma S/MIME del gestore su tutta la busta
La firma si verifica con le funzioni crittografiche di Windows (crypt32, come la cassaforte): dice se la busta
e' integra e chi l'ha firmata. Non controlla che il certificato sia nell'elenco dei gestori accreditati AgID.

Tipi delle ricevute (daticert "tipo"): accettazione, non-accettazione, presa-in-carico, avvenuta-consegna,
errore-consegna, preavviso-errore-consegna, rilevazione-virus. Il messaggio vero e' "posta-certificata".
"""

import os
import re
import xml.etree.ElementTree as ET

MAX_DATICERT = 256 * 1024
RECEIPT_TYPES = {
    "accettazione": "Accettazione",
    "non-accettazione": "Mancata accettazione",
    "presa-in-carico": "Presa in carico",
    "avvenuta-consegna": "Avvenuta consegna",
    "errore-consegna": "Mancata consegna",
    "preavviso-errore-consegna": "Preavviso di mancata consegna",
    "rilevazione-virus": "Rilevazione virus",
}
TYPE_LABELS = {"posta-certificata": "Posta certificata", **RECEIPT_TYPES}


# --------------------------------------------------------------------------- daticert.xml

def _text(node, path):
    el = node.find(path)
    return " ".join((el.text or "").split()) if el is not None and el.text else ""


def parse_daticert(data):
    """Dati di certificazione come dizionario; {} se il file manca o non e' leggibile."""
    if not data or len(data) > MAX_DATICERT or b"<!ENTITY" in data or b"<!DOCTYPE" in data:
        return {}  # niente entita' XML: un daticert vero non ne ha bisogno
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return {}
    if root.tag != "postacert":
        return {}
    giorno, ora = _text(root, "dati/data/giorno"), _text(root, "dati/data/ora")
    zona = (root.find("dati/data").get("zona") if root.find("dati/data") is not None else "") or ""
    return {
        "tipo": root.get("tipo", ""),
        "errore": root.get("errore", ""),
        "mittente": _text(root, "intestazione/mittente"),
        "destinatari": [" ".join((d.text or "").split()) for d in root.findall("intestazione/destinatari") if d.text],
        "oggetto": _text(root, "intestazione/oggetto"),
        "gestore": _text(root, "dati/gestore-emittente"),
        "data": f"{giorno} {ora} {zona}".strip(),
        "identificativo": _text(root, "dati/identificativo"),
        "msgid": _text(root, "dati/msgid"),
        "consegna": _text(root, "dati/consegna"),
        "errore_esteso": _text(root, "dati/errore-esteso"),
    }


def find_part(msg, filename):
    for part in msg.walk():
        if (part.get_filename() or "").lower() == filename:
            return part
    return None


# --------------------------------------------------------------------------- firma S/MIME (Windows crypt32)

def signed_content(raw, boundary):
    """
    Byte esatti della prima parte di un multipart/signed (quella firmata), presi dal messaggio originale:
    la firma vale sui byte cosi' come sono arrivati, non su una versione riletta e riscritta.
    """
    if not raw or not boundary:
        return None
    head_end = raw.find(b"\r\n\r\n")
    sep = 4
    if head_end < 0:
        head_end, sep = raw.find(b"\n\n"), 2
        if head_end < 0:
            return None
    body = raw[head_end + sep:]
    delim = b"--" + boundary.encode("ascii", "replace")
    first = body.find(delim)
    if first < 0:
        return None
    start = body.find(b"\n", first)  # la parte inizia dopo la riga del delimitatore
    if start < 0:
        return None
    start += 1
    end = body.find(b"\r\n" + delim, start)
    if end < 0:
        end = body.find(b"\n" + delim, start)
        if end < 0:
            return None
    return body[start:end]


def verify_signature(signature, content):
    """
    {"stato": "valida" | "non valida" | "non verificabile", "firmatario": "...", "dettaglio": "..."}
    signature: smime.p7s (DER); content: byte firmati (vedi signed_content).
    """
    if os.name != "nt":
        return {"stato": "non verificabile", "firmatario": "", "dettaglio": "verifica disponibile solo su Windows"}
    if not signature or content is None:
        return {"stato": "non verificabile", "firmatario": "", "dettaglio": "firma o contenuto firmato non trovati"}
    try:
        return _verify_windows(signature, content)
    except OSError as e:  # libreria di sistema non disponibile
        return {"stato": "non verificabile", "firmatario": "", "dettaglio": str(e)}


if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    _X509_PKCS7 = 0x00000001 | 0x00010000  # X509_ASN_ENCODING | PKCS_7_ASN_ENCODING
    _CERT_NAME_SIMPLE_DISPLAY_TYPE = 4

    class _VerifyPara(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("dwMsgAndCertEncodingType", wintypes.DWORD),
                    ("hCryptProv", ctypes.c_void_p), ("pfnGetSignerCertificate", ctypes.c_void_p),
                    ("pvGetArg", ctypes.c_void_p)]

    class _CertContext(ctypes.Structure):
        _fields_ = [("dwCertEncodingType", wintypes.DWORD), ("pbCertEncoded", ctypes.c_void_p),
                    ("cbCertEncoded", wintypes.DWORD), ("pCertInfo", ctypes.c_void_p), ("hCertStore", ctypes.c_void_p)]

    def _verify_windows(signature, content):
        crypt32 = ctypes.windll.crypt32
        crypt32.CryptVerifyDetachedMessageSignature.restype = wintypes.BOOL
        crypt32.CryptVerifyDetachedMessageSignature.argtypes = [
            ctypes.POINTER(_VerifyPara), wintypes.DWORD, ctypes.c_char_p, wintypes.DWORD, wintypes.DWORD,
            ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(ctypes.POINTER(_CertContext))]
        crypt32.CertGetNameStringW.argtypes = [ctypes.POINTER(_CertContext), wintypes.DWORD, wintypes.DWORD,
                                               ctypes.c_void_p, wintypes.LPWSTR, wintypes.DWORD]
        crypt32.CertVerifyTimeValidity.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        crypt32.CertVerifyTimeValidity.restype = wintypes.LONG
        crypt32.CertFreeCertificateContext.argtypes = [ctypes.POINTER(_CertContext)]

        para = _VerifyPara(ctypes.sizeof(_VerifyPara), _X509_PKCS7, None, None, None)
        parts = (ctypes.c_char_p * 1)(content)
        sizes = (wintypes.DWORD * 1)(len(content))
        cert = ctypes.POINTER(_CertContext)()
        ok = crypt32.CryptVerifyDetachedMessageSignature(ctypes.byref(para), 0, signature, len(signature), 1,
                                                         parts, sizes, ctypes.byref(cert))
        err = ctypes.GetLastError()
        name, expired = "", False
        if cert:
            buf = ctypes.create_unicode_buffer(256)
            crypt32.CertGetNameStringW(cert, _CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, buf, 256)
            name = buf.value
            # validita' del certificato oggi: per una PEC vecchia e' normale che sia scaduto
            expired = crypt32.CertVerifyTimeValidity(None, cert.contents.pCertInfo) != 0
            crypt32.CertFreeCertificateContext(cert)
        if ok:
            return {"stato": "valida", "firmatario": name,
                    "dettaglio": "busta integra" + (" (certificato del gestore oggi scaduto)" if expired else "")}
        return {"stato": "non valida", "firmatario": name,
                "dettaglio": f"la busta e' stata modificata o la firma non corrisponde (codice {err & 0xFFFFFFFF:#010x})"}


# --------------------------------------------------------------------------- analisi completa

def analyze(raw, msg):
    """
    Dati PEC di un messaggio arrivato in una casella PEC (raw: byte originali, msg: messaggio letto).
    Messaggi senza daticert.xml (es. email normali consegnate alla PEC) hanno tipo "anomalia".
    """
    part = find_part(msg, "daticert.xml")
    dati = parse_daticert(part.get_payload(decode=True) if part else b"")
    info = {"tipo": dati.get("tipo") or "anomalia", **{k: v for k, v in dati.items() if k != "tipo"}}
    p7s = find_part(msg, "smime.p7s")
    if p7s is None:
        info["firma"] = {"stato": "assente", "firmatario": "", "dettaglio": "messaggio senza firma del gestore"}
    else:
        boundary = msg.get_boundary() if msg.get_content_type() == "multipart/signed" else None
        info["firma"] = verify_signature(p7s.get_payload(decode=True), signed_content(raw, boundary))
    info["ricevuta"] = info["tipo"] in RECEIPT_TYPES
    return info


def summary(info):
    """Versione ridotta da salvare nella cronologia e nel registro."""
    if not info:
        return {}
    firma = info.get("firma") or {}
    return {"tipo": info.get("tipo", ""), "identificativo": info.get("identificativo", ""), "gestore": info.get("gestore", ""),
            "data": info.get("data", ""), "msgid": info.get("msgid", ""), "destinatari": info.get("destinatari", [])[:20],
            "consegna": info.get("consegna", ""), "errore": info.get("errore_esteso") or "",
            "firma": firma.get("stato", ""), "firmatario": firma.get("firmatario", ""), "firma_dettaglio": firma.get("dettaglio", "")}


def clean_receipt_subject(subject):
    """Oggetto della PEC a cui si riferisce una ricevuta: "ACCETTAZIONE: Prot. 001" -> "Prot. 001"."""
    return re.sub(r"^\s*(?:accettazione|avvenuta\s+consegna|consegna|mancata\s+consegna|non\s+accettazione|"
                  r"presa\s+in\s+carico|preavviso\s+di\s+mancata\s+consegna|problema\s+di\s+sicurezza)\s*:\s*",
                  "", subject or "", flags=re.I)
