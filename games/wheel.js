'use strict';
const D = require('./draw');

const SEG_COLOR = { 0: ['#3A1A63', '#1C0B38'], 0.5: ['#6D3AD8', '#43198C'], 1.5: ['#A63BE8', '#6B1AA8'], 2: ['#D13FCB', '#8A1B85'], 3: ['#F0457F', '#A01450'], 10: ['#FBBF24', '#B45309'] };
const colorOf = (v) => SEG_COLOR[v] || ['#7C4DE8', '#4A1FA0'];
const lab = (v, c) => (v === 0 ? 'x0' : `x${+(v * c).toFixed(2)}`);

const theme = { c0: '#1E0F57', c1: '#07031D', rim: 'rgba(240,171,252,0.85)', spot: 'rgba(240,171,252,0.2)', pattern: 'dots' };

function drawWheel(g, cx, cy, R, rot, wheel, coef, hiIdx, o = {}) {
  const N = wheel.length;
  const seg = D.TAU / N;
  g.save();
  g.translate(cx, cy);
  // jante
  g.shadowColor = 'rgba(192,132,252,0.9)';
  g.shadowBlur = o.small ? 12 : 22;
  g.beginPath();
  g.arc(0, 0, R + (o.small ? 4 : 11), 0, D.TAU);
  const rim = g.createLinearGradient(0, -R, 0, R);
  rim.addColorStop(0, '#F5E9FF');
  rim.addColorStop(1, '#A78BDA');
  g.fillStyle = rim;
  g.fill();
  g.shadowBlur = 0;
  for (let i = 0; i < N; i++) {
    const a = rot + i * seg - seg / 2 - Math.PI / 2;
    const [c0, c1] = colorOf(wheel[i]);
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, R, a, a + seg);
    g.closePath();
    const gr = g.createRadialGradient(0, 0, R * 0.15, 0, 0, R);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c0);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.stroke();
    if (hiIdx === i) {
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = '#FFFFFF';
      g.stroke();
    }
  }
  if (!o.small) {
    for (let i = 0; i < N; i++) {
      const a = rot + i * seg;
      g.save();
      g.rotate(a);
      g.translate(0, -R * 0.78);
      D.text(g, lab(wheel[i], coef), 0, 0, { size: wheel[i] === 10 ? 15 : 13.5, color: wheel[i] === 0 ? 'rgba(233,213,255,0.5)' : '#fff' });
      g.restore();
    }
    // ampoules sur la jante
    for (let i = 0; i < N; i++) {
      const a = rot + i * seg - seg / 2 - Math.PI / 2;
      g.beginPath();
      g.arc(Math.cos(a) * (R + 5.5), Math.sin(a) * (R + 5.5), 2.2, 0, D.TAU);
      g.fillStyle = i % 2 ? '#FDE68A' : '#FFFFFF';
      g.shadowColor = '#FDE68A';
      g.shadowBlur = 6;
      g.fill();
      g.shadowBlur = 0;
    }
  }
  // moyeu
  const hub = o.small ? R * 0.2 : R * 0.2;
  g.beginPath();
  g.arc(0, 0, hub + 6, 0, D.TAU);
  g.fillStyle = '#2E1065';
  g.fill();
  g.beginPath();
  g.arc(0, 0, hub, 0, D.TAU);
  const hg = g.createRadialGradient(-3, -3, 1, 0, 0, hub);
  hg.addColorStop(0, '#FFFFFF');
  hg.addColorStop(1, '#C4B5FD');
  g.fillStyle = hg;
  g.fill();
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
  const frames = extra.map((e, k) => {
    const last = k === n - 1;
    return {
      cap: last ? (res.base === 0 ? "La roue s'arrête sur x0" : `La roue s'arrête sur ${lab(res.base, coef)}`) : caps[k],
      ms: last ? 1300 : 800,
      draw(S) {
        const { g, w, h, cx } = S;
        const R = 172;
        const wy = 208;
        // projecteur derrière la roue
        D.floorGlow(g, cx, wy - R, 230, 120, 'rgba(240,171,252,0.2)');
        drawWheel(g, cx, wy, R, -idx * seg + e * seg, wheel, coef, last ? idx : -1);
        // flou de mouvement
        if (k <= 2) {
          g.save();
          g.beginPath();
          g.arc(cx, wy, R, 0, D.TAU);
          g.clip();
          g.fillStyle = 'rgba(30,10,70,0.22)';
          g.fillRect(0, 0, w, h);
          g.restore();
        }
        // pointeur
        g.save();
        g.shadowColor = '#F0ABFC';
        g.shadowBlur = 14;
        const pg = g.createLinearGradient(0, 2, 0, 36);
        pg.addColorStop(0, '#FFFFFF');
        pg.addColorStop(1, '#E879F9');
        g.fillStyle = pg;
        g.beginPath();
        g.moveTo(cx, 40);
        g.lineTo(cx - 12, 4);
        g.lineTo(cx + 12, 4);
        g.closePath();
        g.fill();
        g.restore();
        D.hud(g, 14, 14, 100, 50, 'Roue', `${N} cases`);
        D.hud(g, w - 114, 14, 100, 50, 'Résultat', last ? (res.base === 0 ? 'x0' : lab(res.base, coef)) : '?', {
          size: 18,
          color: last ? S.accent || '#fff' : 'rgba(233,213,255,0.6)',
          line: last ? S.accent || undefined : undefined,
          glow: last ? S.accent : undefined,
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
  drawWheel(S.g, cx, cy, 36, -idx * seg + (S.last ? 0 : (1 - S.p) * seg * 10), wheel, 1, -1, { small: true });
  S.g.fillStyle = '#F0ABFC';
  S.g.beginPath();
  S.g.moveTo(cx, cy - 30);
  S.g.lineTo(cx - 6, cy - 44);
  S.g.lineTo(cx + 6, cy - 44);
  S.g.fill();
}

module.exports = { key: 'wheel', title: 'Roue de la fortune', theme, build, emblem };
