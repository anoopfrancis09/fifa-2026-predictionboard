import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './styles.css';

const platform = Capacitor.getPlatform();
document.documentElement.dataset.platform = platform;
document.documentElement.classList.toggle('capacitor-ios', platform === 'ios');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
