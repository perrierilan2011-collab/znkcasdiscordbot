'use strict';
const D = require('./draw');

const theme = { c0: '#1B0B45', c1: '#05020F', rim: 'rgba(244,114,182,0.85)', spot: 'rgba(244,114,182,0.14)', pattern: null };

// repère du graphique dans la scène (728 x 172)
const GX0 = 70;
const GX1 = 650;
const GY0 = 150; // sol
const GY1 = 36; // plafond (laisse la place à l'explosion)

const fmt = (m) => `x${(Math.round(m * 100) / 100).toFixed(2)}`;

// fusée orientée selon l'angle (0 = vers la droite)
function drawRocket(g, x, y, ang, flame, shake = 0) {
  g.save();
  g.translate(x + shake, y);
  g.rotate(ang);
  g.scale(1.7, 1.7);
  // flamme
  if (flame > 0) {
    const len = 12 + flame * 10;
    const fg = g.createLinearGradient(-8, 0, -8 - len, 0);
    fg.addColorStop(0, 'rgba(255,255,255,0.95)');
    fg.addColorStop(0.35, '#FDE68A');
    fg.addColorStop(0.7, '#F97316');
    fg.addColorStop(1, 'rgba(244,63,94,0)');
    g.fillStyle = fg;
    g.beginPath();
    g.moveTo(-7, -3.2);
    g.quadraticCurveTo(-8 - len * 0.6, -4, -8 - len, 0);
    g.quadraticCurveTo(-8 - len * 0.6, 4, -7, 3.2);
    g.closePath();
    g.fill();
  }
  // ailerons
  g.fillStyle = '#E11D48';
  g.beginPath();
  g.moveTo(-6, -4);
  g.lineTo(-12, -10);
  g.lineTo(-2, -4);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-6, 4);
  g.lineTo(-12, 10);
  g.lineTo(-2, 4);
  g.closePath();
  g.fill();
  // corps
  const bg = g.createLinearGradient(0, -5, 0, 5);
  bg.addColorStop(0, '#FFFFFF');
  bg.addColorStop(1, '#C4B5FD');
  g.fillStyle = bg;
  g.beginPath();
  g.moveTo(15, 0);
  g.quadraticCurveTo(8, -6, -8, -4.6);
  g.lineTo(-8, 4.6);
  g.quadraticCurveTo(8, 6, 15, 0);
  g.closePath();
  g.fill();
  // nez + hublot
  g.fillStyle = '#E11D48';
  g.beginPath();
  g.moveTo(15, 0);
  g.quadraticCurveTo(11, -4, 7, -4.4);
  g.lineTo(7, 4.4);
  g.quadraticCurveTo(11, 4, 15, 0);
  g.fill();
  g.fillStyle = '#22D3EE';
  g.beginPath();
  g.arc(0, 0, 2.6, 0, D.TAU);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = '#4C1D95';
  g.stroke();
  g.restore();
}

function gif(res, ctx) {
  const crash = Math.max(1, Math.min(res.crash || 1, 1000));
  const target = res.target || 2;
  const hit = crash >= target; // la cible est atteinte avant l'explosion
  const maxM = Math.max(crash, target, 2) * 1.08;
  const lnMax = Math.log(maxM);
  const lev = (m) => Math.pow(Math.log(Math.max(1, m)) / lnMax, 1.7); // courbe convexe façon « crash »
  const T_BOOM = 0.76; // instant de l'explosion
  const T_LIFT = 0.06; // compte à rebours avant décollage

  // multiplicateur au temps t (croissance exponentielle jusqu'au crash)
  const mAt = (t) => {
    if (t <= T_LIFT) return 1;
    const u = D.clamp((t - T_LIFT) / (T_BOOM - T_LIFT));
    return Math.pow(crash, u * u * 0.35 + u * 0.65);
  };
  const posAt = (t) => {
    const u = D.clamp((t - T_LIFT) / (T_BOOM - T_LIFT));
    const m = mAt(t);
    return { x: D.lerp(GX0 + 14, GX1 - 70, u), y: D.lerp(GY0 - 8, GY1 + 8, Math.min(1, lev(m))) };
  };
  const tTarget = (() => {
    if (!hit) return null;
    for (let k = 0; k <= 400; k++) {
      const t = T_LIFT + ((T_BOOM - T_LIFT) * k) / 400;
      if (mAt(t) >= target) return t;
    }
    return T_BOOM;
  })();

  // étoiles de fond (fixes)
  const rnd = D.mulberry(11 + Math.round(crash * 10));
  const stars = Array.from({ length: 46 }, () => ({ x: rnd() * 728, y: rnd() * 172, r: 0.5 + rnd() * 1.2, a: 0.2 + rnd() * 0.5 }));

  return {
    dur: 5.8,
    cap: (t) => {
      if (t < T_LIFT) return 'Décollage imminent';
      if (t < T_BOOM) {
        if (hit && tTarget != null && t >= tTarget) return `Cible x${target} atteinte`;
        return t < 0.25 ? 'La fusée décolle' : t < 0.5 ? 'Elle monte...' : 'Ça monte vite...';
      }
      return hit ? `Explosion à ${fmt(crash)} : cible x${target} encaissée` : `Explosion à ${fmt(crash)} : trop tôt`;
    },
    draw(S, t) {
      const { g, w, h, cx } = S;
      const boom = t >= T_BOOM;
      const m = boom ? crash : mAt(t);

      // étoiles
      for (const s of stars) {
        g.fillStyle = `rgba(255,255,255,${s.a * (0.7 + 0.3 * Math.sin(t * 30 + s.x))})`;
        g.beginPath();
        g.arc(s.x, s.y, s.r, 0, D.TAU);
        g.fill();
      }
      // grille légère
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const y = D.lerp(GY0, GY1, k / 4);
        g.beginPath();
        g.moveTo(GX0, y);
        g.lineTo(GX1, y);
        g.stroke();
      }
      // ligne de cible
      const ty = D.lerp(GY0 - 8, GY1 + 8, Math.min(1, lev(target)));
      g.save();
      g.setLineDash([6, 5]);
      g.lineWidth = 1.6;
      const reached = hit && tTarget != null && t >= tTarget;
      g.strokeStyle = reached ? '#86EFAC' : 'rgba(253,230,138,0.75)';
      g.beginPath();
      g.moveTo(GX0, ty);
      g.lineTo(GX1, ty);
      g.stroke();
      g.restore();
      D.text(g, `CIBLE x${target}`, GX1 + 4, ty, { size: 9, align: 'left', color: reached ? '#86EFAC' : '#FDE68A' });

      // courbe parcourue
      const tEnd = boom ? T_BOOM : t;
      if (tEnd > T_LIFT) {
        const N = 40;
        g.save();
        g.beginPath();
        for (let k = 0; k <= N; k++) {
          const p = posAt(T_LIFT + ((tEnd - T_LIFT) * k) / N);
          if (k === 0) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        }
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.strokeStyle = boom && !hit ? 'rgba(248,113,113,0.9)' : 'rgba(244,114,182,0.95)';
        g.shadowColor = boom && !hit ? '#F87171' : '#F472B6';
        g.shadowBlur = 12;
        g.stroke();
        g.restore();
      }

      // multiplicateur géant
      const big = boom ? (hit ? S.accent || '#86EFAC' : S.accent || '#FCA5A5') : '#FFFFFF';
      D.text(g, fmt(m), cx, 46, { size: boom ? 44 : 40, color: big, glow: boom ? big : 'rgba(244,114,182,0.8)', blur: 16 });
      if (boom) D.text(g, hit ? 'ENCAISSÉ' : 'CRASH', cx, 76, { size: 14, color: big, stroke: 'rgba(10,3,25,0.85)', sw: 4 });

      // fusée (ou explosion)
      const p = posAt(Math.min(t, T_BOOM));
      if (!boom) {
        const lifted = t > T_LIFT;
        const prevP = posAt(Math.max(T_LIFT, t - 0.02));
        const ang = lifted ? Math.atan2(p.y - prevP.y, p.x - prevP.x) : -Math.PI / 4;
        const shake = lifted ? 0 : Math.sin(t * 160) * 1.2 * (t / T_LIFT);
        // fumée derrière
        if (lifted) {
          for (let j = 1; j <= 7; j++) {
            const q = posAt(Math.max(T_LIFT, t - j * 0.018));
            g.beginPath();
            g.arc(q.x - 4, q.y + 2 + j * 0.6, 2.2 + j * 0.9, 0, D.TAU);
            g.fillStyle = `rgba(233,213,255,${0.28 - j * 0.032})`;
            g.fill();
          }
        }
        drawRocket(g, p.x, p.y, ang, lifted ? 0.6 + 0.4 * Math.sin(t * 120) : 0.3, shake);
        // plateforme
        if (!lifted) {
          g.fillStyle = 'rgba(233,213,255,0.5)';
          g.fillRect(GX0, GY0 - 1, 40, 3);
        }
      } else {
        // explosion : onde de choc + éclats + flash
        const e = D.clamp((t - T_BOOM) / 0.16);
        const col = hit ? '#FDE68A' : '#FB7185';
        if (e < 0.5) {
          g.fillStyle = `rgba(255,255,255,${(0.55 * (1 - e * 2)).toFixed(3)})`;
          g.beginPath();
          g.arc(p.x, p.y, 8 + e * 90, 0, D.TAU);
          g.fill();
        }
        g.save();
        g.lineWidth = 3 * (1 - e) + 0.6;
        g.strokeStyle = col;
        g.shadowColor = col;
        g.shadowBlur = 14;
        g.beginPath();
        g.arc(p.x, p.y, 6 + e * 56, 0, D.TAU);
        g.stroke();
        g.restore();
        const rr = D.mulberry(77);
        for (let k = 0; k < 26; k++) {
          const a = rr() * D.TAU;
          const sp = 20 + rr() * 70;
          const d = sp * D.ease(e) + (t - T_BOOM) * 30;
          const fall = (t - T_BOOM) * (t - T_BOOM) * 260;
          g.beginPath();
          g.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d + fall, Math.max(0.6, (2.6 - e * 1.6) * (0.5 + rr())), 0, D.TAU);
          g.fillStyle = k % 3 === 0 ? '#FFFFFF' : k % 3 === 1 ? col : '#F97316';
          g.fill();
        }
      }
    },
  };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  g.save();
  g.scale(1.15, 1.15);
  drawRocket(g, 4, 0 - (S.last ? 0 : Math.sin(p * 6) * 2), -Math.PI / 4 - 0.2, 0.8);
  g.restore();
}

module.exports = { key: 'crash', title: 'Crash', theme, gif, emblem };
