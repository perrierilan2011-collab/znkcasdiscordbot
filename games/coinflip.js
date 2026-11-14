'use strict';
const D = require('./draw');

const LABEL = { pile: 'PILE', face: 'FACE' };
const other = (s) => (s === 'pile' ? 'face' : 'pile');

// y = hauteur de la pièce, sy = écrasement (rotation en l'air)
const FLIGHT = [
  { y: 62, sy: 1, cap: 'La pièce est lancée' },
  { y: 42, sy: 0.55, cap: 'Elle monte...' },
  { y: 30, sy: 0.14, cap: 'Elle tourne dans les airs' },
  { y: 26, sy: 0.85, cap: 'Sommet du lancer' },
  { y: 34, sy: 0.22, cap: 'Elle redescend...' },
  { y: 50, sy: 0.7, cap: 'Elle ralentit' },
  { y: 62, sy: 1, cap: '' },
];

function build(res, ctx) {
  const side = res.side === 'face' ? 'face' : 'pile';
  const choice = String(ctx.choice || '').toLowerCase() === 'face' ? 'face' : 'pile';
  const n = FLIGHT.length;
  const frames = FLIGHT.map((f, k) => {
    const faceKey = (n - 1 - k) % 2 === 0 ? side : other(side);
    const last = k === n - 1;
    return {
      cap: last ? `La pièce retombe sur ${LABEL[side]}` : f.cap,
      ms: last ? 1200 : 850,
      draw(S) {
        const { g, w, h, cx } = S;
        const floorY = h - 10;
        // sol lumineux
        const lg = g.createLinearGradient(40, 0, w - 40, 0);
        lg.addColorStop(0, 'rgba(192,132,252,0)');
        lg.addColorStop(0.5, 'rgba(192,132,252,0.85)');
        lg.addColorStop(1, 'rgba(192,132,252,0)');
        g.fillStyle = lg;
        g.fillRect(40, floorY, w - 80, 2);
        // ombre
        const air = Math.max(0, Math.min(1, (floorY - 28 - f.y) / 40));
        g.fillStyle = `rgba(0,0,0,${0.45 - air * 0.25})`;
        g.beginPath();
        g.ellipse(cx, floorY - 1, 32 - air * 10, 5 - air * 1.5, 0, 0, D.TAU);
        g.fill();
        // traînée
        if (f.sy < 0.9 && !last) {
          D.drawCoin(g, cx, f.y + 16, 28, { sy: f.sy, alpha: 0.12, label: LABEL[faceKey] });
          D.drawCoin(g, cx, f.y + 8, 28, { sy: f.sy, alpha: 0.22, label: LABEL[faceKey] });
        }
        D.drawCoin(g, cx, f.y, 28, { sy: f.sy, label: LABEL[faceKey], glow: last && S.accent ? S.accent : undefined });
        // pastilles
        D.chip(g, 16, 10, 118, 36, 'Ton choix', LABEL[choice]);
        if (last) {
          D.chip(g, w - 134, 10, 118, 36, 'Résultat', LABEL[side], { color: S.accent || '#fff', line: S.accent || undefined });
        } else {
          D.chip(g, w - 134, 10, 118, 36, 'Résultat', '?', { color: 'rgba(233,213,255,0.6)' });
        }
      },
    };
  });
  return { frames };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  const sy = Math.abs(Math.cos(p * Math.PI * 3.2));
  D.drawCoin(g, cx, cy, 30, { sy: S.last ? 1 : sy, label: 'ZNK' });
}

module.exports = { key: 'coinflip', title: 'Pile ou Face', build, emblem };
