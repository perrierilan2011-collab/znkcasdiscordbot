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


// ---------- GIF : battage, puis les cartes glissent du sabot jusqu'à leur place ----------
const SHUFFLE_S = 1.1; // durée du battage (secondes)
const DEAL_S = 0.95; // durée de chaque carte (secondes)

function felt(g, w, h, cx) {
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
  D.text(g, 'BLACKJACK PAIE 3 POUR 2', cx, 80, { size: 9, color: 'rgba(253,230,138,0.7)' }); // sous le sabot
}

// dessine une main en train de se compléter ; renvoie les cartes en vol (dessinées par-dessus)
function dealtHand(g, cards, hidden, prevCards, prevHidden, cx, y, f, shoe) {
  const count = cards.length + (hidden ? 1 : 0);
  const prevCount = prevCards.length + (prevHidden ? 1 : 0);
  if (!count) {
    hand(g, [], false, cx, y, 0); // emplacement vide en pointillés
    return [];
  }
  const flying = [];
  for (let i = 0; i < count; i++) {
    const faceUp = i < cards.length;
    const card = faceUp ? cards[i] : null;
    const tx = handX(count, cx) + i * FAN;
    if (i < prevCount) {
      const px = handX(prevCount, cx) + i * FAN;
      D.drawCard(g, D.lerp(px, tx, f), y, CW, CH, card, { flip: faceUp ? 1 : 0 });
    } else {
      flying.push({ i, faceUp, card, tx });
    }
  }
  return flying.map((c) => () => {
    const e = f;
    const x = D.lerp(shoe.x, c.tx, e);
    const yy = D.lerp(shoe.y, y, e) - Math.sin(e * Math.PI) * 16;
    const wv = D.lerp(40, CW, e);
    const hv = D.lerp(56, CH, e);
    D.drawCard(g, x, yy, wv, hv, c.card, {
      flip: c.faceUp ? D.ease((f - 0.3) / 0.5) : 0,
      rot: (1 - e) * 0.45,
      glow: f >= 1 ? 'rgba(253,230,138,0.9)' : null,
    });
  });
}

function gif(res, ctx) {
  const steps = (ctx.data && ctx.data.steps) || [];
  const n = steps.length;
  const dur = SHUFFLE_S + Math.max(0, n - 1) * DEAL_S + 0.35;
  const at = (t) => {
    const T = Math.min(t, 1) * dur;
    if (T < SHUFFLE_S || n < 2) return { k: 0, u: Math.min(1, T / SHUFFLE_S) };
    const k = 1 + Math.min(n - 2, Math.floor((T - SHUFFLE_S) / DEAL_S));
    const u = Math.min(1, (T - SHUFFLE_S - (k - 1) * DEAL_S) / DEAL_S);
    return { k, u };
  };
  return {
    dur,
    cap: (t) => (steps[at(t).k] || {}).cap || '',
    draw(S, t) {
      const { g, w, h, cx } = S;
      const { k, u } = at(t);
      const s = steps[k] || { p: [], d: [], hidden: false };
      const prev = steps[k - 1] || { p: [], d: [], hidden: false };
      const c1 = w * 0.27;
      const c2 = w * 0.73;
      const y = 48;
      const shoe = { x: cx - 20, y: 6 };
      felt(g, w, h, cx);

      // sabot (pile de cartes dos visible)
      for (let j = 2; j >= 0; j--) D.drawCard(g, shoe.x, shoe.y - j * 2, 40, 56, null, { flip: 0 });

      // battage au début
      if (k === 0) {
        const amp = Math.sin(Math.min(1, u) * Math.PI);
        for (let j = 0; j < 6; j++) {
          const off = Math.sin(u * 26 + j * 1.7) * 22 * amp;
          D.drawCard(g, shoe.x + off, shoe.y + 2 + j * 1.5 - amp * 6, 40, 56, null, { flip: 0, rot: Math.sin(u * 20 + j) * 0.12 * amp });
        }
      }

      const f = k === 0 ? 1 : D.ease(Math.min(1, u / 0.7));
      const settled = k === 0 || f >= 0.85;
      const pv = k === 0 || settled ? s.pv : prev.pv;
      const dv = k === 0 || settled ? s.dv : prev.dv;
      total(g, c1, 28, 'CROUPIER', k > 0 && !settled ? prev.dv : dv, k > 0 && !settled ? prev.hidden : s.hidden);
      total(g, c2, 28, 'TOI', pv, false);

      const flyD = dealtHand(g, s.d, s.hidden, k === 0 ? s.d : prev.d, k === 0 ? s.hidden : prev.hidden, c1, y, f, shoe);
      const flyP = dealtHand(g, s.p, false, k === 0 ? s.p : prev.p, false, c2, y, f, shoe);
      [...flyD, ...flyP].forEach((draw) => draw());

      D.tokenStack(g, cx, h - 34, 11, 3, '#A855F7');
      D.tokenStack(g, cx - 26, h - 30, 9, 2, '#F43F5E');
      D.tokenStack(g, cx + 26, h - 30, 9, 2, '#22D3EE');
    },
  };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  const sw = Math.sin(p * Math.PI) * 5;
  D.drawCard(g, cx - 36 - sw, cy - 32, 38, 54, { r: 'A', s: '♠' }, { flip: 1, rot: -0.22 });
  D.drawCard(g, cx - 2 + sw, cy - 26, 38, 54, { r: 'K', s: '♥' }, { flip: 1, rot: 0.2 });
}

module.exports = { key: 'bj', title: 'Blackjack', theme, build, gif, emblem };
