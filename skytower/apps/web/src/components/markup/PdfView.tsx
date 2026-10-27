// "><(((º> sabusabu <º)))><"
// PDF reso con PDF.js su canvas, pagina per pagina solo quando entra in vista (file grandi), con uno
// strato sovrapposto per le annotazioni. Caricato a richiesta: pdf.js non pesa sul bundle iniziale.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Box, CircularProgress } from "@mui/material";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfViewProps {
  url: string;
  zoom: number;
  focusPage: { page: number; seq: number } | null;
  onPages: (n: number) => void;
  overlay: (page: number) => ReactNode;
}

export default function PdfView({ url, zoom, focusPage, onPages, overlay }: PdfViewProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const task = pdfjs.getDocument({ url, isEvalSupported: false });
    task.promise.then(async (doc) => {
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      if (!alive) return;
      setPdf(doc);
      setBase({ w: first.width, h: first.height });
      onPages(doc.numPages);
    }).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; task.destroy(); };
  }, [url]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusPage) return;
    container.current?.querySelector(`[data-page="${focusPage.page}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusPage]);

  if (error) return <Alert severity="error" sx={{ m: 3 }}>PDF non leggibile: {error}</Alert>;
  if (!pdf || !base) return <Box p={6} textAlign="center"><CircularProgress sx={{ color: "#fff" }} /></Box>;
  return (
    <Box ref={container} sx={{ py: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPage key={i + 1} pdf={pdf} page={i + 1} zoom={zoom} base={base} overlay={overlay(i + 1)} />
      ))}
    </Box>
  );
}

function PdfPage({ pdf, page, zoom, base, overlay }: {
  pdf: PDFDocumentProxy; page: number; zoom: number; base: { w: number; h: number }; overlay: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState(base);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "800px 0px" });
    io.observe(wrap.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let alive = true;
    pdf.getPage(page).then((p) => {
      if (!alive) return;
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: zoom });
      const c = canvas.current!;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      setSize({ w: vp.width / zoom, h: vp.height / zoom });
      task = p.render({ canvasContext: c.getContext("2d")!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task.promise.catch(() => undefined);
    });
    return () => { alive = false; task?.cancel(); };
  }, [visible, pdf, page, zoom]);

  return (
    <Box ref={wrap} data-page={page} sx={{ position: "relative", width: size.w * zoom, height: size.h * zoom,
                                           bgcolor: "#fff", boxShadow: 3, flexShrink: 0 }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
      {overlay}
    </Box>
  );
}
