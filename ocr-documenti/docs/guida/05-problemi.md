<!-- "><(((º> sabusabu <º)))>< -->
# 5. Se qualcosa non va

[← Indice](README.md)

| Cosa succede | Cosa fare |
|---|---|
| **PaddleOCR non trovato** / **PaddleOCR bloccato** in alto | Le scansioni non si possono leggere (PDF con testo, Word ed Excel sì). Il motivo è nel suggerimento dell'indicatore: avvisa l'amministratore. |
| **Assist AI spento** | Normale: è facoltativo. |
| Il primo documento ci mette molto | Normale la prima volta dopo l'avvio: il motore si carica. |
| Excel con poche righe o righe mancanti | Elabora in formato **.MD** e guarda in fondo la sezione *TABELLA ARTICOLI (ricostruita dalla scansione)*: se è incompleta, quel modello di contratto non è ancora "tarato" — segnalalo con il PDF. Nel frattempo correggi in **Modifica**. |
| Celle rosse su PROGETTO/EPU | Commessa non nell'elenco ufficiale: correggi il codice o chiedi di aggiornare l'elenco. |
| Riquadro giallo con *somma righe ≠ importo lavori* | Mancano righe o l'importo di testata è diverso: controlla l'originale e correggi in **Modifica**. |
| *Modulo contratto non valido (N errori)* | Il modulo compilato a mano ha valori fuori formato: ogni errore dice la **riga** del file. Correggi, salva e premi **Scansiona** (vedi [4.4](04-formati-e-claude.md#44-modulo-contratto-i-dati-scritti-a-mano-letti-alla-lettera)). |
| Dopo *Converti in modulo contratto* il riquadro rosso dice che il modulo va completato | Il documento non riportava un dato obbligatorio, o un valore letto era fuori formato. Apri `<nome>_modulo.txt`, cerca le righe `# DA VERIFICARE`, compila i campi indicati e rimetti il file in coda. |
| Un modulo `.txt` viene mostrato come testo invece di essere elaborato | La prima riga del file deve essere esattamente `MODULO CONTRATTO OCR v1`: parti dal modulo vuoto scaricato. |
| *«Manca l'altro file»* | Hai una bozza Word senza PDF o viceversa: **Aggiungi l'altro file** o **Procedi senza**. |
| La scheda **Originale** è vuota | Il browser non riesce a mostrare il PDF dentro la pagina: usa **⋮ → Apri in un'altra finestra**. |
| Un contratto della coda è in rosso | Leggi il motivo sulla riga; gli altri vanno avanti. Rifallo con **Scansiona**. |
| Risultato vecchio senza tabella articoli | Rileggi il documento (**Rifai da capo**): **Riprocessa** non basta. |
| Gli Excel finiscono nei Download invece che nella cartella scelta | Il browser non permette di scegliere la cartella (solo Chrome/Edge lo fanno). |
| La pagina non risponde | Ricarica; se non basta, riavvia OCR Documenti dal Portale. |

[← Formati e Claude](04-formati-e-claude.md) · [Avanti: Per l'amministratore →](06-amministratore.md)
