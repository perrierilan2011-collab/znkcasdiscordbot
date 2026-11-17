'use strict';
require('dotenv').config();

const { randomInt } = require('crypto');
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  AttachmentBuilder,
  escapeMarkdown,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Background images: ./images folder next to index.js (Railway *_BG_URL variables take priority)
const IMG_DIR = path.join(__dirname, 'images');
const localImg = (file) => {
  try {
    const p = path.join(IMG_DIR, file);
    return fs.existsSync(p) ? p : '';
  } catch {
    return '';
  }
};
// Background banner (image without text) above a panel: images/panel_*.png (ignored if file does not exist)
// CARD_GIF=off: fall back to static PNG images (no animation)
const CARD_GIF = false; // disabled — no GIF/image cards
// Image system removed: panels, cards, banners and GIFs are text embeds only.
function withBanner(payload, file) {
  return payload;
}
// Panel / menu without image: generic banner (images/generic_text_card) WITH the panel text written on it
// (title, subtitle, a few lines). Before, the empty background was sent as-is: nothing was visible on it.
// - first time: static image with text (instant); the animated GIF is computed in the background then reused.
// - if all text fits on the image (no code block, <= 5 lines), the embed title/description are removed
//   to avoid showing the same thing twice; otherwise the embed keeps its text.
// attachments: [] removes the old banner when the panel is updated (otherwise it would show twice).
const BANNER_FILE = 'generic_text_card.png';
const bannerCache = new Map(); // key text -> { png, gif, complete }
const bannerPending = new Set();
let bannerBg = null;
let bannerBgLoading = false;
// ASYNC background loading (synchronous decoding would draw an empty image). Until ready: no banner.
function getBannerBg() {
  if (bannerBg || bannerBgLoading || !canvasLib) return bannerBg;
  const p = localImg(BANNER_FILE);
  if (!p) return null;
  bannerBgLoading = true;
  canvasLib
    .loadImage(fs.readFileSync(p))
    .then((img) => {
      bannerBg = img;
    })
    .catch((e) => console.error('[banner] unreadable background:', e?.message || e))
    .finally(() => {
      bannerBgLoading = false;
    });
  return null;
}
const bannerPlain = (s) =>
  noEmoji(
    String(s || '')
      .replace(/<(?:@[!&]?|#|a?:\w+:)\d*>/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`|]/g, '')
      .replace(/^\s*[>#-]+\s*/, '')
      .replace(/[\u2190-\u21FF\u25A0-\u25FF\u2600-\u27BF\u2B00-\u2BFF]/g, '') // ✦ ★ ▶ ➜ ... (not in the bot font)
  );
function bannerInfo(embed) {
  const d = embed.data || {};
  const desc = String(d.description || '');
  const hasCode = desc.includes('```');
  return {
    title: bannerPlain(d.title),
    lines: hasCode ? [] : desc.split('\n').map(bannerPlain).filter(Boolean),
    hasCode,
  };
}
function wrapLines(g, text, maxW) {
  const out = [];
  let cur = '';
  for (const word of String(text).split(' ')) {
    const t = cur ? `${cur} ${word}` : word;
    if (cur && g.measureText(t).width > maxW) {
      out.push(cur);
      cur = word;
    } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
// Draws text on the empty background. Returns { cv, complete } (complete = nothing was truncated)
function drawPanelBanner(info, bg) {
  const W = 800, H = 400, SC = 1.25;
  const cv = canvasLib.createCanvas(W * SC, H * SC);
  const g = cv.getContext('2d');
  g.scale(SC, SC);
  const k = Math.max(W / bg.width, H / bg.height);
  const sw = W / k, sh = H / k;
  g.drawImage(bg, (bg.width - sw) / 2, (bg.height - sh) / 2, sw, sh, 0, 0, W, H);
  const FONT = STATS_FONT;
  // avatar: white star in the template circle
  g.fillStyle = 'rgba(255,255,255,0.85)';
  drawStar(g, CARD_L.av.cx, CARD_L.av.cy, CARD_L.av.d * 0.3);
  const tx = CARD_L.tx;
  const tmax = 520 - tx;
  let complete = true;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = `bold 13px ${FONT}`;
  g.fillText('ZNK CASINO', tx, 94);
  g.fillStyle = '#FFFFFF';
  let tfs = 28;
  g.font = `bold ${tfs}px ${FONT}`;
  while (tfs > 17 && g.measureText(info.title).width > tmax) {
    tfs -= 1;
    g.font = `bold ${tfs}px ${FONT}`;
  }
  if (g.measureText(info.title).width > tmax) complete = false;
  g.fillText(fitText(g, info.title || 'ZNK CASINO', tmax), tx, 121);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.font = `15px ${FONT}`;
  const hasSub = !!info.lines[0] && g.measureText(info.lines[0]).width <= tmax;
  if (hasSub) g.fillText(info.lines[0], tx, 145);
  // main frame: the other lines (automatic line wrapping)
  g.font = `17px ${FONT}`;
  const body = info.lines.slice(hasSub ? 1 : 0).flatMap((l) => wrapLines(g, l, 600));
  const MAXL = 4;
  if (body.length > MAXL) complete = false;
  const shown = body.slice(0, MAXL);
  g.textAlign = 'center';
  if (shown.length) {
    const lh = 27;
    const y0 = 246 - ((shown.length - 1) * lh) / 2 + 6;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    shown.forEach((l, n) => g.fillText(shown.length === MAXL && n === MAXL - 1 && body.length > MAXL ? fitText(g, `${l}…`, 600) : l, 386, y0 + n * lh));
  } else {
    // nothing else to say: title in large text in the frame
    g.fillStyle = '#FFFFFF';
    g.font = `bold 30px ${FONT}`;
    g.fillText(fitText(g, info.title || 'ZNK CASINO', 600), 386, 258);
  }
  g.textAlign = 'left';
  return { cv, complete: complete && !info.hasCode && !!info.title && info.lines.length > 0 };
}
function panelBanner(embed) {
  return null;
}
function animPanel(payload) {
  return payload;
}
// Prepares main panel GIFs at startup (the first "Play" click is then already animated)
function warmPanelBanners() {
  if (!canvasLib) return;
  for (const f of [() => buildGameMenuPayload(null, 0, 'all'), () => buildSettingsPayload(null), () => buildRulesPayload(null)]) {
    try {
      f();
    } catch {
      /* facultatif */
    }
  }
}
const bgSource = (envName, file) => String(process.env[envName] || '').trim() || localImg(file);
// Loads an image from an http(s) URL or a local file
async function readImageSource(src, loadImage, timeoutMs = 8000) {
  if (!/^https?:\/\//i.test(src)) return loadImage(fs.readFileSync(src));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(src, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } finally {
    clearTimeout(timer);
  }
}

// Stats banner: npm i @napi-rs/canvas  (optional, otherwise falls back to text embed)
let canvasLib = null;
try {
  canvasLib = require('@napi-rs/canvas');
} catch {
  console.warn('[stats] @napi-rs/canvas missing: stats banner will be replaced by a text embed (npm i @napi-rs/canvas).');
}

// Animated cards: the decor (stars, halo, reflections) moves smoothly, the text stays fixed.
// Returns a looping GIF, or the classic PNG if animation is off / impossible.
const fxAnim = require('./games/fx');
const imgExt = (b) => (b && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 ? 'gif' : 'png');
async function animOrPng(cv, file, src) {
  if (!CARD_GIF) return cv.toBuffer('image/png');
  if (!canvasLib || !file) return cv.toBuffer('image/png');
  // src = actually used background (local file OR *_BG_URL link): animation is applied in both cases
  const gif = await fxAnim.animateCard(canvasLib, cv, file, IMG_DIR, { src: src || localImg(file) });
  if (gif) return gif;
  return cv.toBuffer('image/png');
}

// Embedded font (./fonts folder): essential on servers without system fonts (Railway...)
let STATS_FONT = 'sans-serif';
if (canvasLib && canvasLib.GlobalFonts) {
  try {
    const dir = path.join(__dirname, 'fonts');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f)) : [];
    let loaded = 0;
    for (const f of files) {
      if (canvasLib.GlobalFonts.registerFromPath(path.join(dir, f), 'ZNKSans')) loaded++;
    }
    if (loaded) {
      STATS_FONT = 'ZNKSans';
      console.log(`[stats] ${loaded} font(s) loaded from ${dir}: ${files.join(', ')}`);
    } else {
      console.warn(`[stats] no valid font in ${dir} (files found: ${files.join(', ') || 'none'}) : banner text will be invisible.`);
    }
  } catch (e) {
    console.warn('[stats] could not save font:', e?.message || e);
  }
}

// ============================================================
//  CONFIG
// ============================================================
const PREFIX = '!';

// ---- MONNAIE (modifiable depuis Railway > Variables) ----
//  COIN_EMOJI: what appears everywhere next to amounts (default: 🪙)
//  COIN_TEXT  : text version for places without emoji (canvas image, pop-ups)
//               if absent, COIN_EMOJI is reused
const COIN = String(process.env.COIN_EMOJI || '🪙').trim() || '🪙';
const COIN_PLAIN = String(process.env.COIN_TEXT || COIN).trim() || COIN;
const plain = (s) => String(s).split(COIN).join(COIN_PLAIN);
console.log(`[coin] ${COIN} (text: ${COIN_PLAIN})`);

const DAILY_AMOUNT = 30;
const INVITE_REWARD = Math.max(1, Number(process.env.INVITE_REWARD) || 10);
const LEADERBOARD_REFRESH_MS = 60_000;
const IDLE_MS = 90_000;
const MAX_ADMIN_AMOUNT = 100_000_000;
const EPH = MessageFlags.Ephemeral;

const { DISCORD_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!DISCORD_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '❌ Missing environment variables: DISCORD_TOKEN, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },

  // Node < 22 has no native WebSocket: provide "ws" (otherwise it crashes on startup)
  realtime: { transport: require('ws') },
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
  allowedMentions: { parse: [], repliedUser: false },
});

const COLORS = {
  green: 0xA81CFD, // win = ZNK violet
  red: 0x2B0A3D, // loss = very dark violet
  grey: 0x6B5B7B, // tie / neutral
  blue: 0x7C3AED,
  gold: 0xD946EF,
  violet: 0xA81CFD,
  black: 0x0B0614,
};

// ============================================================

//  PLAYER PREFS: language + win pings
// ============================================================
const LANG_FILE = path.join(__dirname, 'data', 'lang.json');
const PING_FILE = path.join(__dirname, 'data', 'winping.json');
const FAV_FILE = path.join(__dirname, 'data', 'favorites.json');
const SKIP_FILE = path.join(__dirname, 'data', 'skipanim.json');
const userLang = new Map(); // userId -> 'fr' | 'en'

const winPingOff = new Set(); // userIds who don't want pings in the wins channel
const userFavs = new Map(); // userId -> Set of game keys
const skipAnimUsers = new Set(); // userIds who skip animations

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(LANG_FILE, 'utf8'));
    for (const [id, lang] of Object.entries(raw)) if (lang === 'fr' || lang === 'en') userLang.set(id, lang);
  } catch {

    /* first launch */
  }
  try {
    const raw = JSON.parse(fs.readFileSync(PING_FILE, 'utf8'));
    if (Array.isArray(raw)) for (const id of raw) winPingOff.add(String(id));
  } catch {

    /* first launch */
  }
  try {
    const raw = JSON.parse(fs.readFileSync(FAV_FILE, 'utf8'));
    for (const [id, arr] of Object.entries(raw)) {
      if (Array.isArray(arr)) userFavs.set(id, new Set(arr.map(String)));
    }
  } catch {

    /* first launch */
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SKIP_FILE, 'utf8'));
    if (Array.isArray(raw)) for (const id of raw) skipAnimUsers.add(String(id));
  } catch {

    /* first launch */
  }
}
function saveJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[prefs]', e?.message || e);
  }
}
// The bot is English-only: ignore stored user language for all outgoing bot text.
// LANG_FILE / userLang are kept for backwards compatibility but never affect replies.
const getLang = (userId) => 'en';
function setLang(userId, lang) {
  userLang.set(userId, lang === 'en' ? 'en' : 'fr');
  saveJson(LANG_FILE, Object.fromEntries(userLang));
}
const wantsWinPing = (userId) => !winPingOff.has(userId);
function setWinPing(userId, on) {
  if (on) winPingOff.delete(userId);
  else winPingOff.add(userId);
  saveJson(PING_FILE, [...winPingOff]);
}
const getFavs = (userId) => userFavs.get(userId) || new Set();
function toggleFav(userId, game) {
  let s = userFavs.get(userId);
  if (!s) {
    s = new Set();
    userFavs.set(userId, s);
  }
  if (s.has(game)) s.delete(game);
  else s.add(game);
  const obj = {};
  for (const [id, set] of userFavs) obj[id] = [...set];
  saveJson(FAV_FILE, obj);
  return s.has(game);
}
const wantsSkipAnim = (userId) => skipAnimUsers.has(userId);
function setSkipAnim(userId, on) {
  if (on) skipAnimUsers.add(userId);
  else skipAnimUsers.delete(userId);
  saveJson(SKIP_FILE, [...skipAnimUsers]);
}
const L = (uid, fr, en) => (getLang(uid) === 'en' ? en : fr);

const I18N = {
  fr: {
    yourBalance: 'Your balance',
    dailyOk: 'You received',
    dailyAlready: 'You already claimed your daily today. Come back after midnight (Paris time).',
    newBalance: 'New balance',
    lobbyTitle: '✦ Choose your table',
    lobbyDesc:
      'Select a game from the **menu below**.\nA window opens for your bet (your balance is shown).',
    lobbyPlaceholder: '🎮 Choose a game...',
    lobbyFooter: 'Private menu · only visible to you',
    sendPick: `💸 Who do you want to send ${COIN} from your balance to?`,
    insufficient: `You don\'t have enough ${COIN} for this bet.`,
  },
  en: {
    yourBalance: 'Your balance',
    dailyOk: 'You received',
    dailyAlready: 'You already claimed today’s daily. Come back after midnight (Paris).',
    newBalance: 'New balance',
    lobbyTitle: '✦ Pick your table',
    lobbyDesc:
      'Select a game in the **menu below**.\nA popup opens for your bet (your balance is shown).',
    lobbyPlaceholder: '🎮 Choose a game...',
    lobbyFooter: 'Private menu · only visible to you',
    sendPick: `💸 Who do you want to send ${COIN} to?`,
    insufficient: `Not enough ${COIN} for this bet.`,
  },
};
const t = (userId, key) => I18N[getLang(userId)][key] ?? I18N.fr[key] ?? key;

loadPrefs();

/** Last server from which the player launched Start (for DM games). */
const userHomeGuild = new Map();
function resolveGuildId(i) {
  if (i.guild?.id) return i.guild.id;
  return userHomeGuild.get(i.user.id) || null;
}

// ============================================================
//  OUTILS
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Aborts an overly slow operation (e.g. image generation) to never block a Discord response
const withTimeout = (p, ms, fallback = null) =>
  Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);
const range = (n) => Array.from({ length: n }, (_, i) => i);
const round2 = (n) => Math.round(n * 100) / 100;
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const num = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmt = (n) => `${num(n)} ${COIN}`;
const fx = (m) => `x${Number(m).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;
const padL = (s, n) => String(s).padStart(n, ' ');
const padR = (s, n) => String(s).padEnd(n, ' ');
const code = (lines) => '```\n' + (Array.isArray(lines) ? lines.join('\n') : lines) + '\n```';
const sideBySide = (blocks, gap = '  ') => blocks[0].map((_, r) => blocks.map((b) => b[r]).join(gap));
const short = (m) => String(round2(m)); // compact multiplier for animations

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// "5", "2.5", "2,5", "all"/"tout"/"max" (si max fourni)
function parseAmount(str, max, allowZero = false) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase().replace(',', '.');
  if (['all', 'tout', 'max'].includes(s)) return max && max > 0 ? max : null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 || (allowZero && n === 0) ? n : null;
}

function parseUserId(str) {
  if (!str) return null;
  const m = str.match(/^<@!?(\d{15,25})>$/) || str.match(/^(\d{15,25})$/);
  return m ? m[1] : null;
}

const MSG = {
  busy: '⏳ You already have a game in progress. Finish it first (it settles automatically after 90 s of inactivity).',
  noMoney: `You don't have any ${COIN}. Click **🎁 Daily** in the panel to claim today's reward.`,
  insufficient: `You don't have enough ${COIN} for this bet.`,
};

const isCrown = (msg) => {
  if (!msg?.guild || !msg?.author?.id) return false;
  if (String(msg.author.id) === String(msg.guild.ownerId)) return true;
  if (String(process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean).includes(String(msg.author.id))) return true;
  return false;
};
const CROWN_ONLY = '👑 Only the server owner (the one with the crown) can do this.';

// ============================================================
//  MOTEUR D'ANIMATION
//  A frame = { art, caption, ms }. Everything is drawn with characters (code block).
// ============================================================
const ANIM_PALETTE = [0x1A0B2E, 0x3B0F66, 0x6D28D9, 0x8B1FE0, 0xA81CFD, 0xC026D3, 0xD946EF];
const gradientColor = (idx, n) =>
  ANIM_PALETTE[Math.min(ANIM_PALETTE.length - 1, Math.round((idx / Math.max(1, n - 1)) * (ANIM_PALETTE.length - 1)))];

async function animate(i, frames, title, head = '', key = null) {
  if (!frames || !frames.length) return;
  const mk = (f, idx, n, footer) => {
    const e = new EmbedBuilder()
      .setTitle(title)
      .setColor(gradientColor(idx, n))
      .setDescription(`${head}${f.art}${f.caption ? `\n### ✦ ${f.caption}` : ''}`)
      .setFooter({ text: footer });
    if (key && gameIcon(key)) e.setThumbnail(gameIcon(key));
    return e;
  };
  // Animations disabled by the player: direct result
  if (i.user && wantsSkipAnim(i.user.id)) {
    const last = frames[frames.length - 1];
    const f = typeof last === 'string' ? { art: last } : last;
    await i.editReply({ embeds: [mk(f, frames.length - 1, frames.length, 'ZNK Casino  •  Animations disabled')], components: [] }).catch(() => {});
    return;
  }
  const n = frames.length;
  for (let idx = 0; idx < n; idx++) {
    const f = typeof frames[idx] === 'string' ? { art: frames[idx] } : frames[idx];
    await i
      .editReply({
        embeds: [mk(f, idx, n, `ZNK CASINO  ${'▰'.repeat(idx + 1)}${'▱'.repeat(n - idx - 1)}`)],
        components: [],
      })
      .catch(() => {});
    await sleep(Math.max(750, f.ms || 900));
  }
}

function receipt(rows) {
  return code(rows.map(([a, b]) => padR(a, 13) + padL(plain(b), 17)));
}

// ============================================================
//  IMAGE ANIMATIONS  (./games folder: purple neon style)
//  Animated GIFs: bj, roulette, wheel, plinko, horses, crash (the rocket). Disable GIFs: GAME_GIF=off
//  Fixed images: mines, coinflip, dice, slots, duel, suit, zone.
//  Other games keep text animation. Disable everything: GAME_IMAGES=off variable
// ============================================================
let gameAnimator = null;
let gameAnimatorFailed = false;
function getGameAnimator() {
  if (gameAnimator || gameAnimatorFailed || !canvasLib) return gameAnimator;
  try {
    gameAnimator = require('./games').create({
      canvasLib,
      font: () => STATS_FONT,
      sleep,
      wantsSkip: wantsSkipAnim,
      getTemplate: async () =>
        (await getBgByUrl(CARD_BG.result, canvasLib.loadImage)) ||
        (await getBgByUrl(localImg('game_result.png'), canvasLib.loadImage)),
      getAvatar: (u) => getAvatarCached(u, canvasLib.loadImage),
      userName: (u) => userName(u),
      clean: (txt) => noEmoji(txt),
      EmbedBuilder,
      AttachmentBuilder,
      ActionRowBuilder,
      ButtonBuilder,
      ButtonStyle,
      color: gradientColor,
    });
    console.log(`[games] image animations ready: ${gameAnimator.keys().join(', ')}`);
  } catch (e) {
    gameAnimatorFailed = true;
    console.warn('[games] ./games folder missing or invalid, text animations kept:', e?.message || e);
  }
  return gameAnimator;
}
// true = image animation played (or skipped by player choice); false = fallback to text animation
async function playGameImages(i, key, res, ctx = {}) {
  return false; // image/GIF system removed — text animations only
  if (String(process.env.GAME_IMAGES || 'on').toLowerCase() === 'off') return false;
  const a = getGameAnimator();
  if (!a || !a.has(key)) return false;
  return a.play(i, key, res, ctx);
}
const animResultText = (kind, mult) => (kind === 'win' ? `WIN ${fx(mult)}` : kind === 'lose' ? 'LOST' : 'TIE');

// ---------- ASCII Dice ----------
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieLines(n) {
  const on = new Set(PIPS[Math.max(1, Math.min(6, n))]);
  const c = (k) => (on.has(k) ? '●' : ' ');
  return [
    '╭───────╮',
    `│ ${c(0)} ${c(1)} ${c(2)} │`,
    `│ ${c(3)} ${c(4)} ${c(5)} │`,
    `│ ${c(6)} ${c(7)} ${c(8)} │`,
    '╰───────╯',
  ];
}
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const dieFace = (n) => DICE_FACES[Math.max(1, Math.min(6, n)) - 1];

// ---------- ASCII cards ----------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const newDeck = () => shuffle(SUITS.flatMap((s) => RANKS.map((r) => ({ r, s }))));
const cardStr = (c) => `\`${c.r}${c.s}\``;
function cardLines(c, hidden) {
  if (hidden || !c) return ['╭─────╮', '│░▒░▒░│', '│▒ZNK▒│', '│░▒░▒░│', '╰─────╯'];
  return ['╭─────╮', `│${padR(c.r, 2)}   │`, `│  ${c.s}  │`, `│   ${padL(c.r, 2)}│`, '╰─────╯'];
}
function handArt(cards, hiddenExtra = 0) {
  const blocks = cards.map((c) => cardLines(c, false));
  for (let k = 0; k < hiddenExtra; k++) blocks.push(cardLines(null, true));
  if (!blocks.length) return ['(en attente)'];
  return sideBySide(blocks, ' ');
}

// ---------- Scrolling band (roulette, wheel, ...) ----------
function stripArt(list, pos, cellFn, size = 5) {
  const half = (size - 1) / 2;
  const n = list.length;
  const cells = [];
  for (let k = -half; k <= half; k++) cells.push(cellFn(list[(((pos + k) % n) + n) % n], k === 0));
  const body = cells.join('');
  const w = body.length;
  const mid = Math.floor(w / 2);
  return [
    '.' + '-'.repeat(mid) + 'v' + '-'.repeat(w - mid - 1) + '.',
    '|' + body + '|',
    "'" + '-'.repeat(mid) + '^' + '-'.repeat(w - mid - 1) + "'",
  ];
}
// successive positions of a band that slows down and ends exactly on `finalIdx`
function stripPositions(finalIdx, steps) {
  const total = steps.reduce((a, b) => a + b, 0);
  const out = [];
  let p = finalIdx - total;
  out.push(p);
  for (const s of steps) {
    p += s;
    out.push(p);
  }
  return out;
}

// ============================================================
//  DATABASE (Supabase)
// ============================================================
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

const getBalance = async (id) => Number(await rpc('get_balance', { p_user_id: id }));

// ---------- Peak balances (all-time leaderboard) ----------
const PEAK_FILE = path.join(__dirname, 'data', 'peaks.json');
const peaks = new Map();

async function loadPeaks() {
  try {
    const raw = JSON.parse(fs.readFileSync(PEAK_FILE, 'utf8'));
    for (const [id, v] of Object.entries(raw)) if (Number(v) > 0) peaks.set(id, Number(v));
  } catch {

    /* first launch */
  }
  try {
    const { data, error } = await supabase.from('player_peaks').select('user_id, peak');
    if (!error && data) {
      for (const r of data) {
        const p = Number(r.peak);
        if (p > (peaks.get(r.user_id) || 0)) peaks.set(r.user_id, p);
      }
    }
  } catch (e) {
    console.error('[peaks] unreadable player_peaks table (optional):', e?.message || e);
  }
}

function savePeaksLocal() {
  saveJson(PEAK_FILE, Object.fromEntries(peaks));
}

async function touchPeak(userId, balance) {
  const bal = Number(balance);
  if (!Number.isFinite(bal) || bal <= 0) return;
  const prev = peaks.get(userId) || 0;
  if (bal <= prev) return;
  peaks.set(userId, bal);
  savePeaksLocal();
  try {
    await supabase.from('player_peaks').upsert({
      user_id: userId,
      peak: bal,
      updated_at: new Date().toISOString(),
    });
  } catch {
    /* table optionnelle */
  }
}

const credit = async (id, amount) => {
  const bal = Number(await rpc('change_balance', { p_user_id: id, p_amount: amount }));
  await touchPeak(id, bal);
  return bal;
};

async function debit(id, amount) {
  try {
    return Number(await rpc('change_balance', { p_user_id: id, p_amount: -amount }));
  } catch (e) {
    if (String(e?.message || '').includes('insufficient_funds')) return null;
    throw e;
  }
}

async function takeBet(uid, bet) {
  const bal = await getBalance(uid);
  if (bal <= 0) return MSG.noMoney;
  if (bet > bal) return MSG.insufficient;
  if ((await debit(uid, bet)) === null) return MSG.insufficient;
  return null;
}

// ============================================================
//  PRIVATE REPLIES (ephemeral)
// ============================================================
function fromEphemeral(i) {
  const f = i.message?.flags;
  if (!f) return false;
  try {
    return typeof f.has === 'function' ? f.has(MessageFlags.Ephemeral) : (Number(f) & MessageFlags.Ephemeral) !== 0;
  } catch {
    return false;
  }
}

async function respond(i, payload) {
  if ((i.isButton() || (i.isModalSubmit() && i.isFromMessage())) && fromEphemeral(i)) return i.update(payload);
  return i.reply({ ...payload, flags: EPH });
}

// Each game opens in its own private message (ephemeral popup): the lobby stays intact
// and multiple successive games no longer overwrite each other.
const openGame = (i, payload) => i.reply({ ...payload, flags: EPH });

const respondText = (i, text) => i.reply({ content: text, flags: EPH });

/** End-of-game buttons: Replay + back to panel */
function endGameRow(replayCustomId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(replayCustomId).setLabel('Replay').setEmoji('🔁').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_home').setLabel('Menu ZNK').setEmoji('💜').setStyle(ButtonStyle.Primary)
  );
}

const games = new Map();
const tryLock = (uid) => {
  if (games.has(uid)) return false;
  games.set(uid, { starting: true });
  return true;
};
const unlock = (uid) => games.delete(uid);

function armTimer(game) {
  clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    if (game.type === 'mines') settleMines(game, 'timeout', null);
    else settleBlackjack(game, 'stand', null);
  }, IDLE_MS);
}

// ============================================================
//  HISTORY + WINS CHANNEL
// ============================================================
const GAME_NAMES = {
  mines: '💣 Mines',
  bj: '🃏 Blackjack',
  roulette: '🎡 Roulette',

  coinflip: '🪙 Heads or Tails',

  dice: '🎲 Dice',

  slots: '🎰 Slot Machine',

  wheel: '🎡 Wheel of Fortune',

  duel: '⚔️ Card Duel',

  suit: '🃏 Card Suit',
  zone: '🎯 Zone',
  plinko: '🎱 Plinko',
  crash: '🚀 Crash',

  scratch: '🎟️ Scratch Ticket',

  die: '🎲 Exact Die',

  chest: '📦 Mystery Chest',

  russian: '🔫 Russian Roulette',

  horses: '🏇 Horse Race',
  limbo: '📈 Limbo',
  higher: '⬆️ Higher / Lower',

  rps: '✊ Rock-Paper-Scissors',

  colorpick: '🎨 Color',

  ladder: '🪜 Ladder',
  keno: '🎱 Keno',

  war: '⚔️ War',
  hilo: '🃏 Hi-Lo',
  bingo: '🅱️ Bingo',
  jackpot: '💎 Jackpot',

  // 30 new games

  dicewar: '🎲 Dice War',

  coinladder: '🪙 Coin Ladder',

  cardmatch: '🃏 Card Match',

  numguess: '🔢 Guess the Number',

  bombdefuse: '💣 Bomb Defusal',

  treasure: '🗺️ Treasure Map',

  highcard: '🃏 High Card',

  lowcard: '🃏 Low Card',

  pairmatch: '🃏 Pair',

  freefall: '🪂 Free Fall',

  balloon: '🎈 Balloon',

  target: '🎯 Target',

  sequence: '🔢 Sequence',

  animalrace: '🐾 Animal Race',

  fruitmatch: '🍎 Fruits',

  gemhunt: '💎 Gem Hunt',

  stardrop: '⭐ Shooting Star',

  moonshot: '🌙 Moon Shot',

  volcano: '🌋 Volcano',

  lightning: '⚡ Lightning',

  pokerhand: '🃏 Express Poker',

  redblack: '🔴 Red or Black',

  oddseven: '🔢 Odd or Even+',

  multiplier: '✖️ Multiplier',

  memory: '🧠 Memory',

  colorswipe: '🌈 Rainbow',

  rocket2: '🚀 Rocket 2',

  diceexact2: '🎲 Double Die',

  chest2: '📦 Triple Chest',

  spincolor: '🎨 Color Wheel',
  poker: '🃏 Poker',

  coin2: '🪙 Double Heads',

  dice7: '🎲 Dice 7+',
  lucky7: '7️⃣ Lucky 7',

  evenodd2: '🔢 Odd/Even 2',

  redblack2: '🔴 Red Black 2',

  highlow2: '⬆️ High Low',

  triple: '🎯 Triple Chance',
  quad: '4️⃣ Quad',
  penta: '5️⃣ Penta',

  coin3: '🪙 Triple Heads',
  snake: '🐍 Snake eyes',
  boxcars: '🎲 Boxcars',

  anydouble: '🎲 Any Double',

  acehigh: '🃏 High Ace',

  facecard: '🃏 Face Card',

  suitspade: '♠️ Spades',

  suithr: '♥️ Hearts',

  suitdi: '♦️ Diamonds',

  suitcl: '♣️ Clubs',
  blast: '💥 Blast',
  freeze: '❄️ Freeze',

  shadow: '🌑 Shadow',
  pulse: '💓 Pulse',

  orbit: '🪐 Orbit',

  spark: '✨ Spark',

  wave: '🌊 Wave',

  mirror: '🪞 Mirror',

  portal: '🌀 Portal',
  rune: '🔮 Rune',
  totem: '🗿 Totem',
  cactus: '🌵 Cactus',

  pearl: '🦪 Pearl',

  compass: '🧭 Compass',

  anchor: '⚓ Anchor',

  torch: '🔥 Torch',

  keylock: '🔑 Key',

  hourglass: '⏳ Hourglass',

  balloon2: '🎈 Balloon 2',

  dicehi: '🎲 High Die',

  dicelo: '🎲 Low Die',

  coinrush: '🪙 Coin Rush',

  starfall: '🌟 Starfall',

  meteor: '☄️ Meteor',

  rainbow: '🌈 Rainbow',

  clover: '🍀 Lucky Clover',
};

// Game name without the emoji (for canvas images, which don't render emojis)
const gameNamePlain = (g) => (GAME_NAMES[g] ? GAME_NAMES[g].replace(/^\S+\s/, '') : g);

// ============================================================
//  ZNK VISUAL IDENTITY
// ============================================================
const ZNK_LOGO = process.env.ZNK_LOGO_URL || undefined; // optionnel (Railway > Variables)
const emojiCode = (e) =>
  [...String(e)].map((c) => c.codePointAt(0)).filter((cp) => cp !== 0xfe0f).map((cp) => cp.toString(16)).join('-');
// Illustration for each game = its large emoji (Twemoji): no image to host
const gameIcon = (key) => {
  const n = GAME_NAMES[key];
  if (!n) return null;
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/72x72/${emojiCode(n.split(' ')[0])}.png`;
};

function brand(embed, key, footer) {
  embed.setAuthor({ name: `ZNK CASINO  •  ${gameNamePlain(key).toUpperCase()}`, iconURL: ZNK_LOGO });
  const ic = gameIcon(key);
  if (ic) embed.setThumbnail(ic);
  embed.setFooter({ text: footer || 'ZNK Casino  •  Private game' });
  return embed;
}

const LINE = '▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰';
function outcomeBanner(kind, amount) {
  const amt = Number.isFinite(amount) ? `**${signed(amount)}**` : '';
  if (kind === 'win') return `### 🏆 ━━  WIN  ━━ 🏆\n💜✨ ${amt || 'Well played!'} ✨💜\n${LINE}\n`;
  if (kind === 'lose') return `### 💀 ━━  LOSS  ━━ 💀\n🖤 ${amt || 'Better luck next time…'} 🖤\n${LINE}\n`;
  return `### 🤝 ━━  TIE  ━━ 🤝\n💜 Bet refunded\n${LINE}\n`;
}
const outcomeColor = (kind) => (kind === 'win' ? COLORS.violet : kind === 'lose' ? COLORS.red : COLORS.grey);
const launchBanner = (txt) => `### ✦ ${txt}\n\`${'▱'.repeat(16)}\`\n`;

// ============================================================
//  ADJUSTABLE MULTIPLIERS
// ============================================================
const MULT_MIN = 0.5;
const MULT_MAX = 10;
const MULT_FILE = path.join(__dirname, 'data', 'multipliers.json');
const multipliers = new Map();
const coef = (game) => multipliers.get(game) ?? 1;

async function loadMultipliers() {
  try {
    const raw = JSON.parse(fs.readFileSync(MULT_FILE, 'utf8'));
    for (const [g, v] of Object.entries(raw)) if (GAME_NAMES[g] && Number(v) > 0) multipliers.set(g, Number(v));
  } catch {

    /* first launch */
  }
  try {
    const { data, error } = await supabase.from('game_settings').select('game, multiplier');
    if (error) throw error;
    for (const r of data) if (GAME_NAMES[r.game] && Number(r.multiplier) > 0) multipliers.set(r.game, Number(r.multiplier));
  } catch (e) {
    console.error('[multipliers] game_settings table not found or unreadable (run schema_v3.sql):', e?.message || e);
  }
}

async function saveMultiplier(game, value, guildId = null, actorId = null) {
  multipliers.set(game, value);
  saveJson(MULT_FILE, Object.fromEntries(multipliers));
  let db = true;
  try {
    const { error } = await supabase
      .from('game_settings')
      .upsert({ game, multiplier: value, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (e) {
    console.error('[multiplicateurs] sauvegarde Supabase :', e?.message || e);
    db = false;
  }
  if (guildId) {
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        const who = actorId ? `👤 By <@${actorId}>\n` : '';
        await dmGuildEveryone(guild, {
          embeds: [
            new EmbedBuilder()
              .setTitle('🎚️ Multiplier updated')
              .setColor(COLORS.violet)
              .setDescription(
                `${who}**${GAME_NAMES[game] || game}**: multiplier set to **${fx(value)}**.\n` +
                  `All winnings from this game are now multiplied by this multiplier.`
              )
              .setTimestamp(),
          ],
        });
      }
    } catch (e) {
      console.error('[multipliers] announcement', e?.message || e);
    }
  }
  return { db };
}

// ---------- Boosts temporaires ----------
const activeBoosts = new Map();

function getBoost(guildId) {
  const b = activeBoosts.get(guildId);
  if (!b) return { winMult: 1, loseMult: 1, label: null };
  if (b.expiresAt && Date.now() > b.expiresAt) {
    clearTimeout(b.timer);
    activeBoosts.delete(guildId);
    return { winMult: 1, loseMult: 1, label: null };
  }
  return b;
}

async function startBoost(guildId, { winMult, loseMult, label, minutes }) {
  const prev = activeBoosts.get(guildId);
  if (prev?.timer) clearTimeout(prev.timer);
  const expiresAt = minutes > 0 ? Date.now() + minutes * 60_000 : null;
  const entry = { winMult, loseMult, label, expiresAt, timer: null };
  if (expiresAt) {
    entry.timer = setTimeout(() => {
      activeBoosts.delete(guildId);
      webEvent(guildId, { kind: 'boost_end', title: '⏰ Boost ended', text: `Event ${label} has ended. Back to normal winnings.` });
    }, expiresAt - Date.now());
  }
  activeBoosts.set(guildId, entry);
  return entry;
}

async function recordResult({ guildId, user, game, bet, mult, payout, detail }) {
  const profit = round2(payout - bet);
  try {
    const { error } = await supabase.from('game_history').insert({
      user_id: user.id,
      game,
      bet,
      multiplier: mult,
      payout,
      profit,
      detail: detail || null,
    });
    if (error) console.error('[history]', error.message);
  } catch (e) {
    console.error('[history]', e?.message || e);
  }

  if (profit <= 0) return;
  try {
    const ch = await findWinsChannel(guildId);
    if (!ch) {
      console.warn('[wins] no "wins" channel found for this server: run !wins (or !setup) in the server.');
      return;
    }
    const ping = wantsWinPing(user.id);
    const display = escapeMarkdown(user.globalName || user.username);
    const mention = ping ? `<@${user.id}>` : undefined;
    const allowedMentions = ping ? { users: [user.id] } : { parse: [] };

    // 1) Profit image ("win" card: avatar, game, bet, multiplier, win, profit)
    let buf = null;
    try {
      buf = await withTimeout(renderWinNotif(user, game, bet, mult, profit, detail), 12000, null);
    } catch (e) {
      console.error('[wins] image render:', e?.message || e);
    }
    if (buf) {
      try {
        const fname = `win-${Date.now()}.${imgExt(buf)}`;
        const imgEmbed = new EmbedBuilder().setColor(COLORS.violet).setImage(`attachment://${fname}`);
        await ch.send({
          content: mention,
          embeds: [imgEmbed],
          files: [new AttachmentBuilder(buf, { name: fname })],
          allowedMentions,
        });
        return;
      } catch (e) {
        console.error('[wins] image send denied ("Attach files" / "Embed links" permissions?), falling back to text:', e?.message || e);
      }
    } else {
      console.warn('[wins] image not generated (@napi-rs/canvas or images/win_notification.png missing?), falling back to text.');
    }

    // 2) Text fallback (never silent)
    const embed = new EmbedBuilder()
      .setColor(COLORS.violet)
      .setAuthor({ name: `${display} won!`, iconURL: user.displayAvatarURL() })
      .setThumbnail(gameIcon(game) || user.displayAvatarURL())
      .setDescription(`### 🏆 ${ping ? `<@${user.id}>` : `**${display}**`} remporte **${fmt(profit)}** !\n${LINE}`)
      .addFields(
        { name: '🎮 Game', value: GAME_NAMES[game] || game, inline: true },
        { name: '💰 Bet', value: fmt(bet), inline: true },
        { name: '✖️ Multi', value: fx(mult), inline: true },
        { name: '💜 Profit', value: `**${signed(profit)}**`, inline: true }
      )
      .setFooter({ text: 'ZNK Casino  •  Wins channel' })
      .setTimestamp();
    await ch.send({ content: mention, embeds: [embed], allowedMentions });
  } catch (e) {
    console.error('[wins]', e?.message || e);
  }
}

// Wins channel: remembered, otherwise found by its name (#wins). DM game with no known server: bot's only server.
async function findWinsChannel(guildId) {
  let gid = guildId;
  if (!gid) {
    if (client.guilds.cache.size !== 1) return null;
    gid = client.guilds.cache.first().id;
  }
  const guild = client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
  if (!guild) return null;
  const ch = await getSavedChannel(guild, 'wins').catch(() => null);
  return ch && ch.isTextBased && ch.isTextBased() ? ch : null;
}

async function historyEmbed(uid) {
  const { data, error } = await supabase
    .from('game_history')
    .select('game, bet, multiplier, profit, detail, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw error;

  const e = new EmbedBuilder().setTitle('📜 Your game history').setColor(COLORS.blue);
  if (!data.length) return e.setDescription('You haven\'t played yet. Start a game from the panel!');

  const net = round2(data.reduce((s, r) => s + Number(r.profit), 0));
  const lines = data.map((r) => {
    const p = Number(r.profit);
    const icon = p > 0 ? '🟢' : p < 0 ? '🔴' : '⚪';
    const ts = Math.floor(new Date(r.created_at).getTime() / 1000);
    return `${icon} ${GAME_NAMES[r.game] || r.game} · bet ${fmt(r.bet)} · ${fx(r.multiplier)} · **${signed(p)}** · <t:${ts}:R>`;
  });
  return e
    .setDescription(`Summary of your last ${data.length} games: **${signed(net)}**\n\n${lines.join('\n')}`)
    .setFooter({ text: 'Only visible to you' });
}

// ============================================================
//  STATS + BANNER (680x240, background #A81CFD)
// ============================================================
async function getPlayerStats(uid) {
  const st = { games: 0, wagered: 0, won: 0, lost: 0, net: 0, wins: 0, best: 0, favorite: null };
  const byGame = {};
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabase
      .from('game_history')
      .select('game, bet, profit')
      .eq('user_id', uid)
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data) {
      const bet = Number(r.bet);
      const profit = Number(r.profit);
      st.games++;
      st.wagered += bet;
      st.net += profit;
      if (profit > 0) {
        st.won += profit;
        st.wins++;
        if (profit > st.best) st.best = profit;
      } else if (profit < 0) st.lost += -profit;
      byGame[r.game] = (byGame[r.game] || 0) + 1;
    }
    if (data.length < 1000) break;
  }
  const fav = Object.entries(byGame).sort((a, b) => b[1] - a[1])[0];
  st.favorite = fav ? fav[0] : null;
  st.wagered = round2(st.wagered);
  st.won = round2(st.won);
  st.lost = round2(st.lost);
  st.net = round2(st.net);
  st.best = round2(st.best);
  st.rate = st.games ? Math.round((st.wins / st.games) * 100) : 0;
  return st;
}

function compact(n) {
  const v = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (v >= 1e9) return `${sign}${round2(v / 1e9)}B`;
  if (v >= 1e6) return `${sign}${round2(v / 1e6)}M`;
  if (v >= 1e4) return `${sign}${round2(v / 1e3)}K`;
  return `${sign}${String(round2(v))}`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Loads the Discord avatar: static PNG (handles animated GIF/WebP), then default avatar, never throws.
async function loadAvatarImage(user, loadImage) {
  const urls = [];
  try { urls.push(user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true })); } catch { /* ignore */ }
  try { urls.push(user.defaultAvatarURL); } catch { /* ignore */ }
  try {
    const idx = Number((BigInt(user.id) >> 22n) % 6n);
    urls.push(`https://cdn.discordapp.com/embed/avatars/${idx}.png`);
  } catch { /* ignore */ }
  for (const url of urls.filter(Boolean)) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      return await loadImage(Buffer.from(await res.arrayBuffer()));
    } catch {
      /* try the next source */
    }
  }
  return null;
}

// Truncates text with "…" so it fits in maxW pixels.
function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let t = Array.from(text);
  while (t.length > 1 && g.measureText(`${t.join('')}…`).width > maxW) t.pop();
  return `${t.join('')}…`;
}

// Stats background image (Railway STATS_BG_URL variable). Loaded once then cached.
const STATS_BG_URL = bgSource('STATS_BG_URL', 'stats_card.png');
// STATS_BG_MODE=template: the image already contains the cards (the bot only writes text in it)
const STATS_BG_MODE = String(process.env.STATS_BG_MODE || (STATS_BG_URL && !String(process.env.STATS_BG_URL || '').trim() ? 'template' : '')).trim().toLowerCase();
// Layouts aligned to template images (1774x887 -> 800x400). STATS_BG_MODE = preset name.
const STATS_PRESETS = {
  // Avatar on the left, Z logo on the right
  template: {
    head: { x: 155, y: 77, w: 448, h: 88 },
    av: { cx: 103, cy: 114.5, d: 84, halo: false },
    tx: 171, textRight: 585, nameY: 108,
    bar: { x: 61, y: 175, w: 582, h: 33 }, balFont: 20,
    cols: [[64, 198], [271, 199], [480, 230]],
    rows: [[220, 45], [271, 45]],
  },
  // Z logo on the left, avatar in the top frame
  'template-logo-left': {
    head: { x: 210, y: 79, w: 545, h: 95 },
    av: { cx: 257, cy: 126.5, d: 66, halo: true },
    tx: 287, textRight: 739, nameY: 118.5,
    bar: { x: 56, y: 184, w: 695, h: 38 }, balFont: 22,
    cols: [[56, 224], [293, 222], [527, 224]],
    rows: [[237, 46], [292, 47]],
  },
};
let statsBgPromise = null;
function getStatsBg(loadImage) {
  if (!STATS_BG_URL) return Promise.resolve(null);
  if (!statsBgPromise) {
    statsBgPromise = readImageSource(STATS_BG_URL, loadImage).catch((e) => {
      console.warn('[stats] STATS_BG_URL unreadable (use a direct png/jpg link):', e?.message || e);
      statsBgPromise = null; // retry on next display
      return null;
    });
  }
  return statsBgPromise;
}

async function renderStatsBanner(user, st, balance, lang) {
  if (!canvasLib) return null;
  const { createCanvas, loadImage } = canvasLib;
  // Fixed 2:1 format (800x400): Discord scales it without cropping, sharp on mobile and PC.
  const W = 800;
  const H = 400;
  const SCALE = 1.25;
  const cv = createCanvas(W * SCALE, H * SCALE);
  const g = cv.getContext('2d');
  g.scale(SCALE, SCALE);
  const FONT = STATS_FONT;
  const en = lang === 'en';

  // ZNK purple gradient background
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2B0A3D');
  bg.addColorStop(0.5, '#5B1A9E');
  bg.addColorStop(1, '#A81CFD');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const bgImg = await getStatsBg(loadImage);
  // "Template" mode: the image already contains the cards, only text is written in it.
  const P = bgImg ? STATS_PRESETS[STATS_BG_MODE] || null : null;
  const T = !!P;
  if (bgImg) {
    // centered "cover" crop (no distortion)
    const k = Math.max(W / bgImg.width, H / bgImg.height);
    const sw = W / k;
    const sh = H / k;
    g.drawImage(bgImg, (bgImg.width - sw) / 2, (bgImg.height - sh) / 2, sw, sh, 0, 0, W, H);
    if (!T) {
      g.fillStyle = 'rgba(15,4,30,0.45)'; // dark veil to keep text readable
      g.fillRect(0, 0, W, H);
    }
  }
  if (!T) {
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.arc(W - 60, -20, 170, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-40, H + 20, 130, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(217,70,239,0.10)';
    g.beginPath(); g.arc(W - 200, H + 50, 150, 0, Math.PI * 2); g.fill();
  }

  // ---- layout: standard or aligned to template image (1774x887 -> 800x400) ----
  const PAD = 28;
  const head = T ? P.head : { x: PAD, y: PAD, w: W - PAD * 2, h: 128 };
  const bar = T ? P.bar : { x: PAD, y: PAD + 128 + 14, w: W - PAD * 2, h: 44 };
  let boxes;
  if (T) {
    boxes = P.rows.flatMap(([y, h]) => P.cols.map(([x, w]) => ({ x, y, w, h })));
  } else {
    const gap = 12;
    const cw = Math.floor((W - PAD * 2 - gap * 2) / 3);
    const top = bar.y + 44 + 14;
    boxes = range(6).map((k) => ({ x: PAD + (k % 3) * (cw + gap), y: top + Math.floor(k / 3) * (62 + 10), w: cw, h: 62 }));
  }

  if (!T) {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(g, head.x, head.y, head.w, head.h, 20);
    g.fill();
  }

  // round avatar, square ratio respected (no distortion), glowing halo
  const AV = T ? P.av.d : 96;
  const ax = T ? P.av.cx - AV / 2 : head.x + 20;
  const ay = T ? P.av.cy - AV / 2 : head.y + (head.h - AV) / 2;
  const acx = ax + AV / 2;
  const acy = ay + AV / 2;
  if (!T || P.av.halo) {
    g.save();
    g.shadowColor = 'rgba(217,70,239,0.9)';
    g.shadowBlur = 18;
    g.fillStyle = '#D946EF';
    g.beginPath(); g.arc(acx, acy, AV / 2 + 3, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.save();
  g.beginPath();
  g.arc(acx, acy, AV / 2, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  const img = await loadAvatarImage(user, loadImage);
  if (img) {
    const s = Math.min(img.width, img.height); // centered square crop
    g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, ax, ay, AV, AV);
  } else {
    g.fillStyle = '#5865F2';
    g.fillRect(ax, ay, AV, AV);
    g.fillStyle = '#fff';
    g.font = `bold ${T ? 32 : 46}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(user.username || '?')[0].toUpperCase(), acx, acy + 2);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
  }
  g.restore();

  // username just right of the avatar + subtitle
  const tx = T ? P.tx : ax + AV + 22;
  const tmax = (T ? P.textRight : head.x + head.w - 20) - tx;
  const clean = (s) => String(s || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  const display = clean(user.globalName || user.username) || 'Player';
  const handle = clean(user.username);
  const fav = st.favorite ? gameNamePlain(st.favorite) : '-';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const nameY = T ? P.nameY : acy - 6;
  g.fillStyle = '#FFFFFF';
  g.font = `bold ${T ? 28 : 34}px ${FONT}`;
  g.fillText(fitText(g, display, tmax), tx, nameY);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.font = `${T ? 16 : 18}px ${FONT}`;
  g.fillText(fitText(g, handle && handle !== display ? `@${handle}` : 'ZNK CASINO', tmax), tx, nameY + (T ? 22 : 26));
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.font = `${T ? 13 : 15}px ${FONT}`;
  g.fillText(fitText(g, `Favorite game: ${fav}`, tmax), tx, nameY + (T ? 42 : 50));

  // balance (dedicated line, no overlap with the username)
  if (!T) {
    g.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(g, bar.x, bar.y, bar.w, bar.h, 14);
    g.fill();
  }
  const barPad = T ? 16 : 18;
  g.fillStyle = T ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.75)';
  g.font = `bold ${T ? 14 : 15}px ${FONT}`;
  g.fillText(en ? 'BALANCE' : 'BALANCE', bar.x + barPad, bar.y + bar.h / 2 + 5);
  g.textAlign = 'right';
  g.fillStyle = '#FFFFFF';
  g.font = `bold ${T ? P.balFont : 24}px ${FONT}`;
  g.fillText(`${compact(balance)} ${COIN_PLAIN}`, bar.x + bar.w - barPad, bar.y + bar.h / 2 + (T ? P.balFont * 0.36 : 9));
  g.textAlign = 'left';

  // 6 stat cards (3x2 grid)
  const cells = [
    [en ? 'GAMES PLAYED' : 'GAMES PLAYED', String(st.games), '#FFFFFF'],
    [en ? 'TOTAL WAGERED' : 'TOTAL WAGERED', `${compact(st.wagered)} ${COIN_PLAIN}`, '#FFFFFF'],
    [en ? 'TOTAL WON' : 'TOTAL WON', `${compact(st.won)} ${COIN_PLAIN}`, '#86EFAC'],
    [en ? 'TOTAL LOST' : 'TOTAL LOST', `${compact(st.lost)} ${COIN_PLAIN}`, '#FCA5A5'],
    [en ? 'NET PROFIT' : 'PROFIT NET', `${st.net > 0 ? '+' : ''}${compact(st.net)} ${COIN_PLAIN}`, st.net >= 0 ? '#86EFAC' : '#FCA5A5'],
    [en ? 'WIN RATE' : 'WIN RATE', `${st.rate} %`, '#F0ABFC'],
  ];
  cells.forEach(([label, value, color], k) => {
    const b = boxes[k];
    if (!T) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      roundRect(g, b.x, b.y, b.w, b.h, 14);
      g.fill();
    }
    const px = T ? 14 : 14;
    g.fillStyle = 'rgba(255,255,255,0.78)';
    g.font = `bold ${T ? 11 : 12}px ${FONT}`;
    g.fillText(fitText(g, label, b.w - px * 2), b.x + px, b.y + (T ? 17 : 22));
    g.fillStyle = color;
    g.font = `bold ${T ? 19 : 21}px ${FONT}`;
    g.fillText(fitText(g, value.replace(/\s/g, ' '), b.w - px * 2), b.x + px, b.y + (T ? 38 : 49));
  });

  return T ? await animOrPng(cv, 'stats_card.png', STATS_BG_URL) : cv.toBuffer('image/png');
}

async function buildStatsPayload(user, lang, viewerNote = '') {
  const [st, bal] = await Promise.all([getPlayerStats(user.id), getBalance(user.id)]);
  let buf = null; // image cards removed — always use the text embed
  if (buf) {
    const sName = `stats.${imgExt(buf)}`;
    const attachment = new AttachmentBuilder(buf, { name: sName });
    const embed = new EmbedBuilder()
      .setColor(COLORS.violet)
      .setImage(`attachment://${sName}`)
      .setFooter({ text: `ZNK Casino • ${user.globalName || user.username}${viewerNote}` });
    return { embeds: [embed], files: [attachment] };
  }
  return { embeds: [statsFallbackEmbed(user, st, bal, lang)], files: [] };
}

function statsFallbackEmbed(user, st, balance, lang) {
  const en = lang === 'en';
  return new EmbedBuilder()
    .setColor(0xA81CFD)
    .setTitle(`📊 Stats · ${user.globalName || user.username}`)
    .setDescription(
      code([
        `${padR(en ? 'Balance' : 'Balance', 18)}${padL(plain(fmt(balance)), 16)}`,
        `${padR(en ? 'Games played' : 'Games played', 18)}${padL(st.games, 16)}`,
        `${padR(en ? 'Total wagered' : 'Total wagered', 18)}${padL(plain(fmt(st.wagered)), 16)}`,
        `${padR(en ? 'Total won' : 'Total won', 18)}${padL(plain(fmt(st.won)), 16)}`,
        `${padR(en ? 'Total lost' : 'Total lost', 18)}${padL(plain(fmt(st.lost)), 16)}`,
        `${padR(en ? 'Net profit' : 'Profit net', 18)}${padL(plain(signed(st.net)), 16)}`,
        `${padR(en ? 'Win rate' : 'Victoires', 18)}${padL(`${st.rate} %`, 16)}`,
      ])
    )
    .setFooter({ text: 'Install @napi-rs/canvas for the image banner' });
}

// ============================================================
//  MINES  (24-cell grid, 4 difficulties)
// ============================================================
const MINES_CELLS = 24;
const MINES_EDGE = 0.96;
const MINES_MAX_MULT = 1000;
const LEVELS = {
  easy: { name: 'Easy', emoji: '🟢', mines: 4, style: ButtonStyle.Success },
  medium: { name: 'Medium', emoji: '🟡', mines: 7, style: ButtonStyle.Primary },
  hard: { name: 'Hard', emoji: '🟠', mines: 11, style: ButtonStyle.Secondary },
  impossible: { name: 'Impossible', emoji: '🔴', mines: 16, style: ButtonStyle.Danger },
};

function minesMultiplier(picks, mines) {
  if (picks <= 0) return 1;
  let m = 1;
  for (let k = 0; k < picks; k++) m *= (MINES_CELLS - k) / (MINES_CELLS - mines - k);
  return Math.min(MINES_MAX_MULT, Math.max(0.01, Math.floor(m * MINES_EDGE * coef('mines') * 100) / 100));
}

function minesPickerPayload() {
  const lines = Object.values(LEVELS).map(
    (Lv) =>
      `${Lv.emoji} **${Lv.name}** : ${Lv.mines} 💣 · ${MINES_CELLS - Lv.mines} 💎 · 1er diamant **${fx(minesMultiplier(1, Lv.mines))}**`
  );
  const embed = new EmbedBuilder()
    .setTitle('💣 Mines: choose your difficulty')
    .setColor(COLORS.blue)
    .setDescription(
      `${lines.join('\n')}\n\nThe more mines, the faster the multiplier climbs (max ${fx(MINES_MAX_MULT)}).`
    );
  const row = new ActionRowBuilder().addComponents(
    ...Object.entries(LEVELS).map(([key, Lv]) =>
      new ButtonBuilder().setCustomId(`mines_lvl_${key}`).setLabel(Lv.name).setEmoji(Lv.emoji).setStyle(Lv.style)
    )
  );
  return animPanel({ embeds: [embed], components: [row] });
}

function minesRows(game, over) {
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const row = new ActionRowBuilder();
    const cols = r < 4 ? 5 : 4;
    for (let c = 0; c < cols; c++) {
      const idx = r * 5 + c;
      const b = new ButtonBuilder().setCustomId(`mines_c_${idx}`);
      if (game.revealed.has(idx)) {
        b.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
      } else if (over && game.mineSet.has(idx)) {
        b.setEmoji('💣')
          .setStyle(game.hit === idx ? ButtonStyle.Danger : ButtonStyle.Secondary)
          .setDisabled(true);
      } else if (over) {
        b.setEmoji('💎').setStyle(ButtonStyle.Secondary).setDisabled(true);
      } else {
        b.setEmoji('🟪').setStyle(ButtonStyle.Secondary);
      }
      row.addComponents(b);
    }
    if (r === 4) {
      if (over) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`replay|mines|${game.bet}|${game.level}`)
            .setLabel('Replay')
            .setEmoji('🔁')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('panel_home')
            .setLabel('Menu ZNK')
            .setEmoji('💜')
            .setStyle(ButtonStyle.Primary)
        );
      } else {
        const gain = floor2(game.bet * minesMultiplier(game.revealed.size, game.mines));
        row.addComponents(
          new ButtonBuilder()
            .setCustomId('mines_cash')
            .setLabel(`Cash out ${num(gain)}`)
            .setEmoji('💰')
            .setStyle(ButtonStyle.Success)
            .setDisabled(game.revealed.size === 0)
        );
      }
    }
    rows.push(row);
  }
  return rows;
}

function minesEmbed(game, end) {
  const Lv = LEVELS[game.level];
  const picks = game.revealed.size;
  const safeTotal = MINES_CELLS - game.mines;
  const mult = minesMultiplier(picks, game.mines);
  const track = `[${'#'.repeat(picks)}${'.'.repeat(safeTotal - picks)}] ${picks}/${safeTotal}`;
  const e = new EmbedBuilder()
    .setTitle(`💣 Mines · ${Lv.emoji} ${Lv.name}`)
    .addFields(
      { name: 'Bet', value: fmt(game.bet), inline: true },
      { name: 'Mines', value: String(game.mines), inline: true },
      { name: 'Multiplier', value: fx(mult), inline: true },
      { name: 'Current win', value: fmt(floor2(game.bet * mult)), inline: true }
    );
  if (end) {
    const kind = end.color === COLORS.green ? 'win' : end.color === COLORS.red ? 'lose' : 'push';
    e.setColor(outcomeColor(kind)).setDescription(`${outcomeBanner(kind)}${code([track])}${end.text}`);
    e.addFields({ name: '👛 Balance', value: fmt(end.balance), inline: true });
  } else {
    e.setColor(COLORS.violet).setDescription(
      `${code([track])}Click the cells. Avoid 💣 and cash out whenever you want!`
    );
    if (picks < safeTotal) {
      e.addFields({ name: '💎 Prochain', value: fx(minesMultiplier(picks + 1, game.mines)), inline: true });
    }
  }
  return brand(e, 'mines');
}

async function startMines(i, level, bet) {
  const Lv = LEVELS[level];
  if (!Lv) return respondText(i, 'Unknown difficulty.');
  const uid = i.user.id;
  if (!tryLock(uid)) return respondText(i, MSG.busy);

  let started = false;
  try {
    const err = await takeBet(uid, bet);
    if (err) return respondText(i, err);

    const mineSet = new Set(shuffle(range(MINES_CELLS)).slice(0, Lv.mines));
    const game = {
      type: 'mines',
      userId: uid,
      user: i.user,
      guildId: resolveGuildId(i),
      bet,
      level,
      mines: Lv.mines,
      mineSet,
      revealed: new Set(),
      hit: null,
      messageId: null,
      lastI: i,
      timer: null,
      finished: false,
    };

    try {
      await openGame(i, { embeds: [minesEmbed(game)], components: minesRows(game, false) });
      game.messageId = (await i.fetchReply()).id;
    } catch (e) {
      await credit(uid, bet).catch(() => {});
      throw e;
    }
    games.set(uid, game);
    started = true;
    armTimer(game);
  } finally {
    if (!started) unlock(uid);
  }
}

async function settleMines(game, kind, i) {
  if (game.finished) return;
  game.finished = true;
  clearTimeout(game.timer);
  const t0 = Date.now();
  let held = false;
  try {
    // 1) Reply to Discord IMMEDIATELY (3s max), otherwise "the application did not respond".
    if (i && !i.deferred && !i.replied) {
      if (kind === 'lose') {
        const rows = minesRows(game, false);
        rows.forEach((r) => r.components.forEach((b) => b.setDisabled(true)));
        const hold = new EmbedBuilder()
          .setTitle(`💣 Mines · ${LEVELS[game.level].emoji} ${LEVELS[game.level].name}`)
          .setColor(COLORS.gold)
          .setDescription(code(['  The cell opens...', '', '      . . .']))
          .setFooter({ text: 'Verdict in a moment' });
        await i.update({ embeds: [hold], components: rows });
        held = true;
      } else {
        await i.deferUpdate();
      }
    }
    // 2) Only then: calculation, database, image
    const picks = game.revealed.size;
    let payout = 0;
    let mult = 0;
    let text;
    let color;
    let counted = true;

    if (kind === 'lose') {
      text = '💥 **Boom!** You hit a mine, bet lost.';
      color = COLORS.red;
    } else if (picks === 0) {
      payout = game.bet;
      mult = 1;
      counted = false;
      text = '⏱️ Game abandoned, bet refunded.';
      color = COLORS.grey;
    } else {
      mult = minesMultiplier(picks, game.mines);
      const boost = getBoost(game.guildId);
      if ((boost.winMult || 1) !== 1) mult = round2(mult * boost.winMult);
      payout = floor2(game.bet * mult);
      color = payout > game.bet ? COLORS.green : COLORS.grey;
      text =
        kind === 'timeout'
          ? `⏱️ Time up, automatic cashout: **${fmt(payout)}** (${fx(mult)})`
          : payout > game.bet
            ? `✅ Well played! You cash out **${fmt(payout)}** (${fx(mult)}), profit: **${signed(round2(payout - game.bet))}**.`
            : `💰 You cash out: **${fmt(payout)}** (${fx(mult)}), ${signed(round2(payout - game.bet))}.`;
      if (boost.label) text += `\n⚡ Boost **${boost.label}**`;
    }

    if (kind === 'lose') {
      const boost = getBoost(game.guildId);
      if ((boost.loseMult || 1) > 1) {
        const extra = floor2(game.bet * ((boost.loseMult || 1) - 1));
        if (extra > 0) await debit(game.userId, extra).catch(() => {});
        text += `\n⚡ Boost **${boost.label}**: loss ×${boost.loseMult}`;
      }
    }

    const balance = payout > 0 ? await credit(game.userId, payout) : await getBalance(game.userId);
    if (counted) {
      recordResult({
        guildId: game.guildId,
        user: game.user,
        game: 'mines',
        bet: game.bet,
        mult,
        payout,
        detail: `${LEVELS[game.level].name} · ${picks} 💎`,
      });
    }

    const payload = { embeds: [minesEmbed(game, { text, color, balance })], components: minesRows(game, true) };
    putCard(payload, await withTimeout(resultCard(game.user, 'mines', game.bet, mult, round2(payout - game.bet), balance), 4000, null));

    let minesImgDone = false;
    if (counted) {
      const mKind = kind === 'lose' ? 'lose' : 'win';
      minesImgDone = await playGameImages(i || game.lastI, 'mines', null, {
        user: game.user,
        bet: game.bet,
        outcome: mKind,
        resultText: animResultText(mKind, mult),
        sub: `Bet ${coinTxt(game.bet)} · ${LEVELS[game.level].name}`,
        data: { revealed: [...game.revealed], mines: [...game.mineSet], hit: kind === 'lose' ? game.hit : null },
      });
    }

    if (i) {
      if (held && !minesImgDone) {
        const wait = 900 - (Date.now() - t0); // suspense: the cell opens before the verdict
        if (wait > 0) await sleep(wait);
      }
      await editWithCard(i, payload);
    } else {
      await game.lastI.editReply(payload);
    }
  } catch (e) {
    console.error('[mines] settle', e?.message || e);
    try {
      const target = i || game.lastI;
      const bal = await getBalance(game.userId).catch(() => 0);
      await target.editReply({
        embeds: [minesEmbed(game, { text: '⚠️ Minor display issue, your game is finished.', color: COLORS.grey, balance: bal })],
        components: minesRows(game, true),
      });
    } catch {
      /* ignore */
    }
  } finally {
    games.delete(game.userId);
  }
}

async function handleMinesButton(i) {
  const game = games.get(i.user.id);
  if (!game || game.starting || game.type !== 'mines' || game.messageId !== i.message?.id) {
    return respondText(i, 'This game is no longer active. Start a new one from the panel.');
  }
  if (game.finished) return i.deferUpdate().catch(() => {});
  game.lastI = i;
  armTimer(game);

  if (i.customId === 'mines_cash') {
    if (game.revealed.size === 0) return i.deferUpdate();
    return settleMines(game, 'cash', i);
  }

  const idx = Number(i.customId.replace('mines_c_', ''));
  if (!Number.isInteger(idx) || idx < 0 || idx >= MINES_CELLS || game.revealed.has(idx)) return i.deferUpdate();

  if (game.mineSet.has(idx)) {
    game.hit = idx;
    return settleMines(game, 'lose', i);
  }
  game.revealed.add(idx);
  const done = game.revealed.size === MINES_CELLS - game.mines;
  if (done || minesMultiplier(game.revealed.size, game.mines) >= MINES_MAX_MULT) {
    return settleMines(game, 'cash', i);
  }
  return i.update({ embeds: [minesEmbed(game)], components: minesRows(game, false) });
}

// ============================================================
//  BLACKJACK
// ============================================================
function handValue(hand) {
  return handInfo(hand).total;
}

function handInfo(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === 'A') {
      aces++;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(c.r)) total += 10;
    else total += Number(c.r);
  }
  let softLeft = aces;
  while (total > 21 && softLeft > 0) {
    total -= 10;
    softLeft--;
  }
  const isSoft = softLeft > 0 && total <= 21;
  const low = isSoft ? total - 10 : total;
  const label = isSoft && low >= 1 ? `${low}/${total}` : String(total);
  return { total, low, isSoft, label };
}

function bjTable(player, dealer, dealerHidden) {
  const d = dealerHidden ? handArt(dealer, 1) : handArt(dealer);
  const p = handArt(player);
  const dv = dealer.length ? (dealerHidden ? handInfo(dealer).label + ' + ?' : handInfo(dealer).label) : '-';
  const pv = player.length ? handInfo(player).label : '-';
  return code([`DEALER  [${dv}]`, ...d, '', `YOU  [${pv}]`, ...p]);
}

function bjEmbed(g, end) {
  const e = brand(new EmbedBuilder().setTitle('🃏 Blackjack'), 'bj');
  const pInfo = handInfo(g.player);
  const showAll = !!(end && (end.revealAll || end.balance != null || end.revealing));
  const table = bjTable(g.player, g.dealer, !showAll);

  if (end && end.balance != null) {
    const kind = end.color === COLORS.green ? 'win' : end.color === COLORS.red ? 'lose' : 'push';
    e.setColor(outcomeColor(kind)).setDescription(`${outcomeBanner(kind)}${table}${end.text}`);
    e.addFields({ name: 'Bet', value: fmt(g.bet), inline: true }, { name: 'Balance', value: fmt(end.balance), inline: true });
  } else if (end?.revealing) {
    e.setColor(COLORS.violet).setDescription(`${table}${end.text || '🃏 Dealer\'s turn...'}`);
    e.addFields({ name: 'Bet', value: fmt(g.bet), inline: true });
  } else {
    e.setColor(COLORS.violet).setDescription(
      `${table}Your turn: **Hit**, **Stand** or **Double**.` +
        (pInfo.isSoft ? `\n💡 Your Ace gives you **${pInfo.low}** or **${pInfo.total}**.` : '')
    );
    e.addFields({ name: 'Bet', value: fmt(g.bet), inline: true });
  }
  return e;
}

function bjRows(g, over) {
  if (over) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`replay|bj|${g.baseBet}`).setLabel('Replay').setEmoji('🔁').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('panel_home').setLabel('Menu ZNK').setEmoji('💜').setStyle(ButtonStyle.Primary)
      ),
    ];
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_hit').setLabel('Tirer').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('Rester').setStyle(ButtonStyle.Secondary)
  );
  if (g.player.length === 2) {
    row.addComponents(new ButtonBuilder().setCustomId('bj_double').setLabel('Doubler').setStyle(ButtonStyle.Success));
  }
  return [row];
}

function bjOutcome(g, kind) {
  const pv = handValue(g.player);
  const dv = handValue(g.dealer);
  const bet = g.bet;
  if (kind === 'natural') {
    const pBJ = pv === 21 && g.player.length === 2;
    const dBJ = dv === 21 && g.dealer.length === 2;
    if (pBJ && dBJ) return { payout: bet, text: '🤝 Double blackjack: tie, bet refunded.', color: COLORS.grey };
    if (pBJ) {
      const payout = floor2(bet * 2.5 * coef('bj'));
      return {
        payout,
        text: `🎉 **Blackjack!** You win **${fmt(round2(payout - bet))}** (${fx(2.5 * coef('bj'))}).`,
        color: COLORS.green,
      };
    }
    return { payout: 0, text: '😬 Dealer has blackjack, bet lost.', color: COLORS.red };
  }
  if (kind === 'bust')
    return {
      payout: 0,
      text: `💥 You went over 21 (**${handInfo(g.player).label}**), bet lost.`,
      color: COLORS.red,
    };
  const winPayout = floor2(bet * 2 * coef('bj'));
  const winProfit = fmt(round2(winPayout - bet));
  if (dv > 21) return { payout: winPayout, text: `🎉 Dealer went over 21! You win **${winProfit}**.`, color: COLORS.green };
  if (pv > dv) return { payout: winPayout, text: `🎉 ${pv} vs ${dv}: you win **${winProfit}**.`, color: COLORS.green };
  if (pv === dv) return { payout: bet, text: `🤝 Tie at ${pv}, bet refunded.`, color: COLORS.grey };
  return { payout: 0, text: `😬 ${pv} vs ${dv}: you lose your bet.`, color: COLORS.red };
}

// --- Blackjack: everything stays in the GIF (deal, draw, dealer turn, result) ---
// d = dealer's full hand; if hidden, only their 1st card is visible (2nd is face down)
const bjState = (p, d, hidden, cap) => {
  const vis = hidden ? d.slice(0, 1) : d.slice();
  return { p: p.slice(), d: vis, hidden, cap, ms: 850, pv: p.length ? handValue(p) : null, dv: vis.length ? handValue(vis) : null };
};
// Hands written BELOW the image (embed footer shows below the image, description above)
const bjCards = (cards) => cards.map((c) => `${c.r}${c.s}`).join(' ');
function bjHandFooter(game, revealDealer = false) {
  const p = `Your hand: ${bjCards(game.player)} (${handInfo(game.player).label})`;
  if (!game.dealer.length) return p;
  const d = revealDealer ? `Dealer: ${bjCards(game.dealer)} (${handInfo(game.dealer).label})` : `Dealer: ${bjCards(game.dealer.slice(0, 1))} ?`;
  return `${p}   ·   ${d}`;
}
// Text above the GIF + hands below
const bjLiveEmbed = (game, text, revealDealer = false) =>
  new EmbedBuilder()
    .setColor(COLORS.violet)
    .setImage(`attachment://${game.gifName}`)
    .setDescription(text)
    .addFields({ name: 'Bet', value: fmt(game.bet), inline: true })
    .setFooter({ text: bjHandFooter(game, revealDealer) });
const bjTurnText = (game) => {
  const pInfo = handInfo(game.player);
  return `Your turn: **Hit**, **Stand**${game.player.length === 2 ? ' or **Double**' : ''}.` + (pInfo.isSoft ? `\n💡 Your Ace gives you **${pInfo.low}** or **${pInfo.total}**.` : '');
};
// Plays a blackjack GIF. deliver(p) = send; returns ctx (gifName/gifUrl) if GIF played, otherwise null
async function bjAnimate(game, deliver, steps, o = {}) {
  const ctx = {
    user: game.user,
    bet: game.bet,
    sub: `Bet ${coinTxt(game.bet)}`,
    data: { steps, noShuffle: !!o.noShuffle },
    components: o.components || [],
    deliver,
    noWait: !!o.noWait,
    outcome: o.outcome,
    resultText: o.resultText,
    decorate: o.decorate,
  };
  const ok = await playGameImages(game.lastI, 'bj', null, ctx);
  ctx.played = !!ok; // true also if the player skipped the animation or still images were played
  if (ok && ctx.gifName) {
    game.gifName = ctx.gifName;
    game.gifUrl = ctx.gifUrl;
  } else {
    game.gifName = null; // no more GIF on screen: updates go back through text
    game.gifUrl = null;
  }
  return ctx;
}

async function dealAnimation(i, game, natural = null) {
  const [p1, p2] = game.player;
  const [d1, d2] = game.dealer;
  const steps = [
    { p: [], d: [], hidden: false, cap: 'Dealer shuffles the cards...' },
    { p: [p1], d: [], hidden: false, cap: 'First card for you' },
    { p: [p1], d: [d1], hidden: false, cap: 'Dealer\'s first card' },
    { p: [p1, p2], d: [d1], hidden: false, cap: 'Second card for you' },
    { p: [p1, p2], d: [d1], hidden: true, cap: 'Dealer keeps one face down' },
  ];
  if (natural) steps.push({ p: [p1, p2], d: [d1, d2], hidden: false, cap: 'Blackjack !' });
  const frames = steps.slice(0, 5).map((s) => ({
    art: bjTable(s.p, s.d, s.hidden),
    caption: s.cap,
    ms: 850,
  }));
  const imgSteps = steps.map((s) => ({
    p: s.p,
    d: s.d,
    hidden: s.hidden,
    cap: s.cap,
    ms: 850,
    pv: s.p.length ? handValue(s.p) : null,
    dv: s.d.length ? handValue(s.d) : null,
  }));
  game.lastI = i;
  const done = await bjAnimate(game, (p) => i.editReply(p), imgSteps, {
    components: [],
    outcome: natural ? natural.kind : undefined,
    resultText: natural ? natural.text : undefined,
    decorate: (e) => e.setDescription(`Bet **${fmt(game.bet)}** · dealing...`),
  });
  if (!done.played) await animate(i, frames, '🃏 Blackjack', '', 'bj'); // no GIF or images: old text animation
}

async function startBlackjack(i, bet) {
  const uid = i.user.id;
  if (!tryLock(uid)) return respondText(i, MSG.busy);

  let started = false;
  try {
    const err = await takeBet(uid, bet);
    if (err) return respondText(i, err);

    const deck = newDeck();
    const game = {
      type: 'bj',
      userId: uid,
      user: i.user,
      guildId: resolveGuildId(i),
      bet,
      baseBet: bet,
      deck,
      player: [deck.pop(), deck.pop()],
      dealer: [deck.pop(), deck.pop()],
      messageId: null,
      lastI: i,
      timer: null,
      finished: false,
    };

    const natural = handValue(game.player) === 21 || handValue(game.dealer) === 21;
    let out = null;
    let balance;
    if (natural) {
      out = bjOutcome(game, 'natural');
      try {
        balance = out.payout > 0 ? await credit(uid, out.payout) : await getBalance(uid);
      } catch (e) {
        await credit(uid, bet).catch(() => {});
        throw e;
      }
      recordResult({
        guildId: game.guildId,
        user: i.user,
        game: 'bj',
        bet,
        mult: round2(out.payout / bet),
        payout: out.payout,
        detail: `${handValue(game.player)} vs ${handValue(game.dealer)}`,
      });
    }

    try {
      await openGame(i, {
        embeds: [
          new EmbedBuilder()
            .setTitle('🃏 Blackjack')
            .setColor(COLORS.violet)
            .setDescription(`Bet **${fmt(bet)}** · dealing...`),
        ],
        components: [],
      });
      game.messageId = (await i.fetchReply()).id;
    } catch (e) {
      if (natural) {
        if (out.payout > 0) await debit(uid, out.payout).catch(() => {});
      }
      await credit(uid, bet).catch(() => {});
      throw e;
    }

    await dealAnimation(
      i,
      game,
      natural ? { kind: out.color === COLORS.green ? 'win' : out.color === COLORS.red ? 'lose' : 'push', text: animResultText(out.color === COLORS.green ? 'win' : out.color === COLORS.red ? 'lose' : 'push', round2(out.payout / bet)) } : null
    );

    if (natural) {
      const npay = {
        embeds: [bjEmbed(game, { text: out.text, color: out.color, balance, revealAll: true })],
        components: bjRows(game, true),
      };
      if (game.gifName) {
        // GIF stays on screen: only the result is added below the image
        const kindN = out.color === COLORS.green ? 'win' : out.color === COLORS.red ? 'lose' : 'push';
        const e = bjLiveEmbed(game, `${outcomeBanner(kindN)}${out.text}`, true).setColor(outcomeColor(kindN)).addFields({ name: 'Balance', value: fmt(balance), inline: true });
        await i.editReply({ embeds: [e], components: bjRows(game, true) }).catch(() => {});
        return;
      }
      putCard(npay, await resultCard(i.user, 'bj', bet, round2(out.payout / bet), round2(out.payout - bet), balance));
      await i.editReply(npay).catch(() => {});
      return;
    }

    if (game.gifName) {
      await i.editReply({ embeds: [bjLiveEmbed(game, bjTurnText(game))], components: bjRows(game, false) }).catch(() => {});
    } else {
      await i.editReply({ embeds: [bjEmbed(game)], components: bjRows(game, false) }).catch(() => {});
    }
    games.set(uid, game);
    started = true;
    armTimer(game);
  } finally {
    if (!started) unlock(uid);
  }
}

async function settleBlackjack(game, kind, i) {
  if (game.finished) return;
  game.finished = true;
  clearTimeout(game.timer);

  const pushBoard = async (payload, interaction) => {
    if (interaction && !interaction.replied && !interaction.deferred) {
      await interaction.update(payload);
      return;
    }
    await game.lastI.editReply(payload);
  };
  const outKind = (out) => (out.color === COLORS.green ? 'win' : out.color === COLORS.red ? 'lose' : 'push');

  try {
    const useGif = !!game.gifName && String(process.env.GAME_GIF || 'on').toLowerCase() !== 'off';
    const preP = game.preP || null; // player hand before the last card (hit / double)
    game.preP = null;

    // ----- dealer plays (draws computed in advance; then shown in the GIF)
    const steps = [];
    if (preP) steps.push(bjState(preP, game.dealer, true, 'Your turn...'));
    steps.push(bjState(game.player, game.dealer, true, preP ? 'You draw a card' : 'You stand'));
    const textDraws = [];
    if (kind === 'stand') {
      steps.push(bjState(game.player, game.dealer, false, 'Dealer reveals their card'));
      while (handValue(game.dealer) < 17) {
        game.dealer.push(game.deck.pop());
        const d = handInfo(game.dealer);
        textDraws.push(d);
        steps.push(bjState(game.player, game.dealer, false, `Dealer draws... total ${d.label}`));
      }
      const dFinal = handInfo(game.dealer);
      steps[steps.length - 1].cap = dFinal.total > 21 ? `Dealer busts (${dFinal.label})` : `Dealer stands at ${dFinal.label}`;
    } else {
      steps.push(bjState(game.player, game.dealer, false, `You bust 21 (${handInfo(game.player).label})`));
    }

    // ----- result, boost, payout
    const out = bjOutcome(game, kind);
    const boost = getBoost(game.guildId);
    if (out.payout > game.bet && (boost.winMult || 1) !== 1) {
      const profit = out.payout - game.bet;
      out.payout = floor2(game.bet + profit * (boost.winMult || 1));
      out.text += `\n⚡ Boost **${boost.label}** applied!`;
    } else if (out.payout === 0 && (boost.loseMult || 1) > 1) {
      const extra = floor2(game.bet * ((boost.loseMult || 1) - 1));
      if (extra > 0) await debit(game.userId, extra).catch(() => {});
      out.text += `\n⚡ Boost **${boost.label}**: loss ×${boost.loseMult}`;
    }
    const balance = out.payout > 0 ? await credit(game.userId, out.payout) : await getBalance(game.userId);
    const pL = handInfo(game.player).label;
    const dL = handInfo(game.dealer).label;
    const mult = round2(out.payout / game.bet);
    recordResult({
      guildId: game.guildId,
      user: game.user,
      game: 'bj',
      bet: game.bet,
      mult,
      payout: out.payout,
      detail: `${pL} vs ${dL}`,
    });
    const rk = outKind(out);

    // ----- display: GIF (stays on screen) or, failing that, text
    let played = null;
    if (useGif) {
      if (i && !i.replied && !i.deferred) await i.deferUpdate().catch(() => {});
      played = await bjAnimate(game, (p) => game.lastI.editReply(p), steps, {
        noShuffle: true,
        components: [],
        outcome: rk,
        resultText: animResultText(rk, mult),
        decorate: (e) => e.setDescription(kind === 'stand' ? '🃏 Dealer plays...' : '🃏 You bust...').setFooter({ text: `Your hand: ${bjCards(game.player)} (${handInfo(game.player).label})` }),
      });
    }

    if (played && game.gifName) {
      const e = bjLiveEmbed(game, `${outcomeBanner(rk)}${out.text}`, true)
        .setColor(outcomeColor(rk))
        .addFields({ name: 'Balance', value: fmt(balance), inline: true });
      await game.lastI.editReply({ embeds: [e], components: bjRows(game, true) });
      return;
    }

    // text fallback (no GIF): same sequence as before
    if (kind === 'stand') {
      await pushBoard({ embeds: [bjEmbed(game, { revealing: true, text: '🃏 Dealer **reveals** their second card...' })], components: [], attachments: [] }, i);
      i = null;
      await sleep(1100);
      const dFinal = handInfo(game.dealer);
      for (const d of textDraws) {
        await game.lastI.editReply({
          embeds: [bjEmbed(game, { revealing: true, text: `🃏 Dealer draws a card... total **${d.label}**${d.isSoft ? ' (soft Ace)' : ''}` })],
          components: [],
        });
        await sleep(1100);
      }
      await game.lastI.editReply({
        embeds: [bjEmbed(game, { revealing: true, text: dFinal.total > 21 ? `💥 Dealer busts (**${dFinal.label}**)!` : `🛑 Dealer stands at **${dFinal.label}**.` })],
        components: [],
      });
      await sleep(900);
    }
    const payload = {
      embeds: [bjEmbed(game, { text: out.text, color: out.color, balance, revealAll: true })],
      components: bjRows(game, true),
      attachments: [],
    };
    putCard(payload, await resultCard(game.user, 'bj', game.bet, mult, round2(out.payout - game.bet), balance));
    if (i && !i.replied && !i.deferred) await i.update(payload);
    else await game.lastI.editReply(payload);
  } catch (e) {
    console.error('[blackjack] settle', e?.message || e);
  } finally {
    games.delete(game.userId);
  }
}

async function handleBlackjackButton(i) {
  const game = games.get(i.user.id);
  if (!game || game.starting || game.type !== 'bj' || game.messageId !== i.message?.id) {
    return respondText(i, 'This game is no longer active. Start a new one from the panel.');
  }
  if (game.finished) return i.deferUpdate().catch(() => {});
  if (game.busy) return i.deferUpdate().catch(() => {}); // a card is being dealt
  game.lastI = i;
  armTimer(game);

  if (i.customId === 'bj_hit') {
    const before = game.player.slice();
    game.player.push(game.deck.pop());
    const v = handValue(game.player);
    game.preP = before;
    if (v > 21) return settleBlackjack(game, 'bust', i);
    if (v === 21) return settleBlackjack(game, 'stand', i);
    game.preP = null;

    // GIF stays on screen: the new card slides from the deck to your hand, buttons stay active
    if (game.gifName && String(process.env.GAME_GIF || 'on').toLowerCase() !== 'off' && !wantsSkipAnim(game.userId)) {
      game.busy = true;
      try {
        await i.deferUpdate();
        const steps = [bjState(before, game.dealer, true, 'Your turn'), bjState(game.player, game.dealer, true, 'You draw a card')];
        const ctx = await bjAnimate(game, (p) => i.editReply(p), steps, {
          noShuffle: true,
          noWait: true,
          components: bjRows(game, false),
          decorate: (e) => e.setDescription(bjTurnText(game)).addFields({ name: 'Bet', value: fmt(game.bet), inline: true }).setFooter({ text: bjHandFooter(game) }),
        });
        if (!ctx.played || !game.gifName) {
          // GIF impossible: back to text display
          await i.editReply({ embeds: [bjEmbed(game)], components: bjRows(game, false), attachments: [] });
        }
      } catch (e) {
        console.error('[blackjack] draw', e?.message || e);
        game.gifName = null;
        await i.editReply({ embeds: [bjEmbed(game)], components: bjRows(game, false), attachments: [] }).catch(() => {});
      } finally {
        game.busy = false;
      }
      return;
    }
    const upd = { embeds: [bjEmbed(game)], components: bjRows(game, false) };
    if (game.gifName) {
      // animation skipped: still keep the previous GIF image
      upd.embeds = [bjLiveEmbed(game, bjTurnText(game))];
    }
    return i.update(upd);
  }

  if (i.customId === 'bj_stand') return settleBlackjack(game, 'stand', i);

  if (i.customId === 'bj_double') {
    if (game.player.length !== 2) return i.deferUpdate();
    if ((await debit(game.userId, game.bet)) === null) {
      return respondText(i, `Not enough ${COIN} to double.`);
    }
    game.bet = round2(game.bet * 2);
    game.preP = game.player.slice();
    game.player.push(game.deck.pop());
    if (handValue(game.player) > 21) return settleBlackjack(game, 'bust', i);
    return settleBlackjack(game, 'stand', i);
  }
}

// ============================================================
//  ROULETTE (European, 0 to 36)
// ============================================================
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
const colorTag = (n) => (n === 0 ? 'V' : REDS.has(n) ? 'R' : 'N');
const colorEmoji = { green: '🟢', red: '🔴', black: '⚫' };
// Actual number order on a European wheel
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

function parseRouletteBet(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  if (['rouge', 'red', 'r'].includes(s)) return { key: 'rouge', label: 'Red 🔴', mult: 2, win: (n) => n !== 0 && REDS.has(n) };
  if (['noir', 'black', 'n'].includes(s)) return { key: 'noir', label: 'Black ⚫', mult: 2, win: (n) => n !== 0 && !REDS.has(n) };
  if (['pair', 'even', 'p'].includes(s)) return { key: 'pair', label: 'Even', mult: 2, win: (n) => n !== 0 && n % 2 === 0 };
  if (['impair', 'odd', 'i'].includes(s)) return { key: 'impair', label: 'Odd', mult: 2, win: (n) => n % 2 === 1 };
  if (['vert', 'green', 'v'].includes(s)) return { key: 'vert', label: 'Green 🟢 (0)', mult: 36, win: (n) => n === 0 };
  if (/^\d{1,2}$/.test(s) && Number(s) >= 0 && Number(s) <= 36) {
    const target = Number(s);
    return { key: String(target), label: `Number ${target}`, mult: 36, win: (n) => n === target };
  }
  return null;
}

function roulettePickerPayload() {
  const embed = new EmbedBuilder()
    .setTitle('🎡 Roulette: choose your bet')
    .setColor(COLORS.blue)
    .setDescription(
      `🔴 Red · ⚫ Black · Even · Odd: pay **${fx(2 * coef('roulette'))}**\n` +
        `🟢 Green (0) or a specific **number** (0 to 36): pay **${fx(36 * coef('roulette'))}**`
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rl_rouge').setLabel('Red').setEmoji('🔴').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rl_noir').setLabel('Black').setEmoji('⚫').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rl_pair').setLabel('Even').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rl_impair').setLabel('Odd').setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rl_vert').setLabel('Green (0)').setEmoji('🟢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rl_num').setLabel('A number').setEmoji('🔢').setStyle(ButtonStyle.Secondary)
  );
  return animPanel({ embeds: [embed], components: [row1, row2] });
}

function rouletteFrames(result, choice) {
  const rcell = (n, center) => {
    const s = `${padL(n, 2)}${colorTag(n)}`;
    return center ? `[${s}]` : ` ${s} `;
  };
  const finalIdx = WHEEL_ORDER.indexOf(result);
  const steps = [8, 7, 6, 5, 4, 3, 2, 1, 1]; // 37 crans = 1 tour complet
  const pos = stripPositions(finalIdx, steps);
  const caps = [
    'The ball is launched',
    'The wheel speeds up',
    'Pleine vitesse',
    'The ball is spinning...',
    'It starts slowing down',
    'It hops from cell to cell',
    'Almost stopped',
    'Dernier saut...',
    'It hesitates...',
    `The ball lands on ${result} ${colorOf(result)}`,
  ];
  const legend = 'R red · N black · V green';
  return pos.map((p, k) => ({
    art: code([...stripArt(WHEEL_ORDER, p, rcell, 5), '', legend, `Your bet: ${choice.label}`]),
    caption: caps[k],
    ms: 700 + k * 110,
  }));
}

async function playRoulette(i, bet, choiceStr) {
  const choice = parseRouletteBet(choiceStr);
  if (!choice) return respondText(i, 'Invalid bet: red, black, even, odd, green or a number from 0 to 36.');
  const uid = i.user.id;
  if (!tryLock(uid)) return respondText(i, MSG.busy);

  try {
    const err = await takeBet(uid, bet);
    if (err) return respondText(i, err);

    const result = randomInt(0, 37);
    const won = choice.win(result);
    const boost = getBoost(resolveGuildId(i));
    const rlMult = round2(choice.mult * coef('roulette') * (won ? boost.winMult || 1 : 1));
    const payout = won ? floor2(bet * rlMult) : 0;
    if (!won && (boost.loseMult || 1) > 1) {
      const extra = floor2(bet * ((boost.loseMult || 1) - 1));
      if (extra > 0) await debit(uid, extra).catch(() => {});
    }

    try {
      await openGame(i, {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎡 Roulette')
            .setColor(COLORS.violet)
            .setDescription(`🎡 Place your bets. Bet **${fmt(bet)}** on **${choice.label}**`),
        ],
        components: [],
      });
    } catch (e) {
      await credit(uid, bet).catch(() => {});
      throw e;
    }

    const balance = payout > 0 ? await credit(uid, payout) : await getBalance(uid);

    const profit = round2(payout - bet);
    const kind = won ? 'win' : 'lose';
    const rlCtx = {
      user: i.user,
      bet,
      outcome: kind,
      resultText: animResultText(kind, rlMult),
      pickLabel: noEmoji(choice.label),
      sub: `Bet ${coinTxt(bet)} · ${noEmoji(choice.label)}`,
      data: { order: WHEEL_ORDER, reds: [...REDS], result },
    };
    const rlImgDone = await playGameImages(i, 'roulette', null, rlCtx);
    if (!rlImgDone) await animate(i, rouletteFrames(result, choice), '🎡 Roulette', `Bet **${fmt(bet)}**\n`, 'roulette');

    const embed = brand(
      new EmbedBuilder()
        .setTitle('🎡 Roulette')
        .setColor(outcomeColor(kind))
        .setDescription(
          outcomeBanner(kind, profit) +
            code([
              `  Number:  ${result}  (${colorOf(result)}) ${colorEmoji[colorOf(result)]}`,
              `  Your bet     :  ${choice.label}`,
            ]) +
            (won ? `You win **${fmt(payout)}** (${fx(rlMult)}).` : `You lose **${fmt(bet)}**.`)
        )
        .addFields(
          { name: '🎯 Your bet', value: choice.label, inline: true },
          { name: '💰 Bet', value: fmt(bet), inline: true },
          { name: '👛 Balance', value: fmt(balance), inline: true }
        ),
      'roulette'
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`replay|rl|${bet}|${choice.key}`).setLabel('Replay').setEmoji('🔁').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('panel_home').setLabel('Menu ZNK').setEmoji('💜').setStyle(ButtonStyle.Primary)
    );
    const rlPayload = { embeds: [embed], components: [row] };
    if (rlCtx.gifName) {
      // GIF stays on screen (its last frame shows the result)
      embed.setImage(`attachment://${rlCtx.gifName}`);
      await i.editReply(rlPayload);
    } else {
      putCard(rlPayload, await resultCard(i.user, 'roulette', bet, won ? rlMult : 0, profit, balance));
      await editWithCard(i, rlPayload);
    }

    recordResult({
      guildId: resolveGuildId(i),
      user: i.user,
      game: 'roulette',
      bet,
      mult: won ? rlMult : 0,
      payout,
      detail: `${choice.label} -> ${result}`,
    });
  } finally {
    unlock(uid);
  }
}

// ============================================================
//  INSTANT GAMES
// ============================================================
const COIN_MULT = 1.95;
const DICE_MULT = { under: 2.3, over: 2.3, seven: 5.8 };

const SLOT_SYMBOLS = [
  { s: 'CER', e: '🍒', w: 8, pay: 5 },
  { s: 'CIT', e: '🍋', w: 7, pay: 10 },
  { s: 'RAI', e: '🍇', w: 6, pay: 18 },
  { s: 'CLO', e: '🔔', w: 4, pay: 35 },
  { s: 'DIA', e: '💎', w: 2, pay: 90 },
  { s: ' 7 ', e: '7️⃣', w: 1, pay: 250 },
];
const SLOT_TOTAL = SLOT_SYMBOLS.reduce((a, x) => a + x.w, 0);
const SLOT_TWO_CHERRIES = 2;
function spinReel() {
  let r = randomInt(0, SLOT_TOTAL);
  for (const x of SLOT_SYMBOLS) {
    if (r < x.w) return x;
    r -= x.w;
  }
  return SLOT_SYMBOLS[0];
}

// 24 cells in the wheel's display order
const WHEEL = [0, 0.5, 0, 1.5, 0, 0, 2, 0, 0.5, 0, 1.5, 0, 0, 3, 0, 0.5, 1.5, 0, 0.5, 0, 1.5, 0, 10, 0];
const wheelSummary = (c) => {
  const counts = new Map();
  for (const v of WHEEL) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].map(([v, n]) => `${v === 0 ? '💀 x0' : fx(v * c)}${n > 1 ? ` ×${n}` : ''}`).join(' · ');
};

const igButton = (key, choice, label, emoji, style) => {
  const b = new ButtonBuilder().setCustomId(`ig_${key}_${choice}`).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};

const INSTANT = {};
const ANIMS = {};

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));

function choicePicker(key, title, desc, choices) {
  const buttons = choices.map(([id, label, emoji, style]) => igButton(key, id, label, emoji, style || ButtonStyle.Primary));
  return animPanel({
    embeds: [new EmbedBuilder().setTitle(title).setColor(COLORS.violet).setDescription(`${desc}\n${LINE}`)],
    components: chunk(buttons, 5).map((r) => new ActionRowBuilder().addComponents(...r)),
  });
}

const DUEL_MULT = 2.1;
const SUIT_MULT = 3.8;
const SUIT_CHOICES = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_EMOJI = { s: '♠️', h: '♥️', d: '♦️', c: '♣️' };
const SUIT_NAMES = { s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs' };
const ZONES = {
  low: { label: 'Low (1-3)', mult: 3.2, win: (n) => n <= 3 },
  mid: { label: 'Mid (4-7)', mult: 2.4, win: (n) => n >= 4 && n <= 7 },
  high: { label: 'High (8-10)', mult: 3.2, win: (n) => n >= 8 },
};
const PLINKO = {
  low: { label: 'Low', emoji: '🟢', mults: [2, 1.4, 1.1, 0.95, 0.8, 0.95, 1.1, 1.4, 2] },
  med: { label: 'Medium', emoji: '🟡', mults: [6, 3, 1.4, 0.7, 0.4, 0.7, 1.4, 3, 6] },
  high: { label: 'High', emoji: '🔴', mults: [18, 4, 1.5, 0.4, 0.2, 0.4, 1.5, 4, 18] },
};
const CRASH_TARGETS = { x15: 1.5, x2: 2, x5: 5, x10: 10 };
const SCRATCH = [[1.5, 1900, 'TREF'], [2, 900, 'ETOI'], [5, 400, 'CLOC'], [20, 80, 'DIAM'], [100, 12, 'COUR']];
const SCRATCH_JUNK = ['TREF', 'ETOI', 'CLOC', 'DIAM', 'COUR', 'CERI', 'CITR'];
const SCRATCH_EMOJI = { TREF: '🍀', ETOI: '⭐', CLOC: '🔔', DIAM: '💎', COUR: '👑', CERI: '🍒', CITR: '🍋' };
const DIE_MULT = 5.7;
const CHEST_MULT = 2.85;
const russianMult = (k) => round2((0.96 * 6) / (6 - k));
const HORSES = [
  { p: 0.4, mult: 2.4 },
  { p: 0.25, mult: 3.8 },
  { p: 0.18, mult: 5.3 },
  { p: 0.11, mult: 8.6 },
  { p: 0.06, mult: 15.8 },
];

const randCard = () => {
  const v = randomInt(0, 13);
  return { v, r: RANKS[v], s: SUITS[randomInt(0, 4)] };
};

// ---------- Pile ou Face ----------
const COIN_ART = {
  PILE: ['   .-------.   ', '  /         \\  ', ' |   PILE    | ', '  \\         /  ', "   '-------'   "],
  FACE: ['   .-------.   ', '  /         \\  ', ' |   FACE    | ', '  \\         /  ', "   '-------'   "],
  MID: ['     .---.     ', '    /     \\    ', '   |  ...  |   ', '    \\     /    ', "     '---'     "],
  EDGE: ['       .       ', '      | |      ', '      | |      ', '      | |      ', "       '       "],
};
function coinScene(face, y) {
  const W = 15;
  const rows = Array(9).fill(' '.repeat(W));
  COIN_ART[face].forEach((ln, k) => {
    rows[y + k] = ln;
  });
  return code([...rows, '===============']);
}

Object.assign(INSTANT, {
  coinflip: {
    title: '🪙 Heads or Tails',
    choices: ['pile', 'face'],
    spinText: 'The coin is spinning...',
    info: (c) => `win ${fx(COIN_MULT * c)}`,
    picker(c) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🪙 Heads or Tails: pick your side')
            .setColor(COLORS.blue)
            .setDescription(`Guess the right side: you win **${fx(COIN_MULT * c)}** your bet. 1 in 2 chance!`),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            igButton('coinflip', 'pile', 'Heads', '🪙', ButtonStyle.Primary),
            igButton('coinflip', 'face', 'Tails', '🪙', ButtonStyle.Secondary)
          ),
        ],
      };
    },
    resolve(choice) {
      const side = randomInt(0, 2) === 0 ? 'pile' : 'face';
      return {
        base: side === choice ? COIN_MULT : 0,
        pick: choice === 'pile' ? 'Heads' : 'Tails',
        headline: `The coin lands on **🪙 ${side === 'pile' ? 'Heads' : 'Tails'}**`,
        detail: `${choice} -> ${side}`,
        side,
      };
    },
  },

  dice: {
    title: '🎲 Dice',
    choices: ['under', 'over', 'seven'],
    spinText: 'The dice are rolling...',
    info: (c) => `under/over 7 ${fx(DICE_MULT.under * c)} · exactly 7 ${fx(DICE_MULT.seven * c)}`,
    picker(c) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎲 Dice: bet on the sum of 2 dice')
            .setColor(COLORS.blue)
            .setDescription(
              `⬇️ **Under 7** (2 to 6): **${fx(DICE_MULT.under * c)}**\n` +
                `⬆️ **Over 7** (8 to 12): **${fx(DICE_MULT.over * c)}**\n` +
                `🎯 **Exactement 7** : **${fx(DICE_MULT.seven * c)}**`
            ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            igButton('dice', 'under', 'Under 7', '⬇️', ButtonStyle.Primary),
            igButton('dice', 'seven', 'Exactement 7', '🎯', ButtonStyle.Success),
            igButton('dice', 'over', 'Over 7', '⬆️', ButtonStyle.Primary)
          ),
        ],
      };
    },
    resolve(choice) {
      const a = randomInt(1, 7);
      const b = randomInt(1, 7);
      const sum = a + b;
      const outcome = sum < 7 ? 'under' : sum > 7 ? 'over' : 'seven';
      return {
        base: outcome === choice ? DICE_MULT[choice] : 0,
        pick: { under: 'Under 7', over: 'Over 7', seven: 'Exactly 7' }[choice],
        headline: code(sideBySide([dieLines(a), dieLines(b)], '   ')) + `${dieFace(a)} **${a}** + ${dieFace(b)} **${b}** = **${sum}**`,
        detail: `${a}+${b}=${sum}`,
        a,
        b,
        sum,
      };
    },
  },

  slots: {
    title: '🎰 Slot Machine',
    choices: ['go'],
    spinText: 'The reels are spinning...',
    info: (c) => `3 cerises ${fx(5 * c)} · jackpot 7️⃣ ${fx(250 * c)}`,
    picker(c) {
      const table = SLOT_SYMBOLS.map((x) => `${x.e}${x.e}${x.e}  ->  **${fx(x.pay * c)}**`).join('\n');
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎰 Slot Machine')
            .setColor(COLORS.blue)
            .setDescription(`${table}\n🍒🍒 (2 cerises)  ->  **${fx(SLOT_TWO_CHERRIES * c)}**`),
        ],
        components: [new ActionRowBuilder().addComponents(igButton('slots', 'go', 'Lancer', '🎰', ButtonStyle.Success))],
      };
    },
    resolve() {
      const reels = [spinReel(), spinReel(), spinReel()];
      let base = 0;
      if (reels[0].s === reels[1].s && reels[1].s === reels[2].s) base = reels[0].pay;
      else if (reels.filter((r) => r.s === 'CER').length === 2) base = SLOT_TWO_CHERRIES;
      const line = reels.map((r) => r.e).join(' | ');
      return { base, pick: 'Spin', headline: `**[ ${line} ]**`, detail: reels.map((r) => r.s.trim()).join('-'), reels };
    },
  },

  wheel: {
    title: '🎡 Wheel of Fortune',
    choices: ['go'],
    spinText: 'The wheel is spinning...',
    info: (c) => `from ${fx(0.5 * c)} to ${fx(10 * c)}`,
    picker(c) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎡 Wheel of Fortune')
            .setColor(COLORS.blue)
            .setDescription(`24 cells: ${wheelSummary(c)}\n\nSpin the wheel and see where it stops!`),
        ],
        components: [new ActionRowBuilder().addComponents(igButton('wheel', 'go', 'Spin the wheel', '🎡', ButtonStyle.Success))],
      };
    },
    resolve(choice, c) {
      const idx = randomInt(0, WHEEL.length);
      const base = WHEEL[idx];
      return {
        base,
        pick: 'Wheel',
        headline: `The wheel stops on **${base === 0 ? '💀 x0' : fx(base * c)}**`,
        detail: base === 0 ? 'x0' : fx(base * c),
        idx,
      };
    },
  },

  duel: {
    title: '⚔️ Card duel',
    choices: ['go'],
    spinText: 'Cards are being dealt...',
    info: (c) => `win ${fx(DUEL_MULT * c)}`,
    picker: (c) =>
      choicePicker(
        'duel',
        '⚔️ Card duel',
        `You draw a card against the dealer: highest wins (Ace is lowest, tie = loss).\nWin: **${fx(DUEL_MULT * c)}**`,
        [['go', 'Draw my card', '⚔️', ButtonStyle.Success]]
      ),
    resolve() {
      const me = randCard();
      const dealer = randCard();
      return {
        base: me.v > dealer.v ? DUEL_MULT : 0,
        pick: 'Duel',
        headline: `You: ${cardStr(me)}  ·  Dealer: ${cardStr(dealer)}`,
        detail: `${me.r} vs ${dealer.r}`,
        me,
        dealer,
      };
    },
  },

  suit: {
    title: '🃏 Suit',
    choices: Object.keys(SUIT_CHOICES),
    spinText: 'Dealer draws a card...',
    info: (c) => `win ${fx(SUIT_MULT * c)}`,
    picker: (c) =>
      choicePicker(
        'suit',
        '🃏 Suit: guess the suit of the card',
        `Choose ♠️ ♥️ ♦️ or ♣️: if the drawn card has that suit, you win **${fx(SUIT_MULT * c)}** (1 in 4 chance).`,
        Object.keys(SUIT_CHOICES).map((id) => [id, SUIT_NAMES[id], SUIT_EMOJI[id]])
      ),
    resolve(choice) {
      const card = randCard();
      return {
        base: card.s === SUIT_CHOICES[choice] ? SUIT_MULT : 0,
        pick: `${SUIT_NAMES[choice]} ${SUIT_EMOJI[choice]}`,
        headline: `Card drawn: ${cardStr(card)}`,
        detail: `${SUIT_CHOICES[choice]} -> ${card.s}`,
        card,
      };
    },
  },

  zone: {
    title: '🎯 Zone',
    choices: Object.keys(ZONES),
    spinText: 'Drawing a number from 1 to 10...',
    info: (c) => `zones ${fx(ZONES.low.mult * c)} / ${fx(ZONES.mid.mult * c)}`,
    picker: (c) =>
      choicePicker(
        'zone',
        '🎯 Zone: where will the number land (1 to 10)?',
        Object.values(ZONES).map((z) => `**${z.label}** : ${fx(z.mult * c)}`).join('\n'),
        Object.entries(ZONES).map(([id, z]) => [id, z.label, '🎯'])
      ),
    resolve(choice) {
      const n = randomInt(1, 11);
      return { base: ZONES[choice].win(n) ? ZONES[choice].mult : 0, pick: ZONES[choice].label, headline: `Number drawn: **${n}**`, detail: `${n}`, n };
    },
  },

  plinko: {
    title: '🎱 Plinko',
    choices: Object.keys(PLINKO),
    spinText: 'The ball drops...',
    info: (c) => `from ${fx(0.2 * c)} to ${fx(18 * c)}`,
    picker: (c) =>
      choicePicker(
        'plinko',
        '🎱 Plinko: choose the risk',
        Object.values(PLINKO)
          .map((r) => `${r.emoji} **${r.label}** : ${r.mults.map((m) => fx(m * c).replace('x', '')).join(' · ')}`)
          .join('\n'),
        Object.entries(PLINKO).map(([id, r]) => [id, r.label, r.emoji])
      ),
    resolve(choice, c) {
      const pathArr = [];
      let bin = 0;
      for (let k = 0; k < 8; k++) {
        const right = randomInt(0, 2);
        pathArr.push(right);
        bin += right;
      }
      const mults = PLINKO[choice].mults;
      const board = mults.map((m, k) => (k === bin ? `【${fx(m * c).replace('x', '')}】` : fx(m * c).replace('x', ''))).join(' · ');
      return {
        base: mults[bin],
        pick: PLINKO[choice].label,
        headline: `🎱 The ball lands in cell **${bin + 1}/9**\n${board}`,
        detail: `cell ${bin + 1}`,
        path: pathArr,
        bin,
        mults,
      };
    },
  },

  crash: {
    title: '🚀 Crash',
    choices: Object.keys(CRASH_TARGETS),
    spinText: 'The rocket takes off...',
    info: (c) => `targets from ${fx(1.5 * c)} to ${fx(10 * c)}`,
    picker: () =>
      choicePicker(
        'crash',
        '🚀 Crash: choose your target multiplier',
        'The rocket climbs then crashes at a random moment. If it reaches your target, you win! The higher the target, the riskier it is.',
        Object.entries(CRASH_TARGETS).map(([id, tg]) => [id, `x${tg}`, '🚀'])
      ),
    resolve(choice) {
      const u = randomInt(1, 1_000_001) / 1_000_000;
      const crash = Math.max(1, Math.floor((0.96 / u) * 100) / 100);
      const target = CRASH_TARGETS[choice];
      return {
        base: crash >= target ? target : 0,
        pick: `Target x${target}`,
        headline: `🚀 The rocket crashes at **${fx(Math.min(crash, 1000))}**${crash >= target ? ' : target reached!' : ' : too early!'}`,
        detail: `target x${target} / crash x${Math.min(crash, 1000)}`,
        crash,
        target,
      };
    },
  },

  scratch: {
    title: '🎟️ Scratch ticket',
    choices: ['go'],
    spinText: 'You scratch the ticket...',
    info: (c) => `from ${fx(1.5 * c)} to ${fx(100 * c)}`,
    picker: (c) =>
      choicePicker(
        'scratch',
        '🎟️ Scratch ticket',
        `Three matching symbols = win!\n${SCRATCH.map(([m, , s]) => `${SCRATCH_EMOJI[s]}${SCRATCH_EMOJI[s]}${SCRATCH_EMOJI[s]}  ->  **${fx(m * c)}**`).join('\n')}`,
        [['go', 'Scratch', '🎟️', ButtonStyle.Success]]
      ),
    resolve() {
      let r = randomInt(0, 10000);
      let win = null;
      for (const row of SCRATCH) {
        if (r < row[1]) {
          win = row;
          break;
        }
        r -= row[1];
      }
      let cells;
      if (win) cells = [win[2], win[2], win[2]];
      else {
        do cells = [0, 1, 2].map(() => SCRATCH_JUNK[randomInt(0, SCRATCH_JUNK.length)]);
        while (cells[0] === cells[1] && cells[1] === cells[2]);
      }
      return {
        base: win ? win[0] : 0,
        pick: 'Ticket',
        headline: `**[ ${cells.map((cl) => SCRATCH_EMOJI[cl]).join(' | ')} ]**`,
        detail: cells.join('-'),
        cells,
      };
    },
  },

  die: {
    title: '🎲 Exact die',
    choices: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'],
    spinText: 'The die rolls...',
    info: (c) => `win ${fx(DIE_MULT * c)}`,
    picker: (c) =>
      choicePicker(
        'die',
        '🎲 Exact die: guess the number',
        `A six-sided die: guess the right number and win **${fx(DIE_MULT * c)}** (1 in 6 chance).`,
        ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id) => [id, id.slice(1), '🎲'])
      ),
    resolve(choice) {
      const n = randomInt(1, 7);
      const want = Number(choice.slice(1));
      return {
        base: n === want ? DIE_MULT : 0,
        pick: `Number ${want}`,
        headline: code(dieLines(n)) + `The die lands on **${dieFace(n)} ${n}**`,
        detail: `${want} -> ${n}`,
        n,
        want,
      };
    },
  },

  chest: {
    title: '📦 Mystery chest',
    choices: ['c1', 'c2', 'c3'],
    spinText: 'You open the chest...',
    info: (c) => `win ${fx(CHEST_MULT * c)}`,
    picker: (c) =>
      choicePicker(
        'chest',
        '📦 Mystery chest: 1 treasure, 3 chests',
        `Only one chest holds the treasure: find it and win **${fx(CHEST_MULT * c)}**.`,
        ['c1', 'c2', 'c3'].map((id) => [id, `Chest ${id.slice(1)}`, '📦'])
      ),
    resolve(choice) {
      const win = randomInt(1, 4);
      const want = Number(choice.slice(1));
      const view = [1, 2, 3].map((k) => (k === win ? '💎' : '💨')).join('  ');
      return { base: win === want ? CHEST_MULT : 0, pick: `Chest ${want}`, headline: `Chest contents: ${view}`, detail: `${want} -> ${win}`, win, want };
    },
  },

  russian: {
    title: '🔫 Russian roulette',
    choices: ['b1', 'b2', 'b3', 'b4', 'b5'],
    spinText: 'The cylinder spins...',
    info: (c) => `from ${fx(russianMult(1) * c)} to ${fx(russianMult(5) * c)}`,
    picker: (c) =>
      choicePicker(
        'russian',
        '🔫 Russian roulette: how many bullets?',
        `Six-chamber cylinder. Survive and win! The more bullets, the bigger the payout.\n${[1, 2, 3, 4, 5]
          .map((k) => `**${k}** bullet${k > 1 ? 's' : ''} : ${fx(russianMult(k) * c)}`)
          .join(' · ')}`,
        [1, 2, 3, 4, 5].map((k) => [`b${k}`, `${k} bullet${k > 1 ? 's' : ''}`, '🔫'])
      ),
    resolve(choice) {
      const k = Number(choice.slice(1));
      const dead = randomInt(0, 6) < k;
      // chamber 0 = the one under the firing pin
      const others = shuffle([1, 2, 3, 4, 5]);
      const loaded = new Set(dead ? [0, ...others.slice(0, k - 1)] : others.slice(0, k));
      const chambers = range(6).map((n) => loaded.has(n));
      return {
        base: dead ? 0 : russianMult(k),
        pick: `${k} bullet${k > 1 ? 's' : ''}`,
        headline: dead ? '💥 **BANG!** You lost.' : '😮‍💨 *click*... You survive!',
        detail: dead ? 'bang' : 'click',
        chambers,
        dead,
        k,
      };
    },
  },

  horses: {
    title: '🏇 Horse race',
    choices: ['h1', 'h2', 'h3', 'h4', 'h5'],
    spinText: 'The horses are off...',
    info: (c) => `from ${fx(HORSES[0].mult * c)} to ${fx(HORSES[4].mult * c)}`,
    picker: (c) =>
      choicePicker(
        'horses',
        '🏇 Horse race: bet on your horse',
        HORSES.map((h, k) => `🐎 **#${k + 1}** : ${fx(h.mult * c)} (${Math.round(h.p * 100)}% chance)`).join('\n'),
        HORSES.map((h, k) => [`h${k + 1}`, `Horse ${k + 1}`, '🐎'])
      ),
    resolve(choice) {
      let r = Math.random();
      let winner = HORSES.length - 1;
      for (let k = 0; k < HORSES.length; k++) {
        if (r < HORSES[k].p) {
          winner = k;
          break;
        }
        r -= HORSES[k].p;
      }
      const want = Number(choice.slice(1)) - 1;
      return {
        base: winner === want ? HORSES[want].mult : 0,
        pick: `Horse ${want + 1}`,
        headline: `🏁 Horse **#${winner + 1}** wins the race!`,
        detail: `${want + 1} -> ${winner + 1}`,
        winner,
        want,
      };
    },
  },

  // ---------- 10 new games ----------
  limbo: {
    title: '📈 Limbo',
    choices: ['x15', 'x2', 'x3', 'x5', 'x10'],
    spinText: 'The multiplier climbs...',
    info: (c) => `targets x1.5 to x10`,
    picker: (c) =>
      choicePicker(
        'limbo',
        '📈 Limbo: choose your target',
        'The multiplier climbs randomly. If it exceeds your target, you win x target.',
        [
          ['x15', 'x1.5', '📈'],
          ['x2', 'x2', '📈'],
          ['x3', 'x3', '📈'],
          ['x5', 'x5', '📈'],
          ['x10', 'x10', '📈'],
        ]
      ),
    resolve(choice) {
      const target = { x15: 1.5, x2: 2, x3: 3, x5: 5, x10: 10 }[choice];
      const u = randomInt(1, 1_000_001) / 1_000_000;
      const peak = Math.max(1, Math.floor((0.97 / u) * 100) / 100);
      return {
        base: peak >= target ? target : 0,
        pick: `Target x${target}`,
        headline: `📈 Peak reached: **${fx(Math.min(peak, 1000))}**${peak >= target ? ' · target cleared!' : ' · too low'}`,
        detail: `target ${target} / peak ${Math.min(peak, 1000)}`,
        peak,
        target,
      };
    },
  },

  higher: {
    title: '⬆️ Higher / Lower',
    choices: ['higher', 'lower'],
    spinText: 'The card is flipped...',
    info: (c) => `win ${fx(1.9 * c)}`,
    picker: (c) =>
      choicePicker(
        'higher',
        '⬆️ Higher / Lower',
        `A reference card is drawn. Guess whether the next is **higher** or **lower** (Ace = 1). Win: **${fx(1.9 * c)}**`,
        [
          ['higher', 'Higher', '⬆️'],
          ['lower', 'Lower', '⬇️'],
        ]
      ),
    resolve(choice) {
      const a = randomInt(1, 14);
      const b = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      const won = choice === 'higher' ? b > a : b < a;
      return {
        base: won ? 1.9 : 0,
        pick: choice === 'higher' ? 'Higher' : 'Lower',
        headline: `Reference **${ranks[a]}** → next **${ranks[b]}**`,
        detail: `${ranks[a]} -> ${ranks[b]}`,
        a,
        b,
      };
    },
  },

  rps: {
    title: '✊ Rock-Paper-Scissors',
    choices: ['rock', 'paper', 'scissors'],
    spinText: '1... 2... 3...',
    info: (c) => `win ${fx(2.8 * c)}`,
    picker: (c) =>
      choicePicker(
        'rps',
        '✊ Rock · Paper · Scissors',
        `Beat the bot. Win: **${fx(2.8 * c)}** · Draw = bet refunded.`,
        [
          ['rock', 'Rock', '✊'],
          ['paper', 'Paper', '✋'],
          ['scissors', 'Scissors', '✌️'],
        ]
      ),
    resolve(choice) {
      const opts = ['rock', 'paper', 'scissors'];
      const bot = opts[randomInt(0, 3)];
      const names = { rock: 'Rock ✊', paper: 'Paper ✋', scissors: 'Scissors ✌️' };
      let base = 0;
      if (choice === bot) base = 1;
      else if (
        (choice === 'rock' && bot === 'scissors') ||
        (choice === 'paper' && bot === 'rock') ||
        (choice === 'scissors' && bot === 'paper')
      )
        base = 2.8;
      return {
        base,
        pick: names[choice],
        headline: `You: **${names[choice]}** · Bot: **${names[bot]}**`,
        detail: `${choice} vs ${bot}`,
        bot,
      };
    },
  },

  colorpick: {
    title: '🎨 Color',
    choices: ['red', 'blue', 'green', 'yellow'],
    spinText: 'The color is revealed...',
    info: (c) => `win ${fx(3.6 * c)}`,
    picker: (c) =>
      choicePicker(
        'colorpick',
        '🎨 Guess the color',
        `4 possible colors. Win: **${fx(3.6 * c)}** (1 in 4 chance).`,
        [
          ['red', 'Red', '🔴'],
          ['blue', 'Blue', '🔵'],
          ['green', 'Green', '🟢'],
          ['yellow', 'Yellow', '🟡'],
        ]
      ),
    resolve(choice) {
      const cols = ['red', 'blue', 'green', 'yellow'];
      const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡' };
      const names = { red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow' };
      const out = cols[randomInt(0, 4)];
      return {
        base: out === choice ? 3.6 : 0,
        pick: names[choice],
        headline: `Color drawn: **${em[out]} ${names[out]}**`,
        detail: `${choice} -> ${out}`,
        out,
      };
    },
  },

  ladder: {
    title: '🪜 Ladder',
    choices: ['s1', 's2', 's3', 's4', 's5'],
    spinText: 'You climb the rungs...',
    info: (c) => `x1.5 to x8`,
    picker: (c) =>
      choicePicker(
        'ladder',
        '🪜 Ladder: how high can you climb?',
        'Each step is riskier and pays more. You win if you reach your chosen step.',
        [
          ['s1', 'Step 1 (x1.5)', '🪜'],
          ['s2', 'Step 2 (x2.2)', '🪜'],
          ['s3', 'Step 3 (x3.5)', '🪜'],
          ['s4', 'Step 4 (x5)', '🪜'],
          ['s5', 'Step 5 (x8)', '🪜'],
        ]
      ),
    resolve(choice) {
      const levels = [1.5, 2.2, 3.5, 5, 8];
      const want = Number(choice.slice(1));
      // probability of success up to step n
      const probs = [0.7, 0.5, 0.35, 0.22, 0.12];
      const reached = randomInt(0, 1000) / 1000 < probs[want - 1] ? want : randomInt(0, want);
      return {
        base: reached >= want ? levels[want - 1] : 0,
        pick: `Step ${want}`,
        headline: `You reached **step ${reached}**${reached >= want ? ' · goal reached!' : ' · too early'}`,
        detail: `target ${want} / reached ${reached}`,
        reached,
        want,
      };
    },
  },

  keno: {
    title: '🎱 Keno',
    choices: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10'],
    spinText: 'Drawing the number...',
    info: (c) => `win ${fx(9.5 * c)}`,
    picker: (c) =>
      choicePicker(
        'keno',
        '🎱 Keno: choose a number (1-10)',
        `1 number drawn out of 10. Win: **${fx(9.5 * c)}**.`,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [`n${n}`, String(n), '🎱'])
      ),
    resolve(choice) {
      const n = randomInt(1, 11);
      const want = Number(choice.slice(1));
      return {
        base: n === want ? 9.5 : 0,
        pick: `No. ${want}`,
        headline: `Number drawn: **${n}**`,
        detail: `${want} -> ${n}`,
        n,
        want,
      };
    },
  },

  war: {
    title: '⚔️ War',
    choices: ['go'],
    spinText: 'The cards are dealt...',
    info: (c) => `win ${fx(1.95 * c)}`,
    picker: (c) =>
      choicePicker(
        'war',
        '⚔️ Card War',
        `You vs the dealer: one card each. The higher card wins (**${fx(1.95 * c)}**). Ties lose.`,
        [['go', 'Play', '⚔️', ButtonStyle.Success]]
      ),
    resolve() {
      const me = randomInt(1, 14);
      const dealer = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      return {
        base: me > dealer ? 1.95 : 0,
        pick: 'War',
        headline: `You **${ranks[me]}** · Dealer **${ranks[dealer]}**`,
        detail: `${ranks[me]} vs ${ranks[dealer]}`,
        me,
        dealer,
      };
    },
  },

  hilo: {
    title: '🃏 Hi-Lo',
    choices: ['go'],
    spinText: 'Sequence of 3 cards...',
    info: (c) => `3 high or 3 low ${fx(4 * c)}`,
    picker: (c) =>
      choicePicker(
        'hilo',
        '🃏 Hi-Lo',
        `3 cards drawn. If all 3 are high (8+) or all 3 are low (7-), you win **${fx(4 * c)}**.`,
        [['go', 'Draw', '🃏', ButtonStyle.Success]]
      ),
    resolve() {
      const cards = [randomInt(1, 14), randomInt(1, 14), randomInt(1, 14)];
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      const high = cards.every((c) => c >= 8);
      const low = cards.every((c) => c <= 7);
      return {
        base: high || low ? 4 : 0,
        pick: 'Hi-Lo',
        headline: `Cards: **${cards.map((c) => ranks[c]).join(' · ')}**${high ? ' · 3 HIGH!' : low ? ' · 3 LOW!' : ''}`,
        detail: cards.map((c) => ranks[c]).join('-'),
        cards,
      };
    },
  },

  bingo: {
    title: '🅱️ Bingo',
    choices: ['b1', 'b2', 'b3', 'b4', 'b5'],
    spinText: 'The ball comes out...',
    info: (c) => `win ${fx(4.5 * c)}`,
    picker: (c) =>
      choicePicker(
        'bingo',
        '🅱️ Bingo: choose your spot',
        `5 spots. One ball is drawn. Win: **${fx(4.5 * c)}**.`,
        [1, 2, 3, 4, 5].map((n) => [`b${n}`, `Spot ${n}`, '🅱️'])
      ),
    resolve(choice) {
      const n = randomInt(1, 6);
      const want = Number(choice.slice(1));
      return {
        base: n === want ? 4.5 : 0,
        pick: `Spot ${want}`,
        headline: `Ball in **spot ${n}**`,
        detail: `${want} -> ${n}`,
        n,
        want,
      };
    },
  },

  jackpot: {
    title: '💎 Jackpot',
    choices: ['go'],
    spinText: 'The symbols are spinning...',
    info: (c) => `jackpot ${fx(50 * c)} · 2 matching ${fx(3 * c)}`,
    picker: (c) =>
      choicePicker(
        'jackpot',
        '💎 Jackpot',
        `3 symbols. 3 matching = **${fx(50 * c)}**. 2 matching = **${fx(3 * c)}**.`,
        [['go', 'Spin', '💎', ButtonStyle.Success]]
      ),
    resolve() {
      const syms = ['🍒', '🍋', '💎', '7️⃣', '⭐'];
      const a = syms[randomInt(0, syms.length)];
      const b = syms[randomInt(0, syms.length)];
      const c = syms[randomInt(0, syms.length)];
      let base = 0;
      if (a === b && b === c) base = a === '💎' || a === '7️⃣' ? 50 : 20;
      else if (a === b || b === c || a === c) base = 3;
      return {
        base,
        pick: 'Jackpot',
        headline: `**[ ${a} | ${b} | ${c} ]**`,
        detail: `${a}-${b}-${c}`,
        a,
        b,
        c,
      };
    },
  },

  // ========== 30 NOUVEAUX JEUX ==========
  dicewar: {
    title: '🎲 Dice War',
    choices: ['go'],
    spinText: 'The dice clash...',
    info: (c) => `win ${fx(1.95 * c)}`,
    picker: (c) => choicePicker('dicewar', '🎲 Dice War', `Your die vs the dealer's. The higher die wins (**${fx(1.95 * c)}**). Ties lose.`, [['go', 'Spin', '🎲', ButtonStyle.Success]]),
    resolve() {
      const me = randomInt(1, 7), dealer = randomInt(1, 7);
      return { base: me > dealer ? 1.95 : 0, pick: 'War', headline: code(sideBySide([dieLines(me), dieLines(dealer)], '   ')) + `You **${me}** · Dealer **${dealer}**`, detail: `${me} vs ${dealer}`, me, dealer };
    },
  },
  coinladder: {
    title: '🪙 Coin Ladder',
    choices: ['s1', 's2', 's3', 's4'],
    spinText: 'The coin spins again...',
    info: (c) => `x1.8 to x8`,
    picker: (c) => choicePicker('coinladder', '🪙 Coin Ladder', 'Win several heads in a row. The higher you aim, the riskier it gets.', [['s1', '1 heads (x1.8)', '🪙'], ['s2', '2 heads (x3)', '🪙'], ['s3', '3 heads (x5)', '🪙'], ['s4', '4 heads (x8)', '🪙']]),
    resolve(choice) {
      const need = Number(choice.slice(1));
      const mults = [0, 1.8, 3, 5, 8];
      let streak = 0;
      const flips = [];
      for (let k = 0; k < need; k++) {
        const ok = randomInt(0, 2) === 0;
        flips.push(ok ? 'H' : 'T');
        if (ok) streak++;
        else break;
      }
      return { base: streak >= need ? mults[need] : 0, pick: `${need} heads`, headline: `Results: **${flips.join(' · ')}** (${streak}/${need})`, detail: flips.join(''), streak, need };
    },
  },
  cardmatch: {
    title: '🃏 Card Match',
    choices: ['go'],
    spinText: 'Shuffling the cards...',
    info: (c) => `win ${fx(3.8 * c)}`,
    picker: (c) => choicePicker('cardmatch', '🃏 Card Match', `A secret card is drawn from 4. Find it: **${fx(3.8 * c)}**.`, [['go', 'Reveal', '🃏', ButtonStyle.Success]]),
    resolve() {
      const cards = shuffle([{ r: 'A', s: '♠' }, { r: 'K', s: '♥' }, { r: 'Q', s: '♦' }, { r: 'J', s: '♣' }]);
      const secret = cards[0];
      const pick = cards[randomInt(0, 4)];
      return { base: pick.r === secret.r && pick.s === secret.s ? 3.8 : 0, pick: 'Match', headline: `Secret: ${cardStr(secret)} · Drawn: ${cardStr(pick)}`, detail: `${secret.r}${secret.s}`, secret, pickCard: pick };
    },
  },
  numguess: {
    title: '🔢 Guess the number',
    choices: Array.from({ length: 10 }, (_, i) => `n${i + 1}`),
    spinText: 'Drawing from 1 to 10...',
    info: (c) => `win ${fx(9.5 * c)}`,
    picker: (c) => choicePicker('numguess', '🔢 Guess the number (1-10)', `1 in 10 chance · **${fx(9.5 * c)}**`, Array.from({ length: 10 }, (_, i) => [`n${i + 1}`, String(i + 1), '🔢'])),
    resolve(choice) {
      const n = randomInt(1, 11), want = Number(choice.slice(1));
      return { base: n === want ? 9.5 : 0, pick: `No. ${want}`, headline: `Number drawn: **${n}**`, detail: `${want}->${n}`, n, want };
    },
  },
  bombdefuse: {
    title: '💣 Defusal',
    choices: ['w1', 'w2', 'w3', 'w4'],
    spinText: 'The timer is ticking...',
    info: (c) => `win ${fx(3.6 * c)}`,
    picker: (c) => choicePicker('bombdefuse', '💣 Defusal: cut a wire', `4 wires, only one defuses. **${fx(3.6 * c)}** if you pick the right one.`, [['w1', 'Red wire', '🔴'], ['w2', 'Blue wire', '🔵'], ['w3', 'Green wire', '🟢'], ['w4', 'Yellow wire', '🟡']]),
    resolve(choice) {
      const good = randomInt(1, 5), want = Number(choice.slice(1));
      return { base: good === want ? 3.6 : 0, pick: `Wire ${want}`, headline: good === want ? '✅ Bomb defused!' : `💥 Wrong wire (it was #${good})`, detail: `${want}->${good}`, good, want };
    },
  },
  treasure: {
    title: '🗺️ Treasure map',
    choices: ['c1', 'c2', 'c3', 'c4', 'c5'],
    spinText: 'You dig...',
    info: (c) => `win ${fx(4.5 * c)}`,
    picker: (c) => choicePicker('treasure', '🗺️ Treasure map', `5 spots, 1 treasure. **${fx(4.5 * c)}**`, [1, 2, 3, 4, 5].map((n) => [`c${n}`, `Spot ${n}`, '🗺️'])),
    resolve(choice) {
      const win = randomInt(1, 6), want = Number(choice.slice(1));
      return { base: win === want ? 4.5 : 0, pick: `Spot ${want}`, headline: `Treasure in **spot ${win}**`, detail: `${want}->${win}`, win, want };
    },
  },
  highcard: {
    title: '🃏 High card',
    choices: ['go'],
    spinText: 'Drawing the card...',
    info: (c) => `≥ 8 → ${fx(1.9 * c)}`,
    picker: (c) => choicePicker('highcard', '🃏 High card', `Card ≥ 8 (8,9,10,J,Q,K) wins **${fx(1.9 * c)}**. Ace = 1.`, [['go', 'Draw', '🃏', ButtonStyle.Success]]),
    resolve() {
      const v = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      return { base: v >= 8 ? 1.9 : 0, pick: 'High', headline: `Card: **${ranks[v]}**`, detail: ranks[v], v };
    },
  },
  lowcard: {
    title: '🃏 Low card',
    choices: ['go'],
    spinText: 'Drawing the card...',
    info: (c) => `≤ 7 → ${fx(1.9 * c)}`,
    picker: (c) => choicePicker('lowcard', '🃏 Low card', `Card ≤ 7 wins **${fx(1.9 * c)}**. Ace = 1.`, [['go', 'Draw', '🃏', ButtonStyle.Success]]),
    resolve() {
      const v = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      return { base: v <= 7 ? 1.9 : 0, pick: 'Low', headline: `Card: **${ranks[v]}**`, detail: ranks[v], v };
    },
  },
  pairmatch: {
    title: '🃏 Pair',
    choices: ['go'],
    spinText: 'Two cards...',
    info: (c) => `pair ${fx(5.5 * c)}`,
    picker: (c) => choicePicker('pairmatch', '🃏 Pair', `Two cards. Same rank = **${fx(5.5 * c)}**.`, [['go', 'Draw', '🃏', ButtonStyle.Success]]),
    resolve() {
      const a = randomInt(1, 14), b = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      return { base: a === b ? 5.5 : 0, pick: 'Pair', headline: `**${ranks[a]}** · **${ranks[b]}**`, detail: `${ranks[a]}-${ranks[b]}`, a, b };
    },
  },
  freefall: {
    title: '🪂 Free fall',
    choices: ['safe', 'mid', 'risk'],
    spinText: 'You jump...',
    info: (c) => `x1.5 / x2.5 / x5`,
    picker: (c) => choicePicker('freefall', '🪂 Free fall', 'Choose your landing zone.', [['safe', 'Safe zone (x1.5)', '🟢'], ['mid', 'Medium zone (x2.5)', '🟡'], ['risk', 'Risky zone (x5)', '🔴']]),
    resolve(choice) {
      const zones = { safe: { mult: 1.5, p: 0.65 }, mid: { mult: 2.5, p: 0.38 }, risk: { mult: 5, p: 0.18 } };
      const z = zones[choice];
      const ok = Math.random() < z.p;
      return { base: ok ? z.mult : 0, pick: choice, headline: ok ? '✅ Perfect landing!' : '💥 You missed the zone...', detail: choice, ok };
    },
  },
  balloon: {
    title: '🎈 Balloon',
    choices: ['s1', 's2', 's3', 's4', 's5'],
    spinText: 'The balloon inflates...',
    info: (c) => `x1.4 to x7`,
    picker: (c) => choicePicker('balloon', '🎈 Balloon', 'Inflate the balloon. The further you go, the more you win — but it can pop.', [['s1', 'Level 1 (x1.4)', '🎈'], ['s2', 'Level 2 (x2)', '🎈'], ['s3', 'Level 3 (x3)', '🎈'], ['s4', 'Level 4 (x4.5)', '🎈'], ['s5', 'Level 5 (x7)', '🎈']]),
    resolve(choice) {
      const need = Number(choice.slice(1));
      const mults = [0, 1.4, 2, 3, 4.5, 7];
      const probs = [0, 0.8, 0.6, 0.42, 0.28, 0.15];
      const ok = Math.random() < probs[need];
      return { base: ok ? mults[need] : 0, pick: `Level ${need}`, headline: ok ? `🎈 Balloon intact at level ${need}!` : `💥 The balloon popped at level ${need}`, detail: `${need}:${ok}`, need, ok };
    },
  },
  target: {
    title: '🎯 Target',
    choices: ['center', 'inner', 'outer'],
    spinText: 'The dart flies...',
    info: (c) => `center ${fx(5 * c)} · inner ${fx(2.5 * c)} · outer ${fx(1.5 * c)}`,
    picker: (c) => choicePicker('target', '🎯 Target', 'Aim for the center, inner, or outer ring.', [['center', 'Center (x5)', '🔴'], ['inner', 'Inner (x2.5)', '🟡'], ['outer', 'Outer (x1.5)', '🟢']]),
    resolve(choice) {
      const r = Math.random();
      const hit = r < 0.12 ? 'center' : r < 0.4 ? 'inner' : 'outer';
      const mults = { center: 5, inner: 2.5, outer: 1.5 };
      return { base: hit === choice ? mults[choice] : 0, pick: choice, headline: `Impact: **${hit}**`, detail: `${choice}->${hit}`, hit };
    },
  },
  sequence: {
    title: '🔢 Sequence',
    choices: ['go'],
    spinText: 'Sequence of 3 numbers...',
    info: (c) => `sequence ${fx(6 * c)}`,
    picker: (c) => choicePicker('sequence', '🔢 Sequence', `3 numbers. If they form a sequence (e.g. 3-4-5), **${fx(6 * c)}**.`, [['go', 'Draw', '🔢', ButtonStyle.Success]]),
    resolve() {
      const a = randomInt(1, 9), b = randomInt(1, 9), c = randomInt(1, 9);
      const sorted = [a, b, c].sort((x, y) => x - y);
      const ok = sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
      return { base: ok ? 6 : 0, pick: 'Sequence', headline: `**${a} · ${b} · ${c}**${ok ? ' · SEQUENCE!' : ''}`, detail: `${a}-${b}-${c}`, a, b, c, ok };
    },
  },
  animalrace: {
    title: '🐾 Animal race',
    choices: ['a1', 'a2', 'a3', 'a4'],
    spinText: 'The animals are off...',
    info: (c) => `x2 to x6`,
    picker: (c) => choicePicker('animalrace', '🐾 Animal race', 'Bet on an animal.', [['a1', 'Rabbit (x2)', '🐰'], ['a2', 'Fox (x3)', '🦊'], ['a3', 'Wolf (x4)', '🐺'], ['a4', 'Eagle (x6)', '🦅']]),
    resolve(choice) {
      const animals = [{ id: 'a1', name: 'Rabbit', mult: 2, p: 0.42 }, { id: 'a2', name: 'Fox', mult: 3, p: 0.28 }, { id: 'a3', name: 'Wolf', mult: 4, p: 0.18 }, { id: 'a4', name: 'Eagle', mult: 6, p: 0.12 }];
      let r = Math.random(), winner = animals[animals.length - 1];
      for (const a of animals) { if (r < a.p) { winner = a; break; } r -= a.p; }
      const want = animals.find((a) => a.id === choice);
      return { base: winner.id === choice ? want.mult : 0, pick: want.name, headline: `🏆 Winner: **${winner.name}**`, detail: `${choice}->${winner.id}`, winner };
    },
  },
  fruitmatch: {
    title: '🍎 Fruits',
    choices: ['go'],
    spinText: 'The fruits spin...',
    info: (c) => `3 matching ${fx(12 * c)} · 2 ${fx(2.5 * c)}`,
    picker: (c) => choicePicker('fruitmatch', '🍎 Fruits', `3 fruits. 3 matching = **${fx(12 * c)}**, 2 = **${fx(2.5 * c)}**.`, [['go', 'Spin', '🍎', ButtonStyle.Success]]),
    resolve() {
      const fruits = ['🍎', '🍌', '🍇', '🍊', '🍓'];
      const a = fruits[randomInt(0, 5)], b = fruits[randomInt(0, 5)], c = fruits[randomInt(0, 5)];
      let base = 0;
      if (a === b && b === c) base = 12;
      else if (a === b || b === c || a === c) base = 2.5;
      return { base, pick: 'Fruits', headline: `**[ ${a} | ${b} | ${c} ]**`, detail: `${a}${b}${c}`, a, b, c };
    },
  },
  gemhunt: {
    title: '💎 Gem hunt',
    choices: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'],
    spinText: 'You dig...',
    info: (c) => `win ${fx(5.5 * c)}`,
    picker: (c) => choicePicker('gemhunt', '💎 Gem hunt', `6 rocks, 1 gem. **${fx(5.5 * c)}**`, [1, 2, 3, 4, 5, 6].map((n) => [`g${n}`, `Rock ${n}`, '🪨'])),
    resolve(choice) {
      const win = randomInt(1, 7), want = Number(choice.slice(1));
      return { base: win === want ? 5.5 : 0, pick: `Rock ${want}`, headline: win === want ? '💎 Gem found!' : `Nothing in rock ${want} (it was #${win})`, detail: `${want}->${win}`, win, want };
    },
  },
  stardrop: {
    title: '⭐ Shooting star',
    choices: ['catch', 'miss'],
    spinText: 'The star crosses the sky...',
    info: (c) => `catch ${fx(2.2 * c)}`,
    picker: (c) => choicePicker('stardrop', '⭐ Shooting star', `Try to catch the star (**${fx(2.2 * c)}**) or let it pass (bet refunded if it truly falls).`, [['catch', 'Catch', '⭐'], ['miss', 'Let pass', '🌑']]),
    resolve(choice) {
      const falls = Math.random() < 0.55;
      if (choice === 'catch') return { base: falls ? 2.2 : 0, pick: 'Catch', headline: falls ? '⭐ You caught it!' : 'It passed too quickly...', detail: 'catch', falls };
      return { base: falls ? 0 : 1, pick: 'Let pass', headline: falls ? '⭐ It fell (you missed it)' : 'It went on its way; bet refunded.', detail: 'miss', falls };
    },
  },
  moonshot: {
    title: '🌙 Moon shot',
    choices: ['x2', 'x4', 'x8'],
    spinText: 'The rocket lifts off toward the Moon...',
    info: (c) => `x2 / x4 / x8`,
    picker: (c) => choicePicker('moonshot', '🌙 Moon shot', 'Reach the chosen distance.', [['x2', 'Orbit (x2)', '🌍'], ['x4', 'Moon (x4)', '🌙'], ['x8', 'Beyond (x8)', '🚀']]),
    resolve(choice) {
      const targets = { x2: 2, x4: 4, x8: 8 };
      const probs = { x2: 0.48, x4: 0.24, x8: 0.11 };
      const t = targets[choice];
      const ok = Math.random() < probs[choice];
      return { base: ok ? t : 0, pick: choice, headline: ok ? `🌙 Distance ${choice} reached!` : `💥 Failed before ${choice}`, detail: choice, ok };
    },
  },
  volcano: {
    title: '🌋 Volcano',
    choices: ['close', 'mid', 'far'],
    spinText: 'The volcano rumbles...',
    info: (c) => `near ${fx(4 * c)} · mid ${fx(2.2 * c)} · far ${fx(1.4 * c)}`,
    picker: (c) => choicePicker('volcano', '🌋 Volcano', 'Where do you stand? Closer = riskier.', [['close', 'Near (x4)', '🔴'], ['mid', 'Mid (x2.2)', '🟡'], ['far', 'Far (x1.4)', '🟢']]),
    resolve(choice) {
      const r = Math.random();
      const eruption = r < 0.35 ? 'close' : r < 0.7 ? 'mid' : 'far';
      // you win if you are NOT in the eruption zone... actually: you win if you guessed the zone
      const mults = { close: 4, mid: 2.2, far: 1.4 };
      return { base: eruption === choice ? mults[choice] : 0, pick: choice, headline: `Eruption zone **${eruption}**`, detail: `${choice}->${eruption}`, eruption };
    },
  },
  lightning: {
    title: '⚡ Lightning',
    choices: ['stay', 'run'],
    spinText: 'The storm is coming...',
    info: (c) => `stay ${fx(2.5 * c)} · run (refunded if lightning strikes)`,
    picker: (c) => choicePicker('lightning', '⚡ Lightning', `Stay in the storm (**${fx(2.5 * c)}**) if you survive, or run.`, [['stay', 'Stay', '⚡'], ['run', 'Run', '🏃']]),
    resolve(choice) {
      const strike = Math.random() < 0.4;
      if (choice === 'stay') return { base: strike ? 0 : 2.5, pick: 'Stay', headline: strike ? '⚡ Struck by lightning!' : 'You survived the storm!', detail: 'stay', strike };
      return { base: strike ? 1 : 0, pick: 'Run', headline: strike ? 'You were right to run (bet refunded).' : 'No lightning... you ran for nothing.', detail: 'run', strike };
    },
  },
  pokerhand: {
    title: '🃏 Express poker',
    choices: ['go'],
    spinText: 'Dealing...',
    info: (c) => `pair+ ${fx(2 * c)} · three of a kind ${fx(8 * c)}`,
    picker: (c) => choicePicker('pokerhand', '🃏 Express poker', `3 cards. Pair = **${fx(2 * c)}**, three of a kind = **${fx(8 * c)}**.`, [['go', 'Deal', '🃏', ButtonStyle.Success]]),
    resolve() {
      const ranks = [randomInt(1, 14), randomInt(1, 14), randomInt(1, 14)];
      const names = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      const counts = {};
      for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
      const max = Math.max(...Object.values(counts));
      let base = 0;
      if (max >= 3) base = 8;
      else if (max >= 2) base = 2;
      return { base, pick: 'Poker', headline: `**${ranks.map((r) => names[r]).join(' · ')}**${max >= 3 ? ' · THREE OF A KIND!' : max >= 2 ? ' · Pair' : ''}`, detail: ranks.join('-'), ranks, max };
    },
  },
  redblack: {
    title: '🔴 Black or Red',
    choices: ['red', 'black'],
    spinText: 'The card is flipped...',
    info: (c) => `win ${fx(1.95 * c)}`,
    picker: (c) => choicePicker('redblack', '🔴 Black or Red', `Guess the color. **${fx(1.95 * c)}**.`, [['red', 'Red', '🔴'], ['black', 'Black', '⚫']]),
    resolve(choice) {
      const col = randomInt(0, 2) === 0 ? 'red' : 'black';
      return { base: col === choice ? 1.95 : 0, pick: choice === 'red' ? 'Red' : 'Black', headline: `Color: **${col === 'red' ? '🔴 Red' : '⚫ Black'}**`, detail: `${choice}->${col}`, col };
    },
  },
  oddseven: {
    title: '🔢 Even or Odd+',
    choices: ['even', 'odd'],
    spinText: 'The die rolls...',
    info: (c) => `win ${fx(1.95 * c)}`,
    picker: (c) => choicePicker('oddseven', '🔢 Even or Odd', `One die. Even or odd: **${fx(1.95 * c)}**.`, [['even', 'Even', '🔵'], ['odd', 'Odd', '🔴']]),
    resolve(choice) {
      const n = randomInt(1, 7);
      const isEven = n % 2 === 0;
      const ok = (choice === 'even' && isEven) || (choice === 'odd' && !isEven);
      return { base: ok ? 1.95 : 0, pick: choice === 'even' ? 'Even' : 'Odd', headline: code(dieLines(n)) + `**${n}** (${isEven ? 'even' : 'odd'})`, detail: `${choice}->${n}`, n };
    },
  },
  multiplier: {
    title: '✖️ Multiplier',
    choices: ['m15', 'm2', 'm3', 'm5'],
    spinText: 'The multiplier is spinning...',
    info: (c) => `x1.5 to x5`,
    picker: (c) => choicePicker('multiplier', '✖️ Multiplier', 'Choose your target. A random draw decides.', [['m15', 'x1.5', '✖️'], ['m2', 'x2', '✖️'], ['m3', 'x3', '✖️'], ['m5', 'x5', '✖️']]),
    resolve(choice) {
      const targets = { m15: 1.5, m2: 2, m3: 3, m5: 5 };
      const probs = { m15: 0.62, m2: 0.45, m3: 0.3, m5: 0.18 };
      const t = targets[choice];
      const ok = Math.random() < probs[choice];
      return { base: ok ? t : 0, pick: `x${t}`, headline: ok ? `✅ Multiplier x${t} cleared!` : `❌ Not this time (target x${t})`, detail: choice, ok };
    },
  },
  memory: {
    title: '🧠 Memory',
    choices: ['go'],
    spinText: 'Cards are flipping...',
    info: (c) => `pair ${fx(3.5 * c)}`,
    picker: (c) => choicePicker('memory', '🧠 Memory', `4 face-down cards, 2 pairs. Flip 2: if they match, **${fx(3.5 * c)}**.`, [['go', 'Flip', '🧠', ButtonStyle.Success]]),
    resolve() {
      const vals = shuffle([1, 1, 2, 2]);
      const i1 = randomInt(0, 4), i2 = (i1 + 1 + randomInt(0, 3)) % 4;
      const ok = vals[i1] === vals[i2];
      return { base: ok ? 3.5 : 0, pick: 'Memory', headline: `Cards flipped: **${vals[i1]}** and **${vals[i2]}**${ok ? ' · Pair!' : ''}`, detail: `${vals[i1]}-${vals[i2]}`, ok };
    },
  },
  colorswipe: {
    title: '🌈 Rainbow',
    choices: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'],
    spinText: 'The rainbow spins...',
    info: (c) => `win ${fx(5.5 * c)}`,
    picker: (c) => choicePicker('colorswipe', '🌈 Rainbow', `6 colors. **${fx(5.5 * c)}**.`, [['red', 'Red', '🔴'], ['orange', 'Orange', '🟠'], ['yellow', 'Yellow', '🟡'], ['green', 'Green', '🟢'], ['blue', 'Blue', '🔵'], ['purple', 'Purple', '🟣']]),
    resolve(choice) {
      const cols = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
      const em = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣' };
      const out = cols[randomInt(0, 6)];
      return { base: out === choice ? 5.5 : 0, pick: choice, headline: `Color: **${em[out]}**`, detail: `${choice}->${out}`, out };
    },
  },
  rocket2: {
    title: '🚀 Rocket 2',
    choices: ['x2', 'x5', 'x10', 'x20'],
    spinText: 'Liftoff...',
    info: (c) => `x2 to x20`,
    picker: (c) => choicePicker('rocket2', '🚀 Rocket 2', 'Choose your multiplier target.', [['x2', 'x2', '🚀'], ['x5', 'x5', '🚀'], ['x10', 'x10', '🚀'], ['x20', 'x20', '🚀']]),
    resolve(choice) {
      const targets = { x2: 2, x5: 5, x10: 10, x20: 20 };
      const u = randomInt(1, 1_000_001) / 1_000_000;
      const peak = Math.max(1, Math.floor((0.96 / u) * 100) / 100);
      const t = targets[choice];
      return { base: peak >= t ? t : 0, pick: choice, headline: `Peak **${fx(Math.min(peak, 500))}** · target ${choice}`, detail: `${choice}/${peak}`, peak, t };
    },
  },
  diceexact2: {
    title: '🎲 Double die',
    choices: ['s7', 's8', 's9', 's10', 's11', 's12'],
    spinText: 'Two dice roll...',
    info: (c) => `exact sum ${fx(6 * c)}`,
    picker: (c) => choicePicker('diceexact2', '🎲 Double die: exact sum', `Guess the sum (7 to 12). **${fx(6 * c)}**.`, [7, 8, 9, 10, 11, 12].map((n) => [`s${n}`, String(n), '🎲'])),
    resolve(choice) {
      const a = randomInt(1, 7), b = randomInt(1, 7), sum = a + b, want = Number(choice.slice(1));
      return { base: sum === want ? 6 : 0, pick: `Sum ${want}`, headline: code(sideBySide([dieLines(a), dieLines(b)], '   ')) + `**${a}+${b}=${sum}**`, detail: `${want}->${sum}`, a, b, sum };
    },
  },
  chest2: {
    title: '📦 Triple chest',
    choices: ['c1', 'c2', 'c3'],
    spinText: 'Opening...',
    info: (c) => `win ${fx(2.85 * c)}`,
    picker: (c) => choicePicker('chest2', '📦 Triple chest', `1 treasure in 3. **${fx(2.85 * c)}**.`, [['c1', 'Chest 1', '📦'], ['c2', 'Chest 2', '📦'], ['c3', 'Chest 3', '📦']]),
    resolve(choice) {
      const win = randomInt(1, 4), want = Number(choice.slice(1));
      const view = [1, 2, 3].map((k) => (k === win ? '💎' : '💨')).join('  ');
      return { base: win === want ? 2.85 : 0, pick: `Chest ${want}`, headline: `Contents: ${view}`, detail: `${want}->${win}`, win, want };
    },
  },
  spincolor: {
    title: '🎨 Color wheel',
    choices: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'],
    spinText: 'The wheel spins...',
    info: (c) => `win ${fx(5.5 * c)}`,
    picker: (c) => choicePicker('spincolor', '🎨 Color wheel', `6 segments. **${fx(5.5 * c)}**.`, [['red', 'Red', '🔴'], ['blue', 'Blue', '🔵'], ['green', 'Green', '🟢'], ['yellow', 'Yellow', '🟡'], ['purple', 'Purple', '🟣'], ['orange', 'Orange', '🟠']]),
    resolve(choice) {
      const cols = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
      const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', purple: '🟣', orange: '🟠' };
      const out = cols[randomInt(0, 6)];
      return { base: out === choice ? 5.5 : 0, pick: choice, headline: `The wheel stops on **${em[out]}**`, detail: `${choice}->${out}`, out };
    },
  },
});

// ============================================================
//  ANIMATIONS FOR EACH GAME  (res = already-drawn result, ctx = { c, bet, choice })
// ============================================================
ANIMS.coinflip = (res) => {
  const forms = [
    ['PILE', 5], ['MID', 4], ['EDGE', 2], ['MID', 1], ['FACE', 0], ['MID', 0], ['EDGE', 1], ['MID', 2],
  ];
  const caps = [
    'The coin is tossed', 'It rises...', 'It spins on its edge', 'It gains height',
    'Top of the toss', 'It starts falling', 'It spins again', 'It comes back down',
  ];
  const frames = forms.map(([f, y], k) => ({ art: coinScene(f, y), caption: caps[k], ms: 800 }));
  frames.push({
    art: coinScene(res.side === 'pile' ? 'PILE' : 'FACE', 4),
    caption: `The coin lands: ${res.side === 'pile' ? 'PILE' : 'FACE'}`,
    ms: 900,
  });
  return frames;
};

ANIMS.dice = (res) => {
  const r = () => randomInt(1, 7);
  const show = (a, b, cap, ms) => ({ art: code(sideBySide([dieLines(a), dieLines(b)], '   ')), caption: cap, ms });
  return [
    show(r(), r(), 'Dice leave your hand', 800),
    show(r(), r(), 'They bounce on the felt', 800),
    show(r(), r(), 'Ils roulent...', 850),
    show(r(), r(), 'Ils ralentissent', 900),
    show(res.a, r(), `First die: ${res.a}`, 1000),
    show(res.a, res.b, `Total: ${res.a} + ${res.b} = ${res.sum}`, 1100),
  ];
};

ANIMS.die = (res) => {
  const r = () => randomInt(1, 7);
  const show = (n, cap, ms) => ({ art: code(dieLines(n)), caption: cap, ms });
  return [
    show(r(), 'The die is rolled', 800),
    show(r(), 'Il rebondit', 800),
    show(r(), 'Il roule...', 850),
    show(r(), 'It slows down', 900),
    show(r(), 'Almost stopped', 950),
    show(res.n, `The die stops on ${res.n}`, 1000),
  ];
};

ANIMS.slots = (res) => {
  const syms = SLOT_SYMBOLS.map((x) => x.s);
  const rnd = () => syms[randomInt(0, syms.length)];
  const finals = res.reels.map((r) => r.s);
  const around = finals.map(() => [rnd(), rnd()]);
  const stopAt = [3, 5, 7];
  const frames = [];
  const caps = {
    1: 'Reels start', 2: 'They spin at full speed', 3: 'Reel 1 locked',
    4: 'The other two still spin', 5: 'Reel 2 locked', 6: 'Last reel...', 7: 'Reel 3 locked',
  };
  const board = (cols, mark) => {
    const row = (r) => '| ' + cols.map((c) => c[r]).join(' | ') + ' |';
    return code([
      '.' + '-'.repeat(17) + '.',
      ' ' + row(0),
      '>' + row(1) + '<',
      ' ' + row(2),
      "'" + '-'.repeat(17) + "'",
      mark || '',
    ]);
  };
  for (let f = 1; f <= 7; f++) {
    const cols = [0, 1, 2].map((k) => (f >= stopAt[k] ? [around[k][0], finals[k], around[k][1]] : [rnd(), rnd(), rnd()]));
    frames.push({ art: board(cols), caption: caps[f], ms: 800 });
  }
  const cols = [0, 1, 2].map((k) => [around[k][0], finals[k], around[k][1]]);
  const triple = finals[0] === finals[1] && finals[1] === finals[2];
  const two = finals.filter((s) => s === 'CER').length === 2;
  frames.push({
    art: board(cols, triple ? '   *** THREE MATCHING ***' : two ? '   * TWO CHERRIES *' : '       no win'),
    caption: triple ? (finals[0] === ' 7 ' ? 'JACKPOT!' : 'Winning combination!') : two ? 'Two cherries!' : 'No combination',
    ms: 1100,
  });
  return frames;
};

ANIMS.wheel = (res, ctx) => {
  const c = ctx.c;
  const cell = (v, center) => {
    const lab = v === 0 ? 'x0' : `x${short(v * c)}`;
    const inner = lab.length >= 4 ? lab.slice(0, 4) : lab.padStart(Math.floor((4 + lab.length) / 2)).padEnd(4);
    return center ? `[${inner}]` : ` ${inner} `;
  };
  const steps = [6, 5, 4, 3, 2, 2, 1, 1]; // 24 = one full turn
  const pos = stripPositions(res.idx, steps);
  const caps = [
    'The wheel is spun', 'It speeds up', 'Full speed', 'The slots flash by', 'It slows down',
    'Only a few slots left', 'The pointer hesitates', 'Last slot...', `The wheel stops on ${res.base === 0 ? 'x0' : fx(res.base * c)}`,
  ];
  return pos.map((p, k) => ({
    art: code([...stripArt(WHEEL, p, cell, 5), '', `  24 cells · pointer in the center`]),
    caption: caps[k],
    ms: 700 + k * 100,
  }));
};

ANIMS.duel = (res) => {
  const lab = () => `${padR('     YOU', 12)}${'  DEALER'}`;
  const scene = (meHidden, dHidden, cap, ms) => ({
    art: code([lab(), ...sideBySide([cardLines(res.me, meHidden), cardLines(res.dealer, dHidden)], '     ')]),
    caption: cap,
    ms,
  });
  const verdict = res.me.v > res.dealer.v ? 'Your card is higher: WIN' : res.me.v === res.dealer.v ? 'Tie: lost' : 'The dealer card is higher: LOSS';
  return [
    scene(true, true, 'Dealer shuffles the cards', 850),
    scene(true, true, 'Cards are dealt', 900),
    scene(true, true, 'You flip your card...', 1000),
    scene(false, true, `Your card: ${res.me.r}${res.me.s}`, 1100),
    scene(false, true, 'Dealer flips theirs...', 1000),
    scene(false, false, verdict, 1200),
  ];
};

ANIMS.suit = (res, ctx) => {
  const order = SUITS;
  const cell = (s, center) => (center ? `[ ${s} ]` : `  ${s}  `);
  const finalIdx = order.indexOf(res.card.s);
  const pos = stripPositions(finalIdx, [4, 3, 3, 2, 1, 1]);
  const want = SUIT_CHOICES[ctx.choice];
  const frames = pos.map((p, k) => ({
    art: code([...stripArt(order, p, cell, 3), '', `Your pick: ${want}`]),
    caption: ['Dealer shuffles the deck', 'Suits flash by', 'Slowing down', 'Almost...', 'One more notch', `Suit drawn: ${res.card.s}`][k] || '...',
    ms: 800 + k * 80,
  }));
  frames.push({ art: code([...cardLines(null, true), '', `Your pick: ${want}`]), caption: 'Card is placed face down', ms: 900 });
  frames.push({ art: code([...cardLines(res.card, false), '', `Your pick: ${want}`]), caption: `Card flipped: ${res.card.r}${res.card.s}`, ms: 1100 });
  return frames;
};

ANIMS.zone = (res, ctx) => {
  const zone = ZONES[ctx.choice];
  const grid = (cur) => {
    const cell = (k) => (k === cur ? `<${padL(k, 2)}>` : `[${padL(k, 2)}]`);
    return [range(5).map((k) => cell(k + 1)).join(''), range(5).map((k) => cell(k + 6)).join('')];
  };
  const seq = [];
  let prev = randomInt(1, 11);
  for (let k = 0; k < 7; k++) {
    let nx;
    do nx = randomInt(1, 11);
    while (nx === prev);
    seq.push(nx);
    prev = nx;
  }
  if (seq[seq.length - 1] === res.n) seq[seq.length - 1] = res.n === 1 ? 2 : res.n - 1;
  seq.push(res.n);
  const caps = ['The cursor starts', 'It hops from tile to tile', 'It speeds up', 'It slows down', 'It hesitates', 'Only a few hops left', 'Almost...', `Number drawn: ${res.n}`];
  return seq.map((cur, k) => ({
    art: code([...grid(cur), '', `Your bet: ${zone.label}`, 'Low 1-3 · Middle 4-7 · High 8-10']),
    caption: caps[k],
    ms: 750 + k * 70,
  }));
};

ANIMS.plinko = (res, ctx) => {
  const path = res.path;
  const c = ctx.c;
  const board = (row, col, ending) => {
    const lines = [];
    for (let r = 0; r <= 8; r++) {
      let line = ' '.repeat(8 - r);
      for (let s = 0; s <= r; s++) {
        const isBall = r === row && s === col;
        line += isBall ? '@' : '.';
        if (s < r) line += ' ';
      }
      // shift so rows are centered: each post is separated by a space
      lines.push(line);
    }
    const slots = range(9).map((s) => (ending && s === col ? '^' : ' ')).join(' ');
    lines.push(range(9).map((s) => String(s + 1)).join(' '));
    lines.push(slots);
    return code(lines);
  };
  const frames = [{ art: board(0, 0, false), caption: 'The ball is dropped', ms: 800 }];
  let col = 0;
  path.forEach((p, k) => {
    col += p;
    frames.push({ art: board(k + 1, col, false), caption: `Bounce ${k + 1}/8 ${p ? 'to the right' : 'to the left'}`, ms: 750 });
  });
  const mult = res.mults[res.bin];
  frames.push({
    art: board(8, res.bin, true) + `Cell **${res.bin + 1}**: ${fx(mult * c)}`,
    caption: `It falls into cell ${res.bin + 1}`,
    ms: 1100,
  });
  return frames;
};

ANIMS.crash = (res) => {
  const crash = Math.min(res.crash, 1000);
  const target = res.target;
  const H = 7;
  const N = 9;
  const maxM = Math.max(crash, target, 2);
  const yOf = (m) => Math.min(H - 1, Math.max(0, Math.round((Math.log(m) / Math.log(maxM)) * (H - 1))));
  const mAt = (k) => Math.max(1, Math.round(Math.pow(crash, k / N) * 100) / 100);
  const targetRow = yOf(target);
  const chart = (k, boom) => {
    const grid = range(H).map(() => Array(N * 2 + 2).fill(' '));
    for (let x = 0; x < N * 2 + 2; x++) grid[H - 1 - targetRow][x] = grid[H - 1 - targetRow][x] === ' ' ? '-' : grid[H - 1 - targetRow][x];
    for (let s = 1; s <= k; s++) {
      const y = yOf(mAt(s));
      grid[H - 1 - y][s * 2] = '*';
    }
    const last = k >= 1 ? yOf(mAt(k)) : 0;
    grid[H - 1 - last][Math.max(1, k * 2) + 1] = boom ? 'X' : '>';
    const lines = grid.map((r) => '|' + r.join(''));
    lines.push('+' + '-'.repeat(N * 2 + 2));
    lines.push(`target x${target} (line -)`);
    return code(lines);
  };
  const frames = [{ art: chart(0, false) + 'Liftoff in 3... 2... 1...', caption: 'Countdown', ms: 1000 }];
  let hit = false;
  for (let k = 1; k <= N; k++) {
    const m = mAt(k);
    let cap = `Multiplier: ${fx(m)}`;
    if (!hit && m >= target && crash >= target) {
      hit = true;
      cap = `Target x${target} reached! (${fx(m)})`;
    }
    frames.push({ art: chart(k, false) + `**${fx(m)}**`, caption: cap, ms: 800 });
  }
  frames.push({
    art: chart(N, true) + `**CRASH at ${fx(crash)}**`,
    caption: res.crash >= target ? `Explosion at ${fx(crash)} : you had taken x${target}` : `Explosion at ${fx(crash)} : too early for your target`,
    ms: 1200,
  });
  return frames;
};

ANIMS.scratch = (res) => {
  const cell = (state, sym) => (state === 0 ? '######' : state === 1 ? '//////' : ` ${padR(sym, 4)} `.slice(0, 6));
  const ticket = (states) =>
    code([
      '.------.------.------.',
      '|' + [0, 1, 2].map((k) => cell(states[k], res.cells[k])).join('|') + '|',
      "'------'------'------'",
      '  Scratch the 3 cells',
    ]);
  const steps = [
    [[0, 0, 0], 'The ticket is ready'],
    [[1, 0, 0], 'You scratch the first cell...'],
    [[2, 0, 0], `First cell: ${res.cells[0]}`],
    [[2, 1, 0], 'You scratch the second cell...'],
    [[2, 2, 0], `Second cell: ${res.cells[1]}`],
    [[2, 2, 1], 'Last slot...'],
    [[2, 2, 2], res.cells[0] === res.cells[1] && res.cells[1] === res.cells[2] ? 'Three matching: WON!' : 'No triple: lost'],
  ];
  return steps.map(([st, cap], k) => ({ art: ticket(st), caption: cap, ms: 800 + (k >= 4 ? 200 : 0) }));
};

ANIMS.chest = (res) => {
  const closed = ['  _____  ', ' |_____| ', ' |__o__| ', ' |_____| '];
  const open = (content) => ['  _____  ', ' /_____\\ ', ` | ${content} | `, ' |_____| '];
  const label = ['    #1   ', '    #2   ', '    #3   '];
  const scene = (chests, mark) =>
    code([...sideBySide(chests, '  '), label.join('  '), range(3).map((k) => (mark === k ? '   ^^^   ' : '         ')).join('  ')]);
  const sym = (k) => (k + 1 === res.win ? 'GEM' : '...');
  const c3 = [closed, closed, closed];
  const chosen = res.want - 1;
  const withOpen = c3.map((cl, k) => (k === chosen ? open(sym(k)) : cl));
  const all = c3.map((_, k) => open(sym(k)));
  return [
    { art: scene(c3, -1), caption: 'Three chests, one treasure', ms: 900 },
    { art: scene(c3, chosen), caption: `You pick chest ${res.want}`, ms: 900 },
    { art: scene(c3, chosen), caption: 'The lock creaks...', ms: 900 },
    { art: scene(withOpen, chosen), caption: res.win === res.want ? 'The lid opens: treasure!' : 'The lid opens: empty...', ms: 1100 },
    { art: scene(all, res.win - 1), caption: `The treasure was in chest ${res.win}`, ms: 1200 },
  ];
};

ANIMS.russian = (res) => {
  const cyl = (rot, firing) => {
    const ch = range(6).map((p) => (res.chambers[(p + rot) % 6] ? '@' : 'o'));
    // positions: top, top-right, bottom-right, bottom, bottom-left, top-left
    return code([
      '           v',
      `          (${ch[0]})`,
      `     (${ch[5]})       (${ch[1]})`,
      `     (${ch[4]})       (${ch[2]})`,
      `          (${ch[3]})`,
      '',
      firing || '   @ = ball   o = empty',
    ]);
  };
  const rots = [0, 2, 4, 1, 3, 5, 2, 4];
  const caps = ['The cylinder is loaded', 'You spin it', 'It spins fast', 'Even faster', 'It slows down', 'It slows further', 'Almost stopped', 'It stops'];
  const frames = rots.map((r, k) => ({ art: cyl(r), caption: caps[k], ms: 750 + k * 60 }));
  frames.push({ art: cyl(0, '   The hammer is cocked...'), caption: 'You pull the trigger', ms: 1300 });
  frames.push({
    art: cyl(0, res.dead ? '   >>> BANG <<<' : '   ...clic.'),
    caption: res.dead ? 'BANG! The bullet was there' : 'Click: the chamber was empty',
    ms: 1200,
  });
  return frames;
};

ANIMS.horses = (res) => {
  const Ln = 22;
  const finals = HORSES.map((_, k) => (k === res.winner ? Ln : Ln - randomInt(1, 4) - k % 2));
  const T = 7;
  const positions = [];
  let prev = Array(5).fill(0);
  for (let tt = 1; tt <= T; tt++) {
    const cur = finals.map((f, k) => {
      const target = Math.round((f * tt) / T) + randomInt(-2, 3);
      return Math.min(f - (tt < T ? 1 : 0), Math.max(prev[k], target));
    });
    prev = cur;
    positions.push(cur);
  }
  positions[T - 1] = finals.slice();
  const lane = (k, p) => {
    const mark = k === res.want ? '*' : ' ';
    const before = '.'.repeat(Math.max(0, p));
    const after = ' '.repeat(Math.max(0, Ln - p));
    return `${k + 1}${mark}|${before}=>${after}|`;
  };
  const track = (pos, flag) => code([...pos.map((p, k) => lane(k, p)), '', flag || `* = your horse (#${res.want + 1})`]);
  const caps = ['Horses are in the gates', 'They are off!', 'The pack forms', 'A battle up front', 'Down the home stretch', 'Final sprint', 'Photo finish...'];
  const frames = [{ art: track(Array(5).fill(0), "At the starter's command..."), caption: 'Horses are in the gates', ms: 900 }];
  positions.forEach((pos, k) => frames.push({ art: track(pos), caption: caps[Math.min(k + 1, caps.length - 1)], ms: 800 }));
  frames.push({ art: track(finals, `Winner: horse #${res.winner + 1}`), caption: `Horse #${res.winner + 1} crosses the line first`, ms: 1200 });
  return frames;
};

// Simple animations for the new games
ANIMS.limbo = (res) => {
  const steps = 8;
  const frames = [];
  for (let k = 1; k <= steps; k++) {
    const m = Math.max(1, Math.round(Math.pow(res.peak, k / steps) * 100) / 100);
    const bar = '█'.repeat(Math.min(20, Math.floor(m * 2))) + '░'.repeat(Math.max(0, 20 - Math.floor(m * 2)));
    frames.push({
      art: code([`  ${bar}`, `  x${m.toFixed(2)}`, '', `  Target: x${res.target}`]),
      caption: m >= res.target ? 'Target exceeded!' : 'Climbing...',
      ms: 700,
    });
  }
  frames.push({
    art: code([`  PEAK: x${Math.min(res.peak, 1000).toFixed(2)}`, `  Target: x${res.target}`]),
    caption: res.peak >= res.target ? 'Target cleared!' : 'Too low',
    ms: 1100,
  });
  return frames;
};

ANIMS.higher = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?]', '', '  Reference card...']), caption: 'Drawing the reference', ms: 900 },
    { art: code([`  [${ranks[res.a]}]`, '', '  Reference placed']), caption: `Reference: ${ranks[res.a]}`, ms: 1000 },
    { art: code([`  [${ranks[res.a]}]  →  [?]`, '', '  The next one flips...']), caption: 'Suspense', ms: 1000 },
    { art: code([`  [${ranks[res.a]}]  →  [${ranks[res.b]}]`]), caption: `Next: ${ranks[res.b]}`, ms: 1100 },
  ];
};

ANIMS.rps = (res) => {
  const names = { rock: '✊', paper: '✋', scissors: '✌️' };
  return [
    { art: code(['  1...']), caption: 'Pierre', ms: 700 },
    { art: code(['  2...']), caption: 'Papier', ms: 700 },
    { art: code(['  3...']), caption: 'Ciseaux', ms: 700 },
    { art: code([`  You ${names[res.detail.split(' vs ')[0]]}  ·  Bot ${names[res.bot]}`]), caption: 'Result', ms: 1200 },
  ];
};

ANIMS.colorpick = (res) => {
  const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡' };
  const order = ['red', 'blue', 'green', 'yellow'];
  return order.map((c, k) => ({
    art: code([`  ${em[c]}`, '', '  The colors spin...']),
    caption: 'Shuffle',
    ms: 600 + k * 50,
  })).concat([
    { art: code([`  ${em[res.out]}`, '', `  Color drawn`]), caption: 'Result', ms: 1100 },
  ]);
};

ANIMS.ladder = (res) => {
  const frames = [];
  for (let k = 0; k <= res.reached; k++) {
    const steps = Array.from({ length: 5 }, (_, i) => (i < k ? '▓▓' : i === k ? '██' : '░░')).reverse();
    frames.push({
      art: code(['  LADDER', ...steps.map((s, i) => `  ${5 - i} ${s}`)]),
      caption: k === 0 ? 'Start' : `Step ${k}`,
      ms: 750,
    });
  }
  frames.push({
    art: code([`  Reached: tier ${res.reached}`, `  Target: tier ${res.want}`]),
    caption: res.reached >= res.want ? 'Goal reached!' : 'Fall',
    ms: 1100,
  });
  return frames;
};

ANIMS.keno = (res) => {
  const frames = [];
  for (let k = 0; k < 6; k++) {
    const n = randomInt(1, 11);
    frames.push({ art: code([`  [ ${n} ]`]), caption: 'Numbers rolling', ms: 600 });
  }
  frames.push({ art: code([`  [ ${res.n} ]`]), caption: `Number drawn: ${res.n}`, ms: 1100 });
  return frames;
};

ANIMS.war = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?]     [?]']), caption: 'Cards dealt', ms: 900 },
    { art: code([`  [${ranks[res.me]}]     [?]`]), caption: 'Your card', ms: 1000 },
    { art: code([`  [${ranks[res.me]}]     [${ranks[res.dealer]}]`]), caption: 'Dealer card', ms: 1100 },
  ];
};

ANIMS.hilo = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const frames = [];
  for (let k = 1; k <= 3; k++) {
    frames.push({
      art: code([`  ${res.cards.slice(0, k).map((c) => ranks[c]).join(' · ')}`]),
      caption: `Card ${k}/3`,
      ms: 900,
    });
  }
  return frames;
};

ANIMS.bingo = (res) => {
  const frames = [];
  for (let k = 0; k < 5; k++) {
    frames.push({ art: code([`  Cell ${randomInt(1, 6)}`]), caption: 'The ball is spinning...', ms: 600 });
  }
  frames.push({ art: code([`  Cell ${res.n}`]), caption: `Ball in cell ${res.n}`, ms: 1100 });
  return frames;
};

ANIMS.jackpot = (res) => {
  const syms = ['🍒', '🍋', '💎', '7️⃣', '⭐'];
  const frames = [];
  for (let k = 0; k < 5; k++) {
    frames.push({
      art: code([`  [ ${syms[randomInt(0, 5)]} | ${syms[randomInt(0, 5)]} | ${syms[randomInt(0, 5)]} ]`]),
      caption: 'The reels spin',
      ms: 700,
    });
  }
  frames.push({
    art: code([`  [ ${res.a} | ${res.b} | ${res.c} ]`]),
    caption: 'Result',
    ms: 1200,
  });
  return frames;
};

// Animations for the 30 new games
ANIMS.dicewar = (res) => {
  const r = () => randomInt(1, 7);
  return [
    { art: code(sideBySide([dieLines(r()), dieLines(r())], '   ')), caption: 'Dice roll', ms: 700 },
    { art: code(sideBySide([dieLines(r()), dieLines(r())], '   ')), caption: 'Rebond', ms: 700 },
    { art: code(sideBySide([dieLines(res.me), dieLines(r())], '   ')), caption: `Your die: ${res.me}`, ms: 900 },
    { art: code(sideBySide([dieLines(res.me), dieLines(res.dealer)], '   ')), caption: `Dealer: ${res.dealer}`, ms: 1100 },
  ];
};
ANIMS.coinladder = (res) => {
  const frames = [{ art: code(['  Coin ready...']), caption: 'Ladder start', ms: 700 }];
  const flips = (res.detail || '').split('');
  flips.forEach((f, k) => {
    frames.push({ art: code([`  ${f === 'P' ? 'PILE' : 'FACE'}`, '', `  Streak: ${k + 1}/${res.need}`]), caption: f === 'P' ? 'Heads!' : 'Tails...', ms: 800 });
  });
  frames.push({ art: code([`  Result: ${flips.join(' · ')}`]), caption: res.streak >= res.need ? 'Ladder cleared!' : 'Ladder broken', ms: 1100 });
  return frames;
};
ANIMS.cardmatch = (res) => [
  { art: code(['  [?] [?] [?] [?]']), caption: 'Cards shuffled', ms: 800 },
  { art: code(['  Cards are shuffling...']), caption: 'Shuffle', ms: 900 },
  { art: code([`  Secret revealed: ${res.secret.r}${res.secret.s}`]), caption: 'Secret card', ms: 1000 },
  { art: code([`  Drawn: ${res.pickCard.r}${res.pickCard.s}`]), caption: 'Your card', ms: 1100 },
];
ANIMS.numguess = (res) => {
  const frames = [];
  for (let k = 0; k < 6; k++) frames.push({ art: code([`  [ ${randomInt(1, 11)} ]`]), caption: 'Numbers rolling', ms: 550 });
  frames.push({ art: code([`  [ ${res.n} ]`]), caption: `Draw: ${res.n}`, ms: 1100 });
  return frames;
};
ANIMS.bombdefuse = (res) => [
  { art: code(['  💣  3...']), caption: 'Countdown', ms: 800 },
  { art: code(['  💣  2...']), caption: 'Countdown', ms: 800 },
  { art: code(['  💣  1...']), caption: 'Countdown', ms: 800 },
  { art: code([res.good === res.want ? '  ✅ Defused' : '  💥 BOOM']), caption: res.good === res.want ? 'Right wire!' : `Wrong wire (right = ${res.good})`, ms: 1200 },
];
ANIMS.treasure = (res) => {
  const frames = [];
  for (let k = 1; k <= 5; k++) {
    frames.push({ art: code([`  Cell ${k}: ${k === res.win ? '💎' : '🕳️'}`]), caption: 'Dig', ms: 600 });
  }
  frames.push({ art: code([`  Treasure in spot ${res.win}`]), caption: 'Result', ms: 1100 });
  return frames;
};
ANIMS.highcard = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?]']), caption: 'Face-down card', ms: 800 },
    { art: code(['  [...]']), caption: 'Flipping...', ms: 900 },
    { art: code([`  [${ranks[res.v]}]`]), caption: `Card: ${ranks[res.v]}`, ms: 1100 },
  ];
};
ANIMS.lowcard = ANIMS.highcard;
ANIMS.pairmatch = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?]  [?]' ]), caption: 'Deux cartes', ms: 800 },
    { art: code([`  [${ranks[res.a]}]  [?]`]), caption: 'First card', ms: 900 },
    { art: code([`  [${ranks[res.a]}]  [${ranks[res.b]}]`]), caption: 'Second card', ms: 1100 },
  ];
};
ANIMS.freefall = (res) => [
  { art: code(['  🪂', '  |', '  |', '  v']), caption: 'Saut !', ms: 800 },
  { art: code(['  🪂', '  |', '  v']), caption: 'Fall...', ms: 800 },
  { art: code(['  🪂', '  v']), caption: 'Approaching the ground', ms: 800 },
  { art: code([res.ok ? '  ✅ Landed' : '  💥 Crash']), caption: res.ok ? 'Zone reached' : 'Missed', ms: 1100 },
];
ANIMS.balloon = (res) => {
  const frames = [];
  for (let k = 1; k <= res.need; k++) {
    frames.push({ art: code([`  ${'O'.repeat(k + 2)}`, `  Level ${k}`]), caption: 'Inflating...', ms: 700 });
  }
  frames.push({ art: code([res.ok ? '  🎈 Intact' : '  💥 Popped']), caption: res.ok ? 'Success' : 'Overinflated', ms: 1100 });
  return frames;
};
ANIMS.target = (res) => [
  { art: code(['  →']), caption: 'Aiming', ms: 700 },
  { art: code(['    →']), caption: 'Lancer', ms: 700 },
  { art: code(['      →']), caption: 'Flight', ms: 700 },
  { art: code([`  Impact: ${res.hit}`]), caption: 'Result', ms: 1100 },
];
ANIMS.sequence = (res) => [
  { art: code([`  ${res.a}  ?  ?`]), caption: 'Premier chiffre', ms: 800 },
  { art: code([`  ${res.a}  ${res.b}  ?`]), caption: 'Second', ms: 800 },
  { art: code([`  ${res.a}  ${res.b}  ${res.c}`]), caption: res.ok ? 'STRAIGHT!' : 'No straight', ms: 1100 },
];
ANIMS.animalrace = (res) => {
  const names = { a1: '🐰', a2: '🦊', a3: '🐺', a4: '🦅' };
  const frames = [];
  for (let k = 0; k < 5; k++) {
    frames.push({ art: code(Object.values(names).map((e, i) => `${e} ${'.'.repeat(randomInt(1, 8))}`)), caption: 'Course en cours', ms: 700 });
  }
  frames.push({ art: code([`  Winner: ${res.winner.name}`]), caption: 'Finish', ms: 1200 });
  return frames;
};
ANIMS.fruitmatch = (res) => {
  const fruits = ['🍎', '🍌', '🍇', '🍊', '🍓'];
  const frames = [];
  for (let k = 0; k < 5; k++) {
    frames.push({ art: code([`  [ ${fruits[randomInt(0, 5)]} | ${fruits[randomInt(0, 5)]} | ${fruits[randomInt(0, 5)]} ]`]), caption: 'Rouleaux', ms: 650 });
  }
  frames.push({ art: code([`  [ ${res.a} | ${res.b} | ${res.c} ]`]), caption: 'Result', ms: 1100 });
  return frames;
};
ANIMS.gemhunt = (res) => {
  const frames = [];
  for (let k = 1; k <= 6; k++) {
    frames.push({ art: code([`  Roche ${k} ${k === res.win ? '💎' : '🪨'}`]), caption: 'Fouille', ms: 550 });
  }
  frames.push({ art: code([`  Gem in rock ${res.win}`]), caption: 'Found', ms: 1100 });
  return frames;
};
ANIMS.stardrop = (res) => [
  { art: code(['  ⭐', '    \\', '     \\']), caption: 'Shooting star', ms: 800 },
  { art: code(['     ⭐', '    /', '   /']), caption: 'It crosses', ms: 800 },
  { art: code([res.falls ? '  ⭐ on the ground' : '  ⭐ vanished']), caption: res.falls ? 'It fell' : 'It keeps going', ms: 1100 },
];
ANIMS.moonshot = (res) => [
  { art: code(['  🚀', '  |', '  |']), caption: 'Liftoff', ms: 800 },
  { art: code(['  🚀', '  |']), caption: 'Climb', ms: 800 },
  { art: code(['  🚀']), caption: 'Espace', ms: 800 },
  { art: code([res.ok ? '  🌙 Target reached' : '  💥 Failure']), caption: res.ok ? 'Success' : 'Return', ms: 1100 },
];
ANIMS.volcano = (res) => [
  { art: code(['  🌋', '  ~ ~']), caption: 'The volcano rumbles', ms: 800 },
  { art: code(['  🌋', '  ~~~']), caption: 'Heating up', ms: 800 },
  { art: code(['  🌋💥', '  ~~~~']), caption: `Eruption zone ${res.eruption}`, ms: 1100 },
];
ANIMS.lightning = (res) => [
  { art: code(['  ☁️ ☁️', '   ~']), caption: 'Nuages', ms: 800 },
  { art: code(['  ☁️☁️☁️', '  ~ ~']), caption: 'Storm approaching', ms: 800 },
  { art: code([res.strike ? '  ⚡ BOOM' : '  ☁️ ...']), caption: res.strike ? 'Lightning!' : 'Storm passes', ms: 1100 },
];
ANIMS.pokerhand = (res) => {
  const names = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?] [?] [?]' ]), caption: 'Distribution', ms: 800 },
    { art: code([`  [${names[res.ranks[0]]}] [?] [?]`]), caption: 'Card 1', ms: 800 },
    { art: code([`  [${names[res.ranks[0]]}] [${names[res.ranks[1]]}] [?]`]), caption: 'Card 2', ms: 800 },
    { art: code([`  [${names[res.ranks[0]]}] [${names[res.ranks[1]]}] [${names[res.ranks[2]]}]`]), caption: res.max >= 3 ? 'Three of a kind!' : res.max >= 2 ? 'Pair' : 'Nothing', ms: 1100 },
  ];
};
ANIMS.redblack = (res) => [
  { art: code(['  [?]']), caption: 'Hidden card', ms: 800 },
  { art: code(['  [...]']), caption: 'Returnnement', ms: 900 },
  { art: code([`  ${res.col === 'red' ? '🔴 RED' : '⚫ BLACK'}`]), caption: 'Color', ms: 1100 },
];
ANIMS.oddseven = (res) => {
  const r = () => randomInt(1, 7);
  return [
    { art: code(dieLines(r())), caption: 'The die rolls', ms: 700 },
    { art: code(dieLines(r())), caption: 'Rebond', ms: 700 },
    { art: code(dieLines(res.n)), caption: `Result: ${res.n}`, ms: 1100 },
  ];
};
ANIMS.multiplier = (res) => {
  const frames = [];
  for (let k = 0; k < 6; k++) {
    const m = [1.5, 2, 3, 5][randomInt(0, 4)];
    frames.push({ art: code([`  x${m}`]), caption: 'Multipliers', ms: 600 });
  }
  frames.push({ art: code([`  Target ${res.pick}`]), caption: res.ok ? 'Cleared!' : 'Missed', ms: 1100 });
  return frames;
};
ANIMS.memory = (res) => [
  { art: code(['  [?] [?] [?] [?]' ]), caption: 'Hidden cards', ms: 800 },
  { art: code(['  Flipping...']), caption: 'Memory', ms: 900 },
  { art: code([`  ${res.detail.replace('-', ' and ')}`]), caption: res.ok ? 'Pair!' : 'No pair', ms: 1100 },
];
ANIMS.colorswipe = (res) => {
  const cols = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'];
  const frames = cols.map((e) => ({ art: code([`  ${e}`]), caption: 'Rainbow', ms: 500 }));
  const em = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣' };
  frames.push({ art: code([`  ${em[res.out]}`]), caption: 'Color drawn', ms: 1100 });
  return frames;
};
ANIMS.rocket2 = (res) => {
  const steps = 8;
  const frames = [];
  for (let k = 1; k <= steps; k++) {
    const m = Math.max(1, Math.round(Math.pow(Math.min(res.peak, 100), k / steps) * 100) / 100);
    frames.push({ art: code([`  🚀 x${m.toFixed(2)}`, `  Target ${res.pick}`]), caption: 'Climb', ms: 650 });
  }
  frames.push({ art: code([`  Peak x${Math.min(res.peak, 500).toFixed(2)}`]), caption: res.peak >= res.t ? 'Target cleared!' : 'Too low', ms: 1100 });
  return frames;
};
ANIMS.diceexact2 = (res) => {
  const r = () => randomInt(1, 7);
  return [
    { art: code(sideBySide([dieLines(r()), dieLines(r())], '   ')), caption: 'Lancer', ms: 700 },
    { art: code(sideBySide([dieLines(r()), dieLines(r())], '   ')), caption: 'Roulement', ms: 700 },
    { art: code(sideBySide([dieLines(res.a), dieLines(res.b)], '   ')), caption: `${res.a}+${res.b}=${res.sum}`, ms: 1100 },
  ];
};
ANIMS.chest2 = (res) => [
  { art: code(['  📦  📦  📦']), caption: 'Trois coffres', ms: 800 },
  { art: code(['  Ouverture...']), caption: 'Suspense', ms: 900 },
  { art: code([`  ${[1, 2, 3].map((k) => (k === res.win ? '💎' : '💨')).join('  ')}`]), caption: 'Contenu', ms: 1100 },
];
ANIMS.spincolor = (res) => {
  const cols = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
  const frames = [];
  for (let k = 0; k < 8; k++) {
    frames.push({ art: code([`  ${cols[k % 6]}`]), caption: 'The wheel spins', ms: 500 });
  }
  const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', purple: '🟣', orange: '🟠' };
  frames.push({ art: code([`  ${em[res.out]}`]), caption: 'Stop', ms: 1100 });
  return frames;
};


// ============================================================
//  ZNK VISUELS v2  (display only: no odds, no payout, no Z-Tokens touched)
//  Immersive scenes in emojis / code blocks. The old ANIMS above
//  are replaced here with illustrated versions (same `res` fields).
// ============================================================
const vhash = (a, b) => (((a | 0) * 73856093) ^ ((b | 0) * 19349663)) >>> 0;
const vBG = '⬛';
const vRank = (v) => RANKS[Math.max(1, Math.min(13, Number(v) || 1)) - 1];
const vCard = (v, salt = 0) => ({ r: vRank(v), s: SUITS[(Number(v) + salt + 4) % 4] });
const vBar = (ratio, n = 10) => {
  const f = Math.max(0, Math.min(n, Math.round(ratio * n)));
  return '▰'.repeat(f) + '▱'.repeat(n - f);
};

// ---------- Space: starry backdrop, planets, rocket, flames, trail ----------
function spaceScene({ cols = 9, rows = 7, scroll = 0, rocket = null, planets = [], ground = false, boom = false, smoke = false, flame = false, sparks = false }) {
  const g = range(rows).map(() => Array(cols).fill(vBG));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = vhash(r - scroll, c + 3);
      if (h % 11 === 0) g[r][c] = '✨';
      else if (h % 29 === 1) g[r][c] = '🌟';
    }
  }
  for (const p of planets) {
    const r = p.y + scroll;
    if (r >= 0 && r < rows && p.c >= 0 && p.c < cols) g[r][p.c] = p.e;
  }
  if (ground) for (let c = 0; c < cols; c++) g[rows - 1][c] = '🟪';
  if (rocket) {
    const { r, c } = rocket;
    if (boom) {
      g[r][c] = '💥';
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) g[rr][cc] = sparks ? '✨' : '🔥';
      }
      if (sparks) for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) g[rr][cc] = '☄️';
      }
    } else {
      g[r][c] = '🚀';
      if (flame) {
        ['🔥', '🟠', '🟣'].forEach((e, i) => {
          const rr = r + 1 + i, cc = c - 1 - i;
          if (rr < rows && cc >= 0 && !(ground && rr === rows - 1 && i > 0)) g[rr][cc] = e;
        });
      }
    }
    if (smoke) for (const dc of [-1, 1]) if (c + dc >= 0 && c + dc < cols && r + 1 < rows) g[r + 1][c + dc] = '☁️';
  }
  return g.map((row) => row.join('')).join('\n') + '\n';
}

const V_PLANETS = [
  { e: '🪐', c: 7, y: -1 }, { e: '🌕', c: 1, y: -4 }, { e: '☄️', c: 6, y: -7 },
  { e: '🌍', c: 2, y: -10 }, { e: '🪐', c: 0, y: -13 }, { e: '🌠', c: 7, y: -16 },
];

// Rocket climb with multiplier. Visual only: values come from `res`.
function rocketFrames({ peak, target = null, N = 8, endTitle, endCap, success, finalMoon = false }) {
  const COLS = 9, ROWS = 7;
  const P = Math.max(1.01, Math.min(Number(peak) || 1.01, 1000));
  const T = target && target > 1 ? target : null;
  const mAt = (k) => Math.max(1, Math.round(Math.pow(P, k / N) * 100) / 100);
  const pos = (k) => {
    const p = k / N;
    return { r: Math.round(ROWS - 2 - (ROWS - 3) * Math.min(1, p / 0.55)), c: 1 + Math.round(p * (COLS - 3)) };
  };
  const targetLine = (m) => {
    if (!T) return '';
    const ok = m >= T;
    return `\n${ok ? '✅' : '🎯'} Target **x${T}**  ${vBar(Math.log(Math.max(1, m)) / Math.log(T))}`;
  };
  const frames = [];
  const pad = { r: ROWS - 2, c: 1 };
  ['3️⃣', '2️⃣', '1️⃣'].forEach((n, i) => {
    frames.push({
      art: spaceScene({ cols: COLS, rows: ROWS, rocket: pad, ground: true, smoke: i >= 1 }) + `## ${n} …${targetLine(1)}`,
      caption: i === 0 ? 'Countdown' : i === 1 ? 'Engines ignite' : 'Ignition',
      ms: 900,
    });
  });
  frames.push({
    art: spaceScene({ cols: COLS, rows: ROWS, rocket: pad, ground: true, smoke: true, flame: true }) + `## 🔥 LIFTOFF!${targetLine(1)}`,
    caption: 'Liftoff',
    ms: 850,
  });
  let hit = false;
  for (let k = 1; k <= N; k++) {
    const m = mAt(k);
    let cap = `Multiplier: x${m.toFixed(2)}`;
    if (!hit && T && m >= T && P >= T) {
      hit = true;
      cap = `Target x${T} reached! (x${m.toFixed(2)})`;
    }
    const last = k === N;
    if (last && finalMoon) break;
    frames.push({
      art: spaceScene({ cols: COLS, rows: ROWS, scroll: k, rocket: pos(k), planets: V_PLANETS, flame: true }) + `## 🚀 x${m.toFixed(2)}${targetLine(m)}`,
      caption: cap,
      ms: 750,
    });
  }
  const end = pos(finalMoon ? N - 1 : N);
  if (finalMoon) {
    const g = spaceScene({ cols: COLS, rows: ROWS, scroll: N, rocket: { r: 1, c: COLS - 3 }, planets: [{ e: '🌕', c: COLS - 2, y: -N }], flame: true, boom: !success, sparks: !success });
    frames.push({ art: g + `## ${success ? '🌙 LANDING!' : '💥 FAILURE'}`, caption: endCap, ms: 1300 });
    return frames;
  }
  frames.push({ art: spaceScene({ cols: COLS, rows: ROWS, scroll: N, rocket: end, planets: V_PLANETS, boom: true }) + `## 💥 BOOM x${P.toFixed(2)}${targetLine(P)}`, caption: 'Explosion !', ms: 900 });
  frames.push({ art: spaceScene({ cols: COLS, rows: ROWS, scroll: N + 1, rocket: end, planets: V_PLANETS, boom: true, sparks: true }) + `## ${endTitle}${targetLine(P)}`, caption: endCap, ms: 1300 });
  return frames;
}

ANIMS.crash = (res) =>
  rocketFrames({
    peak: res.crash,
    target: res.target,
    endTitle: `💀 CRASH at ${fx(Math.min(res.crash, 1000))}`,
    endCap: res.crash >= res.target ? `Explosion at ${fx(Math.min(res.crash, 1000))} : you had taken x${res.target}` : `Explosion at ${fx(Math.min(res.crash, 1000))} : too early for your target`,
  });
ANIMS.limbo = (res) =>
  rocketFrames({
    peak: res.peak,
    target: res.target,
    N: 8,
    endTitle: `PEAK x${Math.min(res.peak, 1000).toFixed(2)}`,
    endCap: res.peak >= res.target ? 'Target cleared!' : 'Too low',
  });
ANIMS.rocket2 = (res) =>
  rocketFrames({
    peak: Math.min(res.peak, 100),
    target: res.t,
    N: 8,
    endTitle: `PEAK x${Math.min(res.peak, 500).toFixed(2)}`,
    endCap: res.peak >= res.t ? 'Target cleared!' : 'Too low',
  });
ANIMS.moonshot = (res) =>
  rocketFrames({ peak: 12, N: 7, finalMoon: true, success: !!res.ok, endCap: res.ok ? 'Target reached: the Moon!' : "The rocket didn't hold" });

// ---------- Slot machines: colorful reels, flashing lights ----------
const slotEmoji = (s) => (SLOT_SYMBOLS.find((x) => x.s === s) || {}).e || '❔';
function slotBoard({ cols, locked, f, lights = null, text = '' }) {
  const lamp = (n) => {
    if (lights) return lights.repeat(n + 2);
    const pat = f % 2 ? ['🟡', '🟣'] : ['🟣', '🟡'];
    return range(n + 2).map((k) => pat[k % 2]).join('');
  };
  const n = cols.length;
  const row = (r, mid) => (mid ? '▶️' : '🟪') + cols.map((c) => c[r]).join('') + (mid ? '◀️' : '🟪');
  const st = '🟪' + locked.map((l) => (l ? '🔒' : '🌀')).join('') + '🟪';
  return [lamp(n), row(0, false), row(1, true), row(2, false), st, lamp(n)].join('\n') + '\n' + text;
}
function slotFrames(finals, pool, kind) {
  const rnd = () => pool[randomInt(0, pool.length)];
  const around = finals.map(() => [rnd(), rnd()]);
  const stopAt = [3, 5, 7];
  const caps = { 1: 'Reels start', 2: 'They spin at full speed', 3: 'Reel 1 locked', 4: 'The other two still spin', 5: 'Reel 2 locked', 6: 'Last reel...', 7: 'Reel 3 locked' };
  const frames = [];
  for (let f = 1; f <= 7; f++) {
    const locked = [0, 1, 2].map((k) => f >= stopAt[k]);
    const cols = [0, 1, 2].map((k) => (locked[k] ? [around[k][0], finals[k], around[k][1]] : [rnd(), rnd(), rnd()]));
    frames.push({ art: slotBoard({ cols, locked, f, text: f >= 6 ? '## 🎰 …' : '## 🎰 ✦ ✦ ✦' }), caption: caps[f], ms: 800 });
  }
  const cols = [0, 1, 2].map((k) => [around[k][0], finals[k], around[k][1]]);
  frames.push({ art: slotBoard({ cols, locked: [true, true, true], f: 0, lights: kind.lights, text: kind.text }), caption: kind.cap, ms: 1200 });
  return frames;
}
ANIMS.slots = (res) => {
  const pool = SLOT_SYMBOLS.map((x) => x.e);
  const finals = res.reels.map((r) => slotEmoji(r.s));
  const raw = res.reels.map((r) => r.s);
  const triple = raw[0] === raw[1] && raw[1] === raw[2];
  const two = raw.filter((s) => s === 'CER').length === 2;
  const jack = triple && raw[0] === ' 7 ';
  return slotFrames(finals, pool, {
    lights: triple || two ? '🟡' : '🟣',
    text: jack ? '## 🎆 JACKPOT 7️⃣7️⃣7️⃣ 🎆' : triple ? '## 🎉 THREE MATCHING 🎉' : two ? '## 🍒🍒 TWO CHERRIES' : '## 🌑 No win',
    cap: triple ? (jack ? 'JACKPOT!' : 'Winning combination!') : two ? 'Two cherries!' : 'No combination',
  });
};
ANIMS.jackpot = (res) => {
  const pool = ['🍒', '🍋', '💎', '7️⃣', '⭐'];
  const f = [res.a, res.b, res.c];
  const win = f[0] === f[1] && f[1] === f[2];
  return slotFrames(f, pool, { lights: win ? '🟡' : '🟣', text: win ? '## 🎆 JACKPOT 🎆' : '## 🌑 Nothing this time', cap: win ? 'Jackpot!' : 'Result' });
};
ANIMS.fruitmatch = (res) => {
  const pool = ['🍎', '🍌', '🍇', '🍊', '🍓'];
  const f = [res.a, res.b, res.c];
  const win = new Set(f).size < 3;
  return slotFrames(f, pool, { lights: win ? '🟡' : '🟣', text: win ? '## 🍓 MIXED FRUITS 🍓' : '## 🌑 No mix', cap: win ? 'Mixed fruits!' : 'Result' });
};

// ---------- Illustrated cards + dealing ----------
const vFlip = () => ['  ╭─╮  ', '  │▒│  ', '  │▒│  ', '  │▒│  ', '  ╰─╯  '];
const vPad = (lines, n) => lines.map((l) => ' '.repeat(n) + l);
// states: array of 'hidden' | 'flip' | card {r,s}
function cardRow(states, gap = ' ') {
  const blocks = states.map((s) => (s === 'hidden' ? cardLines(null, true) : s === 'flip' ? vFlip() : cardLines(s, false)));
  return sideBySide(blocks, gap);
}
// Deal (slides in from the right) then flip the cards one by one.
function dealAndReveal(cards, { labels = null, caps = {}, endCap = '', gap = ' ', extra = [] } = {}) {
  const n = cards.length;
  const label = labels ? [labels.map((l) => padR(l, 7)).join(gap)] : [];
  const frame = (states, cap, ms, pad = 0) => ({ art: code([...vPad([...label, ...cardRow(states, gap)], pad), ...extra]), caption: cap, ms });
  const frames = [
    frame(range(n).map(() => 'hidden'), caps.shuffle || 'Dealer shuffles the deck', 800, 14),
    frame(range(n).map(() => 'hidden'), caps.deal || 'Dealing cards', 800, 7),
    frame(range(n).map(() => 'hidden'), caps.table || 'Cards are dealt', 850, 0),
  ];
  const st = range(n).map(() => 'hidden');
  for (let k = 0; k < n; k++) {
    st[k] = 'flip';
    frames.push(frame([...st], caps.flip || 'Flipping...', 700));
    st[k] = cards[k];
    const last = k === n - 1;
    frames.push(frame([...st], last ? endCap : (caps.reveal ? caps.reveal(k, cards[k]) : `Card ${k + 1}: ${cards[k].r}${cards[k].s}`), last ? 1200 : 900));
  }
  return frames;
}

ANIMS.duel = (res) => {
  const f = dealAndReveal([res.me, res.dealer], {
    labels: ['  YOU  ', ' BANK'],
    gap: '     ',
    caps: { reveal: (k, c) => (k === 0 ? `Your card: ${c.r}${c.s}` : '') },
    endCap: res.me.v > res.dealer.v ? 'Your card is higher: WIN' : res.me.v === res.dealer.v ? 'Tie: lost' : 'The dealer card is higher: LOSS',
  });
  return f;
};
ANIMS.war = (res) =>
  dealAndReveal([vCard(res.me, 1), vCard(res.dealer, 2)], {
    labels: ['  YOU  ', ' BANK'],
    gap: '     ',
    caps: { reveal: (k, c) => (k === 0 ? `Your card: ${c.r}` : '') },
    endCap: res.me > res.dealer ? 'Your card wins' : res.me === res.dealer ? 'War: tie' : 'The dealer card wins',
  });
ANIMS.higher = (res) =>
  dealAndReveal([vCard(res.a, 0), vCard(res.b, 2)], {
    labels: [' REF   ', ' SUIV. '],
    gap: '  ',
    caps: { reveal: (k, c) => `Reference: ${c.r}` },
    endCap: `Next: ${vRank(res.b)}`,
  });
ANIMS.hilo = (res) =>
  dealAndReveal(res.cards.slice(0, 3).map((v, k) => vCard(v, k)), {
    caps: { reveal: (k, c) => `Card ${k + 1}/3: ${c.r}` },
    endCap: 'All 3 cards are flipped',
  });
ANIMS.highcard = (res) => dealAndReveal([vCard(res.v, 1)], { endCap: `Card: ${vRank(res.v)}` });
ANIMS.lowcard = ANIMS.highcard;
ANIMS.pairmatch = (res) =>
  dealAndReveal([vCard(res.a, 0), vCard(res.b, 1)], {
    caps: { reveal: () => 'First card' },
    endCap: res.a === res.b ? 'A pair!' : 'Second card',
  });
ANIMS.pokerhand = (res) =>
  dealAndReveal(res.ranks.slice(0, 3).map((v, k) => vCard(v, k)), {
    caps: { reveal: (k, c) => `Card ${k + 1}: ${c.r}` },
    endCap: res.max >= 3 ? 'Three of a kind!' : res.max >= 2 ? 'Pair' : 'Nothing',
  });
ANIMS.redblack = (res) => {
  const card = res.col === 'red' ? { r: RANKS[randomInt(0, 13)], s: randomInt(0, 2) ? '♥' : '♦' } : { r: RANKS[randomInt(0, 13)], s: randomInt(0, 2) ? '♠' : '♣' };
  return dealAndReveal([card], { extra: [], endCap: res.col === 'red' ? '🔴 RED' : '⚫ BLACK' });
};
ANIMS.cardmatch = (res) =>
  dealAndReveal([res.secret, res.pickCard], {
    labels: ['SECRETE', ' TIREE '],
    gap: '  ',
    caps: { reveal: (k, c) => `Secret card: ${c.r}${c.s}` },
    endCap: `Your card : ${res.pickCard.r}${res.pickCard.s}`,
  });
ANIMS.memory = (res) => {
  const [a, b] = String(res.detail).split('-').map((x) => (Number(x) === 1 ? { r: 'A', s: '♥' } : { r: 'K', s: '♠' }));
  const hid = ['hidden', 'hidden', 'hidden', 'hidden'];
  const mk = (states, cap, ms) => ({ art: code(cardRow(states, ' ')), caption: cap, ms });
  return [
    mk(hid, 'Quatre cartes, deux paires', 850),
    mk(['flip', 'hidden', 'hidden', 'hidden'], 'You flip the first...', 750),
    mk([a, 'hidden', 'hidden', 'hidden'], `First card: ${a.r}`, 900),
    mk([a, 'flip', 'hidden', 'hidden'], 'Then the second...', 750),
    mk([a, b, 'hidden', 'hidden'], res.ok ? 'Pair!' : 'No pair', 1200),
  ];
};
ANIMS.suit = (res, ctx) => {
  const order = SUITS;
  const cell = (s, center) => (center ? `[ ${s} ]` : `  ${s}  `);
  const pos = stripPositions(order.indexOf(res.card.s), [4, 3, 3, 2, 1, 1]);
  const want = SUIT_CHOICES[ctx.choice];
  const frames = pos.map((p, k) => ({
    art: code([...stripArt(order, p, cell, 3), '', `Your pick: ${want}`]),
    caption: ['Dealer shuffles the deck', 'Suits flash by', 'Slowing down', 'Almost...', 'One more notch', `Suit drawn: ${res.card.s}`][k] || '...',
    ms: 800 + k * 80,
  }));
  frames.push({ art: code([...vPad(cardLines(null, true), 4), '', `Your pick: ${want}`]), caption: 'Card is placed face down', ms: 900 });
  frames.push({ art: code([...vPad(vFlip(), 4), '', `Your pick: ${want}`]), caption: 'It flips over...', ms: 700 });
  frames.push({ art: code([...vPad(cardLines(res.card, false), 4), '', `Your pick: ${want}`]), caption: `Card flipped: ${res.card.r}${res.card.s}`, ms: 1200 });
  return frames;
};

// ---------- Other games: themed scenes ----------
const vRow = (e, n) => e.repeat(n);
const vScene = (lines) => lines.join('\n') + '\n';

ANIMS.stardrop = (res) => {
  const sky = (r, c, e) => range(5).map((y) => range(7).map((x) => (y === r && x === c ? e : (vhash(y, x) % 5 === 0 ? '✨' : vBG))).join('')).join('\n') + '\n';
  return [
    { art: sky(0, 5, '🌠') + '## 🌠 A shooting star...', caption: 'Shooting star', ms: 800 },
    { art: sky(1, 4, '⭐') + '## ⭐ It shoots across the night', caption: 'It crosses', ms: 800 },
    { art: sky(3, 2, '⭐') + '## ⭐ It is descending…', caption: 'It is approaching', ms: 800 },
    { art: sky(4, 2, res.falls ? '🌟' : '💨') + (res.falls ? '## 🌟 Caught!' : '## 💨 It faded away'), caption: res.falls ? 'It fell' : 'It keeps going', ms: 1200 },
  ];
};
ANIMS.volcano = (res) => [
  { art: vScene(['☁️☁️🌫️☁️☁️', '⬛⬛🌋⬛⬛', '🟫🟫🟫🟫🟫']) + '## 🌋 The volcano rumbles', caption: 'The volcano rumbles', ms: 800 },
  { art: vScene(['⬛⬛💨⬛⬛', '⬛🔥🌋🔥⬛', '🟫🟧🟧🟧🟫']) + '## 🔥 Heating up', caption: 'Heating up', ms: 800 },
  { art: vScene(['⬛🔥💥🔥⬛', '🔥🌋🌋🌋🔥', '🟧🟧🟧🟧🟧']) + `## 🌋 ERUPTION zone ${res.eruption}`, caption: `Eruption zone ${res.eruption}`, ms: 1200 },
];
ANIMS.lightning = (res) => [
  { art: vScene(['⬛☁️⬛☁️⬛', '⬛⬛⬛⬛⬛', '🟦🟦🟦🟦🟦']) + '## ☁️ Clouds gather', caption: 'Clouds', ms: 800 },
  { art: vScene(['☁️☁️🌩️☁️☁️', '⬛⬛💧⬛⬛', '🟦🟦🟦🟦🟦']) + '## 🌩️ The storm is brewing', caption: 'Storm approaching', ms: 800 },
  { art: res.strike ? vScene(['☁️☁️🌩️☁️☁️', '⬛⬛⚡⬛⬛', '🟨🟨💥🟨🟨']) + '## ⚡ LIGHTNING!' : vScene(['⬛☁️☁️☁️⬛', '⬛⬛⬛⬛⬛', '🟦🟦🟦🟦🟦']) + '## 🌤️ Storm passes', caption: res.strike ? 'Lightning!' : 'Storm passes', ms: 1200 },
];
ANIMS.bombdefuse = (res) => {
  const ok = res.good === res.want;
  return [
    { art: vScene(['🟥🟥🟥🟥🟥', '🟥💣⏱️3🟥', '🟥🟥🟥🟥🟥']).replace('⏱️3', '3️⃣') + '## ✂️ Pick a wire...', caption: 'Countdown', ms: 800 },
    { art: vScene(['🟧🟧🟧🟧🟧', '🟧💣2️⃣🟧🟧', '🟧🟧🟧🟧🟧']) + '## ⏱️ Time is running out', caption: 'Countdown', ms: 800 },
    { art: vScene(['🟨🟨🟨🟨🟨', '🟨💣1️⃣🟨🟨', '🟨🟨🟨🟨🟨']) + '## ✂️ Click!', caption: 'Countdown', ms: 800 },
    { art: ok ? vScene(['🟩🟩🟩🟩🟩', '🟩✅💣✅🟩', '🟩🟩🟩🟩🟩']) + '## ✅ DEFUSED' : vScene(['🔥🔥🔥🔥🔥', '🔥💥💥💥🔥', '🔥🔥🔥🔥🔥']) + '## 💥 BOOM', caption: ok ? 'Right wire!' : `Wrong wire (right = ${res.good})`, ms: 1300 },
  ];
};
ANIMS.freefall = (res) => {
  const col = (r, e) => range(6).map((y) => (y === r ? `⬛⬛${e}⬛⬛` : `${vBG}${vBG}${vBG}${vBG}${vBG}`)).join('\n') + '\n';
  return [
    { art: col(0, '🪂') + '🟩🟩🟩🟩🟩\n## 🪂 Saut !', caption: 'Saut !', ms: 800 },
    { art: col(2, '🪂') + '🟩🟩🟩🟩🟩\n## ☁️ Fall libre', caption: 'Fall...', ms: 800 },
    { art: col(4, '🪂') + '🟩🟩🟩🟩🟩\n## 🌍 The ground approaches', caption: 'Approaching the ground', ms: 800 },
    { art: (res.ok ? col(5, '🧍') : col(5, '💥')) + '🟩🟩🟩🟩🟩\n' + (res.ok ? '## ✅ Landedssage parfait' : '## 💥 Crash'), caption: res.ok ? 'Zone reached' : 'Missed', ms: 1200 },
  ];
};
ANIMS.balloon = (res) => {
  const frames = [];
  for (let k = 1; k <= res.need; k++) {
    frames.push({ art: vScene([vRow('🎈', Math.min(9, k + 1)), '', `Level ${k}  ${vBar(k / Math.max(1, res.need))}`]) + '## 🎈 Inflating…', caption: 'Inflating...', ms: 700 });
  }
  frames.push({ art: vScene([res.ok ? '🎈🎈🎈🎈🎈' : '💥💥💥💥💥']) + (res.ok ? '## 🎈 Intact !' : '## 💥 POP !'), caption: res.ok ? 'Success' : 'Overinflated', ms: 1200 });
  return frames;
};
ANIMS.treasure = (res) => {
  const frames = [];
  for (let k = 1; k <= 5; k++) {
    const row = range(5).map((j) => (j + 1 < k ? '🕳️' : j + 1 === k ? (k === res.win ? '💎' : '🕳️') : '🟫')).join('');
    frames.push({ art: vScene(['🏝️🌴🏝️🌴🏝️', row]) + `## ⛏️ Cell ${k}`, caption: 'Dig', ms: 600 });
  }
  frames.push({ art: vScene(range(1).map(() => range(5).map((j) => (j + 1 === res.win ? '💎' : '🕳️')).join(''))) + `## 💎 Treasure in spot ${res.win}`, caption: 'Result', ms: 1200 });
  return frames;
};
ANIMS.gemhunt = (res) => {
  const frames = [];
  for (let k = 1; k <= 6; k++) {
    const row = range(6).map((j) => (j + 1 < k ? '🪨' : j + 1 === k ? (k === res.win ? '💎' : '🪨') : '⛰️')).join('');
    frames.push({ art: vScene(['⛏️✨⛏️✨⛏️✨', row]) + `## ⛏️ Roche ${k}`, caption: 'Fouille', ms: 550 });
  }
  frames.push({ art: vScene([range(6).map((j) => (j + 1 === res.win ? '💎' : '🪨')).join('')]) + `## 💎 Gem in rock ${res.win}`, caption: 'Found', ms: 1200 });
  return frames;
};
ANIMS.numguess = (res) => {
  const frames = [];
  for (let k = 0; k < 6; k++) frames.push({ art: vScene(['🔮✨🔮✨🔮']) + `## 🔮 [ ${randomInt(1, 11)} ]`, caption: 'Numbers rolling', ms: 550 });
  frames.push({ art: vScene(['🌟🔮🔮🔮🌟']) + `## 🎯 [ ${res.n} ]`, caption: `Draw: ${res.n}`, ms: 1200 });
  return frames;
};
ANIMS.target = (res) => [
  { art: vScene(['🏹⬛⬛⬛🎯']) + '## 🏹 Aiming...', caption: 'Aiming', ms: 700 },
  { art: vScene(['⬛⬛➳⬛🎯']) + '## 💨 Tir !', caption: 'Lancer', ms: 700 },
  { art: vScene(['⬛⬛⬛➳🎯']) + '## 💨 In flight', caption: 'Flight', ms: 700 },
  { art: vScene(['⬛⬛⬛⬛💥']) + `## 🎯 Impact: ${res.hit}`, caption: 'Result', ms: 1200 },
];
ANIMS.sequence = (res) => [
  { art: vScene(['🟪🟪🟪🟪🟪']) + `## 🔢 ${res.a}  ❔  ❔`, caption: 'Premier chiffre', ms: 800 },
  { art: vScene(['🟪🟪🟪🟪🟪']) + `## 🔢 ${res.a}  ${res.b}  ❔`, caption: 'Second', ms: 800 },
  { art: vScene([res.ok ? '🟩🟩🟩🟩🟩' : '🟥🟥🟥🟥🟥']) + `## 🔢 ${res.a}  ${res.b}  ${res.c}`, caption: res.ok ? 'STRAIGHT!' : 'No straight', ms: 1200 },
];
ANIMS.animalrace = (res) => {
  const animals = ['🐰', '🦊', '🐺', '🦅'];
  const lane = (e, p) => '🏁' + '▫️'.repeat(Math.max(0, 6 - p)) + e + '▫️'.repeat(Math.max(0, p)) + '🚩';
  const frames = [];
  const pos = [0, 0, 0, 0];
  for (let k = 0; k < 5; k++) {
    for (let a = 0; a < 4; a++) pos[a] = Math.min(5, pos[a] + randomInt(0, 2));
    frames.push({ art: vScene(animals.map((e, a) => lane(e, pos[a]))) + '## 🏃 Course en cours', caption: 'Course en cours', ms: 700 });
  }
  frames.push({ art: vScene(animals.map((e) => lane(e, 0))) + `## 🏆 Winner: ${res.winner.name}`, caption: 'Finish', ms: 1300 });
  return frames;
};
ANIMS.bingo = (res) => {
  const frames = [];
  const cells = (on) => range(5).map((j) => (j + 1 === on ? '🔴' : '⚪')).join('');
  for (let k = 0; k < 5; k++) frames.push({ art: vScene(['🎱✨🎱✨🎱', cells(randomInt(1, 6))]) + '## 🎰 The ball spins…', caption: 'The ball spins...', ms: 600 });
  frames.push({ art: vScene(['🎱🎱🎱🎱🎱', cells(res.n)]) + `## 🎱 Cell ${res.n}`, caption: `Ball in cell ${res.n}`, ms: 1200 });
  return frames;
};
ANIMS.colorswipe = (res) => {
  const cols = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'];
  const em = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣' };
  const frames = cols.map((e, k) => ({ art: vScene([cols.map((_, j) => (j === k ? e : '⚫')).join('')]) + '## 🌈 Rainbow', caption: 'Rainbow', ms: 500 }));
  frames.push({ art: vScene([vRow(em[res.out], 6)]) + `## ${em[res.out]} Color drawn`, caption: 'Color drawn', ms: 1200 });
  return frames;
};
ANIMS.spincolor = (res) => {
  const cols = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
  const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', purple: '🟣', orange: '🟠' };
  const wheel = (k) => cols.map((e, j) => (j === k % 6 ? '👉' + e : '⚪')).join('');
  const frames = [];
  for (let k = 0; k < 8; k++) frames.push({ art: vScene(['🎡✨🎡✨🎡✨🎡', wheel(k)]) + '## 🎨 The wheel spins', caption: 'The wheel spins', ms: 500 });
  frames.push({ art: vScene(['🎆' + vRow(em[res.out], 5) + '🎆']) + `## ${em[res.out]} Stop`, caption: 'Stop', ms: 1200 });
  return frames;
};
ANIMS.multiplier = (res) => {
  const frames = [];
  for (let k = 0; k < 6; k++) frames.push({ art: vScene(['💠✨💠✨💠']) + `## 💠 x${[1.5, 2, 3, 5][randomInt(0, 4)]}`, caption: 'Multipliers', ms: 600 });
  frames.push({ art: vScene([res.ok ? '🟩🟩🟩🟩🟩' : '🟥🟥🟥🟥🟥']) + `## 💠 Target ${res.pick}`, caption: res.ok ? 'Cleared!' : 'Missed', ms: 1200 });
  return frames;
};
ANIMS.oddseven = (res) => {
  const r = () => randomInt(1, 7);
  return [
    { art: code(dieLines(r())), caption: 'The die rolls', ms: 700 },
    { art: code(dieLines(r())), caption: 'Rebond', ms: 700 },
    { art: code(dieLines(res.n)), caption: `Result: ${res.n}`, ms: 1200 },
  ];
};

// Generic game banner (~40 mini-games): themed scene based on the game emoji
function genericFrames(emoji, res) {
  const glow = res.ok ? '🟣' : '⚫';
  const line = (e) => `${e}✨${e}✨${e}✨${e}`;
  return [
    { art: vScene([line(emoji), `${vRow('🟪', 7)}`, line('✨')]) + `## ${emoji} Drawing in progress…`, caption: 'Draw', ms: 750 },
    { art: vScene([line('💫'), `🟪🟪🌀🌀🌀🟪🟪`, line('💫')]) + `## 🌀 Spinning...`, caption: 'Suspense', ms: 750 },
    { art: vScene([vRow(res.ok ? '🟩' : '🟥', 7), `${glow}${vRow(emoji, 5)}${glow}`, vRow(res.ok ? '🟩' : '🟥', 7)]) + `## ${res.ok ? '✅' : '❌'} ${res.detail}`, caption: res.ok ? 'Won' : 'Lost', ms: 1100 },
  ];
}

// ---------- Bulk games (to reach ~100) ----------
(function registerBulkGames() {
  const bulk = [['coin2', 'Double heads', '🪙', 'Heads or tails again', 'pile', 'face', 2], ['dice7', 'Dice 7+', '🎲', 'Sum >= 7', 'over', 'under', 2], ['lucky7', 'Lucky 7', '7️⃣', 'Exactly 7', 'yes', 'no', 5], ['evenodd2', 'Even/Odd 2', '🔢', 'Even or odd die', 'even', 'odd', 2], ['redblack2', 'Red Black 2', '🔴', 'Red/black card', 'red', 'black', 2], ['highlow2', 'High Low', '⬆️', 'High or low card', 'high', 'low', 2], ['triple', 'Triple chance', '🎯', '1 in 3', 'a', 'b', 2.8], ['quad', 'Quad', '4️⃣', '1 in 4', 'a', 'b', 3.5], ['penta', 'Penta', '5️⃣', '1 in 5', 'a', 'b', 4.5], ['coin3', 'Triple heads', '🪙', "3 heads in a row", 'yes', 'no', 7], ['snake', 'Snake eyes', '🐍', 'Double 1', 'yes', 'no', 30], ['boxcars', 'Boxcars', '🎲', 'Double 6', 'yes', 'no', 30], ['anydouble', 'Any double', '🎲', 'Two matching dice', 'yes', 'no', 5.5], ['acehigh', 'High ace', '🃏', 'Ace drawn', 'yes', 'no', 12], ['facecard', 'Face card', '🃏', 'J, Q, or K', 'yes', 'no', 3.5], ['suitspade', 'Spades', '♠️', 'Spade suit', 'yes', 'no', 3.8], ['suithr', 'Hearts', '♥️', 'Heart suit', 'yes', 'no', 3.8], ['suitdi', 'Diamonds', '♦️', 'Diamond suit', 'yes', 'no', 3.8], ['suitcl', 'Clubs', '♣️', 'Club suit', 'yes', 'no', 3.8], ['blast', 'Blast', '💥', 'Explosion or not', 'safe', 'boom', 1.9], ['freeze', 'Freeze', '❄️', 'Ice or heat', 'ice', 'fire', 2], ['shadow', 'Shadow', '🌑', 'Shadow or light', 'shadow', 'light', 2], ['pulse', 'Pulse', '💓', 'Strong/weak pulse', 'high', 'low', 2], ['orbit', 'Orbit', '🪐', 'Stay in orbit', 'in', 'out', 2.2], ['spark', 'Spark', '✨', 'Spark lit', 'on', 'off', 2], ['wave', 'Wave', '🌊', 'High/low wave', 'high', 'low', 2], ['mirror', 'Mirror', '🪞', 'Mirror broken or not', 'ok', 'break', 1.95], ['portal', 'Portal', '🌀', 'Portal open', 'open', 'closed', 2.1], ['rune', 'Rune', '🔮', 'Good rune', 'yes', 'no', 3], ['totem', 'Totem', '🗿', 'Stable totem', 'yes', 'no', 2.4], ['cactus', 'Cactus', '🌵', 'Avoid the thorns', 'safe', 'ouch', 1.9], ['pearl', 'Pearl', '🦪', 'Find the pearl', 'yes', 'no', 4], ['compass', 'Compass', '🧭', 'Right direction', 'n', 's', 2], ['anchor', 'Anchor', '⚓', 'Anchor raised', 'up', 'down', 2], ['torch', 'Torch', '🔥', 'Torch lit', 'on', 'off', 2], ['keylock', 'Key', '🔑', 'Right key', 'yes', 'no', 3.5], ['hourglass', 'Hourglass', '⏳', 'Time remaining', 'ok', 'out', 2.2], ['balloon2', 'Ballon 2', '🎈', 'Inflated or popped', 'ok', 'pop', 2], ['dicehi', 'High die', '🎲', 'Die >= 4', 'yes', 'no', 1.9], ['dicelo', 'Low die', '🎲', 'Die <= 3', 'yes', 'no', 1.9], ['coinrush', 'Coin rush', '🪙', 'More heads', 'yes', 'no', 2.5], ['starfall', "Shower of stars", '🌟', 'Catch 1 star', 'yes', 'no', 3], ['meteor', 'Meteor', '☄️', 'Dodge the meteor', 'dodge', 'hit', 1.85], ['rainbow', 'Rainbow', '🌈', 'Lucky color', 'yes', 'no', 5], ['clover', 'Lucky clover', '🍀', 'Clover found', 'yes', 'no', 6]];
  for (const [key, name, emoji, desc, c1, c2, winMult] of bulk) {
    if (INSTANT[key]) continue;
    INSTANT[key] = {
      title: `${emoji} ${name}`,
      spinText: code(['...']),
      choices: [c1, c2],
      info: (c) => `Choice ${c1}/${c2} · win ≈ ${fx(winMult * c)}`,
      picker: (c) =>
        choicePicker(
          key,
          `${emoji} ${name}`,
          `${desc}\nWin ~ **${fx(winMult * c)}** if correct.`,
          [
            [c1, c1, '✅', ButtonStyle.Success],
            [c2, c2, '❌', ButtonStyle.Danger],
          ]
        ),
      resolve: (choice) => {
        // 50/50 bias adjusted by winMult: P(win) ≈ 0.96/winMult
        const pWin = Math.min(0.9, Math.max(0.05, 0.97 / winMult));
        const ok = Math.random() < pWin;
        // if player chose c1, outcome aligns when ok
        const out = ok ? choice : choice === c1 ? c2 : c1;
        return {
          base: out === choice ? winMult : 0,
          pick: choice,
          detail: out,
          ok: out === choice,
          headline: out === choice ? `✅ **${out}** — won!` : `❌ Outcome **${out}** — lost.`,
        };
      },
    };
    ANIMS[key] = (res) => genericFrames(emoji, res);
  }
})();

// ============================================================
//  CATALOG: only the first 20 games are kept
//  mines · bj · roulette · coinflip · dice · slots · wheel · duel · suit · zone · plinko · crash ·
//  scratch · die · chest · russian · horses · limbo · higher · rps
//  Other games are removed from the casino (menu, rules, multipliers, bets).
//  MAX_GAMES variable: 20 by default; 30 = keep 30 games; 0 = keep the original catalog.
// ============================================================
let GAME_LIMIT = Number.parseInt(process.env.MAX_GAMES ?? '20', 10);
if (!Number.isFinite(GAME_LIMIT) || GAME_LIMIT < 0) GAME_LIMIT = 20;
if (GAME_LIMIT > 0) {
  const keep = new Set(Object.keys(GAME_NAMES).slice(0, GAME_LIMIT));
  for (const k of Object.keys(GAME_NAMES)) if (!keep.has(k)) delete GAME_NAMES[k];
  for (const k of Object.keys(INSTANT)) if (!keep.has(k)) delete INSTANT[k];
  for (const k of Object.keys(ANIMS)) if (!keep.has(k)) delete ANIMS[k];
  console.log(`[games] catalog limited to the first ${keep.size} games: ${[...keep].join(', ')}`);
}

async function playInstant(i, key, bet, choice) {
  const G = INSTANT[key];
  if (!G || !G.choices.includes(choice)) return respondText(i, 'Invalid bet.');
  const uid = i.user.id;
  if (!tryLock(uid)) return respondText(i, MSG.busy);

  // Reply right away to avoid "The application did not respond"
  try {
    if (!i.deferred && !i.replied) await i.deferReply({ flags: EPH });
  } catch {
    /* ignore */
  }

  try {
    const err = await takeBet(uid, bet);
    if (err) return i.editReply({ content: err }).catch(() => respondText(i, err));

    const c = coef(key);
    const res = G.resolve(choice, c);
    const boost = getBoost(resolveGuildId(i));
    const mult = res.base > 0 ? round2(res.base * c * (boost.winMult || 1)) : 0;
    const payout = mult > 0 ? floor2(bet * mult) : 0;
    let extraLoss = 0;
    if (payout === 0 && (boost.loseMult || 1) > 1) {
      extraLoss = floor2(bet * ((boost.loseMult || 1) - 1));
      if (extraLoss > 0) await debit(uid, extraLoss).catch(() => {});
    }
    const profit = round2(payout - bet - extraLoss);

    try {
      await i.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(G.title)
            .setThumbnail(gameIcon(key) || null)
            .setAuthor({ name: `ZNK CASINO  •  ${gameNamePlain(key).toUpperCase()}`, iconURL: ZNK_LOGO })
            .setColor(COLORS.gold)
            .setDescription(
              launchBanner('Lets go!') + `${G.spinText}\nBet **${fmt(bet)}** · ${res.pick}` + (boost.label ? `\n⚡ Boost active: **${boost.label}**` : '')
            ),
        ],
        components: [],
      });
    } catch (e) {
      await credit(uid, bet + extraLoss).catch(() => {});
      throw e;
    }

    const balance = payout > 0 ? await credit(uid, payout) : await getBalance(uid);

    let frames = [{ art: G.spinText || '...', ms: 1000 }];
    try {
      if (ANIMS[key]) frames = ANIMS[key](res, { c, bet, choice }) || frames;
    } catch (animErr) {
      console.error('[anim]', key, animErr?.message || animErr);
    }
    const kind = profit > 0 ? 'win' : profit < 0 ? 'lose' : 'push';
    const gCtx = {
      user: i.user,
      bet,
      choice,
      coef: c,
      outcome: kind,
      resultText: animResultText(kind, mult),
      sub: `Bet ${coinTxt(bet)} · ${noEmoji(res.pick || '')}`,
      data: { wheel: WHEEL, horses: HORSES },
    };
    const imgDone = await playGameImages(i, key, res, gCtx);
    if (!imgDone) await animate(i, frames, G.title, `Bet **${fmt(bet)}** · ${res.pick || ''}\n`, key);

    const text =
      payout === 0
        ? `You lose **${fmt(bet)}**.`
        : kind === 'win'
          ? `You win **${fmt(payout)}** (${fx(mult)}).`
          : `You get back **${fmt(payout)}** (${fx(mult)}).`;

    const embed = brand(
      new EmbedBuilder()
        .setTitle(G.title)
        .setColor(outcomeColor(kind))
        .setDescription(`${outcomeBanner(kind, kind === 'push' ? NaN : profit)}${res.headline}\n\n${text}\n${kind === 'win' ? '💜✨💜✨💜✨💜✨💜' : kind === 'lose' ? '🖤🌑🖤🌑🖤🌑🖤🌑🖤' : '💜🤍💜🤍💜🤍💜🤍💜'}`)
        .addFields(
          { name: '🎯 Your bet', value: res.pick, inline: true },
          { name: '💰 Bet', value: fmt(bet), inline: true },
          { name: '👛 Balance', value: fmt(balance), inline: true }
        ),
      key
    );

    const igPayload = { embeds: [embed], components: [endGameRow(`replay|${key}|${bet}|${choice}`)] };
    if (gCtx.gifName) {
      embed.setImage(`attachment://${gCtx.gifName}`);
      await i.editReply(igPayload);
    } else {
      putCard(igPayload, await resultCard(i.user, key, bet, mult, profit, balance));
      await editWithCard(i, igPayload);
    }

    recordResult({
      guildId: resolveGuildId(i),
      user: i.user,
      game: key,
      bet,
      mult,
      payout,
      detail: `${res.pick} -> ${res.detail}`,
    });
  } finally {
    unlock(uid);
  }
}

// ============================================================
//  GAME PANEL (buttons) + POP-UPS
// ============================================================
function buildHelpEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.violet)
    .setAuthor({ name: 'ZNK CASINO' })
    .setTitle('✨ Slash command guide')
    .setDescription(
      '**All commands use `/`** and are **reserved for the server owner** (crown).'
    )
    .addFields(
      {
        name: '📖 Help',
        value: '`/help` · `/aide` — this guide',
        inline: false,
      },
      {
        name: '💰 Accounts',
        value:
          '`/balance` `[member]` · `/solde` — balance\n' +
          '`/daily` — daily reward\n' +
          '`/invites` `[member]` — invitations\n' +
          '`/add` `member` `amount` — add coins\n' +
          '`/remove` `member` `amount` — remove coins',
        inline: false,
      },
      {
        name: '🎮 Casino',
        value:
          '`/casino` · `/jeux` — publish the game panel\n' +
          '`/setup` · `/salon` — configure channels\n' +
          '`/wins` — wins channel\n' +
          '`/classement` — auto leaderboard message\n' +
          '`/admin` — admin panel\n' +
          '`/invites-notif` — invite notification channel',
        inline: false,
      },
      {
        name: '🎁 Shop / tickets',
        value:
          '`/ticketsetup` `[category]` — claim rewards panel (site order codes)',
        inline: false,
      },
      {
        name: '🌐 Website',
        value:
          'Online / offline / **ranked** (RR) games / shop / tasks — via the website Discord link.',
        inline: false,
      }
    )
    .setFooter({ text: 'ZNK Casino · owner-only commands' })
    .setTimestamp();
}

function buildPanelPayload() {
  const panel = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setDescription('Click **Start** to open your private casino, then choose a game and your bet.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_start').setLabel('Start').setEmoji('▶️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_settings').setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_rules').setLabel('Rules').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_invites').setLabel('Invites').setEmoji('📨').setStyle(ButtonStyle.Secondary)
  );
  return withBanner({ embeds: [panel], components: [row] }, 'panel_salon.png');
}

async function buildDmPlayPayload(userId) {
  const lang = getLang(userId);
  let bal = 0;
  try {
    bal = await getBalance(userId);
  } catch {
    /* ignore */
  }
  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setTitle(lang === 'en' ? '✦ Your private casino' : '✦ Your private casino')
    .setDescription(
      lang === 'en'
        ? [
            `💰 **Balance: ${fmt(bal)}**`,
            `🎁 Daily: **${DAILY_AMOUNT}** ${COIN} once a day (Paris midnight)`,
            '',
            '**Play** → choose a game',
            '**Send** → transfer coins (username of a server member)',
            '**Rules** → simple rules of every game',
          ].join('\n')
        : [
            `💰 **Balance: ${fmt(bal)}**`,
            `🎁 Daily: **${DAILY_AMOUNT}** ${COIN} per day (Paris midnight)`,
            '',
            '**Play** → choose a game',
            '**Send** → transfer coins (username of a server member)',
            '**Rules** → simple rules of every game',
          ].join('\n')
    )
    .setFooter({ text: lang === 'en' ? 'Private panel' : 'Private panel' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_play').setLabel(lang === 'en' ? 'Play' : 'Play').setEmoji('🎮').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_search').setLabel(lang === 'en' ? 'Search' : 'Search').setEmoji('🔍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_favs').setLabel(lang === 'en' ? 'Favorites' : 'Favorites').setEmoji('⭐').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_daily').setLabel('Daily').setEmoji('🎁').setStyle(ButtonStyle.Success)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_send').setLabel(lang === 'en' ? 'Send' : 'Send').setEmoji('💸').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_rules').setLabel(lang === 'en' ? 'Rules' : 'Rules').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_history').setLabel('History').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_settings').setLabel(lang === 'en' ? 'Settings' : 'Settings').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_clearall').setLabel(lang === 'en' ? 'Clear chat' : 'Tout effacer').setEmoji('🧹').setStyle(ButtonStyle.Danger)
  );
  const menuPayload = { embeds: [embed], components: [row1, row2, row3] };
  try {
    const mu = await client.users.fetch(userId).catch(() => null);
    if (mu) {
      putCard(
        menuPayload,
        await makeCard('menu', {
          avatar: mu,
          tag: lang === 'en' ? 'PRIVATE CASINO' : 'PRIVATE CASINO',
          headline: userName(mu),
          sub: 'ZNK CASINO',
          barLeft: lang === 'en' ? 'BALANCE' : 'BALANCE',
          barRight: coinTxt(bal),
          cells: [
            [lang === 'en' ? 'BALANCE' : 'BALANCE', coinTxt(bal)],
            ['DAILY', `+${coinTxt(DAILY_AMOUNT)} / ${lang === 'en' ? 'day' : 'day'}`],
            [lang === 'en' ? 'LANGUAGE' : 'LANGUAGE', lang === 'en' ? 'ENGLISH' : 'ENGLISH'],
            [lang === 'en' ? 'WIN PING' : 'WIN PING', wantsWinPing(userId) ? 'ON' : 'OFF'],
            ['ANIMATIONS', wantsSkipAnim(userId) ? 'SKIP' : 'ON'],
            [lang === 'en' ? 'FAVORITES' : 'FAVORITES', String(getFavs(userId).size)],
          ],
        })
      );
    }
  } catch (e) {
    console.error('[card menu]', e?.message || e);
  }
  return menuPayload;
}

const GAME_MENU = [
  ['mines', 'Mines', '💣', 'Bombs · rising multiplier'],
  ['bj', 'Blackjack', '🃏', 'Beat the dealer · soft ace'],
  ['roulette', 'Roulette', '🎡', 'Color · even · number'],
  ['coinflip', 'Heads/Tails', '🪙', '50 / 50'],
  ['dice', 'Dice', '🎲', 'Sum of 2 dice'],
  ['slots', 'Slots', '🎰', '3 reels · jackpot'],
  ['wheel', 'Wheel', '🎡', 'Wheel of fortune'],
  ['duel', 'Duel', '⚔️', 'Card vs dealer'],
  ['suit', 'Suit', '🃏', 'Guess the suit'],
  ['zone', 'Zone', '🎯', 'Low · mid · high'],
  ['plinko', 'Plinko', '🎱', 'Ball · risk'],
  ['crash', 'Crash', '🚀', 'Cash out before boom'],
  ['scratch', 'Ticket', '🎟️', 'Scratch & win'],
  ['die', 'Exact die', '🎲', '1 in 6 chance'],
  ['chest', 'Chest', '📦', 'Find the treasure'],
  ['russian', 'Russian', '🔫', 'Survive the cylinder'],
  ['horses', 'Horses', '🏇', 'Bet on the winner'],
  ['limbo', 'Limbo', '📈', 'Choose your target'],
  ['higher', 'Higher/Lower', '⬆️', 'Higher or lower'],
  ['rps', 'RPS', '✊', 'Rock paper scissors'],
  ['colorpick', 'Color', '🎨', 'Guess the color'],
  ['ladder', 'Ladder', '🪜', 'Climb the rungs'],
  ['keno', 'Keno', '🎱', 'Draw 1 number out of 10'],
  ['war', 'War', '⚔️', 'Card vs card'],
  ['hilo', 'Hi-Lo', '🃏', 'Card sequence'],
  ['bingo', 'Bingo', '🅱️', 'Number drawn'],
  ['jackpot', 'Jackpot', '💎', '3 symboles = jackpot'],
  // 30 new games
  ['dicewar', 'Dice War', '🎲', 'Dice vs dice'],
  ['coinladder', 'Coin Ladder', '🪙', 'Heads streak'],
  ['cardmatch', 'Card Match', '🃏', 'Find the card'],
  ['numguess', 'Guess number', '🔢', '1 to 10'],
  ['bombdefuse', 'Defusal', '💣', 'Cut the right wire'],
  ['treasure', 'Treasure', '🗺️', 'Choose the spot'],
  ['highcard', 'High card', '🃏', 'Above 7'],
  ['lowcard', 'Low card', '🃏', 'Below 8'],
  ['pairmatch', 'Pair', '🃏', 'Two matching ranks'],
  ['freefall', 'Free fall', '🪂', 'Land safely'],
  ['balloon', 'Balloon', '🎈', 'Inflate without popping'],
  ['target', 'Target', '🎯', 'Aim for the center'],
  ['sequence', 'Sequence', '🔢', 'Number sequence'],
  ['animalrace', 'Animal race', '🐾', 'Bet on an animal'],
  ['fruitmatch', 'Fruits', '🍎', '3 matching fruits'],
  ['gemhunt', 'Gems', '💎', 'Find the gem'],
  ['stardrop', 'Star', '⭐', 'Catch the star'],
  ['moonshot', 'Moon shot', '🌙', 'Reach the Moon'],
  ['volcano', 'Volcano', '🌋', 'Avoid the eruption'],
  ['lightning', 'Lightning', '⚡', 'Survive the storm'],
  ['pokerhand', 'Express poker', '🃏', 'Best hand'],
  ['redblack', 'Red/Black', '🔴', 'Simple color'],
  ['oddseven', 'Even/Odd+', '🔢', 'On a die'],
  ['multiplier', 'Multiplier', '✖️', 'Choose your multiplier'],
  ['memory', 'Memory', '🧠', 'Find the pair'],
  ['colorswipe', 'Rainbow', '🌈', 'Color drawn'],
  ['rocket2', 'Rocket 2', '🚀', 'High target'],
  ['diceexact2', 'Double die', '🎲', 'Exact sum'],
  ['chest2', 'Triple chest', '📦', '1 treasure in 3'],
  ['spincolor', 'Color wheel', '🎨', '6-color wheel'],
  ['coin2', 'Double heads', '🪙', 'Heads or tails again'],
  ['dice7', 'Dice 7+', '🎲', 'Sum >= 7'],
  ['lucky7', 'Lucky 7', '7️⃣', 'Exactly 7'],
  ['evenodd2', 'Even/Odd 2', '🔢', 'Even or odd die'],
  ['redblack2', 'Red Black 2', '🔴', 'Red/black card'],
  ['highlow2', 'High Low', '⬆️', 'High or low card'],
  ['triple', 'Triple chance', '🎯', '1 in 3'],
  ['quad', 'Quad', '4️⃣', '1 in 4'],
  ['penta', 'Penta', '5️⃣', '1 in 5'],
  ['coin3', 'Triple heads', '🪙', '3 heads in a row'],
  ['snake', 'Snake eyes', '🐍', 'Double 1'],
  ['boxcars', 'Boxcars', '🎲', 'Double 6'],
  ['anydouble', 'Any double', '🎲', 'Two matching dice'],
  ['acehigh', 'High ace', '🃏', 'Ace drawn'],
  ['facecard', 'Face card', '🃏', 'J, Q, or K'],
  ['suitspade', 'Spades', '♠️', 'Spade suit'],
  ['suithr', 'Hearts', '♥️', 'Heart suit'],
  ['suitdi', 'Diamonds', '♦️', 'Diamond suit'],
  ['suitcl', 'Clubs', '♣️', 'Club suit'],
  ['blast', 'Blast', '💥', 'Explosion or not'],
  ['freeze', 'Freeze', '❄️', 'Ice or heat'],
  ['shadow', 'Shadow', '🌑', 'Shadow or light'],
  ['pulse', 'Pulse', '💓', 'Strong/weak pulse'],
  ['orbit', 'Orbit', '🪐', 'Stay in orbit'],
  ['spark', 'Spark', '✨', 'Spark lit'],
  ['wave', 'Wave', '🌊', 'High/low wave'],
  ['mirror', 'Mirror', '🪞', 'Mirror broken or not'],
  ['portal', 'Portal', '🌀', 'Portal open'],
  ['rune', 'Rune', '🔮', 'Good rune'],
  ['totem', 'Totem', '🗿', 'Stable totem'],
  ['cactus', 'Cactus', '🌵', 'Avoid the thorns'],
  ['pearl', 'Pearl', '🦪', 'Find the pearl'],
  ['compass', 'Compass', '🧭', 'Right direction'],
  ['anchor', 'Anchor', '⚓', 'Anchor raised'],
  ['torch', 'Torch', '🔥', 'Torch lit'],
  ['keylock', 'Key', '🔑', 'Right key'],
  ['hourglass', 'Hourglass', '⏳', 'Time remaining'],
  ['balloon2', 'Balloon 2', '🎈', 'Inflated or popped'],
  ['dicehi', 'High die', '🎲', 'Die >= 4'],
  ['dicelo', 'Low die', '🎲', 'Die <= 3'],
  ['coinrush', 'Coin rush', '🪙', 'More heads'],
  ['starfall', 'Shower of stars', '🌟', 'Catch 1 star'],
  ['meteor', 'Meteor', '☄️', 'Dodge the meteor'],
  ['rainbow', 'Rainbow', '🌈', 'Lucky color'],
  ['clover', 'Lucky clover', '🍀', 'Clover found'],
];

function buildGameMenuPayload(userId = null, page = 0, mode = 'all', query = '') {
  const favs = userId ? getFavs(userId) : new Set();
  let list = GAME_MENU.filter(([key]) => GAME_NAMES[key]);
  if (mode === 'favs') {
    list = list.filter(([key]) => favs.has(key));
  } else if (mode === 'search' && query) {
    const q = query.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    list = list.filter(([key, name, , desc]) => {
      const hay = `${key} ${name} ${desc}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      return hay.includes(q);
    });
  }
  // Favorites first in all mode
  if (mode === 'all' && favs.size) {
    list = [
      ...list.filter(([k]) => favs.has(k)),
      ...list.filter(([k]) => !favs.has(k)),
    ];
  }

  const PAGE_SIZE = 23;
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const slice = list.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const modeLabel =
    mode === 'favs' ? '⭐ Favorites' : mode === 'search' ? `🔍 “${query}”` : '🎮 All games';
  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setTitle(t(userId, 'lobbyTitle'))
    .setDescription(
      `${modeLabel}\n` +
        (list.length ? `**Page ${p + 1}/${totalPages}** · ${list.length} game(s)` : '_No results_') +
        `\n⭐ = favorite · use **Search** or **Favorites** from the panel`
    )
    .setFooter({ text: t(userId, 'lobbyFooter') })
    .setTimestamp();

  const components = [];
  if (slice.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('panel_gameselect')
      .setPlaceholder(t(userId, 'lobbyPlaceholder'))
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        slice.map(([key, name, emoji, desc]) => ({
          label: `${favs.has(key) ? '⭐ ' : ''}${emoji} ${name}`.slice(0, 100),
          value: key,
          description: desc.slice(0, 100),
        }))
      );
    components.push(new ActionRowBuilder().addComponents(select));
  }

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`panel_gamepage_${mode}_${p - 1}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p <= 0),
    new ButtonBuilder()
      .setCustomId(`panel_gamepage_${mode}_${p + 1}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= totalPages - 1 || list.length === 0),
    new ButtonBuilder().setCustomId('panel_search').setLabel('Search').setEmoji('🔍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_favs').setLabel('Favorites').setEmoji('⭐').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_play').setLabel('All').setEmoji('🎮').setStyle(ButtonStyle.Secondary)
  );
  components.push(nav);

  return animPanel({ embeds: [embed], components });
}

function buildSettingsPayload(userId) {
  const cur = getLang(userId);
  const ping = wantsWinPing(userId);
  const skip = wantsSkipAnim(userId);
  const embed = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setTitle(`⚙️ ${L(userId, 'Settings', 'Settings')}`)
    .setDescription(
      code([
        `${padR(L(userId, 'Language', 'Language'), 22)}${padL(cur === 'fr' ? 'English (FR)' : 'English', 10)}`,
        `${padR(L(userId, 'Win pings', 'Win pings'), 22)}${padL(ping ? 'ON' : 'OFF', 10)}`,
        `${padR(L(userId, 'Animations', 'Animations'), 22)}${padL(skip ? 'SKIP' : 'ON', 10)}`,
      ]) +
        L(
          userId,
          '**Language**: private menus.\n**Ping**: mentions in wins channel.\n**Animations**: SKIP = instant result.',
          '**Language**: private menus.\n**Ping**: mentions in wins channel.\n**Animations**: SKIP = instant result.'
        )
    )
    .setFooter({ text: L(userId, 'Saved for you', 'Saved for you') });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_lang_fr').setLabel('English (FR)').setEmoji('🇫🇷').setStyle(cur === 'fr' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_lang_en').setLabel('English').setEmoji('🇬🇧').setStyle(cur === 'en' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel_ping')
      .setLabel(`Ping: ${ping ? 'ON' : 'OFF'}`)
      .setEmoji('🔔')
      .setStyle(ping ? ButtonStyle.Primary : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('panel_skipanim')
      .setLabel(skip ? 'Anim: SKIP' : 'Anim: ON')
      .setEmoji('⏩')
      .setStyle(skip ? ButtonStyle.Danger : ButtonStyle.Success)
  );
  return animPanel({ embeds: [embed], components: [row] });
}

function buildRulesPayload(userId) {
  const lang = getLang(userId);
  const fr = lang !== 'en';
  let lines = [
    ['💣 Mines', fr ? 'Pick a difficulty. Click tiles for diamonds. Avoid mines. Cash out anytime: more diamonds = higher multiplier.' : 'Pick a difficulty. Click tiles for diamonds. Avoid mines. Cash out anytime: more diamonds = higher multiplier.'],
    ['🃏 Blackjack', fr ? 'Beat the dealer without going over 21. Hit, Stand or Double. Natural blackjack pays x2.5.' : 'Beat the dealer without going over 21. Hit, Stand or Double. Natural blackjack pays x2.5.'],
    ['🎡 Roulette', fr ? 'Bet on red/black/even/odd (x2) or a number / green (x36). The ball spins then stops.' : 'Bet on red/black/even/odd (x2) or a number / green (x36). The ball spins then stops.'],
    ['🪙 Heads or Tails', fr ? 'Pick heads or tails. 50/50, win about x1.95.' : 'Pick heads or tails. 50/50, win about x1.95.'],
    ['🎲 Dice', fr ? '2 dice. Bet under 7, over 7 or exactly 7. Exactly 7 pays more.' : '2 dice. Bet under 7, over 7 or exactly 7. Exactly 7 pays more.'],
    ['🎰 Slots', fr ? '3 reels. 3 matching symbols = big win. 2 cherries = small win.' : '3 reels. 3 matching symbols = big win. 2 cherries = small win.'],
    ['🎡 Wheel', fr ? 'The wheel spins and stops on a multiplier (or x0).' : 'The wheel spins and stops on a multiplier (or x0).'],
    ['⚔️ Duel', fr ? 'Draw a card vs the dealer. Highest wins (Ace is low).' : 'Draw a card vs the dealer. Highest wins (Ace is low).'],
    ['🃏 Suit', fr ? 'Guess the suit of the card (spades, hearts, diamonds, clubs). 1 in 4.' : 'Guess the suit of the card. 1 in 4.'],
    ['🎯 Zone', fr ? 'A number from 1 to 10. Pick low (1-3), mid (4-7) or high (8-10).' : 'A number from 1 to 10. Pick low (1-3), mid (4-7) or high (8-10).'],
    ['🎱 Plinko', fr ? 'The ball falls into a slot. Choose the risk level.' : 'The ball falls into a slot. Choose the risk level.'],
    ['🚀 Crash', fr ? 'Pick a target (x1.5, x2…). Rocket rises then crashes. If it reaches your target, you win.' : 'Pick a target (x1.5, x2…). Rocket rises then crashes. If it reaches your target, you win.'],
    ['🎟️ Ticket', fr ? 'Scratch 3 cells. 3 matching symbols = win.' : 'Scratch 3 cells. 3 matching symbols = win.'],
    ['🎲 Exact die', fr ? 'Guess the die face (1-6). 1 in 6.' : 'Guess the die face (1-6). 1 in 6.'],
    ['📦 Chest', fr ? '3 chests, 1 treasure. Pick the right one.' : '3 chests, 1 treasure. Pick the right one.'],
    ['🔫 Russian roulette', fr ? 'Pick how many bullets. Survive to win (more bullets = bigger payout).' : 'Pick how many bullets. Survive to win (more bullets = bigger payout).'],
    ['🏇 Horses', fr ? 'Bet on one of 5 horses. Each has its own odds.' : 'Bet on one of 5 horses. Each has its own odds.'],
    ['📈 Limbo', fr ? 'Pick a target (x1.5 to x10). Multiplier rises randomly: if it exceeds your target, you win.' : 'Pick a target (x1.5 to x10). Multiplier rises randomly: if it exceeds your target, you win.'],
    ['⬆️ Higher/Lower', fr ? 'A reference card is drawn. Guess if the next is higher or lower.' : 'A reference card is drawn. Guess if the next is higher or lower.'],
    ['✊ Rock-Paper-Scissors', fr ? 'Pick rock, paper or scissors vs the bot. Win ≈ x2.8, draw = refund.' : 'Pick rock, paper or scissors vs the bot. Win ≈ x2.8, draw = refund.'],
    ['🎨 Color', fr ? 'Guess the drawn color among 4 (red, blue, green, yellow).' : 'Guess the drawn color among 4 (red, blue, green, yellow).'],
    ['🪜 Ladder', fr ? 'Choose how high you climb. Higher = riskier and more rewarding.' : 'Choose how high you climb. Higher = riskier and more rewarding.'],
    ['🎱 Keno', fr ? 'Pick a number from 1 to 10. One is drawn.' : 'Pick a number from 1 to 10. One is drawn.'],
    ['⚔️ War', fr ? 'One card vs the dealer. Highest wins.' : 'One card vs the dealer. Highest wins.'],
    ['🃏 Hi-Lo', fr ? '3 cards. If all high (8+) or all low (7-), you win.' : '3 cards. If all high (8+) or all low (7-), you win.'],
    ['🅱️ Bingo', fr ? 'Pick one of 5 slots. A ball is drawn.' : 'Pick one of 5 slots. A ball is drawn.'],
    ['💎 Jackpot', fr ? '3 symbols. 3 matching = big jackpot, 2 matching = small win.' : '3 symbols. 3 matching = big jackpot, 2 matching = small win.'],
    ['🎲 Dice War', fr ? 'Your die vs dealer. Highest wins.' : 'Your die vs dealer. Highest wins.'],
    ['🪙 Coin Ladder', fr ? 'Chain heads to climb the ladder.' : 'Chain heads to climb the ladder.'],
    ['🃏 Card Match', fr ? 'Find the secret card among 4.' : 'Find the secret card among 4.'],
    ['🔢 Guess the number', fr ? 'A number from 1 to 10.' : 'A number from 1 to 10.'],
    ['💣 Defusal', fr ? 'Cut the right wire among 4.' : 'Cut the right wire among 4.'],
    ['🗺️ Treasure map', fr ? '5 spots, 1 treasure.' : '5 spots, 1 treasure.'],
    ['🃏 High / low card', fr ? 'Card ≥ 8 or ≤ 7.' : 'Card ≥ 8 or ≤ 7.'],
    ['🃏 Pair', fr ? 'Two cards of the same rank.' : 'Two cards of the same rank.'],
    ['🪂 Free fall', fr ? 'Pick your landing zone.' : 'Pick your landing zone.'],
    ['🎈 Balloon', fr ? 'Inflate without popping.' : 'Inflate without popping.'],
    ['🎯 Target', fr ? 'Center, inner or outer.' : 'Center, inner or outer.'],
    ['🔢 Sequence', fr ? '3 numbers in a row.' : '3 numbers in a row.'],
    ['🐾 Animal race', fr ? 'Bet on an animal.' : 'Bet on an animal.'],
    ['🍎 Fruits', fr ? '3 matching fruits or 2.' : '3 matching fruits or 2.'],
    ['💎 Gem hunt', fr ? '6 rocks, 1 gem.' : '6 rocks, 1 gem.'],
    ['⭐ Shooting star', fr ? 'Catch or let pass.' : 'Catch or let pass.'],
    ['🌙 Moon shot', fr ? 'Reach the chosen distance.' : 'Reach the chosen distance.'],
    ['🌋 Volcano', fr ? 'Guess the eruption zone.' : 'Guess the eruption zone.'],
    ['⚡ Lightning', fr ? 'Stay or run from the storm.' : 'Stay or run from the storm.'],
    ['🃏 Poker express', fr ? '3 cards: pair or three of a kind.' : '3 cards: pair or three of a kind.'],
    ['🔴 Red/Black', fr ? 'Card color.' : 'Card color.'],
    ['🔢 Even/Odd', fr ? 'On a die.' : 'On a die.'],
    ['✖️ Multiplier', fr ? 'Hit your multi target.' : 'Hit your multi target.'],
    ['🧠 Memory', fr ? 'Flip 2 cards, find the pair.' : 'Flip 2 cards, find the pair.'],
    ['🌈 Rainbow', fr ? '6 possible colors.' : '6 possible colors.'],
    ['🚀 Rocket 2', fr ? 'High multiplier target.' : 'High multiplier target.'],
    ['🎲 Double die', fr ? 'Guess the exact sum.' : 'Guess the exact sum.'],
    ['📦 Triple chest', fr ? '1 treasure in 3 chests.' : '1 treasure in 3 chests.'],
    ['🎨 Color wheel', fr ? '6-color wheel.' : '6-color wheel.'],
  ];
  if (GAME_LIMIT > 0) lines = lines.slice(0, GAME_LIMIT); // same games as the catalog
  // Multiple embeds if too long
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const [name, rule] of lines) {
    const block = `**${name}**\n${rule}\n\n`;
    if (len + block.length > 3800 && buf.length) {
      chunks.push(buf.join(''));
      buf = [];
      len = 0;
    }
    buf.push(block);
    len += block.length;
  }
  if (buf.length) chunks.push(buf.join(''));
  const embeds = chunks.map((desc, i) =>
    new EmbedBuilder()
      .setColor(0x8B5CF6)
      .setTitle(fr ? `📖 Game rules${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}` : `📖 Game rules${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`)
      .setDescription(desc)
      .setFooter({ text: fr ? 'Bet before playing · private games' : 'Bet before playing · private games' })
  );
  return animPanel({ embeds, components: [] });
}

function modalInput(id, label, { placeholder, value, required = true, max = 30 } = {}) {
  const ti = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
  if (placeholder) ti.setPlaceholder(placeholder);
  if (value) ti.setValue(value);
  return new ActionRowBuilder().addComponents(ti);
}

const betLabel = (bal) => {
  const s = `Bet (balance: ${num(bal)} ${COIN_PLAIN})`;
  return s.length > 45 ? `Bet · balance ${num(bal)}` : s;
};
const BET_PLACEHOLDER = 'e.g.: 1  or  all';

const minesBetModal = (level, bal = 0) =>
  new ModalBuilder()
    .setCustomId(`modal_mines_${level}`)
    .setTitle(`💣 Mines · ${LEVELS[level].name}`.slice(0, 45))
    .addComponents(modalInput('bet', betLabel(bal), { placeholder: BET_PLACEHOLDER }));

const blackjackModal = (bal = 0) =>
  new ModalBuilder()
    .setCustomId('modal_bj')
    .setTitle('🃏 Blackjack')
    .addComponents(modalInput('bet', betLabel(bal), { placeholder: BET_PLACEHOLDER }));

function rouletteModal(key, bal = 0) {
  const m = new ModalBuilder()
    .setCustomId(`modal_rl_${key}`)
    .setTitle(key === 'num' ? '🎡 Roulette · Number' : `🎡 Roulette · ${parseRouletteBet(key)?.label || key}`.slice(0, 45))
    .addComponents(modalInput('bet', betLabel(bal), { placeholder: BET_PLACEHOLDER }));
  if (key === 'num') m.addComponents(modalInput('num', 'Your number (0 to 36)', { placeholder: 'e.g.: 17', max: 2 }));
  return m;
}

const instantBetModal = (key, choice, bal = 0) =>
  new ModalBuilder()
    .setCustomId(`modal_ig_${key}_${choice}`)
    .setTitle((INSTANT[key]?.title || 'Game').slice(0, 45))
    .addComponents(modalInput('bet', betLabel(bal), { placeholder: BET_PLACEHOLDER }));

async function handlePanelButton(i) {
  if (i.customId.startsWith('panel_gamepage_')) {
    // format: panel_gamepage_{mode}_{page}
    const rest = i.customId.slice('panel_gamepage_'.length);
    const parts = rest.split('_');
    const page = Number(parts[parts.length - 1]);
    const mode = parts.slice(0, -1).join('_') || 'all';
    if (!Number.isFinite(page) || page < 0) return i.deferUpdate().catch(() => {});
    return i.update(buildGameMenuPayload(i.user.id, page, mode === 'favs' ? 'favs' : 'all'));
  }

  if (i.customId.startsWith('panel_favtoggle_')) {
    const game = i.customId.slice('panel_favtoggle_'.length);
    const on = toggleFav(i.user.id, game);
    return i.reply({ content: on ? `⭐ **${GAME_NAMES[game] || game}** added to favorites.` : `☆ **${GAME_NAMES[game] || game}** removed from favorites.`, flags: EPH });
  }

  const instantKey = i.customId.slice('panel_'.length);
  if (INSTANT[instantKey]) {
    const payload = INSTANT[instantKey].picker(coef(instantKey));
    payload.embeds.forEach((e) => brand(e, instantKey, 'ZNK Casino  •  Choose, then bet'));
    // Add favorite button
    const favOn = getFavs(i.user.id).has(instantKey);
    const favRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`panel_favtoggle_${instantKey}`)
        .setLabel(favOn ? 'Remove from favorites' : 'Add to favorites')
        .setEmoji('⭐')
        .setStyle(favOn ? ButtonStyle.Secondary : ButtonStyle.Primary)
    );
    const comps = [...(payload.components || []), favRow];
    return i.reply({ ...payload, components: comps, flags: EPH });
  }

  switch (i.customId) {
    case 'panel_start': {
      if (i.guild?.id) userHomeGuild.set(i.user.id, i.guild.id);
      const payload = await buildDmPlayPayload(i.user.id);
      try {
        const dm = await i.user.createDM();
        await dm.send(payload);
        return i.reply({
          content: L(i.user.id, '✅ **Start** sent in your DMs. Open your private messages with the bot.', '✅ **Start** sent in your DMs. Open your private messages with the bot.'),
          flags: EPH,
        });
      } catch {
        return i.reply({
          content: L(i.user.id, '⚠️ Could not DM you (DMs closed). Here’s your private panel instead:', '⚠️ Could not DM you (DMs closed). Here’s your private panel instead:'),
          ...payload,
          flags: EPH,
        });
      }
    }
    case 'panel_play':
      return i.reply({ ...buildGameMenuPayload(i.user.id, 0, 'all'), flags: EPH });
    case 'panel_favs':
      return i.reply({ ...buildGameMenuPayload(i.user.id, 0, 'favs'), flags: EPH });
    case 'panel_search':
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_search_game')
          .setTitle('🔍 Search for a game')
          .addComponents(modalInput('q', 'Game name (e.g.: poker, dice, crash)', { placeholder: 'mines, slots…', max: 40 }))
      );
    case 'panel_home': {
      const payload = await buildDmPlayPayload(i.user.id);
      if (fromEphemeral(i) && (i.isButton() || i.isModalSubmit())) {
        return i.update({ ...payload, attachments: [] });
      }
      return i.reply({ ...payload, flags: EPH });
    }
    case 'panel_settings':
      return i.reply({ ...buildSettingsPayload(i.user.id), flags: EPH });
    case 'panel_lang_fr':
      setLang(i.user.id, 'fr');
      return i.update(buildSettingsPayload(i.user.id));
    case 'panel_lang_en':
      setLang(i.user.id, 'en');
      return i.update(buildSettingsPayload(i.user.id));
    case 'panel_ping':
      setWinPing(i.user.id, !wantsWinPing(i.user.id));
      return i.update(buildSettingsPayload(i.user.id));
    case 'panel_skipanim':
      setSkipAnim(i.user.id, !wantsSkipAnim(i.user.id));
      return i.update(buildSettingsPayload(i.user.id));
    case 'panel_clearall': {
      await i.deferReply({ flags: EPH });
      const channel = i.channel?.isDMBased?.() ? i.channel : await i.user.createDM().catch(() => null);
      if (!channel) return i.editReply({ content: 'Unable to access the conversation.' });
      let deleted = 0;
      try {
        let lastId;
        for (let page = 0; page < 15; page++) {
          const opts = { limit: 100 };
          if (lastId) opts.before = lastId;
          const fetched = await channel.messages.fetch(opts).catch(() => null);
          if (!fetched || !fetched.size) break;
          for (const m of fetched.values()) {
            await m.delete().catch(() => {});
            deleted++;
            await sleep(250);
          }
          lastId = fetched.last()?.id;
          if (fetched.size < 100) break;
        }
      } catch (e) {
        console.error('[clearall]', e?.message || e);
      }
      await channel.send(await buildDmPlayPayload(i.user.id)).catch(() => {});
      return i.editReply({ content: `🧹 **${deleted}** message(s) deleted. Panel resent.` }).catch(() => {});
    }
    case 'panel_stats': {
      await i.deferReply({ flags: EPH });
      return i.editReply(await buildStatsPayload(i.user, getLang(i.user.id)));
    }
    case 'panel_clear': {
      const g = games.get(i.user.id);
      if (g?.timer) clearTimeout(g.timer);
      games.delete(i.user.id);
      unlock(i.user.id);

      const inDm = !i.guild;
      if (inDm || i.channel?.isDMBased?.()) {
        try {
          await i.deferReply({ flags: EPH });
          const channel = i.channel?.isDMBased?.() ? i.channel : await i.user.createDM().catch(() => null);
          if (channel) {
            // Delete as many bot messages as possible
            for (let page = 0; page < 5; page++) {
              const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
              if (!fetched || fetched.size === 0) break;
              const mine = fetched.filter((m) => m.author.id === client.user.id);
              if (mine.size === 0) break;
              for (const m of mine.values()) await m.delete().catch(() => {});
              if (mine.size < 100) break;
            }
            await channel.send(await buildDmPlayPayload(i.user.id));
          }
          return i.editReply({
            content: L(i.user.id, '🧹 Everything cleaned · games closed · fresh panel sent.', '🧹 Everything cleaned · games closed · fresh panel sent.'),
          });
        } catch (e) {
          console.error('[clear dm]', e?.message || e);
        }
      }

      return i.reply({
        content: L(i.user.id, '🧹 Open games closed. Use **Start** for a clean private panel.', '🧹 Open games closed. Use **Start** for a clean private panel.'),
        flags: EPH,
      });
    }
    case 'panel_mines': {
      const pl = minesPickerPayload();
      pl.embeds.forEach((e) => brand(e, 'mines', 'ZNK Casino  •  Choose your difficulty'));
      return i.reply({ ...pl, flags: EPH });
    }
    case 'panel_bj': {
      const bal = await getBalance(i.user.id);
      return i.showModal(blackjackModal(bal));
    }
    case 'panel_roulette': {
      const pl = roulettePickerPayload();
      pl.embeds.forEach((e) => brand(e, 'roulette', 'ZNK Casino  •  Place your bet'));
      return i.reply({ ...pl, flags: EPH });
    }
    case 'panel_daily': {
      const res = await rpc('claim_daily', { p_user_id: i.user.id, p_amount: DAILY_AMOUNT });
      if (res?.balance != null) await touchPeak(i.user.id, res.balance);
      const dtxt = res?.claimed
        ? `🎁 ${t(i.user.id, 'dailyOk')} **${fmt(DAILY_AMOUNT)}** ! ${t(i.user.id, 'newBalance')} : **${fmt(res.balance)}**`
        : `🎁 ${t(i.user.id, 'dailyAlready')}\n${t(i.user.id, 'yourBalance')} : **${fmt(res?.balance ?? 0)}**`;
      return i.reply({ ...(await dailyPayload(i.user, res, dtxt)), flags: EPH });
    }
    case 'panel_rules': {
      return i.reply({ ...buildRulesPayload(i.user.id), flags: EPH });
    }
    case 'panel_history': {
      await i.deferReply({ flags: EPH });
      return i.editReply({ embeds: [await historyEmbed(i.user.id)] });
    }
    case 'panel_invites': {
      await i.deferReply({ flags: EPH });
      if (!i.guild) return i.editReply({ content: 'Invitations can be checked from the server.' });
      return i.editReply(await buildInvitesPayload(i.guild, i.user.id, getLang(i.user.id)));
    }
    case 'panel_send': {
      // Send by username: server members only
      const guildId = resolveGuildId(i);
      if (!guildId) {
        return i.reply({
          content: L(i.user.id, '⚠️ Use **Start** from the server to send coins.', '⚠️ Use **Start** from the server to send coins.'),
          flags: EPH,
        });
      }
      const bal = await getBalance(i.user.id);
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_send_name')
          .setTitle(L(i.user.id, `💸 Send ${COIN_PLAIN}`, `💸 Send ${COIN_PLAIN}`))
          .addComponents(
            modalInput('to', L(i.user.id, 'Exact username', 'Exact username'), {
              placeholder: L(i.user.id, 'e.g.: JohnDoe', 'e.g.: JohnDoe'),
              max: 32,
            }),
            modalInput('amount', betLabel(bal), { placeholder: 'e.g.: 5  or  all' })
          )
      );
    }
    default:
      return;
  }
}

async function handleModalSubmit(i) {
  const id = i.customId;
  const get = (k) => i.fields.getTextInputValue(k).trim();

  const readBet = async () => {
    const bal = await getBalance(i.user.id);
    return parseAmount(get('bet'), bal);
  };
  const badBet = () => respondText(i, 'Invalid bet: enter a number (e.g. 1 or 2.5) or "all".');

  if (id.startsWith('modal_mines_')) {
    const level = id.slice('modal_mines_'.length);
    if (!LEVELS[level]) return;
    const bet = await readBet();
    return bet ? startMines(i, level, bet) : badBet();
  }
  if (id === 'modal_bj') {
    const bet = await readBet();
    return bet ? startBlackjack(i, bet) : badBet();
  }
  if (id.startsWith('modal_ig_')) {
    const [, , key, choice] = id.split('_');
    if (!INSTANT[key] || !INSTANT[key].choices.includes(choice)) return;
    const bet = await readBet();
    return bet ? playInstant(i, key, bet, choice) : badBet();
  }
  if (id.startsWith('modal_rl_')) {
    const key = id.slice('modal_rl_'.length);
    const choiceStr = key === 'num' ? get('num') : key;
    if (!parseRouletteBet(choiceStr)) return respondText(i, 'Invalid number: enter a number from 0 to 36.');
    const bet = await readBet();
    return bet ? playRoulette(i, bet, choiceStr) : badBet();
  }
  if (id === 'modal_send_name' || id.startsWith('modal_send_')) {
    let toId = null;
    if (id === 'modal_send_name') {
      const name = String(get('to') || '').trim().toLowerCase();
      if (!name) return respondText(i, L(i.user.id, 'Enter a username.', 'Enter a username.'));
      const guildId = resolveGuildId(i);
      if (!guildId) {
        return respondText(i, L(i.user.id, 'Open Start from the server to send coins.', 'Open Start from the server to send coins.'));
      }
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return respondText(i, L(i.user.id, 'Server not found.', 'Server not found.'));
      // Find the member by username or globalName (must be on the server)
      let member = guild.members.cache.find(
        (m) =>
          !m.user.bot &&
          (m.user.username.toLowerCase() === name ||
            (m.user.globalName && m.user.globalName.toLowerCase() === name) ||
            (m.nickname && m.nickname.toLowerCase() === name))
      );
      if (!member) {
        try {
          await guild.members.fetch();
          member = guild.members.cache.find(
            (m) =>
              !m.user.bot &&
              (m.user.username.toLowerCase() === name ||
                (m.user.globalName && m.user.globalName.toLowerCase() === name) ||
                (m.nickname && m.nickname.toLowerCase() === name))
          );
        } catch {
          /* ignore */
        }
      }
      if (!member) {
        return respondText(
          i,
          L(
            i.user.id,
            `❌ No member **${escapeMarkdown(get('to'))}** found on the server. Username must be exact and the person must be on the server.`,
            `❌ No member **${escapeMarkdown(get('to'))}** found on the server. Username must be exact and the person must be on the server.`
          )
        );
      }
      toId = member.id;
    } else {
      toId = id.slice('modal_send_'.length);
      if (!/^\d{15,25}$/.test(toId)) {
        return respondText(i, L(i.user.id, 'Invalid recipient.', 'Invalid recipient.'));
      }
    }
    if (toId === i.user.id) {
      return respondText(i, L(i.user.id, `❌ You cannot send ${COIN} to yourself.`, `❌ You cannot send ${COIN} to yourself.`));
    }
    const bal = await getBalance(i.user.id);
    const amount = parseAmount(get('amount'), bal);
    if (!amount) return respondText(i, 'Invalid amount: number or "all".');
    if (amount > bal) return respondText(i, t(i.user.id, 'insufficient'));
    const newBal = await debit(i.user.id, amount);
    if (newBal === null) return respondText(i, t(i.user.id, 'insufficient'));
    const toBal = await credit(toId, amount);
    const toUser = await client.users.fetch(toId).catch(() => null);
    const tcard = await makeCard('transfer', {
      avatar: i.user,
      tag: 'TRANSFER',
      headline: userName(i.user),
      sub: `sent to ${userName(toUser)}`,
      barLeft: 'AMOUNT',
      barRight: coinTxt(amount),
      cells: [
        ['FROM', userName(i.user)],
        ['TO', userName(toUser)],
        ['AMOUNT', coinTxt(amount), '#86EFAC'],
        ['YOUR BALANCE', coinTxt(newBal)],
        ['RECIPIENT BALANCE', coinTxt(toBal)],
        ['DATE', dateFR()],
      ],
    });
    // DM notification to the recipient
    const dmPayload = {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.green)
          .setTitle(`💸 You received ${COIN_PLAIN}`)
          .setDescription(
            `<@${i.user.id}> sent you **${fmt(amount)}**.\n` +
              `New balance: **${fmt(toBal)}**`
          )
          .setTimestamp(),
      ],
    };
    putCard(dmPayload, tcard);
    await dmUser(toId, dmPayload);
    const sendReply = {
      content:
        `✅ **${fmt(amount)}** → <@${toId}>\n` +
        `💰 ${t(i.user.id, 'yourBalance')} : **${fmt(newBal)}** · Recipient: **${fmt(toBal)}**`,
      flags: EPH,
    };
    if (tcard) {
      const se = new EmbedBuilder().setColor(COLORS.violet);
      putCard(sendReply, tcard, se);
      sendReply.embeds = [se];
    }
    return i.reply(sendReply);
  }
}

async function handleReplay(i) {
  const [, type, betStr, arg] = i.customId.split('|');
  const bet = Number(betStr);
  if (!Number.isFinite(bet) || bet <= 0) return respondText(i, 'Invalid bet.');
  if (type === 'mines') return startMines(i, arg, bet);
  if (type === 'bj') return startBlackjack(i, bet);
  if (type === 'rl') return playRoulette(i, bet, arg);
  if (INSTANT[type]) return playInstant(i, type, bet, arg);
}

// ============================================================
//  ADMIN PANEL (owner only)
// ============================================================
function buildAdminPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xEF4444)
    .setTitle('✦ Admin')
    .setDescription(`Owner control · currency **${COIN}**\nEvery public action shows **who** did it.`)
    .addFields(
      { name: '💰 Economy', value: 'Add · Remove · Set · View · Gift all', inline: false },
      { name: '💥 Resets', value: 'Balances · All-time · Stats', inline: true },
      { name: '🎚️ Live', value: 'Multipliers · Events · Boosts', inline: true },
      { name: '📡 Channels', value: 'All-time · Notifications · Leaderboard', inline: true }
    )
    .setFooter({ text: 'Owner only' })
    .setTimestamp();
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_add').setLabel('Add').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_remove').setLabel('Remove').setEmoji('➖').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_set').setLabel('Set').setEmoji('🎯').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_view').setLabel('View').setEmoji('👀').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_all').setLabel('Gift all').setEmoji('🎁').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_reset').setLabel('Reset balances').setEmoji('💥').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_resetpeaks').setLabel('Reset all-time').setEmoji('👑').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_resetstats').setLabel('Reset stats').setEmoji('📊').setStyle(ButtonStyle.Danger)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_mult').setLabel('Multipliers').setEmoji('🎚️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_event').setLabel('Event').setEmoji('📢').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_annonce').setLabel('Announcement').setEmoji('📣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_alltimechan').setLabel('All-time channel').setEmoji('🏆').setStyle(ButtonStyle.Secondary)
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_notifchan').setLabel('Notifications channel').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_pokerchan').setLabel('Online channel').setEmoji('🌐').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_top').setLabel('Leaderboard').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_topall').setLabel('All-time').setEmoji('👑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_stats').setLabel('Player stats').setEmoji('📊').setStyle(ButtonStyle.Primary)
  );
  return withBanner({ embeds: [embed], components: [row1, row2, row3, row4] }, 'panel_admin.png');
}

// ---------- Events (claim, giveaway, boosts) ----------
const activeEvents = new Map();

const EVENT_TYPES = [
  { id: 'claim', label: 'Quick claim', desc: 'First N players to click win' },
  { id: 'giveaway', label: 'Giveaway', desc: 'Sign-ups, draw when the timer ends' },
  { id: 'x2win', label: 'x2 Wins', desc: 'All wins are doubled for X minutes' },
  { id: 'x2lose', label: 'x2 Losses', desc: 'Losses are doubled for X minutes' },
  { id: 'x2both', label: 'x2 Wins & Losses', desc: 'Wins and losses x2 for X minutes' },
  { id: 'lucky', label: 'Lucky hour', desc: 'Wins x1.5 for X minutes' },
  { id: 'goldrush', label: 'Gold rush', desc: 'Wins x3 for X minutes' },
];

const BOOST_PRESETS = {
  x2win: { winMult: 2, loseMult: 1, label: 'x2 Wins 🔥' },
  x2lose: { winMult: 1, loseMult: 2, label: 'x2 Losses 💀' },
  x2both: { winMult: 2, loseMult: 2, label: 'x2 Wins & Losses ⚡' },
  lucky: { winMult: 1.5, loseMult: 1, label: 'Lucky Hour 🍀' },
  goldrush: { winMult: 3, loseMult: 1, label: 'Gold Rush 🏆' },
};
/** sends an event notification to the site inbox (all players on the server) */
function webEvent(guildId, n) {
  try { if (webApp && webApp.pushEvent) webApp.pushEvent(String(guildId), n); } catch (e) { console.error('[web event]', e?.message || e); }
}
const boostText = (p, minutes) => [p.winMult !== 1 ? `Wins ×${p.winMult}` : '', p.loseMult !== 1 ? `Losses ×${p.loseMult}` : '', `for ${minutes} min`].filter(Boolean).join(' · ');
const evNotif = (ev, eventId) => ({
  kind: ev.type, eventId,
  title: ev.type === 'giveaway' ? '🎉 Giveaway' : '📢 Claim: first come, first served',
  text: ev.type === 'giveaway' ? `Prize: ${num(ev.amount)} × ${ev.maxWinners} winner(s) · drawing ${ev.expiresAt ? 'in ' + Math.max(1, Math.round((ev.expiresAt - Date.now()) / 60000)) + ' min' : ''}` : `${num(ev.amount)} per winner · ${ev.maxWinners} spot(s)` + (ev.expiresAt ? ` · ${Math.max(1, Math.round((ev.expiresAt - Date.now()) / 60000))} min` : ''),
  amount: ev.amount, expiresAt: ev.expiresAt || 0,
});

function claimEventEmbed(ev) {
  const left = ev.maxWinners - ev.winners.size;
  const host = ev.hostId ? `👤 By <@${ev.hostId}>\n` : '';
  const e = new EmbedBuilder().setTitle('📢 Claim: first come, first served').setColor(left > 0 ? COLORS.violet : COLORS.grey);
  if (ev.finished || left <= 0) {
    const names = [...ev.winners].map((id) => `<@${id}>`).join(', ') || 'no one';
    e.setDescription(`${host}🏁 **Finished** · winner(s): ${names}\nEach received **${fmt(ev.amount)}**.`);
  } else {
    const timeLine = ev.expiresAt ? `\n⏱️ Expires <t:${Math.floor(ev.expiresAt / 1000)}:R>` : '\n⏱️ No limit';
    e.setDescription(
      `${host}🎁 **${fmt(ev.amount)}** per winner\n` +
        `Spots remaining: **${left}/${ev.maxWinners}**\n` +
        `Click **Claim** to collect your share!${timeLine}`
    );
  }
  return e;
}

function giveawayEmbed(ev) {
  const host = ev.hostId ? `👤 By <@${ev.hostId}>\n` : '';
  const e = new EmbedBuilder().setTitle('🎉 Giveaway').setColor(ev.finished ? COLORS.grey : COLORS.gold);
  if (ev.finished) {
    const names = [...ev.winners].map((id) => `<@${id}>`).join(', ') || 'no one';
    e.setDescription(
      `${host}🏁 **Giveaway finished**\nWinner(s): ${names}\nPrize: **${fmt(ev.amount)}** each\n` +
        `Participants: **${ev.entries.size}**`
    );
  } else {
    e.setDescription(
      `${host}🎁 Prize: **${fmt(ev.amount)}** × **${ev.maxWinners}** winner(s)\n` +
        `Click **Join** to enter!\n` +
        `👥 Entrants: **${ev.entries.size}**\n` +
        `⏱️ Drawing <t:${Math.floor(ev.expiresAt / 1000)}:R>`
    );
  }
  return e;
}

function eventActionRow(eventId, type, disabled) {
  if (type === 'giveaway') {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`event_join_${eventId}`)
        .setLabel(disabled ? 'Finished' : 'Join')
        .setEmoji(disabled ? '🏁' : '🎟️')
        .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(!!disabled)
    );
  }
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_claim_${eventId}`)
      .setLabel(disabled ? 'Finished' : 'Claim')
      .setEmoji(disabled ? '🏁' : '🎁')
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!!disabled)
  );
}

async function finishGiveaway(eventId) {
  const ev = activeEvents.get(eventId);
  if (!ev || ev.finished || ev.type !== 'giveaway') return;
  ev.finished = true;
  clearTimeout(ev.timer);

  const pool = [...ev.entries];
  shuffle(pool);
  const winners = pool.slice(0, Math.min(ev.maxWinners, pool.length));
  for (const uid of winners) {
    ev.winners.add(uid);
    try {
      await credit(uid, ev.amount);
    } catch (e) {
      console.error('[giveaway] credit', e?.message || e);
    }
  }
  webEvent(ev.guildId, { kind: 'giveaway_end', title: '🎉 Giveaway finished', text: `Winner(s): ${[...ev.winners].map((id) => { const u = client.users.cache.get(id); return u ? u.globalName || u.username : id; }).join(', ') || 'no one'} · ${num(ev.amount)} each` });
  activeEvents.delete(eventId);
}

async function expireClaimEvent(eventId) {
  const ev = activeEvents.get(eventId);
  if (!ev || ev.finished || ev.type !== 'claim') return;
  ev.finished = true;
  clearTimeout(ev.timer);
  activeEvents.delete(eventId);
}

async function handleEventClaim(i) {
  const eventId = i.customId.slice('event_claim_'.length);
  const ev = activeEvents.get(eventId);
  if (!ev || ev.finished || ev.type !== 'claim') {
    return i.reply({ content: 'This reward is no longer available.' });
  }
  if (ev.expiresAt && Date.now() > ev.expiresAt) {
    await expireClaimEvent(eventId);
    return i.reply({ content: '⏱️ This event has expired.' });
  }
  if (ev.winners.has(i.user.id)) return i.reply({ content: 'You already claimed your share!' });
  if (ev.winners.size >= ev.maxWinners) {
    ev.finished = true;
    activeEvents.delete(eventId);
    return i.reply({ content: 'No more spots available.' });
  }

  ev.winners.add(i.user.id);
  const done = ev.winners.size >= ev.maxWinners;
  if (done) {
    ev.finished = true;
    clearTimeout(ev.timer);
    activeEvents.delete(eventId);
  }

  try {
    await credit(i.user.id, ev.amount);
    await i.update({
      embeds: [claimEventEmbed(ev)],
      components: [eventActionRow(eventId, 'claim', true)],
    }).catch(() => i.reply({ content: `✅ You received **${fmt(ev.amount)}**!` }));
    await i.followUp({ content: `✅ You received **${fmt(ev.amount)}**!` }).catch(() => {});
  } catch (e) {
    ev.winners.delete(i.user.id);
    console.error('[event] claim', e?.message || e);
    if (!i.replied && !i.deferred) {
      await i.reply({ content: '⚠️ Error while crediting.' }).catch(() => {});
    }
  }
}

async function handleEventJoin(i) {
  const eventId = i.customId.slice('event_join_'.length);
  const ev = activeEvents.get(eventId);
  if (!ev || ev.finished || ev.type !== 'giveaway') return i.reply({ content: 'This giveaway is finished.' });
  if (ev.expiresAt && Date.now() > ev.expiresAt) {
    await finishGiveaway(eventId);
    return i.reply({ content: '⏱️ The giveaway is finished.' });
  }
  if (ev.entries.has(i.user.id)) return i.reply({ content: 'You are already entered!' });
  ev.entries.add(i.user.id);
  try {
    await i.update({
      embeds: [giveawayEmbed(ev)],
      components: [eventActionRow(eventId, 'giveaway', false)],
    }).catch(() => {});
    await i.followUp({ content: '🎟️ You are entered in the giveaway! Good luck.' }).catch(() =>
      i.reply({ content: '🎟️ You are entered in the giveaway! Good luck.' }).catch(() => {})
    );
  } catch (e) {
    console.error('[giveaway] join', e?.message || e);
  }
}

async function postBoostEvent(i, kind, minutes) {
  const presets = BOOST_PRESETS;
  const p = presets[kind];
  if (!p) return respondText(i, 'Unknown boost type.');
  if (!minutes || minutes < 1) return respondText(i, 'Enter a duration in minutes (min. 1).');

  await startBoost(i.guild.id, { ...p, minutes });
  webEvent(i.guild.id, { kind: 'boost', title: `⚡ Boost: ${p.label}`, text: boostText(p, minutes), expiresAt: Date.now() + minutes * 60_000 });
  return i.reply({ content: `✅ Boost **${p.label}** started · popup shown on the site.`, flags: EPH });
}

async function createClaimOrGiveaway(i, type, amount, winners, minutes) {
  if (type === 'giveaway' && (!minutes || minutes < 1)) {
    return respondText(i, 'A giveaway must have a duration (minutes ≥ 1).');
  }

  const eventId = `${Date.now().toString(36)}_${randomInt(1000, 9999)}`;
  const expiresAt = minutes > 0 ? Date.now() + minutes * 60_000 : null;
  const maxWinners = Math.max(1, Math.min(50, winners || 1));

  const ev = {
    type,
    amount,
    maxWinners,
    winners: new Set(),
    entries: new Set(),
    guildId: i.guild.id,
    channelId: null,
    messageId: null,
    expiresAt,
    finished: false,
    timer: null,
    hostId: i.user.id,
    dmMode: true,
  };

  if (type === 'giveaway') ev.timer = setTimeout(() => finishGiveaway(eventId), expiresAt - Date.now());
  else if (expiresAt) ev.timer = setTimeout(() => expireClaimEvent(eventId), expiresAt - Date.now());
  activeEvents.set(eventId, ev);
  webEvent(ev.guildId, evNotif(ev, eventId));

  return i.reply({
    content:
      type === 'giveaway'
        ? `✅ Giveaway created: **${fmt(amount)}** × ${maxWinners} · drawing in **${minutes} min** · popup shown on the site.`
        : `✅ Claim created: **${fmt(amount)}** × ${maxWinners}` +
          (minutes > 0 ? ` · expires in **${minutes} min**` : '') +
          ' · popup shown on the site.',
    flags: EPH,
  });
}

// ---------- Events launched / used from the site ----------
async function webLaunchBoost(guildId, hostId, kind, minutes) {
  const p = BOOST_PRESETS[kind];
  if (!p) throw new Error('Unknown boost type.');
  minutes = Math.max(1, Math.min(24 * 60, Math.floor(Number(minutes) || 0)));
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw new Error('Server not found.');
  await startBoost(guildId, { ...p, minutes });
  webEvent(guildId, { kind: 'boost', title: `⚡ Boost: ${p.label}`, text: boostText(p, minutes), expiresAt: Date.now() + minutes * 60_000 });
  return { label: p.label, minutes };
}

async function webLaunchEvent(guildId, hostId, type, amount, winners, minutes) {
  if (type !== 'claim' && type !== 'giveaway') throw new Error('Unknown event type.');
  amount = round2(Number(amount));
  if (!(amount > 0) || amount > MAX_ADMIN_AMOUNT) throw new Error(`Invalid amount (between 0.01 and ${num(MAX_ADMIN_AMOUNT)}).`);
  minutes = Math.max(0, Math.min(24 * 60, Math.floor(Number(minutes) || 0)));
  if (type === 'giveaway' && minutes < 1) throw new Error('A giveaway must have a duration (minutes ≥ 1).');
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throw new Error('Server not found.');
  const eventId = `${Date.now().toString(36)}_${randomInt(1000, 9999)}`;
  const expiresAt = minutes > 0 ? Date.now() + minutes * 60_000 : null;
  const ev = { type, amount, maxWinners: Math.max(1, Math.min(50, Math.floor(Number(winners) || 1))), winners: new Set(), entries: new Set(), guildId, channelId: null, messageId: null, expiresAt, finished: false, timer: null, hostId, dmMode: true };
  if (type === 'giveaway') ev.timer = setTimeout(() => finishGiveaway(eventId), expiresAt - Date.now());
  else if (expiresAt) ev.timer = setTimeout(() => expireClaimEvent(eventId), expiresAt - Date.now());
  activeEvents.set(eventId, ev);
  webEvent(guildId, evNotif(ev, eventId));
  return { type, amount, winners: ev.maxWinners, minutes };
}

async function webEventClaim(uid, guildId, eventId) {
  const ev = activeEvents.get(eventId);
  if (!ev || ev.guildId !== guildId || ev.finished || ev.type !== 'claim') return { ok: false, msg: 'This reward is no longer available.' };
  if (ev.expiresAt && Date.now() > ev.expiresAt) { await expireClaimEvent(eventId); return { ok: false, msg: 'This event has expired.' }; }
  if (ev.winners.has(uid)) return { ok: false, msg: 'You already claimed your share!' };
  if (ev.winners.size >= ev.maxWinners) { ev.finished = true; activeEvents.delete(eventId); return { ok: false, msg: 'No more spots available.' }; }
  ev.winners.add(uid);
  if (ev.winners.size >= ev.maxWinners) { ev.finished = true; clearTimeout(ev.timer); activeEvents.delete(eventId); }
  try {
    const balance = await credit(uid, ev.amount);
    return { ok: true, msg: `You received ${num(ev.amount)}!`, balance };
  } catch (e) {
    ev.winners.delete(uid);
    console.error('[event web] claim', e?.message || e);
    return { ok: false, msg: 'Error while crediting.' };
  }
}

async function webEventJoin(uid, guildId, eventId) {
  const ev = activeEvents.get(eventId);
  if (!ev || ev.guildId !== guildId || ev.finished || ev.type !== 'giveaway') return { ok: false, msg: 'This giveaway is finished.' };
  if (ev.expiresAt && Date.now() > ev.expiresAt) { await finishGiveaway(eventId); return { ok: false, msg: 'The giveaway is finished.' }; }
  if (ev.entries.has(uid)) return { ok: false, msg: 'You are already entered!' };
  ev.entries.add(uid);
  return { ok: true, msg: 'You are entered in the giveaway! Good luck.' };
}

const MULT_INFO = {
  mines: () => `1st 💎: Easy ${fx(minesMultiplier(1, LEVELS.easy.mines))} · Impossible ${fx(minesMultiplier(1, LEVELS.impossible.mines))}`,
  bj: (c) => `win ${fx(2 * c)} · blackjack ${fx(2.5 * c)}`,
  roulette: (c) => `color/even/odd ${fx(2 * c)} · number ${fx(36 * c)}`,
};

function multAdminPayload(note, page = 0) {
  const games = Object.keys(GAME_NAMES);
  const PAGE = 23;
  const totalPages = Math.max(1, Math.ceil(games.length / PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const slice = games.slice(p * PAGE, p * PAGE + PAGE);

  const lines = slice.map((g) => {
    const c = coef(g);
    let info = '';
    try {
      const fn = MULT_INFO[g] || INSTANT[g]?.info;
      info = fn ? fn(c) : '—';
    } catch {
      info = '—';
    }
    return `**${GAME_NAMES[g]}** · coef ${fx(c)}\n└ ${info}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('🎚️ Game multipliers')
    .setColor(COLORS.red)
    .setDescription(
      `Multiplier × all winnings (x1.00 = normal). Range ${fx(MULT_MIN)}–${fx(MULT_MAX)}.\n` +
        `**Page ${p + 1}/${totalPages}**\n\n${lines.join('\n\n')}`.slice(0, 4000) +
        (note ? `\n\n${note}` : '')
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId('admin_multpick')
    .setPlaceholder('Choose the game to modify')
    .addOptions(
      slice.map((g) => ({
        label: (GAME_NAMES[g] || g).replace(/^\S+\s/, '').slice(0, 100),
        value: g,
        description: `Current multiplier: ${fx(coef(g))}`.slice(0, 100),
      }))
    );

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin_multpage_${p - 1}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p <= 0),
    new ButtonBuilder()
      .setCustomId(`admin_multpage_${p + 1}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= totalPages - 1)
  );

  return animPanel({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select), nav] });
}

const ADMIN_TITLES = {
  add: '➕ Add money: choose the member',
  remove: '➖ Remove money: choose the member',
  set: '🎯 Set balance: choose the member',
  view: '👀 View a balance: choose the member',
  stats: '📊 Player stats: choose the member',
};

async function handleAdmin(i) {
  if (!i.guild) return i.reply({ content: CROWN_ONLY, flags: EPH });
  if (i.user.id !== i.guild.ownerId) return i.reply({ content: CROWN_ONLY, flags: EPH });
  const id = i.customId;

  if (i.isButton()) {
    const action = id.slice('admin_'.length);
    if (action === 'mult') return i.reply({ ...multAdminPayload(null, 0), flags: EPH });
    if (action.startsWith('multpage_')) {
      const page = Number(action.slice('multpage_'.length));
      if (!Number.isFinite(page) || page < 0) return i.deferUpdate().catch(() => {});
      return i.update(multAdminPayload(null, page));
    }
    if (action === 'event') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('admin_eventpick')
        .setPlaceholder('Event type')
        .addOptions(EVENT_TYPES.map((et) => ({ label: et.label, value: et.id, description: et.desc.slice(0, 100) })));
      return i.reply({
        content: '📢 Choose the event type:',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: EPH,
      });
    }
    if (action === 'reset') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_reset')
          .setTitle('💥 Reset all balances')
          .addComponents(modalInput('confirm', 'Type RESET to confirm', { placeholder: 'RESET', max: 10 }))
      );
    }
    if (action === 'resetpeaks') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_resetpeaks')
          .setTitle('👑 Reset all-time leaderboard')
          .addComponents(modalInput('confirm', 'Type RESET to confirm', { placeholder: 'RESET', max: 10 }))
      );
    }
    if (action === 'resetstats') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_resetstats')
          .setTitle('📊 Reset all stats')
          .addComponents(modalInput('confirm', 'Type RESET to confirm', { placeholder: 'RESET', max: 10 }))
      );
    }
    if (action === 'top') {
      await i.deferReply({ flags: EPH });
      return i.editReply(await buildBoardPayload('rich', { lang: 'en' }));
    }
    if (action === 'topall') {
      await i.deferReply({ flags: EPH });
      return i.editReply(await buildBoardPayload('alltime', { lang: 'en' }));
    }
    if (action === 'annonce') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_annonce')
          .setTitle('📣 Reward announcement')
          .addComponents(
            modalInput('amount', `Number of ${COIN_PLAIN}`, { placeholder: 'e.g.: 100' }),
            modalInput('reward', 'Reward (text)', { placeholder: 'e.g.: one month of Nitro', max: 100 })
          )
      );
    }
    if (action === 'alltimechan') return createAllTimeChannel(i);
    if (action === 'pokerchan') return createPokerChannel(i);
    if (action === 'notifchan') {
      const current = guildChannels.get(`${i.guild.id}:notifs`);
      const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('admin_notifpick')
          .setPlaceholder('Choose the notifications channel')
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
      return i.reply({
        content:
          `🔔 Choose the channel where admin notifications are sent (gift all, reset, giveaway, boosts, announcements...).\n` +
          (current ? `Current channel: <#${current}>` : `Currently: **casino** channel (default).`),
        components: [row],
        flags: EPH,
      });
    }
    if (ADMIN_TITLES[action]) {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`admin_pick_${action}`).setPlaceholder('Choose a member').setMinValues(1).setMaxValues(1)
      );
      return i.reply({ content: ADMIN_TITLES[action], components: [row], flags: EPH });
    }
    if (action === 'all') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_all')
          .setTitle('🎁 Gift to everyone')
          .addComponents(modalInput('amount', 'Amount gifted to each player', { placeholder: 'e.g.: 10' }))
      );
    }
    return;
  }

  if (i.isStringSelectMenu() && id === 'admin_multpick') {
    const game = i.values[0];
    if (!GAME_NAMES[game]) return;
    return i.showModal(
      new ModalBuilder()
        .setCustomId(`modal_admin_mult_${game}`)
        .setTitle(`🎚️ ${GAME_NAMES[game]}`.slice(0, 45))
        .addComponents(
          modalInput('amount', `Multiplier (${MULT_MIN} to ${MULT_MAX}, 1 = normal)`, {
            placeholder: 'ex : 1.5',
            value: String(coef(game)),
            max: 6,
          })
        )
    );
  }

  if (i.isStringSelectMenu() && id === 'admin_eventpick') {
    const kind = i.values[0];
    if (['x2win', 'x2lose', 'x2both', 'lucky', 'goldrush'].includes(kind)) {
      return i.showModal(
        new ModalBuilder()
          .setCustomId(`modal_admin_boost_${kind}`)
          .setTitle(`⚡ ${EVENT_TYPES.find((et) => et.id === kind)?.label || 'Boost'}`.slice(0, 45))
          .addComponents(modalInput('minutes', 'Duration in minutes', { placeholder: 'e.g.: 15', value: '15', max: 6 }))
      );
    }
    if (kind === 'claim' || kind === 'giveaway') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId(`modal_admin_event_${kind}`)
          .setTitle(kind === 'giveaway' ? '🎉 Giveaway' : '📢 Claim multi-gagnants')
          .addComponents(
            modalInput('amount', 'Amount per winner', { placeholder: 'e.g.: 50' }),
            modalInput('winners', 'Number of winners', { placeholder: 'e.g.: 3', value: '1', max: 3 }),
            modalInput('minutes', kind === 'giveaway' ? 'Duration before drawing (min)' : 'Max duration (0 = unlimited)', {
              placeholder: 'ex : 10',
              value: kind === 'giveaway' ? '10' : '5',
              required: false,
              max: 6,
            })
          )
      );
    }
    return;
  }

  if (i.isChannelSelectMenu && i.isChannelSelectMenu() && id === 'admin_notifpick') {
    const channelId = i.values[0];
    const saved = await saveChannel(i.guild.id, 'notifs', channelId);
    return i.update({
      content:
        `✅ Notification channel set: <#${channelId}>\n` +
        `Gift all, reset, giveaway, boosts, announcements, multipliers will be posted there.` +
        (saved ? '' : DB_WARN),
      components: [],
    });
  }

  if (i.isUserSelectMenu() && id.startsWith('admin_pick_')) {
    const action = id.slice('admin_pick_'.length);
    const userId = i.values[0];
    if (i.users?.get(userId)?.bot) return i.update({ content: '❌ Choose a real member, not a bot.', components: [] });
    if (action === 'view') {
      const bal = await getBalance(userId);
      return i.update({ content: `💰 Balance of <@${userId}>: **${fmt(bal)}**`, components: [] });
    }
    if (action === 'stats') {
      await i.deferUpdate();
      const target = i.users?.get(userId) || (await client.users.fetch(userId).catch(() => null));
      if (!target) return i.editReply({ content: '❌ Player not found.', components: [] });
      const payload = await buildStatsPayload(target, 'en', ' · admin view');
      return i.editReply({ content: `📊 Stats for <@${userId}>`, components: [], ...payload });
    }
    const titles = { add: '➕ Add', remove: '➖ Remove', set: '🎯 Set balance' };
    if (!titles[action]) return;
    return i.showModal(
      new ModalBuilder()
        .setCustomId(`modal_admin_${action}_${userId}`)
        .setTitle(titles[action])
        .addComponents(modalInput('amount', action === 'set' ? 'New balance' : 'Amount', { placeholder: 'e.g.: 10' }))
    );
  }

  if (i.isModalSubmit()) {
    if (id === 'modal_admin_reset') {
      const confirm = i.fields.getTextInputValue('confirm')?.trim().toUpperCase();
      if (confirm !== 'RESET') return respondText(i, 'Cancelled: you must type **RESET** to confirm.');
      try {
        const { data, error } = await supabase
          .from('players')
          .update({ balance: 0, updated_at: new Date().toISOString() })
          .neq('user_id', '__impossible__')
          .select('user_id');
        if (error) throw error;
        const count = data?.length ?? 0;
        await i.reply({ content: `✅ Balances reset: **${count}** player(s) to 0. Sending DMs…`, flags: EPH });
        const { ok, fail } = await dmGuildEveryone(i.guild, {
          embeds: [
            new EmbedBuilder()
              .setTitle('💥 Reset balances')
              .setColor(COLORS.red)
              .setDescription(`👤 By <@${i.user.id}>\nAll balances were reset to **0**.`)
              .setTimestamp(),
          ],
        });
        return i.followUp({ content: `📬 DMs: **${ok}** ok · **${fail}** failed.`, flags: EPH }).catch(() => {});
      } catch (e) {
        console.error('[reset]', e?.message || e);
        return respondText(i, `Reset error: ${explainError(e)}`);
      }
    }

    if (id === 'modal_admin_resetpeaks') {
      const confirm = i.fields.getTextInputValue('confirm')?.trim().toUpperCase();
      if (confirm !== 'RESET') return respondText(i, 'Cancelled: you must type **RESET** to confirm.');
      peaks.clear();
      savePeaksLocal();
      try {
        await supabase.from('player_peaks').update({ peak: 0 }).neq('user_id', '__impossible__');
      } catch (e) {
        console.error('[resetpeaks]', e?.message || e);
      }
      await i.reply({ content: '✅ All-time leaderboard reset. Sending DMs…', flags: EPH });
      const r1 = await dmGuildEveryone(i.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle('👑 Reset all-time leaderboard')
            .setColor(COLORS.red)
            .setDescription(`👤 By <@${i.user.id}>\nAll peak balance records were cleared.`)
            .setTimestamp(),
        ],
      });
      return i.followUp({ content: `📬 DMs: **${r1.ok}** ok · **${r1.fail}** failed.`, flags: EPH }).catch(() => {});
    }

    if (id === 'modal_admin_resetstats') {
      const confirm = i.fields.getTextInputValue('confirm')?.trim().toUpperCase();
      if (confirm !== 'RESET') return respondText(i, 'Cancelled: you must type **RESET** to confirm.');
      try {
        const { error } = await supabase.from('game_history').delete().neq('user_id', '__impossible__');
        if (error) throw error;
        await i.reply({ content: '✅ Statistics reset. Sending DMs…', flags: EPH });
        const r2 = await dmGuildEveryone(i.guild, {
          embeds: [
            new EmbedBuilder()
              .setTitle('📊 Reset statistics')
              .setColor(COLORS.red)
              .setDescription(`👤 By <@${i.user.id}>\nAll game history was cleared.`)
              .setTimestamp(),
          ],
        });
        return i.followUp({ content: `📬 DMs: **${r2.ok}** ok · **${r2.fail}** failed.`, flags: EPH }).catch(() => {});
      } catch (e) {
        console.error('[resetstats]', e?.message || e);
        return respondText(i, `Stats reset error: ${explainError(e)}`);
      }
    }

    if (id === 'modal_admin_annonce') {
      const amount = parseAmount(i.fields.getTextInputValue('amount')?.trim());
      const reward = i.fields.getTextInputValue('reward')?.trim();
      if (!amount) return respondText(i, 'Invalid amount.');
      if (!reward) return respondText(i, 'Enter the reward as text.');
      await i.reply({ content: `✅ Announcement **${fmt(amount)}** = **${reward}** · Sending DMs…`, flags: EPH });
      const r3 = await dmGuildEveryone(i.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle('📣 Reward available')
            .setColor(COLORS.gold)
            .setDescription(
              `👤 Announcement by <@${i.user.id}>\n\n` +
                `**${fmt(amount)}**  ≈  **${reward}**\n\n` +
                `Contact the owner to exchange your ${COIN} for this reward.`
            )
            .setTimestamp(),
        ],
      });
      return i.followUp({ content: `📬 DMs: **${r3.ok}** ok · **${r3.fail}** failed.`, flags: EPH }).catch(() => {});
    }

    const boostM = id.match(/^modal_admin_boost_([a-z0-9]+)$/);
    if (boostM) {
      const kind = boostM[1];
      const mRaw = i.fields.getTextInputValue('minutes')?.trim() || '15';
      const minutes = Math.max(1, Math.min(24 * 60, Math.floor(Number(String(mRaw).replace(',', '.')) || 15)));
      return postBoostEvent(i, kind, minutes);
    }

    let raw;
    try {
      raw = i.fields.getTextInputValue('amount').trim();
    } catch {
      return respondText(i, 'Invalid form (amount field missing).');
    }

    const evM = id.match(/^modal_admin_event_(claim|giveaway)$/);
    if (evM) {
      const type = evM[1];
      const amount = parseAmount(raw);
      if (!amount || amount > MAX_ADMIN_AMOUNT) {
        return respondText(i, `Invalid amount (between 0.01 and ${num(MAX_ADMIN_AMOUNT)}).`);
      }
      const wRaw = i.fields.getTextInputValue('winners')?.trim() || '1';
      const winners = Math.max(1, Math.min(50, Math.floor(Number(wRaw) || 1)));
      const mRaw = i.fields.getTextInputValue('minutes')?.trim() || '0';
      const minutes = Math.max(0, Math.min(24 * 60, Math.floor(Number(String(mRaw).replace(',', '.')) || 0)));
      return createClaimOrGiveaway(i, type, amount, winners, minutes);
    }

    if (id === 'modal_admin_all') {
      const amount = parseAmount(raw);
      if (!amount || amount > MAX_ADMIN_AMOUNT) {
        return respondText(i, `Invalid amount (between 0.01 and ${num(MAX_ADMIN_AMOUNT)}).`);
      }
      let count = 0;
      try {
        count = Number(await rpc('give_all', { p_amount: amount }));
      } catch (e) {
        console.error('[give_all] rpc', e?.message || e);
        const { data: rows, error } = await supabase.from('players').select('user_id, balance');
        if (error) throw error;
        for (const row of rows || []) {
          const { error: upErr } = await supabase
            .from('players')
            .update({ balance: Number(row.balance) + amount, updated_at: new Date().toISOString() })
            .eq('user_id', row.user_id);
          if (!upErr) {
            count++;
            await touchPeak(row.user_id, Number(row.balance) + amount);
          }
        }
      }
      await i.reply({ content: `✅ **${fmt(amount)}** gifted to **${count}** account(s). Sending DMs…`, flags: EPH });
      const rg = await dmGuildEveryone(i.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎁 Gift for everyone')
            .setColor(COLORS.green)
            .setDescription(
              `👤 By <@${i.user.id}>\n💰 **${fmt(amount)}** gifted to **every** player.`
            )
            .setTimestamp(),
        ],
      });
      return i.followUp({ content: `📬 DMs: **${rg.ok}** ok · **${rg.fail}** failed.`, flags: EPH }).catch(() => {});
    }

    const mm = id.match(/^modal_admin_mult_([a-z0-9]+)$/);
    if (mm) {
      const game = mm[1];
      if (!GAME_NAMES[game]) return;
      const value = parseAmount(raw);
      if (value === null || value < MULT_MIN || value > MULT_MAX) {
        return respondText(i, `Invalid value: between ${fx(MULT_MIN)} and ${fx(MULT_MAX)} (e.g.: 1.5).`);
      }
      const { db } = await saveMultiplier(game, value, i.guild.id, i.user.id);
      const note =
        `✅ **${GAME_NAMES[game]}**: multiplier set to **${fx(value)}** (announced in the casino).` +
        (db ? '' : '\n⚠️ Saved locally only: run **schema_v3.sql** in Supabase so it survives a redeploy.');
      return respond(i, multAdminPayload(note));
    }

    const m = id.match(/^modal_admin_(add|remove|set)_(\d{15,25})$/);
    if (!m) return;
    const [, action, userId] = m;
    const amount = parseAmount(raw, null, action === 'set');
    if (amount === null || amount > MAX_ADMIN_AMOUNT) {
      return respondText(i, `Invalid amount (max ${num(MAX_ADMIN_AMOUNT)}).`);
    }

    let balance;
    if (action === 'add') balance = Number(await rpc('admin_adjust', { p_user_id: userId, p_amount: amount }));
    else if (action === 'remove') balance = Number(await rpc('admin_adjust', { p_user_id: userId, p_amount: -amount }));
    else {
      const current = await getBalance(userId);
      balance = Number(await rpc('admin_adjust', { p_user_id: userId, p_amount: round2(amount - current) }));
    }
    await touchPeak(userId, balance);
    const verb = { add: `➕ **${fmt(amount)}** added to`, remove: `➖ **${fmt(amount)}** removed from`, set: '🎯 Balance set for' }[action];
    const dmText =
      action === 'add'
        ? `<@${i.user.id}> **added** **${fmt(amount)}** to you.\nNew balance: **${fmt(balance)}**`
        : action === 'remove'
          ? `<@${i.user.id}> **removed** **${fmt(amount)}** from you.\nNew balance: **${fmt(balance)}**`
          : `<@${i.user.id}> **set** your balance to **${fmt(balance)}**.`;
    await dmUser(userId, {
      embeds: [
        new EmbedBuilder()
          .setColor(action === 'remove' ? COLORS.red : COLORS.green)
          .setTitle(action === 'set' ? '🎯 Balance updated' : action === 'add' ? '➕ Coins received' : '➖ Coins removed')
          .setDescription(dmText)
          .setTimestamp(),
      ],
    });
    return i.reply({ content: `✅ ${verb} <@${userId}>. New balance: **${fmt(balance)}**`, flags: EPH });
  }
}

// ============================================================
//  balance / daily (written commands)
// ============================================================
const dailyText = (res) =>
  res.claimed
    ? `🎁 You received **${fmt(DAILY_AMOUNT)}**! New balance: **${fmt(res.balance)}**`
    : `⏰ You already claimed your reward today. Come back after midnight (Paris time)!\nBalance: **${fmt(res.balance)}**`;

async function cmdBalance(msg, args) {
  const targetId = parseUserId(args[0]) || msg.author.id;
  const bal = await getBalance(targetId);
  if (targetId === msg.author.id) return msg.reply(`💰 Your balance: **${fmt(bal)}**`);
  return msg.reply(`💰 Balance of <@${targetId}>: **${fmt(bal)}**`);
}

async function cmdDaily(msg) {
  const res = await rpc('claim_daily', { p_user_id: msg.author.id, p_amount: DAILY_AMOUNT });
  if (res?.balance != null) await touchPeak(msg.author.id, res.balance);
  return msg.reply(await dailyPayload(msg.author, res, dailyText(res)));
}

// ============================================================
//  OWNER COMMANDS
// ============================================================
async function cmdAdjust(msg, args, sign) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const name = sign > 0 ? 'add' : 'remove';
  const targetId = parseUserId(args[0]);
  const amount = parseAmount(args[1]);
  if (!targetId || !amount) return msg.reply('Usage: /' + name + ' member:@… amount:…');
  if (amount > MAX_ADMIN_AMOUNT) return msg.reply(`Amount too large (max ${num(MAX_ADMIN_AMOUNT)}).`);

  const balance = Number(await rpc('admin_adjust', { p_user_id: targetId, p_amount: sign * amount }));
  await touchPeak(targetId, balance);
  await dmUser(targetId, {
    embeds: [
      new EmbedBuilder()
        .setColor(sign > 0 ? COLORS.green : COLORS.red)
        .setTitle(sign > 0 ? '➕ Coins received' : '➖ Coins removed')
        .setDescription(
          sign > 0
            ? `<@${msg.author.id}> **added** **${fmt(amount)}** to you.\nNew balance: **${fmt(balance)}**`
            : `<@${msg.author.id}> **removed** **${fmt(amount)}** from you.\nNew balance: **${fmt(balance)}**`
        )
        .setTimestamp(),
    ],
  });
  return msg.reply(
    sign > 0
      ? `✅ **${fmt(amount)}** added to <@${targetId}>. New balance: **${fmt(balance)}**`
      : `✅ **${fmt(amount)}** removed from <@${targetId}>. New balance: **${fmt(balance)}**`
  );
}

// ---------- Registered channels ----------
const casinoChannels = new Map();
const guildChannels = new Map();

async function loadChannels() {
  const a = await supabase.from('casino_channels').select('guild_id, channel_id');
  if (a.error) console.error('[salons] casino_channels :', a.error.message);
  else for (const r of a.data) casinoChannels.set(r.guild_id, r.channel_id);

  const b = await supabase.from('guild_channels').select('guild_id, kind, channel_id');
  if (b.error) console.error('[channels] guild_channels (did you run schema_v2.sql?):', b.error.message);
  else for (const r of b.data) guildChannels.set(`${r.guild_id}:${r.kind}`, r.channel_id);
}

const CHANNEL_NAMES = {
  wins: 'wins',
  admin: 'casino-admin',
  invites: 'invites-notif',
  alltime: 'alltime',
  notifs: 'casino-notifs',
  online: 'online',
  poker: 'online', // backward-compat alias
};
const alltimeBoardMessages = new Map();
const ALLTIME_MSG_FILE = path.join(__dirname, 'data', 'alltime_msgs.json');
function saveAlltimeMsgs() {
  saveJson(ALLTIME_MSG_FILE, Object.fromEntries(alltimeBoardMessages));
}
function loadAlltimeMsgs() {
  try {
    const raw = JSON.parse(fs.readFileSync(ALLTIME_MSG_FILE, 'utf8'));
    for (const [gid, v] of Object.entries(raw)) if (v?.channelId && v?.messageId) alltimeBoardMessages.set(gid, v);
  } catch {

    /* first launch */
  }
}
function trackAlltime(guildId, channelId, messageId) {
  alltimeBoardMessages.set(guildId, { channelId, messageId });
  saveAlltimeMsgs();
}
// Finds each server's all-time leaderboard message after a redeploy (the data/ folder is lost).
// NEVER REPOST: if the message cannot be found, do nothing (the admin "All-time channel" button recreates one).
const isAlltimeBoardMsg = (m) =>
  m.author?.id === client.user.id &&
  (/^Record/.test(m.embeds?.[0]?.footer?.text || '') || /board-alltime-/.test(m.embeds?.[0]?.image?.url || '') || m.attachments?.some?.((a) => /^board-alltime-/.test(a.name || '')));
async function ensureAlltimeMessages() {
  for (const guild of client.guilds.cache.values()) {
    if (alltimeBoardMessages.has(guild.id)) continue;
    const chId = guildChannels.get(`${guild.id}:alltime`);
    if (!chId) continue;
    try {
      const ch = await client.channels.fetch(chId).catch(() => null);
      if (!ch || !ch.messages) continue;
      const pinned = await ch.messages.fetchPinned().catch(() => null);
      let mine = pinned?.find(isAlltimeBoardMsg);
      if (!mine) {
        const recent = await ch.messages.fetch({ limit: 100 }).catch(() => null);
        mine = recent?.find(isAlltimeBoardMsg);
      }
      if (mine) trackAlltime(guild.id, ch.id, mine.id);
      else console.warn(`[alltime] leaderboard message not found in <#${chId}>: nothing was reposted (use Admin → All-time channel to recreate it).`);
    } catch (e) {
      console.error('[alltime] restauration', e?.message || e);
    }
  }
}

// ============================================================
//  ONLINE BLACKJACK + ROULETTE — EXTERNAL tables (web page hosted by the bot)
//  Other "online" games (poker, roulette, heads or tails, dice, cards, slots, races, crash) are removed.
//  Code: web/server.js (server + realtime) · web/table.js (blackjack) · web/roulette.js (multiplayer roulette) · web/public/index.html (animations)
//  Address: PUBLIC_URL (default https://znkcasdiscordbot-production.up.railway.app) · port: PORT (Railway)
//  Disable: WEB=off variable
// ============================================================
const lbLast = new Map(); // last description posted by a leaderboard message (avoids needless edits)
function lbSameSig(id, sig) {
  if (lbLast.get(id) === sig) return true;
  lbLast.set(id, sig);
  return false;
}

// Leaderboards shown on the site ("Leaderboard" page): richest (current balance) + all-time (peak balance), 30s cache
const webBoardCache = { t: 0, data: null, p: null };
function getWebBoards() {
  if (webBoardCache.data && Date.now() - webBoardCache.t < 30000) return Promise.resolve(webBoardCache.data);
  if (webBoardCache.p) return webBoardCache.p;
  webBoardCache.p = (async () => {
    try {
      const out = {};
      for (const kind of ['rich', 'alltime']) {
        const rows = await getBoardData(kind, null);
        out[kind] = await Promise.all(
          rows.map(async (r) => {
            const u = await client.users.fetch(r.id).catch(() => null);
            return { uid: r.id, name: u ? u.globalName || u.username : 'Unknown user', value: r.value, avatar: u ? u.displayAvatarURL({ size: 64, extension: 'png' }) : '' };
          })
        );
      }
      webBoardCache.data = out;
      webBoardCache.t = Date.now();
      return out;
    } finally {
      webBoardCache.p = null;
    }
  })();
  return webBoardCache.p;
}

// Site admin: Discord account @b7f5 (unique username) + optional ADMIN_IDS (comma-separated IDs).
const webIsAdmin = async (uid) => {
  uid = String(uid);
  if (String(process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean).includes(uid)) return true;
  const u = await client.users.fetch(uid).catch(() => null);
  return !!u && String(u.username).toLowerCase() === 'b7f5';
};
const requireWebAdmin = async (actorId) => {
  if (actorId && !(await webIsAdmin(actorId))) throw new Error('Admin only.');
};

let webApp = { makeLink: () => null, enabled: false };
try {
  webApp = require('./web/server').init({
    supabase, // ranks / persistent RR (player_rank table)
    getBalance,
    debit,
    credit,
    getBoards: getWebBoards,
    isAdmin: webIsAdmin,
    // DM a user from the website (role purchase confirmations, etc.)
    notifyUser: async (uid, text) => {
      const u = await client.users.fetch(String(uid));
      await u.send(String(text).slice(0, 1800));
    },
    // Search guild members by name for the website "send coins" picker.
    searchMembers: async (guildId, q) => {
      const needle = String(q || '').trim().toLowerCase();
      if (!needle) return [];
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) return [];
      try {
        await guild.members.fetch();
      } catch {}
      return [...guild.members.cache.values()]
        .filter((m) => !m.user.bot)
        .filter((m) => {
          const hay = `${m.user.username} ${m.user.globalName || ''} ${m.displayName || m.nickname || ''}`.toLowerCase();
          return hay.includes(needle);
        })
        .slice(0, 20)
        .map((m) => ({
          uid: m.id,
          name: m.displayName || m.user.globalName || m.user.username,
          avatar: m.user.displayAvatarURL({ extension: 'png', size: 128 }),
        }));
    },
    // Admin economy actions from the website (server.js already checks isAdmin too).
    giftAll: async (guildId, amount, actorId) => {
      await requireWebAdmin(actorId);
      amount = round2(Number(amount));
      if (!(amount > 0) || amount > MAX_ADMIN_AMOUNT) throw new Error('Invalid amount.');
      let count = 0;
      try {
        count = Number(await rpc('give_all', { p_amount: amount }));
      } catch (e) {
        console.error('[web giftAll] rpc', e?.message || e);
        const { data: rows, error } = await supabase.from('players').select('user_id, balance');
        if (error) throw error;
        for (const row of rows || []) {
          const newBal = Number(row.balance) + amount;
          const { error: upErr } = await supabase
            .from('players')
            .update({ balance: newBal, updated_at: new Date().toISOString() })
            .eq('user_id', row.user_id);
          if (!upErr) {
            count++;
            await touchPeak(row.user_id, newBal);
          }
        }
      }
      return count;
    },
    resetBalances: async (guildId, actorId) => {
      await requireWebAdmin(actorId);
      const { data, error } = await supabase
        .from('players')
        .update({ balance: 0, updated_at: new Date().toISOString() })
        .neq('user_id', '__impossible__')
        .select('user_id');
      if (error) throw error;
      return data?.length ?? 0;
    },
    resetAlltime: async (guildId, actorId) => {
      await requireWebAdmin(actorId);
      peaks.clear();
      savePeaksLocal();
      const { error } = await supabase.from('player_peaks').update({ peak: 0 }).neq('user_id', '__impossible__');
      if (error) throw error;
      return true;
    },
    resetStats: async (guildId, actorId) => {
      await requireWebAdmin(actorId);
      const { error } = await supabase.from('game_history').delete().neq('user_id', '__impossible__');
      if (error) throw error;
      return true;
    },
    grantRole: async (guildId, uid, roleId) => {
      const g = client.guilds.cache.get(String(guildId));
      if (!g) throw new Error('Server not found.');
      const member = await g.members.fetch(String(uid));
      await member.roles.add(String(roleId), 'ZNK Shop — automatic delivery');
      return true;
    },
    notifyAdmins: async (text, guildId) => {
      const ids = String(process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
      try {
        const g = client.guilds.cache.get(String(guildId));
        if (g?.ownerId && !ids.includes(g.ownerId)) ids.push(g.ownerId);
      } catch {}
      const body = String(text || '').slice(0, 1800);
      for (const id of [...new Set(ids)]) {
        try {
          const u = await client.users.fetch(id);
          await u.send({ content: '🛒 **Shop**\n' + body });
        } catch {}
      }
    },
    runBotCommand: async (guildId, actorId, cmd, params = {}) => {
      const guild = client.guilds.cache.get(String(guildId));
      if (!guild) throw new Error('Discord server not found (bot offline?).');
      const channel =
        guild.channels.cache.get(casinoChannels.get(guild.id)) ||
        guild.systemChannel ||
        guild.channels.cache.find((c) => c.isTextBased?.() && c.viewable) ||
        null;
      if (!channel && !['balance', 'invites', 'help', 'remove', 'add'].includes(String(cmd))) {
        throw new Error('No accessible text channel to post in.');
      }
      const replies = [];
      const fakeMsg = {
        guild,
        channel: channel || { send: async () => null, id: null },
        author: { id: String(actorId) },
        member: { id: String(actorId) },
        mentions: {
          users: { first: () => null },
          channels: {
            find: (fn) => {
              const id = params.categoryId;
              if (!id) return null;
              const c = guild.channels.cache.get(String(id));
              return c && (!fn || fn(c)) ? c : null;
            },
          },
        },
        reply: async (payload) => {
          const text = typeof payload === 'string' ? payload : payload?.content || 'OK';
          replies.push(String(text).replace(/<@!?(\d+)>/g, '@$1').slice(0, 500));
          return null;
        },
        delete: async () => {},
      };
      switch (String(cmd)) {
        case 'help':
          return { ok: true, msg: ['/help','/balance','/daily','/invites','/casino','/setup','/wins','/classement','/admin','/add','/remove','/invites-notif','/ticketsetup'].join('\n') };
        case 'balance': {
          const target = String(params.userId || actorId);
          const bal = await getBalance(target);
          return { ok: true, msg: 'Balance of ' + target + ': ' + fmt(bal), balance: bal };
        }
        case 'daily':
          await cmdDaily(fakeMsg);
          return { ok: true, msg: replies.join(' ') || 'Daily processed.' };
        case 'invites': {
          const target = String(params.userId || actorId);
          let count = 0;
          try {
            const { count: c, error } = await supabase.from('invite_rewards').select('invited_id', { count: 'exact', head: true }).eq('guild_id', String(guildId)).eq('inviter_id', target);
            if (!error) count = c || 0;
          } catch {}
          return { ok: true, msg: 'Invites for ' + target + ': ' + count, invites: count };
        }
        case 'casino':
        case 'jeux': {
          if (!channel) throw new Error('Casino channel not found — run /setup first.');
          await channel.send(buildPanelPayload());
          return { ok: true, msg: 'Game panel posted in #' + channel.name + '.' };
        }
        case 'setup':
        case 'salon':
          await cmdSetup(fakeMsg);
          return { ok: true, msg: replies.join(' ') || 'Setup completed.' };
        case 'wins':
          await cmdWins(fakeMsg);
          return { ok: true, msg: replies.join(' ') || 'Wins channel OK.' };
        case 'classement':
          await cmdLeaderboard(fakeMsg);
          return { ok: true, msg: replies.join(' ') || 'Leaderboard posted.' };
        case 'admin':
          await cmdAdmin(fakeMsg);
          return { ok: true, msg: replies.join(' ') || 'Discord admin panel posted.' };
        case 'add': {
          const to = String(params.userId || '');
          const amount = Number(params.amount);
          if (!/^\d{5,25}$/.test(to)) throw new Error('Invalid member ID.');
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid amount.');
          await cmdAdjust(fakeMsg, [to, String(amount)], +1);
          return { ok: true, msg: replies.join(' ') || ('+' + amount + ' for ' + to) };
        }
        case 'remove': {
          const to = String(params.userId || '');
          const amount = Number(params.amount);
          if (!/^\d{5,25}$/.test(to)) throw new Error('Invalid member ID.');
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid amount.');
          await cmdAdjust(fakeMsg, [to, String(amount)], -1);
          return { ok: true, msg: replies.join(' ') || ('−' + amount + ' for ' + to) };
        }
        case 'invites-notif':
          await cmdInvitesNotif(fakeMsg);
          return { ok: true, msg: replies.join(' ') || 'Invite notifs channel OK.' };
        case 'ticketsetup':
          await cmdTicketSetup(fakeMsg);
          return { ok: true, msg: replies.join(' ') || 'Ticket panel posted.' };
        default:
          throw new Error('Unknown command: ' + cmd);
      }
    },

    // events (boosts, claim, giveaway) launched from the site admin page; notifs also go out when launched from Discord
    launchBoost: webLaunchBoost,
    launchEvent: webLaunchEvent,
    eventClaim: webEventClaim,
    eventJoin: webEventJoin,
    // site "Daily" button: same RPC as the Discord button
    claimDaily: async (uid) => {
      const res = await rpc('claim_daily', { p_user_id: String(uid), p_amount: DAILY_AMOUNT });
      if (res?.balance != null) await touchPeak(String(uid), res.balance);
      return { claimed: !!res?.claimed, balance: res?.balance ?? null, amount: DAILY_AMOUNT };
    },
    coin: /^<a?:\w+:\d+>$/.test(COIN_PLAIN) ? '🪙' : COIN_PLAIN, // a custom Discord emoji does not display on the web
    secretSeed: DISCORD_TOKEN,
    clientId: () => client.user?.id,
    // "Log in with Discord": casino servers where the player is a member (name, avatar, highest role)
    resolveMember: async (userId, guildIds) => {
      const out = [];
      for (const gid of guildIds) {
        const guild = client.guilds.cache.get(gid);
        if (!guild) continue;
        const m = await guild.members.fetch(userId).catch(() => null);
        if (!m) continue;
        const r = m.roles?.highest;
        out.push({ guildId: gid, guildName: guild.name, name: m.displayName || m.user.globalName || m.user.username, avatar: m.user.displayAvatarURL({ extension: 'png', size: 128 }), role: r && r.id !== guild.id ? r.name : '' });
      }
      return out;
    },
    onRoundEnd: (guildId, recap) => postOnlineRecap(guildId, recap).catch((e) => console.error('[online recap]', e?.message || e)),
    getInviteCount: async (uid, guildId) => {
      try {
        const { count, error } = await supabase.from('invite_rewards').select('invited_id', { count: 'exact', head: true }).eq('guild_id', String(guildId)).eq('inviter_id', String(uid));
        if (error) throw error;
        return count || 0;
      } catch (e) {
        console.error('[web] invites', e?.message || e);
        return 0;
      }
    },
    getGamesPlayed: async (uid) => {
      try {
        if (webApp.shop && webApp.rooms) { /* rank lives in web server memory */ }
        const rankFile = path.join(__dirname, 'data', 'rank.json');
        const data = JSON.parse(fs.readFileSync(rankFile, 'utf8') || '{}');
        const u = data[String(uid)];
        return (u && (u.eg || 0)) || 0;
      } catch { return 0; }
    },
    inviteUrl: async (guildId) => {
      try {
        const g = client.guilds.cache.get(String(guildId));
        if (!g) return '';
        const ch = g.systemChannel || g.channels.cache.find((c) => c.isTextBased?.() && c.viewable);
        if (ch && ch.createInvite) {
          const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'ZNK shop invite link' }).catch(() => null);
          if (inv) return inv.url;
        }
        // fallback vanity or generic
        if (g.vanityURLCode) return 'https://discord.gg/' + g.vanityURLCode;
        return '';
      } catch (e) {
        console.error('[web] inviteUrl', e?.message || e);
        return '';
      }
    },
  });
} catch (e) {
  console.error('[web] online blackjack failed to start (web/ folder missing?):', e?.message || e);
}

// Instant order delivery: Supabase Realtime pushes new shop_orders to the bot.
// The 2 s SQL poll in web/shop.js remains as a fallback if Realtime is disabled.
try {
  if (webApp.enabled && webApp.shop && webApp.shop.syncOrdersFromDb) {
    supabase
      .channel('znk-shop-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_orders' }, () => {
        Promise.resolve(webApp.shop.syncOrdersFromDb()).catch(() => {});
      })
      .subscribe();
  }
} catch (e) {
  console.warn('[shop] realtime unavailable (SQL polling still active):', e?.message || e);
}

// Recap of an online round (blackjack / poker / roulette) sent to the wins channel
const SPOT_FR = { red: 'Red', black: 'Black', even: 'Even', odd: 'Odd', low: '1-18', high: '19-36', d1: '1st 12', d2: '2nd 12', d3: '3rd 12', c1: 'Col. 1', c2: 'Col. 2', c3: 'Col. 3' };
const spotFr = (k) => SPOT_FR[k] || `N°${String(k).slice(1)}`;
async function postOnlineRecap(guildId, r) {
  // Recap = WINNERS only. If nobody won: no message.
  const winners = (r.players || []).filter((p) => p.net > 0).sort((a, b) => b.net - a.net);
  if (!winners.length) return;
  const ch = await findWinsChannel(guildId);
  if (!ch) return;
  const MAXL = 15;
  const lines = winners.slice(0, MAXL).map((p) => {
    let extra = '';
    if (r.game === 'roulette') extra = ' · ' + Object.entries(p.bets || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${spotFr(k)} ${num(v)}`).join(', ');
    else if (r.game === 'blackjack') extra = p.outcome === 'bj' ? ' · BLACKJACK' : '';
    else if (p.detail) extra = ` · ${p.detail}`;
    return `🟢 **${escapeMarkdown(p.name)}** · bet ${fmt(p.bet)} · **${signed(p.net)}**${extra}`;
  });
  if (winners.length > MAXL) lines.push(`… and ${winners.length - MAXL} more`);
  let title, head = '';
  if (r.game === 'blackjack') {
    const d = r.dealer;
    title = '🃏 Blackjack en ligne — victoires';
    head = `🎩 Dealer: **${d.cards.join(' ')} → ${d.bj ? 'Blackjack' : d.bust ? `bust (${d.total})` : d.total}**\n`;
  } else if (r.game === 'poker') {
    title = '♠️ Poker en ligne — victoires';
    head = r.board && r.board.length ? `🃏 Board: **${r.board.join(' ')}**\n` : '';
  } else if (r.game === 'roulette') {
    const dot = r.color === 'rouge' ? '🔴' : r.color === 'noir' ? '⚫' : '🟢';
    title = '🎰 Roulette en ligne — victoires';
    head = `${dot} Number: **${r.n}** (${r.color})\n`;
  } else if (r.game === 'mines') title = '💣 Mines — win';
  else if (r.game === 'fuse') title = '🚀 Fuse — win';
  else if (r.game === 'bj-solo') title = '🃏 Solo Blackjack — win';
  else if (r.game === 'coin') title = '🪙 Heads or Tails — win';
  else if (r.game === 'dice') title = '🎲 Dice — win';
  else if (r.game === 'horses') title = '🏇 Horse Race — win';
  else if (r.game === 'russian') title = '🔫 Russian Roulette — win';
  else if (r.game === 'slots') title = '🎰 Slots — win';
  else if (r.game === 'duel') title = '🤠 Duel — win';
  else if (r.game === 'plinko') title = '🎱 Plinko — win';
  else if (r.game === 'scratch') title = '🎟️ Scratch Ticket — win';
  else return;
  const embed = new EmbedBuilder()
    .setColor(COLORS.violet)
    .setTitle(title)
    .setDescription(`${head}${LINE}\n${lines.join('\n')}`)
    .setFooter({ text: 'ZNK Casino  •  Games online' })
    .setTimestamp();
  await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

function buildPokerPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle('🎮 Casino en ligne')
    .setDescription('Click **Play Online**: the site opens and you choose your game (your casino balance is used).')
    .setFooter({ text: 'Admin → Online channel to create this channel' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('online_play').setLabel('Play Online').setEmoji('🎮').setStyle(ButtonStyle.Primary)
  );
  return withBanner({ embeds: [embed], components: [row] }, 'panel_online.png');
}

async function createPokerChannel(i) {
  const guild = i.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;
  const existing = (await getSavedChannel(guild, 'online')) || (await getSavedChannel(guild, 'poker'));
  if (existing) {
    await existing.send(buildPokerPanelPayload()).catch(() => {});
    return i.reply({ content: `✅ Online channel already exists: <#${existing.id}> (panel reposted).`, flags: EPH });
  }
  if (!me.permissions.has(P.ManageChannels)) return i.reply({ content: NEED_MANAGE_CHANNELS, flags: EPH });
  const channel = await guild.channels.create({
    name: 'online',
    type: ChannelType.GuildText,
    topic: 'Online casino 🃏🎰 — multiplayer blackjack, poker and roulette on the casino site',
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        allow: [P.ViewChannel, P.ReadMessageHistory],
        deny: [P.SendMessages],
      },
      {
        id: me.id,
        type: OverwriteType.Member,
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.MentionEveryone, P.ManageMessages]),
      },
    ],
  });
  const panelMsg = await channel.send(buildPokerPanelPayload());
  await panelMsg.pin().catch(() => {});
  const saved = await saveChannel(guild.id, 'online', channel.id);
  return i.reply({
    content: `✅ Channel <#${channel.id}> created (Play Online button).${saved ? '' : DB_WARN}`,
    flags: EPH,
  });
}

// All buttons in the online channel (including those from old panels: poker_new / poker_top / poker_hist…)
// give the PERSONAL link to the web table.
async function handlePokerButton(i) {
  if (!i.guild) return respondText(i, 'Use this button in the server.');
  if (!webApp.enabled) return respondText(i, '⚠️ Online games are currently disabled.');
  // A single link for all buttons (including those from old panels): it opens the games home page.
  const shared = !!(webApp.oauth && webApp.oauth()); // Discord login configured: same link for everyone
  const url = shared ? webApp.publicUrl : webApp.makeLink({
    id: i.user.id,
    name: i.member?.displayName || i.user.globalName || i.user.username,
    avatar: i.user.displayAvatarURL({ extension: 'png', size: 128 }),
    role: (() => { const r = i.member?.roles?.highest; return r && r.id !== i.guild.id ? r.name : ''; })(), // highest Discord role (shown in chat)
  }, i.guild.id);
  if (!url) return respondText(i, '⚠️ Link unavailable, try again in a moment.');
  const bal = await getBalance(i.user.id).catch(() => null);
  const embed = new EmbedBuilder()
    .setColor(COLORS.violet)
    .setAuthor({ name: 'ZNK CASINO  •  JEUX EN LIGNE', iconURL: ZNK_LOGO })
    .setTitle('🎮 The games are waiting for you')
    .setDescription(
      `Click the button to open the site, then choose your game${bal !== null ? ` (balance: **${fmt(bal)}**)` : ''}.\n\n` +
        (shared ? '🔐 On the site, click **Log in with Discord**: you will be recognized automatically.' : `🔒 This link is **personal** (it logs you into your account): do not share it. Valid for 12 h.`)
    );
  return i.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Play Online').setEmoji('🎮').setStyle(ButtonStyle.Link).setURL(url))],
    flags: EPH,
  });
}

async function getAnnounceChannel(guildId) {
  // Old channel logic — kept as fallback only
  const notifId = guildChannels.get(`${guildId}:notifs`);
  if (notifId) {
    const ch = await client.channels.fetch(notifId).catch(() => null);
    if (ch) return ch;
  }
  const casinoId = casinoChannels.get(guildId);
  if (casinoId) return client.channels.fetch(casinoId).catch(() => null);
  return null;
}

/** Sends a DM to a user (ignores if DMs are closed). */
async function dmUser(userId, payload) {
  try {
    const u = await client.users.fetch(userId);
    await u.send(typeof payload === 'string' ? { content: payload } : payload);
    return true;
  } catch {
    return false;
  }
}

/** Broadcasts a DM to all non-bot members of the server (slow, rate-limited). */
async function dmGuildEveryone(guild, payload) {
  if (!guild) return { ok: 0, fail: 0 };
  if (
    typeof payload !== 'string' &&
    payload.embeds?.length &&
    !payload.components?.length &&
    !payload.files?.length &&
    !payload.embeds[0].data?.image
  ) {
    try {
      putCard(payload, await announceCardFor(payload.embeds[0]));
    } catch (e) {
      console.error('[card announcement]', e?.message || e);
    }
  }
  let list;
  try {
    list = guild.members.cache.size >= Math.max(1, (guild.memberCount || 0) * 0.95) ? guild.members.cache : await guild.members.fetch();
  } catch {
    list = guild.members.cache;
  }
  let ok = 0;
  let fail = 0;
  for (const m of list.values()) {
    if (!m || m.user.bot) continue;
    try {
      await m.send(typeof payload === 'string' ? { content: payload } : payload);
      ok++;
      await sleep(400);
    } catch {
      fail++;
    }
  }
  return { ok, fail };
}

async function createAllTimeChannel(i) {
  const guild = i.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;
  const existing = await getSavedChannel(guild, 'alltime');
  if (existing) {
    const msg = await existing.send(await buildBoardPayload('alltime'));
    trackAlltime(guild.id, existing.id, msg.id);
    return i.reply({ content: `✅ All-time channel already exists: <#${existing.id}> (leaderboard reposted).`, flags: EPH });
  }
  if (!me.permissions.has(P.ManageChannels)) return i.reply({ content: NEED_MANAGE_CHANNELS, flags: EPH });
  const channel = await guild.channels.create({
    name: 'alltime',
    type: ChannelType.GuildText,
    topic: 'All-time leaderboard: all-time peak balance 👑',
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        allow: [P.ViewChannel, P.ReadMessageHistory],
        deny: [P.SendMessages],
      },
      {
        id: me.id,
        type: OverwriteType.Member,
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.ManageMessages]),
      },
    ],
  });
  const msg = await channel.send(await buildBoardPayload('alltime'));
  await msg.pin().catch(() => {});
  trackAlltime(guild.id, channel.id, msg.id);
  const saved = await saveChannel(guild.id, 'alltime', channel.id);
  return i.reply({ content: `✅ Channel <#${channel.id}> created with the all-time leaderboard.${saved ? '' : DB_WARN}`, flags: EPH });
}

async function restoreChannelsByName() {
  for (const guild of client.guilds.cache.values()) {
    for (const kind of Object.keys(CHANNEL_NAMES)) {
      if (guildChannels.has(`${guild.id}:${kind}`)) continue;
      try {
        await getSavedChannel(guild, kind);
      } catch (e) {
        console.error('[salons] restauration', e?.message || e);
      }
    }
  }
}

async function getSavedChannel(guild, kind) {
  const key = `${guild.id}:${kind}`;
  const id = guildChannels.get(key);
  if (id) {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch) return ch;
    guildChannels.delete(key);
    await supabase.from('guild_channels').delete().eq('guild_id', guild.id).eq('kind', kind).then(() => {}, () => {});
  }
  const all = await guild.channels.fetch().catch(() => null);
  const found = all?.find((c) => c && c.type === ChannelType.GuildText && c.name === CHANNEL_NAMES[kind]);
  if (found) await saveChannel(guild.id, kind, found.id);
  return found || null;
}

async function saveChannel(guildId, kind, channelId) {
  guildChannels.set(`${guildId}:${kind}`, channelId);
  try {
    const { error } = await supabase.from('guild_channels').upsert({
      guild_id: guildId,
      kind,
      channel_id: channelId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error(`[channels] could not save "${kind}" in guild_channels (run schema_v3.sql):`, e?.message || e);
    return false;
  }
}

const DB_WARN = '\n⚠️ I could not save it to the database (missing `guild_channels` table): run **schema_v3.sql** in Supabase.';

function explainError(e) {
  const msg = String(e?.message || e || '');
  if (e?.code === 50013 || /Missing Permissions/i.test(msg)) {
    return 'I am missing a Discord permission (**Manage Channels**, **View Channel**, **Send Messages**, **Embed Links**).';
  }
  if (e?.code === 50001 || /Missing Access/i.test(msg)) return 'I do not have access to this channel/server (**Missing Access**).';
  if (/relation|does not exist|schema cache|PGRST|42P01|Could not find the table/i.test(msg)) {
    return 'A Supabase table is missing: run **schema_v3.sql** in the Supabase SQL editor.';
  }
  return `Technical detail: \`${msg.slice(0, 180)}\``;
}

function botCan(guild, wanted) {
  const me = guild.members.me;
  return wanted.filter((p) => me.permissions.has(p));
}

const NEED_MANAGE_CHANNELS =
  '⚠️ I need the **Manage Channels** permission to create the channel (Server Settings → Roles → bot role).';

// ---------- !setup: casino channel ----------
async function cmdSetup(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const guild = msg.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;

  const existingId = casinoChannels.get(guild.id);
  if (existingId) {
    const existing = await guild.channels.fetch(existingId).catch(() => null);
    if (existing) {
      await existing.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
      const panelMsg = await existing.send(buildPanelPayload());
      await panelMsg.pin().catch(() => {});
      return msg.reply(`✅ Channel <#${existingId}> already exists: I posted a new game panel there (pinned).`);
    }
    casinoChannels.delete(guild.id);
  }

  if (!me.permissions.has(P.ManageChannels)) return msg.reply(NEED_MANAGE_CHANNELS);
  const botAllow = botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.ManageMessages]);

  const channel = await guild.channels.create({
    name: 'casino',
    type: ChannelType.GuildText,
    topic: 'Casino 🪙: play using the buttons on the pinned panel',
    permissionOverwrites: [
      { id: guild.roles.everyone.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages] },
      { id: me.id, allow: botAllow },
    ],
  });

  try {
    const panelMsg = await channel.send(buildPanelPayload());
    await panelMsg.pin().catch(() => {});
    const { error } = await supabase.from('casino_channels').upsert({
      guild_id: guild.id,
      channel_id: channel.id,
      help_message_id: panelMsg.id,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    await channel.delete().catch(() => {});
    throw e;
  }
  casinoChannels.set(guild.id, channel.id);

  const warn = me.permissions.has(P.ManageMessages)
    ? ''
    : '\n⚠️ I am missing **Manage Messages**: I will not be able to pin the panel.';
  return msg.reply(
    `✅ Channel <#${channel.id}> created with the button panel (pinned). Everyone plays by clicking, and their games are only visible to them.${warn}`
  );
}

// ---------- !wins: wins channel ----------
async function cmdWins(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const guild = msg.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;

  const existing = await getSavedChannel(guild, 'wins');
  if (existing) return msg.reply(`The wins channel already exists: <#${existing.id}>`);
  if (!me.permissions.has(P.ManageChannels)) return msg.reply(NEED_MANAGE_CHANNELS);

  const channel = await guild.channels.create({
    name: 'wins',
    type: ChannelType.GuildText,
    topic: 'Everyone\'s wins 🎉',
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        allow: [P.ViewChannel, P.ReadMessageHistory],
        deny: [P.SendMessages],
      },
      {
        id: me.id,
        type: OverwriteType.Member,
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.MentionEveryone]),
      },
    ],
  });
  const saved = await saveChannel(guild.id, 'wins', channel.id);
  return msg.reply(
    `✅ Channel <#${channel.id}> created: every win (game, bet, multiplier, payout) will be shown there automatically.${saved ? '' : DB_WARN}`
  );
}

// ---------- !invites-notif ----------
async function cmdInvitesNotif(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const guild = msg.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;

  const existing = await getSavedChannel(guild, 'invites');
  if (existing) return msg.reply(`The invite notifications channel already exists: <#${existing.id}>`);
  if (!me.permissions.has(P.ManageChannels)) return msg.reply(NEED_MANAGE_CHANNELS);

  const channel = await guild.channels.create({
    name: 'invites-notif',
    type: ChannelType.GuildText,
    topic: 'Notifications when someone invites a new member 📨',
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        allow: [P.ViewChannel, P.ReadMessageHistory],
        deny: [P.SendMessages],
      },
      {
        id: me.id,
        type: OverwriteType.Member,
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory]),
      },
    ],
  });
  const saved = await saveChannel(guild.id, 'invites', channel.id);
  return msg.reply(
    `✅ Channel <#${channel.id}> created: every successful invite (new member + reward) will be shown there automatically.${saved ? '' : DB_WARN}`
  );
}

// ---------- !admin ----------
async function cmdAdmin(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const guild = msg.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;

  const existing = await getSavedChannel(guild, 'admin');
  if (existing) {
    await existing.send(buildAdminPayload());
    return msg.reply(`✅ The admin channel already exists: I reposted the panel in <#${existing.id}>.`);
  }
  if (!me.permissions.has(P.ManageChannels)) return msg.reply(NEED_MANAGE_CHANNELS);

  const channel = await guild.channels.create({
    name: 'casino-admin',
    type: ChannelType.GuildText,
    topic: 'Casino admin panel (only visible to the owner)',
    permissionOverwrites: [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
      { id: guild.ownerId, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
      {
        id: me.id,
        type: OverwriteType.Member,
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory]),
      },
    ],
  });
  let saved = true;
  try {
    const panelMsg = await channel.send(buildAdminPayload());
    await panelMsg.pin().catch(() => {});
    saved = await saveChannel(guild.id, 'admin', channel.id);
  } catch (e) {
    await channel.delete().catch(() => {});
    throw e;
  }
  return msg.reply(`✅ Private channel <#${channel.id}> created with the admin panel (only visible to you).${saved ? '' : DB_WARN}`);
}

// ============================================================
//  LEADERBOARD (auto-updated every minute)
// ============================================================
// ============================================================
//  IMAGE LEADERBOARDS (richest, all-time, invites)
//  Variables Railway (optionnelles) : LB_BG_URL, ALLTIME_BG_URL, INVITES_BG_URL
//  If the URL is set, the image is a "template": the bot only writes text in it.
//  Template: 1600x1800 px image (8:9 ratio). Hardcoded positions in renderBoardImage (800x900 coordinates, x2 for the image):
//    title   : centered x=400, baseline y=83, area x 40-760 / y 30-110
//    rows    : 10 rows, top of row k = 130 + 74*k, height 66, area x 40-760
//    rank    : centered x=80 | avatar: center x=144, diameter 44 | username: x 182-530
//    value   : right-aligned at x=744 (area x 540-744) | invites subtext: same x, y_line+54
// ============================================================
const BOARD_BG = {
  rich: bgSource('LB_BG_URL', 'richest_leaderboard.png'),
  alltime: bgSource('ALLTIME_BG_URL', 'alltime_leaderboard.png'),
  invites: bgSource('INVITES_BG_URL', 'top_inviters_leaderboard.png'),
  winNotif: bgSource('WIN_NOTIF_BG_URL', 'win_notification.png'), // win notif (image 1774x887)
  inviteNotif: bgSource('INVITE_NOTIF_BG_URL', 'invite_notification.png'), // notif "X invited Y" (image 1600x800)
};
const bgByUrl = new Map(); // url -> Promise<Image|null>
function getBgByUrl(url, loadImage) {
  if (!url) return Promise.resolve(null);
  if (!bgByUrl.has(url)) {
    bgByUrl.set(
      url,
      readImageSource(url, loadImage).catch((e) => {
        console.warn('[leaderboard] unreadable background image (direct png/jpg link required):', e?.message || e);
        bgByUrl.delete(url); // retry on next display
        return null;
      })
    );
  }
  return bgByUrl.get(url);
}

const avatarCache = new Map();
async function getAvatarCached(user, loadImage) {
  const key = `${user.id}:${user.avatar || 'none'}`;
  if (avatarCache.has(key)) return avatarCache.get(key);
  const img = await loadAvatarImage(user, loadImage);
  if (img) {
    if (avatarCache.size > 300) avatarCache.clear();
    avatarCache.set(key, img);
  }
  return img;
}

// Logical layout 800x900 (final image 1000x1125). Recommended template: 1600x1800 (x2).
const BOARD_ROW_Y = (k) => 130 + 74 * k; // 10 lignes de 66 px de haut

// Positions aligned to neon leaderboard images classement_riches.png / classement_alltime.png
// (1180x1327 px, rendered at 800x900). Rank, crowns, coins, title and frames are ALREADY in the image:
// the bot only writes the avatar, username and amount. Coordinates in the 800x900 reference frame.
const BOARD_TPL = {
  rowCy: [268.9, 330.3, 391.7, 451.3, 510.4, 568.7, 627.0, 685.3, 743.0, 802.0], // center y of the 10 rows
  avatar: { cx: 191.5, d: 47 },                          // avatar circle (center x, diameter)
  name: { x: 243, maxW: 344, font: 24 },                 // username on the left (x 243 -> 587)
  nameInv: { maxW: 300 },                                // top invites: shorter username (x 243 -> 543, no coin in the image)
  invValue: { right: 756, maxW: 200, font: 22, subFont: 13, mainDy: 3, subDy: 19 }, // top invites: "N invited" + "+N coins" right-aligned
  value: { x: 647, maxW: 109, font: 26, minFont: 14 },   // amount to the right of the coin (x 647 -> 756)
};

async function renderBoardImage({ kind, title, rows, bgUrl }) {
  if (!canvasLib) return null;
  const { createCanvas, loadImage } = canvasLib;
  const W = 800;
  const H = 900;
  const SCALE = 1.25;
  const cv = createCanvas(W * SCALE, H * SCALE);
  const g = cv.getContext('2d');
  g.scale(SCALE, SCALE);
  const FONT = STATS_FONT;

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2B0A3D');
  bg.addColorStop(0.5, '#5B1A9E');
  bg.addColorStop(1, '#A81CFD');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const bgImg = await getBgByUrl(bgUrl, loadImage);
  const T = !!bgImg;
  const TPL = T && (kind === 'rich' || kind === 'alltime' || kind === 'invites'); // neon image with rank/title already drawn
  const INV = kind === 'invites';
  if (T) {
    const k = Math.max(W / bgImg.width, H / bgImg.height);
    const sw = W / k;
    const sh = H / k;
    g.drawImage(bgImg, (bgImg.width - sw) / 2, (bgImg.height - sh) / 2, sw, sh, 0, 0, W, H);
  } else {
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.arc(W - 60, -20, 190, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-40, H + 20, 160, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(g, 40, 30, 720, 80, 18);
    g.fill();
  }

  // title centered in area x 40-760, y 30-110 (already in the image in neon mode)
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  if (!TPL) {
    g.fillStyle = '#FFFFFF';
    g.font = `bold 36px ${FONT}`;
    g.fillText(fitText(g, title, 680), W / 2, 83);
  }
  g.textAlign = 'left';

  const avatars = await Promise.all(rows.map((r) => (r?.user ? getAvatarCached(r.user, loadImage) : null)));
  for (let k = 0; k < 10; k++) {
    const y = BOARD_ROW_Y(k);
    const r = rows[k];
    if (TPL) {
      const cy = BOARD_TPL.rowCy[k];
      if (!r) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.font = `bold 22px ${FONT}`;
        g.fillText('—', BOARD_TPL.name.x, cy + 8);
        continue;
      }
      const D = BOARD_TPL.avatar.d;
      const acx = BOARD_TPL.avatar.cx;
      g.save();
      g.beginPath();
      g.arc(acx, cy, D / 2, 0, Math.PI * 2);
      g.closePath();
      g.clip();
      const timg = avatars[k];
      if (timg) {
        const sq = Math.min(timg.width, timg.height);
        g.drawImage(timg, (timg.width - sq) / 2, (timg.height - sq) / 2, sq, sq, acx - D / 2, cy - D / 2, D, D);
      } else {
        g.fillStyle = '#5865F2';
        g.fillRect(acx - D / 2, cy - D / 2, D, D);
        g.fillStyle = '#fff';
        g.font = `bold 22px ${FONT}`;
        g.textAlign = 'center';
        g.fillText(String(r.name || '?')[0].toUpperCase(), acx, cy + 8);
        g.textAlign = 'left';
      }
      g.restore();
      // pseudo
      g.fillStyle = '#FFFFFF';
      g.font = `bold ${BOARD_TPL.name.font}px ${FONT}`;
      g.fillText(fitText(g, r.name, INV ? BOARD_TPL.nameInv.maxW : BOARD_TPL.name.maxW), BOARD_TPL.name.x, cy + 8);
      if (INV) {
        const iv = BOARD_TPL.invValue;
        g.textAlign = 'right';
        g.fillStyle = k === 0 ? '#FACC15' : k === 1 ? '#E5E7EB' : k === 2 ? '#FB923C' : '#FFFFFF';
        g.font = `bold ${iv.font}px ${FONT}`;
        g.fillText(fitText(g, r.main, iv.maxW), iv.right, cy + iv.mainDy);
        if (r.sub) {
          g.fillStyle = 'rgba(255,255,255,0.75)';
          g.font = `${iv.subFont}px ${FONT}`;
          g.fillText(fitText(g, r.sub, iv.maxW), iv.right, cy + iv.subDy);
        }
        g.textAlign = 'left';
        continue;
      }
      // amount (the coin is already in the image): shrink font if the number is long
      const vtxt = String(r.val ?? r.main);
      let fs = BOARD_TPL.value.font;
      g.font = `bold ${fs}px ${FONT}`;
      while (fs > BOARD_TPL.value.minFont && g.measureText(vtxt).width > BOARD_TPL.value.maxW) {
        fs -= 1;
        g.font = `bold ${fs}px ${FONT}`;
      }
      g.fillStyle = k === 0 ? '#FACC15' : k === 1 ? '#E5E7EB' : k === 2 ? '#FB923C' : '#FFFFFF';
      g.fillText(fitText(g, vtxt, BOARD_TPL.value.maxW), BOARD_TPL.value.x, cy + fs * 0.36);
      continue;
    }
    if (!T) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      roundRect(g, 40, y, 720, 66, 16);
      g.fill();
    }
    const rankColor = k === 0 ? '#FACC15' : k === 1 ? '#E5E7EB' : k === 2 ? '#FB923C' : '#FFFFFF';

    // rank (centered at x = 80)
    g.textAlign = 'center';
    g.fillStyle = r ? rankColor : 'rgba(255,255,255,0.35)';
    g.font = `bold ${k < 3 ? 30 : 26}px ${FONT}`;
    g.fillText(String(k + 1), 80, y + 43);
    g.textAlign = 'left';

    if (!r) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.font = `bold 22px ${FONT}`;
      g.fillText('—', 182, y + 42);
      continue;
    }

    // round avatar (diameter 44, x 122-166)
    const cx = 144;
    const cy = y + 33;
    g.fillStyle = k < 3 ? rankColor : '#D946EF';
    g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.fill();
    g.save();
    g.beginPath();
    g.arc(cx, cy, 22, 0, Math.PI * 2);
    g.closePath();
    g.clip();
    const img = avatars[k];
    if (img) {
      const s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx - 22, cy - 22, 44, 44);
    } else {
      g.fillStyle = '#5865F2';
      g.fillRect(cx - 22, cy - 22, 44, 44);
      g.fillStyle = '#fff';
      g.font = `bold 22px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(String(r.name || '?')[0].toUpperCase(), cx, cy + 8);
      g.textAlign = 'left';
    }
    g.restore();

    // pseudo (x 182 -> 530)
    g.fillStyle = '#FFFFFF';
    g.font = `bold 24px ${FONT}`;
    g.fillText(fitText(g, r.name, 348), 182, y + 42);

    // value right-aligned (x ... 744)
    g.textAlign = 'right';
    g.fillStyle = k < 3 ? rankColor : '#FFFFFF';
    g.font = `bold 24px ${FONT}`;
    g.fillText(fitText(g, r.main, 204), 744, r.sub ? y + 33 : y + 42);
    if (r.sub) {
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = `13px ${FONT}`;
      g.fillText(fitText(g, r.sub, 204), 744, y + 54);
    }
    g.textAlign = 'left';
  }
  const boardFile = { rich: 'richest_leaderboard.png', alltime: 'alltime_leaderboard.png', invites: 'top_inviters_leaderboard.png' }[kind];
  return TPL ? await animOrPng(cv, boardFile, bgUrl) : cv.toBuffer('image/png');
}

const cleanTxt = (s) => String(s || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
const plainNum = (n) => num(n).replace(/\s/g, ' ');

// ------------------------------------------------------------
//  INVITE NOTIFICATION IMAGE (Railway variable: INVITE_NOTIF_BG_URL)
//  Provided image: notif_invitation.png, 1774x887 px (2:1 ratio). In image mode, positions (800x400 reference):
//    inviter avatar (103,115) d84 | invitee avatar (534,115) d84 | title x171 y100 | inviter username x171 y137
//    bar: "INVITED" x77 y196, invitee username right-aligned x627 y197 | reward centered x387 (y252 label, y302 amount) Logical reference 800x400 (final image 1000x500).
//  Hardcoded positions (x2 for your image):
//    title         : centered x=400, baseline y=70, area x 100-700 / y 35-85
//    inviter avatar : center (200, 190), diameter 120 | username centered x=200, baseline y=290 (max width 300)
//    "invited"     : centered x=400, baseline y=198 (area x 310-490)
//    invitee avatar  : center (600, 190), diameter 120 | username centered x=600, baseline y=290 (max width 300)
//    reward        : centered x=400, baseline y=355, area x 150-650 / y 320-370
// ------------------------------------------------------------
// ============================================================
//  IMAGE CARDS (win, result, daily, transfer, announcement, online, menu, invitation)
//  Template: "profile card" 1774x887 (1 round avatar, banner, bar, 6 cells) -> 800x400 reference.
//  Railway variables: WIN_NOTIF_BG_URL, RESULT_BG_URL, DAILY_BG_URL, TRANSFER_BG_URL, ANNOUNCE_BG_URL,
//                      ONLINE_BG_URL, MENU_BG_URL, INVITE_NOTIF_BG_URL   (direct png/jpg link)
//  No variable => old text display.
// ============================================================
const CARD_BG = {
  win: bgSource('WIN_NOTIF_BG_URL', 'win_notification.png'),
  result: bgSource('RESULT_BG_URL', 'game_result.png'),
  daily: bgSource('DAILY_BG_URL', 'daily_reward.png'),
  transfer: bgSource('TRANSFER_BG_URL', 'transfer.png'),
  announce: bgSource('ANNOUNCE_BG_URL', 'announcement.png'),
  online: bgSource('ONLINE_BG_URL', 'online_games.png'),
  menu: bgSource('MENU_BG_URL', 'casino_menu.png'),
  invite: bgSource('INVITE_NOTIF_BG_URL', 'invite_notification.png'),
};
const CARD_FILE = {
  win: 'win_notification.png',
  result: 'game_result.png',
  daily: 'daily_reward.png',
  transfer: 'transfer.png',
  announce: 'announcement.png',
  online: 'online_games.png',
  menu: 'casino_menu.png',
  invite: 'invite_notification.png',
};
const CARD_L = {
  av: { cx: 103, cy: 114.5, d: 84 },
  tx: 171,
  bar: { x: 61, y: 175, w: 582, h: 33 },
  cols: [[64, 198], [271, 199], [480, 230]],
  rows: [[220, 45], [271, 45]],
};
// text without emoji (canvas does not display emoji); keeps the text currency symbol
const noEmoji = (s) => {
  const keep = '\uE000';
  return String(s ?? '')
    .split(COIN).join(COIN_PLAIN)
    .split(COIN_PLAIN).join(keep)
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, '')
    .split(keep).join(COIN_PLAIN)
    .replace(/\s+/g, ' ')
    .trim();
};
const dateFR = () => new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Paris', month: '2-digit', day: '2-digit', year: 'numeric' });

function drawStar(g, cx, cy, r) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.42 : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
}

// d = { avatar, icon(url), tag, headline, sub, barLeft, barRight, cells: [[label, value, color?] x6] }
async function renderCard(kind, d) {
  if (!canvasLib) return null;
  const { createCanvas, loadImage } = canvasLib;
  // 1) Railway link  2) local images/… file  3) drawn purple gradient (the card is ALWAYS an image)
  let bgImg = await getBgByUrl(CARD_BG[kind], loadImage);
  if (!bgImg && CARD_FILE[kind]) bgImg = await getBgByUrl(localImg(CARD_FILE[kind]), loadImage);
  const W = 800, H = 400, SCALE = 1.25;
  const cv = createCanvas(W * SCALE, H * SCALE);
  const g = cv.getContext('2d');
  g.scale(SCALE, SCALE);
  const FONT = STATS_FONT;
  const S = noEmoji;
  if (bgImg) {
    const k = Math.max(W / bgImg.width, H / bgImg.height);
    const sw = W / k, sh = H / k;
    g.drawImage(bgImg, (bgImg.width - sw) / 2, (bgImg.height - sh) / 2, sw, sh, 0, 0, W, H);
  } else {
    console.warn(`[card ${kind}] background image not found: fallback purple gradient`);
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1A0B2E');
    bg.addColorStop(0.5, '#4C1D95');
    bg.addColorStop(1, '#A81CFD');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,3,30,0.6)';
    roundRect(g, 50, 70, 695, 270, 18);
    g.fill();
    g.fillStyle = 'rgba(168,85,247,0.55)';
    roundRect(g, CARD_L.bar.x, CARD_L.bar.y, CARD_L.bar.w, CARD_L.bar.h, 10);
    g.fill();
    g.fillStyle = 'rgba(12,3,30,0.75)';
    for (const [ry, rh] of CARD_L.rows) for (const [cx, cw] of CARD_L.cols) {
      roundRect(g, cx, ry, cw, rh, 10);
      g.fill();
    }
  }

  // round avatar (in the template frame)
  const A = CARD_L.av;
  const av = d.avatar ? await getAvatarCached(d.avatar, loadImage) : null;
  g.save();
  g.beginPath(); g.arc(A.cx, A.cy, A.d / 2, 0, Math.PI * 2); g.closePath(); g.clip();
  if (av) {
    const sq = Math.min(av.width, av.height);
    g.drawImage(av, (av.width - sq) / 2, (av.height - sq) / 2, sq, sq, A.cx - A.d / 2, A.cy - A.d / 2, A.d, A.d);
    g.restore();
  } else {
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    drawStar(g, A.cx, A.cy, A.d * 0.3);
  }

  // game icon on the right of the banner
  const icon = d.icon ? await loadRemoteImage(d.icon, loadImage) : null;
  if (icon) g.drawImage(icon, 531, 91, 62, 62);

  const tx = CARD_L.tx;
  const tmax = (icon ? 520 : 590) - tx;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `bold 13px ${FONT}`;
  g.fillText(fitText(g, S(d.tag).toUpperCase(), tmax), tx, 94);
  g.fillStyle = '#FFFFFF'; g.font = `bold 28px ${FONT}`;
  g.fillText(fitText(g, S(d.headline), tmax), tx, 121);
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = `15px ${FONT}`;
  g.fillText(fitText(g, S(d.sub), tmax), tx, 145);

  // bar: label on the left, value on the right
  const B = CARD_L.bar;
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = `bold 14px ${FONT}`;
  g.fillText(fitText(g, S(d.barLeft).toUpperCase(), 200), B.x + 16, B.y + B.h / 2 + 5);
  g.textAlign = 'right'; g.fillStyle = '#FFFFFF'; g.font = `bold 20px ${FONT}`;
  g.fillText(fitText(g, S(d.barRight), 380), B.x + B.w - 16, B.y + B.h / 2 + 7);
  g.textAlign = 'left';

  // 6 cells (3x2 grid)
  const boxes = CARD_L.rows.flatMap(([y, h]) => CARD_L.cols.map(([x, w]) => ({ x, y, w, h })));
  (d.cells || []).slice(0, 6).forEach(([label, value, color], n) => {
    const b = boxes[n];
    g.fillStyle = 'rgba(255,255,255,0.78)'; g.font = `bold 11px ${FONT}`;
    g.fillText(fitText(g, S(label).toUpperCase(), b.w - 28), b.x + 14, b.y + 17);
    g.fillStyle = color || '#FFFFFF';
    let fs = 19;
    g.font = `bold ${fs}px ${FONT}`;
    const v = S(value);
    while (fs > 11 && g.measureText(v).width > b.w - 28) { fs -= 1; g.font = `bold ${fs}px ${FONT}`; }
    g.fillText(fitText(g, v, b.w - 28), b.x + 14, b.y + 38);
  });
  return bgImg
    ? await animOrPng(cv, CARD_FILE[kind], CARD_BG[kind] || localImg(CARD_FILE[kind]))
    : cv.toBuffer('image/png');
}

async function makeCard(kind, d) {
  try {
    const buf = await renderCard(kind, d);
    if (!buf) return null;
    const name = `${kind}-${Date.now()}-${randomInt(1000, 9999)}.${imgExt(buf)}`;
    return { name, file: new AttachmentBuilder(buf, { name }) };
  } catch (e) {
    console.error(`[card ${kind}]`, e?.message || e);
    return null;
  }
}
async function editWithCard(i, payload) {
  if (payload.attachments === undefined && !payload.files?.length) payload.attachments = []; // removes animation images
  try {
    return await i.editReply(payload);
  } catch (e) {
    if (!payload.files?.length) throw e;
    console.error('[card] image rejected, falling back to text:', e?.message || e);
    payload.embeds.forEach((em) => em.setImage(null));
    payload.files = [];
    payload.attachments = [];
    return i.editReply(payload);
  }
}
// Image cards disabled — keep embed text only
function putCard(payload, card, embed) {
  return payload;
}
const userName = (u) => cleanTxt(u?.globalName || u?.username) || 'Player';
const cardColors = { win: '#86EFAC', lose: '#FCA5A5', push: '#E9D5FF' };
const coinTxt = (n) => `${plainNum(n)} ${COIN_PLAIN}`;

async function resultCard(user, game, bet, mult, profit, balance = null) {
  const kind = profit > 0 ? 'win' : profit < 0 ? 'lose' : 'push';
  const tag = kind === 'win' ? 'WIN' : kind === 'lose' ? 'LOSS' : 'TIE';
  const col = cardColors[kind];
  const payout = Math.max(0, round2(bet + profit));
  return makeCard('result', {
    avatar: user,
    icon: gameIcon(game),
    tag,
    headline: userName(user),
    sub: gameNamePlain(game),
    barLeft: balance == null ? 'RESULT' : 'BALANCE',
    barRight: balance == null ? tag : coinTxt(balance),
    cells: [
      ['GAME', gameNamePlain(game)],
      ['BET', coinTxt(bet)],
      ['MULTIPLIER', fx(mult)],
      ['TOTAL WIN', coinTxt(payout)],
      ['PROFIT', `${profit > 0 ? '+' : ''}${coinTxt(profit)}`, col],
      ['RESULT', tag, col],
    ],
  });
}

async function dailyPayload(user, res, content) {
  const payload = { content };
  const claimed = !!res?.claimed;
  const card = await makeCard('daily', {
    avatar: user,
    tag: 'DAILY REWARD',
    headline: userName(user),
    sub: claimed ? 'Daily claimed' : 'Daily already claimed today',
    barLeft: 'BALANCE',
    barRight: coinTxt(res?.balance ?? 0),
    cells: [
      ['RECEIVED', claimed ? `+${coinTxt(DAILY_AMOUNT)}` : '0', claimed ? '#86EFAC' : '#E9D5FF'],
      ['STATUS', claimed ? 'CLAIMED' : 'ALREADY TAKEN', claimed ? '#86EFAC' : '#FCA5A5'],
      ['PROCHAIN DAILY', 'MINUIT (PARIS)'],
      ['BALANCE', coinTxt(res?.balance ?? 0)],
      ['DAILY', coinTxt(DAILY_AMOUNT)],
      ['DATE', dateFR()],
    ],
  });
  if (card) {
    const e = new EmbedBuilder().setColor(COLORS.violet);
    putCard(payload, card, e);
    payload.embeds = [e];
  }
  return payload;
}

// "Announcement" card generated automatically from a admin broadcast embed
async function announceCardFor(embed) {
  const title = noEmoji(embed.data?.title || '');
  const desc = String(embed.data?.description || '');
  const bolds = [...desc.matchAll(/\*\*(.+?)\*\*/g)].map((m) => noEmoji(m[1])).filter(Boolean);
  const actorId = (desc.match(/<@!?(\d{15,25})>/) || [])[1];
  const actor = actorId ? await client.users.fetch(actorId).catch(() => null) : null;
  let label = 'INFO';
  let value = title || 'ANNOUNCEMENT';
  let color = '#FFFFFF';
  if (/Gift/i.test(title)) { label = 'GIFTED TO EVERY PLAYER'; value = `+${bolds[0] || ''}`; color = '#86EFAC'; }
  else if (/Multiplier/i.test(title)) { label = bolds[0] || 'MULTIPLIER'; value = bolds[1] || title; }
  else if (/Boost ended/i.test(title)) { label = 'EVENT ENDED'; value = bolds[0] || title; color = '#E9D5FF'; }
  else if (/Boost/i.test(title)) { label = `ACTIVE FOR ${bolds[0] || ''}`; value = title.replace(/^Boost\s*:?\s*/i, '') || title; }
  else if (/Reward/i.test(title)) { label = bolds[1] || 'REWARD'; value = bolds[0] || title; color = '#FACC15'; }
  else if (/Reset/i.test(title)) { label = 'ADMINISTRATION'; value = title; color = '#FCA5A5'; }
  return makeCard('announce', {
    avatar: actor,
    tag: 'ANNOUNCEMENT · ZNK CASINO',
    headline: title,
    sub: actor ? `By ${userName(actor)}` : 'Administration',
    barLeft: label,
    barRight: value,
    cells: [
      ['ANNOUNCEMENT', title],
      ['BY', actor ? userName(actor) : 'ADMIN'],
      [label, value, color],
      ['DETAIL', bolds[0] || '-'],
      ['DETAIL 2', bolds[1] || '-'],
      ['DATE', dateFR()],
    ],
  });
}

const iconCache = new Map();
async function loadRemoteImage(url, loadImage) {
  if (!url) return null;
  if (iconCache.has(url)) return iconCache.get(url);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const img = await loadImage(Buffer.from(await res.arrayBuffer()));
    iconCache.set(url, img);
    return img;
  } catch {
    return null;
  }
}

// Win notif from the wins channel (profile card template)
async function renderWinNotif(user, game, bet, mult, profit, detail = '') {
  const payout = round2(bet + profit);
  return renderCard('win', {
    avatar: user,
    icon: gameIcon(game),
    tag: 'WIN',
    headline: userName(user),
    sub: gameNamePlain(game),
    barLeft: 'WIN',
    barRight: `+${coinTxt(profit)}`,
    cells: [
      ['GAME', gameNamePlain(game)],
      ['BET', coinTxt(bet)],
      ['MULTIPLIER', fx(mult)],
      ['TOTAL WIN', coinTxt(payout)],
      ['PROFIT', `+${coinTxt(profit)}`, '#86EFAC'],
      ['DETAIL', detail || '-'],
    ],
  });
}

async function renderInviteNotif(inviter, invited, lang = 'en') {
  {
    const en0 = lang === 'en';
    const newCard = await renderCard('invite', {
      avatar: inviter,
      tag: en0 ? 'NEW INVITE' : 'NOUVELLE INVITATION',
      headline: userName(inviter),
      sub: `${en0 ? 'invited' : 'invited'} ${userName(invited)}`,
      barLeft: en0 ? 'REWARD' : 'REWARD',
      barRight: `+${coinTxt(INVITE_REWARD)}`,
      cells: [
        [en0 ? 'INVITER' : 'INVITANT', userName(inviter)],
        [en0 ? 'INVITED' : 'INVITED', userName(invited)],
        [en0 ? 'REWARD' : 'REWARD', `+${coinTxt(INVITE_REWARD)}`, '#86EFAC'],
        ['STATUS', en0 ? 'VALIDATED' : 'VALIDATED', '#86EFAC'],
        ['DATE', dateFR()],
        ['SERVER', 'ZNK CASINO'],
      ],
    });
    if (newCard) return newCard;
  }
  if (!canvasLib) return null;
  const { createCanvas, loadImage } = canvasLib;
  const W = 800;
  const H = 400;
  const SCALE = 1.25;
  const cv = createCanvas(W * SCALE, H * SCALE);
  const g = cv.getContext('2d');
  g.scale(SCALE, SCALE);
  const FONT = STATS_FONT;
  const en = lang === 'en';

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2B0A3D');
  bg.addColorStop(0.5, '#5B1A9E');
  bg.addColorStop(1, '#A81CFD');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const bgImg = await getBgByUrl(BOARD_BG.inviteNotif, loadImage);
  const T = !!bgImg; // template mode: the image already contains the decor, the bot only writes text
  if (T) {
    const k = Math.max(W / bgImg.width, H / bgImg.height);
    const sw = W / k;
    const sh = H / k;
    g.drawImage(bgImg, (bgImg.width - sw) / 2, (bgImg.height - sh) / 2, sw, sh, 0, 0, W, H);
  } else {
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.arc(W - 60, -20, 170, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-40, H + 20, 130, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(g, 100, 30, 600, 60, 18); g.fill();
    roundRect(g, 150, 318, 500, 54, 18); g.fill();
  }

  // ---- template mode (notif_invitation.png, 1774x887): positions aligned to the image ----
  if (T) {
    const clean1 = (u) => (u ? cleanTxt(u.globalName || u.username) || '?' : en ? 'Unknown user' : 'Unknown user');
    const avatarAt = async (user, cx, cy, D) => {
      g.save();
      g.beginPath();
      g.arc(cx, cy, D / 2, 0, Math.PI * 2);
      g.closePath();
      g.clip();
      const im = user ? await getAvatarCached(user, loadImage) : null;
      if (im) {
        const sq = Math.min(im.width, im.height);
        g.drawImage(im, (im.width - sq) / 2, (im.height - sq) / 2, sq, sq, cx - D / 2, cy - D / 2, D, D);
      } else {
        g.fillStyle = '#5865F2';
        g.fillRect(cx - D / 2, cy - D / 2, D, D);
        g.fillStyle = '#fff';
        g.font = `bold 32px ${FONT}`;
        g.textAlign = 'center';
        g.fillText('?', cx, cy + 11);
      }
      g.restore();
    };
    await avatarAt(inviter, 103, 115, 84);   // inviter's avatar (circle on the left)
    await avatarAt(invited, 534, 115, 84);   // invitee avatar (right circle)
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = `bold 13px ${FONT}`;
    g.fillText(en ? 'NEW INVITE' : 'NOUVELLE INVITATION', 171, 100);
    g.fillStyle = '#FFFFFF';
    g.font = `bold 28px ${FONT}`;
    g.fillText(fitText(g, clean1(inviter), 300), 171, 137);
    // purple bar: "invited" on the left, invitee username on the right
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = `bold 14px ${FONT}`;
    g.fillText(en ? 'INVITED' : 'INVITED', 77, 196);
    g.textAlign = 'right';
    g.fillStyle = '#FFFFFF';
    g.font = `bold 18px ${FONT}`;
    g.fillText(fitText(g, clean1(invited), 400), 627, 197);
    // reward centered in the bottom area
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.78)';
    g.font = `bold 16px ${FONT}`;
    g.fillText(en ? 'REWARD' : 'REWARD', 387, 252);
    g.fillStyle = '#86EFAC';
    g.font = `bold 52px ${FONT}`;
    g.fillText(fitText(g, `+${plainNum(INVITE_REWARD)} ${COIN_PLAIN}`, 500), 387, 302);
    g.textAlign = 'left';
    return await animOrPng(cv, 'invite_notification.png', BOARD_BG.inviteNotif);
  }

  // titre
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#FFFFFF';
  g.font = `bold 28px ${FONT}`;
  g.fillText(fitText(g, en ? 'NEW INVITE' : 'NOUVELLE INVITATION', 600), 400, 70);

  // two round avatars (diameter 120)
  const drawAvatar = async (user, cx, cy, D) => {
    if (!T) {
      g.fillStyle = '#D946EF';
      g.beginPath(); g.arc(cx, cy, D / 2 + 4, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.beginPath();
    g.arc(cx, cy, D / 2, 0, Math.PI * 2);
    g.closePath();
    g.clip();
    const img = user ? await getAvatarCached(user, loadImage) : null;
    if (img) {
      const sq = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - sq) / 2, (img.height - sq) / 2, sq, sq, cx - D / 2, cy - D / 2, D, D);
    } else {
      g.fillStyle = '#5865F2';
      g.fillRect(cx - D / 2, cy - D / 2, D, D);
      g.fillStyle = '#fff';
      g.font = `bold 52px ${FONT}`;
      g.textAlign = 'center';
      g.fillText('?', cx, cy + 18);
    }
    g.restore();
  };
  await drawAvatar(inviter, 200, 190, 120);
  await drawAvatar(invited, 600, 190, 120);

  const nameOf = (u) => (u ? cleanTxt(u.globalName || u.username) || '?' : en ? 'Unknown user' : 'Unknown user');
  g.textAlign = 'center';
  g.fillStyle = '#FFFFFF';
  g.font = `bold 24px ${FONT}`;
  g.fillText(fitText(g, nameOf(inviter), 300), 200, 290);
  g.fillText(fitText(g, nameOf(invited), 300), 600, 290);

  // "invited"
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = `bold 20px ${FONT}`;
  g.fillText(en ? 'invited' : 'invited', 400, 198);

  // reward
  g.fillStyle = '#86EFAC';
  g.font = `bold 26px ${FONT}`;
  g.fillText(fitText(g, `${en ? 'REWARD' : 'REWARD'}: +${plainNum(INVITE_REWARD)} ${COIN_PLAIN}`, 480), 400, 355);
  g.textAlign = 'left';

  return cv.toBuffer('image/png');
}

async function topInviters(guildId) {
  const counts = new Map();
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabase
      .from('invite_rewards')
      .select('inviter_id')
      .eq('guild_id', guildId)
      .order('invited_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data) counts.set(r.inviter_id, (counts.get(r.inviter_id) || 0) + 1);
    if (data.length < 1000) break;
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

async function getBoardData(kind, guild) {
  if (kind === 'rich') {
    const { data, error } = await supabase
      .from('players')
      .select('user_id, balance')
      .gt('balance', 0)
      .order('balance', { ascending: false })
      .limit(10);
    if (error) throw error;
    return data.map((r) => ({ id: r.user_id, value: Number(r.balance) }));
  }
  if (kind === 'alltime') {
    try {
      const { data } = await supabase.from('players').select('user_id, balance').gt('balance', 0).limit(50);
      if (data) for (const r of data) await touchPeak(r.user_id, Number(r.balance));
    } catch {
      /* ignore */
    }
    return [...peaks.entries()]
      .filter(([, p]) => p > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, value]) => ({ id, value }));
  }
  if (kind === 'invites') {
    if (!guild) return [];
    return (await topInviters(guild.id)).map(([id, value]) => ({ id, value }));
  }
  return [];
}

const BOARD_TITLES = {
  rich: { fr: 'RICHEST PLAYERS', en: 'RICHEST PLAYERS' },
  alltime: { fr: 'ALL-TIME · PEAK BALANCE', en: 'ALL-TIME · PEAK BALANCE' },
  invites: { fr: 'TOP INVITATIONS', en: 'TOP INVITERS' },
};
const boardRenderCache = new Map(); // kind:guild -> { sig, buf }

// Returns { buf, sig } (ready image) or null if canvas is unavailable.
async function renderBoard(kind, { lang = 'en', guild = null } = {}) {
  if (!canvasLib) return null;
  const en = lang === 'en';
  const data = await getBoardData(kind, guild);
  const sig = `${kind}|${guild?.id || ''}|${lang}|${BOARD_BG[kind]}|${data.map((d) => `${d.id}:${d.value}`).join(',')}`;
  const ckey = `${kind}:${guild?.id || ''}:${lang}`;
  const cached = boardRenderCache.get(ckey);
  if (cached && cached.sig === sig) return cached;

  const rows = [];
  for (const d of data) {
    const user = await client.users.fetch(d.id).catch(() => null);
    const name = user ? cleanTxt(user.globalName || user.username) || '?' : en ? 'Unknown user' : 'Unknown user';
    if (kind === 'invites') {
      rows.push({
        user,
        name,
        main: en ? `${d.value} invite${d.value > 1 ? 's' : ''}` : `${d.value} invited${d.value > 1 ? 's' : ''}`,
        sub: `+${plainNum(d.value * INVITE_REWARD)} ${COIN_PLAIN}`,
      });
    } else {
      rows.push({ user, name, main: `${plainNum(d.value)} ${COIN_PLAIN}`, val: plainNum(d.value) });
    }
  }
  const buf = await renderBoardImage({ kind, title: BOARD_TITLES[kind][en ? 'en' : 'fr'], rows, bgUrl: BOARD_BG[kind] });
  const out = { sig, buf };
  boardRenderCache.set(ckey, out);
  return out;
}

const boardFileName = (kind, buf) => `board-${kind}-${Date.now()}.${imgExt(buf)}`;

// Payload ready to send: { embeds, files, sig }. Falls back to the old text embed if canvas fails.
async function buildBoardPayload(kind, { lang = 'en', guild = null } = {}) {
  const en = lang === 'en';
  const textFallback = async () => {
    const embed = kind === 'rich' ? await buildLeaderboardEmbed(lang) : await buildAllTimeLeaderboardEmbed(lang);
    return { embeds: [embed], files: [], sig: embed.data?.description || '' };
  };
  return textFallback(); // image leaderboards removed — text only
  if (!canvasLib || kind === 'invites') return textFallback();
  try {
    const r = await renderBoard(kind, { lang, guild });
    if (!r?.buf) return textFallback();
    const name = boardFileName(kind, r.buf);
    const embed = new EmbedBuilder()
      .setColor(kind === 'rich' ? COLORS.gold : COLORS.violet)
      .setImage(`attachment://${name}`)
      .setFooter({
        text:
          kind === 'rich'
            ? en ? 'Auto-updated every minute' : 'Auto-updated every minute'
            : en ? 'Record = highest balance ever reached' : 'Record = highest balance ever reached',
      })
      .setTimestamp();
    return { embeds: [embed], files: [new AttachmentBuilder(r.buf, { name })], sig: r.sig };
  } catch (e) {
    console.error('[leaderboard] image', e?.message || e);
    return textFallback();
  }
}

// For message.edit: also replaces the old attachment
const editable = (p) => ({ embeds: p.embeds, files: p.files, attachments: [] });

async function buildInvitesPayload(guild, targetId, lang = 'en') {
  const textEmbed = await buildInvitesEmbed(guild, targetId);
  return { embeds: [textEmbed], files: [] }; // image cards removed
  if (!canvasLib) return { embeds: [textEmbed], files: [] };
  try {
    const r = await renderBoard('invites', { lang, guild });
    if (!r?.buf) return { embeds: [textEmbed], files: [] };
    const name = boardFileName('invites', r.buf);
    textEmbed.setColor(COLORS.violet).setImage(`attachment://${name}`);
    return { embeds: [textEmbed], files: [new AttachmentBuilder(r.buf, { name })] };
  } catch (e) {
    console.error('[invitations] image', e?.message || e);
    return { embeds: [textEmbed], files: [] };
  }
}

async function buildLeaderboardEmbed(lang = 'en') {
  const { data, error } = await supabase
    .from('players')
    .select('user_id, balance')
    .gt('balance', 0)
    .order('balance', { ascending: false })
    .limit(10);
  if (error) throw error;

  const medals = ['🥇', '🥈', '🥉'];
  const lines = [];
  for (let i = 0; i < data.length; i++) {
    const u = await client.users.fetch(data[i].user_id).catch(() => null);
    const name = u ? escapeMarkdown(u.globalName || u.username) : lang === 'en' ? 'Unknown user' : 'Unknown user';
    lines.push(`${medals[i] ?? `**${i + 1}.**`} ${name} : **${fmt(data[i].balance)}**`);
  }

  return new EmbedBuilder()
    .setTitle(lang === 'en' ? '🏆 Richest players' : '🏆 Richest players')
    .setColor(COLORS.gold)
    .setDescription(lines.length ? lines.join('\n') : lang === 'en' ? 'No balances yet.' : `Nobody has any ${COIN} yet.`)
    .setFooter({ text: lang === 'en' ? 'Auto-updated every minute' : 'Auto-updated every minute' })
    .setTimestamp();
}

async function buildAllTimeLeaderboardEmbed(lang = 'en') {
  try {
    const { data } = await supabase.from('players').select('user_id, balance').gt('balance', 0).limit(50);
    if (data) for (const r of data) await touchPeak(r.user_id, Number(r.balance));
  } catch {
    /* ignore */
  }

  const ranked = [...peaks.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const medals = ['🥇', '🥈', '🥉'];
  const lines = [];
  for (let i = 0; i < ranked.length; i++) {
    const [uid, peak] = ranked[i];
    const u = await client.users.fetch(uid).catch(() => null);
    const name = u ? escapeMarkdown(u.globalName || u.username) : lang === 'en' ? 'Unknown user' : 'Unknown user';
    lines.push(`${medals[i] ?? `**${i + 1}.**`} ${name} : **${fmt(peak)}**`);
  }

  return new EmbedBuilder()
    .setTitle(lang === 'en' ? '👑 All-time leaderboard (peak balance)' : '👑 All-time leaderboard (peak balance)')
    .setColor(COLORS.violet)
    .setDescription(
      lines.length ? lines.join('\n') : lang === 'en' ? 'No records yet. Peaks update on every win.' : 'No records yet. Peaks update on every win.'
    )
    .setFooter({ text: lang === 'en' ? 'Record = highest balance ever reached' : 'Record = highest balance ever reached' })
    .setTimestamp();
}

async function cmdLeaderboard(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);

  const { data: old } = await supabase.from('leaderboard_messages').select('*').eq('guild_id', msg.guild.id).maybeSingle();
  if (old) {
    try {
      const ch = await client.channels.fetch(old.channel_id);
      const m = await ch.messages.fetch(old.message_id);
      await m.delete();
    } catch {
      /* already removed */
    }
  }

  const sent = await msg.channel.send(await buildBoardPayload('rich'));
  const { error } = await supabase.from('leaderboard_messages').upsert({
    guild_id: msg.guild.id,
    channel_id: msg.channel.id,
    message_id: sent.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  msg.delete().catch(() => {});
}

let updatingLeaderboards = false;
async function updateLeaderboards() {
  if (updatingLeaderboards) return;
  updatingLeaderboards = true;
  try {
    const { data: rows, error } = await supabase.from('leaderboard_messages').select('*');
    if (error) throw error;

    if (rows && rows.length > 0) {
      const lbPayload = await buildBoardPayload('rich');
      for (const row of rows) {
        try {
          const ch = await client.channels.fetch(row.channel_id);
          if (lbSameSig(row.message_id, lbPayload.sig)) continue;
          const m = ch.messages.cache.get(row.message_id) || (await ch.messages.fetch(row.message_id));
          await m.edit(editable(lbPayload));
        } catch (e) {
          if ([10008, 10003, 50001, 50013].includes(e?.code)) {
            await supabase.from('leaderboard_messages').delete().eq('guild_id', row.guild_id);
          } else {
            console.error('[leaderboard] edit', e?.message || e);
          }
        }
      }
    }

    await ensureAlltimeMessages();
    if (alltimeBoardMessages.size > 0) {
      const allPayload = await buildBoardPayload('alltime');
      for (const [gid, info] of alltimeBoardMessages) {
        try {
          const ch = await client.channels.fetch(info.channelId);
          if (lbSameSig(info.messageId, allPayload.sig)) continue;
          const m = ch.messages.cache.get(info.messageId) || (await ch.messages.fetch(info.messageId));
          await m.edit(editable(allPayload));
        } catch (e) {
          if ([10008, 10003, 50001, 50013].includes(e?.code)) { alltimeBoardMessages.delete(gid); saveAlltimeMsgs(); }
          else console.error('[alltime] edit', e?.message || e);
        }
      }
    }
  } catch (e) {
    console.error('[leaderboard] update', e?.message || e);
  } finally {
    updatingLeaderboards = false;
  }
}

// ============================================================
//  MESSAGES (written commands)
// ============================================================
// ============================================================
//  MESSAGES — slash commands only
// ============================================================
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  if (!msg.content.startsWith(PREFIX)) return;
  const cmd = msg.content.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (!cmd) return;
  // No more prefix! — point users to /
  if (msg.author.id !== msg.guild.ownerId) {
    return msg.reply(CROWN_ONLY).catch(() => {});
  }
  return msg
    .reply({
      content:
        `Commands with **\`!\`** are disabled.\nUse **slash commands**: type **\`/\`** then choose (e.g. \`/help\`, \`/setup\`, \`/admin\`).`,
    })
    .catch(() => {});
});

// ============================================================
//  BUTTONS, MENUS AND POP-UPS
// ============================================================
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) {
      return handleSlashCommand(i);
    }
    if (!i.customId) return;
    if (
      !i.guild &&
      !userHomeGuild.has(i.user.id) &&
      !['panel_', 'modal_', 'ig_', 'rl_', 'bj_', 'mines_', 'replay|', 'event_'].some((p) => i.customId.startsWith(p))
    ) {
      return;
    }
    const id = i.customId;

    if (id.startsWith('admin_') || id.startsWith('modal_admin_')) return await handleAdmin(i);
    if (i.isButton() && (await handleTicketButton(i))) return;
    if (i.isModalSubmit() && (await handleTicketModal(i))) return;

    if (id.startsWith('event_claim_') && i.isButton()) return await handleEventClaim(i);
    if (id.startsWith('event_join_') && i.isButton()) return await handleEventJoin(i);

    if ((id.startsWith('poker_') || id.startsWith('online_')) && i.isButton()) return await handlePokerButton(i);
    if (id === 'modal_search_game' && i.isModalSubmit()) {
      const q = i.fields.getTextInputValue('q')?.trim() || '';
      if (!q) return respondText(i, 'Enter a keyword.');
      return i.reply({ ...buildGameMenuPayload(i.user.id, 0, 'search', q), flags: EPH });
    }

    const isGame =
      id.startsWith('panel_') ||
      id.startsWith('mines_') ||
      id.startsWith('bj_') ||
      id.startsWith('rl_') ||
      id.startsWith('ig_') ||
      id.startsWith('replay|') ||
      id.startsWith('modal_');
    if (!isGame) return;

    if (i.isModalSubmit()) return await handleModalSubmit(i);

    if (i.isUserSelectMenu() && id === 'panel_send_pick') {
      const userId = i.values[0];
      if (userId === i.user.id) {
        return i.update({ content: `❌ You cannot send ${COIN} to yourself.`, components: [] });
      }
      if (i.users?.get(userId)?.bot) {
        return i.update({ content: `❌ You cannot send ${COIN} to a bot.`, components: [] });
      }
      return i.showModal(
        new ModalBuilder()
          .setCustomId(`modal_send_${userId}`)
          .setTitle(`💸 Send ${COIN_PLAIN}`)
          .addComponents(modalInput('amount', 'Amount to send (or "all")', { placeholder: 'e.g.: 5' }))
      );
    }

    if (i.isStringSelectMenu() && id === 'panel_gameselect') {
      const key = i.values[0];
      i.customId = `panel_${key}`;
      return await handlePanelButton(i);
    }

    if (!i.isButton()) return;

    if (id.startsWith('panel_')) return await handlePanelButton(i);
    if (id.startsWith('replay|')) return await handleReplay(i);
    if (id.startsWith('mines_lvl_')) {
      const level = id.slice('mines_lvl_'.length);
      if (!LEVELS[level]) return;
      const bal = await getBalance(i.user.id);
      return i.showModal(minesBetModal(level, bal));
    }
    if (id.startsWith('mines_')) return await handleMinesButton(i);
    if (id.startsWith('bj_')) return await handleBlackjackButton(i);
    if (id.startsWith('ig_')) {
      const [, key, choice] = id.split('_');
      if (!INSTANT[key]?.choices.includes(choice)) return;
      const bal = await getBalance(i.user.id);
      return i.showModal(instantBetModal(key, choice, bal));
    }
    if (id.startsWith('rl_')) {
      const key = id.slice('rl_'.length);
      if (!(key === 'num' || parseRouletteBet(key))) return;
      const bal = await getBalance(i.user.id);
      return i.showModal(rouletteModal(key, bal));
    }
  } catch (e) {
    console.error('[interaction]', e);
    const detail = String(e?.message || e || 'unknown error').slice(0, 300);
    const text = `⚠️ An error occurred: \`${detail}\``;
    try {
      if (i.deferred || i.replied) await i.followUp({ content: text, flags: EPH }).catch(() => {});
      else if (i.isRepliable?.()) await i.reply({ content: text, flags: EPH }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
});

// ============================================================
//  INVITATIONS: +1 coin for whoever invites someone who joins
// ============================================================
const inviteCache = new Map();
const rewardedLocal = new Set();

async function cacheInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    inviteCache.set(
      guild.id,
      new Map(invites.map((inv) => [inv.code, { uses: inv.uses ?? 0, max: inv.maxUses ?? 0, inviterId: inv.inviter?.id ?? null }]))
    );
    return true;
  } catch (e) {
    console.error(`[invitations] ${guild.name}: could not read invites ("Manage Server" permission required):`, e?.message || e);
    return false;
  }
}

async function claimInviteReward(guildId, invitedId, inviterId) {
  const key = `${guildId}:${invitedId}`;
  if (rewardedLocal.has(key)) return false;
  const { error } = await supabase.from('invite_rewards').insert({ guild_id: guildId, invited_id: invitedId, inviter_id: inviterId });
  if (error) {
    if (error.code === '23505') return false;
    console.error('[invitations] table invite_rewards inaccessible (lance schema_v3.sql) :', error.message);
  }
  rewardedLocal.add(key);
  return true;
}

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (member.user.bot) return;
    const guild = member.guild;
    const old = inviteCache.get(guild.id);
    let fresh;
    try {
      fresh = await guild.invites.fetch();
    } catch {
      return;
    }

    let inviterId = null;
    if (old) {
      const used = fresh.find((inv) => (inv.uses ?? 0) > (old.get(inv.code)?.uses ?? 0));
      if (used) inviterId = used.inviter?.id ?? null;
      else {
        for (const [code2, o] of old) {
          if (!fresh.has(code2) && o.max > 0 && o.uses + 1 >= o.max) {
            inviterId = o.inviterId;
            break;
          }
        }
      }
    }
    inviteCache.set(
      guild.id,
      new Map(fresh.map((inv) => [inv.code, { uses: inv.uses ?? 0, max: inv.maxUses ?? 0, inviterId: inv.inviter?.id ?? null }]))
    );

    if (!inviterId || inviterId === member.id) return;
    if (!(await claimInviteReward(guild.id, member.id, inviterId))) return;

    await credit(inviterId, INVITE_REWARD);
    const notifId = guildChannels.get(`${guild.id}:invites`) || casinoChannels.get(guild.id);
    const ch = notifId ? await client.channels.fetch(notifId).catch(() => null) : null;
    if (ch) {
      const inviter = await client.users.fetch(inviterId).catch(() => null);
      const embed = new EmbedBuilder()
        .setColor(COLORS.violet)
        .setAuthor({
          name: inviter ? `${inviter.globalName || inviter.username} invited someone!` : 'New invite',
          iconURL: inviter?.displayAvatarURL(),
        })
        .setDescription(`📨 <@${inviterId}> invited <@${member.id}>\n🎁 Reward: **${fmt(INVITE_REWARD)}**`)
        .setTimestamp();
      const payload = { embeds: [embed] };
      try {
        const buf = await renderInviteNotif(inviter, member.user, 'en');
        if (buf) {
          const fname = `invite-${Date.now()}.${imgExt(buf)}`;
          embed.setImage(`attachment://${fname}`);
          payload.files = [new AttachmentBuilder(buf, { name: fname })];
        } else {
          embed.setThumbnail(member.user.displayAvatarURL());
        }
      } catch (e) {
        console.error('[invitations] image notif', e?.message || e);
        embed.setThumbnail(member.user.displayAvatarURL());
      }
      ch.send(payload).catch(() => {});
    }
  } catch (e) {
    console.error('[invitations] join', e?.message || e);
  }
});

client.on(Events.InviteCreate, (inv) => {
  if (!inv.guild) return;
  const m = inviteCache.get(inv.guild.id) || new Map();
  m.set(inv.code, { uses: inv.uses ?? 0, max: inv.maxUses ?? 0, inviterId: inv.inviter?.id ?? null });
  inviteCache.set(inv.guild.id, m);
});
client.on(Events.InviteDelete, () => {});
client.on(Events.GuildCreate, (guild) => cacheInvites(guild));

async function buildInvitesEmbed(guild, targetId) {
  const [{ count, error: countError }, { data, error: listError }] = await Promise.all([
    supabase
      .from('invite_rewards')
      .select('invited_id', { count: 'exact', head: true })
      .eq('guild_id', guild.id)
      .eq('inviter_id', targetId),
    supabase.from('invite_rewards').select('invited_id').eq('guild_id', guild.id).eq('inviter_id', targetId).limit(20),
  ]);
  if (countError) throw countError;
  if (listError) throw listError;

  const invitedIds = [...new Set((data || []).map((row) => row.invited_id).filter(Boolean))];
  const members = invitedIds.length ? invitedIds.map((id) => `<@${id}>`).join('\n') : 'No invited members recorded yet.';
  const total = count ?? 0;

  return new EmbedBuilder()
    .setTitle('📨 Your invites')
    .setColor(COLORS.blue)
    .setDescription(`You invited **${total}** member(s) and received **${fmt(total * INVITE_REWARD)}**.`)
    .addFields({ name: `Invited members${total > 20 ? ' (20 shown)' : ''}`, value: members.slice(0, 1024) });
}

async function cmdInvites(msg, args) {
  const targetId = parseUserId(args[0]) || msg.author.id;
  return msg.reply(await buildInvitesPayload(msg.guild, targetId));
}

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  const gid = channel.guild.id;
  if (casinoChannels.get(gid) === channel.id) {
    casinoChannels.delete(gid);
    await supabase.from('casino_channels').delete().eq('guild_id', gid);
  }
  for (const kind of ['wins', 'admin', 'invites', 'alltime', 'notifs', 'poker', 'online']) {
    if (guildChannels.get(`${gid}:${kind}`) === channel.id) {
      guildChannels.delete(`${gid}:${kind}`);
      alltimeBoardMessages.delete(gid);
      saveAlltimeMsgs();
      await supabase.from('guild_channels').delete().eq('guild_id', gid).eq('kind', kind);
    }
  }
});

// Dedicated image for each game: images/games/<key>.jpg (otherwise generic card)
const GAME_BG_BY_NAME = new Map();
const GAME_BG_BY_TITLE = new Map();
const GAME_BG_BY_ICON = new Map();
for (const k of Object.keys(GAME_NAMES)) {
  GAME_BG_BY_NAME.set(gameNamePlain(k).toUpperCase(), k);
  GAME_BG_BY_TITLE.set(GAME_NAMES[k], k);
  const ic = gameIcon(k);
  GAME_BG_BY_ICON.set(ic, GAME_BG_BY_ICON.has(ic) ? null : k); // icon shared by several games: ignored
}
function gameBgForEmbed(e) {
  const authorName = String(e?.author?.name || '');
  const last = authorName.includes('•') ? authorName.split('•').pop().trim().toUpperCase() : '';
  const key =
    GAME_BG_BY_NAME.get(last) ||
    GAME_BG_BY_TITLE.get(String(e?.title || '').trim()) ||
    GAME_BG_BY_ICON.get(e?.thumbnail?.url) ||
    null;
  if (!key) return null;
  return localImg(`games/${key}.jpg`) || null;
}

// ============================================================
//  TEXT -> IMAGE: no more "normal" text, everything is converted to an image (see textcard.js)
//  Temporarily disable: Railway TEXT_CARDS=off variable
// ============================================================
// TEXT CARDS / image message system DISABLED — plain Discord embeds only
// (ONLINE panel banner is still attached via withBanner for panel_online.png only)




// ============================================================
// ============================================================
//  TICKETS CLAIM REWARDS (shop order codes)
// ============================================================
function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.violet)
    .setTitle('🎁 Claim rewards')
    .setDescription(
      'Bought a reward on the **website** and received an **order code**?\n\n' +
        '1. Click **Open a ticket**\n' +
        '2. Enter your order code\n' +
        '3. The channel is renamed after your reward (Nitro, Role…)\n' +
        '4. Staff delivers it, or the role is given **automatically**\n\n' +
        'Server owner can mark the reward as **delivered** inside the ticket.'
    )
    .setFooter({ text: 'One order code = one shop order' });
}
function ticketPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim_open').setLabel('Open a ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary)
  );
}

async function cmdTicketSetup(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY).catch(() => {});
  const category = msg.mentions.channels.find((c) => c.type === ChannelType.GuildCategory) || null;
  const shop = webApp.shop;
  if (!shop) return msg.reply('Web shop unavailable (shop module).');
  if (category) shop.setTicketCfg(msg.guild.id, { categoryId: category.id });
  const payload = { embeds: [buildTicketPanelEmbed()], components: [ticketPanelRow()] };
  const sent = await msg.channel.send(payload);
  shop.setTicketCfg(msg.guild.id, { panelChannelId: sent.id, categoryId: category?.id || shop.getTicketCfg(msg.guild.id)?.categoryId || null });
  return msg.reply({ content: 'Ticket panel posted.' + (category ? ' Category: ' + category.name : ' (optional: /ticketsetup + category)') }).catch(() => {});
}

async function handleTicketButton(i) {
  // Close ticket
  if (i.customId === 'ticket_claim_close') {
    if (!i.channel || !i.guild) return i.reply({ content: 'Only usable inside a ticket.', flags: EPH });
    const isOwner = i.guild.ownerId === i.user.id;
    const isAdm = i.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels) || isOwner;
    if (!isAdm && i.channel.topic && !String(i.channel.topic).includes(i.user.id)) {
      return i.reply({ content: 'Only staff (or the ticket creator) can close this ticket.', flags: EPH });
    }
    await i.reply({ content: 'Ticket closes in 3 seconds…' }).catch(() => {});
    setTimeout(() => i.channel.delete('Ticket claim closed').catch(() => {}), 3000);
    return true;
  }

  // Owner / staff: mark reward as delivered
  if (i.customId.startsWith('ticket_claim_deliver|')) {
    if (!i.guild || !i.channel) return i.reply({ content: 'Only usable inside a ticket.', flags: EPH });
    const isOwner = i.guild.ownerId === i.user.id;
    const isAdm = i.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels) || isOwner;
    if (!isAdm) return i.reply({ content: 'Only the server owner or staff can mark a reward as delivered.', flags: EPH });
    const code = i.customId.split('|')[1];
    const shop = webApp.shop;
    if (!shop) return i.reply({ content: 'Shop unavailable.', flags: EPH });
    const order = shop.getOrder(code);
    if (!order) return i.reply({ content: '❌ Order code not found.', flags: EPH });
    if (order.status === 'delivered') return i.reply({ content: '✅ Already marked as delivered.', flags: EPH });
    try {
      shop.markDelivered(code);
    } catch (e) {
      return i.reply({ content: '❌ Could not update order: ' + (e?.message || e), flags: EPH });
    }
    // Disable buttons on the message
    try {
      const disabled = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim_deliver_done').setLabel('Reward delivered').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('ticket_claim_close').setLabel('Close ticket').setStyle(ButtonStyle.Danger)
      );
      await i.update({
        content: i.message.content || undefined,
        embeds: i.message.embeds,
        components: [disabled],
      });
    } catch {
      await i.reply({ content: `✅ Order \`${code}\` marked as **delivered**. The code no longer works.`, flags: EPH }).catch(() => {});
    }
    try {
      await i.channel.send(`✅ **Reward delivered** by <@${i.user.id}>\nOrder code \`${code}\` (\`${order.rewardName}\`) is now closed and can no longer be used.`);
    } catch {}
    return true;
  }

  if (i.customId !== 'ticket_claim_open') return false;
  if (!i.guild) return i.reply({ content: 'Only usable in a server.', flags: EPH });
  const modal = new ModalBuilder()
    .setCustomId('modal_ticket_code')
    .setTitle('Shop order code')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('code').setLabel('Your order code').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(6).setMaxLength(16).setPlaceholder('e.g. AB12CD34')
      )
    );
  await i.showModal(modal);
  return true;
}

async function handleTicketModal(i) {
  if (i.customId !== 'modal_ticket_code') return false;
  const code = String(i.fields.getTextInputValue('code') || '').trim().toUpperCase();
  const shop = webApp.shop;
  if (!shop) return i.reply({ content: 'Shop unavailable.', flags: EPH });

  // STRICT validation FIRST — never create a ticket on invalid/foreign/delivered codes.
  // Prefer the async Supabase lookup (the shop polls it for codes placed on the website);
  // fall back to the in-memory sync lookup for older orders.
  const order = (shop.getOrderAsync ? await shop.getOrderAsync(code) : null) || shop.getOrder(code);
  if (!order) {
    return i.reply({ content: '❌ Invalid order code. Check the code from the website and try again in a few seconds.', flags: EPH });
  }
  if (String(order.uid) !== String(i.user.id)) {
    return i.reply({ content: '❌ This code does not belong to you. No ticket created.', flags: EPH });
  }
  if (order.status === 'delivered') {
    return i.reply({ content: '✅ This order was already delivered. The code no longer works.', flags: EPH });
  }

  // Auto-role delivery: grant immediately, confirm by DM, and never open a ticket on success.
  if (order.type === 'role' && order.roleId) {
    try {
      const member = await i.guild.members.fetch(i.user.id);
      await member.roles.add(order.roleId, `Shop order ${order.code}`);
      try {
        shop.markDelivered(order.code);
      } catch (markErr) {
        console.error('[ticket] role markDelivered', markErr?.message || markErr);
      }
      const confirmText =
        `✅ **Role added**\n` +
        `The role **${order.rewardName}** has been added to your account.\n` +
        `Order code: \`${order.code}\``;
      try {
        await i.user.send({ content: confirmText });
      } catch (dmErr) {
        console.error('[ticket] role DM', dmErr?.message || dmErr);
      }
      // Always reply ephemerally too, so the confirmation is visible even if the DM failed.
      return i.reply({ content: confirmText, flags: EPH });
    } catch (e) {
      console.error('[ticket] role', e?.message || e);
      // fall through to create ticket if role grant failed
    }
  }

  const cfg = shop.getTicketCfg(i.guild.id) || {};
  const parent = cfg.categoryId || undefined;
  const slugName = String(order.rewardName || 'reward')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'reward';
  const base = `${slugName}-${order.code}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);

  let ch;
  try {
    ch = await i.guild.channels.create({
      name: base,
      type: ChannelType.GuildText,
      parent: parent || null,
      topic: `Order ${order.code} · ${order.rewardName} · ${i.user.id}`,
      permissionOverwrites: [
        { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: i.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
      ],
      reason: `Claim reward ${order.code}`,
    });
  } catch (e) {
    console.error('[ticket]', e);
    return i.reply({ content: 'Could not create the channel (bot needs Manage Channels).', flags: EPH });
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.violet)
    .setTitle(String(order.rewardName || 'Reward'))
    .setDescription(
      `**Player:** <@${i.user.id}>\n**Order code:** \`${order.code}\`\n**Type:** ${order.type}\n**Price paid:** ${order.price} ${COIN_PLAIN}\n**Ticket:** ${ch}\n\n` +
        (order.type === 'nitro'
          ? 'Staff: deliver the Nitro, then click **Mark delivered**.'
          : 'Staff: deliver the reward, then click **Mark delivered**.')
    )
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_claim_deliver|' + order.code)
      .setLabel('Mark delivered')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_claim_close').setLabel('Close ticket').setStyle(ButtonStyle.Danger)
  );
  await ch.send({
    content: `<@${i.user.id}> Ticket opened for order \`${order.code}\` — ${ch}`,
    embeds: [embed],
    components: [row],
  });
  await i.reply({ content: `✅ Ticket opened in #${ch.name} — ${ch}\nOrder code: \`${code}\``, flags: EPH });
  return true;
}


/** "message"-like context to reuse existing cmd* functions from a slash command */
function slashCtx(i) {
  return {
    author: i.user,
    member: i.member,
    guild: i.guild,
    channel: i.channel,
    mentions: {
      users: {
        first: () => i.options.getUser('membre') || null,
      },
      channels: {
        find: (fn) => {
          const c = i.options.getChannel('categorie');
          if (c && typeof fn === 'function' && fn(c)) return c;
          return null;
        },
      },
    },
    reply: async (payload) => {
      const data = typeof payload === 'string' ? { content: payload } : { ...payload };
      // owner command replies = ephemeral unless already flagged
      if (data.flags == null) data.flags = EPH;
      if (!i.replied && !i.deferred) return i.reply(data);
      return i.followUp(data);
    },
    delete: async () => {},
  };
}

function requireOwner(i) {
  if (!i.guild) {
    return i.reply({ content: 'Only usable in a server.', flags: EPH }).then(() => false);
  }
  if (i.user.id !== i.guild.ownerId) {
    return i.reply({ content: CROWN_ONLY, flags: EPH }).then(() => false);
  }
  return Promise.resolve(true);
}

async function handleSlashCommand(i) {
  try {
    if (!(await requireOwner(i))) return;

    const name = i.commandName;
    const msg = slashCtx(i);
    const member = i.options.getUser('membre');
    const amountOpt = i.options.getNumber('montant');

    switch (name) {
      case 'help':
      case 'aide':
        return i.reply({ embeds: [buildHelpEmbed()], flags: EPH });
      case 'balance':
      case 'solde': {
        const targetId = member?.id || i.user.id;
        const bal = await getBalance(targetId);
        if (targetId === i.user.id) return i.reply({ content: `💰 Your balance: **${fmt(bal)}**`, flags: EPH });
        return i.reply({ content: `💰 Balance of <@${targetId}>: **${fmt(bal)}**`, flags: EPH });
      }
      case 'daily':
        return cmdDaily(msg);
      case 'invites': {
        const targetId = member?.id || i.user.id;
        return i.reply({ ...(await buildInvitesPayload(i.guild, targetId)), flags: EPH });
      }
      case 'casino':
      case 'jeux': {
        await i.channel.send(buildPanelPayload());
        return i.reply({ content: '✅ Game panel posted.', flags: EPH });
      }
      case 'setup':
      case 'salon':
        return cmdSetup(msg);
      case 'wins':
        return cmdWins(msg);
      case 'classement':
        return cmdLeaderboard(msg);
      case 'admin':
        return cmdAdmin(msg);
      case 'add': {
        if (!member || amountOpt == null) {
          return i.reply({ content: 'Usage: `/add member:@… amount:…`', flags: EPH });
        }
        return cmdAdjust(msg, [member.id, String(amountOpt)], +1);
      }
      case 'remove': {
        if (!member || amountOpt == null) {
          return i.reply({ content: 'Usage: `/remove member:@… amount:…`', flags: EPH });
        }
        return cmdAdjust(msg, [member.id, String(amountOpt)], -1);
      }
      case 'invites-notif':
        return cmdInvitesNotif(msg);
      case 'ticketsetup': {
        // adapt category from option
        const cat = i.options.getChannel('categorie');
        const fake = slashCtx(i);
        fake.mentions.channels.find = (fn) => (cat && fn(cat) ? cat : null);
        return cmdTicketSetup(fake);
      }
      default:
        return i.reply({ content: 'Unknown command. Use `/help`.', flags: EPH });
    }
  } catch (e) {
    console.error(`[slash:${i.commandName}]`, e);
    const text = `⚠️ Error: ${explainError(e)}`;
    if (i.replied || i.deferred) return i.followUp({ content: text, flags: EPH }).catch(() => {});
    return i.reply({ content: text, flags: EPH }).catch(() => {});
  }
}

async function registerSlashCommands() {
  try {
    const commands = [
      new SlashCommandBuilder().setName('help').setDescription('ZNK Casino command guide (owner)'),
      new SlashCommandBuilder().setName('aide').setDescription('ZNK Casino command guide (owner)'),
      new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Shows a balance (owner)')
        .addUserOption((o) => o.setName('membre').setDescription('Member (default: you)')),
      new SlashCommandBuilder().setName('solde').setDescription('Alias of /balance').addUserOption((o) => o.setName('membre').setDescription('Member')),
      new SlashCommandBuilder().setName('daily').setDescription('Daily reward (owner)'),
      new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Invite statistics (owner)')
        .addUserOption((o) => o.setName('membre').setDescription('Member (default: you)')),
      new SlashCommandBuilder().setName('casino').setDescription('Posts the game panel (owner)'),
      new SlashCommandBuilder().setName('jeux').setDescription('Alias of /casino'),
      new SlashCommandBuilder().setName('setup').setDescription('Configures the casino channels (owner)'),
      new SlashCommandBuilder().setName('salon').setDescription('Alias of /setup'),
      new SlashCommandBuilder().setName('wins').setDescription('Creates the wins channel (owner)'),
      new SlashCommandBuilder().setName('classement').setDescription('Posts the auto leaderboard (owner)'),
      new SlashCommandBuilder().setName('admin').setDescription('Opens / creates the admin panel (owner)'),
      new SlashCommandBuilder()
        .setName('add')
        .setDescription('Adds coins to a member (owner)')
        .addUserOption((o) => o.setName('membre').setDescription('Member').setRequired(true))
        .addNumberOption((o) => o.setName('montant').setDescription('Amount').setRequired(true).setMinValue(0.01)),
      new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Removes coins from a member (owner)')
        .addUserOption((o) => o.setName('membre').setDescription('Member').setRequired(true))
        .addNumberOption((o) => o.setName('montant').setDescription('Amount').setRequired(true).setMinValue(0.01)),
      new SlashCommandBuilder().setName('invites-notif').setDescription('Creates the invite notifications channel (owner)'),
      new SlashCommandBuilder()
        .setName('ticketsetup')
        .setDescription('Posts the claim rewards / tickets panel (owner)')
        .addChannelOption((o) =>
          o.setName('categorie').setDescription('Category where tickets are created').addChannelTypes(ChannelType.GuildCategory)
        ),
    ].map((c) => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const appId = client.user.id;
    // Guild commands = available immediately + in practice restricted to the server
    for (const [gid] of client.guilds.cache) {
      try {
        await rest.put(Routes.applicationGuildCommands(appId, gid), { body: commands });
      } catch (e) {
        console.warn('[slash] guild', gid, e?.message || e);
      }
    }
    // Global too (slower propagation)
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('[slash] / commands registered (' + commands.length + ')');
  } catch (e) {
    console.error('[slash] registration failed:', e?.message || e);
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  loadMultipliers();
  loadPeaks();
  for (const g of c.guilds.cache.values()) cacheInvites(g);
  loadAlltimeMsgs();
  getBannerBg();
  setTimeout(warmPanelBanners, 4000);
  loadChannels().then(restoreChannelsByName).then(() => updateLeaderboards());
  setInterval(updateLeaderboards, LEADERBOARD_REFRESH_MS);
  registerSlashCommands();
});

client.on(Events.Error, (e) => console.error('[client]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

async function start() {
  try {
    const res = await fetch('https://discord.com/api/v10/applications/@me', {
      headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
    });
    if (res.ok) {
      const { flags = 0 } = await res.json();
      const GUILD_MEMBERS = (1 << 14) | (1 << 15);
      const MESSAGE_CONTENT = (1 << 18) | (1 << 19);
      if (!(flags & GUILD_MEMBERS)) {
        client.options.intents.remove(GatewayIntentBits.GuildMembers);
        console.warn(
          '⚠️ "Server Members Intent" is not enabled: the bot starts WITHOUT the invite system.\n' +
            '   To enable it: Developer Portal → your application → Bot → Privileged Gateway Intents → Server Members Intent → Save, then restart.'
        );
      }
      if (!(flags & MESSAGE_CONTENT)) {
        console.warn('⚠️ "Message Content Intent" is not enabled: written commands (!setup, !admin...) will not work.');
      }
    }
  } catch (e) {
    console.warn('[startup] could not check intents:', e?.message || e);
  }
  try {
    await client.login(DISCORD_TOKEN);
  } catch (e) {
    console.error('[connexion]', e?.message || e);
    process.exit(1);
  }
}
start();
