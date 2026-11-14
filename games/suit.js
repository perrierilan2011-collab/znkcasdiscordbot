'use strict';
const D = require('./draw');

const NAMES = { S: 'PIQUE', H: 'COEUR', D: 'CARREAU', C: 'TREFLE' };
const CHOICE = { s: 'S', h: 'H', d: 'D', c: 'C' };
const CW = 60;
const CH = 84;

function suitTile(g, x, y, s, suit, o = {}) {
  g.save();
  D.rr(g, x, y, s, s, 10);
  g.fillStyle = o.fill || 'rgba(168,85,247,0.16)';
  g.fill();
  g.lineWidth = o.w || 1.4;
  g.strokeStyle = o.line || 'rgba(192,132,252,0.6)';
  if (o.glow) {
    g.shadowColor = o.glow;
    g.shadowBlur = 14;
  }
  g.stroke();
  g.restore();
  if (suit) D.drawSuit(g, suit, x + s / 2, y + s / 2, s * 0.62, o.color || '#F5D0FE');
  else D.text(g, '?', x + s / 2, y + s / 2, { size: s * 0.5, color: 'rgba(233,213,255,0.5)' });
}

function build(res, ctx) {
  const pick = CHOICE[String(ctx.choice || 's').toLowerCase()] || 'S';
  const drawn = D.suitKey(res.card.s);
  const win = ctx.outcome === 'win';
  const plan = [
    { flip: 0, rot: 0, dx: 0, cap: 'Le croupier bat les cartes' },
    { flip: 0, rot: -0.12, dx: -6, cap: 'Il tire une carte...' },
    { flip: 0, rot: 0.1, dx: 6, cap: 'La carte est posée' },
    { flip: 0.3, rot: 0, dx: 0, cap: 'Elle se retourne...' },
    { flip: 0.72, rot: 0, dx: 0, cap: 'Presque...' },
    { flip: 1, rot: 0, dx: 0, hl: true, cap: `${res.card.r} de ${NAMES[drawn].toLowerCase()}` },
  ];
  const n = plan.length;
  const frames = plan.map((f, k) => ({
    cap: f.cap,
    ms: k === n - 1 ? 1300 : 800,
    draw(S) {
      const { g, w, h, cx } = S;
      const y = (h - CH) / 2;
      D.text(g, 'TON CHOIX', 118, 14, { size: 10.5, color: 'rgba(233,213,255,0.75)' });
      suitTile(g, 90, 24, 56, pick, { color: '#F5D0FE', glow: f.hl ? (win ? S.accent : null) : null });
      D.text(g, NAMES[pick], 118, 90, { size: 10, color: 'rgba(233,213,255,0.7)' });
      D.drawCard(g, cx - CW / 2 + f.dx, y, CW, CH, res.card, { flip: f.flip, rot: f.rot, glow: f.hl ? S.accent : null });
      D.text(g, 'RÉSULTAT', w - 118, 14, { size: 10.5, color: 'rgba(233,213,255,0.75)' });
      suitTile(g, w - 146, 24, 56, f.flip >= 0.5 ? drawn : null, {
        color: f.flip >= 0.5 ? (D.isRed(drawn) ? '#FDA4AF' : '#E9D5FF') : '#fff',
        line: f.hl ? S.accent || undefined : undefined,
        glow: f.hl ? S.accent : null,
      });
      D.text(g, f.flip >= 0.5 ? NAMES[drawn] : '?', w - 118, 90, { size: 10, color: 'rgba(233,213,255,0.7)' });
    },
  }));
  return { frames };
}

function emblem(S, cx, cy) {
  const order = ['S', 'H', 'D', 'C'];
  const suit = S.last ? D.suitKey(S.res.card.s) : order[S.k % 4];
  D.drawSuit(S.g, suit, cx, cy, 58, D.isRed(suit) ? '#FDA4AF' : '#E9D5FF');
}

module.exports = { key: 'suit', title: 'Enseigne', build, emblem };
