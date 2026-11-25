// "><(((º> sabusabu <º)))><"
/**
 * Punto d'ingresso del frontend: carica i font del marchio Cosedil (serviti dall'app, non
 * da Google: funzionano anche offline) e monta <App /> nella pagina (index.html, #radice).
 */
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/500.css';
import '@fontsource/ubuntu/700.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('radice')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
