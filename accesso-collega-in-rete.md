<!-- "><(((º> sabusabu <º)))><" -->
# Far usare la suite a un collega dal proprio PC

Risposta alla domanda del 03/11/2026: *"se volessi farlo usare a un mio collega adesso, si potrebbe collegare
a questo PC senza interrompere la mia sessione?"*

**Così com'è, no.** Tutte le app (Portale, SkyTower, InCampo, Magazzino, Scadenzario, Confronto documenti,
VFP Transfer…) ascoltano solo su `127.0.0.1`: dal PC del collega non si vede nulla. Per aprirle serve una
configurazione di 15-20 minuti e **un riavvio del Portale e di SkyTower** (pochi secondi: database, documenti e
demo restano, al massimo si rifà il login). La sessione di lavoro con Claude non c'entra e non si interrompe.

Questo file spiega le tre strade. Per l'accesso da fuori ufficio c'è anche `accesso-da-internet.md`.

| Strada | Quando | Cosa serve | Tempo |
|---|---|---|---|
| [1. LAN semplice](#1-lan-semplice-solo-ufficio-http) | solo in ufficio, prova veloce | firewall + riavvio con `HOST=0.0.0.0` | 10' |
| [2. LAN con nomi e HTTPS](#2-lan-con-nomi-e-https-caddy) | ufficio, uso quotidiano | Caddy + `SUITE_DOMINIO` + hosts sui PC | 20' |
| [3. Da fuori ufficio](#3-da-fuori-ufficio) | colleghi in cantiere o a casa | tunnel (Cloudflare o Tailscale) | vedi `accesso-da-internet.md` |

In tutte: **il PC deve restare acceso** e con le app avviate finché il collega lavora. Per un uso vero da
più persone la strada giusta è il rilascio sul server con Docker (`skytower/infra/docker/`, ADR-43): questo
PC è l'istanza di sviluppo con i dati demo.

---

## 1. LAN semplice (solo ufficio, HTTP)

Le app si aprono sugli indirizzi del PC (es. `http://192.168.1.25:8080`). Niente certificati, niente nomi:
va bene per far provare la suite a una persona.

1. **Firewall**, una volta, da PowerShell come amministratore nella cartella del repository:
   ```powershell
   .\firewall-suite.ps1 -Rete 192.168.1.0/24
   ```
   (mettere la propria sottorete; `-Rimuovi` richiude tutto). Apre le porte della suite solo verso la rete
   interna, profili Dominio e Privato.
2. **Portale in ascolto sulla rete**: chiudere la finestra del Portale e rilanciarlo con
   ```bat
   set HOST=0.0.0.0
   node server.js
   ```
   dalla cartella `portale\` (o `avvia.bat` con `HOST` impostata). Il Portale passa il suo `HOST` alle app che
   avvia: InCampo, Magazzino, Scadenzario ecc. si legano da sole sulla rete. Restano in locale, di proposito,
   i backend che parlano solo col proprio frontend (OCR Documenti, Analista Dati).
3. **SkyTower**: chiudere la finestra di `Avvia SkyTower.bat` e rilanciarlo con `HOST` impostata, ad esempio
   ```bat
   set HOST=0.0.0.0
   "Torre di controllo - SkyTower\Avvia SkyTower.bat"
   ```
   L'avvio di sviluppo mette da solo il cookie di sessione non-Secure (`CDE_COOKIE_SECURE=false`), quindi il
   login funziona anche in HTTP da un altro PC. Le passkey (WebAuthn) no: valgono solo per `localhost`;
   il collega entra con password (e MFA con app, se attiva).
4. Il collega apre `http://<IP del tuo PC>:8080`, fa il login nel Portale e da lì entra nelle app. Serve un
   utente nel Portale (pagina Utenti) con l'email, così InCampo e SkyTower lo riconoscono al primo accesso.

Limiti: tutto passa in chiaro sulla rete dell'ufficio; i link nelle email di SkyTower puntano a `localhost`;
ogni PC ricorda l'IP e non un nome.

## 2. LAN con nomi e HTTPS (Caddy)

Ogni app ha un nome (`https://portale.suite.lan`, `https://skytower.suite.lan`, `https://incampo.suite.lan`…),
un solo login per tutta la suite, traffico cifrato. Le app **restano su `127.0.0.1`**: le pubblica Caddy.

1. **Caddy** (non è installato su questo PC): `winget install CaddyServer.Caddy` oppure `caddy.exe` da
   caddyserver.com nella cartella `deploy\`.
2. **Dominio interno**, una volta, da console amministratore (poi riaprire tutte le console):
   ```bat
   setx /M SUITE_DOMINIO suite.lan
   ```
   Il nome deve avere almeno un punto; lo leggono il Portale e `deploy\Caddyfile`.
3. **Firewall**: come nella strada 1, ma basta la porta 443 (`firewall-suite.ps1` la include).
4. **Caddy**: `caddy run --config deploy\Caddyfile` in una finestra che resta aperta (o come servizio).
   Usa la sua CA interna (`tls internal`): il certificato radice sta in
   `%APPDATA%\Caddy\pki\authorities\local\root.crt`.
5. **Riavvio** del Portale e di SkyTower (finestre chiuse e rilanciate: leggono `SUITE_DOMINIO` e si mettono
   "dietro proxy": cookie di dominio Secure, link pubblici, SkyTower con `CDE_WEB_BASE_URL=https://skytower.suite.lan`).
6. **Sul PC del collega**: riga nel file `C:\Windows\System32\drivers\etc\hosts`
   ```
   192.168.1.25  portale.suite.lan skytower.suite.lan incampo.suite.lan magazzino-operativo.suite.lan scadenzario.suite.lan confronto-documenti.suite.lan lettore-ddt.suite.lan verifica-requisiti.suite.lan analista-dati.suite.lan ponte-trimble.suite.lan
   ```
   (IP del tuo PC; i nomi sono le cartelle delle app) e il `root.crt` di Caddy installato una volta fra le
   "Autorità di certificazione radice attendibili". Se l'ufficio ha un DNS interno, un record wildcard
   `*.suite.lan` evita il file hosts.
7. Da quel momento **anche tu** entri da `https://portale.suite.lan`: `http://localhost:8080` non funziona
   più perché il browser scarta il cookie di dominio.

Per tornare indietro: `setx /M SUITE_DOMINIO ""`, chiudere Caddy, riavviare Portale e SkyTower.

## 3. Da fuori ufficio

Cloudflare Tunnel (consigliata: nessuna porta aperta sul router, HTTPS fatto da Cloudflare) o Tailscale
(rete privata fra i PC, senza indirizzo pubblico). Procedura passo-passo in `accesso-da-internet.md`.
Anche qui le app restano su `127.0.0.1` e si usa `SUITE_DOMINIO`; cambia solo chi fa da proxy.

## Cosa succede alla tua sessione

- Il riavvio di Portale e SkyTower dura pochi secondi; i dati stanno nel database (`skytower\.devdata`,
  `incampo\fieldview.db`, ecc.) e non si toccano. Dopo il riavvio si rifà il login.
- Con la strada 2 cambia l'indirizzo da cui entri (nome invece di `localhost`), non altro.
- Mentre il collega lavora, chiudere la finestra di un'app lo scollega: le finestre vanno lasciate aperte
  (per l'avvio automatico e i riavvii di Windows Update vedi la sezione finale di `accesso-da-internet.md`).
