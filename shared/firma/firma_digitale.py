# "><(((º> sabusabu <º)))><"
"""Firma digitale CAdES (.p7m) per tutta la suite Cosedil: apre la busta e verifica le firme.

Un file `.pdf.p7m` è una busta PKCS#7/CMS (SignedData) che contiene il PDF e una o più firme; una busta può
contenerne un'altra (`.p7m.p7m`, firme "a matrioska"). Questo modulo:

  1. tira fuori il documento (anche da buste annidate, in DER, BER o base64), così i programmi lo leggono come
     un PDF qualunque;
  2. verifica ogni firma come fanno i programmi di verifica (Dike, ArubaSign), richiesta del 06/11/2026
     "verifica completa con i certificati degli enti riconosciuti":
       - integrità: impronta del documento nell'attributo firmato messageDigest e firma crittografica;
       - legame col certificato (attributo ESS signing-certificate, se c'è);
       - catena del certificato fino a un ente certificatore qualificato degli elenchi ufficiali (Trusted List
         europea con quella italiana di AgID, vedi `elenchi_fiduciari`), nello stato "granted" alla data di
         riferimento;
       - revoca (OCSP o CRL scaricati dagli indirizzi del certificato) e scadenza;
       - marca temporale dentro la firma (CAdES-T): se c'è ed è valida, la data di riferimento è la sua;
         altrimenti è adesso (regola italiana: senza marca la firma vale se il certificato è valido oggi);
       - certificato qualificato (QcCompliance) e su dispositivo sicuro (QcSSCD) = firma digitale.

Esito per firma e per busta: "valida", "non valida" (documento alterato, certificato revocato o scaduto senza
marca, catena falsa) oppure "da verificare" (revoca non controllabile senza rete, ente non presente negli elenchi,
certificato non qualificato). L'esito della busta è il peggiore fra le sue firme.

Lo usano i programmi attraverso la riga di comando `firma.py` (stesso ambiente Python per tutti:
`shared/firma/.venv`, vedi README). Non solleva eccezioni per firme sbagliate: le descrive nell'esito; solleva
`FirmaErrore` solo se il file non è una busta leggibile.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import re
from datetime import UTC, datetime, timedelta
from pathlib import PurePath

from asn1crypto import cms, tsp, x509
from asn1crypto.algos import DigestAlgorithm
from asn1crypto.core import Any, OctetString, Sequence, SequenceOf
from pyhanko_certvalidator import CertificateValidator, ValidationContext
from pyhanko_certvalidator import errors as verr
from pyhanko_certvalidator.sig_validate import DefaultSignatureValidator, SignatureValidationContext

import elenchi_fiduciari

OID_SIGNED_DATA = b"\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x07\x02"     # 1.2.840.113549.1.7.2 in DER
OID_QC_COMPLIANCE = b"\x06\x06\x04\x00\x8e\x46\x01\x01"                # 0.4.0.1862.1.1: certificato qualificato
OID_QC_SSCD = b"\x06\x06\x04\x00\x8e\x46\x01\x04"                      # 0.4.0.1862.1.4: chiave su dispositivo sicuro
OID_SIGNING_CERT_V2 = "1.2.840.113549.1.9.16.2.47"
OID_SIGNING_CERT = "1.2.840.113549.1.9.16.2.12"
MAX_LIVELLI = 10                                                         # buste annidate: oltre è un file anomalo
GRAVITA = {"valida": 0, "da verificare": 1, "non valida": 2}


class FirmaErrore(Exception):
    """Il file sembra una busta firmata ma non si riesce a leggere (rotto, troncato, firma staccata)."""


# ---------------------------------------------------------------------------------------------------------------
# Riconoscere e aprire la busta
# ---------------------------------------------------------------------------------------------------------------
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
    """Vero se il file è una busta CAdES: per nome (.p7m) o per contenuto (anche senza estensione)."""
    if nome and nome.lower().rstrip().endswith(".p7m"):
        return True
    return _der_da(dati) is not None


def nome_contenuto(nome: str | None, contenuto: bytes) -> str:
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
        raise FirmaErrore("Firma staccata: la busta non contiene il documento (serve anche il file firmato)")
    valore = econtent.native
    return valore if isinstance(valore, bytes) else econtent.contents


# ---------------------------------------------------------------------------------------------------------------
# Una firma (SignerInfo)
# ---------------------------------------------------------------------------------------------------------------
def _attributo(attrs, nome_o_oid: str):
    if not attrs:
        return None
    for a in attrs:
        if a["type"].native == nome_o_oid or a["type"].dotted == nome_o_oid:
            return a["values"][0]
    return None


def _certificato_firmatario(signed: cms.SignedData, si: cms.SignerInfo) -> x509.Certificate | None:
    sid = si["sid"]
    for c in signed["certificates"] or []:
        if c.name != "certificate":
            continue
        cert = c.chosen
        if sid.name == "issuer_and_serial_number":
            if (cert.issuer == sid.chosen["issuer"] and cert.serial_number == sid.chosen["serial_number"].native):
                return cert
        elif cert.key_identifier == sid.chosen.native:
            return cert
    return None


def _altri_certificati(signed: cms.SignedData) -> list[x509.Certificate]:
    return [c.chosen for c in signed["certificates"] or [] if c.name == "certificate"]


def _integrita(si: cms.SignerInfo, cert: x509.Certificate, contenuto: bytes) -> tuple[bool, str | None]:
    """Impronta del documento e firma crittografica. (ok, motivo se non ok)."""
    algo = si["digest_algorithm"]["algorithm"].native
    try:
        impronta = hashlib.new(algo, contenuto).digest()
    except ValueError:
        return False, f"Algoritmo di impronta non supportato: {algo}"
    attrs = si["signed_attrs"]
    if attrs:
        md = _attributo(attrs, "message_digest")
        if md is None or md.native != impronta:
            return False, "Il documento è stato modificato dopo la firma (impronta diversa)"
        firmati = b"\x31" + attrs.dump()[1:]                       # gli attributi si firmano come SET, non [0]
    else:
        firmati = contenuto
    try:
        DefaultSignatureValidator().validate_signature(
            si["signature"].native, firmati, cert.public_key, si["signature_algorithm"],
            SignatureValidationContext(contextual_md_algorithm=algo))
    except verr.InvalidSignature:
        return False, "Firma crittografica non valida"
    except (verr.AlgorithmNotSupported, verr.PSSParameterMismatch, verr.DSAParametersUnavailable) as e:
        return False, f"Algoritmo di firma non supportato: {e}"
    # attributo ESS (RFC 5035): lega la firma proprio a questo certificato, così non lo si può scambiare con un
    # altro dello stesso titolare. asn1crypto non conosce gli OID: si rilegge il valore con le strutture qui sotto.
    for oid, struttura in ((OID_SIGNING_CERT_V2, _SigningCertificateV2), (OID_SIGNING_CERT, _SigningCertificate)):
        v = _attributo(attrs, oid)
        if v is None:
            continue
        try:
            primo = struttura.load(v.dump())["certs"][0]
            alg = primo["hash_algorithm"]["algorithm"].native if isinstance(primo, _ESSCertIDv2) else "sha1"
            if hashlib.new(alg, cert.dump()).digest() != primo["cert_hash"].native:
                return False, "La firma non corrisponde al certificato allegato (attributo signing-certificate)"
        except Exception:                                              # noqa: BLE001 - attributo malformato
            return False, "Attributo signing-certificate illeggibile"
        break
    return True, None


class _ESSCertIDv2(Sequence):
    _fields = [("hash_algorithm", DigestAlgorithm, {"default": {"algorithm": "sha256"}}),
               ("cert_hash", OctetString), ("issuer_serial", Any, {"optional": True})]


class _ESSCertID(Sequence):
    _fields = [("cert_hash", OctetString), ("issuer_serial", Any, {"optional": True})]


class _CertIDsV2(SequenceOf):
    _child_spec = _ESSCertIDv2


class _CertIDs(SequenceOf):
    _child_spec = _ESSCertID


class _SigningCertificateV2(Sequence):
    _fields = [("certs", _CertIDsV2), ("policies", Any, {"optional": True})]


class _SigningCertificate(Sequence):
    _fields = [("certs", _CertIDs), ("policies", Any, {"optional": True})]


def _descrivi_certificato(cert: x509.Certificate) -> dict:
    s = cert.subject.native
    nome = s.get("common_name") or " ".join(x for x in (s.get("given_name"), s.get("surname")) if x)
    seriale = s.get("serial_number") or ""
    cf = seriale.split("-", 1)[1] if seriale[:6].upper() in ("TINIT-", "IDCIT-") else seriale or None
    estensioni = b"".join(e["extn_value"].contents for e in cert["tbs_certificate"]["extensions"] or []
                          if e["extn_id"].dotted == "1.3.6.1.5.5.7.1.3")
    uso = cert.key_usage_value.native if cert.key_usage_value else set()
    emittente = cert.issuer.native
    return {
        "firmatario": nome or "(nome assente)", "codice_fiscale": cf,
        "organizzazione": s.get("organization_name"),
        "ente_certificatore": emittente.get("organization_name") or emittente.get("common_name"),
        "certificato_valido_dal": cert.not_valid_before.isoformat(), "certificato_valido_al": cert.not_valid_after.isoformat(),
        "qualificato": OID_QC_COMPLIANCE in estensioni, "dispositivo_sicuro": OID_QC_SSCD in estensioni,
        "non_ripudio": "non_repudiation" in uso,
    }


def _catena(cert, altri, ancore, momento: datetime, rete: bool, crls, uso_esteso=None) -> tuple[str, str | None]:
    """Catena e revoca con pyhanko-certvalidator. ("ok" | "non valida" | "da verificare", motivo)."""
    if not ancore:
        return "da verificare", "Elenchi degli enti certificatori non disponibili (rete assente al primo avvio?)"
    # data nel passato (marca temporale, data dichiarata): le risposte OCSP/CRL di oggi valgono anche per allora
    passato = momento < datetime.now(UTC) - timedelta(minutes=5)
    ctx = ValidationContext(trust_roots=ancore, other_certs=altri, moment=momento, allow_fetching=rete,
                            crls=list(crls), revocation_mode="hard-fail", retroactive_revinfo=passato)
    validatore = CertificateValidator(cert, altri, validation_context=ctx)
    try:
        asyncio.run(validatore.async_validate_usage(set(), extended_key_usage=uso_esteso))
        return "ok", None
    except verr.RevokedError as e:
        return "non valida", f"Certificato revocato ({e})"
    except verr.ExpiredError:
        return "scaduto", "Certificato scaduto alla data di riferimento"
    except verr.NotYetValidError:
        return "non valida", "Certificato non ancora valido alla data di riferimento"
    except verr.PathBuildingError:
        return "da verificare", "L'ente che ha emesso il certificato non è fra gli enti certificatori qualificati degli elenchi ufficiali"
    except (verr.InsufficientRevinfoError, verr.StaleRevinfoError) as e:
        return "da verificare", f"Stato di revoca non controllabile ({e.__class__.__name__}): manca la rete o l'ente non risponde"
    except verr.PathValidationError as e:
        return "non valida", f"Catena del certificato non valida: {e}"
    except Exception as e:                                             # noqa: BLE001 - rete, formati strani
        return "da verificare", f"Verifica della catena non completata: {e}"


def _marca_temporale(si: cms.SignerInfo, rete: bool, crls, elenchi) -> dict | None:
    """Marca temporale CAdES-T (attributo non firmato signature-time-stamp-token), verificata come una firma:
    integrità, impronta = hash del valore della firma, ente di marcatura negli elenchi alla data della marca."""
    token = _attributo(si["unsigned_attrs"], "signature_time_stamp_token")
    if token is None:
        return None
    try:
        tsigned = token["content"]
        info = tsigned["encap_content_info"]["content"].parsed
        if not isinstance(info, tsp.TSTInfo):
            info = tsp.TSTInfo.load(_contenuto(tsigned))
        data = info["gen_time"].native
        imprint = info["message_imprint"]
        algo = imprint["hash_algorithm"]["algorithm"].native
        esito = {"data": data.isoformat(), "valida": False, "motivo": None, "ente": None}
        if hashlib.new(algo, si["signature"].native).digest() != imprint["hashed_message"].native:
            esito["motivo"] = "La marca temporale non si riferisce a questa firma"
            return esito
        tsi = tsigned["signer_infos"][0]
        tcert = _certificato_firmatario(tsigned, tsi)
        if tcert is None:
            esito["motivo"] = "Certificato dell'ente di marcatura assente"
            return esito
        esito["ente"] = (tcert.subject.native.get("organization_name") or tcert.subject.native.get("common_name"))
        ok, motivo = _integrita(tsi, tcert, _contenuto(tsigned))
        if not ok:
            esito["motivo"] = f"Marca temporale alterata: {motivo}"
            return esito
        stato, motivo = _catena(tcert, _altri_certificati(tsigned), elenchi.ancore(data, marca=True), data, rete,
                                crls, uso_esteso={"time_stamping"})
        esito["valida"] = stato == "ok"
        esito["motivo"] = motivo
        return esito
    except FirmaErrore:
        raise
    except Exception as e:                                             # noqa: BLE001 - token malformato
        return {"data": None, "valida": False, "motivo": f"Marca temporale illeggibile: {e}", "ente": None}


def _verifica_firma(signed, si, contenuto, *, rete, crls, elenchi, adesso) -> dict:
    cert = _certificato_firmatario(signed, si)
    if cert is None:
        return {"esito": "non valida", "motivi": ["Certificato del firmatario assente nella busta"], "firmatario": "?"}
    f = _descrivi_certificato(cert)
    data_firma = _attributo(si["signed_attrs"], "signing_time")
    f["data_firma_dichiarata"] = data_firma.native.isoformat() if data_firma is not None else None
    motivi, esito = [], "valida"

    integra, motivo = _integrita(si, cert, contenuto)
    f["integra"] = integra
    if not integra:
        f.update(esito="non valida", motivi=[motivo], marca_temporale=None, catena=None, data_riferimento=None)
        return f

    marca = _marca_temporale(si, rete, crls, elenchi) if elenchi is not None else None
    f["marca_temporale"] = marca
    riferimento = datetime.fromisoformat(marca["data"]) if marca and marca["valida"] else adesso
    f["data_riferimento"] = riferimento.isoformat()
    if marca and not marca["valida"]:
        motivi.append(f"Marca temporale non valida: {marca['motivo']}")

    altri = _altri_certificati(signed)
    stato, motivo = _catena(cert, altri, elenchi.ancore(riferimento) if elenchi else [], riferimento, rete, crls)
    f["catena"] = stato
    if stato == "scaduto":
        esito = "non valida"
        motivi.append(f"Certificato scaduto il {cert.not_valid_after:%d/%m/%Y} e firma senza marca temporale valida")
        if data_firma is not None and elenchi is not None:
            # come i programmi di verifica: alla data dichiarata dal firmatario il certificato era valido?
            prima, _ = _catena(cert, altri, elenchi.ancore(data_firma.native), data_firma.native, rete, crls)
            if prima == "ok":
                motivi.append(f"Alla data dichiarata di firma ({data_firma.native:%d/%m/%Y}) il certificato era "
                              "valido, ma la data non è provata da una marca temporale")
    elif stato != "ok":
        esito = "non valida" if stato == "non valida" else "da verificare"
        motivi.append(motivo)
    if esito == "valida" and not f["qualificato"]:
        esito = "da verificare"
        motivi.append("Certificato non qualificato: firma elettronica avanzata, non firma digitale")
    elif esito == "valida" and not f["dispositivo_sicuro"]:
        motivi.append("Firma elettronica qualificata (il certificato non dichiara il dispositivo sicuro)")
    if marca and not marca["valida"] and esito == "valida":
        esito = "da verificare"
    f["tipo"] = ("firma digitale" if f["qualificato"] and f["dispositivo_sicuro"]
                 else "firma elettronica qualificata" if f["qualificato"] else "firma elettronica")
    f["esito"] = esito
    f["motivi"] = [m for m in motivi if m]
    return f


# ---------------------------------------------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------------------------------------------
def apri(dati: bytes, nome: str | None = None, *, verifica: bool = True, rete: bool = True,
         adesso: datetime | None = None, ancore_extra=(), crls=(), elenchi=None) -> dict:
    """Apre una busta .p7m: {"firmato", "contenuto" (bytes), "nome_contenuto", "livelli", "firme", "esito",
    "riepilogo", "elenchi"}. Un file non firmato torna com'è con firmato=False.

    - verifica=False: estrae e descrive i firmatari senza controllare catena e revoca (più veloce, senza rete);
    - rete=False: niente download (elenchi dalla cache, revoca non controllabile → "da verificare");
    - ancore_extra / crls: certificati di fiducia ed elenchi di revoca aggiuntivi (test, enti privati);
    - elenchi: oggetto `elenchi_fiduciari.Elenchi` già caricato (riuso fra chiamate)."""
    adesso = adesso or datetime.now(UTC)
    der = _der_da(dati)
    if der is None:
        if nome and nome.lower().endswith(".p7m"):
            raise FirmaErrore("Il file .p7m non contiene una busta firmata leggibile")
        return {"firmato": False, "contenuto": dati, "nome_contenuto": PurePath(nome or "documento").name,
                "livelli": 0, "firme": [], "esito": None, "riepilogo": "Documento senza firma digitale CAdES"}
    if verifica and elenchi is None:
        elenchi = elenchi_fiduciari.carica(rete=rete, extra=ancore_extra)
    elif elenchi is not None and ancore_extra:
        elenchi.aggiungi(ancore_extra)
    firme, contenuto, livello = [], der, 0
    while (corrente := _der_da(contenuto)) is not None:
        livello += 1
        if livello > MAX_LIVELLI:
            raise FirmaErrore(f"Più di {MAX_LIVELLI} buste annidate: file anomalo")
        try:
            ci = cms.ContentInfo.load(corrente)
            if ci["content_type"].native != "signed_data":
                raise FirmaErrore("La busta non è di tipo SignedData")
            signed = ci["content"]
            interno = _contenuto(signed)
            signer_infos = list(signed["signer_infos"])
        except FirmaErrore:
            raise
        except Exception as e:                                         # noqa: BLE001 - DER rotto, troncato
            raise FirmaErrore(f"Busta firmata illeggibile: {e}") from e
        for si in signer_infos:
            if verifica:
                f = _verifica_firma(signed, si, interno, rete=rete, crls=crls, elenchi=elenchi, adesso=adesso)
            else:
                cert = _certificato_firmatario(signed, si)
                f = _descrivi_certificato(cert) if cert else {"firmatario": "?"}
                f.update(esito=None, motivi=["Firma non verificata"])
                data_firma = _attributo(si["signed_attrs"], "signing_time")
                f["data_firma_dichiarata"] = data_firma.native.isoformat() if data_firma is not None else None
            f["livello"] = livello
            firme.append(f)
        contenuto = interno
    esito = max((f["esito"] for f in firme if f.get("esito")), key=GRAVITA.get, default=None)
    return {"firmato": True, "contenuto": contenuto, "nome_contenuto": nome_contenuto(nome, contenuto),
            "livelli": livello, "firme": firme, "esito": esito, "riepilogo": riepilogo(firme, esito),
            "elenchi": elenchi.descrizione() if elenchi is not None else None}


def riepilogo(firme: list[dict], esito: str | None) -> str:
    """Una riga in italiano per le interfacce: "Firma digitale valida: Mario Rossi (InfoCert), 12/03/2024"."""
    if not firme:
        return "Nessuna firma"

    def chi(f):
        data = f.get("marca_temporale", {}) or {}
        quando = (data.get("data") if data.get("valida") else None) or f.get("data_firma_dichiarata")
        q = f", {datetime.fromisoformat(quando):%d/%m/%Y}" if quando else ""
        ente = f" ({f['ente_certificatore']})" if f.get("ente_certificatore") else ""
        return f"{f.get('firmatario', '?')}{ente}{q}"
    nomi = "; ".join(chi(f) for f in firme)
    if esito is None:
        return f"Documento firmato (non verificato): {nomi}"
    plurale = len(firme) > 1
    testa = {"valida": "Firme valide" if plurale else "Firma valida",
             "non valida": "Firma NON valida" if not plurale else "Firme NON valide",
             "da verificare": "Firma da verificare" if not plurale else "Firme da verificare"}[esito]
    motivo = next((m for f in firme if f.get("esito") == esito for m in f.get("motivi", [])), None)
    return f"{testa}: {nomi}" + (f" — {motivo}" if motivo and esito != "valida" else "")
