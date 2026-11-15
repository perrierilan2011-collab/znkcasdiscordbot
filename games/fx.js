'use strict';
/*
 * games/fx.js — ZNK Casino
 * ---------------------------------------------------------------------------
 * Animation "douce" des interfaces (images/*.png) -> GIF en boucle, sans dépendance.
 *
 * Effets (discrets, volontairement) :
 *   1) étoiles qui scintillent (positions dans games/fx-map.json)
 *   2) halo qui pulse autour du bouton rond en haut à droite
 *   3) un reflet lumineux qui glisse sur les néons / bordures (jamais sur les zones de texte :
 *      le masque est calculé sur l'image de fond VIDE, pas sur la carte finale)
 *
 * Le texte, l'avatar et les icônes dessinés par le bot ne bougent pas.
 *
 * Utilisation (dans le bot) :
 *   const buf = await fx.animateCard(canvasLib, canvas, 'win_notification.png', IMG_DIR); // Buffer GIF ou null
 */
const fs = require('fs');
const path = require('path');
const { createEncoder } = require('./gif');

let MAP = {};
try {
  MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'fx-map.json'), 'utf8'));
} catch {
  MAP = {};
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Prépare les masques à partir du fond vide (rgba w*h)
function prepare(base, w, h, entry) {
  const n = w * h;
  let cnt = 0;
  const tmpW = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = base[j], g = base[j + 1], b = base[j + 2];
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (mx < 120) continue;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    const m = smooth(0.5, 0.85, mx / 255) * smooth(0.22, 0.5, (mx - mn) / mx);
    if (m > 0.03) {
      tmpW[i] = m;
      cnt++;
    }
  }
  const gIdx = new Int32Array(cnt);
  const gW = new Float32Array(cnt);
  const gU = new Float32Array(cnt);
  for (let i = 0, k = 0; i < n; i++) {
    if (tmpW[i] > 0) {
      gIdx[k] = i;
      gW[k] = tmpW[i];
      gU[k] = (i % w) / w + (0.35 * ((i / w) | 0)) / h;
      k++;
    }
  }

  // étoiles (x, y normalisés ; r = demi-taille normalisée sur la largeur)
  const stars = (entry.stars || []).map(([x, y, r], i) => ({
    x: x * w,
    y: y * h,
    r: Math.max(5, r * w),
    phase: ((i * 0.6180339) % 1),
    freq: i % 3 === 2 ? 2 : 1,
  }));

  // halo du bouton rond
  let ring = null;
  if (entry.ring) {
    const [cx, cy, rr] = entry.ring;
    const R = rr * w;
    const x0 = Math.max(0, Math.floor(cx * w - R * 1.3)), x1 = Math.min(w - 1, Math.ceil(cx * w + R * 1.3));
    const y0 = Math.max(0, Math.floor(cy * h - R * 1.3)), y1 = Math.min(h - 1, Math.ceil(cy * h + R * 1.3));
    const idx = [], wt = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx * w, y - cy * h) / R;
        const v = Math.exp(-(((d - 0.93) / 0.11) ** 2));
        if (v > 0.04) {
          idx.push(y * w + x);
          wt.push(v);
        }
      }
    }
    ring = { idx: Int32Array.from(idx), wt: Float32Array.from(wt) };
  }
  return { gIdx, gW, gU, stars, ring };
}

// écran : px += (255 - px) * k  (teinte c)
function screen(px, j, k, cr, cg, cb) {
  px[j] += (cr - px[j]) * k;
  px[j + 1] += (cg - px[j + 1]) * k;
  px[j + 2] += (cb - px[j + 2]) * k;
}

function applyFrame(px, w, h, M, t, o) {
  // 1) reflet qui glisse (actif sur 68 % de la boucle, puis pause)
  const ACTIVE = 0.68;
  if (t < ACTIVE && M.gIdx.length) {
    const p = smooth(0, 1, t / ACTIVE);
    const c = -0.3 + p * 1.95;
    const sig = 0.1;
    const gain = o.sweep;
    const { gIdx, gW, gU } = M;
    for (let k = 0; k < gIdx.length; k++) {
      const d = (gU[k] - c) / sig;
      if (d > 2.5 || d < -2.5) continue;
      const kk = Math.exp(-d * d) * gW[k] * gain;
      if (kk > 0.01) screen(px, gIdx[k] * 4, kk, 240, 205, 255);
    }
  }
  // 2) halo du bouton
  if (M.ring) {
    const pulse = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
    const { idx, wt } = M.ring;
    const gain = o.ring * pulse;
    for (let k = 0; k < idx.length; k++) screen(px, idx[k] * 4, wt[k] * gain, 235, 175, 255);
  }
  // 3) étoiles
  for (const s of M.stars) {
    const sv = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t * s.freq + s.phase));
    const e = sv * sv;
    const R = Math.ceil(s.r * 2.2);
    const x0 = Math.max(0, Math.floor(s.x - R)), x1 = Math.min(w - 1, Math.ceil(s.x + R));
    const y0 = Math.max(0, Math.floor(s.y - R)), y1 = Math.min(h - 1, Math.ceil(s.y + R));
    for (let y = y0; y <= y1; y++) {
      const dy = y - s.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x - s.x;
        const arm = Math.max(
          Math.exp(-((dy / (0.13 * R)) ** 2)) * Math.exp(-2 * (dx / R) ** 2),
          Math.exp(-((dx / (0.13 * R)) ** 2)) * Math.exp(-2 * (dy / R) ** 2)
        );
        const core = Math.exp(-((dx * dx + dy * dy) / (0.3 * R) ** 2));
        const j = (y * w + x) * 4;
        // léger "éteint" du cœur quand l'étoile est au repos, puis éclat
        const dim = 1 - 0.28 * (1 - sv) * core;
        px[j] *= dim; px[j + 1] *= dim; px[j + 2] *= dim;
        const k = Math.min(1, (arm * 0.9 + core * 0.6) * e * o.star);
        if (k > 0.01) screen(px, j, k, 255, 240, 255);
      }
    }
  }
}

const DEFAULTS = { frames: 32, delay: 7, sweep: 0.36, ring: 0.3, star: 1.0 };

// final / base : RGBA (Uint8ClampedArray ou Buffer) w*h*4 ; retourne un Buffer GIF (boucle infinie)
async function encode(finalRgba, baseRgba, w, h, file, opts = {}) {
  const entry = MAP[file];
  if (!entry) return null;
  const o = { ...DEFAULTS, ...opts };
  const M = prepare(baseRgba, w, h, entry);
  const enc = createEncoder(w, h, { loop: 0 });
  const px = new Float32Array(w * h * 4);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let f = 0; f < o.frames; f++) {
    for (let i = 0; i < px.length; i++) px[i] = finalRgba[i];
    applyFrame(px, w, h, M, f / o.frames, o);
    for (let i = 0; i < px.length; i++) out[i] = px[i] + 0.5;
    enc.add(out, o.delay);
    if (f % 4 === 3) await new Promise((r) => setImmediate(r)); // ne bloque pas le bot
  }
  return enc.finish();
}

const _baseCache = new Map();
async function getBase(canvasLib, file, imgDir, w, h) {
  const key = `${file}|${w}x${h}`;
  if (_baseCache.has(key)) return _baseCache.get(key);
  const img = await canvasLib.loadImage(fs.readFileSync(path.join(imgDir, file)));
  const cv = canvasLib.createCanvas(w, h);
  const g = cv.getContext('2d');
  // même recadrage "cover" que le bot
  const k = Math.max(w / img.width, h / img.height);
  const sw = w / k, sh = h / k;
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  _baseCache.set(key, data);
  return data;
}

const MAX_BYTES = 7.5 * 1024 * 1024;
// canvas du bot -> Buffer GIF animé, ou null (le bot garde alors son PNG)
async function animateCard(canvasLib, cv, file, imgDir, opts = {}) {
  try {
    if (!MAP[file] || !canvasLib) return null;
    const w = cv.width, h = cv.height;
    const base = await getBase(canvasLib, file, imgDir, w, h);
    const fin = cv.getContext('2d').getImageData(0, 0, w, h).data;
    let buf = await encode(fin, base, w, h, file, opts);
    if (buf && buf.length > MAX_BYTES) buf = await encode(fin, base, w, h, file, { ...opts, frames: 16, delay: 14 });
    return buf && buf.length <= MAX_BYTES ? buf : null;
  } catch (e) {
    console.warn('[fx] animation impossible, image fixe conservée :', e?.message || e);
    return null;
  }
}

module.exports = { animateCard, encode, MAP };
