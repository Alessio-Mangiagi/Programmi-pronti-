// "><(((º> sabusabu <º)))><"
// Segni di contenuto delle cartelle (26/11/2026): oltre ai modelli BIM (che hanno la loro icona,
// FolderBimIcon.tsx) una cartella dice a colpo d'occhio se contiene tavole, disegni CAD, computi,
// relazioni o foto.
// Così in ogni commessa si trova la cartella giusta senza aprirle una per una.
//
// Da dove arrivano i dati: `content_kinds` di GET /projects/{id}/containers
// (apps/api/cde_api/modules/containers.py, CONTENT_KINDS: l'elenco delle estensioni sta solo lì).
// I PDF contano solo se il nome segue la codifica: il server guarda il tipo documento (DR = tavola,
// RP = relazione, BQ = computo…), perché l'estensione .pdf da sola non distinguerebbe nulla.
//
// Due intensità, come per il BIM:
// - `qui`: i file stanno proprio in questa cartella (segno pieno; nell'elenco è un'etichetta col nome);
// - `sotto`: stanno in una sottocartella a qualsiasi profondità (icona più chiara), calcolati da
//   `contenutiSotto` sulle sole cartelle che l'utente vede.
import { Box, Chip, Tooltip } from "@mui/material";
import ArchitectureIcon from "@mui/icons-material/Architecture";
import CalculateIcon from "@mui/icons-material/Calculate";
import DescriptionIcon from "@mui/icons-material/Description";
import DesignServicesIcon from "@mui/icons-material/DesignServices";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import type { SvgIconComponent } from "@mui/icons-material";
import type { Container } from "../api";

type Tipo = { etichetta: string; cosa: string; colore: string; Icona: SvgIconComponent };

/** I tipi nell'ordine in cui si mostrano; le chiavi sono quelle che manda il server. */
export const TIPI_CONTENUTO: Record<string, Tipo> = {
  TAVOLE: { etichetta: "Tavole", cosa: "tavole", colore: "#0e7c86", Icona: DesignServicesIcon },
  CAD: { etichetta: "CAD", cosa: "disegni CAD", colore: "#b45f06", Icona: ArchitectureIcon },
  COMPUTI: { etichetta: "Computi", cosa: "computi e fogli di calcolo", colore: "#2f7d46", Icona: CalculateIcon },
  RELAZIONI: { etichetta: "Relazioni", cosa: "relazioni e documenti di testo", colore: "#55606b", Icona: DescriptionIcon },
  FOTO: { etichetta: "Foto", cosa: "foto e immagini", colore: "#a8436b", Icona: PhotoCameraIcon },
};
const ORDINE = Object.keys(TIPI_CONTENUTO);

/**
 * Per ogni cartella, i tipi di contenuto presenti nelle sue sottocartelle (non in lei stessa).
 * Si risale da ogni cartella con `content_kinds` lungo `parent_id`. Le aree riservate non contano e
 * non vengono segnate, come per il BIM (cartelleConBimSotto in ProjectTree.tsx).
 */
export function contenutiSotto(containers: Container[]): Map<string, Set<string>> {
  const byId = new Map(containers.map((c) => [c.id, c]));
  const sopra = new Map<string, Set<string>>();
  for (const c of containers) {
    if (c.is_private || !c.content_kinds?.length) continue;
    for (let p = c.parent_id ? byId.get(c.parent_id) : undefined; p && !p.is_private; p = p.parent_id ? byId.get(p.parent_id) : undefined) {
      const tipi = sopra.get(p.id) ?? new Set<string>();
      for (const k of c.content_kinds) tipi.add(k);
      sopra.set(p.id, tipi);
    }
  }
  return sopra;
}

type Props = {
  /** tipi presenti nella cartella stessa */
  qui?: string[];
  /** tipi presenti nelle sottocartelle */
  sotto?: Set<string>;
  /** "albero": solo icone piccole; "elenco": etichette col nome per i tipi presenti qui */
  variante: "albero" | "elenco";
};

export default function FolderContentMarks({ qui = [], sotto, variante }: Props) {
  const pieni = ORDINE.filter((k) => qui.includes(k));
  // un tipo già presente qui non si ripete sbiadito
  const sbiaditi = ORDINE.filter((k) => sotto?.has(k) && !pieni.includes(k));
  if (!pieni.length && !sbiaditi.length) return null;
  const lato = variante === "albero" ? 16 : 18;
  const icona = (k: string, pieno: boolean) => {
    const t = TIPI_CONTENUTO[k];
    const testo = pieno ? `Contiene ${t.cosa}` : `${t.cosa[0].toUpperCase()}${t.cosa.slice(1)} nelle sottocartelle`;
    return (
      <Tooltip key={k} title={testo}>
        <Box component="span" role="img" aria-label={testo} data-contenuto={k} data-dove={pieno ? "qui" : "sotto"}
             sx={{ display: "inline-flex", opacity: pieno ? 1 : 0.6 }}>
          <t.Icona sx={{ fontSize: lato, color: t.colore }} />
        </Box>
      </Tooltip>
    );
  };
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
      {pieni.map((k) => {
        if (variante === "albero") return icona(k, true);
        const t = TIPI_CONTENUTO[k];
        return (
          <Tooltip key={k} title={`Contiene ${t.cosa}`}>
            <Chip size="small" variant="outlined" data-contenuto={k} data-dove="qui" label={t.etichetta}
                  icon={<t.Icona sx={{ fontSize: 16, color: `${t.colore} !important` }} />}
                  sx={{ borderColor: t.colore, color: t.colore, fontWeight: 600 }} />
          </Tooltip>
        );
      })}
      {sbiaditi.map((k) => icona(k, false))}
    </Box>
  );
}
