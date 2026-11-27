# "><(((º> sabusabu <º)))><"
"""Apertura dei PDF firmati digitalmente (.p7m) nella versione autonoma di Confronto Documenti.

La versione autonoma (autonomo.py, build-autonomo.bat) si manda a PC che non hanno né la suite né Python: il
motore comune della firma (shared/firma, con le librerie di verifica in un suo .venv) lì non può esserci. Questo
modulo ne prende il posto con la sola parte che al confronto serve davvero: TIRA FUORI il documento dalla busta e
dice chi l'ha firmato, SENZA verificare la firma (niente catena del certificato, revoca, marca temporale: scelta
del 27/11/2026, "estrazione senza verifica"). Chi vuole la verifica usa il programma dentro la suite.

Ha la stessa interfaccia del client shared/firma/busta.py (`e_busta_firmata`, `apri`, `FirmaNonInstallata`,
`BustaIllegibile`), così server.apri_busta lo usa senza sapere quale dei due ha davanti: autonomo.py lo mette in
`server.firma_busta` solo se il motore vero non c'è. L'unica libreria è asn1crypto (Python puro, sta dentro
l'exe). La lettura della busta ricalca shared/firma/firma_digitale.py (`_der_da`, `_contenuto`,
`_descrivi_certificato`, `apri` con verifica=False): se là cambia il formato del rapporto, va allineato qui.
"""
from __future__ import annotations

import base64
import binascii
import re
from datetime import datetime
from pathlib import PurePath

from asn1crypto import cms, x509

OID_SIGNED_DATA = b"\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x07\x02"     # 1.2.840.113549.1.7.2 in DER
OID_QC_COMPLIANCE = b"\x06\x06\x04\x00\x8e\x46\x01\x01"                # 0.4.0.1862.1.1: certificato qualificato
OID_QC_SSCD = b"\x06\x06\x04\x00\x8e\x46\x01\x04"                      # 0.4.0.1862.1.4: chiave su dispositivo sicuro
MAX_LIVELLI = 10                                                         # buste annidate: oltre è un file anomalo
NON_VERIFICATA = ("Firma non verificata: questa versione del programma apre il documento firmato ma non "
                  "controlla la validità della firma")


class FirmaNonInstallata(RuntimeError):
    """Mai sollevata qui (non c'è niente da installare): esiste perché server.apri_busta la intercetta."""


class BustaIllegibile(ValueError):
    """Il file sembra un .p7m ma la busta non si legge (rotta, troncata, firma staccata)."""


def _der_da(dati: bytes) -> bytes | None:
    """I byte DER della busta: il file così com'è, oppure decodificato da base64 / PEM (molte PEC e alcuni
    programmi di firma salvano il .p7m in base64). None se non sembra una busta firmata."""
    if dati[:1] == b"\x30" and OID_SIGNED_DATA in dati[:64]:
        return dati
    if dati.lstrip()[:2] not in (b"MI", b"MC", b"--"):                 # né base64 né PEM: inutile decodificare
        return None
    testo = dati.strip()
    if testo.startswith(b"-----BEGIN"):
        testo = b"".join(r for r in testo.splitlines() if r and not r.startswith(b"-----"))
    if testo[:2] in (b"MI", b"MC"):                                     # "0\x82…" / "0\x80…" in base64
        try:
            der = base64.b64decode(re.sub(rb"\s+", b"", testo), validate=True)
        except (binascii.Error, ValueError):
            return None
        if der[:1] == b"\x30" and OID_SIGNED_DATA in der[:64]:
            return der
    return None


def e_busta_firmata(dati: bytes, nome: str | None = None) -> bool:
    """Vero se il file è una busta CAdES: per nome (.p7m) o per contenuto (DER, base64, PEM).

    `dati` può essere anche solo l'inizio del file (server.apri_busta ne passa la testa): per il DER bastano i
    primi 64 byte; un base64 troncato a metà non si decodifica, ma quei file hanno l'estensione .p7m."""
    if nome and str(nome).lower().rstrip().endswith(".p7m"):
        return True
    return _der_da(dati) is not None


def _nome_contenuto(nome: str | None, contenuto: bytes) -> str:
    """"contratto.pdf.p7m" → "contratto.pdf"; senza estensione utile la si deduce dal contenuto."""
    base = PurePath(nome or "documento").name
    while base.lower().endswith(".p7m"):
        base = base[:-4]
    if "." not in base.strip("."):
        if contenuto[:5] == b"%PDF-":
            base += ".pdf"
        elif contenuto[:4] == b"PK\x03\x04":
            base += ".zip"
    return base or "documento.pdf"


def _contenuto(signed: cms.SignedData) -> bytes:
    econtent = signed["encap_content_info"]["content"]
    if econtent.native is None:
        raise BustaIllegibile("Firma staccata: la busta non contiene il documento (serve anche il file firmato)")
    valore = econtent.native
    return valore if isinstance(valore, bytes) else econtent.contents


def _certificato_firmatario(signed: cms.SignedData, si: cms.SignerInfo) -> x509.Certificate | None:
    """Il certificato di chi ha messo questa firma, cercato fra quelli allegati alla busta."""
    sid = si["sid"]
    for c in signed["certificates"] or []:
        if c.name != "certificate":
            continue
        cert = c.chosen
        if sid.name == "issuer_and_serial_number":
            if cert.issuer == sid.chosen["issuer"] and cert.serial_number == sid.chosen["serial_number"].native:
                return cert
        elif cert.key_identifier == sid.chosen.native:
            return cert
    return None


def _descrivi(cert: x509.Certificate) -> dict:
    """Chi è il firmatario, letto dal certificato: nome, codice fiscale, ente, tipo di firma dichiarato."""
    s = cert.subject.native
    nome = s.get("common_name") or " ".join(x for x in (s.get("given_name"), s.get("surname")) if x)
    seriale = s.get("serial_number") or ""
    # nei certificati italiani il codice fiscale sta nel serialNumber come "TINIT-RSSMRA80A01H501U"
    cf = seriale.split("-", 1)[1] if seriale[:6].upper() in ("TINIT-", "IDCIT-") else seriale or None
    estensioni = b"".join(e["extn_value"].contents for e in cert["tbs_certificate"]["extensions"] or []
                          if e["extn_id"].dotted == "1.3.6.1.5.5.7.1.3")           # qcStatements
    qualificato, sicuro = OID_QC_COMPLIANCE in estensioni, OID_QC_SSCD in estensioni
    emittente = cert.issuer.native
    return {
        "firmatario": nome or "(nome assente)", "codice_fiscale": cf,
        "organizzazione": s.get("organization_name"),
        "ente_certificatore": emittente.get("organization_name") or emittente.get("common_name"),
        "certificato_valido_dal": cert.not_valid_before.isoformat(),
        "certificato_valido_al": cert.not_valid_after.isoformat(),
        "qualificato": qualificato, "dispositivo_sicuro": sicuro,
        # il tipo è quello che il certificato DICHIARA: qui nessuno controlla che sia vero
        "tipo": ("firma digitale" if qualificato and sicuro
                 else "firma elettronica qualificata" if qualificato else "firma elettronica"),
    }


def _data_firma(si: cms.SignerInfo) -> str | None:
    """La data che il firmatario ha dichiarato (attributo signing_time), se c'è."""
    for a in si["signed_attrs"] or []:
        if a["type"].native == "signing_time":
            return a["values"][0].native.isoformat()
    return None


def _riepilogo(firme: list[dict]) -> str:
    """Una riga per pagina e report: "Documento firmato (firma non verificata): Mario Rossi (InfoCert), 12/03/2026"."""
    def chi(f):
        quando = f.get("data_firma_dichiarata")
        q = f", {datetime.fromisoformat(quando):%d/%m/%Y}" if quando else ""
        ente = f" ({f['ente_certificatore']})" if f.get("ente_certificatore") else ""
        return f"{f.get('firmatario', '?')}{ente}{q}"
    return "Documento firmato (firma non verificata): " + ("; ".join(chi(f) for f in firme) or "nessun firmatario")


def apri(dati: bytes, nome: str | None = None, *, rete: bool = True, verifica: bool = True,
         timeout: float = 180) -> tuple[bytes, str, dict]:
    """(documento contenuto, suo nome, rapporto). Apre anche le buste annidate (.p7m.p7m).

    `rete`, `verifica` e `timeout` ci sono solo per avere la stessa firma di busta.apri: qui la verifica non si
    fa mai, quindi nel rapporto `esito` è None (la pagina scrive "Firma non verificata") e ogni firmatario porta
    il motivo NON_VERIFICATA. Solleva BustaIllegibile se il file non è una busta leggibile."""
    der = _der_da(dati)
    if der is None:
        raise BustaIllegibile("Il file .p7m non contiene una busta firmata leggibile")
    firme, contenuto, livello = [], der, 0
    while (corrente := _der_da(contenuto)) is not None:
        livello += 1
        if livello > MAX_LIVELLI:
            raise BustaIllegibile(f"Più di {MAX_LIVELLI} buste annidate: file anomalo")
        try:
            ci = cms.ContentInfo.load(corrente)
            if ci["content_type"].native != "signed_data":
                raise BustaIllegibile("La busta non è di tipo SignedData")
            signed = ci["content"]
            interno = _contenuto(signed)
            for si in signed["signer_infos"]:
                cert = _certificato_firmatario(signed, si)
                f = _descrivi(cert) if cert is not None else {"firmatario": "?"}
                f.update(esito=None, motivi=[NON_VERIFICATA], marca_temporale=None, livello=livello,
                         data_firma_dichiarata=_data_firma(si))
                firme.append(f)
        except BustaIllegibile:
            raise
        except Exception as e:                                         # noqa: BLE001 - DER rotto, troncato
            raise BustaIllegibile(f"Busta firmata illeggibile: {e}") from e
        contenuto = interno
    nome_doc = _nome_contenuto(nome, contenuto)
    return contenuto, nome_doc, {"firmato": True, "nome_contenuto": nome_doc, "livelli": livello, "firme": firme,
                                 "esito": None, "riepilogo": _riepilogo(firme), "elenchi": None}
