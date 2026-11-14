'use strict';
const D = require('./draw');

const CW = 56;
const CH = 80;

function build(res, ctx) {
  const win = ctx.outcome === 'win';
  const tie = res.me.v === res.dealer.v;
  // flip du joueur / du croupier à chaque frame
  const plan = [
    { me: 0, dl: 0, cap: 'Les cartes sont distribuées' },
    { me: 0.34, dl: 0, cap: 'Tu retournes ta carte...' },
    { me: 1, dl: 0, cap: `Ta carte : ${res.me.r}` },
    { me: 1, dl: 0.34, cap: 'Le croupier retourne la sienne...' },
    { me: 1, dl: 1, cap: `Croupier : ${res.dealer.r}` },
    { me: 1, dl: 1, hl: true, cap: win ? 'Tu gagnes le duel !' : tie ? 'Égalité : le croupier gagne' : 'Le croupier l\'emporte' },
  ];
  const n = plan.length;
  const frames = plan.map((f, k) => ({
    cap: f.cap,
    ms: k === n - 1 ? 1300 : 850,
    draw(S) {
      const { g, w, h, cx } = S;
      const y = (h - CH) / 2;
      const xm = cx - 92 - CW / 2;
      const xd = cx + 92 - CW / 2;
      const meGlow = f.hl && win ? S.accent || '#86EFAC' : null;
      const dlGlow = f.hl && !win ? '#FCA5A5' : null;
      D.drawCard(g, xm, y, CW, CH, res.me, { flip: f.me, glow: meGlow, alpha: f.hl && !win ? 0.55 : 1, rot: f.me > 0 && f.me < 1 ? -0.05 : 0 });
      D.drawCard(g, xd, y, CW, CH, res.dealer, { flip: f.dl, glow: dlGlow, alpha: f.hl && win ? 0.55 : 1 });
      D.text(g, 'VS', cx, h / 2, { size: 26, color: '#F0ABFC', glow: '#C026D3' });
      D.text(g, 'TOI', xm - 56, h / 2 - 8, { size: 20 });
      D.text(g, f.me >= 0.5 ? res.me.r : '?', xm - 56, h / 2 + 18, { size: 16, color: 'rgba(233,213,255,0.8)' });
      D.text(g, 'CROUPIER', xd + CW + 66, h / 2 - 8, { size: 18 });
      D.text(g, f.dl >= 0.5 ? res.dealer.r : '?', xd + CW + 66, h / 2 + 18, { size: 16, color: 'rgba(233,213,255,0.8)' });
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

module.exports = { key: 'duel', title: 'Duel de cartes', build, emblem };
