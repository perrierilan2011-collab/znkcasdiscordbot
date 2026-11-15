'use strict';
const D = require('./draw');

const theme = { c0: '#0F3D46', c1: '#06171C', rim: 'rgba(103,232,249,0.85)', spot: 'rgba(165,243,252,0.2)', pattern: 'diamond' };

function build(res, ctx) {
  const a = res.a;
  const b = res.b;
  const sum = res.sum;
  const bounce = [-46, -24, -8, -16, -4, 0];
  const caps = ['Les dés sont lancés', 'Ils rebondissent...', 'Ils roulent sur la table', 'Ils ralentissent', 'Presque arrêtés', ''];
  const n = caps.length;
  const frames = caps.map((cap, k) => {
    const last = k === n - 1;
    return {
      cap: last ? `${a} + ${b} = ${sum}` : cap,
      ms: last ? 1200 : 800,
      draw(S) {
        const { g, h, w, cx, rnd } = S;
        const base = h / 2 + 6;
        const va = last ? a : 1 + Math.floor(rnd() * 6);
        const vb = last ? b : 1 + Math.floor(rnd() * 6);
        const spread = last ? 0 : (n - 1 - k) * 0.11;
        const dy = bounce[k];
        const ra = last ? -0.08 : (rnd() - 0.5) * 2 * (0.3 + spread * 3);
        const rb = last ? 0.1 : (rnd() - 0.5) * 2 * (0.3 + spread * 3);
        const xa = cx - 96 + (last ? 0 : (rnd() - 0.5) * 26);
        const xb = cx + 12 + (last ? 0 : (rnd() - 0.5) * 26);
        const glow = last && S.accent ? S.accent : undefined;
        // table : lumière + ombres
        D.floorGlow(g, cx - 40, h - 20, 190, 20, 'rgba(165,243,252,0.35)');
        const air = (d) => D.clamp(-d / 60);
        for (const [sx, d] of [[xa, dy], [xb, dy * 0.8]]) {
          g.fillStyle = `rgba(0,0,0,${0.5 - air(d) * 0.3})`;
          g.beginPath();
          g.ellipse(sx, h - 22, 38 - air(d) * 8, 7, 0, 0, D.TAU);
          g.fill();
        }
        // traînée de mouvement
        if (!last && k < 3) {
          D.drawDie(g, xa - 14, base + dy - 14, 62, va, ra - 0.2, { alpha: 0.16 });
          D.drawDie(g, xb - 14, base + dy * 0.8 - 14, 62, vb, rb - 0.2, { alpha: 0.16 });
        }
        D.drawDie(g, xa, base + dy, 66, va, ra, { glow });
        D.drawDie(g, xb + 62, base + dy * 0.8, 66, vb, rb, { glow });
        // pastille somme (cadran)
        const sx = cx + 210;
        const sy = h / 2 + 4;
        g.save();
        g.beginPath();
        g.arc(sx, sy, 44, 0, D.TAU);
        const rg = g.createRadialGradient(sx - 10, sy - 12, 4, sx, sy, 46);
        rg.addColorStop(0, 'rgba(76,29,149,0.9)');
        rg.addColorStop(1, 'rgba(14,4,36,0.95)');
        g.fillStyle = rg;
        if (last && S.accent) {
          g.shadowColor = S.accent;
          g.shadowBlur = 18;
        }
        g.fill();
        g.shadowBlur = 0;
        g.lineWidth = 2.4;
        g.strokeStyle = last ? S.accent || '#E9D5FF' : 'rgba(192,132,252,0.7)';
        g.stroke();
        g.setLineDash([2, 5]);
        g.beginPath();
        g.arc(sx, sy, 37, 0, D.TAU);
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(255,255,255,0.25)';
        g.stroke();
        g.restore();
        D.text(g, 'SOMME', sx, sy - 25, { size: 9.5, color: 'rgba(233,213,255,0.75)' });
        D.text(g, last ? String(sum) : '?', sx, sy + 6, { size: 38, color: last ? S.accent || '#fff' : 'rgba(255,255,255,0.45)', glow: last ? S.accent : undefined });
        D.hud(g, 14, 14, 100, 48, 'Ton pari', String(res.pick || '-').slice(0, 12), { size: 13 });
        void w;
      },
    };
  });
  return { frames };
}


// ---------- GIF : les dés sont lancés, rebondissent et roulent sur la table avant de s'arrêter ----------
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
function gif(res, ctx) {
  const a = res.a;
  const b = res.b;
  const sum = res.sum;
  const STOP = 0.78; // les dés sont immobiles à 78 %
  const BASE = 92;
  // dé i : position finale, départ hors champ à gauche, rebonds qui diminuent
  const dice = [
    { fx: null, off: 0, spin: 1, bounces: 4.5, amp: 92 },
    { fx: null, off: 0.06, spin: -1, bounces: 4, amp: 78 },
  ];
  const pos = (i, t, cx) => {
    const d = dice[i];
    const finalX = i === 0 ? cx - 96 : cx + 74;
    const m = D.clamp((t - d.off) / (STOP - d.off));
    const x = D.lerp(-50, finalX, D.ease(m));
    const env = Math.pow(1 - m, 1.4);
    const y = BASE - d.amp * env * Math.abs(Math.sin(Math.PI * m * d.bounces));
    const rot = d.spin * env * 15 + (m >= 1 ? (i === 0 ? -0.08 : 0.1) : 0);
    return { x, y, rot, m };
  };
  return {
    dur: 4.2,
    cap: (t) => (t < 0.1 ? 'Les dés sont lancés' : t < 0.4 ? 'Ils rebondissent...' : t < 0.62 ? 'Ils roulent sur la table' : t < STOP ? 'Ils ralentissent' : `${a} + ${b} = ${sum}`),
    draw(S, t) {
      const { g, w, h, cx } = S;
      const done = t >= STOP;
      const glow = S.last && S.accent ? S.accent : undefined;
      D.floorGlow(g, cx - 40, h - 20, 190, 20, 'rgba(165,243,252,0.35)');
      const P = [pos(0, t, cx), pos(1, t, cx)];
      const vals = [a, b];
      P.forEach((q, i) => {
        // ombre
        const air = D.clamp((BASE - q.y) / 60);
        g.fillStyle = `rgba(0,0,0,${0.5 - air * 0.3})`;
        g.beginPath();
        g.ellipse(q.x + (i === 0 ? 0 : 0), h - 22, 38 - air * 8, 7, 0, 0, D.TAU);
        g.fill();
      });
      P.forEach((q, i) => {
        const v = done ? vals[i] : 1 + Math.floor(hash(Math.floor(Math.pow(q.m, 0.6) * 24) + i * 9.7) * 6);
        // traînée de mouvement
        if (!done && q.m < 0.65) {
          const back = pos(i, t - 0.04, cx);
          D.drawDie(g, back.x, back.y, 66, v, back.rot - 0.2, { alpha: 0.16 });
        }
        D.drawDie(g, q.x, q.y, 66, v, q.rot, { glow });
      });
      // pastille somme (cadran)
      const sx = cx + 210;
      const sy = h / 2 + 4;
      g.save();
      g.beginPath();
      g.arc(sx, sy, 44, 0, D.TAU);
      const rg = g.createRadialGradient(sx - 10, sy - 12, 4, sx, sy, 46);
      rg.addColorStop(0, 'rgba(76,29,149,0.9)');
      rg.addColorStop(1, 'rgba(14,4,36,0.95)');
      g.fillStyle = rg;
      if (done && S.accent) {
        g.shadowColor = S.accent;
        g.shadowBlur = 18;
      }
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = 2.4;
      g.strokeStyle = done ? S.accent || '#E9D5FF' : 'rgba(192,132,252,0.7)';
      g.stroke();
      g.setLineDash([2, 5]);
      g.beginPath();
      g.arc(sx, sy, 37, 0, D.TAU);
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.stroke();
      g.restore();
      D.text(g, 'SOMME', sx, sy - 25, { size: 9.5, color: 'rgba(233,213,255,0.75)' });
      D.text(g, done ? String(sum) : '?', sx, sy + 6, { size: 38, color: done ? S.accent || '#fff' : 'rgba(255,255,255,0.45)', glow: done ? S.accent : undefined });
      D.hud(g, 14, 14, 100, 48, 'Ton pari', String(res.pick || '-').slice(0, 12), { size: 13 });
      void w;
    },
  };
}

function emblem(S, cx, cy) {
  const v = S.last ? S.res.a : 1 + Math.floor(S.rnd() * 6);
  D.drawDie(S.g, cx, cy, 54, v, S.last ? 0 : (S.rnd() - 0.5) * 1.2);
}

module.exports = { key: 'dice', title: 'Dés', theme, build, gif, emblem };
