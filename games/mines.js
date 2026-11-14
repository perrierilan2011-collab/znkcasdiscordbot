'use strict';
const D = require('./draw');

const COLS = 8;
const ROWS = 3;
const CWD = 64;
const CHT = 26;
const GX = 6;
const GY = 4;

function build(res, ctx) {
  const data = ctx.data || {};
  const revealed = new Set(data.revealed || []);
  const mines = new Set(data.mines || []);
  const hit = data.hit == null ? null : data.hit;
  const total = COLS * ROWS;
  // ordre de révélation des cases restantes (mélangé)
  const rnd = D.mulberry((Date.now() & 0xffff) + total);
  const rest = [];
  for (let i = 0; i < total; i++) if (!revealed.has(i) && i !== hit) rest.push(i);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const boom = hit != null;
  const plan = [
    { showHit: false, reveal: 0, cap: boom ? 'Tu ouvres une case...' : 'Tu encaisses tes diamants' },
    { showHit: true, pulse: true, reveal: 0, cap: boom ? 'Boom ! Une mine !' : 'Les diamants brillent' },
    { showHit: true, reveal: 0.5, cap: 'Le plateau se dévoile...' },
    { showHit: true, reveal: 1, cap: 'Voici toutes les mines' },
    { showHit: true, reveal: 1, cap: boom ? 'Partie perdue' : 'Partie encaissée', hl: true },
  ];
  const n = plan.length;
  const frames = plan.map((f, k) => ({
    cap: f.cap,
    ms: k === n - 1 ? 1300 : 900,
    draw(S) {
      const { g, w, h } = S;
      const x0 = (w - (COLS * CWD + (COLS - 1) * GX)) / 2;
      const y0 = (h - (ROWS * CHT + (ROWS - 1) * GY)) / 2;
      const shown = new Set(rest.slice(0, Math.round(rest.length * f.reveal)));
      for (let i = 0; i < total; i++) {
        const x = x0 + (i % COLS) * (CWD + GX);
        const y = y0 + Math.floor(i / COLS) * (CHT + GY);
        const cx = x + CWD / 2;
        const cy = y + CHT / 2;
        const isHit = i === hit && f.showHit;
        const isRev = revealed.has(i);
        const isShown = shown.has(i);
        const isMine = mines.has(i);
        g.save();
        D.rr(g, x, y, CWD, CHT, 8);
        let fill = 'rgba(168,85,247,0.28)';
        let line = 'rgba(192,132,252,0.55)';
        if (isRev) {
          fill = 'rgba(103,232,249,0.22)';
          line = 'rgba(103,232,249,0.85)';
        } else if (isHit) {
          fill = 'rgba(244,63,94,0.6)';
          line = '#FCA5A5';
        } else if (isShown) {
          fill = isMine ? 'rgba(244,63,94,0.2)' : 'rgba(103,232,249,0.08)';
          line = isMine ? 'rgba(252,165,165,0.55)' : 'rgba(103,232,249,0.3)';
        }
        if (isHit && f.pulse) {
          g.shadowColor = '#F43F5E';
          g.shadowBlur = 20;
        }
        g.fillStyle = fill;
        g.fill();
        g.lineWidth = isHit ? 2 : 1.2;
        g.strokeStyle = line;
        g.stroke();
        g.restore();
        if (isRev) D.drawGem(g, cx, cy, 20, { glow: f.hl && S.accent ? S.accent : undefined });
        else if (isHit) D.drawBomb(g, cx, cy, 22);
        else if (isShown) {
          if (isMine) D.drawBomb(g, cx, cy, 17, { alpha: 0.75 });
          else D.drawGem(g, cx, cy, 15, { alpha: 0.4 });
        } else D.spark(g, cx, cy, 5, '#E9D5FF', 0.5);
      }
    },
  }));
  return { frames };
}

function emblem(S, cx, cy) {
  const data = S.data || {};
  if (data.hit != null && S.k >= 1) D.drawBomb(S.g, cx, cy, 52);
  else D.drawGem(S.g, cx, cy, 52 + (S.last ? 0 : Math.sin(S.p * 9) * 3));
}

module.exports = { key: 'mines', title: 'Mines', build, emblem };
