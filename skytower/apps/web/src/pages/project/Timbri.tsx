// "><(((º> sabusabu <º)))><"
// Scheda "Timbri" della commessa (ADR-56): la libreria dei timbri da mettere sui PDF dal visualizzatore.
// Tre gruppi: della commessa (li crea il Project Admin, li usano tutti i membri), della mia organizzazione (li crea
// l'amministratore dell'organizzazione, valgono in tutte le commesse), personali (la propria firma: li vede e usa solo
// chi li ha creati). "Nuovo timbro" carica un PNG o JPG e, come Timbri per VFP, rende trasparente lo sfondo con una
// tolleranza regolabile: l'anteprima è fatta nel browser (scontorno.ts), il PNG salvato lo prepara il server con gli
// stessi parametri. I timbri non si cancellano: si disattivano (le revisioni già timbrate e il registro restano).
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Card, CardActions, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, FormHelperText, Paper, Radio, RadioGroup, Slider, Stack, Switch, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { api, ApiError, type Project } from "../../api";
import { anteprimaScontornata, TOLLERANZA_MASSIMA } from "../../components/timbri/scontorno";
import {
  base64DelFile, NOME_AMBITO, SCACCHI, useImmagineTimbro, useTimbri, type AmbitoTimbro, type ElencoTimbri, type Timbro,
} from "../../components/timbri/timbri";

const ORDINE: AmbitoTimbro[] = ["PROJECT", "ORGANIZATION", "PERSONAL"];
const SPIEGAZIONE: Record<AmbitoTimbro, string> = {
  PROJECT: "Li vedono e li usano tutti i membri della commessa, di ogni organizzazione. Li crea il Project Admin.",
  ORGANIZATION: "Logo e timbro dell'impresa: li usano tutti i colleghi, in tutte le commesse. Li crea l'amministratore dell'organizzazione.",
  PERSONAL: "La tua firma o la tua sigla: le vedi e le usi solo tu, in tutte le tue commesse.",
};
const IMMAGINE_MAX = 8 * 1024 * 1024;           // come timbro_immagine_max_bytes dell'API

export function TimbriTab({ project }: { project: Project }) {
  const [disattivati, setDisattivati] = useState(false);
  const [nuovo, setNuovo] = useState(false);
  const { data, error } = useTimbri(project.id, disattivati);
  if (error) return <Alert severity="error">{(error as ApiError).message}</Alert>;
  if (!data) return null;
  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
        <Box flexGrow={1} minWidth={280}>
          <Typography variant="h6">Timbri</Typography>
          <Typography variant="body2" color="text.secondary">
            Firme, loghi e timbri da mettere sulle pagine dei PDF: nel visualizzatore, «Timbra». Il PDF timbrato diventa
            una nuova revisione in WIP e il registro attività dice chi ha timbrato e quando.
          </Typography>
        </Box>
        <FormControlLabel control={<Switch checked={disattivati} onChange={(e) => setDisattivati(e.target.checked)} />}
                          label="Mostra i disattivati" />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNuovo(true)}>Nuovo timbro</Button>
      </Stack>
      {ORDINE.map((ambito) => {
        const lista = data.timbri.filter((t) => t.scope === ambito);
        return (
          <Paper key={ambito} variant="outlined" sx={{ p: 2 }} component="section" aria-label={NOME_AMBITO[ambito]}>
            <Typography variant="subtitle1" fontWeight={600}>{NOME_AMBITO[ambito]}</Typography>
            <Typography variant="body2" color="text.secondary" mb={1}>{SPIEGAZIONE[ambito]}</Typography>
            {lista.length === 0 ? <Typography variant="body2" color="text.secondary">Nessun timbro.</Typography> : (
              <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(210px, 1fr))" gap={1.5}>
                {lista.map((t) => <SchedaTimbro key={t.id} t={t} projectId={project.id} />)}
              </Box>
            )}
          </Paper>
        );
      })}
      {nuovo && <NuovoTimbroDialog project={project} posso={data.posso_creare} onClose={() => setNuovo(false)} />}
    </Stack>
  );
}

function SchedaTimbro({ t, projectId }: { t: Timbro; projectId: string }) {
  const qc = useQueryClient();
  const { data: url } = useImmagineTimbro(t.id);
  const [rinomina, setRinomina] = useState<string | null>(null);
  const cambia = useMutation({
    mutationFn: (body: { nome?: string; attivo?: boolean }) => api(`/stamps/${t.id}`, { method: "PATCH", json: body }),
    onSuccess: () => { setRinomina(null); qc.invalidateQueries({ queryKey: ["timbri", projectId] }); },
  });
  return (
    <Card variant="outlined" sx={{ opacity: t.disabled_at ? 0.6 : 1 }} aria-label={`Timbro ${t.name}`}>
      <Box height={110} m={1} sx={{ background: SCACCHI, borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {url && <Box component="img" src={url} alt={`Anteprima di ${t.name}`} sx={{ maxWidth: "100%", maxHeight: 104, objectFit: "contain" }} />}
      </Box>
      <CardContent sx={{ py: 0.5 }}>
        <Typography fontWeight={600} noWrap title={t.name}>{t.name}</Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {t.organization_code} · {t.created_by_name ?? "—"} · {new Date(t.created_at).toLocaleDateString("it-IT")}
        </Typography>
        {t.disabled_at && <Chip size="small" label="Disattivato" sx={{ mt: 0.5 }} />}
        {cambia.error && <Alert severity="error" sx={{ mt: 1 }}>{(cambia.error as ApiError).message}</Alert>}
      </CardContent>
      {t.can_manage && (
        <CardActions>
          <Button size="small" onClick={() => setRinomina(t.name)}>Rinomina</Button>
          <Button size="small" color={t.disabled_at ? "primary" : "warning"} disabled={cambia.isPending}
                  onClick={() => cambia.mutate({ attivo: !!t.disabled_at })}>
            {t.disabled_at ? "Riattiva" : "Disattiva"}
          </Button>
        </CardActions>
      )}
      <Dialog open={rinomina !== null} onClose={() => setRinomina(null)}>
        <DialogTitle>Rinomina il timbro</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth margin="dense" label="Nome" value={rinomina ?? ""} inputProps={{ maxLength: 80 }}
                     onChange={(e) => setRinomina(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRinomina(null)}>Annulla</Button>
          <Button variant="contained" disabled={!rinomina?.trim() || cambia.isPending}
                  onClick={() => cambia.mutate({ nome: rinomina!.trim() })}>Salva</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function NuovoTimbroDialog({ project, posso, onClose }: {
  project: Project; posso: ElencoTimbri["posso_creare"]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [nome, setNome] = useState("");
  const [ambito, setAmbito] = useState<AmbitoTimbro>("PERSONAL");
  const [scontorna, setScontorna] = useState(true);
  const [tolleranza, setTolleranza] = useState(15);            // percento, come il cursore di Timbri per VFP
  const [originale, setOriginale] = useState<string | null>(null);
  const [anteprima, setAnteprima] = useState<string | null>(null);
  const [erroreFile, setErroreFile] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setOriginale(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    if (!file || !scontorna) { setAnteprima(null); return; }
    let vivo = true, creato: string | null = null;
    const t = setTimeout(() => {
      anteprimaScontornata(file, tolleranza / 100)
        .then((u) => { if (vivo) { creato = u; setAnteprima(u); } else URL.revokeObjectURL(u); })
        .catch(() => vivo && setErroreFile("Immagine non leggibile: scegliere un PNG o un JPG"));
    }, 150);
    return () => { vivo = false; clearTimeout(t); if (creato) URL.revokeObjectURL(creato); };
  }, [file, scontorna, tolleranza]);

  const scegli = (f: File | undefined) => {
    setErroreFile(null);
    if (!f) return;
    if (!["image/png", "image/jpeg"].includes(f.type)) { setErroreFile("Il timbro deve essere un'immagine PNG o JPG"); return; }
    if (f.size > IMMAGINE_MAX) { setErroreFile("Immagine oltre 8 MB: ridurla prima di caricarla"); return; }
    setFile(f);
    if (!nome) setNome(f.name.replace(/\.[^.]+$/, "").slice(0, 80));
  };
  const crea = useMutation({
    mutationFn: async () => api<Timbro>(`/projects/${project.id}/stamps`, {
      method: "POST",
      json: { nome: nome.trim(), ambito, immagine_base64: await base64DelFile(file!), scontorna,
              tolleranza: Math.min(tolleranza / 100, TOLLERANZA_MASSIMA) },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["timbri", project.id] }); onClose(); },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="nuovo-timbro-titolo">
      <DialogTitle id="nuovo-timbro-titolo">Nuovo timbro</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={0.5}>
          <Box>
            <Button variant="outlined" component="label">
              {file ? "Cambia immagine" : "Scegli l'immagine (PNG o JPG)"}
              <input hidden type="file" accept="image/png,image/jpeg" aria-label="Immagine del timbro"
                     onChange={(e) => scegli(e.target.files?.[0])} />
            </Button>
            {file && <Typography variant="body2" component="span" ml={1}>{file.name}</Typography>}
            <FormHelperText>La firma su un foglio bianco, il logo, il timbro dell'impresa scansionato o fotografato dritto.</FormHelperText>
            {erroreFile && <Alert severity="error" sx={{ mt: 1 }}>{erroreFile}</Alert>}
          </Box>
          <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} inputProps={{ maxLength: 80 }} required />
          <RadioGroup value={ambito} onChange={(e) => setAmbito(e.target.value as AmbitoTimbro)} aria-label="Chi lo può usare">
            {(["PERSONAL", "ORGANIZATION", "PROJECT"] as AmbitoTimbro[]).map((a) => (
              <FormControlLabel key={a} value={a} disabled={!posso[a]} control={<Radio />}
                                label={<Box><Typography variant="body2" fontWeight={600}>{NOME_AMBITO[a]}{a === "PROJECT" ? ` (${project.name})` : ""}</Typography>
                                  <Typography variant="caption" color="text.secondary">{SPIEGAZIONE[a]}</Typography></Box>} />
            ))}
          </RadioGroup>
          <Box>
            <FormControlLabel control={<Switch checked={scontorna} onChange={(e) => setScontorna(e.target.checked)} />}
                              label="Scontorna lo sfondo (rende trasparente il foglio bianco)" />
            <Typography variant="body2" id="tolleranza-label" color={scontorna ? "text.primary" : "text.disabled"}>
              Tolleranza {tolleranza}% — alzarla se restano aloni o la grana della carta, abbassarla se il timbro perde dettagli
            </Typography>
            <Slider value={tolleranza} min={0} max={TOLLERANZA_MASSIMA * 100} step={1} disabled={!scontorna}
                    onChange={(_, v) => setTolleranza(v as number)} aria-labelledby="tolleranza-label" sx={{ maxWidth: 360 }} />
          </Box>
          {file && (
            <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
              <Anteprima titolo="Immagine caricata" url={originale} />
              <Anteprima titolo={scontorna ? "Come sarà il timbro" : "Come sarà il timbro (senza scontorno)"} url={scontorna ? anteprima : originale} />
            </Stack>
          )}
          {crea.error && <Alert severity="error">{(crea.error as ApiError).message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!file || !nome.trim() || crea.isPending} onClick={() => crea.mutate()}>
          {crea.isPending ? "Salvataggio…" : "Crea il timbro"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Anteprima({ titolo, url }: { titolo: string; url: string | null }) {
  return (
    <Box flex={1} minWidth={0}>
      <Typography variant="caption" color="text.secondary">{titolo}</Typography>
      <Box height={180} sx={{ background: SCACCHI, borderRadius: 1, border: 1, borderColor: "divider", display: "flex",
                              alignItems: "center", justifyContent: "center" }}>
        {url && <Box component="img" src={url} alt={titolo} sx={{ maxWidth: "100%", maxHeight: 172, objectFit: "contain" }} />}
      </Box>
    </Box>
  );
}
