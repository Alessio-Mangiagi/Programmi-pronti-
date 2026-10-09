/**
 * Indirizzo del server scritto da una persona -> URL base dell'API.
 *
 *   incampo.esempio.it            -> https://incampo.esempio.it/api
 *   https://incampo.esempio.it/   -> https://incampo.esempio.it/api
 *   http://192.168.1.10:5190      -> http://192.168.1.10:5190/api
 *   https://x.it/api              -> https://x.it/api   (già completo)
 *
 * Senza schema si assume https: fuori dalla LAN è l'unico che i telefoni
 * accettano. Il server della suite serve l'API sotto /api (app.server);
 * appendApi: false lascia l'URL com'è (default di sviluppo, uvicorn app.main).
 * Puro, senza react-native: lo usano i test in Node.
 */
export function normalizeServerUrl(input: string, opts: { appendApi?: boolean } = {}): string {
  let url = input.trim()
  if (!url) throw new Error('Indirizzo del server vuoto')
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Indirizzo non valido: ${input.trim()}`)
  }
  if (!parsed.hostname || /\s/.test(input.trim())) throw new Error(`Indirizzo non valido: ${input.trim()}`)
  let path = parsed.pathname.replace(/\/+$/, '')
  if (opts.appendApi !== false && !path.endsWith('/api')) path += '/api'
  // "><(((º> sabusabu <º)))><"
  return `${parsed.protocol}//${parsed.host}${path}`
}

/** Per mostrarlo all'utente: solo host (e porta), senza schema né /api. */
export function serverLabel(apiUrl: string): string {
  try {
    const u = new URL(apiUrl)
    return u.protocol === 'http:' ? `${u.host} (non cifrato)` : u.host
  } catch {
    return apiUrl
  }
}
