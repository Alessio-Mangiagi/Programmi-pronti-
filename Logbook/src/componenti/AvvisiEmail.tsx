// "><(((º> sabusabu <º)))><"
/**
 * Riquadro "Avvisi via email" delle Impostazioni (26/11/2026), solo amministratori.
 *
 * Qui HR sceglie a chi arrivano gli avvisi per l'ufficio personale e quali avvisi mandare:
 * richieste di assenza (a HR), esito delle richieste (al dipendente), promemoria settimanale
 * dei giorni senza ore, attestati in scadenza, chiusura di un progetto. Le regole di invio sono in
 * server/servizi/avvisi.ts; le API in server/rotte/impostazioni.ts (PUT /avvisi, POST
 * /avvisi/prova).
 *
 * Se su questo Copilota la posta non è configurata (variabili LOGBOOK_SMTP_*) il riquadro lo
 * dice e le scelte restano salvabili: varranno quando la posta ci sarà.
 * Le email ai dipendenti partono solo per chi ha un indirizzo in anagrafica.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api, ErroreApi } from '../api';
import type { Impostazioni } from '../tipi';
import { Avviso, Campo, classiInput, Etichetta, Pulsante } from './ui';

const VOCI: { chiave: 'richieste' | 'esiti' | 'oreMancanti' | 'attestati' | 'progettoChiuso'; titolo: string; dettaglio: string }[] = [
  { chiave: 'richieste', titolo: 'Nuova richiesta di assenza', dettaglio: 'A HR, appena un dipendente chiede ferie o permessi o comunica una malattia' },
  { chiave: 'esiti', titolo: 'Esito della richiesta', dettaglio: 'Al dipendente, quando la richiesta viene approvata o rifiutata' },
  { chiave: 'oreMancanti', titolo: 'Giorni senza ore', dettaglio: 'Una volta alla settimana: al dipendente i suoi giorni scoperti delle ultime due settimane, a HR il riepilogo' },
  { chiave: 'attestati', titolo: 'Attestati in scadenza', dettaglio: 'Al dipendente e a HR: 30 giorni prima, 7 giorni prima e il giorno della scadenza' },
  { chiave: 'progettoChiuso', titolo: 'Progetto chiuso', dettaglio: 'Quando un progetto passa a "Chiuso": a HR il riepilogo di ore, costo e cose rimaste in attesa; ai dipendenti assegnati l\'avviso che non si registrano più ore' },
];

export function AvvisiEmail({ dati, ricarica }: { dati: Impostazioni['avvisi']; ricarica: () => void }) {
  const [emailHr, setEmailHr] = useState('');
  const [scelte, setScelte] = useState({ richieste: true, esiti: true, oreMancanti: true, attestati: true, progettoChiuso: true });
  const [erroreCampo, setErroreCampo] = useState<string | undefined>();
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const [lavoro, setLavoro] = useState<'salva' | 'prova' | null>(null);

  useEffect(() => {
    setEmailHr(dati.emailHr);
    setScelte({ richieste: dati.richieste, esiti: dati.esiti, oreMancanti: dati.oreMancanti, attestati: dati.attestati, progettoChiuso: dati.progettoChiuso });
  }, [dati]);

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setMessaggio(null);
    setLavoro('salva');
    try {
      await api.put('/api/impostazioni/avvisi', { emailHr, ...scelte });
      setErroreCampo(undefined);
      setMessaggio({ tipo: 'successo', testo: 'Avvisi salvati.' });
      ricarica();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErroreCampo(err.campi.emailHr);
        setMessaggio({ tipo: 'errore', testo: err.message });
      }
    } finally {
      setLavoro(null);
    }
  };

  const prova = async () => {
    setMessaggio(null);
    setLavoro('prova');
    try {
      const r = await api.post<{ inviataA: string[] }>('/api/impostazioni/avvisi/prova');
      setMessaggio({ tipo: 'successo', testo: `Email di prova inviata a ${r.inviataA.join(', ')}.` });
    } catch (err) {
      setMessaggio({ tipo: 'errore', testo: err instanceof Error ? err.message : String(err) });
    } finally {
      setLavoro(null);
    }
  };

  return (
    <form onSubmit={salva} className="scheda min-w-0 max-w-4xl flex-[1_1_32rem] space-y-3 p-4" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-medium text-marchio">Avvisi via email</h2>
        {dati.postaConfigurata ? <Etichetta colore="verde">Posta attiva</Etichetta> : <Etichetta colore="giallo">Posta non configurata</Etichetta>}
      </div>
      <p className="text-sm text-gray-600">
        Copilota scrive da solo quando c'è qualcosa da fare. Le email ai dipendenti partono solo per chi ha un indirizzo in anagrafica.
      </p>
      {!dati.postaConfigurata && (
        <Avviso tipo="info">Su questo Copilota la posta non è configurata: le scelte si possono salvare, ma nessuna email parte finché non lo è.</Avviso>
      )}
      {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}
      <Campo
        etichetta="Indirizzi dell'ufficio personale"
        errore={erroreCampo}
        aiuto={`Più indirizzi separati da virgola. ${dati.emailPredefinita ? `Vuoto = ${dati.emailPredefinita}` : 'Vuoto = nessun avviso a HR'}`}
      >
        <input className={classiInput(erroreCampo)} value={emailHr} onChange={(e) => setEmailHr(e.target.value)} placeholder={dati.emailPredefinita ?? 'personale@azienda.it'} />
      </Campo>
      <div className="divide-y divide-gray-100 border-y border-gray-100">
        {VOCI.map((v) => (
          <label key={v.chiave} className="flex cursor-pointer items-start gap-3 py-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[#0c4577]"
              checked={scelte[v.chiave]}
              onChange={(e) => setScelte({ ...scelte, [v.chiave]: e.target.checked })}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">{v.titolo}</span>
              <span className="block text-sm text-gray-600">{v.dettaglio}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="flex-1" />
        {dati.postaConfigurata && (
          <Pulsante onClick={prova} disabled={lavoro !== null}>
            {lavoro === 'prova' ? 'Invio in corso…' : 'Invia email di prova'}
          </Pulsante>
        )}
        <Pulsante type="submit" variante="primario" disabled={lavoro !== null}>
          {lavoro === 'salva' ? 'Salvataggio…' : 'Salva'}
        </Pulsante>
      </div>
    </form>
  );
}
