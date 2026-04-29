import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { App } from './App';
import { AuthProvider } from './auth';
import { ThemeProvider } from './theme';
import { LanguageProvider } from './i18n';
import { SyncStateProvider } from './lib/sync-state';
import { registerServiceWorker } from './lib/sw';
import './index.css';

if (import.meta.env.PROD) registerServiceWorker();

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in apps/web/.env.local');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <LanguageProvider>
        <ThemeProvider>
          <BrowserRouter>
            <AuthProvider>
              <SyncStateProvider>
                <App />
              </SyncStateProvider>
            </AuthProvider>
          </BrowserRouter>
        </ThemeProvider>
      </LanguageProvider>
    </ClerkProvider>
  </StrictMode>,
);
