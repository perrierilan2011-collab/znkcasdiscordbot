'use strict';
/*
 * games/draw.js — ZNK Casino
 * Primitives de dessin (canvas 2D) partagées par toutes les animations de jeux.
 * Aucun emoji : tout est dessiné en vectoriel (le canvas du serveur n'a pas les emojis).
 */
const TAU = Math.PI * 2;

let FONT = 'sans-serif';
const setFont = (f) => {
  FONT = f || 'sans-serif';
};
const font = (px, weight = 'bold') => `${weight} ${px}px ${FONT}`;

// Palette « néon violet ZNK » (celle des images du bot)
const C = {
  ink: '#12042A',
  panel: 'rgba(12,3,30,0.93)',
  line: 'rgba(192,132,252,0.55)',
  lav: '#E9D5FF',
  soft: 'rgba(233,213,255,0.72)',
  violet: '#A855F7',
  deep: '#4C1D95',
  pink: '#E879F9',
  gold: '#FDE68A',
  green: '#86EFAC',
  red: '#FCA5A5',
  hot: '#F43F5E',
  cyan: '#67E8F9',
};

function rr(g, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

function text(g, s, x, y, o = {}) {
  g.save();
  g.font = font(o.size || 14, o.weight || 'bold');
  g.textAlign = o.align || 'center';
  g.textBaseline = o.base || 'middle';
  if (o.alpha != null) g.globalAlpha = o.alpha;
  if (o.glow) {
    g.shadowColor = o.glow;
    g.shadowBlur = o.blur ?? 10;
  }
  if (o.stroke) {
    g.lineWidth = o.sw || 3;
    g.lineJoin = 'round';
    g.strokeStyle = o.stroke;
    g.strokeText(String(s), x, y);
  }
  g.fillStyle = o.color || '#FFFFFF';
  g.fillText(String(s), x, y);
  g.restore();
}

// 4 branches, comme les étoiles du gabarit
function spark(g, cx, cy, r, color = '#FFFFFF', alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = r * 1.2;
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.quadraticCurveTo(cx + r * 0.12, cy - r * 0.12, cx + r, cy);
  g.quadraticCurveTo(cx + r * 0.12, cy + r * 0.12, cx, cy + r);
  g.quadraticCurveTo(cx - r * 0.12, cy + r * 0.12, cx - r, cy);
  g.quadraticCurveTo(cx - r * 0.12, cy - r * 0.12, cx, cy - r);
  g.closePath();
  g.fill();
  g.restore();
}

function sparkles(g, rnd, w, h, n = 14, color = '#F5D0FE') {
  for (let k = 0; k < n; k++) spark(g, rnd() * w, rnd() * h, 2 + rnd() * 4.5, k % 3 === 0 ? '#FDE68A' : color, 0.35 + rnd() * 0.65);
}

// Petit libellé « pastille » (libellé minuscule + valeur)
function chip(g, x, y, w, h, label, value, o = {}) {
  g.save();
  rr(g, x, y, w, h, 9);
  g.fillStyle = o.bg || 'rgba(168,85,247,0.16)';
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = o.line || 'rgba(192,132,252,0.55)';
  g.stroke();
  g.restore();
  text(g, String(label).toUpperCase(), x + 10, y + 11, { size: 9.5, align: 'left', color: 'rgba(233,213,255,0.78)' });
  text(g, value, x + 10, y + h - 12, { size: 14, align: 'left', color: o.color || '#FFFFFF' });
}

function suitKey(s) {
  return { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C', S: 'S', H: 'H', D: 'D', C: 'C' }[s] || 'S';
}
const isRed = (s) => ['H', 'D'].includes(suitKey(s));

function heartPath(g) {
  g.moveTo(0, 0.42);
  g.bezierCurveTo(-0.66, -0.02, -0.36, -0.52, 0, -0.18);
  g.bezierCurveTo(0.36, -0.52, 0.66, -0.02, 0, 0.42);
}
function drawSuit(g, suit, cx, cy, s, color) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = color || (isRed(suit) ? '#E11D48' : '#1E1B4B');
  g.beginPath();
  const k = suitKey(suit);
  if (k === 'H') heartPath(g);
  else if (k === 'D') {
    g.moveTo(0, -0.5);
    g.lineTo(0.36, 0);
    g.lineTo(0, 0.5);
    g.lineTo(-0.36, 0);
    g.closePath();
  } else if (k === 'S') {
    g.save();
    g.translate(0, -0.06);
    g.scale(1, -1);
    heartPath(g);
    g.restore();
    g.moveTo(0, 0.1);
    g.lineTo(0.17, 0.5);
    g.lineTo(-0.17, 0.5);
    g.closePath();
  } else {
    g.arc(0, -0.2, 0.23, 0, TAU);
    g.moveTo(-0.1, 0.1);
    g.arc(-0.23, 0.08, 0.23, 0, TAU);
    g.moveTo(0.46, 0.08);
    g.arc(0.23, 0.08, 0.23, 0, TAU);
    g.moveTo(0, 0.08);
    g.lineTo(0.16, 0.5);
    g.lineTo(-0.16, 0.5);
    g.closePath();
  }
  g.fill();
  g.restore();
}

// Carte : flip 0 = dos, 1 = face (la carte se retourne via un effet de largeur)
function drawCard(g, x, y, w, h, card, o = {}) {
  const flip = o.flip == null ? (o.faceDown ? 0 : 1) : o.flip;
  const sx = Math.max(0.04, Math.abs(Math.cos(flip * Math.PI)));
  const up = flip >= 0.5;
  g.save();
  g.translate(x + w / 2, y + h / 2);
  if (o.rot) g.rotate(o.rot);
  g.scale(sx, 1);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  if (o.glow) {
    g.shadowColor = o.glow;
    g.shadowBlur = 18;
  } else {
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
  }
  rr(g, -w / 2, -h / 2, w, h, w * 0.12);
  if (up) {
    const gr = g.createLinearGradient(0, -h / 2, 0, h / 2);
    gr.addColorStop(0, '#FFFFFF');
    gr.addColorStop(1, '#DDD0FA');
    g.fillStyle = gr;
  } else {
    const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    gr.addColorStop(0, '#7C3AED');
    gr.addColorStop(1, '#3B0F66');
    g.fillStyle = gr;
  }
  g.fill();
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.lineWidth = 1.6;
  g.strokeStyle = up ? '#8B5CF6' : '#E9D5FF';
  g.stroke();
  if (up && card) {
    const col = isRed(card.s) ? '#E11D48' : '#1E1B4B';
    text(g, card.r, -w / 2 + w * 0.2, -h / 2 + h * 0.17, { size: h * 0.22, color: col });
    drawSuit(g, card.s, -w / 2 + w * 0.2, -h / 2 + h * 0.36, h * 0.17, col);
    drawSuit(g, card.s, w * 0.04, h * 0.1, h * 0.5, col);
  } else if (!up) {
    g.save();
    rr(g, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, w * 0.08);
    g.clip();
    g.strokeStyle = 'rgba(233,213,255,0.35)';
    g.lineWidth = 1;
    for (let d = -h; d < w + h; d += 9) {
      g.beginPath();
      g.moveTo(-w / 2 + d, -h / 2);
      g.lineTo(-w / 2 + d - h, h / 2);
      g.stroke();
      g.beginPath();
      g.moveTo(-w / 2 + d - h, -h / 2);
      g.lineTo(-w / 2 + d, h / 2);
      g.stroke();
    }
    g.restore();
    spark(g, 0, 0, Math.min(w, h) * 0.2, '#F5D0FE');
  }
  g.restore();
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function drawDie(g, cx, cy, s, v, rot = 0, o = {}) {
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  const h = s / 2;
  g.shadowColor = o.glow || 'rgba(168,85,247,0.9)';
  g.shadowBlur = o.glow ? 22 : 14;
  const gr = g.createLinearGradient(0, -h, 0, h);
  gr.addColorStop(0, '#FFFFFF');
  gr.addColorStop(1, '#C4B5FD');
  g.fillStyle = gr;
  rr(g, -h, -h, s, s, s * 0.2);
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 2;
  g.strokeStyle = '#7C3AED';
  g.stroke();
  const sp = s * 0.26;
  g.fillStyle = '#4C1D95';
  for (const idx of PIPS[Math.max(1, Math.min(6, v))]) {
    g.beginPath();
    g.arc(((idx % 3) - 1) * sp, (Math.floor(idx / 3) - 1) * sp, s * 0.075, 0, TAU);
    g.fill();
  }
  g.restore();
}

// Pièce : sy = écrasement vertical (rotation en l'air), face = texte gravé
function drawCoin(g, cx, cy, r, o = {}) {
  const sy = o.sy == null ? 1 : Math.max(0.06, o.sy);
  g.save();
  g.translate(cx, cy);
  g.scale(1, sy);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  g.shadowColor = o.glow || 'rgba(232,121,249,0.85)';
  g.shadowBlur = 16;
  const gr = g.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, '#F5D0FE');
  gr.addColorStop(0.5, '#C084FC');
  gr.addColorStop(1, '#7E22CE');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 3;
  g.strokeStyle = '#F3E8FF';
  g.stroke();
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(76,29,149,0.7)';
  g.beginPath();
  g.arc(0, 0, r * 0.76, 0, TAU);
  g.stroke();
  if (o.label) text(g, o.label, 0, 1, { size: r * 0.5, color: '#3B0764' });
  else spark(g, 0, 0, r * 0.4, '#FFFFFF');
  g.restore();
}

function drawGem(g, cx, cy, s, o = {}) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  g.shadowColor = o.glow || 'rgba(103,232,249,0.9)';
  g.shadowBlur = 0.5 * 24 / Math.max(s, 1) * s * 0.3 + 6;
  const pts = [
    [-0.5, -0.12],
    [-0.28, -0.42],
    [0.28, -0.42],
    [0.5, -0.12],
    [0, 0.5],
  ];
  g.beginPath();
  pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  const gr = g.createLinearGradient(-0.5, -0.4, 0.5, 0.5);
  gr.addColorStop(0, o.c0 || '#E0F2FE');
  gr.addColorStop(0.5, o.c1 || '#67E8F9');
  gr.addColorStop(1, o.c2 || '#A78BFA');
  g.fillStyle = gr;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 0.05;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.stroke();
  g.beginPath();
  g.moveTo(-0.5, -0.12);
  g.lineTo(0.5, -0.12);
  g.moveTo(-0.28, -0.42);
  g.lineTo(-0.12, -0.12);
  g.lineTo(0, 0.5);
  g.moveTo(0.28, -0.42);
  g.lineTo(0.12, -0.12);
  g.lineTo(0, 0.5);
  g.lineWidth = 0.03;
  g.strokeStyle = 'rgba(255,255,255,0.65)';
  g.stroke();
  g.restore();
}

function drawBomb(g, cx, cy, s, o = {}) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  g.shadowColor = o.glow || 'rgba(244,63,94,0.8)';
  g.shadowBlur = 8;
  const gr = g.createRadialGradient(-0.12, -0.05, 0.05, 0, 0.05, 0.5);
  gr.addColorStop(0, '#6B5B8C');
  gr.addColorStop(1, '#0F0820');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0.08, 0.38, 0, TAU);
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 0.07;
  g.strokeStyle = '#A78BFA';
  g.beginPath();
  g.moveTo(0.18, -0.24);
  g.quadraticCurveTo(0.3, -0.45, 0.46, -0.4);
  g.stroke();
  g.restore();
  spark(g, cx + s * 0.46, cy - s * 0.4, s * 0.17, '#FDBA74');
}

// Symboles de la machine à sous : CER CIT RAI CLO DIA 7
function drawSymbol(g, key, cx, cy, s, o = {}) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  const k = String(key).trim();
  if (k === 'CER') {
    g.lineWidth = 0.06;
    g.strokeStyle = '#86EFAC';
    g.beginPath();
    g.moveTo(-0.22, 0.2);
    g.quadraticCurveTo(-0.15, -0.3, 0.12, -0.46);
    g.moveTo(0.24, 0.24);
    g.quadraticCurveTo(0.2, -0.2, 0.12, -0.46);
    g.stroke();
    g.fillStyle = '#4ADE80';
    g.beginPath();
    g.ellipse(0.2, -0.42, 0.14, 0.07, -0.4, 0, TAU);
    g.fill();
    for (const [x, y] of [
      [-0.22, 0.26],
      [0.24, 0.3],
    ]) {
      const gr = g.createRadialGradient(x - 0.06, y - 0.06, 0.02, x, y, 0.22);
      gr.addColorStop(0, '#FDA4AF');
      gr.addColorStop(1, '#BE123C');
      g.fillStyle = gr;
      g.shadowColor = 'rgba(244,63,94,0.8)';
      g.shadowBlur = 6;
      g.beginPath();
      g.arc(x, y, 0.2, 0, TAU);
      g.fill();
    }
  } else if (k === 'CIT') {
    const gr = g.createLinearGradient(-0.4, -0.3, 0.4, 0.3);
    gr.addColorStop(0, '#FEF08A');
    gr.addColorStop(1, '#EAB308');
    g.fillStyle = gr;
    g.shadowColor = 'rgba(250,204,21,0.8)';
    g.shadowBlur = 8;
    g.beginPath();
    g.moveTo(-0.5, 0);
    g.quadraticCurveTo(-0.3, -0.42, 0.04, -0.34);
    g.quadraticCurveTo(0.34, -0.3, 0.5, -0.02);
    g.quadraticCurveTo(0.3, 0.42, -0.04, 0.34);
    g.quadraticCurveTo(-0.34, 0.3, -0.5, 0);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 0.04;
    g.beginPath();
    g.arc(-0.06, -0.06, 0.18, 3.6, 5.4);
    g.stroke();
  } else if (k === 'RAI') {
    g.shadowColor = 'rgba(168,85,247,0.9)';
    g.shadowBlur = 8;
    const pts = [
      [-0.24, -0.14],
      [0, -0.14],
      [0.24, -0.14],
      [-0.12, 0.1],
      [0.12, 0.1],
      [0, 0.34],
    ];
    for (const [x, y] of pts) {
      const gr = g.createRadialGradient(x - 0.05, y - 0.05, 0.02, x, y, 0.17);
      gr.addColorStop(0, '#E9D5FF');
      gr.addColorStop(1, '#7E22CE');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, 0.15, 0, TAU);
      g.fill();
    }
    g.shadowBlur = 0;
    g.strokeStyle = '#86EFAC';
    g.lineWidth = 0.06;
    g.beginPath();
    g.moveTo(0, -0.3);
    g.lineTo(0.06, -0.48);
    g.stroke();
  } else if (k === 'CLO') {
    const gr = g.createLinearGradient(0, -0.45, 0, 0.45);
    gr.addColorStop(0, '#FEF3C7');
    gr.addColorStop(1, '#F59E0B');
    g.fillStyle = gr;
    g.shadowColor = 'rgba(251,191,36,0.9)';
    g.shadowBlur = 8;
    g.beginPath();
    g.moveTo(-0.44, 0.28);
    g.quadraticCurveTo(-0.36, 0.1, -0.34, -0.08);
    g.bezierCurveTo(-0.34, -0.5, 0.34, -0.5, 0.34, -0.08);
    g.quadraticCurveTo(0.36, 0.1, 0.44, 0.28);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(0, 0.38, 0.1, 0, TAU);
    g.fill();
  } else if (k === 'DIA') {
    drawGem(g, 0, 0, 1.02);
  } else {
    // 7
    g.font = font(1.0);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(244,63,94,0.9)';
    g.shadowBlur = 12;
    g.lineWidth = 0.14;
    g.strokeStyle = '#FFFFFF';
    g.strokeText('7', 0, 0.04);
    const gr = g.createLinearGradient(0, -0.5, 0, 0.5);
    gr.addColorStop(0, '#FB7185');
    gr.addColorStop(1, '#BE123C');
    g.fillStyle = gr;
    g.fillText('7', 0, 0.04);
  }
  g.restore();
}

function stagePanel(g, w, h, line) {
  rr(g, 0, 0, w, h, 14);
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(22,5,52,0.96)');
  gr.addColorStop(1, 'rgba(10,2,26,0.97)');
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = line || C.line;
  g.stroke();
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  TAU, C, setFont, font, rr, text, spark, sparkles, chip, suitKey, isRed,
  drawSuit, drawCard, drawDie, drawCoin, drawGem, drawBomb, drawSymbol, stagePanel, mulberry,
};
