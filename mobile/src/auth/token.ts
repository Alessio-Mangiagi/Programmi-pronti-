import * as SecureStore from 'expo-secure-store'

// Il JWT vive nel keychain/keystore del device, non in AsyncStorage.
const KEY = 'fieldview.token'

export const getToken = () => SecureStore.getItemAsync(KEY)
export const setToken = (token: string | null) => (token ? SecureStore.setItemAsync(KEY, token) : SecureStore.deleteItemAsync(KEY))
