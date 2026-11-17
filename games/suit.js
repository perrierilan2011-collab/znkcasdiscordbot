'use strict';
const D = require('./draw');

const NAMES = { S: 'PIQUE', H: 'COEUR', D: 'CARREAU', C: 'TREFLE' };
const CHOICE = { s: 'S', h: 'H', d: 'D', c: 'C' };
const CW = 82;
const CH = 114;
const ORDER = ['S', 'H', 'D', 'C'];

const theme = { c0: '#13365A', c1: '#060F24', rim: 'rgba(147,197,253,0.85)', spot: 'rgba(191,219,254,0.2)', pattern: 'diamond' };

function tile(g, x, y, s, suit, o = {}) {
  g.save();
  D.rr(g, x, y, s, s, 11);
  const gr = g.createLinearGradient(0, y, 0, y + s);
  gr.addColorStop(0, o.fill0 || 'rgba(88,40,170,0.7)');
  gr.addColorStop(1, o.fill1 || 'rgba(20,6,50,0.85)');
  g.fillStyle = gr;
  if (o.glow) {
    g.shadowColor = o.glow;
    g.shadowBlur = 16;
  }
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = o.w || 1.4;
  g.strokeStyle = o.line || 'rgba(192,132,252,0.55)';
  g.stroke();
  g.restore();
  if (suit) D.drawSuit(g, suit, x + s / 2, y + s / 2, s * 0.6, o.color || (D.isRed(suit) ? '#FDA4AF' : '#E9D5FF'));
  else D.text(g, '?', x + s / 2, y + s / 2, { size: s * 0.5, color: 'rgba(233,213,255,0.5)' });
}

function build(res, ctx) {
  const pick = CHOICE[String(ctx.choice || 's').toLowerCase()] || 'S';
  const drawn = D.suitKey(res.card.s);
  const win = ctx.outcome === 'win';
  const plan = [
    { flip: 0, rot: 0, dx: 0, cap: 'Le croupier bat les cartes' },
    { flip: 0, rot: -0.12, dx: -8, cap: 'Il tire une carte...' },
    { flip: 0, rot: 0.1, dx: 8, cap: 'La carte est posée' },
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
      const y = (h - CH) / 2 + 2;
      // côté gauche : 4 enseignes, la tienne est mise en valeur
      D.text(g, 'TON CHOIX', 100, 16, { size: 10.5, color: 'rgba(233,213,255,0.8)' });
      ORDER.forEach((s, i) => {
        const x = 40 + (i % 2) * 62;
        const yy = 30 + Math.floor(i / 2) * 62;
        const mine = s === pick;
        const hit = f.hl && s === drawn;
        tile(g, x, yy, 54, s, {
          line: mine ? '#FDE68A' : 'rgba(192,132,252,0.35)',
          w: mine ? 2.4 : 1,
          glow: mine ? '#FDE68A' : null,
          fill0: mine ? 'rgba(120,70,10,0.6)' : 'rgba(40,16,90,0.5)',
          color: D.isRed(s) ? '#FDA4AF' : '#E9D5FF',
        });
        void hit;
      });
      // carte centrale
      D.floorGlow(g, cx, y + CH + 2, 100, 14, 'rgba(147,197,253,0.4)');
      D.drawCard(g, cx - CW / 2 + f.dx, y, CW, CH, res.card, { flip: f.flip, rot: f.rot, glow: f.hl ? S.accent : null });
      // côté droit : résultat
      D.text(g, 'RÉSULTAT', w - 100, 16, { size: 10.5, color: 'rgba(233,213,255,0.8)' });
      const shown = f.flip >= 0.5;
      tile(g, w - 154, 30, 108, shown ? drawn : null, {
        line: f.hl ? S.accent || undefined : undefined,
        glow: f.hl ? S.accent : null,
        w: f.hl ? 2.6 : 1.4,
      });
      D.plate(g, w - 100, 152, 100, shown ? NAMES[drawn] : '?', '', { line: f.hl ? S.accent || undefined : undefined, glow: f.hl ? S.accent : undefined });
      void win;
    },
  }));
  return { frames };
}

function emblem(S, cx, cy) {
  const suit = S.last ? D.suitKey(S.res.card.s) : ORDER[S.k % 4];
  D.drawSuit(S.g, suit, cx, cy, 58, D.isRed(suit) ? '#FDA4AF' : '#E9D5FF');
}

module.exports = { key: 'suit', title: 'Enseigne', theme, build, emblem };
