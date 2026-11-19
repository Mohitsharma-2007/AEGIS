import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './style.css';
import './editor.css';
import { watchSystemTheme } from './theme';

// Browser-safe process shim for any libraries expecting Node globals
if (typeof window !== 'undefined') {
  const win = window as unknown as { process?: Record<string, unknown> };
  if (!win.process) {
    win.process = {
      env: {},
      platform: typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || '') ? 'win32' : 'darwin',
      version: 'v20.18.0',
      versions: { node: '20.18.0' },
      nextTick: (cb: (...args: unknown[]) => void, ...args: unknown[]) => setTimeout(() => cb(...args), 0),
    };
  }
}

watchSystemTheme();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Aegis Desktop Recovery">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
