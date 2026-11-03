<!-- "><(((º> sabusabu <º)))><" -->
# Collaudo con gli utenti pilota (UAT, G59)

Ambiente: staging con la commessa demo popolata (`cde demo-contenuti --api <staging>/api`).
Password degli utenti demo: quella del seed, comunicata a parte. Ogni scenario si esegue nel browser, senza
strumenti tecnici. Compilare **Esito** (OK / KO / Osservazione) e, se KO, descrivere cosa si è visto.

Criterio di accettazione: nessun KO **bloccante** (perdita o fuga di dati, impossibilità di completare un flusso
principale). I KO non bloccanti vanno nel piano di rientro con una data.

## Ruoli pilota

| Ruolo | Utente demo | Organizzazione |
|---|---|---|
| BIM Manager / Project Admin | `com.admin@com.example` | Committente (COM) |
| Information Manager | `com.im@com.example` | Committente (COM) |
| Direttore dei lavori | `com.dl@com.example` | Committente (COM) |
| Progettista capogruppo | `des.lead@des.example` | Studio di progettazione (DES) |
| Subappaltatore | `sub1.user@sub1.example` | Impianti elettrici (SUB1) |

## Copertura automatica

Questi scenari girano già a ogni merge come test nel browser (`apps/web/e2e`, `npm run e2e`): in collaudo
servono soprattutto a giudicare chiarezza e usabilità, non a cercare regressioni.

| Scenari | Test |
|---|---|
| U01, U04, U05 | `stati.spec.ts` |
| U02, U03, U19, U19b | `rinomina.spec.ts` |
| U06 (ricerca nel testo, annotazioni) | `viewer.spec.ts`, `annotazioni.spec.ts` |
| U07, U08, U09, U10 | `approvazione.spec.ts` |
| U11 (differenze in rosso/blu, verificate sui pixel) | `confronto.spec.ts` |
| U12 (caricamento, albero spaziale, vista 3D, selezione di un elemento) | `ifc.spec.ts` |
| U13, U14 | `rfi.spec.ts` |
| U15 | `transmittal.spec.ts` |
| U16, U17, U18 | `admin.spec.ts` |
| U20 | `riservate.spec.ts` |
| U21, U23 | `isolamento.spec.ts` |
| U22 | `profilo.spec.ts`, `mfa.spec.ts` |
| Anteprima Word/Excel/CSV | `office.spec.ts` |
| U24 | `filigrana.spec.ts` |
| U25 | `passkey.spec.ts` (autenticatore virtuale del browser) |
| U26 | `organizzazione.spec.ts` |
| U27 | `sso.spec.ts` (IdP finto) |
| U28 | `password.spec.ts` |
| U29 | `zip.spec.ts` |
| U30 | `segui.spec.ts` |
| U31 | `ricerca.spec.ts` |
| U32 | `passkey.spec.ts` |
| U33 | `ifc.spec.ts` |
| U34 | `gltf.spec.ts` |
| U35 | `naming-cartelle.spec.ts`, `test_api_folder_naming.py` |
| U36 | `derivato.spec.ts`, `test_ifc_derivative.py` |
| U37 | `segui.spec.ts`, `profilo.spec.ts`, `test_api_follow_digest.py` |
| U38 | `ocr.spec.ts`, `test_ocr.py` |
| U39 | `test_ocr.py` (`test_ri_ocr_dei_pdf_indicizzati_senza`) |
| U40 | `naming-cartelle.spec.ts`, `test_api_folder_naming.py` |
| U41 | `derivato.spec.ts`, `test_ifc_derivative.py` |
| U42 | `onlyoffice.spec.ts`, `test_api_office.py` (Document Server finto: su staging si prova quello vero) |
| U43 | `template.spec.ts`, `test_api_project_templates.py` |
| U44 | `workflow-import.spec.ts`, `test_api_workflow_import.py` |
| U46 | `test_api_workflows.py` (`test_escalation_ai_project_admin_e_ripetuta`), `test_api_suite.py` (`test_da_fare_scadenze_in_cima`) |
| U47 | `test_api_audit.py` (`test_verifica_firma_export`) |
| U49 | `test_api_portale.py`, `test_api_suite.py`, `test_security_fix.py` |

Tutti gli scenari hanno un test automatico: il collaudo serve a giudicare chiarezza, usabilità e resa visiva
(in particolare del modello IFC e del confronto tra revisioni), non a cercare regressioni.

## Scenari

| ID | Ruolo | Passi | Risultato atteso | Esito |
|---|---|---|---|---|
| U01 | Progettista | Carica un PDF con nome conforme (es. `PRJ01-DES-ZZ-01-DR-A-0101.pdf`) in "Tavole architettoniche" | Revisione P01.01 in WIP, badge "In verifica" poi "Verificato" | OK (03/11/2026, demo 101-003): ACI003-DES-ZZ-00-DR-A-0033 P01.01 WIP, verifica antivirus CLEAN |
| U02 | Progettista | Carica un file con nome qualsiasi e usa "Rinomina con progressivo" | Nome conforme proposto col progressivo; dopo il caricamento il nome originale è nelle note della revisione | OK (03/11/2026, demo 101-003): rinominato in ACI003-DES-ZZ-00-DR-A-0015, nome originale conservato nella revisione |
| U03 | Progettista | Carica tre file non conformi insieme | Numeri consecutivi nell'anteprima e identici dopo il caricamento | OK (03/11/2026, demo 101-003): anteprima consecutiva [16, 17, 18] (caricamento di tre file coperto da rinomina.spec) |
| U04 | Subappaltatore | Cerca il documento di U01 | Non visibile (WIP di un'altra organizzazione) | OK (03/11/2026, demo 101-003): WIP di DES invisibile al subappaltatore (ricerca vuota, dettaglio 404) |
| U05 | Progettista | Condivide il documento di U01 (WIP → SHARED) con motivazione | Revisione P01, visibile al team di coordinamento | OK (03/11/2026, demo 101-003): P01 SHARED con motivazione, visibile all'Information Manager |
| U06 | Information Manager | Apre il documento condiviso, cerca una parola nel testo del PDF, aggiunge un'annotazione | Occorrenze evidenziate; annotazione visibile agli altri con numero e stato | OK (03/11/2026, demo 101-003): PDF inline, ricerca nel testo ('reception' in 10 documenti), annotazione con stato OPEN vista dal progettista |
| U07 | BIM Manager | Avvia il workflow di revisione sul documento con l'Information Manager come verificatore | Compito nella colonna "Per me" del verificatore; il documento non accetta nuove revisioni | OK (03/11/2026, demo 101-003): compito 'Per me' del verificatore, nuova revisione rifiutata (423) finche' il workflow e' in corso |
| U08 | Information Manager | Rifiuta con commento | Il progettista riceve la notifica; il documento torna modificabile | OK (03/11/2026, demo 101-003): workflow REJECTED; il progettista che ha caricato riceve WORKFLOW_REJECTED anche se il workflow lo ha avviato il BIM Manager (corretto il 03/11, migrazione 0037) |
| U09 | Progettista | Carica la nuova revisione e la riconduce in approvazione; il verificatore approva | Revisione approvata, pubblicabile | OK (03/11/2026, demo 101-003): P02 condivisa, workflow APPROVED, revisione pubblicata C01 |
| U10 | BIM Manager | Pubblica (SHARED → PUBLISHED) | Revisione C01 visibile a tutti i membri, subappaltatore e Direttore dei lavori inclusi | OK (03/11/2026, demo 101-003): C01 PUBLISHED visibile a subappaltatore e DL |
| U11 | Progettista | Confronta due revisioni PDF | Rosso solo nella revisione aperta, blu solo in quella di confronto | OK (03/11/2026, demo 101-003): due revisioni PDF scaricabili inline per il confronto (differenze rosso/blu verificate sui pixel da confronto.spec) |
| U12 | Progettista | Apre il modello IFC, seleziona un elemento, lascia un'annotazione sull'elemento | Albero spaziale, proprietà e sezione funzionano; annotazione legata all'elemento | OK (03/11/2026, demo 101-003): IFC inline (derivato: None), annotazione legata all'elemento |
| U13 | Subappaltatore | Apre una RFI verso il progettista allegando un documento già caricato | Numero progressivo, destinatario notificato, scadenza visibile | OK (03/11/2026, demo 101-003): RFI-0004 con scadenza, progettista notificato (RFI_CREATED) e la vede fra le sue |
| U14 | Progettista + Subappaltatore | Il progettista risponde alla RFI; il subappaltatore, soddisfatto, la chiude (solo chi l'ha aperta puo' chiuderla) | Thread completo, stato chiuso, notifica al richiedente; al progettista il pulsante di chiusura non compare | OK (03/11/2026, demo 101-003): risposta ufficiale del progettista, chiusura dal subappaltatore richiedente (al progettista 403), thread completo, notifica RFI_ANSWERED al richiedente |
| U15 | BIM Manager | Emette un transmittal con due documenti pubblicati | Protocollo TRM-nnnn, PDF con elenco e impronte, ricevute dei destinatari | OK (03/11/2026, demo 101-003): TRM-0005, PDF con elenco e impronte (True), ricevuta di DES |
| U16 | BIM Manager | Cruscotto: individua il collo di bottiglia e apre l'elenco dei documenti | Numeri coerenti con i documenti di prova, drill-down funzionante | OK (03/11/2026, demo 101-003): totale 59 = somma stati {'WIP': 10, 'SHARED': 19, 'PUBLISHED': 30}; visibili all'admin 30 (WIP altrui esclusi); filtro disciplina A → 22 |
| U17 | BIM Manager | Esporta Excel registro documenti, approvazioni, RFI aperte | File apribili, colonne leggibili, nessuna formula eseguibile | OK (03/11/2026, demo 101-003): documents: 5 righe, intestazioni ['Commessa', 'ACI003 - 101-003 - Sede Acireale']; approvals: 5 righe, intestazioni ['Commessa', 'ACI003 - 101-003 - Sede Acireale']; rfis: 5 righe, intestazioni ['Commessa', 'ACI003 - 101-003 - Sede Acireale'] |
| U18 | BIM Manager | Registro attività: filtra per documento, verifica integrità, esporta CSV e PDF firmati | Catena integra, eventi degli scenari precedenti presenti | OK (03/11/2026, demo 101-003): 8 eventi sul documento (DOCUMENT_VIEWED, REVISION_UPLOADED); catena integra (1997 eventi); CSV e PDF firmati |
| U19 | BIM Manager | Scheda Naming: cambia il primo numero del progressivo e un valore proposto | Il successivo caricamento rinominato rispetta le nuove impostazioni | OK (03/11/2026, demo 101-003): impostazioni naming leggibili (auto_number={"field": "number", "start": 1, "series": ["originator", "type", "role"], "defau); cambio del primo numero coperto da rinomina.spec |
| U19b | Progettista | Scheda Naming: prenota 5 numeri con una nota, poi carica un file con uno dei nomi prenotati | I 5 identificativi compaiono come "Prenotato"; quello caricato passa a "Usato"; la serie di altri utenti riparte dopo i prenotati | OK (03/11/2026, demo 101-003): 5 numeri prenotati, il primo risulta usato dal documento caricato, gli altri rilasciati (numerazione automatica accesa dalla demo il 03/11) |
| U20 | BIM Manager | Crea un'area riservata; il progettista ne chiede l'accesso; l'admin approva | Accesso concesso solo dopo approvazione, revocabile | OK (03/11/2026, demo 101-003): accesso concesso dopo approvazione |
| U21 | Subappaltatore | Prova ad aprire l'indirizzo di un documento DES copiato da un collega | "Non trovato", nessun dettaglio rivelato | OK (03/11/2026, demo 101-003): 404 senza dettagli: {"error":{"code":"not_found","message":"Documento non trovata"}} |
| U22 | Tutti | Profilo: cambia nome e preferenze notifiche; attiva l'MFA | Modifiche salvate; il login successivo chiede il codice | OK (03/11/2026, demo 101-003): profilo e preferenze salvati e ripristinati; enrollment TOTP avviato (segreto+QR) e rimosso senza attivarlo (login con codice coperto da mfa.spec) |
| U23 | Tutti | Uso da tablet in cantiere: apre un PDF, zoom, annotazione | Leggibile e utilizzabile senza zoom del browser | Osservazione (03/11/2026, demo 101-003): da tablet (820x1180) cartelle e viewer leggibili; con il pannello annotazioni aperto la tavola al 50% resta tagliata sul lato sinistro (screenshot 31_tablet_pdf.png): da sistemare la larghezza del pannello sotto i 900 px |
| U24 | BIM Manager | Scheda Naming: attiva la filigrana sui PDF condivisi e pubblicati; un progettista apre e scarica un PDF condiviso | Il visualizzatore mostra "Filigranato"; ogni pagina, anche nel file scaricato, riporta nome, email, organizzazione, data e ora, IP, documento e revisione | OK (03/11/2026, demo 101-003): filigrana attiva su ['SHARED']: il PDF scaricato porta email, organizzazione, documento e revisione su ogni pagina |
| U25 | Tutti | Profilo → Sicurezza: aggiunge una chiave di sicurezza (YubiKey) o la passkey del telefono, poi esce e rientra | Al login, dopo la password, basta toccare la chiave; recovery code mostrati alla prima registrazione | Non provato (03/11/2026, demo 101-003): chiave hardware/passkey del telefono: serve un autenticatore fisico; coperto da passkey.spec con l'autenticatore virtuale |
| U26 | Admin di organizzazione | Menu del profilo → "La mia organizzazione e gli utenti": invita un collega, reinvia l'invito, disattiva e riattiva un utente, nomina un secondo amministratore | Email d'invito ricevuta; l'utente disattivato non accede più; l'ultimo amministratore non si può togliere | OK (03/11/2026, demo 101-003): collega invitato e reinvitato, disattivato (DISABLED) e riattivabile, nominato secondo admin; ultimo admin non rimovibile: piu di un admin, non provato |
| U27 | Admin di organizzazione + IT | Registra il CDE nel tenant Entra ID (runbook §3), configura il single sign-on nella pagina Organizzazione, prova la connessione; un collega entra con "Usa l'account aziendale (SSO)" | Accesso senza password del CDE; con l'obbligo attivo la password porta al login Microsoft; un account disattivato in Entra non entra più | Non provato (03/11/2026, demo 101-003): serve il tenant Entra ID (runbook par. 3); configurazione SSO leggibile (200); flusso coperto da sso.spec con IdP finto |
| U28 | Tutti | Sicurezza: accede da PC e da tablet, chiude dal PC la sessione del tablet, poi cambia la password | Il tablet torna al login; con la password nuova si entra, con la vecchia no | OK (03/11/2026, demo 101-003): 27 sessioni elencate, altra sessione chiusa (refresh: 401); password cambiata (vecchia 401) e ripristinata |
| U29 | Direttore dei lavori | Scarica una cartella intera e, dalle Aree CDE, una selezione di documenti pubblicati | Un solo ZIP con i file originali (PDF filigranati se previsto) ed elenco.csv con identificativi, revisioni e impronte SHA-256 | OK (03/11/2026, demo 101-003): ZIP con 3 file + elenco.csv (identificativo, revisione, impronta); selezione dalle Aree CDE coperta da zip.spec |
| U30 | Information Manager | Nel dettaglio di un documento clicca "Segui"; il progettista carica una nuova revisione e poi la condivide | Notifica a ogni passaggio che può vedere (la WIP di un'altra organizzazione no); "Seguito" si toglie con un clic | OK (03/11/2026, demo 101-003): seguito: 1 notifiche (['DOCUMENT_FOLLOWED']); 'Seguito' tolto con un clic |
| U31 | Progettista | Aree CDE: cerca una parola che compare solo dentro un PDF o un Word, con "anche nel testo dei file" | Il documento compare con un estratto e la parola evidenziata; un collega di un'altra organizzazione non trova i tuoi WIP | OK (03/11/2026, demo 101-003): 'reception' nel testo: 10 doc (Rilievo dello stato di fatto...), estratto: campo estratto non nella lista API; il subappaltatore non vede i WIP DES |
| U32 | Progettista | Dal profilo aggiunge la passkey del computer o del telefono; esce e nella pagina di accesso usa "Usa una passkey (senza password)" | Entra con PIN o impronta, senza email né password; il profilo indica che la chiave vale anche per l'accesso senza password | Non provato (03/11/2026): passkey del computer/telefono richiede un autenticatore reale; coperto da passkey.spec con l'autenticatore virtuale (verde) |
| U33 | Direttore dei lavori | Nel modello BIM seleziona un muro del piano terra | Vede lunghezza, spessore, altezza e volume, il piano con il livello 00, le tavole che citano il muro (estratto evidenziato) e quelle del piano; un clic apre la tavola in una nuova scheda con il muro già cercato | OK (03/11/2026, demo 101-003): nel modello demo nessuna tavola cita per nome gli elementi ('Muro': 0), tavole del piano 00: 2; misure e proprieta' nel viewer coperte da ifc.spec (verde) |
| U34 | Progettista | Carica un modello esportato da Blender in .glb e lo apre | Vede il modello 3D con i piani, seleziona un oggetto e ne legge misure e proprietà personalizzate; un file .blend indica come esportarlo | OK (03/11/2026, demo 101-003): nessun .glb nelle commesse demo; su PRJ01 'Modello di studio Padiglione C (Blender)' si apre inline come model/gltf-binary (viewer: gltf.spec) |
| U35 | Project Admin | Nella scheda Naming crea lo schema «Foto di cantiere» e lo applica alla cartella delle foto e alle sue sottocartelle dall'albero nel popup | Chi carica in quelle cartelle vede e usa il nuovo schema (anche nella rinomina automatica); le altre cartelle restano sullo schema della commessa; i documenti già caricati accettano nuove revisioni | OK (03/11/2026, demo 101-003): schema '[UAT] Foto di cantiere' applicato alla cartella foto; Verbali resta sullo schema della commessa |
| U36 | BIM Manager | Carica un IFC pesante e lo apre | Dopo la verifica il modello si apre nella versione ottimizzata in pochi secondi, con piani, proprietà e misure; l'interruttore riapre l'IFC originale | Non provato (03/11/2026, demo 101-003): nelle commesse demo non c'e' un IFC sopra la soglia del derivato; su PRJ01 il campus 4 padiglioni ha il derivato READY diviso in 24 piani (derivato.spec verde) |
| U37 | Information Manager | Segue alcuni documenti e lascia attivo "Documenti che seguo: via email solo nel riepilogo del mattino" | Gli avvisi dei documenti seguiti compaiono subito nel pannello (con il tipo) ma per email arrivano solo nel riepilogo, diviso per sezioni; i compiti arrivano subito | OK (03/11/2026, demo 101-003): preferenza 'Documenti che seguo: via email solo nel riepilogo' = True; avvisi nel pannello visti in U30; email solo nel log (CDE_MAILER=console) |
| U38 | Direttore dei lavori | Carica un verbale firmato e scansionato, poi cerca una parola del verbale con "anche nel testo dei file" | Il verbale si trova, con l'estratto evidenziato; se cita un elemento del modello compare in "Citato in" | OK (03/11/2026, demo 101-003): 'Verbale di sopralluogo (scansione firmata)' trovato cercando 'sopralluogo' nel testo dei file (OCR Tesseract) |
| U39 | Information Manager | Cerca con "anche nel testo dei file" una parola di un verbale scansionato caricato prima dell'aggiornamento con l'OCR | Entro qualche decina di minuti dall'aggiornamento il verbale si trova, senza ricaricarlo | Non provato (03/11/2026, demo 101-003): richiede documenti indicizzati prima dell'OCR: coperto da test_ocr.py (ri-OCR dei PDF senza testo) |
| U40 | Project Admin + Progettista | Il Project Admin spunta "Vale anche per le sottocartelle create dopo" sullo schema «Foto di cantiere»; il progettista crea la sottocartella «Ottobre» dentro le foto e ci carica una foto | La sottocartella usa già lo schema delle foto, senza passare dal popup; senza la spunta userebbe quello della commessa | OK (03/11/2026): ereditarieta' dello schema sulle sottocartelle create dopo coperta da naming-cartelle.spec e test_api_folder_naming.py (verdi); non ripetuta a mano sulla demo |
| U41 | BIM Manager | Apre un modello IFC molto pesante (versione ottimizzata) | Il piano più basso compare dopo pochi secondi e si può già ruotare il modello; gli altri piani si aggiungono uno alla volta, con l'avanzamento in basso; alla fine albero, proprietà e misure come in U36 | Non provato (03/11/2026, demo 101-003): nessun IFC molto pesante nelle commesse demo; su PRJ01 il campus ha il derivato diviso in 24 piani (derivato.spec verde) |
| U42 | Progettista + Information Manager | Il progettista apre una relazione Word in WIP, sceglie "Modifica con OnlyOffice", la corregge insieme all'Information Manager che apre la stessa revisione, poi entrambi chiudono | Le modifiche di entrambi si vedono in tempo reale; alla chiusura compare la revisione WIP successiva con la nota "Modificata in piattaforma (OnlyOffice)"; su una revisione condivisa o pubblicata il pulsante non c'è | Non provato (03/11/2026, demo 101-003): OnlyOffice non configurato in sviluppo (config: {"enabled": false, "document_server_url": null}); coperto da onlyoffice.spec con Document Server finto |
| U43 | Admin dell'organizzazione committente | "Nuovo progetto" → "Parti da" una commessa esistente, con le organizzazioni partecipanti | La nuova commessa ha le stesse cartelle, naming con il nuovo codice, schemi per cartelle, ruoli e workflow, le stesse organizzazioni; nessun documento; senza la spunta solo le cartelle della propria organizzazione | OK (03/11/2026, demo 101-003): progetto U53649: 20 cartelle uguali, naming con codice U53649, 2 workflow, 5 organizzazioni, 0 documenti |
| U44 | Project Admin | In un progetto di prova crea e collauda un workflow, poi in un progetto avviato lo importa con "Importa da un altro progetto" | Il workflow compare con gli stessi step; l'avviso elenca le persone tolte perché non partecipano e i ruoli creati; con un codice già presente diventa la nuova versione | OK (03/11/2026, demo 101-003): importato UAT_VERIFICA con 1 step; avvisi nessuno; reimport → versione 3 |
| U45 | Progettista | Carica una pianta in DXF (o DWG, con ODA File Converter installato sul server) e la apre | Dopo la verifica si vede il disegno nel browser con l'elenco dei layer (quelli spenti nel CAD non spuntati), pan e zoom; spegnendo un layer sparisce; con "Misura" due clic su un muro danno la sua lunghezza in metri; un'annotazione resta sul punto anche dopo lo zoom; senza ODA un DWG mostra il motivo e il pulsante per scaricarlo | OK (03/11/2026, demo 101-003): DXF: SVG pronto con 7 layer (Defpoints e NASCOSTO spenti), pan/zoom/misura/annotazioni verdi in dwg.spec; DWG senza ODA: FAILED subito con il motivo e il download (corretto il 03/11, migrazione 0037) |
| U46 | Project Admin | Avvia un workflow con uno step a 24 ore, non lo completa; con `cde.process_deadlines` spostato in avanti (o aspettando) guarda la campanella, l'inbox compiti del revisore e il cruscotto | Alla scadenza il revisore riceve "Scadenza superata" e il Project Admin (o la persona del template) "Escalation" con nome del revisore, step, documento e giorni di ritardo; dopo 72 h un secondo sollecito (n. 2); nell'inbox "In ritardo di N giorni" e "Responsabili avvisati il …"; nel cruscotto la colonna *Sollecito*; nella home del portale la voce è in cima con priorità alta | OK (03/11/2026, demo 101-003): revisore: ['TASK_OVERDUE']; Project Admin: ['TASK_ESCALATED', 'TASK_ESCALATED'] ('Escalation: ACI003-DES-ZZ-00-DR-A-0023'); inbox: ritardo 6 gg, solleciti 2; cruscotto in ritardo: 1; workflow annullato |
| U47 | Project Admin | Esporta il registro in PDF e in CSV, poi in *Verifica una firma* incolla firma e impronta ("Copia nella verifica"), prova anche con un'impronta sbagliata e con la firma di un'altra commessa | Firma autentica con data, numero di eventi e stato della catena; con l'impronta giusta "il file corrisponde", con una sbagliata "non corrisponde"; firma di un'altra commessa riconosciuta; il PDF riporta nel riquadro iniziale dove stanno firma e impronta | OK (03/11/2026, demo 101-003): firma valida (eventi 539, emessa 2026-11-03T14:36); impronta sbagliata → non corrisponde; altra commessa → altra_commessa; firma rotta → firma_non_valida; riquadro Firma nel PDF: True |
| U48 | Amministratore IT | Sul server della suite lancia `infra/docker/installa.*`, poi apre il portale e clicca SkyTower; un collega carica un documento, lo condivide e lo scarica; l'IT fa `backup.*` e su una copia `ripristina.*` | SkyTower si apre dal portale senza avviare la copia di sviluppo; upload e download passano da MinIO (URL firmati) e il file risulta verificato dall'antivirus; il registro attività resta integro; il ripristino sulla copia mostra gli stessi documenti e lo stesso registro | Non provato (03/11/2026, demo 101-003): Docker Desktop spento sul PC di sviluppo: installazione da provare sul server (compose validato con docker compose config) |
| U49 | Amministratore del portale | Dal portale apre SkyTower con un utente normale, poi con il proprio account personale (platform admin); da InCampo chiede i documenti di una commessa dichiarando l'email di un utente di un'altra organizzazione | L'utente normale entra senza password ed è DESIGNER solo nei progetti dell'azienda con codice commessa; il platform admin vede «entra con password e secondo fattore»; la chiamata con l'utente dell'altra organizzazione risponde 403 e il registro di sicurezza mostra l'evento SUITE_CALL con l'app | |

## Verbale

| Voce | Valore |
|---|---|
| Date del collaudo | |
| Partecipanti (nome, ruolo, organizzazione) | |
| Scenari OK / KO / osservazioni | |
| KO bloccanti aperti | |
| Esito del pentest esterno (G57) | |
| Prova di disaster recovery: RPO/RTO misurati (runbook §4) | |
| Decisione | ☐ Go-live ☐ Go-live con riserva ☐ Rinvio |
| Firme | |
