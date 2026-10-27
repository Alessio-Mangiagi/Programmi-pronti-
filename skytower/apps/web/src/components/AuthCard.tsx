// "><(((º> sabusabu <º)))><"
import { ReactNode } from "react";
import { Box, Paper, Typography } from "@mui/material";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box component="main" minHeight="100vh" display="flex" alignItems="center" justifyContent="center" px={2}
         sx={{ background: "linear-gradient(135deg, #1f4e79 0%, #12304b 100%)" }}>
      <Paper sx={{ p: { xs: 3, sm: 4 }, width: "100%", maxWidth: 420 }} elevation={8}>
        <Typography variant="overline" color="primary" fontWeight={700}>CDE · ISO 19650</Typography>
        <Typography variant="h5" component="h1" fontWeight={600} gutterBottom>{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary" mb={2}>{subtitle}</Typography>}
        {children}
      </Paper>
    </Box>
  );
}

export function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <Box component="ul" sx={{ columns: 2, fontFamily: "monospace", bgcolor: "grey.100", p: 2, pl: 4, borderRadius: 1, my: 2 }}>
      {codes.map((c) => <li key={c}>{c}</li>)}
    </Box>
  );
}
