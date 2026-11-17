'use strict';
/*
 * games/draw.js — ZNK Casino
 * Primitives de dessin (canvas 2D) partagées par toutes les animations de jeux.
 * Aucun emoji : tout est dessiné en vectoriel (le canvas du serveur n'a pas les emojis).
 *
 * v2 : cartes avec vrais pips + figures, dés en relief, pièce 3D avec tranche,
 *      jetons de casino, plaques HUD, tables feutrées, confettis, ampoules, etc.
 */
const TAU = Math.PI * 2;

let FONT = 'sans-serif';
const setFont = (f) => {
  FONT = f || 'sans-serif';
};
const font = (px, weight = 'bold') => `${weight} ${px}px ${FONT}`;

// Palette « néon violet ZNK »
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
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
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

// Étoile à 4 branches, comme dans le gabarit
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

// Confettis (victoire)
function confetti(g, rnd, w, h, n = 30) {
  const cols = ['#FDE68A', '#F0ABFC', '#A78BFA', '#67E8F9', '#86EFAC', '#FFFFFF', '#FB7185'];
  for (let k = 0; k < n; k++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const s = 3 + rnd() * 4;
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * TAU);
    g.globalAlpha = 0.55 + rnd() * 0.45;
    g.fillStyle = cols[k % cols.length];
    g.fillRect(-s, -s * 0.4, s * 2, s * 0.8);
    g.restore();
  }
}

// Plaque d'information en verre fumé : petit libellé + valeur
function hud(g, x, y, w, h, label, value, o = {}) {
  g.save();
  rr(g, x, y, w, h, 10);
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, o.bg0 || 'rgba(58,18,110,0.78)');
  gr.addColorStop(1, o.bg1 || 'rgba(18,4,42,0.88)');
  g.fillStyle = gr;
  if (o.glow) {
    g.shadowColor = o.glow;
    g.shadowBlur = 14;
  }
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 1.4;
  g.strokeStyle = o.line || 'rgba(192,132,252,0.6)';
  g.stroke();
  // reflet
  rr(g, x + 2, y + 2, w - 4, h * 0.38, 8);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fill();
  g.restore();
  text(g, String(label).toUpperCase(), x + w / 2, y + 12, { size: 9, color: o.labelColor || 'rgba(233,213,255,0.75)' });
  text(g, value, x + w / 2, y + h - 14, { size: o.size || 15, color: o.color || '#FFFFFF', glow: o.glow, blur: 8 });
}

// ancien nom conservé
function chip(g, x, y, w, h, label, value, o = {}) {
  hud(g, x, y, w, h, label, value, o);
}

// Plaque nominative (TOI / CROUPIER…)
function plate(g, cx, cy, w, label, value, o = {}) {
  const h = 24;
  const x = cx - w / 2;
  g.save();
  rr(g, x, cy - h / 2, w, h, 12);
  g.fillStyle = o.fill || 'rgba(12,3,30,0.7)';
  g.fill();
  g.lineWidth = 1.4;
  g.strokeStyle = o.line || 'rgba(192,132,252,0.7)';
  if (o.glow) {
    g.shadowColor = o.glow;
    g.shadowBlur = 12;
  }
  g.stroke();
  g.restore();
  g.font = font(11);
  const lw = g.measureText(label).width;
  if (value == null || value === '') {
    text(g, label, cx, cy + 0.5, { size: 11, color: o.color || '#F5D0FE' });
    return;
  }
  const bw = 26;
  const total = lw + 8 + bw;
  const lx = cx - total / 2;
  text(g, label, lx, cy + 0.5, { size: 11, align: 'left', color: o.color || '#F5D0FE' });
  rr(g, lx + lw + 8, cy - 9, bw, 18, 9);
  g.fillStyle = o.badge || 'rgba(168,85,247,0.75)';
  g.fill();
  text(g, value, lx + lw + 8 + bw / 2, cy + 0.5, { size: 11.5, color: o.badgeText || '#fff' });
}

// Jeton de casino
function token(g, cx, cy, r, color = '#A855F7', o = {}) {
  g.save();
  g.translate(cx, cy);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fillStyle = color;
  g.fill();
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    g.beginPath();
    g.arc(0, 0, r - 0.5, a - 0.2, a + 0.2);
    g.lineWidth = r * 0.34;
    g.strokeStyle = 'rgba(255,255,255,0.92)';
    g.stroke();
  }
  g.beginPath();
  g.arc(0, 0, r * 0.66, 0, TAU);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.stroke();
  const hl = g.createRadialGradient(-r * 0.3, -r * 0.35, 1, 0, 0, r);
  hl.addColorStop(0, 'rgba(255,255,255,0.35)');
  hl.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fillStyle = hl;
  g.fill();
  spark(g, 0, 0, r * 0.3, '#FFFFFF', 0.9);
  g.restore();
}

function tokenStack(g, cx, cy, r, n, color) {
  for (let i = 0; i < n; i++) token(g, cx, cy - i * (r * 0.34), r, color);
}

// Rangée d'ampoules (marquee)
function bulbs(g, x0, x1, y, count, k = 0, color = '#FDE68A', dim = 'rgba(253,230,138,0.22)') {
  for (let i = 0; i < count; i++) {
    const x = x0 + ((x1 - x0) * i) / (count - 1);
    const on = (i + k) % 2 === 0;
    g.save();
    g.beginPath();
    g.arc(x, y, 2.6, 0, TAU);
    g.fillStyle = on ? color : dim;
    if (on) {
      g.shadowColor = color;
      g.shadowBlur = 8;
    }
    g.fill();
    g.restore();
  }
}

function vignette(g, w, h, color = 'rgba(0,0,0,0.55)', inner = 0.55) {
  const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.max(w, h) * 0.62);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, color);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
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
    g.quadraticCurveTo(0.12, -0.18, 0.38, 0);
    g.quadraticCurveTo(0.12, 0.18, 0, 0.5);
    g.quadraticCurveTo(-0.12, 0.18, -0.38, 0);
    g.quadraticCurveTo(-0.12, -0.18, 0, -0.5);
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

// disposition des pips : [colonne -1/0/1, ligne 0..1]
const PIP_LAYOUT = {
  2: [[0, 0], [0, 1]],
  3: [[0, 0], [0, 0.5], [0, 1]],
  4: [[-1, 0], [1, 0], [-1, 1], [1, 1]],
  5: [[-1, 0], [1, 0], [0, 0.5], [-1, 1], [1, 1]],
  6: [[-1, 0], [1, 0], [-1, 0.5], [1, 0.5], [-1, 1], [1, 1]],
  7: [[-1, 0], [1, 0], [0, 0.25], [-1, 0.5], [1, 0.5], [-1, 1], [1, 1]],
  8: [[-1, 0], [1, 0], [0, 0.25], [-1, 0.5], [1, 0.5], [0, 0.75], [-1, 1], [1, 1]],
  9: [[-1, 0], [1, 0], [-1, 0.333], [1, 0.333], [0, 0.5], [-1, 0.667], [1, 0.667], [-1, 1], [1, 1]],
  10: [[-1, 0], [1, 0], [0, 0.17], [-1, 0.333], [1, 0.333], [-1, 0.667], [1, 0.667], [0, 0.83], [-1, 1], [1, 1]],
};

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
    g.shadowBlur = 22;
  } else {
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 10;
    g.shadowOffsetY = 4;
  }
  rr(g, -w / 2, -h / 2, w, h, w * 0.1);
  if (up) {
    const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    gr.addColorStop(0, '#FFFFFF');
    gr.addColorStop(1, '#E4D9FB');
    g.fillStyle = gr;
  } else {
    const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    gr.addColorStop(0, '#8B45F5');
    gr.addColorStop(1, '#3B0F66');
    g.fillStyle = gr;
  }
  g.fill();
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.lineWidth = 1.6;
  g.strokeStyle = up ? '#8B5CF6' : '#F3E8FF';
  g.stroke();
  if (up && card) {
    const col = isRed(card.s) ? '#E11D48' : '#1E1B4B';
    const rank = String(card.r);
    const big = h >= 66;
    // fine bordure intérieure
    rr(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, w * 0.07);
    g.lineWidth = 0.8;
    g.strokeStyle = 'rgba(124,58,237,0.25)';
    g.stroke();
    // indices (coin haut-gauche + bas-droite retourné)
    const idx = (flipY) => {
      g.save();
      if (flipY) g.rotate(Math.PI);
      text(g, rank, -w / 2 + w * 0.15, -h / 2 + h * 0.14, { size: h * (rank === '10' ? 0.15 : 0.19), color: col });
      drawSuit(g, card.s, -w / 2 + w * 0.15, -h / 2 + h * 0.29, h * 0.12, col);
      g.restore();
    };
    idx(false);
    idx(true);
    const n = rank === 'A' ? 1 : /^\d+$/.test(rank) ? Number(rank) : 0;
    if (big && n >= 2 && n <= 10) {
      const px = w * 0.17;
      const top = -h * 0.29;
      const span = h * 0.58;
      const ps = h * 0.135;
      for (const [cx, row] of PIP_LAYOUT[n]) {
        const py = top + span * row;
        g.save();
        g.translate(cx * px, py);
        if (row > 0.5) g.rotate(Math.PI);
        drawSuit(g, card.s, 0, 0, ps, col);
        g.restore();
      }
    } else if (n === 1) {
      drawSuit(g, card.s, 0, 0, h * 0.5, col);
    } else if (n === 0) {
      // figure : cadre + lettre + couleur
      rr(g, -w * 0.28, -h * 0.3, w * 0.56, h * 0.6, 5);
      const fg = g.createLinearGradient(0, -h * 0.3, 0, h * 0.3);
      fg.addColorStop(0, 'rgba(253,230,138,0.55)');
      fg.addColorStop(1, 'rgba(168,85,247,0.25)');
      g.fillStyle = fg;
      g.fill();
      g.lineWidth = 1.1;
      g.strokeStyle = 'rgba(124,58,237,0.7)';
      g.stroke();
      drawSuit(g, card.s, 0, -h * 0.15, h * 0.2, col);
      text(g, rank, 0, h * 0.07, { size: h * 0.26, color: col });
      g.save();
      g.rotate(Math.PI);
      drawSuit(g, card.s, 0, -h * 0.15, h * 0.2, col);
      g.restore();
    } else {
      drawSuit(g, card.s, w * 0.02, 0, h * 0.46, col);
    }
  } else if (!up) {
    g.save();
    rr(g, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, w * 0.07);
    g.clip();
    g.strokeStyle = 'rgba(233,213,255,0.3)';
    g.lineWidth = 1;
    for (let d = -h; d < w + h; d += 8) {
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
    rr(g, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, w * 0.07);
    g.lineWidth = 1.1;
    g.strokeStyle = 'rgba(253,230,138,0.65)';
    g.stroke();
    g.beginPath();
    g.arc(0, 0, Math.min(w, h) * 0.24, 0, TAU);
    g.fillStyle = 'rgba(59,15,102,0.85)';
    g.fill();
    g.strokeStyle = 'rgba(253,230,138,0.8)';
    g.stroke();
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
  g.shadowColor = o.glow || 'rgba(0,0,0,0.55)';
  g.shadowBlur = o.glow ? 24 : 12;
  g.shadowOffsetY = o.glow ? 0 : 5;
  const gr = g.createLinearGradient(-h, -h, h, h);
  gr.addColorStop(0, '#FFFFFF');
  gr.addColorStop(0.55, '#EDE4FF');
  gr.addColorStop(1, '#B9A4F5');
  g.fillStyle = gr;
  rr(g, -h, -h, s, s, s * 0.22);
  g.fill();
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.lineWidth = 2;
  g.strokeStyle = '#7C3AED';
  g.stroke();
  // biseau
  rr(g, -h + 3, -h + 3, s - 6, s - 6, s * 0.18);
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.stroke();
  const sp = s * 0.27;
  for (const idx of PIPS[Math.max(1, Math.min(6, v))]) {
    const px = ((idx % 3) - 1) * sp;
    const py = (Math.floor(idx / 3) - 1) * sp;
    const pr = s * 0.085;
    const pg = g.createRadialGradient(px - pr * 0.3, py - pr * 0.3, 0.5, px, py, pr * 1.2);
    const one = v === 1;
    pg.addColorStop(0, one ? '#FB7185' : '#7C3AED');
    pg.addColorStop(1, one ? '#9F1239' : '#2E1065');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(px, py, one ? pr * 1.5 : pr, 0, TAU);
    g.fill();
  }
  g.restore();
}

// Pièce : sy = écrasement vertical (rotation en l'air), mark = 'pile' | 'face'
function drawCoin(g, cx, cy, r, o = {}) {
  const sy = o.sy == null ? 1 : Math.max(0.07, o.sy);
  g.save();
  g.translate(cx, cy);
  g.scale(1, sy);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  // tranche
  const th = Math.min(r * 0.2, 9) / sy;
  g.shadowColor = o.glow || 'rgba(232,121,249,0.85)';
  g.shadowBlur = 18;
  g.beginPath();
  g.arc(0, th * 0.5, r, 0, TAU);
  g.fillStyle = '#6B21A8';
  g.fill();
  g.shadowBlur = 0;
  g.beginPath();
  g.rect(-r, 0, r * 2, th * 0.5);
  g.fillStyle = '#6B21A8';
  g.fill();
  // face
  const gr = g.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, '#FAE8FF');
  gr.addColorStop(0.45, '#D8B4FE');
  gr.addColorStop(1, '#7E22CE');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.lineWidth = Math.max(2, r * 0.07);
  g.strokeStyle = '#F5E9FF';
  g.stroke();
  // crénelage
  g.save();
  g.lineWidth = 1.4;
  g.strokeStyle = 'rgba(76,29,149,0.45)';
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    g.lineTo(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
    g.stroke();
  }
  g.restore();
  g.lineWidth = 1.3;
  g.strokeStyle = 'rgba(76,29,149,0.7)';
  g.beginPath();
  g.arc(0, 0, r * 0.78, 0, TAU);
  g.stroke();
  const ink = '#3B0764';
  if (o.mark === 'face') {
    // couronne
    g.fillStyle = ink;
    g.beginPath();
    const u = r * 0.34;
    g.moveTo(-u * 1.3, u * 0.7);
    g.lineTo(-u * 1.5, -u * 0.8);
    g.lineTo(-u * 0.6, -u * 0.1);
    g.lineTo(0, -u * 1.1);
    g.lineTo(u * 0.6, -u * 0.1);
    g.lineTo(u * 1.5, -u * 0.8);
    g.lineTo(u * 1.3, u * 0.7);
    g.closePath();
    g.fill();
    if (o.label) text(g, o.label, 0, r * 0.52, { size: r * 0.24, color: ink });
  } else if (o.mark === 'pile') {
    text(g, 'Z', 0, -r * 0.06, { size: r * 0.82, color: ink });
    if (o.label) text(g, o.label, 0, r * 0.52, { size: r * 0.24, color: ink });
  } else if (o.label) text(g, o.label, 0, 1, { size: r * 0.5, color: ink });
  else spark(g, 0, 0, r * 0.4, '#FFFFFF');
  // reflet
  g.beginPath();
  g.arc(0, 0, r, Math.PI * 1.08, Math.PI * 1.45);
  g.lineWidth = r * 0.1;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.stroke();
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
  // facette brillante
  g.beginPath();
  g.moveTo(-0.28, -0.42);
  g.lineTo(0.28, -0.42);
  g.lineTo(0.12, -0.12);
  g.lineTo(-0.12, -0.12);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fill();
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
  gr.addColorStop(0, '#7C6BA5');
  gr.addColorStop(1, '#0F0820');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0.08, 0.38, 0, TAU);
  g.fill();
  g.shadowBlur = 0;
  // culot
  g.fillStyle = '#2B1A4D';
  g.fillRect(0.02, -0.34, 0.2, 0.1);
  g.lineWidth = 0.07;
  g.strokeStyle = '#C4B5FD';
  g.beginPath();
  g.moveTo(0.18, -0.3);
  g.quadraticCurveTo(0.3, -0.5, 0.46, -0.42);
  g.stroke();
  // reflet
  g.beginPath();
  g.arc(-0.12, -0.04, 0.12, Math.PI * 1.1, Math.PI * 1.6);
  g.lineWidth = 0.05;
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.stroke();
  g.restore();
  spark(g, cx + s * 0.46, cy - s * 0.42, s * 0.17, '#FDBA74');
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

/**
 * Table de jeu (fond de la scène) : tapis dégradé + projecteur + trame + liseré.
 * o.c0 / o.c1 : couleurs du tapis, o.rim : couleur du liseré, o.pattern : 'diamond' | 'dots' | 'lines' | null
 */
function stage(g, w, h, o = {}) {
  g.save();
  rr(g, 0, 0, w, h, 18);
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, o.c0 || '#2A0E55');
  gr.addColorStop(1, o.c1 || '#10042A');
  g.fillStyle = gr;
  g.fill();
  g.clip();
  // trame
  g.globalAlpha = 0.07;
  g.strokeStyle = '#FFFFFF';
  g.fillStyle = '#FFFFFF';
  g.lineWidth = 1;
  const pat = o.pattern === undefined ? 'diamond' : o.pattern;
  if (pat === 'diamond') {
    for (let x = -h; x < w + h; x += 22) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + h, h);
      g.moveTo(x + h, 0);
      g.lineTo(x, h);
      g.stroke();
    }
  } else if (pat === 'dots') {
    for (let x = 8; x < w; x += 16) for (let y = 8; y < h; y += 16) g.fillRect(x, y, 1.6, 1.6);
  } else if (pat === 'lines') {
    for (let y = 6; y < h; y += 8) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  // projecteur
  const sp = g.createRadialGradient(w / 2, h * 0.45, 4, w / 2, h * 0.45, w * 0.55);
  sp.addColorStop(0, o.spot || 'rgba(255,255,255,0.16)');
  sp.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sp;
  g.fillRect(0, 0, w, h);
  vignette(g, w, h, 'rgba(0,0,0,0.5)', 0.45);
  g.restore();
}

// cadre néon autour de la scène (dessiné après le contenu)
function stageRim(g, w, h, color, glow = 12) {
  g.save();
  rr(g, 0, 0, w, h, 18);
  g.lineWidth = 2.2;
  g.strokeStyle = color || 'rgba(192,132,252,0.8)';
  g.shadowColor = color || '#C084FC';
  g.shadowBlur = glow;
  g.stroke();
  g.shadowBlur = 0;
  rr(g, 5, 5, w - 10, h - 10, 14);
  g.lineWidth = 0.9;
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.stroke();
  g.restore();
}

// ancien nom conservé
function stagePanel(g, w, h, line) {
  stage(g, w, h);
  stageRim(g, w, h, line, 6);
}

// Cercle lumineux « sol »
function floorGlow(g, cx, y, rx, ry, color = 'rgba(192,132,252,0.5)') {
  g.save();
  g.translate(cx, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 2, 0, 0, rx);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(192,132,252,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, rx, 0, TAU);
  g.fill();
  g.restore();
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

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);

module.exports = {
  TAU, C, setFont, font, rr, text, spark, sparkles, confetti, hud, chip, plate, token, tokenStack, bulbs, vignette,
  suitKey, isRed, drawSuit, drawCard, drawDie, drawCoin, drawGem, drawBomb, drawSymbol,
  stage, stageRim, stagePanel, floorGlow, mulberry, lerp, clamp, ease,
};
