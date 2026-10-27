// "><(((º> sabusabu <º)))><"
// Impostazioni di sicurezza personali: fattori MFA e recovery code.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, List, ListItem, ListItemText, Paper, Stack, TextField, Typography } from "@mui/material";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { RecoveryCodes } from "../components/AuthCard";

interface Factors { factors: { id: string; method: string; label: string; created_at: string; last_used_at: string | null }[]; recovery_codes_remaining: number }
interface Enrollment { factor_id: string; secret: string; qr_svg: string }

export function SecurityPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const { data } = useQuery({ queryKey: ["mfa-factors"], queryFn: () => api<Factors>("/auth/mfa/factors") });

  const start = useMutation({
    mutationFn: () => api<Enrollment>("/auth/mfa/totp/enroll", { method: "POST", json: {} }),
    onSuccess: setEnrollment,
  });
  const confirm = useMutation({
    mutationFn: () => api<{ recovery_codes: string[] }>("/auth/mfa/totp/confirm", { method: "POST", json: { factor_id: enrollment!.factor_id, code } }),
    onSuccess: (r) => { setCodes(r.recovery_codes); setEnrollment(null); setCode(""); qc.invalidateQueries({ queryKey: ["mfa-factors"] }); },
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
        <Typography variant="subtitle1" fontWeight={600}>App di autenticazione</Typography>
        <List dense>
          {data?.factors.map((f) => (
            <ListItem key={f.id} secondaryAction={<Button color="error" size="small" disabled={!me?.mfa} onClick={() => remove.mutate(f.id)}>Rimuovi</Button>}>
              <ListItemText primary={`${f.label} (${f.method})`}
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
