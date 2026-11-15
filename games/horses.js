'use strict';
const D = require('./draw');

const LANE_Y0 = 14;
const LANE_H = 28;
const START_X = 130;
const FINISH_X = 640;
const NOSE = 22; // distance centre -> nez du cheval (à l'échelle 1)
const SCALE = 1.12;

const SILKS = ['#F43F5E', '#22D3EE', '#FBBF24', '#A3E635', '#C084FC'];
const COATS = ['#B4693A', '#E0B77E', '#7A74A8', '#F3F4F6', '#9A6A45'];

const theme = { c0: '#2A0F4F', c1: '#0B0421', rim: 'rgba(253,230,138,0.85)', spot: 'rgba(253,230,138,0.12)', pattern: null };

// cheval vu de profil, qui galope (phase = cycle des jambes)
function drawHorse(g, x, groundY, phase, coat, silk, moving) {
  const s = SCALE;
  const bob = moving ? Math.sin(phase * 2) * 1.3 : 0;
  g.save();
  g.translate(x, groundY + bob);
  g.scale(s, s);

  // ombre
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(0, 1.5 - bob / s, 15, 2.4, 0, 0, D.TAU);
  g.fill();

  // jambes (arrière puis avant) : deux segments qui plient
  const leg = (hx, off, back) => {
    const a = moving ? Math.sin(phase + off) * 0.75 : 0;
    const bend = moving ? (Math.cos(phase + off) * 0.5 + 0.35) * (back ? -1 : 1) : 0;
    const kx = hx + Math.sin(a) * 6.5;
    const ky = -6 + Math.cos(a) * 6.5;
    const fx = kx + Math.sin(a + bend) * 6.2;
    const fy = ky + Math.cos(a + bend) * 6.2;
    g.beginPath();
    g.moveTo(hx, -7);
    g.lineTo(kx, ky);
    g.lineTo(fx, Math.min(0, fy));
    g.stroke();
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  leg(-7, Math.PI, true);
  leg(9, Math.PI + 0.5, false);
  g.strokeStyle = coat;
  leg(-9, 0, true);
  leg(7, 0.5, false);

  // queue
  g.strokeStyle = 'rgba(30,20,40,0.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-11, -12);
  g.quadraticCurveTo(-19, -12 + (moving ? Math.sin(phase * 2 + 1) * 3 : 3), -22, -6 + (moving ? Math.sin(phase * 2) * 3 : 4));
  g.stroke();

  // corps
  g.fillStyle = coat;
  g.beginPath();
  g.ellipse(0, -12, 13, 6.2, 0, 0, D.TAU);
  g.fill();
  // encolure + tête
  g.beginPath();
  g.moveTo(7, -15);
  g.lineTo(13, -25);
  g.lineTo(19, -25);
  g.lineTo(23, -20);
  g.lineTo(19, -19);
  g.lineTo(16, -19);
  g.lineTo(12, -9);
  g.closePath();
  g.fill();
  // crinière
  g.strokeStyle = 'rgba(30,20,40,0.85)';
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(8, -16);
  g.lineTo(13.5, -25.5);
  g.stroke();
  // oreille + œil
  g.fillStyle = coat;
  g.beginPath();
  g.moveTo(15.5, -25);
  g.lineTo(16.5, -29);
  g.lineTo(18, -25);
  g.fill();
  g.fillStyle = '#12042A';
  g.beginPath();
  g.arc(18.2, -22.6, 0.9, 0, D.TAU);
  g.fill();

  // selle + jockey penché en avant
  g.fillStyle = silk;
  g.beginPath();
  g.ellipse(1, -19.5, 4.2, 5.2, 0.55, 0, D.TAU);
  g.fill();
  g.fillStyle = '#F5D0B5';
  g.beginPath();
  g.arc(6.2, -25.5, 2.5, 0, D.TAU);
  g.fill();
  g.fillStyle = silk;
  g.beginPath();
  g.arc(6.2, -26.3, 2.6, Math.PI, 0);
  g.fill();
  g.restore();
}

function checker(g, x, y0, y1) {
  const q = 4;
  for (let y = y0, r = 0; y < y1; y += q, r++) {
    for (let c = 0; c < 2; c++) {
      g.fillStyle = (r + c) % 2 ? '#FFFFFF' : '#1A0B3A';
      g.fillRect(x + c * q, y, q, Math.min(q, y1 - y));
    }
  }
}

function seedOf(res) {
  return ((res.winner || 0) * 97 + (res.want || 0) * 31 + 7) >>> 0;
}

function gif(res, ctx) {
  const winner = res.winner;
  const want = res.want;
  const horses = (ctx.data && ctx.data.horses) || null;
  const coef = ctx.coef || 1;
  const rnd = D.mulberry(seedOf(res));

  // écarts à l'arrivée : le gagnant à 0, les autres derrière (photo-finish pour le 2e)
  const gaps = [0.025 + rnd() * 0.03, 0.065 + rnd() * 0.04, 0.1 + rnd() * 0.04, 0.13 + rnd() * 0.04].sort(() => rnd() - 0.5);
  let gi = 0;
  const M = 260;
  const table = [];
  for (let i = 0; i < 5; i++) {
    const gap = i === winner ? 0 : gaps[gi++ % gaps.length];
    const amp = 0.03 + rnd() * 0.035;
    const k = 2 + Math.floor(rnd() * 3);
    const ph = rnd() * D.TAU;
    const row = new Float32Array(M + 1);
    let best = 0;
    for (let m = 0; m <= M; m++) {
      const u = m / M;
      const base = u < 0.1 ? (u * u) / 0.2 / 0.95 : (0.05 + (u - 0.1)) / 0.95; // accélération puis vitesse de croisière
      const v = base * (1 - gap * Math.pow(u, 2.2)) + amp * Math.sin(D.TAU * k * u + ph) * Math.sin(Math.PI * u) * 0.8;
      best = Math.max(best, v); // jamais de recul
      row[m] = best;
    }
    row[M] = 1 - gap;
    table.push(row);
  }
  const posAt = (i, u) => {
    const f = D.clamp(u) * M;
    const a = Math.floor(f);
    const b = Math.min(M, a + 1);
    return D.lerp(table[i][a], table[i][b], f - a);
  };

  const T_GO = 0.1;
  const T_FIN = 0.88;
  const L = FINISH_X - START_X - NOSE * SCALE;
  const laneC = (i) => LANE_Y0 + i * LANE_H + LANE_H / 2;

  return {
    dur: 6.4,
    cap: (t) => {
      if (t < T_GO) return 'Les chevaux sont aux boîtes';
      if (t < T_GO + 0.06) return 'Départ !';
      const u = (t - T_GO) / (T_FIN - T_GO);
      if (t >= T_FIN) return `Le cheval n°${winner + 1} gagne !`;
      return u < 0.3 ? 'Le peloton se forme' : u < 0.6 ? 'Ça se bat en tête' : u < 0.85 ? 'Dans la ligne droite' : 'Photo-finish...';
    },
    draw(S, t) {
      const { g, w } = S;
      const u = D.clamp((t - T_GO) / (T_FIN - T_GO));
      const racing = t >= T_GO && t < T_FIN;
      const over = t >= T_FIN;
      const coast = over ? 0.05 * D.ease((t - T_FIN) / 0.12) : 0; // après la ligne, ils ralentissent

      // couloirs
      for (let i = 0; i < 5; i++) {
        const y = LANE_Y0 + i * LANE_H;
        g.fillStyle = i % 2 ? 'rgba(150,100,230,0.10)' : 'rgba(150,100,230,0.2)';
        g.fillRect(70, y, w - 100, LANE_H);
        if (over && i === winner) {
          g.fillStyle = 'rgba(253,230,138,0.16)';
          g.fillRect(70, y, w - 100, LANE_H);
        }
      }
      // portillons de départ puis ligne d'arrivée
      g.fillStyle = 'rgba(255,255,255,0.55)';
      if (t < T_GO + 0.04) g.fillRect(START_X - 30, LANE_Y0, 3, LANE_H * 5);
      checker(g, FINISH_X, LANE_Y0, LANE_Y0 + LANE_H * 5);
      g.fillStyle = 'rgba(253,230,138,0.9)';
      D.text(g, 'ARRIVÉE', FINISH_X + 4, LANE_Y0 - 6, { size: 8, color: 'rgba(253,230,138,0.9)' });

      for (let i = 0; i < 5; i++) {
        const yc = laneC(i);
        const gy = yc + 12;
        const p = (racing || over ? posAt(i, u) : 0) + coast * (1 - (1 - posAt(i, 1)) * 0.0);
        const jitter = t < T_GO ? Math.sin(t * 90 + i * 2) * 0.9 : 0; // ça piaffe dans les boîtes
        const x = START_X + p * L + jitter;
        const moving = (racing || (over && coast < 0.048)) && t >= T_GO;
        const phase = (racing || over ? posAt(i, u) * 95 : 0) + (over ? (t - T_FIN) * 40 : 0) + i;

        // poussière
        if (moving) {
          for (let j = 1; j <= 3; j++) {
            g.beginPath();
            g.arc(x - 16 - j * 8, gy - 1 - Math.abs(Math.sin(phase + j)) * 2, 1.8 + j * 0.8, 0, D.TAU);
            g.fillStyle = `rgba(233,213,255,${0.24 / j})`;
            g.fill();
          }
        }
        drawHorse(g, x, gy, phase, COATS[i], SILKS[i], moving);

        // « TOI » au-dessus de son cheval
        if (i === want) {
          g.save();
          g.fillStyle = '#FFFFFF';
          g.shadowColor = '#FFFFFF';
          g.shadowBlur = 8;
          g.beginPath();
          g.moveTo(x + 6, yc - 12);
          g.lineTo(x + 2, yc - 17);
          g.lineTo(x + 10, yc - 17);
          g.closePath();
          g.fill();
          g.restore();
        }

        // pastille de couloir (à gauche) + gain (à droite)
        const mine = i === want;
        g.save();
        g.beginPath();
        g.arc(40, yc, 10, 0, D.TAU);
        g.fillStyle = SILKS[i];
        if (mine) {
          g.shadowColor = '#FFFFFF';
          g.shadowBlur = 10;
        }
        g.fill();
        g.lineWidth = mine ? 2.4 : 1.2;
        g.strokeStyle = mine ? '#FFFFFF' : 'rgba(255,255,255,0.5)';
        g.stroke();
        g.restore();
        D.text(g, i + 1, 40, yc + 0.5, { size: 12, color: '#1A0B3A' });
        if (horses && horses[i]) {
          const win = over && i === winner;
          D.text(g, `x${+(horses[i].mult * coef).toFixed(2)}`, w - 44, yc, {
            size: win ? 13 : 11,
            color: win ? S.accent || '#FDE68A' : 'rgba(233,213,255,0.7)',
            glow: win ? S.accent || '#FDE68A' : null,
          });
        }
      }

      // bannière de départ
      if (t < T_GO + 0.07) {
        const go = t >= T_GO;
        D.text(g, go ? 'PARTEZ !' : 'PRÊTS...', 364, 8, { size: 12, color: go ? '#86EFAC' : '#FDE68A', glow: go ? '#86EFAC' : '#FDE68A' });
      }
    },
  };
}

function emblem(S, cx, cy) {
  const { g, p } = S;
  g.save();
  g.rotate(Math.sin(p * 5) * 0.12);
  const gr = g.createLinearGradient(-22, -22, 22, 22);
  gr.addColorStop(0, '#FFFFFF');
  gr.addColorStop(1, '#A78BDA');
  g.strokeStyle = gr;
  g.lineWidth = 8;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(0, -2, 20, Math.PI / 2 + 0.6, Math.PI / 2 - 0.6 + D.TAU);
  g.stroke();
  g.fillStyle = '#2E1065';
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + 0.95 + (k * (D.TAU - 1.9)) / 5;
    g.beginPath();
    g.arc(Math.cos(a) * 20, -2 + Math.sin(a) * 20, 1.6, 0, D.TAU);
    g.fill();
  }
  g.restore();
}

module.exports = { key: 'horses', title: 'Course de chevaux', theme, gif, emblem };
