/**
 * app.tsx — Lettore DDT
 * Compilato con Vite.
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { EMPTY_PROJECT } from './store';
import { fmt, fmtPct, fmtInt, COLORS, MONTHS } from './formatters';
import { parseOutputCD, parseQuadroRiepilogo, convertJsonToProject } from './parsers';
import { Bar2 } from './components/Bar2';
import { BatchTab } from './components/BatchTab';
import { PaniereTab, aggiungiAlPaniere } from './components/PaniereTab';
import { ArchivioTab } from './components/ArchivioTab';
import { PreviewModal } from './components/PreviewModal';
import { PromptBuilder } from './components/PromptBuilder';
import { S } from './styles';
import { computeDdtChecks, ddtNumbersFromParsed } from './ddtChecks';

declare const XLSX: any;

// ============================================================
// ClaudeJsonBox — area di incolla della risposta JSON.
// Componente top-level memoizzato con stato locale: la digitazione
// non ri-renderizza l'intera app (prima ogni tasto rifaceva tutto l'albero).
// ============================================================
const ClaudeJsonBox = React.memo(function ClaudeJsonBox({
  busy,
  onPreview,
  onNextPdf,
  hasLastPrompt,
}: {
  busy: boolean;
  onPreview: (text: string) => void;
  onNextPdf: () => void;
  hasLastPrompt: boolean;
}) {
  const [text, setText] = React.useState<string>(() => {
    try {
      const saved = localStorage.getItem('cosedil-claude-json');
      if (saved) {
        const { content, savedAt } = JSON.parse(saved);
        if (Date.now() - new Date(savedAt).getTime() < 48 * 60 * 60 * 1000) return content;
        localStorage.removeItem('cosedil-claude-json');
      }
    } catch {}
    return '';
  });

  // Persistenza bozza (48h) mentre si digita
  React.useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (text.trim()) {
          localStorage.setItem('cosedil-claude-json', JSON.stringify({ content: text, savedAt: new Date().toISOString() }));
        } else {
          localStorage.removeItem('cosedil-claude-json');
        }
      } catch {}
    }, 400);
    return () => clearTimeout(timer);
  }, [text]);

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) setText(t);
    } catch {
      /* permesso negato: resta il Ctrl+V manuale */
    }
  };

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#434549" }}>
            📥 Incolla qui la risposta JSON di Claude:
          </label>
          <button onClick={pasteFromClipboard} style={{ ...S.btn("secondary"), fontSize: 12, padding: "6px 14px" }}>
            📋 Incolla da appunti
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'{\n  "summary": "...",\n  "sheets": [...]\n}'}
          style={{
            width: "100%", minHeight: 160, padding: 12,
            borderRadius: 10, border: "2px solid #e5e7eb",
            fontSize: 12, fontFamily: "monospace",
            resize: "vertical", outline: "none", boxSizing: "border-box",
            background: "#f0f8ff"
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => onPreview(text)}
          disabled={busy || !text.trim()}
          style={{
            ...S.btn("success"),
            opacity: busy || !text.trim() ? 0.5 : 1,
            fontSize: 14, padding: "10px 24px"
          }}
        >
          {busy ? "⏳ Generazione…" : "🔍 Anteprima & Scarica Excel"}
        </button>
        <button
          onClick={() => setText("")}
          disabled={!text}
          style={{ ...S.btn("secondary"), opacity: text ? 1 : 0.4 }}
        >
          🗑 Pulisci
        </button>
        {hasLastPrompt && (
          <button
            onClick={() => { setText(""); onNextPdf(); }}
            title="Ricopia l'ultimo prompt e apre una nuova chat Claude per il PDF successivo (un file per chat = qualità costante)"
            style={{ ...S.btn("primary"), fontSize: 14, padding: "10px 20px" }}
          >
            🔁 Prossimo PDF
          </button>
        )}
      </div>
    </>
  );
});

// Bar2, convertJsonToProject, parseOutputCD, parseQuadroRiepilogo, fmt, fmtPct, fmtInt, COLORS, MONTHS
// are imported from ./components/Bar2, ./parsers, ./formatters

// ============================================================
// MAIN APP
// ============================================================
interface AppProps {
  user?: { username: string; commessaId: string; displayName: string; isAdmin?: boolean };
  onLogout?: () => void;
}

export default function App({ user, onLogout }: AppProps = {}) {
  const isUndoing = React.useRef(false);
  const [project, setProject] = useState(() => {
    try {
      const ts = localStorage.getItem('cosedil-project-time');
      if (ts && (Date.now() - new Date(ts).getTime()) > 30 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem('cosedil-project');
        localStorage.removeItem('cosedil-project-time');
        return EMPTY_PROJECT;
      }
      const saved = localStorage.getItem('cosedil-project');
      if (saved) return JSON.parse(saved);
    } catch {}
    return EMPTY_PROJECT;
  });
  const [activeTab, setActiveTab] = useState("import");
  // Prompt preimpostati: arrivano dal server (/prompts, fonte unica condivisa
  // col batch) — la vecchia copia statica divergeva in silenzio.
  const [prompts, setPrompts] = useState<Array<{ id: string; label: string; description: string; text: string; custom?: boolean }>>([]);
  const caricaPrompts = useCallback(() => {
    fetch('/prompts', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { prompts: [] }))
      .then(d => setPrompts(d.prompts || []))
      .catch(() => setPrompts([]));
  }, []);
  useEffect(() => { caricaPrompts(); }, [caricaPrompts]);
  // Finestra "Costruttore prompt". Lo stato sta qui e non in ImportTab: quel
  // componente è ridefinito a ogni render di App, e la finestra si chiuderebbe
  // da sola alla prima notifica.
  const [costruttorePrompt, setCostruttorePrompt] = useState(false);
  const [selectedWbs, setSelectedWbs] = useState(null);
  const [activeSal, setActiveSal] = useState(null);
  const [progressWbs, setProgressWbs] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [notification, setNotification] = useState(null);

  // Cambio password (self-service)
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: "", next: "", confirm: "" });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState("");

  // Claude.ai manual workflow states
  const [claudeResponse, setClaudeResponse] = useState(() => {
    try {
      const saved = localStorage.getItem('cosedil-claude-json');
      if (saved) {
        const { content, savedAt } = JSON.parse(saved);
        if (Date.now() - new Date(savedAt).getTime() < 48 * 60 * 60 * 1000) return content;
        localStorage.removeItem('cosedil-claude-json');
      }
    } catch {}
    return "";
  });
  const [claudeOpenLog, setClaudeOpenLog] = useState<{openedAt: string}[]>(() => {
    try {
      const saved = localStorage.getItem('cosedil-claude-log');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewWarnings, setPreviewWarnings] = useState<{ level: 'ok'|'warn'|'error'; text: string }[]>([]);
  const [hasLastPrompt, setHasLastPrompt] = useState(() => {
    try { return !!localStorage.getItem('cosedil-last-prompt'); } catch { return false; }
  });
  const [pdfUploading, setPdfUploading] = useState(false);
  const [showExcelValidation, setShowExcelValidation] = useState(false);
  // Nome del PDF scansionato: persiste in localStorage così l'export mantiene
  // lo stesso nome anche se la pagina viene ricaricata durante il lavoro su Claude.ai
  const [pdfFileName, setPdfFileName] = useState(() => {
    try { return localStorage.getItem('cosedil-last-pdf-name') || ""; } catch { return ""; }
  });
  const pdfFileInputRef = useRef(null);
  const pendingPromptRef = useRef(null);

  // Sidebar states
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHover, setSidebarHover] = useState(false);
  const [activeSection, setActiveSection] = useState("main");
  const [readmeContent, setReadmeContent] = useState(null);
  const [extraTabsEnabled, setExtraTabsEnabled] = useState(() => localStorage.getItem('cosedil-extra-tabs') !== 'false');

  // Enhancement states
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('cosedil-theme') === 'dark');

  const TTL_48H = 48 * 60 * 60 * 1000;
  const [fileHistory, setFileHistory] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('cosedil-file-history');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      const now = Date.now();
      return parsed.filter((e: any) => now - new Date(e.createdAt).getTime() < TTL_48H);
    } catch { return []; }
  });

  // Persistenza del JSON Claude: gestita da ClaudeJsonBox (unico writer su
  // 'cosedil-claude-json') per evitare che due debounce si sovrascrivano.

  React.useEffect(() => {
    localStorage.setItem('cosedil-extra-tabs', String(extraTabsEnabled));
    if (!extraTabsEnabled && ['wbs','sal','kpi'].includes(activeTab)) setActiveTab('import');
  }, [extraTabsEnabled]);

  // Tab riservate agli admin: se un utente normale ci finisce (stato residuo), torna su Importa
  React.useEffect(() => {
    if (!user?.isAdmin && ['batch', 'archivio', 'wbs', 'sal', 'kpi'].includes(activeTab))
      setActiveTab('import');
  }, [user, activeTab]);

  // AutoSave debounced su localStorage + server
  React.useEffect(() => {
    if (!project || (project.articles.length === 0 && project.wbsItems.length === 0)) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('cosedil-project', JSON.stringify(project));
        const now = new Date();
        localStorage.setItem('cosedil-project-time', now.toISOString());
      } catch {}
      // Server autosave (fire-and-forget)
      fetch('/project/autosave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(project),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [project]);

  // Carica autosave dal server se localStorage è vuoto
  React.useEffect(() => {
    const hasLocal = localStorage.getItem('cosedil-project');
    if (hasLocal) return;
    fetch('/project/autosave', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && (data.articles?.length > 0 || data.wbsItems?.length > 0)) {
          setProject(data);
          notify('Progetto ripristinato dall\'autosave del server', 'info');
        }
      })
      .catch(() => {});
  }, []);

  // Push undo history quando il progetto cambia
  React.useEffect(() => {
    if (isUndoing.current) { isUndoing.current = false; return; }
    if (project.articles.length > 0 || project.wbsItems.length > 0) {
      window.Enhancements?.UndoRedo?.push(project);
    }
  }, [project]);

  // Fetch README content when section is activated
  React.useEffect(() => {
    if (activeSection === "readme") {
      setReadmeContent("Caricamento...");
      fetch("/docs-api/readme")
        .then((r) => {
          if (!r.ok) throw new Error("Errore HTTP: " + r.status);
          return r.json();
        })
        .then((data) => {
          if (data.content) {
            setReadmeContent(data.content);
          } else if (data.error) {
            setReadmeContent("Errore: " + data.error);
          } else {
            setReadmeContent("Nessun contenuto disponibile");
          }
        })
        .catch((err) => {
          console.error("Errore nel caricamento del README:", err);
          setReadmeContent("Errore di connessione al server: " + err.message);
        });
    }
  }, [activeSection]);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };
// "><(((º> sabusabu <º)))><"

  const openChangePwd = () => {
    setPwdForm({ current: "", next: "", confirm: "" });
    setPwdError("");
    setShowChangePwd(true);
  };

  const handleChangePassword = useCallback(async () => {
    setPwdError("");
    if (!pwdForm.current || !pwdForm.next) {
      setPwdError("Compila tutti i campi.");
      return;
    }
    if (pwdForm.next.length < 8) {
      setPwdError("La nuova password deve avere almeno 8 caratteri.");
      return;
    }
    if (pwdForm.next !== pwdForm.confirm) {
      setPwdError("La conferma non coincide con la nuova password.");
      return;
    }
    setPwdSaving(true);
    try {
      const res = await fetch('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: pwdForm.current, newPassword: pwdForm.next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwdError(data.error || 'Errore durante il cambio password.');
        return;
      }
      setShowChangePwd(false);
      notify('Password aggiornata con successo', 'success');
    } catch {
      setPwdError('Errore di connessione al server.');
    } finally {
      setPwdSaving(false);
    }
  }, [pwdForm]);

  const saveProjectToStorage = useCallback(() => {
    try {
      localStorage.setItem('cosedil-project', JSON.stringify(project));
      const now = new Date();
      localStorage.setItem('cosedil-project-time', now.toISOString());
      setLastSaved(now);
      window.Enhancements?.ToastSystem?.show('Progetto salvato', 'success', 2000);
    } catch {}
  }, [project]);

  const handleUndo = useCallback(() => {
    const prev = window.Enhancements?.UndoRedo?.undo();
    if (prev) {
      isUndoing.current = true;
      setProject(prev);
      setUndoAvail(window.Enhancements.UndoRedo.canUndo());
      setRedoAvail(window.Enhancements.UndoRedo.canRedo());
    }
  }, []);

  const handleRedo = useCallback(() => {
    const next = window.Enhancements?.UndoRedo?.redo();
    if (next) {
      isUndoing.current = true;
      setProject(next);
      setUndoAvail(window.Enhancements.UndoRedo.canUndo());
      setRedoAvail(window.Enhancements.UndoRedo.canRedo());
    }
  }, []);

  const toggleDark = useCallback(() => {
    window.Enhancements?.DarkMode?.toggle();
    setDarkMode(window.Enhancements?.DarkMode?.isDark() ?? false);
  }, []);

  const clearProject = useCallback(() => {
    window.Enhancements?.showConfirm(
      'Vuoi cancellare il progetto corrente? I dati non salvati andranno persi.',
      () => {
        setProject(EMPTY_PROJECT);
        localStorage.removeItem('cosedil-project');
        localStorage.removeItem('cosedil-project-time');
        setLastSaved(null);
        window.Enhancements?.UndoRedo?.clear();
        setUndoAvail(false);
        setRedoAvail(false);
        setActiveTab("import");
        fetch('/project/autosave', { method: 'DELETE', credentials: 'include' }).catch(() => {});
        notify('Progetto cancellato');
      }
    );
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveProjectToStorage(); }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); handleRedo(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [saveProjectToStorage, handleUndo, handleRedo]);

  // ── Claude.ai manual workflow ──────────────────────────────
  // Helper: legge risposta come JSON, mostra errore leggibile se non è JSON
  const fetchJSON = async (res) => {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error(`Errore server (${res.status}) — risposta non valida. Controlla che il server sia avviato.`);
    }
    return res.json();
  };

  // Apre l'anteprima: valida il JSON, esegue i controlli di coerenza (conteggi,
  // totali m³, duplicati interni) e verifica in background i DDT già archiviati.
  const openPreviewWithChecks = useCallback((parsed: any) => {
    const checks = computeDdtChecks(parsed);
    setPreviewWarnings(checks);
    setPreviewData(parsed);

    const nums = ddtNumbersFromParsed(parsed);
    if (nums.length === 0) return;
    const jsonName = (typeof parsed.fileName === 'string' && parsed.fileName ? parsed.fileName : '')
      .replace(/\.[^.]+$/, '.json');
    fetch('/ddt-check-duplicates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ddtNumbers: nums, excludeName: jsonName || undefined }),
    })
      .then(r => r.json())
      .then(d => {
        const dups: Array<{ ddt: string; file: string }> = d.duplicates || [];
        if (dups.length) {
          const byFile = new Map<string, string[]>();
          dups.forEach(({ ddt, file }) => byFile.set(file, [...(byFile.get(file) || []), ddt]));
          setPreviewWarnings(prev => [
            ...prev,
            ...[...byFile.entries()].map(([file, ddts]) => ({
              level: 'error' as const,
              text: `DDT già estratti in "${file}": ${ddts.join(', ')} — possibile doppia contabilizzazione`,
            })),
          ]);
        } else {
          setPreviewWarnings(prev => [...prev, { level: 'ok' as const, text: 'Nessun DDT duplicato negli export archiviati' }]);
        }
      })
      .catch(() => {});
  }, []);

  const handleClaudeToExcel = useCallback((text: string) => {
    if (!text.trim()) {
      notify('Incolla prima la risposta di Claude', 'error');
      return;
    }
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      if (!parsed.sheets || !Array.isArray(parsed.sheets)) throw new Error('Campo "sheets" mancante');
      setClaudeResponse(text);
      openPreviewWithChecks(parsed);
    } catch (e: any) {
      notify('JSON non valido: ' + e.message, 'error');
    }
  }, [openPreviewWithChecks]);

  // Riapre un export archiviato in anteprima (tab Archivio)
  const handleReopenExport = useCallback((parsed: any, name: string) => {
    setClaudeResponse(JSON.stringify(parsed));
    setPdfFileName(name);
    openPreviewWithChecks(parsed);
  }, [openPreviewWithChecks]);

  const handleConfirmDownload = useCallback(async () => {
    setClaudeLoading(true);
    try {
      const res = await fetch('/claude-to-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response: claudeResponse, pdfFileName })
      });
      if (!res.ok) {
        const errData = await fetchJSON(res);
        throw new Error(errData.error || `Errore ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Nome export: 1° il "fileName" che Claude riporta nel JSON (nome del PDF allegato),
      // 2° il nome del PDF caricato via drag-drop, 3° fallback generico.
      let jsonFileName = '';
      try {
        const p = JSON.parse(claudeResponse.replace(/```json|```/g, '').trim());
        if (typeof p.fileName === 'string' && p.fileName.trim() && !/[\[\]]/.test(p.fileName)) {
          jsonFileName = p.fileName.trim();
        }
      } catch {}
      const baseName = jsonFileName || pdfFileName;
      let excelName = baseName ? baseName.replace(/\.[^.]+$/, '.xlsx') : 'claude_export.xlsx';
      if (!/\.xlsx$/i.test(excelName)) excelName += '.xlsx';
      a.download = excelName;
      a.click();
      URL.revokeObjectURL(url);
      saveToHistory('ddt', excelName, { claudeJson: claudeResponse });

      // Log validation automatically on download (don't require user to click modal button)
      try {
        await fetch('/log-excel-validation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            fileName: excelName,
            validated: false
          })
        });
      } catch (err) {
        console.error('Errore logging convalida:', err);
      }

      // Mostra banner di convalida dopo il download
      setShowExcelValidation(true);
      notify('File Excel salvato · Convalidare l\'estrazione dati', 'info');
    } catch (err: any) {
      notify('Errore: ' + err.message, 'error');
    } finally {
      setClaudeLoading(false);
    }
  }, [claudeResponse, pdfFileName]);

  // Mette l'estrazione in anteprima nel paniere invece di scaricarla subito:
  // serve quando i dati di più PDF devono finire in un unico Excel.
  const handleAddPreviewToPaniere = useCallback(async () => {
    try {
      const parsed = JSON.parse(claudeResponse.replace(/```json|```/g, '').trim());
      const label = (typeof parsed.fileName === 'string' && parsed.fileName.trim())
        ? parsed.fileName.trim()
        : (pdfFileName || 'estrazione manuale');
      const count = await aggiungiAlPaniere({ label, source: 'chat', data: parsed });
      setPreviewData(null);
      setPreviewWarnings([]);
      notify(`Messo nel paniere (${count} in tutto) · uniscili dalla scheda Importa`, 'success');
    } catch (e: any) {
      notify('Errore: ' + e.message, 'error');
    }
  }, [claudeResponse, pdfFileName]);

  // ── Import da Excel ────────────────────────────────────────
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "array" });
        let outputSheet = null, quadroSheet = null;
        for (const name of wb.SheetNames) {
          const lower = name.toLowerCase();
          // Cerca "Output C.D." con varie variazioni (c.d, cd, etc)
          if ((lower.includes("output") && (lower.includes("c.d") || lower.includes("cd"))) || lower.includes("c.d")) outputSheet = wb.Sheets[name];
          if (lower.includes("quadro") && lower.includes("riepilog")) quadroSheet = wb.Sheets[name];
        }
        if (!outputSheet) {
          const sheetList = wb.SheetNames.join(", ") || "nessuno";
          notify(`Foglio 'Output C.D.' non trovato!\nFogli disponibili: ${sheetList}`, "error");
          return;
        }
        const parsed = parseOutputCD(outputSheet);
        if (quadroSheet) parseQuadroRiepilogo(quadroSheet, parsed.wbsItems);
        setProject({ ...EMPTY_PROJECT, name: file.name.replace(/\.xlsx?$/i, ""), ...parsed });
        setActiveTab("wbs");
        notify(`Importati ${parsed.wbsItems.length} WBS e ${parsed.articles.length} articoli`);
      } catch (err) { notify("Errore: " + err.message, "error"); }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // ── File History (48h TTL) ─────────────────────────────────
  const saveToHistory = (type: string, name: string, data: any) => {
    const entry = { id: crypto.randomUUID(), type, name, createdAt: new Date().toISOString(), data };
    setFileHistory(prev => {
      const now = Date.now();
      const fresh = prev.filter(e => now - new Date(e.createdAt).getTime() < TTL_48H);
      const next = [entry, ...fresh].slice(0, 30);
      try { localStorage.setItem('cosedil-file-history', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const redownload = async (entry: any) => {
    try {
      if (entry.type === 'ddt') {
        const res = await fetch('/claude-to-excel', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ response: entry.data.claudeJson, pdfFileName: entry.name })
        });
        if (!res.ok) throw new Error('Errore server');
        const blob = await res.blob();
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = entry.name; a.click();
      } else if (entry.type === 'wbs-excel') {
        const wb = XLSX.utils.book_new();
        const rows = [["WBS","Codice","Descrizione","UM","Q.Budget","P.U.","Ricavi","C.D.","MDC1%"]];
        (entry.data.articles || []).forEach((a: any) => rows.push([a.wbsCode,a.code,a.description,a.um,a.budgetQuantity,a.unitPrice,a.revenueAmount,a.cdAmount,(a.mdc1Pct*100).toFixed(2)]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "WBS");
        XLSX.writeFile(wb, entry.name);
      } else if (entry.type === 'wbs-csv') {
        const rows = [["WBS","Codice","Descrizione","UM","Q.Budget","P.U.","Ricavi","C.D.","MDC1%"]];
        (entry.data.articles || []).forEach((a: any) => rows.push([a.wbsCode,a.code,`"${a.description.replace(/"/g,'""')}"`,a.um,a.budgetQuantity,a.unitPrice,a.revenueAmount,a.cdAmount,(a.mdc1Pct*100).toFixed(2)]));
        const csv = '﻿' + rows.map(r => r.join(';')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download = entry.name; a.click();
      } else if (entry.type === 'project-json') {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(entry.data,null,2)],{type:'application/json'})); a.download = entry.name; a.click();
      }
      notify('File scaricato: ' + entry.name, 'success');
    } catch { notify('Errore nel riscaricamento', 'error'); }
  };

  // ── JSON Export / Import ───────────────────────────────────
  const exportProject = () => {
    const name = `${project.name}_backup.json`;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    saveToHistory('project-json', name, project);
    notify("Progetto esportato");
  };

  // ── Esporta Excel (XLSX) ──────────────────────────────────
  const exportToExcel = () => {
    if (!project.articles.length) { notify("Nessun dato da esportare", "error"); return; }
    const wb = XLSX.utils.book_new();
    // Foglio riepilogo WBS
    const wbsRows = [["Codice WBS", "Gruppo", "Descrizione", "Ricavi Budget", "C.D. Budget", "% Avanz."]];
    project.wbsItems.forEach((w) => {
      const prog = getWbsProgress(w.code);
      wbsRows.push([w.code, w.groupNumber, w.description, prog.revenueBudget, prog.costBudget, (prog.pct * 100).toFixed(1) + "%"]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wbsRows), "WBS");

    // Foglio articoli
    const artRows = [["WBS", "Codice", "Descrizione", "U.M.", "Q.tà Bdg", "P.U.", "Ricavi", "C.D.", "MDC1%", "Avanz.%"]];
    project.articles.forEach((a) => {
      const prog = getArticleProgress(a.id);
      artRows.push([a.wbsCode, a.code, a.description, a.um, a.budgetQuantity, a.unitPrice, a.revenueAmount, a.cdAmount, (a.mdc1Pct * 100).toFixed(2) + "%", (prog.totalPct * 100).toFixed(1) + "%"]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(artRows), "Articoli");

    // Foglio SAL
    if (project.salPeriods.length) {
      const salRows = [["SAL", "Articolo", "WBS", "Tipo", "Valore", "% Totale"]];
      project.progressEntries.forEach((e) => {
        const a = project.articles.find((x) => x.id === e.articleId);
        const sal = project.salPeriods.find((s) => s.id === e.salId);
        if (a && sal) {
          const prog = getArticleProgress(a.id);
          salRows.push([sal.name, a.code, a.wbsCode, e.type, e.value, (prog.totalPct * 100).toFixed(1) + "%"]);
        }
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salRows), "Avanzamenti SAL");
    }

    const name = `${project.name}_export.xlsx`;
    XLSX.writeFile(wb, name);
    saveToHistory('wbs-excel', name, { articles: project.articles, wbsItems: project.wbsItems, wbsGroups: project.wbsGroups, name: project.name });
    notify("Excel esportato!");
  };

  // ── Esporta CSV ────────────────────────────────────────────
  const exportToCsv = () => {
    if (!project.articles.length) { notify("Nessun dato da esportare", "error"); return; }
    const rows = [["WBS", "Codice", "Descrizione", "UM", "Q.Budget", "Prezzo Unit.", "Ricavi", "C.D.", "MDC1%", "Avanz.%"]];
    project.articles.forEach((a) => {
      const prog = getArticleProgress(a.id);
      rows.push([a.wbsCode, a.code, `"${a.description.replace(/"/g, '""')}"`, a.um, a.budgetQuantity, a.unitPrice, a.revenueAmount, a.cdAmount, (a.mdc1Pct * 100).toFixed(2), (prog.totalPct * 100).toFixed(1)]);
    });
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const csvName = `${project.name}_articoli.csv`;
    a.download = csvName;
    a.click();
    saveToHistory('wbs-csv', csvName, { articles: project.articles, wbsItems: project.wbsItems, name: project.name });
    notify("CSV esportato!");
  };

  const importProject = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const raw = JSON.parse(evt.target.result);
        const converted = convertJsonToProject(raw, file.name.replace(/\.json$/i, ""));
        setProject(converted);
        setActiveTab("wbs");
        notify(`Caricati ${converted.wbsItems.length} fogli · ${converted.articles.length} articoli`);
      } catch { notify("JSON non valido", "error"); }
    };
    reader.readAsText(file);
  };

  // ── SAL ────────────────────────────────────────────────────
  const createSal = (month, year) => {
    const id = `SAL-${year}-${String(month).padStart(2, "0")}`;
    if (project.salPeriods.find((s) => s.id === id)) { notify("SAL esistente", "error"); return; }
    const ns = { id, month, year, status: "open", name: `SAL ${MONTHS[month - 1]} ${year}` };
    setProject((p) => ({ ...p, salPeriods: [...p.salPeriods, ns].sort((a, b) => a.id.localeCompare(b.id)) }));
    setActiveSal(id);
    notify(`${ns.name} creato`);
  };
  const closeSal = (id) => { setProject((p) => ({ ...p, salPeriods: p.salPeriods.map((s) => (s.id === id ? { ...s, status: "closed" } : s)) })); notify("SAL chiuso"); };
  const reopenSal = (id) => { setProject((p) => ({ ...p, salPeriods: p.salPeriods.map((s) => (s.id === id ? { ...s, status: "open" } : s)) })); notify("SAL riaperto"); };

  // ── Progress ───────────────────────────────────────────────
  const updateProgress = (articleId, salId, value, type) => {
    setProject((p) => {
      const idx = p.progressEntries.findIndex((e) => e.articleId === articleId && e.salId === salId);
      const entry = { articleId, salId, value: parseFloat(value) || 0, type };
      const entries = [...p.progressEntries];
      if (idx >= 0) entries[idx] = entry; else entries.push(entry);
      return { ...p, progressEntries: entries };
    });
  };
  const setArticleProgressType = (articleId, type) => {
    setProject((p) => ({ ...p, articles: p.articles.map((a) => (a.id === articleId ? { ...a, progressType: type } : a)) }));
  };

  // ── Computed ───────────────────────────────────────────────
  const getArticleProgress = useCallback((articleId) => {
    const a = project.articles.find((x) => x.id === articleId);
    if (!a) return { totalQty: 0, totalPct: 0, totalRevenue: 0, totalCost: 0 };
    const entries = project.progressEntries.filter((e) => e.articleId === articleId);
    if (a.progressType === "percentage") {
      const last = [...entries].sort((x, y) => y.salId.localeCompare(x.salId))[0];
      const pct = last ? Math.min(last.value / 100, 1) : 0;
      return { totalQty: a.budgetQuantity * pct, totalPct: pct, totalRevenue: a.revenueAmount * pct, totalCost: a.cdAmount * pct };
    }
    const totalQty = entries.reduce((s, e) => s + e.value, 0);
    const pct = a.budgetQuantity > 0 ? totalQty / a.budgetQuantity : 0;
    return { totalQty, totalPct: Math.min(pct, 1), totalRevenue: totalQty * a.unitPrice, totalCost: totalQty * a.cdUnit };
  }, [project.articles, project.progressEntries]);

  const getWbsProgress = useCallback((code) => {
    const arts = project.articles.filter((a) => a.wbsCode === code);
    const revBdg = arts.reduce((s, a) => s + a.revenueAmount, 0);
    const costBdg = arts.reduce((s, a) => s + a.cdAmount, 0);
    let revAct = 0, costAct = 0;
    arts.forEach((a) => { const p = getArticleProgress(a.id); revAct += p.totalRevenue; costAct += p.totalCost; });
    return { pct: revBdg > 0 ? Math.min(revAct / revBdg, 1) : 0, revenueActual: revAct, costActual: costAct, revenueBudget: revBdg, costBudget: costBdg };
  }, [project.articles, getArticleProgress]);

  const totals = useMemo(() => {
    const rB = project.articles.reduce((s, a) => s + a.revenueAmount, 0);
    const cB = project.articles.reduce((s, a) => s + a.cdAmount, 0);
    let rA = 0, cA = 0;
    project.articles.forEach((a) => { const p = getArticleProgress(a.id); rA += p.totalRevenue; cA += p.totalCost; });
    return { rB, cB, rA, cA, mdc1B: rB - cB, mdc1A: rA - cA, pct: rB > 0 ? rA / rB : 0 };
  }, [project.articles, getArticleProgress]);

  // ============================ TAB COMPONENTS ============================

  // Click su un bottone prompt: copia il prompt e apre Claude.ai, senza selezione file.
  // Il nome dell'export arriva dal campo "fileName" che Claude include nel JSON di risposta
  // (il browser non può trasferire il PDF negli allegati di Claude.ai: va allegato lì).
  const handleSelectAndOpen = async (promptText) => {
    const newLog = [...claudeOpenLog, { openedAt: new Date().toISOString() }];
    setClaudeOpenLog(newLog);
    try { localStorage.setItem('cosedil-claude-log', JSON.stringify(newLog)); } catch {}
    // Memorizza l'ultimo prompt per il flusso batch "Prossimo PDF"
    try { localStorage.setItem('cosedil-last-prompt', promptText); } catch {}
    setHasLastPrompt(true);
    try {
      await navigator.clipboard.writeText(promptText);
      notify("📋 Prompt copiato! In Claude.ai allega il PDF e incolla il prompt (Ctrl+V).", "success");
    } catch {
      notify("⚠️ Copia il prompt manualmente.", "info");
    }
    window.open("https://claude.ai/new", "claude-chat", "width=1000,height=800,left=100,top=80,resizable=yes,scrollbars=yes");
  };

  // Batch iterativo: riapre una nuova chat Claude con l'ultimo prompt usato.
  // Un PDF per chat mantiene la qualità di estrazione costante su molti file.
  const handleNextPdf = useCallback(() => {
    let prompt = '';
    try { prompt = localStorage.getItem('cosedil-last-prompt') || ''; } catch {}
    if (!prompt) {
      notify('Nessun prompt recente: usa prima uno dei bottoni documento', 'error');
      return;
    }
    handleSelectAndOpen(prompt);
  }, [claudeOpenLog]);

  const handlePdfFileSelected = async (e) => {
    const files = Array.from(e.target.files || []) as File[];
    e.target.value = "";
    if (!files.length) return;

    const promptText = pendingPromptRef.current;
    pendingPromptRef.current = null;
    setPdfUploading(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("files", f));
      const res = await fetch("/prepare-claude", { method: "POST", credentials: 'include', body: fd });
      const data = await res.json();
      if (!res.ok) {
        notify("❌ " + (data.error || "Errore upload PDF"), "error");
        return;
      }
      // Salva il nome del PDF per usarlo come nome export.
      // Più file: nomi combinati con " + " (troncati per restare sotto il limite filename Windows).
      if (files.length > 0) {
        const exportName = files.length === 1
          ? files[0].name
          : files.map(f => f.name.replace(/\.pdf$/i, '')).join(' + ').slice(0, 150) + '.pdf';
        setPdfFileName(exportName);
        try { localStorage.setItem('cosedil-last-pdf-name', exportName); } catch {}
      }
      // Handle both single (backward compat) and multiple response
      if (data.results) {
        const invalid = data.results.filter((r: any) => r.error);
        if (invalid.length) notify(`⚠️ ${invalid.length} file non validi`, 'error');
      }
      try {
        if (promptText) await navigator.clipboard.writeText(promptText);
        notify(`📋 ${files.length > 1 ? files.length + ' PDF caricati' : 'PDF caricato'}! Prompt copiato — allega il PDF a Claude.ai.`, "success");
      } catch {
        notify("⚠️ Copia il prompt manualmente.", "info");
      }
      // Registra l'apertura di Claude nel log (spostato qui: la finestra apre solo dopo upload riuscito)
      const newLog = [...claudeOpenLog, { openedAt: new Date().toISOString() }];
      setClaudeOpenLog(newLog);
      try { localStorage.setItem('cosedil-claude-log', JSON.stringify(newLog)); } catch {}
      window.open("https://claude.ai/new", "claude-chat", "width=1000,height=800,left=100,top=80,resizable=yes,scrollbars=yes");
    } catch (err: any) {
      notify("❌ Errore: " + err.message, "error");
    } finally {
      setPdfUploading(false);
    }
  };

  // La scheda Importa è spezzata in due (ImportTab + ImportTabRest) perché il
  // paniere va in mezzo, subito sotto la conversione singola. Non poteva essere
  // annidato: queste due sono ridefinite a ogni render di App, quindi React ne
  // rimonta il sottoalbero e il JSON incollato nel paniere andrebbe perso.
  const ImportTab = () => {
    const [dragOverPdf, setDragOverPdf] = React.useState(false);

    const handlePdfDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverPdf(false);
      const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
      if (!files.length) { notify('Solo file PDF consentiti', 'error'); return; }
      if (!prompts.length) { notify('Prompt non ancora caricati dal server: riprova tra un attimo', 'error'); return; }
      pendingPromptRef.current = prompts[0].text;
      await handlePdfFileSelected({ target: { files, value: '' } } as any);
    };

    return (
    <div>
      {/* Input PDF nascosto — condiviso da tutti i bottoni prompt */}
      <input
        ref={pdfFileInputRef}
        type="file"
        accept=".pdf"
        multiple
        style={{ display: "none" }}
        onChange={handlePdfFileSelected}
      />

      {/* Scegli prompt e apri Claude */}
      <div style={{ ...S.card, borderLeft: "4px solid #0c4577" }}>
        <div style={S.cardTitle}>🤖 Analisi PDF con Claude</div>
        <p style={{ fontSize: 14, color: "#434549", marginBottom: 20, lineHeight: 1.6 }}>
          Scegli il tipo di documento: il prompt viene copiato e Claude.ai si apre. Lì allega il PDF e incolla il prompt — l'export prenderà automaticamente il nome del PDF allegato.
        </p>

        {/* Bottoni preset (uno per prompt del server) */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          {prompts.length === 0 && (
            <span style={{ fontSize: 13, color: "#8a8d92" }}>Carico i prompt dal server…</span>
          )}
          {prompts.map(p => (
            <button
              key={p.id}
              onClick={() => handleSelectAndOpen(p.text)}
              disabled={pdfUploading}
              title={p.description}
              style={{
                ...S.btn("primary"),
                fontSize: 14, padding: "12px 22px",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                minWidth: 160,
                opacity: pdfUploading ? 0.6 : 1
              }}
            >
              <span style={{ fontSize: 18 }}>{p.custom ? "🧩" : p.label.split(" ")[0]}</span>
              <span>{pdfUploading ? "⏳ Caricamento…" : p.custom ? p.label : p.label.split(" ").slice(1).join(" ")}</span>
            </button>
          ))}
          <button
            onClick={() => setCostruttorePrompt(true)}
            title="Traduci i tuoi parametri (colonne, indizi, controlli) in un prompt di scansione, da copiare o da salvare fra i tipi documento"
            style={{
              ...S.btn("secondary"),
              fontSize: 14, padding: "12px 22px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              minWidth: 160,
              borderStyle: "dashed"
            }}
          >
            <span style={{ fontSize: 18 }}>🧩</span>
            <span>Costruisci prompt</span>
          </button>
        </div>

        {/* Log aperture Claude */}
        {claudeOpenLog.length > 0 && (
          <div style={{ fontSize: 12, color: "#434549", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <span>🕐 Claude aperto <strong>{claudeOpenLog.length}</strong> volt{claudeOpenLog.length === 1 ? "a" : "e"}</span>
            <span style={{ color: "#8a8d92" }}>·</span>
            <span>ultima: {new Date(claudeOpenLog[claudeOpenLog.length - 1].openedAt).toLocaleString("it-IT")}</span>
          </div>
        )}

        {/* Drag-drop PDF per archiviazione */}
        <div
          style={{ border: `2px dashed ${dragOverPdf ? '#0c4577' : '#e5e7eb'}`, borderRadius: 10, padding: "16px 20px", marginBottom: 20, textAlign: "center", background: dragOverPdf ? '#eef4fa' : "#f9f9fb", transition: 'all 0.15s ease', cursor: 'default' }}
          onDragOver={e => { e.preventDefault(); setDragOverPdf(true); }}
          onDragEnter={e => { e.preventDefault(); setDragOverPdf(true); }}
          onDragLeave={() => setDragOverPdf(false)}
          onDrop={handlePdfDrop}
        >
          <span style={{ fontSize: 13, color: dragOverPdf ? '#0c4577' : '#8a8d92' }}>
            {dragOverPdf ? '⬇️ Rilascia i PDF qui' : '📎 Trascina uno o più PDF qui per caricarli (usa DDT come prompt predefinito)'}
          </span>
        </div>

        {/* Istruzioni */}
        <div style={{ background: "#f2f3f5", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 20, fontSize: 13, color: "#0c4577" }}>
          <strong>Come fare:</strong>
          <ol style={{ margin: "8px 0 0 18px", lineHeight: 2 }}>
            <li>Clicca il tipo di documento → il prompt viene copiato e Claude.ai si apre automaticamente</li>
            <li>In Claude.ai: allega il PDF e incolla il prompt (<kbd>Ctrl+V</kbd>)</li>
            <li>Aspetta la risposta JSON di Claude</li>
            <li>Copia la risposta e incollala nel campo qui sotto</li>
            <li>Clicca <strong>Anteprima &amp; Scarica Excel</strong> → verifica i dati e scarica</li>
          </ol>
        </div>

        {/* Area incolla risposta — componente memoizzato: digitare non ri-renderizza l'app */}
        <ClaudeJsonBox
          busy={claudeLoading}
          onPreview={handleClaudeToExcel}
          onNextPdf={handleNextPdf}
          hasLastPrompt={hasLastPrompt}
        />

        {/* Banner archivia PDF — appare quando ci sono PDF in attesa */}
      </div>
    </div>
    );
  };

  // Seconda metà della scheda Importa: quello che sta sotto al paniere.
  const ImportTabRest = () => {
    const [dragOverExcel, setDragOverExcel] = React.useState(false);

    const handleExcelDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverExcel(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      handleFileUpload({ target: { files: [file] } } as any);
    };

    return (
    <div>
      {/* Excel locale */}
      <div style={S.card}>
        <div style={S.cardTitle}>📊 Importa da Excel (formato Output C.D.)</div>
        <p style={{ fontSize: 14, color: "#434549", marginBottom: 16, lineHeight: 1.6 }}>
          Carica il file Excel contenente i fogli "Output C.D." e "Quadro di riepilogo".
        </p>
        <div
          style={{ border: `2px dashed ${dragOverExcel ? '#0c4577' : '#e5e7eb'}`, borderRadius: 12, padding: 32, textAlign: "center", background: dragOverExcel ? '#eef4fa' : "#f9f9fb", transition: 'all 0.15s ease' }}
          onDragOver={e => { e.preventDefault(); setDragOverExcel(true); }}
          onDragEnter={e => { e.preventDefault(); setDragOverExcel(true); }}
          onDragLeave={() => setDragOverExcel(false)}
          onDrop={handleExcelDrop}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>{dragOverExcel ? '⬇️' : '📂'}</div>
          <div style={{ fontSize: 13, color: "#8a8d92", marginBottom: 12 }}>Trascina qui il file Excel oppure</div>
          <label style={{ ...S.btn("secondary"), display: "inline-block", cursor: "pointer" }}>
            Scegli file Excel (.xlsx)
            <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ ...S.card, flex: 1, minWidth: 280 }}>
          <div style={S.cardTitle}>Carica Backup</div>
          <p style={{ fontSize: 14, color: "#434549", marginBottom: 16 }}>Riprendi da un file JSON esportato in precedenza.</p>
          <label style={{ ...S.btn("secondary"), display: "inline-block", cursor: "pointer" }}>
            Carica .json
            <input type="file" accept=".json" onChange={importProject} style={{ display: "none" }} />
          </label>
        </div>
        <div style={{ ...S.card, flex: 1, minWidth: 280 }}>
          <div style={S.cardTitle}>💾 Salva / Esporta</div>
          <p style={{ fontSize: 14, color: "#434549", marginBottom: 14 }}>
            {project.articles.length > 0 ? "Salva o esporta i dati nel formato che preferisci." : "Importa dati per abilitare l'esportazione."}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button style={{ ...S.btn("success"), textAlign: "left", opacity: project.articles.length > 0 ? 1 : 0.45, cursor: project.articles.length > 0 ? "pointer" : "not-allowed" }} onClick={exportToExcel} disabled={project.articles.length === 0}>
              📊 Esporta Excel (.xlsx)
            </button>
            <button style={{ ...S.btn("secondary"), textAlign: "left", opacity: project.articles.length > 0 ? 1 : 0.45, cursor: project.articles.length > 0 ? "pointer" : "not-allowed" }} onClick={exportToCsv} disabled={project.articles.length === 0}>
              📄 Esporta CSV
            </button>
            <button style={{ ...S.btn("secondary"), textAlign: "left", opacity: project.articles.length > 0 ? 1 : 0.45, cursor: project.articles.length > 0 ? "pointer" : "not-allowed" }} onClick={exportProject} disabled={project.articles.length === 0}>
              🗂️ Backup JSON
            </button>
          </div>
        </div>
      </div>
    </div>
    );
  };

  const ArchivioSection = () => {
    const [openFolder, setOpenFolder] = React.useState<string|null>(null);
    const now = Date.now();
    const fresh = fileHistory.filter(e => now - new Date(e.createdAt).getTime() < TTL_48H);
    const folders = [
      { id: 'ddt',          label: '📊 DDT / Documenti Claude',  icon: '📊', types: ['ddt'] },
      { id: 'wbs-export',   label: '📋 Export WBS',              icon: '📋', types: ['wbs-excel','wbs-csv'] },
      { id: 'backup',       label: '💾 Backup Progetto',         icon: '💾', types: ['project-json'] },
    ];
    const fmtDate = (iso: string) => new Date(iso).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const expiry = (iso: string) => {
      const ms = TTL_48H - (now - new Date(iso).getTime());
      const h = Math.floor(ms / 3600000);
      return h > 0 ? `${h}h` : `<1h`;
    };
    if (fresh.length === 0) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#434549', marginBottom: 8, display:'flex', alignItems:'center', gap:6 }}>
          📁 Archivio file recenti <span style={{ fontWeight:400, color:'#8a8d92', fontSize:12 }}>(48h)</span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {folders.map(folder => {
            const items = fresh.filter(e => folder.types.includes(e.type));
            if (!items.length) return null;
            const isOpen = openFolder === folder.id;
            return (
              <div key={folder.id} style={{ border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden' }}>
                <div
                  onClick={() => setOpenFolder(isOpen ? null : folder.id)}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', background:'#f2f3f5', cursor:'pointer', userSelect:'none' }}
                >
                  <span style={{ fontWeight:600, fontSize:13 }}>{folder.label}</span>
                  <span style={{ marginLeft:'auto', background:'#0c4577', color:'white', borderRadius:10, padding:'1px 8px', fontSize:11 }}>{items.length}</span>
                  <span style={{ fontSize:12, color:'#8a8d92' }}>{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div style={{ padding:'6px 8px', display:'flex', flexDirection:'column', gap:4 }}>
                    {items.map(entry => (
                      <div key={entry.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', background:'white', borderRadius:6, border:'1px solid #f0f0ee' }}>
                        <span style={{ fontSize:12, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{entry.name}</span>
                        <span style={{ fontSize:11, color:'#8a8d92', whiteSpace:'nowrap' }}>{fmtDate(entry.createdAt)}</span>
                        <span style={{ fontSize:11, color:'#d97706', whiteSpace:'nowrap' }}>⏱ {expiry(entry.createdAt)}</span>
                        <button
                          onClick={() => redownload(entry)}
                          style={{ ...S.btn('primary'), fontSize:11, padding:'3px 10px', whiteSpace:'nowrap' }}
                        >⬇ Scarica</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const WbsTab = () => {
    const filtered = searchTerm
      ? project.articles.filter((a) =>
          a.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
          a.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
          a.wbsCode.includes(searchTerm)
        )
      : null;

    return (
      <div>
        <ArchivioSection />
        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <input
            style={{ ...S.input, maxWidth: 300 }}
            placeholder="Cerca articolo, WBS..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <span style={{ fontSize: 13, color: "#434549" }}>
            {project.wbsItems.length} WBS · {project.articles.length} articoli · Budget: {fmt(totals.rB)}
          </span>
        </div>

        {filtered ? (
          <div style={S.card}>
            <div style={S.cardTitle}>Risultati: {filtered.length} articoli</div>
            <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead> <tr>
                  <th style={S.th}>WBS</th> <th style={S.th}>Articolo</th> <th style={S.th}>Descrizione</th> <th style={S.th}>U.M.</th>
                  <th style={S.thR}>Q.tà</th> <th style={S.thR}>P.U.</th> <th style={S.thR}>Ricavi</th> <th style={S.thR}>C.D.</th> <th style={S.thR}>MDC1</th>
                </tr> </thead>
                <tbody>{filtered.map((a) => (
                  <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => { setSelectedWbs(a.wbsCode); setSearchTerm(""); }}>
                    <td style={S.td}>{a.wbsCode}</td>
                    <td style={{ ...S.td, fontWeight: 500 }}>{a.code}</td>
                    <td style={{ ...S.td, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.description}</td>
                    <td style={S.td}>{a.um}</td>
                    <td style={S.tdR}>{fmt(a.budgetQuantity)}</td>
                    <td style={S.tdR}>{fmt(a.unitPrice)}</td>
                    <td style={S.tdR}>{fmt(a.revenueAmount)}</td>
                    <td style={S.tdR}>{fmt(a.cdAmount)}</td>
                    <td style={{ ...S.tdR, color: a.mdc1Pct >= 0 ? "#3f8f55" : "#c0392b" }}>{fmtPct(a.mdc1Pct)}</td>
                  </tr>
                ))} </tbody>
              </table>
            </div>
          </div>
        ) : (
          project.wbsGroups.map((g) => (
            <div key={g.number} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#212326", padding: "8px 0", borderBottom: "2px solid #0c4577", marginBottom: 8 }}>
                {g.number}. {g.name}
              </div>
              {project.wbsItems.filter((w) => w.groupNumber === g.number).map((wbs) => {
                const prog = getWbsProgress(wbs.code);
                const open = selectedWbs === wbs.code;
                return (
                  <div key={wbs.code} style={{ marginBottom: 4 }}>
                    <div
                      onClick={() => setSelectedWbs(open ? null : wbs.code)}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: open ? "#f2f3f5" : "white", borderRadius: 8, cursor: "pointer", border: open ? "1px solid #e5e7eb" : "1px solid #e5e7eb" }}
                    >
                      <span style={{ fontWeight: 600, color: "#0c4577", minWidth: 60 }}>{wbs.code}</span>
                      <span style={{ flex: 1, fontSize: 13 }}>{wbs.description || "(--)"}</span>
                      <Bar2 pct={prog.pct} />
                      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 40, textAlign: "right" }}>{fmtPct(prog.pct)}</span>
                      <span style={{ fontSize: 12, color: "#434549" }}>{fmtInt(prog.revenueActual)} / {fmtInt(prog.revenueBudget)}</span>
                      <span style={{ fontSize: 16, color: "#8a8d92" }}>{open ? "▲" : "▼"}</span>
                    </div>
                    {open && (
                      <div style={{ margin: "8px 0 8px 16px", overflowX: "auto" }}>
                        <table style={S.table}>
                          <thead> <tr>
                            <th style={S.th}>Articolo</th> <th style={S.th}>Descrizione</th> <th style={S.th}>U.M.</th>
                            <th style={S.thR}>Q.tà Bdg</th> <th style={S.thR}>P.U.</th> <th style={S.thR}>Ricavi</th>
                            <th style={S.thR}>C.D.</th> <th style={S.thR}>MDC1%</th> <th style={S.thR}>Avanz.</th>
                          </tr> </thead>
                          <tbody>
                            {project.articles.filter((a) => a.wbsCode === wbs.code).map((a) => {
                              const ap = getArticleProgress(a.id);
                              return (
                                <tr key={a.id}>
                                  <td style={{ ...S.td, fontWeight: 500, whiteSpace: "nowrap" }}>{a.code}</td>
                                  <td style={{ ...S.td, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.description}>{a.description}</td>
                                  <td style={S.td}>{a.um}</td>
                                  <td style={S.tdR}>{fmt(a.budgetQuantity)}</td>
                                  <td style={S.tdR}>{fmt(a.unitPrice)}</td>
                                  <td style={S.tdR}>{fmt(a.revenueAmount)}</td>
                                  <td style={S.tdR}>{fmt(a.cdAmount)}</td>
                                  <td style={{ ...S.tdR, color: a.mdc1Pct >= 0 ? "#3f8f55" : "#c0392b" }}>{fmtPct(a.mdc1Pct)}</td>
                                  <td style={S.tdR}> <Bar2 pct={ap.totalPct} color="#0c4577" /> <span style={{ fontSize: 12 }}>{fmtPct(ap.totalPct)}</span> </td>
                                </tr>
                              );
                            })}
                            <tr style={{ background: "#f9f9fb", fontWeight: 600 }}>
                              <td colSpan={5} style={S.td}>Totale WBS {wbs.code}</td>
                              <td style={S.tdR}>{fmt(project.articles.filter((a) => a.wbsCode === wbs.code).reduce((s, a) => s + a.revenueAmount, 0))}</td>
                              <td style={S.tdR}>{fmt(project.articles.filter((a) => a.wbsCode === wbs.code).reduce((s, a) => s + a.cdAmount, 0))}</td>
                              <td colSpan={2} style={S.td}> </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    );
  };

  const SalTab = () => {
    const [newMonth, setNewMonth] = useState(new Date().getMonth() + 1);
    const [newYear, setNewYear] = useState(new Date().getFullYear());
    const sal = project.salPeriods.find((s) => s.id === activeSal);
    const isOpen = sal?.status === "open";

    return (
      <div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
          {/* Crea nuovo SAL */}
          <div style={{ ...S.card, flex: "0 0 320px" }}>
            <div style={S.cardTitle}>Nuovo SAL</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select style={S.select} value={newMonth} onChange={(e) => setNewMonth(+e.target.value)}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <input type="number" style={{ ...S.input, width: 80 }} value={newYear} onChange={(e) => setNewYear(+e.target.value)} />
              <button style={S.btn("primary")} onClick={() => createSal(newMonth, newYear)}>Crea</button>
            </div>
          </div>

          {/* Lista periodi */}
          <div style={{ ...S.card, flex: 1, minWidth: 300 }}>
            <div style={S.cardTitle}>Periodi SAL</div>
            {!project.salPeriods.length
              ? <p style={{ color: "#8a8d92", fontSize: 14 }}>Nessun SAL. Crea il primo.</p>
              : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {project.salPeriods.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setActiveSal(s.id)}
                      style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: activeSal === s.id ? 600 : 400, background: activeSal === s.id ? "#0c4577" : s.status === "closed" ? "#f2f3f5" : "white", color: activeSal === s.id ? "#212326" : "#434549", border: `1px solid ${activeSal === s.id ? "#0c4577" : "#e5e7eb"}` }}
                    >
                      {s.name} {s.status === "closed" ? " 🔒" : " 📝"}
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>

        {sal && (
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={S.cardTitle}>{sal.name}</div>
                <span style={S.badge(isOpen ? "green" : "blue")}>{isOpen ? "APERTO" : "CHIUSO"}</span>
              </div>
              {isOpen
                ? <button style={S.btn("danger")} onClick={() => closeSal(sal.id)}>Chiudi SAL</button>
                : <button style={S.btn("secondary")} onClick={() => reopenSal(sal.id)}>Riapri</button>}
            </div>

            <select
              style={{ ...S.select, width: "100%", maxWidth: 500, marginBottom: 16 }}
              value={progressWbs || ""}
              onChange={(e) => setProgressWbs(e.target.value || null)}
            >
              <option value="">-- Seleziona WBS --</option>
              {project.wbsItems.map((w) => <option key={w.code} value={w.code}>{w.code} - {w.description}</option>)}
            </select>

            {progressWbs && (
              <div style={{ overflowX: "auto" }}>
                <table style={S.table}>
                  <thead> <tr>
                    <th style={S.th}>Articolo</th> <th style={S.th}>Descrizione</th> <th style={S.th}>U.M.</th>
                    <th style={S.thR}>Q.tà Bdg</th> <th style={S.thR}>Prec.</th> <th style={S.th}>Tipo</th>
                    <th style={S.th}>Avanz. Periodo</th> <th style={S.thR}>Totale</th> <th style={S.thR}>%</th>
                  </tr> </thead>
                  <tbody>
                    {project.articles.filter((a) => a.wbsCode === progressWbs).map((a) => {
                      const entry = project.progressEntries.find((e) => e.articleId === a.id && e.salId === sal.id);
                      const prev = project.progressEntries.filter((e) => e.articleId === a.id && e.salId !== sal.id).reduce((s, e) => s + e.value, 0);
                      const prog = getArticleProgress(a.id);
                      return (
                        <tr key={a.id}>
                          <td style={{ ...S.td, fontWeight: 500, whiteSpace: "nowrap" }}>{a.code}</td>
                          <td style={{ ...S.td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.description}>{a.description}</td>
                          <td style={S.td}>{a.um}</td>
                          <td style={S.tdR}>{fmt(a.budgetQuantity)}</td>
                          <td style={S.tdR}>{a.progressType === "quantity" ? fmt(prev) : "-"}</td>
                          <td style={S.td}>
                            <select
                              style={{ ...S.select, fontSize: 12, padding: "4px 8px" }}
                              value={a.progressType}
                              onChange={(e) => setArticleProgressType(a.id, e.target.value)}
                              disabled={!isOpen}
                            >
                              <option value="quantity">Quantità</option>
                              <option value="percentage">% Manuale</option>
                            </select>
                          </td>
                          <td style={S.td}>
                            <input
                              type="number" step="any"
                              style={{ ...S.input, width: 100, textAlign: "right" }}
                              value={entry?.value ?? ""}
                              placeholder={a.progressType === "percentage" ? "0-100" : "0"}
                              onChange={(e) => updateProgress(a.id, sal.id, e.target.value, a.progressType)}
                              disabled={!isOpen}
                            />
                          </td>
                          <td style={S.tdR}>{fmt(prog.totalQty)}</td>
                          <td style={S.tdR}>{fmtPct(prog.totalPct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================ KPI DASHBOARD ============================
  const KpiTab = () => {
    if (!project.articles.length) {
      return (
        <div style={{ ...S.card, textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 18, color: "#434549" }}>Nessun dato. Importa prima un progetto per visualizzare i KPI.</div>
        </div>
      );
    }

    // Semaforo avanzamento: verde ≥70%, ambra ≥35%, rosso sotto (desaturati, palette Cosedil)
    const semColor = (pct) => pct >= 0.7 ? "#3f8f55" : pct >= 0.35 ? "#d97706" : "#c0392b";

    const wbsData = project.wbsItems.map(w => ({ ...w, prog: getWbsProgress(w.code) }));

    // SAL timeline: per ogni periodo calcola ricavi del periodo e cumulativo
    const salTimeline = (() => {
      const sorted = [...project.salPeriods].sort((a, b) => a.id.localeCompare(b.id));
      let cumRev = 0;
      return sorted.map(sal => {
        const periodEntries = project.progressEntries.filter(e => e.salId === sal.id);
        let periodRev = 0;
        periodEntries.forEach(e => {
          const a = project.articles.find(x => x.id === e.articleId);
          if (!a) return;
          if (a.progressType === "quantity") {
            periodRev += e.value * (a.unitPrice || 0);
          } else {
            const prevEntry = project.progressEntries
              .filter(pe => pe.articleId === a.id && pe.salId < sal.id)
              .sort((x, y) => y.salId.localeCompare(x.salId))[0];
            const prevPct = prevEntry ? Math.min(prevEntry.value / 100, 1) : 0;
            const thisPct = Math.min(e.value / 100, 1);
            periodRev += Math.max(0, thisPct - prevPct) * a.revenueAmount;
          }
        });
        cumRev += periodRev;
        return { sal, periodRev, cumRev };
      });
    })();

    return (
      <div>
        {/* ── KPI CARDS ─────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 16, marginBottom: 24 }}>
          {/* Avanzamento globale */}
          <div style={{ ...S.card, textAlign: "center", borderTop: `4px solid ${semColor(totals.pct)}`, marginBottom: 0, padding: 20 }}>
            <div style={{ fontSize: 38, fontWeight: 800, color: semColor(totals.pct), lineHeight: 1 }}>{(totals.pct * 100).toFixed(1)}%</div>
            <div style={{ fontSize: 12, color: "#434549", margin: "6px 0 10px" }}>Avanzamento Globale</div>
            <Bar2 pct={totals.pct} color={semColor(totals.pct)} />
          </div>
          {/* Ricavi */}
          <div style={{ ...S.card, textAlign: "center", borderTop: "4px solid #0c4577", marginBottom: 0, padding: 20 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#0c4577", lineHeight: 1 }}>{fmtInt(totals.rA)}</div>
            <div style={{ fontSize: 11, color: "#8a8d92", margin: "3px 0" }}>su {fmtInt(totals.rB)} €</div>
            <div style={{ fontSize: 12, color: "#434549", marginBottom: 10 }}>Ricavi Realizzati €</div>
            <Bar2 pct={totals.rB > 0 ? Math.min(totals.rA / totals.rB, 1) : 0} color="#0c4577" />
          </div>
          {/* Costi */}
          <div style={{ ...S.card, textAlign: "center", borderTop: "4px solid #0d9488", marginBottom: 0, padding: 20 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#0d9488", lineHeight: 1 }}>{fmtInt(totals.cA)}</div>
            <div style={{ fontSize: 11, color: "#8a8d92", margin: "3px 0" }}>su {fmtInt(totals.cB)} €</div>
            <div style={{ fontSize: 12, color: "#434549", marginBottom: 10 }}>Costi C.D. €</div>
            <Bar2 pct={totals.cB > 0 ? Math.min(totals.cA / totals.cB, 1) : 0} color="#0d9488" />
          </div>
          {/* MDC1 */}
          <div style={{ ...S.card, textAlign: "center", borderTop: `4px solid ${totals.mdc1A >= 0 ? "#3f8f55" : "#c0392b"}`, marginBottom: 0, padding: 20 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: totals.mdc1A >= 0 ? "#3f8f55" : "#c0392b", lineHeight: 1 }}>{fmtInt(totals.mdc1A)}</div>
            <div style={{ fontSize: 11, color: "#8a8d92", margin: "3px 0" }}>budget {fmtInt(totals.mdc1B)} €</div>
            <div style={{ fontSize: 12, color: "#434549", marginBottom: 6 }}>MDC1 €</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: totals.rA > 0 ? (totals.mdc1A / totals.rA >= 0 ? "#3f8f55" : "#c0392b") : "#8a8d92" }}>
              {totals.rA > 0 ? ((totals.mdc1A / totals.rA) * 100).toFixed(1) + "%" : "—"} MDC1%
            </div>
          </div>
          {/* SAL */}
          <div style={{ ...S.card, textAlign: "center", borderTop: "4px solid #1477b8", marginBottom: 0, padding: 20 }}>
            <div style={{ fontSize: 38, fontWeight: 800, color: "#1477b8", lineHeight: 1 }}>{project.salPeriods.filter(s => s.status === "open").length}</div>
            <div style={{ fontSize: 11, color: "#8a8d92", margin: "3px 0" }}>{project.salPeriods.length} totali · {project.salPeriods.filter(s => s.status === "closed").length} chiusi</div>
            <div style={{ fontSize: 12, color: "#434549" }}>SAL Aperti</div>
          </div>
          {/* WBS */}
          <div style={{ ...S.card, textAlign: "center", borderTop: "4px solid #0c4577", marginBottom: 0, padding: 20 }}>
            <div style={{ fontSize: 38, fontWeight: 800, color: "#0c4577", lineHeight: 1 }}>{project.wbsItems.length}</div>
            <div style={{ fontSize: 11, color: "#8a8d92", margin: "3px 0" }}>{project.articles.length} articoli</div>
            <div style={{ fontSize: 12, color: "#434549" }}>Voci WBS</div>
          </div>
        </div>

        {/* ── AVANZAMENTO PER WBS ─────────────────────────────────── */}
        <div style={S.card}>
          <div style={S.cardTitle}>Avanzamento per WBS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {wbsData.map(w => (
              <div key={w.code} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 88, fontSize: 12, fontWeight: 600, color: "#434549", flexShrink: 0 }}>{w.code}</div>
                <div style={{ flex: 1, background: "#e5e7eb", borderRadius: 2, height: 6, overflow: "hidden", minWidth: 80 }}>
                  <div style={{
                    width: `${Math.min(w.prog.pct * 100, 100)}%`,
                    height: "100%",
                    background: semColor(w.prog.pct),
                    borderRadius: 2,
                    transition: "width 0.5s ease",
                    minWidth: w.prog.pct > 0 ? 4 : 0,
                  }} />
                </div>
                <div style={{ width: 46, fontSize: 13, fontWeight: 700, color: semColor(w.prog.pct), textAlign: "right", flexShrink: 0 }}>
                  {(w.prog.pct * 100).toFixed(0)}%
                </div>
                <div style={{ width: 160, fontSize: 11, color: "#434549", flexShrink: 0, textAlign: "right" }}>
                  {fmtInt(w.prog.revenueActual)} / {fmtInt(w.prog.revenueBudget)} €
                </div>
                <span style={{ ...S.badge(w.prog.pct >= 0.7 ? "green" : w.prog.pct >= 0.35 ? "yellow" : "red"), fontSize: 10, padding: "3px 9px", flexShrink: 0 }}>
                  {w.prog.pct >= 0.7 ? "Avanzato" : w.prog.pct >= 0.35 ? "In corso" : "Attesa"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── GRAFICI ─────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

          {/* Budget vs Realizzato per WBS */}
          <div style={S.card}>
            <div style={S.cardTitle}>Budget vs Realizzato · Ricavi (€)</div>
            {(() => {
              const topN = [...wbsData].sort((a, b) => b.prog.revenueBudget - a.prog.revenueBudget).slice(0, 8);
              const maxVal = Math.max(...topN.map(w => w.prog.revenueBudget), 1);
              const rowH = 46;
              const svgH = topN.length * rowH + 24;
              const barMaxW = 200;
              const labelW = 88;
              return (
                <svg width="100%" height={svgH} viewBox={`0 0 370 ${svgH}`} style={{ overflow: "visible" }}>
                  {topN.map((w, i) => {
                    const y = i * rowH + 4;
                    const bW = (w.prog.revenueBudget / maxVal) * barMaxW;
                    const aW = Math.min((w.prog.revenueActual / maxVal) * barMaxW, bW + barMaxW * 0.05);
                    return (
                      <g key={w.code}>
                        <text x={0} y={y + 13} fontSize={10} fill="#434549" fontWeight={600}>{w.code}</text>
                        <rect x={labelW} y={y} width={Math.max(bW, 2)} height={15} rx={4} fill="#e5e7eb" />
                        <rect x={labelW} y={y + 17} width={Math.max(aW, 2)} height={11} rx={4} fill={semColor(w.prog.pct)} opacity={0.9} />
                        {bW > 30 && <text x={labelW + Math.max(bW, 2) + 4} y={y + 12} fontSize={9} fill="#0c4577">{fmtInt(w.prog.revenueBudget)}</text>}
                        {aW > 30 && <text x={labelW + Math.max(aW, 2) + 4} y={y + 27} fontSize={9} fill={semColor(w.prog.pct)}>{fmtInt(w.prog.revenueActual)}</text>}
                      </g>
                    );
                  })}
                  <g transform={`translate(0, ${svgH - 16})`}>
                    <rect x={0} y={0} width={10} height={8} rx={2} fill="#e5e7eb" />
                    <text x={14} y={7} fontSize={9} fill="#434549">Budget</text>
                    <rect x={56} y={0} width={10} height={8} rx={2} fill="#0c4577" opacity={0.9} />
                    <text x={70} y={7} fontSize={9} fill="#434549">Realizzato</text>
                  </g>
                </svg>
              );
            })()}
          </div>

          {/* SAL timeline */}
          <div style={S.card}>
            <div style={S.cardTitle}>Andamento SAL · Ricavi per Periodo (€)</div>
            {salTimeline.length === 0 ? (
              <p style={{ color: "#8a8d92", fontSize: 14 }}>Nessun SAL creato. Crea un SAL dalla scheda SAL.</p>
            ) : (() => {
              const svgW = 320; const svgH = 190;
              const padL = 8; const padB = 28; const padT = 12; const padR = 8;
              const chartW = svgW - padL - padR;
              const chartH = svgH - padT - padB;
              const n = salTimeline.length;
              const colW = chartW / n;
              const barW = Math.min(36, colW - 6);
              const maxV = Math.max(...salTimeline.map(s => s.periodRev), totals.rB / Math.max(n, 1) * 0.5, 1);
              const toY = (v) => padT + chartH - Math.min((v / maxV) * chartH, chartH);
              return (
                <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`}>
                  {[0, 0.25, 0.5, 0.75, 1].map(f => (
                    <line key={f} x1={padL} x2={svgW - padR} y1={padT + chartH * (1 - f)} y2={padT + chartH * (1 - f)} stroke="#e5e7eb" strokeWidth={1} />
                  ))}
                  {salTimeline.map((s, i) => {
                    const bH = Math.max((s.periodRev / maxV) * chartH, 0);
                    const cx = padL + i * colW + colW / 2;
                    const bx = cx - barW / 2;
                    const by = padT + chartH - bH;
                    return (
                      <g key={s.sal.id}>
                        <rect x={bx} y={by} width={barW} height={bH} rx={4}
                          fill={s.sal.status === "closed" ? "#8a8d92" : "#0c4577"} opacity={0.88} />
                        {bH > 22 && (
                          <text x={cx} y={by + bH / 2 + 4} textAnchor="middle" fontSize={8} fill="white" fontWeight={600}>
                            {fmtInt(s.periodRev)}
                          </text>
                        )}
                        <text x={cx} y={svgH - 6} textAnchor="middle" fontSize={8} fill="#434549">
                          {s.sal.name.replace("SAL ", "").substring(0, 7)}
                        </text>
                      </g>
                    );
                  })}
                  {/* Linea cumulativa */}
                  {salTimeline.length > 1 && (() => {
                    const pts = salTimeline.map((s, i) => `${padL + i * colW + colW / 2},${toY(s.cumRev)}`).join(" ");
                    return (
                      <>
                        <polyline points={pts} fill="none" stroke="#0c4577" strokeWidth={2} strokeDasharray="5,3" />
                        {salTimeline.map((s, i) => (
                          <circle key={i} cx={padL + i * colW + colW / 2} cy={toY(s.cumRev)} r={3} fill="#0c4577" />
                        ))}
                      </>
                    );
                  })()}
                  <g transform={`translate(${padL}, ${svgH - 14})`}>
                    <rect x={0} y={0} width={8} height={8} rx={2} fill="#0c4577" opacity={0.88} />
                    <text x={12} y={7} fontSize={8} fill="#434549">Periodo</text>
                    <line x1={60} x2={72} y1={4} y2={4} stroke="#0c4577" strokeWidth={2} strokeDasharray="5,3" />
                    <text x={76} y={7} fontSize={8} fill="#434549">Cumulativo</text>
                  </g>
                </svg>
              );
            })()}
          </div>
        </div>

        {/* ── TABELLA RIEPILOGO ───────────────────────────────────── */}
        <div style={S.card}>
          <div style={S.cardTitle}>Riepilogo Dettagliato WBS</div>
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>WBS</th>
                  <th style={S.th}>Descrizione</th>
                  <th style={S.thR}>Ricavi Budget €</th>
                  <th style={S.thR}>Ricavi Reali €</th>
                  <th style={S.thR}>C.D. Budget €</th>
                  <th style={S.thR}>C.D. Reali €</th>
                  <th style={S.thR}>MDC1 Reale €</th>
                  <th style={S.thR}>Avanz. %</th>
                  <th style={S.th}>Stato</th>
                </tr>
              </thead>
              <tbody>
                {wbsData.map((w, i) => (
                  <tr key={w.code} style={{ background: i % 2 === 0 ? "white" : "#f9f9fb" }}>
                    <td style={{ ...S.td, fontWeight: 600, color: "#0c4577" }}>{w.code}</td>
                    <td style={{ ...S.td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.description || "(—)"}</td>
                    <td style={S.tdR}>{fmt(w.prog.revenueBudget)}</td>
                    <td style={{ ...S.tdR, fontWeight: 600, color: "#0c4577" }}>{fmt(w.prog.revenueActual)}</td>
                    <td style={S.tdR}>{fmt(w.prog.costBudget)}</td>
                    <td style={{ ...S.tdR, color: "#0d9488" }}>{fmt(w.prog.costActual)}</td>
                    <td style={{ ...S.tdR, fontWeight: 600, color: (w.prog.revenueActual - w.prog.costActual) >= 0 ? "#3f8f55" : "#c0392b" }}>
                      {fmt(w.prog.revenueActual - w.prog.costActual)}
                    </td>
                    <td style={{ ...S.tdR, fontWeight: 700, color: semColor(w.prog.pct) }}>{(w.prog.pct * 100).toFixed(1)}%</td>
                    <td style={S.td}>
                      <span style={{ ...S.badge(w.prog.pct >= 0.7 ? "green" : w.prog.pct >= 0.35 ? "yellow" : "red"), fontSize: 11 }}>
                        {w.prog.pct >= 0.7 ? "Avanzato" : w.prog.pct >= 0.35 ? "In corso" : "Attesa"}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "#f2f3f5", fontWeight: 700, borderTop: "2px solid #e5e7eb" }}>
                  <td colSpan={2} style={{ ...S.td, fontWeight: 800 }}>TOTALE PROGETTO</td>
                  <td style={S.tdR}>{fmt(totals.rB)}</td>
                  <td style={{ ...S.tdR, color: "#0c4577", fontWeight: 800 }}>{fmt(totals.rA)}</td>
                  <td style={S.tdR}>{fmt(totals.cB)}</td>
                  <td style={{ ...S.tdR, color: "#0d9488", fontWeight: 800 }}>{fmt(totals.cA)}</td>
                  <td style={{ ...S.tdR, fontWeight: 800, color: totals.mdc1A >= 0 ? "#3f8f55" : "#c0392b" }}>{fmt(totals.mdc1A)}</td>
                  <td style={{ ...S.tdR, fontWeight: 800, color: semColor(totals.pct) }}>{(totals.pct * 100).toFixed(1)}%</td>
                  <td style={S.td}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ============================ FOOTER ============================
  const Footer = () => {
    const [showReadme, setShowReadme] = useState(false);
    const [showManual, setShowManual] = useState(false);
    const [readmeContent, setReadmeContent] = useState("");
    const [manualContent, setManualContent] = useState("");
    const [loading, setLoading] = useState(false);

    const loadMarkdown = async (type) => {
      setLoading(true);
      try {
        const res = await fetch(type === 'readme' ? '/docs-api/readme' : '/docs-api/manual');
        const data = await res.json();
        if (type === 'readme') {
          setReadmeContent(data.content);
          setShowReadme(true);
        } else {
          setManualContent(data.content);
          setShowManual(true);
        }
      } catch (err) {
        notify("Errore nel caricamento del documento", "error");
      } finally {
        setLoading(false);
      }
    };

    const navigateHome = () => {
      setActiveSection("main");
      setActiveTab("import");
      setSidebarOpen(false);
      setSidebarHover(false);
    };

    const renderMarkdown = (text) => {
      // Simple markdown-like rendering
      const lines = text.split('\n');
      const elements = [];
      let inCodeBlock = false;
      let codeContent = [];
      let listItems = [];

      const flushList = () => {
        if (listItems.length > 0) {
          elements.push(
            <ul key={`list-${elements.length}`} style={{ margin: '8px 0', paddingLeft: 20 }}>
              {listItems.map((item, i) => <li key={i} style={{ marginBottom: 4 }}>{item}</li>)}
            </ul>
          );
          listItems = [];
        }
      };

      lines.forEach((line, idx) => {
        // Code blocks
        if (line.startsWith('```')) {
          if (inCodeBlock) {
            flushList();
            elements.push(
              <pre key={`code-${idx}`} style={{ background: '#212326', color: '#e5e7eb', padding: 16, borderRadius: 8, margin: '12px 0', overflowX: 'auto', fontSize: 13 }}>
                <code>{codeContent.join('\n')}</code>
              </pre>
            );
            codeContent = [];
            inCodeBlock = false;
          } else {
            flushList();
            inCodeBlock = true;
          }
          return;
        }

        if (inCodeBlock) {
          codeContent.push(line);
          return;
        }

        // Headers
        if (line.startsWith('# ')) {
          flushList();
          elements.push(<h1 key={idx} style={{ fontSize: 24, fontWeight: 700, margin: '20px 0 12px', color: '#212326' }}>{line.substring(2)}</h1>);
        } else if (line.startsWith('## ')) {
          flushList();
          elements.push(<h2 key={idx} style={{ fontSize: 20, fontWeight: 600, margin: '16px 0 10px', color: '#334155' }}>{line.substring(3)}</h2>);
        } else if (line.startsWith('### ')) {
          flushList();
          elements.push(<h3 key={idx} style={{ fontSize: 17, fontWeight: 600, margin: '12px 0 8px', color: '#434549' }}>{line.substring(4)}</h3>);
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
          const content = line.substring(2);
          listItems.push(renderInline(content));
        } else if (line.trim() === '') {
          flushList();
        } else {
          flushList();
          elements.push(<p key={idx} style={{ margin: '6px 0', lineHeight: 1.6 }}>{renderInline(line)}</p>);
        }
      });

      flushList();
      return elements;
    };

    const renderInline = (text) => {
      // Parse bold and links
      const boldParts = text.split(/\*\*(.+?)\*\*/g);

      return boldParts.flatMap((part, boldIdx) => {
        if (boldIdx % 2 === 1) {
          return <strong key={boldIdx} style={{ fontWeight: 600 }}>{part}</strong>;
        }

        // Now parse links in this part: [text](/url)
        const linkParts = part.split(/\[(.+?)\]\((.+?)\)/g);
        if (linkParts.length === 1) return part;

        return linkParts.map((chunk, linkIdx) => {
          if (linkIdx % 3 === 1) {
            // linkIdx % 3 === 1 is the link text
            const linkText = chunk;
            const linkUrl = linkParts[linkIdx + 1];
            return <a key={linkIdx} href={linkUrl} style={{ color: '#0c4577', textDecoration: 'underline', cursor: 'pointer' }}>{linkText}</a>;
          } else if (linkIdx % 3 === 2) {
            // linkIdx % 3 === 2 is the link URL, skip it (already used)
            return null;
          }
          return chunk;
        }).filter(el => el !== null);
      });
    };

    return (
      <>
        {/* Footer Bar */}
        <div style={{
          background: 'white',
          borderTop: '2px solid #e5e7eb',
          padding: '16px 32px',
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
          boxShadow: '0 -2px 10px rgba(0,0,0,0.05)',
          marginTop: 40
        }}>
          <button
            onClick={navigateHome}
            style={{
              ...S.btn('success'),
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <i className="fas fa-home"></i>
            Home
          </button>
          <button
            onClick={() => loadMarkdown('readme')}
            disabled={loading}
            style={{
              ...S.btn('secondary'),
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: loading ? 0.6 : 1
            }}
          >
            <i className="fas fa-book"></i>
            Leggi README
          </button>
          <button
            onClick={() => loadMarkdown('manual')}
            disabled={loading}
            style={{
              ...S.btn('secondary'),
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: loading ? 0.6 : 1
            }}
          >
            <i className="fas fa-book-open"></i>
            Leggi Manuale
          </button>
        </div>

        {/* README Modal */}
        {showReadme && (
          <div
            onClick={() => setShowReadme(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              animation: 'fadeIn 0.2s ease'
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'white',
                borderRadius: 16,
                padding: 28,
                maxWidth: 900,
                width: '90%',
                maxHeight: '85vh',
                overflow: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '2px solid #e5e7eb', paddingBottom: 16 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#212326', margin: 0 }}>
                  <i className="fas fa-book" style={{ marginRight: 8, color: '#0c4577' }}></i>
                  README
                </h2>
                <button
                  onClick={() => setShowReadme(false)}
                  style={{
                    background: '#f2f3f5',
                    border: 'none',
                    borderRadius: 8,
                    width: 36,
                    height: 36,
                    cursor: 'pointer',
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease'
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ lineHeight: 1.7 }}>
                {renderMarkdown(readmeContent)}
              </div>
            </div>
          </div>
        )}

        {/* Manual Modal */}
        {showManual && (
          <div
            onClick={() => setShowManual(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              animation: 'fadeIn 0.2s ease'
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'white',
                borderRadius: 16,
                padding: 28,
                maxWidth: 900,
                width: '90%',
                maxHeight: '85vh',
                overflow: 'auto',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '2px solid #e5e7eb', paddingBottom: 16 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#212326', margin: 0 }}>
                  <i className="fas fa-book-open" style={{ marginRight: 8, color: '#0c4577' }}></i>
                  MANUALE
                </h2>
                <button
                  onClick={() => setShowManual(false)}
                  style={{
                    background: '#f2f3f5',
                    border: 'none',
                    borderRadius: 8,
                    width: 36,
                    height: 36,
                    cursor: 'pointer',
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease'
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ lineHeight: 1.7 }}>
                {renderMarkdown(manualContent)}
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  // ============================ RENDER ============================
  return (
    <div 
      style={S.app}
      onMouseEnter={(e) => {
        // Show sidebar when mouse enters left edge area
        if (e.clientX < 10) {
          setSidebarHover(true);
          setSidebarOpen(true);
        }
      }}
    >
      {/* Sidebar Overlay - only when actively navigating */}
      {sidebarOpen && (
        <div 
          style={S.sidebarOverlay}
          onClick={() => {
            setSidebarOpen(false);
            setSidebarHover(false);
          }}
        />
      )}

      {/* Sidebar */}
      <div 
        style={S.sidebar(sidebarOpen)}
        onMouseLeave={() => {
          if (!sidebarHover || window.innerWidth < 768) {
            setSidebarOpen(false);
            setSidebarHover(false);
          }
        }}
      >
        <div style={S.sidebarHeader}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>☰ Menu</div>
          <button 
            style={S.closeBtn}
            onClick={() => {
              setSidebarOpen(false);
              setSidebarHover(false);
            }}
          >
            ✕
          </button>
        </div>

        <div style={S.sidebarContent}>
          {/* Menu Items */}
          <div
            style={activeSection === "main" ? S.menuItemActive : S.menuItem}
            onClick={() => { 
              setActiveSection("main"); 
              setActiveTab("import"); 
              setSidebarOpen(false); 
              setSidebarHover(false); 
            }}
          >
            <i className="fas fa-home" style={S.menuIcon}></i>
            <span>Home</span>
          </div>

          <div
            style={activeSection === "readme" ? S.menuItemActive : S.menuItem}
            onClick={() => {
              setActiveSection("readme");
              setSidebarOpen(false);
              setSidebarHover(false);
            }}
          >
            <i className="fas fa-book" style={S.menuIcon}></i>
            <span>README</span>
          </div>

          {user && (
            <div
              style={S.menuItem}
              onClick={() => {
                openChangePwd();
                setSidebarOpen(false);
                setSidebarHover(false);
              }}
            >
              <i className="fas fa-key" style={S.menuIcon}></i>
              <span>Cambia password</span>
            </div>
          )}

          <div style={{ borderTop: "1px solid #1e211e", margin: "12px 0", padding: "16px 0 4px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#434549", textTransform: "uppercase", letterSpacing: 1, paddingLeft: 16, marginBottom: 12 }}>
              Sezioni
            </div>
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", cursor: "pointer" }}
              onClick={() => setExtraTabsEnabled(v => !v)}
            >
              <span style={{ color: "#e5e7eb", fontSize: 14 }}>WBS / SAL / KPI</span>
              <div style={{ position: "relative", width: 42, height: 24, background: extraTabsEnabled ? "#0c4577" : "#3a3d3a", borderRadius: 12, transition: "background 0.2s", flexShrink: 0 }}>
                <div style={{ position: "absolute", top: 3, left: extraTabsEnabled ? 21 : 3, width: 18, height: 18, background: "white", borderRadius: "50%", transition: "left 0.2s" }} />
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Invisible trigger zone on left edge */}
      <div 
        style={S.sidebarTrigger}
        onMouseEnter={() => {
          setSidebarHover(true);
          setSidebarOpen(true);
        }}
      />

      {/* Main Content */}
      <div style={S.mainWrapper}>
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '8px 16px', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s ease' }}
              title="Apri il menu di navigazione"
            >
              ☰ Menu
            </button>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Lettore DDT</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {project.articles.length > 0 && (
              <button onClick={clearProject} title="Nuovo progetto"
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                ✕ Nuovo
              </button>
            )}
            {user && (
              <>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  {user.displayName} · {user.commessaId}
                </span>
                <button onClick={openChangePwd} title="Cambia password"
                  style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  🔑 Password
                </button>
                {user?.isAdmin && (
                  <button onClick={() => window.location.href = '/admin'} title="Pannello amministrazione"
                    style={{ background: 'rgba(255,215,0,0.3)', border: '1px solid rgba(255,215,0,0.5)', color: '#ffd700', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    ⚙️ Admin
                  </button>
                )}
                <button onClick={onLogout} title="Esci"
                  style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  Esci
                </button>
              </>
            )}
          </div>
        </div>

        <div style={S.tabs}>
          {[
            { id: "import", label: "📥 Importa" },
            // Conversione automatica, Archivio, WBS, SAL e KPI sono riservati
            // agli amministratori: la prima spende sull'API e occupa la GPU del
            // server, le altre mostrano i dati di tutta la commessa.
            ...(user?.isAdmin ? [
              { id: "batch", label: "⚙️ Conversione automatica" },
              { id: "archivio", label: "📚 Archivio DDT" },
              ...(extraTabsEnabled ? [
                { id: "wbs", label: "🏗️ WBS" },
                { id: "sal", label: "📋 SAL" },
                { id: "kpi", label: "📊 Dashboard KPI" },
              ] : []),
            ] : []),
          ].map(({ id, label }) => (
            <div key={id} style={S.tab(activeTab === id && activeSection === "main")} onClick={() => { setActiveTab(id); setActiveSection("main"); }}>
              {label}
            </div>
          ))}
        </div>

        {/* Layout principale */}
        {activeSection === "main" && (
          <div style={S.content}>
            {/* PaniereTab è fratello di ImportTab, non figlio: ImportTab è
                ridefinita a ogni render di App, quindi il suo sottoalbero viene
                rimontato da capo e il JSON incollato nel paniere sparirebbe. */}
            {activeTab === "import" && (
              <>
                <ImportTab />
                <PaniereTab notify={notify} isAdmin={!!user?.isAdmin} />
                <ImportTabRest />
              </>
            )}
            {activeTab === "batch" && user?.isAdmin && <BatchTab notify={notify} />}
            {activeTab === "archivio" && user?.isAdmin && <ArchivioTab notify={notify} onReopen={handleReopenExport} />}
            {activeTab === "wbs" && user?.isAdmin && <WbsTab />}
            {activeTab === "sal" && user?.isAdmin && <SalTab />}
            {activeTab === "kpi" && user?.isAdmin && <KpiTab />}
          </div>
        )}

        {activeSection !== "main" && <div style={S.content}>

          {/* README Section */}
          {activeSection === "readme" && (
            <div style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: "#212326", margin: 0 }}>
                  <i className="fas fa-book" style={{ marginRight: 8, color: "#0c4577" }}></i>
                  README Documentation
                </h2>
              </div>
              {!readmeContent ? (
                <div style={{ textAlign: "center", padding: 40, color: "#434549" }}>
                  <i className="fas fa-spinner fa-spin" style={{ fontSize: 24 }}></i>
                  <p style={{ marginTop: 12 }}>Caricamento...</p>
                </div>
              ) : readmeContent.startsWith("Errore") ? (
                <div style={{ 
                  padding: 20, 
                  background: "#fef2f2", 
                  borderRadius: 12, 
                  border: "1px solid #fecaca",
                  color: "#991b1b"
                }}>
                  <i className="fas fa-exclamation-triangle" style={{ fontSize: 24, marginBottom: 12, display: "block" }}></i>
                  <p style={{ margin: 0 }}>{readmeContent}</p>
                </div>
              ) : readmeContent === "Caricamento..." ? (
                <div style={{ textAlign: "center", padding: 40, color: "#434549" }}>
                  <i className="fas fa-spinner fa-spin" style={{ fontSize: 24 }}></i>
                  <p style={{ marginTop: 12 }}>Caricamento del documento...</p>
                </div>
              ) : (
                <div style={{
                  padding: 20,
                  background: "#f9f9fb",
                  borderRadius: 12,
                  lineHeight: 1.6,
                  maxHeight: "70vh",
                  overflowY: "auto"
                }}>
                  <pre style={{
                    whiteSpace: "pre-wrap",
                    wordWrap: "break-word",
                    fontFamily: "inherit",
                    margin: 0,
                    fontSize: 14
                  }}>
                    {readmeContent}
                  </pre>
                </div>
              )}
            </div>
          )}

        </div>}

        {notification && <div style={S.notif(notification.type)}>{notification.msg}</div>}

        {showChangePwd && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => !pwdSaving && setShowChangePwd(false)}
          >
            <div
              style={{ background: "#fff", borderRadius: 8, padding: 28, width: 380, maxWidth: "90vw", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ ...S.cardTitle, marginBottom: 16 }}>🔑 Cambia password</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input type="password" placeholder="Password attuale" autoFocus value={pwdForm.current}
                  onChange={(e) => setPwdForm(f => ({ ...f, current: e.target.value }))} style={S.input} />
                <input type="password" placeholder="Nuova password (min 8)" value={pwdForm.next}
                  onChange={(e) => setPwdForm(f => ({ ...f, next: e.target.value }))} style={S.input} />
                <input type="password" placeholder="Conferma nuova password" value={pwdForm.confirm}
                  onChange={(e) => setPwdForm(f => ({ ...f, confirm: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !pwdSaving) handleChangePassword(); }} style={S.input} />
              </div>
              {pwdError && <div style={{ color: "#c43a3a", fontSize: 13, marginTop: 12 }}>{pwdError}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
                <button onClick={() => setShowChangePwd(false)} disabled={pwdSaving} style={S.btn("secondary")}>Annulla</button>
                <button onClick={handleChangePassword} disabled={pwdSaving}
                  style={{ ...S.btn("primary"), opacity: pwdSaving ? 0.6 : 1 }}>
                  {pwdSaving ? "Salvataggio…" : "Aggiorna password"}
                </button>
              </div>
            </div>
          </div>
        )}

        {previewData && (
          <PreviewModal
            data={previewData}
            onConfirm={handleConfirmDownload}
            onCancel={() => { setPreviewData(null); setPreviewWarnings([]); }}
            loading={claudeLoading}
            warnings={previewWarnings}
            onAddToPaniere={handleAddPreviewToPaniere}
          />
        )}

        {costruttorePrompt && (
          <PromptBuilder
            notify={notify}
            onClose={() => setCostruttorePrompt(false)}
            onCambiato={() => caricaPrompts()}
            // Finestra completa solo agli amministratori: gli altri rispondono
            // a tre domande e il prompt lo scrive il costruttore.
            avanzato={!!user?.isAdmin}
            azionePrimaria={{
              label: "📋 Copia e apri Claude",
              run: (testo) => { setCostruttorePrompt(false); handleSelectAndOpen(testo); },
            }}
          />
        )}

        {showExcelValidation && (
          <div style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 5001
          }}>
            <div style={{
              background: "#fff", borderRadius: 12, padding: 40,
              maxWidth: 500, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              textAlign: "center"
            }}>
              <div style={{ fontSize: 32, marginBottom: 16 }}>✅ File salvato con successo</div>
              <h3 style={{ margin: "0 0 16px", fontSize: 20, color: "#212326" }}>
                Convalidare l'estrazione dati
              </h3>
              <p style={{
                margin: "0 0 24px", fontSize: 15, color: "#434549", lineHeight: 1.5
              }}>
                Per favore, verifica il file Excel scaricato per assicurarti che i dati siano stati estratti correttamente.
              </p>
              <div style={{
                background: "#f2f3f5", padding: 16, borderRadius: 8, marginBottom: 24,
                borderLeft: "4px solid #1f7f1f", textAlign: "left"
              }}>
                <p style={{ margin: 0, fontSize: 13, color: "#212326" }}>
                  <strong>Checklist di convalida:</strong>
                </p>
                <ul style={{ margin: "8px 0 0 20px", fontSize: 13, color: "#434549" }}>
                  <li>Verifica che i dati siano visibili in tutti i fogli</li>
                  <li>Controlla che i valori numerici siano corretti</li>
                  <li>Assicurati che nessun dato sia stato troncato</li>
                </ul>
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button onClick={() => {
                  setShowExcelValidation(false);
                  try {
                    const raw = JSON.parse(claudeResponse);
                    const converted = convertJsonToProject(raw, "Risposta Claude");
                    if (converted.articles.length > 0) {
                      setProject(converted);
                      setActiveTab("wbs");
                    }
                  } catch {}
                  setPreviewData(null);
                  setClaudeResponse('');
                }} style={{
                  flex: 1, padding: "12px 20px", background: "#1f7f1f", color: "#fff",
                  border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer"
                }}>
                  ✓ Dati convalidati
                </button>
              </div>
              <p style={{
                margin: "12px 0 0", fontSize: 12, color: "#999", fontStyle: "italic"
              }}>
                Clicca il pulsante sopra per confermare la convalida dei dati
              </p>
            </div>
          </div>
        )}

        <Footer />
      </div>
    </div>
  );
}
