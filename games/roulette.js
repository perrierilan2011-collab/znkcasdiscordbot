'use strict';
const D = require('./draw');

const CELL_W = 58;
const CELL_H = 84;
const PITCH = 66;
const STEPS = [8, 7, 6, 5, 4, 3, 2, 1, 1]; // 37 crans = un tour complet

const theme = { c0: '#3A0E3E', c1: '#12041F', rim: 'rgba(253,230,138,0.85)', spot: 'rgba(253,230,138,0.18)', pattern: 'lines' };

function numColor(n, reds) {
  if (n === 0) return ['#047857', '#34D399'];
  return reds.has(n) ? ['#9F1239', '#FB7185'] : ['#150B2B', '#7C5CE0'];
}
const colorName = (n, reds) => (n === 0 ? 'VERT' : reds.has(n) ? 'ROUGE' : 'NOIR');

// bande de cases façon « cylindre » : les cases s'écrasent et s'assombrissent vers les bords
function drawStrip(g, cx, cy, order, pos, reds, blur, hot) {
  const N = order.length;
  for (let d = -6; d <= 6; d++) {
    const i = (((Math.round(pos) + d) % N) + N) % N;
    const num = order[i];
    const t = Math.min(1, Math.abs(d) / 6);
    const sc = Math.cos(t * 1.05);
    const x = cx + Math.sign(d) * Math.sin(t * 1.05) * 6 * PITCH * 0.98;
    const wv = CELL_W * sc;
    const hv = CELL_H * (0.62 + 0.38 * sc);
    const [c0, c1] = numColor(num, reds);
    const centre = d === 0;
    g.save();
    g.globalAlpha = Math.max(0.25, sc) * (blur && !centre ? 0.9 : 1);
    D.rr(g, x - wv / 2, cy - hv / 2, wv, hv, 10 * sc);
    const gr = g.createLinearGradient(0, cy - hv / 2, 0, cy + hv / 2);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c0);
    g.fillStyle = gr;
    if (centre && hot) {
      g.shadowColor = hot;
      g.shadowBlur = 20;
    }
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = centre ? 2 : 1.2;
    g.strokeStyle = 'rgba(233,213,255,0.6)';
    g.stroke();
    D.rr(g, x - wv / 2 + 2, cy - hv / 2 + 2, wv - 4, hv * 0.34, 8 * sc);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fill();
    g.restore();
    D.text(g, num, x, cy + 1, { size: 15 + 13 * sc, alpha: Math.max(0.3, sc) });
    if (blur && !centre) {
      g.save();
      g.globalAlpha = 0.5 * sc;
      for (let s = 1; s <= 3; s++) {
        g.fillStyle = `rgba(192,132,252,${0.13 / s})`;
        g.fillRect(x - wv / 2 - s * 7, cy - hv / 2, 7, hv);
      }
      g.restore();
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
        // rail lumineux
        D.floorGlow(g, cx, cy + CELL_H / 2 + 8, 300, 20, 'rgba(253,230,138,0.22)');
        g.save();
        g.beginPath();
        g.rect(116, 0, w - 232, h);
        g.clip();
        drawStrip(g, cx, cy, order, p0, reds, fast, last ? S.accent || '#FDE68A' : null);
        g.restore();
        // cadre du numéro central + repères
        g.save();
        D.rr(g, cx - CELL_W / 2 - 5, cy - CELL_H / 2 - 5, CELL_W + 10, CELL_H + 10, 13);
        g.lineWidth = 3;
        const hl = last ? S.accent || '#FDE68A' : '#FDE68A';
        g.strokeStyle = hl;
        g.shadowColor = hl;
        g.shadowBlur = 16;
        g.stroke();
        g.restore();
        for (const dir of [-1, 1]) {
          g.fillStyle = '#FDE68A';
          g.shadowColor = '#FDE68A';
          g.shadowBlur = 10;
          g.beginPath();
          const py = dir < 0 ? cy - CELL_H / 2 - 8 : cy + CELL_H / 2 + 8;
          g.moveTo(cx, py);
          g.lineTo(cx - 8, py + dir * -13);
          g.lineTo(cx + 8, py + dir * -13);
          g.fill();
          g.shadowBlur = 0;
        }
        // infos
        D.hud(g, 12, (h - 52) / 2, 96, 52, 'Ton pari', String(ctx.pickLabel || '-').slice(0, 11), { size: 13 });
        D.hud(g, w - 108, (h - 52) / 2, 96, 52, 'Numéro', last ? `${result} ${colorName(result, reds)}` : '?', {
          size: 13,
          color: last ? S.accent || '#fff' : 'rgba(233,213,255,0.6)',
          line: last ? S.accent || undefined : undefined,
          glow: last ? S.accent : undefined,
        });
        D.bulbs(g, 130, w - 130, 9, 22, k);
        D.bulbs(g, 130, w - 130, h - 9, 22, k + 1);
      },
    };
  });
  return { frames, emblem: null };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
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
  const ba = S.last ? -0.9 : -rot * 1.7;
  g.beginPath();
  g.arc(Math.cos(ba) * 28, Math.sin(ba) * 28, 3.6, 0, D.TAU);
  g.fillStyle = '#FFFFFF';
  g.shadowColor = '#fff';
  g.shadowBlur = 6;
  g.fill();
}

module.exports = { key: 'roulette', title: 'Roulette', theme, build, emblem };
