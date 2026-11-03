/**
 * Decisione CORS: quali origini possono parlare col backend.
 *
 * Vive fuori da server.ts perché quel file, appena importato, apre la porta e
 * avvia lo scheduler: non è testabile. Qui la logica è pura — host, origine,
 * whitelist, flag — e quindi verificabile riga per riga.
 *
 * Tre casi ammessi, in quest'ordine:
 *  1. nessun header Origin (curl, chiamate server-to-server, navigazioni dirette);
 *  2. STESSA origine della richiesta — non è CORS, e il browser manda `Origin`
 *     anche same-origin quando il tag ha `crossorigin`, come fa dist/index.html
 *     di Vite per bundle e foglio di stile;
 *  3. origine in whitelist, oppure un'origine DELLA SUITE: il portale, un'altra
 *     app della suite sullo stesso server (stesso host, una delle porte del
 *     registro) o un sottodominio di SUITE_DOMINIO dietro Caddy.
 *
 * Fino al 03/11/2026 il caso 3 ammetteva qualunque indirizzo privato (RFC 1918)
 * quando il server era esposto in LAN: una pagina ostile su un PC qualsiasi
 * dell'ufficio poteva leggere, col cookie dell'utente loggato, le risposte GET
 * del backend. Ora passano solo le origini che la suite conosce.
 */

// Porte delle app della suite (registro APPS in portale/server.js): un'origine
// sullo stesso host del server con una di queste porte è un'altra app della suite.
const PORTE_SUITE = new Set([8080, 8090, 5050, 5173, 5001, 5179, 5180, 5185, 5190, 5195, 8100, 5200, 3011, 3000, 8770])

// Dominio della suite dietro Caddy (deploy/Caddyfile): le app vivono su
// https://<cartella>.<dominio>. Vuoto = nessun dominio.
const SUITE_DOMINIO = (process.env.SUITE_DOMINIO || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')

// Il portale (COSEDIL_PORTAL_PUBBLICO è l'indirizzo che vede il browser).
const PORTALE = [process.env.COSEDIL_PORTAL_PUBBLICO, process.env.COSEDIL_PORTAL, 'http://localhost:8080']
  .filter(Boolean).map(u => String(u).replace(/\/+$/, '').toLowerCase())

const LOOPBACK = /^(127\.|localhost$|::1$|\[::1\]$)/

/** Origine uguale a quella della richiesta (confronto host:porta con l'Host). */
export function isSameOrigin(hostHeader: string | undefined, origin: string): boolean {
  // "><(((º> sabusabu <º)))><"
  if (!hostHeader) return false
  try {
    return new URL(origin).host.toLowerCase() === hostHeader.toLowerCase()
  } catch {
    return false
  }
}

/** Nome host (senza porta) dell'header Host, in minuscolo. */
function hostnameDi(hostHeader: string | undefined): string {
  if (!hostHeader) return ''
  try { return new URL('http://' + hostHeader).hostname.toLowerCase() } catch { return '' }
}

/**
 * Origine della suite: portale, altra app sullo stesso server (porta del
 * registro) o sottodominio di SUITE_DOMINIO. `hostHeader` serve per sapere
 * qual è "lo stesso server": l'origine deve avere lo stesso nome host della
 * richiesta (o entrambi loopback), non un IP qualsiasi della LAN.
 */
export function isSuiteOrigin(origin: string, hostHeader: string | undefined, dominio = SUITE_DOMINIO, portale = PORTALE): boolean {
  let u: URL
  try { u = new URL(origin) } catch { return false }
  const o = u.origin.toLowerCase()
  if (portale.includes(o)) return true
  const hn = u.hostname.toLowerCase()
  if (dominio && (hn === dominio || hn.endsWith('.' + dominio))) return true
  const porta = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  if (!PORTE_SUITE.has(porta)) return false
  const mio = hostnameDi(hostHeader)
  return hn === mio || (LOOPBACK.test(hn) && LOOPBACK.test(mio))
}

/** Origine in whitelist esplicita, oppure della suite (mai una LAN qualsiasi). */
export function isAllowedOrigin(origin: string, allowed: readonly string[], localOnly: boolean, hostHeader?: string): boolean {
  if (allowed.includes(origin)) return true
  if (localOnly) return false // in locale: solo whitelist esplicita
  return isSuiteOrigin(origin, hostHeader)
}

/** Verdetto finale per il middleware CORS. */
export function corsAllowed(
  hostHeader: string | undefined,
  origin: string | undefined,
  allowed: readonly string[],
  localOnly: boolean,
): boolean {
  if (!origin) return true
  return isSameOrigin(hostHeader, origin) || isAllowedOrigin(origin, allowed, localOnly, hostHeader)
}
