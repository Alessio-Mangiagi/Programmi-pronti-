<!-- "><(((º> sabusabu <º)))>< -->
# Firma digitale (.p7m) per tutta la suite

Richiesta del 06/11/2026: i programmi che aprono PDF devono leggere anche i **PDF firmati digitalmente in
busta `.p7m` (CAdES)** e fare la **verifica completa** della firma con i certificati degli enti riconosciuti.

Un solo motore, qui, usato da tutti:

| Programma | Come lo chiama |
|---|---|
| Lettore DDT, OCR Documenti, Verifica Requisiti, Ponte Trimble (Node) | `shared/firma/firma.js` (o `firma.mjs`) |
| SkyTower, Confronto Documenti (Python) | `shared/firma/busta.py` |

I due client non hanno dipendenze: eseguono `firma.py` con l'ambiente Python di `shared/firma/.venv`, dove
stanno le librerie di verifica (`pyhanko-certvalidator`, `asn1crypto`, `cryptography`, `requests`).

## Installazione

`shared\firma\installa.bat` (una volta, serve la rete): crea `.venv` con Python 3.12, installa
`requirements.txt` e scarica gli elenchi ufficiali. Gli `avvia.bat` dei programmi lo lanciano da soli se `.venv`
manca. Se più programmi partono insieme al primo avvio, la cartella `.installazione.lock` fa installare uno alla
volta (gli altri aspettano; un lock abbandonato da un'installazione interrotta si scavalca dopo 5 minuti). Su Linux/Docker: un Python con `requirements.txt` e la variabile `FIRMA_PYTHON` che punta a lui.
Lo lancia anche `InstallaSuite.exe` / `installa-suite.py` insieme ai programmi che lo usano.

**Installazione alla prima busta.** Se un programma riceve un `.p7m` e il motore c'è ma `.venv` manca (programma
avviato senza il suo `avvia.bat`, exe copiato su un altro PC), il client lancia da solo `installa.bat` in disparte
(solo Windows, solo senza `FIRMA_PYTHON`) e risponde "in installazione, riprovare fra qualche minuto". Al massimo
un tentativo ogni 10 minuti per processo: se finisce senza `.venv` (manca Python 3.12, niente rete) il messaggio
dice quale `installa.bat` lanciare a mano.

**Dove si cerca il motore** (stesso ordine in `firma.js` e `busta.py`, vince la prima cartella con `firma.py`):

1. `FIRMA_DIR`, se impostata (un motore installato altrove);
2. `<cartella dell'eseguibile>\shared\firma`: per i programmi impacchettati in un `.exe`, dove il client sta dentro
   l'eseguibile e Python non potrebbe leggere `firma.py` né creare `.venv`;
3. la cartella del client stesso (programmi lanciati dal repo o da una copia della suite).

**Programmi impacchettati.** `copia-motore.bat DESTINAZIONE` copia qui i soli sorgenti (niente `.venv`, che ha
percorsi assoluti e si crea sul PC di destinazione, niente cache, lock e test). Lo usano
`confronto-documenti\build-exe.bat` (ConfrontaPDF.exe con `shared\firma` accanto) e
`lettore-ddt\installer-pkg\build-installer-pkg.bat` (server.exe; l'installer copia il motore in
`{app}\shared\firma`, lo prepara a fine installazione e il watchdog ci riprova a ogni avvio). Sul PC di
destinazione per i `.p7m` serve Python 3.12; il resto del programma funziona anche senza.

## Cosa fa

1. **Apre la busta** e restituisce il documento contenuto (di solito il PDF), anche se:
   - la busta è in base64 o PEM (frequente nelle PEC);
   - ci sono buste una dentro l'altra (`.p7m.p7m`, più firmatari "a matrioska");
   - il file non ha l'estensione `.p7m` (riconosciuto dal contenuto).
2. **Verifica ogni firma**:
   - **integrità**: l'impronta del documento è quella firmata e la firma crittografica è corretta;
   - **legame col certificato** (attributo ESS signing-certificate, se presente);
   - **catena** fino a un ente certificatore **qualificato** degli elenchi ufficiali eIDAS (Trusted List), nello
     stato "concesso" alla data di riferimento (vale la storia: un ente oggi cessato vale per le firme di allora);
   - **revoca**: OCSP o CRL scaricati dagli indirizzi del certificato;
   - **scadenza** alla data di riferimento;
   - **marca temporale** dentro la firma (CAdES-T): se valida, la data di riferimento è la sua, altrimenti è oggi
     (regola italiana: senza marca la firma vale se il certificato è valido adesso). Se il certificato è scaduto
     senza marca, il rapporto dice anche se era valido alla data di firma dichiarata (non provata);
   - **tipo**: firma digitale (certificato qualificato su dispositivo sicuro), firma elettronica qualificata,
     firma elettronica (certificato non qualificato).

Esito per firma e per busta (il peggiore fra le firme):

| Esito | Quando |
|---|---|
| `valida` | integra, catena fino a un ente qualificato, non revocata, valida alla data di riferimento, certificato qualificato |
| `non valida` | documento modificato dopo la firma, firma crittografica sbagliata, certificato revocato, scaduto senza marca temporale valida, catena falsa |
| `da verificare` | revoca non controllabile (niente rete, ente che non risponde), ente non presente negli elenchi, certificato non qualificato, marca temporale non valida, elenchi non ancora scaricati |

`riepilogo` è una riga pronta per le interfacce, per esempio
«Firma valida: Mario Rossi (InfoCert S.p.A.), 12/03/2024».

## Elenchi ufficiali

`FIRMA_ELENCHI=eu` (default): lista delle liste europea e da lì le Trusted List di tutti gli Stati, compresa
quella italiana di AgID; `it`: solo `https://eidas.agid.gov.it/TL/TSL-IT.xml`. Il risultato, ridotto ai servizi
che servono (enti di certificazione qualificati e di marcatura temporale), sta in `cache/elenchi.json` (fuori da
git, circa 9 MB, rigenerabile). Se manca si scarica subito; se ha più di `FIRMA_ELENCHI_ORE` ore (default 24) si
aggiorna in un processo separato e intanto vale quella vecchia. Prova del 06/11/2026: 28 elenchi su 32, 3.527
servizi, 869 enti di firma qualificati validi oggi, in 10 secondi; Austria, Grecia e altri due non si scaricano
perché la rete aziendale non ne risolve gli indirizzi. Una firma emessa da un ente di quei paesi risulta quindi
"da verificare".

**Limite dichiarato**: gli elenchi arrivano in HTTPS dagli indirizzi ufficiali, ma la firma XML degli elenchi non
è ricontrollata.

## Riga di comando

```
.venv\Scripts\python.exe firma.py apri contratto.pdf.p7m --estrai contratto.pdf   # rapporto JSON su stdout
.venv\Scripts\python.exe firma.py aggiorna-elenchi [--fonte eu|it]
.venv\Scripts\python.exe firma.py controlla FILE                                   # 0 = busta firmata
```

Opzioni di `apri`: `--nome` (nome originale se il file è temporaneo), `--senza-rete` (niente download: revoca
"da verificare"), `--senza-verifica` (solo estrazione), `--ancore CARTELLA` / `FIRMA_ANCORE_EXTRA` (certificati di
fiducia in più, per test o enti privati). Uscita 0 anche se la firma non è valida (lo dice il rapporto),
2 = busta illeggibile (`{"errore": …}`), 1 = errore inatteso.

## Uso dai programmi

```js
const firma = require('../shared/firma/firma.js')
if (firma.eBustaFirmata(buffer, nomeFile)) {
  const { contenuto, nomeContenuto, rapporto } = await firma.apri(buffer, nomeFile)
  // contenuto = PDF; rapporto.esito, rapporto.riepilogo, rapporto.firme[]
}
```

```python
from busta import e_busta_firmata, apri, FirmaNonInstallata, BustaIllegibile
if e_busta_firmata(dati, nome):
    pdf, nome_pdf, rapporto = apri(dati, nome)
```

Errori: `FIRMA_NON_INSTALLATA` / `FirmaNonInstallata` (motore non trovato o `.venv` mancante: il messaggio dice
già se l'installazione è partita da sola o cosa fare), `BUSTA_ILLEGGIBILE` / `BustaIllegibile`
(file rotto o firma staccata: messaggio leggibile per l'utente). Il documento originale firmato va conservato
dove conta il valore legale (SkyTower conserva il `.p7m`); gli altri programmi lavorano sul PDF estratto e
mostrano il riepilogo.

## Test

```
.venv\Scripts\python.exe test_firma.py      # 11 test, ente certificatore di prova creato al volo, niente rete
node --test firma.test.js                   # client Node
```

Casi: firma valida, documento alterato, buste annidate e base64, ente sconosciuto, certificato non qualificato,
revocato (CRL), revoca non controllabile, scaduto senza e con marca temporale, marca che non riguarda la firma,
file non firmato, .p7m rotto, storia degli stati negli elenchi, LOTL, client e riga di comando.
`python test_firma.py fixture CARTELLA` crea file di prova (ente di prova fuori dagli elenchi ufficiali) per i
test dei programmi.

Non ancora gestiti: firme staccate (`.p7s` + documento), buste con marca separata (`.tsd`, `.m7m`), PDF con la
firma dentro (PAdES: si leggono già come PDF normali, ma la firma non viene verificata).
