// "><(((º> sabusabu <º)))><"
// Icona delle cartelle che contengono modelli BIM (26/11/2026). Una cartella gialla uguale alle altre
// costringeva ad aprirle una per una per trovare i modelli: questa porta il cubo 3D, così si riconosce
// a colpo d'occhio nell'albero delle commesse e nell'elenco della cartella.
//
// Due aspetti:
// - cartella BLU con il cubo: i modelli stanno proprio qui dentro (`has_bim` nella risposta di
//   GET /projects/{id}/containers, apps/api/cde_api/modules/containers.py);
// - cartella GIALLA con il cubo (`dentro`): i modelli stanno in una sottocartella. È il segno più
//   leggero che dice dove scendere anche con l'albero chiuso; lo calcola `cartelleConBimSotto` in
//   ProjectTree.tsx dalle cartelle che l'utente vede.
//
// Formati contati: .ifc, .ifczip, .ifcxml, .rvt, .rfa, .nwd, .nwc, .nwf e i modelli 3D .glb / .gltf.
// L'elenco sta solo sul server (BIM_EXTENSIONS).
import { Box, Tooltip } from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ViewInArIcon from "@mui/icons-material/ViewInAr";

/** blu del marchio per la cartella chiusa, più scuro per quella aperta (come fa il giallo delle altre) */
const BLU = "#1976a8";
const BLU_APERTA = "#0c4577";
/** gli stessi gialli delle cartelle normali (ProjectTree.tsx, Folder.tsx) */
const GIALLO = "#d9a93c";
const GIALLO_APERTA = "#c08a1e";

type Props = {
  /** cartella aperta (quella selezionata nell'albero) */
  open?: boolean;
  fontSize?: "small" | "medium";
  /** true: i modelli non sono in questa cartella ma in una sua sottocartella (cartella gialla, solo il cubo) */
  dentro?: boolean;
};

export default function FolderBimIcon({ open = false, fontSize = "medium", dentro = false }: Props) {
  const Cartella = open ? FolderOpenIcon : FolderIcon;
  const lato = fontSize === "small" ? 20 : 24;
  const colore = dentro ? (open ? GIALLO_APERTA : GIALLO) : open ? BLU_APERTA : BLU;
  const testo = dentro ? "Modelli BIM o 3D nelle sottocartelle" : "Contiene modelli BIM o 3D";
  return (
    <Tooltip title={testo}>
      <Box component="span" role="img" aria-label={testo} data-bim={dentro ? "sotto" : "true"}
           sx={{ position: "relative", display: "inline-flex", width: lato, height: lato, flexShrink: 0 }}>
        <Cartella fontSize={fontSize} sx={{ color: colore }} />
        {/* il cubo sta in basso a destra, su un dischetto bianco: resta leggibile anche a 20 px e su sfondo scuro */}
        <Box component="span" sx={{ position: "absolute", right: -4, bottom: -3, display: "inline-flex", borderRadius: "50%",
                                    bgcolor: "background.paper", lineHeight: 0 }}>
          <ViewInArIcon sx={{ fontSize: lato * 0.6, color: BLU_APERTA }} />
        </Box>
      </Box>
    </Tooltip>
  );
}
