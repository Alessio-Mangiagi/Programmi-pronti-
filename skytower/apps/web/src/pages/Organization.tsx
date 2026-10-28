// "><(((º> sabusabu <º)))><"
// La mia organizzazione (org admin): dati, policy MFA, utenti — inviti, reinvio, disattivazione, ruolo di admin.
// Il platform admin sceglie l'organizzazione da gestire e ne crea di nuove.
import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Stack,
  Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface Org { id: string; legal_name: string; vat_number: string | null; code: string; status: string; mfa_required: boolean }
interface OrgUser {
  id: string; email: string; first_name: string; last_name: string; status: "INVITED" | "ACTIVE" | "LOCKED" | "DISABLED";
  is_org_admin: boolean; last_login_at: string | null; job_title: string | null;
  mfa_methods?: string[]; recovery_codes_left?: number;
}

const MFA_LABEL: Record<string, string> = { TOTP: "App", WEBAUTHN: "Chiave" };

const STATUS: Record<OrgUser["status"], { label: string; color: "default" | "success" | "warning" | "error" }> = {
  INVITED: { label: "Invitato", color: "warning" }, ACTIVE: { label: "Attivo", color: "success" },
  LOCKED: { label: "Bloccato", color: "error" }, DISABLED: { label: "Disattivato", color: "default" },
};

export function OrganizationPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const orgId = params.get("org") ?? me?.organization_id ?? "";
  const { data: orgs = [] } = useQuery({
    queryKey: ["organizations"], queryFn: () => api<Org[]>("/organizations"), enabled: !!me?.is_platform_admin,
  });
  const [creating, setCreating] = useState(false);

  if (!me) return null;
  if (!me.is_org_admin && !me.is_platform_admin)
    return <Alert severity="info">Solo gli amministratori dell'organizzazione gestiscono utenti e impostazioni.</Alert>;

  return (
    <Stack spacing={2} maxWidth={1000}>
      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
        <Typography variant="h4" fontWeight={600} flexGrow={1}>Organizzazione</Typography>
        {me.is_platform_admin && (
          <>
            <TextField select size="small" label="Organizzazione da gestire" value={orgId} sx={{ minWidth: 280 }}
                       onChange={(e) => setParams({ org: e.target.value })}>
              {orgs.map((o) => <MenuItem key={o.id} value={o.id}>{o.legal_name} · {o.code}</MenuItem>)}
            </TextField>
            <Button variant="outlined" onClick={() => setCreating(true)}>Nuova organizzazione</Button>
          </>
        )}
      </Stack>
      {orgId && <OrgDetails orgId={orgId} meId={me.id} />}
      {creating && <NewOrgDialog onClose={() => setCreating(false)} onCreated={(o) => { setCreating(false); setParams({ org: o.id }); }} />}
    </Stack>
  );
}

function OrgDetails({ orgId, meId }: { orgId: string; meId: string }) {
  const qc = useQueryClient();
  const { data: org, error } = useQuery({ queryKey: ["organization", orgId], queryFn: () => api<Org>(`/organizations/${orgId}`) });
  const { data: users = [] } = useQuery({
    queryKey: ["organization", orgId, "users"], queryFn: () => api<OrgUser[]>(`/organizations/${orgId}/users`),
  });
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["organization", orgId] });

  const patchOrg = useMutation({
    mutationFn: (body: Partial<Org>) => api(`/organizations/${orgId}`, { method: "PATCH", json: body }),
    onSuccess: refresh,
  });
  const patchUser = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; is_org_admin?: boolean }) =>
      api(`/organizations/${orgId}/users/${id}`, { method: "PATCH", json: body }),
    onSuccess: refresh,
  });
  const resend = useMutation({
    mutationFn: (u: OrgUser) => api(`/organizations/${orgId}/users/${u.id}/invitation`, { method: "POST" }),
    onSuccess: (_, u) => setNotice(`Invito inviato di nuovo a ${u.email}`),
  });
  const [resetting, setResetting] = useState<OrgUser | null>(null);
  const resetMfa = useMutation({
    mutationFn: (u: OrgUser) => api(`/organizations/${orgId}/users/${u.id}/mfa/reset`, { method: "POST" }),
    onSuccess: (_, u) => { setResetting(null); setNotice(`Secondo fattore azzerato per ${u.email}: al prossimo accesso lo configurerà di nuovo`); refresh(); },
  });
  const failure = [patchOrg.error, patchUser.error, resend.error, resetMfa.error].find(Boolean) as ApiError | undefined;

  if (error) return <Alert severity="error">{(error as ApiError).message}</Alert>;
  if (!org) return null;
  const admins = users.filter((u) => u.is_org_admin && u.status === "ACTIVE").length;

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h5" fontWeight={600}>{org.legal_name}</Typography>
        <Typography variant="body2" color="text.secondary">
          Codice originatore <b>{org.code}</b>{org.vat_number ? ` · P. IVA ${org.vat_number}` : ""}
        </Typography>
        <FormControlLabel sx={{ mt: 1 }} label="Autenticazione a due fattori obbligatoria per tutti gli utenti"
          control={<Switch checked={org.mfa_required} disabled={patchOrg.isPending}
                           onChange={(e) => patchOrg.mutate({ mfa_required: e.target.checked })} />} />
        {!org.mfa_required && (
          <Alert severity="warning" sx={{ mt: 1 }}>Senza MFA obbligatoria basta la password: chi la scopre entra nel CDE.</Alert>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-label="Utenti dell'organizzazione">
        <Stack direction="row" alignItems="center" mb={1}>
          <Typography variant="h6" component="h3" fontWeight={600} flexGrow={1}>Utenti ({users.length})</Typography>
          <Button variant="contained" onClick={() => setInviting(true)}>Invita utente</Button>
        </Stack>
        {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 1 }}>{notice}</Alert>}
        {failure && <Alert severity="error" sx={{ mb: 1 }}>{failure.message}</Alert>}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Utente</TableCell><TableCell>Stato</TableCell>
              <TableCell>MFA</TableCell><TableCell>Admin</TableCell><TableCell align="right">Azioni</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => {
              const self = u.id === meId;
              const lastAdmin = u.is_org_admin && admins <= 1;
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{u.first_name} {u.last_name}{self ? " (tu)" : ""}</Typography>
                    <Typography variant="body2" color="text.secondary">{u.email}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Ultimo accesso: {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString("it-IT") : "mai"}
                    </Typography>
                  </TableCell>
                  <TableCell><Chip size="small" label={STATUS[u.status].label} color={STATUS[u.status].color} /></TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {u.mfa_methods?.length
                      ? u.mfa_methods.map((m) => <Chip key={m} size="small" variant="outlined" label={MFA_LABEL[m] ?? m} sx={{ mr: 0.5 }} />)
                      : <Typography variant="body2" color={org.mfa_required && u.status === "ACTIVE" ? "warning.dark" : "text.secondary"}>
                          {org.mfa_required && u.status === "ACTIVE" ? "da configurare" : "no"}
                        </Typography>}
                  </TableCell>
                  <TableCell>
                    <Switch size="small" checked={u.is_org_admin} disabled={self || patchUser.isPending || lastAdmin}
                            inputProps={{ "aria-label": `Amministratore: ${u.first_name} ${u.last_name}` }}
                            onChange={(e) => patchUser.mutate({ id: u.id, is_org_admin: e.target.checked })} />
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    {!self && !!u.mfa_methods?.length && (
                      <Button size="small" onClick={() => setResetting(u)}>Azzera MFA</Button>
                    )}
                    {u.status === "INVITED" && (
                      <Button size="small" disabled={resend.isPending} onClick={() => resend.mutate(u)}>Reinvia invito</Button>
                    )}
                    {!self && u.status !== "INVITED" && (
                      u.status === "DISABLED"
                        ? <Button size="small" onClick={() => patchUser.mutate({ id: u.id, status: "ACTIVE" })}>Riattiva</Button>
                        : <Button size="small" color="error" onClick={() => patchUser.mutate({ id: u.id, status: "DISABLED" })}
                                  aria-label={`Disattiva ${u.first_name} ${u.last_name}`}>Disattiva</Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" display="block" mt={1}>
          Un utente disattivato non accede più e i suoi link già emessi smettono di funzionare; i documenti e lo storico restano.
        </Typography>
      </Paper>
      {resetting && (
        <Dialog open onClose={() => setResetting(null)} maxWidth="xs">
          <DialogTitle>Azzerare l'MFA di {resetting.first_name} {resetting.last_name}?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              Si eliminano app di autenticazione, chiavi di sicurezza e recovery code, e si chiudono le sessioni aperte.
              Fallo solo dopo aver verificato l'identità della persona (es. per telefono): chi ha solo la password
              potrà configurare un nuovo secondo fattore.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setResetting(null)}>Annulla</Button>
            <Button color="error" variant="contained" disabled={resetMfa.isPending} onClick={() => resetMfa.mutate(resetting)}>Azzera</Button>
          </DialogActions>
        </Dialog>
      )}
      {inviting && <InviteDialog org={org} onClose={() => setInviting(false)}
                                 onInvited={(email) => { setInviting(false); setNotice(`Invito inviato a ${email}`); refresh(); }} />}
    </>
  );
}

function InviteDialog({ org, onClose, onInvited }: { org: Org; onClose: () => void; onInvited: (email: string) => void }) {
  const [form, setForm] = useState({ email: "", first_name: "", last_name: "", is_org_admin: false });
  const invite = useMutation({
    mutationFn: () => api(`/organizations/${org.id}/users`, { method: "POST", json: form }),
    onSuccess: () => onInvited(form.email),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); invite.mutate(); };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ component: "form", onSubmit: submit }}>
      <DialogTitle>Invita in {org.legal_name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {invite.error && <Alert severity="error">{(invite.error as ApiError).message}</Alert>}
          <TextField label="Email" type="email" required value={form.email} autoFocus
                     onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextField label="Nome" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <TextField label="Cognome" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <FormControlLabel label="Amministratore dell'organizzazione" control={
            <Switch checked={form.is_org_admin} onChange={(e) => setForm({ ...form, is_org_admin: e.target.checked })} />} />
          <Typography variant="caption" color="text.secondary">
            Riceverà un'email con il link per scegliere la password; il link scade dopo 72 ore.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button type="submit" variant="contained" disabled={invite.isPending}>Invia invito</Button>
      </DialogActions>
    </Dialog>
  );
}

function NewOrgDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (o: Org) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ legal_name: "", code: "", vat_number: "", mfa_required: true });
  const create = useMutation({
    mutationFn: () => api<Org>("/organizations", { method: "POST", json: { ...form, vat_number: form.vat_number.trim() || null } }),
    onSuccess: (o) => { qc.invalidateQueries({ queryKey: ["organizations"] }); onCreated(o); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ component: "form", onSubmit: submit }}>
      <DialogTitle>Nuova organizzazione</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
          <TextField label="Ragione sociale" required value={form.legal_name} autoFocus
                     onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
          <TextField label="Codice originatore ISO 19650" required value={form.code} helperText="Da 3 a 6 lettere maiuscole o cifre"
                     inputProps={{ pattern: "[A-Z0-9]{3,6}", maxLength: 6 }}
                     onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          <TextField label="Partita IVA" value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} />
          <FormControlLabel label="MFA obbligatoria" control={
            <Switch checked={form.mfa_required} onChange={(e) => setForm({ ...form, mfa_required: e.target.checked })} />} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button type="submit" variant="contained" disabled={create.isPending}>Crea</Button>
      </DialogActions>
    </Dialog>
  );
}
