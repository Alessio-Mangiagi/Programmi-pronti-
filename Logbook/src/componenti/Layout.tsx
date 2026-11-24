// "><(((º> sabusabu <º)))><"
/**
 * Struttura di tutte le pagine dopo il login, nello stile Cosedil: menu laterale blu
 * #0c4577 con il logo della Suite Cosedil e icone lineari, intestazione bianca con utente,
 * cambio password ed esci, contenuto su fondo #f9f9fb.
 *
 * Il menu dipende dal ruolo: l'admin (HR) vede tutte le voci, il dipendente solo
 * Dashboard, Calendario, i propri progetti e le proprie assenze. Sotto i 768px il menu si apre col pulsante
 * a tre righe.
 *
 * Il contenuto (<main>) usa tutta la larghezza disponibile, anche sugli schermi ultra
 * wide: le pagine dispongono i blocchi in flexbox con a capo automatico (src/index.css,
 * "Layout adattabile"). Fino al 23/11 era fermo a 1400px al centro.
 */
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { formattaData, oggiIso } from '../../comune/date';
import { useAuth } from '../auth';
import { BloccoErrori } from './BloccoErrori';
import { CambiaPassword } from './CambiaPassword';
import { Notifiche } from './Segnalazioni';
import { Icona, type NomeIcona } from './icone';

type VoceMenu = { a: string; etichetta: string; icona: NomeIcona; soloAdmin?: boolean; etichettaDipendente?: string };

export const MENU: VoceMenu[] = [
  { a: '/', etichetta: 'Dashboard', icona: 'dashboard' },
  { a: '/calendario', etichetta: 'Calendario', icona: 'calendario' },
  { a: '/dipendenti', etichetta: 'Dipendenti', icona: 'dipendenti', soloAdmin: true },
  // Dal Giorno 17 il dipendente vede "I miei progetti" per caricare la documentazione di avanzamento.
  { a: '/progetti', etichetta: 'Progetti', icona: 'progetti', etichettaDipendente: 'I miei progetti' },
  { a: '/assenze', etichetta: 'Assenze', icona: 'assenze', etichettaDipendente: 'Le mie assenze' },
  { a: '/importa', etichetta: 'Importa', icona: 'importa', soloAdmin: true },
  { a: '/esporta', etichetta: 'Esporta', icona: 'esporta', soloAdmin: true },
  // Dal 24/11/2026: collegamento a SkyTower e altre impostazioni, solo amministratori.
  { a: '/impostazioni', etichetta: 'Impostazioni', icona: 'impostazioni', soloAdmin: true },
];

export function Layout() {
  const { utente, admin, logout, oggi, orologioDiverso } = useAuth();
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
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b border-bordo bg-white/95 px-3 backdrop-blur sm:px-4 md:px-6">
          <button type="button" className="flex items-center gap-2 rounded p-1.5 text-marchio hover:bg-ghiaccio md:hidden" onClick={() => setMenuAperto(true)} aria-label="Apri menu">
            <Icona nome="menu" dimensione={22} />
            {/* Sul telefono il menu laterale è chiuso: il nome del programma resta visibile qui. */}
            <span className="font-display text-base font-medium">Logbook</span>
          </button>
          <div className="ml-auto flex min-w-0 items-center gap-2 text-sm sm:gap-4">
            <span className="hidden rounded-full bg-ghiaccio px-2.5 py-0.5 font-ui text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-marchio sm:inline">
              {admin ? 'HR' : 'Dipendente'}
            </span>
            {/* Giorno 20: segnalazioni dei dipendenti (solo HR, finestra anche all'accesso). */}
            <Notifiche />
            <span className="truncate font-display font-medium text-testo-forte">{utente?.nomeVisualizzato}</span>
            <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded p-1.5 text-marchio transition-colors hover:text-marchio-hover" onClick={() => setCambioPassword(true)} aria-label="Cambia password">
              <Icona nome="chiave" dimensione={16} />
              <span className="hidden sm:inline">Cambia password</span>
            </button>
            <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1 text-gray-600 transition-colors hover:border-marchio hover:text-marchio" onClick={logout}>
              <Icona nome="esci" dimensione={16} />
              Esci
            </button>
          </div>
        </header>
        {/* Giorno 19: Logbook usa la data del server; se il PC ne ha un'altra lo si dice. */}
        {orologioDiverso && (
          <div role="alert" className="border-b border-[#e9c46a] bg-[#fdf1d6] px-3 py-2 text-sm text-[#6b4a00] sm:px-4 md:px-6">
            La data di questo computer ({formattaData(oggiIso())}) è diversa da quella di Logbook ({formattaData(oggi)}). Logbook usa la sua:
            «oggi» è il {formattaData(oggi)}. Controllate data e ora del PC.
          </div>
        )}
        <main className="w-full min-w-0 flex-1 px-3 py-4 sm:px-4 md:px-6 md:py-6 xl:px-8 4xl:px-12">
          <BloccoErrori chiave={posizione.pathname}>
            <Outlet />
          </BloccoErrori>
        </main>
      </div>
      <CambiaPassword aperta={cambioPassword} onChiudi={() => setCambioPassword(false)} />
    </div>
  );
}
