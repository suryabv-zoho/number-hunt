import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { useStore } from './store.js';
import { socket } from './socket.js';
import './index.css';

// Dev-only handle for poking at live state from the console (and for automated
// playthroughs). Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__nh = { store: useStore, socket };
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
