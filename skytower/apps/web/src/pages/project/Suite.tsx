// "><(((º> sabusabu <º)))><"
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { api, Project } from "../../api";

/**
 * Scheda "Suite": il codice commessa aziendale (es. 101-003) con cui le altre app della
 * suite Cosedil (InCampo, Magazzino Operativo) riconoscono questo progetto. Viaggia in
 * `settings.commessa` (PATCH /projects/{id}); solo il Project Admin lo cambia.
 */
export function SuiteTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const [commessa, setCommessa] = useState(project.settings?.commessa ?? "");
  const salva = useMutation({
    mutationFn: (valore: string) =>
      api(`/projects/${project.id}`, { method: "PATCH", json: { settings: { ...(project.settings ?? {}), commessa: valore.trim() } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", project.id] }),
  });
  const attuale = project.settings?.commessa ?? "";

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
          <TextField
            label="Codice commessa aziendale"
            value={commessa}
            onChange={(e) => setCommessa(e.target.value)}
            placeholder="es. 101-003"
            helperText={attuale ? `Attuale: ${attuale}. Il codice ISO del progetto (${project.code}) vale come ripiego.` : `Senza codice vale il codice ISO del progetto (${project.code}).`}
            disabled={!canManage || salva.isPending}
            inputProps={{ maxLength: 40 }}
          />
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
        dell'utente del portale; se non esiste, all'utente tecnico configurato dall'amministratore.
      </Typography>
    </Stack>
  );
}
