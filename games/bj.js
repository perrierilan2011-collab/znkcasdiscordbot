'use strict';
const D = require('./draw');

const CW = 70;
const CH = 98;
const FAN = 44;

const theme = { c0: '#0E4A44', c1: '#06201F', rim: 'rgba(110,231,183,0.85)', spot: 'rgba(167,243,208,0.22)', pattern: 'diamond' };

function handX(count, cx) {
  return cx - (CW + (count - 1) * FAN) / 2;
}

function hand(g, cards, hidden, cx, y, newFrom) {
  const total = cards.length + (hidden ? 1 : 0);
  if (!total) {
    g.save();
    D.rr(g, cx - CW / 2, y, CW, CH, 8);
    g.setLineDash([5, 5]);
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.stroke();
    g.restore();
    return;
  }
  const x0 = handX(total, cx);
  cards.forEach((c, i) => {
    const fresh = i >= newFrom;
    D.drawCard(g, x0 + i * FAN, y - (fresh ? 5 : 0), CW, CH, c, {
      flip: 1,
      rot: fresh ? 0.07 : 0,
      glow: fresh ? 'rgba(253,230,138,0.9)' : null,
    });
  });
  if (hidden) D.drawCard(g, x0 + cards.length * FAN, y, CW, CH, null, { flip: 0 });
}

function total(g, cx, y, label, value, hidden) {
  let v = value;
  if (hidden) v = value != null ? `${value}+?` : '?';
  const num = typeof value === 'number' ? value : null;
  const bust = num != null && num > 21;
  const bj = num === 21;
  D.plate(g, cx, y, 150, label, v == null ? '' : String(v), {
    glow: bj ? '#FDE68A' : bust ? '#FB7185' : null,
    line: bj ? '#FDE68A' : bust ? '#FB7185' : undefined,
    badge: bj ? '#CA8A04' : bust ? '#BE123C' : undefined,
  });
}

function build(res, ctx) {
  const steps = (ctx.data && ctx.data.steps) || [];
  const frames = steps.map((s, k) => {
    const prev = steps[k - 1] || { p: [], d: [] };
    return {
      cap: s.cap,
      ms: s.ms || 850,
      draw(S) {
        const { g, w, h, cx } = S;
        const c1 = w * 0.27;
        const c2 = w * 0.73;
        // arc du tapis
        g.save();
        g.strokeStyle = 'rgba(253,230,138,0.32)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.ellipse(cx, -h * 0.55, w * 0.5, h * 1.05, 0, 0.12 * Math.PI, 0.88 * Math.PI);
        g.stroke();
        g.setLineDash([2, 6]);
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.beginPath();
        g.moveTo(cx, 16);
        g.lineTo(cx, h - 16);
        g.stroke();
        g.restore();
        D.text(g, 'BLACKJACK PAIE 3 POUR 2', cx, 20, { size: 10, color: 'rgba(253,230,138,0.7)' });

        total(g, c1, 28, 'CROUPIER', s.dv, s.hidden);
        total(g, c2, 28, 'TOI', s.pv, false);
        const y = 48;
        hand(g, s.d, s.hidden, c1, y, prev.d.length);
        hand(g, s.p, false, c2, y, prev.p.length);

        // mise (jetons) au centre
        D.tokenStack(g, cx, h - 34, 11, 3, '#A855F7');
        D.tokenStack(g, cx - 26, h - 30, 9, 2, '#F43F5E');
        D.tokenStack(g, cx + 26, h - 30, 9, 2, '#22D3EE');
      },
    };
  });
  return { frames };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  const sw = Math.sin(p * Math.PI) * 5;
  D.drawCard(g, cx - 36 - sw, cy - 32, 38, 54, { r: 'A', s: '♠' }, { flip: 1, rot: -0.22 });
  D.drawCard(g, cx - 2 + sw, cy - 26, 38, 54, { r: 'K', s: '♥' }, { flip: 1, rot: 0.2 });
}

module.exports = { key: 'bj', title: 'Blackjack', theme, build, emblem };
