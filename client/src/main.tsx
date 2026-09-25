import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { useStore } from './store.js';
import { socket } from './socket.js';
import { applyTheme, storedTheme } from './themes.js';
import './index.css';

// Before the first render, so nothing is ever painted in the wrong theme.
applyTheme(storedTheme());

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
