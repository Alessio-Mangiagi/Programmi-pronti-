// "><(((º> sabusabu <º)))><"
// Layout a tre colonne: commesse e cartelle a sinistra, contenuto al centro, "Per me" a destra.
// Sotto i 1200 px le colonne laterali diventano cassetti apribili dalla barra in alto.
// Nella barra, accanto al logo, le frecce Indietro / Avanti tra le pagine visitate.
import { ReactNode, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { AppBar, Avatar, Badge, Box, Drawer, IconButton, Stack, Toolbar, Typography, useMediaQuery, useTheme } from "@mui/material";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import MenuIcon from "@mui/icons-material/Menu";
import { HistoryArrows } from "./HistoryArrows";
import { NotificationBell } from "./NotificationBell";
import { PerMePanel, usePerMe } from "./PerMePanel";
import { ProfileMenu } from "./ProfileMenu";
import { ProjectTree } from "./ProjectTree";

export function Shell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("lg"));
  const [treeOpen, setTreeOpen] = useState(false);
  const [perMeOpen, setPerMeOpen] = useState(false);
  const { tasks, transmittals } = usePerMe();

  return (
    <Stack height="100vh">
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar sx={{ gap: 1.5, minHeight: { xs: 56 } }}>
          {!wide && (
            <IconButton color="inherit" edge="start" aria-label="Commesse e cartelle" onClick={() => setTreeOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Stack direction="row" alignItems="center" spacing={1.25} component={RouterLink} to="/"
                 sx={{ color: "inherit", textDecoration: "none", minWidth: { lg: 268 } }}>
            <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: "#fff", color: "primary.main", fontWeight: 700 }}>C</Avatar>
            <Typography fontWeight={600} sx={{ display: { xs: "none", sm: "block" } }}>CDE · ISO 19650</Typography>
          </Stack>
          <HistoryArrows />
          <Box flexGrow={1} />
          {!wide && (
            <IconButton color="inherit" aria-label="Per me" onClick={() => setPerMeOpen(true)}>
              <Badge badgeContent={tasks.length + transmittals.length} color="secondary"><AssignmentTurnedInIcon /></Badge>
            </IconButton>
          )}
          <NotificationBell />
          <ProfileMenu />
        </Toolbar>
      </AppBar>
      <Stack direction="row" flexGrow={1} minHeight={0}>
        {wide ? (
          <Box width={290} flexShrink={0} borderRight={1} borderColor="divider" bgcolor="background.paper">
            <ProjectTree />
          </Box>
        ) : (
          <Drawer open={treeOpen} onClose={() => setTreeOpen(false)} PaperProps={{ sx: { width: 300 } }}>
            <ProjectTree onNavigate={() => setTreeOpen(false)} />
          </Drawer>
        )}
        <Box component="main" flexGrow={1} minWidth={0} overflow="auto" p={{ xs: 2, md: 2.5 }}>
          {children}
        </Box>
        {wide ? (
          <Box flexShrink={0}><PerMePanel /></Box>
        ) : (
          <Drawer anchor="right" open={perMeOpen} onClose={() => setPerMeOpen(false)} PaperProps={{ sx: { width: 340 } }}>
            <PerMePanel variant="drawer" onNavigate={() => setPerMeOpen(false)} />
          </Drawer>
        )}
      </Stack>
    </Stack>
  );
}
