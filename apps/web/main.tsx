/**
 * Main Entry Point - React application bootstrap
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './globals.css';

// Archive builds (VITE_SITE_MODE=archive) bundle only the static docs site.
const loadApp = import.meta.env.VITE_SITE_MODE === 'archive'
  ? import('./components/archive/ArchiveApp').then((m) => m.ArchiveApp)
  : import('./App').then((m) => m.default);

loadApp.then((App) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});

