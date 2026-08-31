
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function findAuthFile(filename) {
  const candidates = [
    path.join(__dirname, 'root_config', filename),
    path.join('/app', 'root_config', filename),
    path.join(__dirname, '..', filename),
    path.join(process.cwd(), filename),
    path.join(process.cwd(), '..', filename),
    path.join(__dirname, '..', 'Emails_agent', filename),
    path.join(process.cwd(), 'Emails_agent', filename),
    path.join(__dirname, 'Emails_agent', filename),
    path.join(__dirname, filename)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

async function main() {
  const credentialsPath = findAuthFile('credentials.json');
  const tokenPath = findAuthFile('token.json');
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris ? redirect_uris[0] : 'http://localhost');
  oAuth2Client.setCredentials(token);
  const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || '1GTwzxMgViohbCimXqfiBZBJsKbCSr7hCgbcHF_En1VE';
  const gid = process.env.GOOGLE_SHEET_GID || '1274623128';

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties.sheetId === Number(gid));
  const title = sheet ? sheet.properties.title : 'Sheet1';
  console.log('Sheet Title:', title);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A1:AG5` });
  const rows = res.data.values || [];
  console.log('Header Row (Row 0):', JSON.stringify(rows[0]));
  console.log('Sample Data Row 1:', JSON.stringify(rows[1]));
}

main().catch(err => console.error(err));
