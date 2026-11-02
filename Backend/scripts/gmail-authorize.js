#!/usr/bin/env node
/**
 * One-time Google OAuth helper for the shared mailbox.
 *
 * Run this on a machine with a browser:
 *   node Backend/scripts/gmail-authorize.js
 *
 * It writes the new token to the project-root token.json (backing up the old one).
 * Required scopes:
 *   - gmail.modify   (read, labels, read/unread, archive, trash, drafts)
 *   - gmail.send     (send mail)
 *   - drive.file     (download attachments created by this app)
 *   - spreadsheets.readonly / documents.readonly / presentations.readonly
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
];

const SCOPE_ALIASES = {
  'gmail.modify': 'https://www.googleapis.com/auth/gmail.modify',
  'gmail.send': 'https://www.googleapis.com/auth/gmail.send',
  'drive.file': 'https://www.googleapis.com/auth/drive.file',
  'drive.readonly': 'https://www.googleapis.com/auth/drive.readonly',
  'spreadsheets.readonly': 'https://www.googleapis.com/auth/spreadsheets.readonly',
  'documents.readonly': 'https://www.googleapis.com/auth/documents.readonly',
  'presentations.readonly': 'https://www.googleapis.com/auth/presentations.readonly',
};

const SCOPES = (process.env.GMAIL_OAUTH_SCOPES
  ? process.env.GMAIL_OAUTH_SCOPES.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_SCOPES
).map(scope => SCOPE_ALIASES[scope] || scope);

const ROOT = path.resolve(__dirname, '..', '..');
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || path.join(ROOT, 'credentials.json');
const TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH || path.join(ROOT, 'token.json');
const PORT = Number(process.env.GMAIL_OAUTH_PORT) || 53682;
const REDIRECT_URI = process.env.GMAIL_OAUTH_REDIRECT || `http://localhost:${PORT}/oauth2callback`;

function findCredentials() {
  const candidates = [
    CREDENTIALS_PATH,
    path.join(ROOT, 'credentials.json'),
    path.join(ROOT, 'Emails_agent', 'credentials.json'),
    path.join(process.cwd(), 'credentials.json'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function loadClientConfig() {
  const credentialsPath = findCredentials();
  if (!credentialsPath) {
    throw new Error(`credentials.json not found. Looked at: ${CREDENTIALS_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const config = raw.installed || raw.web;
  if (!config || !config.client_id || !config.client_secret) {
    throw new Error(`Invalid ${credentialsPath}: missing installed/web client_id/client_secret.`);
  }
  return config;
}

function backupExistingToken() {
  if (!fs.existsSync(TOKEN_PATH)) return;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${TOKEN_PATH}.bak-${stamp}`;
    fs.copyFileSync(TOKEN_PATH, backup);
    console.log(`Backed up existing token to ${backup}`);
  } catch (err) {
    console.warn(`Could not back up existing token: ${err.message}`);
  }
}

async function main() {
  const config = loadClientConfig();
  const oAuth2Client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    REDIRECT_URI
  );

  const state = crypto.randomBytes(24).toString('hex');
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  });

  console.log('\n=== Gmail OAuth authorization ===');
  console.log(`Redirect URI: ${REDIRECT_URI}`);
  console.log('\nOpen this URL in a browser and sign in with the shared mailbox:\n');
  console.log(authUrl);
  console.log('\nIf Google says redirect_uri_mismatch, add this exact URI to the OAuth client:');
  console.log(`  ${REDIRECT_URI}`);
  console.log('Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client -> Authorized redirect URIs\n');

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
      if (requestUrl.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const returnedState = requestUrl.searchParams.get('state');
      const code = requestUrl.searchParams.get('code');
      const error = requestUrl.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h2>Authorization failed</h2><p>${error}</p>`);
        server.close();
        process.exitCode = 1;
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h2>Invalid OAuth callback</h2>');
        return;
      }

      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      let existing = {};
      try {
        if (fs.existsSync(TOKEN_PATH)) {
          existing = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        }
      } catch (err) {
        existing = {};
      }

      let account = '';
      try {
        const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        account = profile.data.emailAddress || '';
      } catch (err) {
        console.warn(`Could not read Gmail profile (account field will be empty): ${err.message}`);
      }

      const grantedScopes = tokens.scope
        ? String(tokens.scope).split(/\s+/).filter(Boolean)
        : SCOPES;
      const refreshToken = tokens.refresh_token || existing.refresh_token;
      const expiryDate = tokens.expiry_date ||
        (tokens.expiry_date === 0 ? 0 : Date.now() + (Number(tokens.expires_in) || 3600) * 1000);

      // Write a token shape that works with BOTH googleapis (Node) and
      // google-auth (Python agent): `scopes` must be an array of granted scopes.
      const tokenJson = {
        token: tokens.access_token || tokens.token,
        refresh_token: refreshToken,
        token_uri: config.token_uri || 'https://oauth2.googleapis.com/token',
        client_id: config.client_id,
        client_secret: config.client_secret,
        scopes: grantedScopes,
        universe_domain: 'googleapis.com',
        account,
        expiry: new Date(expiryDate).toISOString(),
        access_token: tokens.access_token || tokens.token,
        scope: grantedScopes.join(' '),
        token_type: tokens.token_type || 'Bearer',
        expiry_date: expiryDate,
      };

      if (!tokenJson.refresh_token) {
        throw new Error('Google did not return a refresh_token. Remove this app from your Google account permissions and try again.');
      }

      backupExistingToken();
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenJson, null, 2), 'utf8');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2>Success</h2><p>token.json has been updated. You can close this window.</p>');
      console.log(`\nSuccess. New token written to ${TOKEN_PATH}`);
      console.log('Restart the backend and emails-agent containers now.');
      server.close();
    } catch (err) {
      console.error('OAuth callback failed:', err);
      try {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>OAuth failed</h2><pre>${String(err.message || err)}</pre>`);
      } catch (e) {}
      server.close();
      process.exitCode = 1;
    }
  });

  server.listen(PORT, () => {
    console.log(`Waiting for the OAuth callback on port ${PORT}...`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
