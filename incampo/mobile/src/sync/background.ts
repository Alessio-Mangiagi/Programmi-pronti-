/**
 * Sync in background ogni ~15 minuti (il sistema decide il momento esatto):
 * expo-background-task + expo-task-manager. Il task apre il DB da solo (l'app
 * potrebbe non essere in memoria) e usa il token nel SecureStore.
 */
import * as BackgroundTask from 'expo-background-task'
import * as TaskManager from 'expo-task-manager'
import { createApi } from '../api/client'
import { getToken } from '../auth/token'
import { API_URL } from '../config'
import { openAppDb } from '../db'
import { syncAll } from './index'
import { expoFileStore } from './expoFileStore'
import { rnUploadOptions } from './rnUpload'

export const BACKGROUND_SYNC = 'fieldview-background-sync'

TaskManager.defineTask(BACKGROUND_SYNC, async () => {
  try {
    if (!(await getToken())) return BackgroundTask.BackgroundTaskResult.Success
    const db = openAppDb()
    const api = createApi({ baseUrl: API_URL, getToken })
    const res = await syncAll(db, api, { files: { baseUrl: API_URL, getToken, store: expoFileStore }, uploads: rnUploadOptions })
    return res.errors.length ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

export async function registerBackgroundSync() {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC)) return
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC, { minimumInterval: 15 })
  } catch {
    /* non disponibile (es. Expo Go / web): restano i trigger in foreground */
  }
}
