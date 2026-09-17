'use strict';

// Gera o ícone da barra de menu (template image: preto + alfa, o macOS recolore
// sozinho em tema claro/escuro). É um script em vez de um PNG solto no repo pra
// que o desenho seja editável — mexer nos pontos abaixo e rodar `npm run
// make-icon` refaz os dois tamanhos.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 18;
const SUPERSAMPLE = 8; // desenha grande e reduz: é daí que vem o antialiasing
const OUT_DIR = path.join(__dirname, '..', 'src', 'popover');

// Uma linha de tendência subindo, com um ponto na cotação mais recente.
const LINE = [
  [2.5, 13.2],
  [7, 8.6],
  [10.5, 11],
  [15.4, 4.6],
];
const STROKE = 1.05; // metade da espessura
const DOT = { x: 15.4, y: 4.6, r: 1.7 };

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function covered(x, y) {
  if (Math.hypot(x - DOT.x, y - DOT.y) <= DOT.r) return true;
  for (let i = 1; i < LINE.length; i++) {
    if (distanceToSegment(x, y, LINE[i - 1], LINE[i]) <= STROKE) return true;
  }
  return false;
}

function crcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}

const CRC = crcTable();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, alpha) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      offset += 3; // RGB preto
      raw[offset++] = alpha[y * size + x];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(scale) {
  const size = SIZE * scale;
  const alpha = new Uint8Array(size * size);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = (x + (sx + 0.5) / SUPERSAMPLE) / scale;
          const py = (y + (sy + 0.5) / SUPERSAMPLE) / scale;
          if (covered(px, py)) hits++;
        }
      }
      alpha[y * size + x] = Math.round((hits / samples) * 255);
    }
  }
  return png(size, alpha);
}

for (const [scale, name] of [[1, 'iconTemplate.png'], [2, 'iconTemplate@2x.png']]) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, render(scale));
  console.log(`escrito ${path.relative(process.cwd(), file)} (${SIZE * scale}x${SIZE * scale})`);
}
