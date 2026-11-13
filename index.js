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

// ---- MONNAIE (modifiable depuis Railway > Variables) ----
//  COIN_EMOJI : ce qui s'affiche partout à côté des montants (défaut : 🪙)
//  COIN_TEXT  : version texte pour les endroits sans emoji (image canvas, pop-ups)
//               si absente, on réutilise COIN_EMOJI
const COIN = String(process.env.COIN_EMOJI || '🪙').trim() || '🪙';
const COIN_PLAIN = String(process.env.COIN_TEXT || COIN).trim() || COIN;
const plain = (s) => String(s).split(COIN).join(COIN_PLAIN);
console.log(`[coin] ${COIN} (texte : ${COIN_PLAIN})`);

const DAILY_AMOUNT = 4;
const INVITE_REWARD = 1;
const LEADERBOARD_REFRESH_MS = 60_000;
const IDLE_MS = 90_000;
const MAX_ADMIN_AMOUNT = 100_000_000;
const EPH = MessageFlags.Ephemeral;

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
const FAV_FILE = path.join(__dirname, 'data', 'favorites.json');
const SKIP_FILE = path.join(__dirname, 'data', 'skipanim.json');
const userLang = new Map(); // userId -> 'fr' | 'en'
const winPingOff = new Set(); // userIds qui ne veulent plus être ping dans le salon wins
const userFavs = new Map(); // userId -> Set of game keys
const skipAnimUsers = new Set(); // userIds who skip animations

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
  try {
    const raw = JSON.parse(fs.readFileSync(FAV_FILE, 'utf8'));
    for (const [id, arr] of Object.entries(raw)) {
      if (Array.isArray(arr)) userFavs.set(id, new Set(arr.map(String)));
    }
  } catch {
    /* premier lancement */
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SKIP_FILE, 'utf8'));
    if (Array.isArray(raw)) for (const id of raw) skipAnimUsers.add(String(id));
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
    yourBalance: 'Ton solde',
    dailyOk: 'Tu as reçu',
    dailyAlready: 'Tu as déjà pris ton daily aujourd’hui. Reviens après minuit (Paris).',
    newBalance: 'Nouveau solde',
    lobbyTitle: '✦ Choisis ta table',
    lobbyDesc:
      'Sélectionne un jeu dans le **menu ci-dessous**.\nUne fenêtre s’ouvre pour ta mise (ton solde est affiché).',
    lobbyPlaceholder: '🎮 Choisir un jeu...',
    lobbyFooter: 'Menu privé · visible uniquement par toi',
    sendPick: `💸 À qui veux-tu envoyer des ${COIN} depuis ton solde ?`,
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
    sendPick: `💸 Who do you want to send ${COIN} to?`,
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
  if (!frames || !frames.length) return;
  // Skip animations if user prefers
  if (i.user && wantsSkipAnim(i.user.id)) {
    const f = typeof frames[frames.length - 1] === 'string' ? { art: frames[frames.length - 1] } : frames[frames.length - 1];
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(ANIM_PALETTE[ANIM_PALETTE.length - 1])
      .setDescription(`${head}${f.art}${f.caption ? `\n**${f.caption}**` : ''}`)
      .setFooter({ text: 'Animations désactivées' });
    await i.editReply({ embeds: [embed], components: [] }).catch(() => {});
    return;
  }
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

/** Boutons de fin de partie : Rejouer + retour au panneau */
function endGameRow(replayCustomId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(replayCustomId).setLabel('Rejouer').setEmoji('🔁').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_home').setLabel('Changer de mode').setEmoji('🏠').setStyle(ButtonStyle.Primary)
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
  limbo: '📈 Limbo',
  higher: '⬆️ Higher / Lower',
  rps: '✊ Pierre-Papier-Ciseaux',
  colorpick: '🎨 Couleur',
  ladder: '🪜 Échelle',
  keno: '🎱 Keno',
  war: '⚔️ Guerre',
  hilo: '🃏 Hi-Lo',
  bingo: '🅱️ Bingo',
  jackpot: '💎 Jackpot',
  // 30 nouveaux jeux
  dicewar: '🎲 Guerre de dés',
  coinladder: '🪙 Échelle de pièces',
  cardmatch: '🃏 Match de cartes',
  numguess: '🔢 Devine le nombre',
  bombdefuse: '💣 Désamorçage',
  treasure: '🗺️ Carte au trésor',
  highcard: '🃏 Carte haute',
  lowcard: '🃏 Carte basse',
  pairmatch: '🃏 Paire',
  freefall: '🪂 Chute libre',
  balloon: '🎈 Ballon',
  target: '🎯 Cible',
  sequence: '🔢 Séquence',
  animalrace: '🐾 Course d\'animaux',
  fruitmatch: '🍎 Fruits',
  gemhunt: '💎 Chasse aux gemmes',
  stardrop: '⭐ Étoile filante',
  moonshot: '🌙 Tir lunaire',
  volcano: '🌋 Volcan',
  lightning: '⚡ Éclair',
  pokerhand: '🃏 Poker express',
  redblack: '🔴 Noir ou Rouge',
  oddseven: '🔢 Pair ou Impair+',
  multiplier: '✖️ Multiplicateur',
  memory: '🧠 Mémoire',
  colorswipe: '🌈 Arc-en-ciel',
  rocket2: '🚀 Fusée 2',
  diceexact2: '🎲 Double dé',
  chest2: '📦 Triple coffre',
  spincolor: '🎨 Roue couleur',
  poker: '🃏 Poker',
  coin2: '🪙 Double pile',
  dice7: '🎲 Dés 7+',
  lucky7: '7️⃣ Lucky 7',
  evenodd2: '🔢 Pair/Impair 2',
  redblack2: '🔴 Rouge Noir 2',
  highlow2: '⬆️ Haut Bas',
  triple: '🎯 Triple chance',
  quad: '4️⃣ Quad',
  penta: '5️⃣ Penta',
  coin3: '🪙 Triple pile',
  snake: '🐍 Snake eyes',
  boxcars: '🎲 Boxcars',
  anydouble: '🎲 Double quelconque',
  acehigh: '🃏 As haut',
  facecard: '🃏 Figure',
  suitspade: '♠️ Pique',
  suithr: '♥️ Coeur',
  suitdi: '♦️ Carreau',
  suitcl: '♣️ Trèfle',
  blast: '💥 Blast',
  freeze: '❄️ Freeze',
  shadow: '🌑 Ombre',
  pulse: '💓 Pulse',
  orbit: '🪐 Orbite',
  spark: '✨ Étincelle',
  wave: '🌊 Vague',
  mirror: '🪞 Miroir',
  portal: '🌀 Portail',
  rune: '🔮 Rune',
  totem: '🗿 Totem',
  cactus: '🌵 Cactus',
  pearl: '🦪 Perle',
  compass: '🧭 Boussole',
  anchor: '⚓ Ancre',
  torch: '🔥 Torche',
  keylock: '🔑 Clé',
  hourglass: '⏳ Sablier',
  balloon2: '🎈 Ballon 2',
  dicehi: '🎲 Dé haut',
  dicelo: '🎲 Dé bas',
  coinrush: '🪙 Ruée pièces',
  starfall: '🌟 Pluie d\'étoiles',
  meteor: '☄️ Météore',
  rainbow: '🌈 Arc',
  clover: '🍀 Trèfle chance',
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
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        const who = actorId ? `👤 Par <@${actorId}>\n` : '';
        await dmGuildEveryone(guild, {
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
      client.guilds
        .fetch(guildId)
        .then((guild) =>
          dmGuildEveryone(guild, {
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
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('panel_home')
            .setLabel('Changer de mode')
            .setEmoji('🏠')
            .setStyle(ButtonStyle.Primary)
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
        new ButtonBuilder().setCustomId(`replay|bj|${g.baseBet}`).setLabel('Rejouer').setEmoji('🔁').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('panel_home').setLabel('Changer de mode').setEmoji('🏠').setStyle(ButtonStyle.Primary)
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
      new ButtonBuilder().setCustomId(`replay|rl|${bet}|${choice.key}`).setLabel('Rejouer').setEmoji('🔁').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('panel_home').setLabel('Changer de mode').setEmoji('🏠').setStyle(ButtonStyle.Primary)
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

  // ---------- 10 nouveaux jeux ----------
  limbo: {
    title: '📈 Limbo',
    choices: ['x15', 'x2', 'x3', 'x5', 'x10'],
    spinText: 'Le multiplicateur monte...',
    info: (c) => `cibles x1.5 à x10`,
    picker: (c) =>
      choicePicker(
        'limbo',
        '📈 Limbo : choisis ta cible',
        'Le multiplicateur monte de façon aléatoire. S’il dépasse ta cible, tu gagnes x cible.',
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
        pick: `Cible x${target}`,
        headline: `📈 Pic atteint : **${fx(Math.min(peak, 1000))}**${peak >= target ? ' · cible validée !' : ' · trop bas'}`,
        detail: `cible ${target} / pic ${Math.min(peak, 1000)}`,
        peak,
        target,
      };
    },
  },

  higher: {
    title: '⬆️ Higher / Lower',
    choices: ['higher', 'lower'],
    spinText: 'La carte se retourne...',
    info: (c) => `victoire ${fx(1.9 * c)}`,
    picker: (c) =>
      choicePicker(
        'higher',
        '⬆️ Higher / Lower',
        `Une carte de référence est tirée. Devine si la suivante est **plus haute** ou **plus basse** (As = 1). Victoire : **${fx(1.9 * c)}**`,
        [
          ['higher', 'Plus haute', '⬆️'],
          ['lower', 'Plus basse', '⬇️'],
        ]
      ),
    resolve(choice) {
      const a = randomInt(1, 14);
      const b = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      const won = choice === 'higher' ? b > a : b < a;
      return {
        base: won ? 1.9 : 0,
        pick: choice === 'higher' ? 'Plus haute' : 'Plus basse',
        headline: `Référence **${ranks[a]}** → suivante **${ranks[b]}**`,
        detail: `${ranks[a]} -> ${ranks[b]}`,
        a,
        b,
      };
    },
  },

  rps: {
    title: '✊ Pierre-Papier-Ciseaux',
    choices: ['rock', 'paper', 'scissors'],
    spinText: '1... 2... 3...',
    info: (c) => `victoire ${fx(2.8 * c)}`,
    picker: (c) =>
      choicePicker(
        'rps',
        '✊ Pierre · Papier · Ciseaux',
        `Bat le bot. Victoire : **${fx(2.8 * c)}** · Égalité = mise remboursée.`,
        [
          ['rock', 'Pierre', '✊'],
          ['paper', 'Papier', '✋'],
          ['scissors', 'Ciseaux', '✌️'],
        ]
      ),
    resolve(choice) {
      const opts = ['rock', 'paper', 'scissors'];
      const bot = opts[randomInt(0, 3)];
      const names = { rock: 'Pierre ✊', paper: 'Papier ✋', scissors: 'Ciseaux ✌️' };
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
        headline: `Toi : **${names[choice]}** · Bot : **${names[bot]}**`,
        detail: `${choice} vs ${bot}`,
        bot,
      };
    },
  },

  colorpick: {
    title: '🎨 Couleur',
    choices: ['red', 'blue', 'green', 'yellow'],
    spinText: 'La couleur se révèle...',
    info: (c) => `victoire ${fx(3.6 * c)}`,
    picker: (c) =>
      choicePicker(
        'colorpick',
        '🎨 Devine la couleur',
        `4 couleurs possibles. Victoire : **${fx(3.6 * c)}** (1 chance sur 4).`,
        [
          ['red', 'Rouge', '🔴'],
          ['blue', 'Bleu', '🔵'],
          ['green', 'Vert', '🟢'],
          ['yellow', 'Jaune', '🟡'],
        ]
      ),
    resolve(choice) {
      const cols = ['red', 'blue', 'green', 'yellow'];
      const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡' };
      const names = { red: 'Rouge', blue: 'Bleu', green: 'Vert', yellow: 'Jaune' };
      const out = cols[randomInt(0, 4)];
      return {
        base: out === choice ? 3.6 : 0,
        pick: names[choice],
        headline: `Couleur tirée : **${em[out]} ${names[out]}**`,
        detail: `${choice} -> ${out}`,
        out,
      };
    },
  },

  ladder: {
    title: '🪜 Échelle',
    choices: ['s1', 's2', 's3', 's4', 's5'],
    spinText: 'Tu montes les échelons...',
    info: (c) => `x1.5 à x8`,
    picker: (c) =>
      choicePicker(
        'ladder',
        '🪜 Échelle : jusqu’où montes-tu ?',
        'Chaque échelon est plus risqué et plus rémunérateur. Tu gagnes si tu atteins ton niveau.',
        [
          ['s1', 'Palier 1 (x1.5)', '🪜'],
          ['s2', 'Palier 2 (x2.2)', '🪜'],
          ['s3', 'Palier 3 (x3.5)', '🪜'],
          ['s4', 'Palier 4 (x5)', '🪜'],
          ['s5', 'Palier 5 (x8)', '🪜'],
        ]
      ),
    resolve(choice) {
      const levels = [1.5, 2.2, 3.5, 5, 8];
      const want = Number(choice.slice(1));
      // probabilité de réussir jusqu'au palier n
      const probs = [0.7, 0.5, 0.35, 0.22, 0.12];
      const reached = randomInt(0, 1000) / 1000 < probs[want - 1] ? want : randomInt(0, want);
      return {
        base: reached >= want ? levels[want - 1] : 0,
        pick: `Palier ${want}`,
        headline: `Tu as atteint le **palier ${reached}**${reached >= want ? ' · objectif réussi !' : ' · trop tôt'}`,
        detail: `cible ${want} / atteint ${reached}`,
        reached,
        want,
      };
    },
  },

  keno: {
    title: '🎱 Keno',
    choices: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10'],
    spinText: 'Tirage du numéro...',
    info: (c) => `victoire ${fx(9.5 * c)}`,
    picker: (c) =>
      choicePicker(
        'keno',
        '🎱 Keno : choisis un numéro (1-10)',
        `1 numéro tiré sur 10. Victoire : **${fx(9.5 * c)}**.`,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [`n${n}`, String(n), '🎱'])
      ),
    resolve(choice) {
      const n = randomInt(1, 11);
      const want = Number(choice.slice(1));
      return {
        base: n === want ? 9.5 : 0,
        pick: `N° ${want}`,
        headline: `Numéro tiré : **${n}**`,
        detail: `${want} -> ${n}`,
        n,
        want,
      };
    },
  },

  war: {
    title: '⚔️ Guerre',
    choices: ['go'],
    spinText: 'Les cartes sont posées...',
    info: (c) => `victoire ${fx(1.95 * c)}`,
    picker: (c) =>
      choicePicker(
        'war',
        '⚔️ Guerre de cartes',
        `Toi vs le croupier : une carte chacun. La plus haute gagne (**${fx(1.95 * c)}**). Égalité = perdu.`,
        [['go', 'Jouer', '⚔️', ButtonStyle.Success]]
      ),
    resolve() {
      const me = randomInt(1, 14);
      const dealer = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      return {
        base: me > dealer ? 1.95 : 0,
        pick: 'Guerre',
        headline: `Toi **${ranks[me]}** · Croupier **${ranks[dealer]}**`,
        detail: `${ranks[me]} vs ${ranks[dealer]}`,
        me,
        dealer,
      };
    },
  },

  hilo: {
    title: '🃏 Hi-Lo',
    choices: ['go'],
    spinText: 'Suite de 3 cartes...',
    info: (c) => `3 hautes ou 3 basses ${fx(4 * c)}`,
    picker: (c) =>
      choicePicker(
        'hilo',
        '🃏 Hi-Lo',
        `3 cartes tirées. Si les 3 sont hautes (8+) ou les 3 basses (7-), tu gagnes **${fx(4 * c)}**.`,
        [['go', 'Tirer', '🃏', ButtonStyle.Success]]
      ),
    resolve() {
      const cards = [randomInt(1, 14), randomInt(1, 14), randomInt(1, 14)];
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      const high = cards.every((c) => c >= 8);
      const low = cards.every((c) => c <= 7);
      return {
        base: high || low ? 4 : 0,
        pick: 'Hi-Lo',
        headline: `Cartes : **${cards.map((c) => ranks[c]).join(' · ')}**${high ? ' · 3 HAUTES !' : low ? ' · 3 BASSES !' : ''}`,
        detail: cards.map((c) => ranks[c]).join('-'),
        cards,
      };
    },
  },

  bingo: {
    title: '🅱️ Bingo',
    choices: ['b1', 'b2', 'b3', 'b4', 'b5'],
    spinText: 'La bille sort...',
    info: (c) => `victoire ${fx(4.5 * c)}`,
    picker: (c) =>
      choicePicker(
        'bingo',
        '🅱️ Bingo : choisis ta case',
        `5 cases. Une bille sort. Victoire : **${fx(4.5 * c)}**.`,
        [1, 2, 3, 4, 5].map((n) => [`b${n}`, `Case ${n}`, '🅱️'])
      ),
    resolve(choice) {
      const n = randomInt(1, 6);
      const want = Number(choice.slice(1));
      return {
        base: n === want ? 4.5 : 0,
        pick: `Case ${want}`,
        headline: `Bille dans la **case ${n}**`,
        detail: `${want} -> ${n}`,
        n,
        want,
      };
    },
  },

  jackpot: {
    title: '💎 Jackpot',
    choices: ['go'],
    spinText: 'Les symboles tournent...',
    info: (c) => `jackpot ${fx(50 * c)} · 2 identiques ${fx(3 * c)}`,
    picker: (c) =>
      choicePicker(
        'jackpot',
        '💎 Jackpot',
        `3 symboles. 3 identiques = **${fx(50 * c)}**. 2 identiques = **${fx(3 * c)}**.`,
        [['go', 'Lancer', '💎', ButtonStyle.Success]]
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
    title: '🎲 Guerre de dés',
    choices: ['go'],
    spinText: 'Les dés s\'affrontent...',
    info: (c) => `victoire ${fx(1.95 * c)}`,
    picker: (c) => choicePicker('dicewar', '🎲 Guerre de dés', `Ton dé contre celui du croupier. Le plus haut gagne (**${fx(1.95 * c)}**). Égalité = perdu.`, [['go', 'Lancer', '🎲', ButtonStyle.Success]]),
    resolve() {
      const me = randomInt(1, 7), dealer = randomInt(1, 7);
      return { base: me > dealer ? 1.95 : 0, pick: 'Guerre', headline: code(sideBySide([dieLines(me), dieLines(dealer)], '   ')) + `Toi **${me}** · Croupier **${dealer}**`, detail: `${me} vs ${dealer}`, me, dealer };
    },
  },
  coinladder: {
    title: '🪙 Échelle de pièces',
    choices: ['s1', 's2', 's3', 's4'],
    spinText: 'La pièce tourne encore...',
    info: (c) => `x1.8 à x8`,
    picker: (c) => choicePicker('coinladder', '🪙 Échelle de pièces', 'Gagne plusieurs pile/face d\'affilée. Plus tu vises haut, plus c\'est risqué.', [['s1', '1 face (x1.8)', '🪙'], ['s2', '2 faces (x3)', '🪙'], ['s3', '3 faces (x5)', '🪙'], ['s4', '4 faces (x8)', '🪙']]),
    resolve(choice) {
      const need = Number(choice.slice(1));
      const mults = [0, 1.8, 3, 5, 8];
      let streak = 0;
      const flips = [];
      for (let k = 0; k < need; k++) {
        const ok = randomInt(0, 2) === 0;
        flips.push(ok ? 'P' : 'F');
        if (ok) streak++;
        else break;
      }
      return { base: streak >= need ? mults[need] : 0, pick: `${need} face(s)`, headline: `Résultats : **${flips.join(' · ')}** (${streak}/${need})`, detail: flips.join(''), streak, need };
    },
  },
  cardmatch: {
    title: '🃏 Match de cartes',
    choices: ['go'],
    spinText: 'Mélange des cartes...',
    info: (c) => `victoire ${fx(3.8 * c)}`,
    picker: (c) => choicePicker('cardmatch', '🃏 Match de cartes', `Une carte secrète est tirée parmi 4. Retrouve-la : **${fx(3.8 * c)}**.`, [['go', 'Révéler', '🃏', ButtonStyle.Success]]),
    resolve() {
      const cards = shuffle([{ r: 'A', s: '♠' }, { r: 'K', s: '♥' }, { r: 'Q', s: '♦' }, { r: 'J', s: '♣' }]);
      const secret = cards[0];
      const pick = cards[randomInt(0, 4)];
      return { base: pick.r === secret.r && pick.s === secret.s ? 3.8 : 0, pick: 'Match', headline: `Secrète : ${cardStr(secret)} · Tirée : ${cardStr(pick)}`, detail: `${secret.r}${secret.s}`, secret, pickCard: pick };
    },
  },
  numguess: {
    title: '🔢 Devine le nombre',
    choices: Array.from({ length: 10 }, (_, i) => `n${i + 1}`),
    spinText: 'Tirage entre 1 et 10...',
    info: (c) => `victoire ${fx(9.5 * c)}`,
    picker: (c) => choicePicker('numguess', '🔢 Devine le nombre (1-10)', `1 chance sur 10 · **${fx(9.5 * c)}**`, Array.from({ length: 10 }, (_, i) => [`n${i + 1}`, String(i + 1), '🔢'])),
    resolve(choice) {
      const n = randomInt(1, 11), want = Number(choice.slice(1));
      return { base: n === want ? 9.5 : 0, pick: `N° ${want}`, headline: `Nombre tiré : **${n}**`, detail: `${want}->${n}`, n, want };
    },
  },
  bombdefuse: {
    title: '💣 Désamorçage',
    choices: ['w1', 'w2', 'w3', 'w4'],
    spinText: 'Le compteur tourne...',
    info: (c) => `victoire ${fx(3.6 * c)}`,
    picker: (c) => choicePicker('bombdefuse', '💣 Désamorçage : coupe un fil', `4 fils, 1 seul désamorce. **${fx(3.6 * c)}** si tu trouves le bon.`, [['w1', 'Fil rouge', '🔴'], ['w2', 'Fil bleu', '🔵'], ['w3', 'Fil vert', '🟢'], ['w4', 'Fil jaune', '🟡']]),
    resolve(choice) {
      const good = randomInt(1, 5), want = Number(choice.slice(1));
      return { base: good === want ? 3.6 : 0, pick: `Fil ${want}`, headline: good === want ? '✅ Bombe désamorcée !' : `💥 Mauvais fil (c\'était le n°${good})`, detail: `${want}->${good}`, good, want };
    },
  },
  treasure: {
    title: '🗺️ Carte au trésor',
    choices: ['c1', 'c2', 'c3', 'c4', 'c5'],
    spinText: 'Tu creuses...',
    info: (c) => `victoire ${fx(4.5 * c)}`,
    picker: (c) => choicePicker('treasure', '🗺️ Carte au trésor', `5 cases, 1 trésor. **${fx(4.5 * c)}**`, [1, 2, 3, 4, 5].map((n) => [`c${n}`, `Case ${n}`, '🗺️'])),
    resolve(choice) {
      const win = randomInt(1, 6), want = Number(choice.slice(1));
      return { base: win === want ? 4.5 : 0, pick: `Case ${want}`, headline: `Trésor en case **${win}**`, detail: `${want}->${win}`, win, want };
    },
  },
  highcard: {
    title: '🃏 Carte haute',
    choices: ['go'],
    spinText: 'Tirage de la carte...',
    info: (c) => `≥ 8 → ${fx(1.9 * c)}`,
    picker: (c) => choicePicker('highcard', '🃏 Carte haute', `Carte ≥ 8 (8,9,10,J,Q,K) gagne **${fx(1.9 * c)}**. As = 1.`, [['go', 'Tirer', '🃏', ButtonStyle.Success]]),
    resolve() {
      const v = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      return { base: v >= 8 ? 1.9 : 0, pick: 'Haute', headline: `Carte : **${ranks[v]}**`, detail: ranks[v], v };
    },
  },
  lowcard: {
    title: '🃏 Carte basse',
    choices: ['go'],
    spinText: 'Tirage de la carte...',
    info: (c) => `≤ 7 → ${fx(1.9 * c)}`,
    picker: (c) => choicePicker('lowcard', '🃏 Carte basse', `Carte ≤ 7 gagne **${fx(1.9 * c)}**. As = 1.`, [['go', 'Tirer', '🃏', ButtonStyle.Success]]),
    resolve() {
      const v = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      return { base: v <= 7 ? 1.9 : 0, pick: 'Basse', headline: `Carte : **${ranks[v]}**`, detail: ranks[v], v };
    },
  },
  pairmatch: {
    title: '🃏 Paire',
    choices: ['go'],
    spinText: 'Deux cartes...',
    info: (c) => `paire ${fx(5.5 * c)}`,
    picker: (c) => choicePicker('pairmatch', '🃏 Paire', `Deux cartes. Même rang = **${fx(5.5 * c)}**.`, [['go', 'Tirer', '🃏', ButtonStyle.Success]]),
    resolve() {
      const a = randomInt(1, 14), b = randomInt(1, 14);
      const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      return { base: a === b ? 5.5 : 0, pick: 'Paire', headline: `**${ranks[a]}** · **${ranks[b]}**`, detail: `${ranks[a]}-${ranks[b]}`, a, b };
    },
  },
  freefall: {
    title: '🪂 Chute libre',
    choices: ['safe', 'mid', 'risk'],
    spinText: 'Tu sautes...',
    info: (c) => `x1.5 / x2.5 / x5`,
    picker: (c) => choicePicker('freefall', '🪂 Chute libre', 'Choisis ta zone d\'atterrissage.', [['safe', 'Zone sûre (x1.5)', '🟢'], ['mid', 'Zone moyenne (x2.5)', '🟡'], ['risk', 'Zone risquée (x5)', '🔴']]),
    resolve(choice) {
      const zones = { safe: { mult: 1.5, p: 0.65 }, mid: { mult: 2.5, p: 0.38 }, risk: { mult: 5, p: 0.18 } };
      const z = zones[choice];
      const ok = Math.random() < z.p;
      return { base: ok ? z.mult : 0, pick: choice, headline: ok ? '✅ Atterrissage parfait !' : '💥 Tu rates la zone...', detail: choice, ok };
    },
  },
  balloon: {
    title: '🎈 Ballon',
    choices: ['s1', 's2', 's3', 's4', 's5'],
    spinText: 'Le ballon gonfle...',
    info: (c) => `x1.4 à x7`,
    picker: (c) => choicePicker('balloon', '🎈 Ballon', 'Gonfle le ballon. Plus tu vas loin, plus tu gagnes — mais il peut éclater.', [['s1', 'Niveau 1 (x1.4)', '🎈'], ['s2', 'Niveau 2 (x2)', '🎈'], ['s3', 'Niveau 3 (x3)', '🎈'], ['s4', 'Niveau 4 (x4.5)', '🎈'], ['s5', 'Niveau 5 (x7)', '🎈']]),
    resolve(choice) {
      const need = Number(choice.slice(1));
      const mults = [0, 1.4, 2, 3, 4.5, 7];
      const probs = [0, 0.8, 0.6, 0.42, 0.28, 0.15];
      const ok = Math.random() < probs[need];
      return { base: ok ? mults[need] : 0, pick: `Niv. ${need}`, headline: ok ? `🎈 Ballon intact au niveau ${need} !` : `💥 Le ballon a éclaté au niveau ${need}`, detail: `${need}:${ok}`, need, ok };
    },
  },
  target: {
    title: '🎯 Cible',
    choices: ['center', 'inner', 'outer'],
    spinText: 'La fléchette vole...',
    info: (c) => `centre ${fx(5 * c)} · intérieur ${fx(2.5 * c)} · extérieur ${fx(1.5 * c)}`,
    picker: (c) => choicePicker('target', '🎯 Cible', 'Vise le centre, l\'intérieur ou l\'extérieur.', [['center', 'Centre (x5)', '🔴'], ['inner', 'Intérieur (x2.5)', '🟡'], ['outer', 'Extérieur (x1.5)', '🟢']]),
    resolve(choice) {
      const r = Math.random();
      const hit = r < 0.12 ? 'center' : r < 0.4 ? 'inner' : 'outer';
      const mults = { center: 5, inner: 2.5, outer: 1.5 };
      return { base: hit === choice ? mults[choice] : 0, pick: choice, headline: `Impact : **${hit}**`, detail: `${choice}->${hit}`, hit };
    },
  },
  sequence: {
    title: '🔢 Séquence',
    choices: ['go'],
    spinText: 'Suite de 3 chiffres...',
    info: (c) => `suite ${fx(6 * c)}`,
    picker: (c) => choicePicker('sequence', '🔢 Séquence', `3 chiffres. S\'ils forment une suite (ex 3-4-5), **${fx(6 * c)}**.`, [['go', 'Tirer', '🔢', ButtonStyle.Success]]),
    resolve() {
      const a = randomInt(1, 9), b = randomInt(1, 9), c = randomInt(1, 9);
      const sorted = [a, b, c].sort((x, y) => x - y);
      const ok = sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
      return { base: ok ? 6 : 0, pick: 'Séquence', headline: `**${a} · ${b} · ${c}**${ok ? ' · SUITE !' : ''}`, detail: `${a}-${b}-${c}`, a, b, c, ok };
    },
  },
  animalrace: {
    title: '🐾 Course d\'animaux',
    choices: ['a1', 'a2', 'a3', 'a4'],
    spinText: 'Les animaux s\'élancent...',
    info: (c) => `x2 à x6`,
    picker: (c) => choicePicker('animalrace', '🐾 Course d\'animaux', 'Parie sur un animal.', [['a1', 'Lapin (x2)', '🐰'], ['a2', 'Renard (x3)', '🦊'], ['a3', 'Loup (x4)', '🐺'], ['a4', 'Aigle (x6)', '🦅']]),
    resolve(choice) {
      const animals = [{ id: 'a1', name: 'Lapin', mult: 2, p: 0.42 }, { id: 'a2', name: 'Renard', mult: 3, p: 0.28 }, { id: 'a3', name: 'Loup', mult: 4, p: 0.18 }, { id: 'a4', name: 'Aigle', mult: 6, p: 0.12 }];
      let r = Math.random(), winner = animals[animals.length - 1];
      for (const a of animals) { if (r < a.p) { winner = a; break; } r -= a.p; }
      const want = animals.find((a) => a.id === choice);
      return { base: winner.id === choice ? want.mult : 0, pick: want.name, headline: `🏆 Gagnant : **${winner.name}**`, detail: `${choice}->${winner.id}`, winner };
    },
  },
  fruitmatch: {
    title: '🍎 Fruits',
    choices: ['go'],
    spinText: 'Les fruits tournent...',
    info: (c) => `3 identiques ${fx(12 * c)} · 2 ${fx(2.5 * c)}`,
    picker: (c) => choicePicker('fruitmatch', '🍎 Fruits', `3 fruits. 3 identiques = **${fx(12 * c)}**, 2 = **${fx(2.5 * c)}**.`, [['go', 'Lancer', '🍎', ButtonStyle.Success]]),
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
    title: '💎 Chasse aux gemmes',
    choices: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'],
    spinText: 'Tu fouilles...',
    info: (c) => `victoire ${fx(5.5 * c)}`,
    picker: (c) => choicePicker('gemhunt', '💎 Chasse aux gemmes', `6 roches, 1 gemme. **${fx(5.5 * c)}**`, [1, 2, 3, 4, 5, 6].map((n) => [`g${n}`, `Roche ${n}`, '🪨'])),
    resolve(choice) {
      const win = randomInt(1, 7), want = Number(choice.slice(1));
      return { base: win === want ? 5.5 : 0, pick: `Roche ${want}`, headline: win === want ? '💎 Gemme trouvée !' : `Rien dans la roche ${want} (c\'était la n°${win})`, detail: `${want}->${win}`, win, want };
    },
  },
  stardrop: {
    title: '⭐ Étoile filante',
    choices: ['catch', 'miss'],
    spinText: 'L\'étoile traverse le ciel...',
    info: (c) => `attraper ${fx(2.2 * c)}`,
    picker: (c) => choicePicker('stardrop', '⭐ Étoile filante', `Essaie d\'attraper l\'étoile (**${fx(2.2 * c)}**) ou laisse passer (mise remboursée si elle passe vraiment).`, [['catch', 'Attraper', '⭐'], ['miss', 'Laisser passer', '🌑']]),
    resolve(choice) {
      const falls = Math.random() < 0.55;
      if (choice === 'catch') return { base: falls ? 2.2 : 0, pick: 'Attraper', headline: falls ? '⭐ Tu l\'as eue !' : 'Elle est passée trop vite...', detail: 'catch', falls };
      return { base: falls ? 0 : 1, pick: 'Laisser', headline: falls ? '⭐ Elle est tombée (tu l\'as ratée)' : 'Elle a continué sa route, mise rendue.', detail: 'miss', falls };
    },
  },
  moonshot: {
    title: '🌙 Tir lunaire',
    choices: ['x2', 'x4', 'x8'],
    spinText: 'La fusée décolle vers la lune...',
    info: (c) => `x2 / x4 / x8`,
    picker: (c) => choicePicker('moonshot', '🌙 Tir lunaire', 'Atteins la distance choisie.', [['x2', 'Orbite (x2)', '🌍'], ['x4', 'Lune (x4)', '🌙'], ['x8', 'Au-delà (x8)', '🚀']]),
    resolve(choice) {
      const targets = { x2: 2, x4: 4, x8: 8 };
      const probs = { x2: 0.48, x4: 0.24, x8: 0.11 };
      const t = targets[choice];
      const ok = Math.random() < probs[choice];
      return { base: ok ? t : 0, pick: choice, headline: ok ? `🌙 Distance ${choice} atteinte !` : `💥 Échec avant ${choice}`, detail: choice, ok };
    },
  },
  volcano: {
    title: '🌋 Volcan',
    choices: ['close', 'mid', 'far'],
    spinText: 'Le volcan gronde...',
    info: (c) => `proche ${fx(4 * c)} · moyen ${fx(2.2 * c)} · loin ${fx(1.4 * c)}`,
    picker: (c) => choicePicker('volcano', '🌋 Volcan', 'Où te places-tu ? Plus près = plus risqué.', [['close', 'Proche (x4)', '🔴'], ['mid', 'Moyen (x2.2)', '🟡'], ['far', 'Loin (x1.4)', '🟢']]),
    resolve(choice) {
      const r = Math.random();
      const eruption = r < 0.35 ? 'close' : r < 0.7 ? 'mid' : 'far';
      // tu gagnes si tu n'es PAS dans la zone d'éruption... non: on gagne si on a deviné la zone
      const mults = { close: 4, mid: 2.2, far: 1.4 };
      return { base: eruption === choice ? mults[choice] : 0, pick: choice, headline: `Éruption zone **${eruption}**`, detail: `${choice}->${eruption}`, eruption };
    },
  },
  lightning: {
    title: '⚡ Éclair',
    choices: ['stay', 'run'],
    spinText: 'L\'orage arrive...',
    info: (c) => `rester ${fx(2.5 * c)} · fuir (remboursé si éclair)`,
    picker: (c) => choicePicker('lightning', '⚡ Éclair', 'Rester sous l\'orage (**${fx(2.5 * c)}** si tu survis) ou fuir.', [['stay', 'Rester', '⚡'], ['run', 'Fuir', '🏃']]),
    resolve(choice) {
      const strike = Math.random() < 0.4;
      if (choice === 'stay') return { base: strike ? 0 : 2.5, pick: 'Rester', headline: strike ? '⚡ Foudroyé !' : 'Tu as survécu à l\'orage !', detail: 'stay', strike };
      return { base: strike ? 1 : 0, pick: 'Fuir', headline: strike ? 'Tu as bien fait de fuir (mise rendue).' : 'Pas d\'éclair... tu as fui pour rien.', detail: 'run', strike };
    },
  },
  pokerhand: {
    title: '🃏 Poker express',
    choices: ['go'],
    spinText: 'Distribution...',
    info: (c) => `paire+ ${fx(2 * c)} · brelan ${fx(8 * c)}`,
    picker: (c) => choicePicker('pokerhand', '🃏 Poker express', `3 cartes. Paire = **${fx(2 * c)}**, brelan = **${fx(8 * c)}**.`, [['go', 'Distribuer', '🃏', ButtonStyle.Success]]),
    resolve() {
      const ranks = [randomInt(1, 14), randomInt(1, 14), randomInt(1, 14)];
      const names = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
      const counts = {};
      for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
      const max = Math.max(...Object.values(counts));
      let base = 0;
      if (max >= 3) base = 8;
      else if (max >= 2) base = 2;
      return { base, pick: 'Poker', headline: `**${ranks.map((r) => names[r]).join(' · ')}**${max >= 3 ? ' · BRELAN !' : max >= 2 ? ' · Paire' : ''}`, detail: ranks.join('-'), ranks, max };
    },
  },
  redblack: {
    title: '🔴 Noir ou Rouge',
    choices: ['red', 'black'],
    spinText: 'La carte se retourne...',
    info: (c) => `victoire ${fx(1.95 * c)}`,
    picker: (c) => choicePicker('redblack', '🔴 Noir ou Rouge', `Devine la couleur. **${fx(1.95 * c)}**.`, [['red', 'Rouge', '🔴'], ['black', 'Noir', '⚫']]),
    resolve(choice) {
      const col = randomInt(0, 2) === 0 ? 'red' : 'black';
      return { base: col === choice ? 1.95 : 0, pick: choice === 'red' ? 'Rouge' : 'Noir', headline: `Couleur : **${col === 'red' ? '🔴 Rouge' : '⚫ Noir'}**`, detail: `${choice}->${col}`, col };
    },
  },
  oddseven: {
    title: '🔢 Pair ou Impair+',
    choices: ['even', 'odd'],
    spinText: 'Le dé roule...',
    info: (c) => `victoire ${fx(1.95 * c)}`,
    picker: (c) => choicePicker('oddseven', '🔢 Pair ou Impair', `Un dé. Pair ou impair : **${fx(1.95 * c)}**.`, [['even', 'Pair', '🔵'], ['odd', 'Impair', '🔴']]),
    resolve(choice) {
      const n = randomInt(1, 7);
      const isEven = n % 2 === 0;
      const ok = (choice === 'even' && isEven) || (choice === 'odd' && !isEven);
      return { base: ok ? 1.95 : 0, pick: choice === 'even' ? 'Pair' : 'Impair', headline: code(dieLines(n)) + `**${n}** (${isEven ? 'pair' : 'impair'})`, detail: `${choice}->${n}`, n };
    },
  },
  multiplier: {
    title: '✖️ Multiplicateur',
    choices: ['m15', 'm2', 'm3', 'm5'],
    spinText: 'Le multiplicateur tourne...',
    info: (c) => `x1.5 à x5`,
    picker: (c) => choicePicker('multiplier', '✖️ Multiplicateur', 'Choisis ta cible. Un tirage aléatoire décide.', [['m15', 'x1.5', '✖️'], ['m2', 'x2', '✖️'], ['m3', 'x3', '✖️'], ['m5', 'x5', '✖️']]),
    resolve(choice) {
      const targets = { m15: 1.5, m2: 2, m3: 3, m5: 5 };
      const probs = { m15: 0.62, m2: 0.45, m3: 0.3, m5: 0.18 };
      const t = targets[choice];
      const ok = Math.random() < probs[choice];
      return { base: ok ? t : 0, pick: `x${t}`, headline: ok ? `✅ Multiplicateur x${t} validé !` : `❌ Pas cette fois (cible x${t})`, detail: choice, ok };
    },
  },
  memory: {
    title: '🧠 Mémoire',
    choices: ['go'],
    spinText: 'Les cartes se retournent...',
    info: (c) => `paire ${fx(3.5 * c)}`,
    picker: (c) => choicePicker('memory', '🧠 Mémoire', `4 cartes face cachée, 2 paires. Tu en retournes 2 : si paire **${fx(3.5 * c)}**.`, [['go', 'Retourner', '🧠', ButtonStyle.Success]]),
    resolve() {
      const vals = shuffle([1, 1, 2, 2]);
      const i1 = randomInt(0, 4), i2 = (i1 + 1 + randomInt(0, 3)) % 4;
      const ok = vals[i1] === vals[i2];
      return { base: ok ? 3.5 : 0, pick: 'Mémoire', headline: `Cartes retournées : **${vals[i1]}** et **${vals[i2]}**${ok ? ' · Paire !' : ''}`, detail: `${vals[i1]}-${vals[i2]}`, ok };
    },
  },
  colorswipe: {
    title: '🌈 Arc-en-ciel',
    choices: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'],
    spinText: 'L\'arc-en-ciel tourne...',
    info: (c) => `victoire ${fx(5.5 * c)}`,
    picker: (c) => choicePicker('colorswipe', '🌈 Arc-en-ciel', `6 couleurs. **${fx(5.5 * c)}**.`, [['red', 'Rouge', '🔴'], ['orange', 'Orange', '🟠'], ['yellow', 'Jaune', '🟡'], ['green', 'Vert', '🟢'], ['blue', 'Bleu', '🔵'], ['purple', 'Violet', '🟣']]),
    resolve(choice) {
      const cols = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
      const em = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣' };
      const out = cols[randomInt(0, 6)];
      return { base: out === choice ? 5.5 : 0, pick: choice, headline: `Couleur : **${em[out]}**`, detail: `${choice}->${out}`, out };
    },
  },
  rocket2: {
    title: '🚀 Fusée 2',
    choices: ['x2', 'x5', 'x10', 'x20'],
    spinText: 'Décollage...',
    info: (c) => `x2 à x20`,
    picker: (c) => choicePicker('rocket2', '🚀 Fusée 2', 'Choisis ta cible de multiplicateur.', [['x2', 'x2', '🚀'], ['x5', 'x5', '🚀'], ['x10', 'x10', '🚀'], ['x20', 'x20', '🚀']]),
    resolve(choice) {
      const targets = { x2: 2, x5: 5, x10: 10, x20: 20 };
      const u = randomInt(1, 1_000_001) / 1_000_000;
      const peak = Math.max(1, Math.floor((0.96 / u) * 100) / 100);
      const t = targets[choice];
      return { base: peak >= t ? t : 0, pick: choice, headline: `Pic **${fx(Math.min(peak, 500))}** · cible ${choice}`, detail: `${choice}/${peak}`, peak, t };
    },
  },
  diceexact2: {
    title: '🎲 Double dé',
    choices: ['s7', 's8', 's9', 's10', 's11', 's12'],
    spinText: 'Deux dés roulent...',
    info: (c) => `somme exacte ${fx(6 * c)}`,
    picker: (c) => choicePicker('diceexact2', '🎲 Double dé : somme exacte', `Devine la somme (7 à 12). **${fx(6 * c)}**.`, [7, 8, 9, 10, 11, 12].map((n) => [`s${n}`, String(n), '🎲'])),
    resolve(choice) {
      const a = randomInt(1, 7), b = randomInt(1, 7), sum = a + b, want = Number(choice.slice(1));
      return { base: sum === want ? 6 : 0, pick: `Somme ${want}`, headline: code(sideBySide([dieLines(a), dieLines(b)], '   ')) + `**${a}+${b}=${sum}**`, detail: `${want}->${sum}`, a, b, sum };
    },
  },
  chest2: {
    title: '📦 Triple coffre',
    choices: ['c1', 'c2', 'c3'],
    spinText: 'Ouverture...',
    info: (c) => `victoire ${fx(2.85 * c)}`,
    picker: (c) => choicePicker('chest2', '📦 Triple coffre', `1 trésor sur 3. **${fx(2.85 * c)}**.`, [['c1', 'Coffre 1', '📦'], ['c2', 'Coffre 2', '📦'], ['c3', 'Coffre 3', '📦']]),
    resolve(choice) {
      const win = randomInt(1, 4), want = Number(choice.slice(1));
      const view = [1, 2, 3].map((k) => (k === win ? '💎' : '💨')).join('  ');
      return { base: win === want ? 2.85 : 0, pick: `Coffre ${want}`, headline: `Contenu : ${view}`, detail: `${want}->${win}`, win, want };
    },
  },
  spincolor: {
    title: '🎨 Roue couleur',
    choices: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'],
    spinText: 'La roue tourne...',
    info: (c) => `victoire ${fx(5.5 * c)}`,
    picker: (c) => choicePicker('spincolor', '🎨 Roue couleur', `6 segments. **${fx(5.5 * c)}**.`, [['red', 'Rouge', '🔴'], ['blue', 'Bleu', '🔵'], ['green', 'Vert', '🟢'], ['yellow', 'Jaune', '🟡'], ['purple', 'Violet', '🟣'], ['orange', 'Orange', '🟠']]),
    resolve(choice) {
      const cols = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
      const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', purple: '🟣', orange: '🟠' };
      const out = cols[randomInt(0, 6)];
      return { base: out === choice ? 5.5 : 0, pick: choice, headline: `La roue s'arrête sur **${em[out]}**`, detail: `${choice}->${out}`, out };
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

// Animations simples pour les nouveaux jeux
ANIMS.limbo = (res) => {
  const steps = 8;
  const frames = [];
  for (let k = 1; k <= steps; k++) {
    const m = Math.max(1, Math.round(Math.pow(res.peak, k / steps) * 100) / 100);
    const bar = '█'.repeat(Math.min(20, Math.floor(m * 2))) + '░'.repeat(Math.max(0, 20 - Math.floor(m * 2)));
    frames.push({
      art: code([`  ${bar}`, `  x${m.toFixed(2)}`, '', `  Cible : x${res.target}`]),
      caption: m >= res.target ? 'Cible dépassée !' : 'Ça monte...',
      ms: 700,
    });
  }
  frames.push({
    art: code([`  PIC : x${Math.min(res.peak, 1000).toFixed(2)}`, `  Cible : x${res.target}`]),
    caption: res.peak >= res.target ? 'Cible validée !' : 'Trop bas',
    ms: 1100,
  });
  return frames;
};

ANIMS.higher = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?]', '', '  Carte de référence...']), caption: 'Tirage de la référence', ms: 900 },
    { art: code([`  [${ranks[res.a]}]`, '', '  Référence posée']), caption: `Référence : ${ranks[res.a]}`, ms: 1000 },
    { art: code([`  [${ranks[res.a]}]  →  [?]`, '', '  La suivante se retourne...']), caption: 'Suspense', ms: 1000 },
    { art: code([`  [${ranks[res.a]}]  →  [${ranks[res.b]}]`]), caption: `Suivante : ${ranks[res.b]}`, ms: 1100 },
  ];
};

ANIMS.rps = (res) => {
  const names = { rock: '✊', paper: '✋', scissors: '✌️' };
  return [
    { art: code(['  1...']), caption: 'Pierre', ms: 700 },
    { art: code(['  2...']), caption: 'Papier', ms: 700 },
    { art: code(['  3...']), caption: 'Ciseaux', ms: 700 },
    { art: code([`  Toi ${names[res.detail.split(' vs ')[0]]}  ·  Bot ${names[res.bot]}`]), caption: 'Résultat', ms: 1200 },
  ];
};

ANIMS.colorpick = (res) => {
  const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡' };
  const order = ['red', 'blue', 'green', 'yellow'];
  return order.map((c, k) => ({
    art: code([`  ${em[c]}`, '', '  Les couleurs tournent...']),
    caption: 'Mélange',
    ms: 600 + k * 50,
  })).concat([
    { art: code([`  ${em[res.out]}`, '', `  Couleur tirée`]), caption: 'Résultat', ms: 1100 },
  ]);
};

ANIMS.ladder = (res) => {
  const frames = [];
  for (let k = 0; k <= res.reached; k++) {
    const steps = Array.from({ length: 5 }, (_, i) => (i < k ? '▓▓' : i === k ? '██' : '░░')).reverse();
    frames.push({
      art: code(['  ÉCHELLE', ...steps.map((s, i) => `  ${5 - i} ${s}`)]),
      caption: k === 0 ? 'Départ' : `Palier ${k}`,
      ms: 750,
    });
  }
  frames.push({
    art: code([`  Atteint : palier ${res.reached}`, `  Objectif : palier ${res.want}`]),
    caption: res.reached >= res.want ? 'Objectif réussi !' : 'Chute',
    ms: 1100,
  });
  return frames;
};

ANIMS.keno = (res) => {
  const frames = [];
  for (let k = 0; k < 6; k++) {
    const n = randomInt(1, 11);
    frames.push({ art: code([`  [ ${n} ]`]), caption: 'Les numéros défilent', ms: 600 });
  }
  frames.push({ art: code([`  [ ${res.n} ]`]), caption: `Numéro tiré : ${res.n}`, ms: 1100 });
  return frames;
};

ANIMS.war = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?]     [?]']), caption: 'Cartes posées', ms: 900 },
    { art: code([`  [${ranks[res.me]}]     [?]`]), caption: 'Ta carte', ms: 1000 },
    { art: code([`  [${ranks[res.me]}]     [${ranks[res.dealer]}]`]), caption: 'Carte du croupier', ms: 1100 },
  ];
};

ANIMS.hilo = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const frames = [];
  for (let k = 1; k <= 3; k++) {
    frames.push({
      art: code([`  ${res.cards.slice(0, k).map((c) => ranks[c]).join(' · ')}`]),
      caption: `Carte ${k}/3`,
      ms: 900,
    });
  }
  return frames;
};

ANIMS.bingo = (res) => {
  const frames = [];
  for (let k = 0; k < 5; k++) {
    frames.push({ art: code([`  Case ${randomInt(1, 6)}`]), caption: 'La bille tourne...', ms: 600 });
  }
  frames.push({ art: code([`  Case ${res.n}`]), caption: `Bille dans la case ${res.n}`, ms: 1100 });
  return frames;
};

ANIMS.jackpot = (res) => {
  const syms = ['🍒', '🍋', '💎', '7️⃣', '⭐'];
  const frames = [];
  for (let k = 0; k < 5; k++) {
    frames.push({
      art: code([`  [ ${syms[randomInt(0, 5)]} | ${syms[randomInt(0, 5)]} | ${syms[randomInt(0, 5)]} ]`]),
      caption: 'Les rouleaux tournent',
      ms: 700,
    });
  }
  frames.push({
    art: code([`  [ ${res.a} | ${res.b} | ${res.c} ]`]),
    caption: 'Résultat',
    ms: 1200,
  });
  return frames;
};

// Animations des 30 nouveaux jeux
ANIMS.dicewar = (res) => {
  const r = () => randomInt(1, 7);
  return [
    { art: code(sideBySide([dieLines(r()), dieLines(r())], '   ')), caption: 'Les dés roulent', ms: 700 },
    { art: code(sideBySide([dieLines(r()), dieLines(r())], '   ')), caption: 'Rebond', ms: 700 },
    { art: code(sideBySide([dieLines(res.me), dieLines(r())], '   ')), caption: `Ton dé : ${res.me}`, ms: 900 },
    { art: code(sideBySide([dieLines(res.me), dieLines(res.dealer)], '   ')), caption: `Croupier : ${res.dealer}`, ms: 1100 },
  ];
};
ANIMS.coinladder = (res) => {
  const frames = [{ art: code(['  Pièce prête...']), caption: 'Début de l\'échelle', ms: 700 }];
  const flips = (res.detail || '').split('');
  flips.forEach((f, k) => {
    frames.push({ art: code([`  ${f === 'P' ? 'PILE' : 'FACE'}`, '', `  Série : ${k + 1}/${res.need}`]), caption: f === 'P' ? 'Pile !' : 'Face...', ms: 800 });
  });
  frames.push({ art: code([`  Résultat : ${flips.join(' · ')}`]), caption: res.streak >= res.need ? 'Échelle réussie !' : 'Échelle cassée', ms: 1100 });
  return frames;
};
ANIMS.cardmatch = (res) => [
  { art: code(['  [?] [?] [?] [?]']), caption: 'Cartes mélangées', ms: 800 },
  { art: code(['  Les cartes se mélangent...']), caption: 'Mélange', ms: 900 },
  { art: code([`  Secrète révélée : ${res.secret.r}${res.secret.s}`]), caption: 'Carte secrète', ms: 1000 },
  { art: code([`  Tirée : ${res.pickCard.r}${res.pickCard.s}`]), caption: 'Ta carte', ms: 1100 },
];
ANIMS.numguess = (res) => {
  const frames = [];
  for (let k = 0; k < 6; k++) frames.push({ art: code([`  [ ${randomInt(1, 11)} ]`]), caption: 'Les nombres défilent', ms: 550 });
  frames.push({ art: code([`  [ ${res.n} ]`]), caption: `Tirage : ${res.n}`, ms: 1100 });
  return frames;
};
ANIMS.bombdefuse = (res) => [
  { art: code(['  💣  3...']), caption: 'Compte à rebours', ms: 800 },
  { art: code(['  💣  2...']), caption: 'Compte à rebours', ms: 800 },
  { art: code(['  💣  1...']), caption: 'Compte à rebours', ms: 800 },
  { art: code([res.good === res.want ? '  ✅ Désamorcé' : '  💥 BOOM']), caption: res.good === res.want ? 'Bon fil !' : `Mauvais fil (bon = ${res.good})`, ms: 1200 },
];
ANIMS.treasure = (res) => {
  const frames = [];
  for (let k = 1; k <= 5; k++) {
    frames.push({ art: code([`  Case ${k} : ${k === res.win ? '💎' : '🕳️'}`]), caption: 'Fouille', ms: 600 });
  }
  frames.push({ art: code([`  Trésor en case ${res.win}`]), caption: 'Résultat', ms: 1100 });
  return frames;
};
ANIMS.highcard = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?]']), caption: 'Carte face cachée', ms: 800 },
    { art: code(['  [...]']), caption: 'Retournement...', ms: 900 },
    { art: code([`  [${ranks[res.v]}]`]), caption: `Carte : ${ranks[res.v]}`, ms: 1100 },
  ];
};
ANIMS.lowcard = ANIMS.highcard;
ANIMS.pairmatch = (res) => {
  const ranks = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?]  [?]' ]), caption: 'Deux cartes', ms: 800 },
    { art: code([`  [${ranks[res.a]}]  [?]`]), caption: 'Première carte', ms: 900 },
    { art: code([`  [${ranks[res.a]}]  [${ranks[res.b]}]`]), caption: 'Deuxième carte', ms: 1100 },
  ];
};
ANIMS.freefall = (res) => [
  { art: code(['  🪂', '  |', '  |', '  v']), caption: 'Saut !', ms: 800 },
  { art: code(['  🪂', '  |', '  v']), caption: 'Chute...', ms: 800 },
  { art: code(['  🪂', '  v']), caption: 'Approche du sol', ms: 800 },
  { art: code([res.ok ? '  ✅ Atterri' : '  💥 Crash']), caption: res.ok ? 'Zone atteinte' : 'Raté', ms: 1100 },
];
ANIMS.balloon = (res) => {
  const frames = [];
  for (let k = 1; k <= res.need; k++) {
    frames.push({ art: code([`  ${'O'.repeat(k + 2)}`, `  Niveau ${k}`]), caption: 'Gonflage...', ms: 700 });
  }
  frames.push({ art: code([res.ok ? '  🎈 Intact' : '  💥 Éclaté']), caption: res.ok ? 'Succès' : 'Trop gonflé', ms: 1100 });
  return frames;
};
ANIMS.target = (res) => [
  { art: code(['  →']), caption: 'Visée', ms: 700 },
  { art: code(['    →']), caption: 'Lancer', ms: 700 },
  { art: code(['      →']), caption: 'Vol', ms: 700 },
  { art: code([`  Impact : ${res.hit}`]), caption: 'Résultat', ms: 1100 },
];
ANIMS.sequence = (res) => [
  { art: code([`  ${res.a}  ?  ?`]), caption: 'Premier chiffre', ms: 800 },
  { art: code([`  ${res.a}  ${res.b}  ?`]), caption: 'Deuxième', ms: 800 },
  { art: code([`  ${res.a}  ${res.b}  ${res.c}`]), caption: res.ok ? 'SUITE !' : 'Pas de suite', ms: 1100 },
];
ANIMS.animalrace = (res) => {
  const names = { a1: '🐰', a2: '🦊', a3: '🐺', a4: '🦅' };
  const frames = [];
  for (let k = 0; k < 5; k++) {
    frames.push({ art: code(Object.values(names).map((e, i) => `${e} ${'.'.repeat(randomInt(1, 8))}`)), caption: 'Course en cours', ms: 700 });
  }
  frames.push({ art: code([`  Gagnant : ${res.winner.name}`]), caption: 'Arrivée', ms: 1200 });
  return frames;
};
ANIMS.fruitmatch = (res) => {
  const fruits = ['🍎', '🍌', '🍇', '🍊', '🍓'];
  const frames = [];
  for (let k = 0; k < 5; k++) {
    frames.push({ art: code([`  [ ${fruits[randomInt(0, 5)]} | ${fruits[randomInt(0, 5)]} | ${fruits[randomInt(0, 5)]} ]`]), caption: 'Rouleaux', ms: 650 });
  }
  frames.push({ art: code([`  [ ${res.a} | ${res.b} | ${res.c} ]`]), caption: 'Résultat', ms: 1100 });
  return frames;
};
ANIMS.gemhunt = (res) => {
  const frames = [];
  for (let k = 1; k <= 6; k++) {
    frames.push({ art: code([`  Roche ${k} ${k === res.win ? '💎' : '🪨'}`]), caption: 'Fouille', ms: 550 });
  }
  frames.push({ art: code([`  Gemme en roche ${res.win}`]), caption: 'Trouvée', ms: 1100 });
  return frames;
};
ANIMS.stardrop = (res) => [
  { art: code(['  ⭐', '    \\', '     \\']), caption: 'Étoile filante', ms: 800 },
  { art: code(['     ⭐', '    /', '   /']), caption: 'Elle traverse', ms: 800 },
  { art: code([res.falls ? '  ⭐ au sol' : '  ⭐ disparue']), caption: res.falls ? 'Elle est tombée' : 'Elle continue', ms: 1100 },
];
ANIMS.moonshot = (res) => [
  { art: code(['  🚀', '  |', '  |']), caption: 'Décollage', ms: 800 },
  { art: code(['  🚀', '  |']), caption: 'Montée', ms: 800 },
  { art: code(['  🚀']), caption: 'Espace', ms: 800 },
  { art: code([res.ok ? '  🌙 Objectif atteint' : '  💥 Échec']), caption: res.ok ? 'Succès' : 'Retour', ms: 1100 },
];
ANIMS.volcano = (res) => [
  { art: code(['  🌋', '  ~ ~']), caption: 'Le volcan gronde', ms: 800 },
  { art: code(['  🌋', '  ~~~']), caption: 'Ça chauffe', ms: 800 },
  { art: code(['  🌋💥', '  ~~~~']), caption: `Éruption zone ${res.eruption}`, ms: 1100 },
];
ANIMS.lightning = (res) => [
  { art: code(['  ☁️ ☁️', '   ~']), caption: 'Nuages', ms: 800 },
  { art: code(['  ☁️☁️☁️', '  ~ ~']), caption: 'Orage proche', ms: 800 },
  { art: code([res.strike ? '  ⚡ BOOM' : '  ☁️ ...']), caption: res.strike ? 'Éclair !' : 'L\'orage passe', ms: 1100 },
];
ANIMS.pokerhand = (res) => {
  const names = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return [
    { art: code(['  [?] [?] [?]' ]), caption: 'Distribution', ms: 800 },
    { art: code([`  [${names[res.ranks[0]]}] [?] [?]`]), caption: 'Carte 1', ms: 800 },
    { art: code([`  [${names[res.ranks[0]]}] [${names[res.ranks[1]]}] [?]`]), caption: 'Carte 2', ms: 800 },
    { art: code([`  [${names[res.ranks[0]]}] [${names[res.ranks[1]]}] [${names[res.ranks[2]]}]`]), caption: res.max >= 3 ? 'Brelan !' : res.max >= 2 ? 'Paire' : 'Rien', ms: 1100 },
  ];
};
ANIMS.redblack = (res) => [
  { art: code(['  [?]']), caption: 'Carte cachée', ms: 800 },
  { art: code(['  [...]']), caption: 'Retournement', ms: 900 },
  { art: code([`  ${res.col === 'red' ? '🔴 ROUGE' : '⚫ NOIR'}`]), caption: 'Couleur', ms: 1100 },
];
ANIMS.oddseven = (res) => {
  const r = () => randomInt(1, 7);
  return [
    { art: code(dieLines(r())), caption: 'Le dé roule', ms: 700 },
    { art: code(dieLines(r())), caption: 'Rebond', ms: 700 },
    { art: code(dieLines(res.n)), caption: `Résultat : ${res.n}`, ms: 1100 },
  ];
};
ANIMS.multiplier = (res) => {
  const frames = [];
  for (let k = 0; k < 6; k++) {
    const m = [1.5, 2, 3, 5][randomInt(0, 4)];
    frames.push({ art: code([`  x${m}`]), caption: 'Multiplicateurs', ms: 600 });
  }
  frames.push({ art: code([`  Cible ${res.pick}`]), caption: res.ok ? 'Validé !' : 'Raté', ms: 1100 });
  return frames;
};
ANIMS.memory = (res) => [
  { art: code(['  [?] [?] [?] [?]' ]), caption: 'Cartes cachées', ms: 800 },
  { art: code(['  Retournement...']), caption: 'Mémoire', ms: 900 },
  { art: code([`  ${res.detail.replace('-', ' et ')}`]), caption: res.ok ? 'Paire !' : 'Pas de paire', ms: 1100 },
];
ANIMS.colorswipe = (res) => {
  const cols = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'];
  const frames = cols.map((e) => ({ art: code([`  ${e}`]), caption: 'Arc-en-ciel', ms: 500 }));
  const em = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵', purple: '🟣' };
  frames.push({ art: code([`  ${em[res.out]}`]), caption: 'Couleur tirée', ms: 1100 });
  return frames;
};
ANIMS.rocket2 = (res) => {
  const steps = 8;
  const frames = [];
  for (let k = 1; k <= steps; k++) {
    const m = Math.max(1, Math.round(Math.pow(Math.min(res.peak, 100), k / steps) * 100) / 100);
    frames.push({ art: code([`  🚀 x${m.toFixed(2)}`, `  Cible ${res.pick}`]), caption: 'Montée', ms: 650 });
  }
  frames.push({ art: code([`  Pic x${Math.min(res.peak, 500).toFixed(2)}`]), caption: res.peak >= res.t ? 'Cible OK' : 'Trop bas', ms: 1100 });
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
    frames.push({ art: code([`  ${cols[k % 6]}`]), caption: 'La roue tourne', ms: 500 });
  }
  const em = { red: '🔴', blue: '🔵', green: '🟢', yellow: '🟡', purple: '🟣', orange: '🟠' };
  frames.push({ art: code([`  ${em[res.out]}`]), caption: 'Arrêt', ms: 1100 });
  return frames;
};


// ---------- Jeux bulk (pour atteindre ~100) ----------
(function registerBulkGames() {
  const bulk = [['coin2', 'Double pile', '🪙', 'Encore pile ou face', 'pile', 'face', 2], ['dice7', 'Dés 7+', '🎲', 'Somme >= 7', 'over', 'under', 2], ['lucky7', 'Lucky 7', '7️⃣', 'Exactement 7', 'yes', 'no', 5], ['evenodd2', 'Pair/Impair 2', '🔢', 'Dé pair ou impair', 'even', 'odd', 2], ['redblack2', 'Rouge Noir 2', '🔴', 'Carte rouge/noire', 'red', 'black', 2], ['highlow2', 'Haut Bas', '⬆️', 'Carte haute ou basse', 'high', 'low', 2], ['triple', 'Triple chance', '🎯', '1 sur 3', 'a', 'b', 2.8], ['quad', 'Quad', '4️⃣', '1 sur 4', 'a', 'b', 3.5], ['penta', 'Penta', '5️⃣', '1 sur 5', 'a', 'b', 4.5], ['coin3', 'Triple pile', '🪙', "3 piles d\'affilée", 'yes', 'no', 7], ['snake', 'Snake eyes', '🐍', 'Double 1', 'yes', 'no', 30], ['boxcars', 'Boxcars', '🎲', 'Double 6', 'yes', 'no', 30], ['anydouble', 'Double quelconque', '🎲', 'Deux dés égaux', 'yes', 'no', 5.5], ['acehigh', 'As haut', '🃏', 'As sort', 'yes', 'no', 12], ['facecard', 'Figure', '🃏', 'J Q ou K', 'yes', 'no', 3.5], ['suitspade', 'Pique', '♠️', 'Enseigne pique', 'yes', 'no', 3.8], ['suithr', 'Coeur', '♥️', 'Enseigne coeur', 'yes', 'no', 3.8], ['suitdi', 'Carreau', '♦️', 'Enseigne carreau', 'yes', 'no', 3.8], ['suitcl', 'Trèfle', '♣️', 'Enseigne trèfle', 'yes', 'no', 3.8], ['blast', 'Blast', '💥', 'Explosion ou pas', 'safe', 'boom', 1.9], ['freeze', 'Freeze', '❄️', 'Gel ou chaleur', 'ice', 'fire', 2], ['shadow', 'Ombre', '🌑', 'Ombre ou lumière', 'shadow', 'light', 2], ['pulse', 'Pulse', '💓', 'Rythme fort/faible', 'high', 'low', 2], ['orbit', 'Orbite', '🪐', 'Reste en orbite', 'in', 'out', 2.2], ['spark', 'Étincelle', '✨', 'Étincelle allumée', 'on', 'off', 2], ['wave', 'Vague', '🌊', 'Vague haute/basse', 'high', 'low', 2], ['mirror', 'Miroir', '🪞', 'Miroir cassé ou non', 'ok', 'break', 1.95], ['portal', 'Portail', '🌀', 'Portail ouvert', 'open', 'closed', 2.1], ['rune', 'Rune', '🔮', 'Bonne rune', 'yes', 'no', 3], ['totem', 'Totem', '🗿', 'Totem stable', 'yes', 'no', 2.4], ['cactus', 'Cactus', '🌵', 'Évite les épines', 'safe', 'ouch', 1.9], ['pearl', 'Perle', '🦪', 'Trouve la perle', 'yes', 'no', 4], ['compass', 'Boussole', '🧭', 'Bonne direction', 'n', 's', 2], ['anchor', 'Ancre', '⚓', 'Ancre levée', 'up', 'down', 2], ['torch', 'Torche', '🔥', 'Torche allumée', 'on', 'off', 2], ['keylock', 'Clé', '🔑', 'Bonne clé', 'yes', 'no', 3.5], ['hourglass', 'Sablier', '⏳', 'Temps restant', 'ok', 'out', 2.2], ['balloon2', 'Ballon 2', '🎈', 'Gonflé ou éclaté', 'ok', 'pop', 2], ['dicehi', 'Dé haut', '🎲', 'Dé >= 4', 'yes', 'no', 1.9], ['dicelo', 'Dé bas', '🎲', 'Dé <= 3', 'yes', 'no', 1.9], ['coinrush', 'Ruée pièces', '🪙', 'Plus de piles', 'yes', 'no', 2.5], ['starfall', "Pluie d\'étoiles", '🌟', 'Attrape 1 étoile', 'yes', 'no', 3], ['meteor', 'Météore', '☄️', 'Évite le météore', 'dodge', 'hit', 1.85], ['rainbow', 'Arc', '🌈', 'Couleur chanceuse', 'yes', 'no', 5], ['clover', 'Trèfle chance', '🍀', 'Trèfle trouvé', 'yes', 'no', 6]];
  for (const [key, name, emoji, desc, c1, c2, winMult] of bulk) {
    if (INSTANT[key]) continue;
    INSTANT[key] = {
      title: `${emoji} ${name}`,
      spinText: code(['...']),
      choices: [c1, c2],
      info: (c) => `Choix ${c1}/${c2} · gain ≈ ${fx(winMult * c)}`,
      picker: (c) =>
        choicePicker(
          key,
          [
            [c1, c1, '✅', ButtonStyle.Success],
            [c2, c2, '❌', ButtonStyle.Danger],
          ],
          `**${emoji} ${name}**\n${desc}\nGain ~ **${fx(winMult * c)}** si bon.`
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
          headline: out === choice ? `✅ **${out}** — gagné !` : `❌ Sortie **${out}** — perdu.`,
        };
      },
    };
    ANIMS[key] = (res) => [
      { art: code(['  ...']), caption: 'Tirage', ms: 700 },
      { art: code([`  ${res.detail}`]), caption: res.ok ? 'Gagné' : 'Perdu', ms: 1000 },
    ];
  }
})();

async function playInstant(i, key, bet, choice) {
  const G = INSTANT[key];
  if (!G || !G.choices.includes(choice)) return respondText(i, 'Pari invalide.');
  const uid = i.user.id;
  if (!tryLock(uid)) return respondText(i, MSG.busy);

  // Répondre tout de suite pour éviter "l\'application n'a pas répondu"
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
      await i.editReply({
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

    let frames = [{ art: G.spinText || '...', ms: 1000 }];
    try {
      if (ANIMS[key]) frames = ANIMS[key](res, { c, bet, choice }) || frames;
    } catch (animErr) {
      console.error('[anim]', key, animErr?.message || animErr);
    }
    await animate(i, frames, G.title, `Mise **${fmt(bet)}** · ${res.pick || ''}\n`);

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
    await i.editReply({ embeds: [embed], components: [endGameRow(`replay|${key}|${bet}|${choice}`)] });

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
    .setTitle('✦ Salon de jeu')
    .setDescription(
      [
        'Bienvenue dans le salon de jeu.',
        '',
        `🎁 **Daily** · **${DAILY_AMOUNT}** ${COIN} par jour (minuit Paris)`,
        '',
        '▶️ **Start** : ouvre ton casino privé en message privé',
        '⚙️ **Paramètres** : langue et notifications de victoire',
        '📊 **Stats** : ta bannière de statistiques',
        '📖 **Règles** : explications simples de tous les jeux',
        '📨 **Invites** : tes invitations',
        '',
        '🔒 Toutes les parties sont privées.',
      ].join('\n')
    )
    .addFields(
      { name: 'Jouer', value: 'Start → MP', inline: true },
      { name: 'Monnaie', value: COIN, inline: true },
      { name: 'Daily', value: `${DAILY_AMOUNT} ${COIN}`, inline: true }
    )
    .setFooter({ text: 'Parties privées' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_start').setLabel('Start').setEmoji('▶️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_settings').setLabel('Paramètres').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_rules').setLabel('Règles').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_invites').setLabel('Invites').setEmoji('📨').setStyle(ButtonStyle.Secondary)
  );
  return { content: `${COIN} **Salon de jeu**`, embeds: [panel], components: [row] };
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
    .setTitle(lang === 'en' ? '✦ Your private casino' : '✦ Ton casino privé')
    .setDescription(
      lang === 'en'
        ? [
            `💰 **Balance : ${fmt(bal)}**`,
            `🎁 Daily : **${DAILY_AMOUNT}** ${COIN} once a day (Paris midnight)`,
            '',
            '**Play** → choose a game',
            '**Send** → transfer coins (username of a server member)',
            '**Rules** → simple rules of every game',
          ].join('\n')
        : [
            `💰 **Solde : ${fmt(bal)}**`,
            `🎁 Daily : **${DAILY_AMOUNT}** ${COIN} par jour (minuit Paris)`,
            '',
            '**Jouer** → choisir un jeu',
            '**Envoyer** → transférer des coins (pseudo d’un membre du serveur)',
            '**Règles** → explications simples de chaque jeu',
          ].join('\n')
    )
    .setFooter({ text: lang === 'en' ? 'Private panel' : 'Panneau privé' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_play').setLabel(lang === 'en' ? 'Play' : 'Jouer').setEmoji('🎮').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_search').setLabel(lang === 'en' ? 'Search' : 'Recherche').setEmoji('🔍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_favs').setLabel(lang === 'en' ? 'Favorites' : 'Favoris').setEmoji('⭐').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_daily').setLabel('Daily').setEmoji('🎁').setStyle(ButtonStyle.Success)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_send').setLabel(lang === 'en' ? 'Send' : 'Envoyer').setEmoji('💸').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_rules').setLabel(lang === 'en' ? 'Rules' : 'Règles').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_history').setLabel(lang === 'en' ? 'History' : 'Historique').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_settings').setLabel(lang === 'en' ? 'Settings' : 'Paramètres').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_clearall').setLabel(lang === 'en' ? 'Clear chat' : 'Tout effacer').setEmoji('🧹').setStyle(ButtonStyle.Danger)
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
  ['limbo', 'Limbo', '📈', 'Choisis ta cible'],
  ['higher', 'Higher/Lower', '⬆️', 'Plus haut ou plus bas'],
  ['rps', 'PFC', '✊', 'Pierre papier ciseaux'],
  ['colorpick', 'Couleur', '🎨', 'Devine la couleur'],
  ['ladder', 'Échelle', '🪜', 'Monte les échelons'],
  ['keno', 'Keno', '🎱', 'Tire 1 numéro sur 10'],
  ['war', 'Guerre', '⚔️', 'Carte vs carte'],
  ['hilo', 'Hi-Lo', '🃏', 'Suite de cartes'],
  ['bingo', 'Bingo', '🅱️', 'Numéro tiré'],
  ['jackpot', 'Jackpot', '💎', '3 symboles = jackpot'],
  // 30 nouveaux
  ['dicewar', 'Guerre dés', '🎲', 'Dés vs dés'],
  ['coinladder', 'Échelle pièces', '🪙', 'Pile/face en chaîne'],
  ['cardmatch', 'Match cartes', '🃏', 'Retrouve la carte'],
  ['numguess', 'Devine nombre', '🔢', '1 à 20'],
  ['bombdefuse', 'Désamorçage', '💣', 'Coupe le bon fil'],
  ['treasure', 'Trésor', '🗺️', 'Choisis la case'],
  ['highcard', 'Carte haute', '🃏', 'Au-dessus de 7'],
  ['lowcard', 'Carte basse', '🃏', 'En-dessous de 8'],
  ['pairmatch', 'Paire', '🃏', 'Deux mêmes rangs'],
  ['freefall', 'Chute libre', '🪂', 'Atterris bien'],
  ['balloon', 'Ballon', '🎈', 'Gonfle sans éclater'],
  ['target', 'Cible', '🎯', 'Vise le centre'],
  ['sequence', 'Séquence', '🔢', 'Suite de chiffres'],
  ['animalrace', 'Course animaux', '🐾', 'Parie sur un animal'],
  ['fruitmatch', 'Fruits', '🍎', '3 fruits identiques'],
  ['gemhunt', 'Gemmes', '💎', 'Trouve la gemme'],
  ['stardrop', 'Étoile', '⭐', 'Attrape l\'étoile'],
  ['moonshot', 'Tir lunaire', '🌙', 'Atteins la lune'],
  ['volcano', 'Volcan', '🌋', 'Évite l\'éruption'],
  ['lightning', 'Éclair', '⚡', 'Survis à l\'orage'],
  ['pokerhand', 'Poker express', '🃏', 'Meilleure main'],
  ['redblack', 'Rouge/Noir', '🔴', 'Couleur simple'],
  ['oddseven', 'Pair/Impair+', '🔢', 'Sur un dé'],
  ['multiplier', 'Multi', '✖️', 'Choisis ton multi'],
  ['memory', 'Mémoire', '🧠', 'Retrouve la paire'],
  ['colorswipe', 'Arc-en-ciel', '🌈', 'Couleur tirée'],
  ['rocket2', 'Fusée 2', '🚀', 'Cible haute'],
  ['diceexact2', 'Double dé', '🎲', 'Somme exacte'],
  ['chest2', 'Triple coffre', '📦', '1 trésor sur 3'],
  ['spincolor', 'Roue couleur', '🎨', 'Roue à 6 couleurs'],
  ['coin2', 'Double pile', '🪙', 'Encore pile ou face'],
  ['dice7', 'Dés 7+', '🎲', 'Somme >= 7'],
  ['lucky7', 'Lucky 7', '7️⃣', 'Exactement 7'],
  ['evenodd2', 'Pair/Impair 2', '🔢', 'Dé pair ou impair'],
  ['redblack2', 'Rouge Noir 2', '🔴', 'Carte rouge/noire'],
  ['highlow2', 'Haut Bas', '⬆️', 'Carte haute ou basse'],
  ['triple', 'Triple chance', '🎯', '1 sur 3'],
  ['quad', 'Quad', '4️⃣', '1 sur 4'],
  ['penta', 'Penta', '5️⃣', '1 sur 5'],
  ['coin3', 'Triple pile', '🪙', '3 piles d\'affilée'],
  ['snake', 'Snake eyes', '🐍', 'Double 1'],
  ['boxcars', 'Boxcars', '🎲', 'Double 6'],
  ['anydouble', 'Double quelconque', '🎲', 'Deux dés égaux'],
  ['acehigh', 'As haut', '🃏', 'As sort'],
  ['facecard', 'Figure', '🃏', 'J Q ou K'],
  ['suitspade', 'Pique', '♠️', 'Enseigne pique'],
  ['suithr', 'Coeur', '♥️', 'Enseigne coeur'],
  ['suitdi', 'Carreau', '♦️', 'Enseigne carreau'],
  ['suitcl', 'Trèfle', '♣️', 'Enseigne trèfle'],
  ['blast', 'Blast', '💥', 'Explosion ou pas'],
  ['freeze', 'Freeze', '❄️', 'Gel ou chaleur'],
  ['shadow', 'Ombre', '🌑', 'Ombre ou lumière'],
  ['pulse', 'Pulse', '💓', 'Rythme fort/faible'],
  ['orbit', 'Orbite', '🪐', 'Reste en orbite'],
  ['spark', 'Étincelle', '✨', 'Étincelle allumée'],
  ['wave', 'Vague', '🌊', 'Vague haute/basse'],
  ['mirror', 'Miroir', '🪞', 'Miroir cassé ou non'],
  ['portal', 'Portail', '🌀', 'Portail ouvert'],
  ['rune', 'Rune', '🔮', 'Bonne rune'],
  ['totem', 'Totem', '🗿', 'Totem stable'],
  ['cactus', 'Cactus', '🌵', 'Évite les épines'],
  ['pearl', 'Perle', '🦪', 'Trouve la perle'],
  ['compass', 'Boussole', '🧭', 'Bonne direction'],
  ['anchor', 'Ancre', '⚓', 'Ancre levée'],
  ['torch', 'Torche', '🔥', 'Torche allumée'],
  ['keylock', 'Clé', '🔑', 'Bonne clé'],
  ['hourglass', 'Sablier', '⏳', 'Temps restant'],
  ['balloon2', 'Ballon 2', '🎈', 'Gonflé ou éclaté'],
  ['dicehi', 'Dé haut', '🎲', 'Dé >= 4'],
  ['dicelo', 'Dé bas', '🎲', 'Dé <= 3'],
  ['coinrush', 'Ruée pièces', '🪙', 'Plus de piles'],
  ['starfall', 'Pluie d\'étoiles', '🌟', 'Attrape 1 étoile'],
  ['meteor', 'Météore', '☄️', 'Évite le météore'],
  ['rainbow', 'Arc', '🌈', 'Couleur chanceuse'],
  ['clover', 'Trèfle chance', '🍀', 'Trèfle trouvé'],
];

function buildGameMenuPayload(userId = null, page = 0, mode = 'all', query = '') {
  const favs = userId ? getFavs(userId) : new Set();
  let list = GAME_MENU.slice();
  if (mode === 'favs') {
    list = list.filter(([key]) => favs.has(key));
  } else if (mode === 'search' && query) {
    const q = query.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    list = list.filter(([key, name, , desc]) => {
      const hay = `${key} ${name} ${desc}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      return hay.includes(q);
    });
  }
  // Favoris en tête si mode all
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
    mode === 'favs' ? '⭐ Favoris' : mode === 'search' ? `🔍 « ${query} »` : '🎮 Tous les jeux';
  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setTitle(t(userId, 'lobbyTitle'))
    .setDescription(
      `${modeLabel}\n` +
        (list.length ? `**Page ${p + 1}/${totalPages}** · ${list.length} jeu(x)` : '_Aucun résultat_') +
        `\n⭐ = favori · utilise **Recherche** ou **Favoris** depuis le panneau`
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
    new ButtonBuilder().setCustomId('panel_search').setLabel('Recherche').setEmoji('🔍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_favs').setLabel('Favoris').setEmoji('⭐').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_play').setLabel('Tous').setEmoji('🎮').setStyle(ButtonStyle.Secondary)
  );
  components.push(nav);

  return { embeds: [embed], components };
}

function buildSettingsPayload(userId) {
  const cur = getLang(userId);
  const ping = wantsWinPing(userId);
  const skip = wantsSkipAnim(userId);
  const embed = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setTitle(`⚙️ ${L(userId, 'Paramètres', 'Settings')}`)
    .setDescription(
      code([
        `${padR(L(userId, 'Langue', 'Language'), 22)}${padL(cur === 'fr' ? 'Français' : 'English', 10)}`,
        `${padR(L(userId, 'Ping des victoires', 'Win pings'), 22)}${padL(ping ? 'ON' : 'OFF', 10)}`,
        `${padR(L(userId, 'Animations', 'Animations'), 22)}${padL(skip ? 'SKIP' : 'ON', 10)}`,
      ]) +
        L(
          userId,
          '**Langue** : menus privés.\n**Ping** : mentions dans le salon wins.\n**Animations** : SKIP = résultat immédiat sans anim.',
          '**Language**: private menus.\n**Ping**: mentions in wins channel.\n**Animations**: SKIP = instant result.'
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
      .setStyle(ping ? ButtonStyle.Primary : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('panel_skipanim')
      .setLabel(skip ? 'Anim : SKIP' : 'Anim : ON')
      .setEmoji('⏩')
      .setStyle(skip ? ButtonStyle.Danger : ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row] };
}

function buildRulesPayload(userId) {
  const lang = getLang(userId);
  const fr = lang !== 'en';
  const lines = [
    ['💣 Mines', fr ? 'Choisis une difficulté. Clique sur les cases pour trouver des diamants. Évite les mines. Encaisse quand tu veux : plus tu trouves de diamants, plus le multiplicateur monte.' : 'Pick a difficulty. Click tiles for diamonds. Avoid mines. Cash out anytime: more diamonds = higher multiplier.'],
    ['🃏 Blackjack', fr ? 'Bats le croupier sans dépasser 21. Tirer = nouvelle carte, Rester = s’arrêter, Doubler = double la mise et tire une seule carte. Blackjack naturel paie x2.5.' : 'Beat the dealer without going over 21. Hit, Stand or Double. Natural blackjack pays x2.5.'],
    ['🎡 Roulette', fr ? 'Mise sur rouge/noir/pair/impair (x2) ou un numéro / vert (x36). La bille tourne puis s’arrête.' : 'Bet on red/black/even/odd (x2) or a number / green (x36). The ball spins then stops.'],
    ['🪙 Pile ou Face', fr ? 'Choisis pile ou face. 1 chance sur 2, victoire environ x1.95.' : 'Pick heads or tails. 50/50, win about x1.95.'],
    ['🎲 Dés', fr ? '2 dés. Parie moins de 7, plus de 7 ou exactement 7. Exactement 7 paie plus.' : '2 dice. Bet under 7, over 7 or exactly 7. Exactly 7 pays more.'],
    ['🎰 Slots', fr ? '3 rouleaux. 3 symboles identiques = gros gain. 2 cerises = petit gain.' : '3 reels. 3 matching symbols = big win. 2 cherries = small win.'],
    ['🎡 Roue', fr ? 'La roue tourne et s’arrête sur un multiplicateur (ou x0).' : 'The wheel spins and stops on a multiplier (or x0).'],
    ['⚔️ Duel', fr ? 'Tu tires une carte contre le croupier. La plus haute gagne (As faible).' : 'Draw a card vs the dealer. Highest wins (Ace is low).'],
    ['🃏 Enseigne', fr ? 'Devine la couleur de la carte (pique, cœur, carreau, trèfle). 1 chance sur 4.' : 'Guess the suit of the card. 1 in 4.'],
    ['🎯 Zone', fr ? 'Un nombre de 1 à 10. Choisis bas (1-3), milieu (4-7) ou haut (8-10).' : 'A number from 1 to 10. Pick low (1-3), mid (4-7) or high (8-10).'],
    ['🎱 Plinko', fr ? 'La bille descend et tombe dans une case. Choisis le niveau de risque.' : 'The ball falls into a slot. Choose the risk level.'],
    ['🚀 Crash', fr ? 'Choisis une cible (x1.5, x2…). La fusée monte puis explose. Si elle atteint ta cible, tu gagnes.' : 'Pick a target (x1.5, x2…). Rocket rises then crashes. If it reaches your target, you win.'],
    ['🎟️ Ticket', fr ? 'Gratte 3 cases. 3 symboles identiques = gagné.' : 'Scratch 3 cells. 3 matching symbols = win.'],
    ['🎲 Dé exact', fr ? 'Devine le chiffre du dé (1 à 6). 1 chance sur 6.' : 'Guess the die face (1-6). 1 in 6.'],
    ['📦 Coffre', fr ? '3 coffres, 1 trésor. Choisis le bon.' : '3 chests, 1 treasure. Pick the right one.'],
    ['🔫 Roulette russe', fr ? 'Choisis le nombre de balles. Survis pour gagner (plus de balles = plus gros gain).' : 'Pick how many bullets. Survive to win (more bullets = bigger payout).'],
    ['🏇 Chevaux', fr ? 'Parie sur un des 5 chevaux. Chacun a ses cotes.' : 'Bet on one of 5 horses. Each has its own odds.'],
    ['📈 Limbo', fr ? 'Choisis une cible (x1.5 à x10). Le multiplicateur monte au hasard : s’il dépasse ta cible, tu gagnes.' : 'Pick a target (x1.5 to x10). Multiplier rises randomly: if it exceeds your target, you win.'],
    ['⬆️ Higher/Lower', fr ? 'Une carte de référence est tirée. Devine si la suivante est plus haute ou plus basse.' : 'A reference card is drawn. Guess if the next is higher or lower.'],
    ['✊ Pierre-Papier-Ciseaux', fr ? 'Choisis pierre, papier ou ciseaux contre le bot. Victoire ≈ x2.8, égalité = remboursement.' : 'Pick rock, paper or scissors vs the bot. Win ≈ x2.8, draw = refund.'],
    ['🎨 Couleur', fr ? 'Devine la couleur tirée parmi 4 (rouge, bleu, vert, jaune).' : 'Guess the drawn color among 4 (red, blue, green, yellow).'],
    ['🪜 Échelle', fr ? 'Choisis jusqu’à quel palier tu montes. Plus haut = plus risqué et plus rémunérateur.' : 'Choose how high you climb. Higher = riskier and more rewarding.'],
    ['🎱 Keno', fr ? 'Choisis un numéro de 1 à 10. Un seul est tiré.' : 'Pick a number from 1 to 10. One is drawn.'],
    ['⚔️ Guerre', fr ? 'Une carte contre le croupier. La plus haute gagne.' : 'One card vs the dealer. Highest wins.'],
    ['🃏 Hi-Lo', fr ? '3 cartes. Si les 3 sont hautes (8+) ou les 3 basses (7-), tu gagnes.' : '3 cards. If all high (8+) or all low (7-), you win.'],
    ['🅱️ Bingo', fr ? 'Choisis une case parmi 5. Une bille sort.' : 'Pick one of 5 slots. A ball is drawn.'],
    ['💎 Jackpot', fr ? '3 symboles. 3 identiques = gros jackpot, 2 identiques = petit gain.' : '3 symbols. 3 matching = big jackpot, 2 matching = small win.'],
    ['🎲 Guerre de dés', fr ? 'Ton dé contre le croupier. Le plus haut gagne.' : 'Your die vs dealer. Highest wins.'],
    ['🪙 Échelle de pièces', fr ? 'Enchaîne des piles pour monter l\'échelle.' : 'Chain heads to climb the ladder.'],
    ['🃏 Match de cartes', fr ? 'Retrouve la carte secrète parmi 4.' : 'Find the secret card among 4.'],
    ['🔢 Devine le nombre', fr ? 'Un nombre de 1 à 10.' : 'A number from 1 to 10.'],
    ['💣 Désamorçage', fr ? 'Coupe le bon fil parmi 4.' : 'Cut the right wire among 4.'],
    ['🗺️ Carte au trésor', fr ? '5 cases, 1 trésor.' : '5 spots, 1 treasure.'],
    ['🃏 Carte haute / basse', fr ? 'Carte ≥ 8 ou ≤ 7.' : 'Card ≥ 8 or ≤ 7.'],
    ['🃏 Paire', fr ? 'Deux cartes du même rang.' : 'Two cards of the same rank.'],
    ['🪂 Chute libre', fr ? 'Choisis ta zone d\'atterrissage.' : 'Pick your landing zone.'],
    ['🎈 Ballon', fr ? 'Gonfle sans faire éclater.' : 'Inflate without popping.'],
    ['🎯 Cible', fr ? 'Centre, intérieur ou extérieur.' : 'Center, inner or outer.'],
    ['🔢 Séquence', fr ? '3 chiffres en suite.' : '3 numbers in a row.'],
    ['🐾 Course d\'animaux', fr ? 'Parie sur un animal.' : 'Bet on an animal.'],
    ['🍎 Fruits', fr ? '3 fruits identiques ou 2.' : '3 matching fruits or 2.'],
    ['💎 Chasse aux gemmes', fr ? '6 roches, 1 gemme.' : '6 rocks, 1 gem.'],
    ['⭐ Étoile filante', fr ? 'Attrape ou laisse passer.' : 'Catch or let pass.'],
    ['🌙 Tir lunaire', fr ? 'Atteins la distance choisie.' : 'Reach the chosen distance.'],
    ['🌋 Volcan', fr ? 'Devine la zone d\'éruption.' : 'Guess the eruption zone.'],
    ['⚡ Éclair', fr ? 'Reste ou fuis l\'orage.' : 'Stay or run from the storm.'],
    ['🃏 Poker express', fr ? '3 cartes : paire ou brelan.' : '3 cards: pair or three of a kind.'],
    ['🔴 Rouge/Noir', fr ? 'Couleur de la carte.' : 'Card color.'],
    ['🔢 Pair/Impair', fr ? 'Sur un dé.' : 'On a die.'],
    ['✖️ Multiplicateur', fr ? 'Valide ta cible de multi.' : 'Hit your multi target.'],
    ['🧠 Mémoire', fr ? 'Retourne 2 cartes, trouve la paire.' : 'Flip 2 cards, find the pair.'],
    ['🌈 Arc-en-ciel', fr ? '6 couleurs possibles.' : '6 possible colors.'],
    ['🚀 Fusée 2', fr ? 'Cible de multiplicateur haute.' : 'High multiplier target.'],
    ['🎲 Double dé', fr ? 'Devine la somme exacte.' : 'Guess the exact sum.'],
    ['📦 Triple coffre', fr ? '1 trésor sur 3 coffres.' : '1 treasure in 3 chests.'],
    ['🎨 Roue couleur', fr ? 'Roue à 6 couleurs.' : '6-color wheel.'],
  ];
  // Plusieurs embeds si trop long
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
      .setTitle(fr ? `📖 Règles des jeux${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}` : `📖 Game rules${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`)
      .setDescription(desc)
      .setFooter({ text: fr ? 'Mise avant de lancer · parties privées' : 'Bet before playing · private games' })
  );
  return { embeds, components: [] };
}

function modalInput(id, label, { placeholder, value, required = true, max = 30 } = {}) {
  const ti = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
  if (placeholder) ti.setPlaceholder(placeholder);
  if (value) ti.setValue(value);
  return new ActionRowBuilder().addComponents(ti);
}

const betLabel = (bal) => {
  const s = `Mise (solde: ${num(bal)} ${COIN_PLAIN})`;
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
    return i.reply({ content: on ? `⭐ **${GAME_NAMES[game] || game}** ajouté aux favoris.` : `☆ **${GAME_NAMES[game] || game}** retiré des favoris.`, flags: EPH });
  }

  const instantKey = i.customId.slice('panel_'.length);
  if (INSTANT[instantKey]) {
    const payload = INSTANT[instantKey].picker(coef(instantKey));
    // Ajoute bouton favori
    const favOn = getFavs(i.user.id).has(instantKey);
    const favRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`panel_favtoggle_${instantKey}`)
        .setLabel(favOn ? 'Retirer des favoris' : 'Ajouter aux favoris')
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
      return i.reply({ ...buildGameMenuPayload(i.user.id, 0, 'all'), flags: EPH });
    case 'panel_favs':
      return i.reply({ ...buildGameMenuPayload(i.user.id, 0, 'favs'), flags: EPH });
    case 'panel_search':
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_search_game')
          .setTitle('🔍 Rechercher un jeu')
          .addComponents(modalInput('q', 'Nom du jeu (ex : poker, dés, crash)', { placeholder: 'mines, slots…', max: 40 }))
      );
    case 'panel_home': {
      const payload = await buildDmPlayPayload(i.user.id);
      if (fromEphemeral(i) && (i.isButton() || i.isModalSubmit())) {
        return i.update(payload);
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
      if (!channel) return i.editReply({ content: 'Impossible d’accéder à la conversation.' });
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
      return i.editReply({ content: `🧹 **${deleted}** message(s) supprimé(s). Panneau renvoyé.` }).catch(() => {});
    }
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
            // Supprime autant de messages du bot que possible
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
            content: L(i.user.id, '🧹 Tout a été nettoyé · parties fermées · panneau renvoyé.', '🧹 Everything cleaned · games closed · fresh panel sent.'),
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
    case 'panel_rules': {
      return i.reply({ ...buildRulesPayload(i.user.id), flags: EPH });
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
      // Envoi par pseudo : uniquement un membre du serveur
      const guildId = resolveGuildId(i);
      if (!guildId) {
        return i.reply({
          content: L(i.user.id, '⚠️ Ouvre **Start** depuis le serveur pour pouvoir envoyer des coins.', '⚠️ Use **Start** from the server to send coins.'),
          flags: EPH,
        });
      }
      const bal = await getBalance(i.user.id);
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_send_name')
          .setTitle(L(i.user.id, `💸 Envoyer des ${COIN_PLAIN}`, `💸 Send ${COIN_PLAIN}`))
          .addComponents(
            modalInput('to', L(i.user.id, 'Pseudo du joueur (exact)', 'Exact username'), {
              placeholder: L(i.user.id, 'ex : JeanDupont', 'ex : JohnDoe'),
              max: 32,
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
  if (id === 'modal_send_name' || id.startsWith('modal_send_')) {
    let toId = null;
    if (id === 'modal_send_name') {
      const name = String(get('to') || '').trim().toLowerCase();
      if (!name) return respondText(i, L(i.user.id, 'Indique un pseudo.', 'Enter a username.'));
      const guildId = resolveGuildId(i);
      if (!guildId) {
        return respondText(i, L(i.user.id, 'Ouvre Start depuis le serveur pour envoyer des coins.', 'Open Start from the server to send coins.'));
      }
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return respondText(i, L(i.user.id, 'Serveur introuvable.', 'Server not found.'));
      // Cherche le membre par username ou globalName (doit être sur le serveur)
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
            `❌ Aucun membre **${escapeMarkdown(get('to'))}** trouvé sur le serveur. Le pseudo doit être exact et la personne doit être présente.`,
            `❌ No member **${escapeMarkdown(get('to'))}** found on the server. Username must be exact and the person must be on the server.`
          )
        );
      }
      toId = member.id;
    } else {
      toId = id.slice('modal_send_'.length);
      if (!/^\d{15,25}$/.test(toId)) {
        return respondText(i, L(i.user.id, 'Destinataire invalide.', 'Invalid recipient.'));
      }
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
    // Notif MP au destinataire
    await dmUser(toId, {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.green)
          .setTitle(`💸 Tu as reçu des ${COIN_PLAIN}`)
          .setDescription(
            `<@${i.user.id}> t’a envoyé **${fmt(amount)}**.\n` +
              `Nouveau solde : **${fmt(toBal)}**`
          )
          .setTimestamp(),
      ],
    });
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
    .setTitle('✦ Admin')
    .setDescription(`Contrôle propriétaire · monnaie **${COIN}**\nChaque action publique indique **qui** l’a faite.`)
    .addFields(
      { name: '💰 Économie', value: 'Ajouter · Retirer · Définir · Voir · Offrir all', inline: false },
      { name: '💥 Resets', value: 'Soldes · All-time · Stats', inline: true },
      { name: '🎚️ Live', value: 'Mult · Events · Boosts', inline: true },
      { name: '📡 Salons', value: 'All-time · Notifs · Classement', inline: true }
    )
    .setFooter({ text: 'Owner only' })
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
    new ButtonBuilder().setCustomId('admin_resetstats').setLabel('Reset stats').setEmoji('📊').setStyle(ButtonStyle.Danger)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_mult').setLabel('Multiplicateurs').setEmoji('🎚️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_event').setLabel('Événement').setEmoji('📢').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_annonce').setLabel('Annonce').setEmoji('📣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_alltimechan').setLabel('Salon all-time').setEmoji('🏆').setStyle(ButtonStyle.Secondary)
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_notifchan').setLabel('Salon notifs').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_pokerchan').setLabel('Salon online').setEmoji('🌐').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_top').setLabel('Classement').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_topall').setLabel('All-time').setEmoji('👑').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row1, row2, row3, row4] };
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
      await dmUser(uid, {
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.green)
            .setTitle('🎉 Giveaway — tu as gagné !')
            .setDescription(`Tu reçois **${fmt(ev.amount)}**.`)
            .setTimestamp(),
        ],
      });
    } catch (e) {
      console.error('[giveaway] credit', e?.message || e);
    }
  }
  // Notifie les perdants inscrits
  for (const uid of pool) {
    if (ev.winners.has(uid)) continue;
    await dmUser(uid, {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.grey)
          .setTitle('🎉 Giveaway terminé')
          .setDescription(
            `Tirage terminé. Gagnant(s) : ${[...ev.winners].map((id) => `<@${id}>`).join(', ') || 'personne'}.`
          )
          .setTimestamp(),
      ],
    });
  }
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
    return i.reply({ content: 'Cette récompense n’est plus disponible.' });
  }
  if (ev.expiresAt && Date.now() > ev.expiresAt) {
    await expireClaimEvent(eventId);
    return i.reply({ content: '⏱️ Cet événement a expiré.' });
  }
  if (ev.winners.has(i.user.id)) return i.reply({ content: 'Tu as déjà réclamé ta part !' });
  if (ev.winners.size >= ev.maxWinners) {
    ev.finished = true;
    activeEvents.delete(eventId);
    return i.reply({ content: 'Plus de places disponibles.' });
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
    }).catch(() => i.reply({ content: `✅ Tu as reçu **${fmt(ev.amount)}** !` }));
    await i.followUp({ content: `✅ Tu as reçu **${fmt(ev.amount)}** !` }).catch(() => {});
  } catch (e) {
    ev.winners.delete(i.user.id);
    console.error('[event] claim', e?.message || e);
    if (!i.replied && !i.deferred) {
      await i.reply({ content: '⚠️ Erreur lors du crédit.' }).catch(() => {});
    }
  }
}

async function handleEventJoin(i) {
  const eventId = i.customId.slice('event_join_'.length);
  const ev = activeEvents.get(eventId);
  if (!ev || ev.finished || ev.type !== 'giveaway') return i.reply({ content: 'Ce giveaway est terminé.' });
  if (ev.expiresAt && Date.now() > ev.expiresAt) {
    await finishGiveaway(eventId);
    return i.reply({ content: '⏱️ Le giveaway est terminé.' });
  }
  if (ev.entries.has(i.user.id)) return i.reply({ content: 'Tu es déjà inscrit !' });
  ev.entries.add(i.user.id);
  try {
    await i.update({
      embeds: [giveawayEmbed(ev)],
      components: [eventActionRow(eventId, 'giveaway', false)],
    }).catch(() => {});
    await i.followUp({ content: '🎟️ Tu es inscrit au giveaway ! Bonne chance.' }).catch(() =>
      i.reply({ content: '🎟️ Tu es inscrit au giveaway ! Bonne chance.' }).catch(() => {})
    );
  } catch (e) {
    console.error('[giveaway] join', e?.message || e);
  }
}

async function postBoostEvent(i, kind, minutes) {
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
  const payload = {
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
  };
  await i.reply({ content: `✅ Boost **${p.label}** lancé · envoi des MP en cours…`, flags: EPH });
  const { ok, fail } = await dmGuildEveryone(i.guild, payload);
  return i.followUp({ content: `📬 Boost notifié en MP : **${ok}** ok · **${fail}** échecs (MP fermés).`, flags: EPH }).catch(() => {});
}

async function createClaimOrGiveaway(i, type, amount, winners, minutes) {
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

  const payload = {
    embeds: [type === 'giveaway' ? giveawayEmbed(ev) : claimEventEmbed(ev)],
    components: [eventActionRow(eventId, type, false)],
  };

  await i.reply({
    content:
      type === 'giveaway'
        ? `✅ Giveaway créé : **${fmt(amount)}** × ${maxWinners} · tirage dans **${minutes} min** · MP en cours…`
        : `✅ Claim créé : **${fmt(amount)}** × ${maxWinners}` +
          (minutes > 0 ? ` · expire dans **${minutes} min**` : '') +
          ' · MP en cours…',
    flags: EPH,
  });
  const { ok, fail } = await dmGuildEveryone(i.guild, payload);
  return i.followUp({ content: `📬 Envoyé en MP : **${ok}** ok · **${fail}** échecs.`, flags: EPH }).catch(() => {});
}

const MULT_INFO = {
  mines: () => `1er 💎 : Easy ${fx(minesMultiplier(1, LEVELS.easy.mines))} · Impossible ${fx(minesMultiplier(1, LEVELS.impossible.mines))}`,
  bj: (c) => `victoire ${fx(2 * c)} · blackjack ${fx(2.5 * c)}`,
  roulette: (c) => `couleur/pair/impair ${fx(2 * c)} · numéro ${fx(36 * c)}`,
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
    .setTitle('🎚️ Multiplicateurs des jeux')
    .setColor(COLORS.red)
    .setDescription(
      `Coefficient × tous les gains (x1.00 = normal). Plage ${fx(MULT_MIN)}–${fx(MULT_MAX)}.\n` +
        `**Page ${p + 1}/${totalPages}**\n\n${lines.join('\n\n')}`.slice(0, 4000) +
        (note ? `\n\n${note}` : '')
    );

  const select = new StringSelectMenuBuilder()
    .setCustomId('admin_multpick')
    .setPlaceholder('Choisis le jeu à modifier')
    .addOptions(
      slice.map((g) => ({
        label: (GAME_NAMES[g] || g).replace(/^\S+\s/, '').slice(0, 100),
        value: g,
        description: `Coefficient actuel : ${fx(coef(g))}`.slice(0, 100),
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

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), nav] };
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
    if (action === 'mult') return i.reply({ ...multAdminPayload(null, 0), flags: EPH });
    if (action.startsWith('multpage_')) {
      const page = Number(action.slice('multpage_'.length));
      if (!Number.isFinite(page) || page < 0) return i.deferUpdate().catch(() => {});
      return i.update(multAdminPayload(null, page));
    }
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
    if (action === 'resetstats') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_resetstats')
          .setTitle('📊 Reset toutes les stats')
          .addComponents(modalInput('confirm', 'Tape RESET pour confirmer', { placeholder: 'RESET', max: 10 }))
      );
    }
    if (action === 'top') {
      await i.deferReply({ flags: EPH });
      return i.editReply({ embeds: [await buildLeaderboardEmbed('fr')] });
    }
    if (action === 'topall') {
      await i.deferReply({ flags: EPH });
      return i.editReply({ embeds: [await buildAllTimeLeaderboardEmbed('fr')] });
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
    if (action === 'pokerchan') return createPokerChannel(i);
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
        await i.reply({ content: `✅ Soldes reset : **${count}** joueur(s) à 0. MP en cours…`, flags: EPH });
        const { ok, fail } = await dmGuildEveryone(i.guild, {
          embeds: [
            new EmbedBuilder()
              .setTitle('💥 Reset des soldes')
              .setColor(COLORS.red)
              .setDescription(`👤 Par <@${i.user.id}>\nTous les soldes ont été remis à **0**.`)
              .setTimestamp(),
          ],
        });
        return i.followUp({ content: `📬 MP : **${ok}** ok · **${fail}** échecs.`, flags: EPH }).catch(() => {});
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
      await i.reply({ content: '✅ Classement all-time réinitialisé. MP en cours…', flags: EPH });
      const r1 = await dmGuildEveryone(i.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle('👑 Reset classement all-time')
            .setColor(COLORS.red)
            .setDescription(`👤 Par <@${i.user.id}>\nTous les records de solde max ont été effacés.`)
            .setTimestamp(),
        ],
      });
      return i.followUp({ content: `📬 MP : **${r1.ok}** ok · **${r1.fail}** échecs.`, flags: EPH }).catch(() => {});
    }

    if (id === 'modal_admin_resetstats') {
      const confirm = i.fields.getTextInputValue('confirm')?.trim().toUpperCase();
      if (confirm !== 'RESET') return respondText(i, 'Annulé : tu dois taper **RESET** pour confirmer.');
      try {
        const { error } = await supabase.from('game_history').delete().neq('user_id', '__impossible__');
        if (error) throw error;
        await i.reply({ content: '✅ Statistiques réinitialisées. MP en cours…', flags: EPH });
        const r2 = await dmGuildEveryone(i.guild, {
          embeds: [
            new EmbedBuilder()
              .setTitle('📊 Reset des statistiques')
              .setColor(COLORS.red)
              .setDescription(`👤 Par <@${i.user.id}>\nTout l’historique des parties a été effacé.`)
              .setTimestamp(),
          ],
        });
        return i.followUp({ content: `📬 MP : **${r2.ok}** ok · **${r2.fail}** échecs.`, flags: EPH }).catch(() => {});
      } catch (e) {
        console.error('[resetstats]', e?.message || e);
        return respondText(i, `Erreur reset stats : ${explainError(e)}`);
      }
    }

    if (id === 'modal_admin_annonce') {
      const amount = parseAmount(i.fields.getTextInputValue('amount')?.trim());
      const reward = i.fields.getTextInputValue('reward')?.trim();
      if (!amount) return respondText(i, 'Montant invalide.');
      if (!reward) return respondText(i, 'Indique la récompense en texte.');
      await i.reply({ content: `✅ Annonce **${fmt(amount)}** = **${reward}** · MP en cours…`, flags: EPH });
      const r3 = await dmGuildEveryone(i.guild, {
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
      return i.followUp({ content: `📬 MP : **${r3.ok}** ok · **${r3.fail}** échecs.`, flags: EPH }).catch(() => {});
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
      await i.reply({ content: `✅ **${fmt(amount)}** offerts à **${count}** compte(s). MP en cours…`, flags: EPH });
      const rg = await dmGuildEveryone(i.guild, {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎁 Cadeau pour tous')
            .setColor(COLORS.green)
            .setDescription(
              `👤 Par <@${i.user.id}>\n💰 **${fmt(amount)}** offerts à **chaque** joueur.`
            )
            .setTimestamp(),
        ],
      });
      return i.followUp({ content: `📬 MP : **${rg.ok}** ok · **${rg.fail}** échecs.`, flags: EPH }).catch(() => {});
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
    const dmText =
      action === 'add'
        ? `<@${i.user.id}> t’a **ajouté** **${fmt(amount)}**.\nNouveau solde : **${fmt(balance)}**`
        : action === 'remove'
          ? `<@${i.user.id}> t’a **retiré** **${fmt(amount)}**.\nNouveau solde : **${fmt(balance)}**`
          : `<@${i.user.id}> a **défini** ton solde à **${fmt(balance)}**.`;
    await dmUser(userId, {
      embeds: [
        new EmbedBuilder()
          .setColor(action === 'remove' ? COLORS.red : COLORS.green)
          .setTitle(action === 'set' ? '🎯 Solde modifié' : action === 'add' ? '➕ Coins reçus' : '➖ Coins retirés')
          .setDescription(dmText)
          .setTimestamp(),
      ],
    });
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
  await dmUser(targetId, {
    embeds: [
      new EmbedBuilder()
        .setColor(sign > 0 ? COLORS.green : COLORS.red)
        .setTitle(sign > 0 ? '➕ Coins reçus' : '➖ Coins retirés')
        .setDescription(
          sign > 0
            ? `<@${msg.author.id}> t’a **ajouté** **${fmt(amount)}**.\nNouveau solde : **${fmt(balance)}**`
            : `<@${msg.author.id}> t’a **retiré** **${fmt(amount)}**.\nNouveau solde : **${fmt(balance)}**`
        )
        .setTimestamp(),
    ],
  });
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
  online: 'online',
  poker: 'online', // alias rétrocompat
};
const alltimeBoardMessages = new Map();

// ============================================================
//  POKER MULTIJOUEUR (Texas Hold'em simplifié, max 4)
// ============================================================
const POKER_MAX = 4;
const pokerLobbies = new Map(); // guildId -> lobby/table state

const POKER_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const POKER_SUITS = ['♠', '♥', '♦', '♣'];
const pokerRankVal = (r) => POKER_RANKS.indexOf(r);

function newPokerDeck() {
  const d = [];
  for (const s of POKER_SUITS) for (const r of POKER_RANKS) d.push({ r, s });
  return shuffle(d);
}
const pokerCardStr = (c) => (c ? `\`${c.r}${c.s}\`` : '`??`');
function pokerCardLines(c, hidden = false) {
  if (hidden || !c) return ['+-----+', '|/////|', '|/////|', '|/////|', '+-----+'];
  return ['+-----+', `|${padR(c.r, 2)}   |`, `|  ${c.s}  |`, `|   ${padL(c.r, 2)}|`, '+-----+'];
}
function pokerHandArt(cards, hiddenExtra = 0) {
  const blocks = cards.map((c) => pokerCardLines(c, false));
  for (let k = 0; k < hiddenExtra; k++) blocks.push(pokerCardLines(null, true));
  if (!blocks.length) return ['(aucune carte)'];
  return sideBySide(blocks, ' ');
}

// Évaluation main poker (meilleures 5 parmi jusqu'à 7)
function evaluatePokerHand(cards) {
  if (!cards || cards.length < 5) return { rank: 0, name: 'Incomplet', score: [0] };
  const vals = cards.map((c) => pokerRankVal(c.r));
  const suits = cards.map((c) => c.s);
  // Toutes combinaisons de 5
  const combos = [];
  const n = cards.length;
  const idx = [];
  function rec(start, need) {
    if (need === 0) {
      combos.push(idx.map((i) => cards[i]));
      return;
    }
    for (let i = start; i <= n - need; i++) {
      idx.push(i);
      rec(i + 1, need - 1);
      idx.pop();
    }
  }
  rec(0, 5);
  let best = null;
  for (const five of combos) {
    const scored = scoreFive(five);
    if (!best || compareScores(scored.score, best.score) > 0) best = scored;
  }
  return best || { rank: 0, name: 'Rien', score: [0] };
}
function scoreFive(five) {
  const vals = five.map((c) => pokerRankVal(c.r)).sort((a, b) => b - a);
  const suits = five.map((c) => c.s);
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v, n]) => ({ v: Number(v), n }))
    .sort((a, b) => b.n - a.n || b.v - a.v);
  const isFlush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(vals)].sort((a, b) => b - a);
  let isStraight = false;
  let topStraight = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) {
      isStraight = true;
      topStraight = uniq[0];
    }
    // A-2-3-4-5
    if (uniq[0] === 12 && uniq[1] === 3 && uniq[2] === 2 && uniq[3] === 1 && uniq[4] === 0) {
      isStraight = true;
      topStraight = 3; // 5-high
    }
  }
  if (isStraight && isFlush) return { rank: 8, name: topStraight === 12 ? 'Quinte flush royale' : 'Quinte flush', score: [8, topStraight] };
  if (groups[0].n === 4) return { rank: 7, name: 'Carré', score: [7, groups[0].v, groups[1].v] };
  if (groups[0].n === 3 && groups[1].n === 2) return { rank: 6, name: 'Full', score: [6, groups[0].v, groups[1].v] };
  if (isFlush) return { rank: 5, name: 'Couleur', score: [5, ...vals] };
  if (isStraight) return { rank: 4, name: 'Suite', score: [4, topStraight] };
  if (groups[0].n === 3) return { rank: 3, name: 'Brelan', score: [3, groups[0].v, ...groups.slice(1).map((g) => g.v)] };
  if (groups[0].n === 2 && groups[1].n === 2) {
    const high = Math.max(groups[0].v, groups[1].v);
    const low = Math.min(groups[0].v, groups[1].v);
    return { rank: 2, name: 'Double paire', score: [2, high, low, groups[2].v] };
  }
  if (groups[0].n === 2) return { rank: 1, name: 'Paire', score: [1, groups[0].v, ...groups.slice(1).map((g) => g.v)] };
  return { rank: 0, name: 'Carte haute', score: [0, ...vals] };
}
function compareScores(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

function pokerLobbyEmbed(lobby) {
  const g = ONLINE_GAMES[lobby.game] || ONLINE_GAMES.poker;
  const max = lobby.maxPlayers || g.max || POKER_MAX;
  const spots = lobby.players.map((p, i) => `${i + 1}. <@${p.id}>${p.choice ? ` · ${p.choice}` : ''}`).join('\n') || '_Personne pour l’instant_';
  const e = new EmbedBuilder()
    .setColor(COLORS.violet)
    .setTitle(`${g.emoji} ${g.name}`)
    .setDescription(
      `**Mise** : ${fmt(lobby.stake)} par joueur\n` +
        `**Pot** : ${fmt(lobby.stake * lobby.players.length)}\n` +
        `**Places** : ${lobby.players.length}/${max}\n` +
        `**Règle** : ${g.desc}\n\n` +
        `**Joueurs**\n${spots}\n\n` +
        (lobby.status === 'lobby'
          ? 'Clique **Rejoindre** pour payer la mise.\nL’hôte lance quand il veut (même seul).\nTout se joue **dans ce salon** (pas en MP).'
          : lobby.status === 'playing'
            ? 'Partie en cours — suis les messages ci-dessous.'
            : 'Partie terminée.')
    )
    .setFooter({ text: `Hôte : ${lobby.hostName}` })
    .setTimestamp();
  return e;
}
function pokerLobbyRows(lobby) {
  if (lobby.status !== 'lobby') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('poker_new').setLabel('Nouvelle partie').setEmoji('🌐').setStyle(ButtonStyle.Success)
      ),
    ];
  }
  const g = ONLINE_GAMES[lobby.game] || ONLINE_GAMES.poker;
  const max = lobby.maxPlayers || g.max || POKER_MAX;
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('poker_join')
        .setLabel('Rejoindre')
        .setEmoji('✋')
        .setStyle(ButtonStyle.Success)
        .setDisabled(lobby.players.length >= max),
      new ButtonBuilder().setCustomId('poker_leave').setLabel('Quitter').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('poker_start').setLabel('Lancer').setEmoji('▶️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('poker_cancel').setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger)
    ),
  ];
  if (lobby.game === 'roulette') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('online_choice_rouge').setLabel('Rouge').setEmoji('🔴').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('online_choice_noir').setLabel('Noir').setEmoji('⚫').setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (lobby.game === 'coinflip') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('online_choice_pile').setLabel('Pile').setEmoji('🪙').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('online_choice_face').setLabel('Face').setEmoji('🪙').setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (lobby.game === 'horses') {
    rows.push(
      new ActionRowBuilder().addComponents(
        ...[1, 2, 3, 4].map((n) =>
          new ButtonBuilder().setCustomId(`online_choice_h${n}`).setLabel(`Cheval ${n}`).setEmoji('🐎').setStyle(ButtonStyle.Primary)
        )
      )
    );
  } else if (lobby.game === 'crash') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('online_choice_x15').setLabel('x1.5').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('online_choice_x2').setLabel('x2').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('online_choice_x3').setLabel('x3').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('online_choice_x5').setLabel('x5').setStyle(ButtonStyle.Danger)
      )
    );
  }
  return rows;
}

const ONLINE_GAMES = {
  poker: { key: 'poker', name: 'Poker Hold’em', emoji: '🃏', max: 4, desc: '2 cartes + board · meilleur jeu gagne le pot' },
  bjtable: { key: 'bjtable', name: 'Blackjack table', emoji: '🃏', max: 4, desc: 'Tous vs le croupier · ceux qui battent le croupier se partagent le pot' },
  roulette: { key: 'roulette', name: 'Roulette', emoji: '🎡', max: 4, desc: 'Chacun choisit rouge/noir · les bons pronostics se partagent le pot' },
  coinflip: { key: 'coinflip', name: 'Pile ou Face', emoji: '🪙', max: 2, desc: '2 joueurs · pile vs face · le gagnant prend tout' },
  dicewar: { key: 'dicewar', name: 'Guerre de dés', emoji: '🎲', max: 4, desc: 'Chacun lance un dé · le plus haut remporte le pot' },
  highcard: { key: 'highcard', name: 'Carte haute', emoji: '⬆️', max: 4, desc: 'Chacun tire une carte · la plus haute gagne' },
  war: { key: 'war', name: 'Bataille', emoji: '⚔️', max: 4, desc: 'Chacun une carte · la plus haute gagne le pot' },
  slotsrace: { key: 'slotsrace', name: 'Course de slots', emoji: '🎰', max: 4, desc: 'Chacun un spin · le meilleur multiplicateur gagne' },
  horses: { key: 'horses', name: 'Course hippique', emoji: '🏇', max: 4, desc: 'Chacun choisit un cheval · le bon numéro gagne' },
  crash: { key: 'crash', name: 'Crash ensemble', emoji: '🚀', max: 4, desc: 'Multi partagé · ceux sous le crash se partagent le pot' },
};

function buildPokerPanelPayload() {
  const list = Object.values(ONLINE_GAMES)
    .map((g) => `${g.emoji} **${g.name}** — ${g.desc}`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setTitle('🌐 Jeux en ligne')
    .setDescription(
      [
        'Parties multijoueurs dans ce salon (max **4** sauf pile/face : **2**).',
        '',
        '1. **Créer une partie** → choisis le jeu et la mise',
        '2. Les autres **rejoignent** (mise prélevée)',
        '3. L’**hôte** lance quand il veut (même à 1)',
        '4. Tout se passe **ici** (pas en MP) avec les explications',
        '',
        list,
      ].join('\n')
    )
    .setFooter({ text: 'Admin → Salon online pour créer ce salon' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('poker_new').setLabel('Créer une partie').setEmoji('🌐').setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row] };
}

async function createPokerChannel(i) {
  const guild = i.guild;
  const P = PermissionFlagsBits;
  const me = guild.members.me;
  const existing = (await getSavedChannel(guild, 'online')) || (await getSavedChannel(guild, 'poker'));
  if (existing) {
    await existing.send(buildPokerPanelPayload()).catch(() => {});
    return i.reply({ content: `✅ Salon online déjà présent : <#${existing.id}> (panneau renvoyé).`, flags: EPH });
  }
  if (!me.permissions.has(P.ManageChannels)) return i.reply({ content: NEED_MANAGE_CHANNELS, flags: EPH });
  const channel = await guild.channels.create({
    name: 'online',
    type: ChannelType.GuildText,
    topic: 'Jeux multijoueurs 🌐 — poker, blackjack, roulette, dés…',
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
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.MentionEveryone, P.ManageMessages]),
      },
    ],
  });
  const panelMsg = await channel.send(buildPokerPanelPayload());
  await panelMsg.pin().catch(() => {});
  const saved = await saveChannel(guild.id, 'online', channel.id);
  return i.reply({
    content: `✅ Salon <#${channel.id}> créé (jeux en ligne).${saved ? '' : DB_WARN}`,
    flags: EPH,
  });
}

async function pokerCreateLobby(i, stake, gameKey = 'poker', maxPlayers = null) {
  const guildId = i.guild?.id;
  if (!guildId) return respondText(i, 'Utilise cette commande dans le serveur.');
  if (stake <= 0 || stake > MAX_ADMIN_AMOUNT) return respondText(i, 'Mise invalide.');
  const gdef = ONLINE_GAMES[gameKey] || ONLINE_GAMES.poker;
  const prev = pokerLobbies.get(guildId);
  if (prev && prev.status === 'lobby') return respondText(i, 'Une table est déjà ouverte. Rejoins-la ou annule-la d’abord.');
  if (prev && prev.status === 'playing') return respondText(i, 'Une partie est déjà en cours.');

  const hardMax = gdef.max || POKER_MAX;
  let seats = Number(maxPlayers);
  if (!Number.isFinite(seats)) seats = hardMax;
  seats = Math.max(1, Math.min(8, Math.floor(seats)));
  // ne pas dépasser le max du jeu (ex. pile/face = 2)
  seats = Math.min(seats, hardMax);

  const bal = await getBalance(i.user.id);
  if (bal < stake) return respondText(i, `Solde insuffisant (il te faut ${fmt(stake)}).`);

  const deb = await debit(i.user.id, stake);
  if (deb === null) return respondText(i, t(i.user.id, 'insufficient'));

  const lobby = {
    guildId,
    game: gdef.key,
    hostId: i.user.id,
    hostName: i.user.globalName || i.user.username,
    stake,
    maxPlayers: seats,
    players: [{ id: i.user.id, name: i.user.globalName || i.user.username, hole: [], choice: null, stand: false, bust: false }],
    status: 'lobby',
    community: [],
    pot: stake,
    channelId: i.channel.id,
    messageId: null,
    deck: null,
    bjWait: null,
  };
  pokerLobbies.set(guildId, lobby);

  const msg = await i.channel.send({
    content: `${gdef.emoji} **${gdef.name}** ouverte ! @everyone\nMise : **${fmt(stake)}** · max **${seats}** · hôté par <@${i.user.id}>\n${gdef.desc}`,
    embeds: [pokerLobbyEmbed(lobby)],
    components: pokerLobbyRows(lobby),
    allowedMentions: { parse: ['everyone'] },
  });
  lobby.messageId = msg.id;
  return i.reply({ content: `✅ Table **${gdef.name}** créée (−${fmt(stake)}) · max **${seats}** places.`, flags: EPH });
}

async function pokerUpdateLobbyMessage(lobby) {
  try {
    const ch = await client.channels.fetch(lobby.channelId).catch(() => null);
    if (!ch || !lobby.messageId) return;
    const msg = await ch.messages.fetch(lobby.messageId).catch(() => null);
    if (!msg) return;
    await msg.edit({ embeds: [pokerLobbyEmbed(lobby)], components: pokerLobbyRows(lobby) });
  } catch (e) {
    console.error('[poker] update lobby', e?.message || e);
  }
}

async function handlePokerButton(i) {
  const id = i.customId;
  const guildId = i.guild?.id;
  if (!guildId) return respondText(i, 'Serveur uniquement.');

  if (id === 'poker_new') {
    // Pas d'emoji dans options.emoji : Discord rejette certains unicode (ex. 🂡)
    const opts = Object.values(ONLINE_GAMES).map((g) => ({
      label: `${g.emoji} ${g.name}`.slice(0, 100),
      value: g.key,
      description: g.desc.slice(0, 100),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId('online_pickgame')
      .setPlaceholder('Choisis le jeu en ligne')
      .addOptions(opts.slice(0, 25));
    return i.reply({
      content: '🌐 Quel jeu en ligne veux-tu ouvrir ?',
      components: [new ActionRowBuilder().addComponents(select)],
      flags: EPH,
    });
  }

  const lobby = pokerLobbies.get(guildId);

  if (id === 'online_bj_hit' || id === 'online_bj_stand') {
    if (!lobby || lobby.status !== 'playing' || lobby.game !== 'bjtable') {
      return respondText(i, 'Aucune table de blackjack en cours.');
    }
    if (!lobby.bjWait || lobby.bjWait.userId !== i.user.id) {
      return respondText(i, 'Ce n’est pas ton tour.');
    }
    const action = id === 'online_bj_hit' ? 'hit' : 'stand';
    const resolve = lobby.bjWait.resolve;
    lobby.bjWait = null;
    await i.deferUpdate().catch(() => {});
    resolve(action);
    return;
  }

  if (id === 'poker_join') {
    if (!lobby || lobby.status !== 'lobby') return respondText(i, 'Aucune table ouverte.');
    if (lobby.players.some((p) => p.id === i.user.id)) return respondText(i, 'Tu es déjà à la table.');
    const max = lobby.maxPlayers || (ONLINE_GAMES[lobby.game] || {}).max || POKER_MAX;
    if (lobby.players.length >= max) return respondText(i, `Table complète (${max}/${max}).`);
    const bal = await getBalance(i.user.id);
    if (bal < lobby.stake) return respondText(i, `Il te faut ${fmt(lobby.stake)}.`);
    const deb = await debit(i.user.id, lobby.stake);
    if (deb === null) return respondText(i, t(i.user.id, 'insufficient'));
    lobby.players.push({
      id: i.user.id,
      name: i.user.globalName || i.user.username,
      hole: [],
      choice: null,
      stand: false,
      bust: false,
    });
    lobby.pot = lobby.stake * lobby.players.length;
    await pokerUpdateLobbyMessage(lobby);
    return i.reply({ content: `✅ Tu as rejoint (−${fmt(lobby.stake)}). Pot : **${fmt(lobby.pot)}**`, flags: EPH });
  }

  if (id === 'poker_leave') {
    if (!lobby || lobby.status !== 'lobby') return respondText(i, 'Aucune table ouverte.');
    const idx = lobby.players.findIndex((p) => p.id === i.user.id);
    if (idx < 0) return respondText(i, 'Tu n’es pas à cette table.');
    if (i.user.id === lobby.hostId) return respondText(i, 'L’hôte ne peut pas quitter : utilise **Annuler**.');
    lobby.players.splice(idx, 1);
    await credit(i.user.id, lobby.stake);
    lobby.pot = lobby.stake * lobby.players.length;
    await pokerUpdateLobbyMessage(lobby);
    return i.reply({ content: `Tu as quitté · mise remboursée (${fmt(lobby.stake)}).`, flags: EPH });
  }

  if (id === 'poker_cancel') {
    if (!lobby || lobby.status !== 'lobby') return respondText(i, 'Aucune table à annuler.');
    if (i.user.id !== lobby.hostId && i.user.id !== i.guild.ownerId) {
      return respondText(i, 'Seul l’hôte (ou le propriétaire) peut annuler.');
    }
    for (const p of lobby.players) {
      await credit(p.id, lobby.stake).catch(() => {});
    }
    pokerLobbies.delete(guildId);
    await pokerUpdateLobbyMessage({ ...lobby, status: 'done', players: [] });
    try {
      const ch = await client.channels.fetch(lobby.channelId);
      const msg = await ch.messages.fetch(lobby.messageId);
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.grey)
            .setTitle('🃏 Table annulée')
            .setDescription('Mises remboursées.'),
        ],
        components: pokerLobbyRows({ status: 'done', players: [] }),
      });
    } catch {
      /* ignore */
    }
    return i.reply({ content: '✅ Table annulée, mises rendues.', flags: EPH });
  }

  if (id === 'poker_start') {
    if (!lobby || lobby.status !== 'lobby') return respondText(i, 'Aucune table à lancer.');
    if (i.user.id !== lobby.hostId) return respondText(i, 'Seul l’hôte peut lancer.');
    if (lobby.players.length < 1) return respondText(i, 'Il faut au moins 1 joueur.');
    // Jeux qui demandent un choix avant le start (roulette, coinflip, horses, crash)
    if (['roulette', 'coinflip', 'horses', 'crash'].includes(lobby.game)) {
      const missing = lobby.players.filter((p) => !p.choice);
      if (missing.length) {
        return i.reply({
          content: `Certains joueurs n’ont pas choisi : ${missing.map((p) => `<@${p.id}>`).join(', ')}\nUtilisez les boutons **Choix** sous la table.`,
          flags: EPH,
        });
      }
    }
    await i.deferReply({ flags: EPH });
    try {
      await runOnlineGame(lobby, i);
      return i.editReply({ content: '✅ Partie terminée.' });
    } catch (e) {
      console.error('[online] start', e);
      if (lobby.status === 'playing') {
        for (const p of lobby.players) await credit(p.id, lobby.stake).catch(() => {});
        pokerLobbies.delete(guildId);
      }
      return i.editReply({ content: `⚠️ Erreur : \`${String(e?.message || e).slice(0, 200)}\`` });
    }
  }

  // Choix en lobby (roulette / coinflip / horses / crash)
  if (id.startsWith('online_choice_')) {
    if (!lobby || lobby.status !== 'lobby') return respondText(i, 'Aucune table ouverte.');
    const p = lobby.players.find((x) => x.id === i.user.id);
    if (!p) return respondText(i, 'Rejoins d’abord la table.');
    const choice = id.slice('online_choice_'.length);
    p.choice = choice;
    await pokerUpdateLobbyMessage(lobby);
    return i.reply({ content: `✅ Choix enregistré : **${choice}**`, flags: EPH });
  }
}


async function runOnlineGame(lobby, hostInteraction) {
  lobby.status = 'playing';
  const ch = await client.channels.fetch(lobby.channelId);
  const game = lobby.game || 'poker';
  if (game === 'poker') return runOnlinePoker(lobby, ch);
  if (game === 'bjtable') return runOnlineBlackjack(lobby, ch);
  if (game === 'roulette') return runOnlineRoulette(lobby, ch);
  if (game === 'coinflip') return runOnlineCoinflip(lobby, ch);
  if (game === 'dicewar') return runOnlineDicewar(lobby, ch);
  if (game === 'highcard' || game === 'war') return runOnlineHighcard(lobby, ch);
  if (game === 'slotsrace') return runOnlineSlots(lobby, ch);
  if (game === 'horses') return runOnlineHorses(lobby, ch);
  if (game === 'crash') return runOnlineCrash(lobby, ch);
  return runOnlinePoker(lobby, ch);
}

function sceneEmbed(title, body, color, footer) {
  return new EmbedBuilder()
    .setColor(color ?? COLORS.violet)
    .setTitle(String(title).slice(0, 256))
    .setDescription(String(body).slice(0, 4000))
    .setFooter({ text: String(footer || 'Table en direct').slice(0, 200) });
}

/** Une seule carte qui s’anime : chaque frame remplace la précédente. */
async function playScene(msg, frames) {
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    await msg.edit({
      embeds: [
        sceneEmbed(
          f.title,
          f.body,
          f.color || ANIM_PALETTE[i % ANIM_PALETTE.length],
          f.footer || `Scène ${i + 1} / ${frames.length}`
        ),
      ],
    }).catch(() => {});
    await sleep(f.ms ?? 950);
  }
}

function meter(n, max, w = 14) {
  const f = Math.max(0, Math.min(w, Math.round((Math.max(0, n) / Math.max(0.01, max)) * w)));
  return '█'.repeat(f) + '░'.repeat(w - f);
}
function who(p) {
  return String(p.name || 'Joueur').replace(/[`\n]/g, '').slice(0, 16);
}
function potLine(lobby) {
  return `Pot **${fmt(lobby.pot)}** · ${lobby.players.length} joueur(s) · mise ${fmt(lobby.stake)}`;
}
function boardArt(cards) {
  const shown = (cards || []).filter(Boolean);
  const hidden = Math.max(0, 5 - shown.length);
  if (!shown.length && !hidden) return code(['(vide)']);
  return code(pokerHandArt(shown, hidden));
}
function holeArt(cards, n = 2) {
  const shown = (cards || []).filter(Boolean);
  if (!shown.length) return code(pokerHandArt([], n));
  return code(pokerHandArt(shown, Math.max(0, n - shown.length)));
}
function seatsBlock(players, faceUp) {
  return players
    .map((p) => `**${who(p)}** <@${p.id}>\n${faceUp ? holeArt(p.hole, p.hole?.length || 2) : holeArt([], 2)}`)
    .join('\n');
}
function bjVal(hand) {
  let t = 0;
  let aces = 0;
  for (const c of hand || []) {
    if (c.r === 'A') {
      aces++;
      t += 11;
    } else if (c.r === 'J' || c.r === 'Q' || c.r === 'K') t += 10;
    else t += Number(c.r) || 0;
  }
  while (t > 21 && aces > 0) {
    t -= 10;
    aces--;
  }
  return t;
}
function handLine(label, cards, extra = '') {
  const shown = (cards || []).filter(Boolean);
  const art = shown.length ? code(pokerHandArt(shown)) : code(pokerHandArt([], 1));
  const v = shown.length ? ` · **${bjVal(shown)}**` : '';
  return `**${label}**${v}${extra ? ` ${extra}` : ''}\n${art}`;
}

async function openStage(lobby, ch, title, body) {
  return onlineSend(lobby, ch, { embeds: [sceneEmbed(title, body, COLORS.violet, 'La partie commence')] });
}

async function purgeOnlineChannel(ch) {
  try {
    let safety = 0;
    while (safety < 20) {
      const fetched = await ch.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched || !fetched.size) break;
      const bulk = fetched.filter((m) => Date.now() - m.createdTimestamp < 13 * 24 * 60 * 60 * 1000);
      if (bulk.size >= 2) {
        await ch.bulkDelete(bulk, true).catch(() => {});
      } else {
        for (const m of fetched.values()) {
          await m.delete().catch(() => {});
          await sleep(200);
        }
      }
      safety++;
      if (fetched.size < 100) break;
    }
  } catch (e) {
    console.error('[online] purge', e?.message || e);
  }
}

async function onlineFinish(lobby, ch, embed) {
  lobby.status = 'done';
  pokerLobbies.delete(lobby.guildId);
  // Affiche le résultat un court instant, puis reset complet du salon
  try {
    await ch.send({ embeds: [embed] });
  } catch {
    /* ignore */
  }
  await sleep(3500);
  await purgeOnlineChannel(ch);
  await ch.send(buildPokerPanelPayload()).catch(() => {});
}

function onlineTrack(lobby, msg) {
  if (!lobby.msgIds) lobby.msgIds = [];
  if (msg?.id) lobby.msgIds.push(msg.id);
}
async function onlineSend(lobby, ch, payload) {
  const msg = await ch.send(payload);
  onlineTrack(lobby, msg);
  return msg;
}

async function onlinePayWinners(lobby, winnerIds) {
  const ids = winnerIds.length ? winnerIds : [];
  if (!ids.length) {
    for (const p of lobby.players) await credit(p.id, lobby.stake).catch(() => {});
    return lobby.stake;
  }
  const share = floor2(lobby.pot / ids.length);
  for (const id of ids) await credit(id, share);
  for (const p of lobby.players) {
    const u = await client.users.fetch(p.id).catch(() => null);
    if (!u) continue;
    const isWin = ids.includes(p.id);
    recordResult({
      guildId: lobby.guildId,
      user: u,
      game: lobby.game || 'poker',
      bet: lobby.stake,
      mult: isWin ? round2(share / lobby.stake) : 0,
      payout: isWin ? share : 0,
      detail: isWin ? 'win' : 'lose',
    }).catch(() => {});
  }
  return share;
}

async function runOnlinePoker(lobby, ch) {
  const deck = newPokerDeck();
  lobby.community = [];
  for (const p of lobby.players) p.hole = [];

  const msg = await openStage(
    lobby,
    ch,
    '🃏 Poker — la table s’ouvre',
    `${potLine(lobby)}\n\nLe croupier mélange. Chacun va recevoir **2 cartes**, visibles ici.\nPuis 5 cartes communes : flop, turn, river.\nLa meilleure main de 5 cartes **prend le pot**.`
  );

  const frames = [];
  // distribution carte par carte, faces visibles
  for (let round = 0; round < 2; round++) {
    for (const p of lobby.players) p.hole.push(deck.pop());
    frames.push({
      title: `🃏 Distribution — carte ${round + 1}`,
      ms: 1100,
      body:
        `${potLine(lobby)}\n` +
        `**Ce qui se passe :** une carte est posée devant chaque joueur.\n\n` +
        `${boardArt([])}\n` +
        seatsBlock(lobby.players, true),
    });
  }
  const street = async (title, explain, take) => {
    deck.pop(); // burn
    for (let k = 0; k < take; k++) lobby.community.push(deck.pop());
    frames.push({
      title,
      ms: 1300,
      color: COLORS.gold,
      body:
        `${potLine(lobby)}\n` +
        `**Ce qui se passe :** ${explain}\n\n` +
        `**Board**\n${boardArt(lobby.community)}\n` +
        seatsBlock(lobby.players, true),
    });
  };
  await street('🃏 Flop — 3 cartes', 'trois cartes communes tombent au centre.', 3);
  await street('🃏 Turn — 4e carte', 'une quatrième carte s’ajoute au board.', 1);
  await street('🃏 River — 5e carte', 'dernière carte. On compare les mains.', 1);

  const results = lobby.players.map((p) => ({
    player: p,
    ev: evaluatePokerHand([...p.hole, ...lobby.community]),
  }));
  results.sort((a, b) => compareScores(b.ev.score, a.ev.score));
  const best = results[0].ev.score;
  const winners = results.filter((r) => compareScores(r.ev.score, best) === 0);

  frames.push({
    title: '🃏 Abattage',
    ms: 1600,
    color: COLORS.green,
    body:
      `**Ce qui se passe :** chaque main est lue. Le plus fort gagne.\n\n` +
      `**Board**\n${boardArt(lobby.community)}\n` +
      results
        .map((r, i) => {
          const mark = winners.some((w) => w.player.id === r.player.id) ? '🏆' : `${i + 1}.`;
          return `${mark} **${who(r.player)}** — **${r.ev.name}**\n${holeArt(r.player.hole)}`;
        })
        .join('\n'),
  });
  await playScene(msg, frames);

  const share = await onlinePayWinners(lobby, winners.map((w) => w.player.id));
  const verdict =
    winners.length === 1
      ? `<@${winners[0].player.id}> remporte **${fmt(lobby.pot)}** avec **${winners[0].ev.name}**.`
      : `Égalité : ${winners.map((w) => `<@${w.player.id}>`).join(', ')} se partagent le pot (**${fmt(share)}** chacun).`;
  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(COLORS.green)
      .setTitle('🃏 Poker — résultat')
      .setDescription(
        (
          `${verdict}\n\n**Board**\n${boardArt(lobby.community)}\n` +
          results
            .map((r) => {
              const win = winners.some((w) => w.player.id === r.player.id);
              return `${win ? '🏆' : '•'} <@${r.player.id}> · ${r.player.hole.map(pokerCardStr).join(' ')} · **${r.ev.name}**`;
            })
            .join('\n')
        ).slice(0, 4000)
      )
  );
}

async function runOnlineBlackjack(lobby, ch) {
  const deck = newPokerDeck();
  const dealer = [];
  for (const p of lobby.players) {
    p.hole = [];
    p.stand = false;
    p.bust = false;
  }

  // Distribution
  for (const p of lobby.players) p.hole.push(deck.pop());
  dealer.push(deck.pop());
  for (const p of lobby.players) p.hole.push(deck.pop());
  dealer.push(deck.pop()); // hole card

  const tableBody = (extra = '') => {
    const dealerShown = dealer.length ? [dealer[0]] : [];
    return (
      `${potLine(lobby)}\n` +
      (extra ? `**${extra}**\n\n` : '\n') +
      handLine('Croupier', dealerShown, dealer.length > 1 ? '(1 carte cachée)' : '') +
      '\n' +
      lobby.players
        .map((p) => {
          const v = bjVal(p.hole);
          const tag = p.bust ? '💥 BUST' : p.stand ? '✋ RESTER' : '';
          return handLine(who(p), p.hole, tag ? `· ${tag} (${v})` : `· ${v}`);
        })
        .join('\n')
    );
  };

  let msg = await openStage(
    lobby,
    ch,
    '🃏 Blackjack — distribution',
    tableBody('Chacun a 2 cartes. À ton tour : **Tirer** ou **Rester**.')
  );

  // Tour de chaque joueur
  for (const p of lobby.players) {
    if (bjVal(p.hole) >= 21) {
      p.stand = true;
      if (bjVal(p.hole) > 21) p.bust = true;
      continue;
    }
    while (!p.stand && !p.bust) {
      const rows = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('online_bj_hit').setLabel('Tirer').setEmoji('🃏').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('online_bj_stand').setLabel('Rester').setEmoji('✋').setStyle(ButtonStyle.Secondary)
        ),
      ];
      await msg.edit({
        embeds: [
          sceneEmbed(
            `🃏 Tour de ${who(p)}`,
            tableBody(`À <@${p.id}> de jouer (30 s) — **Tirer** ou **Rester**.`),
            COLORS.violet,
            `Tour de ${who(p)}`
          ),
        ],
        components: rows,
      }).catch(() => {});

      const action = await new Promise((resolve) => {
        let done = false;
        const finish = (a) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(a);
        };
        lobby.bjWait = { userId: p.id, resolve: finish };
        const timer = setTimeout(() => {
          if (lobby.bjWait?.userId === p.id) lobby.bjWait = null;
          finish('stand');
        }, 30000);
      });

      if (action === 'hit') {
        p.hole.push(deck.pop());
        const v = bjVal(p.hole);
        if (v > 21) {
          p.bust = true;
          p.stand = true;
        } else if (v === 21) {
          p.stand = true;
        }
      } else {
        p.stand = true;
      }
    }
  }

  // Croupier
  await msg.edit({
    embeds: [
      sceneEmbed(
        '🃏 Croupier',
        `${potLine(lobby)}\n**Le croupier révèle sa carte cachée et tire jusqu’à 17.**\n\n` +
          handLine('Croupier', dealer) +
          '\n' +
          lobby.players
            .map((p) => handLine(who(p), p.hole, p.bust ? '· 💥' : `· ${bjVal(p.hole)}`))
            .join('\n'),
        COLORS.gold,
        'Tour du croupier'
      ),
    ],
    components: [],
  }).catch(() => {});
  await sleep(1200);

  while (bjVal(dealer) < 17) {
    dealer.push(deck.pop());
    await msg.edit({
      embeds: [
        sceneEmbed(
          '🃏 Croupier tire',
          `${potLine(lobby)}\n**Nouvelle carte du croupier…**\n\n` + handLine('Croupier', dealer),
          COLORS.gold,
          `Croupier ${bjVal(dealer)}`
        ),
      ],
    }).catch(() => {});
    await sleep(900);
  }

  const dv = bjVal(dealer);
  const survivors = lobby.players.filter((p) => !p.bust && bjVal(p.hole) <= 21 && (dv > 21 || bjVal(p.hole) > dv));
  const pushes = lobby.players.filter((p) => !p.bust && bjVal(p.hole) <= 21 && dv <= 21 && bjVal(p.hole) === dv);
  // Égalité = mise rendue ; on retire ces mises du pot avant de payer les gagnants
  for (const p of pushes) await credit(p.id, lobby.stake).catch(() => {});
  lobby.pot = floor2(Math.max(0, lobby.pot - lobby.stake * pushes.length));

  let share = 0;
  if (survivors.length) {
    share = await onlinePayWinners(
      lobby,
      survivors.map((p) => p.id)
    );
  } else {
    // Personne ne bat le croupier : on ne rembourse que ceux encore en jeu (pas les bust, déjà pushés)
    const refundIds = new Set(pushes.map((p) => p.id));
    for (const p of lobby.players) {
      if (refundIds.has(p.id) || p.bust) continue;
      // perdants nets (sous le croupier) : rien
    }
    // si tout le monde a bust ou perdu : le pot reste "perdu" (maison) — on ne redistribue pas
    share = 0;
  }

  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(survivors.length ? COLORS.green : COLORS.grey)
      .setTitle('🃏 Blackjack — résultat')
      .setDescription(
        (
          `**Croupier** ${dealer.map(pokerCardStr).join(' ')} → **${dv}**${dv > 21 ? ' (bust)' : ''}\n\n` +
          lobby.players
            .map((p) => {
              const v = bjVal(p.hole);
              let tag = '❌';
              if (survivors.some((s) => s.id === p.id)) tag = '🏆';
              else if (pushes.some((s) => s.id === p.id)) tag = '↩️ égalité';
              else if (p.bust) tag = '💥 bust';
              return `${tag} <@${p.id}> ${p.hole.map(pokerCardStr).join(' ')} → **${v}**`;
            })
            .join('\n') +
          '\n\n' +
          (survivors.length
            ? `Gagnant(s) : ${survivors.map((p) => `<@${p.id}>`).join(', ')} · **${fmt(share)}** chacun.`
            : pushes.length && !survivors.length
              ? 'Égalités remboursées · pas de gagnant.'
              : 'Personne ne bat le croupier.')
        ).slice(0, 4000)
      )
  );
}

function rouletteColor(n) {
  if (n === 0) return 'vert';
  return REDS.has(n) ? 'rouge' : 'noir';
}
function rouletteDot(n) {
  if (n === 0) return '🟢';
  return REDS.has(n) ? '🔴' : '⚫';
}
function wheelArt(idx, locked = false) {
  const cells = [];
  for (let k = -4; k <= 4; k++) {
    const n = WHEEL_ORDER[(idx + k + WHEEL_ORDER.length * 3) % WHEEL_ORDER.length];
    const label = String(n).padStart(2, ' ');
    cells.push(k === 0 ? `[${label}]` : ` ${label} `);
  }
  return code([
    locked ? '        🎯 ARRÊT' : '        🎡 TOURNE',
    cells.join(''),
    '            ▲',
    '         bille',
  ]);
}

async function runOnlineRoulette(lobby, ch) {
  const n = randomInt(0, 37);
  const col = rouletteColor(n);
  const idx = WHEEL_ORDER.indexOf(n);
  const bets = lobby.players.map((p) => `• <@${p.id}> mise sur **${p.choice || '?'}**`).join('\n');
  const msg = await openStage(
    lobby,
    ch,
    '🎡 Roulette — les jeux sont faits',
    `${potLine(lobby)}\n\n${bets}\n\nRouge paie si la bille est rouge, noir si elle est noire. Le **0** est vert : personne ne gagne.`
  );
  const frames = [];
  let pos = randomInt(0, WHEEL.length);
  for (let s = 0; s < 7; s++) {
    pos = (pos + randomInt(3, 8)) % WHEEL.length;
    const show = s === 6 ? idx : pos;
    frames.push({
      title: s === 6 ? '🎡 La bille s’arrête' : '🎡 La bille tourne',
      ms: s === 6 ? 1400 : 700,
      color: s === 6 ? COLORS.gold : COLORS.violet,
      body:
        `${potLine(lobby)}\n` +
        `**Ce qui se passe :** ${s === 6 ? 'la bille tombe dans une case.' : 'la roue défile, regarde la case entre crochets.'}\n\n` +
        wheelArt(show, s === 6) +
        (s === 6 ? `\n**${n}** ${rouletteDot(n)} **${col}**` : ''),
    });
  }
  await playScene(msg, frames);
  const winners = lobby.players.filter((p) => p.choice === col);
  const share = await onlinePayWinners(lobby, winners.map((p) => p.id));
  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(n === 0 ? COLORS.green : col === 'rouge' ? COLORS.red : 0x111827)
      .setTitle('🎡 Roulette — résultat')
      .setDescription(
        (
          `${wheelArt(idx, true)}\n**${n}** ${rouletteDot(n)} **${col}**\n\n` +
          lobby.players.map((p) => `• <@${p.id}> **${p.choice || '?'}** ${p.choice === col ? '✅' : '❌'}`).join('\n') +
          '\n\n' +
          (winners.length
            ? `Gagnant(s) : ${winners.map((p) => `<@${p.id}>`).join(', ')} · **${fmt(share)}** chacun.`
            : n === 0
              ? 'Zéro. Personne sur le vert — mises rendues.'
              : 'Mauvaise couleur — mises rendues.')
        ).slice(0, 4000)
      )
  );
}

function coinArt(side, spinning) {
  if (spinning) {
    return code(['    ││', '    ││', '   tranche', '    ││']);
  }
  const word = side === 'face' ? 'FACE' : 'PILE';
  return code(['  ╔═══════╗', `  ║ ${word.padEnd(5, ' ')} ║`, '  ╚═══════╝', spinning ? '' : '   🪙'].filter(Boolean));
}

async function runOnlineCoinflip(lobby, ch) {
  const side = randomInt(0, 2) === 0 ? 'pile' : 'face';
  const bets = lobby.players.map((p) => `• <@${p.id}> a choisi **${p.choice || '?'}**`).join('\n');
  const msg = await openStage(
    lobby,
    ch,
    '🪙 Pile ou face',
    `${potLine(lobby)}\n\n${bets}\n\nLa pièce est lancée. Le côté qui sort **prend le pot**.`
  );
  const seq = ['pile', 'face', 'pile', 'face', 'pile', side];
  const frames = seq.map((s, i) => {
    const last = i === seq.length - 1;
    return {
      title: last ? `🪙 ${side.toUpperCase()}` : '🪙 La pièce tourne',
      ms: last ? 1400 : 650,
      color: last ? COLORS.gold : COLORS.violet,
      body:
        `${potLine(lobby)}\n` +
        `**Ce qui se passe :** ${last ? `elle retombe sur **${side}**.` : 'elle tourne encore.'}\n\n` +
        coinArt(s, !last) +
        `\n${bets}`,
    };
  });
  await playScene(msg, frames);
  const winners = lobby.players.filter((p) => p.choice === side);
  const share = await onlinePayWinners(lobby, winners.map((p) => p.id));
  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle('🪙 Résultat')
      .setDescription(
        `${coinArt(side, false)}\nLa pièce est sur **${side}**.\n\n` +
          lobby.players.map((p) => `• <@${p.id}> ${p.choice || '?'} ${p.choice === side ? '✅' : '❌'}`).join('\n') +
          '\n\n' +
          (winners.length
            ? `Gagnant(s) : ${winners.map((p) => `<@${p.id}>`).join(', ')} · **${fmt(share)}**.`
            : 'Personne — mises rendues.')
      )
  );
}

async function runOnlineDicewar(lobby, ch) {
  for (const p of lobby.players) p.roll = randomInt(1, 7);
  const best = Math.max(...lobby.players.map((p) => p.roll));
  const msg = await openStage(
    lobby,
    ch,
    '🎲 Guerre de dés',
    `${potLine(lobby)}\n\nChacun lance **un dé**. Le plus haut score prend le pot. Égalité = partage.`
  );
  const frames = [];
  for (let s = 0; s < 5; s++) {
    const last = s === 4;
    const nums = lobby.players.map((p) => (last ? p.roll : randomInt(1, 7)));
    const art = code(sideBySide(nums.map((n) => dieLines(n)), '  '));
    const names = lobby.players.map((p) => who(p).slice(0, 7).padEnd(9, ' ')).join('  ');
    frames.push({
      title: last ? '🎲 Les dés s’arrêtent' : '🎲 Les dés roulent',
      ms: last ? 1500 : 700,
      color: last ? COLORS.gold : COLORS.blue,
      body:
        `${potLine(lobby)}\n` +
        `**Ce qui se passe :** ${last ? 'lecture des scores. Le plus haut gagne.' : 'les dés rebondissent.'}\n\n` +
        `\`${names}\`\n${art}\n` +
        lobby.players.map((p, i) => `• <@${p.id}> ${last ? `**${p.roll}** ${dieFace(p.roll)}` : '…'}`).join('\n'),
    });
  }
  await playScene(msg, frames);
  const winners = lobby.players.filter((p) => p.roll === best);
  const share = await onlinePayWinners(lobby, winners.map((p) => p.id));
  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle('🎲 Résultat')
      .setDescription(
        lobby.players.map((p) => `• <@${p.id}> **${p.roll}** ${dieFace(p.roll)} ${p.roll === best ? '🏆' : ''}`).join('\n') +
          '\n\n' +
          (winners.length === 1
            ? `<@${winners[0].id}> gagne **${fmt(lobby.pot)}**.`
            : `Égalité : ${winners.map((p) => `<@${p.id}>`).join(', ')} · **${fmt(share)}** chacun.`)
      )
  );
}

async function runOnlineHighcard(lobby, ch) {
  const deck = newPokerDeck();
  const label = lobby.game === 'war' ? '⚔️ Bataille' : '⬆️ Carte haute';
  for (const p of lobby.players) p.hole = [];
  const msg = await openStage(
    lobby,
    ch,
    label,
    `${potLine(lobby)}\n\nUne carte chacun. La **plus haute** gagne (As est le plus fort). Égalité = partage.`
  );
  const frames = [];
  frames.push({
    title: `${label} — cartes cachées`,
    ms: 900,
    body: `${potLine(lobby)}\n**Ce qui se passe :** le croupier pose une carte face cachée devant chacun.\n\n` + seatsBlock(lobby.players, false),
  });
  for (const p of lobby.players) {
    p.hole = [deck.pop()];
    frames.push({
      title: `${label} — ${who(p)}`,
      ms: 1100,
      body:
        `${potLine(lobby)}\n**Ce qui se passe :** la carte de **${who(p)}** est retournée.\n\n` +
        lobby.players
          .map((q) => `**${who(q)}** <@${q.id}>\n${q.hole?.length ? holeArt(q.hole, 1) : holeArt([], 1)}`)
          .join('\n'),
    });
  }
  await playScene(msg, frames);
  const rank = (c) => pokerRankVal(c.r);
  const best = Math.max(...lobby.players.map((p) => rank(p.hole[0])));
  const winners = lobby.players.filter((p) => rank(p.hole[0]) === best);
  const share = await onlinePayWinners(lobby, winners.map((p) => p.id));
  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle(`${label} — résultat`)
      .setDescription(
        lobby.players.map((p) => `• <@${p.id}> ${pokerCardStr(p.hole[0])} ${rank(p.hole[0]) === best ? '🏆' : ''}`).join('\n') +
          '\n\n' +
          (winners.length === 1
            ? `<@${winners[0].id}> gagne **${fmt(lobby.pot)}**.`
            : `Égalité · **${fmt(share)}** chacun.`)
      )
  );
}

function slotWindow(a, b, c) {
  const cell = (s) => ` ${s} `;
  return code(['┌────┬────┬────┐', `│${cell(a)}│${cell(b)}│${cell(c)}│`, '└────┴────┴────┘']);
}

async function runOnlineSlots(lobby, ch) {
  const syms = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
  for (const p of lobby.players) {
    const a = syms[randomInt(0, syms.length)];
    const b = syms[randomInt(0, syms.length)];
    const c = syms[randomInt(0, syms.length)];
    let mult = 0;
    if (a === b && b === c) mult = a === '7️⃣' || a === '💎' ? 20 : 8;
    else if (a === b || b === c || a === c) mult = 2;
    p.slot = { a, b, c, mult };
  }
  const msg = await openStage(
    lobby,
    ch,
    '🎰 Course de slots',
    `${potLine(lobby)}\n\nChacun a **3 rouleaux**.\n3 identiques = gros score · 2 identiques = petit score.\nLe **meilleur score** prend le pot. Personne payé = mises rendues.`
  );
  const frames = [];
  for (let s = 0; s < 5; s++) {
    const last = s === 4;
    const blocks = lobby.players.map((p) => {
      const a = last ? p.slot.a : syms[randomInt(0, syms.length)];
      const b = last ? p.slot.b : syms[randomInt(0, syms.length)];
      const c = last ? p.slot.c : syms[randomInt(0, syms.length)];
      return `**${who(p)}** <@${p.id}>${last ? ` · score **x${p.slot.mult}**` : ''}\n${slotWindow(a, b, c)}`;
    });
    frames.push({
      title: last ? '🎰 Rouleaux bloqués' : '🎰 Les rouleaux tournent',
      ms: last ? 1500 : 700,
      color: last ? COLORS.gold : COLORS.violet,
      body:
        `${potLine(lobby)}\n` +
        `**Ce qui se passe :** ${last ? 'on compare les scores.' : 'les symboles défilent.'}\n\n` +
        blocks.join('\n'),
    });
  }
  await playScene(msg, frames);
  const best = Math.max(...lobby.players.map((p) => p.slot.mult));
  const winners = best > 0 ? lobby.players.filter((p) => p.slot.mult === best) : [];
  const share = await onlinePayWinners(lobby, winners.map((p) => p.id));
  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle('🎰 Résultat')
      .setDescription(
        lobby.players
          .map((p) => `• <@${p.id}> ${p.slot.a} ${p.slot.b} ${p.slot.c} · x${p.slot.mult} ${winners.some((w) => w.id === p.id) ? '🏆' : ''}`)
          .join('\n') +
          '\n\n' +
          (winners.length ? `Gagnant(s) · **${fmt(share)}** chacun.` : 'Aucun symbole payant — mises rendues.')
      )
  );
}

function trackArt(pos) {
  const lines = [0, 1, 2, 3].map((i) => {
    const p = Math.max(0, Math.min(12, pos[i] || 0));
    return `${i + 1} ${'.'.repeat(p)}🐎${'.'.repeat(12 - p)}|`;
  });
  lines.push('   ------------FIN');
  return code(lines);
}

async function runOnlineHorses(lobby, ch) {
  const winH = `h${randomInt(1, 5)}`;
  const winIdx = Number(winH.slice(1)) - 1;
  const picks = lobby.players.map((p) => `• <@${p.id}> → **cheval ${(p.choice || '?').replace('h', '')}**`).join('\n');
  const msg = await openStage(
    lobby,
    ch,
    '🏇 Course hippique',
    `${potLine(lobby)}\n\n${picks}\n\n4 chevaux. Celui qui franchit la ligne en premier fait gagner ses parieurs.`
  );
  const pos = [0, 0, 0, 0];
  const frames = [];
  for (let s = 0; s < 6; s++) {
    const last = s === 5;
    for (let i = 0; i < 4; i++) pos[i] += last ? 0 : randomInt(1, 4);
    if (last) {
      const top = Math.max(...pos);
      for (let i = 0; i < 4; i++) pos[i] = i === winIdx ? 12 : Math.min(pos[i], 9);
      if (pos[winIdx] < top) pos[winIdx] = 12;
    }
    frames.push({
      title: last ? `🏇 Arrivée — cheval ${winIdx + 1}` : '🏇 La course',
      ms: last ? 1500 : 800,
      color: last ? COLORS.gold : COLORS.green,
      body:
        `${potLine(lobby)}\n` +
        `**Ce qui se passe :** ${last ? `le cheval **${winIdx + 1}** passe la ligne.` : 'les chevaux avancent vers la ligne.'}\n\n` +
        trackArt(pos) +
        `\n${picks}`,
    });
  }
  await playScene(msg, frames);
  const winners = lobby.players.filter((p) => p.choice === winH);
  const share = await onlinePayWinners(lobby, winners.map((p) => p.id));
  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(COLORS.gold)
      .setTitle('🏇 Arrivée')
      .setDescription(
        `${trackArt([winIdx === 0 ? 12 : 6, winIdx === 1 ? 12 : 5, winIdx === 2 ? 12 : 7, winIdx === 3 ? 12 : 4])}\n` +
          `Vainqueur : **cheval ${winIdx + 1}**\n\n` +
          lobby.players.map((p) => `• <@${p.id}> ${p.choice || '?'} ${p.choice === winH ? '🏆' : ''}`).join('\n') +
          '\n\n' +
          (winners.length ? `Gagnant(s) · **${fmt(share)}**.` : 'Personne sur ce cheval — mises rendues.')
      )
  );
}

function rocketArt(mult, crashed) {
  const h = Math.max(0, Math.min(7, Math.floor(Math.log2(Math.max(mult, 1)) * 3)));
  const lines = [];
  for (let y = 7; y >= 0; y--) lines.push(y === h ? (crashed ? '      💥' : '      🚀') : '       ');
  lines.push(`  x${Number(mult).toFixed(2)}`);
  lines.push('  ' + meter(Math.min(mult, 8), 8, 16));
  return code(lines);
}

async function runOnlineCrash(lobby, ch) {
  const u = randomInt(1, 1_000_001) / 1_000_000;
  const crashAt = Math.max(1.01, Math.floor((0.96 / u) * 100) / 100);
  const parseT = (c) => ({ x15: 1.5, x2: 2, x3: 3, x5: 5 }[c] || 2);
  const picks = lobby.players
    .map((p) => `• <@${p.id}> sort à **x${parseT(p.choice)}**`)
    .join('\n');
  const msg = await openStage(
    lobby,
    ch,
    '🚀 Crash',
    `${potLine(lobby)}\n\n${picks}\n\nLa fusée monte. Si elle explose **avant** ta cible, tu perds. Si ta cible est sous l’explosion, tu survit et tu partages le pot.`
  );
  const steps = [1];
  let m = 1;
  while (steps.length < 6 && m * 1.45 < crashAt) {
    m = round2(m * 1.45);
    steps.push(m);
  }
  steps.push(crashAt);
  const frames = steps.map((v, i) => {
    const last = i === steps.length - 1;
    return {
      title: last ? `🚀 Explosion x${Math.min(crashAt, 1000)}` : `🚀 Montée x${v.toFixed(2)}`,
      ms: last ? 1500 : 800,
      color: last ? COLORS.red : COLORS.blue,
      body:
        `${potLine(lobby)}\n` +
        `**Ce qui se passe :** ${last ? 'la fusée explose. On regarde qui était encore en dessous.' : 'le multiplicateur grimpe.'}\n\n` +
        rocketArt(v, last) +
        `\n${picks}`,
    };
  });
  await playScene(msg, frames);
  const winners = lobby.players.filter((p) => parseT(p.choice) <= crashAt);
  const share = await onlinePayWinners(lobby, winners.map((p) => p.id));
  await onlineFinish(
    lobby,
    ch,
    new EmbedBuilder()
      .setColor(COLORS.red)
      .setTitle('🚀 Crash — résultat')
      .setDescription(
        `${rocketArt(Math.min(crashAt, 1000), true)}\nExplosion à **x${Math.min(crashAt, 1000)}**.\n\n` +
          lobby.players
            .map((p) => {
              const t = parseT(p.choice);
              return `• <@${p.id}> x${t} ${t <= crashAt ? '✅' : '❌'}`;
            })
            .join('\n') +
          '\n\n' +
          (winners.length ? `Survivants · **${fmt(share)}** chacun.` : 'Tout le monde a crash — mises rendues.')
      )
  );
}

async function getAnnounceChannel(guildId) {
  // Ancienne logique salon — conservée en secours uniquement
  const notifId = guildChannels.get(`${guildId}:notifs`);
  if (notifId) {
    const ch = await client.channels.fetch(notifId).catch(() => null);
    if (ch) return ch;
  }
  const casinoId = casinoChannels.get(guildId);
  if (casinoId) return client.channels.fetch(casinoId).catch(() => null);
  return null;
}

/** Envoie un MP à un utilisateur (ignore si MP fermés). */
async function dmUser(userId, payload) {
  try {
    const u = await client.users.fetch(userId);
    await u.send(typeof payload === 'string' ? { content: payload } : payload);
    return true;
  } catch {
    return false;
  }
}

/** Diffuse un MP à tous les membres non-bot du serveur (lent, rate-limit). */
async function dmGuildEveryone(guild, payload) {
  if (!guild) return { ok: 0, fail: 0 };
  let list;
  try {
    list = await guild.members.fetch();
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
      !['panel_', 'modal_', 'ig_', 'rl_', 'bj_', 'mines_', 'replay|', 'event_'].some((p) => i.customId.startsWith(p))
    ) {
      return;
    }
    const id = i.customId;

    if (id.startsWith('admin_') || id.startsWith('modal_admin_')) return await handleAdmin(i);

    if (id.startsWith('event_claim_') && i.isButton()) return await handleEventClaim(i);
    if (id.startsWith('event_join_') && i.isButton()) return await handleEventJoin(i);

    if ((id.startsWith('poker_') || id.startsWith('online_choice_') || id.startsWith('online_bj_')) && i.isButton()) return await handlePokerButton(i);
    if (id === 'online_pickgame' && i.isStringSelectMenu()) {
      const gameKey = i.values[0];
      const bal = await getBalance(i.user.id);
      const g = ONLINE_GAMES[gameKey] || ONLINE_GAMES.poker;
      const hardMax = g.max || 4;
      return i.showModal(
        new ModalBuilder()
          .setCustomId(`modal_online_stake_${gameKey}`)
          .setTitle(`${g.emoji} ${g.name}`.slice(0, 45))
          .addComponents(
            modalInput('stake', `Mise par joueur (solde ${num(bal)})`, { placeholder: 'ex : 10', max: 12 }),
            modalInput('maxp', `Max joueurs (1-${hardMax})`, { placeholder: String(hardMax), max: 2, required: false })
          )
      );
    }
    if (id.startsWith('modal_online_stake_') && i.isModalSubmit()) {
      const gameKey = id.slice('modal_online_stake_'.length);
      const raw = i.fields.getTextInputValue('stake')?.trim();
      const rawMax = i.fields.getTextInputValue('maxp')?.trim();
      const bal = await getBalance(i.user.id);
      const stake = parseAmount(raw, bal);
      if (!stake) return respondText(i, 'Mise invalide : nombre ou "all".');
      const gdef = ONLINE_GAMES[gameKey] || ONLINE_GAMES.poker;
      let maxp = Number(rawMax);
      if (!Number.isFinite(maxp) || maxp < 1) maxp = gdef.max || 4;
      return pokerCreateLobby(i, stake, gameKey, maxp);
    }
    if (id === 'modal_poker_stake' && i.isModalSubmit()) {
      const raw = i.fields.getTextInputValue('stake')?.trim();
      const bal = await getBalance(i.user.id);
      const stake = parseAmount(raw, bal);
      if (!stake) return respondText(i, 'Mise invalide : nombre ou "all".');
      return pokerCreateLobby(i, stake, 'poker');
    }
    if (id === 'modal_search_game' && i.isModalSubmit()) {
      const q = i.fields.getTextInputValue('q')?.trim() || '';
      if (!q) return respondText(i, 'Indique un mot-clé.');
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
    const detail = String(e?.message || e || 'erreur inconnue').slice(0, 300);
    const text = `⚠️ Une erreur est survenue : \`${detail}\``;
    try {
      if (i.deferred || i.replied) await i.followUp({ content: text, flags: EPH }).catch(() => {});
      else if (i.isRepliable?.()) await i.reply({ content: text, flags: EPH }).catch(() => {});
    } catch {
      /* ignore */
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
  for (const kind of ['wins', 'admin', 'invites', 'alltime', 'notifs', 'poker', 'online']) {
    if (guildChannels.get(`${gid}:${kind}`) === channel.id) {
      guildChannels.delete(`${gid}:${kind}`);
      alltimeBoardMessages.delete(gid);
      await supabase.from('guild_channels').delete().eq('guild_id', gid).eq('kind', kind);
    }
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Connecté en tant que ${c.user.tag}`);
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

