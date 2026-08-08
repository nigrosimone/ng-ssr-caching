import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import App from './App.jsx';

// what the server already fetched, so the browser does not ask for it a second time
const state = window.__SSR_STATE__ ?? {};

hydrateRoot(
  document.getElementById('root'),
  <React.StrictMode>
    <App initialData={state.initialData ?? null} initialError={state.initialError ?? null} />
  </React.StrictMode>
);
