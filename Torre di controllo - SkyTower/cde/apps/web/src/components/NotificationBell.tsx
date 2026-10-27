// "><(((º> sabusabu <º)))><"
// Campanella notifiche: lista, segna come lette, aggiornamento in tempo reale via SSE (ticket di 60").
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Box, Button, Divider, IconButton, List, ListItemButton, ListItemText, Popover, Stack, Typography } from "@mui/material";
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

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
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
          <Divider />
          {data?.items.length === 0 && <Typography p={2} color="text.secondary">Nessuna notifica.</Typography>}
          <List dense disablePadding>
            {data?.items.map((n) => (
              <ListItemButton key={n.id} onClick={() => open(n)} sx={{ bgcolor: n.read_at ? "transparent" : "action.hover" }}>
                <ListItemText primary={n.title} primaryTypographyProps={{ fontWeight: n.read_at ? 400 : 600 }}
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
