'use strict';
const D = require('./draw');

const SEG_COLOR = { 0: '#241043', 0.5: '#4C1D95', 1.5: '#7E22CE', 2: '#A21CAF', 3: '#DB2777', 10: '#F59E0B' };
const colorOf = (v) => SEG_COLOR[v] || '#6D28D9';
const lab = (v, c) => (v === 0 ? 'x0' : `x${+(v * c).toFixed(2)}`);

function drawWheel(g, cx, cy, R, rot, wheel, coef, hiIdx) {
  const N = wheel.length;
  const seg = D.TAU / N;
  g.save();
  g.translate(cx, cy);
  g.shadowColor = 'rgba(168,85,247,0.9)';
  g.shadowBlur = 16;
  g.beginPath();
  g.arc(0, 0, R + 4, 0, D.TAU);
  g.fillStyle = '#E9D5FF';
  g.fill();
  g.shadowBlur = 0;
  for (let i = 0; i < N; i++) {
    const a = rot + i * seg - seg / 2 - Math.PI / 2;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, R, a, a + seg);
    g.closePath();
    g.fillStyle = colorOf(wheel[i]);
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.stroke();
    if (hiIdx === i) {
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fill();
    }
  }
  for (let i = 0; i < N; i++) {
    const a = rot + i * seg;
    g.save();
    g.rotate(a);
    g.translate(0, -R * 0.8);
    D.text(g, lab(wheel[i], coef), 0, 0, { size: 11.5, color: wheel[i] === 0 ? 'rgba(233,213,255,0.55)' : '#fff' });
    g.restore();
  }
  g.restore();
}

function build(res, ctx) {
  const wheel = (ctx.data && ctx.data.wheel) || [];
  const coef = ctx.coef || 1;
  const idx = res.idx;
  const N = wheel.length || 24;
  const seg = D.TAU / N;
  const extra = [14, 9.4, 5.7, 3.2, 1.5, 0.45, 0];
  const caps = ['La roue est lancée', 'Pleine vitesse', 'Elle tourne...', 'Elle ralentit', 'Les cases défilent', 'Presque arrêtée', ''];
  const n = extra.length;
  const value = res.base * coef;
  const frames = extra.map((e, k) => {
    const last = k === n - 1;
    return {
      cap: last ? (res.base === 0 ? 'La roue s\'arrête sur x0' : `La roue s'arrête sur ${lab(res.base, coef)}`) : caps[k],
      ms: last ? 1300 : 800,
      draw(S) {
        const { g, w, h, cx } = S;
        const R = 124;
        drawWheel(g, cx, 142, R, -idx * seg + e * seg, wheel, coef, last ? idx : -1);
        // pointeur
        g.save();
        g.shadowColor = '#F0ABFC';
        g.shadowBlur = 12;
        g.fillStyle = '#F0ABFC';
        g.beginPath();
        g.moveTo(cx, 25);
        g.lineTo(cx - 9, 4);
        g.lineTo(cx + 9, 4);
        g.closePath();
        g.fill();
        g.restore();
        D.chip(g, 16, 10, 128, 36, 'Roue', '24 cases');
        D.chip(g, w - 144, 10, 128, 36, 'Résultat', last ? (res.base === 0 ? 'x0' : lab(res.base, coef)) : '?', {
          color: last ? S.accent || '#fff' : 'rgba(233,213,255,0.6)',
          line: last ? S.accent || undefined : undefined,
        });
      },
    };
  });
  return { frames };
}

function emblem(S, cx, cy) {
  const wheel = (S.data && S.data.wheel) || new Array(24).fill(0).map((_, i) => (i % 3 ? 0.5 : 2));
  const idx = S.res ? S.res.idx : 0;
  const seg = D.TAU / wheel.length;
  drawWheel(S.g, cx, cy, 36, -idx * seg + (S.last ? 0 : (1 - S.p) * seg * 10), wheel, 1, -1);
  S.g.fillStyle = '#F0ABFC';
  S.g.beginPath();
  S.g.moveTo(cx, cy - 30);
  S.g.lineTo(cx - 6, cy - 44);
  S.g.lineTo(cx + 6, cy - 44);
  S.g.fill();
}

module.exports = { key: 'wheel', title: 'Roue de la fortune', build, emblem };
