'use strict';
const D = require('./draw');

const CW = 44;
const CH = 62;
const FAN = 30;

function hand(g, cards, cx, y, hidden) {
  const total = cards.length + (hidden ? 1 : 0);
  if (!total) {
    g.save();
    D.rr(g, cx - CW / 2, y, CW, CH, 6);
    g.setLineDash([4, 4]);
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(233,213,255,0.35)';
    g.stroke();
    g.restore();
    return;
  }
  const x = cx - (CW + (total - 1) * FAN) / 2;
  cards.forEach((c, i) => D.drawCard(g, x + i * FAN, y, CW, CH, c, { flip: 1 }));
  if (hidden) D.drawCard(g, x + cards.length * FAN, y, CW, CH, null, { flip: 0 });
}

function label(g, name, value, cx) {
  D.text(g, name, cx - (value ? 12 : 0), 13, { size: 11, color: 'rgba(233,213,255,0.85)' });
  if (!value) return;
  g.font = D.font(12);
  const tw = g.measureText(name).width / 2 + 4;
  const px = cx - 12 + tw + 4;
  D.rr(g, px, 5, 34, 16, 8);
  g.fillStyle = 'rgba(168,85,247,0.45)';
  g.fill();
  D.text(g, value, px + 17, 13.5, { size: 11.5 });
}

function build(res, ctx) {
  const steps = (ctx.data && ctx.data.steps) || [];
  const frames = steps.map((s, k) => ({
    cap: s.cap,
    ms: s.ms || 850,
    draw(S) {
      const { g, w, h, cx } = S;
      const y = 28;
      const c1 = w / 4;
      const c2 = (w * 3) / 4;
      g.save();
      g.strokeStyle = 'rgba(192,132,252,0.35)';
      g.lineWidth = 1;
      g.setLineDash([3, 5]);
      g.beginPath();
      g.moveTo(cx, 10);
      g.lineTo(cx, h - 10);
      g.stroke();
      g.restore();
      label(g, 'CROUPIER', s.hidden ? (s.dv != null ? `${s.dv}+?` : '?') : s.dv != null ? String(s.dv) : '', c1);
      label(g, 'TOI', s.pv != null ? String(s.pv) : '', c2);
      hand(g, s.d, c1, y, s.hidden);
      hand(g, s.p, c2, y, false);
      void k;
    },
  }));
  return { frames };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  const sw = Math.sin(p * Math.PI) * 5;
  D.drawCard(g, cx - 36 - sw, cy - 32, 38, 54, { r: 'A', s: '♠' }, { flip: 1, rot: -0.22 });
  D.drawCard(g, cx - 2 + sw, cy - 26, 38, 54, { r: 'K', s: '♥' }, { flip: 1, rot: 0.2 });
}

module.exports = { key: 'bj', title: 'Blackjack', build, emblem };
