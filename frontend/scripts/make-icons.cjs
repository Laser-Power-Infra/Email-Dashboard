// Generates the "Email One" PWA icons (PNG) into frontend/public/icons.
// Pure Node (zlib only) so no image libraries are needed.
// Run: node scripts/make-icons.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const BG_TOP = [79, 70, 229];     // indigo-600
const BG_BOTTOM = [37, 99, 235];  // blue-600
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Distance from point to segment, for drawing the envelope flap lines.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

/**
 * opts.rounded: rounded-square tile with transparent corners (regular icon)
 * opts.scale:   envelope size relative to the tile (smaller for maskable safe zone)
 */
function drawIcon(size, { rounded, scale }) {
  const S = 4; // supersampling for smooth edges
  const radius = rounded ? size * 0.22 : 0;
  const ew = size * 0.62 * scale;
  const eh = size * 0.44 * scale;
  const ex = (size - ew) / 2;
  const ey = (size - eh) / 2 + size * 0.01;
  const stroke = Math.max(2, size * 0.045 * scale);
  const er = stroke * 0.9;

  function inTile(x, y) {
    if (!rounded) return true;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return Math.hypot(x - cx, y - cy) <= radius;
  }

  function inEnvelopeStroke(x, y) {
    // rounded-rect outline
    const cx = Math.min(Math.max(x, ex + er), ex + ew - er);
    const cy = Math.min(Math.max(y, ey + er), ey + eh - er);
    const d = Math.hypot(x - cx, y - cy);
    const inside = x >= ex && x <= ex + ew && y >= ey && y <= ey + eh && d <= er + 0.001;
    const insideInner = x >= ex + stroke && x <= ex + ew - stroke && y >= ey + stroke && y <= ey + eh - stroke;
    if (inside && !insideInner) return true;
    // flap "V"
    const mx = ex + ew / 2, my = ey + eh * 0.58;
    if (segDist(x, y, ex + stroke, ey + stroke, mx, my) <= stroke / 2) return true;
    if (segDist(x, y, ex + ew - stroke, ey + stroke, mx, my) <= stroke / 2) return true;
    return false;
  }

  return png(size, (x, y) => {
    let tile = 0, white = 0;
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
        if (inTile(px, py)) {
          tile++;
          if (inEnvelopeStroke(px, py)) white++;
        }
      }
    }
    if (!tile) return [0, 0, 0, 0];
    const bg = mix(BG_TOP, BG_BOTTOM, y / size);
    const c = mix(bg, WHITE, white / tile);
    return [...c, Math.round((tile / (S * S)) * 255)];
  });
}

const files = [
  ['icon-192.png', 192, { rounded: true, scale: 1 }],
  ['icon-512.png', 512, { rounded: true, scale: 1 }],
  ['maskable-512.png', 512, { rounded: false, scale: 0.78 }],
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.9 }],
];
for (const [name, size, opts] of files) {
  fs.writeFileSync(path.join(OUT, name), drawIcon(size, opts));
  console.log('wrote', name);
}
