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
  escapeMarkdown,
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ============================================================
//  CONFIG
// ============================================================
const PREFIX = '!';
const COIN = 'coin';
const DAILY_AMOUNT = 4;
const INVITE_REWARD = 1; // coins offerts à celui qui invite un nouveau membre
const LEADERBOARD_REFRESH_MS = 60_000;
const IDLE_MS = 90_000; // une partie inactive est réglée automatiquement après 90 s
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
    GatewayIntentBits.MessageContent, // à activer dans le Developer Portal
    GatewayIntentBits.GuildMembers, // arrivée des membres (système d'invitations) : à activer dans le Developer Portal
    GatewayIntentBits.GuildInvites, // suivi des invitations
  ],
  allowedMentions: { parse: [], repliedUser: false },
});

const COLORS = {
  green: 0x2ecc71,
  red: 0xe74c3c,
  grey: 0x95a5a6,
  blue: 0x8B5CF6,   // violet principal (barre gauche des panels)
  gold: 0xA855F7,   // violet accent
  violet: 0x7C3AED, // violet profond
};

// ============================================================
//  LANGUES (FR / EN) — préférence par utilisateur
// ============================================================
const LANG_FILE = path.join(__dirname, 'data', 'lang.json');
const userLang = new Map(); // userId -> 'fr' | 'en'

function loadLangs() {
  try {
    const raw = JSON.parse(fs.readFileSync(LANG_FILE, 'utf8'));
    for (const [id, lang] of Object.entries(raw)) {
      if (lang === 'fr' || lang === 'en') userLang.set(id, lang);
    }
  } catch {
    /* first run */
  }
}
function saveLangs() {
  try {
    fs.mkdirSync(path.dirname(LANG_FILE), { recursive: true });
    fs.writeFileSync(LANG_FILE, JSON.stringify(Object.fromEntries(userLang), null, 2));
  } catch (e) {
    console.error('[lang]', e?.message || e);
  }
}
function getLang(userId) {
  return userLang.get(userId) || 'fr';
}
function setLang(userId, lang) {
  userLang.set(userId, lang === 'en' ? 'en' : 'fr');
  saveLangs();
}

const I18N = {
  fr: {
    play: 'JOUER',
    daily: 'Daily',
    balance: 'Solde',
    send: 'Envoyer',
    top: 'Classement',
    topall: 'All-time',
    history: 'Historique',
    invites: 'Invites',
    settings: 'Langue',
    lobbyTitle: '✦ Choisis ta table',
    lobbyAuthor: 'Lobby des jeux',
    lobbyDesc:
      'Sélectionne un jeu dans le **menu ci-dessous**.\nUne fenêtre s’ouvre pour ta mise (ton solde est affiché).',
    lobbyPlaceholder: '🎮 Choisir un jeu…',
    lobbyFooter: 'Menu privé · visible uniquement par toi',
    yourBalance: 'Ton solde',
    dailyOk: 'Tu as reçu',
    dailyAlready: 'Tu as déjà pris ton daily aujourd’hui. Reviens après minuit (Paris).',
    newBalance: 'Nouveau solde',
    langTitle: 'Paramètres · Langue',
    langDesc: 'Choisis la langue du bot **pour toi** (menus, messages privés).',
    langFr: 'Français',
    langEn: 'English',
    langSet: 'Langue définie : **Français** ✅',
    sendPick: '💸 À qui veux-tu envoyer de l’argent depuis ton solde ?',
    noMoney: `Tu n’as pas de ${COIN}. Clique sur **🎁 Daily** pour ta récompense du jour.`,
    insufficient: `Tu n’as pas assez de ${COIN} pour cette mise.`,
    betLabel: 'Mise (solde',
    rejouer: 'Rejouer',
  },
  en: {
    play: 'PLAY',
    daily: 'Daily',
    balance: 'Balance',
    send: 'Send',
    top: 'Leaderboard',
    topall: 'All-time',
    history: 'History',
    invites: 'Invites',
    settings: 'Language',
    lobbyTitle: '✦ Pick your table',
    lobbyAuthor: 'Games lobby',
    lobbyDesc:
      'Select a game in the **menu below**.\nA popup opens for your bet (your balance is shown).',
    lobbyPlaceholder: '🎮 Choose a game…',
    lobbyFooter: 'Private menu · only visible to you',
    yourBalance: 'Your balance',
    dailyOk: 'You received',
    dailyAlready: 'You already claimed today’s daily. Come back after midnight (Paris).',
    newBalance: 'New balance',
    langTitle: 'Settings · Language',
    langDesc: 'Choose the bot language **for you** (menus, private messages).',
    langFr: 'Français',
    langEn: 'English',
    langSet: 'Language set to **English** ✅',
    sendPick: '💸 Who do you want to send coins to?',
    noMoney: `You have no ${COIN}. Click **🎁 Daily** for today’s reward.`,
    insufficient: `Not enough ${COIN} for this bet.`,
    betLabel: 'Bet (balance',
    rejouer: 'Replay',
  },
};

function t(userId, key) {
  const lang = getLang(userId);
  return I18N[lang][key] ?? I18N.fr[key] ?? key;
}

loadLangs();

/** Dernier serveur d’où le joueur a lancé Start (pour les parties en MP). */
const userHomeGuild = new Map(); // userId -> guildId

function resolveGuildId(i) {
  if (i.guild?.id) return i.guild.id;
  return userHomeGuild.get(i.user.id) || null;
}

// ============================================================
//  OUTILS
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const range = (n) => Array.from({ length: n }, (_, i) => i);

/** Anime un message en plusieurs étapes (editReply successifs). */
async function animateSteps(i, steps, title, baseDesc = '') {
  const palette = [COLORS.violet, COLORS.gold, COLORS.blue, 0xE879F9, 0xC026D3];
  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(palette[idx % palette.length])
      .setDescription(`${baseDesc}${step.text}`)
      .setFooter({ text: `Étape ${idx + 1}/${steps.length}` });
    await i.editReply({ embeds: [embed], components: [] }).catch(() => {});
    if (step.ms) await sleep(Math.min(1200, Math.round(step.ms * 1.2)));
  }
}
const round2 = (n) => Math.round(n * 100) / 100;
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const num = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmt = (n) => `${num(n)} ${COIN}`;
const fx = (m) => `x${Number(m).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n) => `${n > 0 ? '+' : ''}${fmt(n)}`;

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
const peaks = new Map(); // userId -> max balance jamais atteint

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
  try {
    fs.mkdirSync(path.dirname(PEAK_FILE), { recursive: true });
    fs.writeFileSync(PEAK_FILE, JSON.stringify(Object.fromEntries(peaks), null, 2));
  } catch (e) {
    console.error('[peaks] fichier :', e?.message || e);
  }
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

// Retire `amount` : renvoie le nouveau solde, ou null si solde insuffisant
async function debit(id, amount) {
  try {
    return Number(await rpc('change_balance', { p_user_id: id, p_amount: -amount }));
  } catch (e) {
    if (String(e?.message || '').includes('insufficient_funds')) return null;
    throw e;
  }
}

// Vérifie le solde et retire la mise. Renvoie un message d'erreur (string) ou null si tout est OK.
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

// Depuis un message privé (ex : bouton "Rejouer") on modifie le message ;
// sinon on crée un nouveau message visible uniquement par le joueur.
async function respond(i, payload) {
  if ((i.isButton() || (i.isModalSubmit() && i.isFromMessage())) && fromEphemeral(i)) return i.update(payload);
  return i.reply({ ...payload, flags: EPH });
}

// Message d'erreur : toujours un NOUVEAU message privé (on n'efface pas la partie précédente)
const respondText = (i, text) => i.reply({ content: text, flags: EPH });

// Une seule partie à la fois par joueur
const games = new Map(); // userId -> partie en cours (ou { starting: true })
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

// ============================================================
//  MULTIPLICATEURS RÉGLABLES (un coefficient par jeu, modifiable par le propriétaire)
//  Tous les gains d'un jeu sont multipliés par ce coefficient (1.00 = valeurs normales).
// ============================================================
const MULT_MIN = 0.5;
const MULT_MAX = 10;
const MULT_FILE = path.join(__dirname, 'data', 'multipliers.json');
const multipliers = new Map(); // jeu -> coefficient
const coef = (game) => multipliers.get(game) ?? 1;

async function loadMultipliers() {
  try {
    const raw = JSON.parse(fs.readFileSync(MULT_FILE, 'utf8'));
    for (const [g, v] of Object.entries(raw)) if (GAME_NAMES[g] && Number(v) > 0) multipliers.set(g, Number(v));
  } catch {
    /* pas de fichier local : normal au premier lancement */
  }
  try {
    const { data, error } = await supabase.from('game_settings').select('game, multiplier');
    if (error) throw error;
    for (const r of data) if (GAME_NAMES[r.game] && Number(r.multiplier) > 0) multipliers.set(r.game, Number(r.multiplier));
  } catch (e) {
    console.error('[multiplicateurs] table game_settings introuvable ou illisible (lance schema_v3.sql) :', e?.message || e);
  }
}

// Renvoie { db: true/false } : db = false si seule la sauvegarde locale a marché
async function saveMultiplier(game, value, guildId = null, actorId = null) {
  multipliers.set(game, value);
  try {
    fs.mkdirSync(path.dirname(MULT_FILE), { recursive: true });
    fs.writeFileSync(MULT_FILE, JSON.stringify(Object.fromEntries(multipliers), null, 2));
  } catch (e) {
    console.error('[multiplicateurs] fichier :', e?.message || e);
  }
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

// ---------- Boosts temporaires (x2 wins, x2 losses, etc.) ----------
/** guildId -> { winMult, loseMult, label, expiresAt, timer } */
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
    const embed = new EmbedBuilder()
      .setColor(COLORS.green)
      .setAuthor({ name: `${user.globalName || user.username} a gagné !`, iconURL: user.displayAvatarURL() })
      .setDescription(`🎉 <@${user.id}> remporte **${fmt(profit)}** au ${GAME_NAMES[game] || game}`)
      .addFields(
        { name: 'Jeu', value: GAME_NAMES[game] || game, inline: true },
        { name: 'Mise', value: fmt(bet), inline: true },
        { name: 'Multiplicateur', value: fx(mult), inline: true },
        { name: 'Gain', value: `**${signed(profit)}**`, inline: true }
      )
      .setTimestamp();
    await ch.send({ embeds: [embed] });
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
//  MINES  (grille de 24 cases, 4 difficultés)
// ============================================================
const MINES_CELLS = 24; // 4 lignes de 5 + 1 ligne de 4 (+ le bouton Encaisser/Rejouer)
const MINES_EDGE = 0.97; // avantage de la maison
const MINES_MAX_MULT = 1000; // encaissement automatique à ce multiplicateur
const LEVELS = {
  easy: { name: 'Easy', emoji: '🟢', mines: 3, style: ButtonStyle.Success },
  medium: { name: 'Medium', emoji: '🟡', mines: 6, style: ButtonStyle.Primary },
  hard: { name: 'Hard', emoji: '🟠', mines: 10, style: ButtonStyle.Secondary },
  impossible: { name: 'Impossible', emoji: '🔴', mines: 15, style: ButtonStyle.Danger },
};

// Plus il y a de mines, plus chaque diamant rapporte gros
function minesMultiplier(picks, mines) {
  if (picks <= 0) return 1;
  let m = 1;
  for (let k = 0; k < picks; k++) m *= (MINES_CELLS - k) / (MINES_CELLS - mines - k);
  return Math.min(MINES_MAX_MULT, Math.max(0.01, Math.floor(m * MINES_EDGE * coef('mines') * 100) / 100));
}

function minesPickerPayload() {
  const lines = Object.values(LEVELS).map(
    (L) =>
      `${L.emoji} **${L.name}** : ${L.mines} 💣 · ${MINES_CELLS - L.mines} 💎 · 1er diamant **${fx(minesMultiplier(1, L.mines))}**`
  );
  const embed = new EmbedBuilder()
    .setTitle('💣 Mines : choisis ta difficulté')
    .setColor(COLORS.blue)
    .setDescription(
      `${lines.join('\n')}\n\nPlus il y a de mines, plus le multiplicateur grimpe vite (max ${fx(MINES_MAX_MULT)}).`
    );
  const row = new ActionRowBuilder().addComponents(
    ...Object.entries(LEVELS).map(([key, L]) =>
      new ButtonBuilder().setCustomId(`mines_lvl_${key}`).setLabel(L.name).setEmoji(L.emoji).setStyle(L.style)
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
  const L = LEVELS[game.level];
  const picks = game.revealed.size;
  const safeTotal = MINES_CELLS - game.mines;
  const mult = minesMultiplier(picks, game.mines);
  const e = new EmbedBuilder()
    .setTitle(`💣 Mines · ${L.emoji} ${L.name}`)
    .addFields(
      { name: 'Mise', value: fmt(game.bet), inline: true },
      { name: 'Bombes', value: String(game.mines), inline: true },
      { name: 'Multiplicateur', value: fx(mult), inline: true },
      { name: 'Gain actuel', value: fmt(floor2(game.bet * mult)), inline: true }
    );
  if (end) {
    e.setColor(end.color).setDescription(end.text);
    e.addFields({ name: 'Solde', value: fmt(end.balance), inline: true });
  } else {
    e.setColor(COLORS.blue).setDescription('Clique sur les cases. Évite les 💣 et encaisse quand tu veux !');
    if (picks < safeTotal) {
      e.addFields({ name: 'Prochain 💎', value: fx(minesMultiplier(picks + 1, game.mines)), inline: true });
    }
  }
  return e;
}
async function startMines(i, level, bet) {
  const L = LEVELS[level];
  if (!L) return respondText(i, 'Difficulté inconnue.');
  const uid = i.user.id;
  if (!tryLock(uid)) return respondText(i, MSG.busy);

  let started = false;
  try {
    const err = await takeBet(uid, bet);
    if (err) return respondText(i, err);

    const mineSet = new Set(shuffle(range(MINES_CELLS)).slice(0, L.mines));
    const game = {
      type: 'mines',
      userId: uid,
      user: i.user,
      guildId: resolveGuildId(i),
      bet,
      level,
      mines: L.mines,
      mineSet,
      revealed: new Set(),
      hit: null,
      messageId: null,
      lastI: i,
      timer: null,
      finished: false,
    };

    try {
      await respond(i, { embeds: [minesEmbed(game)], components: minesRows(game, false) });
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
    let counted = true; // enregistré dans l'historique ?

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
    if (i) await i.update(payload);
    else await game.lastI.editReply(payload);
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
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const newDeck = () => shuffle(SUITS.flatMap((s) => RANKS.map((r) => ({ r, s }))));
const cardStr = (c) => `\`${c.r}${c.s}\``;
/** Affiche une carte en "vrai" format visuel */
const cardArt = (c) => {
  const r = String(c.r).padEnd(2, ' ');
  return `┌────┐\n│${r}  │\n│ ${c.s} │\n│  ${r.trim().padStart(2, ' ')}│\n└────┘`;
};
const cardsArt = (hand) => {
  if (!hand.length) return '—';
  // Affiche les cartes côte à côte (lignes fusionnées)
  const arts = hand.map(cardArt).map((a) => a.split('\n'));
  const rows = arts[0].map((_, ri) => arts.map((a) => a[ri]).join(' '));
  return '```\n' + rows.join('\n') + '\n```';
};
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const dieFace = (n) => DICE_FACES[Math.max(1, Math.min(6, n)) - 1];
const WHEEL_FRAMES = ['◐', '◓', '◑', '◒'];

function handValue(hand) {
  return handInfo(hand).total;
}

/** Score blackjack : gère les As (ex: 7/17 si soft). */
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
  // Affiche toujours les 2 lectures quand un As peut valoir 1 ou 11
  const label = isSoft && low >= 1 ? `${low}/${total}` : String(total);
  return { total, low, isSoft, label };
}

function bjEmbed(g, end) {
  const e = new EmbedBuilder().setTitle('🃏 Blackjack');
  const pInfo = handInfo(g.player);
  const showAllDealer = !!(end && (end.revealAll || end.color != null || end.balance != null || end.revealing));
  // Pendant le jeu : une carte visible + dos. Pendant révélation / fin : toutes les cartes.
  const dealerVisible = showAllDealer || end?.revealing ? g.dealer : [g.dealer[0]];
  const dInfo = handInfo(showAllDealer || end?.revealing ? g.dealer : [g.dealer[0]]);
  const playerBlock = cardsArt(g.player);
  const dealerBlock =
    showAllDealer || end?.revealing
      ? cardsArt(g.dealer)
      : cardsArt([g.dealer[0]]) + '\n🂠';

  const playerTitle = pInfo.isSoft
    ? `Ta main · **${pInfo.label}** (As = 1 ou 11)`
    : `Ta main · **${pInfo.label}**`;
  const dealerTitle =
    showAllDealer || end?.revealing
      ? dInfo.isSoft
        ? `Croupier · **${dInfo.label}** (As = 1 ou 11)`
        : `Croupier · **${dInfo.label}**`
      : `Croupier · **${dInfo.label}** + 🂠`;

  e.addFields(
    { name: playerTitle, value: playerBlock },
    { name: dealerTitle, value: dealerBlock },
    { name: 'Mise', value: fmt(g.bet), inline: true }
  );
  if (end && end.balance != null) {
    e.setColor(end.color).setDescription(end.text);
    e.addFields({ name: 'Solde', value: fmt(end.balance), inline: true });
  } else if (end?.revealing) {
    e.setColor(COLORS.violet).setDescription(end.text || '🃏 Tour du croupier…');
  } else {
    e.setColor(COLORS.violet).setDescription(
      'À toi : **Tirer**, **Rester** ou **Doubler**.\n' +
        (pInfo.isSoft ? `💡 Ton As te donne **${pInfo.low}** ou **${pInfo.total}**.` : '')
    );
  }
  return e;
}

function bjRows(g, over) {
  if (over) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`replay|bj|${g.baseBet}`)
          .setLabel('Rejouer')
          .setEmoji('🔁')
          .setStyle(ButtonStyle.Success)
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
    const pBJ = pv === 21;
    const dBJ = dv === 21;
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

    // Blackjack naturel : la partie est réglée tout de suite
    if (handValue(game.player) === 21 || handValue(game.dealer) === 21) {
      const out = bjOutcome(game, 'natural');
      let balance;
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
      return respond(i, {
        embeds: [bjEmbed(game, { text: out.text, color: out.color, balance })],
        components: bjRows(game, true),
      });
    }

    try {
      await respond(i, { embeds: [bjEmbed(game)], components: bjRows(game, false) });
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
    // Révélation carte par carte du croupier (sauf si le joueur a déjà sauté)
    if (kind === 'stand') {
      await pushBoard(
        {
          embeds: [
            bjEmbed(game, {
              revealing: true,
              text: '🃏 Le croupier **retourne** sa deuxième carte…',
            }),
          ],
          components: [],
        },
        i
      );
      i = null;
      await sleep(1100);

      // Tire jusqu'à 17+ en montrant chaque carte
      while (handValue(game.dealer) < 17) {
        game.dealer.push(game.deck.pop());
        const d = handInfo(game.dealer);
        await game.lastI.editReply({
          embeds: [
            bjEmbed(game, {
              revealing: true,
              text: `🃏 Croupier tire une carte… total **${d.label}**${d.isSoft ? ' (As soft)' : ''}`,
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
            text:
              dFinal.total > 21
                ? `💥 Croupier dépasse (**${dFinal.label}**) !`
                : `🛑 Croupier s’arrête à **${dFinal.label}**.`,
          }),
        ],
        components: [],
      });
      await sleep(900);
    } else if (i) {
      // bust / natural : on update une fois à la fin
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
const colorEmoji = { vert: '🟢', rouge: '🔴', noir: '⚫' };

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
    let payout = won ? floor2(bet * rlMult) : 0;
    if (!won && (boost.loseMult || 1) > 1) {
      const extra = floor2(bet * ((boost.loseMult || 1) - 1));
      if (extra > 0) await debit(uid, extra).catch(() => {});
    }

    try {
      await respond(i, {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎡 Roulette')
            .setColor(COLORS.violet)
            .setDescription(`🎡 La roulette s’élance... (mise **${fmt(bet)}** sur **${choice.label}**)`),
        ],
        components: [],
      });
    } catch (e) {
      await credit(uid, bet).catch(() => {});
      throw e;
    }

    const balance = payout > 0 ? await credit(uid, payout) : await getBalance(uid);

    const n1 = randomInt(0, 37);
    const n2 = randomInt(0, 37);
    const n3 = randomInt(0, 37);
    await animateSteps(
      i,
      [
        {
          text:
            '```\n' +
            '    ╭─────────╮\n' +
            '   ╱  ·  ·  ·  ╲\n' +
            '  │ ·   ●   ·   │\n' +
            '   ╲  ·  ·  ·  ╱\n' +
            '    ╰─────────╯\n' +
            '```\n🌀 La bille s’élance…',
          ms: 500,
        },
        {
          text:
            '```\n' +
            '    ╭─────────╮\n' +
            '   ╱  ·  ●  ·  ╲\n' +
            `  │ ·  ${String(n1).padStart(2, ' ')}  ·   │\n` +
            '   ╲  ·  ·  ·  ╱\n' +
            '    ╰─────────╯\n' +
            '```\n💫 Elle tourne à toute vitesse…',
          ms: 500,
        },
        {
          text:
            '```\n' +
            '    ╭─────────╮\n' +
            '   ╱  ●  ·  ·  ╲\n' +
            `  │ ·  ${String(n2).padStart(2, ' ')}  ·   │\n` +
            '   ╲  ·  ·  ·  ╱\n' +
            '    ╰─────────╯\n' +
            '```\n⏳ Ralentit…',
          ms: 550,
        },
        {
          text:
            '```\n' +
            '    ╭─────────╮\n' +
            '   ╱  ·  ·  ●  ╲\n' +
            `  │ ·  ${String(n3).padStart(2, ' ')}  ·   │\n` +
            '   ╲  ·  ·  ·  ╱\n' +
            '    ╰─────────╯\n' +
            '```\n🎯 Dernier tour…',
          ms: 600,
        },
      ],
      '🎡 Roulette',
      `Mise **${fmt(bet)}** sur **${choice.label}**\n\n`
    );

    const embed = new EmbedBuilder()
      .setTitle('🎡 Roulette')
      .setColor(won ? COLORS.green : COLORS.red)
      .setDescription(
        `✨ La bille s’arrête sur **${colorEmoji[colorOf(result)]} ${result}** (${colorOf(result)}).\n\n` +
          (won
            ? `🎉 Gagné ! Tu empoches **${fmt(payout)}** (${fx(rlMult)}), profit : **${signed(round2(payout - bet))}**.`
            : `😬 Perdu, tu laisses **${fmt(bet)}**.`)
      )
      .addFields(
        { name: 'Ton pari', value: choice.label, inline: true },
        { name: 'Mise', value: fmt(bet), inline: true },
        { name: 'Solde', value: fmt(balance), inline: true }
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`replay|rl|${bet}|${choice.key}`)
        .setLabel('Rejouer')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Success)
    );
    await i.editReply({ embeds: [embed], components: [row] });

    recordResult({
      guildId: resolveGuildId(i),
      user: i.user,
      game: 'roulette',
      bet,
      mult: won ? rlMult : 0,
      payout,
      detail: `${choice.label} → ${result}`,
    });
  } finally {
    unlock(uid);
  }
}

// ============================================================
//  NOUVEAUX JEUX INSTANTANÉS : Pile ou Face, Dés, Machine à sous, Roue
//  (le coefficient réglé par le propriétaire s'applique à tous les gains)
// ============================================================
const COIN_MULT = 1.95;
const DICE_MULT = { under: 2.3, over: 2.3, seven: 5.8 };

const SLOT_SYMBOLS = [
  { s: '🍒', w: 8, pay: 5 },
  { s: '🍋', w: 7, pay: 10 },
  { s: '🍇', w: 6, pay: 18 },
  { s: '🔔', w: 4, pay: 35 },
  { s: '💎', w: 2, pay: 90 },
  { s: '7️⃣', w: 1, pay: 250 },
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

// 24 cases : multiplicateur de base de chaque case de la roue
const WHEEL = [...Array(13).fill(0), ...Array(4).fill(0.5), ...Array(4).fill(1.5), 2, 3, 10];
const wheelSummary = (c) => {
  const counts = new Map();
  for (const v of WHEEL) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()]
    .map(([v, n]) => `${v === 0 ? '💀 x0' : fx(v * c)}${n > 1 ? ` ×${n}` : ''}`)
    .join(' · ');
};

const igButton = (key, choice, label, emoji, style) =>
  new ButtonBuilder().setCustomId(`ig_${key}_${choice}`).setLabel(label).setEmoji(emoji).setStyle(style);

const INSTANT = {
  coinflip: {
    title: '🪙 Pile ou Face',
    choices: ['pile', 'face'],
    spinText: 'La pièce tourne...',
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
    resolve(choice, c) {
      const side = randomInt(0, 2) === 0 ? 'pile' : 'face';
      return {
        base: side === choice ? COIN_MULT : 0,
        pick: choice === 'pile' ? 'Pile' : 'Face',
        headline: `La pièce retombe sur **🪙 ${side === 'pile' ? 'Pile' : 'Face'}**.`,
        detail: `${choice} → ${side}`,
      };
    },
  },

  dice: {
    title: '🎲 Dés',
    choices: ['under', 'over', 'seven'],
    spinText: 'Les dés roulent...',
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
    resolve(choice, c) {
      const a = randomInt(1, 7);
      const b = randomInt(1, 7);
      const sum = a + b;
      const outcome = sum < 7 ? 'under' : sum > 7 ? 'over' : 'seven';
      return {
        base: outcome === choice ? DICE_MULT[choice] : 0,
        pick: { under: 'Moins de 7', over: 'Plus de 7', seven: 'Exactement 7' }[choice],
        headline: `${dieFace(a)} **${a}** + ${dieFace(b)} **${b}** = **${sum}**`,
        detail: `${a}+${b}=${sum}`,
      };
    },
  },

  slots: {
    title: '🎰 Machine à sous',
    choices: ['go'],
    spinText: 'Les rouleaux tournent...',
    picker(c) {
      const table = SLOT_SYMBOLS.map((x) => `${x.s}${x.s}${x.s} → **${fx(x.pay * c)}**`).join('\n');
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎰 Machine à sous')
            .setColor(COLORS.blue)
            .setDescription(`${table}\n🍒🍒 (2 cerises) → **${fx(SLOT_TWO_CHERRIES * c)}**`),
        ],
        components: [new ActionRowBuilder().addComponents(igButton('slots', 'go', 'Lancer', '🎰', ButtonStyle.Success))],
      };
    },
    resolve(choice, c) {
      const reels = [spinReel(), spinReel(), spinReel()];
      let base = 0;
      if (reels[0].s === reels[1].s && reels[1].s === reels[2].s) base = reels[0].pay;
      else if (reels.filter((r) => r.s === '🍒').length === 2) base = SLOT_TWO_CHERRIES;
      const line = reels.map((r) => r.s).join(' | ');
      return { base, pick: 'Spin', headline: `**[ ${line} ]**`, detail: reels.map((r) => r.s).join('') };
    },
  },

  wheel: {
    title: '🎡 Roue de la fortune',
    choices: ['go'],
    spinText: 'La roue tourne...',
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
      const base = WHEEL[randomInt(0, WHEEL.length)];
      return {
        base,
        pick: 'Roue',
        headline: `La roue s'arrête sur **${base === 0 ? '💀 x0' : fx(base * c)}**`,
        detail: base === 0 ? 'x0' : fx(base * c),
      };
    },
  },
};

// ---------- 10 jeux de plus ----------
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));

// Écran de choix générique : un bouton par pari possible
function choicePicker(key, title, desc, choices) {
  const buttons = choices.map(([id, label, emoji, style]) => igButton(key, id, label, emoji, style || ButtonStyle.Primary));
  return {
    embeds: [new EmbedBuilder().setTitle(title).setColor(COLORS.blue).setDescription(desc)],
    components: chunk(buttons, 5).map((r) => new ActionRowBuilder().addComponents(...r)),
  };
}

const DUEL_MULT = 2.1;
const SUIT_MULT = 3.8;
const SUIT_CHOICES = { s: '♠️', h: '♥️', d: '♦️', c: '♣️' };
const ZONES = { low: { label: 'Bas (1-3)', mult: 3.2, win: (n) => n <= 3 }, mid: { label: 'Milieu (4-7)', mult: 2.4, win: (n) => n >= 4 && n <= 7 }, high: { label: 'Haut (8-10)', mult: 3.2, win: (n) => n >= 8 } };
const PLINKO_BINS = [1, 8, 28, 56, 70, 56, 28, 8, 1]; // répartition binomiale (8 rangées)
const PLINKO = {
  low: { label: 'Faible', emoji: '🟢', mults: [2, 1.4, 1.1, 0.95, 0.8, 0.95, 1.1, 1.4, 2] },
  med: { label: 'Moyen', emoji: '🟡', mults: [6, 3, 1.4, 0.7, 0.4, 0.7, 1.4, 3, 6] },
  high: { label: 'Élevé', emoji: '🔴', mults: [18, 4, 1.5, 0.4, 0.2, 0.4, 1.5, 4, 18] },
};
const CRASH_TARGETS = { x15: 1.5, x2: 2, x5: 5, x10: 10 };
const SCRATCH = [[1.5, 1900, '🍀'], [2, 900, '⭐'], [5, 400, '🔔'], [20, 80, '💎'], [100, 12, '👑']]; // [mult, poids sur 10000, symbole]
const SCRATCH_JUNK = ['🍀', '⭐', '🔔', '💎', '👑', '🍒', '🍋'];
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

const randCard = () => ({ v: randomInt(0, 13), s: SUITS[randomInt(0, 4)] });
const cardOf = (c) => cardStr({ r: RANKS[c.v], s: c.s });

Object.assign(INSTANT, {
  duel: {
    title: '⚔️ Duel de cartes',
    choices: ['go'],
    spinText: 'Les cartes sont distribuées...',
    info: (c) => `victoire ${fx(DUEL_MULT * c)}`,
    picker: (c) =>
      choicePicker('duel', '⚔️ Duel de cartes', `Tu tires une carte contre le croupier : la plus haute gagne (l’As est la plus faible, égalité = perdu).\nVictoire : **${fx(DUEL_MULT * c)}**`, [
        ['go', 'Tirer ma carte', '⚔️', ButtonStyle.Success],
      ]),
    resolve() {
      const me = randCard();
      const dealer = randCard();
      return {
        base: me.v > dealer.v ? DUEL_MULT : 0,
        pick: 'Duel',
        headline: `Toi : ${cardOf(me)}  ·  Croupier : ${cardOf(dealer)}`,
        detail: `${RANKS[me.v]} vs ${RANKS[dealer.v]}`,
      };
    },
  },

  suit: {
    title: '🃏 Enseigne',
    choices: Object.keys(SUIT_CHOICES),
    spinText: 'Le croupier tire une carte...',
    info: (c) => `victoire ${fx(SUIT_MULT * c)}`,
    picker: (c) =>
      choicePicker('suit', '🃏 Enseigne : devine la couleur de la carte', `Choisis ♠️ ♥️ ♦️ ou ♣️ : si la carte tirée a cette enseigne, tu gagnes **${fx(SUIT_MULT * c)}** (1 chance sur 4).`,
        Object.entries(SUIT_CHOICES).map(([id, e]) => [id, id === 's' ? 'Pique' : id === 'h' ? 'Cœur' : id === 'd' ? 'Carreau' : 'Trèfle', e])),
    resolve(choice) {
      const card = randCard();
      return {
        base: card.s === SUIT_CHOICES[choice] ? SUIT_MULT : 0,
        pick: SUIT_CHOICES[choice],
        headline: `La carte tirée : ${cardOf(card)}`,
        detail: `${SUIT_CHOICES[choice]} → ${card.s}`,
      };
    },
  },

  zone: {
    title: '🎯 Zone',
    choices: Object.keys(ZONES),
    spinText: 'Tirage d’un nombre de 1 à 10...',
    info: (c) => `zones ${fx(ZONES.low.mult * c)} / ${fx(ZONES.mid.mult * c)}`,
    picker: (c) =>
      choicePicker('zone', '🎯 Zone : où tombera le nombre (1 à 10) ?', Object.values(ZONES).map((z) => `**${z.label}** : ${fx(z.mult * c)}`).join('\n'),
        Object.entries(ZONES).map(([id, z]) => [id, z.label, '🎯'])),
    resolve(choice) {
      const n = randomInt(1, 11);
      return { base: ZONES[choice].win(n) ? ZONES[choice].mult : 0, pick: ZONES[choice].label, headline: `Le nombre tiré est **${n}**`, detail: `${n}` };
    },
  },

  plinko: {
    title: '🎱 Plinko',
    choices: Object.keys(PLINKO),
    spinText: 'La bille descend...',
    info: (c) => `de ${fx(0.2 * c)} à ${fx(18 * c)}`,
    picker: (c) =>
      choicePicker('plinko', '🎱 Plinko : choisis le risque', Object.values(PLINKO).map((r) => `${r.emoji} **${r.label}** : ${r.mults.map((m) => fx(m * c).replace('x', '')).join(' · ')}`).join('\n'),
        Object.entries(PLINKO).map(([id, r]) => [id, r.label, r.emoji])),
    resolve(choice, c) {
      // 8 rangées : à chaque rangée la bille va à gauche (0) ou à droite (1)
      const path = [];
      let bin = 0;
      for (let k = 0; k < 8; k++) {
        const right = randomInt(0, 2);
        path.push(right);
        bin += right;
      }
      const mults = PLINKO[choice].mults;
      const board = mults
        .map((m, k) => (k === bin ? `【${fx(m * c).replace('x', '')}】` : fx(m * c).replace('x', '')))
        .join(' · ');
      return {
        base: mults[bin],
        pick: PLINKO[choice].label,
        headline: `🎱 La bille atterrit en case **${bin + 1}/9**\n${board}`,
        detail: `case ${bin + 1}`,
        path,
        bin,
        mults,
        coef: c,
      };
    },
  },

  crash: {
    title: '🚀 Crash',
    choices: Object.keys(CRASH_TARGETS),
    spinText: 'La fusée décolle...',
    info: (c) => `cibles de ${fx(1.5 * c)} à ${fx(10 * c)}`,
    picker: (c) =>
      choicePicker('crash', '🚀 Crash : choisis ton multiplicateur cible', 'La fusée monte puis explose à un moment aléatoire. Si elle atteint ta cible, tu gagnes ! Plus la cible est haute, plus c’est risqué.',
        Object.entries(CRASH_TARGETS).map(([id, t]) => [id, `x${t}`, '🚀'])),
    resolve(choice) {
      const u = randomInt(1, 1_000_001) / 1_000_000;
      const crash = Math.max(1, Math.floor((0.96 / u) * 100) / 100);
      const target = CRASH_TARGETS[choice];
      return {
        base: crash >= target ? target : 0,
        pick: `Cible x${target}`,
        headline: `🚀 La fusée explose à **${fx(Math.min(crash, 1000))}**${crash >= target ? ' : cible atteinte !' : ' : trop tôt !'}`,
        detail: `cible x${target} / crash x${Math.min(crash, 1000)}`,
      };
    },
  },

  scratch: {
    title: '🎟️ Ticket à gratter',
    choices: ['go'],
    spinText: 'Tu grattes le ticket...',
    info: (c) => `de ${fx(1.5 * c)} à ${fx(100 * c)}`,
    picker: (c) =>
      choicePicker('scratch', '🎟️ Ticket à gratter', `Trois symboles identiques = gagné !\n${SCRATCH.map(([m, , e]) => `${e}${e}${e} → **${fx(m * c)}**`).join('\n')}`, [
        ['go', 'Gratter', '🎟️', ButtonStyle.Success],
      ]),
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
      return { base: win ? win[0] : 0, pick: 'Ticket', headline: `**[ ${cells.join(' | ')} ]**`, detail: cells.join('') };
    },
  },

  die: {
    title: '🎲 Dé exact',
    choices: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'],
    spinText: 'Le dé roule...',
    info: (c) => `victoire ${fx(DIE_MULT * c)}`,
    picker: (c) =>
      choicePicker('die', '🎲 Dé exact : devine le chiffre', `Un dé à 6 faces : trouve le bon chiffre et gagne **${fx(DIE_MULT * c)}** (1 chance sur 6).`,
        ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id) => [id, id.slice(1), '🎲'])),
    resolve(choice) {
      const n = randomInt(1, 7);
      const want = Number(choice.slice(1));
      return { base: n === want ? DIE_MULT : 0, pick: `Chiffre ${want}`, headline: `Le dé s'arrête sur **${dieFace(n)} ${n}**`, detail: `${want} → ${n}` };
    },
  },

  chest: {
    title: '📦 Coffre mystère',
    choices: ['c1', 'c2', 'c3'],
    spinText: 'Tu ouvres le coffre...',
    info: (c) => `victoire ${fx(CHEST_MULT * c)}`,
    picker: (c) =>
      choicePicker('chest', '📦 Coffre mystère : 1 trésor, 3 coffres', `Un seul coffre contient le trésor : trouve-le et gagne **${fx(CHEST_MULT * c)}**.`,
        ['c1', 'c2', 'c3'].map((id) => [id, `Coffre ${id.slice(1)}`, '📦'])),
    resolve(choice) {
      const win = randomInt(1, 4);
      const want = Number(choice.slice(1));
      const view = [1, 2, 3].map((k) => (k === win ? '💎' : '💨')).join('  ');
      return { base: win === want ? CHEST_MULT : 0, pick: `Coffre ${want}`, headline: `Contenu des coffres : ${view}`, detail: `${want} → ${win}` };
    },
  },

  russian: {
    title: '🔫 Roulette russe',
    choices: ['b1', 'b2', 'b3', 'b4', 'b5'],
    spinText: 'Le barillet tourne...',
    info: (c) => `de ${fx(russianMult(1) * c)} à ${fx(russianMult(5) * c)}`,
    picker: (c) =>
      choicePicker('russian', '🔫 Roulette russe : combien de balles ?', `Barillet de 6 chambres. Survis et gagne ! Plus il y a de balles, plus le gain est gros.\n${[1, 2, 3, 4, 5].map((k) => `**${k}** balle${k > 1 ? 's' : ''} : ${fx(russianMult(k) * c)}`).join(' · ')}`,
        [1, 2, 3, 4, 5].map((k) => [`b${k}`, `${k} balle${k > 1 ? 's' : ''}`, '🔫'])),
    resolve(choice) {
      const k = Number(choice.slice(1));
      const dead = randomInt(0, 6) < k;
      return { base: dead ? 0 : russianMult(k), pick: `${k} balle${k > 1 ? 's' : ''}`, headline: dead ? '💥 **BANG !** Tu as perdu.' : '😮‍💨 *clic*… Tu survis !', detail: dead ? 'bang' : 'clic' };
    },
  },

  horses: {
    title: '🏇 Course de chevaux',
    choices: ['h1', 'h2', 'h3', 'h4', 'h5'],
    spinText: 'Les chevaux s’élancent...',
    info: (c) => `de ${fx(HORSES[0].mult * c)} à ${fx(HORSES[4].mult * c)}`,
    picker: (c) =>
      choicePicker('horses', '🏇 Course de chevaux : mise sur ton cheval', HORSES.map((h, k) => `🐎 **n°${k + 1}** : ${fx(h.mult * c)} (${Math.round(h.p * 100)} % de chances)`).join('\n'),
        HORSES.map((h, k) => [`h${k + 1}`, `Cheval ${k + 1}`, '🐎'])),
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
      return { base: winner === want ? HORSES[want].mult : 0, pick: `Cheval ${want + 1}`, headline: `🏁 Le cheval **n°${winner + 1}** remporte la course !`, detail: `${want + 1} → ${winner + 1}` };
    },
  },
});

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
    let mult = res.base > 0 ? round2(res.base * c * (boost.winMult || 1)) : 0;
    let payout = mult > 0 ? floor2(bet * mult) : 0;
    // x2 pertes : on retire un supplément (mise déjà débitée → débit additionnel)
    let extraLoss = 0;
    if (payout === 0 && (boost.loseMult || 1) > 1) {
      extraLoss = floor2(bet * ((boost.loseMult || 1) - 1));
      if (extraLoss > 0) await debit(uid, extraLoss).catch(() => {});
    }
    const profit = round2(payout - bet - extraLoss);

    try {
      await respond(i, {
        embeds: [
          new EmbedBuilder()
            .setTitle(G.title)
            .setColor(COLORS.violet)
            .setDescription(
              `${G.spinText}\nMise **${fmt(bet)}** · ${res.pick}` +
                (boost.label ? `\n⚡ Boost actif : **${boost.label}**` : '')
            ),
        ],
        components: [],
      });
    } catch (e) {
      await credit(uid, bet + extraLoss).catch(() => {});
      throw e;
    }

    const balance = payout > 0 ? await credit(uid, payout) : await getBalance(uid);

    // Animations visuelles par jeu
    const animFrames = (() => {
      const d = () => dieFace(randomInt(1, 7));
      const slotSyms = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣'];
      const s = () => slotSyms[randomInt(0, slotSyms.length)];
      switch (key) {
        case 'coinflip':
          return [
            { text: '```\n    ╭───╮\n    │   │\n    ╰───╯\n```\n✨ La pièce est lancée…', ms: 450 },
            { text: '```\n   ╱ ─── ╲\n  │  ···  │\n   ╲ ─── ╱\n```\n🪙 Elle tourne dans les airs…', ms: 450 },
            { text: '```\n    ╭─·─╮\n   ╱     ╲\n  │  ✦ ✦  │\n   ╲     ╱\n    ╰───╯\n```\n💨 Virevolte…', ms: 500 },
            { text: '```\n    ╭───╮\n    │ ? │\n    ╰───╯\n```\n⬇️ Elle redescend…', ms: 500 },
          ];
        case 'dice':
          return [
            { text: `\`\`\`\n  ${d()}     ${d()}\n\`\`\`\n🎲 Lancer des dés…`, ms: 400 },
            { text: `\`\`\`\n ${d()}  ~  ${d()}\n\`\`\`\n💥 Ça rebondit…`, ms: 400 },
            { text: `\`\`\`\n  ${d()}  ·  ${d()}\n\`\`\`\n🌀 Encore un tour…`, ms: 450 },
            { text: `\`\`\`\n   ${d()}   ${d()}\n\`\`\`\n⏳ Stabilisation…`, ms: 500 },
          ];
        case 'slots':
          return [
            { text: '```\n╔═══════════════╗\n║  ░  │  ░  │  ░  ║\n╚═══════════════╝\n```\n🎰 Rouleaux en marche…', ms: 450 },
            { text: `\`\`\`\n╔═══════════════╗\n║  ${s()}  │  ░  │  ░  ║\n╚═══════════════╝\n\`\`\`\n🔒 1er rouleau bloqué…`, ms: 550 },
            { text: `\`\`\`\n╔═══════════════╗\n║  ${s()}  │  ${s()}  │  ░  ║\n╚═══════════════╝\n\`\`\`\n🔒 2e rouleau…`, ms: 550 },
            { text: `\`\`\`\n╔═══════════════╗\n║  ${s()}  │  ${s()}  │  ${s()}  ║\n╚═══════════════╝\n\`\`\`\n✨ Révélation…`, ms: 500 },
          ];
        case 'wheel':
          return [
            { text: '```\n      ╭───╮\n   ╱    ▲    ╲\n  │  ·  ·  ·  │\n   ╲    ·    ╱\n      ╰───╯\n```\n🎡 La roue s’élance…', ms: 450 },
            { text: '```\n      ╭───╮\n   ╱    ·    ╲\n  │  ▲  ·  ·  │\n   ╲    ·    ╱\n      ╰───╯\n```\n💫 Vitesse max…', ms: 400 },
            { text: '```\n      ╭───╮\n   ╱    ·    ╲\n  │  ·  ·  ▲  │\n   ╲    ·    ╱\n      ╰───╯\n```\n🌀 Elle tourne…', ms: 400 },
            { text: '```\n      ╭───╮\n   ╱    ·    ╲\n  │  ·  ▲  ·  │\n   ╲    ·    ╱\n      ╰───╯\n```\n⏳ Ralentit…', ms: 550 },
            { text: '```\n      ╭───╮\n   ╱    ▲    ╲\n  │  ·  ·  ·  │\n   ╲    ·    ╱\n      ╰───╯\n```\n🎯 Dernier tour…', ms: 500 },
          ];
        case 'duel':
          return [
            { text: '```\n  🂠          🂠\n   Toi      Croupier\n```\n⚔️ Distribution des cartes…', ms: 500 },
            { text: '```\n  🂠  →        🂠  →\n```\n✨ Les cartes glissent…', ms: 550 },
            { text: '```\n  ┌───┐      ┌───┐\n  │ ? │  VS  │ ? │\n  └───┘      └───┘\n```\n👁️ Révélation…', ms: 550 },
          ];
        case 'suit':
          return [
            { text: '```\n  ♠️  ♥️  ♦️  ♣️\n```\n🃏 Mélange du jeu…', ms: 450 },
            { text: '```\n  ♥️  ♦️  ♣️  ♠️\n```\n🔀 Les enseignes défilent…', ms: 450 },
            { text: '```\n  ♦️  ♣️  ♠️  ♥️\n```\n✨ Une carte est tirée…', ms: 500 },
            { text: '```\n     ┌───┐\n     │ ? │\n     └───┘\n```\n🎴 Face visible…', ms: 500 },
          ];
        case 'zone':
          return [
            { text: '```\n  [ 1 ][ 2 ][ 3 ][ 4 ][ 5 ]\n  [ 6 ][ 7 ][ 8 ][ 9 ][10 ]\n```\n🎯 Tirage en cours…', ms: 450 },
            { text: '```\n  [ · ][ · ][ ★ ][ · ][ · ]\n  [ · ][ · ][ · ][ · ][ · ]\n```\n⚡ Le curseur bouge…', ms: 450 },
            { text: '```\n  [ · ][ · ][ · ][ · ][ · ]\n  [ · ][ ★ ][ · ][ · ][ · ]\n```\n🎲 Ça ralentit…', ms: 500 },
          ];
        case 'plinko': {
          // Animation bille réelle suivant le path (0 = gauche, 1 = droite)
          const path = res.path || [0, 1, 0, 1, 0, 1, 0, 1];
          const frames = [];
          let col = 0; // position 0..8
          const width = 9;
          const peg = (r, c) => {
            // Grille de piquets + bille
            const lines = [];
            lines.push('     PLINKO');
            for (let row = 0; row <= 8; row++) {
              let line = '';
              const slots = row + 1;
              const pad = Math.max(0, 8 - row);
              line += ' '.repeat(pad);
              for (let s = 0; s < slots; s++) {
                if (row === r && s === c) line += '●';
                else if (row < 8) line += '·';
                else line += '▽';
                line += ' ';
              }
              lines.push(line);
            }
            // cases multiplicateurs en bas
            if (res.mults) {
              const bot = res.mults
                .map((m, k) => (k === (res.bin ?? -1) && r >= 8 ? `[${m}]` : `${m}`))
                .join(' ');
              lines.push(bot);
            }
            return '```\n' + lines.join('\n') + '\n```';
          };
          frames.push({
            text: peg(0, 0) + '\n🎱 **Lâcher** de la bille…',
            ms: 500,
          });
          for (let row = 0; row < path.length; row++) {
            if (path[row] === 1) col += 1;
            const dir = path[row] === 1 ? '↘️' : '↙️';
            frames.push({
              text: peg(row + 1, col) + `\n${dir} Rebond rangée **${row + 1}/8**…`,
              ms: 480,
            });
          }
          frames.push({
            text: peg(8, col) + `\n💥 Case **${(res.bin ?? col) + 1}** !`,
            ms: 700,
          });
          return frames;
        }
        case 'crash':
          return [
            { text: '```\n   🚀\n   ║\n   ║\n  ═╩═\n```\n3️⃣ …', ms: 350 },
            { text: '```\n   🚀\n   ║\n  ═╩═\n```\n2️⃣ …', ms: 350 },
            { text: '```\n   🚀\n  ═╩═\n```\n1️⃣ Décollage !', ms: 350 },
            { text: '```\n      🚀 ✦\n     ╱\n    ╱\n   ═\n```\n📈 x1.5 · x2 · x3…', ms: 500 },
            { text: '```\n         🚀 ✦✦\n        ╱\n       ╱\n      ╱\n```\n🔥 Monte encore…', ms: 550 },
          ];
        case 'scratch':
          return [
            { text: '```\n┌─────┬─────┬─────┐\n│ ░░░ │ ░░░ │ ░░░ │\n└─────┴─────┴─────┘\n```\n🎟️ Tu commences à gratter…', ms: 450 },
            { text: '```\n┌─────┬─────┬─────┐\n│  ⭐  │ ░░░ │ ░░░ │\n└─────┴─────┴─────┘\n```\n✨ Première case…', ms: 450 },
            { text: '```\n┌─────┬─────┬─────┐\n│  ⭐  │  🔔  │ ░░░ │\n└─────┴─────┴─────┘\n```\n✨ Deuxième case…', ms: 450 },
            { text: '```\n┌─────┬─────┬─────┐\n│  ⭐  │  🔔  │  ??  │\n└─────┴─────┴─────┘\n```\n👀 Dernière case…', ms: 500 },
          ];
        case 'die':
          return [
            { text: `\`\`\`\n   ╭─────╮\n   │  ${d()}  │\n   ╰─────╯\n\`\`\`\n🎲 Le dé tourne…`, ms: 350 },
            { text: `\`\`\`\n  ╱───────╲\n │    ${d()}    │\n  ╲───────╱\n\`\`\`\n🌀 …`, ms: 350 },
            { text: `\`\`\`\n   ╭─────╮\n   │  ${d()}  │\n   ╰─────╯\n\`\`\`\n⏳ Ralentit…`, ms: 400 },
            { text: `\`\`\`\n   ╔═════╗\n   ║  ${d()}  ║\n   ╚═════╝\n\`\`\`\n🎯 Presque…`, ms: 450 },
          ];
        case 'chest':
          return [
            { text: '```\n  📦     📦     📦\n  #1     #2     #3\n```\n👀 Tu observes les coffres…', ms: 450 },
            { text: '```\n  📦     📦✨    📦\n  #1     #2     #3\n```\n✨ Une lueur…', ms: 500 },
            { text: '```\n  📦     📦     📦\n   ↑      ↑      ↑\n```\n🔑 Tu fais ton choix…', ms: 500 },
            { text: '```\n     ╔══════╗\n     ║  ??  ║\n     ╚══════╝\n```\n📤 Ouverture…', ms: 550 },
          ];
        case 'russian':
          return [
            { text: '```\n    ╭──────╮\n   ╱ ● ● ● ╲\n  │  ● ● ●  │\n   ╲______╱\n```\n🔫 Barillet chargé…', ms: 500 },
            { text: '```\n    ╭──────╮\n   ╱  ● ●  ╲\n  │ ●  ·  ● │\n   ╲__●___╱\n```\n🔄 Ça tourne…', ms: 550 },
            { text: '```\n    ╭──────╮\n   ╱ ·  ·  ╲\n  │ ·  ●  · │\n   ╲__·___╱\n```\n😬 Une chambre…', ms: 600 },
            { text: '```\n      ╭─╮\n      │⚡│\n      ╰─╯\n```\n👆 Détente…', ms: 700 },
          ];
        case 'horses':
          return [
            { text: '```\n🏁 1 🐎\n   2 🐎\n   3 🐎\n   4 🐎\n   5 🐎\n```\n📢 Sous les starters…', ms: 450 },
            { text: '```\n🏁 1  🐎💨\n   2 🐎\n   3  🐎💨\n   4 🐎\n   5   🐎💨\n```\n🚀 Ils s’élancent !', ms: 550 },
            { text: '```\n🏁 1    🐎💨\n   2   🐎💨\n   3     🐎💨\n   4  🐎💨\n   5    🐎💨\n```\n🔥 Dernière ligne droite…', ms: 600 },
            { text: '```\n🏁 1      🐎\n   2     🐎\n   3       🐎\n   4    🐎\n   5      🐎\n```\n🏆 Sprint final…', ms: 550 },
          ];
        default:
          return [{ text: G.spinText, ms: 1200 }];
      }
    })();

    await animateSteps(i, animFrames, G.title, `Mise **${fmt(bet)}** · ${res.pick}\n\n`);

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
        { name: 'Solde', value: fmt(balance), inline: true }
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`replay|${key}|${bet}|${choice}`)
        .setLabel('Rejouer')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Success)
    );
    await i.editReply({ embeds: [embed], components: [row] });

    recordResult({
      guildId: resolveGuildId(i),
      user: i.user,
      game: key,
      bet,
      mult,
      payout,
      detail: `${res.pick} → ${res.detail}`,
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
    .setAuthor({ name: 'Guide du Casino' })
    .setTitle('✨ Comment jouer')
    .setDescription(
      [
        '```',
        ' ┌─────────────────────────────┐',
        ' │   PARTIES 100 % PRIVÉES     │',
        ' │   Clique · Mise · Résultat  │',
        ' └─────────────────────────────┘',
        '```',
        '',
        'Tout se joue avec les **boutons** — aucune commande obligatoire.',
      ].join('\n')
    )
    .addFields(
      {
        name: '🎮 Jeux',
        value:
          '**Mines** · **Blackjack** · **Roulette** · **Slots** · **Plinko** · **Crash** et 11 autres.\n' +
          'Ouvre **Jouer** → choisis un jeu → entre ta mise.',
        inline: false,
      },
      {
        name: '🎁 Daily',
        value: `**${DAILY_AMOUNT} ${COIN}** / jour (reset à minuit **Paris**).`,
        inline: true,
      },
      {
        name: '📨 Invites',
        value: `**+${INVITE_REWARD} ${COIN}** par ami qui rejoint.`,
        inline: true,
      },
      {
        name: '💸 Transfert',
        value: 'Envoie des coins à un membre du serveur.',
        inline: true,
      },
      {
        name: '👑 Admin',
        value:
          `\`${p}setup\` salon · \`${p}admin\` panneau · \`${p}wins\` · \`${p}classement\`\n` +
          `\`${p}add\` / \`${p}remove\` · événements · boosts · notifs`,
        inline: false,
      }
    )
    .setFooter({ text: `Monnaie : ${COIN} · Rejouer dispo après chaque partie` })
    .setTimestamp();
}

function buildPanelPayload() {
  // Style simple (mobile-friendly) — pas de blocs ANSI
  const panel = new EmbedBuilder()
    .setColor(0x7C3AED)
    .setAuthor({ name: 'ZNK CASINO' })
    .setTitle('Salon de jeu')
    .setDescription(
      [
        `**Daily** · **${DAILY_AMOUNT} ${COIN}** · 1× / jour · minuit Paris`,
        '',
        '**Start** → ouvre ton casino **en message privé** (jeux, solde, daily…)',
        '**Langue** → 🇫🇷 Français ou 🇬🇧 English (sauvegardé)',
        '**Clear** → ferme tes parties en cours',
        '',
        '🔒 Tes parties restent privées.',
      ].join('\n')
    )
    .setFooter({ text: `${COIN} · ZNK Casino` })
    .setTimestamp();

  const rowMain = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_start').setLabel('Start').setEmoji('▶️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_settings').setLabel('Langue').setEmoji('🌐').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_clear').setLabel('Clear').setEmoji('🧹').setStyle(ButtonStyle.Danger)
  );
  const rowRanks = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_top').setLabel('Classement').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_topall').setLabel('All-time').setEmoji('👑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_invites').setLabel('Invites').setEmoji('📨').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [panel], components: [rowMain, rowRanks] };
}

/** Panel privé (MP ou éphémère) : tout pour jouer. */
function buildDmPlayPayload(userId) {
  const lang = getLang(userId);
  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setAuthor({ name: 'ZNK CASINO' })
    .setTitle(lang === 'en' ? 'Your private casino' : 'Ton casino privé')
    .setDescription(
      lang === 'en'
        ? `Language saved: **English**\nDaily: **${DAILY_AMOUNT} ${COIN}** · once per day (Paris midnight)\nPick a game below or use the account buttons.`
        : `Langue enregistrée : **Français**\nDaily : **${DAILY_AMOUNT} ${COIN}** · 1× / jour (minuit Paris)\nChoisis un jeu ci-dessous ou utilise les boutons compte.`
    )
    .setFooter({ text: `ZNK · ${COIN}` })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_play').setLabel(lang === 'en' ? 'Play' : 'Jouer').setEmoji('🎮').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_daily').setLabel('Daily').setEmoji('🎁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_balance').setLabel(lang === 'en' ? 'Balance' : 'Solde').setEmoji('💰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_send').setLabel(lang === 'en' ? 'Send' : 'Envoyer').setEmoji('💸').setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_history').setLabel(lang === 'en' ? 'History' : 'Historique').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_top').setLabel(lang === 'en' ? 'Leaderboard' : 'Classement').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_topall').setLabel('All-time').setEmoji('👑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_clear').setLabel('Clear').setEmoji('🧹').setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row1, row2] };
}

// Menu jeux : TOUS les jeux visibles (17 ≤ 5×4 boutons), + select menu en secours
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
const MENU_PAGE_SIZE = 25; // plus de pagination nécessaire (< 25)
const MENU_PAGES = 1;

/** Menu jeux = “popup” Discord : message éphémère + select natif (overlay). */
function buildGameMenuPayload(userId = null) {
  const lang = userId ? getLang(userId) : 'fr';
  const names = {
    fr: null, // labels already French in GAME_MENU
    en: {
      mines: 'Mines',
      bj: 'Blackjack',
      roulette: 'Roulette',
      coinflip: 'Coin Flip',
      dice: 'Dice',
      slots: 'Slots',
      wheel: 'Wheel',
      duel: 'Duel',
      suit: 'Suit',
      zone: 'Zone',
      plinko: 'Plinko',
      crash: 'Crash',
      scratch: 'Scratch',
      die: 'Exact die',
      chest: 'Chest',
      russian: 'Russian roulette',
      horses: 'Horses',
    },
  };
  const descs = {
    en: {
      mines: 'Avoid bombs · rising mult',
      bj: 'Beat the dealer · soft aces',
      roulette: 'Color · parity · number',
      coinflip: '50 / 50',
      dice: 'Sum of 2 dice',
      slots: '3 reels · jackpot',
      wheel: 'Wheel of fortune',
      duel: 'Card vs dealer',
      suit: 'Guess the suit',
      zone: 'Low · mid · high',
      plinko: 'Ball · risk level',
      crash: 'Cash out before boom',
      scratch: 'Scratch & win',
      die: '1 in 6',
      chest: 'Find the treasure',
      russian: 'Survive the cylinder',
      horses: 'Pick the winner',
    },
  };

  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setAuthor({ name: 'ZNK CASINO' })
    .setTitle(t(userId, 'lobbyTitle'))
    .setDescription(t(userId, 'lobbyDesc'))
    .setFooter({ text: t(userId, 'lobbyFooter') })
    .setTimestamp();

  // Un seul select = comportement le plus proche d’une popup Discord
  const select = new StringSelectMenuBuilder()
    .setCustomId('panel_gameselect')
    .setPlaceholder(t(userId, 'lobbyPlaceholder'))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      GAME_MENU.map(([key, name, emoji, desc]) => ({
        label: (lang === 'en' && names.en[key] ? names.en[key] : name).slice(0, 100),
        value: key,
        emoji,
        description: (lang === 'en' && descs.en[key] ? descs.en[key] : desc).slice(0, 100),
      }))
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

function buildSettingsPayload(userId) {
  const cur = getLang(userId);
  const embed = new EmbedBuilder()
    .setColor(COLORS.violet)
    .setTitle(`🌐 ${t(userId, 'langTitle')}`)
    .setDescription(
      `${t(userId, 'langDesc')}\n\n` +
        (cur === 'fr' ? '**Actuel / Current :** 🇫🇷 Français' : '**Actuel / Current :** 🇬🇧 English')
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel_lang_fr')
      .setLabel('Français')
      .setEmoji('🇫🇷')
      .setStyle(cur === 'fr' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel_lang_en')
      .setLabel('English')
      .setEmoji('🇬🇧')
      .setStyle(cur === 'en' ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

function modalInput(id, label, { placeholder, value, required = true, max = 30 } = {}) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
  if (placeholder) t.setPlaceholder(placeholder);
  if (value) t.setValue(value);
  return new ActionRowBuilder().addComponents(t);
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
    const payload = { ...INSTANT[instantKey].picker(coef(instantKey)), flags: EPH };
    if (i.isStringSelectMenu?.() && i.isStringSelectMenu()) return i.reply(payload);
    return i.reply(payload);
  }

  switch (i.customId) {
    case 'panel_start': {
      if (i.guild?.id) userHomeGuild.set(i.user.id, i.guild.id);
      const payload = buildDmPlayPayload(i.user.id);
      try {
        const dm = await i.user.createDM();
        await dm.send(payload);
        return i.reply({
          content:
            getLang(i.user.id) === 'en'
              ? '✅ **Start** sent in your DMs. Open your private messages with the bot.'
              : '✅ **Start** envoyé en **message privé**. Ouvre tes MP avec le bot.',
          flags: EPH,
        });
      } catch {
        return i.reply({
          content:
            getLang(i.user.id) === 'en'
              ? '⚠️ Could not DM you (DMs closed). Here’s your private panel instead:'
              : '⚠️ Impossible de t’écrire en MP (MP fermés). Voici ton panneau privé :',
          ...payload,
          flags: EPH,
        });
      }
    }
    case 'panel_play':
      return i.reply({ ...buildGameMenuPayload(i.user.id), flags: EPH });
    case 'panel_settings':
      return i.reply({ ...buildSettingsPayload(i.user.id), flags: EPH });
    case 'panel_clear': {
      const g = games.get(i.user.id);
      if (g?.timer) clearTimeout(g.timer);
      games.delete(i.user.id);
      unlock(i.user.id);
      return i.reply({
        content:
          getLang(i.user.id) === 'en'
            ? '🧹 Open games closed. You can play again from **Start** / **Play**.'
            : '🧹 Parties en cours fermées. Tu peux rejouer via **Start** / **Jouer**.',
        flags: EPH,
      });
    }
    case 'panel_lang_fr': {
      setLang(i.user.id, 'fr');
      return i.update({
        content: I18N.fr.langSet,
        embeds: [],
        components: [],
      });
    }
    case 'panel_lang_en': {
      setLang(i.user.id, 'en');
      return i.update({
        content: I18N.en.langSet,
        embeds: [],
        components: [],
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
      return i.editReply({ embeds: [await buildInvitesEmbed(i.guild, i.user.id)] });
    }
    case 'panel_send': {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('panel_send_pick')
          .setPlaceholder(getLang(i.user.id) === 'en' ? 'Pick a member' : 'Choisis un membre')
          .setMinValues(1)
          .setMaxValues(1)
      );
      return i.reply({
        content: t(i.user.id, 'sendPick'),
        components: [row],
        flags: EPH,
      });
    }
    default:
      return;
  }
}

/** Nettoie le salon casino et reposte le panneau (propriétaire uniquement). */
async function cleanCasinoChannel(i) {
  const casinoId = casinoChannels.get(i.guild.id);
  if (!casinoId || i.channelId !== casinoId) {
    return i.reply({
      content: '🧹 Ce bouton ne fonctionne que dans le salon **casino** créé avec `!setup`.',
      flags: EPH,
    });
  }
  const me = i.guild.members.me;
  if (!me?.permissionsIn(i.channel).has(PermissionFlagsBits.ManageMessages)) {
    return i.reply({
      content: '⚠️ Il me faut la permission **Gérer les messages** pour nettoyer le salon.',
      flags: EPH,
    });
  }

  await i.deferReply({ flags: EPH });
  const channel = i.channel;
  let deleted = 0;
  try {
    for (let n = 0; n < 20; n++) {
      const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched || fetched.size === 0) break;
      const young = fetched.filter((m) => Date.now() - m.createdTimestamp < 13 * 24 * 60 * 60 * 1000);
      if (young.size >= 2) {
        const res = await channel.bulkDelete(young, true).catch(() => null);
        deleted += res?.size ?? 0;
      } else {
        for (const m of fetched.values()) {
          await m.delete().catch(() => {});
          deleted++;
        }
        break;
      }
      if (fetched.size < 100) break;
    }
  } catch (e) {
    console.error('[clean]', e?.message || e);
  }

  const panelMsg = await channel.send(buildPanelPayload());
  await panelMsg.pin().catch(() => {});
  await supabase
    .from('casino_channels')
    .upsert({
      guild_id: i.guild.id,
      channel_id: channel.id,
      help_message_id: panelMsg.id,
      updated_at: new Date().toISOString(),
    })
    .then(() => {}, () => {});

  return i.editReply({
    content: `✅ Salon nettoyé (**${deleted}** message(s) supprimé(s)). Le panneau a été reposté.`,
  });
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
  if (id.startsWith('modal_send_')) {
    const toId = id.slice('modal_send_'.length);
    if (!/^\d{15,25}$/.test(toId)) return respondText(i, 'Destinataire invalide.');
    if (toId === i.user.id) return respondText(i, '❌ Tu ne peux pas t’envoyer de l’argent à toi-même.');
    const bal = await getBalance(i.user.id);
    const amount = parseAmount(get('amount'), bal);
    if (!amount) return respondText(i, 'Montant invalide : écris un nombre (ex : 1 ou 2.5) ou "all".');
    if (amount > bal) return respondText(i, MSG.insufficient);
    const newBal = await debit(i.user.id, amount);
    if (newBal === null) return respondText(i, MSG.insufficient);
    const toBal = await credit(toId, amount);
    return i.reply({
      content:
        `✅ Tu as envoyé **${fmt(amount)}** à <@${toId}>.\n` +
        `💰 Ton solde : **${fmt(newBal)}** · Solde du destinataire : **${fmt(toBal)}**`,
      flags: EPH,
    });
  }
}

// "Rejouer" : customId = replay|<jeu>|<mise>|<option>
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
    .setAuthor({ name: 'Console administrateur' })
    .setTitle('✦ Contrôle du casino')
    .setDescription(
      [
        '```ansi',
        '[2;31m╔══════════════════════════╗[0m',
        '[2;31m║[0m  [1;37mOWNER ONLY · ACTIONS[0m   [2;31m║[0m',
        '[2;31m╚══════════════════════════╝[0m',
        '```',
        '',
        'Chaque action publique affiche **qui** l’a lancée.',
      ].join('\n')
    )
    .addFields(
      { name: '💰 Économie', value: 'Ajouter · Retirer · Définir · Voir · Offrir à tous', inline: false },
      { name: '💥 Resets', value: 'Soldes (classement) · Records all-time', inline: false },
      { name: '🎚️ Live', value: 'Multiplicateurs · Événements · Boosts · Annonces', inline: false },
      { name: '📡 Salons', value: 'All-time · **Notifs** (cible des annonces admin)', inline: false }
    )
    .setFooter({ text: 'Visible uniquement par le propriétaire' })
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
// eventId -> {
//   type: 'claim'|'giveaway',
//   amount, maxWinners, winners: Set, entries: Set,
//   guildId, channelId, messageId, expiresAt, finished, timer
// }

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
  const e = new EmbedBuilder().setTitle('📢 Claim — premier arrivé').setColor(left > 0 ? COLORS.violet : COLORS.grey);
  if (ev.finished || left <= 0) {
    const names = [...ev.winners].map((id) => `<@${id}>`).join(', ') || 'personne';
    e.setDescription(`${host}🏁 **Terminé** — gagnant(s) : ${names}\nChacun a reçu **${fmt(ev.amount)}**.`);
  } else {
    const timeLine = ev.expiresAt ? `\n⏱️ Expire <t:${Math.floor(ev.expiresAt / 1000)}:R>` : '\n⏱️ Sans limite';
    e.setDescription(
      `${host}🎁 **${fmt(ev.amount)}** par gagnant\n` +
        `Places restantes : **${left}/${ev.maxWinners}**\n` +
        `Clique **Réclamer** pour empôcher ta part !${timeLine}`
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
      await msg.edit({
        embeds: [giveawayEmbed(ev)],
        components: [eventActionRow(eventId, 'giveaway', true)],
      });
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
      await msg.edit({
        embeds: [claimEventEmbed(ev)],
        components: [eventActionRow(eventId, 'claim', true)],
      });
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
  if (ev.winners.has(i.user.id)) {
    return i.reply({ content: 'Tu as déjà réclamé ta part !', flags: EPH });
  }
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
    await i.update({
      embeds: [claimEventEmbed(ev)],
      components: [eventActionRow(eventId, 'claim', done)],
    });
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
  if (!ev || ev.finished || ev.type !== 'giveaway') {
    return i.reply({ content: 'Ce giveaway est terminé.', flags: EPH });
  }
  if (ev.expiresAt && Date.now() > ev.expiresAt) {
    await finishGiveaway(eventId);
    return i.reply({ content: '⏱️ Le giveaway est terminé.', flags: EPH });
  }
  if (ev.entries.has(i.user.id)) {
    return i.reply({ content: 'Tu es déjà inscrit !', flags: EPH });
  }
  ev.entries.add(i.user.id);
  try {
    await i.update({
      embeds: [giveawayEmbed(ev)],
      components: [eventActionRow(eventId, 'giveaway', false)],
    });
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
        .setTitle(`⚡ ${p.label}`)
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

  if (type === 'giveaway') {
    ev.timer = setTimeout(() => finishGiveaway(eventId), expiresAt - Date.now());
  } else if (expiresAt) {
    ev.timer = setTimeout(() => expireClaimEvent(eventId), expiresAt - Date.now());
  }
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

// Description des gains "têtes d'affiche" de chaque jeu avec le coefficient actuel
const MULT_INFO = {
  mines: () => `1er 💎 : Easy ${fx(minesMultiplier(1, LEVELS.easy.mines))} · Impossible ${fx(minesMultiplier(1, LEVELS.impossible.mines))}`,
  bj: (c) => `victoire ${fx(2 * c)} · blackjack ${fx(2.5 * c)}`,
  roulette: (c) => `couleur/pair/impair ${fx(2 * c)} · numéro ${fx(36 * c)}`,
  coinflip: (c) => `victoire ${fx(COIN_MULT * c)}`,
  dice: (c) => `moins/plus de 7 ${fx(DICE_MULT.under * c)} · exactement 7 ${fx(DICE_MULT.seven * c)}`,
  slots: (c) => `3 cerises ${fx(5 * c)} · jackpot 7️⃣ ${fx(250 * c)}`,
  wheel: (c) => `de ${fx(0.5 * c)} à ${fx(10 * c)}`,
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
  if (i.user.id !== i.guild.ownerId) return i.reply({ content: CROWN_ONLY, flags: EPH });
  const id = i.customId;

  if (i.isButton()) {
    const action = id.slice('admin_'.length);
    if (action === 'mult') return i.reply({ ...multAdminPayload(), flags: EPH });
    if (action === 'event') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('admin_eventpick')
        .setPlaceholder('Type d’événement')
        .addOptions(
          EVENT_TYPES.map((t) => ({
            label: t.label,
            value: t.id,
            description: t.desc.slice(0, 100),
          }))
        );
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
          .addComponents(
            modalInput('confirm', 'Tape RESET pour confirmer', { placeholder: 'RESET', max: 10 })
          )
      );
    }
    if (action === 'resetpeaks') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_resetpeaks')
          .setTitle('👑 Reset classement all-time')
          .addComponents(
            modalInput('confirm', 'Tape RESET pour confirmer', { placeholder: 'RESET', max: 10 })
          )
      );
    }
    if (action === 'annonce') {
      return i.showModal(
        new ModalBuilder()
          .setCustomId('modal_admin_annonce')
          .setTitle('📣 Annonce récompense')
          .addComponents(
            modalInput('amount', `Nombre de ${COIN}`, { placeholder: 'ex : 100' }),
            modalInput('reward', 'Récompense (texte)', {
              placeholder: 'ex : un nitro d’1 mois',
              max: 100,
            })
          )
      );
    }
    if (action === 'alltimechan') {
      return createAllTimeChannel(i);
    }
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
          `🔔 Choisis le salon où envoyer les notifs admin (offrir all, reset, giveaway, boosts, annonces…).\n` +
          (current ? `Salon actuel : <#${current}>` : `Actuellement : salon **casino** (par défaut).`),
        components: [row],
        flags: EPH,
      });
    }
    if (ADMIN_TITLES[action]) {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`admin_pick_${action}`)
          .setPlaceholder('Choisis un membre')
          .setMinValues(1)
          .setMaxValues(1)
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
          .setTitle(`⚡ ${EVENT_TYPES.find((t) => t.id === kind)?.label || 'Boost'}`.slice(0, 45))
          .addComponents(
            modalInput('minutes', 'Durée en minutes', { placeholder: 'ex : 15', value: '15', max: 6 })
          )
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
    if (i.users?.get(userId)?.bot) {
      return i.update({ content: '❌ Choisis un vrai membre, pas un bot.', components: [] });
    }
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
        .addComponents(
          modalInput('amount', action === 'set' ? 'Nouveau solde' : 'Montant', {
            placeholder: 'ex : 10',
          })
        )
    );
  }

  if (i.isModalSubmit()) {
    // Reset soldes (pas de champ "amount")
    if (id === 'modal_admin_reset') {
      const confirm = i.fields.getTextInputValue('confirm')?.trim().toUpperCase();
      if (confirm !== 'RESET') {
        return respondText(i, 'Annulé : tu dois taper **RESET** pour confirmer.');
      }
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
        return i.reply({
          content: `✅ Soldes reset : **${count}** joueur(s) à 0.`,
          flags: EPH,
        });
      } catch (e) {
        console.error('[reset]', e?.message || e);
        return respondText(i, `Erreur reset : ${explainError(e)}`);
      }
    }

    if (id === 'modal_admin_resetpeaks') {
      const confirm = i.fields.getTextInputValue('confirm')?.trim().toUpperCase();
      if (confirm !== 'RESET') {
        return respondText(i, 'Annulé : tu dois taper **RESET** pour confirmer.');
      }
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
      const amountRaw = i.fields.getTextInputValue('amount')?.trim();
      const amount = parseAmount(amountRaw);
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

    // Boosts (champ "minutes" uniquement)
    const boostM = id.match(/^modal_admin_boost_([a-z0-9]+)$/);
    if (boostM) {
      const kind = boostM[1];
      const mRaw = i.fields.getTextInputValue('minutes')?.trim() || '15';
      const minutes = Math.max(1, Math.min(24 * 60, Math.floor(Number(String(mRaw).replace(',', '.')) || 15)));
      return postBoostEvent(i, kind, minutes);
    }

    // À partir d'ici les modals ont un champ "amount"
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
        // Fallback si la RPC échoue : update ligne par ligne (WHERE obligatoire côté API)
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
            .setDescription(
              `👤 Par <@${i.user.id}>\n` +
                `💰 **${fmt(amount)}** offerts à **chaque** joueur (**${count}** comptes).`
            )
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
//  .balance / .daily (commandes écrites)
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
const casinoChannels = new Map(); // guildId -> channelId (casino)
const guildChannels = new Map(); // "guildId:kind" -> channelId (wins, admin)

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
const alltimeBoardMessages = new Map(); // guildId -> { channelId, messageId }

/** Salon où poster les annonces admin (offrir all, reset, giveaway, boosts…). Fallback = casino. */
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
  if (!me.permissions.has(P.ManageChannels)) {
    return i.reply({ content: NEED_MANAGE_CHANNELS, flags: EPH });
  }
  const channel = await guild.channels.create({
    name: 'alltime',
    type: ChannelType.GuildText,
    topic: 'Classement all-time — solde max historique 👑',
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
  return i.reply({
    content: `✅ Salon <#${channel.id}> créé avec le classement all-time.${saved ? '' : DB_WARN}`,
    flags: EPH,
  });
}

// Au démarrage : retrouve les salons wins/admin par leur nom si la base ne les connaît pas
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
  // Pas (ou plus) enregistré : on cherche un salon portant le bon nom (cas où la table n'existait pas)
  const all = await guild.channels.fetch().catch(() => null);
  const found = all?.find((c) => c && c.type === ChannelType.GuildText && c.name === CHANNEL_NAMES[kind]);
  if (found) await saveChannel(guild.id, kind, found.id);
  return found || null;
}

// Garde toujours le salon en mémoire ; la base est "au mieux" (renvoie false si la sauvegarde a échoué)
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

// Message d'aide lisible pour le propriétaire quand une commande plante
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
      // Personne (sauf le propriétaire) n'écrit dans le salon : on joue avec les boutons
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
    : '\n⚠️ Il me manque **Gérer les messages** : je ne pourrai pas épingler le panneau ni nettoyer le salon.';
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
        allow: botCan(guild, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]),
      },
    ],
  });
  const saved = await saveChannel(guild.id, 'wins', channel.id);
  return msg.reply(
    `✅ Salon <#${channel.id}> créé : chaque victoire (jeu, mise, multiplicateur, gain) s’y affichera automatiquement.${saved ? '' : DB_WARN}`
  );
}

// ---------- !invites-notif : salon des notifications d'invitations ----------
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

// ---------- !admin : salon privé avec le panneau admin ----------
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
      {
        id: guild.ownerId,
        type: OverwriteType.Member,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
      },
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
    const name = u
      ? escapeMarkdown(u.globalName || u.username)
      : lang === 'en'
        ? 'Unknown user'
        : 'Utilisateur inconnu';
    lines.push(`${medals[i] ?? `**${i + 1}.**`} ${name} : **${fmt(data[i].balance)}**`);
  }

  return new EmbedBuilder()
    .setTitle(lang === 'en' ? '🏆 Richest players' : '🏆 Classement des plus riches')
    .setColor(COLORS.gold)
    .setDescription(
      lines.length
        ? lines.join('\n')
        : lang === 'en'
          ? 'No balances yet.'
          : 'Personne n’a encore de coins.'
    )
    .setFooter({
      text: lang === 'en' ? 'Auto-updated every minute' : 'Mis à jour automatiquement toutes les minutes',
    })
    .setTimestamp();
}

async function buildAllTimeLeaderboardEmbed(lang = 'fr') {
  try {
    const { data } = await supabase.from('players').select('user_id, balance').gt('balance', 0).limit(50);
    if (data) {
      for (const r of data) await touchPeak(r.user_id, Number(r.balance));
    }
  } catch {
    /* ignore */
  }

  const ranked = [...peaks.entries()]
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const medals = ['🥇', '🥈', '🥉'];
  const lines = [];
  for (let i = 0; i < ranked.length; i++) {
    const [uid, peak] = ranked[i];
    const u = await client.users.fetch(uid).catch(() => null);
    const name = u
      ? escapeMarkdown(u.globalName || u.username)
      : lang === 'en'
        ? 'Unknown user'
        : 'Utilisateur inconnu';
    lines.push(`${medals[i] ?? `**${i + 1}.**`} ${name} : **${fmt(peak)}**`);
  }

  return new EmbedBuilder()
    .setTitle(lang === 'en' ? '👑 All-time leaderboard (peak balance)' : '👑 Classement all-time (solde max)')
    .setColor(COLORS.violet)
    .setDescription(
      lines.length
        ? lines.join('\n')
        : lang === 'en'
          ? 'No records yet. Peaks update on every win.'
          : 'Aucun record encore. Les pics se mettent à jour à chaque gain.'
    )
    .setFooter({
      text: lang === 'en' ? 'Record = highest balance ever reached' : 'Record = plus haut solde jamais atteint',
    })
    .setTimestamp();
}

async function cmdLeaderboard(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);

  // Supprime l'ancien classement de ce serveur s'il existe
  const { data: old } = await supabase
    .from('leaderboard_messages')
    .select('*')
    .eq('guild_id', msg.guild.id)
    .maybeSingle();
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

  msg.delete().catch(() => {}); // nécessite "Gérer les messages", sinon ignoré
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

    // Classement all-time (salons dédiés)
    if (alltimeBoardMessages.size > 0) {
      const allEmbed = await buildAllTimeLeaderboardEmbed();
      for (const [gid, info] of alltimeBoardMessages) {
        try {
          const ch = await client.channels.fetch(info.channelId);
          const m = await ch.messages.fetch(info.messageId);
          await m.edit({ embeds: [allEmbed] });
        } catch (e) {
          if ([10008, 10003, 50001, 50013].includes(e?.code)) {
            alltimeBoardMessages.delete(gid);
          } else {
            console.error('[alltime] edit', e?.message || e);
          }
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
    // Autorise le serveur + les MP (Start en DM) si on a un customId
    if (!i.customId) return;
    if (!i.guild && !userHomeGuild.has(i.user.id) && !i.customId.startsWith('panel_') && !i.customId.startsWith('modal_') && !i.customId.startsWith('ig_') && !i.customId.startsWith('rl_') && !i.customId.startsWith('bj_') && !i.customId.startsWith('mines_') && !i.customId.startsWith('replay|')) {
      return;
    }
    const id = i.customId;

    // Panneau admin
    if (id.startsWith('admin_') || id.startsWith('modal_admin_')) return await handleAdmin(i);

    // Événements (claim / giveaway)
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

    // Envoi d’argent : choix du destinataire
    if (i.isUserSelectMenu() && id === 'panel_send_pick') {
      const userId = i.values[0];
      if (userId === i.user.id) {
        return i.update({ content: '❌ Tu ne peux pas t’envoyer de l’argent à toi-même.', components: [] });
      }
      if (i.users?.get(userId)?.bot) {
        return i.update({ content: '❌ Tu ne peux pas envoyer d’argent à un bot.', components: [] });
      }
      return i.showModal(
        new ModalBuilder()
          .setCustomId(`modal_send_${userId}`)
          .setTitle('💸 Envoyer de l’argent')
          .addComponents(modalInput('amount', 'Montant à envoyer (ou "all")', { placeholder: 'ex : 5' }))
      );
    }

    // Menu déroulant des jeux (lobby)
    if (i.isStringSelectMenu() && id === 'panel_gameselect') {
      const key = i.values[0];
      // Simule le clic bouton panel_<key>
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
      const hint = i.user.id === i.guild.ownerId ? `\n${explainError(e)}` : '';
      i.reply({ content: `⚠️ Une erreur est survenue, réessaie dans un instant.${hint}`, flags: EPH }).catch(() => {});
    }
  }
});

// ============================================================
//  INVITATIONS : +1 pièce pour celui qui invite quelqu'un qui rejoint
// ============================================================
const inviteCache = new Map(); // guildId -> Map(code -> { uses, max, inviterId })
const rewardedLocal = new Set(); // secours si la table invite_rewards est absente

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

// true si la récompense doit être donnée (une seule fois par membre invité, même s'il quitte puis revient)
async function claimInviteReward(guildId, invitedId, inviterId) {
  const key = `${guildId}:${invitedId}`;
  if (rewardedLocal.has(key)) return false;
  const { error } = await supabase
    .from('invite_rewards')
    .insert({ guild_id: guildId, invited_id: invitedId, inviter_id: inviterId });
  if (error) {
    if (error.code === '23505') return false; // déjà récompensé
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
        // invitation à usage limité, supprimée après le dernier usage
        for (const [code, o] of old) {
          if (!fresh.has(code) && o.max > 0 && o.uses + 1 >= o.max) {
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
        .setDescription(
          `📨 <@${inviterId}> a invité <@${member.id}>\n` +
            `🎁 Récompense : **${fmt(INVITE_REWARD)}**`
        )
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
client.on(Events.InviteDelete, () => {}); // on garde l'entrée : elle sert à repérer une invitation épuisée
client.on(Events.GuildCreate, (guild) => cacheInvites(guild));

async function buildInvitesEmbed(guild, targetId) {
  const [{ count, error: countError }, { data, error: listError }] = await Promise.all([
    supabase
      .from('invite_rewards')
      .select('invited_id', { count: 'exact', head: true })
      .eq('guild_id', guild.id)
      .eq('inviter_id', targetId),
    supabase
      .from('invite_rewards')
      .select('invited_id')
      .eq('guild_id', guild.id)
      .eq('inviter_id', targetId)
      .limit(20),
  ]);
  if (countError) throw countError;
  if (listError) throw listError;

  const invitedIds = [...new Set((data || []).map((row) => row.invited_id).filter(Boolean))];
  const members = invitedIds.length
    ? invitedIds.map((id) => `<@${id}>`).join('\n')
    : 'Aucun membre invité enregistré pour le moment.';
  const total = count ?? 0;

  return new EmbedBuilder()
    .setTitle('📨 Tes invitations')
    .setColor(COLORS.blue)
    .setDescription(`Tu as invité **${total}** membre(s) et reçu **${fmt(total * INVITE_REWARD)}**.`)
    .addFields({
      name: `Membres invités${total > 20 ? ' (20 affichés)' : ''}`,
      value: members.slice(0, 1024),
    });
}

async function cmdInvites(msg, args) {
  const targetId = parseUserId(args[0]) || msg.author.id;
  return msg.reply({ embeds: [await buildInvitesEmbed(msg.guild, targetId)] });
}

// Si un salon enregistré est supprimé à la main, on le "désenregistre"
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
  loadMultipliers();
  loadPeaks();
  for (const g of c.guilds.cache.values()) cacheInvites(g);
  loadChannels().then(restoreChannelsByName);
  setInterval(updateLeaderboards, LEADERBOARD_REFRESH_MS);
  updateLeaderboards();
});

client.on(Events.Error, (e) => console.error('[client]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

// Démarrage : on vérifie quels intents "privilégiés" sont activés dans le Developer Portal.
// Si "Server Members Intent" manque, le bot démarre quand même (sans le système d'invitations) au lieu de planter.
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
        console.warn('⚠️ "Message Content Intent" n’est pas activé : les commandes écrites (!setup, !admin…) ne marcheront pas.');
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
