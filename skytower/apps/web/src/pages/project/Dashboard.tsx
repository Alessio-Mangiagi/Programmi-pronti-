// "><(((º> sabusabu <º)))><"
// Cruscotto KPI della commessa (solo Project Admin): stato dei documenti per azienda, attese e scadenze,
// tempi per step, colli di bottiglia, caricamenti settimanali, RFI. Filtri per azienda e disciplina,
// drill-down ai documenti. Grafici in HTML semplice: barre sottili, tooltip al passaggio, tabella sempre visibile.
import { useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert, Box, Link, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip,
  Typography,
} from "@mui/material";
import ErrorIcon from "@mui/icons-material/Error";
import { api, ApiError, type Project } from "../../api";

interface OrgRow { organization_id: string; organization_code: string; legal_name: string; total: number; wip: number; shared: number; published: number; archived: number }
interface Kpi {
  generated_at: string;
  documents: { total: number; by_state: Record<string, number>; by_organization: OrgRow[]; by_discipline: { discipline: string; total: number }[] };
  awaiting: { workflows_running: number; tasks_open: number; tasks_overdue: number; shared_without_workflow: number };
  step_times: { step_name: string; completed: number; avg_hours: number; median_hours: number; max_hours: number }[];
  bottlenecks: { step_name: string; organization_code: string; open: number; overdue: number; avg_age_hours: number }[];
  uploads: { week: string; organization_code: string; n: number }[];
  overdue_tasks: { task_id: string; due_at: string; step_name: string; document_id: string; identifier: string; title: string; assignee_name: string; organization_code: string }[];
  rfis: { open: number; answered: number; closed: number; overdue: number; avg_answer_hours: number | null };
  overdue_rfis: { id: string; code: string; subject: string; due_at: string; author_org_code: string }[];
  filters: { organizations: { id: string; code: string; name: string }[]; disciplines: string[] };
}

// Stati CDE come serie categoriali, in ordine fisso (palette di riferimento, slot 1–4)
const STATES = [
  { key: "wip", state: "WIP", label: "WIP", color: "#2a78d6" },
  { key: "shared", state: "SHARED", label: "Condiviso", color: "#eb6834" },
  { key: "published", state: "PUBLISHED", label: "Pubblicato", color: "#1baf7a" },
  { key: "archived", state: "ARCHIVED", label: "Archiviato", color: "#eda100" },
] as const;
const SERIES = "#2a78d6";
const CRITICAL = "#d32f2f";

const hours = (h: number | null | undefined) =>
  h === null || h === undefined ? "—" : h >= 48 ? `${(h / 24).toLocaleString("it-IT", { maximumFractionDigits: 1 })} g` : `${h.toLocaleString("it-IT")} h`;
const day = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });

export function DashboardTab({ project }: { project: Project }) {
  const [org, setOrg] = useState("");
  const [discipline, setDiscipline] = useState("");
  const qs = new URLSearchParams({ ...(org && { organization_id: org }), ...(discipline && { discipline }) }).toString();
  const { data, error } = useQuery({
    queryKey: ["dashboard", project.id, qs],
    queryFn: () => api<Kpi>(`/projects/${project.id}/dashboard${qs ? `?${qs}` : ""}`),
    refetchInterval: 60_000,
  });
  const docsLink = (id: string) => `/progetti/${project.id}/documenti?doc=${id}`;

  if (error) return <Alert severity="warning">{(error as ApiError).message}</Alert>;
  if (!data) return <Typography color="text.secondary">Caricamento…</Typography>;
  const d = data;

  return (
    <Stack spacing={2}>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <TextField select size="small" label="Azienda" value={org} onChange={(e) => setOrg(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">Tutte</MenuItem>
          {d.filters.organizations.map((o) => <MenuItem key={o.id} value={o.id}>{o.code} · {o.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Disciplina" value={discipline} onChange={(e) => setDiscipline(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">Tutte</MenuItem>
          {[...d.filters.disciplines].sort().map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
        </TextField>
        <Box flexGrow={1} />
        <Typography variant="caption" color="text.secondary">Aggiornato alle {new Date(d.generated_at).toLocaleTimeString("it-IT")}</Typography>
      </Stack>

      <Box display="grid" gap={1.5} gridTemplateColumns="repeat(auto-fill, minmax(165px, 1fr))">
        <Stat label="Documenti" value={d.documents.total} sub={`${d.documents.by_state.PUBLISHED ?? 0} pubblicati`} />
        <Stat label="In approvazione" value={d.awaiting.workflows_running} sub={`${d.awaiting.tasks_open} compiti aperti`} />
        <Stat label="Compiti scaduti" value={d.awaiting.tasks_overdue} critical={d.awaiting.tasks_overdue > 0} sub="da sollecitare" />
        <Stat label="Condivisi senza workflow" value={d.awaiting.shared_without_workflow} sub="in attesa di avvio" />
        <Stat label="RFI aperte" value={d.rfis.open} critical={d.rfis.overdue > 0}
              sub={d.rfis.overdue ? `${d.rfis.overdue} scadute` : `risposta media ${hours(d.rfis.avg_answer_hours)}`} />
      </Box>

      <Box display="grid" gap={2} gridTemplateColumns={{ xs: "1fr", lg: "3fr 2fr" }}>
        <Card title="Documenti per azienda e stato" note="Stato dell'ultima revisione di ogni documento.">
          <Legend />
          <Stack spacing={1.25} mt={1.5}>
            {d.documents.by_organization.map((o) => <StackedBar key={o.organization_id} row={o}
                                                                max={Math.max(...d.documents.by_organization.map((x) => x.total))} />)}
            {d.documents.by_organization.length === 0 && <Empty />}
          </Stack>
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead><TableRow><TableCell>Azienda</TableCell>{STATES.map((s) => <TableCell key={s.key} align="right">{s.label}</TableCell>)}<TableCell align="right">Totale</TableCell></TableRow></TableHead>
            <TableBody>
              {d.documents.by_organization.map((o) => (
                <TableRow key={o.organization_id}>
                  <TableCell>{o.organization_code}</TableCell>
                  {STATES.map((s) => <TableCell key={s.key} align="right">{o[s.key]}</TableCell>)}
                  <TableCell align="right"><b>{o.total}</b></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card title="Caricamenti per settimana" note="Nuove revisioni WIP, ultime 12 settimane.">
          <Weekly uploads={d.uploads} />
        </Card>
      </Box>

      <Box display="grid" gap={2} gridTemplateColumns={{ xs: "1fr", lg: "1fr 1fr" }}>
        <Card title="Tempo medio per step" note="Step completati negli ultimi 180 giorni.">
          {d.step_times.length === 0 ? <Empty /> : (
            <Stack spacing={1}>
              {d.step_times.map((s) => (
                <HBar key={s.step_name} label={s.step_name} value={s.avg_hours} max={Math.max(...d.step_times.map((x) => x.avg_hours))}
                      text={hours(s.avg_hours)}
                      tip={`${s.step_name}: media ${hours(s.avg_hours)}, mediana ${hours(s.median_hours)}, massimo ${hours(s.max_hours)} su ${s.completed} step`} />
              ))}
            </Stack>
          )}
        </Card>
        <Card title="Colli di bottiglia" note="Compiti aperti per step e azienda incaricata.">
          {d.bottlenecks.length === 0 ? <Empty text="Nessun compito aperto." /> : (
            <Table size="small">
              <TableHead><TableRow><TableCell>Step</TableCell><TableCell>Azienda</TableCell><TableCell align="right">Aperti</TableCell><TableCell align="right">Scaduti</TableCell><TableCell align="right">Età media</TableCell></TableRow></TableHead>
              <TableBody>
                {d.bottlenecks.map((b) => (
                  <TableRow key={`${b.step_name}-${b.organization_code}`}>
                    <TableCell>{b.step_name}</TableCell><TableCell>{b.organization_code}</TableCell>
                    <TableCell align="right">{b.open}</TableCell>
                    <TableCell align="right">{b.overdue ? <Critical>{b.overdue}</Critical> : 0}</TableCell>
                    <TableCell align="right">{hours(b.avg_age_hours)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </Box>

      <Box display="grid" gap={2} gridTemplateColumns={{ xs: "1fr", lg: "2fr 1fr" }}>
        <Card title="Scadenze superate" note="Compiti di revisione oltre la scadenza: apri il documento per i dettagli.">
          {d.overdue_tasks.length === 0 ? <Empty text="Nessuna scadenza superata." /> : (
            <Table size="small">
              <TableHead><TableRow><TableCell>Scaduto il</TableCell><TableCell>Documento</TableCell><TableCell>Step</TableCell><TableCell>Incaricato</TableCell></TableRow></TableHead>
              <TableBody>
                {d.overdue_tasks.map((t) => (
                  <TableRow key={t.task_id}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}><Critical>{day(t.due_at)}</Critical></TableCell>
                    <TableCell>
                      <Link component={RouterLink} to={docsLink(t.document_id)} fontFamily="monospace" fontSize={13}>{t.identifier}</Link>
                      <Typography variant="caption" display="block" color="text.secondary">{t.title}</Typography>
                    </TableCell>
                    <TableCell>{t.step_name}</TableCell>
                    <TableCell>{t.assignee_name} ({t.organization_code})</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {d.overdue_rfis.length > 0 && (
            <>
              <Typography variant="subtitle2" mt={2} mb={0.5}>RFI scadute</Typography>
              {d.overdue_rfis.map((f) => (
                <Typography key={f.id} variant="body2">
                  <Critical>{day(f.due_at)}</Critical>{" "}
                  <Link component={RouterLink} to={`/progetti/${project.id}/rfi/${f.id}`}>{f.code}</Link> {f.subject} ({f.author_org_code})
                </Typography>
              ))}
            </>
          )}
        </Card>
        <Card title="Documenti per disciplina" note="Codice disciplina del nome ISO 19650.">
          {d.documents.by_discipline.length === 0 ? <Empty /> : (
            <Stack spacing={1}>
              {d.documents.by_discipline.map((x) => (
                <HBar key={x.discipline} label={x.discipline} value={x.total} text={String(x.total)}
                      max={Math.max(...d.documents.by_discipline.map((y) => y.total))} tip={`Disciplina ${x.discipline}: ${x.total} documenti`} />
              ))}
            </Stack>
          )}
        </Card>
      </Box>
    </Stack>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Typography fontWeight={600}>{title}</Typography>
      {note && <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>{note}</Typography>}
      {children}
    </Paper>
  );
}

function Stat({ label, value, sub, critical }: { label: string; value: number; sub?: string; critical?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Stack direction="row" alignItems="center" gap={0.75}>
        <Typography fontSize={30} fontWeight={600} lineHeight={1.3}>{value.toLocaleString("it-IT")}</Typography>
        {critical && <ErrorIcon sx={{ color: CRITICAL }} aria-label="attenzione" />}
      </Stack>
      {sub && <Typography variant="caption" color={critical ? CRITICAL : "text.secondary"}>{sub}</Typography>}
    </Paper>
  );
}

function Critical({ children }: { children: ReactNode }) {
  return <Box component="span" sx={{ color: CRITICAL, fontWeight: 600 }}>{children}</Box>;
}

function Empty({ text = "Nessun dato per questi filtri." }: { text?: string }) {
  return <Typography variant="body2" color="text.secondary" py={2}>{text}</Typography>;
}

function Legend() {
  return (
    <Stack direction="row" gap={2} flexWrap="wrap">
      {STATES.map((s) => (
        <Stack key={s.key} direction="row" alignItems="center" gap={0.75}>
          <Box width={10} height={10} borderRadius="2px" bgcolor={s.color} />
          <Typography variant="caption" color="text.secondary">{s.label}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function StackedBar({ row, max }: { row: OrgRow; max: number }) {
  return (
    <Box display="grid" gridTemplateColumns="64px 1fr 40px" alignItems="center" gap={1}>
      <Typography variant="body2" fontWeight={500} noWrap>{row.organization_code}</Typography>
      <Box display="flex" gap="2px" height={14} width={`${(row.total / max) * 100}%`} minWidth={4}>
        {STATES.filter((s) => row[s.key] > 0).map((s, i, arr) => (
          <Tooltip key={s.key} title={`${row.organization_code} · ${s.label}: ${row[s.key]}`}>
            <Box flex={row[s.key]} bgcolor={s.color}
                 sx={{ borderRadius: `${i === 0 ? 4 : 0}px ${i === arr.length - 1 ? 4 : 0}px ${i === arr.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
                       "&:hover": { filter: "brightness(0.9)" } }} />
          </Tooltip>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary" textAlign="right">{row.total}</Typography>
    </Box>
  );
}

function HBar({ label, value, max, text, tip }: { label: string; value: number; max: number; text: string; tip: string }) {
  return (
    <Tooltip title={tip} placement="top-start">
      <Box display="grid" gridTemplateColumns="minmax(90px, 40%) 1fr 56px" alignItems="center" gap={1} sx={{ cursor: "default" }}>
        <Typography variant="body2" noWrap title={label}>{label}</Typography>
        <Box height={10} width={`${max ? (value / max) * 100 : 0}%`} minWidth={4} bgcolor={SERIES} borderRadius="0 4px 4px 0" />
        <Typography variant="body2" color="text.secondary" textAlign="right">{text}</Typography>
      </Box>
    </Tooltip>
  );
}

function Weekly({ uploads }: { uploads: Kpi["uploads"] }) {
  // 12 settimane piene, anche quelle senza caricamenti
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() - (11 - i) * 7);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const rows = uploads.filter((u) => u.week === key);
    return { key, label: day(d.toISOString()), short: `${d.getDate()}/${d.getMonth() + 1}`, total: rows.reduce((s, r) => s + r.n, 0), rows };
  });
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const total = weeks.reduce((s, w) => s + w.total, 0);
  return (
    <>
      <Typography variant="body2" color="text.secondary" mb={1}>{total} caricamenti</Typography>
      <Box display="flex" alignItems="flex-end" gap="2px" height={150} borderBottom={1} borderColor="divider">
        {weeks.map((w) => (
          <Tooltip key={w.key} title={<>Settimana del {w.label}: {w.total}{w.rows.map((r) => <div key={r.organization_code}>{r.organization_code}: {r.n}</div>)}</>}>
            <Box flex={1} height="100%" display="flex" alignItems="flex-end" sx={{ cursor: "default" }}>
              <Box width="100%" height={`${(w.total / max) * 100}%`} minHeight={w.total ? 3 : 0} bgcolor={SERIES} borderRadius="4px 4px 0 0" />
            </Box>
          </Tooltip>
        ))}
      </Box>
      <Box display="flex" gap="2px" mt={0.5}>
        {weeks.map((w, i) => (
          <Typography key={w.key} flex={1} minWidth={0} variant="caption" color="text.secondary" textAlign="center"
                      whiteSpace="nowrap" overflow="visible">
            {i % 3 === 0 ? w.short : ""}
          </Typography>
        ))}
      </Box>
    </>
  );
}
