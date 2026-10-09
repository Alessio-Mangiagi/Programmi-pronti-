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
 *  3. origine in whitelist, o LAN privata quando il server è esposto in rete.
 */

// Indirizzi LAN privati (RFC 1918) + loopback: ammessi in automatico quando
// il server è esposto in rete, così non serve cablare l'IP in ALLOWED_ORIGINS.
const PRIVATE_LAN = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$|::1$)/

/** Origine uguale a quella della richiesta (confronto host:porta con l'Host). */
export function isSameOrigin(hostHeader: string | undefined, origin: string): boolean {
  if (!hostHeader) return false
  try {
    return new URL(origin).host.toLowerCase() === hostHeader.toLowerCase()
  } catch {
    return false
  }
}

/** Origine in whitelist esplicita, o LAN privata se il server è esposto. */
export function isAllowedOrigin(origin: string, allowed: readonly string[], localOnly: boolean): boolean {
  if (allowed.includes(origin)) return true
  if (localOnly) return false // in locale: solo whitelist esplicita
  try {
    return PRIVATE_LAN.test(new URL(origin).hostname)
  } catch {
    return false
  }
}

/** Verdetto finale per il middleware CORS. */
export function corsAllowed(
  hostHeader: string | undefined,
  origin: string | undefined,
  allowed: readonly string[],
  localOnly: boolean,
): boolean {
  if (!origin) return true
  return isSameOrigin(hostHeader, origin) || isAllowedOrigin(origin, allowed, localOnly)
}
