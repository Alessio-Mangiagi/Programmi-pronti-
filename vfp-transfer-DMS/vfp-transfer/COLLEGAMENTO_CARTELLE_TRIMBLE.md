<!-- "><(((º> sabusabu <º)))><" -->
# Collegare email e dati DMS/CPM alle cartelle Trimble (Viewpoint For Projects)

Proposta per decidere **in quale progetto e in quale cartella di Viewpoint For Projects (VFP)** finisce ogni
documento che arriva per email o dall'archivio (DMS/CPM).

**Situazione attuale:** tutti gli allegati email finiscono in un'unica cartella ("Posta in arrivo") di un unico
progetto VFP, impostata nel file `.env`. I trasferimenti da archivio usano la struttura delle cartelle di
origine oppure un CSV compilato a mano.

**Proposta:** una **tabella di regole** che, per ogni file, sceglie progetto e cartella in base ai dati
disponibili (codice commessa, codice del documento, mittente, parole chiave). Le regole si leggono dall'alto e
vale **la prima che corrisponde**; ciò che nessuna regola riconosce va in **"Da smistare"**, mai in una
cartella a caso.

---

## 1. Quali dati usare, dal più affidabile al meno affidabile

| Dato | Dove si trova | Esempio | A cosa serve |
|---|---|---|---|
| **Codice commessa** | oggetto dell'email, nome del file, metadati DMS/CPM | `C26-014` | Scegliere il **progetto VFP** (una commessa = un progetto), tramite una tabella `commessa → ID progetto VFP` |
| **Codifica del documento** | nome del file | `PL-001`, `ST-010_revB` | Scegliere la **cartella per disciplina** (PL → Architettonico/Piante, ST → Strutture, IE → Impianti/Elettrico) e leggere la **revisione** (`_rev1`, `_revB`) |
| **Mittente o dominio** | indirizzo email | `@labetna.it`, `@edilsud.it` | Cartelle per fornitore o per tipo (Certificazioni, Fornitori/Calcestruzzo), usando l'anagrafica fornitori del CPM |
| **Parole chiave** | oggetto dell'email | "DDT", "Certificato", "Verbale", "SAL" | Tipo di documento, quando mancano i codici |

### Il codice commessa è il dato più importante

Se oggi non compare in modo regolare nelle email, conviene chiedere a fornitori e progettisti di inserirlo
nell'oggetto con un formato fisso, ad esempio:

```
[C26-014] DDT 0457 consegna calcestruzzo
```

È la regola più semplice da far rispettare e rende affidabile tutto il resto.

---

## 2. La tabella delle regole

Un file CSV modificabile in Excel (`regole_instradamento.csv`), più una schermata nelle Impostazioni del
programma per gestirlo senza aprire il file.

```
ordine;campo;condizione;valore;progetto;cartella;revisione
1;oggetto;regex;\[(C\d{2}-\d{3})\];{commessa};Posta in arrivo/{tipo};
2;nome_file;inizia_con;ST-;{commessa};Strutture;da_nome_file
3;dominio;uguale;labetna.it;{commessa};Certificazioni/Laboratorio;
4;oggetto;contiene;DDT;{commessa};Contabilità/DDT/{anno};
9;*;*;*;Smistamento;Da smistare;
```

| Colonna | Significato |
|---|---|
| `ordine` | Ordine di lettura: vale la prima regola che corrisponde |
| `campo` | Dove guardare: `oggetto`, `nome_file`, `mittente`, `dominio`, oppure un metadato del DMS (`commessa`, `disciplina`, `tipo`) |
| `condizione` | `uguale`, `contiene`, `inizia_con`, `regex` |
| `valore` | Il testo o lo schema da cercare |
| `progetto` | Progetto VFP: codice commessa (tradotto nell'ID VFP con la tabella commesse) oppure segnaposto |
| `cartella` | Percorso della cartella VFP, con sottocartelle separate da `/` |
| `revisione` | Vuoto = revisione predefinita; `da_nome_file` = letta dal nome (`_rev1`, `_revB`) |

**Segnaposti** utilizzabili in `progetto` e `cartella`, per non scrivere una regola per ogni cartella:

| Segnaposto | Valore |
|---|---|
| `{commessa}` | Codice commessa riconosciuto (oggetto, nome file o metadato DMS) |
| `{tipo}` | Tipo di documento (DDT, Certificato, Verbale, ...) |
| `{anno}` | Anno di arrivo o di emissione |
| `{mittente}` | Nome del mittente o del fornitore (dall'anagrafica CPM) |

Il report dei trasferimenti registra **quale regola** ha deciso ogni file: se qualcosa finisce nel posto
sbagliato si capisce subito perché e si corregge la regola.

---

## 3. La stessa tabella vale anche per l'archivio DMS/CPM

Il trasferimento di cartelle accetta già un CSV con la colonna `folder` (vedi `manifest.example.csv`).
Basta generare quel CSV dall'export del DMS, facendo passare i metadati (commessa, disciplina, tipo, codice,
revisione) nella stessa tabella di regole. **Una sola logica per email e archivio.**

---

## 4. Accorgimenti

- **Uno scheletro di cartelle uguale in tutti i progetti VFP.** Le regole puntano a percorsi fissi e non si crea disordine.
- **Il programma non crea mai progetti VFP da solo.** Se la commessa non è nella tabella, il file va in "Da smistare".
- **Colonna "Da smistare" nel Flusso posta, con un pulsante *Assegna*.** Chi smista sceglie la cartella e il
  programma propone di salvare la scelta come nuova regola: le regole crescono con l'uso.
- **Pulizia dei nomi**: accenti, maiuscole e minuscole, caratteri non ammessi, limite di 100 caratteri di VFP.
- **Proposte con l'intelligenza artificiale** per i casi non riconosciuti, sempre confermate da una persona:
  si possono valutare in un secondo momento. Partire con regole fisse è più prevedibile e più facile da controllare.

---

## 5. Cosa serve per realizzarlo

| # | Informazione | Chi può fornirla |
|---|---|---|
| 1 | Formato del **codice commessa** e se il **CPM** (indicare il software) può esportare l'elenco commesse con l'ID del progetto VFP corrispondente | Ufficio commesse / IT |
| 2 | **Codifica dei nomi file** usata oggi, se esiste: prefissi per disciplina, come si scrivono le revisioni | Ufficio tecnico |
| 3 | **Scheletro di cartelle** da usare in ogni progetto VFP | Ufficio tecnico / responsabili di commessa |
| 4 | Elenco dei **mittenti ricorrenti** (fornitori, laboratori, studi di progettazione) con la cartella di destinazione | Acquisti / ufficio tecnico |

Con queste informazioni si realizzano la tabella di regole e la colonna "Da smistare" con *Assegna*.

---

## Nota tecnica: avvio del programma

Verificato sul PC di sviluppo con `avvia_interfaccia.bat`:

| Caso | Risultato |
|---|---|
| Programma spento | Parte e apre la pagina |
| Programma già acceso | Apre solo la pagina, senza avviare un secondo programma |
| Programma acceso con una versione vecchia | La versione vecchia si chiude da sola (mai durante un caricamento) e parte quella aggiornata |
| PC senza Python | Messaggio chiaro con il link per installarlo (non scambia più la scorciatoia del Microsoft Store per Python) |

In caso di problemi i dettagli sono nel file `logs\vfp_servizio.log`.
