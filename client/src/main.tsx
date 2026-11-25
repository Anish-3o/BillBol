import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './index.css';
// Imported here, before anything renders, so the one-time "can install" event is never missed.
import './lib/installPrompt';

// After a deploy, a tab opened before it may ask for a page file (e.g. DashboardPage-abc123.js)
// that no longer exists, because file names change with every build. Vite reports this as
// "vite:preloadError"; reloading picks up the new build. The flag stops an endless reload loop
// if the file is missing for some other reason.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('billbol-reloaded-for-update')) return;
  sessionStorage.setItem('billbol-reloaded-for-update', '1');
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => sessionStorage.removeItem('billbol-reloaded-for-update'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
