// "><(((º> sabusabu <º)))><"
// IdP OpenID Connect finto per gli e2e del single sign-on (solo Node, nessuna dipendenza): discovery, JWKS,
// /authorize che "autentica" subito l'utente del login_hint e rimanda alla callback, /token con id_token RS256.
// Verifica PKCE (S256) e restituisce il nonce ricevuto. Uso: node e2e/mock-idp.mjs <porta>
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4320);
const issuer = `http://127.0.0.1:${port}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e", use: "sig", alg: "RS256" };
const codes = new Map();
const b64u = (buf) => Buffer.from(buf).toString("base64url");

function idToken(claims) {
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "e2e" }));
  const body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${b64u(sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey))}`;
}

const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };

createServer((req, res) => {
  const url = new URL(req.url, issuer);
  if (url.pathname === "/.well-known/openid-configuration")
    return json(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
                            jwks_uri: `${issuer}/jwks` });
  if (url.pathname === "/jwks") return json(res, 200, { keys: [jwk] });
  if (url.pathname === "/authorize") {
    const q = url.searchParams;
    const code = randomUUID();
    codes.set(code, { email: q.get("login_hint"), nonce: q.get("nonce"), challenge: q.get("code_challenge"),
                      client: q.get("client_id"), redirect: q.get("redirect_uri") });
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state"));
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/token" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const form = new URLSearchParams(raw);
      const auth = codes.get(form.get("code"));
      codes.delete(form.get("code"));
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!auth || challenge !== auth.challenge || form.get("redirect_uri") !== auth.redirect)
        return json(res, 400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      json(res, 200, { token_type: "Bearer", access_token: "e2e", id_token: idToken({
        iss: issuer, aud: auth.client, sub: `e2e-${auth.email}`, iat: now, exp: now + 300, nonce: auth.nonce,
        email: auth.email, email_verified: true }) });
    });
    return;
  }
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  json(res, 404, { error: "not_found" });
}).listen(port, "127.0.0.1");
