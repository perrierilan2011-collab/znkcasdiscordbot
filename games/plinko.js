'use strict';
const D = require('./draw');

const ROWS = 8; // rangées de piquets = nombre de rebonds
const SP = 52; // écart entre deux piquets d'une même rangée
const DY = 14; // écart vertical entre deux rangées
const Y0 = 16; // hauteur de la 1re rangée
const SLOT_TOP = 128;
const SLOT_H = 32;
const BALL_R = 6;

const theme = { c0: '#2B0F5C', c1: '#0A0320', rim: 'rgba(103,232,249,0.85)', spot: 'rgba(103,232,249,0.16)', pattern: 'dots' };

const fmtMult = (m, c) => `x${+(m * c).toFixed(2)}`;

function slotColors(m) {
  if (m >= 5) return ['#FBBF24', '#B45309'];
  if (m >= 2) return ['#F0457F', '#A01450'];
  if (m >= 1) return ['#A63BE8', '#6B1AA8'];
  return ['#4B2A8F', '#24104F'];
}

// calendrier de l'animation (fractions de la durée totale)
const T_DROP = 0.07; // début de la chute
const T_HIT0 = 0.16; // 1er contact (rangée 0)
const T_SEG = 0.085; // durée d'un rebond
const T_END = T_HIT0 + (ROWS - 1) * T_SEG; // contact avec la dernière rangée
const T_LAND = T_END + 0.12; // la bille touche le fond de la case
const T_SETTLE = T_LAND + 0.06;

function gif(res, ctx) {
  const path = res.path || [];
  const mults = res.mults || [];
  const bin = res.bin;
  const coef = ctx.coef || 1;
  const cx0 = 364;

  // positions horizontales avant chaque rangée : o_r = (2*R_r - r) * SP / 2
  const off = [];
  let rights = 0;
  for (let r = 0; r <= ROWS; r++) {
    off.push((2 * rights - r) * (SP / 2));
    if (r < ROWS) rights += path[r] ? 1 : 0;
  }
  const rightsBefore = [];
  rights = 0;
  for (let r = 0; r < ROWS; r++) {
    rightsBefore.push(rights);
    rights += path[r] ? 1 : 0;
  }
  const rowY = (r) => Y0 + r * DY;
  const contactY = (r) => rowY(r) - BALL_R - 2.6;
  const slotBallY = SLOT_TOP + SLOT_H * 0.55;

  function ballAt(t) {
    if (t < T_DROP) return { x: cx0, y: -10 };
    if (t < T_HIT0) {
      const u = (t - T_DROP) / (T_HIT0 - T_DROP);
      return { x: cx0 + off[0], y: D.lerp(-10, contactY(0), u * u) };
    }
    if (t < T_END) {
      const r = Math.min(ROWS - 2, Math.floor((t - T_HIT0) / T_SEG));
      const u = (t - T_HIT0 - r * T_SEG) / T_SEG;
      const yA = contactY(r);
      const yB = contactY(r + 1);
      return {
        x: cx0 + D.lerp(off[r], off[r + 1], D.clamp(u)),
        y: D.lerp(yA, yB, u) - 4 * 7 * u * (1 - u),
      };
    }
    if (t < T_LAND) {
      const u = (t - T_END) / (T_LAND - T_END);
      const yA = contactY(ROWS - 1);
      return {
        x: cx0 + D.lerp(off[ROWS - 1], off[ROWS], D.clamp(u)),
        y: D.lerp(yA, slotBallY, u * u * 0.8 + u * 0.2) - 4 * 6 * u * (1 - u),
      };
    }
    if (t < T_SETTLE) {
      const u = (t - T_LAND) / (T_SETTLE - T_LAND);
      return { x: cx0 + off[ROWS], y: slotBallY - 4 * 7 * u * (1 - u) };
    }
    return { x: cx0 + off[ROWS], y: slotBallY };
  }

  return {
    dur: 5.4,
    cap: (t) => {
      if (t < T_DROP) return 'La bille est prête';
      if (t < T_HIT0) return 'La bille est lâchée';
      if (t < T_END) return `Rebond ${Math.min(ROWS, Math.floor((t - T_HIT0) / T_SEG) + 1)}/${ROWS}`;
      if (t < T_END + 0.04) return `Rebond ${ROWS}/${ROWS}`;
      if (t < T_LAND) return 'Elle tombe...';
      return `Case ${bin + 1} : ${fmtMult(mults[bin], coef)}`;
    },
    draw(S, t) {
      const { g, w, h } = S;
      const landed = t >= T_LAND;

      D.floorGlow(g, cx0, SLOT_TOP + SLOT_H, 300, 26, 'rgba(103,232,249,0.14)');

      // cases de gain (celle d'arrivée s'enfonce un instant)
      for (let b = 0; b < mults.length; b++) {
        const x = cx0 + (b - 4) * SP;
        const hit = landed && b === bin;
        const dent = hit ? Math.sin(D.clamp((t - T_LAND) / 0.08) * Math.PI) * 4 : 0;
        const [c0, c1] = slotColors(mults[b]);
        g.save();
        D.rr(g, x - SP / 2 + 2, SLOT_TOP + dent, SP - 4, SLOT_H, 8);
        const gr = g.createLinearGradient(0, SLOT_TOP, 0, SLOT_TOP + SLOT_H);
        gr.addColorStop(0, c0);
        gr.addColorStop(1, c1);
        g.fillStyle = gr;
        if (hit) {
          g.shadowColor = S.accent || '#FDE68A';
          g.shadowBlur = 18;
        }
        g.globalAlpha = landed && !hit ? 0.55 : 1;
        g.fill();
        g.lineWidth = hit ? 2.6 : 1.1;
        g.strokeStyle = hit ? S.accent || '#FFFFFF' : 'rgba(255,255,255,0.35)';
        g.stroke();
        g.restore();
        D.text(g, fmtMult(mults[b], coef), x, SLOT_TOP + SLOT_H / 2 + 1 + dent, { size: hit ? 13 : 11.5, alpha: landed && !hit ? 0.6 : 1 });
      }

      // piquets (celui qui vient d'être touché s'illumine)
      for (let r = 0; r < ROWS; r++) {
        const tHit = T_HIT0 + r * T_SEG;
        const glow = t >= tHit ? Math.max(0, 1 - (t - tHit) / 0.07) : 0;
        for (let j = 0; j <= r; j++) {
          const x = cx0 + (2 * j - r) * (SP / 2);
          const y = rowY(r);
          const lit = glow > 0 && j === rightsBefore[r];
          g.save();
          g.beginPath();
          g.arc(x, y, lit ? 3.2 + 2.4 * glow : 3.2, 0, D.TAU);
          g.fillStyle = lit ? '#FFFFFF' : 'rgba(233,213,255,0.85)';
          if (lit) {
            g.shadowColor = '#67E8F9';
            g.shadowBlur = 14 * glow + 4;
          }
          g.fill();
          g.restore();
        }
      }

      // traînée + bille
      if (t >= T_DROP) {
        for (let j = 4; j >= 1; j--) {
          const p = ballAt(Math.max(T_DROP, t - j * 0.011));
          g.beginPath();
          g.arc(p.x, p.y, BALL_R * (1 - j * 0.14), 0, D.TAU);
          g.fillStyle = `rgba(103,232,249,${0.2 - j * 0.035})`;
          g.fill();
        }
      }
      const b = ballAt(t);
      g.save();
      g.shadowColor = '#67E8F9';
      g.shadowBlur = 14;
      g.beginPath();
      g.arc(b.x, b.y, BALL_R, 0, D.TAU);
      const bg = g.createRadialGradient(b.x - 1.8, b.y - 1.8, 0.8, b.x, b.y, BALL_R);
      bg.addColorStop(0, '#FFFFFF');
      bg.addColorStop(1, '#22D3EE');
      g.fillStyle = bg;
      g.fill();
      g.restore();

      D.hud(g, 14, 14, 100, 50, 'Risque', String(res.pick || '-').slice(0, 10), { size: 15 });
      D.hud(g, w - 114, 14, 100, 50, 'Gain', landed ? fmtMult(mults[bin], coef) : '?', {
        size: 18,
        color: landed ? S.accent || '#fff' : 'rgba(233,213,255,0.6)',
        line: landed ? S.accent || undefined : undefined,
        glow: landed ? S.accent : undefined,
      });
    },
  };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  for (let r = 0; r < 4; r++) {
    for (let j = 0; j <= r; j++) {
      g.beginPath();
      g.arc((2 * j - r) * 11, -22 + r * 14, 2.6, 0, D.TAU);
      g.fillStyle = 'rgba(233,213,255,0.9)';
      g.fill();
    }
  }
  const by = -30 + (S.last ? 1 : p) * 52;
  g.save();
  g.shadowColor = '#67E8F9';
  g.shadowBlur = 10;
  g.beginPath();
  g.arc(Math.sin(p * 9) * 8 * (S.last ? 0 : 1), by, 5.5, 0, D.TAU);
  g.fillStyle = '#22D3EE';
  g.fill();
  g.restore();
}

module.exports = { key: 'plinko', title: 'Plinko', theme, gif, emblem };
