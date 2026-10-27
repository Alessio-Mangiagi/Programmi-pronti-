// "><(((º> sabusabu <º)))><"
// Avanzamento di un workflow: step con assegnatari, esiti, scadenze.
import { useQuery } from "@tanstack/react-query";
import { Box, Chip, Stack, Step, StepContent, StepLabel, Stepper, Typography } from "@mui/material";
import { api } from "../api";

export interface WorkflowInstance {
  id: string;
  status: "RUNNING" | "APPROVED" | "REJECTED" | "CANCELLED";
  template_name: string;
  template_version: number;
  step_count: number;
  current_step: number;
  started_by_name: string;
  started_by: string;
  started_at: string;
  outcome_comment: string | null;
  steps: {
    id: string;
    step_index: number;
    name: string;
    required: number;
    status: string;
    due_at: string | null;
    tasks: { id: string; assignee_name: string; status: string; outcome: string | null; comment: string | null; completed_at: string | null }[];
  }[];
}

const WF_STATUS: Record<string, { label: string; color: "warning" | "success" | "error" | "default" }> = {
  RUNNING: { label: "In corso", color: "warning" },
  APPROVED: { label: "Approvato", color: "success" },
  REJECTED: { label: "Rifiutato", color: "error" },
  CANCELLED: { label: "Annullato", color: "default" },
};
const OUTCOME: Record<string, string> = { APPROVED: "✔ approvato", APPROVED_WITH_COMMENTS: "✔ con commenti", REJECTED: "✖ rifiutato" };

export function WorkflowProgress({ instanceId, instance }: { instanceId?: string; instance?: WorkflowInstance }) {
  const { data } = useQuery({
    queryKey: ["workflow", instanceId],
    queryFn: () => api<WorkflowInstance>(`/workflows/${instanceId}`),
    enabled: !!instanceId && !instance,
  });
  const wf = instance ?? data;
  if (!wf) return null;
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={1}>
        <Typography fontWeight={600}>{wf.template_name} v{wf.template_version}</Typography>
        <Chip size="small" {...WF_STATUS[wf.status]} />
        <Typography variant="caption" color="text.secondary">avviato da {wf.started_by_name}</Typography>
      </Stack>
      {wf.outcome_comment && <Typography variant="body2" mb={1}>“{wf.outcome_comment}”</Typography>}
      <Stepper orientation="vertical" activeStep={wf.status === "RUNNING" ? wf.current_step : wf.steps.length}>
        {wf.steps.map((s) => (
          <Step key={s.id} expanded completed={s.status === "APPROVED"}>
            <StepLabel error={s.status === "REJECTED"}>
              {s.name} <Typography component="span" variant="caption" color="text.secondary">
                (quorum {s.required}/{s.tasks.length}{s.due_at ? `, scadenza ${new Date(s.due_at).toLocaleString("it-IT")}` : ""})
              </Typography>
            </StepLabel>
            <StepContent>
              {s.tasks.map((t) => (
                <Typography key={t.id} variant="body2">
                  {t.assignee_name}: {t.status === "DONE" ? OUTCOME[t.outcome!] : t.status === "OPEN" ? "in attesa" : "non necessario"}
                  {t.comment && <> — <i>{t.comment}</i></>}
                </Typography>
              ))}
            </StepContent>
          </Step>
        ))}
      </Stepper>
    </Box>
  );
}
