// "><(((º> sabusabu <º)))><"
// Icona delle cartelle che contengono modelli BIM (26/11/2026). Una cartella gialla uguale alle altre
// costringeva ad aprirle una per una per trovare i modelli: questa è blu e porta il cubo 3D, così si
// riconosce a colpo d'occhio nell'albero delle commesse e nell'elenco della cartella.
//
// Quali cartelle: quelle con `has_bim` nella risposta di GET /projects/{id}/containers
// (apps/api/cde_api/modules/containers.py), cioè con almeno un documento non archiviato che ha una
// revisione in formato BIM (.ifc, .ifczip, .ifcxml, .rvt, .rfa, .nwd, .nwc, .nwf). L'elenco dei formati
// sta solo sul server.
import { Box, Tooltip } from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ViewInArIcon from "@mui/icons-material/ViewInAr";

/** blu del marchio per la cartella chiusa, più scuro per quella aperta (come fa il giallo delle altre) */
const BLU = "#1976a8";
const BLU_APERTA = "#0c4577";

export default function FolderBimIcon({ open = false, fontSize = "medium" }: { open?: boolean; fontSize?: "small" | "medium" }) {
  const Cartella = open ? FolderOpenIcon : FolderIcon;
  const lato = fontSize === "small" ? 20 : 24;
  return (
    <Tooltip title="Contiene modelli BIM">
      <Box component="span" role="img" aria-label="Cartella con modelli BIM" data-bim="true"
           sx={{ position: "relative", display: "inline-flex", width: lato, height: lato, flexShrink: 0 }}>
        <Cartella fontSize={fontSize} sx={{ color: open ? BLU_APERTA : BLU }} />
        {/* il cubo sta in basso a destra, su un dischetto bianco: resta leggibile anche a 20 px e su sfondo scuro */}
        <Box component="span" sx={{ position: "absolute", right: -4, bottom: -3, display: "inline-flex", borderRadius: "50%",
                                    bgcolor: "background.paper", lineHeight: 0 }}>
          <ViewInArIcon sx={{ fontSize: lato * 0.6, color: BLU_APERTA }} />
        </Box>
      </Box>
    </Tooltip>
  );
}
