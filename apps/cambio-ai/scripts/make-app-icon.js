'use strict';

// Gera o ícone do `.app` (build/icon.icns) pro electron-builder.
//
// É a mesma marca do ícone da barra (mark.js), só que colorida e sobre o
// quadrado arredondado que o macOS espera num ícone de aplicativo. Script em vez
// de binário no repo, igual ao make-icon.js: o desenho continua editável, e
// `build/` fica fora do git.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { encode } = require('./png');
const { GRID, covered } = require('./mark');

const SIZE = 1024;
const SUPERSAMPLE = 3;
const OUT_DIR = path.join(__dirname, '..', 'build');

// Geometria do ícone no macOS: a arte fica dentro de um quadrado arredondado
// recuado da borda do canvas, não coladinha nela.
const TILE = { inset: 100, radius: 185, color: [23, 27, 22] }; // --surface do tema escuro
const MARK = { color: [86, 194, 162], fill: 0.62 }; // --buy do tema escuro

const tileSize = SIZE - TILE.inset * 2;
const scale = (tileSize * MARK.fill) / GRID;
const origin = (SIZE - GRID * scale) / 2;

function tileCovers(x, y) {
  const min = TILE.inset;
  const max = SIZE - TILE.inset;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + TILE.radius), max - TILE.radius);
  const cy = Math.min(Math.max(y, min + TILE.radius), max - TILE.radius);
  return Math.hypot(x - cx, y - cy) <= TILE.radius;
}

/** Média de SUPERSAMPLE² amostras por pixel — é daí que vem o antialiasing. */
function shade(x, y) {
  let r = 0;
  let g = 0;
  let b = 0;
  let hits = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const px = x + (sx + 0.5) / SUPERSAMPLE;
      const py = y + (sy + 0.5) / SUPERSAMPLE;
      if (!tileCovers(px, py)) continue;
      const onMark = covered((px - origin) / scale, (py - origin) / scale);
      const color = onMark ? MARK.color : TILE.color;
      r += color[0];
      g += color[1];
      b += color[2];
      hits++;
    }
  }
  if (!hits) return [0, 0, 0, 0];
  // A cor é a média só das amostras cobertas, pra borda do quadrado desbotar
  // pelo alfa em vez de escurecer em direção ao preto.
  return [
    Math.round(r / hits),
    Math.round(g / hits),
    Math.round(b / hits),
    Math.round((hits / (SUPERSAMPLE * SUPERSAMPLE)) * 255),
  ];
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const source = path.join(OUT_DIR, 'icon.png');
fs.writeFileSync(source, encode(SIZE, shade));
console.log(`escrito build/icon.png (${SIZE}x${SIZE})`);

// sips e iconutil são do próprio macOS: escalar e empacotar o .icns não precisa
// de dependência nenhuma.
const iconset = path.join(OUT_DIR, 'icon.iconset');
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset);
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  const names = [`icon_${size}x${size}.png`];
  if (size >= 32) names.push(`icon_${size / 2}x${size / 2}@2x.png`);
  for (const name of names) {
    execFileSync('sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, name)], { stdio: 'ignore' });
  }
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT_DIR, 'icon.icns')]);
fs.rmSync(iconset, { recursive: true, force: true });
console.log('escrito build/icon.icns');
