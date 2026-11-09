<!-- "><(((º> sabusabu <º)))>< -->
# 6. Problemi frequenti e messaggi

[← Indice](README.md)

| Messaggio o situazione | Cosa significa | Cosa fare |
|---|---|---|
| Vengo mandato alla pagina di login del Portale / *"Accesso richiesto: entra dal Portale Suite Cosedil"* | Il Lettore DDT si apre solo dal Portale | Entra nel Portale e clicca la scheda Lettore DDT ([guida del Portale](../../../portale/docs/guida/README.md)) |
| Nel Portale non c'è la scheda DDT e Magazzino | Non sei abilitato né al Lettore DDT né al Magazzino | Chiedi l'abilitazione all'amministratore del Portale |
| Si apre la finestra **In che commessa lavori?** | È l'inizio della sessione: la commessa si sceglie una volta | Scegli la commessa e **CONFERMA**; la cambi quando vuoi da **CAMBIA COMMESSA** nella barra in alto |
| *"Il registro delle commesse della suite è vuoto"* | Nel Portale non ci sono ancora commesse | Chiedi a un amministratore di aggiungerle (*Portale › Commesse*); intanto **CONTINUA** lavora nella cartella del tuo account |
| *"Il magazzino li registrerà appena acceso"* | In quel momento il Magazzino non rispondeva | Niente: i carichi li prende da solo appena riparte (al massimo dopo due minuti) |
| *"Sto avviando il magazzino…"* (sezione Magazzino) | Il Magazzino si sta accendendo | Aspetta qualche secondo: la pagina si ricarica da sola |
| *"Il magazzino non è acceso. Avvisa un amministratore."* | Il Magazzino non parte da solo su questo server | Avvisa l'amministratore di sistema (capitolo 7) |
| **Credenziali non valide** | Nome utente o password del Lettore DDT sbagliati | Ricontrolla maiuscole/minuscole. Dopo 5 errori attendi 15 minuti |
| **Account disabilitato** | L'amministratore ha sospeso l'account | Chiedi di riattivarlo |
| **Errore di connessione al server** | Il Lettore DDT non risponde | Ricarica la pagina; se persiste riaprilo dal Portale o avvisa l'amministratore |
| **Incolla prima la risposta di Claude** | Il riquadro è vuoto | Incolla la risposta di Claude |
| **JSON non valido: …** / **Campo "sheets" mancante** | Hai incollato solo una parte della risposta, o del testo in più | In Claude usa il pulsante *Copia* del blocco e incolla di nuovo tutto |
| **Copia il prompt manualmente** | Il browser non ha dato accesso agli appunti | Riprova il pulsante; se continua, consenti gli appunti al sito |
| La finestra di Claude non si apre | Il browser blocca i popup | Consenti i popup per il Lettore DDT o apri claude.ai a mano |
| Controllo rosso **DDT già estratti in …** | Quel DDT è già stato convertito | Verifica: se è un doppione, non scaricare di nuovo |
| Controllo rosso **Conteggio DDT incoerente** o **Totale m³ incoerente** | Claude ha saltato o letto male una riga | Confronta con il PDF; chiedi a Claude di ricontrollare o rifai la chat |
| **Solo file PDF consentiti** / **Solo file PDF (anche firmati digitalmente .p7m) sono consentiti** | Hai trascinato un file che non è né PDF né `.p7m` | Trascina solo PDF o DDT firmati `.p7m` |
| **File firmato illeggibile: …** | Il file `.p7m` è rotto, troncato o contiene solo la firma senza il documento | Chiedi al fornitore di rimandarlo |
| **Il file firmato non contiene un PDF** | Dentro la busta `.p7m` c'è un altro tipo di file (per esempio una fattura XML) | Non è un DDT da convertire qui |
| **Documento firmato digitalmente (.p7m): il componente per aprirlo non è installato…** | Sul server manca il motore della firma digitale | Avvisa l'amministratore di sistema (capitolo 7) |
| Bollino rosso **Firma NON valida** | Il documento è stato modificato dopo la firma, o il certificato è revocato o scaduto | La conversione va avanti; segnala la cosa a chi ha mandato il DDT |
| Bollino giallo **Firma da verificare** | Ente non negli elenchi ufficiali, certificato non qualificato o stato del certificato non controllabile (rete) | Passa il mouse sul bollino per il motivo; se è la rete, riprova più tardi |
| **Foglio 'Output C.D.' non trovato!** | L'Excel non è nel formato di progetto | Usa il file con il foglio *Output C.D.* |
| Non vedo le schede Archivio, Fornitori, Conversione automatica | Sono riservate agli amministratori | Normale per un utente |
| **Accesso amministratore richiesto** | Sei admin nel Lettore DDT ma non nel Portale (o viceversa) | Fatti abilitare come amministratore del Lettore DDT nel Portale |
| **API key Anthropic mancante** (Conversione automatica) | Manca la chiave dell'API | Inseriscila in Admin › Chiave API |
| Password dimenticata | — | L'amministratore fa *Reset password*, poi la cambi tu |

[← Pannello di amministrazione](05-pannello-admin.md) · [Avanti: appendice per l'amministratore di sistema →](07-amministratore-di-sistema.md)
