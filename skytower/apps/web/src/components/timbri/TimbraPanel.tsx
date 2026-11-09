// "><(((º> sabusabu <º)))><"
// Pannello "Timbra il documento" del visualizzatore (ADR-56), al posto delle annotazioni mentre si timbra: scelta del
// timbro (personali, dell'organizzazione, della commessa), didascalia "Timbrato da … il …", elenco dei timbri messi,
// nota facoltativa e "Salva come nuova revisione" (POST /revisions/{id}/timbra). Il PDF timbrato diventa la WIP
// successiva; la revisione aperta resta com'era. Se il PDF ha una firma digitale PAdES il server chiede conferma
// (409 pdf_firmato): la nuova revisione non avrà più una firma valida.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, ButtonBase, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  FormControlLabel, IconButton, Link, List, ListItem, ListItemText, Stack, TextField, Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { api, ApiError } from "../../api";
import { NOME_AMBITO, SCACCHI, useImmagineTimbro, useTimbri, type Timbro } from "./timbri";
import type { Piazzamento } from "./TimbraLayer";

interface RevisioneCreata { id: string; revision_code: string }

export function TimbraPanel({ projectId, documentId, revisionId, piazzamenti, attivo, didascalia, onScegli, onDidascalia,
                              onTogli, onAnnulla, onSalvato }: {
  projectId: string;
  documentId: string;
  revisionId: string;
  piazzamenti: Piazzamento[];
  attivo: Timbro | null;
  didascalia: boolean;
  onScegli: (t: Timbro | null) => void;
  onDidascalia: (v: boolean) => void;
  onTogli: (chiave: string) => void;
  onAnnulla: () => void;
  onSalvato: (r: RevisioneCreata) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useTimbri(projectId);
  const [nota, setNota] = useState("");
  const [confermaFirma, setConfermaFirma] = useState(false);
  const salva = useMutation({
    mutationFn: (accetta: boolean) => api<RevisioneCreata>(`/revisions/${revisionId}/timbra`, {
      method: "POST",
      json: {
        timbri: piazzamenti.map((p) => ({ timbro_id: p.timbro.id, pagina: p.pagina, x: p.x, y: p.y,
                                          larghezza: p.larghezza, altezza: p.altezza, didascalia: p.didascalia })),
        commento: nota.trim() || null,
        accetta_firma_pdf: accetta,
      },
    }),
    onSuccess: async (r) => {
      setConfermaFirma(false);
      await qc.invalidateQueries({ queryKey: ["document", documentId] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      onSalvato(r);
    },
    onError: (e: ApiError) => { if (e.code === "pdf_firmato") setConfermaFirma(true); },
  });
  const timbri = data?.timbri ?? [];
  const errore = salva.error as ApiError | null;

  return (
    <Stack height="100%" component="section" aria-label="Timbra il documento">
      <Box p={2} pb={1} borderBottom={1} borderColor="divider">
        <Typography variant="subtitle1" fontWeight={600}>Timbra il documento</Typography>
        <Typography variant="body2" color="text.secondary">
          Scegli un timbro e clicca sulla pagina dove metterlo. Trascinalo per spostarlo, tira l'angolo blu per
          ingrandirlo. Il PDF timbrato diventa una nuova revisione in WIP: questa resta com'è.
        </Typography>
      </Box>
      <Box flexGrow={1} overflow="auto" p={2} pt={1}>
        {isLoading && <Typography variant="body2">Caricamento dei timbri…</Typography>}
        {data && timbri.length === 0 && (
          <Alert severity="info">
            Nessun timbro disponibile. Creane uno in{" "}
            <Link href={`/progetti/${projectId}/timbri`} target="_blank" rel="noopener">Timbri della commessa</Link>.
          </Alert>
        )}
        <Box display="grid" gridTemplateColumns="repeat(2, 1fr)" gap={1} role="listbox" aria-label="Timbri disponibili">
          {timbri.map((t) => (
            <SceltaTimbro key={t.id} t={t} scelto={attivo?.id === t.id} onClick={() => onScegli(attivo?.id === t.id ? null : t)} />
          ))}
        </Box>
        {data && timbri.length > 0 && (
          <Link variant="body2" href={`/progetti/${projectId}/timbri`} target="_blank" rel="noopener" display="block" mt={1}>
            Gestisci i timbri
          </Link>
        )}
        <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={didascalia} onChange={(e) => onDidascalia(e.target.checked)} />}
                          label={<Typography variant="body2">Sotto i nuovi timbri «Timbrato da … il …» (nome, data e ora li scrive il server)</Typography>} />
        <Typography variant="subtitle2" mt={1}>Timbri messi ({piazzamenti.length})</Typography>
        {piazzamenti.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{attivo ? `Clicca sulla pagina per mettere «${attivo.name}».` : "Nessuno."}</Typography>
        ) : (
          <List dense disablePadding>
            {piazzamenti.map((p) => (
              <ListItem key={p.chiave} disableGutters secondaryAction={
                <IconButton edge="end" size="small" aria-label={`Togli ${p.timbro.name} dalla pagina ${p.pagina}`} onClick={() => onTogli(p.chiave)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>}>
                <ListItemText primary={`Pagina ${p.pagina} · ${p.timbro.name}`} secondary={p.didascalia ? "con didascalia" : undefined} />
              </ListItem>
            ))}
          </List>
        )}
        <TextField size="small" fullWidth label="Nota per la revisione (facoltativa)" value={nota} sx={{ mt: 2 }}
                   onChange={(e) => setNota(e.target.value)} inputProps={{ maxLength: 500 }} />
        {errore && errore.code !== "pdf_firmato" && <Alert severity="error" sx={{ mt: 2 }}>{errore.message}</Alert>}
      </Box>
      <Stack direction="row" gap={1} p={2} borderTop={1} borderColor="divider" justifyContent="flex-end">
        <Button onClick={onAnnulla} disabled={salva.isPending}>Annulla</Button>
        <Button variant="contained" disabled={!piazzamenti.length || salva.isPending} onClick={() => salva.mutate(false)}>
          {salva.isPending ? "Salvataggio…" : "Salva come nuova revisione"}
        </Button>
      </Stack>
      <Dialog open={confermaFirma} onClose={() => setConfermaFirma(false)}>
        <DialogTitle>PDF firmato digitalmente</DialogTitle>
        <DialogContent>
          <DialogContentText>{errore?.code === "pdf_firmato" ? errore.message : ""}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfermaFirma(false)}>Annulla</Button>
          <Button color="warning" variant="contained" disabled={salva.isPending} onClick={() => salva.mutate(true)}>
            Timbra comunque
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function SceltaTimbro({ t, scelto, onClick }: { t: Timbro; scelto: boolean; onClick: () => void }) {
  const { data: url } = useImmagineTimbro(t.id);
  return (
    <ButtonBase onClick={onClick} role="option" aria-selected={scelto} aria-label={`${t.name} (${NOME_AMBITO[t.scope].toLowerCase()})`}
                sx={{ display: "block", textAlign: "left", borderRadius: 1, border: 2, p: 0.5,
                      borderColor: scelto ? "primary.main" : "divider", bgcolor: scelto ? "action.selected" : "transparent" }}>
      <Box height={64} sx={{ background: SCACCHI, borderRadius: 0.5, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {url && <Box component="img" src={url} alt="" sx={{ maxWidth: "100%", maxHeight: 60, objectFit: "contain" }} />}
      </Box>
      <Typography variant="body2" noWrap mt={0.5} title={t.name}>{t.name}</Typography>
      <Chip size="small" variant="outlined" label={NOME_AMBITO[t.scope]} sx={{ height: 18, fontSize: 10 }} />
    </ButtonBase>
  );
}
