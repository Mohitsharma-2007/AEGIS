import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/patrick-hand/latin-400.css';
import './style.css';
import './layer.css';
import App from './App.jsx';
import LayerApp from './LayerApp.jsx';

const layer = new URLSearchParams(window.location.search).get('layer') === '1';
if (layer) {
  document.documentElement.classList.add('layer-mode');
  document.title = 'Aegis — Visual Layer';
}

createRoot(document.getElementById('root')).render(layer ? <LayerApp /> : <App />);
