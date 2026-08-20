import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Bypass localtunnel "Click to Continue" page for all API fetch calls
const _originalFetch = window.fetch;
window.fetch = (url, options = {}) => {
  const headers = new Headers(options.headers || {});
  headers.set('bypass-tunnel-reminder', 'true');
  return _originalFetch(url, { ...options, headers });
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
