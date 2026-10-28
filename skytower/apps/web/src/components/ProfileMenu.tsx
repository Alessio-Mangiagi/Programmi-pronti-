// "><(((º> sabusabu <º)))><"
// Avatar in alto a destra: menu account e dialog "Il mio profilo" (dati anagrafici + preferenze notifiche).
import { ChangeEvent, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Avatar, Box, Button, ButtonBase, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControlLabel, ListItemIcon, Menu, MenuItem, Stack, Switch, TextField, Typography,
} from "@mui/material";
import BusinessIcon from "@mui/icons-material/Business";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LockIcon from "@mui/icons-material/Lock";
import LogoutIcon from "@mui/icons-material/Logout";
import PersonIcon from "@mui/icons-material/Person";
import { api, ApiError, Me } from "../api";
import { useAuth } from "../auth";

export function initials(me: Pick<Me, "first_name" | "last_name">) {
  return `${me.first_name[0] ?? ""}${me.last_name[0] ?? ""}`.toUpperCase();
}

export function ProfileMenu() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  if (!me) return null;

  return (
    <>
      <ButtonBase onClick={(e) => setAnchor(e.currentTarget)} aria-label="Il mio profilo" aria-haspopup="menu"
                  sx={{ gap: 1.25, pl: 0.5, pr: 1, height: 44, borderRadius: 22, bgcolor: "rgba(255,255,255,.12)",
                        "&:hover": { bgcolor: "rgba(255,255,255,.2)" } }}>
        <Avatar sx={{ width: 36, height: 36, bgcolor: "#dbe7f3", color: "primary.main", fontWeight: 700, fontSize: 15 }}>
          {initials(me)}
        </Avatar>
        <Box textAlign="left" lineHeight={1.2} sx={{ display: { xs: "none", sm: "block" } }}>
          <Typography variant="body2" fontWeight={600} lineHeight={1.2}>{me.first_name} {me.last_name}</Typography>
          <Typography variant="caption" sx={{ color: "#dbe7f3" }}>{me.organization_name}</Typography>
        </Box>
        <ExpandMoreIcon fontSize="small" />
      </ButtonBase>
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { width: 300, mt: 1 } } }}>
        <Box px={2} py={1.5}>
          <Typography fontWeight={600}>{me.first_name} {me.last_name}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{me.email}</Typography>
          <Typography variant="body2" color="text.secondary">{me.organization_name} · {me.organization_code}</Typography>
          <Chip size="small" sx={{ mt: 1 }} color={me.mfa ? "success" : me.mfa_required ? "warning" : "default"}
                label={me.mfa ? "MFA attiva" : me.mfa_required ? "MFA richiesta" : "MFA non attiva"} />
        </Box>
        <Divider />
        <MenuItem onClick={() => { setAnchor(null); setEditing(true); }}>
          <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>Modifica il mio profilo
        </MenuItem>
        <MenuItem component={RouterLink} to="/sicurezza" onClick={() => setAnchor(null)}>
          <ListItemIcon><LockIcon fontSize="small" /></ListItemIcon>Password e autenticazione a due fattori
        </MenuItem>
        {(me.is_org_admin || me.is_platform_admin) && (
          <MenuItem component={RouterLink} to="/organizzazione" onClick={() => setAnchor(null)}>
            <ListItemIcon><BusinessIcon fontSize="small" /></ListItemIcon>
            {me.is_platform_admin ? "Organizzazioni e utenti" : "La mia organizzazione e gli utenti"}
          </MenuItem>
        )}
        <Divider />
        <MenuItem sx={{ color: "error.main" }} onClick={async () => { setAnchor(null); await logout(); navigate("/login"); }}>
          <ListItemIcon><LogoutIcon fontSize="small" color="error" /></ListItemIcon>Esci
        </MenuItem>
      </Menu>
      {editing && <ProfileDialog me={me} onClose={() => setEditing(false)} />}
    </>
  );
}

interface Preferences { email_enabled: boolean; daily_digest: boolean; locale: "it" | "en" }

function ProfileDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: me.first_name, last_name: me.last_name, phone: me.phone ?? "", job_title: me.job_title ?? "",
  });
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const { data: savedPrefs } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => api<Preferences>("/me/notification-preferences"),
  });
  useEffect(() => { if (savedPrefs && !prefs) setPrefs(savedPrefs); }, [savedPrefs, prefs]);

  const save = useMutation({
    mutationFn: async () => {
      await api<Me>("/me", { method: "PATCH", json: form });
      if (prefs) await api("/me/notification-preferences", { method: "PUT", json: prefs });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["notification-preferences"] });
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const valid = form.first_name.trim() && form.last_name.trim() && /^(\+?[0-9 ./()-]{5,30})?$/.test(form.phone.trim());

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Il mio profilo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {save.error && <Alert severity="error">{(save.error as ApiError).message}</Alert>}
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar sx={{ width: 56, height: 56, bgcolor: "#dbe7f3", color: "primary.main", fontWeight: 700 }}>
              {initials({ first_name: form.first_name || " ", last_name: form.last_name || " " })}
            </Avatar>
            <Box>
              <Typography fontWeight={600}>{me.email}</Typography>
              <Typography variant="body2" color="text.secondary">
                {me.organization_name} — email e organizzazione le modifica l'amministratore
              </Typography>
            </Box>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Nome" value={form.first_name} onChange={set("first_name")} fullWidth required />
            <TextField label="Cognome" value={form.last_name} onChange={set("last_name")} fullWidth required />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Telefono" value={form.phone} onChange={set("phone")} fullWidth
                       error={!/^(\+?[0-9 ./()-]{5,30})?$/.test(form.phone.trim())} />
            <TextField label="Qualifica" value={form.job_title} onChange={set("job_title")} fullWidth
                       placeholder="es. Project manager" />
          </Stack>
          <Divider />
          <Typography variant="subtitle2">Notifiche</Typography>
          {prefs && (
            <>
              <TextField select label="Lingua delle email" value={prefs.locale}
                         onChange={(e) => setPrefs({ ...prefs, locale: e.target.value as "it" | "en" })}>
                <MenuItem value="it">Italiano</MenuItem>
                <MenuItem value="en">English</MenuItem>
              </TextField>
              <FormControlLabel label="Ricevi le notifiche anche via email"
                                control={<Switch checked={prefs.email_enabled}
                                                 onChange={(e) => setPrefs({ ...prefs, email_enabled: e.target.checked })} />} />
              <FormControlLabel label="Un solo riepilogo al giorno invece di un'email per ogni notifica"
                                control={<Switch checked={prefs.daily_digest} disabled={!prefs.email_enabled}
                                                 onChange={(e) => setPrefs({ ...prefs, daily_digest: e.target.checked })} />} />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!valid || save.isPending} onClick={() => save.mutate()}>Salva</Button>
      </DialogActions>
    </Dialog>
  );
}
