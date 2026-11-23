// "><(((º> sabusabu <º)))><"
/**
 * Struttura di tutte le pagine dopo il login: menu laterale a sinistra, intestazione
 * con utente collegato, cambio password e logout, contenuto della pagina a destra.
 *
 * Il menu dipende dal ruolo: l'admin (HR) vede tutte le voci, il dipendente solo
 * Dashboard, Calendario e le proprie assenze. Su schermi stretti il menu si apre col
 * pulsante ☰.
 */
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { BloccoErrori } from './BloccoErrori';
import { CambiaPassword } from './CambiaPassword';

type VoceMenu = { a: string; etichetta: string; soloAdmin?: boolean; etichettaDipendente?: string };

export const MENU: VoceMenu[] = [
  { a: '/', etichetta: 'Dashboard' },
  { a: '/calendario', etichetta: 'Calendario' },
  { a: '/dipendenti', etichetta: 'Dipendenti', soloAdmin: true },
  { a: '/progetti', etichetta: 'Progetti', soloAdmin: true },
  { a: '/assenze', etichetta: 'Assenze', etichettaDipendente: 'Le mie assenze' },
  { a: '/importa', etichetta: 'Importa', soloAdmin: true },
  { a: '/esporta', etichetta: 'Esporta', soloAdmin: true },
];

export function Layout() {
  const { utente, admin, logout } = useAuth();
  const [menuAperto, setMenuAperto] = useState(false);
  const [cambioPassword, setCambioPassword] = useState(false);
  const posizione = useLocation();
  const voci = MENU.filter((v) => admin || !v.soloAdmin);

  return (
    <div className="flex min-h-screen">
      {/* Menu laterale */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-56 transform bg-marchio text-white transition-transform md:static md:translate-x-0 ${
          menuAperto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-12 items-center gap-2 border-b border-white/15 px-4">
          <span className="text-lg font-semibold tracking-wide">Logbook</span>
          <span className="rounded bg-marchio-verde px-1.5 text-[10px] font-bold uppercase text-marchio-scuro">ore</span>
        </div>
        <nav className="py-2" aria-label="Menu principale">
          {voci.map((v) => (
            <NavLink
              key={v.a}
              to={v.a}
              end={v.a === '/'}
              onClick={() => setMenuAperto(false)}
              className={({ isActive }) =>
                `block border-l-4 px-4 py-2 text-sm ${
                  isActive ? 'border-marchio-verde bg-white/10 font-semibold' : 'border-transparent text-white/85 hover:bg-white/5'
                }`
              }
            >
              {!admin && v.etichettaDipendente ? v.etichettaDipendente : v.etichetta}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-white/15 px-4 py-2 text-xs text-white/60">
          {admin ? 'Amministrazione / HR' : 'Area dipendente'}
        </div>
      </aside>
      {menuAperto && <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setMenuAperto(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Intestazione */}
        <header className="flex h-12 items-center justify-between border-b border-gray-200 bg-white px-4 shadow-sm">
          <button type="button" className="rounded px-2 text-xl md:hidden" onClick={() => setMenuAperto(true)} aria-label="Apri menu">
            ☰
          </button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-gray-500 sm:inline">{admin ? 'HR' : 'Dipendente'}</span>
            <span className="font-medium text-gray-800">{utente?.nomeVisualizzato}</span>
            <button type="button" className="text-marchio hover:underline" onClick={() => setCambioPassword(true)}>
              Cambia password
            </button>
            <button type="button" className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50" onClick={logout}>
              Esci
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <BloccoErrori chiave={posizione.pathname}>
            <Outlet />
          </BloccoErrori>
        </main>
      </div>
      <CambiaPassword aperta={cambioPassword} onChiudi={() => setCambioPassword(false)} />
    </div>
  );
}
