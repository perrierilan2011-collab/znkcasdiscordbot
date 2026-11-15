'use strict';
const D = require('./draw');

const theme = { c0: '#2B0A3D', c1: '#0A0216', rim: 'rgba(252,165,165,0.85)', spot: 'rgba(244,114,182,0.2)', pattern: 'diamond' };

const R = 58; // rayon du barillet
const RC = 36; // distance des chambres au centre
const RH = 15; // rayon d'une chambre
const BANG = '#FCA5A5';
const SAFE = '#86EFAC';

const smooth = (a, b, x) => {
  const u = D.clamp((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

// angle (rad) de la chambre p quand le barillet a tourné de `rot`
const chamberAngle = (p, rot) => -Math.PI / 2 + rot + (p * Math.PI) / 3;

// Barillet : `show` = révèle les balles ; `alpha` pour les images fantômes (flou de rotation)
function cylinder(g, cx, cy, rot, chambers, o = {}) {
  const show = !!o.show;
  g.save();
  g.globalAlpha = o.alpha == null ? 1 : o.alpha;
  // corps métallique
  g.shadowColor = o.glow || 'rgba(0,0,0,0.6)';
  g.shadowBlur = o.glow ? 26 : 14;
  g.shadowOffsetY = o.glow ? 0 : 4;
  g.beginPath();
  g.arc(cx, cy, R, 0, D.TAU);
  const body = g.createRadialGradient(cx - 18, cy - 22, 6, cx, cy, R);
  body.addColorStop(0, '#8B7FB0');
  body.addColorStop(0.55, '#4B3A78');
  body.addColorStop(1, '#1C1038');
  g.fillStyle = body;
  g.fill();
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.lineWidth = 2.4;
  g.strokeStyle = o.rim || 'rgba(233,213,255,0.8)';
  g.stroke();
  // rainures entre les chambres
  g.strokeStyle = 'rgba(12,3,30,0.35)';
  g.lineWidth = 3;
  for (let p = 0; p < 6; p++) {
    const a = chamberAngle(p, rot) + Math.PI / 6;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
    g.lineTo(cx + Math.cos(a) * (R - 3), cy + Math.sin(a) * (R - 3));
    g.stroke();
  }
  // chambres
  for (let p = 0; p < 6; p++) {
    const a = chamberAngle(p, rot);
    const x = cx + Math.cos(a) * RC;
    const y = cy + Math.sin(a) * RC;
    g.beginPath();
    g.arc(x, y, RH, 0, D.TAU);
    const hole = g.createRadialGradient(x - 3, y - 4, 2, x, y, RH);
    hole.addColorStop(0, '#0B0418');
    hole.addColorStop(1, '#241046');
    g.fillStyle = hole;
    g.fill();
    g.lineWidth = 1.6;
    g.strokeStyle = 'rgba(192,132,252,0.55)';
    g.stroke();
    if (show && chambers[p]) bullet(g, x, y, o.fired === p);
  }
  // axe central
  g.beginPath();
  g.arc(cx, cy, 11, 0, D.TAU);
  const ax = g.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 11);
  ax.addColorStop(0, '#E9D5FF');
  ax.addColorStop(1, '#6D28D9');
  g.fillStyle = ax;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.stroke();
  g.restore();
}

// balle (étui doré vu de face) ; `spent` = percutée
function bullet(g, x, y, spent) {
  g.save();
  g.beginPath();
  g.arc(x, y, RH - 3.5, 0, D.TAU);
  const b = g.createRadialGradient(x - 3, y - 3, 1, x, y, RH - 3);
  b.addColorStop(0, spent ? '#FEE2E2' : '#FEF3C7');
  b.addColorStop(0.6, spent ? '#F87171' : '#F59E0B');
  b.addColorStop(1, spent ? '#7F1D1D' : '#92400E');
  g.fillStyle = b;
  g.shadowColor = spent ? '#EF4444' : '#FBBF24';
  g.shadowBlur = 7;
  g.fill();
  g.shadowBlur = 0;
  g.beginPath();
  g.arc(x, y, 4.2, 0, D.TAU);
  g.fillStyle = spent ? '#450A0A' : '#B45309';
  g.fill();
  g.restore();
}

// chien (marteau) au-dessus de la chambre du haut : `pull` 0 = repos, 1 = armé
function hammer(g, cx, cy, pull, strike) {
  g.save();
  // bloc du canon
  D.rr(g, cx - 20, cy - R - 30, 40, 22, 6);
  const gr = g.createLinearGradient(0, cy - R - 30, 0, cy - R - 8);
  gr.addColorStop(0, '#6B5B95');
  gr.addColorStop(1, '#2A1B4D');
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = 'rgba(233,213,255,0.65)';
  g.stroke();
  // chien qui pivote
  g.translate(cx + 12, cy - R - 22);
  g.rotate(-0.75 * pull + (strike ? 0.1 : 0));
  g.beginPath();
  g.moveTo(-3, 0);
  g.lineTo(8, -10);
  g.lineTo(13, -4);
  g.lineTo(2, 8);
  g.closePath();
  g.fillStyle = '#C4B5FD';
  g.fill();
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 1.2;
  g.stroke();
  g.restore();
  // repère « chambre sous le percuteur »
  g.save();
  g.beginPath();
  g.moveTo(cx - 8, cy - R - 6);
  g.lineTo(cx + 8, cy - R - 6);
  g.lineTo(cx, cy - R + 4);
  g.closePath();
  g.fillStyle = '#F5D0FE';
  g.shadowColor = '#E879F9';
  g.shadowBlur = 8;
  g.fill();
  g.restore();
}

function flash(g, x, y, k, rnd) {
  // k : 0..1 (progression de l'explosion)
  const r = 18 + k * 150;
  const a = 1 - k;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(255,255,255,${a})`);
  gr.addColorStop(0.25, `rgba(254,215,170,${a * 0.9})`);
  gr.addColorStop(0.6, `rgba(244,63,94,${a * 0.5})`);
  gr.addColorStop(1, 'rgba(244,63,94,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, D.TAU);
  g.fill();
  // rayons
  g.strokeStyle = `rgba(255,237,213,${a})`;
  g.lineWidth = 3;
  g.lineCap = 'round';
  for (let s = 0; s < 14; s++) {
    const an = (s / 14) * D.TAU + rnd() * 0.3;
    const r0 = 14 + k * 30;
    const r1 = r0 + 22 + rnd() * 70 * (0.4 + k);
    g.beginPath();
    g.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0);
    g.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1);
    g.stroke();
  }
  g.restore();
}

function gif(res, ctx) {
  const dead = !!res.dead;
  const chambers = res.chambers || [true, false, false, false, false, false];
  const k = res.k || chambers.filter(Boolean).length;
  const T_LOAD = 0.14; // on montre les balles
  const T_SPIN = 0.7; // fin de la rotation
  const T_PULL = 0.82; // chien armé
  const T_FIRE = 0.86; // détente
  const TURNS = 4; // tours complets (chambre 0 finit pile sous le percuteur)
  const SPIN_RNG = D.mulberry(k * 131 + (dead ? 7 : 3));
  const spin0 = SPIN_RNG() * D.TAU; // point de départ du barillet
  // rotation : part de spin0, finit sur un multiple de 2π (chambre 0 en haut)
  const rotAt = (t) => {
    if (t < T_LOAD) return spin0;
    const u = smooth(T_LOAD, T_SPIN, t);
    const ease = 1 - Math.pow(1 - u, 3);
    return spin0 + (D.TAU * Math.ceil(spin0 / D.TAU) - spin0 + D.TAU * TURNS) * ease;
  };

  return {
    dur: 5,
    hold: 220,
    cap: (t) =>
      t < T_LOAD ? `Le barillet contient ${k} balle${k > 1 ? 's' : ''}` :
      t < 0.3 ? 'Tu le fais tourner' :
      t < 0.5 ? 'Il tourne vite...' :
      t < T_SPIN ? 'Il ralentit...' :
      t < T_PULL ? 'Il s’arrête' :
      t < T_FIRE ? 'Le percuteur est armé...' :
      dead ? 'BANG ! La balle était là' : 'Clic : la chambre était vide',
    draw(S, t) {
      const { g, w, h, cx, rnd } = S;
      const cy = h / 2 + 15;
      const rot = rotAt(t);
      const fired = t >= T_FIRE;
      const hit = fired && dead;
      const fk = D.clamp((t - T_FIRE) / 0.14);

      // tremblement de l'écran au moment du tir
      let shx = 0;
      let shy = 0;
      if (hit && t < T_FIRE + 0.12) {
        const a = (1 - (t - T_FIRE) / 0.12) * 7;
        shx = Math.sin(t * 700) * a;
        shy = Math.cos(t * 610) * a;
      }
      g.save();
      g.translate(shx, shy);

      // lueur de fond
      const tension = t > T_SPIN && t < T_FIRE ? (t - T_SPIN) / (T_FIRE - T_SPIN) : 0;
      g.save();
      const bg = g.createRadialGradient(cx, cy, 10, cx, cy, 150);
      const tone = fired ? (dead ? '244,63,94' : '74,222,128') : '192,132,252';
      bg.addColorStop(0, `rgba(${tone},${fired ? 0.3 : 0.12 + tension * 0.18})`);
      bg.addColorStop(1, `rgba(${tone},0)`);
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.restore();

      // flou de rotation : images fantômes quand ça tourne vite
      const speed = t >= T_LOAD && t < T_SPIN ? Math.pow(1 - smooth(T_LOAD, T_SPIN, t), 2) : 0;
      if (speed > 0.15) {
        for (const [back, a] of [[0.34, 0.1], [0.22, 0.16], [0.11, 0.24]]) {
          cylinder(g, cx, cy, rot - back * speed * 1.6, chambers, { alpha: a * Math.min(1, speed * 1.4) });
        }
      }
      const showBullets = t < T_LOAD + 0.025 || fired;
      cylinder(g, cx, cy, rot, chambers, {
        show: showBullets,
        fired: fired && dead ? 0 : -1,
        glow: fired ? (dead ? '#F43F5E' : '#4ADE80') : null,
        rim: fired ? (dead ? BANG : SAFE) : null,
      });

      // cliquetis : petites étincelles sur le repère pendant que ça ralentit
      if (t > 0.4 && t < T_SPIN) {
        const tick = (t * 38) % 1;
        if (tick < 0.25) D.spark(g, cx, cy - R - 2, 4 + (0.25 - tick) * 10, '#F5D0FE', 0.9);
      }

      hammer(g, cx, cy, t < T_SPIN ? 0 : t < T_PULL ? smooth(T_SPIN, T_PULL, t) : fired ? 1 - Math.min(1, fk * 6) : 1, fired);

      // détente : léger zoom de tension juste avant le tir
      if (t >= T_PULL && t < T_FIRE) {
        const v = (t - T_PULL) / (T_FIRE - T_PULL);
        D.vignette(g, w, h, 'rgba(120,10,40,0.45)', 0.55 - 0.25 * v);
      }

      if (fired) {
        const topX = cx;
        const topY = cy - RC;
        if (dead) {
          flash(g, topX, topY, fk, rnd);
          D.vignette(g, w, h, 'rgba(160,10,40,0.5)', 0.35);
          if (fk > 0.2) D.text(g, 'BANG !', cx - 150, cy, { size: 34, color: '#FFFFFF', glow: '#F43F5E', blur: 18, alpha: D.clamp((fk - 0.2) * 3) });
        } else {
          // simple « clic » + anneau vert
          g.save();
          g.strokeStyle = `rgba(134,239,172,${1 - fk})`;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(topX, topY, 18 + fk * 60, 0, D.TAU);
          g.stroke();
          g.restore();
          for (let s = 0; s < 8; s++) {
            const an = (s / 8) * D.TAU;
            D.spark(g, cx + Math.cos(an) * (R + 14 + fk * 20), cy + Math.sin(an) * (R + 14 + fk * 20), 3.2, '#BBF7D0', 0.9 * (1 - fk * 0.4));
          }
          D.text(g, 'CLIC', cx - 150, cy, { size: 32, color: '#FFFFFF', glow: '#4ADE80', blur: 16, alpha: D.clamp(fk * 4) });
        }
      }
      g.restore();

      // plaques latérales
      D.hud(g, 14, 14, 92, 76, 'Balles', `${k} / 6`, { size: 17 });
      D.hud(g, w - 106, 14, 92, 76, 'Résultat', fired ? (dead ? 'BANG' : 'SURVIS') : '?', {
        size: 15,
        color: fired ? (dead ? BANG : SAFE) : '#fff',
        line: fired ? (dead ? BANG : SAFE) : undefined,
        glow: fired ? (dead ? BANG : SAFE) : undefined,
      });
    },
  };
}

function emblem(S, cx, cy) {
  const { g, p, last, res } = S;
  const rot = last ? 0 : p * D.TAU * 2.6;
  g.save();
  g.beginPath();
  g.arc(cx, cy, 30, 0, D.TAU);
  const gr = g.createRadialGradient(cx - 8, cy - 8, 3, cx, cy, 30);
  gr.addColorStop(0, '#9A8BC4');
  gr.addColorStop(1, '#2A1B4D');
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = '#E9D5FF';
  g.stroke();
  for (let q = 0; q < 6; q++) {
    const a = -Math.PI / 2 + rot + (q * Math.PI) / 3;
    g.beginPath();
    g.arc(cx + Math.cos(a) * 17, cy + Math.sin(a) * 17, 6, 0, D.TAU);
    g.fillStyle = last && res && res.chambers && res.chambers[q] ? '#F59E0B' : '#0B0418';
    g.fill();
  }
  g.beginPath();
  g.arc(cx, cy, 4.5, 0, D.TAU);
  g.fillStyle = '#E9D5FF';
  g.fill();
  g.restore();
}

module.exports = { key: 'russian', title: 'Roulette russe', theme, gif, emblem };
