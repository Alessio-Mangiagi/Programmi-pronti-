// "><(((º> sabusabu <º)))><"
import { ReactNode } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from "@mui/material";
import { useAuth } from "../auth";

export function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Box minHeight="100vh">
      <AppBar position="sticky" color="primary">
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" component={RouterLink} to="/" sx={{ color: "inherit", textDecoration: "none", flexGrow: 1 }}>
            CDE · ISO 19650
          </Typography>
          {me && (
            <>
              <Chip size="small" label={me.organization_code} sx={{ bgcolor: "rgba(255,255,255,.15)", color: "inherit" }} />
              <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>
                {me.first_name} {me.last_name}
              </Typography>
              {!me.mfa && me.mfa_required && <Chip size="small" color="warning" label="MFA richiesta" />}
            </>
          )}
          <Button color="inherit" component={RouterLink} to="/sicurezza">
            Sicurezza
          </Button>
          <Button color="inherit" onClick={async () => { await logout(); navigate("/login"); }}>
            Esci
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        {children}
      </Container>
    </Box>
  );
}
