/**
 * BatchTab.tsx — Pagina "Conversione automatica".
 *
 * Converte in blocco i PDF di una cartella scelta dall'utente e deposita gli
 * Excel in un'altra, tramite l'API Claude. Affianca la pagina "Importa" (flusso
 * manuale via claude.ai), non la sostituisce.
 *
 * Le cartelle si scelgono in due modi, secondo quello che il browser permette:
 *  - cartelle del server: percorsi sul PC che ospita l'app (solo se ci stai
 *    lavorando sopra, o se sono elencate in batch.config.json → allowedRoots);
 *  - cartelle del browser: finestra di Windows. Scrive da sola nella cartella
 *    di destinazione se il browser ha la File System Access API (Chrome/Edge su
 *    localhost o HTTPS), altrimenti restituisce un .zip da scaricare.
 *
 * Qui resta il form di avvio e l'elenco dei lavori; i pezzi grossi stanno in
 * ./batch/ (ServerBrowser, SorveglianzaCard, JobDetail) con i tipi condivisi
 * in ./batch/tipi.
 */
import React from 'react';
import { S } from '../styles';
import { ServerBrowser } from './batch/ServerBrowser';
import { SorveglianzaCard } from './batch/SorveglianzaCard';
import { JobDetail } from './batch/JobDetail';
import { PromptBuilder, PromptSalvato } from './PromptBuilder';
import {
  api,
  BatchConfigInfo,
  FsDirHandle,
  FsFileHandle,
  hasFsPicker,
  Job,
  JOB_ATTIVO,
  PickerWindow,
  STATUS_BADGE,
} from './batch/tipi';


// ── Pagina ──────────────────────────────────────────────────────────────────
export const BatchTab = React.memo(function BatchTab({
  notify,
}: {
  notify: (msg: string, type?: string) => void;
}) {
  const [cfg, setCfg] = React.useState<BatchConfigInfo | null>(null);
  const [source, setSource] = React.useState<'server' | 'upload'>('upload');

  // Modalità 'server'
  const [inputDir, setInputDir] = React.useState('');
  const [outputDir, setOutputDir] = React.useState('');
  const [browsing, setBrowsing] = React.useState<'input' | 'output' | null>(null);

  // Modalità 'upload'
  const [pdfFiles, setPdfFiles] = React.useState<File[]>([]);
  const [inDirName, setInDirName] = React.useState('');
  const [outDirHandle, setOutDirHandle] = React.useState<FsDirHandle | null>(null);
  const folderInputRef = React.useRef<HTMLInputElement>(null);

  // Opzioni
  const [promptId, setPromptId] = React.useState('ddt');
  const [model, setModel] = React.useState('claude-haiku-4-5');
  const [fallbackModel, setFallbackModel] = React.useState('claude-sonnet-5');
  const [useFallback, setUseFallback] = React.useState(true);
  const [useBatchApi, setUseBatchApi] = React.useState(true);
  const [force, setForce] = React.useState(false);
  const [mergeOutput, setMergeOutput] = React.useState(false);
  const [localOcr, setLocalOcr] = React.useState(false);
  const [ollama, setOllama] = React.useState(false);
  const [spostaElaborati, setSpostaElaborati] = React.useState(false);
  const [autoPaniere, setAutoPaniere] = React.useState(false);

  // Il Registro FIR è per natura una tabella cumulativa: se lo scegli, la
  // spunta "tabella unica" si accende da sola (resta comunque modificabile).
  // L'OCR locale invece si spegne cambiando prompt: ha senso solo sul FIR,
  // e su un altro tipo di documento manderebbe comunque in errore il lavoro.
  React.useEffect(() => {
    if (promptId === 'registro-fir') setMergeOutput(true);
    else setLocalOcr(false);
  }, [promptId]);

  // Finestra "Costruttore prompt": i prompt che salva finiscono nella tendina
  // Tipo documento come i preset, perché il server li serve dalla stessa lista.
  const [costruttore, setCostruttore] = React.useState(false);

  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [openJob, setOpenJob] = React.useState<Job | null>(null);
  const [starting, setStarting] = React.useState(false);

  // ── Config iniziale ──
  React.useEffect(() => {
    api('/batch/config')
      .then((c: BatchConfigInfo) => {
        setCfg(c);
        setPromptId(c.defaults.prompt);
        setModel(c.defaults.model);
        setFallbackModel(c.defaults.fallbackModel);
        setUseBatchApi(c.defaults.useBatchApi);
        // Se le cartelle del server sono a portata (stai lavorando sul PC che
        // ospita l'app), è il modo comodo: niente da caricare, niente da scaricare.
        if (c.canBrowseServer) {
          setSource('server');
          setInputDir(c.defaults.inputDir);
          setOutputDir(c.defaults.outputDir);
        }
      })
      .catch((e) => notify(`Configurazione non caricata: ${(e as Error).message}`, 'error'));
  }, []);

  // Un prompt custom è stato salvato o cancellato: la tendina va riletta dal
  // server, ed è comodo trovarsi già selezionato quello appena scritto.
  const ricaricaPrompts = React.useCallback(async (p?: PromptSalvato) => {
    try {
      const c: BatchConfigInfo = await api('/batch/config');
      setCfg(c);
      if (p) setPromptId(p.id);
      else setPromptId((attuale) => (c.prompts.some((x) => x.id === attuale) ? attuale : c.defaults.prompt));
    } catch (e) {
      notify(`Prompt non ricaricati: ${(e as Error).message}`, 'error');
    }
  }, [notify]);

  // ── Lista lavori, con sondaggio finché qualcosa è in corso ──
  const refreshJobs = React.useCallback(async () => {
    try {
      const { jobs: list } = await api('/batch/jobs');
      setJobs(list);
      return list as Job[];
    } catch {
      return [];
    }
  }, []);

  React.useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  // Il dettaglio aperto e la lista si aggiornano ogni 3s solo mentre serve.
  React.useEffect(() => {
    const attivo = jobs.some((j) => JOB_ATTIVO(j.status)) || (openJob && JOB_ATTIVO(openJob.status));
    if (!attivo) return;
    const t = setInterval(async () => {
      const list = await refreshJobs();
      if (openJob) {
        const fresh = list.find((j) => j.id === openJob.id);
        if (fresh && JOB_ATTIVO(fresh.status)) {
          try {
            setOpenJob(await api(`/batch/jobs/${openJob.id}`));
          } catch {
            /* riproviamo al giro dopo */
          }
        } else if (fresh) {
          setOpenJob(await api(`/batch/jobs/${openJob.id}`).catch(() => openJob));
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, [jobs, openJob, refreshJobs]);

  // ── Scelta cartelle lato browser ──
  const pickInputWithPicker = async () => {
    try {
      const dir = await (window as PickerWindow).showDirectoryPicker!({ mode: 'read' });
      const files: File[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) {
          files.push(await (entry as FsFileHandle).getFile());
        }
      }
      if (files.length === 0) return notify('Nessun PDF in quella cartella', 'error');
      setPdfFiles(files);
      setInDirName(dir.name);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify((e as Error).message, 'error');
    }
  };

  const pickOutputWithPicker = async () => {
    try {
      const dir = await (window as PickerWindow).showDirectoryPicker!({ mode: 'readwrite' });
      setOutDirHandle(dir);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notify((e as Error).message, 'error');
    }
  };

  const onFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files || []);
    const pdfs = all.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) return notify('Nessun PDF in quella cartella', 'error');
    setPdfFiles(pdfs);
    // webkitRelativePath = "cartella/file.pdf": il primo pezzo è il nome scelto.
    const rel = (pdfs[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    setInDirName(rel.split('/')[0] || 'cartella scelta');
  };

  // ── Avvio ──
  const tooBig = React.useMemo(
    () => (cfg ? pdfFiles.filter((f) => f.size > cfg.maxPdfBytes) : []),
    [pdfFiles, cfg]
  );

  const start = async (pulisci = false) => {
    if (!cfg) return;
    setStarting(true);
    try {
      let bodyInput = inputDir;

      if (source === 'upload') {
        if (pdfFiles.length === 0) throw new Error('Scegli prima la cartella dei PDF');
        const form = new FormData();
        for (const f of pdfFiles) {
          if (f.size > cfg.maxPdfBytes) continue; // l'API li rifiuterebbe comunque
          form.append('files', f, f.name);
        }
        const up = await api('/batch/uploads', { method: 'POST', body: form });
        if (!up.saved) throw new Error('Nessun PDF caricato');
        for (const r of up.rejected || []) notify(`${r.name} scartato: ${r.reason}`, 'error');
        bodyInput = up.uploadId;
      }

      const job: Job = await api('/batch/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: source,
          inputDir: bodyInput,
          outputDir,
          promptId,
          model,
          fallbackModel,
          useFallback,
          useBatchApi,
          force,
          pulisci,
          mergeOutput,
          localOcr,
          ollama,
          spostaElaborati,
          autoPaniere,
        }),
      });
      setOpenJob(job);
      await refreshJobs();
      notify(
        job.status === 'errore'
          ? `Lavoro non avviato: ${job.error}`
          : pulisci
            ? `Pulizia di ${job.progress.total} PDF in corso, poi la conversione`
            : `Lavoro avviato: ${job.progress.total} PDF`,
        job.status === 'errore' ? 'error' : 'success'
      );
      if (source === 'upload') {
        setPdfFiles([]);
        setInDirName('');
      }
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      // "><(((º> sabusabu <º)))><"
      setStarting(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await api(`/batch/jobs/${id}/cancel`, { method: 'POST' });
      notify('Annullamento richiesto: i batch aperti vengono chiusi', 'info');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  if (!cfg) return <div style={S.card}>Carico la configurazione…</div>;

  if (!cfg.puoiUsare) {
    return (
      <div style={{ ...S.card, borderLeft: '4px solid #d97706' }}>
        <div style={S.cardTitle}>🔒 Pagina riservata agli amministratori</div>
        <p style={{ fontSize: 14, color: '#434549', lineHeight: 1.6, margin: 0 }}>
          La conversione automatica usa l'API a pagamento ed è stata riservata agli amministratori
          (impostazione <code>soloAdmin</code> in <code>batch.config.json</code>). Puoi continuare a
          usare la pagina <strong>Importa</strong> per il flusso manuale.
        </p>
      </div>
    );
  }

  // Ollama e OCR locale girano sulla macchina: niente chiave, niente Batch API,
  // niente modello Claude da scegliere.
  const motoreLocale = localOcr || ollama;
  const canStart =
    (cfg.hasApiKey || motoreLocale) &&
    !starting &&
    (source === 'server' ? !!inputDir && !!outputDir : pdfFiles.length > 0);

  const row = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' as const };
  const label = { fontSize: 12, fontWeight: 600, color: '#434549', minWidth: 128 };

  return (
    <div>
      {!cfg.hasApiKey && (
        <div
          style={{
            ...S.card,
            borderLeft: '4px solid #c0392b',
            background: 'rgba(192,57,43,0.04)',
          }}
        >
          <div style={S.cardTitle}>🔑 API key Anthropic mancante</div>
          <p style={{ fontSize: 14, color: '#434549', lineHeight: 1.6, margin: 0 }}>
            Questa pagina chiama l'API di Claude, che richiede una chiave a pagamento. Imposta la variabile
            d'ambiente <code>ANTHROPIC_API_KEY</code> (oppure il campo <code>apiKey</code> in{' '}
            <code>batch.config.json</code>) e riavvia l'app. Nel frattempo puoi usare la pagina{' '}
            <strong>Importa</strong>, che passa da claude.ai e non richiede chiave
            {cfg.ollama.disponibile &&
              ', oppure il motore "Ollama locale" qui sotto, che gira sulla GPU del server senza chiave né costi'}
            {cfg.estrazioneLocale.disponibile &&
              ', oppure — solo per il Registro FIR — la spunta "Estrai in locale" qui sotto, gratis e senza chiave'}
            .
          </p>
        </div>
      )}

      <div style={{ ...S.card, borderLeft: '4px solid #0c4577' }}>
        <div style={S.cardTitle}>⚙️ Conversione automatica di una cartella</div>
        <p style={{ fontSize: 14, color: '#434549', marginBottom: 20, lineHeight: 1.6 }}>
          Prende tutti i PDF di una cartella, li converte con l'API di Claude e deposita gli Excel nella cartella
          che scegli. Nessun copia-incolla: la pagina <strong>Importa</strong> resta lì per il flusso manuale.
        </p>

        {/* Da dove arrivano i PDF */}
        <div style={row}>
          <span style={label}>PDF da</span>
          {(['server', 'upload'] as const).map((m) => (
            <label
              key={m}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                cursor: m === 'server' && !cfg.canBrowseServer ? 'not-allowed' : 'pointer',
                opacity: m === 'server' && !cfg.canBrowseServer ? 0.45 : 1,
              }}
              title={
                m === 'server' && !cfg.canBrowseServer
                  ? 'Disponibile solo usando l\'app sul computer che la ospita'
                  : undefined
              }
            >
              <input
                type="radio"
                checked={source === m}
                disabled={m === 'server' && !cfg.canBrowseServer}
                onChange={() => setSource(m)}
              />
              {m === 'server' ? 'una cartella di questo computer' : 'una cartella scelta dal browser'}
            </label>
          ))}
        </div>

        {source === 'server' ? (
          <>
            <div style={row}>
              <span style={label}>Cartella PDF</span>
              <input
                style={{ ...S.input, flex: 1, minWidth: 240, fontFamily: 'Consolas, monospace', fontSize: 13 }}
                value={inputDir}
                onChange={(e) => setInputDir(e.target.value)}
                placeholder="C:\DDT\da-fare"
              />
              <button style={S.btn('secondary')} onClick={() => setBrowsing('input')}>
                Sfoglia
              </button>
            </div>
            <div style={row}>
              <span style={label}>Cartella Excel</span>
              <input
                style={{ ...S.input, flex: 1, minWidth: 240, fontFamily: 'Consolas, monospace', fontSize: 13 }}
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="C:\DDT\convertiti"
              />
              <button style={S.btn('secondary')} onClick={() => setBrowsing('output')}>
                Sfoglia
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#8a8d92', marginBottom: 16 }}>
              Se non esiste, la cartella Excel viene creata. Accetta anche percorsi di rete (\\server\condivisa\ddt).
            </div>
          </>
        ) : (
          <>
            <div style={row}>
              <span style={label}>Cartella PDF</span>
              <input
                ref={folderInputRef}
                type="file"
                accept=".pdf"
                multiple
                style={{ display: 'none' }}
                onChange={onFolderInput}
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              />
              <button
                style={S.btn('secondary')}
                onClick={() => (hasFsPicker() ? pickInputWithPicker() : folderInputRef.current?.click())}
              >
                Scegli cartella
              </button>
              <span style={{ fontSize: 13, color: pdfFiles.length ? '#3f8f55' : '#8a8d92' }}>
                {pdfFiles.length ? `${inDirName} — ${pdfFiles.length} PDF` : 'nessuna cartella scelta'}
              </span>
            </div>

            <div style={row}>
              <span style={label}>Cartella Excel</span>
              {hasFsPicker() ? (
                <>
                  <button style={S.btn('secondary')} onClick={pickOutputWithPicker}>
                    Scegli cartella
                  </button>
                  <span style={{ fontSize: 13, color: outDirHandle ? '#3f8f55' : '#8a8d92' }}>
                    {outDirHandle ? outDirHandle.name : 'nessuna — scaricherai un .zip a fine lavoro'}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 13, color: '#8a8d92' }}>
                  Il browser non può scrivere nelle cartelle da questa connessione: a fine lavoro scarichi un .zip
                  con tutti gli Excel.
                </span>
              )}
            </div>

            {tooBig.length > 0 && (
              <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 12 }}>
                {tooBig.length} PDF oltre i 22MB verranno saltati: l'API li rifiuta, vanno divisi.
              </div>
            )}
          </>
        )}

        {/* Opzioni */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginTop: 4 }}>
          <div style={row}>
            <span style={label}>Tipo documento</span>
            <select style={{ ...S.select, minWidth: 260 }} value={promptId} onChange={(e) => setPromptId(e.target.value)}>
              {cfg.prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.custom ? '🧩 ' : ''}{p.label} — {p.description}
                </option>
              ))}
            </select>
            <button
              style={S.btn('secondary')}
              title="Costruisci un prompt su misura (colonne, indizi, controlli) e salvalo fra i tipi documento"
              onClick={() => setCostruttore(true)}
            >
              🧩 Costruisci prompt
            </button>
          </div>

          {/* Chi fa l'estrazione. Claude è il default; gli altri due girano sulla
              macchina che ospita l'app, senza chiave e senza costi. */}
          <div style={row}>
            <span style={label}>Motore</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="radio"
                checked={!motoreLocale}
                onChange={() => {
                  setLocalOcr(false);
                  setOllama(false);
                }}
              />
              API Claude — a pagamento, capisce il documento
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                cursor: cfg.ollama.disponibile ? 'pointer' : 'not-allowed',
                opacity: cfg.ollama.disponibile ? 1 : 0.45,
              }}
              title={
                cfg.ollama.disponibile
                  ? `Modello ${cfg.ollama.modello} sulla GPU del server`
                  : cfg.ollama.motivo
              }
            >
              <input
                type="radio"
                checked={ollama}
                disabled={!cfg.ollama.disponibile}
                onChange={() => {
                  setOllama(true);
                  setLocalOcr(false);
                }}
              />
              🦙 Ollama locale — gratis e offline, più lento
            </label>
            {promptId === 'registro-fir' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  cursor: cfg.estrazioneLocale.disponibile ? 'pointer' : 'not-allowed',
                  opacity: cfg.estrazioneLocale.disponibile ? 1 : 0.45,
                }}
                title={cfg.estrazioneLocale.disponibile ? undefined : cfg.estrazioneLocale.motivo}
              >
                <input
                  type="radio"
                  checked={localOcr}
                  disabled={!cfg.estrazioneLocale.disponibile}
                  onChange={() => {
                    setLocalOcr(true);
                    setOllama(false);
                  }}
                />
                🖥️ OCR locale — gratis, no chiave, solo regex sui campi del modulo
              </label>
            )}
          </div>

          <div style={row}>
            <span style={label}>Modalità</span>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                cursor: motoreLocale ? 'not-allowed' : 'pointer',
                opacity: motoreLocale ? 0.45 : 1,
              }}
            >
              <input type="radio" checked={useBatchApi} disabled={motoreLocale} onChange={() => setUseBatchApi(true)} />
              Batch API — metà prezzo, esito entro ~1h
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                cursor: motoreLocale ? 'not-allowed' : 'pointer',
                opacity: motoreLocale ? 0.45 : 1,
              }}
            >
              <input type="radio" checked={!useBatchApi} disabled={motoreLocale} onChange={() => setUseBatchApi(false)} />
              Immediata — prezzo pieno
            </label>
          </div>

          <div style={{ ...row, opacity: motoreLocale ? 0.45 : 1 }}>
            <span style={label}>Modello</span>
            <select style={S.select} disabled={motoreLocale} value={model} onChange={(e) => setModel(e.target.value)}>
              {cfg.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: motoreLocale ? 'not-allowed' : 'pointer' }}>
              <input
                type="checkbox"
                checked={useFallback}
                disabled={motoreLocale}
                onChange={(e) => setUseFallback(e.target.checked)}
              />
              rielabora i file dubbi con
            </label>
            <select
              style={{ ...S.select, opacity: useFallback && !motoreLocale ? 1 : 0.45 }}
              disabled={!useFallback || motoreLocale}
              value={fallbackModel}
              onChange={(e) => setFallbackModel(e.target.value)}
            >
              {cfg.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div style={row}>
            <span style={label}>Output</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={mergeOutput} onChange={(e) => setMergeOutput(e.target.checked)} />
              tabella unica — una riga per PDF, tutte impilate in un solo Excel (invece di un file per PDF)
            </label>
          </div>

          <div style={row}>
            <span style={label}>Già convertiti</span>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                cursor: mergeOutput ? 'not-allowed' : 'pointer',
                opacity: mergeOutput ? 0.45 : 1,
              }}
              title={mergeOutput ? 'Con "tabella unica" ogni lavoro rielabora sempre tutti i PDF della cartella' : undefined}
            >
              <input
                type="checkbox"
                checked={force}
                disabled={mergeOutput}
                onChange={(e) => setForce(e.target.checked)}
              />
              rifai anche i PDF che hanno già un Excel in destinazione
            </label>
          </div>

          {/* Automazione: svuota l'input e alimenta il paniere senza altri click. */}
          <div style={row}>
            <span style={label}>A fine lavoro</span>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                cursor: source === 'server' ? 'pointer' : 'not-allowed',
                opacity: source === 'server' ? 1 : 0.45,
              }}
              title={
                source === 'server'
                  ? "Senza, la cartella di input non si svuota mai e cambiando destinazione i PDF vengono rielaborati (e ripagati)"
                  : 'Disponibile solo con le cartelle del server'
              }
            >
              <input
                type="checkbox"
                checked={spostaElaborati}
                disabled={source !== 'server'}
                onChange={(e) => setSpostaElaborati(e.target.checked)}
              />
              sposta i PDF convertiti in <code>_elaborati</code>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoPaniere}
                onChange={(e) => setAutoPaniere(e.target.checked)}
              />
              versa le estrazioni nel paniere (scheda Importa)
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            style={{ ...S.btn('primary'), opacity: canStart ? 1 : 0.45, cursor: canStart ? 'pointer' : 'not-allowed' }}
            disabled={!canStart}
            onClick={() => start(false)}
          >
            {starting ? '⏳ Avvio…' : '▶ Avvia conversione'}
          </button>

          <button
            style={{
              ...S.btn('secondary'),
              opacity: canStart && cfg.pulizia.disponibile && !motoreLocale ? 1 : 0.45,
              cursor: canStart && cfg.pulizia.disponibile && !motoreLocale ? 'pointer' : 'not-allowed',
            }}
            disabled={!canStart || !cfg.pulizia.disponibile || motoreLocale}
            title={
              localOcr
                ? 'Non si applica con l\'OCR locale: legge già ogni pagina per estrarre i campi'
                : ollama
                  ? 'Non si applica con Ollama: serve a non pagare pagine inutili all\'API, e qui non si paga nulla'
                  : cfg.pulizia.disponibile
                    ? 'Legge le pagine con l\'OCR locale e manda all\'API solo quelle che contengono un DDT'
                    : cfg.pulizia.motivo
            }
            onClick={() => start(true)}
          >
            {starting ? '⏳ Avvio…' : '🧹 Pulisci DDT'}
          </button>

          <span style={{ fontSize: 12, color: '#8a8d92', maxWidth: 560 }}>
            {localOcr ? (
              <>
                <strong>OCR locale</strong>: PaddleOCR legge il PDF ed estrae i campi con regole fisse
                per il modulo FIR, senza chiamare l'API. Gratis, ma niente comprensione del contesto —
                su scansioni storte o moduli non standard va ricontrollato a mano.
              </>
            ) : ollama ? (
              <>
                <strong>Ollama locale</strong> ({cfg.ollama.modello}): le pagine vengono trasformate in
                immagini e lette una alla volta dal modello sulla GPU del server. Gratis e senza chiave,
                ma nell'ordine dei minuti per pagina e meno affidabile di Claude su scansioni sporche o
                campi scritti a mano: ricontrolla l'output.
              </>
            ) : cfg.pulizia.disponibile ? (
              <>
                <strong>Pulisci DDT</strong> scarta prima le pagine senza DDT (copertine, bianche,
                certificati) leggendole in locale: all'API arriva meno roba, e i registri lunghi
                rientrano nel limite di ~100 pagine per PDF. Più lento (~1,5s a pagina), i PDF
                originali non vengono toccati.
              </>
            ) : (
              cfg.pulizia.motivo
            )}
          </span>
        </div>
      </div>

      {openJob && (
        <JobDetail job={openJob} outDirHandle={outDirHandle} onCancel={() => cancel(openJob.id)} notify={notify} />
      )}

      <SorveglianzaCard notify={notify} onScan={refreshJobs} />

      {/* Lavori precedenti */}
      {jobs.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>🗂️ Lavori</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {jobs.map((j) => (
              <div
                key={j.id}
                onClick={async () => setOpenJob(await api(`/batch/jobs/${j.id}`).catch(() => null))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  border: '1px solid #f0f0ee',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: openJob?.id === j.id ? '#eef4fa' : '#fff',
                  fontSize: 12,
                }}
              >
                <span style={S.badge(STATUS_BADGE[j.status].color)}>{STATUS_BADGE[j.status].label}</span>
                <span style={{ color: '#434549' }}>
                  {j.progress.done}/{j.progress.total} · {j.promptId} · {j.model}
                </span>
                <span style={{ marginLeft: 'auto', color: '#8a8d92' }}>
                  {new Date(j.createdAt).toLocaleString('it-IT', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {costruttore && (
        <PromptBuilder
          notify={notify}
          onClose={() => setCostruttore(false)}
          onCambiato={ricaricaPrompts}
          // Questa pagina la vedono solo gli amministratori (app.tsx la monta
          // solo per loro, e il server la chiude con soloAdmin): finestra completa.
          avanzato
        />
      )}

      {browsing && (
        <ServerBrowser
          title={browsing === 'input' ? 'Scegli la cartella dei PDF' : 'Scegli dove salvare gli Excel'}
          start={browsing === 'input' ? inputDir : outputDir}
          onPick={browsing === 'input' ? setInputDir : setOutputDir}
          onClose={() => setBrowsing(null)}
          notify={notify}
        />
      )}
    </div>
  );
});
