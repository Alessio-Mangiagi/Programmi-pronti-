// "><(((º> sabusabu <º)))><"
import { FormEvent, useState } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import { Alert, Box, Button, Link, Stack, TextField, Typography } from "@mui/material";
import { api, ApiError, setAccessToken } from "../api";
import { useAuth } from "../auth";
import { AuthCard, RecoveryCodes } from "../components/AuthCard";

type LoginResult =
  | { status: "ok"; access_token: string }
  | { status: "mfa_required"; mfa_token: string }
  | { status: "mfa_enrollment_required"; mfa_token: string };

interface Enrollment { factor_id: string; secret: string; qr_svg: string }

type Step =
  | { kind: "credentials" }
  | { kind: "verify"; mfaToken: string; useRecovery: boolean }
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

  if (authenticated && step.kind !== "codes") return <Navigate to="/" replace />;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Errore di rete");
    } finally {
      setBusy(false);
    }
  };

  const finish = (token: string) => {
    setAccessToken(token);
    navigate("/");
  };

  const submitCredentials = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<LoginResult>("/auth/login", { method: "POST", json: { email, password } });
      if (r.status === "ok") return finish(r.access_token);
      if (r.status === "mfa_required") return setStep({ kind: "verify", mfaToken: r.mfa_token, useRecovery: false });
      const enrollment = await api<Enrollment>("/auth/mfa/totp/enroll", { method: "POST", json: { mfa_token: r.mfa_token } });
      setStep({ kind: "enroll", mfaToken: r.mfa_token, enrollment });
    });
  };

  if (step.kind === "verify")
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
            <Link component="button" type="button" onClick={() => { setCode(""); setStep({ ...step, useRecovery: !step.useRecovery }); }}>
              {step.useRecovery ? "Usa l'app di autenticazione" : "Non hai il telefono? Usa un recovery code"}
            </Link>
          </Stack>
        </Box>
      </AuthCard>
    );

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
        </Stack>
      </Box>
    </AuthCard>
  );
}
