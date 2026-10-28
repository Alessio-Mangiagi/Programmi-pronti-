// "><(((º> sabusabu <º)))><"
// Documenti e modelli si aprono sempre in una nuova scheda del browser (/documenti/:id): l'app resta dov'era,
// con le sue frecce e la cronologia, e si passa da una scheda all'altra.

export interface OpenDocumentOptions {
  /** testo da cercare ed evidenziare subito nel PDF */
  search?: string;
  /** revisione da mostrare invece dell'ultima */
  revisionId?: string;
  /** compito di revisione a cui legare le annotazioni */
  taskId?: string;
}

export function documentUrl(documentId: string, opts: OpenDocumentOptions = {}): string {
  const q = new URLSearchParams();
  if (opts.search) q.set("cerca", opts.search);
  if (opts.revisionId) q.set("rev", opts.revisionId);
  if (opts.taskId) q.set("compito", opts.taskId);
  const qs = q.toString();
  return `/documenti/${documentId}${qs ? `?${qs}` : ""}`;
}

export function openDocument(documentId: string, opts: OpenDocumentOptions = {}): void {
  window.open(documentUrl(documentId, opts), "_blank", "noopener");
}
