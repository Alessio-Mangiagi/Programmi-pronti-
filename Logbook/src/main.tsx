// "><(((º> sabusabu <º)))><"
/**
 * Punto d'ingresso del frontend: monta <App /> nella pagina (index.html, #radice).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('radice')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
