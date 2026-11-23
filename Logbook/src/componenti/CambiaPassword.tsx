// "><(((º> sabusabu <º)))><"
/**
 * Finestra "Cambia password" (POST /api/auth/password). Chiede la password attuale;
 * la nuova deve avere almeno 8 caratteri con lettere e numeri (regola del server).
 */
import { useState, type FormEvent } from 'react';
import { api, ErroreApi } from '../api';
import { Avviso, Campo, classiInput, Modale, Pulsante } from './ui';

export function CambiaPassword({ aperta, onChiudi }: { aperta: boolean; onChiudi: () => void }) {
  const [attuale, setAttuale] = useState('');
  const [nuova, setNuova] = useState('');
  const [conferma, setConferma] = useState('');
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const [invio, setInvio] = useState(false);

  const chiudi = () => {
    setAttuale('');
    setNuova('');
    setConferma('');
    setErrori({});
    setMessaggio(null);
    onChiudi();
  };

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    if (nuova !== conferma) {
      setErrori({ conferma: 'Le due password non coincidono' });
      return;
    }
    setInvio(true);
    setErrori({});
    try {
      await api.post('/api/auth/password', { attuale, nuova });
      setMessaggio({ tipo: 'successo', testo: 'Password cambiata.' });
      setAttuale('');
      setNuova('');
      setConferma('');
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio({ tipo: 'errore', testo: err.message });
      }
    } finally {
      setInvio(false);
    }
  };

  return (
    <Modale titolo="Cambia password" aperta={aperta} onChiudi={chiudi} larghezza="max-w-sm">
      <form onSubmit={salva} className="space-y-3">
        {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}
        <Campo etichetta="Password attuale" errore={errori.attuale} obbligatorio>
          <input type="password" autoComplete="current-password" className={classiInput(errori.attuale)} value={attuale} onChange={(e) => setAttuale(e.target.value)} />
        </Campo>
        <Campo etichetta="Nuova password" errore={errori.nuova} obbligatorio aiuto="Almeno 8 caratteri, con lettere e numeri">
          <input type="password" autoComplete="new-password" className={classiInput(errori.nuova)} value={nuova} onChange={(e) => setNuova(e.target.value)} />
        </Campo>
        <Campo etichetta="Ripeti la nuova password" errore={errori.conferma} obbligatorio>
          <input type="password" autoComplete="new-password" className={classiInput(errori.conferma)} value={conferma} onChange={(e) => setConferma(e.target.value)} />
        </Campo>
        <div className="flex justify-end gap-2 pt-1">
          <Pulsante onClick={chiudi}>Chiudi</Pulsante>
          <Pulsante type="submit" variante="primario" disabled={invio || !attuale || !nuova}>
            {invio ? 'Salvataggio…' : 'Salva'}
          </Pulsante>
        </div>
      </form>
    </Modale>
  );
}
