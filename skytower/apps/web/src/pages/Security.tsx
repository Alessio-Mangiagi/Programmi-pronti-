// "><(((º> sabusabu <º)))><"
// Impostazioni di sicurezza personali: fattori MFA (app di autenticazione, chiavi di sicurezza e passkey) e recovery code.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, List, ListItem, ListItemText, Paper, Stack, TextField, Typography } from "@mui/material";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { RecoveryCodes } from "../components/AuthCard";
import { createCredential, webauthnError, webauthnSupported } from "../webauthn";

interface Factors { factors: { id: string; method: string; label: string; created_at: string; last_used_at: string | null }[]; recovery_codes_remaining: number }
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
                            secondary={`Aggiunta il ${new Date(f.created_at).toLocaleDateString("it-IT")}${f.last_used_at ? ` · ultimo uso ${new Date(f.last_used_at).toLocaleString("it-IT")}` : ""}`} />
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
          niente codici da ricopiare, e non funziona su siti falsi che imitano questo.
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
