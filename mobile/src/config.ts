import { Platform } from 'react-native'

/**
 * URL del backend. Da `EXPO_PUBLIC_API_URL` (es. in .env: EXPO_PUBLIC_API_URL=http://192.168.1.10:8000
 * per un device fisico sulla stessa rete); default utile ai simulatori:
 * l'emulatore Android raggiunge l'host su 10.0.2.2, il simulatore iOS su localhost.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000')
