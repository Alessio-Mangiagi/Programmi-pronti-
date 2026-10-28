// "><(((º> sabusabu <º)))><"
// Campanella notifiche: lista con il tipo di ogni avviso e filtro per tipo, segna come lette, aggiornamento in
// tempo reale via SSE (ticket di 60").
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge, Box, Button, Chip, Divider, IconButton, List, ListItemButton, ListItemText, Popover, Stack, Typography,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { api } from "../api";

interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

// tipi raggruppati come nel riepilogo giornaliero (notifier.py)
const GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: "task", label: "Compiti", kinds: ["TASK_ASSIGNED", "TASK_REMINDER", "TASK_OVERDUE", "TASK_ESCALATED", "WORKFLOW_APPROVED", "WORKFLOW_REJECTED"] },
  { key: "rfi", label: "RFI", kinds: ["RFI_CREATED", "RFI_REMINDER", "RFI_OVERDUE"] },
  { key: "transmittal", label: "Transmittal", kinds: ["TRANSMITTAL_RECEIVED", "TRANSMITTAL_ACKNOWLEDGED"] },
  { key: "follow", label: "Documenti seguiti", kinds: ["DOCUMENT_FOLLOWED"] },
  { key: "access", label: "Accessi", kinds: ["ACCESS_REQUESTED"] },
];
const groupOf = (kind: string) => GROUPS.find((g) => g.kinds.includes(kind)) ?? { key: "other", label: "Altro", kinds: [] };
const URGENT = new Set(["TASK_OVERDUE", "TASK_ESCALATED", "RFI_OVERDUE", "WORKFLOW_REJECTED"]);

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: Notification[]; unread: number }>("/notifications?limit=30"),
    refetchInterval: 60_000,   // rete di sicurezza se lo stream SSE cade
  });
  const markAll = useMutation({
    mutationFn: () => api("/notifications/read", { method: "POST", json: { all: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    const connect = async () => {
      try {
        const { ticket } = await api<{ ticket: string }>("/notifications/stream-ticket", { method: "POST" });
        if (closed) return;
        source = new EventSource(`/api/notifications/stream?ticket=${encodeURIComponent(ticket)}&last_id=${data?.items[0]?.id ?? 0}`);
        source.addEventListener("notification", () => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          qc.invalidateQueries({ queryKey: ["my-tasks"] });
        });
        source.onerror = () => { source?.close(); if (!closed) retry = setTimeout(connect, 10_000); };
      } catch {
        if (!closed) retry = setTimeout(connect, 30_000);
      }
    };
    connect();
    return () => { closed = true; source?.close(); clearTimeout(retry); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (n: Notification) => {
    setAnchor(null);
    if (!n.read_at) await api("/notifications/read", { method: "POST", json: { ids: [n.id] } }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ["notifications"] });
    if (n.link) navigate(n.link);
  };

  const items = data?.items ?? [];
  const present = [...GROUPS, { key: "other", label: "Altro", kinds: [] }]
    .filter((g) => items.some((n) => groupOf(n.kind).key === g.key));
  const shown = filter ? items.filter((n) => groupOf(n.kind).key === filter) : items;

  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)} aria-label="notifiche">
        <Badge badgeContent={data?.unread ?? 0} color="secondary" max={99}><NotificationsIcon /></Badge>
      </IconButton>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
               anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <Box width={{ xs: 320, sm: 400 }} maxHeight={480} overflow="auto">
          <Stack direction="row" alignItems="center" px={2} py={1}>
            <Typography fontWeight={600} flexGrow={1}>Notifiche</Typography>
            <Button size="small" disabled={!data?.unread} onClick={() => markAll.mutate()}>Segna tutte come lette</Button>
          </Stack>
          {present.length > 1 && (
            <Stack direction="row" spacing={0.5} px={2} pb={1} flexWrap="wrap" useFlexGap role="group" aria-label="Filtra per tipo">
              <Chip size="small" label="Tutte" color={filter ? "default" : "primary"} onClick={() => setFilter(null)} />
              {present.map((g) => (
                <Chip key={g.key} size="small" label={g.label} color={filter === g.key ? "primary" : "default"}
                      onClick={() => setFilter(filter === g.key ? null : g.key)} />
              ))}
            </Stack>
          )}
          <Divider />
          {shown.length === 0 && <Typography p={2} color="text.secondary">Nessuna notifica.</Typography>}
          <List dense disablePadding>
            {shown.map((n) => (
              <ListItemButton key={n.id} onClick={() => open(n)} sx={{ bgcolor: n.read_at ? "transparent" : "action.hover" }}>
                <ListItemText primary={<>
                                <Typography component="span" variant="caption" color={URGENT.has(n.kind) ? "error.main" : "primary.main"}
                                            fontWeight={600} display="block">{groupOf(n.kind).label}</Typography>
                                {n.title}
                              </>}
                              primaryTypographyProps={{ fontWeight: n.read_at ? 400 : 600, component: "div" }}
                              secondary={`${new Date(n.created_at).toLocaleString("it-IT")} · ${n.body}`}
                              secondaryTypographyProps={{ noWrap: true }} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Popover>
    </>
  );
}
