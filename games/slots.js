'use strict';
const D = require('./draw');

const KEYS = ['CER', 'CIT', 'RAI', 'CLO', 'DIA', '7'];
const RW = 150;
const RH = 124;
const GAP = 14;

const theme = { c0: '#3B0764', c1: '#12021F', rim: 'rgba(253,230,138,0.9)', spot: 'rgba(253,230,138,0.2)', pattern: 'diamond' };

function build(res, ctx) {
  const reels = (res.reels || []).map((r) => String(r.s).trim());
  const win = ctx.outcome === 'win';
  const rn = D.mulberry(reels.join('').split('').reduce((a, c) => a + c.charCodeAt(0) * 31, 7));
  const nb = reels.map(() => [KEYS[Math.floor(rn() * KEYS.length)], KEYS[Math.floor(rn() * KEYS.length)]]);
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
      const gold = f.hl && win ? S.accent || '#FDE68A' : '#FDE68A';
      D.bulbs(g, 20, w - 20, 9, 34, f.hl && win ? k : k, '#FDE68A');
      D.bulbs(g, 20, w - 20, h - 9, 34, k + 1, '#F0ABFC', 'rgba(240,171,252,0.2)');
      D.text(g, 'JACKPOT', 62, 30, { size: 11, color: 'rgba(253,230,138,0.8)' });
      D.text(g, 'ZNK', w - 52, 30, { size: 11, color: 'rgba(240,171,252,0.8)' });

      for (let r = 0; r < 3; r++) {
        const x = x0 + r * (RW + GAP);
        const stopped = r < f.stop;
        g.save();
        D.rr(g, x, cy - RH / 2, RW, RH, 14);
        g.fillStyle = '#0B0319';
        g.fill();
        g.clip();
        const bg = g.createLinearGradient(0, cy - RH / 2, 0, cy + RH / 2);
        bg.addColorStop(0, 'rgba(255,255,255,0.02)');
        bg.addColorStop(0.5, 'rgba(168,85,247,0.38)');
        bg.addColorStop(1, 'rgba(255,255,255,0.02)');
        g.fillStyle = bg;
        g.fillRect(x, cy - RH / 2, RW, RH);
        if (stopped) {
          D.drawSymbol(g, nb[r][0], x + RW / 2, cy - 48, 40, { alpha: 0.4 });
          D.drawSymbol(g, nb[r][1], x + RW / 2, cy + 48, 40, { alpha: 0.4 });
          D.drawSymbol(g, reels[r], x + RW / 2, cy, 66);
        } else {
          for (let j = -2; j <= 2; j++) {
            const sym = KEYS[Math.floor(rnd() * KEYS.length)];
            D.drawSymbol(g, sym, x + RW / 2, cy + j * 50 + (rnd() - 0.5) * 12, 44, { alpha: j === 0 ? 0.55 : 0.3 });
          }
          for (let l = 0; l < 14; l++) {
            g.fillStyle = `rgba(216,180,254,${0.06 + rnd() * 0.14})`;
            g.fillRect(x, cy - RH / 2 + rnd() * RH, RW, 1.5 + rnd() * 2);
          }
        }
        // ombre haut / bas du cylindre
        const sh = g.createLinearGradient(0, cy - RH / 2, 0, cy + RH / 2);
        sh.addColorStop(0, 'rgba(8,2,20,0.85)');
        sh.addColorStop(0.28, 'rgba(8,2,20,0)');
        sh.addColorStop(0.72, 'rgba(8,2,20,0)');
        sh.addColorStop(1, 'rgba(8,2,20,0.85)');
        g.fillStyle = sh;
        g.fillRect(x, cy - RH / 2, RW, RH);
        // reflet de vitre
        const gl = g.createLinearGradient(x, cy - RH / 2, x + RW, cy + RH / 2);
        gl.addColorStop(0, 'rgba(255,255,255,0.14)');
        gl.addColorStop(0.4, 'rgba(255,255,255,0)');
        g.fillStyle = gl;
        g.fillRect(x, cy - RH / 2, RW, RH);
        g.restore();
        g.save();
        D.rr(g, x, cy - RH / 2, RW, RH, 14);
        g.lineWidth = f.hl && win ? 3.4 : 2;
        g.strokeStyle = f.hl ? (win ? gold : 'rgba(252,165,165,0.8)') : 'rgba(253,230,138,0.75)';
        g.shadowColor = f.hl && win ? gold : 'rgba(253,230,138,0.45)';
        g.shadowBlur = f.hl && win ? 18 : 8;
        g.stroke();
        g.restore();
      }
      // ligne de gain + flèches
      g.save();
      g.strokeStyle = f.hl && win ? gold : 'rgba(244,63,94,0.75)';
      g.shadowColor = f.hl && win ? gold : '#F43F5E';
      g.shadowBlur = f.hl && win ? 12 : 6;
      g.lineWidth = f.hl && win ? 2.4 : 1.4;
      g.setLineDash(f.hl && win ? [] : [6, 5]);
      g.beginPath();
      g.moveTo(x0 - 16, cy);
      g.lineTo(x0 + 3 * RW + 2 * GAP + 16, cy);
      g.stroke();
      g.restore();
      for (const dir of [-1, 1]) {
        const sx = dir < 0 ? x0 - 20 : x0 + 3 * RW + 2 * GAP + 20;
        g.fillStyle = '#F43F5E';
        g.shadowColor = '#F43F5E';
        g.shadowBlur = 8;
        g.beginPath();
        g.moveTo(sx + dir * -9, cy);
        g.lineTo(sx + dir * 5, cy - 9);
        g.lineTo(sx + dir * 5, cy + 9);
        g.closePath();
        g.fill();
        g.shadowBlur = 0;
      }
    },
  }));
  return { frames };
}

function emblem(S, cx, cy) {
  const flip = S.last ? S.res.reels?.[0]?.s : KEYS[Math.floor(S.rnd() * KEYS.length)];
  D.drawSymbol(S.g, S.last ? String(flip).trim() : flip, cx, cy, 56);
}

module.exports = { key: 'slots', title: 'Machine à sous', theme, build, emblem };
