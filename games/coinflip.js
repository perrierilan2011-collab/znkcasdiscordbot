'use strict';
const D = require('./draw');

const LABEL = { pile: 'PILE', face: 'FACE' };
const other = (s) => (s === 'pile' ? 'face' : 'pile');
const R = 44;

const theme = { c0: '#2A1163', c1: '#0A0422', rim: 'rgba(240,171,252,0.85)', spot: 'rgba(240,171,252,0.2)', pattern: 'dots' };

// y = centre de la pièce, sy = écrasement (rotation en l'air)
const FLIGHT = [
  { y: 112, sy: 1, cap: 'La pièce est lancée' },
  { y: 78, sy: 0.55, cap: 'Elle monte...' },
  { y: 50, sy: 0.12, cap: 'Elle tourne dans les airs' },
  { y: 44, sy: 0.9, cap: 'Sommet du lancer' },
  { y: 60, sy: 0.2, cap: 'Elle redescend...' },
  { y: 92, sy: 0.7, cap: 'Elle ralentit' },
  { y: 112, sy: 1, cap: '' },
];

function sideTile(g, x, y, w, h, label, side, o = {}) {
  D.hud(g, x, y, w, h, label, '', o);
  if (side) D.drawCoin(g, x + w / 2, y + h / 2 + 1, 17, { mark: side, sy: 1, glow: o.glow });
  else D.text(g, '?', x + w / 2, y + h / 2 + 4, { size: 26, color: 'rgba(233,213,255,0.5)' });
  if (side) D.text(g, LABEL[side], x + w / 2, y + h - 7, { size: 10, color: o.color || '#F5D0FE' });
}

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
        const floorY = h - 22;
        // faisceau de projecteur
        g.save();
        const bm = g.createLinearGradient(0, 0, 0, floorY);
        bm.addColorStop(0, 'rgba(240,171,252,0.2)');
        bm.addColorStop(1, 'rgba(240,171,252,0.02)');
        g.fillStyle = bm;
        g.beginPath();
        g.moveTo(cx - 24, 0);
        g.lineTo(cx + 24, 0);
        g.lineTo(cx + 110, floorY);
        g.lineTo(cx - 110, floorY);
        g.closePath();
        g.fill();
        g.restore();
        // sol
        D.floorGlow(g, cx, floorY, 170, 20, 'rgba(216,180,254,0.55)');
        const lg = g.createLinearGradient(60, 0, w - 60, 0);
        lg.addColorStop(0, 'rgba(192,132,252,0)');
        lg.addColorStop(0.5, 'rgba(233,213,255,0.9)');
        lg.addColorStop(1, 'rgba(192,132,252,0)');
        g.fillStyle = lg;
        g.fillRect(60, floorY, w - 120, 2);
        // ombre
        const air = D.clamp((floorY - R - f.y) / 70);
        g.fillStyle = `rgba(0,0,0,${0.5 - air * 0.3})`;
        g.beginPath();
        g.ellipse(cx, floorY + 5, R * (1 - air * 0.35), 6 * (1 - air * 0.4), 0, 0, D.TAU);
        g.fill();
        // traînée
        if (f.sy < 0.9 && !last) {
          D.drawCoin(g, cx, f.y + 26, R, { sy: f.sy, alpha: 0.1, mark: faceKey });
          D.drawCoin(g, cx, f.y + 13, R, { sy: f.sy, alpha: 0.2, mark: faceKey });
        }
        D.drawCoin(g, cx, f.y, R, { sy: f.sy, mark: faceKey, label: LABEL[faceKey], glow: last && S.accent ? S.accent : undefined });
        if (last) {
          for (let a = 0; a < 8; a++) {
            const an = (a / 8) * D.TAU;
            D.spark(g, cx + Math.cos(an) * (R + 22), f.y + Math.sin(an) * 14, 3.5, '#F5D0FE', 0.85);
          }
        }
        // côtés
        sideTile(g, 14, 14, 92, 76, 'Ton choix', choice);
        sideTile(g, w - 106, 14, 92, 76, 'Résultat', last ? side : null, { color: S.accent || '#fff', line: last ? S.accent || undefined : undefined, glow: last ? S.accent : undefined });
      },
    };
  });
  return { frames };
}


// ---------- GIF : la pièce est lancée, tourne en l'air, retombe, rebondit et s'immobilise sur le bon côté ----------
function gif(res, ctx) {
  const side = res.side === 'face' ? 'face' : 'pile';
  const choice = String(ctx.choice || '').toLowerCase() === 'face' ? 'face' : 'pile';
  const startSide = other(side);
  const HALF_TURNS = 13; // impair : la pièce part sur l'autre côté et retombe sur le résultat
  const LAUNCH = 0.1; // préparation avant le lancer
  const LAND = 0.7; // instant où elle touche la table
  const REST_Y = 112;
  const PEAK_Y = 40;
  const pos = (t) => {
    if (t < LAUNCH) return { y: REST_Y + (t / LAUNCH) * 4, th: 0, air: 0, phase: 0 }; // elle se « charge »
    if (t < LAND) {
      const u = (t - LAUNCH) / (LAND - LAUNCH);
      const y = REST_Y - (REST_Y - PEAK_Y) * 4 * u * (1 - u);
      const th = Math.PI * HALF_TURNS * (1 - Math.pow(1 - u, 1.5)); // ralentit avant l'impact
      return { y, th, air: 1, phase: 1 };
    }
    const u = (t - LAND) / (1 - LAND);
    const bounce = 20 * Math.exp(-4.2 * u) * Math.abs(Math.sin(u * Math.PI * 3));
    return { y: REST_Y - bounce, th: Math.PI * HALF_TURNS, air: bounce > 1 ? 0.5 : 0, phase: 2 };
  };
  return {
    dur: 4.2,
    cap: (t) => (t < LAUNCH ? 'La pièce est lancée' : t < 0.3 ? 'Elle monte...' : t < 0.5 ? 'Elle tourne dans les airs' : t < LAND ? 'Elle redescend...' : t < 0.92 ? 'Elle rebondit...' : `La pièce retombe sur ${LABEL[side]}`),
    draw(S, t) {
      const { g, w, h, cx } = S;
      const floorY = h - 22;
      const { y, th, phase } = pos(t);
      const landed = t >= 0.9;
      const c = Math.cos(th);
      const sy = Math.max(0.07, Math.abs(c));
      const faceKey = c >= 0 ? startSide : side;
      // faisceau de projecteur
      g.save();
      const bm = g.createLinearGradient(0, 0, 0, floorY);
      bm.addColorStop(0, 'rgba(240,171,252,0.2)');
      bm.addColorStop(1, 'rgba(240,171,252,0.02)');
      g.fillStyle = bm;
      g.beginPath();
      g.moveTo(cx - 24, 0);
      g.lineTo(cx + 24, 0);
      g.lineTo(cx + 110, floorY);
      g.lineTo(cx - 110, floorY);
      g.closePath();
      g.fill();
      g.restore();
      // sol
      D.floorGlow(g, cx, floorY, 170, 20, 'rgba(216,180,254,0.55)');
      const lg = g.createLinearGradient(60, 0, w - 60, 0);
      lg.addColorStop(0, 'rgba(192,132,252,0)');
      lg.addColorStop(0.5, 'rgba(233,213,255,0.9)');
      lg.addColorStop(1, 'rgba(192,132,252,0)');
      g.fillStyle = lg;
      g.fillRect(60, floorY, w - 120, 2);
      // ombre (plus petite et plus claire quand la pièce est haute)
      const air = D.clamp((floorY - R - y) / 70);
      g.fillStyle = `rgba(0,0,0,${0.5 - air * 0.3})`;
      g.beginPath();
      g.ellipse(cx, floorY + 5, R * (1 - air * 0.35), 6 * (1 - air * 0.4), 0, 0, D.TAU);
      g.fill();
      // traînée pendant la rotation rapide
      if (phase === 1 && t < LAND - 0.05) {
        for (const [dt, a] of [[0.035, 0.2], [0.07, 0.1]]) {
          const q = pos(t - dt);
          D.drawCoin(g, cx, q.y, R, { sy: Math.max(0.07, Math.abs(Math.cos(q.th))), alpha: a, mark: Math.cos(q.th) >= 0 ? startSide : side });
        }
      }
      D.drawCoin(g, cx, y, R, { sy, mark: faceKey, label: sy > 0.6 ? LABEL[faceKey] : undefined, glow: landed && S.accent ? S.accent : undefined });
      if (landed) {
        const k = D.clamp((t - 0.9) / 0.1);
        for (let a = 0; a < 8; a++) {
          const an = (a / 8) * D.TAU;
          D.spark(g, cx + Math.cos(an) * (R + 16 + k * 10), y + Math.sin(an) * 14, 3.5, '#F5D0FE', 0.85 * k);
        }
      }
      // côtés
      sideTile(g, 14, 14, 92, 76, 'Ton choix', choice);
      sideTile(g, w - 106, 14, 92, 76, 'Résultat', landed ? side : null, { color: landed ? S.accent || '#fff' : '#fff', line: landed ? S.accent || undefined : undefined, glow: landed ? S.accent : undefined });
    },
  };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  const sy = Math.abs(Math.cos(p * Math.PI * 3.2));
  D.drawCoin(g, cx, cy, 30, { sy: S.last ? 1 : sy, label: 'ZNK' });
}

module.exports = { key: 'coinflip', title: 'Pile ou Face', theme, build, gif, emblem };
