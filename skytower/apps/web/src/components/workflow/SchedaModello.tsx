// "><(((º> sabusabu <º)))><"
// Scheda di un modello di workflow negli elenchi (scheda Workflow della commessa e Libreria workflow
// dell'organizzazione): nome, codice e versione, oggetto (documenti/processi), bollino "Libreria" per i modelli
// della libreria dell'organizzazione (ADR-50), riassunto dei nodi; i pulsanti arrivano da chi la usa (children).
import { ReactNode } from "react";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import { Definizione, Modello, NOME_TIPO, comeGrafo, diLibreria } from "./modello";

export function SchedaModello({ t, onApri, children, sottotitolo }: {
  t: Modello; onApri: () => void; children?: ReactNode;
  /** Riga in più sotto il titolo (es. da quale modello è stato copiato). */
  sottotitolo?: ReactNode;
}) {
  const g = comeGrafo(t.definition);
  const decisioni = g.nodes.filter((n) => n.type === "decision" || n.type === "activity");
  const paralleli = maxRamiParalleli(g);
  return (
    <Paper variant="outlined" sx={{ p: 2, opacity: t.is_active ? 1 : 0.6, borderColor: diLibreria(t) ? "primary.light" : undefined }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography fontWeight={600}>{t.name}</Typography>
        <Chip size="small" variant="outlined" label={`${t.code} · v${t.version}`} sx={{ fontFamily: "monospace" }} />
        <Chip size="small" label={t.subject === "PROCESS" ? "Processi" : "Documenti"} color={t.subject === "PROCESS" ? "secondary" : "default"} variant="outlined" />
        {diLibreria(t) && <Chip size="small" color="primary" icon={<LibraryBooksIcon />} label="Libreria" />}
        {!t.is_active && <Chip size="small" label="Disattivato" />}
        {g.on_completed && (
          <Chip size="small" color="success" variant="outlined"
                label={`Se concluso → ${g.on_completed.to_state === "SHARED" ? "Condiviso" : "Pubblicato"} ${g.on_completed.suitability}`} />
        )}
        <Box flexGrow={1} />
        {/* pulsanti in un gruppo unico: se non c'è posto vanno a capo insieme, non uno alla volta */}
        <Stack direction="row" alignItems="center" spacing={0.5} flexShrink={0}>
          <Button size="small" startIcon={<AccountTreeIcon />} onClick={onApri}>Apri</Button>
          {children}
        </Stack>
      </Stack>
      {sottotitolo && <Typography variant="body2" color="text.secondary" mt={0.5}>{sottotitolo}</Typography>}
      <Typography variant="body2" color="text.secondary" mt={1}>
        {g.nodes.length} nodi · {decisioni.length} {decisioni.length === 1 ? "compito" : "compiti"}
        {paralleli > 1 ? ` · fino a ${paralleli} rami in parallelo` : ""}
        {" · "}{decisioni.slice(0, 4).map((n) => n.name).join(" → ")}{decisioni.length > 4 ? " → …" : ""}
      </Typography>
      <Stack direction="row" gap={0.5} mt={1} flexWrap="wrap">
        {(["start", "decision", "activity", "notification", "end"] as const).map((tipo) => {
          const k = g.nodes.filter((n) => n.type === tipo).length;
          return k ? <Chip key={tipo} size="small" variant="outlined" label={`${NOME_TIPO[tipo]} ${k}`} /> : null;
        })}
      </Stack>
    </Paper>
  );
}

/** Il gruppo di rami paralleli più grande: quanti archi escono dallo stesso nodo con lo stesso esito. */
export function maxRamiParalleli(g: Definizione): number {
  const conta = new Map<string, number>();
  for (const e of g.edges) conta.set(`${e.from}|${e.outcome ?? ""}`, (conta.get(`${e.from}|${e.outcome ?? ""}`) ?? 0) + 1);
  return Math.max(1, ...conta.values());
}
