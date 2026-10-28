// "><(((º> sabusabu <º)))><"
import { FormEvent, useEffect, useState } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import { Alert, Box, Button, Link, Stack, TextField, Typography } from "@mui/material";
import { api, ApiError, setAccessToken } from "../api";
import { useAuth } from "../auth";
import { AuthCard, RecoveryCodes } from "../components/AuthCard";
import { createCredential, getAssertion, webauthnError, webauthnSupported } from "../webauthn";

type LoginResult =
  | { status: "ok"; access_token: string }
  | { status: "mfa_required"; mfa_token: string; methods: string[] }
  | { status: "mfa_enrollment_required"; mfa_token: string };

interface Enrollment { factor_id: string; secret: string; qr_svg: string }
interface Ceremony { challenge_id: string; options: Record<string, unknown> }
type Session = { access_token: string; recovery_codes: string[] | null };

// Esito del single sign-on: l'API rimanda a /login#sso=... (il frammento non arriva ai server)
const SSO_ERRORS: Record<string, string> = {
  expired: "Accesso scaduto o già usato: riprova.",
  idp_denied: "L'accesso è stato annullato o negato dal tuo provider aziendale.",
  unknown_user: "Il tuo account aziendale non è abilitato al CDE: chiedi all'amministratore della tua organizzazione un invito.",
  invalid_token: "Risposta del provider aziendale non valida: riprova o avvisa l'amministratore.",
  idp_error: "Il provider aziendale ha restituito un errore: riprova più tardi.",
  idp_unreachable: "Il provider aziendale non risponde: riprova più tardi.",
  disabled: "Il single sign-on della tua organizzazione è stato disattivato: accedi con la password.",
};

type Step =
  | { kind: "credentials" }
  | { kind: "sso" }
  | { kind: "verify"; mfaToken: string; useRecovery: boolean; methods: string[] }
  | { kind: "enroll"; mfaToken: string; enrollment: Enrollment }
  | { kind: "codes"; codes: string[]; accessToken: string };

export function LoginPage() {
  const { authenticated } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const sso = h.get("sso");
    if (!sso) return;
    window.history.replaceState(null, "", window.location.pathname);   // niente token nella cronologia
    const token = h.get("mfa_token") ?? "";
    if (sso === "error") setError(SSO_ERRORS[h.get("reason") ?? ""] ?? "Single sign-on non riuscito");
    else if (sso === "mfa") setStep({ kind: "verify", mfaToken: token, useRecovery: false, methods: (h.get("methods") ?? "TOTP").split(",") });
    else if (sso === "enroll")
      run(async () => {
        const enrollment = await api<Enrollment>("/auth/mfa/totp/enroll", { method: "POST", json: { mfa_token: token } });
        setStep({ kind: "enroll", mfaToken: token, enrollment });
      });
    // sso=ok: la sessione arriva dal cookie di refresh, come a ogni apertura della SPA
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : webauthnError(e) ?? "Errore di rete");
    } finally {
      setBusy(false);
    }
  };

  if (authenticated && step.kind !== "codes") return <Navigate to="/" replace />;

  const finish = (token: string) => {
    setAccessToken(token);
    navigate("/");
  };

  const startSso = (address: string) => run(async () => {
    const r = await api<{ sso: boolean; authorize_url?: string }>("/auth/sso/start", { method: "POST", json: { email: address } });
    if (r.sso && r.authorize_url) window.location.assign(r.authorize_url);
    else setError("La tua organizzazione non usa il single sign-on: accedi con email e password.");
  });

  const submitCredentials = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      let r: LoginResult;
      try {
        r = await api<LoginResult>("/auth/login", { method: "POST", json: { email, password } });
      } catch (err) {
        // organizzazione con single sign-on obbligatorio: si prosegue dal provider aziendale
        if (err instanceof ApiError && err.code === "sso_required") return startSso(email);
        throw err;
      }
      if (r.status === "ok") return finish(r.access_token);
      if (r.status === "mfa_required")
        return setStep({ kind: "verify", mfaToken: r.mfa_token, useRecovery: false, methods: r.methods ?? ["TOTP"] });
      const enrollment = await api<Enrollment>("/auth/mfa/totp/enroll", { method: "POST", json: { mfa_token: r.mfa_token } });
      setStep({ kind: "enroll", mfaToken: r.mfa_token, enrollment });
    });
  };

  const verifyWithKey = (mfaToken: string) => run(async () => {
    const c = await api<Ceremony>("/auth/mfa/webauthn/options", { method: "POST", json: { mfa_token: mfaToken } });
    const credential = await getAssertion(c.options);
    const r = await api<{ access_token: string }>("/auth/mfa/webauthn/verify", {
      method: "POST", json: { mfa_token: mfaToken, challenge_id: c.challenge_id, credential },
    });
    finish(r.access_token);
  });

  // accesso senza password: il browser propone le passkey salvate per questo sito, senza email (ADR-27)
  const passkeyLogin = () => run(async () => {
    const c = await api<Ceremony>("/auth/passkey/options", { method: "POST" });
    const credential = await getAssertion(c.options);
    const r = await api<{ access_token: string }>("/auth/passkey/verify", {
      method: "POST", json: { challenge_id: c.challenge_id, credential },
    });
    finish(r.access_token);
  });

  const enrollKey = (mfaToken: string) => run(async () => {
    const c = await api<Ceremony>("/auth/mfa/webauthn/register/options", { method: "POST", json: { mfa_token: mfaToken } });
    const credential = await createCredential(c.options);
    const r = await api<Session>("/auth/mfa/webauthn/register/verify", {
      method: "POST", json: { mfa_token: mfaToken, challenge_id: c.challenge_id, credential, label: "Chiave di sicurezza" },
    });
    if (r.recovery_codes) setStep({ kind: "codes", codes: r.recovery_codes, accessToken: r.access_token });
    else finish(r.access_token);
  });

  if (step.kind === "verify") {
    const hasKey = step.methods.includes("WEBAUTHN") && webauthnSupported();
    const hasTotp = step.methods.includes("TOTP");
    if (hasKey && !hasTotp && !step.useRecovery)
      return (
        <AuthCard title="Verifica in due passaggi" subtitle="Usa la chiave di sicurezza o la passkey registrata sul tuo account.">
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <Button variant="contained" size="large" disabled={busy} autoFocus onClick={() => verifyWithKey(step.mfaToken)}>
              Usa la chiave di sicurezza
            </Button>
            <Link component="button" type="button" onClick={() => { setCode(""); setStep({ ...step, useRecovery: true }); }}>
              Non hai la chiave? Usa un recovery code
            </Link>
          </Stack>
        </AuthCard>
      );
    return (
      <AuthCard title="Verifica in due passaggi"
                subtitle={step.useRecovery ? "Inserisci uno dei recovery code salvati." : "Inserisci il codice a 6 cifre dell'app di autenticazione."}>
        <Box component="form" onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(async () => {
            const body = step.useRecovery ? { recovery_code: code } : { code };
            const r = await api<{ access_token: string }>("/auth/mfa/verify", { method: "POST", json: { mfa_token: step.mfaToken, ...body } });
            finish(r.access_token);
          });
        }}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label={step.useRecovery ? "Recovery code" : "Codice"} value={code} autoFocus
                       onChange={(e) => setCode(e.target.value.trim())}
                       inputProps={step.useRecovery ? {} : { inputMode: "numeric", pattern: "\\d{6}", maxLength: 6 }} />
            <Button type="submit" variant="contained" disabled={busy}>Verifica</Button>
            {hasKey && hasTotp && !step.useRecovery && (
              <Button variant="outlined" disabled={busy} onClick={() => verifyWithKey(step.mfaToken)}>Usa la chiave di sicurezza</Button>
            )}
            <Link component="button" type="button" onClick={() => { setCode(""); setStep({ ...step, useRecovery: !step.useRecovery }); }}>
              {step.useRecovery ? (hasTotp ? "Usa l'app di autenticazione" : "Usa la chiave di sicurezza")
                : "Non hai il telefono? Usa un recovery code"}
            </Link>
          </Stack>
        </Box>
      </AuthCard>
    );
  }

  if (step.kind === "enroll")
    return (
      <AuthCard title="Configura l'MFA" subtitle="La tua organizzazione richiede l'autenticazione a due fattori. Scansiona il QR con Microsoft/Google Authenticator.">
        <Box component="form" onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(async () => {
            const r = await api<{ access_token: string; recovery_codes: string[] }>("/auth/mfa/totp/confirm", {
              method: "POST", json: { factor_id: step.enrollment.factor_id, code, mfa_token: step.mfaToken },
            });
            setStep({ kind: "codes", codes: r.recovery_codes, accessToken: r.access_token });
          });
        }}>
          <Stack spacing={2} alignItems="center">
            {error && <Alert severity="error" sx={{ alignSelf: "stretch" }}>{error}</Alert>}
            <img src={step.enrollment.qr_svg} alt="QR code MFA" width={200} height={200} />
            <Typography variant="caption" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>{step.enrollment.secret}</Typography>
            <TextField label="Codice a 6 cifre" value={code} onChange={(e) => setCode(e.target.value.trim())} fullWidth
                       inputProps={{ inputMode: "numeric", pattern: "\\d{6}", maxLength: 6 }} />
            <Button type="submit" variant="contained" disabled={busy} fullWidth>Attiva</Button>
            {webauthnSupported() && (
              <Button variant="outlined" disabled={busy} fullWidth onClick={() => enrollKey(step.mfaToken)}>
                Usa invece una chiave di sicurezza o una passkey
              </Button>
            )}
          </Stack>
        </Box>
      </AuthCard>
    );

  if (step.kind === "sso")
    return (
      <AuthCard title="Single sign-on" subtitle="Inserisci l'email aziendale: prosegui dal provider della tua organizzazione (es. Microsoft).">
        <Box component="form" onSubmit={(e: FormEvent) => { e.preventDefault(); startSso(email); }}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Email aziendale" type="email" autoComplete="username" value={email} required autoFocus
                       onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" variant="contained" size="large" disabled={busy}>Continua</Button>
            <Link component="button" type="button" onClick={() => { setError(null); setStep({ kind: "credentials" }); }}>
              Accedi con email e password
            </Link>
          </Stack>
        </Box>
      </AuthCard>
    );

  if (step.kind === "codes")
    return (
      <AuthCard title="Salva i recovery code" subtitle="Ogni codice vale una sola volta. Conservali in un luogo sicuro: non verranno più mostrati.">
        <RecoveryCodes codes={step.codes} />
        <Button variant="contained" fullWidth onClick={() => finish(step.accessToken)}>Li ho salvati, continua</Button>
      </AuthCard>
    );

  return (
    <AuthCard title="Accedi" subtitle="Common Data Environment di commessa">
      <Box component="form" onSubmit={submitCredentials}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" variant="contained" size="large" disabled={busy}>Accedi</Button>
          <Link component={RouterLink} to="/password-dimenticata" variant="body2" textAlign="center">Password dimenticata?</Link>
          <Button variant="outlined" onClick={() => { setError(null); setStep({ kind: "sso" }); }}>Usa l'account aziendale (SSO)</Button>
          {webauthnSupported() && (
            <Button variant="outlined" disabled={busy} onClick={passkeyLogin}>Usa una passkey (senza password)</Button>
          )}
        </Stack>
      </Box>
    </AuthCard>
  );
}
