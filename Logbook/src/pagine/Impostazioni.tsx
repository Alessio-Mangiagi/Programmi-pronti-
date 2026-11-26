// "><(((º> sabusabu <º)))><"
/**
 * Impostazioni (solo amministratori), Giorno 15 (24/11/2026).
 *
 * Oggi c'è il collegamento a SkyTower, l'archivio documentale della suite (risposta
 * "4a e b come pulsante"): i file di Copilota restano sul suo server; se qui si registra il
 * collegamento, HR vede "Invia a SkyTower" sulla documentazione dei progetti che hanno una
 * commessa SkyTower. Senza collegamento il pulsante non compare da nessuna parte.
 *
 * Campi: indirizzo dell'API di SkyTower (di solito http://127.0.0.1:8100 sul server della
 * suite), token di servizio della suite (shared/suite/.token sul server, o SUITE_TOKEN),
 * email dell'utente SkyTower a nome del quale si caricano i documenti (facoltativa: senza,
 * SkyTower usa il suo utente tecnico). Il token non torna mai al browser.
 * API: /api/impostazioni (server/rotte/impostazioni.ts).
 *
 * Dal 26/11/2026 c'è anche il riquadro "Avvisi via email" (componenti/AvvisiEmail.tsx).
 *
 * Dal 25/11/2026 il proprietario vede anche "Dati del programma" (componenti/DatiProgramma.tsx):
 * dati di esempio e cancellazione di tutti i dati con codice via email.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api, ErroreApi } from '../api';
import { AvvisiEmail } from '../componenti/AvvisiEmail';
import { DatiProgramma } from '../componenti/DatiProgramma';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import type { Impostazioni as DatiImpostazioni } from '../tipi';
import { usaDati } from '../usaDati';

export function Impostazioni() {
  const { dati, errore, ricarica } = usaDati<DatiImpostazioni>('/api/impostazioni');
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo' | 'info'; testo: string } | null>(null);
  const [lavoro, setLavoro] = useState<'salva' | 'prova' | null>(null);

  useEffect(() => {
    if (!dati) return;
    setUrl(dati.skytower.url || 'http://127.0.0.1:8100');
    setEmail(dati.skytower.email);
  }, [dati]);

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setMessaggio(null);
    setLavoro('salva');
    try {
      await api.put('/api/impostazioni/skytower', { url, email, token });
      setToken('');
      setErrori({});
      setMessaggio({ tipo: 'successo', testo: 'Collegamento salvato. Usa «Prova collegamento» per controllarlo.' });
      ricarica();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
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
      const r = await api.post<{ commesse: number }>('/api/impostazioni/skytower/prova');
      setMessaggio({ tipo: 'successo', testo: `Collegamento riuscito: SkyTower vede ${r.commesse} ${r.commesse === 1 ? 'commessa' : 'commesse'}.` });
    } catch (err) {
      setMessaggio({ tipo: 'errore', testo: err instanceof Error ? err.message : String(err) });
    } finally {
      setLavoro(null);
    }
  };

  const rimuovi = async () => {
    if (!window.confirm('Togliere il collegamento a SkyTower? Il pulsante «Invia a SkyTower» sparirà; i documenti già inviati restano in SkyTower.')) return;
    await api.delete('/api/impostazioni/skytower');
    setToken('');
    setMessaggio({ tipo: 'info', testo: 'Collegamento tolto' });
    ricarica();
  };

  if (errore) return <Avviso tipo="errore">{errore}</Avviso>;
  if (!dati) return <Caricamento />;
  const s = dati.skytower;

  return (
    <>
      <IntestazionePagina titolo="Impostazioni" sopratitolo="Amministrazione" sottotitolo="Visibili solo agli amministratori" />
      <div className="flex flex-wrap gap-4">
        {/* Riquadro flex (base 32rem) con un tetto di leggibilità: un modulo da solo non va steso su 3000px. */}
        <form onSubmit={salva} className="scheda min-w-0 max-w-4xl flex-[1_1_32rem] space-y-3 p-4" noValidate>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-medium text-marchio">Collegamento a SkyTower</h2>
            {s.attivo ? <Etichetta colore="verde">Attivo</Etichetta> : <Etichetta colore="grigio">Non collegato</Etichetta>}
          </div>
          <p className="text-sm text-gray-600">
            I documenti restano in Copilota. Con il collegamento attivo, nella documentazione dei progetti che hanno una commessa SkyTower compare il pulsante{' '}
            <b>Invia a SkyTower</b>: il file diventa un documento WIP della commessa, nella cartella «Suite Cosedil».
          </p>
          {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}
          <Campo etichetta="Indirizzo dell'API di SkyTower" obbligatorio errore={errori.url} aiuto="Sul server della suite di solito http://127.0.0.1:8100">
            <input className={classiInput(errori.url)} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8100" />
          </Campo>
          <Campo
            etichetta="Token di servizio della suite"
            obbligatorio={!s.tokenImpostato}
            errore={errori.token}
            aiuto={s.tokenImpostato ? 'Già impostato: lascia vuoto per non cambiarlo' : 'Si trova sul server in shared\\suite\\.token (o nella variabile SUITE_TOKEN)'}
          >
            <input type="password" autoComplete="off" className={classiInput(errori.token)} value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.tokenImpostato ? '•••••••• (impostato)' : ''} />
          </Campo>
          <Campo etichetta="Email dell'utente SkyTower" errore={errori.email} aiuto="Chi risulterà autore dei documenti in SkyTower; vuota = utente tecnico della suite">
            <input type="email" className={classiInput(errori.email)} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome.cognome@cosedilspa.com" />
          </Campo>
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            {s.attivo && (
              <Pulsante variante="pericolo" onClick={rimuovi}>
                Togli collegamento
              </Pulsante>
            )}
            <span className="flex-1" />
            {s.attivo && (
              <Pulsante onClick={prova} disabled={lavoro !== null}>
                {lavoro === 'prova' ? 'Prova in corso…' : 'Prova collegamento'}
              </Pulsante>
            )}
            <Pulsante type="submit" variante="primario" disabled={lavoro !== null}>
              {lavoro === 'salva' ? 'Salvataggio…' : 'Salva'}
            </Pulsante>
          </div>
        </form>
        {/* 26/11/2026: quali avvisi via email mandare e a chi (componenti/AvvisiEmail.tsx). */}
        <AvvisiEmail dati={dati.avvisi} ricarica={ricarica} />
        {/* 25/11/2026: dati di esempio e "Cancella tutti i dati", solo per il proprietario. */}
        <DatiProgramma />
      </div>
    </>
  );
}
