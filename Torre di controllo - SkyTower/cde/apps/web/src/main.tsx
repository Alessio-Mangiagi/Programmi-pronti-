// "><(((º> sabusabu <º)))><"
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CircularProgress, CssBaseline, Stack, ThemeProvider, createTheme } from "@mui/material";
import { AuthProvider, useAuth } from "./auth";
import { LoginPage } from "./pages/Login";
import { InvitationPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/Account";
import { ProjectsPage } from "./pages/Projects";
import { ProjectPage } from "./pages/Project";
import { SecurityPage } from "./pages/Security";
import { Shell } from "./components/Shell";

const theme = createTheme({
  palette: { primary: { main: "#1f4e79" }, secondary: { main: "#e07a1f" }, background: { default: "#f4f6f8" } },
  shape: { borderRadius: 8 },
  components: { MuiButton: { defaultProps: { disableElevation: true } } },
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (n, err: any) => n < 2 && ![401, 403, 404].includes(err?.status) } },
});

function Protected({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = useAuth();
  if (!ready)
    return (
      <Stack alignItems="center" mt={10}>
        <CircularProgress />
      </Stack>
    );
  return authenticated ? <Shell>{children}</Shell> : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/invito" element={<InvitationPage />} />
              <Route path="/password-dimenticata" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/" element={<Protected><ProjectsPage /></Protected>} />
              <Route path="/progetti/:projectId/*" element={<Protected><ProjectPage /></Protected>} />
              <Route path="/sicurezza" element={<Protected><SecurityPage /></Protected>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
