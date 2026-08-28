import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PreviewApp } from './preview/PreviewApp';
import { registerServiceWorker } from './pwa/registerServiceWorker';
import { watchKeyboardInset } from './viewport';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('No #root element found in index.html.');
}

/**
 * The preview harness, for looking at screens without signing in.
 *
 * `import.meta.env.DEV` is a compile-time constant, so this whole branch —
 * and the modules it reaches — is eliminated from a production build.
 */
const previewing = import.meta.env.DEV && window.location.hash.startsWith('#/preview');

createRoot(container).render(
  <StrictMode>{previewing ? <PreviewApp /> : <App />}</StrictMode>,
);

registerServiceWorker();

// Publishes --keyboard-inset, which is what keeps the quiz's buttons above the
// on-screen keyboard. Started here so the preview harness gets it too.
watchKeyboardInset();
