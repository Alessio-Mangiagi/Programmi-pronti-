// "><(((º> sabusabu <º)))><"
// Un documento da solo, nella sua scheda del browser: /documenti/:id?cerca=testo&rev=revisione&compito=id.
// Ogni documento o modello si apre così (openDocument): l'app resta nella sua scheda con frecce e cronologia.
// "cerca" evidenzia subito il testo nel PDF, "rev" sceglie la revisione, "compito" lega le annotazioni alla
// revisione in corso. "Dettagli e cronologia" mostra il pannello del documento; chiudendo il visualizzatore si
// chiude la scheda (o, se il browser non lo permette, si torna alle commesse).
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { FileViewer } from "../components/FileViewer";
import { DocumentDrawer } from "./project/Documents";

export function DocumentPage() {
  const { documentId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [details, setDetails] = useState(false);
  const { data: doc } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api<{ identifier: string; title: string; project_id: string }>(`/documents/${documentId}`),
  });
  useEffect(() => {
    if (doc) document.title = `${doc.identifier} · ${doc.title}`;      // schede distinguibili nella barra
  }, [doc]);

  if (details && doc)
    return <DocumentDrawer projectId={doc.project_id} documentId={documentId} onClose={() => setDetails(false)} />;
  return (
    <FileViewer documentId={documentId} initialSearch={params.get("cerca") ?? undefined}
                revisionId={params.get("rev") ?? undefined} taskId={params.get("compito") ?? undefined}
                onDetails={() => setDetails(true)}
                onClose={() => { window.close(); navigate("/", { replace: true }); }} />
  );
}
