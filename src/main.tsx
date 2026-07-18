import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

// Sovelluksen käynnistyspiste. StrictMode auttaa löytämään sivuvaikutusongelmat
// kehityksessä.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
