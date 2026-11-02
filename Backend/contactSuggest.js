'use strict';

// Pulls "Name <email>" / bare email entries out of free-text header fields
// (sender, to_details, cc_details) and ranks the ones matching a search term.

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function cleanName(raw) {
  return String(raw || '')
    .replace(/["'<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns [{ email, name }] for one header value.
function extractContacts(value) {
  if (!value) return [];
  const text = String(value);
  const out = [];
  // Split on commas/semicolons that are outside quotes.
  const parts = text.split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const emails = part.match(EMAIL_RE);
    if (!emails) continue;
    for (const email of emails) {
      let name = '';
      if (emails.length === 1) {
        name = cleanName(part.replace(email, ''));
        if (name.toLowerCase() === email.toLowerCase()) name = '';
      }
      out.push({ email: email.toLowerCase(), name });
    }
  }
  return out;
}

// rows: [{ sender, to_details, cc_details }] newest first.
function rankContacts(rows, query, { limit = 8, exclude = [] } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const skip = new Set(exclude.map(e => String(e).toLowerCase()));
  const byEmail = new Map();
  rows.forEach((row, index) => {
    const contacts = [
      ...extractContacts(row.sender),
      ...extractContacts(row.to_details),
      ...extractContacts(row.cc_details),
    ];
    for (const c of contacts) {
      if (skip.has(c.email)) continue;
      const hay = `${c.email} ${c.name}`.toLowerCase();
      if (!hay.includes(q)) continue;
      const entry = byEmail.get(c.email);
      if (entry) {
        entry.count += 1;
        if (!entry.name && c.name) entry.name = c.name;
      } else {
        byEmail.set(c.email, { email: c.email, name: c.name, count: 1, firstSeen: index });
      }
    }
  });
  const startsWith = (c) => c.email.startsWith(q) || c.name.toLowerCase().startsWith(q);
  return [...byEmail.values()]
    .sort((a, b) =>
      (startsWith(b) - startsWith(a)) ||
      (b.count - a.count) ||
      (a.firstSeen - b.firstSeen))
    .slice(0, limit)
    .map(({ email, name, count }) => ({ email, name, count }));
}

module.exports = { extractContacts, rankContacts };
