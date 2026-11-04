/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

const PDFJS_VERSION = '3.11.174';
const PDFJS_SRC = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const MAMMOTH_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
const MAX_PDF_PAGES = 50;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_SHEET_ROWS = 1000;
const MAX_SHEET_COLS = 60;

// One shared loader per external library so each script is only injected once.
const scriptPromises = {};

function loadScript(src, globalName, friendlyName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!scriptPromises[src]) {
    scriptPromises[src] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        if (window[globalName]) {
          resolve(window[globalName]);
        } else {
          delete scriptPromises[src];
          reject(new Error(`${friendlyName} did not initialize.`));
        }
      };
      script.onerror = () => {
        delete scriptPromises[src];
        reject(new Error(`Could not load the ${friendlyName} (no internet?).`));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromises[src];
}

async function loadPdfJs() {
  const pdfjs = await loadScript(PDFJS_SRC, 'pdfjsLib', 'PDF viewer');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjs;
}

const loadXlsx = () => loadScript(XLSX_SRC, 'XLSX', 'Excel viewer');
const loadMammoth = () => loadScript(MAMMOTH_SRC, 'mammoth', 'Word viewer');

export function buildAttachmentUrl(attachment, inline = false) {
  return `/api/mailbox/attachments/${encodeURIComponent(attachment.messageId)}/${encodeURIComponent(attachment.attachmentId)}` +
    `?mime=${encodeURIComponent(attachment.mimeType || 'application/octet-stream')}` +
    `&filename=${encodeURIComponent(attachment.filename || 'attachment')}` +
    (inline ? '&inline=1' : '');
}

function fileExtension(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : '';
}

function detectKind(attachment) {
  const mime = String(attachment.mimeType || '').toLowerCase();
  const ext = fileExtension(attachment.filename);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (
    [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel.sheet.macroenabled.12',
    ].includes(mime) ||
    ['xls', 'xlsx', 'xlsm', 'xlsb', 'ods'].includes(ext)
  ) return 'excel';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) return 'docx';
  if (
    mime.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/javascript'].includes(mime) ||
    ['txt', 'csv', 'log', 'json', 'xml', 'md', 'html', 'htm', 'js'].includes(ext)
  ) return 'text';
  return 'other';
}

function formatSize(size) {
  if (!size) return '';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/**
 * AttachmentViewer - full-screen preview for a Gmail attachment.
 * Previews PDFs (pdf.js), Excel sheets (SheetJS), Word documents (mammoth),
 * images, text, audio and video inline; other file types get a friendly
 * fallback with a Download button.
 *
 * attachment: { messageId, attachmentId, filename, mimeType, size }
 */
export default function AttachmentViewer({ attachment, onClose }) {
  const kind = detectKind(attachment);
  const previewUrl = buildAttachmentUrl(attachment, true);
  const downloadUrl = buildAttachmentUrl(attachment, false);

  const [status, setStatus] = useState(kind === 'other' ? 'unsupported' : 'loading');
  const [error, setError] = useState('');
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfTruncated, setPdfTruncated] = useState(false);
  const [pdfFallback, setPdfFallback] = useState(false);
  const [textContent, setTextContent] = useState('');
  const [excelSheets, setExcelSheets] = useState([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [docxHtml, setDocxHtml] = useState('');
  const [zoom, setZoom] = useState(1);

  const pagesRef = useRef(null);
  const zoomRef = useRef(1);

  const canZoom = kind === 'pdf' || kind === 'image';

  // Lock page scroll while the viewer is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Apply zoom to already rendered PDF pages without re-rendering them.
  useEffect(() => {
    zoomRef.current = zoom;
    const container = pagesRef.current;
    if (!container) return;
    container.querySelectorAll('.attachment-pdf-page').forEach(canvas => {
      const base = parseFloat(canvas.dataset.baseWidth || '0');
      if (base > 0) canvas.style.width = `${Math.round(base * zoom)}px`;
    });
  }, [zoom]);

  // PDF: fetch + render pages with pdf.js.
  useEffect(() => {
    if (kind !== 'pdf') return undefined;
    let cancelled = false;

    (async () => {
      try {
        setStatus('loading');
        let pdfjs;
        try {
          pdfjs = await loadPdfJs();
        } catch {
          // No pdf.js (e.g. offline): let the browser try to render it natively.
          if (!cancelled) {
            setPdfFallback(true);
            setStatus('ready');
          }
          return;
        }

        const res = await fetch(previewUrl);
        if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status}).`);
        const data = await res.arrayBuffer();
        if (cancelled) return;

        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        setPdfPages(doc.numPages);
        setPdfTruncated(doc.numPages > MAX_PDF_PAGES);

        const container = pagesRef.current;
        if (!container) return;
        container.innerHTML = '';

        const baseWidth = Math.min(Math.max(container.clientWidth - 24, 280), 980);
        // Render at >= 2x so zooming to 200% stays sharp without re-rendering.
        const outputRatio = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
        const total = Math.min(doc.numPages, MAX_PDF_PAGES);

        for (let i = 1; i <= total; i += 1) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = (baseWidth / baseViewport.width) * outputRatio;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'attachment-pdf-page';
          canvas.dataset.baseWidth = String(baseWidth);
          canvas.style.width = `${Math.round(baseWidth * zoomRef.current)}px`;
          container.appendChild(canvas);

          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          // Show the document as soon as the first page is painted.
          if (i === 1 && !cancelled) setStatus('ready');
        }
        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not preview this file.');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kind, previewUrl]);

  // Text files: fetch and show inline.
  useEffect(() => {
    if (kind !== 'text') return undefined;
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const res = await fetch(previewUrl);
        if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status}).`);
        const blob = await res.blob();
        const slice = blob.size > MAX_TEXT_BYTES ? blob.slice(0, MAX_TEXT_BYTES) : blob;
        const text = await slice.text();
        if (cancelled) return;
        setTextContent(blob.size > MAX_TEXT_BYTES ? `${text}\n\n… file truncated for preview. Download to see everything.` : text);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not preview this file.');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, previewUrl]);

  // Excel files (.xls / .xlsx): parse with SheetJS and show as tables.
  useEffect(() => {
    if (kind !== 'excel') return undefined;
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const [XLSX, res] = await Promise.all([loadXlsx(), fetch(previewUrl)]);
        if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status}).`);
        const data = await res.arrayBuffer();
        if (cancelled) return;

        const workbook = XLSX.read(data, { type: 'array' });
        const sheets = workbook.SheetNames.map(name => {
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false });
          const totalRows = rows.length;
          const limited = rows.slice(0, MAX_SHEET_ROWS).map(row =>
            (Array.isArray(row) ? row.slice(0, MAX_SHEET_COLS) : []).map(cell => String(cell ?? ''))
          );
          const width = limited.reduce((max, row) => Math.max(max, row.length), 0);
          return { name, rows: limited, width, truncated: totalRows > MAX_SHEET_ROWS, totalRows };
        });

        if (cancelled) return;
        setExcelSheets(sheets);
        setActiveSheet(0);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not preview this Excel file.');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, previewUrl]);

  // Word documents (.docx): convert to HTML with mammoth.
  useEffect(() => {
    if (kind !== 'docx') return undefined;
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const [mammoth, res] = await Promise.all([loadMammoth(), fetch(previewUrl)]);
        if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status}).`);
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setDocxHtml(result.value || '<p>(empty document)</p>');
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not preview this Word document.');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, previewUrl]);

  const onBackdropClick = useCallback((event) => {
    if (event.target === event.currentTarget) onClose();
  }, [onClose]);

  const zoomOut = () => setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
  const zoomIn = () => setZoom(z => Math.min(3, Math.round((z + 0.25) * 100) / 100));

  return (
    <div className="attachment-viewer-backdrop" onClick={onBackdropClick} role="dialog" aria-modal="true">
      <div className="attachment-viewer">
        <div className="attachment-viewer-head">
          <FileText size={16} className="attachment-viewer-fileicon" />
          <span className="attachment-viewer-name" title={attachment.filename}>
            {attachment.filename || 'attachment'}
          </span>
          {attachment.size ? <span className="attachment-viewer-size">{formatSize(attachment.size)}</span> : null}
          <div className="attachment-viewer-actions">
            {canZoom && (
              <>
                <button type="button" onClick={zoomOut} title="Zoom out" disabled={zoom <= 0.5}>
                  <ZoomOut size={16} />
                </button>
                <span className="attachment-viewer-zoom">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={zoomIn} title="Zoom in" disabled={zoom >= 3}>
                  <ZoomIn size={16} />
                </button>
              </>
            )}
            <a href={downloadUrl} title="Download" download={attachment.filename || 'attachment'}>
              <Download size={16} />
            </a>
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab">
              <ExternalLink size={16} />
            </a>
            <button type="button" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="attachment-viewer-body">
          {status === 'loading' && (
            <div className="attachment-viewer-loading">
              <Loader2 size={26} className="spinner" />
              Loading preview…
            </div>
          )}

          {status === 'error' && (
            <div className="attachment-viewer-fallback">
              <FileText size={40} />
              <p>{error}</p>
              <div className="attachment-viewer-fallback-actions">
                <a className="btn btn-primary" href={downloadUrl} download={attachment.filename || 'attachment'}>
                  <Download size={14} />
                  Download file
                </a>
              </div>
            </div>
          )}

          {status === 'unsupported' && (
            <div className="attachment-viewer-fallback">
              <FileText size={40} />
              <p>
                Preview isn&apos;t available for this file type
                {attachment.mimeType ? ` (${attachment.mimeType})` : ''}.
              </p>
              <div className="attachment-viewer-fallback-actions">
                <a className="btn btn-primary" href={downloadUrl} download={attachment.filename || 'attachment'}>
                  <Download size={14} />
                  Download file
                </a>
                <a className="btn btn-secondary" href={previewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} />
                  Open in new tab
                </a>
              </div>
            </div>
          )}

          {kind === 'pdf' && !pdfFallback && (
            <div ref={pagesRef} className="attachment-viewer-pages" />
          )}

          {kind === 'pdf' && pdfFallback && (
            <iframe
              title={attachment.filename || 'PDF preview'}
              src={previewUrl}
              className="attachment-viewer-frame"
              onLoad={() => setStatus('ready')}
            />
          )}

          {kind === 'image' && (
            <div className="attachment-viewer-imagewrap">
              <img
                src={previewUrl}
                alt={attachment.filename || 'attachment'}
                className="attachment-viewer-img"
                style={zoom === 1
                  ? undefined
                  : { width: `${Math.round(zoom * 100)}%`, maxWidth: 'none' }}
                onLoad={() => setStatus('ready')}
                onError={() => {
                  setError('Could not load this image.');
                  setStatus('error');
                }}
              />
            </div>
          )}

          {kind === 'text' && status === 'ready' && (
            <pre className="attachment-viewer-text">{textContent}</pre>
          )}

          {kind === 'excel' && status === 'ready' && excelSheets.length > 0 && (
            <div className="attachment-viewer-sheet">
              {excelSheets.length > 1 && (
                <div className="attachment-viewer-sheetbar">
                  {excelSheets.map((sheet, idx) => (
                    <button
                      key={sheet.name}
                      type="button"
                      className={idx === activeSheet ? 'active' : ''}
                      onClick={() => setActiveSheet(idx)}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </div>
              )}
              {(() => {
                const sheet = excelSheets[Math.min(activeSheet, excelSheets.length - 1)];
                if (!sheet || sheet.rows.length === 0) {
                  return <div className="attachment-viewer-sheetempty">This sheet is empty.</div>;
                }
                return (
                  <>
                    <div className="attachment-viewer-tablewrap">
                      <table className="attachment-viewer-table">
                        <tbody>
                          {sheet.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {Array.from({ length: sheet.width }, (_, cIdx) => (
                                <td key={cIdx}>{row[cIdx] || ''}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {sheet.truncated && (
                      <div className="attachment-viewer-sheetnote">
                        Showing first {MAX_SHEET_ROWS} of {sheet.totalRows} rows — download for the full sheet.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {kind === 'docx' && status === 'ready' && (
            <div
              className="attachment-viewer-doc"
              dangerouslySetInnerHTML={{ __html: docxHtml }}
            />
          )}

          {kind === 'audio' && (
            <div className="attachment-viewer-fallback">
              <audio
                controls
                src={previewUrl}
                style={{ width: '100%', maxWidth: 480 }}
                onCanPlay={() => setStatus('ready')}
                onError={() => { setError('Could not play this audio file.'); setStatus('error'); }}
              />
            </div>
          )}

          {kind === 'video' && (
            <video
              controls
              src={previewUrl}
              className="attachment-viewer-video"
              onCanPlay={() => setStatus('ready')}
              onError={() => { setError('Could not play this video file.'); setStatus('error'); }}
            />
          )}
        </div>

        {kind === 'pdf' && !pdfFallback && pdfPages > 0 && (
          <div className="attachment-viewer-foot">
            {pdfTruncated
              ? `Showing first ${MAX_PDF_PAGES} of ${pdfPages} pages — download for the full document.`
              : `${pdfPages} page${pdfPages === 1 ? '' : 's'}`}
          </div>
        )}
      </div>
    </div>
  );
}
