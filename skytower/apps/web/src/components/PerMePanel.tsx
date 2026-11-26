// "><(((º> sabusabu <º)))><"
// Colonna destra "Per me": compiti di revisione, task assegnati, trasmissioni da confermare, RFI, discussioni con messaggi
// nuovi e notifiche dell'utente su tutte le commesse. "Messaggi" raccoglie RFI e discussioni (ADR-59).
// Si chiude in una barra di icone con i contatori; lo stato aperto/chiuso resta nel browser.
import { ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge, Box, ButtonBase, IconButton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ForumIcon from "@mui/icons-material/Forum";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { api, AppNotification, Discussion, MyTask, Rfi, TeamTask } from "../api";
import { STATUS, giorno } from "./task/common";
import type { TransmittalRow } from "../pages/project/Transmittals";

type Filter = "ALL" | "TASKS" | "RFI" | "NOTIFICATIONS";
const STORAGE_KEY = "cde.perMe.open";
const DAY = 24 * 3600 * 1000;

function remembered(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== "0"; } catch { return true; }
}

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.round((d.getTime() - Date.now()) / DAY);
  if (Math.abs(days) < 1) return `oggi ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export function usePerMe() {
  const tasks = useQuery({ queryKey: ["my-tasks", "OPEN"], queryFn: () => api<MyTask[]>("/me/tasks?status=OPEN") });
  const transmittals = useQuery({
    queryKey: ["my-transmittals"], queryFn: () => api<TransmittalRow[]>("/me/transmittals"), refetchInterval: 120_000,
  });
  const rfis = useQuery({ queryKey: ["my-rfis"], queryFn: () => api<Rfi[]>("/me/rfis"), refetchInterval: 120_000 });
  // task fra le persone assegnati a me, discussioni con messaggi non letti (ADR-59)
  const teamTasks = useQuery({ queryKey: ["my-team-tasks"], queryFn: () => api<TeamTask[]>("/me/team-tasks"), refetchInterval: 120_000 });
  const discussions = useQuery({ queryKey: ["my-discussions"], queryFn: () => api<Discussion[]>("/me/discussions"), refetchInterval: 60_000 });
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: AppNotification[]; unread: number }>("/notifications?limit=30"),
    refetchInterval: 60_000,
  });
  return { tasks: tasks.data ?? [], transmittals: transmittals.data ?? [], rfis: rfis.data ?? [], notifications: notifications.data,
           teamTasks: teamTasks.data ?? [], discussions: discussions.data ?? [] };
}

export function PerMePanel({ variant = "docked", onNavigate }: { variant?: "docked" | "drawer"; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpenState] = useState(variant === "drawer" || remembered());
  const [filter, setFilter] = useState<Filter>("ALL");
  const { tasks, transmittals, rfis, notifications, teamTasks, discussions } = usePerMe();

  const setOpen = (v: boolean) => {
    setOpenState(v);
    try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* storage non disponibile */ }
  };
  const go = (link: string | null) => { if (link) { navigate(link); onNavigate?.(); } };

  const toAnswer = rfis.filter((r) => r.i_am_recipient && r.status === "OPEN");
  const waiting = rfis.filter((r) => !r.i_am_recipient);
  const urgent = tasks.filter((t) => t.overdue || (t.due_at && new Date(t.due_at).getTime() - Date.now() < DAY));
  const normal = tasks.filter((t) => !urgent.includes(t));
  const unread = notifications?.unread ?? 0;
  const lateTeam = teamTasks.filter((t) => t.overdue || t.priority === "URGENT");
  const compiti = tasks.length + transmittals.length + teamTasks.length;
  const messaggi = rfis.length + discussions.length;

  if (!open) {
    return (
      <Stack alignItems="center" spacing={1} py={1.5} width={56} height="100%" borderLeft={1} borderColor="divider"
             bgcolor="background.paper" component="aside" aria-label="Per me (chiuso)">
        <Tooltip title="Apri Per me" placement="left">
          <IconButton onClick={() => setOpen(true)} aria-label="Apri pannello Per me" sx={{ bgcolor: "action.hover" }}>
            <ChevronLeftIcon />
          </IconButton>
        </Tooltip>
        <RailButton label="Compiti, task e trasmissioni" count={compiti} alert={urgent.length + lateTeam.length > 0}
                    onClick={() => { setFilter("TASKS"); setOpen(true); }} icon={<AssignmentTurnedInIcon />} />
        <RailButton label="RFI e discussioni" count={messaggi}
                    onClick={() => { setFilter("RFI"); setOpen(true); }} icon={<ForumIcon />} />
        <RailButton label="Notifiche" count={unread}
                    onClick={() => { setFilter("NOTIFICATIONS"); setOpen(true); }} icon={<NotificationsIcon />} />
      </Stack>
    );
  }

  const show = (f: Filter) => filter === "ALL" || filter === f;
  const empty = compiti + messaggi + (notifications?.items.length ?? 0) === 0;

  return (
    <Stack width={variant === "drawer" ? "100%" : 320} height="100%" borderLeft={variant === "docked" ? 1 : 0}
           borderColor="divider" bgcolor="background.paper" component="aside" aria-label="Per me">
      <Stack direction="row" alignItems="center" px={1.75} py={1.25} borderBottom={1} borderColor="divider">
        <Typography fontWeight={700} flexGrow={1}>Per me</Typography>
        {variant === "docked" && (
          <Tooltip title="Chiudi pannello">
            <IconButton size="small" onClick={() => setOpen(false)} aria-label="Chiudi pannello Per me" sx={{ bgcolor: "action.hover" }}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <Box px={1.75} py={1.25}>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)} fullWidth
                           aria-label="Tipo di azione">
          <ToggleButton value="ALL">Tutto</ToggleButton>
          <ToggleButton value="TASKS">Compiti {compiti || ""}</ToggleButton>
          <ToggleButton value="RFI">Messaggi {messaggi || ""}</ToggleButton>
          <ToggleButton value="NOTIFICATIONS" aria-label="Notifiche"><NotificationsIcon fontSize="small" /></ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Stack flexGrow={1} overflow="auto" px={1.75} pb={2} spacing={1}>
        {empty && <Typography variant="body2" color="text.secondary">Niente da fare. Ottimo lavoro.</Typography>}
        {show("TASKS") && urgent.length > 0 && <Section title="In scadenza" color="error.main" />}
        {show("TASKS") && urgent.map((t) => (
          <Item key={t.id} tone="urgent" kicker={`${tipoCompito(t)} · ${t.overdue ? "scaduto" : "scade"} ${when(t.due_at)}`}
                title={titoloCompito(t)} detail={`${t.project_code} · ${t.step_name}`}
                onClick={() => go(`/compiti?instance=${t.instance_id}&task=${t.id}`)} />
        ))}
        {show("TASKS") && normal.length > 0 && <Section title="Compiti" />}
        {show("TASKS") && normal.map((t) => (
          <Item key={t.id} kicker={`${tipoCompito(t)}${t.due_at ? ` · entro ${when(t.due_at)}` : ""}`}
                title={titoloCompito(t)} detail={`${t.project_code} · ${t.step_name} · ${t.template_name}`}
                onClick={() => go(`/compiti?instance=${t.instance_id}&task=${t.id}`)} />
        ))}
        {show("TASKS") && teamTasks.length > 0 && <Section title="Task assegnati a me" />}
        {show("TASKS") && teamTasks.map((t) => (
          <Item key={t.id} tone={t.overdue ? "urgent" : undefined}
                kicker={`${t.code} · ${STATUS[t.status].label}${t.due_on ? ` · ${t.overdue ? "scaduto il" : "entro il"} ${giorno(t.due_on)}` : ""}`}
                title={t.title}
                detail={`${t.project_code}${t.i_am_creator ? "" : ` · da ${t.created_by_name ?? ""}`}${t.items_total ? ` · sotto-task ${t.items_done}/${t.items_total}` : ""}`}
                onClick={() => go(`/progetti/${t.project_id}/task/${t.id}`)} />
        ))}
        {show("TASKS") && transmittals.length > 0 && <Section title="Trasmissioni da confermare" />}
        {show("TASKS") && transmittals.map((t) => (
          <Item key={t.id} kicker={`${t.code} · ${t.item_count} documenti`} title={t.subject}
                detail={`${t.project_code} · da ${t.sender_org_code} ${t.sender_name}`}
                onClick={() => go(`/progetti/${t.project_id}/transmittal/${t.id}`)} />
        ))}
        {show("RFI") && toAnswer.length > 0 && <Section title="RFI da rispondere" />}
        {show("RFI") && toAnswer.map((r) => (
          <Item key={r.id} tone={r.overdue ? "urgent" : undefined}
                kicker={`${r.code}${r.due_at ? ` · ${r.overdue ? "scaduta" : "entro"} ${when(r.due_at)}` : ""}`}
                title={r.subject} detail={`${r.project_code} · da ${r.author_org_code ?? ""} ${r.author_name ?? ""}`}
                onClick={() => go(`/progetti/${r.project_id}/rfi/${r.id}`)} />
        ))}
        {show("RFI") && waiting.length > 0 && <Section title="RFI che ho aperto" />}
        {show("RFI") && waiting.map((r) => (
          <Item key={r.id} kicker={`${r.code} · ${r.status === "ANSWERED" ? "risposta ricevuta" : "in attesa di risposta"}`}
                title={r.subject} detail={`${r.project_code} · ${r.message_count} messaggi`}
                onClick={() => go(`/progetti/${r.project_id}/rfi/${r.id}`)} />
        ))}
        {show("RFI") && discussions.length > 0 && <Section title="Discussioni con messaggi nuovi" />}
        {show("RFI") && discussions.map((d) => (
          <Item key={d.id} kicker={`${d.unread === 1 ? "1 messaggio nuovo" : `${d.unread} messaggi nuovi`}`} title={d.title}
                detail={`${d.project_code} · ${d.last_author ?? ""}: ${d.last_body ?? ""}`}
                onClick={() => go(`/progetti/${d.project_id}/discussioni/${d.id}`)} />
        ))}
        {show("NOTIFICATIONS") && (notifications?.items.length ?? 0) > 0 && <Section title="Notifiche" />}
        {show("NOTIFICATIONS") && notifications?.items.slice(0, filter === "ALL" ? 5 : 30).map((n) => (
          <ButtonBase key={n.id} sx={{ display: "block", textAlign: "left", borderRadius: 1, px: 0.5, py: 0.75 }}
                      onClick={async () => {
                        if (!n.read_at) await api("/notifications/read", { method: "POST", json: { ids: [n.id] } }).catch(() => undefined);
                        qc.invalidateQueries({ queryKey: ["notifications"] });
                        go(n.link);
                      }}>
            <Typography variant="body2" fontWeight={n.read_at ? 400 : 600}>{n.title}</Typography>
            <Typography variant="caption" color="text.secondary">{when(n.created_at)} · {n.body}</Typography>
          </ButtonBase>
        ))}
      </Stack>
    </Stack>
  );
}

function RailButton({ label, count, alert, icon, onClick }: { label: string; count: number; alert?: boolean; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip title={label} placement="left">
      <IconButton onClick={onClick} aria-label={`${label}: ${count}`}>
        <Badge badgeContent={count} color={alert ? "error" : "primary"} max={99}>{icon}</Badge>
      </IconButton>
    </Tooltip>
  );
}

function Section({ title, color = "text.secondary" }: { title: string; color?: string }) {
  return <Typography variant="overline" color={color} pt={0.5} lineHeight={1.6}>{title}</Typography>;
}

function Item({ kicker, title, detail, tone, onClick }: { kicker: string; title: string; detail: string; tone?: "urgent"; onClick: () => void }) {
  return (
    <ButtonBase onClick={onClick} sx={{
      display: "block", textAlign: "left", width: "100%", borderRadius: 2, px: 1.5, py: 1.25, border: 1,
      borderColor: tone === "urgent" ? "error.light" : "divider", bgcolor: tone === "urgent" ? "#fff6f5" : "background.paper",
      "&:hover": { borderColor: "primary.main" },
    }}>
      <Typography variant="caption" fontWeight={600} color={tone === "urgent" ? "error.main" : "text.secondary"}>{kicker}</Typography>
      <Typography variant="body2" fontWeight={600}>{title}</Typography>
      <Typography variant="caption" color="text.secondary">{detail}</Typography>
    </ButtonBase>
  );
}

/** Compiti dei workflow a grafo: un processo (RdA, gara…) non ha documento né revisione da mostrare. Tornare indietro
 *  (0042): un chiarimento da dare, un compito fermo in attesa di chiarimento, modifiche ricevute. */
function tipoCompito(t: Pick<MyTask, "revision_code" | "kind" | "waiting_for" | "changes_request">) {
  if (t.kind === "CLARIFICATION") return "Chiarimento da dare";
  const base = t.revision_code ? "Revisione" : "Processo";
  if (t.waiting_for) return `${base} · in attesa di chiarimento`;
  if (t.changes_request) return `${base} · modifiche richieste`;
  return base;
}
function titoloCompito(t: { title: string; revision_code?: string | null }) {
  return t.revision_code ? `${t.title} ${t.revision_code}` : t.title;
}
