'use strict';

// Gera o ícone da barra de menu (template image: preto + alfa, o macOS recolore
// sozinho em tema claro/escuro). O desenho em si mora em mark.js, compartilhado
// com o ícone do `.app` — rodar `npm run make-icon` refaz os dois tamanhos.

const fs = require('fs');
const path = require('path');
const { encode } = require('./png');
const { GRID, covered } = require('./mark');

const SUPERSAMPLE = 8; // desenha grande e reduz: é daí que vem o antialiasing
const OUT_DIR = path.join(__dirname, '..', 'src', 'popover');

function render(scale) {
  const size = GRID * scale;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  return encode(size, (x, y) => {
    let hits = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const px = (x + (sx + 0.5) / SUPERSAMPLE) / scale;
        const py = (y + (sy + 0.5) / SUPERSAMPLE) / scale;
        if (covered(px, py)) hits++;
      }
    }
    // Template image: a cor é sempre preta, quem desenha é o alfa.
    return [0, 0, 0, Math.round((hits / samples) * 255)];
  });
}

for (const [scale, name] of [[1, 'iconTemplate.png'], [2, 'iconTemplate@2x.png']]) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, render(scale));
  console.log(`escrito ${path.relative(process.cwd(), file)} (${GRID * scale}x${GRID * scale})`);
}
