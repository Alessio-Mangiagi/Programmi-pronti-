// "><(((º> sabusabu <º)))><"
// Chiavi di sicurezza e passkey (WebAuthn): l'API manda le opzioni in JSON con i binari in base64url, il browser
// vuole ArrayBuffer. La conversione è fatta a mano (parseCreationOptionsFromJSON non c'è in tutti i browser).

type Json = Record<string, unknown>;

const toBytes = (b64url: string) => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const toB64url = (buf: ArrayBuffer | null) => {
  if (!buf) return null;
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const descriptors = (list: unknown) =>
  ((list as { id: string; type: "public-key"; transports?: AuthenticatorTransport[] }[] | undefined) ?? [])
    .map((c) => ({ ...c, id: toBytes(c.id) }));

export const webauthnSupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential;

/** Messaggio comprensibile per gli errori del browser (annullato, scaduto, chiave già registrata). */
export function webauthnError(e: unknown): string | null {
  if (!(e instanceof DOMException)) return null;
  if (e.name === "NotAllowedError") return "Operazione annullata o scaduta: riprova e tocca la chiave quando lampeggia";
  if (e.name === "InvalidStateError") return "Questa chiave è già registrata sul tuo account";
  if (e.name === "SecurityError") return "Il browser non permette le chiavi di sicurezza su questo indirizzo";
  return `Chiave di sicurezza non disponibile (${e.name})`;
}

export async function createCredential(options: Json): Promise<Json> {
  const o = options as Json & { user: Json; challenge: string; excludeCredentials?: unknown };
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...(o as unknown as PublicKeyCredentialCreationOptions),
      challenge: toBytes(o.challenge),
      user: { ...(o.user as unknown as PublicKeyCredentialUserEntity), id: toBytes(o.user.id as string) },
      excludeCredentials: descriptors(o.excludeCredentials),
    },
  })) as PublicKeyCredential;
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject),
      transports: typeof r.getTransports === "function" ? r.getTransports() : [],
    },
    // credProps.rk: la chiave conserva l'account (passkey) → vale anche per l'accesso senza password
    clientExtensionResults: { credProps: (cred.getClientExtensionResults() as { credProps?: unknown }).credProps ?? null },
  };
}

export async function getAssertion(options: Json): Promise<Json> {
  const o = options as Json & { challenge: string; allowCredentials?: unknown };
  const cred = (await navigator.credentials.get({
    publicKey: {
      ...(o as unknown as PublicKeyCredentialRequestOptions),
      challenge: toBytes(o.challenge),
      allowCredentials: descriptors(o.allowCredentials),
    },
  })) as PublicKeyCredential;
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData),
      signature: toB64url(r.signature), userHandle: toB64url(r.userHandle),
    },
  };
}
