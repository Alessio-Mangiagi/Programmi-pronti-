// "><(((º> sabusabu <º)))><"
// PDF reso con PDF.js su canvas, pagina per pagina solo quando entra in vista (file grandi), con uno
// strato sovrapposto per le annotazioni. Con compareUrl le due revisioni si sovrappongono: in rosso ciò che
// c'è solo nella revisione aperta, in blu ciò che c'è solo in quella di confronto, in nero le parti uguali.
// Caricato a richiesta: pdf.js non pesa sul bundle iniziale.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Box, CircularProgress } from "@mui/material";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfViewProps {
  url: string;
  compareUrl?: string | null;
  zoom: number;
  focusPage: { page: number; seq: number } | null;
  onPages: (n: number) => void;
  overlay: (page: number) => ReactNode;
}

function useDocument(url: string | null | undefined) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy | null; error: string | null }>({ doc: null, error: null });
  useEffect(() => {
    setState({ doc: null, error: null });
    if (!url) return;
    let alive = true;
    const task = pdfjs.getDocument({ url, isEvalSupported: false });
    task.promise.then((doc) => alive && setState({ doc, error: null }))
      .catch((e: Error) => alive && setState({ doc: null, error: e.message }));
    return () => { alive = false; task.destroy(); };
  }, [url]);
  return state;
}

export default function PdfView({ url, compareUrl, zoom, focusPage, onPages, overlay }: PdfViewProps) {
  const { doc: pdf, error } = useDocument(url);
  const { doc: cmp, error: cmpError } = useDocument(compareUrl);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    pdf.getPage(1).then((p) => {
      const vp = p.getViewport({ scale: 1 });
      if (alive) { setBase({ w: vp.width, h: vp.height }); onPages(pdf.numPages); }
    });
    return () => { alive = false; };
  }, [pdf]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusPage) return;
    container.current?.querySelector(`[data-page="${focusPage.page}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusPage]);

  if (error) return <Alert severity="error" sx={{ m: 3 }}>PDF non leggibile: {error}</Alert>;
  if (!pdf || !base || (compareUrl && !cmp && !cmpError)) {
    return <Box p={6} textAlign="center"><CircularProgress sx={{ color: "#fff" }} /></Box>;
  }
  const comparing = !!compareUrl && !!cmp;
  return (
    <Box ref={container} sx={{ py: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      {cmpError && <Alert severity="warning">Revisione di confronto non leggibile: {cmpError}</Alert>}
      {comparing && (
        <Alert severity="info" icon={false} sx={{ py: 0 }}>
          <Box component="span" sx={{ color: "#d00000", fontWeight: 700 }}>Rosso</Box>: solo nella revisione aperta ·{" "}
          <Box component="span" sx={{ color: "#0040ff", fontWeight: 700 }}>blu</Box>: solo nella revisione di confronto ·
          nero: invariato
        </Alert>
      )}
      {Array.from({ length: Math.max(pdf.numPages, comparing ? cmp!.numPages : 0) }, (_, i) => (
        <PdfPage key={`${i + 1}-${comparing}`} pdf={pdf} cmp={comparing ? cmp : null} page={i + 1} zoom={zoom} base={base}
                 overlay={overlay(i + 1)} />
      ))}
    </Box>
  );
}

async function renderTo(page: PDFPageProxy | null, width: number, height: number): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  if (page) {
    const vp = page.getViewport({ scale: 1 });
    const scale = width / vp.width;              // stessa larghezza in pixel per le due revisioni
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;
  }
  return c;
}

/** Luminanza per pixel delle due versioni → rosso solo A, blu solo B, nero entrambe. */
function composite(a: HTMLCanvasElement, b: HTMLCanvasElement, out: HTMLCanvasElement) {
  const w = a.width, h = a.height;
  const da = a.getContext("2d")!.getImageData(0, 0, w, h).data;
  const db = b.getContext("2d")!.getImageData(0, 0, w, h).data;
  const ctx = out.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const o = img.data;
  for (let i = 0; i < o.length; i += 4) {
    const la = (da[i] * 299 + da[i + 1] * 587 + da[i + 2] * 114) / 1000;
    const lb = (db[i] * 299 + db[i + 1] * 587 + db[i + 2] * 114) / 1000;
    o[i] = lb;
    o[i + 1] = Math.min(la, lb);
    o[i + 2] = la;
    o[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function PdfPage({ pdf, cmp, page, zoom, base, overlay }: {
  pdf: PDFDocumentProxy; cmp: PDFDocumentProxy | null; page: number; zoom: number; base: { w: number; h: number }; overlay: ReactNode;
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
    let alive = true;
    (async () => {
      const a = page <= pdf.numPages ? await pdf.getPage(page) : null;
      const b = cmp && page <= cmp.numPages ? await cmp.getPage(page) : null;
      const ref = (a ?? b)!.getViewport({ scale: 1 });
      if (!alive) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(ref.width * zoom * dpr), h = Math.floor(ref.height * zoom * dpr);
      setSize({ w: ref.width, h: ref.height });
      const ca = await renderTo(a, w, h);
      if (!alive) return;
      const c = canvas.current!;
      c.width = w;
      c.height = h;
      if (!cmp) { c.getContext("2d")!.drawImage(ca, 0, 0); return; }
      const cb = await renderTo(b, w, h);
      if (alive) composite(ca, cb, c);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [visible, pdf, cmp, page, zoom]);

  return (
    <Box ref={wrap} data-page={page} sx={{ position: "relative", width: size.w * zoom, height: size.h * zoom,
                                           bgcolor: "#fff", boxShadow: 3, flexShrink: 0 }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
      {overlay}
    </Box>
  );
}
