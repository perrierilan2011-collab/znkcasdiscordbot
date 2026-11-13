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
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Bannière de stats : npm i @napi-rs/canvas  (optionnel, sinon repli en embed texte)
let canvasLib = null;
try {
  canvasLib = require('@napi-rs/canvas');
} catch {
  console.warn('[stats] @napi-rs/canvas absent : la bannière de stats sera remplacée par un embed texte (npm i @napi-rs/canvas).');
}

// ============================================================
//  CONFIG
// ============================================================
const PREFIX = '!';
// Monnaie = pièce Z violette
const COIN_EMOJI_ID = '1570874447475253279';
const COIN_DEFAULT = `<:znk:${COIN_EMOJI_ID}>`;
const COIN_IMG = `https://cdn.discordapp.com/emojis/${COIN_EMOJI_ID}.png?size=128&quality=lossless`;
let COIN =
  process.env.COIN_EMOJI && /^<a?:\w+:\d+>$/.test(String(process.env.COIN_EMOJI).trim())
    ? String(process.env.COIN_EMOJI).trim()
    : COIN_DEFAULT;
const COIN_FALLBACK = COIN_DEFAULT;
// Texte brut de la monnaie : pour les endroits qui n'affichent pas les emojis custom
// (blocs de code, image canvas, titres / labels de pop-ups)
const COIN_PLAIN = 'coin';
const plain = (s) => String(s).split(COIN).join(COIN_PLAIN);
const DAILY_AMOUNT = 4;
const INVITE_REWARD = 1;
const LEADERBOARD_REFRESH_MS = 60_000;
const IDLE_MS = 90_000;
const MAX_ADMIN_AMOUNT = 100_000_000;
const EPH = MessageFlags.Ephemeral;

function resolveCoinEmoji() {
  const raw = String(process.env.COIN_EMOJI || '').trim();
  if (/^<a?:\w+:\d+>$/.test(raw)) {
    COIN = raw;
    console.log(`[coin] ${COIN}`);
    return;
  }
  if (/^<a?:\w+:\d+>$/.test(COIN)) {
    console.log(`[coin] ${COIN}`);
    return;
  }
  const name = (raw || 'znk').replace(/^:|:$/g, '');
  for (const g of client.guilds.cache.values()) {
    const em =
      g.emojis.cache.find((e) => e.name === name) ||
      g.emojis.cache.find((e) => e.name.toLowerCase() === name.toLowerCase()) ||
      g.emojis.cache.find((e) => /^(znk|z)$/i.test(e.name));
    if (em) {
      COIN = em.toString();
      console.log(`[coin] résolu ${COIN} sur ${g.name}`);
      return;
    }
  }
  COIN = COIN_FALLBACK;
  console.log(`[coin] fallback ${COIN}`);
}

const { DISCORD_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!DISCORD_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '❌ Variables manquantes : DISCORD_TOKEN, SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont obligatoires.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Node < 22 n'a pas de WebSocket natif : on fournit "ws" (sinon crash au démarrage)
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
  green: 0x2ecc71,
  red: 0xe74c3c,
  grey: 0x95a5a6,
  blue: 0x8B5CF6,
  gold: 0xA855F7,
  violet: 0x7C3AED,
};

// ============================================================
//  PRÉFÉRENCES JOUEUR : langue + ping des victoires
// ============================================================
const LANG_FILE = path.join(__dirname, 'data', 'lang.json');
const PING_FILE = path.join(__dirname, 'data', 'winping.json');
const userLang = new Map(); // userId -> 'fr' | 'en'
const winPingOff = new Set(); // userIds qui ne veulent plus être ping dans le salon wins

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(LANG_FILE, 'utf8'));
    for (const [id, lang] of Object.entries(raw)) if (lang === 'fr' || lang === 'en') userLang.set(id, lang);
  } catch {
    /* premier lancement */
  }
  try {
    const raw = JSON.parse(fs.readFileSync(PING_FILE, 'utf8'));
    if (Array.isArray(raw)) for (const id of raw) winPingOff.add(String(id));
  } catch {
    /* premier lancement */
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
const getLang = (userId) => userLang.get(userId) || 'fr';
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
const L = (uid, fr, en) => (getLang(uid) === 'en' ? en : fr);

const I18N = {
  fr: {
    yourBalance: 'Ton solde',
    dailyOk: 'Tu as reçu',
    dailyAlready: 'Tu as déjà pris ton daily aujourd’hui. Reviens après minuit (Paris).',
    newBalance: 'Nouveau solde',
    lobbyTitle: '✦ Choisis ta table',
    lobbyDesc:
      'Sélectionne un jeu dans le **menu ci-dessous**.\nUne fenêtre s’ouvre pour ta mise (ton solde est affiché).',
    lobbyPlaceholder: '🎮 Choisir un jeu...',
    lobbyFooter: 'Menu privé · visible uniquement par toi',
    sendPick: '💸 À qui veux-tu envoyer des coin depuis ton solde ?',
    insufficient: `Tu n’as pas assez de ${COIN} pour cette mise.`,
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
    sendPick: '💸 Who do you want to send coin to?',
    insufficient: `Not enough ${COIN} for this bet.`,
  },
};
const t = (userId, key) => I18N[getLang(userId)][key] ?? I18N.fr[key] ?? key;

loadPrefs();

/** Dernier serveur d’où le joueur a lancé Start (pour les parties en MP). */
const userHomeGuild = new Map();
function resolveGuildId(i) {
  if (i.guild?.id) return i.guild.id;
  return userHomeGuild.get(i.user.id) || null;
}

// ============================================================
//  OUTILS
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const range = (n) => Array.from({ length: n }, (_, i) => i);
const round2 = (n) => Math.round(n * 100) / 100;
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const num = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmt = (n) => `${num(n)} ${COIN}`;
const fx = (m) => `x${Number(m).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;
const padL = (s, n) => String(s).padStart(n, ' ');
const padR = (s, n) => String(s).padEnd(n, ' ');
const code = (lines) => '```\n' + (Array.isArray(lines) ? lines.join('\n') : lines) + '\n```';
const sideBySide = (blocks, gap = '  ') => blocks[0].map((_, r) => blocks.map((b) => b[r]).join(gap));
const short = (m) => String(round2(m)); // multiplicateur compact pour les animations

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
  busy: '⏳ Tu as déjà une partie en cours, termine-la d’abord (elle se règle toute seule après 90 s d’inactivité).',
  noMoney: `Tu n’as pas de ${COIN}. Clique sur **🎁 Daily** dans le panneau pour récupérer ta récompense du jour.`,
  insufficient: `Tu n’as pas assez de ${COIN} pour cette mise.`,
};

const isCrown = (msg) => msg.guild && msg.author.id === msg.guild.ownerId;
const CROWN_ONLY = '👑 Seul le propriétaire du serveur (celui qui a la couronne) peut faire ça.';

// ============================================================
//  MOTEUR D'ANIMATION
//  Une frame = { art, caption, ms }. Tout est dessiné en caractères (bloc de code).
// ============================================================
const ANIM_PALETTE = [COLORS.violet, COLORS.gold, COLORS.blue, 0xE879F9, 0xC026D3];

async function animate(i, frames, title, head = '') {
  const n = frames.length;
  for (let idx = 0; idx < n; idx++) {
    const f = typeof frames[idx] === 'string' ? { art: frames[idx] } : frames[idx];
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(ANIM_PALETTE[idx % ANIM_PALETTE.length])
      .setDescription(`${head}${f.art}${f.caption ? `\n**${f.caption}**` : ''}`)
      .setFooter({ text: `[${'='.repeat(idx + 1)}${'-'.repeat(n - idx - 1)}]` });
    await i.editReply({ embeds: [embed], components: [] }).catch(() => {});
    await sleep(Math.max(750, f.ms || 900));
  }
}

function receipt(rows) {
  return code(rows.map(([a, b]) => padR(a, 13) + padL(plain(b), 17)));
}

// ---------- Dés ASCII ----------
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieLines(n) {
  const on = new Set(PIPS[Math.max(1, Math.min(6, n))]);
  const c = (k) => (on.has(k) ? 'o' : ' ');
  return [
    '+-------+',
    `| ${c(0)} ${c(1)} ${c(2)} |`,
    `| ${c(3)} ${c(4)} ${c(5)} |`,
    `| ${c(6)} ${c(7)} ${c(8)} |`,
    '+-------+',
  ];
}
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const dieFace = (n) => DICE_FACES[Math.max(1, Math.min(6, n)) - 1];

// ---------- Cartes ASCII ----------
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const newDeck = () => shuffle(SUITS.flatMap((s) => RANKS.map((r) => ({ r, s }))));
const cardStr = (c) => `\`${c.r}${c.s}\``;
function cardLines(c, hidden) {
  if (hidden || !c) return ['+-----+', '|/////|', '|/////|', '|/////|', '+-----+'];
  return ['+-----+', `|${padR(c.r, 2)}   |`, `|  ${c.s}  |`, `|   ${padL(c.r, 2)}|`, '+-----+'];
}
function handArt(cards, hiddenExtra = 0) {
  const blocks = cards.map((c) => cardLines(c, false));
  for (let k = 0; k < hiddenExtra; k++) blocks.push(cardLines(null, true));
  if (!blocks.length) return ['(en attente)'];
  return sideBySide(blocks, ' ');
}

// ---------- Bande qui défile (roulette, roue, ...) ----------
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
// positions successives d'une bande qui ralentit et finit exactement sur `finalIdx`
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
//  BASE DE DONNÉES (Supabase)
// ============================================================
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

const getBalance = async (id) => Number(await rpc('get_balance', { p_user_id: id }));

// ---------- Pics de solde (classement all-time) ----------
const PEAK_FILE = path.join(__dirname, 'data', 'peaks.json');
const peaks = new Map();

async function loadPeaks() {
  try {
    const raw = JSON.parse(fs.readFileSync(PEAK_FILE, 'utf8'));
    for (const [id, v] of Object.entries(raw)) if (Number(v) > 0) peaks.set(id, Number(v));
  } catch {
    /* premier lancement */
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
    console.error('[peaks] table player_peaks illisible (optionnelle) :', e?.message || e);
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
//  RÉPONSES PRIVÉES (éphémères)
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

// Chaque partie s'ouvre dans son propre message privé (popup éphémère) : le lobby reste intact
// et plusieurs parties successives ne s'écrasent plus entre elles.
const openGame = (i, payload) => i.reply({ ...payload, flags: EPH });

const respondText = (i, text) => i.reply({ content: text, flags: EPH });

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
//  HISTORIQUE + SALON DES VICTOIRES
// ============================================================
const GAME_NAMES = {
  mines: '💣 Mines',
  bj: '🃏 Blackjack',
  roulette: '🎡 Roulette',
  coinflip: '🪙 Pile ou Face',
  dice: '🎲 Dés',
  slots: '🎰 Machine à sous',
  wheel: '🎡 Roue de la fortune',
  duel: '⚔️ Duel de cartes',
  suit: '🃏 Enseigne',
  zone: '🎯 Zone',
  plinko: '🎱 Plinko',
  crash: '🚀 Crash',
  scratch: '🎟️ Ticket à gratter',
  die: '🎲 Dé exact',
  chest: '📦 Coffre mystère',
  russian: '🔫 Roulette russe',
  horses: '🏇 Course de chevaux',
};
// Nom du jeu sans l'emoji (pour l'image canvas qui n'affiche pas les emojis)
const gameNamePlain = (g) => (GAME_NAMES[g] ? GAME_NAMES[g].replace(/^\S+\s/, '') : g);

// ============================================================
//  MULTIPLICATEURS RÉGLABLES
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
    /* premier lancement */
  }
  try {
    const { data, error } = await supabase.from('game_settings').select('game, multiplier');
    if (error) throw error;
    for (const r of data) if (GAME_NAMES[r.game] && Number(r.multiplier) > 0) multipliers.set(r.game, Number(r.multiplier));
  } catch (e) {
    console.error('[multiplicateurs] table game_settings introuvable ou illisible (lance schema_v3.sql) :', e?.message || e);
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
      const ch = await getAnnounceChannel(guildId);
      if (ch) {
        const who = actorId ? `👤 Par <@${actorId}>\n` : '';
        await ch.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('🎚️ Multiplicateur modifié')
              .setColor(COLORS.violet)
              .setDescription(
                `${who}**${GAME_NAMES[game] || game}** : coefficient réglé sur **${fx(value)}**.\n` +
                  `Tous les gains de ce jeu sont maintenant multipliés par ce coefficient.`
              )
              .setTimestamp(),
          ],
        });
      }
    } catch (e) {
      console.error('[multiplicateurs] annonce', e?.message || e);
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
      getAnnounceChannel(guildId)
        .then((ch) =>
          ch?.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('⏰ Boost terminé')
                .setColor(COLORS.grey)
                .setDescription(`L’événement **${label}** est terminé. Retour aux gains normaux.`),
            ],
          })
        )
        .catch(() => {});
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
    if (error) console.error('[historique]', error.message);
  } catch (e) {
    console.error('[historique]', e?.message || e);
  }

  if (profit <= 0 || !guildId) return;
  try {
    const chId = guildChannels.get(`${guildId}:wins`);
    if (!chId) return;
    const ch = await client.channels.fetch(chId).catch(() => null);
    if (!ch) return;
    const ping = wantsWinPing(user.id);
    const display = escapeMarkdown(user.globalName || user.username);
    const embed = new EmbedBuilder()
      .setColor(COLORS.green)
      .setAuthor({ name: `${display} a gagné !`, iconURL: user.displayAvatarURL() })
      .setDescription(`🎉 ${ping ? `<@${user.id}>` : `**${display}**`} remporte **${fmt(profit)}** au jeu ${GAME_NAMES[game] || game}`)
      .addFields(
        { name: 'Jeu', value: GAME_NAMES[game] || game, inline: true },
        { name: 'Mise', value: fmt(bet), inline: true },
        { name: 'Multiplicateur', value: fx(mult), inline: true },
        { name: 'Gain', value: `**${signed(profit)}**`, inline: true }
      )
      .setTimestamp();
    await ch.send({
      content: ping ? `<@${user.id}>` : undefined,
      embeds: [embed],
      allowedMentions: ping ? { users: [user.id] } : { parse: [] },
    });
  } catch (e) {
    console.error('[wins]', e?.message || e);
  }
}

async function historyEmbed(uid) {
  const { data, error } = await supabase
    .from('game_history')
    .select('game, bet, multiplier, profit, detail, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw error;

  const e = new EmbedBuilder().setTitle('📜 Historique de tes parties').setColor(COLORS.blue);
  if (!data.length) return e.setDescription('Tu n’as pas encore joué. Lance une partie depuis le panneau !');

  const net = round2(data.reduce((s, r) => s + Number(r.profit), 0));
  const lines = data.map((r) => {
    const p = Number(r.profit);
    const icon = p > 0 ? '🟢' : p < 0 ? '🔴' : '⚪';
    const ts = Math.floor(new Date(r.created_at).getTime() / 1000);
    return `${icon} ${GAME_NAMES[r.game] || r.game} · mise ${fmt(r.bet)} · ${fx(r.multiplier)} · **${signed(p)}** · <t:${ts}:R>`;
  });
  return e
    .setDescription(`Bilan des ${data.length} dernières parties : **${signed(net)}**\n\n${lines.join('\n')}`)
    .setFooter({ text: 'Visible uniquement par toi' });
}

// ============================================================
//  STATS + BANNIÈRE (680x240, fond #A81CFD)
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

async function renderStatsBanner(user, st, balance, lang) {
  if (!canvasLib) return null;
  const { createCanvas, loadImage } = canvasLib;
  const W = 680;
  const H = 240;
  const cv = createCanvas(W, H);
  const g = cv.getContext('2d');
  const FONT = 'sans-serif';
  const en = lang === 'en';

  // fond violet #A81CFD
  g.fillStyle = '#A81CFD';
  g.fillRect(0, 0, W, H);
  // décor discret
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.beginPath();
  g.arc(W - 40, -10, 120, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(-30, H + 10, 90, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.10)';
  g.beginPath();
  g.arc(W - 150, H + 40, 110, 0, Math.PI * 2);
  g.fill();

  // avatar rond
  const AV = 72;
  const ax = 24;
  const ay = 20;
  g.save();
  g.beginPath();
  g.arc(ax + AV / 2, ay + AV / 2, AV / 2, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  let drawn = false;
  try {
    const url = user.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true });
    const res = await fetch(url);
    if (res.ok) {
      const img = await loadImage(Buffer.from(await res.arrayBuffer()));
      g.drawImage(img, ax, ay, AV, AV);
      drawn = true;
    }
  } catch {
    /* avatar indisponible */
  }
  if (!drawn) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(ax, ay, AV, AV);
    g.fillStyle = '#fff';
    g.font = `bold 34px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(String(user.username || '?')[0].toUpperCase(), ax + AV / 2, ay + AV / 2 + 12);
    g.textAlign = 'left';
  }
  g.restore();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(ax + AV / 2, ay + AV / 2, AV / 2, 0, Math.PI * 2);
  g.stroke();

  // pseudo + sous-titre
  let name = String(user.globalName || user.username || '?');
  g.fillStyle = '#FFFFFF';
  let size = 30;
  g.font = `bold ${size}px ${FONT}`;
  while (g.measureText(name).width > 330 && size > 16) {
    size -= 2;
    g.font = `bold ${size}px ${FONT}`;
  }
  g.fillText(name, 112, 54);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = `15px ${FONT}`;
  const fav = st.favorite ? gameNamePlain(st.favorite) : '-';
  g.fillText(`ZNK CASINO  |  ${en ? 'Favorite' : 'Jeu favori'} : ${fav}`, 112, 80);

  // solde en haut à droite
  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = `13px ${FONT}`;
  g.fillText(en ? 'BALANCE' : 'SOLDE', W - 24, 36);
  g.fillStyle = '#FFFFFF';
  g.font = `bold 26px ${FONT}`;
  g.fillText(`${compact(balance)} ${COIN_PLAIN}`, W - 24, 66);
  g.textAlign = 'left';

  // 6 cartes de stats
  const cells = [
    [en ? 'GAMES PLAYED' : 'PARTIES JOUÉES', String(st.games)],
    [en ? 'TOTAL WAGERED' : 'TOTAL MISÉ', `${compact(st.wagered)} ${COIN_PLAIN}`],
    [en ? 'TOTAL WON' : 'TOTAL GAGNÉ', `${compact(st.won)} ${COIN_PLAIN}`],
    [en ? 'TOTAL LOST' : 'TOTAL PERDU', `${compact(st.lost)} ${COIN_PLAIN}`],
    [en ? 'NET PROFIT' : 'PROFIT NET', `${st.net > 0 ? '+' : ''}${compact(st.net)} ${COIN_PLAIN}`],
    [en ? 'WIN RATE' : 'TAUX DE VICTOIRE', `${st.rate} %`],
  ];
  const mx = 24;
  const gap = 12;
  const cw = Math.floor((W - mx * 2 - gap * 2) / 3);
  const ch = 56;
  const top = 110;
  cells.forEach(([label, value], k) => {
    const cx = mx + (k % 3) * (cw + gap);
    const cy = top + Math.floor(k / 3) * (ch + 8);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(g, cx, cy, cw, ch, 10);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = `bold 11px ${FONT}`;
    g.fillText(label, cx + 12, cy + 20);
    g.fillStyle = '#FFFFFF';
    g.font = `bold 20px ${FONT}`;
    g.fillText(value.replace(/\s/g, ' '), cx + 12, cy + 44);
  });

  return cv.toBuffer('image/png');
}

function statsFallbackEmbed(user, st, balance, lang) {
  const en = lang === 'en';
  return new EmbedBuilder()
    .setColor(0xA81CFD)
    .setTitle(`📊 ${en ? 'Stats' : 'Statistiques'} · ${user.globalName || user.username}`)
    .setDescription(
      code([
        `${padR(en ? 'Balance' : 'Solde', 18)}${padL(plain(fmt(balance)), 16)}`,
        `${padR(en ? 'Games played' : 'Parties jouées', 18)}${padL(st.games, 16)}`,
        `${padR(en ? 'Total wagered' : 'Total misé', 18)}${padL(plain(fmt(st.wagered)), 16)}`,
        `${padR(en ? 'Total won' : 'Total gagné', 18)}${padL(plain(fmt(st.won)), 16)}`,
        `${padR(en ? 'Total lost' : 'Total perdu', 18)}${padL(plain(fmt(st.lost)), 16)}`,
        `${padR(en ? 'Net profit' : 'Profit net', 18)}${padL(plain(signed(st.net)), 16)}`,
        `${padR(en ? 'Win rate' : 'Victoires', 18)}${padL(`${st.rate} %`, 16)}`,
      ])
    )
    .setFooter({ text: 'Installe @napi-rs/canvas pour la bannière image' });
}

// ============================================================
//  MINES  (grille de 24 cases, 4 difficultés)
// ============================================================
const MINES_CELLS = 24;
const MINES_EDGE = 0.97;
const MINES_MAX_MULT = 1000;
const LEVELS = {
  easy: { name: 'Easy', emoji: '🟢', mines: 3, style: ButtonStyle.Success },
  medium: { name: 'Medium', emoji: '🟡', mines: 6, style: ButtonStyle.Primary },
  hard: { name: 'Hard', emoji: '🟠', mines: 10, style: ButtonStyle.Secondary },
  impossible: { name: 'Impossible', emoji: '🔴', mines: 15, style: ButtonStyle.Danger },
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
    .setTitle('💣 Mines : choisis ta difficulté')
    .setColor(COLORS.blue)
    .setDescription(
      `${lines.join('\n')}\n\nPlus il y a de mines, plus le multiplicateur grimpe vite (max ${fx(MINES_MAX_MULT)}).`
    );
  const row = new ActionRowBuilder().addComponents(
    ...Object.entries(LEVELS).map(([key, Lv]) =>
      new ButtonBuilder().setCustomId(`mines_lvl_${key}`).setLabel(Lv.name).setEmoji(Lv.emoji).setStyle(Lv.style)
    )
  );
  return { embeds: [embed], components: [row] };
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
        b.setLabel('?').setStyle(ButtonStyle.Secondary);
      }
      row.addComponents(b);
    }
    if (r === 4) {
      if (over) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`replay|mines|${game.bet}|${game.level}`)
            .setLabel('Rejouer')
            .setEmoji('🔁')
            .setStyle(ButtonStyle.Success)
        );
      } else {
        const gain = floor2(game.bet * minesMultiplier(game.revealed.size, game.mines));
        row.addComponents(
          new ButtonBuilder()
            .setCustomId('mines_cash')
            .setLabel(`Encaisser ${num(gain)}`)
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary)
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
      { name: 'Mise', value: fmt(game.bet), inline: true },
      { name: 'Mines', value: String(game.mines), inline: true },
      { name: 'Multiplicateur', value: fx(mult), inline: true },
      { name: 'Gain actuel', value: fmt(floor2(game.bet * mult)), inline: true }
    );
  if (end) {
    e.setColor(end.color).setDescription(`${code([track])}${end.text}`);
    e.addFields({ name: 'Solde', value: fmt(end.balance), inline: true });
  } else {
    e.setColor(COLORS.blue).setDescription(
      `${code([track])}Clique sur les cases. Évite les 💣 et encaisse quand tu veux !`
    );
    if (picks < safeTotal) {
      e.addFields({ name: 'Prochain 💎', value: fx(minesMultiplier(picks + 1, game.mines)), inline: true });
    }
  }
  return e;
}

async function startMines(i, level, bet) {
  const Lv = LEVELS[level];
  if (!Lv) return respondText(i, 'Difficulté inconnue.');
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
  try {
    const picks = game.revealed.size;
    let payout = 0;
    let mult = 0;
    let text;
    let color;
    let counted = true;

    if (kind === 'lose') {
      text = '💥 **Boom !** Tu as touché une mine, la mise est perdue.';
      color = COLORS.red;
    } else if (picks === 0) {
      payout = game.bet;
      mult = 1;
      counted = false;
      text = '⏱️ Partie abandonnée, mise remboursée.';
      color = COLORS.grey;
    } else {
      mult = minesMultiplier(picks, game.mines);
      const boost = getBoost(game.guildId);
      if ((boost.winMult || 1) !== 1) mult = round2(mult * boost.winMult);
      payout = floor2(game.bet * mult);
      color = COLORS.green;
      text =
        kind === 'timeout'
          ? `⏱️ Temps écoulé, encaissement automatique : **${fmt(payout)}** (${fx(mult)})`
          : `✅ Bien joué ! Tu encaisses **${fmt(payout)}** (${fx(mult)}), profit : **${signed(round2(payout - game.bet))}**.`;
      if (boost.label) text += `\n⚡ Boost **${boost.label}**`;
    }

    if (kind === 'lose') {
      const boost = getBoost(game.guildId);
      if ((boost.loseMult || 1) > 1) {
        const extra = floor2(game.bet * ((boost.loseMult || 1) - 1));
        if (extra > 0) await debit(game.userId, extra).catch(() => {});
        text += `\n⚡ Boost **${boost.label}** : perte ×${boost.loseMult}`;
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

    // Suspense : la case choisie s'ouvre avant le verdict
    if (i && kind === 'lose') {
      const rows = minesRows(game, false);
      rows.forEach((r) => r.components.forEach((b) => b.setDisabled(true)));
      const hold = new EmbedBuilder()
        .setTitle(`💣 Mines · ${LEVELS[game.level].emoji} ${LEVELS[game.level].name}`)
        .setColor(COLORS.gold)
        .setDescription(code(['  La case s\'ouvre...', '', '      . . .']))
        .setFooter({ text: 'Verdict dans un instant' });
      await i.update({ embeds: [hold], components: rows });
      await sleep(900);
      await i.editReply(payload);
    } else if (i) {
      await i.update(payload);
    } else {
      await game.lastI.editReply(payload);
    }
  } catch (e) {
    console.error('[mines] settle', e?.message || e);
  } finally {
    games.delete(game.userId);
  }
}

async function handleMinesButton(i) {
  const game = games.get(i.user.id);
  if (!game || game.starting || game.type !== 'mines' || game.messageId !== i.message?.id) {
    return respondText(i, 'Cette partie n’est plus active. Lance-en une nouvelle depuis le panneau.');
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
  return code([`CROUPIER  [${dv}]`, ...d, '', `TOI  [${pv}]`, ...p]);
}

function bjEmbed(g, end) {
  const e = new EmbedBuilder().setTitle('🃏 Blackjack');
  const pInfo = handInfo(g.player);
  const showAll = !!(end && (end.revealAll || end.balance != null || end.revealing));
  const table = bjTable(g.player, g.dealer, !showAll);

  if (end && end.balance != null) {
    e.setColor(end.color).setDescription(`${table}${end.text}`);
    e.addFields({ name: 'Mise', value: fmt(g.bet), inline: true }, { name: 'Solde', value: fmt(end.balance), inline: true });
  } else if (end?.revealing) {
    e.setColor(COLORS.violet).setDescription(`${table}${end.text || '🃏 Tour du croupier...'}`);
    e.addFields({ name: 'Mise', value: fmt(g.bet), inline: true });
  } else {
    e.setColor(COLORS.violet).setDescription(
      `${table}À toi : **Tirer**, **Rester** ou **Doubler**.` +
        (pInfo.isSoft ? `\n💡 Ton As te donne **${pInfo.low}** ou **${pInfo.total}**.` : '')
    );
    e.addFields({ name: 'Mise', value: fmt(g.bet), inline: true });
  }
  return e;
}

function bjRows(g, over) {
  if (over) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`replay|bj|${g.baseBet}`).setLabel('Rejouer').setEmoji('🔁').setStyle(ButtonStyle.Success)
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
    if (pBJ && dBJ) return { payout: bet, text: '🤝 Double blackjack : égalité, mise remboursée.', color: COLORS.grey };
    if (pBJ) {
      const payout = floor2(bet * 2.5 * coef('bj'));
      return {
        payout,
        text: `🎉 **Blackjack !** Tu gagnes **${fmt(round2(payout - bet))}** (${fx(2.5 * coef('bj'))}).`,
        color: COLORS.green,
      };
    }
    return { payout: 0, text: '😬 Le croupier a un blackjack, mise perdue.', color: COLORS.red };
  }
  if (kind === 'bust')
    return {
      payout: 0,
      text: `💥 Tu dépasses 21 (**${handInfo(g.player).label}**), mise perdue.`,
      color: COLORS.red,
    };
  const winPayout = floor2(bet * 2 * coef('bj'));
  const winProfit = fmt(round2(winPayout - bet));
  if (dv > 21) return { payout: winPayout, text: `🎉 Le croupier dépasse 21 ! Tu gagnes **${winProfit}**.`, color: COLORS.green };
  if (pv > dv) return { payout: winPayout, text: `🎉 ${pv} contre ${dv} : tu gagnes **${winProfit}**.`, color: COLORS.green };
  if (pv === dv) return { payout: bet, text: `🤝 Égalité à ${pv}, mise remboursée.`, color: COLORS.grey };
  return { payout: 0, text: `😬 ${pv} contre ${dv} : tu perds ta mise.`, color: COLORS.red };
}

async function dealAnimation(i, game) {
  const [p1, p2] = game.player;
  const [d1, d2] = game.dealer;
  const steps = [
    { p: [], d: [], hidden: false, cap: 'Le croupier bat les cartes...' },
    { p: [p1], d: [], hidden: false, cap: 'Première carte pour toi' },
    { p: [p1], d: [d1], hidden: false, cap: 'Première carte du croupier' },
    { p: [p1, p2], d: [d1], hidden: false, cap: 'Deuxième carte pour toi' },
    { p: [p1, p2], d: [d1], hidden: true, cap: 'Le croupier garde la sienne cachée' },
  ];
  const frames = steps.map((s) => ({
    art: bjTable(s.p, s.d, s.hidden),
    caption: s.cap,
    ms: 850,
  }));
  await animate(i, frames, '🃏 Blackjack', '');
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
            .setDescription(`Mise **${fmt(bet)}** · distribution en cours...`),
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

    await dealAnimation(i, game);

    if (natural) {
      await i
        .editReply({
          embeds: [bjEmbed(game, { text: out.text, color: out.color, balance, revealAll: true })],
          components: bjRows(game, true),
        })
        .catch(() => {});
      return;
    }

    await i.editReply({ embeds: [bjEmbed(game)], components: bjRows(game, false) }).catch(() => {});
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

  try {
    if (kind === 'stand') {
      await pushBoard(
        { embeds: [bjEmbed(game, { revealing: true, text: '🃏 Le croupier **retourne** sa deuxième carte...' })], components: [] },
        i
      );
      i = null;
      await sleep(1100);

      while (handValue(game.dealer) < 17) {
        game.dealer.push(game.deck.pop());
        const d = handInfo(game.dealer);
        await game.lastI.editReply({
          embeds: [
            bjEmbed(game, {
              revealing: true,
              text: `🃏 Le croupier tire une carte... total **${d.label}**${d.isSoft ? ' (As soft)' : ''}`,
            }),
          ],
          components: [],
        });
        await sleep(1100);
      }

      const dFinal = handInfo(game.dealer);
      await game.lastI.editReply({
        embeds: [
          bjEmbed(game, {
            revealing: true,
            text: dFinal.total > 21 ? `💥 Le croupier dépasse (**${dFinal.label}**) !` : `🛑 Le croupier s’arrête à **${dFinal.label}**.`,
          }),
        ],
        components: [],
      });
      await sleep(900);
    }

    const out = bjOutcome(game, kind);
    const boost = getBoost(game.guildId);
    if (out.payout > game.bet && (boost.winMult || 1) !== 1) {
      const profit = out.payout - game.bet;
      out.payout = floor2(game.bet + profit * (boost.winMult || 1));
      out.text += `\n⚡ Boost **${boost.label}** appliqué !`;
    } else if (out.payout === 0 && (boost.loseMult || 1) > 1) {
      const extra = floor2(game.bet * ((boost.loseMult || 1) - 1));
      if (extra > 0) await debit(game.userId, extra).catch(() => {});
      out.text += `\n⚡ Boost **${boost.label}** : perte ×${boost.loseMult}`;
    }
    const balance = out.payout > 0 ? await credit(game.userId, out.payout) : await getBalance(game.userId);
    const pL = handInfo(game.player).label;
    const dL = handInfo(game.dealer).label;
    recordResult({
      guildId: game.guildId,
      user: game.user,
      game: 'bj',
      bet: game.bet,
      mult: round2(out.payout / game.bet),
      payout: out.payout,
      detail: `${pL} vs ${dL}`,
    });
    const payload = {
      embeds: [bjEmbed(game, { text: out.text, color: out.color, balance, revealAll: true })],
      components: bjRows(game, true),
    };
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
    return respondText(i, 'Cette partie n’est plus active. Lance-en une nouvelle depuis le panneau.');
  }
  if (game.finished) return i.deferUpdate().catch(() => {});
  game.lastI = i;
  armTimer(game);

  if (i.customId === 'bj_hit') {
    game.player.push(game.deck.pop());
    const v = handValue(game.player);
    if (v > 21) return settleBlackjack(game, 'bust', i);
    if (v === 21) return settleBlackjack(game, 'stand', i);
    return i.update({ embeds: [bjEmbed(game)], components: bjRows(game, false) });
  }

  if (i.customId === 'bj_stand') return settleBlackjack(game, 'stand', i);

  if (i.customId === 'bj_double') {
    if (game.player.length !== 2) return i.deferUpdate();
    if ((await debit(game.userId, game.bet)) === null) {
      return respondText(i, `Pas assez de ${COIN} pour doubler.`);
    }
    game.bet = round2(game.bet * 2);
    game.player.push(game.deck.pop());
    if (handValue(game.player) > 21) return settleBlackjack(game, 'bust', i);
    return settleBlackjack(game, 'stand', i);
  }
}

// ============================================================
//  ROULETTE (européenne, 0 à 36)
// ============================================================
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'vert' : REDS.has(n) ? 'rouge' : 'noir');
const colorTag = (n) => (n === 0 ? 'V' : REDS.has(n) ? 'R' : 'N');
const colorEmoji = { vert: '🟢', rouge: '🔴', noir: '⚫' };
// Ordre réel des numéros sur une roue européenne
const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

function parseRouletteBet(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  if (['rouge', 'red', 'r'].includes(s)) return { key: 'rouge', label: 'Rouge 🔴', mult: 2, win: (n) => n !== 0 && REDS.has(n) };
  if (['noir', 'black', 'n'].includes(s)) return { key: 'noir', label: 'Noir ⚫', mult: 2, win: (n) => n !== 0 && !REDS.has(n) };
  if (['pair', 'even', 'p'].includes(s)) return { key: 'pair', label: 'Pair', mult: 2, win: (n) => n !== 0 && n % 2 === 0 };
  if (['impair', 'odd', 'i'].includes(s)) return { key: 'impair', label: 'Impair', mult: 2, win: (n) => n % 2 === 1 };
  if (['vert', 'green', 'v'].includes(s)) return { key: 'vert', label: 'Vert 🟢 (0)', mult: 36, win: (n) => n === 0 };
  if (/^\d{1,2}$/.test(s) && Number(s) >= 0 && Number(s) <= 36) {
    const target = Number(s);
    return { key: String(target), label: `Numéro ${target}`, mult: 36, win: (n) => n === target };
  }
  return null;
}

function roulettePickerPayload() {
  const embed = new EmbedBuilder()
    .setTitle('🎡 Roulette : choisis ton pari')
    .setColor(COLORS.blue)
    .setDescription(
      `🔴 Rouge · ⚫ Noir · Pair · Impair : paient **${fx(2 * coef('roulette'))}**\n` +
        `🟢 Vert (0) ou un **numéro** précis (0 à 36) : paient **${fx(36 * coef('roulette'))}**`
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rl_rouge').setLabel('Rouge').setEmoji('🔴').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rl_noir').setLabel('Noir').setEmoji('⚫').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rl_pair').setLabel('Pair').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rl_impair').setLabel('Impair').setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rl_vert').setLabel('Vert (0)').setEmoji('🟢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rl_num').setLabel('Un numéro').setEmoji('🔢').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row1, row2] };
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
    'La bille est lancée',
    'La roue prend de la vitesse',
    'Pleine vitesse',
    'La bille tourne...',
    'Elle commence à ralentir',
    'Elle saute de case en case',
    'Presque arrêtée',
    'Dernier saut...',
    'Elle hésite...',
    `La bille s'arrête sur le ${result} ${colorOf(result)}`,
  ];
  const legend = 'R rouge · N noir · V vert';
  return pos.map((p, k) => ({
    art: code([...stripArt(WHEEL_ORDER, p, rcell, 5), '', legend, `Ton pari : ${choice.label}`]),
    caption: caps[k],
    ms: 700 + k * 110,
  }));
}

async function playRoulette(i, bet, choiceStr) {
  const choice = parseRouletteBet(choiceStr);
  if (!choice) return respondText(i, 'Pari invalide : rouge, noir, pair, impair, vert ou un numéro de 0 à 36.');
  const uid = i.user.id;
  if (!tryLock(uid)) return respondText(i, MSG.busy);

  try {
    const err = await takeBet(uid, bet);
    if (err) return respondText(i, err);

    const result = randomInt(0, 37);
    const won = choice.win(result);
    const boost = getBoost(i.guildId);
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
            .setDescription(`🎡 Les jeux sont faits. Mise **${fmt(bet)}** sur **${choice.label}**`),
        ],
        components: [],
      });
    } catch (e) {
      await credit(uid, bet).catch(() => {});
      throw e;
    }

    const balance = payout > 0 ? await credit(uid, payout) : await getBalance(uid);

    await animate(i, rouletteFrames(result, choice), '🎡 Roulette', `Mise **${fmt(bet)}**\n`);

    const profit = round2(payout - bet);
    const embed = new EmbedBuilder()
      .setTitle('🎡 Roulette')
      .setColor(won ? COLORS.green : COLORS.red)
      .setDescription(
        code([
          `  Numéro sorti :  ${result}  (${colorOf(result)}) ${colorEmoji[colorOf(result)]}`,
          `  Ton pari     :  ${choice.label}`,
        ]) +
          (won
            ? `🎉 Gagné ! Tu empoches **${fmt(payout)}** (${fx(rlMult)}), profit : **${signed(profit)}**.`
            : `😬 Perdu, tu laisses **${fmt(bet)}**.`)
      )
      .addFields(
        { name: 'Ton pari', value: choice.label, inline: true },
        { name: 'Mise', value: fmt(bet), inline: true },
        { name: 'Solde', value: fmt(balance), inline: true },
        {
          name: 'Reçu',
          value: receipt([
            ['Mise', fmt(bet)],
            ['Multiplicateur', won ? fx(rlMult) : 'x0.00'],
            ['Gain', fmt(payout)],
            ['Profit', signed(profit)],
          ]),
        }
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`replay|rl|${bet}|${choice.key}`).setLabel('Rejouer').setEmoji('🔁').setStyle(ButtonStyle.Success)
    );
    await i.editReply({ embeds: [embed], components: [row] });

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
//  JEUX INSTANTANÉS
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

// 24 cases dans l'ordre d'affichage de la roue
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
  return {
    embeds: [new EmbedBuilder().setTitle(title).setColor(COLORS.blue).setDescription(desc)],
    components: chunk(buttons, 5).map((r) => new ActionRowBuilder().addComponents(...r)),
  };
}

const DUEL_MULT = 2.1;
const SUIT_MULT = 3.8;
const SUIT_CHOICES = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_EMOJI = { s: '♠️', h: '♥️', d: '♦️', c: '♣️' };
const SUIT_NAMES = { s: 'Pique', h: 'Coeur', d: 'Carreau', c: 'Trèfle' };
const ZONES = {
  low: { label: 'Bas (1-3)', mult: 3.2, win: (n) => n <= 3 },
  mid: { label: 'Milieu (4-7)', mult: 2.4, win: (n) => n >= 4 && n <= 7 },
  high: { label: 'Haut (8-10)', mult: 3.2, win: (n) => n >= 8 },
};
const PLINKO = {
  low: { label: 'Faible', emoji: '🟢', mults: [2, 1.4, 1.1, 0.95, 0.8, 0.95, 1.1, 1.4, 2] },
  med: { label: 'Moyen', emoji: '🟡', mults: [6, 3, 1.4, 0.7, 0.4, 0.7, 1.4, 3, 6] },
  high: { label: 'Élevé', emoji: '🔴', mults: [18, 4, 1.5, 0.4, 0.2, 0.4, 1.5, 4, 18] },
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
    title: '🪙 Pile ou Face',
    choices: ['pile', 'face'],
    spinText: 'La pièce tourne...',
    info: (c) => `victoire ${fx(COIN_MULT * c)}`,
    picker(c) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🪙 Pile ou Face : choisis ton côté')
            .setColor(COLORS.blue)
            .setDescription(`Devine le bon côté : tu gagnes **${fx(COIN_MULT * c)}** ta mise. 1 chance sur 2 !`),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            igButton('coinflip', 'pile', 'Pile', '🪙', ButtonStyle.Primary),
            igButton('coinflip', 'face', 'Face', '🪙', ButtonStyle.Secondary)
          ),
        ],
      };
    },
    resolve(choice) {
      const side = randomInt(0, 2) === 0 ? 'pile' : 'face';
      return {
        base: side === choice ? COIN_MULT : 0,
        pick: choice === 'pile' ? 'Pile' : 'Face',
        headline: `La pièce retombe sur **🪙 ${side === 'pile' ? 'Pile' : 'Face'}**.`,
        detail: `${choice} -> ${side}`,
        side,
      };
    },
  },

  dice: {
    title: '🎲 Dés',
    choices: ['under', 'over', 'seven'],
    spinText: 'Les dés roulent...',
    info: (c) => `moins/plus de 7 ${fx(DICE_MULT.under * c)} · exactement 7 ${fx(DICE_MULT.seven * c)}`,
    picker(c) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎲 Dés : parie sur la somme de 2 dés')
            .setColor(COLORS.blue)
            .setDescription(
              `⬇️ **Moins de 7** (2 à 6) : **${fx(DICE_MULT.under * c)}**\n` +
                `⬆️ **Plus de 7** (8 à 12) : **${fx(DICE_MULT.over * c)}**\n` +
                `🎯 **Exactement 7** : **${fx(DICE_MULT.seven * c)}**`
            ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            igButton('dice', 'under', 'Moins de 7', '⬇️', ButtonStyle.Primary),
            igButton('dice', 'seven', 'Exactement 7', '🎯', ButtonStyle.Success),
            igButton('dice', 'over', 'Plus de 7', '⬆️', ButtonStyle.Primary)
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
        pick: { under: 'Moins de 7', over: 'Plus de 7', seven: 'Exactement 7' }[choice],
        headline: code(sideBySide([dieLines(a), dieLines(b)], '   ')) + `${dieFace(a)} **${a}** + ${dieFace(b)} **${b}** = **${sum}**`,
        detail: `${a}+${b}=${sum}`,
        a,
        b,
        sum,
      };
    },
  },

  slots: {
    title: '🎰 Machine à sous',
    choices: ['go'],
    spinText: 'Les rouleaux tournent...',
    info: (c) => `3 cerises ${fx(5 * c)} · jackpot 7️⃣ ${fx(250 * c)}`,
    picker(c) {
      const table = SLOT_SYMBOLS.map((x) => `${x.e}${x.e}${x.e}  ->  **${fx(x.pay * c)}**`).join('\n');
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎰 Machine à sous')
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
    title: '🎡 Roue de la fortune',
    choices: ['go'],
    spinText: 'La roue tourne...',
    info: (c) => `de ${fx(0.5 * c)} à ${fx(10 * c)}`,
    picker(c) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎡 Roue de la fortune')
            .setColor(COLORS.blue)
            .setDescription(`24 cases : ${wheelSummary(c)}\n\nLance la roue et vois où elle s'arrête !`),
        ],
        components: [new ActionRowBuilder().addComponents(igButton('wheel', 'go', 'Lancer la roue', '🎡', ButtonStyle.Success))],
      };
    },
    resolve(choice, c) {
      const idx = randomInt(0, WHEEL.length);
      const base = WHEEL[idx];
      return {
        base,
        pick: 'Roue',
        headline: `La roue s'arrête sur **${base === 0 ? '💀 x0' : fx(base * c)}**`,
        detail: base === 0 ? 'x0' : fx(base * c),
        idx,
      };
    },
  },

  duel: {
    title: '⚔️ Duel de cartes',
    choices: ['go'],
    spinText: 'Les cartes sont distribuées...',
    info: (c) => `victoire ${fx(DUEL_MULT * c)}`,
    picker: (c) =>
      choicePicker(
        'duel',
        '⚔️ Duel de cartes',
        `Tu tires une carte contre le croupier : la plus haute gagne (l’As est la plus faible, égalité = perdu).\nVictoire : **${fx(DUEL_MULT * c)}**`,
        [['go', 'Tirer ma carte', '⚔️', ButtonStyle.Success]]
      ),
    resolve() {
      const me = randCard();
      const dealer = randCard();
      return {
        base: me.v > dealer.v ? DUEL_MULT : 0,
        pick: 'Duel',
        headline: `Toi : ${cardStr(me)}  ·  Croupier : ${cardStr(dealer)}`,
        detail: `${me.r} vs ${dealer.r}`,
        me,
        dealer,
      };
    },
  },

  suit: {
    title: '🃏 Enseigne',
    choices: Object.keys(SUIT_CHOICES),
    spinText: 'Le croupier tire une carte...',
    info: (c) => `victoire ${fx(SUIT_MULT * c)}`,
    picker: (c) =>
      choicePicker(
        'suit',
        '🃏 Enseigne : devine la couleur de la carte',
        `Choisis ♠️ ♥️ ♦️ ou ♣️ : si la carte tirée a cette enseigne, tu gagnes **${fx(SUIT_MULT * c)}** (1 chance sur 4).`,
        Object.keys(SUIT_CHOICES).map((id) => [id, SUIT_NAMES[id], SUIT_EMOJI[id]])
      ),
    resolve(choice) {
      const card = randCard();
      return {
        base: card.s === SUIT_CHOICES[choice] ? SUIT_MULT : 0,
        pick: `${SUIT_NAMES[choice]} ${SUIT_EMOJI[choice]}`,
        headline: `La carte tirée : ${cardStr(card)}`,
        detail: `${SUIT_CHOICES[choice]} -> ${card.s}`,
        card,
      };
    },
  },

  zone: {
    title: '🎯 Zone',
    choices: Object.keys(ZONES),
    spinText: 'Tirage d’un nombre de 1 à 10...',
    info: (c) => `zones ${fx(ZONES.low.mult * c)} / ${fx(ZONES.mid.mult * c)}`,
    picker: (c) =>
      choicePicker(
        'zone',
        '🎯 Zone : où tombera le nombre (1 à 10) ?',
        Object.values(ZONES).map((z) => `**${z.label}** : ${fx(z.mult * c)}`).join('\n'),
        Object.entries(ZONES).map(([id, z]) => [id, z.label, '🎯'])
      ),
    resolve(choice) {
      const n = randomInt(1, 11);
      return { base: ZONES[choice].win(n) ? ZONES[choice].mult : 0, pick: ZONES[choice].label, headline: `Le nombre tiré est **${n}**`, detail: `${n}`, n };
    },
  },

  plinko: {
    title: '🎱 Plinko',
    choices: Object.keys(PLINKO),
    spinText: 'La bille descend...',
    info: (c) => `de ${fx(0.2 * c)} à ${fx(18 * c)}`,
    picker: (c) =>
      choicePicker(
        'plinko',
        '🎱 Plinko : choisis le risque',
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
        headline: `🎱 La bille atterrit en case **${bin + 1}/9**\n${board}`,
        detail: `case ${bin + 1}`,
        path: pathArr,
        bin,
        mults,
      };
    },
  },

  crash: {
    title: '🚀 Crash',
    choices: Object.keys(CRASH_TARGETS),
    spinText: 'La fusée décolle...',
    info: (c) => `cibles de ${fx(1.5 * c)} à ${fx(10 * c)}`,
    picker: () =>
      choicePicker(
        'crash',
        '🚀 Crash : choisis ton multiplicateur cible',
        'La fusée monte puis explose à un moment aléatoire. Si elle atteint ta cible, tu gagnes ! Plus la cible est haute, plus c’est risqué.',
        Object.entries(CRASH_TARGETS).map(([id, tg]) => [id, `x${tg}`, '🚀'])
      ),
    resolve(choice) {
      const u = randomInt(1, 1_000_001) / 1_000_000;
      const crash = Math.max(1, Math.floor((0.96 / u) * 100) / 100);
      const target = CRASH_TARGETS[choice];
      return {
        base: crash >= target ? target : 0,
        pick: `Cible x${target}`,
        headline: `🚀 La fusée explose à **${fx(Math.min(crash, 1000))}**${crash >= target ? ' : cible atteinte !' : ' : trop tôt !'}`,
        detail: `cible x${target} / crash x${Math.min(crash, 1000)}`,
        crash,
        target,
      };
    },
  },

  scratch: {
    title: '🎟️ Ticket à gratter',
    choices: ['go'],
    spinText: 'Tu grattes le ticket...',
    info: (c) => `de ${fx(1.5 * c)} à ${fx(100 * c)}`,
    picker: (c) =>
      choicePicker(
        'scratch',
        '🎟️ Ticket à gratter',
        `Trois symboles identiques = gagné !\n${SCRATCH.map(([m, , s]) => `${SCRATCH_EMOJI[s]}${SCRATCH_EMOJI[s]}${SCRATCH_EMOJI[s]}  ->  **${fx(m * c)}**`).join('\n')}`,
        [['go', 'Gratter', '🎟️', ButtonStyle.Success]]
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
    title: '🎲 Dé exact',
    choices: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'],
    spinText: 'Le dé roule...',
    info: (c) => `victoire ${fx(DIE_MULT * c)}`,
    picker: (c) =>
      choicePicker(
        'die',
        '🎲 Dé exact : devine le chiffre',
        `Un dé à 6 faces : trouve le bon chiffre et gagne **${fx(DIE_MULT * c)}** (1 chance sur 6).`,
        ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id) => [id, id.slice(1), '🎲'])
      ),
    resolve(choice) {
      const n = randomInt(1, 7);
      const want = Number(choice.slice(1));
      return {
        base: n === want ? DIE_MULT : 0,
        pick: `Chiffre ${want}`,
        headline: code(dieLines(n)) + `Le dé s'arrête sur **${dieFace(n)} ${n}**`,
        detail: `${want} -> ${n}`,
        n,
        want,
      };
    },
  },

  chest: {
    title: '📦 Coffre mystère',
    choices: ['c1', 'c2', 'c3'],
    spinText: 'Tu ouvres le coffre...',
    info: (c) => `victoire ${fx(CHEST_MULT * c)}`,
    picker: (c) =>
      choicePicker(
        'chest',
        '📦 Coffre mystère : 1 trésor, 3 coffres',
        `Un seul coffre contient le trésor : trouve-le et gagne **${fx(CHEST_MULT * c)}**.`,
        ['c1', 'c2', 'c3'].map((id) => [id, `Coffre ${id.slice(1)}`, '📦'])
      ),
    resolve(choice) {
      const win = randomInt(1, 4);
      const want = Number(choice.slice(1));
      const view = [1, 2, 3].map((k) => (k === win ? '💎' : '💨')).join('  ');
      return { base: win === want ? CHEST_MULT : 0, pick: `Coffre ${want}`, headline: `Contenu des coffres : ${view}`, detail: `${want} -> ${win}`, win, want };
    },
  },

  russian: {
    title: '🔫 Roulette russe',
    choices: ['b1', 'b2', 'b3', 'b4', 'b5'],
    spinText: 'Le barillet tourne...',
    info: (c) => `de ${fx(russianMult(1) * c)} à ${fx(russianMult(5) * c)}`,
    picker: (c) =>
      choicePicker(
        'russian',
        '🔫 Roulette russe : combien de balles ?',
        `Barillet de 6 chambres. Survis et gagne ! Plus il y a de balles, plus le gain est gros.\n${[1, 2, 3, 4, 5]
          .map((k) => `**${k}** balle${k > 1 ? 's' : ''} : ${fx(russianMult(k) * c)}`)
          .join(' · ')}`,
        [1, 2, 3, 4, 5].map((k) => [`b${k}`, `${k} balle${k > 1 ? 's' : ''}`, '🔫'])
      ),
    resolve(choice) {
      const k = Number(choice.slice(1));
      const dead = randomInt(0, 6) < k;
      // chambre 0 = celle qui se trouve sous le percuteur
      const others = shuffle([1, 2, 3, 4, 5]);
      const loaded = new Set(dead ? [0, ...others.slice(0, k - 1)] : others.slice(0, k));
      const chambers = range(6).map((n) => loaded.has(n));
      return {
        base: dead ? 0 : russianMult(k),
        pick: `${k} balle${k > 1 ? 's' : ''}`,
        headline: dead ? '💥 **BANG !** Tu as perdu.' : '😮‍💨 *clic*... Tu survis !',
        detail: dead ? 'bang' : 'clic',
        chambers,
        dead,
        k,
      };
    },
  },

  horses: {
    title: '🏇 Course de chevaux',
    choices: ['h1', 'h2', 'h3', 'h4', 'h5'],
    spinText: 'Les chevaux s’élancent...',
    info: (c) => `de ${fx(HORSES[0].mult * c)} à ${fx(HORSES[4].mult * c)}`,
    picker: (c) =>
      choicePicker(
        'horses',
        '🏇 Course de chevaux : mise sur ton cheval',
        HORSES.map((h, k) => `🐎 **n°${k + 1}** : ${fx(h.mult * c)} (${Math.round(h.p * 100)} % de chances)`).join('\n'),
        HORSES.map((h, k) => [`h${k + 1}`, `Cheval ${k + 1}`, '🐎'])
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
        pick: `Cheval ${want + 1}`,
        headline: `🏁 Le cheval **n°${winner + 1}** remporte la course !`,
        detail: `${want + 1} -> ${winner + 1}`,
        winner,
        want,
      };
    },
  },
});

// ============================================================
//  ANIMATIONS DE CHAQUE JEU  (res = résultat déjà tiré, ctx = { c, bet, choice })
// ============================================================
ANIMS.coinflip = (res) => {
  const forms = [
    ['PILE', 5], ['MID', 4], ['EDGE', 2], ['MID', 1], ['FACE', 0], ['MID', 0], ['EDGE', 1], ['MID', 2],
  ];
  const caps = [
    'La pièce est lancée', 'Elle monte...', 'Elle tourne sur la tranche', 'Elle prend de la hauteur',
    'Sommet du lancer', 'Elle commence à retomber', 'Elle tourne encore', 'Elle redescend',
  ];
  const frames = forms.map(([f, y], k) => ({ art: coinScene(f, y), caption: caps[k], ms: 800 }));
  frames.push({
    art: coinScene(res.side === 'pile' ? 'PILE' : 'FACE', 4),
    caption: `La pièce se pose : ${res.side === 'pile' ? 'PILE' : 'FACE'}`,
    ms: 900,
  });
  return frames;
};

ANIMS.dice = (res) => {
  const r = () => randomInt(1, 7);
  const show = (a, b, cap, ms) => ({ art: code(sideBySide([dieLines(a), dieLines(b)], '   ')), caption: cap, ms });
  return [
    show(r(), r(), 'Les dés quittent ta main', 800),
    show(r(), r(), 'Ils rebondissent sur le tapis', 800),
    show(r(), r(), 'Ils roulent...', 850),
    show(r(), r(), 'Ils ralentissent', 900),
    show(res.a, r(), `Premier dé : ${res.a}`, 1000),
    show(res.a, res.b, `Total : ${res.a} + ${res.b} = ${res.sum}`, 1100),
  ];
};

ANIMS.die = (res) => {
  const r = () => randomInt(1, 7);
  const show = (n, cap, ms) => ({ art: code(dieLines(n)), caption: cap, ms });
  return [
    show(r(), 'Le dé est lancé', 800),
    show(r(), 'Il rebondit', 800),
    show(r(), 'Il roule...', 850),
    show(r(), 'Il ralentit', 900),
    show(r(), 'Presque arrêté', 950),
    show(res.n, `Le dé s'arrête sur ${res.n}`, 1000),
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
    1: 'Les rouleaux démarrent', 2: 'Ils tournent à pleine vitesse', 3: 'Rouleau 1 verrouillé',
    4: 'Les deux autres tournent encore', 5: 'Rouleau 2 verrouillé', 6: 'Dernier rouleau...', 7: 'Rouleau 3 verrouillé',
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
    art: board(cols, triple ? '   *** TROIS IDENTIQUES ***' : two ? '   * DEUX CERISES *' : '       aucun gain'),
    caption: triple ? (finals[0] === ' 7 ' ? 'JACKPOT !' : 'Combinaison gagnante !') : two ? 'Deux cerises !' : 'Pas de combinaison',
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
  const steps = [6, 5, 4, 3, 2, 2, 1, 1]; // 24 = un tour complet
  const pos = stripPositions(res.idx, steps);
  const caps = [
    'La roue est lancée', 'Elle accélère', 'Pleine vitesse', 'Les cases défilent', 'Elle ralentit',
    'Plus que quelques cases', 'Le pointeur hésite', 'Dernière case...', `La roue s'arrête sur ${res.base === 0 ? 'x0' : fx(res.base * c)}`,
  ];
  return pos.map((p, k) => ({
    art: code([...stripArt(WHEEL, p, cell, 5), '', `  24 cases · pointeur au centre`]),
    caption: caps[k],
    ms: 700 + k * 100,
  }));
};

ANIMS.duel = (res) => {
  const lab = () => `${padR('     TOI', 12)}${'  CROUPIER'}`;
  const scene = (meHidden, dHidden, cap, ms) => ({
    art: code([lab(), ...sideBySide([cardLines(res.me, meHidden), cardLines(res.dealer, dHidden)], '     ')]),
    caption: cap,
    ms,
  });
  const verdict = res.me.v > res.dealer.v ? 'Ta carte est plus haute : VICTOIRE' : res.me.v === res.dealer.v ? 'Égalité : perdu' : 'La carte du croupier est plus haute : DÉFAITE';
  return [
    scene(true, true, 'Le croupier bat les cartes', 850),
    scene(true, true, 'Les cartes sont posées', 900),
    scene(true, true, 'Tu retournes ta carte...', 1000),
    scene(false, true, `Ta carte : ${res.me.r}${res.me.s}`, 1100),
    scene(false, true, 'Le croupier retourne la sienne...', 1000),
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
    art: code([...stripArt(order, p, cell, 3), '', `Ton choix : ${want}`]),
    caption: ['Le croupier mélange le jeu', 'Les enseignes défilent', 'Ça ralentit', 'Presque...', 'Encore un cran', `L'enseigne tirée : ${res.card.s}`][k] || '...',
    ms: 800 + k * 80,
  }));
  frames.push({ art: code([...cardLines(null, true), '', `Ton choix : ${want}`]), caption: 'La carte est posée face cachée', ms: 900 });
  frames.push({ art: code([...cardLines(res.card, false), '', `Ton choix : ${want}`]), caption: `Carte retournée : ${res.card.r}${res.card.s}`, ms: 1100 });
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
  const caps = ['Le curseur démarre', 'Il saute de case en case', 'Il accélère', 'Il ralentit', 'Il hésite', 'Plus que quelques sauts', 'Presque...', `Le nombre tiré : ${res.n}`];
  return seq.map((cur, k) => ({
    art: code([...grid(cur), '', `Ton pari : ${zone.label}`, 'Bas 1-3 · Milieu 4-7 · Haut 8-10']),
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
      // décale pour que les rangées se centrent : chaque piquet est séparé d'un espace
      lines.push(line);
    }
    const slots = range(9).map((s) => (ending && s === col ? '^' : ' ')).join(' ');
    lines.push(range(9).map((s) => String(s + 1)).join(' '));
    lines.push(slots);
    return code(lines);
  };
  const frames = [{ art: board(0, 0, false), caption: 'La bille est lâchée', ms: 800 }];
  let col = 0;
  path.forEach((p, k) => {
    col += p;
    frames.push({ art: board(k + 1, col, false), caption: `Rebond ${k + 1}/8 ${p ? 'vers la droite' : 'vers la gauche'}`, ms: 750 });
  });
  const mult = res.mults[res.bin];
  frames.push({
    art: board(8, res.bin, true) + `Case **${res.bin + 1}** : ${fx(mult * c)}`,
    caption: `Elle tombe dans la case ${res.bin + 1}`,
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
    lines.push(`cible x${target} (ligne -)`);
    return code(lines);
  };
  const frames = [{ art: chart(0, false) + 'Décollage dans 3... 2... 1...', caption: 'Compte à rebours', ms: 1000 }];
  let hit = false;
  for (let k = 1; k <= N; k++) {
    const m = mAt(k);
    let cap = `Multiplicateur : ${fx(m)}`;
    if (!hit && m >= target && crash >= target) {
      hit = true;
      cap = `Cible x${target} atteinte ! (${fx(m)})`;
    }
    frames.push({ art: chart(k, false) + `**${fx(m)}**`, caption: cap, ms: 800 });
  }
  frames.push({
    art: chart(N, true) + `**CRASH à ${fx(crash)}**`,
    caption: res.crash >= target ? `Explosion à ${fx(crash)} : tu avais encaissé x${target}` : `Explosion à ${fx(crash)} : trop tôt pour ta cible`,
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
      '  Gratte les 3 cases',
    ]);
  const steps = [
    [[0, 0, 0], 'Le ticket est prêt'],
    [[1, 0, 0], 'Tu gratte la première case...'],
    [[2, 0, 0], `Première case : ${res.cells[0]}`],
    [[2, 1, 0], 'Tu gratte la deuxième case...'],
    [[2, 2, 0], `Deuxième case : ${res.cells[1]}`],
    [[2, 2, 1], 'Dernière case...'],
    [[2, 2, 2], res.cells[0] === res.cells[1] && res.cells[1] === res.cells[2] ? 'Trois identiques : GAGNÉ !' : 'Pas de trio : perdu'],
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
    { art: scene(c3, -1), caption: 'Trois coffres, un seul trésor', ms: 900 },
    { art: scene(c3, chosen), caption: `Tu désignes le coffre ${res.want}`, ms: 900 },
    { art: scene(c3, chosen), caption: 'La serrure grince...', ms: 900 },
    { art: scene(withOpen, chosen), caption: res.win === res.want ? 'Le couvercle se soulève : un trésor !' : 'Le couvercle se soulève : vide...', ms: 1100 },
    { art: scene(all, res.win - 1), caption: `Le trésor était dans le coffre ${res.win}`, ms: 1200 },
  ];
};

ANIMS.russian = (res) => {
  const cyl = (rot, firing) => {
    const ch = range(6).map((p) => (res.chambers[(p + rot) % 6] ? '@' : 'o'));
    // positions : haut, haut-droite, bas-droite, bas, bas-gauche, haut-gauche
    return code([
      '           v',
      `          (${ch[0]})`,
      `     (${ch[5]})       (${ch[1]})`,
      `     (${ch[4]})       (${ch[2]})`,
      `          (${ch[3]})`,
      '',
      firing || '   @ = balle   o = vide',
    ]);
  };
  const rots = [0, 2, 4, 1, 3, 5, 2, 4];
  const caps = ['Le barillet est chargé', 'Tu le fais tourner', 'Il tourne vite', 'Plus vite encore', 'Il ralentit', 'Il ralentit encore', 'Presque arrêté', 'Il s\'arrête'];
  const frames = rots.map((r, k) => ({ art: cyl(r), caption: caps[k], ms: 750 + k * 60 }));
  frames.push({ art: cyl(0, '   Le percuteur est armé...'), caption: 'Tu appuies sur la détente', ms: 1300 });
  frames.push({
    art: cyl(0, res.dead ? '   >>> BANG <<<' : '   ...clic.'),
    caption: res.dead ? 'BANG ! La balle était là' : 'Clic : la chambre était vide',
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
  const track = (pos, flag) => code([...pos.map((p, k) => lane(k, p)), '', flag || `* = ton cheval (n°${res.want + 1})`]);
  const caps = ['Les chevaux sont aux boîtes', 'Départ !', 'Le peloton se forme', 'Ça se bat en tête', 'Dans la ligne droite', 'Sprint final', 'Photo-finish...'];
  const frames = [{ art: track(Array(5).fill(0), 'Sous les ordres du starter...'), caption: 'Les chevaux sont aux boîtes', ms: 900 }];
  positions.forEach((pos, k) => frames.push({ art: track(pos), caption: caps[Math.min(k + 1, caps.length - 1)], ms: 800 }));
  frames.push({ art: track(finals, `Vainqueur : cheval n°${res.winner + 1}`), caption: `Le cheval n°${res.winner + 1} franchit la ligne en premier`, ms: 1200 });
  return frames;
};

async function playInstant(i, key, bet, choice) {
  const G = INSTANT[key];
  if (!G || !G.choices.includes(choice)) return respondText(i, 'Pari invalide.');
  const uid = i.user.id;
  if (!tryLock(uid)) return respondText(i, MSG.busy);

  try {
    const err = await takeBet(uid, bet);
    if (err) return respondText(i, err);

    const c = coef(key);
    const res = G.resolve(choice, c);
    const boost = getBoost(i.guildId);
    const mult = res.base > 0 ? round2(res.base * c * (boost.winMult || 1)) : 0;
    const payout = mult > 0 ? floor2(bet * mult) : 0;
    let extraLoss = 0;
    if (payout === 0 && (boost.loseMult || 1) > 1) {
      extraLoss = floor2(bet * ((boost.loseMult || 1) - 1));
      if (extraLoss > 0) await debit(uid, extraLoss).catch(() => {});
    }
    const profit = round2(payout - bet - extraLoss);

    try {
      await openGame(i, {
        embeds: [
          new EmbedBuilder()
            .setTitle(G.title)
            .setColor(COLORS.violet)
            .setDescription(
              `${G.spinText}\nMise **${fmt(bet)}** · ${res.pick}` + (boost.label ? `\n⚡ Boost actif : **${boost.label}**` : '')
            ),
        ],
        components: [],
      });
    } catch (e) {
      await credit(uid, bet + extraLoss).catch(() => {});
      throw e;
    }

    const balance = payout > 0 ? await credit(uid, payout) : await getBalance(uid);

    const frames = ANIMS[key] ? ANIMS[key](res, { c, bet, choice }) : [{ art: G.spinText, ms: 1200 }];
    await animate(i, frames, G.title, `Mise **${fmt(bet)}** · ${res.pick}\n`);

    let text;
    let color;
    if (payout === 0) {
      text = `😬 Perdu, tu laisses **${fmt(bet)}**.`;
      color = COLORS.red;
    } else if (profit > 0) {
      text = `🎉 Gagné ! Tu empoches **${fmt(payout)}** (${fx(mult)}), profit : **${signed(profit)}**.`;
      color = COLORS.green;
    } else if (profit === 0) {
      text = `🤝 Mise remboursée (${fx(mult)}).`;
      color = COLORS.grey;
    } else {
      text = `😐 Tu récupères **${fmt(payout)}** (${fx(mult)}), perte : **${signed(profit)}**.`;
      color = COLORS.grey;
    }

    const embed = new EmbedBuilder()
      .setTitle(G.title)
      .setColor(color)
      .setDescription(`${res.headline}\n\n${text}`)
      .addFields(
        { name: 'Ton pari', value: res.pick, inline: true },
        { name: 'Mise', value: fmt(bet), inline: true },
        { name: 'Solde', value: fmt(balance), inline: true },
        {
          name: 'Reçu',
          value: receipt([
            ['Mise', fmt(bet)],
            ['Multiplicateur', fx(mult)],
            ['Gain', fmt(payout)],
            ['Profit', signed(profit)],
          ]),
        }
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`replay|${key}|${bet}|${choice}`).setLabel('Rejouer').setEmoji('🔁').setStyle(ButtonStyle.Success)
    );
    await i.editReply({ embeds: [embed], components: [row] });

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
//  PANNEAU DE JEU (boutons) + POP-UPS
// ============================================================
function buildHelpEmbed() {
  const p = PREFIX;
  return new EmbedBuilder()
    .setColor(COLORS.violet)
    .setAuthor({ name: 'ZNK CASINO' })
    .setTitle('✨ Guide')
    .setDescription('Tout se joue avec les **boutons**. Parties **privées**.')
    .addFields(
      { name: '🎮 Jeux', value: '**Start** → MP → **Jouer** → choix du jeu → mise.', inline: false },
      { name: '🎁 Daily', value: `**${DAILY_AMOUNT} ${COIN}** / jour (minuit Paris)`, inline: true },
      { name: '📨 Invites', value: `**+${INVITE_REWARD} ${COIN}** / ami`, inline: true },
      { name: '📊 Stats', value: 'Bannière de tes statistiques', inline: true },
      { name: '👑 Admin', value: `\`${p}setup\` · \`${p}admin\` · \`${p}wins\` · \`${p}classement\``, inline: false }
    )
    .setFooter({ text: 'ZNK Casino' })
    .setTimestamp();
}

function buildPanelPayload() {
  const panel = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setAuthor({ name: 'ZNK CASINO', iconURL: COIN_IMG })
    .setThumbnail(COIN_IMG)
    .setTitle('✦ Salon de jeu')
    .setDescription(
      [
        'Bienvenue sur **ZNK Casino**.',
        '',
        `🎁 **Daily** · **${DAILY_AMOUNT}** ${COIN} · 1× / jour · minuit Paris`,
        '',
        '▶️ **Start** : casino privé en MP',
        '⚙️ **Paramètres** : langue FR / EN et ping des victoires',
        '📊 **Stats** : ta bannière de statistiques',
        '📨 **Invites** : tes invitations',
        '',
        '🔒 Parties privées · classements partagés',
      ].join('\n')
    )
    .addFields(
      { name: 'Jouer', value: 'Start → MP', inline: true },
      { name: 'Monnaie', value: COIN, inline: true },
      { name: 'Langues', value: 'FR · EN', inline: true }
    )
    .setFooter({ text: 'ZNK Casino', iconURL: COIN_IMG })
    .setTimestamp();

  const znkBtn = { id: COIN_EMOJI_ID, name: 'znk' };
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_start').setLabel('Start').setEmoji(znkBtn).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_settings').setLabel('Paramètres').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_invites').setLabel('Invites').setEmoji('📨').setStyle(ButtonStyle.Secondary)
  );
  // Emoji custom dans le content (hors embed) = affichage fiable
  return { content: `${COIN} **ZNK Casino**`, embeds: [panel], components: [row] };
}

function buildDmPlayPayload(userId) {
  const lang = getLang(userId);
  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setAuthor({ name: 'ZNK CASINO', iconURL: COIN_IMG })
    .setThumbnail(COIN_IMG)
    .setTitle(lang === 'en' ? '✦ Your table' : '✦ Ta table')
    .setDescription(
      lang === 'en'
        ? [
            'Language: **English**',
            `Daily: **${DAILY_AMOUNT}** ${COIN} · once / day (Paris midnight)`,
            '',
            '**Play** opens the game picker.',
            `**Send** transfers ${COIN} to another player (Discord ID).`,
            '**Clear** closes games and cleans this chat.',
          ].join('\n')
        : [
            'Langue : **Français**',
            `Daily : **${DAILY_AMOUNT}** ${COIN} · 1× / jour (minuit Paris)`,
            '',
            '**Jouer** ouvre le choix des jeux.',
            `**Envoyer** transfère des ${COIN} (ID Discord).`,
            '**Clear** ferme les parties et nettoie ce chat.',
          ].join('\n')
    )
    .setFooter({ text: 'ZNK Casino', iconURL: COIN_IMG })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_play').setLabel(lang === 'en' ? 'Play' : 'Jouer').setEmoji('🎮').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_daily').setLabel('Daily').setEmoji('🎁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_balance').setLabel(lang === 'en' ? 'Balance' : 'Solde').setEmoji('💰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_send').setLabel(lang === 'en' ? 'Send' : 'Envoyer').setEmoji('💸').setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_history').setLabel(lang === 'en' ? 'History' : 'Historique').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_top').setLabel(lang === 'en' ? 'Ranks' : 'Classement').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_topall').setLabel('All-time').setEmoji('👑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_clear').setLabel('Clear').setEmoji('🧹').setStyle(ButtonStyle.Danger)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_settings').setLabel(lang === 'en' ? 'Settings' : 'Paramètres').setEmoji('⚙️').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row1, row2, row3] };
}

const GAME_MENU = [
  ['mines', 'Mines', '💣', 'Bombes · multiplicateur croissant'],
  ['bj', 'Blackjack', '🃏', 'Bats le croupier · As soft'],
  ['roulette', 'Roulette', '🎡', 'Couleur · pair · numéro'],
  ['coinflip', 'Pile/Face', '🪙', '50 / 50'],
  ['dice', 'Dés', '🎲', 'Somme de 2 dés'],
  ['slots', 'Slots', '🎰', '3 rouleaux · jackpot'],
  ['wheel', 'Roue', '🎡', 'Roue de la fortune'],
  ['duel', 'Duel', '⚔️', 'Carte vs croupier'],
  ['suit', 'Enseigne', '🃏', 'Devine la couleur'],
  ['zone', 'Zone', '🎯', 'Bas · milieu · haut'],
  ['plinko', 'Plinko', '🎱', 'Bille · risque'],
  ['crash', 'Crash', '🚀', 'Cash-out avant boom'],
  ['scratch', 'Ticket', '🎟️', 'Gratte & gagne'],
  ['die', 'Dé exact', '🎲', '1 chance sur 6'],
  ['chest', 'Coffre', '📦', 'Trouve le trésor'],
  ['russian', 'Russe', '🔫', 'Survis au barillet'],
  ['horses', 'Chevaux', '🏇', 'Parie sur le gagnant'],
];

function buildGameMenuPayload(userId = null) {
  const lang = userId ? getLang(userId) : 'fr';
  const names = {
    mines: 'Mines', bj: 'Blackjack', roulette: 'Roulette', coinflip: 'Coin Flip', dice: 'Dice', slots: 'Slots',
    wheel: 'Wheel', duel: 'Duel', suit: 'Suit', zone: 'Zone', plinko: 'Plinko', crash: 'Crash', scratch: 'Scratch',
    die: 'Exact die', chest: 'Chest', russian: 'Russian roulette', horses: 'Horses',
  };
  const descs = {
    mines: 'Avoid bombs · rising mult', bj: 'Beat the dealer · soft aces', roulette: 'Color · parity · number',
    coinflip: '50 / 50', dice: 'Sum of 2 dice', slots: '3 reels · jackpot', wheel: 'Wheel of fortune',
    duel: 'Card vs dealer', suit: 'Guess the suit', zone: 'Low · mid · high', plinko: 'Ball · risk level',
    crash: 'Cash out before boom', scratch: 'Scratch & win', die: '1 in 6', chest: 'Find the treasure',
    russian: 'Survive the cylinder', horses: 'Pick the winner',
  };

  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setAuthor({ name: 'ZNK CASINO' })
    .setTitle(t(userId, 'lobbyTitle'))
    .setDescription(t(userId, 'lobbyDesc'))
    .setFooter({ text: t(userId, 'lobbyFooter') })
    .setTimestamp();

  const select = new StringSelectMenuBuilder()
    .setCustomId('panel_gameselect')
    .setPlaceholder(t(userId, 'lobbyPlaceholder'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      GAME_MENU.map(([key, name, emoji, desc]) => ({
        label: (lang === 'en' ? names[key] : name).slice(0, 100),
        value: key,
        emoji,
        description: (lang === 'en' ? descs[key] : desc).slice(0, 100),
      }))
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

function buildSettingsPayload(userId) {
  const cur = getLang(userId);
  const ping = wantsWinPing(userId);
  const embed = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setAuthor({ name: 'ZNK CASINO' })
    .setTitle(`⚙️ ${L(userId, 'Paramètres', 'Settings')}`)
    .setDescription(
      code([
        `${padR(L(userId, 'Langue', 'Language'), 22)}${padL(cur === 'fr' ? 'Français' : 'English', 10)}`,
        `${padR(L(userId, 'Ping des victoires', 'Win pings'), 22)}${padL(ping ? 'ON' : 'OFF', 10)}`,
      ]) +
        L(
          userId,
          '**Langue** : menus et messages privés.\n**Ping** : quand il est coupé, le bot ne te mentionne plus dans le salon des victoires (ta victoire reste affichée, sans notification).',
          '**Language**: menus and private messages.\n**Ping**: when off, the bot no longer mentions you in the wins channel (your win is still shown, without a notification).'
        )
    )
    .setFooter({ text: L(userId, 'Sauvegardé pour toi', 'Saved for you') });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_lang_fr').setLabel('Français').setEmoji('🇫🇷').setStyle(cur === 'fr' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_lang_en').setLabel('English').setEmoji('🇬🇧').setStyle(cur === 'en' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel_ping')
      .setLabel(`Ping : ${ping ? 'ON' : 'OFF'}`)
      .setEmoji('🔔')
      .setStyle(ping ? ButtonStyle.Primary : ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row] };
}

function modalInput(id, label, { placeholder, value, required = true, max = 30 } = {}) {
  const ti = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
  if (placeholder) ti.setPlaceholder(placeholder);
  if (value) ti.setValue(value);
  return new ActionRowBuilder().addComponents(ti);
}

const betLabel = (bal) => {
  const s = `Mise (solde: ${num(bal)} ${COIN})`;
  return s.length > 45 ? `Mise · solde ${num(bal)}` : s;
};
const BET_PLACEHOLDER = 'ex : 1  ou  all';

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
    .setTitle(key === 'num' ? '🎡 Roulette · Numéro' : `🎡 Roulette · ${parseRouletteBet(key)?.label || key}`.slice(0, 45))
    .addComponents(modalInput('bet', betLabel(bal), { placeholder: BET_PLACEHOLDER }));
  if (key === 'num') m.addComponents(modalInput('num', 'Ton numéro (0 à 36)', { placeholder: 'ex : 17', max: 2 }));
  return m;
}

const instantBetModal = (key, choice, bal = 0) =>
  new ModalBuilder()
    .setCustomId(`modal_ig_${key}_${choice}`)
    .setTitle((INSTANT[key]?.title || 'Jeu').slice(0, 45))
    .addComponents(modalInput('bet', betLabel(bal), { placeholder: BET_PLACEHOLDER }));

async function handlePanelButton(i) {
  const instantKey = i.customId.slice('panel_'.length);
  if (INSTANT[instantKey]) {
    return i.reply({ ...INSTANT[instantKey].picker(coef(instantKey)), flags: EPH });
  }

  switch (i.customId) {
    case 'panel_start': {
      if (i.guild?.id) userHomeGuild.set(i.user.id, i.guild.id);
      const payload = buildDmPlayPayload(i.user.id);
      try {
        const dm = await i.user.createDM();
        await dm.send(payload);
        return i.reply({
          content: L(i.user.id, '✅ **Start** envoyé en **message privé**. Ouvre tes MP avec le bot.', '✅ **Start** sent in your DMs. Open your private messages with the bot.'),
          flags: EPH,
        });
      } catch {
        return i.reply({
          content: L(i.user.id, '⚠️ Impossible de t’écrire en MP (MP fermés). Voici ton panneau privé :', '⚠️ Could not DM you (DMs closed). Here’s your private panel instead:'),
          ...payload,
          flags: EPH,
        });
      }
    }
    case 'panel_play':
      return i.reply({ ...buildGameMenuPayload(i.user.id), flags: EPH });
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
    case 'panel_stats': {
      await i.deferReply({ flags: EPH });
      const lang = getLang(i.user.id);
      const [st, bal] = await Promise.all([getPlayerStats(i.user.id), getBalance(i.user.id)]);
      let buf = null;
      try {
        buf = await renderStatsBanner(i.user, st, bal, lang);
      } catch (e) {
        console.error('[stats] bannière', e?.message || e);
      }
      if (buf) return i.editReply({ files: [new AttachmentBuilder(buf, { name: 'stats.png' })] });
      return i.editReply({ embeds: [statsFallbackEmbed(i.user, st, bal, lang)] });
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
            const fetched = await channel.messages.fetch({ limit: 40 }).catch(() => null);
            if (fetched) {
              const mine = fetched.filter((m) => m.author.id === client.user.id);
              for (const m of mine.values()) await m.delete().catch(() => {});
            }
            await channel.send(buildDmPlayPayload(i.user.id));
          }
          return i.editReply({
            content: L(i.user.id, '🧹 Chat nettoyé · parties fermées · panneau renvoyé.', '🧹 Chat cleaned · games closed · fresh panel sent.'),
          });
        } catch (e) {
          console.error('[clear dm]', e?.message || e);
        }
      }

      return i.reply({
        content: L(i.user.id, '🧹 Parties fermées. **Start** pour un panneau privé propre.', '🧹 Open games closed. Use **Start** for a clean private panel.'),
        flags: EPH,
      });
    }
    case 'panel_mines':
      return i.reply({ ...minesPickerPayload(), flags: EPH });
    case 'panel_bj': {
      const bal = await getBalance(i.user.id);
      return i.showModal(blackjackModal(bal));
    }
    case 'panel_roulette':
      return i.reply({ ...roulettePickerPayload(), flags: EPH });
    case 'panel_balance': {
      const bal = await getBalance(i.user.id);
      return i.reply({ content: `💰 ${t(i.user.id, 'yourBalance')} : **${fmt(bal)}**`, flags: EPH });
    }
    case 'panel_daily': {
      const res = await rpc('claim_daily', { p_user_id: i.user.id, p_amount: DAILY_AMOUNT });
      if (res?.balance != null) await touchPeak(i.user.id, res.balance);
      if (res?.claimed) {
        return i.reply({
          content: `🎁 ${t(i.user.id, 'dailyOk')} **${fmt(DAILY_AMOUNT)}** ! ${t(i.user.id, 'newBalance')} : **${fmt(res.balance)}**`,
          flags: EPH,
        });
      }
      return i.reply({
        content: `🎁 ${t(i.user.id, 'dailyAlready')}\n${t(i.user.id, 'yourBalance')} : **${fmt(res?.balance ?? 0)}**`,
        flags: EPH,
      });
    }
    case 'panel_top': {
      await i.deferReply({ flags: EPH });
      return i.editReply({ embeds: [await buildLeaderboardEmbed(getLang(i.user.id))] });
    }
    case 'panel_topall': {
      await i.deferReply({ flags: EPH });
      return i.editReply({ embeds: [await buildAllTimeLeaderboardEmbed(getLang(i.user.id))] });
    }
    case 'panel_history': {
      await i.deferReply({ flags: EPH });
      return i.editReply({ embeds: [await historyEmbed(i.user.id)] });
    }
    case 'panel_invites': {
      await i.deferReply({ flags: EPH });
      if (!i.guild) return i.editReply({ content: 'Les invitations se consultent depuis le serveur.' });
      return i.editReply({ embeds: [await buildInvitesEmbed(i.guild, i.user.id)] });
    }
    case 'panel_send': {
      if (i.guild) {
        const row = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId('panel_send_pick')
            .setPlaceholder(L(i.user.id, 'Choisis un membre', 'Pick a member'))
            .setMinValues(1)
            .setMaxValues(1)
        );
        return i.reply({ content: t(i.user.id, 'sendPick'), components: [row], flags: EPH });
      }
      const bal = await getBalance(i.user.id);
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_send_dm')
          .setTitle(L(i.user.id, `💸 Envoyer des ${COIN_PLAIN}`, `💸 Send ${COIN_PLAIN}`))
          .addComponents(
            modalInput('to', L(i.user.id, 'ID Discord du joueur', 'User ID (Discord)'), {
              placeholder: 'ex : 123456789012345678',
              max: 25,
            }),
            modalInput('amount', betLabel(bal), { placeholder: 'ex : 5  ou  all' })
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
  const badBet = () => respondText(i, 'Mise invalide : écris un nombre (ex : 1 ou 2.5) ou "all".');

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
    if (!parseRouletteBet(choiceStr)) return respondText(i, 'Numéro invalide : entre un nombre de 0 à 36.');
    const bet = await readBet();
    return bet ? playRoulette(i, bet, choiceStr) : badBet();
  }
  if (id === 'modal_send_dm' || id.startsWith('modal_send_')) {
    let toId;
    if (id === 'modal_send_dm') toId = String(get('to') || '').replace(/[<@!>]/g, '').trim();
    else toId = id.slice('modal_send_'.length);
    if (!/^\d{15,25}$/.test(toId)) {
      return respondText(i, L(i.user.id, 'ID invalide. Clic droit sur le joueur → Copier l’identifiant.', 'Invalid user ID. Right-click the user → Copy User ID.'));
    }
    if (toId === i.user.id) {
      return respondText(i, L(i.user.id, `❌ Tu ne peux pas t’envoyer des ${COIN} à toi-même.`, `❌ You cannot send ${COIN} to yourself.`));
    }
    const bal = await getBalance(i.user.id);
    const amount = parseAmount(get('amount'), bal);
    if (!amount) return respondText(i, 'Montant invalide : nombre ou "all".');
    if (amount > bal) return respondText(i, t(i.user.id, 'insufficient'));
    const newBal = await debit(i.user.id, amount);
    if (newBal === null) return respondText(i, t(i.user.id, 'insufficient'));
    const toBal = await credit(toId, amount);
    return i.reply({
      content:
        `✅ **${fmt(amount)}** → <@${toId}>\n` +
        `💰 ${t(i.user.id, 'yourBalance')} : **${fmt(newBal)}** · Dest. : **${fmt(toBal)}**`,
      flags: EPH,
    });
  }
}

async function handleReplay(i) {
  const [, type, betStr, arg] = i.customId.split('|');
  const bet = Number(betStr);
  if (!Number.isFinite(bet) || bet <= 0) return respondText(i, 'Mise invalide.');
  if (type === 'mines') return startMines(i, arg, bet);
  if (type === 'bj') return startBlackjack(i, bet);
  if (type === 'rl') return playRoulette(i, bet, arg);
  if (INSTANT[type]) return playInstant(i, type, bet, arg);
}

// ============================================================
//  PANNEAU ADMIN (propriétaire uniquement)
// ============================================================
function buildAdminPayload() {
  const embed = new EmbedBuilder()
    .setColor(0xEF4444)
    .setAuthor({ name: 'ZNK CASINO' })
    .setTitle('✦ Admin')
    .setDescription(`Contrôle propriétaire · monnaie **${COIN}**\nChaque action publique indique **qui** l’a faite.`)
    .addFields(
      { name: '💰 Économie', value: 'Ajouter · Retirer · Définir · Voir · Offrir all', inline: false },
      { name: '💥 Resets', value: 'Soldes · All-time', inline: true },
      { name: '🎚️ Live', value: 'Mult · Events · Boosts', inline: true },
      { name: '📡 Salons', value: 'All-time · Notifs', inline: true }
    )
    .setFooter({ text: 'Owner only · ZNK' })
    .setTimestamp();
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_add').setLabel('Ajouter').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_remove').setLabel('Retirer').setEmoji('➖').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_set').setLabel('Définir').setEmoji('🎯').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_view').setLabel('Voir').setEmoji('👀').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_all').setLabel('Offrir all').setEmoji('🎁').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_reset').setLabel('Reset soldes').setEmoji('💥').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_resetpeaks').setLabel('Reset all-time').setEmoji('👑').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_mult').setLabel('Multiplicateurs').setEmoji('🎚️').setStyle(ButtonStyle.Primary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_event').setLabel('Événement').setEmoji('📢').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_annonce').setLabel('Annonce').setEmoji('📣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_alltimechan').setLabel('Salon all-time').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_notifchan').setLabel('Salon notifs').setEmoji('🔔').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row1, row2, row3] };
}

// ---------- Événements (claim, giveaway, boosts) ----------
const activeEvents = new Map();

const EVENT_TYPES = [
  { id: 'claim', label: 'Claim rapide', desc: 'Les N premiers qui cliquent gagnent' },
  { id: 'giveaway', label: 'Giveaway', desc: 'Inscriptions, tirage à la fin du timer' },
  { id: 'x2win', label: 'x2 Gains', desc: 'Tous les gains sont doublés pendant X min' },
  { id: 'x2lose', label: 'x2 Pertes', desc: 'Les pertes sont doublées pendant X min' },
  { id: 'x2both', label: 'x2 Gains & Pertes', desc: 'Gains et pertes x2 pendant X min' },
  { id: 'lucky', label: 'Heure chanceuse', desc: 'Gains x1.5 pendant X min' },
  { id: 'goldrush', label: 'Ruée vers l’or', desc: 'Gains x3 pendant X min' },
];

function claimEventEmbed(ev) {
  const left = ev.maxWinners - ev.winners.size;
  const host = ev.hostId ? `👤 Par <@${ev.hostId}>\n` : '';
  const e = new EmbedBuilder().setTitle('📢 Claim : premier arrivé').setColor(left > 0 ? COLORS.violet : COLORS.grey);
  if (ev.finished || left <= 0) {
    const names = [...ev.winners].map((id) => `<@${id}>`).join(', ') || 'personne';
    e.setDescription(`${host}🏁 **Terminé** · gagnant(s) : ${names}\nChacun a reçu **${fmt(ev.amount)}**.`);
  } else {
    const timeLine = ev.expiresAt ? `\n⏱️ Expire <t:${Math.floor(ev.expiresAt / 1000)}:R>` : '\n⏱️ Sans limite';
    e.setDescription(
      `${host}🎁 **${fmt(ev.amount)}** par gagnant\n` +
        `Places restantes : **${left}/${ev.maxWinners}**\n` +
        `Clique **Réclamer** pour empocher ta part !${timeLine}`
    );
  }
  return e;
}

function giveawayEmbed(ev) {
  const host = ev.hostId ? `👤 Par <@${ev.hostId}>\n` : '';
  const e = new EmbedBuilder().setTitle('🎉 Giveaway').setColor(ev.finished ? COLORS.grey : COLORS.gold);
  if (ev.finished) {
    const names = [...ev.winners].map((id) => `<@${id}>`).join(', ') || 'personne';
    e.setDescription(
      `${host}🏁 **Tirage terminé**\nGagnant(s) : ${names}\nPrix : **${fmt(ev.amount)}** chacun\n` +
        `Participants : **${ev.entries.size}**`
    );
  } else {
    e.setDescription(
      `${host}🎁 Prix : **${fmt(ev.amount)}** × **${ev.maxWinners}** gagnant(s)\n` +
        `Clique **Participer** pour t’inscrire !\n` +
        `👥 Inscrits : **${ev.entries.size}**\n` +
        `⏱️ Tirage <t:${Math.floor(ev.expiresAt / 1000)}:R>`
    );
  }
  return e;
}

function eventActionRow(eventId, type, disabled) {
  if (type === 'giveaway') {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`event_join_${eventId}`)
        .setLabel(disabled ? 'Terminé' : 'Participer')
        .setEmoji(disabled ? '🏁' : '🎟️')
        .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(!!disabled)
    );
  }
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_claim_${eventId}`)
      .setLabel(disabled ? 'Terminé' : 'Réclamer')
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
  activeEvents.delete(eventId);

  try {
    const ch = await client.channels.fetch(ev.channelId).catch(() => null);
    const msg = ch ? await ch.messages.fetch(ev.messageId).catch(() => null) : null;
    if (msg) {
      await msg.edit({ embeds: [giveawayEmbed(ev)], components: [eventActionRow(eventId, 'giveaway', true)] });
    }
  } catch (e) {
    console.error('[giveaway] finish', e?.message || e);
  }
}

async function expireClaimEvent(eventId) {
  const ev = activeEvents.get(eventId);
  if (!ev || ev.finished || ev.type !== 'claim') return;
  ev.finished = true;
  clearTimeout(ev.timer);
  activeEvents.delete(eventId);
  try {
    const ch = await client.channels.fetch(ev.channelId).catch(() => null);
    const msg = ch ? await ch.messages.fetch(ev.messageId).catch(() => null) : null;
    if (msg) {
      await msg.edit({ embeds: [claimEventEmbed(ev)], components: [eventActionRow(eventId, 'claim', true)] });
    }
  } catch (e) {
    console.error('[claim] expire', e?.message || e);
  }
}

async function handleEventClaim(i) {
  const eventId = i.customId.slice('event_claim_'.length);
  const ev = activeEvents.get(eventId);
  if (!ev || ev.finished || ev.type !== 'claim') {
    return i.reply({ content: 'Cette récompense n’est plus disponible.', flags: EPH });
  }
  if (ev.expiresAt && Date.now() > ev.expiresAt) {
    await expireClaimEvent(eventId);
    return i.reply({ content: '⏱️ Cet événement a expiré.', flags: EPH });
  }
  if (ev.winners.has(i.user.id)) return i.reply({ content: 'Tu as déjà réclamé ta part !', flags: EPH });
  if (ev.winners.size >= ev.maxWinners) {
    ev.finished = true;
    activeEvents.delete(eventId);
    return i.reply({ content: 'Plus de places disponibles.', flags: EPH });
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
    await i.update({ embeds: [claimEventEmbed(ev)], components: [eventActionRow(eventId, 'claim', done)] });
    await i.followUp({ content: `✅ Tu as reçu **${fmt(ev.amount)}** !`, flags: EPH }).catch(() => {});
  } catch (e) {
    ev.winners.delete(i.user.id);
    console.error('[event] claim', e?.message || e);
    if (!i.replied && !i.deferred) {
      await i.reply({ content: '⚠️ Erreur lors du crédit.', flags: EPH }).catch(() => {});
    }
  }
}

async function handleEventJoin(i) {
  const eventId = i.customId.slice('event_join_'.length);
  const ev = activeEvents.get(eventId);
  if (!ev || ev.finished || ev.type !== 'giveaway') return i.reply({ content: 'Ce giveaway est terminé.', flags: EPH });
  if (ev.expiresAt && Date.now() > ev.expiresAt) {
    await finishGiveaway(eventId);
    return i.reply({ content: '⏱️ Le giveaway est terminé.', flags: EPH });
  }
  if (ev.entries.has(i.user.id)) return i.reply({ content: 'Tu es déjà inscrit !', flags: EPH });
  ev.entries.add(i.user.id);
  try {
    await i.update({ embeds: [giveawayEmbed(ev)], components: [eventActionRow(eventId, 'giveaway', false)] });
    await i.followUp({ content: '🎟️ Tu es inscrit au giveaway ! Bonne chance.', flags: EPH }).catch(() => {});
  } catch (e) {
    console.error('[giveaway] join', e?.message || e);
  }
}

async function postBoostEvent(i, kind, minutes) {
  const ch = await getAnnounceChannel(i.guild.id);
  if (!ch) return respondText(i, 'Aucun salon de notifs/casino : fais `!setup` ou définis **Salon notifs**.');

  const presets = {
    x2win: { winMult: 2, loseMult: 1, label: 'x2 Gains 🔥' },
    x2lose: { winMult: 1, loseMult: 2, label: 'x2 Pertes 💀' },
    x2both: { winMult: 2, loseMult: 2, label: 'x2 Gains & Pertes ⚡' },
    lucky: { winMult: 1.5, loseMult: 1, label: 'Heure chanceuse 🍀' },
    goldrush: { winMult: 3, loseMult: 1, label: 'Ruée vers l’or 🏆' },
  };
  const p = presets[kind];
  if (!p) return respondText(i, 'Type de boost inconnu.');
  if (!minutes || minutes < 1) return respondText(i, 'Indique une durée en minutes (min. 1).');

  await startBoost(i.guild.id, { ...p, minutes });
  const ends = Math.floor((Date.now() + minutes * 60_000) / 1000);
  await ch.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(`⚡ Boost : ${p.label}`)
        .setColor(COLORS.gold)
        .setDescription(
          `👤 Lancé par <@${i.user.id}>\n` +
            `Un boost est actif pendant **${minutes} min** (fin <t:${ends}:R>) !\n` +
            (p.winMult !== 1 ? `• Gains × **${p.winMult}**\n` : '') +
            (p.loseMult !== 1 ? `• Pertes × **${p.loseMult}** (mise perdue ×${p.loseMult})\n` : '') +
            `\nJoue maintenant pour en profiter !`
        )
        .setTimestamp(),
    ],
  });
  return i.reply({ content: `✅ Boost **${p.label}** lancé pour **${minutes} min**.`, flags: EPH });
}

async function createClaimOrGiveaway(i, type, amount, winners, minutes) {
  const ch = await getAnnounceChannel(i.guild.id);
  if (!ch) return respondText(i, 'Aucun salon de notifs/casino : fais `!setup` ou définis **Salon notifs**.');

  if (type === 'giveaway' && (!minutes || minutes < 1)) {
    return respondText(i, 'Un giveaway doit avoir une durée (minutes ≥ 1).');
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
    channelId: ch.id,
    messageId: null,
    expiresAt,
    finished: false,
    timer: null,
    hostId: i.user.id,
  };

  const msg = await ch.send({
    embeds: [type === 'giveaway' ? giveawayEmbed(ev) : claimEventEmbed(ev)],
    components: [eventActionRow(eventId, type, false)],
  });
  ev.messageId = msg.id;

  if (type === 'giveaway') ev.timer = setTimeout(() => finishGiveaway(eventId), expiresAt - Date.now());
  else if (expiresAt) ev.timer = setTimeout(() => expireClaimEvent(eventId), expiresAt - Date.now());
  activeEvents.set(eventId, ev);

  return i.reply({
    content:
      type === 'giveaway'
        ? `✅ Giveaway posté : **${fmt(amount)}** × ${maxWinners} · tirage dans **${minutes} min**.`
        : `✅ Claim posté : **${fmt(amount)}** × ${maxWinners} gagnant(s)` +
          (minutes > 0 ? ` · expire dans **${minutes} min**` : ' · sans limite') +
          '.',
    flags: EPH,
  });
}

const MULT_INFO = {
  mines: () => `1er 💎 : Easy ${fx(minesMultiplier(1, LEVELS.easy.mines))} · Impossible ${fx(minesMultiplier(1, LEVELS.impossible.mines))}`,
  bj: (c) => `victoire ${fx(2 * c)} · blackjack ${fx(2.5 * c)}`,
  roulette: (c) => `couleur/pair/impair ${fx(2 * c)} · numéro ${fx(36 * c)}`,
};

function multAdminPayload(note) {
  const lines = Object.keys(GAME_NAMES).map((g) => {
    const c = coef(g);
    return `${GAME_NAMES[g]} : coefficient **${fx(c)}**\n└ ${(MULT_INFO[g] || INSTANT[g].info)(c)}`;
  });
  const embed = new EmbedBuilder()
    .setTitle('🎚️ Multiplicateurs des jeux')
    .setColor(COLORS.red)
    .setDescription(
      `Le coefficient multiplie **tous les gains** du jeu (x1.00 = normal, ex : x1.50 = gains +50 %). ` +
        `Valeurs autorisées : ${fx(MULT_MIN)} à ${fx(MULT_MAX)}.\n\n${lines.join('\n\n')}` +
        (note ? `\n\n${note}` : '')
    );
  const select = new StringSelectMenuBuilder()
    .setCustomId('admin_multpick')
    .setPlaceholder('Choisis le jeu à modifier')
    .addOptions(
      Object.keys(GAME_NAMES).map((g) => ({
        label: GAME_NAMES[g].replace(/^\S+\s/, ''),
        emoji: GAME_NAMES[g].split(' ')[0],
        value: g,
        description: `Coefficient actuel : ${fx(coef(g))}`,
      }))
    );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

const ADMIN_TITLES = {
  add: '➕ Ajouter de l’argent : choisis le membre',
  remove: '➖ Retirer de l’argent : choisis le membre',
  set: '🎯 Définir le solde : choisis le membre',
  view: '👀 Voir un solde : choisis le membre',
};

async function handleAdmin(i) {
  if (!i.guild) return i.reply({ content: CROWN_ONLY, flags: EPH });
  if (i.user.id !== i.guild.ownerId) return i.reply({ content: CROWN_ONLY, flags: EPH });
  const id = i.customId;

  if (i.isButton()) {
    const action = id.slice('admin_'.length);
    if (action === 'mult') return i.reply({ ...multAdminPayload(), flags: EPH });
    if (action === 'event') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('admin_eventpick')
        .setPlaceholder('Type d’événement')
        .addOptions(EVENT_TYPES.map((et) => ({ label: et.label, value: et.id, description: et.desc.slice(0, 100) })));
      return i.reply({
        content: '📢 Choisis le type d’événement :',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: EPH,
      });
    }
    if (action === 'reset') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_reset')
          .setTitle('💥 Reset tous les soldes')
          .addComponents(modalInput('confirm', 'Tape RESET pour confirmer', { placeholder: 'RESET', max: 10 }))
      );
    }
    if (action === 'resetpeaks') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_resetpeaks')
          .setTitle('👑 Reset classement all-time')
          .addComponents(modalInput('confirm', 'Tape RESET pour confirmer', { placeholder: 'RESET', max: 10 }))
      );
    }
    if (action === 'annonce') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_annonce')
          .setTitle('📣 Annonce récompense')
          .addComponents(
            modalInput('amount', `Nombre de ${COIN_PLAIN}`, { placeholder: 'ex : 100' }),
            modalInput('reward', 'Récompense (texte)', { placeholder: 'ex : un nitro d’1 mois', max: 100 })
          )
      );
    }
    if (action === 'alltimechan') return createAllTimeChannel(i);
    if (action === 'notifchan') {
      const current = guildChannels.get(`${i.guild.id}:notifs`);
      const row = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('admin_notifpick')
          .setPlaceholder('Choisis le salon des notifications')
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText)
      );
      return i.reply({
        content:
          `🔔 Choisis le salon où envoyer les notifs admin (offrir all, reset, giveaway, boosts, annonces...).\n` +
          (current ? `Salon actuel : <#${current}>` : `Actuellement : salon **casino** (par défaut).`),
        components: [row],
        flags: EPH,
      });
    }
    if (ADMIN_TITLES[action]) {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`admin_pick_${action}`).setPlaceholder('Choisis un membre').setMinValues(1).setMaxValues(1)
      );
      return i.reply({ content: ADMIN_TITLES[action], components: [row], flags: EPH });
    }
    if (action === 'all') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_all')
          .setTitle('🎁 Offrir à tous')
          .addComponents(modalInput('amount', 'Montant offert à chaque joueur', { placeholder: 'ex : 10' }))
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
          modalInput('amount', `Coefficient (${MULT_MIN} à ${MULT_MAX}, 1 = normal)`, {
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
          .addComponents(modalInput('minutes', 'Durée en minutes', { placeholder: 'ex : 15', value: '15', max: 6 }))
      );
    }
    if (kind === 'claim' || kind === 'giveaway') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId(`modal_admin_event_${kind}`)
          .setTitle(kind === 'giveaway' ? '🎉 Giveaway' : '📢 Claim multi-gagnants')
          .addComponents(
            modalInput('amount', 'Montant par gagnant', { placeholder: 'ex : 50' }),
            modalInput('winners', 'Nombre de gagnants', { placeholder: 'ex : 3', value: '1', max: 3 }),
            modalInput('minutes', kind === 'giveaway' ? 'Durée avant tirage (min)' : 'Durée max (0 = illimité)', {
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
        `✅ Salon des notifications défini : <#${channelId}>\n` +
        `Offrir all, reset, giveaway, boosts, annonces, multiplicateurs y seront postés.` +
        (saved ? '' : DB_WARN),
      components: [],
    });
  }

  if (i.isUserSelectMenu() && id.startsWith('admin_pick_')) {
    const action = id.slice('admin_pick_'.length);
    const userId = i.values[0];
    if (i.users?.get(userId)?.bot) return i.update({ content: '❌ Choisis un vrai membre, pas un bot.', components: [] });
    if (action === 'view') {
      const bal = await getBalance(userId);
      return i.update({ content: `💰 Solde de <@${userId}> : **${fmt(bal)}**`, components: [] });
    }
    const titles = { add: '➕ Ajouter', remove: '➖ Retirer', set: '🎯 Définir le solde' };
    if (!titles[action]) return;
    return i.showModal(
      new ModalBuilder()
        .setCustomId(`modal_admin_${action}_${userId}`)
        .setTitle(titles[action])
        .addComponents(modalInput('amount', action === 'set' ? 'Nouveau solde' : 'Montant', { placeholder: 'ex : 10' }))
    );
  }

  if (i.isModalSubmit()) {
    if (id === 'modal_admin_reset') {
      const confirm = i.fields.getTextInputValue('confirm')?.trim().toUpperCase();
      if (confirm !== 'RESET') return respondText(i, 'Annulé : tu dois taper **RESET** pour confirmer.');
      try {
        const { data, error } = await supabase
          .from('players')
          .update({ balance: 0, updated_at: new Date().toISOString() })
          .neq('user_id', '__impossible__')
          .select('user_id');
        if (error) throw error;
        const count = data?.length ?? 0;
        const ch = await getAnnounceChannel(i.guild.id);
        ch?.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('💥 Reset des soldes (classement actuel)')
              .setColor(COLORS.red)
              .setDescription(`👤 Par <@${i.user.id}>\nTous les soldes ont été remis à **0**.`)
              .setTimestamp(),
          ],
        }).catch(() => {});
        return i.reply({ content: `✅ Soldes reset : **${count}** joueur(s) à 0.`, flags: EPH });
      } catch (e) {
        console.error('[reset]', e?.message || e);
        return respondText(i, `Erreur reset : ${explainError(e)}`);
      }
    }

    if (id === 'modal_admin_resetpeaks') {
      const confirm = i.fields.getTextInputValue('confirm')?.trim().toUpperCase();
      if (confirm !== 'RESET') return respondText(i, 'Annulé : tu dois taper **RESET** pour confirmer.');
      peaks.clear();
      savePeaksLocal();
      try {
        await supabase.from('player_peaks').update({ peak: 0 }).neq('user_id', '__impossible__');
      } catch (e) {
        console.error('[resetpeaks]', e?.message || e);
      }
      const ch = await getAnnounceChannel(i.guild.id);
      ch?.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('👑 Reset classement all-time')
            .setColor(COLORS.red)
            .setDescription(`👤 Par <@${i.user.id}>\nTous les records de solde max ont été effacés.`)
            .setTimestamp(),
        ],
      }).catch(() => {});
      return i.reply({ content: '✅ Classement all-time réinitialisé.', flags: EPH });
    }

    if (id === 'modal_admin_annonce') {
      const amount = parseAmount(i.fields.getTextInputValue('amount')?.trim());
      const reward = i.fields.getTextInputValue('reward')?.trim();
      if (!amount) return respondText(i, 'Montant invalide.');
      if (!reward) return respondText(i, 'Indique la récompense en texte.');
      const ch = await getAnnounceChannel(i.guild.id);
      if (!ch) return respondText(i, 'Aucun salon de notifs/casino : fais `!setup` ou **Salon notifs**.');
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('📣 Récompense disponible')
            .setColor(COLORS.gold)
            .setDescription(
              `👤 Annonce de <@${i.user.id}>\n\n` +
                `**${fmt(amount)}**  ≈  **${reward}**\n\n` +
                `Contacte le propriétaire pour échanger tes ${COIN} contre cette récompense.`
            )
            .setTimestamp(),
        ],
      });
      return i.reply({ content: `✅ Annonce postée : **${fmt(amount)}** = **${reward}**`, flags: EPH });
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
      return respondText(i, 'Formulaire invalide (champ montant manquant).');
    }

    const evM = id.match(/^modal_admin_event_(claim|giveaway)$/);
    if (evM) {
      const type = evM[1];
      const amount = parseAmount(raw);
      if (!amount || amount > MAX_ADMIN_AMOUNT) {
        return respondText(i, `Montant invalide (entre 0.01 et ${num(MAX_ADMIN_AMOUNT)}).`);
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
        return respondText(i, `Montant invalide (entre 0.01 et ${num(MAX_ADMIN_AMOUNT)}).`);
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
      const ch = await getAnnounceChannel(i.guild.id);
      ch?.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🎁 Cadeau pour tous')
            .setColor(COLORS.green)
            .setDescription(`👤 Par <@${i.user.id}>\n💰 **${fmt(amount)}** offerts à **chaque** joueur (**${count}** comptes).`)
            .setTimestamp(),
        ],
      }).catch(() => {});
      return i.reply({ content: `✅ **${fmt(amount)}** offerts à **${count}** joueur(s).`, flags: EPH });
    }

    const mm = id.match(/^modal_admin_mult_([a-z]+)$/);
    if (mm) {
      const game = mm[1];
      if (!GAME_NAMES[game]) return;
      const value = parseAmount(raw);
      if (value === null || value < MULT_MIN || value > MULT_MAX) {
        return respondText(i, `Valeur invalide : entre ${fx(MULT_MIN)} et ${fx(MULT_MAX)} (ex : 1.5).`);
      }
      const { db } = await saveMultiplier(game, value, i.guild.id, i.user.id);
      const note =
        `✅ **${GAME_NAMES[game]}** : coefficient réglé sur **${fx(value)}** (annoncé dans le casino).` +
        (db ? '' : '\n⚠️ Sauvegardé uniquement en local : lance **schema_v3.sql** dans Supabase pour que ça survive à un redéploiement.');
      return respond(i, multAdminPayload(note));
    }

    const m = id.match(/^modal_admin_(add|remove|set)_(\d{15,25})$/);
    if (!m) return;
    const [, action, userId] = m;
    const amount = parseAmount(raw, null, action === 'set');
    if (amount === null || amount > MAX_ADMIN_AMOUNT) {
      return respondText(i, `Montant invalide (max ${num(MAX_ADMIN_AMOUNT)}).`);
    }

    let balance;
    if (action === 'add') balance = Number(await rpc('admin_adjust', { p_user_id: userId, p_amount: amount }));
    else if (action === 'remove') balance = Number(await rpc('admin_adjust', { p_user_id: userId, p_amount: -amount }));
    else {
      const current = await getBalance(userId);
      balance = Number(await rpc('admin_adjust', { p_user_id: userId, p_amount: round2(amount - current) }));
    }
    await touchPeak(userId, balance);
    const verb = { add: `➕ **${fmt(amount)}** ajoutés à`, remove: `➖ **${fmt(amount)}** retirés à`, set: '🎯 Solde défini pour' }[action];
    return i.reply({ content: `✅ ${verb} <@${userId}>. Nouveau solde : **${fmt(balance)}**`, flags: EPH });
  }
}

// ============================================================
//  balance / daily (commandes écrites)
// ============================================================
const dailyText = (res) =>
  res.claimed
    ? `🎁 Tu as reçu **${fmt(DAILY_AMOUNT)}** ! Nouveau solde : **${fmt(res.balance)}**`
    : `⏰ Tu as déjà récupéré ta récompense aujourd’hui. Reviens après minuit (heure de Paris) !\nSolde : **${fmt(res.balance)}**`;

async function cmdBalance(msg, args) {
  const targetId = parseUserId(args[0]) || msg.author.id;
  const bal = await getBalance(targetId);
  if (targetId === msg.author.id) return msg.reply(`💰 Ton solde : **${fmt(bal)}**`);
  return msg.reply(`💰 Solde de <@${targetId}> : **${fmt(bal)}**`);
}

async function cmdDaily(msg) {
  const res = await rpc('claim_daily', { p_user_id: msg.author.id, p_amount: DAILY_AMOUNT });
  if (res?.balance != null) await touchPeak(msg.author.id, res.balance);
  return msg.reply(dailyText(res));
}

// ============================================================
//  COMMANDES DU PROPRIÉTAIRE
// ============================================================
async function cmdAdjust(msg, args, sign) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const name = sign > 0 ? 'add' : 'remove';
  const targetId = parseUserId(args[0]);
  const amount = parseAmount(args[1]);
  if (!targetId || !amount) return msg.reply(`Usage : \`${PREFIX}${name} @membre <montant>\``);
  if (amount > MAX_ADMIN_AMOUNT) return msg.reply(`Montant trop grand (max ${num(MAX_ADMIN_AMOUNT)}).`);

  const balance = Number(await rpc('admin_adjust', { p_user_id: targetId, p_amount: sign * amount }));
  await touchPeak(targetId, balance);
  return msg.reply(
    sign > 0
      ? `✅ **${fmt(amount)}** ajoutés à <@${targetId}>. Nouveau solde : **${fmt(balance)}**`
      : `✅ **${fmt(amount)}** retirés à <@${targetId}>. Nouveau solde : **${fmt(balance)}**`
  );
}

// ---------- Salons enregistrés ----------
const casinoChannels = new Map();
const guildChannels = new Map();

async function loadChannels() {
  const a = await supabase.from('casino_channels').select('guild_id, channel_id');
  if (a.error) console.error('[salons] casino_channels :', a.error.message);
  else for (const r of a.data) casinoChannels.set(r.guild_id, r.channel_id);

  const b = await supabase.from('guild_channels').select('guild_id, kind, channel_id');
  if (b.error) console.error('[salons] guild_channels (as-tu lancé schema_v2.sql ?) :', b.error.message);
  else for (const r of b.data) guildChannels.set(`${r.guild_id}:${r.kind}`, r.channel_id);
}

const CHANNEL_NAMES = {
  wins: 'wins',
  admin: 'casino-admin',
  invites: 'invites-notif',
  alltime: 'alltime',
  notifs: 'casino-notifs',
};
const alltimeBoardMessages = new Map();

async function getAnnounceChannel(guildId) {
  const notifId = guildChannels.get(`${guildId}:notifs`);
  if (notifId) {
    const ch = await client.channels.fetch(notifId).catch(() => null);
    if (ch) return ch;
  }
  const casinoId = casinoChannels.get(guildId);
  if (casinoId) return client.channels.fetch(casinoId).catch(() => null);
  return null;
}

async function createAllTimeChannel(i) {
  const guild = i.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;
  const existing = await getSavedChannel(guild, 'alltime');
  if (existing) {
    const embed = await buildAllTimeLeaderboardEmbed();
    const msg = await existing.send({ embeds: [embed] });
    alltimeBoardMessages.set(guild.id, { channelId: existing.id, messageId: msg.id });
    return i.reply({ content: `✅ Salon all-time déjà présent : <#${existing.id}> (classement reposté).`, flags: EPH });
  }
  if (!me.permissions.has(P.ManageChannels)) return i.reply({ content: NEED_MANAGE_CHANNELS, flags: EPH });
  const channel = await guild.channels.create({
    name: 'alltime',
    type: ChannelType.GuildText,
    topic: 'Classement all-time : solde max historique 👑',
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
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages]),
      },
    ],
  });
  const embed = await buildAllTimeLeaderboardEmbed();
  const msg = await channel.send({ embeds: [embed] });
  await msg.pin().catch(() => {});
  alltimeBoardMessages.set(guild.id, { channelId: channel.id, messageId: msg.id });
  const saved = await saveChannel(guild.id, 'alltime', channel.id);
  return i.reply({ content: `✅ Salon <#${channel.id}> créé avec le classement all-time.${saved ? '' : DB_WARN}`, flags: EPH });
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
    console.error(`[salons] impossible d'enregistrer "${kind}" dans guild_channels (lance schema_v3.sql) :`, e?.message || e);
    return false;
  }
}

const DB_WARN = '\n⚠️ Je n’ai pas pu l’enregistrer dans la base (table `guild_channels` manquante) : lance **schema_v3.sql** dans Supabase.';

function explainError(e) {
  const msg = String(e?.message || e || '');
  if (e?.code === 50013 || /Missing Permissions/i.test(msg)) {
    return 'Il me manque une permission Discord (**Gérer les salons**, **Voir le salon**, **Envoyer des messages**, **Intégrer des liens**).';
  }
  if (e?.code === 50001 || /Missing Access/i.test(msg)) return 'Je n’ai pas accès à ce salon/serveur (**Missing Access**).';
  if (/relation|does not exist|schema cache|PGRST|42P01|Could not find the table/i.test(msg)) {
    return 'Une table Supabase est manquante : lance **schema_v3.sql** dans l’éditeur SQL de Supabase.';
  }
  return `Détail technique : \`${msg.slice(0, 180)}\``;
}

function botCan(guild, wanted) {
  const me = guild.members.me;
  return wanted.filter((p) => me.permissions.has(p));
}

const NEED_MANAGE_CHANNELS =
  '⚠️ Il me faut la permission **Gérer les salons** pour créer le salon (Paramètres du serveur → Rôles → rôle du bot).';

// ---------- !setup : salon casino ----------
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
      return msg.reply(`✅ Le salon <#${existingId}> existe déjà : j’y ai posté un nouveau panneau de jeu (épinglé).`);
    }
    casinoChannels.delete(guild.id);
  }

  if (!me.permissions.has(P.ManageChannels)) return msg.reply(NEED_MANAGE_CHANNELS);
  const botAllow = botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages]);

  const channel = await guild.channels.create({
    name: 'casino',
    type: ChannelType.GuildText,
    topic: 'Casino 🪙 : joue avec les boutons du panneau épinglé',
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
    : '\n⚠️ Il me manque **Gérer les messages** : je ne pourrai pas épingler le panneau.';
  return msg.reply(
    `✅ Salon <#${channel.id}> créé avec le panneau de boutons (épinglé). Chacun joue en cliquant, et ses parties ne sont visibles que par lui.${warn}`
  );
}

// ---------- !wins : salon des victoires ----------
async function cmdWins(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const guild = msg.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;

  const existing = await getSavedChannel(guild, 'wins');
  if (existing) return msg.reply(`Le salon des victoires existe déjà : <#${existing.id}>`);
  if (!me.permissions.has(P.ManageChannels)) return msg.reply(NEED_MANAGE_CHANNELS);

  const channel = await guild.channels.create({
    name: 'wins',
    type: ChannelType.GuildText,
    topic: 'Les victoires de tout le monde 🎉',
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
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.MentionEveryone]),
      },
    ],
  });
  const saved = await saveChannel(guild.id, 'wins', channel.id);
  return msg.reply(
    `✅ Salon <#${channel.id}> créé : chaque victoire (jeu, mise, multiplicateur, gain) s’y affichera automatiquement.${saved ? '' : DB_WARN}`
  );
}

// ---------- !invites-notif ----------
async function cmdInvitesNotif(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const guild = msg.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;

  const existing = await getSavedChannel(guild, 'invites');
  if (existing) return msg.reply(`Le salon des notifications d’invitations existe déjà : <#${existing.id}>`);
  if (!me.permissions.has(P.ManageChannels)) return msg.reply(NEED_MANAGE_CHANNELS);

  const channel = await guild.channels.create({
    name: 'invites-notif',
    type: ChannelType.GuildText,
    topic: 'Notifications quand quelqu’un invite un nouveau membre 📨',
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
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]),
      },
    ],
  });
  const saved = await saveChannel(guild.id, 'invites', channel.id);
  return msg.reply(
    `✅ Salon <#${channel.id}> créé : chaque invitation réussie (nouveau membre + récompense) s’y affichera automatiquement.${saved ? '' : DB_WARN}`
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
    return msg.reply(`✅ Le salon admin existe déjà : j’y ai reposté le panneau dans <#${existing.id}>.`);
  }
  if (!me.permissions.has(P.ManageChannels)) return msg.reply(NEED_MANAGE_CHANNELS);

  const channel = await guild.channels.create({
    name: 'casino-admin',
    type: ChannelType.GuildText,
    topic: 'Panneau admin du casino (visible uniquement par le propriétaire)',
    permissionOverwrites: [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
      { id: guild.ownerId, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
      {
        id: me.id,
        type: OverwriteType.Member,
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]),
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
  return msg.reply(`✅ Salon privé <#${channel.id}> créé avec le panneau admin (visible uniquement par toi).${saved ? '' : DB_WARN}`);
}

// ============================================================
//  CLASSEMENT (auto-actualisé toutes les minutes)
// ============================================================
async function buildLeaderboardEmbed(lang = 'fr') {
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
    const name = u ? escapeMarkdown(u.globalName || u.username) : lang === 'en' ? 'Unknown user' : 'Utilisateur inconnu';
    lines.push(`${medals[i] ?? `**${i + 1}.**`} ${name} : **${fmt(data[i].balance)}**`);
  }

  return new EmbedBuilder()
    .setTitle(lang === 'en' ? '🏆 Richest players' : '🏆 Classement des plus riches')
    .setColor(COLORS.gold)
    .setDescription(lines.length ? lines.join('\n') : lang === 'en' ? 'No balances yet.' : `Personne n’a encore de ${COIN}.`)
    .setFooter({ text: lang === 'en' ? 'Auto-updated every minute' : 'Mis à jour automatiquement toutes les minutes' })
    .setTimestamp();
}

async function buildAllTimeLeaderboardEmbed(lang = 'fr') {
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
    const name = u ? escapeMarkdown(u.globalName || u.username) : lang === 'en' ? 'Unknown user' : 'Utilisateur inconnu';
    lines.push(`${medals[i] ?? `**${i + 1}.**`} ${name} : **${fmt(peak)}**`);
  }

  return new EmbedBuilder()
    .setTitle(lang === 'en' ? '👑 All-time leaderboard (peak balance)' : '👑 Classement all-time (solde max)')
    .setColor(COLORS.violet)
    .setDescription(
      lines.length ? lines.join('\n') : lang === 'en' ? 'No records yet. Peaks update on every win.' : 'Aucun record encore. Les pics se mettent à jour à chaque gain.'
    )
    .setFooter({ text: lang === 'en' ? 'Record = highest balance ever reached' : 'Record = plus haut solde jamais atteint' })
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
      /* déjà supprimé */
    }
  }

  const sent = await msg.channel.send({ embeds: [await buildLeaderboardEmbed()] });
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
      const embed = await buildLeaderboardEmbed();
      for (const row of rows) {
        try {
          const ch = await client.channels.fetch(row.channel_id);
          const m = await ch.messages.fetch(row.message_id);
          await m.edit({ embeds: [embed] });
        } catch (e) {
          if ([10008, 10003, 50001, 50013].includes(e?.code)) {
            await supabase.from('leaderboard_messages').delete().eq('guild_id', row.guild_id);
          } else {
            console.error('[classement] edit', e?.message || e);
          }
        }
      }
    }

    if (alltimeBoardMessages.size > 0) {
      const allEmbed = await buildAllTimeLeaderboardEmbed();
      for (const [gid, info] of alltimeBoardMessages) {
        try {
          const ch = await client.channels.fetch(info.channelId);
          const m = await ch.messages.fetch(info.messageId);
          await m.edit({ embeds: [allEmbed] });
        } catch (e) {
          if ([10008, 10003, 50001, 50013].includes(e?.code)) alltimeBoardMessages.delete(gid);
          else console.error('[alltime] edit', e?.message || e);
        }
      }
    }
  } catch (e) {
    console.error('[classement] update', e?.message || e);
  } finally {
    updatingLeaderboards = false;
  }
}

// ============================================================
//  MESSAGES (commandes écrites)
// ============================================================
const PLAYER_CMDS = new Set(['invites', 'invitations', 'balance', 'bal', 'solde', 'daily', 'aide', 'help', 'casino', 'jeux']);
const OWNER_CMDS = new Set([
  'add', 'ajouter', 'remove', 'retirer', 'classement', 'setup', 'salon',
  'wins', 'win', 'admin', 'invites-notif', 'invitesnotif', 'notifinvites',
]);

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  const [cmdRaw] = msg.content.startsWith(PREFIX) ? msg.content.slice(PREFIX.length).trim().split(/\s+/) : [''];
  const cmd = (cmdRaw || '').toLowerCase();
  const args = msg.content.startsWith(PREFIX) ? msg.content.slice(PREFIX.length).trim().split(/\s+/).slice(1) : [];
  const isPlayerCmd = PLAYER_CMDS.has(cmd);
  const isOwnerCmd = OWNER_CMDS.has(cmd);

  if (!isPlayerCmd && !isOwnerCmd) return;
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY).catch(() => {});

  try {
    switch (cmd) {
      case 'balance':
      case 'bal':
      case 'solde':
        return await cmdBalance(msg, args);
      case 'daily':
        return await cmdDaily(msg);
      case 'invites':
      case 'invitations':
        return await cmdInvites(msg, args);
      case 'aide':
      case 'help':
        return await msg.reply({ embeds: [buildHelpEmbed()] });
      case 'casino':
      case 'jeux':
        return await msg.channel.send(buildPanelPayload());
      case 'add':
      case 'ajouter':
        return await cmdAdjust(msg, args, +1);
      case 'remove':
      case 'retirer':
        return await cmdAdjust(msg, args, -1);
      case 'classement':
        return await cmdLeaderboard(msg);
      case 'setup':
      case 'salon':
        return await cmdSetup(msg);
      case 'wins':
      case 'win':
        return await cmdWins(msg);
      case 'invites-notif':
      case 'invitesnotif':
      case 'notifinvites':
        return await cmdInvitesNotif(msg);
      case 'admin':
        return await cmdAdmin(msg);
      default:
        return;
    }
  } catch (e) {
    console.error(`[${cmd}]`, e);
    const hint = isCrown(msg) ? `\n${explainError(e)}` : '';
    msg.reply(`⚠️ Une erreur est survenue, réessaie dans un instant.${hint}`).catch(() => {});
  }
});

// ============================================================
//  BOUTONS, MENUS ET POP-UPS
// ============================================================
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (!i.customId) return;
    if (
      !i.guild &&
      !userHomeGuild.has(i.user.id) &&
      !['panel_', 'modal_', 'ig_', 'rl_', 'bj_', 'mines_', 'replay|'].some((p) => i.customId.startsWith(p))
    ) {
      return;
    }
    const id = i.customId;

    if (id.startsWith('admin_') || id.startsWith('modal_admin_')) return await handleAdmin(i);

    if (id.startsWith('event_claim_') && i.isButton()) return await handleEventClaim(i);
    if (id.startsWith('event_join_') && i.isButton()) return await handleEventJoin(i);

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
        return i.update({ content: `❌ Tu ne peux pas t’envoyer de ${COIN} à toi-même.`, components: [] });
      }
      if (i.users?.get(userId)?.bot) {
        return i.update({ content: `❌ Tu ne peux pas envoyer de ${COIN} à un bot.`, components: [] });
      }
      return i.showModal(
        new ModalBuilder()
          .setCustomId(`modal_send_${userId}`)
          .setTitle(`💸 Envoyer des ${COIN_PLAIN}`)
          .addComponents(modalInput('amount', 'Montant à envoyer (ou "all")', { placeholder: 'ex : 5' }))
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
    if (i.isRepliable?.() && !i.replied && !i.deferred) {
      const hint = i.guild && i.user.id === i.guild.ownerId ? `\n${explainError(e)}` : '';
      i.reply({ content: `⚠️ Une erreur est survenue, réessaie dans un instant.${hint}`, flags: EPH }).catch(() => {});
    }
  }
});

// ============================================================
//  INVITATIONS : +1 coin pour celui qui invite quelqu'un qui rejoint
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
    console.error(`[invitations] ${guild.name} : impossible de lire les invitations (permission "Gérer le serveur" requise) :`, e?.message || e);
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
          name: inviter ? `${inviter.globalName || inviter.username} a invité quelqu’un !` : 'Nouvelle invitation',
          iconURL: inviter?.displayAvatarURL(),
        })
        .setDescription(`📨 <@${inviterId}> a invité <@${member.id}>\n🎁 Récompense : **${fmt(INVITE_REWARD)}**`)
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
      ch.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (e) {
    console.error('[invitations] arrivée', e?.message || e);
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
  const members = invitedIds.length ? invitedIds.map((id) => `<@${id}>`).join('\n') : 'Aucun membre invité enregistré pour le moment.';
  const total = count ?? 0;

  return new EmbedBuilder()
    .setTitle('📨 Tes invitations')
    .setColor(COLORS.blue)
    .setDescription(`Tu as invité **${total}** membre(s) et reçu **${fmt(total * INVITE_REWARD)}**.`)
    .addFields({ name: `Membres invités${total > 20 ? ' (20 affichés)' : ''}`, value: members.slice(0, 1024) });
}

async function cmdInvites(msg, args) {
  const targetId = parseUserId(args[0]) || msg.author.id;
  return msg.reply({ embeds: [await buildInvitesEmbed(msg.guild, targetId)] });
}

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  const gid = channel.guild.id;
  if (casinoChannels.get(gid) === channel.id) {
    casinoChannels.delete(gid);
    await supabase.from('casino_channels').delete().eq('guild_id', gid);
  }
  for (const kind of ['wins', 'admin', 'invites', 'alltime', 'notifs']) {
    if (guildChannels.get(`${gid}:${kind}`) === channel.id) {
      guildChannels.delete(`${gid}:${kind}`);
      alltimeBoardMessages.delete(gid);
      await supabase.from('guild_channels').delete().eq('guild_id', gid).eq('kind', kind);
    }
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Connecté en tant que ${c.user.tag}`);
  resolveCoinEmoji();
  loadMultipliers();
  loadPeaks();
  for (const g of c.guilds.cache.values()) cacheInvites(g);
  loadChannels().then(restoreChannelsByName);
  setInterval(updateLeaderboards, LEADERBOARD_REFRESH_MS);
  updateLeaderboards();
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
          '⚠️ "Server Members Intent" n’est pas activé : le bot démarre SANS le système d’invitations.\n' +
            '   Pour l’activer : Developer Portal → ton application → Bot → Privileged Gateway Intents → Server Members Intent → Save, puis redémarre.'
        );
      }
      if (!(flags & MESSAGE_CONTENT)) {
        console.warn('⚠️ "Message Content Intent" n’est pas activé : les commandes écrites (!setup, !admin...) ne marcheront pas.');
      }
    }
  } catch (e) {
    console.warn('[démarrage] vérification des intents impossible :', e?.message || e);
  }
  try {
    await client.login(DISCORD_TOKEN);
  } catch (e) {
    console.error('[connexion]', e?.message || e);
    process.exit(1);
  }
}
start();
