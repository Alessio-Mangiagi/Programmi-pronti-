<!-- "><(((º> sabusabu <º)))>< -->
# 5. Se qualcosa non va

[← Indice](README.md)

| Cosa succede | Cosa fare |
|---|---|
| **Avvia confronto** resta grigio | Manca uno dei due documenti: riempi sia A sia B. |
| Il file non entra nel riquadro | Formato non supportato: usa PDF (anche firmato `.p7m`), immagine, Word `.docx` o testo. I vecchi `.doc` vanno salvati come `.docx`. |
| «… è firmato digitalmente (.p7m) ma il componente della firma digitale non è installato» | Il motore della firma della suite non è ancora pronto (si installa da solo al primo avvio, serve la rete): aspetta un minuto e rifai il confronto; se resta, avvisa l'amministratore. |
| «Firma staccata: la busta non contiene il documento» o «Busta firmata illeggibile» | Il `.p7m` è rotto oppure contiene solo la firma senza il documento: chiedi a chi l'ha mandato il file completo. |
| Firma **da verificare** con «Stato di revoca non controllabile» | Il programma non ha raggiunto l'ente certificatore (rete assente o ente che non risponde): rifai il confronto più tardi. |
| Il pannello cartella non mostra un file | Formato non supportato, oppure il nome non corrisponde a quanto scritto in *Cerca per nome…*. |
| Tante differenze "finte" su una scansione | Attiva **Confronto tollerante** e **Migliora scansioni**, o passa a **300 DPI · Preciso**. |
| Differenze su numeri di pagina o date in testa alla pagina | Lascia attivo **Ignora intestazioni ripetute**; per il resto usa le **Righe da ignorare** (es. `Pagina # di #`). |
| Mi aspettavo una differenza nell'intestazione e non c'è | Con **Ignora intestazioni ripetute** un cambio di solo numero (es. "Rev. 1" → "Rev. 2") viene ignorato: togli la spunta e rifai il confronto. |
| La fascia arancio dell'anteprima non è sul punto giusto | La sua posizione è stimata: guarda i riquadri rossi. |
| Un confronto non è più nello Storico | Sono passati più di 30 giorni, è stato eliminato, oppure era stato fatto da un altro utente o browser. |
| Messaggio «Hai già 3 confronti in coda: aspetta che finiscano.» oppure, dopo **Avvia N confronti**, «N confronti non sono partiti.» | Ogni utente può avere al massimo 3 confronti in attesa (più i 2 in lavorazione). Con molte coppie insieme le ultime vengono rifiutate: aspetta che lo Storico mostri finiti i primi, poi rilancia **Abbina versioni** spuntando solo le coppie mancanti. |
| La pagina non si apre o non risponde | Ricarica con **Ctrl+F5**. Se non basta, riavvia il programma dal Portale o avvisa l'amministratore. |
| Il Portale chiede di nuovo il login | La sessione del Portale è scaduta: rientra dal Portale e riapri Confronto documenti. |

[← Più confronti insieme e Storico](04-lotti-e-storico.md) · [Avanti: Per l'amministratore →](06-amministratore.md)
