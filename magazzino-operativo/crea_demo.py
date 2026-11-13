# "><(((º> sabusabu <º)))><"
"""Dati di esempio del Magazzino Operativo: per far vedere al cliente come si presentano i dati.

    python crea_demo.py            carica la demo in un database vuoto (si rifiuta se ci sono già dati)
    python crea_demo.py --azzera   svuota il database e ricarica la demo
    python crea_demo.py --conta    mostra solo quante righe ci sono, senza toccare niente

Cosa mette (tutto inventato, ma verosimile per un'impresa edile):
  - ubicazioni: deposito centrale, officina mezzi e tre cantieri con le commesse della demo della
    suite (101-003 Sede Acireale, C-2024-015 Scuola Via Roma, 102-011 Rotatoria SS114), così i
    link verso InCampo e SkyTower trovano gli stessi codici;
  - 26 articoli di materiale edile con unità, categoria, fornitore, scorta minima e qualche EAN;
  - 12 mezzi fra propri e a nolo, con targhe, matricole, stato, chi li sta usando e lo storico;
  - sei settimane di movimenti: carichi dai DDT, trasferimenti verso i cantieri, scarichi per consumo
    (da scansione), rettifiche e un inventario; le giacenze non vanno mai sotto zero in nessun
    momento e qualche articolo resta sotto scorta, così la plancia ha qualcosa da segnalare;
  - il registro attività e lo storico delle importazioni, con quattro utenti e qualche IP.

Gli eventi vengono prima generati, poi ordinati per data e applicati uno alla volta: un consumo non
può mai attingere a una consegna che arriva dopo, e le righe nel database stanno nell'ordine in cui
sarebbero nate davvero (la plancia ordina per inserimento).

Deterministico: rilanciandolo con --azzera si ottiene la stessa demo. Non crea foto dei mezzi.
Usa lo stesso database dell'app (config.DB_PATH, o MAGAZZINO_DB): va lanciato con l'app spenta o
con l'app accesa (SQLite in WAL lo regge), ma non mentre qualcuno sta registrando movimenti.
"""
import argparse
import random
import sys
from datetime import date, datetime, time, timedelta, timezone

import codici
import config
import database

SEME = 20261113
UTENTI = ["marta.colombo", "fabio.restivo", "salvatore.grasso", "a.mangiagi"]
IP = {"marta.colombo": "192.168.1.21", "fabio.restivo": "10.8.0.12", "salvatore.grasso": "10.8.0.31",
      "a.mangiagi": "192.168.1.57"}
UTENTE_DDT = "lettore-ddt"
GIORNI = 45   # quanto indietro parte la storia

UBICAZIONI = [
    # (nome, tipo, commessa, indirizzo, lat, lng, note)
    ("Officina mezzi", "officina", None, "Via dell'Industria 14, Acireale (CT)", 37.6124, 15.1587,
     "Manutenzione e ricovero dei mezzi fermi"),
    ("Cantiere Sede Acireale", "cantiere", "101-003", "Via Nazionale 210, Acireale (CT)", 37.6098, 15.1664,
     "Ampliamento sede: scavi e fondazioni in corso"),
    ("Cantiere Scuola Via Roma", "cantiere", "C-2024-015", "Via Roma 88, Catania", 37.5079, 15.0830,
     "Adeguamento sismico: strutture e impianti"),
    ("Cantiere Rotatoria SS114", "cantiere", "102-011", "SS114 km 93, Catania", 37.4612, 15.0661,
     "Opere stradali: sottoservizi e pavimentazione"),
]
DEPOSITO = (config.UBICAZIONE_DEFAULT, "Via dell'Industria 12, Acireale (CT)", 37.6121, 15.1581,
            "Magazzino principale: materiale, minuteria e DPI")

ARTICOLI = [
    # (descrizione, um, categoria, fornitore, scorta_minima, codice_esterno)
    ("Cemento Portland 42.5 R, sacco 25 kg", "sacchi", "Leganti e inerti", "Buzzi Unicem", 80, "8001234000011"),
    ("Calce idraulica NHL 3.5, sacco 25 kg", "sacchi", "Leganti e inerti", "Buzzi Unicem", 30, None),
    ("Sabbia lavata 0/4", "m³", "Leganti e inerti", "Cave Etna Srl", 10, None),
    ("Ghiaia 8/16", "m³", "Leganti e inerti", "Cave Etna Srl", 10, None),
    ("Malta premiscelata M10, sacco 25 kg", "sacchi", "Leganti e inerti", "Fassa Bortolo", 40, "8001234000028"),
    ("Tondino B450C Ø12", "kg", "Ferro e carpenteria", "Siderurgica Catanese", 1500, None),
    ("Tondino B450C Ø16", "kg", "Ferro e carpenteria", "Siderurgica Catanese", 1000, None),
    ("Rete elettrosaldata Ø8 20×20, pannello 2×4 m", "pz", "Ferro e carpenteria", "Siderurgica Catanese", 40, None),
    ("Filo ricotto per legature, matassa 5 kg", "pz", "Ferro e carpenteria", "Siderurgica Catanese", None, None),
    ("Distanziatore copriferro 30 mm, conf. 100", "conf", "Ferro e carpenteria", "Edil Sud Forniture", 10, None),
    ("Pannello cassero multistrato 27 mm 250×50 cm", "pz", "Casseforme", "Edil Sud Forniture", 60, None),
    ("Puntello telescopico 2,0-3,5 m", "pz", "Casseforme", "Edil Sud Forniture", 50, None),
    ("Disarmante per casseri, tanica 20 l", "pz", "Casseforme", "Mapei", 4, "8001234000035"),
    ("Tavola abete 25×200 mm, 4 m", "pz", "Legname", "Legnami Jonici", 80, None),
    ("Travetto abete 8×8 cm, 4 m", "pz", "Legname", "Legnami Jonici", 40, None),
    ("Tubo PVC Ø125 SN4, barra 3 m", "pz", "Idraulica", "Idrotermica Sud", 20, "8001234000042"),
    ("Tubo PEAD Ø63 PN16, rotolo 100 m", "rotoli", "Idraulica", "Idrotermica Sud", 2, None),
    ("Pozzetto in cls 50×50×50", "pz", "Idraulica", "Prefabbricati Ionici", 6, None),
    ("Cavo FG16OR16 3G2,5, matassa 100 m", "pz", "Elettrico", "Elettroforniture Catania", 4, "8001234000059"),
    ("Corrugato Ø25, rotolo 50 m", "rotoli", "Elettrico", "Elettroforniture Catania", 6, None),
    ("Guaina bituminosa 4 mm, rotolo 10 m²", "rotoli", "Impermeabilizzazione", "Index", 15, "8001234000066"),
    ("Primer bituminoso, tanica 10 l", "pz", "Impermeabilizzazione", "Index", 3, None),
    ("Casco di protezione EN 397", "pz", "DPI", "Safety Point", 10, "8001234000073"),
    ("Guanti antitaglio taglia 9, paio", "pz", "DPI", "Safety Point", 30, None),
    ("Gilet alta visibilità", "pz", "DPI", "Safety Point", 10, None),
    ("Blocco in laterizio 25×30×19", "pz", "Murature", "Fornaci Sicule", 300, None),
]

# Consegne dai DDT: (giorni fa, fornitore, destinazione, [(indice articolo, quantità), ...])
CONSEGNE = [
    (44, "Buzzi Unicem", "deposito", [(0, 240), (1, 60), (4, 120)]),
    (43, "Siderurgica Catanese", "101-003", [(5, 4200), (6, 2800), (7, 90), (8, 20), (9, 30)]),
    (41, "Edil Sud Forniture", "deposito", [(10, 160), (11, 120), (12, 8)]),
    (40, "Safety Point", "deposito", [(22, 24), (23, 60), (24, 20)]),
    (38, "Legnami Jonici", "C-2024-015", [(13, 200), (14, 90)]),
    (36, "Cave Etna Srl", "102-011", [(2, 48), (3, 36)]),
    (33, "Idrotermica Sud", "deposito", [(15, 60), (16, 6), (17, 14)]),
    (31, "Elettroforniture Catania", "deposito", [(18, 10), (19, 16)]),
    (27, "Index", "deposito", [(20, 36), (21, 8)]),
    (24, "Fornaci Sicule", "C-2024-015", [(25, 1800)]),
    (20, "Buzzi Unicem", "deposito", [(0, 200), (4, 80)]),
    (16, "Siderurgica Catanese", "deposito", [(5, 2000), (7, 60)]),
    (12, "Cave Etna Srl", "101-003", [(2, 30), (3, 24)]),
    (8, "Edil Sud Forniture", "deposito", [(11, 60), (10, 40)]),
    (4, "Safety Point", "deposito", [(23, 40)]),
    (1, "Idrotermica Sud", "102-011", [(15, 36), (17, 8)]),
]

# Fabbisogno dei cantieri, servito dal deposito ogni settimana e consumato giorno per giorno:
# (indice articolo, quantità per giro)
FABBISOGNI = {
    "101-003": [(0, 40), (4, 20), (10, 30), (11, 24), (12, 1), (22, 3), (23, 8), (20, 6), (5, 600), (7, 12)],
    "C-2024-015": [(0, 30), (1, 10), (18, 2), (19, 3), (16, 1), (23, 6), (24, 3), (15, 8), (13, 30), (25, 250)],
    "102-011": [(0, 20), (17, 2), (15, 6), (24, 2), (23, 4), (21, 1), (20, 4), (10, 12), (2, 6), (3, 5)],
}
CAPI = {"101-003": "salvatore.grasso", "C-2024-015": "fabio.restivo", "102-011": "salvatore.grasso"}

MEZZI = [
    # (tipo, marca, modello, targa, matricola, proprieta, ditta, piva, nolo_dal, nolo_al, stato, ubicazione, assegnato, note)
    ("Escavatore cingolato", "Caterpillar", "320 GC", None, "CAT0320GCHKA10247", "proprio", None, None, None, None,
     "in_uso", "101-003", "Salvatore Grasso", "Tagliando 500 h fatto il mese scorso"),
    ("Miniescavatore", "Kubota", "U27-4", None, "KBCU274C1234", "proprio", None, None, None, None,
     "in_uso", "C-2024-015", "Fabio Restivo", None),
    ("Pala gommata", "Komatsu", "WA270-8", None, "KMTWA270K0012", "proprio", None, None, None, None,
     "disponibile", "deposito", None, None),
    ("Autocarro ribaltabile", "Iveco", "Eurocargo 120E", "FX123KL", "ZCFA1LD0202567890", "proprio", None, None, None, None,
     "in_uso", "102-011", "Giuseppe Leotta", "Revisione a febbraio"),
    ("Furgone", "Fiat", "Ducato", "GA456MN", None, "proprio", None, None, None, None,
     "disponibile", "deposito", None, "Attrezzato per i DPI e la minuteria"),
    ("Rullo compattatore", "Bomag", "BW 120 AD-5", None, "BW120AD5-77821", "proprio", None, None, None, None,
     "manutenzione", "officina", None, "Perdita olio idraulico: ricambio ordinato"),
    ("Betoniera", "Imer", "Syntesi 350", None, "IMR350-5541", "proprio", None, None, None, None,
     "disponibile", "101-003", None, None),
    ("Gruppo elettrogeno 30 kVA", "Pramac", "GSW30", None, "PRM30-2024-118", "proprio", None, None, None, None,
     "fermo", "officina", None, "Non parte: alternatore da verificare"),
    ("Piattaforma aerea", "Haulotte", "HA16 RTJ", None, "HA16-220931", "nolo", "Noleggi Etna Srl", "04567890871",
     -30, 20, "in_uso", "C-2024-015", "Giuseppe Leotta", "Nolo mensile, consegnata con libretto"),
    ("Escavatore gommato", "JCB", "Hydradig 110W", "EA789CD", None, "nolo", "Noleggi Etna Srl", "04567890871",
     -18, 42, "in_uso", "102-011", "Salvatore Grasso", None),
    ("Martello demolitore idraulico", "Indeco", "HP 750", None, "IND750-3341", "nolo", "Tecnonoleggi Sicilia", "05678901234",
     -10, 5, "disponibile", "deposito", None, "Attacco per escavatore 20 t"),
    ("Gru a torre", "Potain", "Igo 50", None, "IGO50-88112", "nolo", "Tecnonoleggi Sicilia", "05678901234",
     -44, -14, "restituito", None, None, "Restituita a fine getti del secondo solaio"),
]


class Demo:
    """Genera gli eventi (movimenti, spostamenti, attività), poi li scrive in ordine di data."""

    def __init__(self, conn, oggi):
        self.c = conn
        self.oggi = oggi
        self.r = random.Random(SEME)
        self.ubi = {}        # chiave ("deposito", "officina", codice commessa) -> id
        self.nomi_ubi = {}   # id ubicazione -> nome
        self.art = []        # id articoli nell'ordine di ARTICOLI
        self.codici_art = {}  # id articolo -> codice MAG-xxxxx
        self.stock = {}      # (articolo_id, ubicazione_id) -> quantità, mentre si applicano gli eventi
        self.eventi = []     # (ts, progressivo, dict) dei movimenti di materiale, da applicare in ordine
        self.spostamenti = []  # (ts, progressivo, tupla) per movimenti_mezzi
        self.attivita_buf = []  # (ts, progressivo, tupla) per attivita
        self.n = {"movimenti": 0, "movimenti_mezzi": 0, "attivita": 0}

    # ----------------------------------------------------------------- utilità
    def quando(self, giorni_fa, ora=None):
        """Timestamp 'AAAA-MM-GG HH:MM:SS' di un giorno lavorativo, in orario di cantiere."""
        g = self.oggi - timedelta(days=giorni_fa)
        while g.weekday() >= 5:               # sabato/domenica: il giorno lavorativo prima
            g -= timedelta(days=1)
        h, m = ora if ora else (self.r.randint(6, 14), self.r.randint(0, 59))
        dt = datetime.combine(g, time(h, m, self.r.randint(0, 59)))
        # Oggi niente orari nel futuro: chi guarda la demo alle 10 non deve vedere un movimento delle 14.
        # I ts del database sono in UTC (datetime('now') di SQLite), quindi il tetto è l'ora UTC di adesso.
        tetto = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)
        if dt > tetto:
            dt = max(datetime.combine(g, time(6, 0)), tetto - timedelta(minutes=self.r.randint(0, 150)))
        return dt.strftime("%Y-%m-%d %H:%M:%S")

    def attivita(self, ts, utente, azione, oggetto, oggetto_id, descrizione):
        self.attivita_buf.append((ts, len(self.attivita_buf),
                                  (ts, utente, IP.get(utente, "127.0.0.1"), azione, oggetto, oggetto_id,
                                   (descrizione or "")[:300])))

    def evento(self, ts, **dati):
        self.eventi.append((ts, len(self.eventi), dati))

    def movimento(self, ts, tipo, art_id, qta, da=None, a=None, origine="manuale", utente=None, **extra):
        """Un movimento di materiale da applicare poi in ordine di data (vedi _applica_movimento)."""
        self.evento(ts, genere="movimento", tipo=tipo, art=art_id, qta=qta, da=da, a=a, origine=origine,
                    utente=utente, **extra)

    def sposta_mezzo(self, ts, mezzo_id, da, a, stato, origine, utente, nota):
        self.spostamenti.append((ts, len(self.spostamenti), (ts, mezzo_id, da, a, stato, origine, utente, nota)))

    # ----------------------------------------------------------------- anagrafiche (scritte subito)
    def ubicazioni(self):
        c = self.c
        nome, indirizzo, lat, lng, note = DEPOSITO
        c.execute("UPDATE ubicazioni SET indirizzo = ?, lat = ?, lng = ?, note = ? WHERE nome = ?",
                  (indirizzo, lat, lng, note, nome))
        dep = c.execute("SELECT id FROM ubicazioni WHERE nome = ?", (nome,)).fetchone()["id"]
        self.ubi["deposito"], self.nomi_ubi[dep] = dep, nome
        for nome, tipo, commessa, indirizzo, lat, lng, note in UBICAZIONI:
            codice = codici.prossimo_codice(c, "ubicazioni", config.PREFISSO_UBICAZIONE)
            ts = self.quando(GIORNI, (7, 30))
            cur = c.execute(
                "INSERT INTO ubicazioni (codice, nome, tipo, commessa, indirizzo, lat, lng, note, creato_il) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (codice, nome, tipo, commessa, indirizzo, lat, lng, note, ts))
            self.ubi[commessa or tipo], self.nomi_ubi[cur.lastrowid] = cur.lastrowid, nome
            self.attivita(ts, "marta.colombo", "crea", "ubicazione", cur.lastrowid, nome)

    def articoli(self):
        c = self.c
        ts = self.quando(GIORNI, (8, 0))
        for descrizione, um, categoria, fornitore, scorta, ean in ARTICOLI:
            codice = codici.prossimo_codice(c, "articoli", config.PREFISSO_ARTICOLO)
            cur = c.execute(
                "INSERT INTO articoli (codice, codice_esterno, descrizione, descrizione_norm, um, categoria, fornitore, "
                "scorta_minima, creato_il) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (codice, ean, descrizione, codici.normalizza(descrizione), um, categoria, fornitore, scorta, ts))
            self.art.append(cur.lastrowid)
            self.codici_art[cur.lastrowid] = codice
        self.attivita(ts, "marta.colombo", "crea", "articolo", self.art[0], f"{len(ARTICOLI)} articoli dal listino")

    def mezzi(self):
        c = self.c
        for (tipo, marca, modello, targa, matricola, prop, ditta, piva, dal, al, stato, dove, assegnato, note) in MEZZI:
            codice = codici.prossimo_codice(c, "mezzi", config.PREFISSO_MEZZO)
            ubi = self.ubi[dove] if dove else None
            registrato = GIORNI - 1 if prop == "proprio" else -dal
            ts = self.quando(registrato, (8, self.r.randint(0, 59)))
            iso = lambda n: (self.oggi + timedelta(days=n)).isoformat() if n is not None else None  # noqa: E731
            cur = c.execute(
                "INSERT INTO mezzi (codice, tipo_mezzo, marca, modello, targa, matricola, proprieta, ditta, piva, nolo_dal, "
                "nolo_al, stato, ubicazione_id, assegnato_a, note, creato_il) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (codice, tipo, marca, modello, targa, matricola, prop, ditta, piva, iso(dal), iso(al), stato, ubi,
                 assegnato if stato == "in_uso" else None, note, ts))
            mid = cur.lastrowid
            utente = "marta.colombo" if prop == "proprio" else "a.mangiagi"
            # arrivo in anagrafica: i propri al deposito, i noli direttamente dove servono
            prima = self.ubi["deposito"] if prop == "proprio" else (ubi or self.ubi["deposito"])
            self.sposta_mezzo(ts, mid, None, prima, "disponibile", "manuale" if prop == "proprio" else "vfp", utente,
                              "Registrazione in anagrafica" if prop == "proprio" else f"Nolo da {ditta}")
            self.attivita(ts, utente, "crea", "mezzo", mid, tipo)
            # poi gli spostamenti fino allo stato di oggi
            passi = []
            if stato == "in_uso":
                passi.append((self.r.randint(3, 12), ubi, "in_uso", f"in uso da {assegnato}"))
            elif stato == "manutenzione":
                passi.append((self.r.randint(15, 25), self.ubi["101-003"], "in_uso", "in uso da Fabio Restivo"))
                passi.append((self.r.randint(2, 6), ubi, "manutenzione", note or ""))
            elif stato == "fermo":
                passi.append((self.r.randint(20, 30), self.ubi["C-2024-015"], "in_uso", "in uso da Giuseppe Leotta"))
                passi.append((self.r.randint(7, 12), ubi, "fermo", note or ""))
            elif stato == "restituito":
                passi.append((-dal - 2, self.ubi["C-2024-015"], "in_uso", "in uso da Salvatore Grasso"))
                passi.append((-al, None, "restituito", "Ritirata dal noleggiatore"))
            elif stato == "disponibile" and ubi != prima:
                passi.append((self.r.randint(5, 15), ubi, "disponibile", "Spostata per il getto"))
            da = prima
            for giorni_fa, a, st, nota in passi:
                ts = self.quando(giorni_fa)
                utente = self.r.choice(UTENTI)
                self.sposta_mezzo(ts, mid, da, a, st, self.r.choice(("manuale", "scansione")), utente, nota)
                self.attivita(ts, utente, "sposta", "mezzo", mid,
                              st + (f" a {self.nomi_ubi[a]}" if a else "") + (f", {nota}" if nota.startswith("in uso") else ""))
                da = a

    # ----------------------------------------------------------------- eventi di materiale (solo generati)
    def consegne(self):
        """Carichi dai DDT, come li scrive importa_ddt: una riga per articolo, con chiave di export e di riga."""
        for n, (giorni_fa, fornitore, dove, righe) in enumerate(CONSEGNE, start=1180):
            ts = self.quando(giorni_fa, (9, 15))
            giorno = ts[:10]
            commessa = dove if dove != "deposito" else "101-003"   # il DDT è sempre di una commessa
            export = f"{commessa}/export-{giorno}"
            rif = f"DDT {n} del {datetime.strptime(giorno, '%Y-%m-%d').strftime('%d/%m/%Y')}"
            for i, qta in righe:
                self.movimento(ts, "carico", self.art[i], qta, a=self.ubi[dove], origine="ddt", utente=UTENTE_DDT,
                               riferimento=rif, fornitore=fornitore, chiave_import=export,
                               chiave_riga=f"{export}#{n}#{i}", data=giorno,
                               note=None if dove != "deposito" else "Consegnato al deposito, destinato alla commessa")
            letto = self.quando(giorni_fa, (9, 20))
            self.c.execute(
                "INSERT INTO importazioni (ts, sorgente, file, chiave, impronta, righe, nuove, esito, dettaglio) "
                "VALUES (?, 'ddt', ?, ?, ?, ?, ?, 'ok', ?)",
                (letto, f"{config.DDT_DATA_DIR}\\{commessa}\\consegne.json", export, f"{giorno}T09:12:00",
                 len(righe), len(righe), f"{rif} di {fornitore}"))
            self.attivita(letto, UTENTE_DDT, "importazione", "ddt", None, f"{export}: {len(righe)} righe nuove")
        # una lettura della cartella dei mezzi a nolo e una andata male, per la pagina Importazioni
        self.c.execute(
            "INSERT INTO importazioni (ts, sorgente, file, chiave, impronta, righe, nuove, esito, dettaglio) "
            "VALUES (?, 'mezzi', ?, ?, ?, 1, 1, 'ok', ?)",
            (self.quando(18, (9, 40)), f"{config.MEZZI_VFP_DIR}\\2026-0147\\record.json", "2026-0147",
             "2026-10-26 09:31:02", "Escavatore gommato JCB Hydradig 110W, Noleggi Etna Srl"))
        self.c.execute(
            "INSERT INTO importazioni (ts, sorgente, file, chiave, impronta, righe, nuove, esito, dettaglio) "
            "VALUES (?, 'ddt', ?, ?, ?, 0, 0, 'errore', ?)",
            (self.quando(6, (9, 20)), f"{config.DDT_DATA_DIR}\\102-011\\consegne.json", "102-011/export-bozza", None,
             "Riga 4 senza quantità leggibile: export da rivedere nel Lettore DDT"))

    def trasferimenti(self):
        """Ogni settimana il magazziniere porta ai cantieri quello che serve (dal deposito)."""
        dep = self.ubi["deposito"]
        for settimana in range(6, 0, -1):
            for commessa, fabbisogno in FABBISOGNI.items():
                giorni_fa = settimana * 7 - self.r.randint(1, 3)
                ts = self.quando(giorni_fa, (7, self.r.randint(0, 50)))
                utente = self.r.choice(("marta.colombo", "a.mangiagi"))
                for i, qta in self.r.sample(fabbisogno, k=self.r.randint(4, 6)):
                    self.movimento(ts, "trasferimento", self.art[i], qta, da=dep, a=self.ubi[commessa],
                                   origine="scansione", utente=utente, riferimento=f"Consegna in cantiere {commessa}")

    def consumi(self):
        """Scarichi giornalieri nei cantieri, quasi tutti da scansione col telefono (quota del fabbisogno)."""
        for giorni_fa in range(GIORNI - 3, -1, -1):
            if (self.oggi - timedelta(days=giorni_fa)).weekday() >= 5:
                continue
            for commessa, fabbisogno in FABBISOGNI.items():
                if self.r.random() < 0.35:
                    continue
                for i, qta in self.r.sample(fabbisogno, k=self.r.randint(1, 3)):
                    parte = max(1, round(qta * self.r.uniform(0.15, 0.6)))
                    self.movimento(self.quando(giorni_fa), "scarico", self.art[i], parte, da=self.ubi[commessa],
                                   origine="scansione", utente=CAPI[commessa], note=self.r.choice(
                                       ("", "", "Getto fondazioni", "Posa sottoservizi", "Armatura solaio",
                                        "Muratura piano terra", "Consegna squadra")))

    def rettifiche(self):
        dep = self.ubi["deposito"]
        self.movimento(self.quando(22, (16, 5)), "rettifica", self.art[23], 4, da=dep, utente="marta.colombo",
                       note="Due paia rovinate e due mancanti al conteggio")
        self.movimento(self.quando(14, (15, 40)), "rettifica", self.art[14], 3, a=self.ubi["C-2024-015"],
                       utente="fabio.restivo", note="Travetti trovati dietro la baracca, mai scaricati")
        self.movimento(self.quando(9, (16, 20)), "rettifica", self.art[2], 2, da=self.ubi["102-011"],
                       utente="salvatore.grasso", note="Sabbia dilavata dalla pioggia")
        # inventario di fine mese al deposito: il conteggio reale si decide quando si applica (differenza nota)
        for i, differenza in ((0, -3), (11, -2), (22, 1)):
            self.evento(self.quando(5, (17, 10)), genere="inventario", art=self.art[i], ubi=dep,
                        differenza=differenza, utente="a.mangiagi")

    def sotto_scorta(self):
        """Qualche articolo deve restare sotto la scorta minima: è quello che la plancia segnala.
        Quanto scaricare lo si decide quando l'evento viene applicato (si conosce la giacenza di allora)."""
        for i, lascia in ((12, 2), (20, 9), (22, 6), (18, 1)):
            self.evento(self.quando(2, (10, self.r.randint(0, 59))), genere="sotto_scorta", art=self.art[i], lascia=lascia)

    # ----------------------------------------------------------------- applicazione in ordine di data
    def _scrivi_movimento(self, ts, tipo, art, qta, da, a, origine, utente, riferimento=None, fornitore=None,
                          chiave_import=None, chiave_riga=None, note=None, data=None):
        """Scrive un movimento tenendo la giacenza in pari: mai sotto zero, si sposta quello che c'è."""
        if da is not None:
            disponibile = self.stock.get((art, da), 0)
            qta = min(qta, disponibile)
            if qta <= 0:
                return 0
            self.stock[(art, da)] = disponibile - qta
        if a is not None:
            self.stock[(art, a)] = self.stock.get((art, a), 0) + qta
        self.c.execute(
            "INSERT INTO movimenti (ts, data, tipo, articolo_id, quantita, da_ubicazione_id, a_ubicazione_id, riferimento, "
            "fornitore, origine, chiave_import, chiave_riga, utente, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ts, data, tipo, art, qta, da, a, riferimento, fornitore, origine, chiave_import, chiave_riga, utente, note))
        self.n["movimenti"] += 1
        if utente and utente != UTENTE_DDT:
            dove = " ".join(x for x in (f"da {self.nomi_ubi[da]}" if da else "", f"a {self.nomi_ubi[a]}" if a else "") if x)
            if origine == "scansione":
                self.attivita(ts, utente, "scansione", "articolo", art, self.codici_art[art])
            self.attivita(ts, utente, "movimento", "articolo", art, f"{tipo} {qta:g} {dove}")
        return qta

    def _applica(self, ts, ev):
        genere = ev.pop("genere")
        if genere == "movimento":
            self._scrivi_movimento(ts, **ev)
        elif genere == "inventario":
            giacenza = self.stock.get((ev["art"], ev["ubi"]), 0)
            contato = max(0, giacenza + ev["differenza"])
            delta = contato - giacenza
            if delta:
                self._scrivi_movimento(ts, "inventario", ev["art"], abs(delta), ev["ubi"] if delta < 0 else None,
                                       ev["ubi"] if delta > 0 else None, "manuale", ev["utente"],
                                       note=f"Inventario di fine mese: contati {contato:g}")
        elif genere == "sotto_scorta":
            art = ev["art"]
            da_togliere = sum(q for (a, _u), q in self.stock.items() if a == art) - ev["lascia"]
            dep = self.ubi["deposito"]
            # prima dal deposito, poi dai cantieri dove ce n'è di più: "consegnato alle squadre"
            dove = sorted(((u, q) for (a, u), q in self.stock.items() if a == art and q > 0),
                          key=lambda x: (x[0] != dep, -x[1]))
            capi = {self.ubi[k]: v for k, v in CAPI.items()}
            for u, q in dove:
                if da_togliere <= 0:
                    break
                da_togliere -= self._scrivi_movimento(ts, "scarico", art, min(q, da_togliere), u, None, "scansione",
                                                      capi.get(u, "a.mangiagi"), note="Consegnato alle squadre")

    def scrivi(self):
        for ts, _n, ev in sorted(self.eventi, key=lambda e: (e[0], e[1])):
            self._applica(ts, ev)
        for _ts, _n, riga in sorted(self.spostamenti, key=lambda e: (e[0], e[1])):
            self.c.execute(
                "INSERT INTO movimenti_mezzi (ts, mezzo_id, da_ubicazione_id, a_ubicazione_id, stato, origine, utente, note) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", riga)
            self.n["movimenti_mezzi"] += 1
        for _ts, _n, riga in sorted(self.attivita_buf, key=lambda e: (e[0], e[1])):
            self.c.execute(
                "INSERT INTO attivita (ts, utente, ip, azione, oggetto, oggetto_id, descrizione) VALUES (?, ?, ?, ?, ?, ?, ?)",
                riga)
            self.n["attivita"] += 1

    def carica(self):
        self.ubicazioni()
        self.articoli()
        self.mezzi()
        self.consegne()
        self.trasferimenti()
        self.consumi()
        self.rettifiche()
        self.sotto_scorta()
        self.scrivi()
        self.c.commit()


# --------------------------------------------------------------------------- comando

def conta(conn):
    out = {}
    for t in ("ubicazioni", "articoli", "mezzi", "movimenti", "movimenti_mezzi", "importazioni", "attivita"):
        out[t] = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    return out


def azzera(conn):
    for t in ("riepiloghi", "foto_mezzi", "attivita", "importazioni", "movimenti_mezzi", "movimenti", "mezzi",
              "articoli", "ubicazioni"):
        conn.execute(f"DELETE FROM {t}")
    conn.execute("DELETE FROM sqlite_sequence")
    conn.commit()


def verifica(conn):
    """(giacenze mai negative nel tempo, articoli sotto scorta): i due numeri che dicono se la demo è sana."""
    saldi, sotto_zero = {}, 0
    for r in conn.execute("SELECT articolo_id, quantita, da_ubicazione_id, a_ubicazione_id FROM movimenti ORDER BY ts, id"):
        if r["da_ubicazione_id"] is not None:
            k = (r["articolo_id"], r["da_ubicazione_id"])
            saldi[k] = saldi.get(k, 0) - r["quantita"]
            if saldi[k] < -1e-9:
                sotto_zero += 1
        if r["a_ubicazione_id"] is not None:
            k = (r["articolo_id"], r["a_ubicazione_id"])
            saldi[k] = saldi.get(k, 0) + r["quantita"]
    sotto_scorta = conn.execute(
        "SELECT COUNT(*) FROM (SELECT a.id FROM articoli a LEFT JOIN giacenze g ON g.articolo_id = a.id "
        "WHERE a.scorta_minima IS NOT NULL GROUP BY a.id HAVING COALESCE(SUM(g.quantita), 0) < a.scorta_minima)"
    ).fetchone()[0]
    return sotto_zero, sotto_scorta


def main(argv=None):
    ap = argparse.ArgumentParser(description="Dati di esempio del Magazzino Operativo")
    ap.add_argument("--azzera", action="store_true", help="svuota il database prima di caricare la demo")
    ap.add_argument("--conta", action="store_true", help="mostra solo quante righe ci sono")
    args = ap.parse_args(argv)

    database.init_db()
    conn = database.get_db()
    try:
        n = conta(conn)
        if args.conta:
            print(f"Database: {config.DB_PATH}")
            for t, v in n.items():
                print(f"  {t:16} {v}")
            return 0
        pieno = n["articoli"] or n["mezzi"] or n["movimenti"] or n["ubicazioni"] > 1
        if pieno and not args.azzera:
            print(f"Il database {config.DB_PATH} ha già dei dati ({n['articoli']} articoli, {n['mezzi']} mezzi, "
                  f"{n['movimenti']} movimenti).\nPer sostituirli con la demo: python crea_demo.py --azzera "
                  "(cancella TUTTO; i file delle foto restano su disco).", file=sys.stderr)
            return 1
        if args.azzera:
            azzera(conn)
            conn.close()
            database.init_db()                 # rimette il deposito predefinito
            conn = database.get_db()
        Demo(conn, date.today()).carica()
        n = conta(conn)
        sotto_zero, sotto_scorta = verifica(conn)
        print(f"Demo caricata in {config.DB_PATH}")
        print(f"  {n['ubicazioni']} ubicazioni, {n['articoli']} articoli, {n['mezzi']} mezzi")
        print(f"  {n['movimenti']} movimenti di materiale, {n['movimenti_mezzi']} spostamenti di mezzi, "
              f"{n['importazioni']} importazioni, {n['attivita']} righe di attività")
        print(f"  {sotto_scorta} articoli sotto scorta; giacenze sotto zero nel tempo: {sotto_zero}")
        return 0 if sotto_zero == 0 else 2
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
