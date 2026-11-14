'use strict';
const D = require('./draw');

const BOX = 52;
const GAP = 6;
const ZONES = { low: [1, 3, 'BAS 1-3'], mid: [4, 7, 'MILIEU 4-7'], high: [8, 10, 'HAUT 8-10'] };
const zoneOf = (n) => (n <= 3 ? 'low' : n <= 7 ? 'mid' : 'high');
const COL = { low: '#7C3AED', mid: '#C026D3', high: '#DB2777' };

function build(res, ctx) {
  const n10 = res.n;
  const pick = ZONES[ctx.choice] ? ctx.choice : 'mid';
  const win = ctx.outcome === 'win';
  const seq = [];
  let cur = (n10 + 4) % 10 || 10;
  const rnd = D.mulberry((Date.now() & 0xffff) + n10);
  for (let k = 0; k < 5; k++) {
    let nx;
    do nx = 1 + Math.floor(rnd() * 10);
    while (nx === cur || (k === 4 && nx === n10));
    seq.push(nx);
    cur = nx;
  }
  seq.push(n10);
  const caps = ['La bille est lancée', 'Elle rebondit...', 'Elle saute de case en case', 'Elle ralentit', 'Dernier rebond...', ''];
  const n = seq.length;
  const frames = seq.map((cell, k) => {
    const last = k === n - 1;
    return {
      cap: last ? `Le nombre tiré est ${n10}` : caps[k],
      ms: last ? 1300 : 750,
      draw(S) {
        const { g, w, h } = S;
        const x0 = (w - (10 * BOX + 9 * GAP)) / 2;
        const y = 18;
        for (let v = 1; v <= 10; v++) {
          const x = x0 + (v - 1) * (BOX + GAP);
          const on = v === cell;
          const inPick = v >= ZONES[pick][0] && v <= ZONES[pick][1];
          g.save();
          const grow = on ? 4 : 0;
          D.rr(g, x - grow / 2, y - grow, BOX + grow, 46 + grow, 10);
          g.fillStyle = on ? (last ? (win ? '#16A34A' : '#BE123C') : '#D946EF') : COL[zoneOf(v)];
          g.globalAlpha = on ? 1 : last ? 0.4 : 0.7;
          if (on) {
            g.shadowColor = last ? S.accent || '#F0ABFC' : '#F0ABFC';
            g.shadowBlur = 20;
          }
          g.fill();
          g.shadowBlur = 0;
          g.globalAlpha = 1;
          g.lineWidth = on ? 2.4 : 1.2;
          g.strokeStyle = on ? '#FFFFFF' : inPick ? 'rgba(253,230,138,0.85)' : 'rgba(233,213,255,0.3)';
          g.stroke();
          g.restore();
          D.text(g, v, x + BOX / 2, y + 23, { size: on ? 24 : 19, color: on ? '#fff' : 'rgba(255,255,255,0.88)' });
        }
        // barre de zones
        for (const key of Object.keys(ZONES)) {
          const [a, b, label] = ZONES[key];
          const xa = x0 + (a - 1) * (BOX + GAP);
          const xb = x0 + b * (BOX + GAP) - GAP;
          const chosen = key === pick;
          g.save();
          D.rr(g, xa, 74, xb - xa, 16, 8);
          g.fillStyle = chosen ? 'rgba(253,230,138,0.22)' : 'rgba(168,85,247,0.14)';
          g.fill();
          g.lineWidth = chosen ? 1.8 : 1;
          g.strokeStyle = chosen ? '#FDE68A' : 'rgba(192,132,252,0.4)';
          g.stroke();
          g.restore();
          D.text(g, label + (chosen ? '  ·  TON CHOIX' : ''), (xa + xb) / 2, 82.5, { size: 9.5, color: chosen ? '#FDE68A' : 'rgba(233,213,255,0.7)' });
        }
      },
    };
  });
  return { frames };
}

function emblem(S, cx, cy) {
  const { g } = S;
  const pulse = S.last ? 1 : 0.8 + 0.2 * Math.sin(S.p * 12);
  for (const [r, c] of [[34, '#7C3AED'], [24, '#E9D5FF'], [14, '#C026D3'], [5, '#fff']]) {
    g.beginPath();
    g.arc(cx, cy, r * pulse, 0, D.TAU);
    g.fillStyle = c;
    g.fill();
  }
}

module.exports = { key: 'zone', title: 'Zone', build, emblem };
