'use strict';

// A marca do app: uma linha de tendência subindo com um ponto na cotação mais
// recente, desenhada numa grade de 18×18.
//
// Ficou num módulo quando o desenho passou a servir dois ícones — o template
// monocromático da barra de menu e o ícone colorido do `.app`. Mexer nos pontos
// aqui refaz os dois.

const GRID = 18;

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

/** A marca cobre esse ponto da grade? */
function covered(x, y) {
  if (Math.hypot(x - DOT.x, y - DOT.y) <= DOT.r) return true;
  for (let i = 1; i < LINE.length; i++) {
    if (distanceToSegment(x, y, LINE[i - 1], LINE[i]) <= STROKE) return true;
  }
  return false;
}

module.exports = { GRID, covered };
