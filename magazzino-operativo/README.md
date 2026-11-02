<!-- "><(((º> sabusabu <º)))><" -->
# Magazzino Operativo

Webapp locale Cosedil per sapere **dove sta il materiale e quanto ce n'è**, e **dove
stanno i mezzi**, scansionando un codice a barre.

- **Scansione** con lettore USB/Bluetooth (scrive come una tastiera: il campo resta
  sempre a fuoco) o con la fotocamera del telefono/tablet.
- **Materiale**: giacenze per ubicazione (deposito, cantieri, officina), carichi,
  scarichi, trasferimenti, rettifiche e inventari.
- **Mezzi**: di proprietà o a nolo, con ubicazione, stato (disponibile, in uso,
  manutenzione, fermo, restituito) e storico degli spostamenti.
- **Alimentazione automatica**: i DDT estratti dal **Lettore DDT** diventano carichi
  nel cantiere della commessa; le pratiche dei mezzi a nolo di **VFP Transfer**
  diventano mezzi del magazzino.
- **Etichette** con Code 128 + QR, stampate dal browser su fogli A4 adesivi (24 per
  foglio, 70×37 mm).

Tutto gira **in locale**: Flask + SQLite, pagina unica senza build, porta `5200`.

---

## Installazione e avvio

1. **`installa.bat`**: crea `.venv` e installa Flask, waitress e `segno` (QR).
2. **`avvia.bat`** (o `avvia.vbs` senza finestra): prepara il database e apre il
   browser su http://127.0.0.1:5200. Dal Portale Suite parte da sola.

Serve Python 3.10 o superiore. Il database `magazzino.db` nasce al primo avvio e
non è versionato.

## Accesso

L'app monta il gate SSO del Portale (`shared/sso`): senza login nel portale non si
entra. Per lo sviluppo in locale `COSEDIL_SSO=off` (utente admin fittizio).

Gli **admin** dell'app nel portale (o gli username in `MAGAZZINO_ADMIN`) possono
eliminare articoli, mezzi, ubicazioni e movimenti. Tutti gli altri registrano
movimenti e aggiornano le anagrafiche.

## Come funziona

### Codici

Ogni voce ha un codice interno progressivo stampabile come etichetta:

| Prefisso | Cosa |
|---|---|
| `MAG-00001` | articolo (materiale) |
| `MEZ-00001` | mezzo |
| `UBI-00001` | ubicazione |

La scansione riconosce anche il **codice esterno** di un articolo (l'EAN del
fornitore, se c'è), la **targa** e la **matricola** di un mezzo. Chi digita invece di
scansionare ottiene dei suggerimenti.

### Giacenze

Non esiste una tabella delle giacenze: sono la **somma dei movimenti** per articolo
e ubicazione (vista SQL `giacenze`). Un errore si corregge con una rettifica o
cancellando il movimento sbagliato, e il totale torna da solo.

| Movimento | Effetto |
|---|---|
| carico | +quantità nell'ubicazione di arrivo (dal fornitore) |
| scarico | −quantità dall'ubicazione (consumo in cantiere) |
| trasferimento | −da una ubicazione, +nell'altra |
| rettifica | quantità con segno in una ubicazione |
| inventario | si scrive il conteggio reale, il movimento è la differenza |

Uno scarico oltre la giacenza viene rifiutato; la pagina chiede conferma e lo
registra comunque con `forza` (il DDT può non essere ancora arrivato).

### Importazione dai DDT

Il server rilegge ogni `MAGAZZINO_IMPORT_SEC` secondi (default 120) i registri
`lettore-ddt/data/<commessa>/consegne.json`. Ogni riga diventa un **carico** nel
cantiere della commessa (ubicazione creata se manca; se la destinazione scritta sul
DDT corrisponde al nome di un'ubicazione, si usa quella) dell'articolo con quella
descrizione e unità di misura (creato se manca).

- Un export risalvato dal Lettore DDT (`salvatoIl` nuovo) **sostituisce** le sue
  righe: niente doppioni.
- Dalla pagina **Importazioni** si può forzare la lettura o caricare a mano un
  `consegne.json` oppure un export grezzo (`json_exports/*.json`).

### Importazione dei mezzi a nolo

Le pratiche in `vfp-transfer/moduli_compilati/mezzi/<id>/record.json` diventano
mezzi **a nolo** (upsert per id pratica), posizionati nel cantiere della commessa
del contratto. Un mezzo poi spostato a mano non viene riportato indietro: la
pratica dice dove arriva, non dove sta oggi.

### Fotocamera

I browser danno la fotocamera solo in **contesto sicuro** (https o localhost). Dal
telefono quindi serve l'indirizzo https del portale (`SUITE_DOMINIO` + Caddy, vedi
README della suite); su `http://<ip>:5200` il bottone avvisa e non apre nulla. La
libreria di lettura (`html5-qrcode`) viene scaricata dal CDN alla prima apertura.

## Variabili d'ambiente

| Variabile | Default | Effetto |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `5200` | ascolto (il portale passa il suo HOST) |
| `MAGAZZINO_DB` | `magazzino.db` | percorso del database |
| `MAGAZZINO_DDT_DIR` | `../lettore-ddt/data` | cartella dati del Lettore DDT |
| `MAGAZZINO_MEZZI_DIR` | `../vfp-transfer-DMS/vfp-transfer/moduli_compilati/mezzi` | pratiche mezzi |
| `MAGAZZINO_IMPORT_SEC` | `120` | intervallo importazione automatica (0 = spenta) |
| `MAGAZZINO_ADMIN` | vuoto | username admin oltre agli admin del portale |
| `COSEDIL_SSO`, `COSEDIL_PORTAL`, `COSEDIL_SSO_FAIL` | vedi `shared/sso` | gate SSO |

## API principali

| Metodo e rotta | Cosa fa |
|---|---|
| `GET /api/scansione?codice=` | risolve un codice: articolo (giacenze + movimenti), mezzo (ubicazione + storico) o ubicazione |
| `GET /api/giacenze?q=&ubicazione_id=` | giacenze per articolo e ubicazione |
| `POST /api/movimenti` | `{tipo, articolo_id, quantita, da_ubicazione_id, a_ubicazione_id, riferimento, note}` |
| `POST /api/mezzi/<id>/sposta` | `{a_ubicazione_id, stato, note}` |
| `GET/POST/PUT/DELETE /api/articoli`, `/api/mezzi`, `/api/ubicazioni` | anagrafiche |
| `POST /api/importazioni/ddt`, `/mezzi` | lettura delle cartelle (`{forza: true}` rilegge tutto) |
| `POST /api/importazioni/upload` | JSON del Lettore DDT caricato a mano |
| `GET /etichette?tipo=articoli&ids=1,2` | foglio etichette da stampare |
| `GET /api/codici/<codice>.svg?formato=code128\|qr` | il solo codice a barre |

## File

| File | Cosa |
|---|---|
| `app.py` | server Flask e API |
| `database.py` | schema SQLite e vista `giacenze` |
| `codici.py` | Code 128 in SVG, QR (segno), codici progressivi, riconoscimento scansioni |
| `importa_ddt.py` | lettura dei registri e degli export del Lettore DDT |
| `importa_mezzi.py` | lettura delle pratiche mezzi di VFP Transfer |
| `templates/index.html`, `static/` | pagina unica (stile Cosedil) |
| `templates/etichette.html` | foglio etichette |
| `tests/` | `python -m pytest tests/ -q` |
