import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIos() {
  const ua = window.navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/**
 * "Install app" button for Email One.
 * - Android / Chrome / Edge / desktop: uses the browser's install prompt.
 * - iPhone / iPad (Safari has no prompt): shows "Share → Add to Home Screen" steps.
 * Hidden once the app is installed / opened as an app.
 */
export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;
  const ios = isIos();
  if (!deferredPrompt && !ios) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        const choice = await deferredPrompt.userChoice;
        if (choice?.outcome === 'accepted') setInstalled(true);
      } finally {
        setDeferredPrompt(null);
      }
      return;
    }
    setShowIosHelp(true);
  };

  return (
    <>
      <button type="button" className="btn btn-primary install-app-btn" onClick={handleClick} title="Install Email One on this device">
        <Download size={14} />
        <span>Install app</span>
      </button>

      {showIosHelp && (
        <div className="install-help-backdrop" onClick={() => setShowIosHelp(false)}>
          <div className="install-help" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="install-help-close" onClick={() => setShowIosHelp(false)} aria-label="Close">
              <X size={16} />
            </button>
            <img src="/icons/icon-192.png" alt="" width="56" height="56" />
            <h3>Install Email One</h3>
            <ol>
              <li>Tap the <Share size={14} style={{ verticalAlign: '-2px' }} /> <strong>Share</strong> button in Safari.</li>
              <li>Choose <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong>. Email One opens like a normal app.</li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
