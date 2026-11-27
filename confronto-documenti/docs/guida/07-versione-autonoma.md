<!-- "><(((º> sabusabu <º)))>< -->
# 7. Versione autonoma

[← Indice](README.md)

La versione autonoma è Confronto documenti **in una cartella sola**: si riceve
come file zip e funziona su qualunque PC Windows, senza la suite Cosedil, senza
Portale e senza installare niente. I documenti restano sul tuo computer.

Il programma è lo stesso descritto negli altri capitoli: cambiano solo l'avvio,
la chiusura e i documenti firmati.

## Avviarla

1. **Estrai tutto lo zip** (tasto destro sullo zip → *Estrai tutto*). Non
   avviare il programma da dentro lo zip: non troverebbe i suoi file.
2. Apri la cartella *Confronto Documenti* e fai doppio clic su
   **Confronto Documenti.exe**.
3. Compare una **finestra nera** e, dopo qualche secondo, la pagina del
   programma nel browser. Da qui in poi si usa come sempre: vedi
   [Il primo confronto](01-primo-confronto.md).

La prima volta Windows può mostrare l'avviso *PC protetto da Windows*: fai clic
su **Ulteriori informazioni** e poi su **Esegui comunque**. Compare perché il
programma è fatto in azienda e non ha una firma commerciale.

## Chiuderla

**Chiudi la finestra nera.** Finché resta aperta il programma è acceso; la
pagina nel browser da sola non lo spegne. Per riaprirlo, di nuovo doppio clic
sull'exe. Se fai doppio clic mentre è già aperto, si riapre soltanto la pagina.

## Cosa cambia rispetto al programma nella suite

| | Nella suite | Versione autonoma |
|---|---|---|
| Accesso | dal Portale, con il tuo utente | nessun login: lo usa chi è al PC |
| Chi lo raggiunge | i colleghi in rete | solo il PC su cui gira |
| PDF firmati `.p7m` | firma verificata (valida / non valida) | il documento si apre e si vedono i firmatari, ma compare **Firma non verificata** |
| Confronto da SkyTower | sì | no |
| Storico | per utente | quello del tuo PC, per 30 giorni |

Per sapere se una firma è valida usa un programma di firma (Dike, ArubaSign,
FirmaCerta…) oppure il Confronto documenti della suite.

## Da sapere

- Le cartelle `_internal` e `Tesseract-OCR` servono al programma: lasciale
  accanto all'exe. Per spostarlo, sposta **tutta** la cartella.
- Lo Storico sta in `%LOCALAPPDATA%\Confronto Documenti` (incolla questa riga
  nella barra di Esplora file). Resta anche se sostituisci la cartella del
  programma con una versione nuova.
- Per toglierlo dal PC: elimina la cartella del programma e quella dello Storico.

## Se qualcosa non va

| Succede | Cosa fare |
|---|---|
| La pagina non si apre da sola | Apri il browser e scrivi l'indirizzo che si legge nella finestra nera (di solito `http://127.0.0.1:5001`). |
| La finestra nera si chiude subito | Estrai di nuovo lo zip in una cartella nuova, ad esempio sul Desktop. Se l'antivirus ha bloccato dei file, chiedi all'assistenza informatica. |
| Le scansioni non vengono lette | Manca la cartella `Tesseract-OCR` accanto all'exe: estrai di nuovo lo zip. |
| Nella finestra nera c'è scritto che usa un'altra porta | Un altro programma occupa la solita. Funziona lo stesso; lo Storico fatto sull'altra porta lì non compare. |

Per gli altri casi vedi [Se qualcosa non va](05-problemi.md).

[← Per l'amministratore di sistema](06-amministratore.md)
