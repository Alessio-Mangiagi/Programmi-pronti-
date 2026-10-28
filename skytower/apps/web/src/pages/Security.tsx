// "><(((º> sabusabu <º)))><"
// Impostazioni di sicurezza personali: password, sessioni aperte, fattori MFA (app di autenticazione, chiavi di
// sicurezza e passkey) e recovery code.
import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, List, ListItem, ListItemText, Paper, Stack, TextField, Typography } from "@mui/material";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { RecoveryCodes } from "../components/AuthCard";
import { createCredential, webauthnError, webauthnSupported } from "../webauthn";

interface Factors { factors: { id: string; method: string; label: string; discoverable: boolean | null; created_at: string; last_used_at: string | null }[]; recovery_codes_remaining: number }
interface Enrollment { factor_id: string; secret: string; qr_svg: string }
interface Ceremony { challenge_id: string; options: Record<string, unknown> }

const METHOD = { TOTP: "app di autenticazione", WEBAUTHN: "chiave di sicurezza" } as Record<string, string>;

export function SecurityPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [keyLabel, setKeyLabel] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["mfa-factors"], queryFn: () => api<Factors>("/auth/mfa/factors") });

  const start = useMutation({
    mutationFn: () => api<Enrollment>("/auth/mfa/totp/enroll", { method: "POST", json: {} }),
    onSuccess: setEnrollment,
  });
  const confirm = useMutation({
    mutationFn: () => api<{ recovery_codes: string[] }>("/auth/mfa/totp/confirm", { method: "POST", json: { factor_id: enrollment!.factor_id, code } }),
    onSuccess: (r) => { setCodes(r.recovery_codes); setEnrollment(null); setCode(""); qc.invalidateQueries({ queryKey: ["mfa-factors"] }); },
  });
  const addKey = useMutation({
    mutationFn: async () => {
      const c = await api<Ceremony>("/auth/mfa/webauthn/register/options", { method: "POST", json: {} });
      const credential = await createCredential(c.options);
      return api<{ recovery_codes: string[] | null }>("/auth/mfa/webauthn/register/verify", {
        method: "POST", json: { challenge_id: c.challenge_id, credential, label: keyLabel.trim() || "Chiave di sicurezza" },
      });
    },
    onMutate: () => setKeyError(null),
    onSuccess: (r) => { if (r.recovery_codes) setCodes(r.recovery_codes); setKeyLabel(""); qc.invalidateQueries({ queryKey: ["mfa-factors"] }); },
    onError: (e) => setKeyError(e instanceof ApiError ? e.message : webauthnError(e) ?? "Errore di rete"),
  });
  const regenerate = useMutation({
    mutationFn: () => api<{ recovery_codes: string[] }>("/auth/mfa/recovery-codes", { method: "POST" }),
    onSuccess: (r) => { setCodes(r.recovery_codes); qc.invalidateQueries({ queryKey: ["mfa-factors"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/auth/mfa/factors/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mfa-factors"] }),
  });
  const error = [start.error, confirm.error, regenerate.error, remove.error].find(Boolean) as ApiError | undefined;

  return (
    <Stack spacing={2} maxWidth={640}>
      <Typography variant="h4" fontWeight={600}>Sicurezza</Typography>
      <PasswordPanel />
      <SessionsPanel />
      {me?.mfa_required && <Alert severity="info">La tua organizzazione richiede l'autenticazione a due fattori.</Alert>}
      {error && <Alert severity="error">{error.message}</Alert>}
      {codes && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography fontWeight={600}>Nuovi recovery code — salvali ora</Typography>
          <RecoveryCodes codes={codes} />
          <Button onClick={() => setCodes(null)}>Fatto</Button>
        </Paper>
      )}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>Secondo fattore</Typography>
        <List dense>
          {data?.factors.map((f) => (
            <ListItem key={f.id} secondaryAction={<Button color="error" size="small" disabled={!me?.mfa} onClick={() => remove.mutate(f.id)}>Rimuovi</Button>}>
              <ListItemText primary={`${f.label} (${METHOD[f.method] ?? f.method})`}
                            secondary={`Aggiunta il ${new Date(f.created_at).toLocaleDateString("it-IT")}${f.last_used_at ? ` · ultimo uso ${new Date(f.last_used_at).toLocaleString("it-IT")}` : ""}${f.discoverable ? " · vale anche per l'accesso senza password" : ""}`} />
            </ListItem>
          ))}
        </List>
        {data?.factors.length === 0 && <Typography variant="body2" color="text.secondary" mb={1}>Nessun fattore configurato.</Typography>}
        {enrollment ? (
          <Stack spacing={2} alignItems="flex-start">
            <img src={enrollment.qr_svg} alt="QR code MFA" width={180} height={180} />
            <Typography variant="caption" fontFamily="monospace">{enrollment.secret}</Typography>
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="Codice a 6 cifre" value={code} onChange={(e) => setCode(e.target.value.trim())} />
              <Button variant="contained" disabled={!/^\d{6}$/.test(code)} onClick={() => confirm.mutate()}>Conferma</Button>
            </Stack>
          </Stack>
        ) : (
          <Button variant="outlined" onClick={() => start.mutate()}>Aggiungi app di autenticazione</Button>
        )}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-label="Chiavi di sicurezza e passkey">
        <Typography variant="subtitle1" fontWeight={600}>Chiavi di sicurezza e passkey</Typography>
        <Typography variant="body2" color="text.secondary" mb={1.5}>
          Una chiave USB/NFC (es. YubiKey) o la passkey del telefono o del computer: al login basta toccarla,
          niente codici da ricopiare, e non funziona su siti falsi che imitano questo. Con una passkey si può anche
          entrare senza password, dal pulsante "Usa una passkey" della pagina di accesso.
        </Typography>
        {keyError && <Alert severity="error" sx={{ mb: 1.5 }}>{keyError}</Alert>}
        {webauthnSupported() ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <TextField size="small" label="Nome della chiave" placeholder="Es. YubiKey ufficio" value={keyLabel}
                       inputProps={{ maxLength: 60 }} onChange={(e) => setKeyLabel(e.target.value)} />
            <Button variant="outlined" disabled={addKey.isPending} onClick={() => addKey.mutate()}>Aggiungi chiave di sicurezza</Button>
          </Stack>
        ) : <Alert severity="info">Questo browser non supporta le chiavi di sicurezza.</Alert>}
      </Paper>
      {!!data?.factors.length && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>Recovery code</Typography>
          <Typography variant="body2" color="text.secondary" mb={1}>Rimasti: {data.recovery_codes_remaining}</Typography>
          <Button variant="outlined" disabled={!me?.mfa} onClick={() => regenerate.mutate()}>Rigenera</Button>
          {!me?.mfa && <Typography variant="caption" display="block" mt={1}>Per rigenerarli accedi con il secondo fattore.</Typography>}
        </Paper>
      )}
    </Stack>
  );
}

function PasswordPanel() {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [done, setDone] = useState<string | null>(null);
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: () => api<{ sessions_closed: number }>("/auth/password/change", {
      method: "POST", json: { current_password: form.current, new_password: form.next },
    }),
    onSuccess: (r) => {
      setForm({ current: "", next: "", confirm: "" });
      setDone(`Password cambiata${r.sessions_closed ? `: chiuse ${r.sessions_closed} sessioni su altri dispositivi` : ""}`);
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onMutate: () => setDone(null),
  });
  const mismatch = !!form.confirm && form.confirm !== form.next;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!mismatch) change.mutate(); };
  return (
    <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-label="Password">
      <Typography variant="subtitle1" fontWeight={600}>Password</Typography>
      <Typography variant="body2" color="text.secondary" mb={1.5}>
        Almeno 12 caratteri, senza la tua email. Cambiandola esci da tutti gli altri dispositivi.
      </Typography>
      {done && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setDone(null)}>{done}</Alert>}
      {change.error && <Alert severity="error" sx={{ mb: 1.5 }}>{(change.error as ApiError).message}</Alert>}
      <Box component="form" onSubmit={submit}>
        <Stack spacing={1.5} maxWidth={360}>
          <TextField size="small" type="password" label="Password attuale" autoComplete="current-password" required
                     value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
          <TextField size="small" type="password" label="Nuova password" autoComplete="new-password" required
                     value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
          <TextField size="small" type="password" label="Ripeti la nuova password" autoComplete="new-password" required
                     value={form.confirm} error={mismatch} helperText={mismatch ? "Le due password non coincidono" : " "}
                     onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          <Box><Button type="submit" variant="outlined" disabled={change.isPending || mismatch}>Cambia password</Button></Box>
        </Stack>
      </Box>
    </Paper>
  );
}

interface Session { family_id: string; signed_in_at: string; last_seen_at: string; ip: string | null; user_agent: string | null; current: boolean }

/** "Firefox su Windows" dallo user agent: basta per riconoscere i propri dispositivi. */
function device(ua: string | null): string {
  if (!ua) return "Dispositivo sconosciuto";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} su ${os}` : browser;
}

function SessionsPanel() {
  const qc = useQueryClient();
  const { data: sessions = [] } = useQuery({ queryKey: ["sessions"], queryFn: () => api<Session[]>("/auth/sessions") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["sessions"] });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const others = useMutation({ mutationFn: () => api("/auth/sessions/revoke-others", { method: "POST" }), onSuccess: refresh });
  const fmt = (d: string) => new Date(d).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
  return (
    <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-label="Sessioni aperte">
      <Typography variant="subtitle1" fontWeight={600}>Sessioni aperte</Typography>
      <Typography variant="body2" color="text.secondary">
        I dispositivi da cui hai fatto l'accesso. Se non ne riconosci uno, chiudilo e cambia la password.
      </Typography>
      <List dense>
        {sessions.map((s) => (
          <ListItem key={s.family_id} secondaryAction={s.current ? <Chip size="small" color="success" label="Questo dispositivo" />
            : <Button size="small" color="error" disabled={revoke.isPending} onClick={() => revoke.mutate(s.family_id)}
                      aria-label={`Chiudi la sessione ${device(s.user_agent)} ${s.ip ?? ""}`}>Chiudi</Button>}>
            <ListItemText primary={`${device(s.user_agent)}${s.ip ? ` · ${s.ip}` : ""}`}
                          secondary={`Accesso il ${fmt(s.signed_in_at)} · ultima attività ${fmt(s.last_seen_at)}`} />
          </ListItem>
        ))}
      </List>
      {sessions.filter((s) => !s.current).length > 0 && (
        <Button variant="outlined" color="error" disabled={others.isPending} onClick={() => others.mutate()}>
          Esci da tutti gli altri dispositivi
        </Button>
      )}
    </Paper>
  );
}
