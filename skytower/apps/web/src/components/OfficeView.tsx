// "><(((º> sabusabu <º)))><"
// Anteprima in sola lettura di Word (.docx) ed Excel (.xlsx) nel browser, senza servizi esterni.
// Word: mammoth converte in HTML semantico, mostrato in un iframe sandbox senza script (un documento ostile
// non può eseguire nulla, nemmeno con link javascript:). Excel: valori delle celle, un foglio per scheda.
// CSV: stessa tabella, separatore (; , tab) riconosciuto dalla prima riga.
// Caricato a richiesta: le librerie non pesano sul bundle iniziale.
import { useEffect, useState } from "react";
import { Alert, Box, CircularProgress, Paper, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from "@mui/material";
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/browser";

const MAX_ROWS = 1000;
const MAX_COLS = 60;

const DOC_CSS = `
  body { font: 15px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1d1d1f; margin: 0; padding: 40px 48px; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 12px 0; }
  td, th { border: 1px solid #c9ccd1; padding: 4px 8px; vertical-align: top; }
  h1, h2, h3 { line-height: 1.25; }
`;

type Sheet = { sheet: string; data: unknown[][] };

/** CSV con campi tra virgolette (anche su più righe) e virgolette raddoppiate. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const first = body.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].reduce((best, c) => (first.split(c).length > first.split(best).length ? c : best), ",");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toLocaleDateString("it-IT");
  if (typeof v === "number") return v.toLocaleString("it-IT", { maximumFractionDigits: 10 });
  return String(v);
}

export default function OfficeView({ url, kind }: { url: string; kind: "docx" | "xlsx" | "csv" }) {
  const [html, setHtml] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setHtml(null); setSheets(null); setError(null); setTab(0);
    (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (kind === "csv") {
        const text = await res.text();
        if (alive) setSheets([{ sheet: "CSV", data: parseCsv(text) }]);
        return;
      }
      const buf = await res.arrayBuffer();
      if (kind === "docx") {
        const out = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (alive) setHtml(out.value);
      } else {
        const all = await readXlsxFile(buf);
        if (alive) setSheets(all as Sheet[]);
      }
    })().catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [url, kind]);

  if (error) return <Alert severity="error" sx={{ m: 3 }}>File non leggibile: {error}</Alert>;
  if (html === null && sheets === null) return <Box p={6} textAlign="center"><CircularProgress sx={{ color: "#fff" }} /></Box>;

  if (html !== null) {
    return (
      <Box sx={{ flexGrow: 1, display: "flex", justifyContent: "center", p: 2, minHeight: 0 }}>
        <Box component="iframe" title="Anteprima del documento Word" sandbox="allow-popups allow-popups-to-escape-sandbox"
             srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>${DOC_CSS}</style>${html}`}
             sx={{ border: 0, width: "100%", maxWidth: 900, height: "100%", minHeight: "70vh", bgcolor: "#fff", boxShadow: 3 }} />
      </Box>
    );
  }

  const sheet = sheets![tab];
  const rows = sheet?.data ?? [];
  const width = Math.min(MAX_COLS, Math.max(0, ...rows.slice(0, MAX_ROWS).map((r) => r.length)));
  return (
    <Paper sx={{ m: 2, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ borderBottom: 1, borderColor: "divider" }}>
        {sheets!.map((s, i) => <Tab key={s.sheet} value={i} label={s.sheet} />)}
      </Tabs>
      <Box sx={{ overflow: "auto", flexGrow: 1 }}>
        {rows.length === 0 ? <Typography p={2} color="text.secondary">Foglio vuoto.</Typography> : (
          <Table size="small" stickyHeader aria-label={`Foglio ${sheet.sheet}`}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ bgcolor: "action.hover", width: 48 }} />
                {Array.from({ length: width }, (_, i) => <TableCell key={i} sx={{ bgcolor: "action.hover", fontWeight: 600 }}>{colName(i)}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.slice(0, MAX_ROWS).map((r, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ bgcolor: "action.hover", color: "text.secondary" }}>{i + 1}</TableCell>
                  {Array.from({ length: width }, (_, j) => (
                    <TableCell key={j} sx={{ whiteSpace: "nowrap", textAlign: typeof r[j] === "number" ? "right" : "left" }}>{cell(r[j])}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>
      {(rows.length > MAX_ROWS || rows.some((r) => r.length > MAX_COLS)) && (
        <Typography variant="caption" color="text.secondary" p={1}>
          Anteprima limitata a {MAX_ROWS} righe e {MAX_COLS} colonne: per il resto scarica il file.
        </Typography>
      )}
    </Paper>
  );
}
