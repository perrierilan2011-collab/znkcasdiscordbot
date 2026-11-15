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


// ---------- GIF : la bille est lâchée, saute de case en case en ralentissant, puis se pose sur le nombre tiré ----------
function gif(res, ctx) {
  const n10 = res.n;
  const pick = ZONES[ctx.choice] ? ctx.choice : 'mid';
  const win = ctx.outcome === 'win';
  const GREEN = '#4ADE80';
  const RED = '#FB7185';

  // trajet déterministe (le GIF peut être rendu deux fois) : 8 sauts, le dernier atterrit sur n10
  const rnd = D.mulberry(n10 * 7919 + 101);
  const cells = [];
  let cur = ((n10 + 4) % 10) + 1;
  for (let k = 0; k < 7; k++) {
    let nx;
    do nx = 1 + Math.floor(rnd() * 10);
    while (nx === cur || (k === 6 && nx === n10));
    cells.push(nx);
    cur = nx;
  }
  cells.push(n10);
  const HOPS = cells.length;
  const T0 = 0.1; // chute initiale
  const T1 = 0.9; // fin du dernier saut
  // durées croissantes : la bille ralentit
  const w8 = cells.map((_, k) => 1 + k * 0.28);
  const sum = w8.reduce((a, b) => a + b, 0);
  const starts = [];
  let acc = T0;
  for (let k = 0; k < HOPS; k++) {
    starts.push(acc);
    acc += ((T1 - T0) * w8[k]) / sum;
  }
  const ends = starts.map((s, k) => (k + 1 < HOPS ? starts[k + 1] : T1));

  const gw = 10 * BOX + 9 * GAP;
  const cellX = (v, w) => (w - gw) / 2 + (v - 1) * (BOX + GAP) + BOX / 2;
  const Y = 54;
  const TH = 62;

  return {
    dur: 4.6,
    hold: 200,
    cap: (t) =>
      t < T0 ? 'La bille est lancée' :
      t < 0.4 ? 'Elle rebondit...' :
      t < 0.66 ? 'Elle saute de case en case' :
      t < 0.82 ? 'Elle ralentit' :
      t < T1 ? 'Dernier rebond...' :
      `Le nombre tiré est ${n10}`,
    draw(S, t) {
      const { g, w, h } = S;
      const settled = t >= T1;

      // position de la bille + case actuellement « touchée »
      let bx;
      let by;
      let squash = 1;
      let hopIdx = -1;
      let u = 0;
      if (t < T0) {
        const k0 = D.clamp(t / T0);
        bx = cellX(((n10 + 4) % 10) + 1, w);
        by = Y - 14 - 120 * (1 - k0 * k0);
      } else if (!settled) {
        hopIdx = starts.findIndex((s, k) => t >= s && t < ends[k]);
        if (hopIdx < 0) hopIdx = HOPS - 1;
        u = D.clamp((t - starts[hopIdx]) / (ends[hopIdx] - starts[hopIdx]));
        const from = hopIdx === 0 ? ((n10 + 4) % 10) + 1 : cells[hopIdx - 1];
        const to = cells[hopIdx];
        const fx = cellX(from, w);
        const tx = cellX(to, w);
        const ex = u * u * (3 - 2 * u) * 0.35 + u * 0.65; // presque linéaire, léger lissage
        bx = fx + (tx - fx) * ex;
        const arc = 46 - hopIdx * 3.2; // sauts de plus en plus bas
        by = Y - 14 - 4 * arc * u * (1 - u);
        if (u > 0.9) squash = 1 - (u - 0.9) * 2.4;
      } else {
        bx = cellX(n10, w);
        const k1 = D.clamp((t - T1) / 0.06);
        by = Y - 8 - Math.sin(k1 * Math.PI) * 5 * (1 - k1);
      }

      // intensité lumineuse de chaque case (se dissipe après chaque contact)
      const glowOf = (v) => {
        let best = 0;
        for (let k = 0; k < HOPS; k++) {
          if (cells[k] !== v) continue;
          const tl = ends[k];
          if (t >= tl) best = Math.max(best, Math.exp(-(t - tl) * 14));
        }
        return best;
      };

      // trajectoire en pointillés du saut en cours
      if (hopIdx >= 0 && !settled) {
        const from = hopIdx === 0 ? ((n10 + 4) % 10) + 1 : cells[hopIdx - 1];
        const px = cellX(from, w);
        const tx = cellX(cells[hopIdx], w);
        g.save();
        g.setLineDash([3, 5]);
        g.strokeStyle = 'rgba(255,255,255,0.3)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(px, Y - 6);
        g.quadraticCurveTo((px + tx) / 2, Y - 6 - 2 * (46 - hopIdx * 3.2), tx, Y - 6);
        g.stroke();
        g.restore();
      }

      for (let v = 1; v <= 10; v++) {
        const x = cellX(v, w) - BOX / 2;
        const gl = settled ? (v === n10 ? 1 : 0) : glowOf(v);
        const on = gl > 0.04;
        const inPick = v >= ZONES[pick][0] && v <= ZONES[pick][1];
        const [c0, c1] = COL[zoneOf(v)];
        g.save();
        const grow = 6 * gl;
        D.rr(g, x - grow / 2, Y - grow + 4 * gl, BOX + grow, TH + grow, 11);
        const gr = g.createLinearGradient(0, Y, 0, Y + TH);
        if (settled && v === n10) {
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
        g.globalAlpha = on ? 1 : settled ? 0.45 : 0.85;
        if (on) {
          g.shadowColor = settled ? (win ? GREEN : RED) : '#F0ABFC';
          g.shadowBlur = 24 * gl;
        }
        g.fill();
        g.shadowBlur = 0;
        g.globalAlpha = 1;
        g.lineWidth = on ? 2.6 : 1.2;
        g.strokeStyle = on ? '#FFFFFF' : inPick ? 'rgba(253,230,138,0.9)' : 'rgba(233,213,255,0.3)';
        g.stroke();
        D.rr(g, x + 3, Y + 3, BOX - 6, TH * 0.34, 8);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fill();
        g.restore();
        D.text(g, v, x + BOX / 2, Y + TH / 2 + 1, { size: on ? 28 : 22, color: on ? '#fff' : 'rgba(255,255,255,0.9)' });
      }

      // ombre + bille (écrasée à l'impact)
      const shadowA = 0.45 - D.clamp((Y - 14 - by) / 110) * 0.3;
      g.fillStyle = `rgba(0,0,0,${Math.max(0.1, shadowA)})`;
      g.beginPath();
      g.ellipse(bx, Y + 4, 11 * (1 - D.clamp((Y - 14 - by) / 140) * 0.4), 3.2, 0, 0, D.TAU);
      g.fill();
      g.save();
      g.translate(bx, by);
      g.scale(1 + (1 - squash) * 0.6, squash);
      g.shadowColor = '#FFFFFF';
      g.shadowBlur = 14;
      const bg = g.createRadialGradient(-3, -3, 1, 0, 0, 10);
      bg.addColorStop(0, '#FFFFFF');
      bg.addColorStop(1, '#C4B5FD');
      g.fillStyle = bg;
      g.beginPath();
      g.arc(0, 0, 9, 0, D.TAU);
      g.fill();
      g.restore();

      // petites étincelles à chaque contact
      if (!settled && hopIdx > 0 && u < 0.2) {
        const kk = u / 0.2;
        for (let s = 0; s < 4; s++) {
          const an = Math.PI + (s / 3) * Math.PI;
          D.spark(g, bx + Math.cos(an) * (10 + kk * 18), Y + 2 + Math.sin(an) * (6 + kk * 16), 3, '#F5D0FE', 0.9 * (1 - kk));
        }
      }

      // barre de zones
      for (const key of Object.keys(ZONES)) {
        const [a, b, label] = ZONES[key];
        const xa = cellX(a, w) - BOX / 2;
        const xb = cellX(b, w) + BOX / 2;
        const chosen = key === pick;
        const hit = settled && ZONES[key][0] <= n10 && n10 <= ZONES[key][1];
        g.save();
        D.rr(g, xa, 128, xb - xa, 26, 13);
        g.fillStyle = chosen ? 'rgba(253,230,138,0.22)' : 'rgba(168,85,247,0.14)';
        g.fill();
        g.lineWidth = chosen || hit ? 2 : 1;
        g.strokeStyle = hit ? (win ? GREEN : RED) : chosen ? '#FDE68A' : 'rgba(192,132,252,0.4)';
        if (chosen || hit) {
          g.shadowColor = hit ? (win ? GREEN : RED) : '#FDE68A';
          g.shadowBlur = 8;
        }
        g.stroke();
        g.restore();
        D.text(g, label + (chosen ? '  ·  TON CHOIX' : ''), (xa + xb) / 2, 141.5, { size: 10.5, color: chosen ? '#FDE68A' : 'rgba(233,213,255,0.75)' });
      }
      D.text(g, 'ZONE', w / 2, 15, { size: 10, color: 'rgba(233,213,255,0.55)' });
    },
  };
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

module.exports = { key: 'zone', title: 'Zone', theme, build, gif, emblem };
