import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Indian Type Foundry faces, self-hosted: Yantramanav for the interface,
// Rajdhani for headings and numerals, Kalam for the scribe's notes.
import '@fontsource/yantramanav/400.css';
import '@fontsource/yantramanav/500.css';
import '@fontsource/yantramanav/700.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/kalam/400.css';
import './styles/app.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
