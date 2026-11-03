// "><(((º> sabusabu <º)))><"
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Autocomplete, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { api, Project } from "../../api";

interface CommessaRegistro { code: string; nome: string; stato: string; cliente: string; indirizzo: string; note: string }

/**
 * Scheda "Suite": il codice commessa aziendale (es. 101-003) con cui le altre app della
 * suite Cosedil (InCampo, Magazzino Operativo) riconoscono questo progetto. Viaggia in
 * `settings.commessa` (PATCH /projects/{id}); solo il Project Admin lo cambia.
 * Il codice si sceglie dal registro unico della suite (shared/suite/commesse.json, curato dal
 * portale): testo libero solo se il registro è vuoto.
 */
export function SuiteTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const [commessa, setCommessa] = useState(project.settings?.commessa ?? "");
  const registro = useQuery({
    queryKey: ["suite-registro"],
    queryFn: () => api<{ commesse: CommessaRegistro[] }>("/suite/registro"),
    staleTime: 60_000,
  });
  const salva = useMutation({
    mutationFn: (valore: string) =>
      api(`/projects/${project.id}`, { method: "PATCH", json: { settings: { ...(project.settings ?? {}), commessa: valore.trim() } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", project.id] }),
  });
  const attuale = project.settings?.commessa ?? "";
  const voci = registro.data?.commesse ?? [];
  // il codice già salvato resta scelto anche se nel registro non c'è più (chiusa) o il registro è vuoto
  const opzioni = voci.some((v) => v.code === attuale) || !attuale ? voci : [{ code: attuale, nome: "", stato: "", cliente: "", indirizzo: "", note: "" }, ...voci];
  const etichetta = (code: string) => {
    const v = voci.find((x) => x.code === code);
    return v && v.nome ? `${v.code} · ${v.nome}` : code;
  };
  const helper = attuale
    ? `Attuale: ${attuale}. Il codice ISO del progetto (${project.code}) vale come ripiego.`
    : `Senza codice vale il codice ISO del progetto (${project.code}).`;

  return (
    <Stack spacing={2} maxWidth={720}>
      <Typography variant="h6">Collegamento con la suite Cosedil</Typography>
      <Typography color="text.secondary">
        InCampo (cantieri, task, non conformità) e il Magazzino Operativo (materiale e mezzi) riconoscono questo
        progetto dal <b>codice commessa aziendale</b>: lo stesso che InCampo ha sulla commessa e il Magazzino
        sull'ubicazione del cantiere. Con il codice impostato, da InCampo si scelgono le tavole pubblicate qui
        come planimetrie e i PDF dei moduli arrivano nella cartella «Suite Cosedil»; dal Magazzino arriva il
        report delle giacenze.
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          {voci.length > 0 ? (
            <Autocomplete
              options={opzioni.map((v) => v.code)}
              value={commessa || null}
              onChange={(_, v) => setCommessa(v ?? "")}
              getOptionLabel={etichetta}
              disabled={!canManage || salva.isPending}
              renderInput={(params) => (
                <TextField {...params} label="Codice commessa aziendale" placeholder="Scegli dal registro della suite" helperText={helper} />
              )}
            />
          ) : (
            <TextField
              label="Codice commessa aziendale"
              value={commessa}
              onChange={(e) => setCommessa(e.target.value)}
              placeholder="es. 101-003"
              helperText={`${helper} Il registro delle commesse del portale è vuoto: l'admin lo compila nella pagina Commesse.`}
              disabled={!canManage || salva.isPending}
              inputProps={{ maxLength: 40 }}
            />
          )}
          {canManage && (
            <Box>
              <Button variant="contained" onClick={() => salva.mutate(commessa)} disabled={salva.isPending || commessa.trim() === attuale}>
                Salva
              </Button>
            </Box>
          )}
          {salva.isSuccess && <Alert severity="success">Codice commessa salvato.</Alert>}
          {salva.isError && <Alert severity="error">{(salva.error as Error).message}</Alert>}
          {!canManage && <Alert severity="info">Solo il Project Admin può cambiare il codice.</Alert>}
        </Stack>
      </Paper>
      <Typography variant="body2" color="text.secondary">
        I documenti che arrivano dalle altre app nascono in stato WIP, nella cartella «Suite Cosedil»
        dell'organizzazione di chi li manda, con il nome a norma (rinomina automatica se attiva, altrimenti primo
        progressivo libero, tipo RP, ruolo Z). Le chiamate sono attribuite all'utente SkyTower con la stessa email
        dell'utente del portale; chi entra dal portale senza un account lo riceve al primo accesso, membro dei
        progetti che hanno un codice commessa.
      </Typography>
    </Stack>
  );
}
