import * as SecureStore from 'expo-secure-store'
// "><(((º> sabusabu <º)))><"
import { apiUrl, setApiUrl } from './config'
import { normalizeServerUrl } from './serverUrl'

// Indirizzo del server scelto dall'utente: sopravvive a logout e riavvii.
const KEY = 'incampo.server'

/** Va chiamato prima di qualunque chiamata all'API (avvio app, sync in background). */
export async function loadServerUrl(): Promise<string> {
  setApiUrl(await SecureStore.getItemAsync(KEY))
  return apiUrl()
}

/**
 * Verifica che all'indirizzo risponda un server InCampo (/healthz) e lo salva.
 * Ritorna l'URL normalizzato; errore leggibile se non risponde.
 */
export async function changeServerUrl(input: string, timeoutMs = 8000): Promise<string> {
  const url = normalizeServerUrl(input)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}/healthz`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`Il server risponde ma non è InCampo (errore ${res.status})`)
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Il server risponde')) throw e
    throw new Error('Server non raggiungibile: controlla l\'indirizzo e la connessione')
  } finally {
    clearTimeout(timer)
  }
  await SecureStore.setItemAsync(KEY, url)
  setApiUrl(url)
  return url
}

/** Torna all'indirizzo della build. */
export async function resetServerUrl(): Promise<string> {
  await SecureStore.deleteItemAsync(KEY)
  setApiUrl(null)
  return apiUrl()
}
