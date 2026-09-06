'use strict';

// Generates the .app icon (build/icon.icns) for electron-builder.
//
// A script instead of a binary in the repo, same reason as cambio-ai's tray
// icon: the drawing stays editable — change the numbers below, run
// `npm run make-app-icon`, and the icon is rebuilt. Nothing is committed.
//
// The mark is the app's own glyph: the ◐ that sits in the menu bar, drawn as a
// gauge ring filled to the same percentage the tray shows.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const SUPERSAMPLE = 3;
const OUT_DIR = path.join(__dirname, '..', 'build');

// macOS icon geometry: the artwork sits inside a rounded square inset from the
// canvas, not edge to edge.
const TILE = { inset: 100, radius: 185, color: [26, 26, 25] };
const RING = {
  center: SIZE / 2,
  radius: 250,
  width: 76,
  track: [44, 47, 40],
  fill: [86, 194, 162], // --accent do tema escuro
  progress: 0.42, // o mesmo 42% que o README usa nos exemplos
};

function tileCovers(x, y) {
  const min = TILE.inset;
  const max = SIZE - TILE.inset;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + TILE.radius), max - TILE.radius);
  const cy = Math.min(Math.max(y, min + TILE.radius), max - TILE.radius);
  return Math.hypot(x - cx, y - cy) <= TILE.radius;
}

function ringAt(x, y) {
  const dist = Math.hypot(x - RING.center, y - RING.center);
  if (Math.abs(dist - RING.radius) > RING.width / 2) return null;
  // Angle from 12 o'clock, clockwise — a gauge reads the way a clock does.
  const angle = (Math.atan2(x - RING.center, RING.center - y) + 2 * Math.PI) % (2 * Math.PI);
  return angle / (2 * Math.PI) <= RING.progress ? RING.fill : RING.track;
}

/** Averages SUPERSAMPLE² samples per pixel — that's where the antialiasing comes from. */
function shade(x, y) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const px = x + (sx + 0.5) / SUPERSAMPLE;
      const py = y + (sy + 0.5) / SUPERSAMPLE;
      if (!tileCovers(px, py)) continue;
      const color = ringAt(px, py) || TILE.color;
      r += color[0];
      g += color[1];
      b += color[2];
      a += 255;
    }
  }
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  if (a === 0) return [0, 0, 0, 0];
  // Colors are averaged over the covered samples only, so an edge pixel keeps
  // its own color and fades through alpha instead of through black.
  const covered = a / 255;
  return [Math.round(r / covered), Math.round(g / covered), Math.round(b / covered), Math.round(a / samples)];
}

function render() {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let offset = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[offset++] = 0; // filtro "none"
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = shade(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }
  return png(raw);
}

function png(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const source = path.join(OUT_DIR, 'icon.png');
fs.writeFileSync(source, render());
console.log(`escrito build/icon.png (${SIZE}x${SIZE})`);

// sips + iconutil são do próprio macOS: escalar e empacotar o .icns não precisa
// de dependência nenhuma.
const iconset = path.join(OUT_DIR, 'icon.iconset');
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset);
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  for (const [name, px] of [[`icon_${size}x${size}.png`, size], [`icon_${size / 2}x${size / 2}@2x.png`, size]]) {
    if (name.startsWith('icon_8x8')) continue; // 16@2x já é o 16; abaixo disso não existe
    execFileSync('sips', ['-z', String(px), String(px), source, '--out', path.join(iconset, name)], { stdio: 'ignore' });
  }
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT_DIR, 'icon.icns')]);
fs.rmSync(iconset, { recursive: true, force: true });
console.log('escrito build/icon.icns');
