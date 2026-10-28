// "><(((º> sabusabu <º)))><"
// Un documento da solo, nella sua scheda del browser: /documenti/:id?cerca=testo. Si apre così una tavola
// dal modello BIM, accanto al modello invece che sopra; "cerca" evidenzia subito il testo nel PDF.
// Chiudendo il visualizzatore si chiude la scheda (o, se il browser non lo permette, si torna alle commesse).
import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { FileViewer } from "../components/FileViewer";

export function DocumentPage() {
  const { documentId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: doc } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api<{ identifier: string; title: string }>(`/documents/${documentId}`),
  });
  useEffect(() => {
    if (doc) document.title = `${doc.identifier} · ${doc.title}`;      // schede distinguibili nella barra
  }, [doc]);

  return (
    <FileViewer documentId={documentId} initialSearch={params.get("cerca") ?? undefined}
                onClose={() => { window.close(); navigate("/", { replace: true }); }} />
  );
}
