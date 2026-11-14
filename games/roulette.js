'use strict';
const D = require('./draw');

const CELL_W = 48;
const CELL_H = 58;
const PITCH = 54;
const STEPS = [8, 7, 6, 5, 4, 3, 2, 1, 1]; // 37 crans = un tour complet

function numColor(n, reds) {
  if (n === 0) return ['#059669', '#34D399'];
  return reds.has(n) ? ['#BE123C', '#FB7185'] : ['#1B1233', '#8B5CF6'];
}
const colorName = (n, reds) => (n === 0 ? 'VERT' : reds.has(n) ? 'ROUGE' : 'NOIR');

function drawStrip(g, cx, cy, order, pos, reds, blur) {
  const N = order.length;
  for (let d = -7; d <= 7; d++) {
    const i = (((Math.round(pos) + d) % N) + N) % N;
    const num = order[i];
    const x = cx + d * PITCH;
    const near = Math.abs(d) <= 1 ? 1 : 1 - Math.min(1, (Math.abs(d) - 1) * 0.14);
    const [c0, c1] = numColor(num, reds);
    g.save();
    g.globalAlpha = Math.max(0.2, near) * (blur ? 0.85 : 1);
    D.rr(g, x - CELL_W / 2, cy - CELL_H / 2, CELL_W, CELL_H, 9);
    const gr = g.createLinearGradient(0, cy - CELL_H / 2, 0, cy + CELL_H / 2);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c0);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 1.3;
    g.strokeStyle = 'rgba(233,213,255,0.55)';
    g.stroke();
    g.restore();
    D.text(g, num, x, cy + 1, { size: 21, alpha: Math.max(0.25, near) });
    if (blur) {
      g.fillStyle = 'rgba(192,132,252,0.12)';
      g.fillRect(x - CELL_W / 2 - 8, cy - CELL_H / 2, 8, CELL_H);
    }
  }
}

function build(res, ctx) {
  const data = ctx.data || {};
  const order = data.order || [];
  const reds = new Set(data.reds || []);
  const result = data.result;
  const finalIdx = order.indexOf(result);
  const pos = [finalIdx - STEPS.reduce((a, b) => a + b, 0)];
  STEPS.forEach((s) => pos.push(pos[pos.length - 1] + s));
  const caps = [
    'La bille est lancée',
    'La roue prend de la vitesse',
    'Pleine vitesse',
    'La bille tourne...',
    'Elle commence à ralentir',
    'Elle saute de case en case',
    'Presque arrêtée',
    'Dernier saut...',
    'Elle hésite...',
    '',
  ];
  const n = pos.length;
  const frames = pos.map((p0, k) => {
    const last = k === n - 1;
    const fast = k <= 3;
    return {
      cap: last ? `Le ${result} ${colorName(result, reds).toLowerCase()}` : caps[k],
      ms: last ? 1300 : 650 + k * 110,
      draw(S) {
        const { g, w, h, cx } = S;
        const cy = h / 2 + 4;
        g.save();
        g.beginPath();
        g.rect(150, 0, w - 300, h);
        g.clip();
        drawStrip(g, cx, cy, order, p0, reds, fast);
        g.restore();
        // cadre du numéro central + repère
        g.save();
        D.rr(g, cx - CELL_W / 2 - 4, cy - CELL_H / 2 - 4, CELL_W + 8, CELL_H + 8, 12);
        g.lineWidth = 2.6;
        g.strokeStyle = last ? S.accent || '#FDE68A' : '#FDE68A';
        g.shadowColor = last ? S.accent || '#FDE68A' : '#FDE68A';
        g.shadowBlur = 14;
        g.stroke();
        g.restore();
        g.fillStyle = '#FDE68A';
        g.beginPath();
        g.moveTo(cx, cy - CELL_H / 2 - 5);
        g.lineTo(cx - 7, cy - CELL_H / 2 - 16);
        g.lineTo(cx + 7, cy - CELL_H / 2 - 16);
        g.fill();
        // fondu sur les bords
        for (const [x0, x1] of [[150, 215], [w - 150, w - 215]]) {
          const fg = g.createLinearGradient(x0, 0, x1, 0);
          fg.addColorStop(0, 'rgba(10,2,26,1)');
          fg.addColorStop(1, 'rgba(10,2,26,0)');
          g.fillStyle = fg;
          g.fillRect(Math.min(x0, x1), 0, 65, h);
        }
        D.chip(g, 14, (h - 42) / 2, 126, 42, 'Ton pari', ctx.pickLabel || '-');
        D.chip(g, w - 140, (h - 42) / 2, 126, 42, 'Numéro', last ? `${result} ${colorName(result, reds)}` : '?', {
          color: last ? S.accent || '#fff' : 'rgba(233,213,255,0.6)',
          line: last ? S.accent || undefined : undefined,
        });
      },
    };
  });
  return { frames, emblem: null };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  const data = S.data || {};
  const reds = new Set(data.reds || []);
  const order = data.order || [];
  const rot = S.last ? 0 : (1 - p) * 7;
  g.save();
  g.rotate(rot);
  const N = 24;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * D.TAU;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 36, a, a + D.TAU / N);
    g.fillStyle = i === 0 ? '#34D399' : i % 2 ? '#BE123C' : '#1B1233';
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, 14, 0, D.TAU);
  g.fillStyle = '#E9D5FF';
  g.fill();
  g.restore();
  // bille
  const ba = S.last ? -0.9 : -rot * 1.7;
  g.beginPath();
  g.arc(Math.cos(ba) * 28, Math.sin(ba) * 28, 3.6, 0, D.TAU);
  g.fillStyle = '#FFFFFF';
  g.shadowColor = '#fff';
  g.shadowBlur = 6;
  g.fill();
  void reds;
  void order;
}

module.exports = { key: 'roulette', title: 'Roulette', build, emblem };
