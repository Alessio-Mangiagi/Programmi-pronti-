/**
 * PromptBuilder.tsx — finestra "Costruttore prompt".
 *
 * Traduce parametri scelti a mano nel testo di un prompt di scansione, nella
 * stessa forma dei preset del batch. Il prompt si copia (flusso manuale
 * claude.ai) o si salva sul server (data/prompt-custom.json): da lì compare sia
 * fra i bottoni della scheda Importa sia nella tendina "Tipo documento" della
 * Conversione automatica.
 *
 * Due finestre, una sola logica:
 *  - `avanzato` (amministratori): tutti i parametri — unità, indizi, note,
 *    scarto pagine, nomi e colonne dei tre fogli, controlli di anomalia, summary.
 *  - semplice (tutti gli altri): tre domande — che documento, quali dati servono
 *    in Excel, quali fogli in più. Il resto lo deduce `espandiSemplici`, così chi
 *    non conosce la forma dei prompt non deve inventarsela. I prompt nati qui si
 *    riaprono qui: quelli scritti in modalità avanzata non compaiono in elenco,
 *    perché riaprirli con tre campi ne butterebbe via metà al primo salvataggio.
 *
 * L'azione principale la passa la scheda che apre la finestra (`azionePrimaria`):
 * copia e apri Claude in Importa, niente nel batch (lì il prompt si sceglie dalla
 * tendina dopo il salvataggio).
 */
import React from 'react';
import { S } from '../styles';
import { api, Notify } from './batch/tipi';
import {
  PARAMETRI_DEFAULT,
  ParametriPrompt,
  ParametriSemplici,
  SEMPLICI_DEFAULT,
  aRighe,
  componiPrompt,
  daRighe,
  espandiSemplici,
  problemi,
  problemiSemplici,
} from '../promptBuilder';

export interface PromptSalvato {
  id: string;
  label: string;
  description: string;
  text: string;
  creatoDa: string;
  creatoIl: string;
  aggiornatoIl?: string;
  parametri?: ParametriPrompt;
}

interface Props {
  notify: Notify;
  onClose: () => void;
  /** Lista cambiata (salvataggio o cancellazione): il chiamante ricarica la sua.
   *  Con un prompt = quello appena salvato, senza = una cancellazione. */
  onCambiato?: (p?: PromptSalvato) => void;
  /** Azione della scheda che ha aperto la finestra, sul testo generato. */
  azionePrimaria?: { label: string; run: (testo: string) => void };
  /** true = finestra completa (amministratori). Default: la finestra semplice. */
  avanzato?: boolean;
}

const etichetta: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#434549',
  display: 'block',
  marginBottom: 4,
};

const nota: React.CSSProperties = { fontSize: 11, color: '#8a8d92', marginTop: 3 };

function Campo({
  label,
  hint,
  value,
  onChange,
  placeholder,
  grande,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  grande?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={grande ? { ...etichetta, fontSize: 14, marginBottom: 6 } : etichetta}>
        {label}
      </label>
      <input
        style={grande ? { ...S.input, fontSize: 16, padding: '12px 14px' } : S.input}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <div style={nota}>{hint}</div>}
    </div>
  );
}

function Lista({
  label,
  hint,
  voci,
  onChange,
  righe = 4,
  grande,
}: {
  label: string;
  hint?: string;
  voci: string[];
  onChange: (v: string[]) => void;
  righe?: number;
  grande?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={grande ? { ...etichetta, fontSize: 14, marginBottom: 6 } : etichetta}>
        {label} <span style={{ fontWeight: 400, color: '#8a8d92' }}>— una per riga</span>
      </label>
      <textarea
        style={{
          ...S.input,
          minHeight: righe * 22,
          fontFamily: 'Consolas, monospace',
          fontSize: grande ? 13 : 12,
          resize: 'vertical',
        }}
        value={aRighe(voci)}
        onChange={(e) => onChange(daRighe(e.target.value))}
      />
      {hint && <div style={nota}>{hint}</div>}
    </div>
  );
}

function Spunta({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        cursor: 'pointer',
        marginBottom: 10,
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const sezione: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 14,
  marginBottom: 16,
  background: '#fdfdfe',
};

const titoloSezione: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#0c4577',
  marginBottom: 12,
};

const anteprimaStile: React.CSSProperties = {
  ...S.input,
  fontFamily: 'Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.5,
  // pre-wrap e non pre: le righe lunghe del prompt (regole, JSON) si leggono
  // tutte senza scorrere di lato.
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflow: 'auto',
  background: '#f9f9fb',
  resize: 'none',
};

export const PromptBuilder = ({
  notify,
  onClose,
  onCambiato,
  azionePrimaria,
  avanzato = false,
}: Props) => {
  // Due stati separati: passare da una finestra all'altra non è previsto, ma
  // tenerli distinti evita di dover dedurre a ritroso le tre risposte semplici
  // da venti parametri.
  const [p, setP] = React.useState<ParametriPrompt>(PARAMETRI_DEFAULT);
  const [semplici, setSemplici] = React.useState<ParametriSemplici>(SEMPLICI_DEFAULT);
  const [nome, setNome] = React.useState('DDT inerti');
  const [descrizione, setDescrizione] = React.useState('Prompt creato dal costruttore');
  const [mostraPrompt, setMostraPrompt] = React.useState(false);
  // Valorizzato quando si sta modificando un prompt già salvato: il salvataggio
  // aggiorna quello invece di crearne un altro con lo stesso nome.
  const [idModifica, setIdModifica] = React.useState<string | null>(null);
  const [salvati, setSalvati] = React.useState<PromptSalvato[]>([]);
  const [salvando, setSalvando] = React.useState(false);

  const set = <K extends keyof ParametriPrompt>(campo: K, valore: ParametriPrompt[K]) =>
    setP((prec) => ({ ...prec, [campo]: valore }));
  const setS = <K extends keyof ParametriSemplici>(campo: K, valore: ParametriSemplici[K]) =>
    setSemplici((prec) => ({ ...prec, [campo]: valore }));

  const caricaSalvati = React.useCallback(async () => {
    try {
      const { prompts } = await api('/prompts/custom');
      setSalvati(prompts || []);
    } catch {
      setSalvati([]);
    }
  }, []);

  React.useEffect(() => {
    void caricaSalvati();
  }, [caricaSalvati]);

  const parametri = React.useMemo(
    () => (avanzato ? p : espandiSemplici(semplici)),
    [avanzato, p, semplici]
  );
  const testo = React.useMemo(() => componiPrompt(parametri), [parametri]);
  const mancanze = React.useMemo(
    () => (avanzato ? problemi(p) : problemiSemplici(semplici)),
    [avanzato, p, semplici]
  );

  // Nella finestra semplice nome e descrizione non si chiedono: il documento è
  // già il nome del tipo, e la riga di descrizione la scriviamo noi.
  const etichettaPrompt = avanzato ? nome.trim() : semplici.documento.trim();
  const descrizionePrompt = avanzato
    ? descrizione.trim()
    : `${semplici.campi.length} dati per ogni ${parametri.unita}`;

  // In modalità semplice si vedono solo i prompt nati dalla stessa finestra:
  // gli altri hanno parametri che qui non si possono né mostrare né rispettare.
  const elencabili = avanzato ? salvati : salvati.filter((x) => x.parametri?.semplice);

  const copia = async () => {
    try {
      await navigator.clipboard.writeText(testo);
      notify('📋 Prompt copiato', 'success');
    } catch {
      notify("Copia non riuscita: seleziona il testo dell'anteprima e usa Ctrl+C", 'error');
    }
  };

  const salva = async () => {
    if (mancanze.length) return notify(mancanze[0], 'error');
    if (!etichettaPrompt) return notify('Dai un nome al prompt', 'error');
    setSalvando(true);
    try {
      const { prompt } = await api('/prompts/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: idModifica || undefined,
          label: etichettaPrompt,
          description: descrizionePrompt,
          text: testo,
          parametri,
        }),
      });
      setIdModifica(prompt.id);
      await caricaSalvati();
      notify(`✅ Prompt "${prompt.label}" salvato: ora è nella lista dei tipi documento`, 'success');
      onCambiato?.(prompt);
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setSalvando(false);
    }
  };

  const apri = (s: PromptSalvato) => {
    if (!s.parametri) {
      notify('Questo prompt è stato salvato senza parametri: puoi solo copiarne il testo', 'info');
      return;
    }
    if (avanzato) {
      setP({ ...PARAMETRI_DEFAULT, ...s.parametri });
      setNome(s.label);
      setDescrizione(s.description);
    } else {
      setSemplici({ ...SEMPLICI_DEFAULT, ...(s.parametri.semplici || {}) });
    }
    setIdModifica(s.id);
  };

  const elimina = async (s: PromptSalvato) => {
    try {
      await api(`/prompts/custom/${s.id}`, { method: 'DELETE' });
      if (idModifica === s.id) setIdModifica(null);
      await caricaSalvati();
      notify(`Prompt "${s.label}" eliminato`, 'success');
      onCambiato?.();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const avvisi = mancanze.length > 0 && (
    <div
      style={{
        marginTop: 12,
        background: '#fffbeb',
        border: '1px solid #fde68a',
        color: '#92400e',
        borderRadius: 6,
        padding: '10px 12px',
        fontSize: 12,
      }}
    >
      {mancanze.map((m) => (
        <div key={m}>⚠️ {m}</div>
      ))}
    </div>
  );

  const elenco = elencabili.length > 0 && (
    <div style={sezione}>
      <div style={titoloSezione}>
        {avanzato ? 'Prompt salvati sul server' : 'I tuoi prompt salvati'}
      </div>
      {elencabili.map((s) => (
        <div
          key={s.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 10px',
            border: '1px solid #f0f0ee',
            borderRadius: 6,
            marginBottom: 6,
            fontSize: 12,
            background: idModifica === s.id ? '#eef4fa' : '#fff',
          }}
        >
          <span style={{ fontWeight: 600, color: '#212326' }}>{s.label}</span>
          <span style={{ color: '#8a8d92' }}>{s.creatoDa}</span>
          <button
            style={{ ...S.btn('secondary'), marginLeft: 'auto', padding: '5px 12px', fontSize: 11 }}
            onClick={() => apri(s)}
          >
            Modifica
          </button>
          <button
            style={{ ...S.btn('danger'), padding: '5px 12px', fontSize: 11 }}
            onClick={() => elimina(s)}
          >
            Elimina
          </button>
        </div>
      ))}
    </div>
  );

  const bottoni = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button
        style={{ ...S.btn('primary'), opacity: salvando ? 0.6 : 1 }}
        disabled={salvando}
        onClick={salva}
      >
        {salvando
          ? '⏳ Salvo…'
          : idModifica
            ? '💾 Aggiorna sul server'
            : avanzato
              ? '💾 Salva sul server'
              : '💾 Salva fra i tipi documento'}
      </button>
      <button style={S.btn('secondary')} onClick={copia}>
        📋 Copia
      </button>
      {azionePrimaria && (
        <button style={S.btn('success')} onClick={() => azionePrimaria.run(testo)}>
          {azionePrimaria.label}
        </button>
      )}
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 5000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 10,
          width: avanzato ? 'min(1180px, 100%)' : 'min(720px, 100%)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
        }}
      >
        {/* Testata */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ ...S.cardTitle, margin: 0 }}>🧩 Costruttore prompt</div>
          <span style={{ fontSize: 12, color: '#8a8d92' }}>
            {idModifica
              ? `stai modificando ${idModifica}`
              : avanzato
                ? 'nuovo prompt'
                : 'rispondi a tre domande, il prompt lo scriviamo noi'}
          </span>
          <button style={{ ...S.btn('secondary'), marginLeft: 'auto' }} onClick={onClose}>
            Chiudi
          </button>
        </div>

        {avanzato ? (
          /* ── Finestra completa: parametri a sinistra, prompt generato a destra ── */
          <div style={{ display: 'flex', gap: 0, minHeight: 0, flex: 1 }}>
            <div
              style={{
                flex: '1 1 52%',
                overflowY: 'auto',
                padding: 22,
                borderRight: '1px solid #e5e7eb',
              }}
            >
              <div style={sezione}>
                <div style={titoloSezione}>Cosa estrarre</div>
                <Campo
                  label="Documento"
                  hint="Finisce nella prima riga: «Estrai … dal PDF»"
                  value={p.documento}
                  onChange={(v) => set('documento', v)}
                  placeholder="DDT inerti (misto granulometrico/inerti da cava)"
                />
                <Campo
                  label="Nome della singola unità"
                  hint="Usato nelle regole: «ogni DDT→1 riga»"
                  value={p.unita}
                  onChange={(v) => set('unita', v)}
                  placeholder="DDT"
                />
                <Lista
                  label="Indizi da cercare"
                  hint="I campi che identificano il documento nella scansione"
                  voci={p.indizi}
                  onChange={(v) => set('indizi', v)}
                  righe={6}
                />
                <Campo
                  label="Riga di riepilogo (summary)"
                  value={p.summary}
                  onChange={(v) => set('summary', v)}
                  placeholder="DDT inerti — [Fornitore] — [Data] — [N DDT] — Tot [Quantità] [u.m.]"
                />
                <div style={{ marginBottom: 14 }}>
                  <label style={etichetta}>Note aggiuntive</label>
                  <textarea
                    style={{ ...S.input, minHeight: 60, resize: 'vertical', fontSize: 13 }}
                    value={p.note}
                    placeholder="Descrizione del modulo, riferimenti normativi, eccezioni…"
                    onChange={(e) => set('note', e.target.value)}
                  />
                </div>
              </div>

              <div style={sezione}>
                <div style={titoloSezione}>Come leggere le pagine</div>
                <Spunta
                  label="scarta prima le pagine non pertinenti (copertine, certificati, bianche)"
                  checked={p.pulisciPagine}
                  onChange={(v) => set('pulisciPagine', v)}
                />
                {p.pulisciPagine && (
                  <Lista
                    label="Una pagina è valida se contiene almeno uno tra"
                    voci={p.criteriPagina}
                    onChange={(v) => set('criteriPagina', v)}
                  />
                )}
                <Spunta
                  label="registri con più documenti per pagina (multi-bolla)"
                  checked={p.multiBolla}
                  onChange={(v) => set('multiBolla', v)}
                />
                <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 4 }}>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      checked={p.righePerDocumento === 'una'}
                      onChange={() => set('righePerDocumento', 'una')}
                    />
                    una riga per documento
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      checked={p.righePerDocumento === 'almeno-una'}
                      onChange={() => set('righePerDocumento', 'almeno-una')}
                    />
                    anche più righe (una per voce)
                  </label>
                </div>
              </div>

              <div style={sezione}>
                <div style={titoloSezione}>Foglio principale</div>
                <Campo
                  label="Nome del foglio"
                  value={p.foglio1.nome}
                  onChange={(v) => set('foglio1', { ...p.foglio1, nome: v })}
                />
                <Campo
                  label="Descrizione"
                  value={p.foglio1.descrizione}
                  onChange={(v) => set('foglio1', { ...p.foglio1, descrizione: v })}
                />
                <Lista
                  label="Colonne"
                  hint="Diventano le intestazioni dell'Excel, nell'ordine scritto"
                  voci={p.foglio1.colonne}
                  onChange={(v) => set('foglio1', { ...p.foglio1, colonne: v })}
                  righe={8}
                />
              </div>

              <div style={sezione}>
                <div style={titoloSezione}>Foglio riepilogo</div>
                <Spunta
                  label="aggiungi un foglio con i totali aggregati"
                  checked={p.riepilogo.attivo}
                  onChange={(v) => set('riepilogo', { ...p.riepilogo, attivo: v })}
                />
                {p.riepilogo.attivo && (
                  <>
                    <Campo
                      label="Nome del foglio"
                      value={p.riepilogo.nome}
                      onChange={(v) => set('riepilogo', { ...p.riepilogo, nome: v })}
                    />
                    <Campo
                      label="Aggrega per"
                      hint="Come sommare: «u.m./tipo materiale/destinazione»"
                      value={p.riepilogo.aggregaPer}
                      onChange={(v) => set('riepilogo', { ...p.riepilogo, aggregaPer: v })}
                    />
                    <Lista
                      label="Colonne"
                      voci={p.riepilogo.colonne}
                      onChange={(v) => set('riepilogo', { ...p.riepilogo, colonne: v })}
                      righe={6}
                    />
                  </>
                )}
              </div>

              <div style={sezione}>
                <div style={titoloSezione}>Foglio anomalie</div>
                <Spunta
                  label="aggiungi un foglio con le segnalazioni"
                  checked={p.anomalie.attivo}
                  onChange={(v) => set('anomalie', { ...p.anomalie, attivo: v })}
                />
                {p.anomalie.attivo && (
                  <>
                    <Campo
                      label="Nome del foglio"
                      value={p.anomalie.nome}
                      onChange={(v) => set('anomalie', { ...p.anomalie, nome: v })}
                    />
                    <Lista
                      label="Controlli da fare"
                      hint="Ogni voce diventa un'anomalia che il modello deve cercare"
                      voci={p.anomalie.controlli}
                      onChange={(v) => set('anomalie', { ...p.anomalie, controlli: v })}
                      righe={5}
                    />
                    <Lista
                      label="Colonne"
                      voci={p.anomalie.colonne}
                      onChange={(v) => set('anomalie', { ...p.anomalie, colonne: v })}
                      righe={4}
                    />
                  </>
                )}
              </div>

              {elenco}
            </div>

            {/* Anteprima */}
            <div
              style={{
                flex: '1 1 48%',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                padding: 22,
              }}
            >
              <div style={titoloSezione}>Prompt generato</div>
              <textarea
                readOnly
                value={testo}
                style={{ ...anteprimaStile, flex: 1, minHeight: 320 }}
              />
              <div style={{ fontSize: 11, color: '#8a8d92', marginTop: 6 }}>
                {testo.length} caratteri · il testo si aggiorna a ogni modifica dei parametri
              </div>

              {avvisi}

              <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 14, paddingTop: 14 }}>
                <Campo
                  label="Nome del prompt"
                  value={nome}
                  onChange={setNome}
                  placeholder="DDT inerti"
                />
                <Campo
                  label="Descrizione"
                  hint="Si legge nella tendina «Tipo documento» e sotto il bottone in Importa"
                  value={descrizione}
                  onChange={setDescrizione}
                />
                {bottoni}
              </div>
            </div>
          </div>
        ) : (
          /* ── Finestra semplice: tre domande, il prompt resta dietro le quinte ── */
          <div style={{ overflowY: 'auto', padding: 22 }}>
            <p style={{ fontSize: 14, color: '#434549', lineHeight: 1.6, margin: '0 0 18px' }}>
              Dimmi che documento scansioni e quali dati ti servono: preparo il prompt e lo metto
              fra i tipi di documento, pronto da usare.
            </p>

            <Campo
              grande
              label="1. Che documento devi scansionare?"
              hint="Come lo chiami tu: «DDT inerti», «Fatture fornitori», «Rapporti di prova»"
              value={semplici.documento}
              onChange={(v) => setS('documento', v)}
              placeholder="DDT inerti"
            />

            <Lista
              grande
              label="2. Quali dati vuoi nell'Excel?"
              hint="Diventano le colonne, nell'ordine scritto"
              voci={semplici.campi}
              onChange={(v) => setS('campi', v)}
              righe={9}
            />

            <div style={{ marginTop: 6, marginBottom: 8 }}>
              <label style={{ ...etichetta, fontSize: 14, marginBottom: 8 }}>3. Vuoi altro?</label>
              <Spunta
                label="nel PDF ci sono pagine da buttare (copertine, certificati, pagine bianche)"
                checked={semplici.scartaPagine}
                onChange={(v) => setS('scartaPagine', v)}
              />
              <Spunta
                label="aggiungi un foglio con i totali"
                checked={semplici.totali}
                onChange={(v) => setS('totali', v)}
              />
              <Spunta
                label="aggiungi un foglio con le cose strane da controllare"
                checked={semplici.anomalie}
                onChange={(v) => setS('anomalie', v)}
              />
            </div>

            {avvisi}

            <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 16, paddingTop: 16 }}>
              <div style={{ fontSize: 12, color: '#8a8d92', marginBottom: 10 }}>
                Verrà salvato come{' '}
                <strong style={{ color: '#212326' }}>{etichettaPrompt || '—'}</strong> ·{' '}
                {descrizionePrompt}
              </div>
              {bottoni}
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#0c4577',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '10px 0 0',
                  textDecoration: 'underline',
                }}
                onClick={() => setMostraPrompt((v) => !v)}
              >
                {mostraPrompt ? 'Nascondi il prompt' : 'Vedi il prompt che verrà usato'}
              </button>
              {mostraPrompt && (
                <textarea
                  readOnly
                  value={testo}
                  style={{ ...anteprimaStile, minHeight: 240, marginTop: 8 }}
                />
              )}
            </div>

            <div style={{ marginTop: 18 }}>{elenco}</div>
          </div>
        )}
      </div>
    </div>
  );
};
// "><(((º> sabusabu <º)))><"
