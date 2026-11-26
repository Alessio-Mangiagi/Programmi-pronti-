// "><(((º> sabusabu <º)))><"
/**
 * Saldo ferie e permessi (Giorno 38, 26/11/2026), in cima alla pagina Assenze.
 *
 * - Dipendente: due tessere con ferie (giorni) e permessi (ore) residui, e sotto il conto
 *   (di partenza, maturato, goduto, già programmato, in attesa di risposta).
 * - HR: riquadro richiudibile con una riga per dipendente attivo e il pulsante "Quota", che
 *   apre il modulo con giorni di ferie e ore di permesso all'anno, data da cui contare e
 *   residui di partenza. Finché HR non scrive la quota, il saldo di quel dipendente non
 *   esiste: Logbook non inventa i numeri del contratto.
 *
 * Il saldo non è salvato: lo calcola il server a ogni lettura (comune/saldi.ts), quindi una
 * richiesta approvata o corretta lo cambia subito. API: /api/saldi (server/rotte/saldi.ts).
 */
import { useState, type FormEvent } from 'react';
import { formattaData } from '../../comune/date';
import type { Quota, Saldo, VoceSaldo } from '../../comune/saldi';
import { api, ErroreApi } from '../api';
import { useAuth } from '../auth';
import { usaDati } from '../usaDati';
import { Avviso, Campo, classiInput, Modale, Pulsante } from './ui';

type RigaSaldo = { dipendenteId: number; nome: string; matricola: string; quota: Quota | null; saldo: Saldo | null };

/** Numero con al massimo due decimali, virgola italiana, senza zeri inutili. */
const numero = (n: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(n);

function Tessera({ titolo, unita, voce }: { titolo: string; unita: string; voce: VoceSaldo }) {
  const riga = (etichetta: string, valore: number, segno = '') => (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-600">{etichetta}</dt>
      <dd className="cifre">
        {valore !== 0 ? segno : ''}
        {numero(valore)}
      </dd>
    </div>
  );
  return (
    <div className="scheda min-w-0 flex-[1_1_16rem] p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{titolo}</div>
      <div className={`font-display text-2xl font-medium ${voce.residue < 0 ? 'text-red-700' : 'text-marchio'}`}>
        {numero(voce.residue)} <span className="text-sm font-normal text-gray-600">{unita} residui</span>
      </div>
      <dl className="mt-2 space-y-0.5 border-t border-gray-100 pt-2 text-sm">
        {voce.iniziali !== 0 && riga('Residuo di partenza', voce.iniziali)}
        {riga(`Maturati (${numero(voce.quotaAnno)} all'anno)`, voce.maturate, '+')}
        {riga('Goduti', voce.godute, '−')}
        {voce.programmate > 0 && riga('Già approvati, in arrivo', voce.programmate)}
        {voce.inAttesa > 0 && riga('In attesa di risposta', voce.inAttesa)}
        {(voce.programmate > 0 || voce.inAttesa > 0) && (
          <div className="flex justify-between gap-3 border-t border-gray-100 pt-1 font-medium">
            <dt>Ancora da chiedere</dt>
            <dd className="cifre">{numero(voce.disponibile)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

const QUOTA_VUOTA = { ferieGiorniAnno: '', permessiOreAnno: '', contaDal: '', ferieIniziali: '0', permessiIniziali: '0' };

function ModuloQuota({ riga, onChiudi, onSalvato }: { riga: RigaSaldo; onChiudi: () => void; onSalvato: () => void }) {
  const q = riga.quota;
  const [m, setM] = useState(
    q
      ? { ferieGiorniAnno: String(q.ferieGiorniAnno), permessiOreAnno: String(q.permessiOreAnno), contaDal: q.contaDal, ferieIniziali: String(q.ferieIniziali), permessiIniziali: String(q.permessiIniziali) }
      : { ...QUOTA_VUOTA, contaDal: `${new Date().getFullYear()}-01-01` },
  );
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const campo = (nome: keyof typeof m) => ({ value: m[nome], onChange: (e: { target: { value: string } }) => setM({ ...m, [nome]: e.target.value }) });
  // I numeri si scrivono anche con la virgola: al server vanno con il punto.
  const n = (v: string) => v.trim().replace(',', '.');

  const esegui = async (azione: () => Promise<unknown>) => {
    setErrore(null);
    setLavoro(true);
    try {
      await azione();
      onSalvato();
    } catch (err) {
      if (err instanceof ErroreApi) setErrori(err.campi);
      setErrore(err instanceof Error ? err.message : String(err));
    } finally {
      setLavoro(false);
    }
  };
  const salva = (e: FormEvent) => {
    e.preventDefault();
    void esegui(() =>
      api.put(`/api/saldi/${riga.dipendenteId}`, { ferieGiorniAnno: n(m.ferieGiorniAnno), permessiOreAnno: n(m.permessiOreAnno), contaDal: m.contaDal, ferieIniziali: n(m.ferieIniziali) || '0', permessiIniziali: n(m.permessiIniziali) || '0' }),
    );
  };
  const togli = () => {
    if (window.confirm(`Togliere la quota di ${riga.nome}? Il suo saldo non verrà più calcolato.`)) void esegui(() => api.delete(`/api/saldi/${riga.dipendenteId}`));
  };

  return (
    <Modale titolo={`Quota di ${riga.nome}`} aperta onChiudi={onChiudi}>
      <form onSubmit={salva} className="space-y-3" noValidate>
        <p className="text-sm text-gray-600">Sono i numeri del contratto: Logbook li usa per calcolare quanto matura ogni mese (un dodicesimo della quota, per i mesi lavorati almeno 15 giorni).</p>
        {errore && <Avviso tipo="errore">{errore}</Avviso>}
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-[1_1_12rem]">
            <Campo etichetta="Giorni di ferie all'anno" obbligatorio errore={errori.ferieGiorniAnno}>
              <input inputMode="decimal" className={classiInput(errori.ferieGiorniAnno)} {...campo('ferieGiorniAnno')} />
            </Campo>
          </div>
          <div className="min-w-0 flex-[1_1_12rem]">
            <Campo etichetta="Ore di permesso all'anno" obbligatorio errore={errori.permessiOreAnno}>
              <input inputMode="decimal" className={classiInput(errori.permessiOreAnno)} {...campo('permessiOreAnno')} />
            </Campo>
          </div>
        </div>
        <Campo etichetta="Conta dal" obbligatorio errore={errori.contaDal} aiuto="Da questa data Logbook conta maturato e goduto. Di solito il 1° gennaio dell'anno in cui si comincia a usarlo.">
          <input type="date" className={classiInput(errori.contaDal)} {...campo('contaDal')} />
        </Campo>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-[1_1_12rem]">
            <Campo etichetta="Ferie residue a quella data (giorni)" errore={errori.ferieIniziali} aiuto="Riportate dal sistema precedente; negativo se già godute in anticipo">
              <input inputMode="decimal" className={classiInput(errori.ferieIniziali)} {...campo('ferieIniziali')} />
            </Campo>
          </div>
          <div className="min-w-0 flex-[1_1_12rem]">
            <Campo etichetta="Permessi residui a quella data (ore)" errore={errori.permessiIniziali}>
              <input inputMode="decimal" className={classiInput(errori.permessiIniziali)} {...campo('permessiIniziali')} />
            </Campo>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          {q && (
            <Pulsante variante="pericolo" onClick={togli} disabled={lavoro}>
              Togli quota
            </Pulsante>
          )}
          <span className="flex-1" />
          <Pulsante onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante type="submit" variante="primario" disabled={lavoro}>
            {lavoro ? 'Salvataggio…' : 'Salva'}
          </Pulsante>
        </div>
      </form>
    </Modale>
  );
}

export function SaldiAssenze() {
  const { admin } = useAuth();
  const { dati, ricarica } = usaDati<RigaSaldo[]>('/api/saldi');
  const [inModifica, setInModifica] = useState<RigaSaldo | null>(null);
  if (!dati) return null;

  if (!admin) {
    const mio = dati[0]?.saldo;
    if (!mio) return null;
    return (
      <section className="mb-4" aria-label="Il mio saldo">
        <div className="flex flex-wrap gap-3">
          <Tessera titolo="Ferie" unita="giorni" voce={mio.ferie} />
          <Tessera titolo="Permessi" unita="ore" voce={mio.permessi} />
        </div>
        <p className="mt-1 text-xs text-gray-500">Saldo al {formattaData(mio.al)}, contato dal {formattaData(mio.dal)}.</p>
      </section>
    );
  }

  const senza = dati.filter((r) => !r.quota).length;
  return (
    <details className="scheda mb-4 p-3" open={false}>
      <summary className="cursor-pointer select-none font-semibold text-marchio">
        Saldi ferie e permessi
        <span className="ml-2 text-sm font-normal text-gray-600">
          {dati.length - senza} con quota{senza > 0 ? `, ${senza} da impostare` : ''}
        </span>
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="cifre w-full min-w-[40rem] text-sm">
          <thead className="text-xs uppercase text-gray-500">
            <tr>
              <th className="py-1 text-left">Dipendente</th>
              <th className="py-1 pl-3 text-right">Ferie residue</th>
              <th className="py-1 pl-3 text-right">Maturate</th>
              <th className="py-1 pl-3 text-right">Godute</th>
              <th className="py-1 pl-3 text-right">In arrivo / attesa</th>
              <th className="py-1 pl-3 text-right">Permessi residui</th>
              <th className="py-1 pl-3" />
            </tr>
          </thead>
          <tbody>
            {dati.map((r) => (
              <tr key={r.dipendenteId} className="border-t border-gray-100">
                <td className="py-1.5">{r.nome}</td>
                {r.saldo ? (
                  <>
                    <td className={`py-1.5 pl-3 text-right font-medium ${r.saldo.ferie.residue < 0 ? 'text-red-700' : ''}`}>{numero(r.saldo.ferie.residue)} g</td>
                    <td className="py-1.5 pl-3 text-right text-gray-600">{numero(r.saldo.ferie.maturate)}</td>
                    <td className="py-1.5 pl-3 text-right text-gray-600">{numero(r.saldo.ferie.godute)}</td>
                    <td className="py-1.5 pl-3 text-right text-gray-600">
                      {numero(r.saldo.ferie.programmate)} / {numero(r.saldo.ferie.inAttesa)}
                    </td>
                    <td className={`py-1.5 pl-3 text-right font-medium ${r.saldo.permessi.residue < 0 ? 'text-red-700' : ''}`}>{numero(r.saldo.permessi.residue)} h</td>
                  </>
                ) : (
                  <td colSpan={5} className="py-1.5 pl-3 text-right text-gray-500">
                    quota non impostata
                  </td>
                )}
                <td className="py-1 pl-3 text-right">
                  <Pulsante onClick={() => setInModifica(r)}>Quota</Pulsante>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Ferie in giorni lavorativi, permessi in ore. Contano le assenze approvate; "in arrivo" sono quelle approvate con data futura.</p>
      {inModifica && (
        <ModuloQuota
          key={inModifica.dipendenteId}
          riga={inModifica}
          onChiudi={() => setInModifica(null)}
          onSalvato={() => {
            setInModifica(null);
            ricarica();
          }}
        />
      )}
    </details>
  );
}
