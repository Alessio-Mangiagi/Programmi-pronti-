<!-- "><(((º> sabusabu <º)))>< -->
# 5. Pannello di amministrazione

[← Indice](README.md)

Clicca il pulsante giallo **Admin** in alto a destra. Si apre il pannello, con le sezioni nel menu a sinistra:
**Account**, **Account attivi**, **Log accessi**, **DDT convalidati**, **Chiave API** e **Aiuto** (la guida
amministratore completa).

> Il pannello gestisce gli account **del Lettore DDT** (nome utente, password, commessa). Chi può aprire il
> Lettore DDT dal Portale, e chi ne è amministratore, si decide invece nel Portale: vedi la
> [guida del Portale](../../../portale/docs/guida/README.md). Servono entrambe le cose.

## Account

![Pannello Account](img/18-admin-account.png)

### Creare un account

Compila la riga in alto e clicca **Crea account**:

| Campo | Cosa scrivere |
|---|---|
| **Username** | lettere, numeri e `. _ @ -` (es. `marco.russo`); deve essere unico |
| **Password** | almeno 8 caratteri; l'utente la cambia al primo accesso |
| **Commessa** | il codice che separa i dati (es. `101-003`). Chi ha la stessa commessa condivide gli stessi dati |
| **Codice commessa aziendale (SkyTower)** | il codice ufficiale della commessa (es. `101-003`): con questo i PDF dei DDT finiscono anche nella commessa giusta di SkyTower. Vuoto = nessun invio a SkyTower |
| **Nome visualizzato** | il nome che compare in alto nel programma |
| **Admin** | spunta solo per chi deve amministrare |

### Importare molti utenti da Excel

Nel riquadro **Importa da Excel**: **Template** scarica un file d'esempio con le colonne *Username, Password,
Commessa, Nome visualizzato, Admin* (*sì*/*no*). Compilalo, sceglilo con **Scegli il file** e clicca **Importa
utenti**: il messaggio dice quanti account sono stati creati e quali righe sono state scartate e perché.
Il file contiene password in chiaro: cancellalo dopo l'importazione e non mandarlo per email.

### Gestire un account

Nella tabella, colonna **Azioni**:

- **Codice commessa**: cambia il codice commessa aziendale (quello di SkyTower);
- **Reset password**: imposta una password nuova (almeno 8 caratteri); comunicala all'utente;
- **Disabilita / Abilita**: sospende o riattiva l'accesso **senza cancellare niente** (preferibile);
- **Revoca**: elimina l'account per sempre (i dati della commessa restano). Chiede conferma.

Non puoi disabilitare o revocare te stesso né l'ultimo amministratore attivo. **Salva lista (CSV)** scarica
l'elenco degli account.

## Account attivi

Gli account che sono entrati almeno una volta negli **ultimi 30 giorni**, con l'ultimo accesso. Utile per
scoprire gli account mai usati.

![Account attivi](img/19-admin-account-attivi.png)

## Log accessi

Gli ultimi eventi: **Login OK**, **Login fallito**, login bloccati, **Logout**, account creati, revocati,
disabilitati, password cambiate, chiave API aggiornata, **DDT convalidato** (un utente ha cliccato *✓ Dati
convalidati*), **DDT firmato (.p7m)** (un utente ha caricato un DDT firmato digitalmente: sotto il bollino il
nome del file e l'esito della firma; bollino verde, rosso o giallo come l'esito). Per ognuno data e ora,
utente, commessa e indirizzo IP.
**Aggiorna** ricarica, la casella cerca per username, **Salva lista (CSV)** scarica.

![Log accessi](img/20-admin-log-accessi.png)

Molti *Login fallito* dello stesso utente = password dimenticata (proponi un reset) oppure qualcuno che prova
a indovinarla.

## DDT convalidati

Lo storico dei file Excel scaricati: data, utente, commessa, nome del file e **Stato convalida**
(*✓ Convalidato* / *✗ Da convalidare*). Sopra la tabella, il conteggio (*1 risultato*, *12 risultati*) segue
la ricerca.

![DDT convalidati](img/21-admin-ddt-convalidati.png)

Ogni Excel scaricato dalla scheda Importa entra come *✗ Da convalidare*; quando l'utente clicca **✓ Dati
convalidati** la **stessa riga** passa a *✓ Convalidato* con l'ora della convalida (dal 06/11/2026: prima il
pulsante non aggiornava lo stato). La convalida compare anche nel **Log accessi** come *DDT convalidato* e nel
registro del Portale come *Excel verificato · convalidato*. Nell'immagine: quattro Excel già convalidati e tre
ancora da convalidare (dati inventati).

## Chiave API

La chiave dell'API di Anthropic (inizia con `sk-ant-`) serve solo alla **Conversione automatica**.

![Chiave API](img/22-admin-chiave-api.png)

- **Stato attuale** mostra se c'è una chiave e da dove arriva, sempre **mascherata**: una volta salvata nessuno
  può rileggerla per intero.
- Per inserirla: incollala in **Nuova chiave** (spunta *Mostra mentre digito* per controllarla) e clicca
  **Salva (cifrata)**.
- **Rimuovi chiave salvata** la cancella: la conversione automatica smette di funzionare.

Se lo stato dice *"Origine: variabile d'ambiente ANTHROPIC_API_KEY"*, la chiave è impostata sul server e ha la
precedenza su quella salvata qui. Ogni salvataggio o rimozione finisce nel Log accessi.

[← Strumenti degli amministratori](04-strumenti-amministratori.md) · [Avanti: problemi frequenti →](06-problemi-frequenti.md)
