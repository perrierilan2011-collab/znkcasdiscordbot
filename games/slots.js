'use strict';
const D = require('./draw');

const KEYS = ['CER', 'CIT', 'RAI', 'CLO', 'DIA', '7'];
const RW = 124;
const RH = 80;
const GAP = 16;

function build(res, ctx) {
  const reels = (res.reels || []).map((r) => String(r.s).trim());
  const win = ctx.outcome === 'win';
  // [rouleaux arrêtés, mise en valeur]
  const plan = [
    { stop: 0, cap: 'Les rouleaux tournent...' },
    { stop: 0, cap: 'Pleine vitesse' },
    { stop: 1, cap: 'Premier rouleau bloqué' },
    { stop: 2, cap: 'Deuxième rouleau bloqué' },
    { stop: 3, cap: 'Dernier rouleau...' },
    { stop: 3, cap: win ? 'Combinaison gagnante !' : 'Pas de combinaison', hl: true },
  ];
  const n = plan.length;
  const frames = plan.map((f, k) => ({
    cap: f.cap,
    ms: k === n - 1 ? 1300 : 800,
    draw(S) {
      const { g, w, h, cx, rnd } = S;
      const x0 = cx - (3 * RW + 2 * GAP) / 2;
      const cy = h / 2;
      // ligne de gain
      if (f.hl && win) {
        g.save();
        g.strokeStyle = 'rgba(253,230,138,0.9)';
        g.shadowColor = '#FDE68A';
        g.shadowBlur = 10;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x0 - 18, cy);
        g.lineTo(x0 + 3 * RW + 2 * GAP + 18, cy);
        g.stroke();
        g.restore();
      }
      for (let r = 0; r < 3; r++) {
        const x = x0 + r * (RW + GAP);
        const stopped = r < f.stop;
        g.save();
        D.rr(g, x, cy - RH / 2, RW, RH, 12);
        const bg = g.createLinearGradient(0, cy - RH / 2, 0, cy + RH / 2);
        bg.addColorStop(0, '#3B1370');
        bg.addColorStop(0.5, '#6D28D9');
        bg.addColorStop(1, '#3B1370');
        g.fillStyle = '#12042A';
        g.fill();
        g.clip();
        g.fillStyle = bg;
        g.globalAlpha = 0.35;
        g.fillRect(x, cy - RH / 2, RW, RH);
        g.globalAlpha = 1;
        if (stopped) {
          D.drawSymbol(g, reels[r], x + RW / 2, cy, 50);
        } else {
          for (let j = -1; j <= 1; j++) {
            const sym = KEYS[Math.floor(rnd() * KEYS.length)];
            D.drawSymbol(g, sym, x + RW / 2, cy + j * 46 + (rnd() - 0.5) * 14, 40, { alpha: j === 0 ? 0.6 : 0.35 });
          }
          g.fillStyle = 'rgba(192,132,252,0.18)';
          for (let l = 0; l < 6; l++) g.fillRect(x, cy - RH / 2 + rnd() * RH, RW, 2);
        }
        // reflet de la vitre
        const gl = g.createLinearGradient(0, cy - RH / 2, 0, cy + RH / 2);
        gl.addColorStop(0, 'rgba(255,255,255,0.16)');
        gl.addColorStop(0.45, 'rgba(255,255,255,0)');
        gl.addColorStop(1, 'rgba(0,0,0,0.25)');
        g.fillStyle = gl;
        g.fillRect(x, cy - RH / 2, RW, RH);
        g.restore();
        g.save();
        D.rr(g, x, cy - RH / 2, RW, RH, 12);
        g.lineWidth = f.hl && win ? 3 : 1.6;
        g.strokeStyle = f.hl ? (win ? S.accent || '#FDE68A' : 'rgba(252,165,165,0.8)') : 'rgba(216,180,254,0.75)';
        g.shadowColor = f.hl && win ? S.accent || '#FDE68A' : 'rgba(168,85,247,0.7)';
        g.shadowBlur = f.hl && win ? 16 : 6;
        g.stroke();
        g.restore();
      }
      // flèches latérales
      for (const sx of [x0 - 14, x0 + 3 * RW + 2 * GAP + 14]) {
        g.fillStyle = '#E879F9';
        g.beginPath();
        g.moveTo(sx + (sx < cx ? -7 : 7), cy);
        g.lineTo(sx + (sx < cx ? 3 : -3), cy - 7);
        g.lineTo(sx + (sx < cx ? 3 : -3), cy + 7);
        g.closePath();
        g.fill();
      }
    },
  }));
  return { frames };
}

function emblem(S, cx, cy) {
  const flip = S.last ? S.res.reels?.[0]?.s : KEYS[Math.floor(S.rnd() * KEYS.length)];
  D.drawSymbol(S.g, S.last ? String(flip).trim() : flip, cx, cy, 56);
}

module.exports = { key: 'slots', title: 'Machine à sous', build, emblem };
