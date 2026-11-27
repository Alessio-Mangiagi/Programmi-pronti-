// "><(((º> sabusabu <º)))><"
/**
 * Componenti per gli allegati (Giorno 15, 24/11/2026): campo di caricamento e link al file.
 *
 * CaricaFile: pulsante "Scegli file…" che carica SUBITO il file nell'archivio
 * (api.carica → POST /api/file) e restituisce { id, nome, … }; il modulo che lo contiene
 * salva poi solo l'id. Controlla prima nel browser estensione e dimensione (stesse regole
 * del server, comune/documenti.ts) per dare l'errore senza aspettare il caricamento.
 *
 * LinkFile: nome, dimensione e link che apre il file in una nuova scheda (PDF e immagini)
 * o lo scarica (gli altri formati). Il server decide chi può aprirlo (server/rotte/file.ts).
 */
import { conPercorso } from '../percorso';
import { useRef, useState } from 'react';
import { ESTENSIONI_FILE, formattaDimensione, MAX_MB_FILE } from '../../comune/documenti';
import { api } from '../api';
import type { VistaFile } from '../tipi';
import { Icona } from './icone';
import { Pulsante } from './ui';

/** Testo d'aiuto sotto il pulsante con tutti i formati (attestati, documenti, documentazione). */
const AIUTO_TUTTI = 'PDF, immagini, Word, Excel';

export function LinkFile({ file, compatto = false }: { file: VistaFile; compatto?: boolean }) {
  return (
    <a
      href={conPercorso(`/api/file/${file.id}`)}
      target="_blank"
      rel="noopener"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded text-marchio hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marchio-chiaro"
      title={`Apri ${file.nome}`}
    >
      <Icona nome="allegato" dimensione={15} className="shrink-0" />
      <span className="truncate">{file.nome}</span>
      {!compatto && <span className="shrink-0 text-xs text-gray-500">({formattaDimensione(file.dimensione)})</span>}
    </a>
  );
}

export function CaricaFile({
  file,
  onFile,
  errore,
  testoPulsante = 'Scegli file…',
  estensioni = ESTENSIONI_FILE,
  aiutoFormati = AIUTO_TUTTI,
}: {
  file: VistaFile | null;
  onFile: (f: VistaFile | null) => void;
  errore?: string;
  testoPulsante?: string;
  /** Formati ammessi qui (default tutti); per le assenze solo PDF e immagini (comune/documenti.ts). */
  estensioni?: readonly string[];
  aiutoFormati?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [stato, setStato] = useState<{ caricamento: boolean; errore: string | null }>({ caricamento: false, errore: null });

  const scegli = async (f: File | undefined) => {
    if (input.current) input.current.value = ''; // lo stesso file si può riscegliere
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!estensioni.includes(ext)) {
      setStato({ caricamento: false, errore: `Formato .${ext} non ammesso` });
      return;
    }
    if (f.size > MAX_MB_FILE * 1024 * 1024) {
      setStato({ caricamento: false, errore: `File troppo grande (${formattaDimensione(f.size)}): massimo ${MAX_MB_FILE} MB` });
      return;
    }
    setStato({ caricamento: true, errore: null });
    try {
      onFile(await api.carica<VistaFile>(f));
      setStato({ caricamento: false, errore: null });
    } catch (e) {
      setStato({ caricamento: false, errore: e instanceof Error ? e.message : String(e) });
    }
  };

  const messaggio = stato.errore ?? errore;
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {file ? (
          <>
            <LinkFile file={file} />
            <button type="button" className="rounded px-1.5 py-0.5 text-xs text-errore hover:bg-[#fdf3f2]" onClick={() => onFile(null)}>
              Togli
            </button>
            <Pulsante variante="leggero" className="!px-2 !py-0.5" onClick={() => input.current?.click()} disabled={stato.caricamento}>
              Sostituisci
            </Pulsante>
          </>
        ) : (
          <Pulsante onClick={() => input.current?.click()} disabled={stato.caricamento}>
            <Icona nome="allegato" dimensione={15} /> {stato.caricamento ? 'Caricamento…' : testoPulsante}
          </Pulsante>
        )}
        <input ref={input} type="file" accept={estensioni.map((e) => `.${e}`).join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => scegli(e.target.files?.[0])} />
      </div>
      {messaggio ? (
        <span className="mt-0.5 block text-xs text-errore">{messaggio}</span>
      ) : (
        !file && <span className="mt-0.5 block text-xs text-gray-500">{aiutoFormati}; massimo {MAX_MB_FILE} MB</span>
      )}
    </div>
  );
}
