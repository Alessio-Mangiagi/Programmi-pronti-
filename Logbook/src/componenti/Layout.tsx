// "><(((º> sabusabu <º)))><"
/**
 * Struttura di tutte le pagine dopo il login, nello stile Cosedil: menu laterale blu
 * #0c4577 con il logo della Suite Cosedil e icone lineari, intestazione bianca con utente,
 * cambio password ed esci, contenuto su fondo #f9f9fb.
 *
 * Il menu dipende dal ruolo: l'admin (HR) vede tutte le voci, il dipendente solo
 * Dashboard, Calendario e le proprie assenze. Sotto i 768px il menu si apre col pulsante
 * a tre righe.
 */
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { BloccoErrori } from './BloccoErrori';
import { CambiaPassword } from './CambiaPassword';
import { Icona, type NomeIcona } from './icone';

type VoceMenu = { a: string; etichetta: string; icona: NomeIcona; soloAdmin?: boolean; etichettaDipendente?: string };

export const MENU: VoceMenu[] = [
  { a: '/', etichetta: 'Dashboard', icona: 'dashboard' },
  { a: '/calendario', etichetta: 'Calendario', icona: 'calendario' },
  { a: '/dipendenti', etichetta: 'Dipendenti', icona: 'dipendenti', soloAdmin: true },
  { a: '/progetti', etichetta: 'Progetti', icona: 'progetti', soloAdmin: true },
  { a: '/assenze', etichetta: 'Assenze', icona: 'assenze', etichettaDipendente: 'Le mie assenze' },
  { a: '/importa', etichetta: 'Importa', icona: 'importa', soloAdmin: true },
  { a: '/esporta', etichetta: 'Esporta', icona: 'esporta', soloAdmin: true },
];

export function Layout() {
  const { utente, admin, logout } = useAuth();
  const [menuAperto, setMenuAperto] = useState(false);
  const [cambioPassword, setCambioPassword] = useState(false);
  const posizione = useLocation();
  const voci = MENU.filter((v) => admin || !v.soloAdmin);

  return (
    <div className="flex min-h-[100dvh]">
      {/* Menu laterale */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-60 transform flex-col bg-marchio text-white transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:static md:translate-x-0 ${
          menuAperto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-white/15 px-4 py-4">
          <img src="/logo-cosedil-chiaro.png" alt="" className="h-10 w-10 rounded-lg" />
          <div className="leading-tight">
            <div className="font-display text-xl font-medium tracking-wide">Logbook</div>
            <div className="font-ui text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-white/65">Ore e presenze</div>
          </div>
        </div>
        <nav className="flex-1 py-3" aria-label="Menu principale">
          {voci.map((v) => (
            <NavLink
              key={v.a}
              to={v.a}
              end={v.a === '/'}
              onClick={() => setMenuAperto(false)}
              className={({ isActive }) =>
                `mx-2 mb-0.5 flex items-center gap-3 rounded border-l-[3px] px-3 py-2 font-display text-[0.92rem] transition-colors duration-300 ${
                  isActive ? 'border-marchio-verde bg-white/12 text-white' : 'border-transparent text-white/80 hover:bg-white/6 hover:text-white'
                }`
              }
            >
              <Icona nome={v.icona} dimensione={18} />
              {!admin && v.etichettaDipendente ? v.etichettaDipendente : v.etichetta}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/15 px-4 py-3 font-ui text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-white/55">
          {admin ? 'Amministrazione / HR' : 'Area dipendente'}
          <div className="mt-0.5 font-sans text-[0.7rem] normal-case tracking-normal text-white/45">Suite Cosedil</div>
        </div>
      </aside>
      {menuAperto && <div className="fixed inset-0 z-20 bg-[#212326]/40 md:hidden" onClick={() => setMenuAperto(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Intestazione */}
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-bordo bg-white/95 px-4 backdrop-blur md:px-6">
          <button type="button" className="rounded p-1.5 text-marchio hover:bg-ghiaccio md:hidden" onClick={() => setMenuAperto(true)} aria-label="Apri menu">
            <Icona nome="menu" dimensione={22} />
          </button>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="hidden rounded-full bg-ghiaccio px-2.5 py-0.5 font-ui text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-marchio sm:inline">
              {admin ? 'HR' : 'Dipendente'}
            </span>
            <span className="font-display font-medium text-testo-forte">{utente?.nomeVisualizzato}</span>
            <button type="button" className="inline-flex items-center gap-1.5 text-marchio transition-colors hover:text-marchio-hover" onClick={() => setCambioPassword(true)}>
              <Icona nome="chiave" dimensione={16} />
              <span className="hidden sm:inline">Cambia password</span>
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1 text-gray-600 transition-colors hover:border-marchio hover:text-marchio" onClick={logout}>
              <Icona nome="esci" dimensione={16} />
              Esci
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 md:px-8 md:py-6">
          <BloccoErrori chiave={posizione.pathname}>
            <Outlet />
          </BloccoErrori>
        </main>
      </div>
      <CambiaPassword aperta={cambioPassword} onChiudi={() => setCambioPassword(false)} />
    </div>
  );
}
