'use strict';
const D = require('./draw');

const CW = 86;
const CH = 118;

const theme = { c0: '#3D1170', c1: '#0F0426', rim: 'rgba(240,171,252,0.85)', spot: 'rgba(240,171,252,0.22)', pattern: 'diamond' };

function build(res, ctx) {
  const win = ctx.outcome === 'win';
  const tie = res.me.v === res.dealer.v;
  const plan = [
    { me: 0, dl: 0, near: 0, cap: 'Les cartes sont distribuées' },
    { me: 0.34, dl: 0, near: 0.6, cap: 'Tu retournes ta carte...' },
    { me: 1, dl: 0, near: 1, cap: `Ta carte : ${res.me.r}` },
    { me: 1, dl: 0.34, near: 1, cap: 'Le croupier retourne la sienne...' },
    { me: 1, dl: 1, near: 1, cap: `Croupier : ${res.dealer.r}` },
    { me: 1, dl: 1, near: 1, hl: true, cap: win ? 'Tu gagnes le duel !' : tie ? 'Égalité : le croupier gagne' : "Le croupier l'emporte" },
  ];
  const n = plan.length;
  const frames = plan.map((f, k) => ({
    cap: f.cap,
    ms: k === n - 1 ? 1300 : 850,
    draw(S) {
      const { g, w, h, cx } = S;
      const y = (h - CH) / 2 + 8;
      const gap = k === 0 ? 210 : 170;
      const xm = cx - gap - CW / 2;
      const xd = cx + gap - CW / 2;
      const meGlow = f.hl && win ? S.accent || '#86EFAC' : null;
      const dlGlow = f.hl && !win ? '#FCA5A5' : null;
      // halos
      D.floorGlow(g, xm + CW / 2, y + CH, 90, 16, 'rgba(240,171,252,0.35)');
      D.floorGlow(g, xd + CW / 2, y + CH, 90, 16, 'rgba(240,171,252,0.35)');
      D.drawCard(g, xm, y, CW, CH, res.me, { flip: f.me, glow: meGlow, alpha: f.hl && !win ? 0.5 : 1, rot: f.me > 0 && f.me < 1 ? -0.06 : -0.02 });
      D.drawCard(g, xd, y, CW, CH, res.dealer, { flip: f.dl, glow: dlGlow, alpha: f.hl && win ? 0.5 : 1, rot: f.dl > 0 && f.dl < 1 ? 0.06 : 0.02 });
      // médaillon VS
      g.save();
      g.beginPath();
      g.arc(cx, h / 2 + 2, 28, 0, D.TAU);
      const vg = g.createRadialGradient(cx - 6, h / 2 - 6, 3, cx, h / 2 + 2, 30);
      vg.addColorStop(0, '#C026D3');
      vg.addColorStop(1, '#4A044E');
      g.fillStyle = vg;
      g.shadowColor = '#E879F9';
      g.shadowBlur = f.hl ? 22 : 12;
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = 2.2;
      g.strokeStyle = '#F5D0FE';
      g.stroke();
      g.restore();
      D.text(g, 'VS', cx, h / 2 + 3, { size: 20, glow: '#F0ABFC' });
      // plaques
      D.plate(g, xm + CW / 2, 17, 106, 'TOI', f.me >= 0.5 ? res.me.r : '?', { line: meGlow || undefined, glow: meGlow });
      D.plate(g, xd + CW / 2, 17, 128, 'CROUPIER', f.dl >= 0.5 ? res.dealer.r : '?', { line: dlGlow || undefined, glow: dlGlow });
      // verdict
      if (f.hl) {
        const label = win ? 'GAGNÉ' : tie ? 'ÉGALITÉ' : 'PERDU';
        D.plate(g, win ? xm + CW / 2 : xd + CW / 2, h - 14, 90, label, '', {
          fill: win ? 'rgba(22,101,52,0.85)' : 'rgba(127,29,29,0.85)',
          line: win ? '#86EFAC' : '#FCA5A5',
          color: '#fff',
        });
      }
      void w;
    },
  }));
  return { frames };
}


// ---------- GIF : les cartes glissent, se retournent l'une après l'autre, le verdict tombe ----------
const smooth = (a, b, x) => {
  const u = D.clamp((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const backOut = (u) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};

function gif(res, ctx) {
  const win = ctx.outcome === 'win';
  const tie = res.me.v === res.dealer.v;
  const GREEN = '#86EFAC';
  const RED = '#FCA5A5';
  // instants clés (0..1)
  const DEAL = [0.02, 0.22]; // les cartes glissent jusqu'à la table
  const FLIP_ME = [0.36, 0.52];
  const FLIP_DL = [0.6, 0.76];
  const VERDICT = 0.8;
  return {
    dur: 4.6,
    hold: 200,
    cap: (t) =>
      t < DEAL[1] ? 'Les cartes sont distribuées' :
      t < FLIP_ME[0] ? 'Deux cartes face cachée...' :
      t < FLIP_ME[1] ? 'Tu retournes ta carte...' :
      t < FLIP_DL[0] ? `Ta carte : ${res.me.r}` :
      t < FLIP_DL[1] ? 'Le croupier retourne la sienne...' :
      t < VERDICT ? `Croupier : ${res.dealer.r}` :
      win ? 'Tu gagnes le duel !' : tie ? 'Égalité : le croupier gagne' : 'Le croupier l’emporte',
    draw(S, t) {
      const { g, w, h, cx } = S;
      const y0 = (h - CH) / 2 + 8;
      const xm = cx - 170 - CW / 2;
      const xd = cx + 170 - CW / 2;

      // entrée : glissement depuis les bords + léger rebond
      const din = smooth(DEAL[0], DEAL[1], t);
      const slide = backOut(D.clamp((t - DEAL[0]) / (DEAL[1] - DEAL[0])));
      const meX = -CW - 20 + (xm + CW + 20) * slide;
      const dlX = w + 20 - (w + 20 - xd) * slide;

      // retournement (0 = dos, 1 = face) avec petit saut
      const fm = smooth(FLIP_ME[0], FLIP_ME[1], t);
      const fd = smooth(FLIP_DL[0], FLIP_DL[1], t);
      const liftM = Math.sin(Math.PI * fm) * 14;
      const liftD = Math.sin(Math.PI * fd) * 14;
      // respiration de la carte avant son tour (tension)
      const idleM = t >= DEAL[1] && t < FLIP_ME[0] ? Math.sin(t * 60) * 1.6 : 0;
      const idleD = t >= FLIP_ME[1] && t < FLIP_DL[0] ? Math.sin(t * 60) * 1.6 : 0;

      const verdict = t >= VERDICT;
      const vk = D.clamp((t - VERDICT) / 0.12);
      const meGlow = verdict && win ? GREEN : null;
      const dlGlow = verdict && !win ? RED : null;

      // halos au sol
      g.save();
      g.globalAlpha = din;
      D.floorGlow(g, xm + CW / 2, y0 + CH + 2, 90, 16, 'rgba(240,171,252,0.35)');
      D.floorGlow(g, xd + CW / 2, y0 + CH + 2, 90, 16, 'rgba(240,171,252,0.35)');
      g.restore();

      // traînée pendant le glissement
      if (t > DEAL[0] && t < DEAL[1] - 0.02) {
        for (const [off, a] of [[26, 0.12], [13, 0.22]]) {
          D.drawCard(g, meX - off, y0, CW, CH, res.me, { flip: 0, alpha: a, rot: -0.04 });
          D.drawCard(g, dlX + off, y0, CW, CH, res.dealer, { flip: 0, alpha: a, rot: 0.04 });
        }
      }

      const dim = (loser) => (verdict && loser ? 1 - 0.5 * vk : 1);
      D.drawCard(g, meX, y0 - liftM + idleM, CW, CH, res.me, {
        flip: fm, glow: meGlow, alpha: dim(!win),
        rot: fm > 0 && fm < 1 ? -0.07 * Math.sin(Math.PI * fm) - 0.02 : -0.02,
      });
      D.drawCard(g, dlX, y0 - liftD + idleD, CW, CH, res.dealer, {
        flip: fd, glow: dlGlow, alpha: dim(win),
        rot: fd > 0 && fd < 1 ? 0.07 * Math.sin(Math.PI * fd) + 0.02 : 0.02,
      });

      // éclat à l'instant où chaque carte se retourne
      for (const [a, b, px] of [[FLIP_ME[1] - 0.02, FLIP_ME[1] + 0.07, xm + CW / 2], [FLIP_DL[1] - 0.02, FLIP_DL[1] + 0.07, xd + CW / 2]]) {
        if (t > a && t < b) {
          const k = (t - a) / (b - a);
          for (let s = 0; s < 6; s++) {
            const an = (s / 6) * D.TAU + 0.4;
            D.spark(g, px + Math.cos(an) * (CW * 0.7 + k * 26), y0 + CH / 2 + Math.sin(an) * (CH * 0.5 + k * 16), 4 * (1 - k * 0.5), '#F5D0FE', 1 - k);
          }
        }
      }

      // médaillon VS (bat plus fort à l'approche du verdict)
      const beat = t > FLIP_DL[0] && !verdict ? 1 + 0.12 * Math.sin(t * 90) : 1;
      g.save();
      g.globalAlpha = din;
      g.translate(cx, h / 2 + 2);
      g.scale(beat, beat);
      g.beginPath();
      g.arc(0, 0, 28, 0, D.TAU);
      const vg = g.createRadialGradient(-6, -8, 3, 0, 0, 30);
      vg.addColorStop(0, '#C026D3');
      vg.addColorStop(1, '#4A044E');
      g.fillStyle = vg;
      g.shadowColor = '#E879F9';
      g.shadowBlur = verdict ? 24 : 12;
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = 2.2;
      g.strokeStyle = '#F5D0FE';
      g.stroke();
      g.restore();
      D.text(g, 'VS', cx, h / 2 + 3, { size: 20 * beat, glow: '#F0ABFC', alpha: din });

      // plaques nominatives
      g.save();
      g.globalAlpha = din;
      D.plate(g, xm + CW / 2, 17, 106, 'TOI', fm >= 0.5 ? res.me.r : '?', { line: meGlow || undefined, glow: meGlow });
      D.plate(g, xd + CW / 2, 17, 128, 'CROUPIER', fd >= 0.5 ? res.dealer.r : '?', { line: dlGlow || undefined, glow: dlGlow });
      g.restore();

      // verdict : la plaque grandit sous le gagnant
      if (verdict) {
        const label = win ? 'GAGNÉ' : tie ? 'ÉGALITÉ' : 'PERDU';
        const px = win ? xm + CW / 2 : xd + CW / 2;
        const sc = backOut(vk);
        g.save();
        g.translate(px, h - 14);
        g.scale(sc, sc);
        D.plate(g, 0, 0, 96, label, '', {
          fill: win ? 'rgba(22,101,52,0.9)' : 'rgba(127,29,29,0.9)',
          line: win ? GREEN : RED,
          color: '#fff',
          glow: win ? GREEN : RED,
        });
        g.restore();
        if (win) {
          for (let s = 0; s < 8; s++) {
            const an = (s / 8) * D.TAU + t * 3;
            D.spark(g, xm + CW / 2 + Math.cos(an) * 66, y0 + CH / 2 + Math.sin(an) * 70, 3.4, '#BBF7D0', 0.9 * vk);
          }
        }
      }
    },
  };
}

function emblem(S, cx, cy) {
  const { g, p, res } = S;
  const sw = Math.sin(p * Math.PI) * 6;
  D.drawCard(g, cx - 34 - sw, cy - 30, 36, 52, res && res.me, { flip: S.last ? 1 : 0, rot: -0.2 });
  D.drawCard(g, cx - 2 + sw, cy - 22, 36, 52, res && res.dealer, { flip: S.last ? 1 : 0, rot: 0.2 });
}

module.exports = { key: 'duel', title: 'Duel de cartes', theme, build, gif, emblem };
