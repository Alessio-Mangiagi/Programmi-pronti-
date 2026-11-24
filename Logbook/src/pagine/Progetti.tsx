// "><(((º> sabusabu <º)))><"
/**
 * Progetti (solo HR): elenco con ricerca e filtro di stato, finestra per creare o
 * modificare. "Chiudi" mette il progetto in stato CHIUSO: non si può più scegliere
 * per nuove ore, ma quelle già registrate restano nei report.
 */
import { useState, type FormEvent } from 'react';
import { DATA_MINIMA, formattaData, oggiIso } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { erroriPerCampo, schemaProgetto, STATI_PROGETTO } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import { Tabella, type Colonna } from '../componenti/Tabella';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Modale, Pulsante } from '../componenti/ui';
import type { Progetto } from '../tipi';
import { usaDati } from '../usaDati';
import { coloreProgetto } from '../colori';

const ETICHETTE_STATO: Record<Progetto['stato'], { testo: string; colore: 'verde' | 'giallo' | 'grigio' }> = {
  ATTIVO: { testo: 'Attivo', colore: 'verde' },
  SOSPESO: { testo: 'Sospeso', colore: 'giallo' },
  CHIUSO: { testo: 'Chiuso', colore: 'grigio' },
};

/** Valori del modulo; `maxOre` è il testo del campo in ore ("9" o "7,5"), convertito in minuti all'invio. */
type Modulo = { codice: string; nome: string; cliente: string; dataInizio: string; dataFine: string; stato: Progetto['stato']; colore: string; maxOre: string };

/** "7,5" → 450 minuti; "" → null; testo non numerico → NaN (lo segnala lo schema). */
const minutiDaOre = (testo: string) => (testo.trim() === '' ? null : Math.round(Number(testo.replace(',', '.')) * 60));

export function Progetti() {
  const { dati, errore, caricamento, ricarica } = usaDati<Progetto[]>('/api/progetti');
  const [filtroStato, setFiltroStato] = useState<Progetto['stato'] | ''>('');
  const [modifica, setModifica] = useState<Progetto | 'nuovo' | null>(null);

  const colonne: Colonna<Progetto>[] = [
    {
      chiave: 'codice',
      titolo: 'Codice',
      valore: (p) => p.codice,
      render: (p) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: coloreProgetto(p) }} />
          {p.codice}
        </span>
      ),
    },
    { chiave: 'nome', titolo: 'Nome', valore: (p) => p.nome },
    { chiave: 'cliente', titolo: 'Cliente', valore: (p) => p.cliente },
    { chiave: 'inizio', titolo: 'Inizio', valore: (p) => p.dataInizio, render: (p) => formattaData(p.dataInizio) },
    { chiave: 'fine', titolo: 'Fine', valore: (p) => p.dataFine, render: (p) => (p.dataFine ? formattaData(p.dataFine) : '—') },
    {
      chiave: 'max',
      titolo: 'Max ore/giorno',
      valore: (p) => p.maxMinutiGiorno,
      render: (p) => (p.maxMinutiGiorno != null ? formattaOre(p.maxMinutiGiorno) : <span className="text-gray-400">nessun limite</span>),
      allinea: 'destra',
    },
    {
      chiave: 'stato',
      titolo: 'Stato',
      valore: (p) => p.stato,
      render: (p) => <Etichetta colore={ETICHETTE_STATO[p.stato].colore}>{ETICHETTE_STATO[p.stato].testo}</Etichetta>,
    },
  ];

  return (
    <>
      <IntestazionePagina
        titolo="Progetti"
        sottotitolo="Progetti e commesse su cui si registrano le ore"
        azioni={
          <Pulsante variante="primario" onClick={() => setModifica('nuovo')}>
            + Nuovo progetto
          </Pulsante>
        }
      />
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {caricamento && !dati && <Caricamento />}
      {dati && (
        <Tabella
          righe={dati.filter((p) => !filtroStato || p.stato === filtroStato)}
          colonne={colonne}
          chiaveRiga={(p) => p.id}
          testoRicerca={(p) => `${p.codice} ${p.nome} ${p.cliente ?? ''}`}
          onRiga={(p) => setModifica(p)}
          ordinamentoIniziale={{ chiave: 'codice', verso: 1 }}
          vuoto="Nessun progetto"
          strumenti={
            <select aria-label="Filtra per stato" className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" value={filtroStato} onChange={(e) => setFiltroStato(e.target.value as typeof filtroStato)}>
              <option value="">Tutti gli stati</option>
              {STATI_PROGETTO.map((s) => (
                <option key={s} value={s}>
                  {ETICHETTE_STATO[s].testo}
                </option>
              ))}
            </select>
          }
        />
      )}
      {modifica && (
        <ModuloProgetto
          progetto={modifica === 'nuovo' ? null : modifica}
          onChiudi={() => setModifica(null)}
          onSalvato={() => {
            setModifica(null);
            ricarica();
          }}
        />
      )}
    </>
  );
}

function ModuloProgetto({ progetto, onChiudi, onSalvato }: { progetto: Progetto | null; onChiudi: () => void; onSalvato: () => void }) {
  const [modulo, setModulo] = useState<Modulo>(
    progetto
      ? {
          codice: progetto.codice, nome: progetto.nome, cliente: progetto.cliente ?? '', dataInizio: progetto.dataInizio, dataFine: progetto.dataFine ?? '',
          stato: progetto.stato, colore: progetto.colore ?? '',
          maxOre: progetto.maxMinutiGiorno != null ? String(progetto.maxMinutiGiorno / 60).replace('.', ',') : '',
        }
      : { codice: '', nome: '', cliente: '', dataInizio: oggiIso(), dataFine: '', stato: 'ATTIVO', colore: '', maxOre: '' },
  );
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const campo = (nome: keyof Modulo) => ({
    value: modulo[nome],
    onChange: (e: { target: { value: string } }) => setModulo((m) => ({ ...m, [nome]: e.target.value })),
  });

  const invia = async (valori: Modulo) => {
    const { maxOre, ...resto } = valori;
    const corpo = { ...resto, maxMinutiGiorno: minutiDaOre(maxOre) };
    const controllo = schemaProgetto.safeParse(corpo);
    if (!controllo.success) {
      setErrori(erroriPerCampo(controllo.error));
      return;
    }
    try {
      if (progetto) await api.put(`/api/progetti/${progetto.id}`, corpo);
      else await api.post('/api/progetti', corpo);
      onSalvato();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio(err.message);
      }
    }
  };

  const salva = (e: FormEvent) => {
    e.preventDefault();
    setMessaggio(null);
    invia(modulo);
  };

  return (
    <Modale titolo={progetto ? `Progetto ${progetto.codice}` : 'Nuovo progetto'} aperta onChiudi={onChiudi}>
      <form onSubmit={salva} className="space-y-3" noValidate>
        {messaggio && <Avviso tipo="errore">{messaggio}</Avviso>}
        {/* Campi in righe flex che vanno a capo (24/11/2026): affiancati nella finestra, uno sotto l'altro sul telefono. */}
        <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_10rem]">
          <Campo etichetta="Codice" obbligatorio errore={errori.codice}>
            <input className={`${classiInput(errori.codice)} uppercase`} {...campo('codice')} />
          </Campo>
          <Campo etichetta="Stato" errore={errori.stato}>
            <select className={classiInput(errori.stato)} {...campo('stato')}>
              {STATI_PROGETTO.map((s) => (
                <option key={s} value={s}>
                  {ETICHETTE_STATO[s].testo}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <Campo etichetta="Nome" obbligatorio errore={errori.nome}>
          <input className={classiInput(errori.nome)} {...campo('nome')} />
        </Campo>
        <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*:first-child]:flex-[2_1_14rem] [&>*:last-child]:flex-[1_1_10rem]">
          <Campo etichetta="Cliente" errore={errori.cliente}>
            <input className={classiInput(errori.cliente)} {...campo('cliente')} />
          </Campo>
          <Campo etichetta="Ore massime al giorno" errore={errori.maxMinutiGiorno} aiuto="Per dipendente; vuoto = nessun limite">
            <input inputMode="decimal" placeholder="es. 8" className={`${classiInput(errori.maxMinutiGiorno)} text-right`} {...campo('maxOre')} />
          </Campo>
        </div>
        <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_9rem]">
          <Campo etichetta="Data inizio" obbligatorio errore={errori.dataInizio}>
            <input type="date" min={DATA_MINIMA} className={classiInput(errori.dataInizio)} {...campo('dataInizio')} />
          </Campo>
          <Campo etichetta="Data fine" errore={errori.dataFine}>
            <input type="date" min={DATA_MINIMA} className={classiInput(errori.dataFine)} {...campo('dataFine')} />
          </Campo>
          <Campo etichetta="Colore nel calendario" errore={errori.colore}>
            <input type="color" className="h-[34px] w-full rounded border border-gray-300" value={modulo.colore || '#0c4577'} onChange={(e) => setModulo((m) => ({ ...m, colore: e.target.value }))} />
          </Campo>
        </div>
        <div className="flex justify-between gap-2 border-t border-gray-100 pt-3">
          <div>
            {progetto && progetto.stato !== 'CHIUSO' && (
              <Pulsante variante="pericolo" onClick={() => invia({ ...modulo, stato: 'CHIUSO' })}>
                Chiudi progetto
              </Pulsante>
            )}
          </div>
          <div className="flex gap-2">
            <Pulsante onClick={onChiudi}>Annulla</Pulsante>
            <Pulsante type="submit" variante="primario">
              Salva
            </Pulsante>
          </div>
        </div>
      </form>
    </Modale>
  );
}
