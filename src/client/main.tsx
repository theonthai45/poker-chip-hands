import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { sfx } from './sound';
import './styles.css';

// Browsers only start audio after a touch or key press.
addEventListener('pointerdown', sfx.unlock, { passive: true });
addEventListener('keydown', sfx.unlock, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
