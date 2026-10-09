// Formati di uscita e tipi di file: condivisi da App.tsx e dalle librerie di export.
export type Format = 'md' | 'json' | 'contract' | 'contratti'
export type FileKind = 'pdf' | 'image' | 'docx' | 'excel' | 'text' | null

// Formati di uscita, con la riga che spiega cosa producono: sceglierne uno sbagliato
// è l'errore più frequente (si scansiona in MD e l'Import_Contratti esce vuoto), e
// prima nulla in interfaccia diceva la differenza.
// Due formati sono il lavoro, due sono di servizio. Tenerli tutti e quattro alla stessa
// altezza faceva scegliere «.MD» per sbaglio su un contratto, con l'Excel poi vuoto.
export const FORMATI: { id: Format; etichetta: string; aiuto: string }[] = [
  { id: 'contratti', etichetta: 'IMPORT P6', aiuto: 'Elenco prezzi riga per riga → Import_Contratti.xlsx. È il formato da usare sui contratti.' },
  { id: 'contract', etichetta: 'CONTRATTO', aiuto: 'Solo la testata del contratto, una riga per documento.' },
]
export const FORMATI_TECNICI: { id: Format; etichetta: string; aiuto: string }[] = [
  { id: 'md', etichetta: '.MD', aiuto: 'Testo del documento in Markdown, senza estrazione dei campi.' },
  { id: 'json', etichetta: '.JSON', aiuto: 'Testo grezzo riga per riga in JSON.' },
]
export const TUTTI_I_FORMATI = [...FORMATI, ...FORMATI_TECNICI]

