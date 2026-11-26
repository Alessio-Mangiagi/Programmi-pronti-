// "><(((º> sabusabu <º)))><"
// Etichette, colori e frasi comuni ai task fra le persone della commessa (ADR-59): bacheca, elenco, scheda del task,
// pannello "Per me" e discussioni li scrivono tutti allo stesso modo.
import { useQuery } from "@tanstack/react-query";
import { api, Member, TeamTaskPriority, TeamTaskStatus } from "../../api";

export const STATUS: Record<TeamTaskStatus, { label: string; color: "default" | "info" | "success" }> = {
  TODO: { label: "Da fare", color: "default" },
  IN_PROGRESS: { label: "In corso", color: "info" },
  DONE: { label: "Fatto", color: "success" },
};
export const STATUS_ORDER: TeamTaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

export const PRIORITY: Record<TeamTaskPriority, { label: string; color: "default" | "warning" | "error" | "primary" }> = {
  LOW: { label: "Bassa", color: "default" },
  NORMAL: { label: "Normale", color: "primary" },
  HIGH: { label: "Alta", color: "warning" },
  URGENT: { label: "Urgente", color: "error" },
};

/** '2026-11-28' → '28/11/2026' (le scadenze sono giorni, senza ora: niente conversioni di fuso). */
export function giorno(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export const quando = (iso: string) => new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

/** Iniziali per i pallini delle persone sulle schede. */
export const iniziali = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

/** Persone della commessa, una volta sola anche se hanno più ruoli (l'elenco membri ha una riga per ruolo). */
export function usePersone(projectId: string) {
  const { data = [] } = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => api<Member[]>(`/projects/${projectId}/members`),
  });
  return [...new Map(data.map((m) => [m.user_id, m])).values()]
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
}

export const nomeMembro = (m: Member) => `${m.first_name} ${m.last_name} (${m.organization_code})`;

/** Una riga della storia del task in italiano: "ha spostato in «In corso»", "ha completato il sotto-task «…»". */
export function frase(kind: string, data: Record<string, any>): string {
  const pr = (p: string) => (PRIORITY[p as TeamTaskPriority]?.label ?? p).toLowerCase();
  switch (kind) {
    case "CREATED": return `ha creato il task${data.assignees?.length ? ` per ${data.assignees.join(", ")}` : ""}`;
    case "STATUS": return `ha spostato in «${STATUS[data.to as TeamTaskStatus]?.label ?? data.to}»`;
    case "PRIORITY": return `ha cambiato la priorità da ${pr(data.from)} a ${pr(data.to)}`;
    case "DUE": return data.to ? `ha fissato la scadenza al ${giorno(data.to)}` : "ha tolto la scadenza";
    case "TITLE": return `ha cambiato il titolo in «${data.to}»`;
    case "DESCRIPTION": return "ha cambiato la descrizione";
    case "ASSIGNED": return `ha assegnato il task a ${data.name}`;
    case "UNASSIGNED": return `ha tolto dal task ${data.name}`;
    case "ITEM_ADDED": return `ha aggiunto il sotto-task «${data.title}»`;
    case "ITEM_DONE": return `ha completato il sotto-task «${data.title}»`;
    case "ITEM_REOPENED": return `ha riaperto il sotto-task «${data.title}»`;
    case "ITEM_REMOVED": return `ha tolto il sotto-task «${data.title}»`;
    case "ITEM_RENAMED": return `ha rinominato il sotto-task «${data.from}» in «${data.to}»`;
    case "COMMENT": return "ha commentato";
    case "OVERDUE": return `scadenza del ${giorno(data.due_on)} superata`;
    case "DELETED": return "ha eliminato il task";
    default: return kind;
  }
}
