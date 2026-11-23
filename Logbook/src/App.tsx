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
import { Caricamento, InArrivo } from './componenti/ui';
import { Dashboard } from './pagine/Dashboard';
import { Dipendenti } from './pagine/Dipendenti';
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
        <Route path="calendario" element={<InArrivo titolo="Calendario" giorno={5} />} />
        <Route path="dipendenti" element={<SoloAdmin><Dipendenti /></SoloAdmin>} />
        <Route path="dipendenti/:id" element={<SoloAdmin><SchedaDipendente /></SoloAdmin>} />
        <Route path="progetti" element={<SoloAdmin><Progetti /></SoloAdmin>} />
        <Route path="assenze" element={<InArrivo titolo="Assenze" giorno={6} />} />
        <Route path="importa" element={<SoloAdmin><InArrivo titolo="Importa" giorno={7} /></SoloAdmin>} />
        <Route path="esporta" element={<SoloAdmin><InArrivo titolo="Esporta" giorno={8} /></SoloAdmin>} />
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
