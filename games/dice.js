'use strict';
const D = require('./draw');

function build(res, ctx) {
  const a = res.a;
  const b = res.b;
  const sum = res.sum;
  const bounce = [-20, -12, -4, -8, -2, 0];
  const caps = ['Les dés sont lancés', 'Ils rebondissent...', 'Ils roulent sur la table', 'Ils ralentissent', 'Presque arrêtés', ''];
  const n = caps.length;
  const frames = caps.map((cap, k) => {
    const last = k === n - 1;
    return {
      cap: last ? `${a} + ${b} = ${sum}` : cap,
      ms: last ? 1200 : 800,
      draw(S) {
        const { g, h, w, rnd } = S;
        const base = h / 2 + 8;
        const va = last ? a : 1 + Math.floor(rnd() * 6);
        const vb = last ? b : 1 + Math.floor(rnd() * 6);
        const spread = last ? 0 : (n - 1 - k) * 0.11;
        const dy = bounce[k];
        const ra = last ? 0.0 : (rnd() - 0.5) * 2 * (0.3 + spread * 3);
        const rb = last ? 0.0 : (rnd() - 0.5) * 2 * (0.3 + spread * 3);
        // table
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath();
        g.ellipse(215, h - 12, 34, 5, 0, 0, D.TAU);
        g.ellipse(305, h - 12, 34, 5, 0, 0, D.TAU);
        g.fill();
        D.drawDie(g, 215 + (last ? 0 : (rnd() - 0.5) * 10), base + dy, 52, va, ra, { glow: last && S.accent ? S.accent : undefined });
        D.drawDie(g, 305 + (last ? 0 : (rnd() - 0.5) * 10), base + dy * 0.8, 52, vb, rb, { glow: last && S.accent ? S.accent : undefined });
        // somme
        D.text(g, 'SOMME', 450, 26, { size: 11, color: 'rgba(233,213,255,0.75)' });
        D.text(g, last ? String(sum) : '?', 450, 60, { size: 40, color: last ? S.accent || '#fff' : 'rgba(255,255,255,0.45)', glow: last ? S.accent : undefined });
        D.chip(g, w - 150, 10, 136, 36, 'Ton pari', res.pick || '-');
        if (last) D.chip(g, w - 150, 52, 136, 36, 'Résultat', String(sum), { color: S.accent || '#fff', line: S.accent || undefined });
      },
    };
  });
  return { frames };
}

function emblem(S, cx, cy) {
  const v = S.last ? S.res.a : 1 + Math.floor(S.rnd() * 6);
  D.drawDie(S.g, cx, cy, 54, v, S.last ? 0 : (S.rnd() - 0.5) * 1.2);
}

module.exports = { key: 'dice', title: 'Dés', build, emblem };
