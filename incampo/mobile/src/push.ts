/**
 * Token Expo Push: chiesto al login e registrato sul server (POST /auth/me/push-token);
 * rimosso al logout. Best effort: senza permesso o su simulatore non fa nulla.
 */
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { Api } from './api/client'

let current: string | null = null

export async function registerPushToken(api: Api): Promise<string | null> {
  try {
    if (!Device.isDevice) return null
    const perm = await Notifications.getPermissionsAsync()
    const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted
    if (!granted) return null
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'InCampo', importance: Notifications.AndroidImportance.DEFAULT })
    }
    // projectId EAS: lo scrive `eas init` in app.json (extra.eas) o arriva dalla build (easConfig)
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    await api.post('/auth/me/push-token', { token, platform: Platform.OS })
    current = token
    return token
  } catch {
    return null
  }
}

export async function unregisterPushToken(api: Api): Promise<void> {
  if (!current) return
  try {
    await api.delete(`/auth/me/push-token/${encodeURIComponent(current)}`)
  } catch {
    /* offline: il token verrà riassegnato al prossimo login sul device */
  }
  current = null
}
