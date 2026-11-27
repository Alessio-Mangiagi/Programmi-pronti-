// "><(((º> sabusabu <º)))><"
/**
 * Pagina obbligatoria del cambio password (Giorno 24, risposta 1a del 24/11/2026).
 *
 * Compare al posto di Copilota quando l'utente è entrato con una password provvisoria:
 * quella che HR ha dato al dipendente, quella dell'amministratore creato all'avvio o una
 * password di prova scritta nel README. Finché non la cambia non vede nessun dato (le API
 * rispondono 403, server/middleware.ts); dopo il salvataggio si rilegge l'utente e si entra.
 * Stessa impaginazione della pagina di accesso (Login.tsx).
 */
import { conPercorso } from '../percorso';
import { useAuth } from '../auth';
import { ModuloPassword } from '../componenti/CambiaPassword';
import { Pulsante } from '../componenti/ui';

export function PasswordProvvisoria() {
  const { utente, ricarica, logout } = useAuth();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-fondo p-3 sm:p-4">
      <div className="scheda w-full max-w-md overflow-hidden">
        <div className="flex items-center gap-3 bg-marchio px-5 py-4 text-white">
          <img src={conPercorso('/logo-cosedil-chiaro.png')} alt="" className="h-10 w-10 rounded-lg" />
          <div className="leading-tight">
            <div className="font-display text-xl font-medium">Copilota</div>
            <div className="font-ui text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-white/70">Suite Cosedil</div>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-8">
          <div>
            <div className="sopratitolo">Primo accesso</div>
            <h1 className="font-display text-2xl font-normal text-testo-forte">Scegli la tua password</h1>
            <p className="mt-1 text-sm text-gray-500">
              {utente?.nomeVisualizzato ? `${utente.nomeVisualizzato}, la` : 'La'} password con cui sei entrato è provvisoria. Per usare Copilota
              scegline una tua: da quel momento la conosci solo tu.
            </p>
          </div>
          <ModuloPassword onCambiata={ricarica} testoSalva="Salva ed entra" secondario={<Pulsante onClick={logout}>Esci</Pulsante>} />
        </div>
      </div>
    </div>
  );
}
