// "><(((º> sabusabu <º)))><"
/**
 * Radice dell'interfaccia: login, poi le pagine dentro il Layout col menu laterale.
 *
 * Le pagine riservate a HR sono avvolte in <SoloAdmin>: un dipendente che scrive
 * l'indirizzo a mano torna alla Dashboard. È solo comodità: le API rifiutano comunque
 * (server/middleware.ts).
 */
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { FornitoreAuth, useAuth } from './auth';
import { PERCORSO } from './percorso';
import { Layout } from './componenti/Layout';
import { Caricamento } from './componenti/ui';
import { Assenze } from './pagine/Assenze';
import { Calendario } from './pagine/Calendario';
import { Dashboard } from './pagine/Dashboard';
import { Dipendenti } from './pagine/Dipendenti';
import { Esporta } from './pagine/Esporta';
import { Importa } from './pagine/Importa';
import { Impostazioni } from './pagine/Impostazioni';
import { Login } from './pagine/Login';
import { PasswordProvvisoria } from './pagine/PasswordProvvisoria';
import { Progetti } from './pagine/Progetti';
import { Registro } from './pagine/Registro';
import { Squadra } from './pagine/Squadra';
import { NoteSpese } from './pagine/NoteSpese';
import { SchedaAssenza } from './pagine/SchedaAssenza';
import { SchedaDipendente } from './pagine/SchedaDipendente';
import { SchedaProgetto } from './pagine/SchedaProgetto';

function SoloAdmin({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  return admin ? <>{children}</> : <Navigate to="/" replace />;
}

function Rotte() {
  const { utente, caricamento } = useAuth();
  if (caricamento) return <Caricamento testo="Avvio di Copilota…" />;
  if (!utente) return <Login />;
  // Giorno 24 (risposta 1a): con la password provvisoria si vede solo la pagina per
  // cambiarla; anche le API rifiutano tutto il resto (server/middleware.ts).
  if (utente.passwordDaCambiare) return <PasswordProvvisoria />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="dipendenti" element={<SoloAdmin><Dipendenti /></SoloAdmin>} />
        <Route path="dipendenti/:id" element={<SoloAdmin><SchedaDipendente /></SoloAdmin>} />
        {/* Dal Giorno 17 anche il dipendente: "I miei progetti" e la loro documentazione (il server filtra). */}
        <Route path="progetti" element={<Progetti />} />
        <Route path="progetti/:id" element={<SchedaProgetto />} />
        <Route path="assenze" element={<Assenze />} />
        {/* Giorno 18: l'assenza si inserisce e si decide in una pagina, come le anagrafiche. */}
        <Route path="assenze/:id" element={<SchedaAssenza />} />
        <Route path="importa" element={<SoloAdmin><Importa /></SoloAdmin>} />
        <Route path="esporta" element={<SoloAdmin><Esporta /></SoloAdmin>} />
        <Route path="impostazioni" element={<SoloAdmin><Impostazioni /></SoloAdmin>} />
        <Route path="registro" element={<SoloAdmin><Registro /></SoloAdmin>} />
        {/* Giorno 43: pagina del caposquadra (chi non lo è vede un avviso; il server rifiuta comunque). */}
        <Route path="squadra" element={<Squadra />} />
        {/* Giorno 45: note spese (il dipendente le sue, HR tutte). */}
        <Route path="note-spese" element={<NoteSpese />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <FornitoreAuth>
      {/* basename: sotto LOGBOOK_PERCORSO le pagine sono /copilota/calendario e così via (src/percorso.ts). */}
      <BrowserRouter basename={PERCORSO || undefined}>
        <Rotte />
      </BrowserRouter>
    </FornitoreAuth>
  );
}
