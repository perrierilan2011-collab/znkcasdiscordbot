'use strict';
/*
 * games/engine.js — ZNK Casino
 * ---------------------------------------------------------------------------
 * Animations de jeux EN IMAGES, dans le style des cartes du bot (gabarit violet
 * néon 1774x887 : avatar rond, bandeau, barre, médaillon).
 *
 * Chaque jeu fournit une liste de « frames ». Le moteur dessine chaque frame sur
 * le gabarit (avatar + titre + légende + scène du jeu) puis envoie les images
 * l'une après l'autre en éditant le message (comme l'ancienne animation texte).
 *
 * Si quelque chose manque (gabarit, canvas, droits...) play() renvoie false et le
 * bot retombe sur l'ancienne animation texte : rien ne casse.
 */
const D = require('./draw');
const { createEncoder } = require('./gif');

const W = 800;
const H = 400;
const SC = 1.25; // images fixes (JPEG)
// échelle des GIF : 1 = 800x400 (léger) · 1.25 = 1000x500 (défaut, net en plein écran) · 1.5 = 1200x600. Variable GAME_GIF_SCALE.
const GS = Math.min(1.5, Math.max(1, Number(process.env.GAME_GIF_SCALE) || 1.25));
const GIF_DELAY = 8; // centièmes de seconde entre deux images (12,5 images/s)
const GIF_HOLD = 180; // pause sur la dernière image (centièmes de seconde)
const GIF_MAX_BYTES = 7.2 * 1024 * 1024; // sous la limite d'envoi Discord
// scène agrandie : recouvre les 6 cases du gabarit et utilise toute la moitié basse de la carte
const STAGE = { x: 36, y: 214, w: 728, h: 172 };
const AV = { cx: 103, cy: 114.5, d: 84 };
const MED = { cx: 702, cy: 112, r: 50 }; // médaillon (en haut à droite)
const BAR = { x: 61, y: 175, w: 582, h: 33 };
const TX = 171;
const TMAX = 590 - TX;

const OUT_COLOR = { win: '#86EFAC', lose: '#FCA5A5', push: '#E9D5FF' };

function fit(g, s, maxW) {
  s = String(s ?? '');
  if (g.measureText(s).width <= maxW) return s;
  const t = Array.from(s);
  while (t.length > 1 && g.measureText(`${t.join('')}…`).width > maxW) t.pop();
  return `${t.join('')}…`;
}

function create(deps, GAMES) {
  const clean = deps.clean || ((s) => String(s ?? ''));
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function buildBase(tpl, avatarImg, sc = SC) {
    const { createCanvas } = deps.canvasLib;
    const cv = createCanvas(Math.round(W * sc), Math.round(H * sc));
    const g = cv.getContext('2d');
    g.scale(sc, sc);
    const k = Math.max(W / tpl.width, H / tpl.height);
    const sw = W / k;
    const sh = H / k;
    g.drawImage(tpl, (tpl.width - sw) / 2, (tpl.height - sh) / 2, sw, sh, 0, 0, W, H);
    // avatar rond
    g.save();
    g.beginPath();
    g.arc(AV.cx, AV.cy, AV.d / 2, 0, D.TAU);
    g.closePath();
    g.clip();
    if (avatarImg) {
      const sq = Math.min(avatarImg.width, avatarImg.height);
      g.drawImage(avatarImg, (avatarImg.width - sq) / 2, (avatarImg.height - sq) / 2, sq, sq, AV.cx - AV.d / 2, AV.cy - AV.d / 2, AV.d, AV.d);
      g.restore();
    } else {
      g.restore();
      D.spark(g, AV.cx, AV.cy, AV.d * 0.3, '#FFFFFF', 0.85);
    }
    return cv;
  }

  function renderFrame(base, game, built, frame, k, n, ctx, seed, o = {}) {
    const { createCanvas } = deps.canvasLib;
    const sc = o.sc || SC;
    const cv = createCanvas(Math.round(W * sc), Math.round(H * sc));
    const g = cv.getContext('2d');
    g.scale(sc, sc);
    g.drawImage(base, 0, 0, W, H);
    const last = k === n - 1;
    const p = n > 1 ? k / (n - 1) : 1;
    const outcome = last ? ctx.outcome : null;
    const accent = (outcome && OUT_COLOR[outcome]) || null;

    // ----- texte d'en-tête
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = D.font(13);
    g.fillText(fit(g, clean(`ZNK CASINO · ${game.title}`).toUpperCase(), TMAX), TX, 94);
    g.fillStyle = '#FFFFFF';
    g.font = D.font(28);
    g.fillText(fit(g, clean(ctx.userName || 'Joueur'), TMAX), TX, 121);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = D.font(15, 'normal');
    g.fillText(fit(g, clean(ctx.sub || ''), TMAX), TX, 145);

    // ----- barre : légende à gauche, progression / résultat à droite
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = D.font(14);
    g.fillText(fit(g, clean(frame.cap || '').toUpperCase(), 380), BAR.x + 16, BAR.y + BAR.h / 2 + 5);
    if (last && ctx.resultText) {
      g.textAlign = 'right';
      g.fillStyle = '#FFFFFF';
      g.font = D.font(18);
      g.fillText(fit(g, clean(ctx.resultText), 200), BAR.x + BAR.w - 16, BAR.y + BAR.h / 2 + 6);
      g.textAlign = 'left';
    } else if (o.gif) {
      const bw = 150;
      const bx = BAR.x + BAR.w - 16 - bw;
      const by = BAR.y + BAR.h / 2;
      D.rr(g, bx, by - 3, bw, 6, 3);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fill();
      D.rr(g, bx, by - 3, Math.max(6, bw * p), 6, 3);
      g.fillStyle = '#FFFFFF';
      g.fill();
    } else {
      for (let j = 0; j < n; j++) {
        const x = BAR.x + BAR.w - 16 - (n - 1 - j) * 15;
        g.beginPath();
        g.arc(x, BAR.y + BAR.h / 2, 4, 0, D.TAU);
        g.fillStyle = j <= k ? '#FFFFFF' : 'rgba(255,255,255,0.3)';
        g.fill();
      }
    }

    // ----- médaillon animé (par-dessus l'icône dessinée dans le gabarit)
    g.save();
    g.beginPath();
    g.arc(MED.cx, MED.cy, MED.r, 0, D.TAU);
    g.clip();
    const mg = g.createRadialGradient(MED.cx, MED.cy - 10, 4, MED.cx, MED.cy, MED.r);
    mg.addColorStop(0, '#5B1FA6');
    mg.addColorStop(1, '#16052F');
    g.fillStyle = mg;
    g.fillRect(MED.cx - MED.r, MED.cy - MED.r, MED.r * 2, MED.r * 2);
    g.translate(MED.cx, MED.cy);
    const emblem = frame.emblem || built.emblem || game.emblem;
    if (emblem) {
      const rndE = D.mulberry(seed + k * 131 + 7);
      emblem({ g, p, k, n, last, res: ctx.res, ctx, data: ctx.data || {}, rnd: rndE, r: MED.r }, 0, 0);
    }
    g.restore();
    g.save();
    g.beginPath();
    g.arc(MED.cx, MED.cy, MED.r, 0, D.TAU);
    g.lineWidth = 2.2;
    g.strokeStyle = accent || 'rgba(233,213,255,0.85)';
    g.shadowColor = accent || '#C084FC';
    g.shadowBlur = 10;
    g.stroke();
    g.restore();

    // ----- scène du jeu (table de jeu thématique)
    g.save();
    g.translate(STAGE.x, STAGE.y);
    // ombre portée sous la table
    g.save();
    D.rr(g, 0, 0, STAGE.w, STAGE.h, 18);
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 4;
    g.fillStyle = '#10042A';
    g.fill();
    g.restore();
    D.stage(g, STAGE.w, STAGE.h, game.theme || {});
    g.save();
    D.rr(g, 0, 0, STAGE.w, STAGE.h, 18);
    g.clip();
    const rnd = D.mulberry(seed + k * 977 + 13);
    frame.draw({
      g, w: STAGE.w, h: STAGE.h, cx: STAGE.w / 2, cy: STAGE.h / 2,
      p, k, n, last, res: ctx.res, ctx, data: ctx.data || {}, rnd, outcome, accent,
    });
    if (last && outcome === 'win') {
      D.confetti(g, D.mulberry(seed + 9), STAGE.w, STAGE.h, 34);
      D.sparkles(g, D.mulberry(seed + 5), STAGE.w, STAGE.h, 14);
    } else if (last && outcome === 'lose') {
      D.vignette(g, STAGE.w, STAGE.h, 'rgba(120,10,40,0.38)', 0.3);
    }
    g.restore();
    D.stageRim(g, STAGE.w, STAGE.h, accent || (game.theme && game.theme.rim) || 'rgba(192,132,252,0.85)', accent ? 16 : 10);
    g.restore();
    if (o.raw) return cv;
    return cv.toBuffer('image/jpeg', 90);
  }

  // Images fixes de secours pour un jeu qui n'a que la version GIF : on échantillonne l'animation
  function autoBuild(game, res, ctx) {
    const anim = game.gif(res, ctx);
    const ts = [0, 0.2, 0.4, 0.6, 0.8, 1];
    return {
      frames: ts.map((t, k) => ({
        cap: anim.cap ? anim.cap(t) : '',
        ms: k === ts.length - 1 ? 1300 : 850,
        draw: (S) => anim.draw(S, t),
      })),
      emblem: game.emblem,
    };
  }

  // Rend l'animation continue d'un jeu en GIF (800x400) ; renvoie { buf, ms } ou null
  async function renderGif(game, res, ctx, baseGif, seed, step) {
    const anim = game.gif(res, ctx);
    const total = Math.max(8, Math.round((anim.dur * 100) / GIF_DELAY / step) + 1);
    const delay = GIF_DELAY * step;
    const enc = createEncoder(Math.round(W * GS), Math.round(H * GS));
    for (let k = 0; k < total; k++) {
      const t = k / (total - 1);
      const frame = { cap: anim.cap ? anim.cap(t) : '', draw: (S) => anim.draw(S, t) };
      const cv = renderFrame(baseGif, game, {}, frame, k, total, ctx, seed, { sc: GS, raw: true, gif: true });
      const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      enc.add(px, k === total - 1 ? anim.hold || GIF_HOLD : delay);
      if (k % 6 === 5) await new Promise((r) => setImmediate(r)); // laisse respirer le bot
    }
    const buf = enc.finish();
    return { buf, ms: (total - 1) * delay * 10 + Math.min(anim.hold || GIF_HOLD, 150) * 10 };
  }

  async function playGif(i, key, game, res, ctx, tpl, avatarImg) {
    try {
      const baseGif = await buildBase(tpl, avatarImg, GS);
      const seed = (Date.now() & 0xffffff) + key.length;
      let out = await renderGif(game, res, ctx, baseGif, seed, 1);
      if (out.buf.length > GIF_MAX_BYTES) out = await renderGif(game, res, ctx, baseGif, seed, 2); // trop lourd : moitié moins d'images
      if (out.buf.length > GIF_MAX_BYTES) return false;
      const name = `znk-${key}-${Date.now()}.gif`;
      const embed = new deps.EmbedBuilder().setColor(deps.color ? deps.color(1, 2) : 0xa81cfd).setImage(`attachment://${name}`);
      if (typeof ctx.decorate === 'function') ctx.decorate(embed); // texte sous le GIF (mise, consigne...)
      // ctx.deliver : envoi personnalisé (ex. bouton déjà différé) ; ctx.components : boutons gardés sous le GIF
      const deliver = ctx.deliver || ((p) => i.editReply(p));
      const keep = Array.isArray(ctx.components) ? ctx.components : [];
      await deliver({
        embeds: [embed],
        files: [new deps.AttachmentBuilder(out.buf, { name })],
        components: keep,
        attachments: [],
      });
      ctx.gifName = name;
      if (!ctx.noWait) await sleep(out.ms + 900); // durée du GIF + temps d'affichage côté client
      return true;
    } catch (e) {
      console.error(`[games] GIF « ${key} » :`, e?.message || e);
      return false;
    }
  }

  /**
   * Joue l'animation d'un jeu : GIF animé si le jeu en a un (variable GAME_GIF=off pour couper),
   * sinon (ou en cas de problème) images fixes envoyées l'une après l'autre.
   *  i   : interaction (editReply)
   *  key : clé du jeu
   *  res : résultat déjà tiré ; ctx : { user, bet, choice, outcome, resultText, data... }
   * Renvoie true si l'animation a été jouée (ou volontairement sautée), false sinon.
   */
  async function play(i, key, res, ctx = {}) {
    const game = GAMES[key];
    if (!game || !deps.canvasLib) return false;
    try {
      if (ctx.user && deps.wantsSkip && deps.wantsSkip(ctx.user.id)) return true;
      const tpl = await deps.getTemplate();
      if (!tpl) return false;
      D.setFont(typeof deps.font === 'function' ? deps.font() : deps.font);
      const avatarImg = ctx.user && deps.getAvatar ? await deps.getAvatar(ctx.user).catch(() => null) : null;
      ctx.res = res;
      ctx.userName = ctx.userName || (ctx.user && deps.userName ? deps.userName(ctx.user) : 'Joueur');

      const gifOn = String(process.env.GAME_GIF || 'on').toLowerCase() !== 'off' && typeof game.gif === 'function';
      if (gifOn && (await playGif(i, key, game, res, ctx, tpl, avatarImg))) return true;

      // ----- images fixes (jeux sans GIF, ou GIF impossible)
      const built = game.build ? game.build(res, ctx) : typeof game.gif === 'function' ? autoBuild(game, res, ctx) : null;
      const frames = built && built.frames;
      if (!frames || !frames.length) return false;
      const base = await buildBase(tpl, avatarImg);
      const n = frames.length;
      const seed = (Date.now() & 0xffffff) + n;
      const stamp = `${Date.now()}`;
      let next = renderFrame(base, game, built, frames[0], 0, n, ctx, seed);
      for (let k = 0; k < n; k++) {
        const buf = next;
        const name = `znk-${key}-${stamp}-${k}.jpg`;
        const embed = new deps.EmbedBuilder().setColor(deps.color ? deps.color(k, n) : 0xa81cfd).setImage(`attachment://${name}`);
        try {
          await i.editReply({
            embeds: [embed],
            files: [new deps.AttachmentBuilder(buf, { name })],
            components: [],
            attachments: [],
          });
        } catch (e) {
          if (k === 0) return false; // impossible d'afficher l'image : repli sur l'animation texte
        }
        if (k < n - 1) {
          const pending = Promise.resolve().then(() => renderFrame(base, game, built, frames[k + 1], k + 1, n, ctx, seed));
          await sleep(Math.max(700, frames[k].ms || 900));
          next = await pending;
        }
      }
      return true;
    } catch (e) {
      console.error(`[games] animation « ${key} » :`, e?.message || e);
      return false;
    }
  }

  return { play, has: (key) => !!GAMES[key], keys: () => Object.keys(GAMES) };
}

module.exports = { create, STAGE, MED };
