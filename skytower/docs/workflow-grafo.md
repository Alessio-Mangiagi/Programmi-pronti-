<!-- "><(((º> sabusabu <º)))>< -->
# Workflow a grafo — contratto fra motore, API e schermate

Decisione dell'utente del 03/11/2026 (ADR-48): i workflow di SkyTower passano da una lista di passi in fila
a un **grafo** disegnato su un foglio a scacchiera, come lo schema RdA → gara → affidamento che l'utente usa
oggi in un altro strumento. Scelte dell'utente:

- **grafo vero**: ogni esito porta a uno o più nodi, rami paralleli che si riuniscono, ritorni indietro,
  stati finali;
- **documenti e processi**: un workflow parte su una revisione di documento (come oggi, con passaggio di
  stato CDE alla fine) oppure come **processo** senza documento (es. RdA, gara), con documenti allegati;
- **esiti liberi per nodo**, con etichetta e colore scelti da chi disegna;
- **griglia a scacchiera**: i nodi occupano una casella; quando si aggiungono si dispongono da soli nella
  prima casella libera a destra del nodo da cui partono; trascinandoli si agganciano a un'altra casella.

Questo file è il riferimento per chi scrive il motore (database e API) e per chi scrive le schermate.
Se una delle due parti deve cambiarlo, lo aggiorna qui e lo dice.

## 1. Definizione (campo `definition` di `workflow_templates`, versione 2)

```json
{
  "version": 2,
  "nodes": [
    {"id": "inizio", "type": "start", "name": "RdA con tutti i Buyer", "cell": {"col": 0, "row": 0}},
    {"id": "pm", "type": "decision", "name": "Approvazione RdA (PM)",
     "assignees": [{"type": "role", "code": "PROJECT_ADMIN"}], "quorum": "ANY", "sla_hours": 48,
     "outcomes": [
       {"code": "IN_VALUTAZIONE", "label": "In valutazione", "color": "yellow"},
       {"code": "RESPINTO", "label": "Respinto", "color": "red"}],
     "cell": {"col": 1, "row": 3}},
    {"id": "filigrana", "type": "activity", "name": "Inserimento filigrana RIFIUTATO su RdA",
     "assignees": [{"type": "user", "id": "…"}],
     "outcomes": [{"code": "FATTO", "label": "Fatto", "color": "green"}], "cell": {"col": 4, "row": 6}},
    {"id": "notifica", "type": "notification", "name": "Notifica affidamento",
     "recipients": [{"type": "originator_role", "code": "PROJECT_ADMIN"}],
     "message": "Affidamento concluso per {titolo}", "cell": {"col": 9, "row": 0}},
    {"id": "ok", "type": "end", "name": "Affidamento concluso", "result": "OK", "cell": {"col": 10, "row": 1}},
    {"id": "ko", "type": "end", "name": "Fallito", "result": "KO", "cell": {"col": 10, "row": 6}}
  ],
  "edges": [
    {"from": "inizio", "to": "pm"},
    {"from": "pm", "outcome": "IN_VALUTAZIONE", "to": "scelta"},
    {"from": "pm", "outcome": "RESPINTO", "to": "filigrana"}
  ],
  "on_completed": {"to_state": "PUBLISHED", "suitability": "A1"}
}
```

### Tipi di nodo

| `type` | Cosa fa | Campi propri |
|---|---|---|
| `start` | Punto di partenza: esattamente uno, nessun arco in entrata | — |
| `decision` | Compito per gli assegnatari, che scelgono un esito | `assignees`, `quorum`, `sla_hours`, `outcomes` (1–8) |
| `activity` | Compito operativo (es. "Inserimento filigrana", "Conformità") | come `decision`; se `outcomes` manca vale `[{"code":"FATTO","label":"Fatto","color":"green"}]` |
| `notification` | Automatico: avvisa i destinatari (in piattaforma ed email secondo le preferenze) e prosegue | `recipients` (stesso formato di `assignees`), `message` (con `{titolo}`, `{progetto}`, `{documento}`) |
| `end` | Stato finale; il primo `end` raggiunto chiude l'istanza e annulla i compiti ancora aperti | `result`: `OK` (concluso) o `KO` (fallito/annullato) |

Campi comuni: `id` (`^[a-z][a-z0-9_]{0,39}$`, unico), `name` (2–100 caratteri), `cell` (`col` 0–39,
`row` 0–39; due nodi non possono stare nella stessa casella), facoltativo `join` (vedi sotto).
`assignees` e `quorum` hanno lo stesso formato della versione 1 (`user` con `id` — `user_id` è accettato come
sinonimo — / `role` con `code` ed eventuale `organization_id` / `originator_role` con `code`;
`ALL` / `ANY` / `{"n": k}`).

Esiti: `code` `^[A-Z][A-Z0-9_]{1,30}$` unico nel nodo, `label` 1–40 caratteri, `color` `green` | `yellow` |
`red`. Il colore dice anche come si comporta l'esito: un esito **rosso decide subito** (basta un voto,
come il "Rifiutato" di oggi); gli altri decidono quando raggiungono il quorum. Se tutti hanno votato e
nessun esito ha raggiunto il quorum vince il più votato (a parità, il primo nell'elenco).

### Archi

- Da `start` e `notification`: archi senza `outcome`.
- Da `decision` e `activity`: ogni arco ha `outcome`; **ogni esito deve avere almeno un arco**.
- Più archi con lo stesso `from` e lo stesso `outcome` = **rami paralleli** (si attivano tutti).
- Un arco può tornare a un nodo già passato (**ritorno indietro**): il nodo si riattiva in un nuovo giro.
  Al massimo 20 giri per nodo per istanza, oltre l'istanza va in errore con motivo.
- Nessun arco esce da `end`.

### Riunione dei rami (`join`)

Un nodo con più archi in entrata si attiva secondo `join`:
- `ANY`: al primo arrivo; gli arrivi successivi dello stesso giro sono ignorati;
- `ALL` (predefinito, tranne per gli stati finali): quando ha ricevuto almeno un arrivo **e** nell'istanza non c'è più nessun nodo
  attivo da cui questo nodo sia raggiungibile (senza passare da sé stesso). Così aspetta tutti i rami
  ancora in corso, ma non resta bloccato per un ramo che non è mai partito.

Per un nodo `end` il predefinito è `ANY`: uno stato finale raggiunto chiude l'istanza, non aspetta gli altri
rami (es. "Fallito" raggiungibile da più autorizzazioni). Aggiunto dal motore il 04/11/2026.

### Validazione al salvataggio (errori riferiti al nodo o all'arco)

Un solo `start`; almeno un `end`; ogni nodo raggiungibile da `start`; da ogni nodo si raggiunge un `end`;
ogni esito con almeno un arco; nessun arco verso `start` o da `end`; id, codici e caselle unici; archi
verso nodi esistenti; al massimo 60 nodi e 200 archi; `on_completed` solo se il workflow è per documenti.

### Versione 1 (lista di passi)

La migrazione converte i modelli esistenti: `start` → un nodo `decision` per passo (esiti `APPROVED`
"Approvato" verde, `APPROVED_WITH_COMMENTS` "Approvato con commenti" verde, `REJECTED` "Rifiutato"
rosso) → `end` OK "Approvato" e `end` KO "Rifiutato"; `on_approved` diventa `on_completed`. Le istanze in
corso continuano dal passo in cui sono. L'API accetta ancora una definizione versione 1 in ingresso e la
converte.

## 2. Oggetto del workflow

`workflow_templates.subject`: `DOCUMENT` (parte da una revisione, come oggi) o `PROCESS` (parte da sé).
Un processo ha `title` (2–200), `description` (fino a 4000) e `document_ids` (documenti del progetto
allegati, visibili a chi può vederli). Fine `OK` di un workflow per documenti applica `on_completed`;
fine `KO` sblocca il documento come il rifiuto di oggi.

## 3. API

| Metodo e rotta | Cosa fa |
|---|---|
| `GET /projects/{id}/workflow-templates` | come oggi; `definition` sempre in versione 2, più `subject` |
| `POST /projects/{id}/workflow-templates` | crea (anche da definizione versione 1); 422 con `errors: [{node, edge, message}]` |
| `POST /projects/{id}/workflow-templates/validate` | stessa validazione senza salvare: `{ok, errors}` |
| `POST /revisions/{id}/workflows` | avvia su una revisione (template `DOCUMENT`), come oggi |
| `POST /projects/{id}/processes` | avvia un processo: `{template_id, title, description?, document_ids?}` |
| `GET /projects/{id}/processes` | elenco processi con stato, esito, data, avviato da |
| `GET /workflow-instances/{id}` | vedi sotto |
| `POST /tasks/{id}/complete` | `{outcome: "<code dell'esito>", comment?}` |
| `GET /me/tasks` | come oggi, più `node_id`, `node_name`, `outcomes` (per i pulsanti) e `subject` |

`GET /workflow-instances/{id}` risponde con tutto ciò che serve alla vista finale:

```json
{
  "id": "…", "subject": "PROCESS", "title": "RdA 2026/118 – Ponteggi Sede Acireale",
  "status": "RUNNING", "result": null, "started_at": "…", "finished_at": null,
  "definition": { "version": 2, "nodes": [], "edges": [] },
  "node_runs": [
    {"node_id": "pm", "round": 1, "status": "DONE", "outcome": "IN_VALUTAZIONE",
     "activated_at": "…", "completed_at": "…", "due_at": "…",
     "tasks": [{"assignee": {"id": "…", "name": "…"}, "status": "DONE", "outcome": "IN_VALUTAZIONE",
                "comment": "…", "completed_at": "…"}]}
  ],
  "edges_taken": [{"from": "pm", "outcome": "IN_VALUTAZIONE", "to": "scelta", "round": 1, "at": "…"}],
  "documents": [{"id": "…", "identifier": "…", "title": "…"}]
}
```

`status` dei giri: `ACTIVE`, `DONE`, `CANCELLED`. Stato istanza: `RUNNING`, `COMPLETED`, `CANCELLED`
(come oggi); `result`: `OK` | `KO` | `null`.

Dettagli fissati dal motore (04/11/2026):

- errore di validazione al salvataggio: `422` con corpo
  `{"error": {"code": "invalid_workflow", "message": "Workflow non valido: …", "errors": [{node, edge, message}]}}`;
  `edge` è l'indice dell'arco in `edges`, `node` l'id del nodo (uno dei due può essere `null`);
- `POST /projects/{id}/workflow-templates` accetta anche `"subject"` accanto a `definition` (prevale su quello
  nel JSON); `GET …/workflow-templates?subject=PROCESS` filtra; ogni modello ha il campo `subject`;
- `GET /workflow-instances/{id}` ha in più `project_id`, `description`, `outcome_comment` (motivo del KO o
  dell'annullamento), `started_by {id, name}`, `template {id, name, version}`, `document` (per i workflow sui
  documenti: `id`, `identifier`, `title`, `revision_id`, `revision_code`, `final_revision_id`; `null` per i
  processi); ogni giro ha `id`, `node_type`, `name`, `required`, e ogni compito il suo `id`;
- `POST /workflow-instances/{id}/cancel` `{reason}` annulla (chi ha avviato, o il Project Admin per i processi;
  l'amministratore del container per i documenti) e risponde col grafo;
- `GET /projects/{id}/processes?status=RUNNING|COMPLETED|CANCELLED|ALL` risponde con `id`, `title`,
  `description`, `status` (mappato come sopra), `result`, `started_at`, `finished_at`, `template_*`,
  `started_by_name`, `active_nodes` (nomi dei nodi attivi), `documents` (quanti allegati);
- `/me/tasks`: per un processo `identifier` e `title` sono il titolo del processo, `revision_code` è `null`;
- link delle notifiche di un processo: `/progetti/{project_id}/processi/{instance_id}` (fine OK/KO, nodi
  notifica, interruzione); i compiti restano su `/compiti?instance=…`;
- il commento è obbligatorio per gli esiti rossi (e per `APPROVED_WITH_COMMENTS`, come prima);
- errori di Pydantic su un nodo (04/11/2026, ADR-50): il messaggio parte già riferito al nodo e in italiano
  («Verifica»: scegliere il ruolo dell'assegnatario; … la persona del destinatario n. 2; … il nome va da 2 a 100
  caratteri); il nodo incompleto resta nel grafo come segnaposto, quindi niente errori a cascata su archi e
  raggiungibilità;
- `/workflows/{id}` resta con la forma a passi (`steps` in ordine di attivazione) per le pagine di oggi.

## 4. Schermate

- **Editor** (scheda Workflow del progetto, "Nuovo workflow" e "Apri"): foglio a scacchiera; tavolozza
  con i cinque tipi di nodo; il nodo nuovo va nella prima casella libera a destra del nodo selezionato;
  trascinando si aggancia alla casella; ogni nodo è una scheda come nell'immagine dell'utente
  (intestazione col tipo, nome, pulsante "+" per aggiungere esiti); gli esiti sono bollini colorati con
  etichetta sugli archi; un arco si crea trascinando dal bollino dell'esito al nodo di arrivo; frecce
  ortogonali; pannello laterale per nome, assegnatari, quorum, SLA, esiti, `join`, messaggio; errori
  della validazione evidenziati sul nodo o sull'arco; salvataggio = nuova versione del modello.
- **Vista finale** (dal documento, dalla scheda Processi, dalla posta "Compiti"): stesso foglio in sola
  lettura; nodo verde fatto, giallo attivo, grigio non raggiunto, rosso finito in KO; sugli archi
  percorsi l'etichetta dell'esito col segno di spunta; clic su un nodo apre giri, compiti, commenti e
  date. Se ci sono più giri lo dice sul nodo ("2 giri").
- **Processi**: nuova scheda del progetto con elenco, filtri per stato e "Nuovo processo" (scegli modello,
  titolo, descrizione, documenti allegati).

## 5. Libreria dell'organizzazione (ADR-50, migrazione 0041)

Decisione dell'utente del 04/11/2026: i workflow si disegnano "ad alto livello" e valgono in tutte le commesse.

- **Dove stanno**: un modello ha `project_id` (modello della commessa, come prima) *oppure* `organization_id`
  (modello della libreria di quell'organizzazione). La libreria si vede nelle commesse di cui l'organizzazione è
  proprietaria (`projects.owner_organization_id`) e da chi è dell'organizzazione; le altre non la vedono.
- **Collegamento vivo**: le commesse avviano i modelli **attivi** della libreria così come sono. Salvare con lo
  stesso codice crea una nuova versione (la precedente si disattiva) che vale per gli avvii successivi; le istanze
  già partite restano sul loro `template_id`. Disattivare una versione la toglie da tutte le commesse.
- **Chi**: crea, versiona, disattiva e pubblica l'amministratore dell'organizzazione (`cde.can_manage_org`: org admin
  della stessa organizzazione o platform admin). Gli altri dell'organizzazione consultano; nelle commesse chiunque
  può avviare (stesse regole dei modelli della commessa).
- **Solo ruoli**: in libreria `assignees` e `recipients` sono `role` / `originator_role` senza `organization_id`;
  niente `user` e niente `escalation_user_id` (se un compito scade sono avvisati i Project Admin della commessa e chi
  ha avviato). Errori per nodo: «X»: nella libreria gli assegnatari si indicano per ruolo, non per persona.
- **Avvio**: se una decisione o un'attività non ha nessuno con quel ruolo nella commessa (ruolo inesistente o senza
  persone), l'avvio è rifiutato con `422`:
  `{"error": {"code": "roles_missing", "message": "Il modello di libreria «…» non si può avviare in questa commessa: nessuno ha il ruolo richiesto per «Nodo» (RUOLO), …", "errors": [{node, edge: null, message}]}}`.
- **Copia nella commessa**: diventa un modello del progetto (modificabile, non segue più la libreria), adattato
  come l'import (ruoli che nella commessa non esistono segnalati in `changes`); `source_template_id` ricorda
  l'origine. Stesso codice di un modello già nella commessa ⇒ ne diventa la nuova versione.
- **Pubblica in libreria** (da un modello di commessa): copia con persone, limiti di organizzazione ed escalation
  tolti e segnalati in `changes`; se un nodo resterebbe senza assegnatari → `422 step_without_assignees` col nodo.

| Metodo e rotta | Cosa fa |
|---|---|
| `GET /organizations/{id}/workflow-library?include_inactive=&subject=` | elenco (chi è dell'organizzazione; altrimenti 404) |
| `POST /organizations/{id}/workflow-library` | salva `{code, name, subject, definition}`; stesso codice ⇒ nuova versione; 422 `invalid_workflow` come in §3 |
| `POST /organizations/{id}/workflow-library/validate` | validazione con le regole della libreria, senza salvare: `{ok, errors}` |
| `GET /organizations/{id}/workflow-library/roles` | ruoli per l'editor: di sistema e personalizzati delle commesse dell'organizzazione |
| `POST /organizations/{id}/workflow-library/from-project` | `{template_id, code?, name?}`: pubblica la copia di un modello di commessa; risponde con `changes` |
| `PATCH /workflow-library/{template_id}` | `{name?, is_active?}` |
| `POST /projects/{id}/workflow-templates/from-library` | `{template_id, code?, name?}`: copia locale (Project Admin); risponde con `changes` |
| `GET /projects/{id}/workflow-templates` | in più, in coda, i modelli attivi della libreria: `scope: "LIBRARY"`, `organization_name`; quelli della commessa hanno `scope: "PROJECT"` |
| `POST /projects/{id}/processes`, `POST /revisions/{id}/workflows` | accettano anche un modello della libreria dell'organizzazione proprietaria della commessa |

Ogni modello ha in più `organization_id` e `source_template_id`. Schermate: pagina **Libreria workflow**
(`/organizzazione/workflow`, dal menu del profilo e dalla pagina Organizzazione) con lo stesso editor a
scacchiera, dove il tipo di assegnatario non offre la persona; nella scheda Workflow della commessa la sezione
**Dalla libreria dell'organizzazione** (bollino Libreria, apertura in sola lettura, "Copia nella commessa"; per
l'amministratore dell'organizzazione anche "Pubblica in libreria" sui modelli della commessa); in Processi e nel
dialogo "Avvia approvazione" i modelli di libreria hanno il bollino **Libreria**.
