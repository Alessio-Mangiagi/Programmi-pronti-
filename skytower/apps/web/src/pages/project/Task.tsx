// "><(((º> sabusabu <º)))><"
// Scheda "Task" della commessa (ADR-59): i task fra le persone, in una bacheca a tre colonne (Da fare, In corso,
// Fatto) o in elenco. Si vede "Tutti i miei" (dati e ricevuti), "Assegnati a me" o "Assegnati da me". Una scheda si
// sposta trascinandola in un'altra colonna oppure dal menu "Sposta in…" (anche da tastiera); un clic apre la scheda
// del task a destra (indirizzo /task/:taskId, si può mandare a un collega). Lo stato lo cambiano chi ha assegnato il
// task e le persone assegnate; gli altri membri della commessa i task degli altri non li vedono.
import { DragEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert, Avatar, AvatarGroup, Box, Button, Chip, IconButton, LinearProgress, Menu, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ViewKanbanIcon from "@mui/icons-material/ViewKanban";
import ViewListIcon from "@mui/icons-material/ViewList";
import { api, ApiError, Project, TeamTask, TeamTaskStatus } from "../../api";
import { STATUS, STATUS_ORDER, giorno, iniziali } from "../../components/task/common";
import { TaskDialog, useSpostaTask } from "../../components/task/TaskDialog";
import { PriorityChip } from "../../components/task/PriorityChip";
import { TaskDrawer } from "../../components/task/TaskDrawer";

type Vista = "tutti" | "assegnati_a_me" | "assegnati_da_me";
type Modo = "bacheca" | "elenco";
const MODO_KEY = "cde.task.modo";

function modoRicordato(): Modo {
  try { return localStorage.getItem(MODO_KEY) === "elenco" ? "elenco" : "bacheca"; } catch { return "bacheca"; }
}

export function TaskTab({ project }: { project: Project }) {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [vista, setVista] = useState<Vista>("tutti");
  const [modo, setModoState] = useState<Modo>(modoRicordato);
  const [creating, setCreating] = useState(false);
  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: ["team-tasks", project.id, vista],
    queryFn: () => api<TeamTask[]>(`/projects/${project.id}/team-tasks?vista=${vista}`),
    refetchInterval: 60_000,
  });
  const sposta = useSpostaTask(project.id);
  const apri = (t: TeamTask) => navigate(`/progetti/${project.id}/task/${t.id}`);
  const setModo = (m: Modo) => {
    setModoState(m);
    try { localStorage.setItem(MODO_KEY, m); } catch { /* storage non disponibile */ }
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
        <ToggleButtonGroup size="small" exclusive value={vista} onChange={(_, v) => v && setVista(v)} aria-label="Quali task">
          <ToggleButton value="tutti">Tutti i miei</ToggleButton>
          <ToggleButton value="assegnati_a_me">Assegnati a me</ToggleButton>
          <ToggleButton value="assegnati_da_me">Assegnati da me</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={modo} onChange={(_, v) => v && setModo(v)} aria-label="Vista">
          <ToggleButton value="bacheca" aria-label="Bacheca"><ViewKanbanIcon fontSize="small" sx={{ mr: 0.5 }} />Bacheca</ToggleButton>
          <ToggleButton value="elenco" aria-label="Elenco"><ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />Elenco</ToggleButton>
        </ToggleButtonGroup>
        <Box flexGrow={1} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Nuovo task</Button>
      </Stack>
      {(error || sposta.error) && <Alert severity="error">{((error ?? sposta.error) as ApiError).message}</Alert>}
      {isLoading && <LinearProgress />}
      {!isLoading && tasks.length === 0 && (
        <Paper variant="outlined">
          <Typography color="text.secondary" textAlign="center" py={5}>
            {vista === "assegnati_da_me" ? "Non hai assegnato task in questa commessa." : "Nessun task: crea il primo con «Nuovo task»."}
          </Typography>
        </Paper>
      )}
      {tasks.length > 0 && (modo === "bacheca"
        ? <Bacheca tasks={tasks} onOpen={apri} onMove={(id, status) => sposta.mutate({ id, status })} />
        : <Elenco tasks={tasks} onOpen={apri} />)}
      {creating && <TaskDialog projectId={project.id} onClose={() => setCreating(false)} />}
      {taskId && <TaskDrawer projectId={project.id} taskId={taskId} onClose={() => navigate(`/progetti/${project.id}/task`)} />}
    </Stack>
  );
}

function Bacheca({ tasks, onOpen, onMove }: {
  tasks: TeamTask[]; onOpen: (t: TeamTask) => void; onMove: (id: string, status: TeamTaskStatus) => void;
}) {
  const [sopra, setSopra] = useState<TeamTaskStatus | null>(null);
  const drop = (status: TeamTaskStatus) => (e: DragEvent) => {
    e.preventDefault();
    setSopra(null);
    const id = e.dataTransfer.getData("text/x-cde-task");
    const t = tasks.find((x) => x.id === id);
    if (t && t.status !== status) onMove(id, status);
  };
  return (
    <Box display="grid" gridTemplateColumns={{ xs: "1fr", md: "repeat(3, minmax(0, 1fr))" }} gap={2} alignItems="start">
      {STATUS_ORDER.map((s) => {
        const colonna = tasks.filter((t) => t.status === s);
        return (
          <Paper key={s} variant="outlined" component="section" aria-label={`Colonna ${STATUS[s].label}`}
                 onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setSopra(s); }}
                 onDragLeave={() => setSopra((x) => (x === s ? null : x))} onDrop={drop(s)}
                 sx={{ p: 1.5, bgcolor: sopra === s ? "action.hover" : "#f8fafc", minHeight: 160,
                       borderColor: sopra === s ? "primary.main" : undefined, borderStyle: sopra === s ? "dashed" : undefined }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={1.25} px={0.5}>
              <Typography fontWeight={700} flexGrow={1}>{STATUS[s].label}</Typography>
              <Chip size="small" label={colonna.length} />
            </Stack>
            <Stack spacing={1}>
              {colonna.map((t) => <Scheda key={t.id} task={t} onOpen={() => onOpen(t)} onMove={(st) => onMove(t.id, st)} />)}
              {colonna.length === 0 && (
                <Typography variant="body2" color="text.secondary" textAlign="center" py={2}>Trascina qui una scheda</Typography>
              )}
            </Stack>
          </Paper>
        );
      })}
    </Box>
  );
}

function Scheda({ task: t, onOpen, onMove }: { task: TeamTask; onOpen: () => void; onMove: (s: TeamTaskStatus) => void }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const percent = t.items_total ? Math.round((t.items_done / t.items_total) * 100) : 0;
  return (
    <Paper variant="outlined" draggable aria-label={`Task ${t.code} ${t.title}`}
           onDragStart={(e) => { e.dataTransfer.setData("text/x-cde-task", t.id); e.dataTransfer.effectAllowed = "move"; }}
           onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(); }} tabIndex={0}
           sx={{ p: 1.25, cursor: "grab", bgcolor: "background.paper", borderColor: t.overdue ? "error.light" : undefined,
                 "&:hover": { borderColor: "primary.main" }, "&:focus-visible": { outline: 2, outlineColor: "primary.main" } }}>
      <Stack direction="row" alignItems="center" spacing={0.75}>
        <Typography variant="caption" fontFamily="monospace" color="text.secondary" flexGrow={1}>{t.code}</Typography>
        {t.priority !== "NORMAL" && <PriorityChip priority={t.priority} />}
        <IconButton size="small" aria-label={`Sposta ${t.code}`} aria-haspopup="menu"
                    onClick={(e) => { e.stopPropagation(); setMenu(e.currentTarget); }}>
          <MoreVertIcon fontSize="small" />
        </IconButton>
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} onClick={(e) => e.stopPropagation()}>
          {STATUS_ORDER.filter((s) => s !== t.status).map((s) => (
            <MenuItem key={s} onClick={() => { setMenu(null); onMove(s); }}>Sposta in «{STATUS[s].label}»</MenuItem>
          ))}
        </Menu>
      </Stack>
      <Typography variant="body2" fontWeight={600} mt={0.25}
                  sx={t.status === "DONE" ? { textDecoration: "line-through", color: "text.secondary" } : undefined}>{t.title}</Typography>
      {t.items_total > 0 && (
        <Stack direction="row" alignItems="center" spacing={1} mt={1}>
          <LinearProgress variant="determinate" value={percent} sx={{ flexGrow: 1, height: 5, borderRadius: 3 }}
                          color={percent === 100 ? "success" : "primary"} aria-label={`Sotto-task ${t.items_done} di ${t.items_total}`} />
          <Typography variant="caption" color="text.secondary">{t.items_done}/{t.items_total}</Typography>
        </Stack>
      )}
      <Stack direction="row" alignItems="center" spacing={1} mt={1}>
        <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 24, height: 24, fontSize: 11, bgcolor: "primary.main", color: "#fff" } }}>
          {t.assignees.map((a) => (
            <Tooltip key={a.user_id} title={a.name}><Avatar alt={a.name}>{iniziali(a.name)}</Avatar></Tooltip>
          ))}
        </AvatarGroup>
        <Box flexGrow={1} />
        {t.comment_count > 0 && (
          <Stack direction="row" alignItems="center" spacing={0.25} color="text.secondary" aria-label={`${t.comment_count} commenti`}>
            <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} /><Typography variant="caption">{t.comment_count}</Typography>
          </Stack>
        )}
        {t.due_on && (
          <Typography variant="caption" fontWeight={t.overdue ? 700 : 500} color={t.overdue ? "error.main" : "text.secondary"}>
            {t.overdue ? "in ritardo · " : ""}{giorno(t.due_on)}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function Elenco({ tasks, onOpen }: { tasks: TeamTask[]; onOpen: (t: TeamTask) => void }) {
  return (
    <Paper variant="outlined" sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ "& th": { fontWeight: 600, color: "text.secondary" } }}>
            <TableCell>Codice</TableCell><TableCell>Titolo</TableCell><TableCell>Assegnato a</TableCell>
            <TableCell>Da</TableCell><TableCell>Priorità</TableCell><TableCell>Scadenza</TableCell>
            <TableCell>Sotto-task</TableCell><TableCell>Stato</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.map((t) => (
            <TableRow key={t.id} hover sx={{ cursor: "pointer" }} onClick={() => onOpen(t)}>
              <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{t.code}</TableCell>
              <TableCell>{t.title}</TableCell>
              <TableCell>{t.assignees.map((a) => a.name).join(", ")}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{t.created_by_name}</TableCell>
              <TableCell><PriorityChip priority={t.priority} /></TableCell>
              <TableCell sx={{ whiteSpace: "nowrap", color: t.overdue ? "error.main" : undefined, fontWeight: t.overdue ? 600 : undefined }}>
                {t.due_on ? giorno(t.due_on) : "—"}{t.overdue && " · in ritardo"}
              </TableCell>
              <TableCell>{t.items_total ? `${t.items_done}/${t.items_total}` : "—"}</TableCell>
              <TableCell><Chip size="small" color={STATUS[t.status].color} label={STATUS[t.status].label} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
