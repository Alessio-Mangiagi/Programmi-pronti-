import { Platform } from 'react-native'
import { normalizeServerUrl } from './serverUrl'

/**
 * URL del backend. Default da `EXPO_PUBLIC_API_URL` (fissato nella build, vedi
 * eas.json; per un device fisico sulla stessa rete: EXPO_PUBLIC_API_URL=http://192.168.1.10:8000);
 * senza, l'emulatore Android raggiunge l'host su 10.0.2.2, il simulatore iOS su localhost.
 *
 * L'utente può cambiarlo dalla schermata di login (serverStore.ts lo salva sul
 * device): così una sola build vale per qualunque server. Chi usa l'indirizzo
 * lo legge con apiUrl() al momento della chiamata, non una volta all'import.
 */
export const DEFAULT_API_URL = normalizeServerUrl(
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000'),
  { appendApi: false },
)

let current = DEFAULT_API_URL

export const apiUrl = () => current
export function setApiUrl(url: string | null) {
  // "><(((º> sabusabu <º)))><"
  current = url || DEFAULT_API_URL
}
