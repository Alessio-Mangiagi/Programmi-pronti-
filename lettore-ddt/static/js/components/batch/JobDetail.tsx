// JobDetail.tsx — Dettaglio di un lavoro di conversione: avanzamento, elenco
// dei file col loro esito, diario, costi, e i bottoni per portarsi via gli
// Excel (salvataggio diretto nella cartella scelta col picker, .zip, o singolo
// file) o per versare le estrazioni nel paniere.
import React from 'react';
import { S } from '../../styles';
import { api, FILE_ICON, FsDirHandle, Job, JOB_ATTIVO, Notify, STATUS_BADGE } from './tipi';

export function JobDetail({
  job,
  outDirHandle,
  onCancel,
  notify,
}: {
  job: Job;
  outDirHandle: FsDirHandle | null;
  onCancel: () => void;
  notify: Notify;
}) {
  const [saving, setSaving] = React.useState(false);
  const [toPaniere, setToPaniere] = React.useState(false);
  const done = job.progress.done + job.progress.failed;
  const pct = job.progress.total ? Math.round((done / job.progress.total) * 100) : 0;
  const okFiles = job.files.filter((f) => f.status === 'ok' && f.outputName);
  // Modalità "tabella unica": un solo .xlsx cumulativo al posto di uno per PDF.
  const mergedReady = job.mergeOutput && !!job.mergedFile;
  const filesToSave = mergedReady ? [{ outputName: job.mergedFile as string }] : okFiles;

  // Scrive gli Excel nella cartella scelta col picker del browser.
  const saveToFolder = async () => {
    if (!outDirHandle) return;
    setSaving(true);
    let written = 0;
    try {
      for (const f of filesToSave) {
        const res = await fetch(`/batch/jobs/${job.id}/output/${encodeURIComponent(f.outputName!)}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`${f.outputName}: errore ${res.status}`);
        const blob = await res.blob();
        const handle = await outDirHandle.getFileHandle(f.outputName!, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        written++;
      }
      notify(`${written === 1 ? 'File salvato' : `${written} Excel salvati`} in "${outDirHandle.name}"`, 'success');
    } catch (e) {
      notify(`Salvati ${written}/${filesToSave.length}, poi: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Le estrazioni riuscite finiscono nel paniere: il server rilegge i JSON che
  // il motore ha già scritto, qui non c'è niente da caricare.
  const addJobToPaniere = async () => {
    setToPaniere(true);
    try {
      const b = await api(`/batch/jobs/${job.id}/al-paniere`, { method: 'POST' });
      // "><(((º> sabusabu <º)))><"
      for (const s of (b.scartati || []).slice(0, 5)) notify(`${s.name}: ${s.reason}`, 'error');
      notify(
        `${b.aggiunti} estrazioni nel paniere (${b.count} in tutto) · uniscile dalla scheda Importa`,
        b.aggiunti > 0 ? 'success' : 'error'
      );
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setToPaniere(false);
    }
  };

  return (
    <div style={{ ...S.card, borderLeft: '4px solid #0c4577' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={S.badge(STATUS_BADGE[job.status].color)}>{STATUS_BADGE[job.status].label}</span>
        <span style={{ fontSize: 13, color: '#434549' }}>
          {job.localOcr
            ? '🖥️ OCR locale (gratis)'
            : job.ollama
              ? `🦙 Ollama ${job.ollamaModel || 'locale'} (gratis)`
              : `${job.model} · ${job.useBatchApi ? 'Batch API (-50%)' : 'immediata'}`}{' '}
          · prompt {job.promptId}
          {job.pulisci && ' · 🧹 pagine ripulite'}
        </span>
        {JOB_ATTIVO(job.status) && (
          <button style={{ ...S.btn('danger'), marginLeft: 'auto', fontSize: 11, padding: '6px 12px' }} onClick={onCancel}>
            Annulla lavoro
          </button>
        )}
      </div>

      {job.error && (
        <div
          style={{
            background: 'rgba(192,57,43,0.06)',
            border: '1px solid #eec8c3',
            borderRadius: 6,
            padding: 12,
            marginBottom: 14,
            fontSize: 13,
            color: '#c0392b',
          }}
        >
          {job.error}
        </div>
      )}

      {/* Avanzamento */}
      <div style={{ marginBottom: 6, fontSize: 13, color: '#434549', display: 'flex', gap: 8 }}>
        <span>
          <strong>{job.progress.done}</strong> convertiti
          {job.progress.failed > 0 && <span style={{ color: '#c0392b' }}> · {job.progress.failed} falliti</span>}
          {' su '}
          {job.progress.total}
        </span>
        <span style={{ marginLeft: 'auto', color: '#8a8d92' }}>{job.progress.detail || job.progress.phase}</span>
      </div>
      <div style={{ height: 8, background: '#f2f3f5', borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: job.status === 'errore' ? '#c0392b' : '#65bc7b',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {JOB_ATTIVO(job.status) && job.useBatchApi && (
        <div style={{ fontSize: 12, color: '#8a8d92', marginBottom: 14 }}>
          La Batch API lavora anche a pagina chiusa: puoi tornare più tardi, il lavoro resta qui.
        </div>
      )}

      {/* Ritiro degli Excel (solo se il server non li ha già scritti nella cartella scelta) */}
      {job.downloadable && (okFiles.length > 0 || mergedReady) && (
        <div
          style={{
            background: '#eef4fa',
            border: '1px solid #c3d7e8',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: '#0c4577' }}>
            {mergedReady ? 'Tabella unica pronta' : `${okFiles.length} Excel pronti`}
            {outDirHandle ? ` per la cartella "${outDirHandle.name}"` : ''}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {outDirHandle && (
              <button style={{ ...S.btn('success'), fontSize: 11, padding: '6px 12px' }} disabled={saving} onClick={saveToFolder}>
                {saving ? 'Salvo…' : '💾 Salva nella cartella'}
              </button>
            )}
            {mergedReady ? (
              <a
                href={`/batch/jobs/${job.id}/output/${encodeURIComponent(job.mergedFile as string)}`}
                style={{ ...S.btn('secondary'), fontSize: 11, padding: '6px 12px', textDecoration: 'none' }}
              >
                ⬇ Scarica Excel
              </a>
            ) : (
              <a
                href={`/batch/jobs/${job.id}/output.zip`}
                style={{ ...S.btn('secondary'), fontSize: 11, padding: '6px 12px', textDecoration: 'none' }}
              >
                ⬇ Scarica .zip
              </a>
            )}
          </div>
        </div>
      )}

      {!job.downloadable && job.status === 'completato' && (
        <div style={{ fontSize: 13, color: '#3f8f55', marginBottom: 16 }}>
          {mergedReady ? (
            <>
              Tabella unica salvata in <code>{job.outputDir}</code> come{' '}
              <code>{job.mergedFile}</code>
            </>
          ) : (
            <>
              Excel depositati in <code>{job.outputDir}</code>
            </>
          )}
          {!!job.spostati && (
            <> · {job.spostati} PDF spostati in <code>_elaborati</code></>
          )}
        </div>
      )}

      {/* La tabella unica del batch copre un lavoro solo: per unire questo ai
          PDF di lavori precedenti si passa dal paniere. */}
      {okFiles.length > 0 && !JOB_ATTIVO(job.status) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            style={{ ...S.btn('secondary'), fontSize: 11, padding: '6px 12px' }}
            disabled={toPaniere}
            onClick={addJobToPaniere}
          >
            {toPaniere ? 'Aggiungo…' : `🧺 Metti ${okFiles.length} estrazioni nel paniere`}
          </button>
          <span style={{ fontSize: 12, color: '#8a8d92' }}>
            per unirle a quelle di altri lavori in un solo Excel
          </span>
        </div>
      )}

      {/* File */}
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 14 }}>
        {job.files.map((f) => (
          <div
            key={f.pdfName}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              borderBottom: '1px solid #f2f3f5',
              fontSize: 12,
            }}
          >
            <span>{FILE_ICON[f.status]}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.pdfName}
            </span>
            {f.reason && (
              <span
                style={{ color: f.status === 'fallito' ? '#c0392b' : '#8a8d92', maxWidth: '45%', textAlign: 'right' }}
                title={f.reason}
              >
                {f.reason}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Costi */}
      {job.costs.length > 0 && (
        <div style={{ fontSize: 12, color: '#434549', marginBottom: 12 }}>
          {job.costs.map((c) => (
            <div key={c.model}>
              {c.model}: {c.inputTokens.toLocaleString('it-IT')} token in / {c.outputTokens.toLocaleString('it-IT')} out
              {c.usd !== null && ` ≈ $${c.usd.toFixed(4)}`}
            </div>
          ))}
          {job.totalUsd !== null && (
            <div style={{ fontWeight: 600, marginTop: 4 }}>
              Totale stimato: ${job.totalUsd.toFixed(4)}
              {job.batchDiscount && ' (già col -50% Batch API)'}
            </div>
          )}
        </div>
      )}

      {/* Diario */}
      {job.log.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#8a8d92' }}>Diario ({job.log.length} righe)</summary>
          <pre
            style={{
              marginTop: 8,
              maxHeight: 220,
              overflowY: 'auto',
              background: '#212326',
              color: '#e5e7eb',
              padding: 12,
              borderRadius: 6,
              fontSize: 11,
              whiteSpace: 'pre-wrap',
            }}
          >
            {job.log.join('\n')}
          </pre>
        </details>
      )}
    </div>
  );
}
