'use strict';
const D = require('./draw');

const CW = 86;
const CH = 118;

const theme = { c0: '#3D1170', c1: '#0F0426', rim: 'rgba(240,171,252,0.85)', spot: 'rgba(240,171,252,0.22)', pattern: 'diamond' };

function build(res, ctx) {
  const win = ctx.outcome === 'win';
  const tie = res.me.v === res.dealer.v;
  const plan = [
    { me: 0, dl: 0, near: 0, cap: 'Les cartes sont distribuées' },
    { me: 0.34, dl: 0, near: 0.6, cap: 'Tu retournes ta carte...' },
    { me: 1, dl: 0, near: 1, cap: `Ta carte : ${res.me.r}` },
    { me: 1, dl: 0.34, near: 1, cap: 'Le croupier retourne la sienne...' },
    { me: 1, dl: 1, near: 1, cap: `Croupier : ${res.dealer.r}` },
    { me: 1, dl: 1, near: 1, hl: true, cap: win ? 'Tu gagnes le duel !' : tie ? 'Égalité : le croupier gagne' : "Le croupier l'emporte" },
  ];
  const n = plan.length;
  const frames = plan.map((f, k) => ({
    cap: f.cap,
    ms: k === n - 1 ? 1300 : 850,
    draw(S) {
      const { g, w, h, cx } = S;
      const y = (h - CH) / 2 + 8;
      const gap = k === 0 ? 210 : 170;
      const xm = cx - gap - CW / 2;
      const xd = cx + gap - CW / 2;
      const meGlow = f.hl && win ? S.accent || '#86EFAC' : null;
      const dlGlow = f.hl && !win ? '#FCA5A5' : null;
      // halos
      D.floorGlow(g, xm + CW / 2, y + CH, 90, 16, 'rgba(240,171,252,0.35)');
      D.floorGlow(g, xd + CW / 2, y + CH, 90, 16, 'rgba(240,171,252,0.35)');
      D.drawCard(g, xm, y, CW, CH, res.me, { flip: f.me, glow: meGlow, alpha: f.hl && !win ? 0.5 : 1, rot: f.me > 0 && f.me < 1 ? -0.06 : -0.02 });
      D.drawCard(g, xd, y, CW, CH, res.dealer, { flip: f.dl, glow: dlGlow, alpha: f.hl && win ? 0.5 : 1, rot: f.dl > 0 && f.dl < 1 ? 0.06 : 0.02 });
      // médaillon VS
      g.save();
      g.beginPath();
      g.arc(cx, h / 2 + 2, 28, 0, D.TAU);
      const vg = g.createRadialGradient(cx - 6, h / 2 - 6, 3, cx, h / 2 + 2, 30);
      vg.addColorStop(0, '#C026D3');
      vg.addColorStop(1, '#4A044E');
      g.fillStyle = vg;
      g.shadowColor = '#E879F9';
      g.shadowBlur = f.hl ? 22 : 12;
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = 2.2;
      g.strokeStyle = '#F5D0FE';
      g.stroke();
      g.restore();
      D.text(g, 'VS', cx, h / 2 + 3, { size: 20, glow: '#F0ABFC' });
      // plaques
      D.plate(g, xm + CW / 2, 17, 106, 'TOI', f.me >= 0.5 ? res.me.r : '?', { line: meGlow || undefined, glow: meGlow });
      D.plate(g, xd + CW / 2, 17, 128, 'CROUPIER', f.dl >= 0.5 ? res.dealer.r : '?', { line: dlGlow || undefined, glow: dlGlow });
      // verdict
      if (f.hl) {
        const label = win ? 'GAGNÉ' : tie ? 'ÉGALITÉ' : 'PERDU';
        D.plate(g, win ? xm + CW / 2 : xd + CW / 2, h - 14, 90, label, '', {
          fill: win ? 'rgba(22,101,52,0.85)' : 'rgba(127,29,29,0.85)',
          line: win ? '#86EFAC' : '#FCA5A5',
          color: '#fff',
        });
      }
      void w;
    },
  }));
  return { frames };
}

function emblem(S, cx, cy) {
  const { g, p, res } = S;
  const sw = Math.sin(p * Math.PI) * 6;
  D.drawCard(g, cx - 34 - sw, cy - 30, 36, 52, res && res.me, { flip: S.last ? 1 : 0, rot: -0.2 });
  D.drawCard(g, cx - 2 + sw, cy - 22, 36, 52, res && res.dealer, { flip: S.last ? 1 : 0, rot: 0.2 });
}

module.exports = { key: 'duel', title: 'Duel de cartes', theme, build, emblem };
