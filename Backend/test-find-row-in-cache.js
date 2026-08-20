require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'sync_cache.json');

function readCache(file, defaultValue = '') {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read cache:', e.message);
  }
  return defaultValue;
}

function main() {
  const cache = readCache(CACHE_FILE, null);
  const tender = cache?.tenders?.find(t => t.rowNumber === 2948);
  console.log('Tender at row 2948 in cache:', tender);
}

main();
