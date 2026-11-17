/* DISABLED — textcard image system off */
module.exports = { install() { console.log('[textcard] disabled'); } };
/*
'use strict';
/*
 * textcard.js — ZNK Casino
 * ---------------------------------------------------------------------------
 * Plus AUCUN texte "normal" : tout ce que le bot envoie (content, embeds,
 * messages privés, animations, erreurs...) est converti automatiquement en
 * IMAGE avant l'envoi.
 *
 *   - texte générique  -> images/generic_text_card.png (carte avec avatar + logo Z)
 *   - panneaux         -> images/panel_*.png (le texte est écrit SUR la bannière)
 *   - cartes déjà faites (win, résultat, stats, classements...) -> inchangées,
 *     on retire seulement le texte "doublon" de l'embed.
 *
 * Les boutons / menus déroulants restent du texte : Discord ne permet pas de
 * les transformer en image.
 *
 * Installation (dans index.js, après la création du client) :
 *   require('./textcard').install({ client, discord: require('discord.js'), canvasLib, ... })
 *

// ----------------------------------------------------------------------------
//  Constantes de mise en page (repère logique 800 px de large, rendu x1.5)
// ----------------------------------------------------------------------------
const LW = 800;
const SCALE = 1.5;
const TPL = { w: 1774, h: 887, cut0: 520, cut1: 600 }; // découpe 9-slice : la bande 520-600 est étirée
const K = LW / TPL.w;
const TOP_H = TPL.cut0 * K;
const STRIP_H = (TPL.cut1 - TPL.cut0) * K;
const BOT_H = (TPL.h - TPL.cut1) * K;

const CARD = {
  av: { cx: 103, cy: 114.5, d: 84 },
  tx: 171,
  textRight: 590,
  bodyX: 78,
  bodyW: 617,
  bodyY: 189,
  bodyNatural: 112, // hauteur utile du cadre sans étirement
  icon: { x: 531, y: 91, s: 62 },
};
const BANNER = { pad: 24, inner: 26, minH: 300 };

const SIZES = [26, 24, 22, 20, 18]; // tailles de texte essayées (du plus lisible au plus petit)
const MAX_TOTAL_H = 720; // hauteur logique max avant de réduire la police
const HARD_MAX_H = 1150; // au-delà : le texte est tronqué avec « … »

const C = {
  text: '#F4EEFF',
  bold: '#FFFFFF',
  dim: 'rgba(233,222,255,0.78)',
  accent: '#E9D5FF',
  label: '#D8B4FE',
  codeBg: 'rgba(0,0,0,0.34)',
  codeLine: 'rgba(233,213,255,0.92)',
  cellBg: 'rgba(255,255,255,0.07)',
  cellLine: 'rgba(216,180,254,0.30)',
  red: '#FF6B81',
  gold: '#FDE68A',
};

const EMOJI_RE = /(\p{Regional_Indicator}{2})|([#*0-9]\uFE0F?\u20E3)|(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/u;
const INLINE_RE = new RegExp(
  [
    '(<a?:\\w{2,}:\\d{15,25}>)', // 1 emoji perso
    '(\\*\\*[\\s\\S]+?\\*\\*)', // 2 gras
    '(__[\\s\\S]+?__)', // 3 souligné
    '(~~[\\s\\S]+?~~)', // 4 barré
    '(\\|\\|[\\s\\S]+?\\|\\|)', // 5 spoiler
    '(`[^`\\n]+`)', // 6 code
    '(\\*[^*\\n]+?\\*)', // 7 italique *
    '((?<![\\w])_[^_\\n]+?_(?![\\w]))', // 8 italique _
    '(\\[[^\\]\\n]+\\]\\([^)\\n]+\\))', // 9 lien
    '(' + EMOJI_RE.source + ')', // 10 emoji unicode (+ sous-groupes 11-13)
  ].join('|'),
  'u'
);
const SUITS = { '♠': 'S', '♣': 'C', '♥': 'H', '♦': 'D' };
const DICE = { '⚀': 1, '⚁': 2, '⚂': 3, '⚃': 4, '⚄': 5, '⚅': 6 };
const VEC_CHARS = '▰▱░▒▓█●▬';
const BOX_CHARS = '─━═│║╭╮╰╯┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬';

const twemoji = (e) =>
  `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/72x72/${[...String(e)]
    .map((c) => c.codePointAt(0))
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join('-')}.png`;

// ----------------------------------------------------------------------------
//  Markdown Discord -> runs
// ----------------------------------------------------------------------------
function parseInline(str, style, out) {
  let rest = String(str);
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      pushText(rest, style, out);
      return out;
    }
    if (m.index > 0) pushText(rest.slice(0, m.index), style, out);
    const tok = m[0];
    if (m[1]) {
      const id = tok.match(/:(\d+)>/)[1];
      out.push({ emoji: `https://cdn.discordapp.com/emojis/${id}.png?size=64`, alt: '' });
    } else if (m[2]) parseInline(tok.slice(2, -2), { ...style, b: true }, out);
    else if (m[3]) parseInline(tok.slice(2, -2), { ...style, u: true }, out);
    else if (m[4]) parseInline(tok.slice(2, -2), { ...style, s: true }, out);
    else if (m[5]) parseInline(tok.slice(2, -2), style, out);
    else if (m[6]) pushText(tok.slice(1, -1), { ...style, mono: true }, out);
    else if (m[7] || m[8]) parseInline(tok.slice(1, -1), { ...style, i: true }, out);
    else if (m[9]) parseInline(tok.slice(1, tok.indexOf(']')), style, out);
    else if (m[10]) pushEmoji(tok, style, out);
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}
function pushEmoji(tok, style, out) {
  const base = tok.replace(/\uFE0F/g, '');
  if (SUITS[base]) return out.push({ suit: SUITS[base], ...style });
  if (DICE[base]) return out.push({ die: DICE[base], ...style });
  if (base === '✦' || base === '✧') return out.push({ star: true, ...style });
  return out.push({ emoji: twemoji(tok), alt: tok });
}
function pushText(text, style, out) {
  // caractères "dessinés" (barres ▰▱, blocs) : la police du serveur ne les a pas toujours
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: buf, ...style });
    buf = '';
  };
  for (const ch of text) {
    if (VEC_CHARS.includes(ch)) {
      flush();
      out.push({ vec: ch, ...style });
    } else buf += ch;
  }
  flush();
}

// Parse un texte en blocs : para / code / divider / spacer
function parseBlocks(src) {
  const blocks = [];
  const text = String(src || '').replace(/\r/g, '');
  const parts = text.split(/```/);
  parts.forEach((seg, idx) => {
    if (idx % 2 === 1) {
      const lines = seg.replace(/^[a-zA-Z0-9_-]*\n/, '').replace(/\n$/, '').split('\n');
      blocks.push({ type: 'code', lines });
      return;
    }
    for (const raw of seg.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) {
        blocks.push({ type: 'spacer' });
        continue;
      }
      if (/^(?:▰{8,}|▬{6,}|[─━═\-_~=]{6,})$/.test(line.trim())) {
        blocks.push({ type: 'divider' });
        continue;
      }
      let kind = 'p';
      let body = line;
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        kind = 'h' + m[1].length;
        body = m[2];
      } else if ((m = line.match(/^-#\s+(.*)$/))) {
        kind = 'sub';
        body = m[1];
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        kind = 'quote';
        body = m[1];
      } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        kind = 'li';
        body = m[1];
      } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
        kind = 'ol';
        body = `${m[1]}. ${m[2]}`;
      }
      blocks.push({ type: 'para', kind, runs: parseInline(body, {}, []) });
    }
  });
  // retire les espaces vides en début / fin et les doublons
  const out = [];
  for (const b of blocks) {
    if (b.type === 'spacer' && (!out.length || out[out.length - 1].type === 'spacer')) continue;
    out.push(b);
  }
  while (out.length && out[out.length - 1].type === 'spacer') out.pop();
  return out;
}

function collectEmojiUrls(model, urls) {
  const scan = (runs) => runs.forEach((r) => r.emoji && urls.add(r.emoji));
  const scanBlocks = (blocks) =>
    blocks.forEach((b) => {
      if (b.type === 'para') scan(b.runs);
      if (b.type === 'code') b.lines.forEach((l) => collectCodeEmoji(l, urls));
    });
  scanBlocks(model.blocks);
  model.fields.forEach((f) => {
    scan(f.nameRuns);
    scanBlocks(f.blocks);
  });
  scan(model.footerRuns);
  scan(model.titleRuns);
  scan(model.tagRuns);
}
function collectCodeEmoji(line, urls) {
  let rest = line;
  let m;
  while ((m = EMOJI_RE.exec(rest))) {
    const base = m[0].replace(/\uFE0F/g, '');
    if (!SUITS[base] && !DICE[base] && base !== '✦') urls.add(twemoji(m[0]));
    rest = rest.slice(m.index + m[0].length);
  }
}

// ----------------------------------------------------------------------------
//  Dessin : primitives
// ----------------------------------------------------------------------------
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawSuit(g, kind, cx, cy, s, color) {
  g.save();
  g.fillStyle = color || (kind === 'H' || kind === 'D' ? C.red : '#FFFFFF');
  g.translate(cx, cy);
  const u = s / 2;
  g.beginPath();
  if (kind === 'D') {
    g.moveTo(0, -u);
    g.lineTo(u * 0.72, 0);
    g.lineTo(0, u);
    g.lineTo(-u * 0.72, 0);
  } else if (kind === 'H') {
    g.moveTo(0, u * 0.95);
    g.bezierCurveTo(-u * 1.35, -u * 0.1, -u * 0.8, -u * 1.0, 0, -u * 0.35);
    g.bezierCurveTo(u * 0.8, -u * 1.0, u * 1.35, -u * 0.1, 0, u * 0.95);
  } else if (kind === 'S') {
    g.moveTo(0, -u);
    g.bezierCurveTo(u * 1.5, u * 0.15, u * 0.7, u * 0.85, 0, u * 0.25);
    g.bezierCurveTo(-u * 0.7, u * 0.85, -u * 1.5, u * 0.15, 0, -u);
    g.moveTo(0, u * 0.2);
    g.lineTo(u * 0.3, u);
    g.lineTo(-u * 0.3, u);
  } else {
    g.arc(0, -u * 0.45, u * 0.42, 0, Math.PI * 2);
    g.moveTo(u * 0.85, u * 0.3);
    g.arc(u * 0.5, u * 0.3, u * 0.42, 0, Math.PI * 2);
    g.moveTo(-u * 0.08, u * 0.3);
    g.arc(-u * 0.5, u * 0.3, u * 0.42, 0, Math.PI * 2);
    g.moveTo(0, 0);
    g.lineTo(u * 0.3, u);
    g.lineTo(-u * 0.3, u);
  }
  g.closePath();
  g.fill();
  g.restore();
}

function drawDie(g, n, cx, cy, s) {
  const h = s * 0.5;
  g.save();
  g.fillStyle = '#FFFFFF';
  rr(g, cx - h, cy - h, s, s, s * 0.2);
  g.fill();
  g.fillStyle = '#2B0A3D';
  const p = s * 0.26;
  const pos = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  }[n];
  for (const [dx, dy] of pos) {
    g.beginPath();
    g.arc(cx + dx * p, cy + dy * p, s * 0.075, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawStar4(g, cx, cy, s, color) {
  g.save();
  g.fillStyle = color || C.accent;
  g.beginPath();
  const u = s / 2;
  g.moveTo(cx, cy - u);
  g.quadraticCurveTo(cx, cy, cx + u, cy);
  g.quadraticCurveTo(cx, cy, cx, cy + u);
  g.quadraticCurveTo(cx, cy, cx - u, cy);
  g.quadraticCurveTo(cx, cy, cx, cy - u);
  g.fill();
  g.restore();
}

// Caractères de tableau / barres, dessinés en vectoriel dans une cellule x,y,w,h
function drawVecChar(g, ch, x, y, w, h, color) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  g.save();
  g.strokeStyle = color || C.codeLine;
  g.fillStyle = color || C.codeLine;
  g.lineWidth = Math.max(1.4, h * 0.075);
  g.lineCap = 'butt';
  const line = (x1, y1, x2, y2) => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  const L = x, R = x + w, T = y, B = y + h;
  if (ch === '▰' || ch === '▱') {
    const bh = h * 0.46;
    const sk = bh * 0.35;
    g.beginPath();
    g.moveTo(x + sk, cy - bh / 2);
    g.lineTo(R + 0.5, cy - bh / 2);
    g.lineTo(R - sk + 0.5, cy + bh / 2);
    g.lineTo(x, cy + bh / 2);
    g.closePath();
    if (ch === '▰') g.fill();
    else {
      g.globalAlpha = 0.45;
      g.stroke();
    }
  } else if (ch === '▬') {
    g.fillRect(x, cy - h * 0.12, w + 0.5, h * 0.24);
  } else if ('░▒▓█'.includes(ch)) {
    g.globalAlpha = { '░': 0.22, '▒': 0.45, '▓': 0.72, '█': 1 }[ch];
    g.fillRect(x, T + h * 0.08, w + 0.5, h * 0.84);
  } else if (ch === '●') {
    g.beginPath();
    g.arc(cx, cy, Math.min(w, h) * 0.3, 0, Math.PI * 2);
    g.fill();
  } else if ('─━═'.includes(ch)) {
    if (ch === '═') {
      line(L, cy - h * 0.09, R + 0.5, cy - h * 0.09);
      line(L, cy + h * 0.09, R + 0.5, cy + h * 0.09);
    } else line(L, cy, R + 0.5, cy);
  } else if ('│║'.includes(ch)) {
    if (ch === '║') {
      line(cx - w * 0.1, T, cx - w * 0.1, B);
      line(cx + w * 0.1, T, cx + w * 0.1, B);
    } else line(cx, T, cx, B);
  } else if ('╭╮╰╯'.includes(ch)) {
    g.beginPath();
    if (ch === '╭') { g.moveTo(cx, B); g.quadraticCurveTo(cx, cy, R, cy); }
    if (ch === '╮') { g.moveTo(L, cy); g.quadraticCurveTo(cx, cy, cx, B); }
    if (ch === '╰') { g.moveTo(cx, T); g.quadraticCurveTo(cx, cy, R, cy); }
    if (ch === '╯') { g.moveTo(L, cy); g.quadraticCurveTo(cx, cy, cx, T); }
    g.stroke();
  } else {
    // coins, T, croix (simple / double traités comme simples)
    const up = '└┘├┤┴┼╚╝╠╣╩╬'.includes(ch);
    const down = '┌┐├┤┬┼╔╗╠╣╦╬'.includes(ch);
    const left = '┐┘┤┬┴┼╗╝╣╦╩╬'.includes(ch);
    const right = '┌└├┬┴┼╔╚╠╦╩╬'.includes(ch);
    if (up) line(cx, T, cx, cy);
    if (down) line(cx, cy, cx, B);
    if (left) line(L, cy, cx, cy);
    if (right) line(cx, cy, R + 0.5, cy);
  }
  g.restore();
}

// ----------------------------------------------------------------------------
//  Texte : mesure, retour à la ligne, dessin
// ----------------------------------------------------------------------------
function fontOf(run, size, forceBold, FONT) {
  return `${run.i ? 'italic ' : ''}${run.b || forceBold ? 'bold ' : ''}${size}px ${FONT}`;
}
function runWidth(g, run, size, forceBold, FONT) {
  if (run.emoji) return size * 1.12;
  if (run.suit || run.die || run.star) return size * 0.95;
  if (run.vec) return size * (run.vec === '▰' || run.vec === '▱' ? 0.62 : 0.6);
  g.font = fontOf(run, size, forceBold, FONT);
  return g.measureText(run.t).width;
}

// Découpe des runs en atomes (mots) puis en lignes de largeur max maxW
function wrapRuns(g, runs, size, forceBold, FONT, maxW, firstIndent = 0) {
  const atoms = [];
  for (const run of runs) {
    if (run.t !== undefined) {
      for (const piece of run.t.split(/(\s+)/)) {
        if (!piece) continue;
        const sp = /^\s+$/.test(piece);
        atoms.push({ run: { ...run, t: sp ? ' ' : piece }, sp, w: 0 });
      }
    } else atoms.push({ run, sp: false, w: 0 });
  }
  atoms.forEach((a) => (a.w = runWidth(g, a.run, size, forceBold, FONT)));
  const lines = [];
  let cur = { atoms: [], w: 0 };
  let avail = maxW - firstIndent;
  const push = () => {
    while (cur.atoms.length && cur.atoms[cur.atoms.length - 1].sp) cur.w -= cur.atoms.pop().w;
    lines.push(cur);
    cur = { atoms: [], w: 0 };
    avail = maxW;
  };
  for (const a of atoms) {
    if (a.sp && !cur.atoms.length) continue;
    if (cur.w + a.w > avail && cur.atoms.length && !a.sp) push();
    if (a.w > avail && !a.sp && a.run.t !== undefined) {
      // mot plus large qu'une ligne : coupe caractère par caractère
      let chunk = '';
      for (const ch of a.run.t) {
        const w = runWidth(g, { ...a.run, t: chunk + ch }, size, forceBold, FONT);
        if (w > avail - cur.w && chunk) {
          cur.atoms.push({ run: { ...a.run, t: chunk }, sp: false, w: runWidth(g, { ...a.run, t: chunk }, size, forceBold, FONT) });
          cur.w += cur.atoms[cur.atoms.length - 1].w;
          push();
          chunk = ch;
        } else chunk += ch;
      }
      if (chunk) {
        const w = runWidth(g, { ...a.run, t: chunk }, size, forceBold, FONT);
        cur.atoms.push({ run: { ...a.run, t: chunk }, sp: false, w });
        cur.w += w;
      }
      continue;
    }
    cur.atoms.push(a);
    cur.w += a.w;
  }
  if (cur.atoms.length || !lines.length) push();
  return lines;
}

function drawLine(g, line, x, baseY, size, forceBold, FONT, color, imgs) {
  let cx = x;
  for (const a of line.atoms) {
    const r = a.run;
    const w = a.w;
    if (r.emoji) {
      const im = imgs.get(r.emoji);
      if (im) g.drawImage(im, cx + size * 0.04, baseY - size * 0.9, size * 1.04, size * 1.04);
    } else if (r.suit) drawSuit(g, r.suit, cx + w / 2, baseY - size * 0.33, size * 0.78);
    else if (r.die) drawDie(g, r.die, cx + w / 2, baseY - size * 0.33, size * 0.8);
    else if (r.star) drawStar4(g, cx + w / 2, baseY - size * 0.33, size * 0.7, color);
    else if (r.vec) drawVecChar(g, r.vec, cx, baseY - size * 0.82, w, size * 0.95, r.vec === '▱' ? C.dim : color);
    else if (!a.sp) {
      if (r.mono) {
        g.fillStyle = 'rgba(255,255,255,0.14)';
        rr(g, cx - 2, baseY - size * 0.86, w + 4, size * 1.12, 4);
        g.fill();
      }
      g.font = fontOf(r, size, forceBold, FONT);
      g.fillStyle = r.mono ? C.gold : r.b || forceBold ? C.bold : color;
      g.fillText(r.t, cx, baseY);
      if (r.u || r.s) {
        g.fillRect(cx, r.s ? baseY - size * 0.3 : baseY + size * 0.1, w, Math.max(1.2, size * 0.06));
      }
    }
    cx += w;
  }
}

// ----------------------------------------------------------------------------
//  Mise en page du corps
// ----------------------------------------------------------------------------
const LH = 1.34;

function layoutBlocks(g, blocks, size, maxW, FONT, imgs, color = C.text) {
  const items = [];
  let h = 0;
  for (const b of blocks) {
    if (b.type === 'spacer') {
      items.push({ h: size * 0.45, draw() {} });
      h += size * 0.45;
    } else if (b.type === 'divider') {
      const ih = size * 0.8;
      items.push({
        h: ih,
        draw(g2, x, y) {
          const gr = g2.createLinearGradient(x, 0, x + maxW, 0);
          gr.addColorStop(0, 'rgba(168,28,253,0)');
          gr.addColorStop(0.5, 'rgba(233,213,255,0.85)');
          gr.addColorStop(1, 'rgba(168,28,253,0)');
          g2.fillStyle = gr;
          g2.fillRect(x, y + ih / 2 - 1, maxW, 2);
          drawStar4(g2, x + maxW / 2, y + ih / 2, size * 0.6, '#FFFFFF');
        },
      });
      h += ih;
    } else if (b.type === 'code') {
      const maxCols = Math.max(1, ...b.lines.map(cellCount));
      const pad = 9;
      const cs = Math.min(size * 0.92, (maxW - pad * 2) / (maxCols * 0.6));
      const cw = cs * 0.6;
      const ch = cs * 1.32;
      const ih = b.lines.length * ch + pad * 2;
      const gridW = maxCols * cw;
      const ox = Math.max(0, (maxW - pad * 2 - gridW) / 2);
      items.push({
        h: ih + 4,
        draw(g2, x, y) {
          g2.fillStyle = C.codeBg;
          rr(g2, x, y, maxW, ih, 9);
          g2.fill();
          b.lines.forEach((l, li) => {
            let cx = x + pad + ox;
            const top = y + pad + li * ch;
            const cl = cells(l);
            for (let n = 0; n < cl.length; n++) {
              const c = cl[n];
              if (c.kind === 'space') {
                cx += cw;
              } else if (c.kind === 'vec') {
                drawVecChar(g2, c.ch, cx, top, cw, ch);
                cx += cw;
              } else if (c.kind === 'suit') {
                drawSuit(g2, c.v, cx + cw / 2, top + ch / 2, cs * 0.8);
                cx += cw;
              } else if (c.kind === 'die') {
                drawDie(g2, c.v, cx + cw / 2, top + ch / 2, cs * 0.85);
                cx += cw;
              } else if (c.kind === 'emoji') {
                const im = imgs.get(c.url);
                if (im) g2.drawImage(im, cx + cw * 0.1, top + ch * 0.1, cw * 1.8, cw * 1.8);
                cx += cw * 2;
              } else {
                // suite de caractères normaux : dessinée d'un seul tenant (lecture naturelle)
                let str = c.ch;
                while (cl[n + 1] && cl[n + 1].kind === 'char') str += cl[++n].ch;
                const wCells = [...str].length * cw;
                g2.font = `bold ${cs}px ${FONT}`;
                g2.fillStyle = C.bold;
                g2.fillText(str, cx, top + ch * 0.74, wCells * 1.14);
                cx += wCells;
              }
            }
          });
        },
      });
      h += ih + 4;
    } else {
      const k = b.kind;
      const mult = { h1: 1.38, h2: 1.24, h3: 1.12, sub: 0.74 }[k] || 1;
      const sz = size * mult;
      const bold = k === 'h1' || k === 'h2' || k === 'h3';
      const indent = k === 'li' || k === 'ol' ? sz * 0.9 : k === 'quote' ? sz * 0.7 : 0;
      const col = k === 'sub' ? C.dim : k === 'quote' ? C.accent : color;
      const lines = wrapRuns(g, b.runs, sz, bold, FONT, maxW - indent);
      const lh = sz * LH;
      const ih = lines.length * lh + (bold ? sz * 0.1 : 0);
      items.push({
        h: ih,
        draw(g2, x, y) {
          if (k === 'quote') {
            g2.fillStyle = 'rgba(216,180,254,0.8)';
            g2.fillRect(x, y + 2, 3, ih - 4);
          }
          if (k === 'li') {
            g2.fillStyle = C.label;
            g2.beginPath();
            g2.arc(x + sz * 0.3, y + lh * 0.55, sz * 0.14, 0, Math.PI * 2);
            g2.fill();
          }
          lines.forEach((ln, li) => drawLine(g2, ln, x + indent, y + li * lh + sz * 1.0, sz, bold, FONT, col, imgs));
        },
      });
      h += ih;
    }
  }
  return { items, h };
}

function cells(line) {
  const out = [];
  let rest = String(line);
  while (rest.length) {
    const m = EMOJI_RE.exec(rest);
    const head = m ? rest.slice(0, m.index) : rest;
    for (const ch of head) {
      if (ch === ' ' || ch === '\t') out.push({ kind: 'space' });
      else if (VEC_CHARS.includes(ch) || BOX_CHARS.includes(ch)) out.push({ kind: 'vec', ch });
      else if (SUITS[ch]) out.push({ kind: 'suit', v: SUITS[ch] });
      else if (DICE[ch]) out.push({ kind: 'die', v: DICE[ch] });
      else out.push({ kind: 'char', ch });
    }
    if (!m) break;
    const base = m[0].replace(/\uFE0F/g, '');
    if (SUITS[base]) out.push({ kind: 'suit', v: SUITS[base] });
    else if (DICE[base]) out.push({ kind: 'die', v: DICE[base] });
    else if (base === '✦') out.push({ kind: 'char', ch: '✦' });
    else out.push({ kind: 'emoji', url: twemoji(m[0]) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}
const cellCount = (line) => cells(line).reduce((n, c) => n + (c.kind === 'emoji' ? 2 : 1), 0);

// Champs (fields) : grille de cartes
function layoutFields(g, fields, size, maxW, FONT, imgs) {
  const rows = [];
  let cur = [];
  for (const f of fields) {
    if (f.inline) {
      cur.push(f);
      if (cur.length === 3) {
        rows.push(cur);
        cur = [];
      }
    } else {
      if (cur.length) rows.push(cur);
      cur = [];
      rows.push([f]);
    }
  }
  if (cur.length) rows.push(cur);
  const items = [];
  let h = 0;
  const gap = 10;
  const pad = 10;
  for (const row of rows) {
    const cw = (maxW - gap * (row.length - 1)) / row.length;
    const lab = size * 0.7;
    const prepared = row.map((f) => {
      const nl = wrapRuns(g, f.nameRuns, lab, true, FONT, cw - pad * 2);
      const vl = layoutBlocks(g, f.blocks, size * 0.96, cw - pad * 2, FONT, imgs, C.bold);
      return { nl, vl, hh: pad * 2 + nl.length * lab * 1.25 + 3 + vl.h };
    });
    const rh = Math.max(...prepared.map((p) => p.hh));
    items.push({
      h: rh + gap,
      draw(g2, x, y) {
        prepared.forEach((p, n) => {
          const bx = x + n * (cw + gap);
          g2.fillStyle = C.cellBg;
          rr(g2, bx, y, cw, rh, 10);
          g2.fill();
          g2.strokeStyle = C.cellLine;
          g2.lineWidth = 1.2;
          g2.stroke();
          p.nl.forEach((ln, li) => drawLine(g2, ln, bx + pad, y + pad + li * lab * 1.25 + lab * 0.95, lab, true, FONT, C.label, imgs));
          let vy = y + pad + p.nl.length * lab * 1.25 + 3;
          for (const it of p.vl.items) {
            it.draw(g2, bx + pad, vy);
            vy += it.h;
          }
        });
      },
    });
    h += rh + gap;
  }
  return { items, h };
}

// Corps complet : description + champs + pied de page. Tronque si trop long.
function layoutBody(g, model, size, maxW, FONT, imgs, maxH) {
  const parts = [];
  const desc = layoutBlocks(g, model.blocks, size, maxW, FONT, imgs);
  parts.push(...desc.items);
  let h = desc.h;
  if (model.fields.length) {
    if (h) {
      parts.push({ h: size * 0.35, draw() {} });
      h += size * 0.35;
    }
    const f = layoutFields(g, model.fields, size, maxW, FONT, imgs);
    parts.push(...f.items);
    h += f.h;
  }
  if (model.footerRuns.length) {
    const fs = size * 0.68;
    const lines = wrapRuns(g, model.footerRuns, fs, false, FONT, maxW);
    const fh = lines.length * fs * LH + size * 0.3;
    parts.push({
      h: fh,
      draw(g2, x, y) {
        lines.forEach((ln, li) => drawLine(g2, ln, x, y + size * 0.3 + li * fs * LH + fs, fs, false, FONT, C.dim, imgs));
      },
    });
    h += fh;
  }
  // troncature
  if (h > maxH) {
    let acc = 0;
    const kept = [];
    for (const it of parts) {
      if (acc + it.h > maxH - size * 1.2) break;
      kept.push(it);
      acc += it.h;
    }
    const lh = size * LH;
    kept.push({
      h: lh,
      draw(g2, x, y) {
        g2.font = `bold ${size}px ${FONT}`;
        g2.fillStyle = C.dim;
        g2.fillText('…', x, y + size);
      },
    });
    return { items: kept, h: acc + lh };
  }
  return { items: parts, h };
}

// ----------------------------------------------------------------------------
//  Rendu d'une carte
// ----------------------------------------------------------------------------
function buildModel(d) {
  const mkRuns = (s) => parseInline(String(s || '').replace(/\n+/g, ' '), {}, []);
  const lead = d.lead ? `${d.lead}\n` : '';
  return {
    blocks: parseBlocks(lead + (d.description || '')),
    fields: (d.fields || []).map((f) => ({
      inline: !!f.inline,
      nameRuns: mkRuns(f.name),
      blocks: parseBlocks(f.value),
    })),
    footerRuns: d.footer ? mkRuns(d.footer) : [],
    titleRuns: d.title ? mkRuns(d.title) : [],
    tagRuns: d.tag ? mkRuns(d.tag) : [],
  };
}

// Dessine une ligne unique (titre) qui rétrécit pour tenir dans maxW
function drawFit(g, runs, x, baseY, size, minSize, maxW, bold, FONT, color, imgs, align = 'left') {
  let s = size;
  let line;
  for (; s >= minSize; s -= 1) {
    line = wrapRuns(g, runs, s, bold, FONT, 99999)[0];
    if (line.w <= maxW) break;
  }
  if (!line || line.w > maxW) {
    s = minSize;
    const lines = wrapRuns(g, runs, s, bold, FONT, maxW);
    line = lines[0];
    if (lines.length > 1) line.atoms.push({ run: { t: '…' }, sp: false, w: runWidth(g, { t: '…' }, s, bold, FONT) });
  }
  const x0 = align === 'center' ? x - line.w / 2 : x;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 4;
  drawLine(g, line, x0, baseY, s, bold, FONT, color, imgs);
  g.restore();
  return line.w;
}

async function drawTextCard(deps, d) {
  const { canvasLib, FONT } = deps;
  const { createCanvas, loadImage } = canvasLib;
  const banner = d.mode === 'banner';
  const bg = await deps.getBg(d.bgSource, loadImage);
  if (!bg) return null;

  const model = buildModel(d);
  const urls = new Set();
  collectEmojiUrls(model, urls);
  const imgs = new Map();
  await Promise.all(
    [...urls].map(async (u) => {
      const im = await deps.loadRemoteImage(u, loadImage).catch(() => null);
      if (im) imgs.set(u, im);
    })
  );
  const avatar = !banner && d.avatarUser ? await deps.getAvatar(d.avatarUser, loadImage).catch(() => null) : null;
  const thumb = d.thumb ? await deps.loadRemoteImage(d.thumb, loadImage).catch(() => null) : null;

  // canvas de mesure
  const mc = createCanvas(10, 10).getContext('2d');
  mc.textBaseline = 'alphabetic';

  const maxW = banner ? LW - BANNER.pad * 2 - BANNER.inner * 2 : CARD.bodyW;
  // en-tête (mode bannière) : titre sur la bannière
  const bannerHead = banner && (d.title || d.tag) ? 70 : 0;

  let chosen = null;
  for (const size of SIZES) {
    const maxContent = HARD_MAX_H;
    const body = layoutBody(mc, model, size, maxW, FONT, imgs, maxContent);
    const total = banner
      ? BANNER.pad * 2 + BANNER.inner * 2 + bannerHead + body.h
      : 400 + Math.max(0, body.h - CARD.bodyNatural);
    chosen = { size, body, total };
    if (total <= MAX_TOTAL_H) break;
  }
  const { body } = chosen;
  const H = Math.round(banner ? Math.max(BANNER.minH, chosen.total) : chosen.total);
  const E = banner ? 0 : Math.max(0, body.h - CARD.bodyNatural);

  const cv = createCanvas(Math.round(LW * SCALE), Math.round(H * SCALE));
  const g = cv.getContext('2d');
  g.scale(SCALE, SCALE);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  if (!banner) {
    // 9-slice : haut / bande étirée / bas
    g.drawImage(bg, 0, 0, TPL.w, TPL.cut0, 0, 0, LW, TOP_H);
    g.drawImage(bg, 0, TPL.cut0, TPL.w, TPL.cut1 - TPL.cut0, 0, TOP_H - 0.5, LW, STRIP_H + E + 1);
    g.drawImage(bg, 0, TPL.cut1, TPL.w, TPL.h - TPL.cut1, 0, TOP_H + STRIP_H + E, LW, BOT_H);

    // avatar
    const A = CARD.av;
    g.save();
    g.beginPath();
    g.arc(A.cx, A.cy, A.d / 2, 0, Math.PI * 2);
    g.closePath();
    g.clip();
    if (avatar) {
      const sq = Math.min(avatar.width, avatar.height);
      g.drawImage(avatar, (avatar.width - sq) / 2, (avatar.height - sq) / 2, sq, sq, A.cx - A.d / 2, A.cy - A.d / 2, A.d, A.d);
      g.restore();
    } else {
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      drawStar4(g, A.cx, A.cy, A.d * 0.6);
    }
    if (thumb) g.drawImage(thumb, CARD.icon.x, CARD.icon.y, CARD.icon.s, CARD.icon.s);

    // en-tête
    const tmax = (thumb ? 520 : CARD.textRight) - CARD.tx;
    const hasTitle = model.titleRuns.length > 0;
    const tagRuns = model.tagRuns.length ? model.tagRuns : parseInline('ZNK CASINO', {}, []);
    drawFit(g, tagRuns, CARD.tx, 94, 14, 11, tmax, true, FONT, 'rgba(233,213,255,0.85)', imgs);
    const headRuns = hasTitle ? model.titleRuns : parseInline(d.userName || 'ZNK Casino', {}, []);
    drawFit(g, headRuns, CARD.tx, 124, 30, 18, tmax, true, FONT, '#FFFFFF', imgs);
    if (hasTitle && d.userName) {
      drawFit(g, parseInline(d.userName, {}, []), CARD.tx, 147, 16, 12, tmax, false, FONT, C.dim, imgs);
    }

    // corps
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 2;
    let y = CARD.bodyY + Math.max(0, (CARD.bodyNatural - body.h) / 2) * 0.55;
    for (const it of body.items) {
      it.draw(g, CARD.bodyX, y);
      y += it.h;
    }
    g.restore();
  } else {
    // bannière plein cadre
    const k = Math.max(LW / bg.width, H / bg.height);
    const sw = LW / k;
    const sh = H / k;
    g.drawImage(bg, (bg.width - sw) / 2, (bg.height - sh) / 2, sw, sh, 0, 0, LW, H);
    const px = BANNER.pad;
    const pw = LW - px * 2;
    const ph = H - px * 2;
    g.save();
    g.shadowColor = 'rgba(168,28,253,0.85)';
    g.shadowBlur = 18;
    g.fillStyle = 'rgba(10,4,26,0.80)';
    rr(g, px, px, pw, ph, 22);
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(216,180,254,0.75)';
    g.lineWidth = 2.5;
    rr(g, px, px, pw, ph, 22);
    g.stroke();

    const ix = px + BANNER.inner;
    let y = px + BANNER.inner + 4;
    if (bannerHead) {
      const tmax = pw - BANNER.inner * 2 - (thumb ? 64 : 0);
      if (thumb) g.drawImage(thumb, px + pw - BANNER.inner - 52, y - 4, 52, 52);
      if (model.tagRuns.length) drawFit(g, model.tagRuns, ix, y + 11, 13, 10, tmax, true, FONT, 'rgba(233,213,255,0.85)', imgs);
      if (model.titleRuns.length) drawFit(g, model.titleRuns, ix, y + 44, 32, 20, tmax, true, FONT, '#FFFFFF', imgs);
      y += bannerHead;
    }
    for (const it of body.items) {
      it.draw(g, ix, y);
      y += it.h;
    }
  }
  return cv.toBuffer('image/png');
}

// ----------------------------------------------------------------------------
//  Interception discord.js
// ----------------------------------------------------------------------------
const PING_ONLY = /^(?:<@[!&]?\d+>|<#\d+>|@everyone|@here|\s)*$/;

function install(deps) {
  const { client, discord: D, canvasLib } = deps;
  if (!canvasLib) {
    console.warn('[textcard] @napi-rs/canvas absent : le texte reste en texte normal (npm i @napi-rs/canvas).');
    return false;
  }
  const tplPath = String(process.env.TEXT_BG_URL || '').trim() || deps.localImg('generic_text_card.png');
  if (!tplPath) console.warn('[textcard] images/generic_text_card.png introuvable : le texte reste en texte normal.');
  let counter = 0;
  const COLOR_DEFAULT = 0xa81cfd;

  const resolveText = async (text) => {
    let s = String(text || '');
    const ids = [...new Set([...s.matchAll(/<@!?(\d{15,25})>/g)].map((m) => m[1]))].slice(0, 12);
    await Promise.all(ids.filter((id) => !client.users.cache.has(id)).map((id) => client.users.fetch(id).catch(() => null)));
    s = s.replace(/<@!?(\d{15,25})>/g, (_, id) => {
      const u = client.users.cache.get(id);
      return `**@${(u && (u.globalName || u.username)) || 'joueur'}**`;
    });
    s = s.replace(/<@&(\d{15,25})>/g, (_, id) => {
      for (const gd of client.guilds.cache.values()) {
        const r = gd.roles.cache.get(id);
        if (r) return `**@${r.name}**`;
      }
      return '**@rôle**';
    });
    s = s.replace(/<#(\d{15,25})>/g, (_, id) => `**#${client.channels.cache.get(id)?.name || 'salon'}**`);
    s = s.replace(/<t:(-?\d+)(?::([tTdDfFR]))?>/g, (_, ts, f) => fmtTime(Number(ts), f));
    s = s.replace(/@(everyone|here)/g, '@$1');
    return s;
  };

  const display = (u) => String(u?.globalName || u?.username || '').replace(/[\u0000-\u001F]/g, '').trim();

  async function cardFromEmbed(e, ctx, lead, bannerSource) {
    const buf = await drawTextCard(deps, {
      mode: bannerSource ? 'banner' : 'card',
      bgSource: bannerSource || tplPath,
      avatarUser: ctx.user,
      userName: display(ctx.user),
      tag: e.author?.name ? await resolveText(e.author.name) : '',
      title: e.title ? await resolveText(e.title) : '',
      description: await resolveText(e.description || ''),
      lead: lead ? await resolveText(lead) : '',
      fields: await Promise.all(
        (e.fields || []).map(async (f) => ({ name: await resolveText(f.name), value: await resolveText(f.value), inline: f.inline }))
      ),
      footer: e.footer?.text ? await resolveText(e.footer.text) : '',
      thumb: e.thumbnail?.url && /^https?:/i.test(e.thumbnail.url) ? e.thumbnail.url : null,
    });
    return buf;
  }

  async function transform(options, ctx) {
    if (typeof options === 'string') options = { content: options };
    if (!options || typeof options !== 'object' || options instanceof D.MessagePayload || options.__textcard === false) return options;

    const hasContent = typeof options.content === 'string' && options.content.trim().length > 0;
    const contentIsPing = hasContent && PING_ONLY.test(options.content);
    const rawEmbeds = (options.embeds || []).map((e) => (e && typeof e.toJSON === 'function' ? e.toJSON() : e)).filter(Boolean);
    const files = Array.isArray(options.files) ? [...options.files] : [];
    const fileByName = (name) => files.find((f) => (f?.name || '') === name);

    const hasEmbedText = (e) => e.title || e.description || e.author?.name || e.footer?.text || (e.fields && e.fields.length);
    const needsContent = hasContent && !contentIsPing;
    if (!needsContent && !rawEmbeds.some(hasEmbedText)) return options;

    const out = { ...options };
    const newEmbeds = [];
    const newFiles = [];
    let leadUsed = !needsContent;
    let touched = false;
    const lead = needsContent ? options.content : '';

    for (const e of rawEmbeds) {
      if (!hasEmbedText(e)) {
        newEmbeds.push(e);
        continue;
      }
      const imgUrl = e.image?.url || '';
      const attName = imgUrl.startsWith('attachment://') ? imgUrl.slice('attachment://'.length) : null;
      const att = attName ? fileByName(attName) : null;

      // image générée (carte win, stats, classement...) : le texte est déjà dedans -> on retire le doublon
      const bannerPath = att && typeof att.attachment === 'string' && /^panel_.*\.(png|jpe?g)$/i.test(att.name || '') ? att.attachment : null;
      if (attName && !bannerPath) {
        const clean = { color: e.color ?? COLOR_DEFAULT, image: e.image };
        newEmbeds.push(clean);
        touched = true;
        continue;
      }

      try {
        const buf = await cardFromEmbed(e, ctx, !leadUsed ? lead : '', bannerPath);
        if (!buf) {
          newEmbeds.push(e);
          continue;
        }
        leadUsed = true;
        const name = `znk-text-${Date.now()}-${counter++}.png`;
        newFiles.push(new D.AttachmentBuilder(buf, { name }));
        const remoteImg = e.image && !attName ? e.image : null;
        newEmbeds.push({ color: e.color ?? COLOR_DEFAULT, image: { url: `attachment://${name}` } });
        if (remoteImg) newEmbeds.push({ color: e.color ?? COLOR_DEFAULT, image: remoteImg });
        if (bannerPath) files.splice(files.indexOf(att), 1);
        touched = true;
      } catch (err) {
        console.error('[textcard] embed non converti :', err?.message || err);
        newEmbeds.push(e);
      }
    }

    // texte du content (non utilisé comme "lead") -> sa propre carte
    if (!leadUsed) {
      try {
        const buf = await drawTextCard(deps, {
          mode: 'card',
          bgSource: tplPath,
          avatarUser: ctx.user,
          userName: display(ctx.user),
          title: '',
          description: await resolveText(lead),
        });
        if (buf) {
          const name = `znk-text-${Date.now()}-${counter++}.png`;
          newFiles.push(new D.AttachmentBuilder(buf, { name }));
          newEmbeds.unshift({ color: COLOR_DEFAULT, image: { url: `attachment://${name}` } });
          leadUsed = true;
          touched = true;
        }
      } catch (err) {
        console.error('[textcard] content non converti :', err?.message || err);
      }
    }
    if (!touched) return options;

    out.embeds = newEmbeds;
    out.files = [...files, ...newFiles];
    if (needsContent && leadUsed) out.content = ctx.edit ? null : undefined;
    if (ctx.edit && out.attachments === undefined) out.attachments = [];
    return out;
  }

  const wrap = (proto, name, ctxOf) => {
    if (!proto || typeof proto[name] !== 'function' || proto[name].__textcard) return;
    const orig = proto[name];
    const fn = async function (options, ...rest) {
      let opt = options;
      try {
        opt = await transform(options, ctxOf(this, name));
      } catch (e) {
        console.error('[textcard] transformation impossible :', e?.message || e);
        opt = options;
      }
      return orig.call(this, opt, ...rest);
    };
    fn.__textcard = true;
    proto[name] = fn;
  };

  const botUser = () => client.user;

  // Le rendu d'image peut dépasser les 3 s laissées par Discord pour répondre :
  // si le message doit être converti, on "defer" tout de suite puis on édite avec l'image.
  const needsConvert = (o) => {
    if (typeof o === 'string') return o.trim().length > 0 && !PING_ONLY.test(o);
    if (!o || typeof o !== 'object' || o instanceof D.MessagePayload) return false;
    if (typeof o.content === 'string' && o.content.trim() && !PING_ONLY.test(o.content)) return true;
    return (o.embeds || []).some((e) => {
      const j = e && typeof e.toJSON === 'function' ? e.toJSON() : e || {};
      return j.title || j.description || j.author?.name || j.footer?.text || j.fields?.length;
    });
  };
  const wrapFirstResponse = (proto, name) => {
    if (!proto || typeof proto[name] !== 'function' || proto[name].__textcard) return;
    const orig = proto[name];
    const fn = async function (options, ...rest) {
      try {
        if (!this.deferred && !this.replied && needsConvert(options)) {
          const o = typeof options === 'string' ? { content: options } : { ...options };
          if (name === 'reply') {
            const eph = o.ephemeral === true || (Number(o.flags ?? 0) & 64) === 64;
            await this.deferReply(eph ? { flags: 64 } : {});
          } else {
            await this.deferUpdate();
          }
          delete o.flags;
          delete o.ephemeral;
          delete o.fetchReply;
          delete o.withResponse;
          return await this.editReply(o);
        }
      } catch (e) {
        if (this.deferred || this.replied) throw e; // déjà acquitté : on ne retente pas
        console.error('[textcard] defer impossible :', e?.message || e);
      }
      return orig.call(this, options, ...rest);
    };
    fn.__textcard = true;
    proto[name] = fn;
  };
  for (const cls of ['CommandInteraction', 'MessageComponentInteraction', 'ModalSubmitInteraction']) {
    const p = D[cls]?.prototype;
    if (!p) continue;
    wrap(p, 'followUp', (self) => ({ user: self.user, edit: false }));
    wrap(p, 'editReply', (self) => ({ user: self.user, edit: true }));
    wrapFirstResponse(p, 'reply');
    wrapFirstResponse(p, 'update');
  }
  for (const cls of ['TextChannel', 'NewsChannel', 'DMChannel', 'ThreadChannel', 'VoiceChannel', 'StageChannel', 'PartialGroupDMChannel']) {
    wrap(D[cls]?.prototype, 'send', () => ({ user: botUser(), edit: false }));
  }
  wrap(D.Message?.prototype, 'edit', (self) => ({
    user: self.interactionMetadata?.user || self.interaction?.user || botUser(),
    edit: true,
  }));

  console.log('[textcard] actif : tout le texte sortant est converti en image.');
  return true;
}

function fmtTime(ts, f) {
  const d = new Date(ts * 1000);
  const tz = 'Europe/Paris';
  const date = d.toLocaleDateString('fr-FR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  if (f === 't') return time;
  if (f === 'd') return date;
  if (f === 'R') {
    const diff = Math.round((ts * 1000 - Date.now()) / 1000);
    const a = Math.abs(diff);
    const u = a < 60 ? [a, 's'] : a < 3600 ? [Math.round(a / 60), 'min'] : a < 86400 ? [Math.round(a / 3600), 'h'] : [Math.round(a / 86400), 'j'];
    return diff >= 0 ? `dans ${u[0]} ${u[1]}` : `il y a ${u[0]} ${u[1]}`;
  }
  return `${date} ${time}`;
}

module.exports = { install, drawTextCard, parseBlocks, parseInline };

*/
