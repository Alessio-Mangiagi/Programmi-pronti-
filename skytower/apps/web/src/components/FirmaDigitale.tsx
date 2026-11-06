// "><(((º> sabusabu <º)))><"
// PDF firmati digitalmente in busta .p7m (ADR-55): il badge con l'esito della verifica della firma.
// - FirmaChip: piccolo, nell'elenco delle revisioni della scheda documento;
// - FirmaBadge: nella barra del visualizzatore; cliccandolo si aprono i dettagli (firmatari, codice fiscale, ente,
//   tipo di firma, marca temporale, motivi) e "Verifica di nuovo" (POST /revisions/{id}/firma/verifica).
// Colori: verde = valida, rosso = non valida, giallo = da verificare; grigio = verifica in corso o non fatta
// (busta non ancora aperta, motore della firma non installato sul server).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography,
} from "@mui/material";
import VerifiedIcon from "@mui/icons-material/Verified";
import { api, ApiError } from "../api";

export type EsitoFirma = "valida" | "non valida" | "da verificare";

export interface FirmaRapporto {
  esito: EsitoFirma | null;
  riepilogo: string;
  verificato_il?: string;
  nome_contenuto?: string;
  livelli?: number;
  errore?: string;
  elenchi?: { fonte: string | null; aggiornati_il: string | null; errore: string | null } | null;
  firme: {
    firmatario: string; codice_fiscale?: string | null; organizzazione?: string | null; ente_certificatore?: string | null;
    tipo?: string; esito: EsitoFirma | null; motivi: string[]; data_firma_dichiarata?: string | null;
    data_riferimento?: string | null; certificato_valido_al?: string;
    marca_temporale?: { data: string | null; valida: boolean; motivo: string | null; ente: string | null } | null;
  }[];
}

/** Il blocco "firma" del download (GET /revisions/{id}/download) di una busta .p7m. */
export interface FirmaInfo {
  stato: "PENDING" | "READY" | "FAILED";
  rapporto: FirmaRapporto | null;
  dettaglio: string | null;
  originale: string;
  contenuto: string;
}

const COLORE: Record<EsitoFirma, "success" | "error" | "warning"> = {
  valida: "success", "non valida": "error", "da verificare": "warning",
};
const ETICHETTA: Record<EsitoFirma, string> = {
  valida: "Firma valida", "non valida": "Firma NON valida", "da verificare": "Firma da verificare",
};

const data = (s?: string | null) => (s ? new Date(s).toLocaleDateString("it-IT") : "—");
const dataOra = (s?: string | null) => (s ? new Date(s).toLocaleString("it-IT") : "—");

/** Etichetta e colore per uno stato di busta + esito (anche senza rapporto: in corso / non verificata). */
function aspetto(stato: string | null | undefined, esito: EsitoFirma | null | undefined) {
  if (esito) return { label: ETICHETTA[esito], color: COLORE[esito] };
  if (!stato || stato === "PENDING") return { label: "Firma: verifica in corso", color: "default" as const };
  return { label: "Firma non verificata", color: "default" as const };
}

/** Chip compatto per l'elenco delle revisioni (dati di REVISION_SQL: firma_stato, firma). */
export function FirmaChip({ stato, rapporto, dettaglio }: { stato: string | null; rapporto: FirmaRapporto | null; dettaglio?: string | null }) {
  if (!stato) return null;
  const a = aspetto(stato, rapporto?.esito);
  return (
    <Chip size="small" icon={<VerifiedIcon />} color={a.color} variant={a.color === "default" ? "outlined" : "filled"}
          label={a.label} title={rapporto?.riepilogo ?? dettaglio ?? "Documento firmato digitalmente (.p7m)"} />
  );
}

/** Badge del visualizzatore con i dettagli della verifica e "Verifica di nuovo". */
export function FirmaBadge({ firma, revisionId }: { firma: FirmaInfo; revisionId: string }) {
  const [aperto, setAperto] = useState(false);
  const qc = useQueryClient();
  const a = aspetto(firma.stato, firma.rapporto?.esito);
  const verifica = useMutation({
    mutationFn: () => api<{ rapporto: FirmaRapporto }>(`/revisions/${revisionId}/firma/verifica`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["view-link", revisionId] });
      qc.invalidateQueries({ queryKey: ["document"] });
    },
  });
  const r = firma.rapporto;
  return (
    <>
      <Chip icon={<VerifiedIcon />} color={a.color} variant={a.color === "default" ? "outlined" : "filled"} label={a.label}
            onClick={() => setAperto(true)} aria-label={`${a.label}: dettagli della firma digitale`} />
      <Dialog open={aperto} onClose={() => setAperto(false)} maxWidth="sm" fullWidth aria-labelledby="firma-digitale-titolo">
        <DialogTitle id="firma-digitale-titolo">Firma digitale</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              File firmato: <b>{firma.originale}</b>. Si legge il documento contenuto (<b>{firma.contenuto}</b>);
              «Scarica» dà il file firmato originale.
            </Typography>
            {firma.stato === "PENDING" && <Alert severity="info">Apertura della busta e verifica della firma in corso.</Alert>}
            {firma.stato === "FAILED" && !r?.esito && (
              <Alert severity="warning">Verifica non eseguita: {firma.dettaglio ?? "motivo sconosciuto"}</Alert>
            )}
            {r && (
              <Alert severity={r.esito ? COLORE[r.esito] : "info"} icon={<VerifiedIcon />}>
                {r.riepilogo}
                {r.verificato_il && <Box component="span" display="block" mt={0.5} fontSize="0.85em">Verificata il {dataOra(r.verificato_il)}</Box>}
              </Alert>
            )}
            {r?.firme.map((f, i) => (
              <Box key={i}>
                {i > 0 && <Divider sx={{ mb: 2 }} />}
                <Typography fontWeight={600}>{f.firmatario}</Typography>
                <Typography variant="body2">
                  {f.tipo ?? "firma"}{f.codice_fiscale ? ` · CF ${f.codice_fiscale}` : ""}{f.organizzazione ? ` · ${f.organizzazione}` : ""}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Ente certificatore: {f.ente_certificatore ?? "—"} · certificato valido fino al {data(f.certificato_valido_al)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {f.marca_temporale?.valida
                    ? `Marca temporale del ${dataOra(f.marca_temporale.data)} (${f.marca_temporale.ente ?? "ente di marcatura"})`
                    : `Data dichiarata di firma: ${dataOra(f.data_firma_dichiarata)} (senza marca temporale)`}
                </Typography>
                {f.motivi.length > 0 && (
                  <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                    {f.motivi.map((m) => <Typography component="li" variant="body2" key={m}>{m}</Typography>)}
                  </Box>
                )}
              </Box>
            ))}
            {verifica.error && <Alert severity="error">{(verifica.error as ApiError).message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={verifica.isPending || firma.stato === "PENDING"} onClick={() => verifica.mutate()}>
            {verifica.isPending ? "Verifica in corso…" : "Verifica di nuovo"}
          </Button>
          <Button onClick={() => setAperto(false)}>Chiudi</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
