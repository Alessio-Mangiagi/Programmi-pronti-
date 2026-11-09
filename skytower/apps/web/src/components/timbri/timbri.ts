// "><(((º> sabusabu <º)))><"
// Timbri sui PDF (ADR-56): tipi e richieste comuni alla pagina "Timbri" della commessa e allo strumento "Timbra" del
// visualizzatore. Le immagini dei timbri arrivano dall'API con il token (GET /stamps/{id}/image) e diventano URL
// blob in cache: un <img src="/api/..."> non porterebbe l'autorizzazione.
import { useQuery } from "@tanstack/react-query";
import { api, apiBlob } from "../../api";

export type AmbitoTimbro = "PERSONAL" | "ORGANIZATION" | "PROJECT";

export interface Timbro {
  id: string;
  scope: AmbitoTimbro;
  organization_code: string;
  project_id: string | null;
  name: string;
  width_px: number;
  height_px: number;
  created_at: string;
  created_by_name: string | null;
  disabled_at: string | null;
  can_manage: boolean;
}

export interface ElencoTimbri { timbri: Timbro[]; posso_creare: Record<AmbitoTimbro, boolean> }

export const NOME_AMBITO: Record<AmbitoTimbro, string> = {
  PROJECT: "Della commessa",
  ORGANIZATION: "Della mia organizzazione",
  PERSONAL: "Personale",
};

/** Sfondo a scacchi: fa vedere dove il timbro è trasparente. */
export const SCACCHI = "repeating-conic-gradient(#d9d9d9 0 25%, #ffffff 0 50%) 0 0 / 14px 14px";

export function useTimbri(projectId: string | undefined, disattivati = false) {
  return useQuery({
    queryKey: ["timbri", projectId, disattivati],
    queryFn: () => api<ElencoTimbri>(`/projects/${projectId}/stamps${disattivati ? "?disattivati=true" : ""}`),
    enabled: !!projectId,
  });
}

/** URL blob dell'immagine di un timbro (cache per tutta la sessione: l'immagine di un timbro non cambia). */
export function useImmagineTimbro(id: string | undefined) {
  return useQuery({
    queryKey: ["timbro-immagine", id],
    queryFn: async () => URL.createObjectURL(await apiBlob(`/stamps/${id}/image`)),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Il file scelto in base64 (senza il prefisso "data:…;base64,"), come lo vuole POST /projects/{id}/stamps. */
export function base64DelFile(file: Blob): Promise<string> {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => ko(r.error ?? new Error("file non leggibile"));
    r.readAsDataURL(file);
  });
}
