import { useMemo, useState } from 'react';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDocument(html, text, blockImages) {
  const imgPolicy = blockImages ? "'none'" : 'http: https: data: blob:';
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgPolicy}; style-src 'unsafe-inline' http: https:; font-src http: https: data:; media-src http: https: data:; frame-src 'none'; form-action 'none'; script-src 'none';">`;
  const base = `<base target="_blank">`;
  const reset = `
    <style>
      html, body { margin: 0; padding: 0; min-height: 100%; }
      body {
        padding: 16px;
        background: #ffffff;
        color: #1e293b;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.6;
        word-wrap: break-word;
        overflow-wrap: anywhere;
      }
      img, video { max-width: 100%; height: auto; }
      table { max-width: 100%; border-collapse: collapse; }
      a { color: #2563eb; text-decoration: underline; }
      pre { white-space: pre-wrap; word-break: break-word; }
      ${blockImages ? 'img, picture, video { visibility: hidden !important; }' : ''}
    </style>
  `;

  let source = String(html || '').trim();
  if (!source && text) {
    source = `<pre>${escapeHtml(text)}</pre>`;
  }

  if (!source) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${csp}${base}${reset}</head><body><div style="padding:24px;color:#64748b;font-style:italic;font-family:Arial,sans-serif;">No message content available.</div></body></html>`;
  }

  const hasFullDocument = /<html[\s>]/i.test(source) || /<!doctype/i.test(source);
  if (hasFullDocument) {
    let document = source;
    if (/<head[^>]*>/i.test(document)) {
      document = document.replace(/<head([^>]*)>/i, `<head$1>${csp}${base}${reset}`);
    } else if (/<html[^>]*>/i.test(document)) {
      document = document.replace(/<html([^>]*)>/i, `<html$1><head>${csp}${base}${reset}</head>`);
    } else {
      document = `${csp}${base}${reset}${document}`;
    }
    return document;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${csp}${base}${reset}</head><body>${source}</body></html>`;
}

export default function EmailHtmlViewer({
  html,
  text,
  title = 'Email content',
  height = 480,
  allowImagesDefault = true,
  showImageToggle = true,
}) {
  const [imagesAllowed, setImagesAllowed] = useState(Boolean(allowImagesDefault));

  const hasImages = useMemo(
    () => /<img\b|background-image\s*:|url\(/i.test(String(html || '')),
    [html]
  );

  const document = useMemo(
    () => buildDocument(html, text, !imagesAllowed),
    [html, text, imagesAllowed]
  );

  return (
    <div className="email-html-viewer">
      {showImageToggle && hasImages && (
        <div className="email-html-viewer-bar">
          <span>{imagesAllowed ? 'Remote images loaded from sender' : 'Remote images blocked'}</span>
          <button type="button" onClick={() => setImagesAllowed(prev => !prev)}>
            {imagesAllowed ? 'Block images' : 'Show images'}
          </button>
        </div>
      )}
      <iframe
        title={title}
        srcDoc={document}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: `${height}px`, border: 'none', display: 'block', background: '#ffffff' }}
      />
    </div>
  );
}
