import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import './EmailComposer.css';

// Text input for To / Cc / Bcc that suggests addresses from existing mails.
// The value stays a plain comma-separated string, so sending/forwarding is unchanged.

const SPLIT_RE = /[,;]/;

function lastToken(value) {
  const parts = String(value || '').split(SPLIT_RE);
  return parts[parts.length - 1].trim();
}

function enteredEmails(value) {
  return String(value || '')
    .split(SPLIT_RE)
    .slice(0, -1)
    .map(s => (s.match(/[^\s<>"]+@[^\s<>"]+/) || [''])[0].toLowerCase())
    .filter(Boolean);
}

function replaceLastToken(value, email) {
  const text = String(value || '');
  const idx = Math.max(text.lastIndexOf(','), text.lastIndexOf(';'));
  const head = idx >= 0 ? text.slice(0, idx + 1) + ' ' : '';
  return `${head}${email}, `;
}

export default function RecipientInput({ value, onChange, placeholder, className, style }) {
  const inputRef = useRef(null);
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  // Results are stored with the search text they belong to; while they don't match
  // the current text, the list shows "Loading".
  const [result, setResult] = useState({ query: '', items: [] });
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);

  const token = lastToken(value);
  const searching = token.length >= 2;
  const loading = searching && result.query !== token;
  const items = searching && result.query === token ? result.items : [];

  useEffect(() => {
    if (token.length < 2) return undefined;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      let contacts;
      try {
        const params = new URLSearchParams({ q: token, limit: '8', exclude: enteredEmails(value).join(',') });
        const res = await fetch(`/api/contacts/suggest?${params}`);
        const data = await res.json().catch(() => ({}));
        contacts = Array.isArray(data.contacts) ? data.contacts : [];
      } catch {
        contacts = [];
      }
      if (id !== requestId.current) return;
      setResult({ query: token, items: contacts });
      setActive(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [token, value]);

  useEffect(() => {
    if (!open) return undefined;
    const update = () => {
      if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, value]);

  const choose = (contact) => {
    onChange(replaceLastToken(value, contact.email));
    setOpen(true);
    requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
  };

  const onKeyDown = (event) => {
    if (!open || items.length === 0) {
      if (event.key === 'Escape') setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(i => (i + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(i => (i - 1 + items.length) % items.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(items[active] || items[0]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && token.length >= 2 && rect;

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={className}
        style={style}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={Boolean(showList)}
      />
      {showList && (
        <ul
          className="recipient-suggest"
          role="listbox"
          style={{ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 260) }}
        >
          {loading && (
            <li className="recipient-suggest-status">
              <Loader2 size={12} className="spinner" /> Loading matching emails...
            </li>
          )}
          {!loading && items.length === 0 && (
            <li className="recipient-suggest-status">No matching emails found</li>
          )}
          {items.map((contact, index) => (
            <li
              key={contact.email}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'is-active' : ''}
              onMouseDown={(event) => { event.preventDefault(); choose(contact); }}
              onMouseEnter={() => setActive(index)}
            >
              <span className="recipient-suggest-name">{contact.name || contact.email}</span>
              {contact.name && <span className="recipient-suggest-email">{contact.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
