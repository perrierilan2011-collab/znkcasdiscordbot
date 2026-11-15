'use strict';
/*
 * games/gif.js — ZNK Casino
 * ---------------------------------------------------------------------------
 * Encodeur GIF89a en JavaScript pur (aucune dépendance à installer).
 *
 *  - palette globale de 255 couleurs (median cut) + 1 index transparent
 *  - frames différentielles : seuls les pixels qui changent sont ré-encodés
 *    (le gabarit violet, l'avatar et l'en-tête ne pèsent presque rien)
 *  - lecture UNE seule fois (pas d'extension de boucle) : la dernière image reste affichée
 *
 * Utilisation :
 *   const enc = createEncoder(800, 400);
 *   enc.add(rgbaUint8Array, delaiEnCentiemes);   // pour chaque image
 *   const buffer = enc.finish();                 // Buffer .gif
 */

const TRANSPARENT = 255;

// ---------------------------------------------------------------------------
//  Palette : median cut sur un histogramme 5-5-5 bits
// ---------------------------------------------------------------------------
function medianCut(hist, nColors) {
  const keys = [];
  for (let i = 0; i < hist.length; i++) if (hist[i]) keys.push(i);
  const rOf = (k) => (k >> 10) & 31;
  const gOf = (k) => (k >> 5) & 31;
  const bOf = (k) => k & 31;
  const to8 = (v) => Math.round((v * 255) / 31);

  const makeBox = (list) => {
    let rMin = 31, rMax = 0, gMin = 31, gMax = 0, bMin = 31, bMax = 0, total = 0;
    for (const k of list) {
      const r = rOf(k), g = gOf(k), b = bOf(k);
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
      if (g < gMin) gMin = g;
      if (g > gMax) gMax = g;
      if (b < bMin) bMin = b;
      if (b > bMax) bMax = b;
      total += hist[k];
    }
    const rr = rMax - rMin, gr = gMax - gMin, br = bMax - bMin;
    const range = Math.max(rr, gr, br);
    const axis = range === rr ? 0 : range === gr ? 1 : 2;
    return { list, total, range, axis, score: range * Math.sqrt(total) };
  };

  if (!keys.length) return [[0, 0, 0]];
  let boxes = [makeBox(keys)];
  while (boxes.length < nColors) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].list.length > 1 && boxes[i].score > bestScore) {
        bestScore = boxes[i].score;
        best = i;
      }
    }
    if (best < 0) break;
    const box = boxes[best];
    const ch = box.axis === 0 ? rOf : box.axis === 1 ? gOf : bOf;
    const sorted = box.list.slice().sort((a, b) => ch(a) - ch(b));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length; i++) {
      acc += hist[sorted[i]];
      if (acc >= box.total / 2) {
        cut = Math.min(Math.max(i + 1, 1), sorted.length - 1);
        break;
      }
    }
    boxes.splice(best, 1, makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut)));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const k of box.list) {
      const c = hist[k];
      r += rOf(k) * c;
      g += gOf(k) * c;
      b += bOf(k) * c;
    }
    return [to8(r / box.total), to8(g / box.total), to8(b / box.total)];
  });
}

// ---------------------------------------------------------------------------
//  Compression LZW (variante GIF) — même découpage de codes que omggif
// ---------------------------------------------------------------------------
function lzwEncode(pixels, start, count, minCode, ctx) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let next = eoi + 1;
  let size = minCode + 1;
  let stamp = ++ctx.stamp;
  const { table, seen } = ctx;
  let out = ctx.out;
  let p = 0;
  let cur = 0;
  let shift = 0;

  const put = (code) => {
    cur |= code << shift;
    shift += size;
    while (shift >= 8) {
      if (p >= out.length) {
        const bigger = new Uint8Array(out.length * 2);
        bigger.set(out);
        out = bigger;
      }
      out[p++] = cur & 255;
      cur >>>= 8;
      shift -= 8;
    }
  };

  put(clear);
  let prefix = pixels[start];
  for (let i = 1; i < count; i++) {
    const k = pixels[start + i];
    const key = (prefix << 8) | k;
    if (seen[key] === stamp) {
      prefix = table[key];
    } else {
      put(prefix);
      if (next === 4096) {
        put(clear);
        next = eoi + 1;
        size = minCode + 1;
        stamp = ++ctx.stamp;
      } else {
        if (next >= 1 << size) size++;
        table[key] = next++;
        seen[key] = stamp;
      }
      prefix = k;
    }
  }
  put(prefix);
  put(eoi);
  if (shift > 0) {
    if (p >= out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[p++] = cur & 255;
  }
  ctx.out = out;
  return p;
}

// ---------------------------------------------------------------------------
//  Encodeur
// ---------------------------------------------------------------------------
function createEncoder(width, height, opts = {}) {
  const maxColors = Math.min(255, opts.maxColors || 255);
  const sampleStep = opts.sampleStep || 3;
  const hist = new Uint32Array(32768);
  const frames = []; // { keys: Uint16Array, delay }

  function add(rgba, delay) {
    const n = width * height;
    const keys = new Uint16Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      keys[i] = ((rgba[j] >> 3) << 10) | ((rgba[j + 1] >> 3) << 5) | (rgba[j + 2] >> 3);
    }
    for (let i = 0; i < n; i += sampleStep) hist[keys[i]]++;
    frames.push({ keys, delay: Math.max(2, Math.round(delay)) });
  }

  function finish() {
    if (!frames.length) throw new Error('GIF : aucune image');
    const colors = medianCut(hist, maxColors);
    const nPal = colors.length;
    const lut = new Int16Array(32768).fill(-1);
    const lookup = (key) => {
      let v = lut[key];
      if (v >= 0) return v;
      const r = ((key >> 10) & 31) * 8.226;
      const g = ((key >> 5) & 31) * 8.226;
      const b = (key & 31) * 8.226;
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < nPal; i++) {
        const c = colors[i];
        const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      lut[key] = bestI;
      return bestI;
    };

    const chunks = [];
    // en-tête + descripteur d'écran + table de couleurs globale (256 entrées)
    const head = Buffer.alloc(13 + 768);
    head.write('GIF89a', 0, 'ascii');
    head.writeUInt16LE(width, 6);
    head.writeUInt16LE(height, 8);
    head[10] = 0x80 | (7 << 4) | 7;
    head[11] = 0;
    head[12] = 0;
    for (let i = 0; i < nPal; i++) {
      head[13 + i * 3] = colors[i][0];
      head[14 + i * 3] = colors[i][1];
      head[15 + i * 3] = colors[i][2];
    }
    chunks.push(head);
    if (opts.loop != null) {
      // boucle explicite (0 = infini) ; par défaut : lecture unique
      const ext = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, opts.loop & 255, (opts.loop >> 8) & 255, 0x00]);
      chunks.push(ext);
    }

    const lz = { table: new Int32Array(1 << 20), seen: new Int32Array(1 << 20), stamp: 0, out: new Uint8Array(1 << 18) };
    let prev = null;
    for (let f = 0; f < frames.length; f++) {
      const { keys, delay } = frames[f];
      const idx = new Uint8Array(width * height);
      for (let i = 0; i < idx.length; i++) idx[i] = lookup(keys[i]);
      frames[f].keys = null; // libère la mémoire au fil de l'eau

      let x0 = 0, y0 = 0, w = width, h = height;
      let pix = idx;
      let transparent = false;
      if (prev) {
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let y = 0; y < height; y++) {
          const row = y * width;
          for (let x = 0; x < width; x++) {
            if (idx[row + x] !== prev[row + x]) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              maxY = y;
            }
          }
        }
        if (maxX < 0) {
          // image identique : un seul pixel transparent (sert juste à allonger le délai)
          x0 = 0; y0 = 0; w = 1; h = 1;
          pix = new Uint8Array([TRANSPARENT]);
          transparent = true;
        } else {
          x0 = minX; y0 = minY; w = maxX - minX + 1; h = maxY - minY + 1;
          pix = new Uint8Array(w * h);
          for (let y = 0; y < h; y++) {
            const src = (y0 + y) * width + x0;
            const dst = y * w;
            for (let x = 0; x < w; x++) {
              const v = idx[src + x];
              pix[dst + x] = v === prev[src + x] ? TRANSPARENT : v;
            }
          }
          transparent = true;
        }
      }

      // Graphic Control Extension
      const gce = Buffer.from([0x21, 0xf9, 0x04, (1 << 2) | (transparent ? 1 : 0), delay & 255, (delay >> 8) & 255, TRANSPARENT, 0x00]);
      chunks.push(gce);
      // Image Descriptor
      const desc = Buffer.alloc(10);
      desc[0] = 0x2c;
      desc.writeUInt16LE(x0, 1);
      desc.writeUInt16LE(y0, 3);
      desc.writeUInt16LE(w, 5);
      desc.writeUInt16LE(h, 7);
      desc[9] = 0;
      chunks.push(desc);
      // Données LZW en sous-blocs de 255 octets
      const len = lzwEncode(pix, 0, pix.length, 8, lz);
      const body = [Buffer.from([8])];
      for (let o = 0; o < len; o += 255) {
        const n = Math.min(255, len - o);
        body.push(Buffer.from([n]), Buffer.from(lz.out.subarray(o, o + n)));
      }
      body.push(Buffer.from([0]));
      chunks.push(Buffer.concat(body));
      prev = idx;
    }
    chunks.push(Buffer.from([0x3b]));
    return Buffer.concat(chunks);
  }

  return { add, finish, get frames() { return frames.length; } };
}

module.exports = { createEncoder };
