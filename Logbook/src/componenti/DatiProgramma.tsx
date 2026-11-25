// "><(((º> sabusabu <º)))><"
/**
 * Riquadro "Dati del programma" nella pagina Impostazioni (25/11/2026), visibile solo al
 * proprietario di Logbook (l'account di LOGBOOK_PROPRIETARIO nel .env del server). Gli altri
 * amministratori non lo vedono e il server rifiuta comunque (server/rotte/proprietario.ts).
 *
 * Due comandi, chiesti dall'utente per "popolare il programma con i dati per capire come sta
 * funzionando" e "all'occorrenza cancellare tutto":
 * - Carica dati di esempio: solo con Logbook vuoto (5 dipendenti, 3 progetti, ore del mese
 *   scorso e di questo, qualche assenza);
 * - Cancella tutti i dati: in due passi. Prima "Invia codice" manda 6 cifre all'email del
 *   proprietario, poi servono il codice e la parola CANCELLA. Restano l'account del
 *   proprietario, il collegamento a SkyTower e le festività nazionali (risposta 3a).
 * Se email o server di posta non sono impostati nel .env lo dice, e la cancellazione resta spenta.
 */
import { useState } from 'react';
import { api, ErroreApi } from '../api';
import { usaDati } from '../usaDati';
import { AccountAmministratori } from './AccountAmministratori';
import { Avviso, Campo, classiInput, Pulsante } from './ui';

type Stato =
  | { proprietario: false }
  | {
      proprietario: true;
      emailMascherata: string | null;
      emailConfigurata: boolean;
      invioConfigurato: boolean;
      vuoto: boolean;
      dipendenti: number;
      progetti: number;
      registrazioni: number;
    };

type Esito = { dipendenti: number; progetti: number; registrazioni: number; assenze: number; account: number; file: number; copia?: string };

const ora = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

export function DatiProgramma() {
  const { dati: stato, ricarica } = usaDati<Stato>('/api/proprietario/stato');
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo' | 'info'; testo: string } | null>(null);
  const [lavoro, setLavoro] = useState<'esempio' | 'codice' | 'cancella' | 'copia' | null>(null);
  const [inviato, setInviato] = useState<{ inviatoA: string; scadeAlle: string } | null>(null);
  const [codice, setCodice] = useState('');
  const [conferma, setConferma] = useState('');
  const [erroreCodice, setErroreCodice] = useState<string | undefined>();

  if (!stato || !stato.proprietario) return null;

  const esegui = async (tipo: NonNullable<typeof lavoro>, azione: () => Promise<void>) => {
    setLavoro(tipo);
    setMessaggio(null);
    try {
      await azione();
    } catch (e) {
      setMessaggio({ tipo: 'errore', testo: e instanceof ErroreApi ? e.message : 'Operazione non riuscita' });
      if (e instanceof ErroreApi && e.campi.codice) setErroreCodice(e.campi.codice);
    } finally {
      setLavoro(null);
    }
  };

  const caricaEsempio = () =>
    esegui('esempio', async () => {
      if (!window.confirm('Caricare in Logbook i dati di esempio (5 dipendenti, 3 progetti, ore e assenze finte)?')) return;
      const r = await api.post<{ dipendenti: number; progetti: number; registrazioni: number }>('/api/proprietario/dati-esempio');
      setMessaggio({ tipo: 'successo', testo: `Caricati ${r.dipendenti} dipendenti, ${r.progetti} progetti e ${r.registrazioni} fasce orarie di esempio.` });
      await ricarica();
    });

  const copiaOra = () =>
    esegui('copia', async () => {
      const r = await api.post<{ file: string; documentiCopiati: number }>('/api/proprietario/backup');
      setMessaggio({ tipo: 'successo', testo: `Copia di sicurezza fatta: ${r.file} (${r.documentiCopiati} file caricati nuovi).` });
    });

  const chiediCodice = () =>
    esegui('codice', async () => {
      const r = await api.post<{ inviatoA: string; scadeAlle: string }>('/api/proprietario/cancellazione/codice');
      setInviato(r);
      setCodice('');
      setErroreCodice(undefined);
    });

  const cancellaTutto = () =>
    esegui('cancella', async () => {
      setErroreCodice(undefined);
      const r = await api.post<Esito>('/api/proprietario/cancellazione', { codice, conferma });
      setInviato(null);
      setCodice('');
      setConferma('');
      setMessaggio({
        tipo: 'successo',
        testo: `Cancellati ${r.dipendenti} dipendenti, ${r.progetti} progetti, ${r.registrazioni} fasce orarie, ${r.assenze} assenze, ${r.account} account e ${r.file} file. Logbook è come appena installato.${r.copia ? ` Copia di sicurezza fatta prima: ${r.copia}` : ''}`,
      });
      await ricarica();
    });

  const pronto = stato.emailConfigurata && stato.invioConfigurato;
  const confermabile = /^\d{6}$/.test(codice.trim()) && conferma.trim() === 'CANCELLA';

  return (
    <section className="scheda min-w-0 max-w-4xl flex-[1_1_32rem] space-y-4 p-4" aria-labelledby="titolo-dati-programma">
      <div>
        <h2 id="titolo-dati-programma" className="font-display text-lg font-medium text-marchio">Dati del programma</h2>
        <p className="text-sm text-gray-600">
          Solo per te come proprietario di Logbook. Oggi ci sono <b className="cifre">{stato.dipendenti}</b> dipendenti, <b className="cifre">{stato.progetti}</b> progetti e{' '}
          <b className="cifre">{stato.registrazioni}</b> fasce orarie.
        </p>
      </div>
      {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}

      <div className="space-y-2 border-t border-gray-100 pt-3">
        <h3 className="font-ui text-sm font-semibold text-testo-forte">Dati di esempio</h3>
        <p className="text-sm text-gray-600">
          5 dipendenti, 3 progetti, le ore dal primo giorno del mese scorso a ieri e qualche assenza, per vedere come Logbook mostra i dati. Si caricano solo con
          Logbook vuoto; gli account dei dipendenti di esempio chiedono di cambiare la password al primo accesso.
        </p>
        <Pulsante onClick={caricaEsempio} disabled={!stato.vuoto || lavoro !== null} title={stato.vuoto ? undefined : 'Prima cancella tutti i dati'}>
          {lavoro === 'esempio' ? 'Caricamento…' : 'Carica dati di esempio'}
        </Pulsante>
      </div>

      <AccountAmministratori />

      <div className="space-y-2 border-t border-gray-100 pt-3">
        <h3 className="font-ui text-sm font-semibold text-testo-forte">Copia di sicurezza</h3>
        <p className="text-sm text-gray-600">
          Logbook copia da solo il database e i file caricati una volta al giorno e tiene le copie 30 giorni (cartella <code>data\backup</code>, oppure quella di{' '}
          <code>LOGBOOK_BACKUP_DIR</code> nel file <code>.env</code>: meglio un altro disco). Qui ne fai una subito.
        </p>
        <Pulsante onClick={copiaOra} disabled={lavoro !== null}>
          {lavoro === 'copia' ? 'Copia in corso…' : 'Fai una copia adesso'}
        </Pulsante>
      </div>

      <div className="space-y-3 rounded border border-errore/30 bg-[#fdf3f2] p-3">
        <h3 className="font-ui text-sm font-semibold text-errore">Cancella tutti i dati</h3>
        <p className="text-sm text-gray-700">
          Cancella dipendenti, progetti, ore, assenze, attestati, documenti e file caricati, mansioni, festività locali e aziendali e tutti gli altri account.{' '}
          <b>Restano</b> il tuo account con la sua password, il collegamento a SkyTower, le festività nazionali e il registro attività. Prima Logbook fa una copia di
          sicurezza, che resta 30 giorni.
        </p>
        {!pronto ? (
          <Avviso tipo="attenzione">
            Per usarlo serve l'invio del codice via email. Nel file <code>.env</code> del server mancano:{' '}
            {[!stato.emailConfigurata && 'LOGBOOK_PROPRIETARIO_EMAIL (indirizzo che riceve il codice)', !stato.invioConfigurato && 'LOGBOOK_SMTP_HOST, LOGBOOK_SMTP_UTENTE e LOGBOOK_SMTP_PASSWORD (casella che lo spedisce)']
              .filter(Boolean)
              .join('; ')}
            . Dopo averli scritti va riavviato Logbook.
          </Avviso>
        ) : !inviato ? (
          // L'indirizzo sta fuori dal pulsante: lì il testo è tutto maiuscolo e un'email si leggerebbe male.
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Pulsante variante="pericolo" onClick={chiediCodice} disabled={lavoro !== null}>
              {lavoro === 'codice' ? 'Invio in corso…' : 'Invia il codice per email'}
            </Pulsante>
            <span className="text-sm text-gray-600">
              Arriva a <b>{stato.emailMascherata}</b>, valido 10 minuti.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <Avviso tipo="info">
              Codice inviato a <b>{inviato.inviatoA}</b>, valido fino alle {ora(inviato.scadeAlle)}. Non arrivato?{' '}
              <button type="button" className="font-semibold text-marchio underline" onClick={chiediCodice} disabled={lavoro !== null}>
                Invialo di nuovo
              </button>
            </Avviso>
            <div className="flex flex-wrap gap-3">
              <Campo etichetta="Codice ricevuto per email" errore={erroreCodice} className="w-48">
                <input
                  className={classiInput(erroreCodice)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={codice}
                  onChange={(e) => setCodice(e.target.value.replace(/\D/g, ''))}
                  placeholder="6 cifre"
                />
              </Campo>
              <Campo etichetta="Scrivi CANCELLA per confermare" className="w-56">
                <input className={classiInput()} autoComplete="off" value={conferma} onChange={(e) => setConferma(e.target.value)} placeholder="CANCELLA" />
              </Campo>
            </div>
            <Pulsante variante="pericolo" onClick={cancellaTutto} disabled={!confermabile || lavoro !== null}>
              {lavoro === 'cancella' ? 'Cancellazione…' : 'Cancella tutti i dati'}
            </Pulsante>
          </div>
        )}
      </div>
    </section>
  );
}
