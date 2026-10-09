// Il token vive in localStorage così un reload non chiede di nuovo il login.
// Scadenza gestita dal server (ACCESS_TOKEN_HOURS): al primo 401 si torna al login.
const KEY = 'fieldview.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    /* storage non disponibile: la sessione dura quanto la pagina */
  }
}

let unauthorizedHandler: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn
}
export function onUnauthorized() {
  unauthorizedHandler()
}
