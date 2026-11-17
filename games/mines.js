'use strict';
const D = require('./draw');

const COLS = 8;
const ROWS = 3;
const CWD = 62;
const CHT = 42;
const GX = 6;
const GY = 7;

const theme = { c0: '#1B1048', c1: '#080320', rim: 'rgba(103,232,249,0.8)', spot: 'rgba(103,232,249,0.14)', pattern: 'dots' };

function tile(g, x, y, kind, o = {}) {
  // kind : hidden | gem | gemDim | mine | mineDim | hit
  g.save();
  D.rr(g, x, y, CWD, CHT, 9);
  let c0 = '#6D3BD0';
  let c1 = '#3A1C7A';
  let line = 'rgba(216,180,254,0.7)';
  if (kind === 'gem') {
    c0 = '#0E7490';
    c1 = '#083344';
    line = 'rgba(103,232,249,0.95)';
  } else if (kind === 'gemDim') {
    c0 = '#13324A';
    c1 = '#0A1B2E';
    line = 'rgba(103,232,249,0.3)';
  } else if (kind === 'mine') {
    c0 = '#7F1D3A';
    c1 = '#3B0A1A';
    line = 'rgba(252,165,165,0.6)';
  } else if (kind === 'hit') {
    c0 = '#E11D48';
    c1 = '#7F1230';
    line = '#FECACA';
  }
  const gr = g.createLinearGradient(0, y, 0, y + CHT);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  g.fillStyle = gr;
  if (kind === 'hit' && o.pulse) {
    g.shadowColor = '#F43F5E';
    g.shadowBlur = 24;
  } else if (kind === 'gem' && o.glow) {
    g.shadowColor = o.glow;
    g.shadowBlur = 14;
  }
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = kind === 'hit' ? 2.2 : 1.3;
  g.strokeStyle = line;
  g.stroke();
  // biseau haut
  if (kind === 'hidden') {
    D.rr(g, x + 2, y + 2, CWD - 4, CHT * 0.42, 7);
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fill();
  }
  g.restore();
}

function build(res, ctx) {
  const data = ctx.data || {};
  const revealed = new Set(data.revealed || []);
  const mines = new Set(data.mines || []);
  const hit = data.hit == null ? null : data.hit;
  const total = COLS * ROWS;
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
      const gw = COLS * CWD + (COLS - 1) * GX;
      const x0 = (w - gw) / 2;
      const y0 = (h - (ROWS * CHT + (ROWS - 1) * GY)) / 2 + 4;
      const shown = new Set(rest.slice(0, Math.round(rest.length * f.reveal)));
      const showHit = f.showHit && hit != null;

      // onde de choc derrière la case touchée
      if (showHit && f.pulse) {
        const hx = x0 + (hit % COLS) * (CWD + GX) + CWD / 2;
        const hy = y0 + Math.floor(hit / COLS) * (CHT + GY) + CHT / 2;
        for (let r = 0; r < 3; r++) {
          g.beginPath();
          g.arc(hx, hy, 30 + r * 26, 0, D.TAU);
          g.lineWidth = 3 - r * 0.8;
          g.strokeStyle = `rgba(251,113,133,${0.55 - r * 0.15})`;
          g.stroke();
        }
        for (let a = 0; a < 12; a++) {
          const an = (a / 12) * D.TAU;
          g.beginPath();
          g.moveTo(hx + Math.cos(an) * 26, hy + Math.sin(an) * 26);
          g.lineTo(hx + Math.cos(an) * 52, hy + Math.sin(an) * 52);
          g.lineWidth = 2.4;
          g.strokeStyle = 'rgba(253,186,116,0.7)';
          g.stroke();
        }
      }

      for (let i = 0; i < total; i++) {
        const x = x0 + (i % COLS) * (CWD + GX);
        const y = y0 + Math.floor(i / COLS) * (CHT + GY);
        const cx = x + CWD / 2;
        const cy = y + CHT / 2;
        const isHit = i === hit && showHit;
        const isRev = revealed.has(i);
        const isShown = shown.has(i);
        const isMine = mines.has(i);
        let kind = 'hidden';
        if (isRev) kind = 'gem';
        else if (isHit) kind = 'hit';
        else if (isShown) kind = isMine ? 'mine' : 'gemDim';
        tile(g, x, y, kind, { pulse: f.pulse, glow: f.hl && S.accent ? S.accent : null });
        if (isRev) D.drawGem(g, cx, cy, 26);
        else if (isHit) D.drawBomb(g, cx, cy, 30);
        else if (isShown) {
          if (isMine) D.drawBomb(g, cx, cy, 24, { alpha: 0.85 });
          else D.drawGem(g, cx, cy, 20, { alpha: 0.35 });
        } else D.spark(g, cx, cy, 5, '#E9D5FF', 0.55);
      }
      // en-têtes
      const found = revealed.size;
      D.hud(g, 12, 12, 58, 44, 'Gemmes', String(found), { color: '#67E8F9', line: 'rgba(103,232,249,0.7)' });
      D.hud(g, w - 70, 12, 58, 44, 'Mines', String(mines.size), { color: '#FCA5A5', line: 'rgba(252,165,165,0.7)' });
    },
  }));
  return { frames };
}

function emblem(S, cx, cy) {
  const data = S.data || {};
  if (data.hit != null && S.k >= 1) D.drawBomb(S.g, cx, cy, 52);
  else D.drawGem(S.g, cx, cy, 52 + (S.last ? 0 : Math.sin(S.p * 9) * 3));
}

module.exports = { key: 'mines', title: 'Mines', theme, build, emblem };
