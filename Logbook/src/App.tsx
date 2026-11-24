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
import { Progetti } from './pagine/Progetti';
import { SchedaDipendente } from './pagine/SchedaDipendente';

function SoloAdmin({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  return admin ? <>{children}</> : <Navigate to="/" replace />;
}

function Rotte() {
  const { utente, caricamento } = useAuth();
  if (caricamento) return <Caricamento testo="Avvio di Logbook…" />;
  if (!utente) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="dipendenti" element={<SoloAdmin><Dipendenti /></SoloAdmin>} />
        <Route path="dipendenti/:id" element={<SoloAdmin><SchedaDipendente /></SoloAdmin>} />
        <Route path="progetti" element={<SoloAdmin><Progetti /></SoloAdmin>} />
        <Route path="assenze" element={<Assenze />} />
        <Route path="importa" element={<SoloAdmin><Importa /></SoloAdmin>} />
        <Route path="esporta" element={<SoloAdmin><Esporta /></SoloAdmin>} />
        <Route path="impostazioni" element={<SoloAdmin><Impostazioni /></SoloAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <FornitoreAuth>
      <BrowserRouter>
        <Rotte />
      </BrowserRouter>
    </FornitoreAuth>
  );
}
