# Guida Importazione Utenti da Excel

## Come funziona

<!-- "><(((º> sabusabu <º)))><" -->

La sezione **"Importa da Excel"** nella pagina Admin permette di caricare più utenti contemporaneamente da un file Excel o CSV.

## Formato del file

Il file deve contenere le seguenti colonne (con nomi esatti):

| Colonna | Obbligatorio | Descrizione |
|---------|-------------|-------------|
| **Username** | ✓ Sì | Nome utente univoco |
| **Password** | ✓ Sì | Password (minimo 8 caratteri) |
| **Commessa** | ✓ Sì | Codice della commessa |
| **Nome visualizzato** | ✗ No | Nome completo da visualizzare |
| **Admin** | ✗ No | `sì` o `no` (default: `no`) |

## Passaggi per importare

1. **Scarica il template** 
   - Clicca su "📥 Template" per scaricare un file di esempio

2. **Compila il file**
   - Aggiungi le righe con gli utenti che vuoi creare
   - Rispetta il formato delle colonne
   - Salva il file come `.xlsx`, `.xls` o `.csv`

3. **Carica il file**
   - Clicca su "Seleziona un file" e scegli il tuo file
   - Clicca su "Importa utenti"

4. **Visualizza i risultati**
   - Leggi il messaggio di stato per vedereçuanti utenti sono stati creati
   - Se ci sono errori, vedrai i dettagli dei problemi

## Esempio di file

```
Username          | Password      | Commessa  | Nome visualizzato | Admin
==================|===============|===========|===================|======
mario.rossi       | SecurePass123 | COMM001   | Mario Rossi       | no
giulia.verdi      | SecurePass456 | COMM002   | Giulia Verdi      | sì
luca.bianchi      | SecurePass789 | COMM001   | Luca Bianchi      | no
```

## Validazione

Durante l'importazione, il sistema controlla:
- ✓ Username non vuoto
- ✓ Password non vuota e lunga almeno 8 caratteri
- ✓ Commessa non vuota
- ✓ Ogni username sia unico nel sistema

Se un utente non passa la validazione, verrà saltato e vedrai il motivo dell'errore.

## Risultati possibili

- **✓ Successo (verde)** - Tutti gli utenti importati correttamente
- **⚠️ Avvertenza (giallo)** - Alcuni utenti importati, altri no
- **✗ Errore (rosso)** - Nessun utente importato, problemi nel file

## Note importanti

- Se uno username esiste già, l'importazione fallirà per quel record
- Le password importate sono definite in chiaro nel file (fai attenzione alla sicurezza)
- Puoi importare un numero illimitato di utenti
- Dopo l'importazione, la lista degli account e i log si aggiornano automaticamente

## Troubleshooting

**"Il file non contiene dati"**
- Verifica che il file abbia almeno una riga di dati (non solo intestazioni)

**"Username mancante"**
- Assicurati che la colonna si chiami esattamente "Username" (maiuscola)

**"Password deve avere almeno 8 caratteri"**
- Tutte le password devono avere minimo 8 caratteri

**"Errore lettura file"**
- Prova a salvar il file come `.xlsx` o `.csv`
- Verifica che il file non sia corrotto

---

Per domande o problemi, consulta l'amministratore del sistema.
