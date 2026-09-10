'use strict';

// Gera o ícone do `.app` (build/icon.icns) pro electron-builder.
//
// O desenho é o próprio produto: um pedaço do heatmap, com a rampa azul do
// plano e — o detalhe que define o app — uma célula vazia com anel, porque aqui
// o assunto é a ausência, não só o que foi feito.
//
// Script em vez de binário no repo, mesmo padrão dos outros apps: mexer nos
// números abaixo e rodar `npm run make-app-icon` refaz o ícone. `build/` fica
// fora do git.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { encode } = require('./png');

const SIZE = 1024;
const SUPERSAMPLE = 3;
const OUT_DIR = path.join(__dirname, '..', 'build');

// Geometria do ícone no macOS: arte dentro de um quadrado arredondado recuado.
const TILE = { inset: 100, radius: 185, color: [26, 26, 25] };

// Rampa do tema escuro, a mesma da tabela no plan.md — mais commits, mais claro.
const LEVELS = {
  1: [24, 79, 149],
  2: [37, 106, 191],
  3: [57, 135, 229],
  4: [109, 167, 236],
};
const EMPTY_RING = [44, 44, 42];

// 3×3 lê bem até em 16px; 0 é dia vazio, e ele aparece com anel.
const CELLS = [
  [3, 1, 4],
  [0, 2, 3],
  [2, 4, 1],
];

const GRID = 560; // lado da grade dentro do tile
const GAP = 36;
const CELL = (GRID - GAP * (CELLS.length - 1)) / CELLS.length;
const CELL_RADIUS = 30;
const RING = 12; // espessura do anel do dia vazio
const ORIGIN = (SIZE - GRID) / 2;

function roundedCovers(x, y, left, top, size, radius) {
  const right = left + size;
  const bottom = top + size;
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function cellColor(x, y) {
  for (let row = 0; row < CELLS.length; row++) {
    for (let col = 0; col < CELLS[row].length; col++) {
      const left = ORIGIN + col * (CELL + GAP);
      const top = ORIGIN + row * (CELL + GAP);
      if (!roundedCovers(x, y, left, top, CELL, CELL_RADIUS)) continue;
      const level = CELLS[row][col];
      if (level > 0) return LEVELS[level];
      // Dia vazio: só o anel, o miolo é a superfície do tile.
      const inner = roundedCovers(x, y, left + RING, top + RING, CELL - RING * 2, CELL_RADIUS - RING);
      return inner ? null : EMPTY_RING;
    }
  }
  return null;
}

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
      const color = cellColor(px, py) || TILE.color;
      r += color[0];
      g += color[1];
      b += color[2];
      hits++;
    }
  }
  if (!hits) return [0, 0, 0, 0];
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
