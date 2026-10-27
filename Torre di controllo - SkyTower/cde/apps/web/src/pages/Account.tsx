// "><(((º> sabusabu <º)))><"
// Pagine pubbliche: accettazione invito, password dimenticata, reset password.
import { FormEvent, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { Alert, Box, Button, Link, Stack, TextField } from "@mui/material";
import { api, ApiError } from "../api";
import { AuthCard } from "../components/AuthCard";

function PasswordForm({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("Le password non coincidono");
    try {
      await onSubmit(password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Errore di rete");
    }
  };

  if (done)
    return (
      <Stack spacing={2}>
        <Alert severity="success">Password impostata.</Alert>
        <Button variant="contained" component={RouterLink} to="/login">Vai al login</Button>
      </Stack>
    );
  return (
    <Box component="form" onSubmit={submit}>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Nuova password" type="password" autoComplete="new-password" value={password}
                   onChange={(e) => setPassword(e.target.value)} helperText="Almeno 12 caratteri" required />
        <TextField label="Conferma password" type="password" autoComplete="new-password" value={confirm}
                   onChange={(e) => setConfirm(e.target.value)} required />
        <Button type="submit" variant="contained">{submitLabel}</Button>
      </Stack>
    </Box>
  );
}

export function InvitationPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  return (
    <AuthCard title="Attiva il tuo account" subtitle="Scegli una password per accedere al CDE.">
      <PasswordForm submitLabel="Attiva account" onSubmit={(password) =>
        api(`/auth/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", json: { password } }).then(() => undefined)} />
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  return (
    <AuthCard title="Reimposta password">
      <PasswordForm submitLabel="Reimposta" onSubmit={(password) =>
        api("/auth/password/reset", { method: "POST", json: { token, password } }).then(() => undefined)} />
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <AuthCard title="Password dimenticata" subtitle="Riceverai un link valido 30 minuti.">
      {sent ? (
        <Alert severity="info">Se l'indirizzo è registrato, riceverai un'email con le istruzioni.</Alert>
      ) : (
        <Box component="form" onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          await api("/auth/password/forgot", { method: "POST", json: { email } }).catch(() => undefined);
          setSent(true);
        }}>
          <Stack spacing={2}>
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" variant="contained">Invia link</Button>
          </Stack>
        </Box>
      )}
      <Link component={RouterLink} to="/login" variant="body2" display="block" mt={2} textAlign="center">Torna al login</Link>
    </AuthCard>
  );
}
