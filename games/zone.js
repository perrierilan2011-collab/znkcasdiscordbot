'use strict';
const D = require('./draw');

const BOX = 62;
const GAP = 7;
const ZONES = { low: [1, 3, 'BAS 1-3'], mid: [4, 7, 'MILIEU 4-7'], high: [8, 10, 'HAUT 8-10'] };
const zoneOf = (n) => (n <= 3 ? 'low' : n <= 7 ? 'mid' : 'high');
const COL = { low: ['#6D3FE8', '#3B1B9C'], mid: ['#C026D3', '#7E1189'], high: ['#F0457F', '#A01450'] };

const theme = { c0: '#2D0F5E', c1: '#0C0324', rim: 'rgba(240,171,252,0.85)', spot: 'rgba(240,171,252,0.22)', pattern: 'diamond' };

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
        const gw = 10 * BOX + 9 * GAP;
        const x0 = (w - gw) / 2;
        const y = 54;
        const th = 62;
        const prev = k > 0 ? seq[k - 1] : null;
        // bille + trajectoire en arc
        const bx = x0 + (cell - 1) * (BOX + GAP) + BOX / 2;
        if (prev && !last) {
          const px = x0 + (prev - 1) * (BOX + GAP) + BOX / 2;
          g.save();
          g.setLineDash([3, 5]);
          g.strokeStyle = 'rgba(255,255,255,0.35)';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(px, y - 6);
          g.quadraticCurveTo((px + bx) / 2, y - 46, bx, y - 6);
          g.stroke();
          g.restore();
        }
        for (let v = 1; v <= 10; v++) {
          const x = x0 + (v - 1) * (BOX + GAP);
          const on = v === cell;
          const inPick = v >= ZONES[pick][0] && v <= ZONES[pick][1];
          const [c0, c1] = COL[zoneOf(v)];
          g.save();
          const grow = on ? 6 : 0;
          D.rr(g, x - grow / 2, y - grow, BOX + grow, th + grow, 11);
          const gr = g.createLinearGradient(0, y, 0, y + th);
          if (on && last) {
            gr.addColorStop(0, win ? '#4ADE80' : '#FB7185');
            gr.addColorStop(1, win ? '#15803D' : '#9F1239');
          } else if (on) {
            gr.addColorStop(0, '#F5D0FE');
            gr.addColorStop(1, '#C026D3');
          } else {
            gr.addColorStop(0, c0);
            gr.addColorStop(1, c1);
          }
          g.fillStyle = gr;
          g.globalAlpha = on ? 1 : last ? 0.45 : 0.85;
          if (on) {
            g.shadowColor = last ? S.accent || '#F0ABFC' : '#F0ABFC';
            g.shadowBlur = 24;
          }
          g.fill();
          g.shadowBlur = 0;
          g.globalAlpha = 1;
          g.lineWidth = on ? 2.6 : 1.2;
          g.strokeStyle = on ? '#FFFFFF' : inPick ? 'rgba(253,230,138,0.9)' : 'rgba(233,213,255,0.3)';
          g.stroke();
          D.rr(g, x + 3, y + 3, BOX - 6, th * 0.34, 8);
          g.fillStyle = 'rgba(255,255,255,0.14)';
          g.fill();
          g.restore();
          D.text(g, v, x + BOX / 2, y + th / 2 + 1, { size: on ? 28 : 22, color: on ? '#fff' : 'rgba(255,255,255,0.9)' });
        }
        // bille
        const by = last ? y - 8 : y - 14;
        g.save();
        g.shadowColor = '#FFFFFF';
        g.shadowBlur = 14;
        const bg = g.createRadialGradient(bx - 3, by - 3, 1, bx, by, 10);
        bg.addColorStop(0, '#FFFFFF');
        bg.addColorStop(1, '#C4B5FD');
        g.fillStyle = bg;
        g.beginPath();
        g.arc(bx, by, 9, 0, D.TAU);
        g.fill();
        g.restore();
        // barre de zones
        for (const key of Object.keys(ZONES)) {
          const [a, b, label] = ZONES[key];
          const xa = x0 + (a - 1) * (BOX + GAP);
          const xb = x0 + b * (BOX + GAP) - GAP;
          const chosen = key === pick;
          g.save();
          D.rr(g, xa, 128, xb - xa, 26, 13);
          g.fillStyle = chosen ? 'rgba(253,230,138,0.22)' : 'rgba(168,85,247,0.14)';
          g.fill();
          g.lineWidth = chosen ? 2 : 1;
          g.strokeStyle = chosen ? '#FDE68A' : 'rgba(192,132,252,0.4)';
          if (chosen) {
            g.shadowColor = '#FDE68A';
            g.shadowBlur = 8;
          }
          g.stroke();
          g.restore();
          D.text(g, label + (chosen ? '  ·  TON CHOIX' : ''), (xa + xb) / 2, 141.5, { size: 10.5, color: chosen ? '#FDE68A' : 'rgba(233,213,255,0.75)' });
        }
        D.text(g, 'ZONE', w / 2, 15, { size: 10, color: 'rgba(233,213,255,0.55)' });
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

module.exports = { key: 'zone', title: 'Zone', theme, build, emblem };
