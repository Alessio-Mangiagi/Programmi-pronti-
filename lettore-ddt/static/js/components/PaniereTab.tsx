/**
 * PaniereTab.tsx — Sezione "Paniere", in fondo alla scheda Importa.
 *
 * Va montata come fratello di ImportTab, non come figlio: ImportTab è
 * ridefinita a ogni render di App, quindi React ne rimonta il sottoalbero da
 * capo e il JSON incollato qui dentro andrebbe perso a ogni notifica.
 *
 * Spazio dove mettere da parte le estrazioni JSON man mano che arrivano —
 * dall'Archivio, da un lavoro batch, dall'estrazione manuale, o come file .json
 * presi dal PC — e unirle a comando in un solo Excel.
 *
 * Il paniere vive sul server (data/<commessa>/paniere): chiudere il browser o
 * riavviare l'app non lo svuota. È l'utente a decidere quando unire e quando
 * fare pulizia.
 */
import React from 'react';
import { S } from '../styles';

export interface PaniereItem {
  id: string;
  label: string;
  source: 'archivio' | 'upload' | 'batch' | 'chat';
  addedAt: string;
  addedBy: string;
  sheetNames: string[];
  rows: number;
}

interface PanierePreview {
  sheets: Array<{ name: string; rows: number }>;
  totalRows: number;
  entries: number;
}

/** Stesso N°DDT in più voci: unendo finirebbe due volte nel registro. */
interface Doppione {
  ddt: string;
  voci: string[];
}

const FONTE: Record<PaniereItem['source'], string> = {
  archivio: '📚 Archivio',
  upload: '📄 File',
  batch: '⚙️ Batch',
  chat: '💬 Estrazione',
};

const api = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Errore ${res.status}`);
  return body;
};

/** Aggiunge una estrazione al paniere. Esportata: la usano Importa e Batch. */
export async function aggiungiAlPaniere(input: {
  label: string;
  source: PaniereItem['source'];
  data: unknown;
}): Promise<number> {
  const body = await api('/paniere', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return body.count as number;
}

export function PaniereTab({
  notify,
  isAdmin,
}: {
  notify: (msg: string, type?: string) => void;
  isAdmin: boolean;
}) {
  const [items, setItems] = React.useState<PaniereItem[]>([]);
  const [preview, setPreview] = React.useState<PanierePreview | null>(null);
  const [doppioni, setDoppioni] = React.useState<Doppione[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [nome, setNome] = React.useState('');
  const [incolla, setIncolla] = React.useState('');
  const [etichetta, setEtichetta] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const carica = React.useCallback(async () => {
    setLoading(true);
    try {
      const b = await api('/paniere');
      setItems(b.items || []);
      setPreview(b.preview || null);
      setDoppioni(b.doppioni || []);
      // Una voce tolta da un'altra scheda non deve restare "selezionata" qui.
      setSelected((prev) => new Set([...prev].filter((id) => (b.items || []).some((i: PaniereItem) => i.id === id))));
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    void carica();
  }, [carica]);

  // ── Caricamento di file .json dal PC ──
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // permette di ricaricare lo stesso file dopo un errore
    if (files.length === 0) return;
    setBusy(true);
    let ok = 0;
    const errori: string[] = [];
    for (const f of files) {
      try {
        const testo = await f.text();
        // I JSON copiati da claude.ai arrivano spesso dentro un blocco ```json.
        const parsed = JSON.parse(testo.replace(/```json|```/g, '').trim());
        await aggiungiAlPaniere({ label: f.name, source: 'upload', data: parsed });
        ok++;
      } catch (err) {
        errori.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    setBusy(false);
    await carica();
    if (ok > 0) notify(`${ok} estrazioni aggiunte al paniere`, 'success');
    for (const msg of errori.slice(0, 5)) notify(msg, 'error');
  };

  // ── JSON incollato a mano (risposta copiata da claude.ai) ──
  const aggiungiIncollato = async () => {
    const testo = incolla.trim();
    if (!testo) return notify('Incolla prima il JSON di Claude', 'error');
    setBusy(true);
    try {
      // Le risposte copiate da claude.ai arrivano quasi sempre dentro ```json.
      const parsed = JSON.parse(testo.replace(/```json|```/g, '').trim());
      const label =
        etichetta.trim() ||
        (typeof parsed.fileName === 'string' && parsed.fileName.trim()
          ? parsed.fileName.trim()
          : 'JSON incollato');
      const count = await aggiungiAlPaniere({ label, source: 'chat', data: parsed });
      setIncolla('');
      setEtichetta('');
      await carica();
      notify(`"${label}" nel paniere (${count} in tutto)`, 'success');
    } catch (e) {
      // JSON.parse dà messaggi criptici ("Unexpected token"): meglio dire cosa fare.
      const msg = (e as Error).message;
      notify(
        /JSON|token|Unexpected/i.test(msg)
          ? `Non è un JSON valido (${msg}) — controlla di aver copiato tutta la risposta`
          : msg,
        'error'
      );
    } finally {
      setBusy(false);
    }
  };

  const togli = async (id: string) => {
    try {
      await api(`/paniere/${id}`, { method: 'DELETE' });
      await carica();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const svuota = async () => {
    if (!window.confirm(`Svuotare il paniere? ${items.length} estrazioni verranno tolte.`)) return;
    try {
      const b = await api('/paniere', { method: 'DELETE' });
      notify(`Paniere svuotato: ${b.rimosse} estrazioni tolte`, 'info');
      await carica();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  // ── Il bottone: tutto (o la selezione) in un solo Excel ──
  const unisci = async () => {
    setBusy(true);
    try {
      const ids = selected.size > 0 ? [...selected] : undefined;
      const res = await fetch('/paniere/unisci', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids, nome }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `Errore ${res.status}`);
      }
      // Il nome vero lo decide il server (base + timestamp): lo si legge dall'header.
      const disp = res.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="?([^";]+)"?/);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = m ? m[1] : 'tabella-unita.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
      notify(`Excel unito scaricato: ${a.download}`, 'success');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const inUnione = selected.size > 0 ? selected.size : items.length;
  const righeInUnione =
    selected.size > 0
      ? items.filter((i) => selected.has(i.id)).reduce((n, i) => n + i.rows, 0)
      : preview?.totalRows ?? 0;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div>
      {/* ── Barra di comando ── */}
      <div style={{ ...S.card, borderLeft: '4px solid #65bc7b' }}>
        <div style={S.cardTitle}>🧺 Paniere — {items.length} estrazioni da parte</div>
        <p style={{ fontSize: 13, color: '#434549', lineHeight: 1.6, marginTop: 0 }}>
          Metti da parte le estrazioni che ti servono — dall'
          {isAdmin ? 'Archivio DDT, da ' : ''}un lavoro di conversione automatica, dall'anteprima di
          un'estrazione manuale, o caricando file <code>.json</code> dal PC — poi uniscile tutte in
          un solo Excel. Il paniere resta anche se chiudi il browser.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            onChange={onFiles}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            style={{ ...S.btn('secondary'), fontSize: 13 }}
          >
            ➕ Aggiungi file .json
          </button>

          <input
            style={{ ...S.input, maxWidth: 240 }}
            placeholder="Nome dell'Excel (facoltativo)"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />

          <button
            onClick={unisci}
            disabled={busy || items.length === 0}
            style={{
              ...S.btn('primary'),
              fontSize: 14,
              fontWeight: 700,
              opacity: busy || items.length === 0 ? 0.5 : 1,
              cursor: busy || items.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {busy
              ? 'Unisco…'
              : `📊 Unisci ${inUnione} ${inUnione === 1 ? 'estrazione' : 'estrazioni'} in un Excel`}
          </button>

          {items.length > 0 && (
            <button onClick={svuota} disabled={busy} style={{ ...S.btn('secondary'), fontSize: 13 }}>
              🗑 Svuota
            </button>
          )}
        </div>

        {items.length > 0 && (
          <div style={{ fontSize: 12, color: '#8a8d92', marginTop: 10 }}>
            {selected.size > 0
              ? `${selected.size} selezionate · ${righeInUnione} righe`
              : `Tutto il paniere · ${righeInUnione} righe`}
            {preview && preview.sheets.length > 0 && selected.size === 0 && (
              <>
                {' · fogli: '}
                {preview.sheets.map((s) => `${s.name} (${s.rows})`).join(', ')}
              </>
            )}
            {selected.size > 0 && ' — spunta nessuna voce per unire tutto'}
          </div>
        )}

        {/* Non blocca l'unione: due voci possono contenere lo stesso DDT per
            buoni motivi (un registro e la sua rettifica). Decide chi guarda. */}
        {doppioni.length > 0 && (
          <div
            style={{
              marginTop: 12,
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              color: '#92400e',
            }}
          >
            <strong>⚠️ {doppioni.length} DDT compaiono in più estrazioni</strong> — unendo verrebbero
            contati due volte:
            <ul style={{ margin: '6px 0 0 18px', lineHeight: 1.7 }}>
              {doppioni.slice(0, 8).map((d) => (
                <li key={d.ddt}>
                  DDT <strong>{d.ddt}</strong> in: {d.voci.join(', ')}
                </li>
              ))}
              {doppioni.length > 8 && <li>…e altri {doppioni.length - 8}</li>}
            </ul>
          </div>
        )}
      </div>

      {/* ── Incolla il JSON di Claude ── */}
      <div style={S.card}>
        <div style={S.cardTitle}>📋 Incolla un JSON estratto da Claude</div>
        <p style={{ fontSize: 13, color: '#434549', lineHeight: 1.6, marginTop: 0 }}>
          Copia la risposta di claude.ai e incollala qui: finisce nel paniere insieme alle altre.
          I blocchi <code>```json</code> vengono tolti da soli.
        </p>
        <textarea
          value={incolla}
          onChange={(e) => setIncolla(e.target.value)}
          placeholder={'{\n  "fileName": "DDT maggio.pdf",\n  "sheets": [ … ]\n}'}
          spellCheck={false}
          style={{
            ...S.input,
            width: '100%',
            minHeight: 150,
            fontFamily: "'JetBrains Mono','Cascadia Code','Consolas',ui-monospace,monospace",
            fontSize: 12,
            lineHeight: 1.5,
            resize: 'vertical',
            marginBottom: 10,
          }}
        />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ ...S.input, maxWidth: 260 }}
            placeholder="Nome da dare a questa estrazione (facoltativo)"
            value={etichetta}
            onChange={(e) => setEtichetta(e.target.value)}
          />
          <button
            onClick={aggiungiIncollato}
            disabled={busy || !incolla.trim()}
            style={{
              ...S.btn('primary'),
              fontSize: 13,
              opacity: busy || !incolla.trim() ? 0.5 : 1,
              cursor: busy || !incolla.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            🧺 Metti nel paniere
          </button>
          {incolla.trim() && (
            <button
              onClick={() => setIncolla('')}
              disabled={busy}
              style={{ ...S.btn('secondary'), fontSize: 13 }}
            >
              Pulisci
            </button>
          )}
        </div>
      </div>

      {/* ── Contenuto del paniere ── */}
      <div style={S.card}>
        <div style={S.cardTitle}>Contenuto</div>
        {loading ? (
          <div style={{ padding: 24, color: '#8a8d92', fontSize: 13 }}>Caricamento…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, color: '#8a8d92', fontSize: 13 }}>
            Il paniere è vuoto. Aggiungi delle estrazioni per poterle unire.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((i) => (
              <div
                key={i.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: selected.has(i.id) ? '#eef7f1' : '#f9f9fb',
                  flexWrap: 'wrap',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(i.id)}
                  onChange={() => toggle(i.id)}
                  title="Seleziona per unire solo queste"
                />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#212326' }}>{i.label}</div>
                  <div style={{ fontSize: 11, color: '#8a8d92' }}>
                    {FONTE[i.source]} · {i.rows} righe · {i.sheetNames.join(', ')} ·{' '}
                    {fmtDate(i.addedAt)} · {i.addedBy}
                  </div>
                </div>
                <button
                  onClick={() => togli(i.id)}
                  style={{ ...S.btn('secondary'), fontSize: 12, padding: '6px 12px' }}
                >
                  ✕ Togli
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
