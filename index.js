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
  escapeMarkdown,
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// ============================================================
//  CONFIG
// ============================================================
const PREFIX = '!';
const COIN = '🪙';
const DAILY_AMOUNT = 2;
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
  ],
  allowedMentions: { parse: [], repliedUser: false },
});

const COLORS = { green: 0x2ecc71, red: 0xe74c3c, grey: 0x95a5a6, blue: 0x5865f2, gold: 0xf1c40f };

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
  noMoney: `Tu n’as pas de pièces ${COIN}. Clique sur **🎁 Daily** dans le panneau pour récupérer ta récompense du jour.`,
  insufficient: 'Tu n’as pas assez de pièces pour cette mise.',
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
const credit = async (id, amount) => Number(await rpc('change_balance', { p_user_id: id, p_amount: amount }));

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
const GAME_NAMES = { mines: '💣 Mines', bj: '🃏 Blackjack', roulette: '🎡 Roulette' };

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
  return Math.min(MINES_MAX_MULT, Math.max(1, Math.floor(m * MINES_EDGE * 100) / 100));
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
      guildId: i.guildId,
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
      payout = floor2(game.bet * mult);
      color = COLORS.green;
      text =
        kind === 'timeout'
          ? `⏱️ Temps écoulé, encaissement automatique : **${fmt(payout)}** (${fx(mult)})`
          : `✅ Bien joué ! Tu encaisses **${fmt(payout)}** (${fx(mult)}), profit : **${signed(round2(payout - game.bet))}**.`;
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
const cardStr = (c) => `\`${c.r}\`${c.s}`;

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === 'A') {
      aces++;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(c.r)) total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function bjEmbed(g, end) {
  const e = new EmbedBuilder().setTitle('🃏 Blackjack');
  e.addFields(
    { name: `Ta main (${handValue(g.player)})`, value: g.player.map(cardStr).join('  ') },
    end
      ? { name: `Croupier (${handValue(g.dealer)})`, value: g.dealer.map(cardStr).join('  ') }
      : { name: `Croupier (${handValue([g.dealer[0]])})`, value: `${cardStr(g.dealer[0])}  🂠` },
    { name: 'Mise', value: fmt(g.bet), inline: true }
  );
  if (end) {
    e.setColor(end.color).setDescription(end.text);
    e.addFields({ name: 'Solde', value: fmt(end.balance), inline: true });
  } else {
    e.setColor(COLORS.blue).setDescription('À toi : **Tirer**, **Rester** ou **Doubler**.');
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
      const payout = floor2(bet * 2.5);
      return {
        payout,
        text: `🎉 **Blackjack !** Tu gagnes **${fmt(round2(payout - bet))}** (paiement 3:2).`,
        color: COLORS.green,
      };
    }
    return { payout: 0, text: '😬 Le croupier a un blackjack, mise perdue.', color: COLORS.red };
  }
  if (kind === 'bust') return { payout: 0, text: `💥 Tu dépasses 21 (${pv}), mise perdue.`, color: COLORS.red };
  if (dv > 21) return { payout: bet * 2, text: `🎉 Le croupier dépasse 21 ! Tu gagnes **${fmt(bet)}**.`, color: COLORS.green };
  if (pv > dv) return { payout: bet * 2, text: `🎉 ${pv} contre ${dv} : tu gagnes **${fmt(bet)}**.`, color: COLORS.green };
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
      guildId: i.guildId,
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
  try {
    if (kind === 'stand') {
      while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());
    }
    const out = bjOutcome(game, kind);
    const balance = out.payout > 0 ? await credit(game.userId, out.payout) : await getBalance(game.userId);
    recordResult({
      guildId: game.guildId,
      user: game.user,
      game: 'bj',
      bet: game.bet,
      mult: round2(out.payout / game.bet),
      payout: out.payout,
      detail: `${handValue(game.player)} vs ${handValue(game.dealer)}`,
    });
    const payload = {
      embeds: [bjEmbed(game, { text: out.text, color: out.color, balance })],
      components: bjRows(game, true),
    };
    if (i) await i.update(payload);
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
      return respondText(i, 'Pas assez de pièces pour doubler.');
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
      '🔴 Rouge · ⚫ Noir · Pair · Impair : paient **x2**\n' +
        '🟢 Vert (0) ou un **numéro** précis (0 à 36) : paient **x36**'
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
    const payout = won ? floor2(bet * choice.mult) : 0;

    try {
      await respond(i, {
        embeds: [
          new EmbedBuilder()
            .setTitle('🎡 Roulette')
            .setColor(COLORS.blue)
            .setDescription(`La roulette tourne... (mise **${fmt(bet)}** sur **${choice.label}**)`),
        ],
        components: [],
      });
    } catch (e) {
      await credit(uid, bet).catch(() => {});
      throw e;
    }

    const balance = payout > 0 ? await credit(uid, payout) : await getBalance(uid);
    await sleep(2500);

    const embed = new EmbedBuilder()
      .setTitle('🎡 Roulette')
      .setColor(won ? COLORS.green : COLORS.red)
      .setDescription(
        `La bille tombe sur **${colorEmoji[colorOf(result)]} ${result}** (${colorOf(result)}).\n\n` +
          (won
            ? `🎉 Gagné ! Tu empoches **${fmt(payout)}** (${fx(choice.mult)}), profit : **${signed(round2(payout - bet))}**.`
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
      guildId: i.guildId,
      user: i.user,
      game: 'roulette',
      bet,
      mult: won ? choice.mult : 0,
      payout,
      detail: `${choice.label} → ${result}`,
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
    .setTitle(`${COIN} Aide`)
    .setColor(COLORS.blue)
    .setDescription(
      [
        'Tout se joue avec les **boutons** du panneau, et tes parties sont **privées**.',
        '',
        `💣 **Mines** : 4 niveaux (Easy 3 💣 · Medium 6 · Hard 10 · Impossible 15). Plus il y a de bombes, plus le multiplicateur monte.`,
        '🃏 **Blackjack** : Tirer / Rester / Doubler, blackjack payé 3:2',
        '🎡 **Roulette** : x2 (couleur, pair, impair) ou x36 (numéro, vert)',
        `🎁 **Daily** : ${DAILY_AMOUNT} pièces gratuites par jour`,
        '📜 **Historique** : tes 15 dernières parties',
        '🔁 À la fin d’une partie, le bouton **Rejouer** relance la même mise.',
        '',
        '👑 **Propriétaire du serveur**',
        `**${p}setup** : créer le salon casino avec le panneau`,
        `**${p}wins** : créer le salon où s’affichent les victoires de tout le monde`,
        `**${p}admin** : créer le salon privé avec le panneau admin (ajouter, retirer, offrir à tous…)`,
        `**${p}classement** : classement auto (mis à jour chaque minute)`,
        `**${p}add** @membre <montant> · **${p}remove** @membre <montant>`,
      ].join('\n')
    );
}

function buildPanelPayload() {
  const panel = new EmbedBuilder()
    .setTitle('🎰 Casino')
    .setColor(COLORS.gold)
    .setDescription(
      'Clique sur un bouton pour jouer. Une fenêtre s’ouvre pour régler ta mise.\n\n' +
        '💣 **Mines** · 🃏 **Blackjack** · 🎡 **Roulette**\n' +
        `🎁 **Daily** : ${DAILY_AMOUNT} pièces gratuites par jour\n` +
        '💰 **Mon solde** · 🏆 **Classement** · 📜 **Historique** · ❓ **Aide**\n\n' +
        '🔒 Tes parties, ton solde et ton historique ne sont visibles que par toi.'
    );
  const games = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_mines').setLabel('Mines').setEmoji('💣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_bj').setLabel('Blackjack').setEmoji('🃏').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_roulette').setLabel('Roulette').setEmoji('🎡').setStyle(ButtonStyle.Primary)
  );
  const extra = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_balance').setLabel('Solde').setEmoji('💰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_daily').setLabel('Daily').setEmoji('🎁').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_top').setLabel('Classement').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_history').setLabel('Historique').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_help').setLabel('Aide').setEmoji('❓').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [panel], components: [games, extra] };
}

function modalInput(id, label, { placeholder, value, required = true, max = 30 } = {}) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
  if (placeholder) t.setPlaceholder(placeholder);
  if (value) t.setValue(value);
  return new ActionRowBuilder().addComponents(t);
}

const BET_LABEL = 'Ta mise (ou "all" pour tout miser)';

const minesBetModal = (level) =>
  new ModalBuilder()
    .setCustomId(`modal_mines_${level}`)
    .setTitle(`💣 Mines · ${LEVELS[level].name}`)
    .addComponents(modalInput('bet', BET_LABEL, { placeholder: 'ex : 1' }));

const blackjackModal = () =>
  new ModalBuilder()
    .setCustomId('modal_bj')
    .setTitle('🃏 Blackjack')
    .addComponents(modalInput('bet', BET_LABEL, { placeholder: 'ex : 2' }));

function rouletteModal(key) {
  const m = new ModalBuilder()
    .setCustomId(`modal_rl_${key}`)
    .setTitle(key === 'num' ? '🎡 Roulette · Numéro' : `🎡 Roulette · ${parseRouletteBet(key).label}`)
    .addComponents(modalInput('bet', BET_LABEL, { placeholder: 'ex : 1' }));
  if (key === 'num') m.addComponents(modalInput('num', 'Ton numéro (0 à 36)', { placeholder: 'ex : 17', max: 2 }));
  return m;
}

async function handlePanelButton(i) {
  switch (i.customId) {
    case 'panel_mines':
      return i.reply({ ...minesPickerPayload(), flags: EPH });
    case 'panel_bj':
      return i.showModal(blackjackModal());
    case 'panel_roulette':
      return i.reply({ ...roulettePickerPayload(), flags: EPH });
    case 'panel_balance': {
      const bal = await getBalance(i.user.id);
      return i.reply({ content: `💰 Ton solde : **${fmt(bal)}**`, flags: EPH });
    }
    case 'panel_daily': {
      const res = await rpc('claim_daily', { p_user_id: i.user.id, p_amount: DAILY_AMOUNT });
      return i.reply({ content: dailyText(res), flags: EPH });
    }
    case 'panel_top': {
      await i.deferReply({ flags: EPH });
      return i.editReply({ embeds: [await buildLeaderboardEmbed()] });
    }
    case 'panel_history': {
      await i.deferReply({ flags: EPH });
      return i.editReply({ embeds: [await historyEmbed(i.user.id)] });
    }
    case 'panel_help':
      return i.reply({ embeds: [buildHelpEmbed()], flags: EPH });
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
  if (id.startsWith('modal_rl_')) {
    const key = id.slice('modal_rl_'.length);
    const choiceStr = key === 'num' ? get('num') : key;
    if (!parseRouletteBet(choiceStr)) return respondText(i, 'Numéro invalide : entre un nombre de 0 à 36.');
    const bet = await readBet();
    return bet ? playRoulette(i, bet, choiceStr) : badBet();
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
}

// ============================================================
//  PANNEAU ADMIN (propriétaire uniquement)
// ============================================================
function buildAdminPayload() {
  const embed = new EmbedBuilder()
    .setTitle('🛠️ Panneau admin')
    .setColor(COLORS.red)
    .setDescription(
      '➕ **Ajouter** de l’argent à un membre\n' +
        '➖ **Retirer** de l’argent à un membre\n' +
        '🎯 **Définir** le solde exact d’un membre\n' +
        '👀 **Voir** le solde d’un membre\n' +
        '🎁 **Offrir à tous** : le même montant à tous les joueurs ayant un compte\n\n' +
        'Tu choisis le membre dans une liste, puis le montant dans une fenêtre.'
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_add').setLabel('Ajouter').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_remove').setLabel('Retirer').setEmoji('➖').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('admin_set').setLabel('Définir').setEmoji('🎯').setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_view').setLabel('Voir un solde').setEmoji('👀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_all').setLabel('Offrir à tous').setEmoji('🎁').setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row1, row2] };
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
    const raw = i.fields.getTextInputValue('amount').trim();

    if (id === 'modal_admin_all') {
      const amount = parseAmount(raw);
      if (!amount || amount > MAX_ADMIN_AMOUNT) {
        return respondText(i, `Montant invalide (entre 0.01 et ${num(MAX_ADMIN_AMOUNT)}).`);
      }
      const count = Number(await rpc('give_all', { p_amount: amount }));
      const casinoId = casinoChannels.get(i.guild.id);
      if (casinoId) {
        const ch = await client.channels.fetch(casinoId).catch(() => null);
        ch?.send(`🎁 **Cadeau !** Le propriétaire offre **${fmt(amount)}** à tous les joueurs !`).catch(() => {});
      }
      return i.reply({ content: `✅ **${fmt(amount)}** offerts à **${count}** joueur(s).`, flags: EPH });
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

async function getSavedChannel(guild, kind) {
  const key = `${guild.id}:${kind}`;
  const id = guildChannels.get(key);
  if (!id) return null;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (!ch) {
    guildChannels.delete(key);
    await supabase.from('guild_channels').delete().eq('guild_id', guild.id).eq('kind', kind);
  }
  return ch;
}

async function saveChannel(guildId, kind, channelId) {
  const { error } = await supabase.from('guild_channels').upsert({
    guild_id: guildId,
    kind,
    channel_id: channelId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  guildChannels.set(`${guildId}:${kind}`, channelId);
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
  try {
    await saveChannel(guild.id, 'wins', channel.id);
  } catch (e) {
    await channel.delete().catch(() => {});
    throw e;
  }
  return msg.reply(`✅ Salon <#${channel.id}> créé : chaque victoire (jeu, mise, multiplicateur, gain) s’y affichera automatiquement.`);
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
  try {
    const panelMsg = await channel.send(buildAdminPayload());
    await panelMsg.pin().catch(() => {});
    await saveChannel(guild.id, 'admin', channel.id);
  } catch (e) {
    await channel.delete().catch(() => {});
    throw e;
  }
  return msg.reply(`✅ Salon privé <#${channel.id}> créé avec le panneau admin (visible uniquement par toi).`);
}

// ============================================================
//  CLASSEMENT (auto-actualisé toutes les minutes)
// ============================================================
async function buildLeaderboardEmbed() {
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
    const name = u ? escapeMarkdown(u.globalName || u.username) : 'Utilisateur inconnu';
    lines.push(`${medals[i] ?? `**${i + 1}.**`} ${name} : **${fmt(data[i].balance)}**`);
  }

  return new EmbedBuilder()
    .setTitle('🏆 Classement des plus riches')
    .setColor(COLORS.gold)
    .setDescription(lines.length ? lines.join('\n') : 'Personne n’a encore de pièces.')
    .setFooter({ text: 'Mis à jour automatiquement toutes les minutes' })
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
    if (!rows || rows.length === 0) return;

    const embed = await buildLeaderboardEmbed();
    for (const row of rows) {
      try {
        const ch = await client.channels.fetch(row.channel_id);
        const m = await ch.messages.fetch(row.message_id);
        await m.edit({ embeds: [embed] });
      } catch (e) {
        // 10008 message supprimé, 10003 salon supprimé, 50001/50013 accès perdu
        if ([10008, 10003, 50001, 50013].includes(e?.code)) {
          await supabase.from('leaderboard_messages').delete().eq('guild_id', row.guild_id);
        } else {
          console.error('[classement] edit', e?.message || e);
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
const PLAYER_CMDS = new Set(['balance', 'bal', 'solde', 'daily', 'aide', 'help', 'casino', 'jeux']);
const OWNER_CMDS = new Set(['add', 'ajouter', 'remove', 'retirer', 'classement', 'setup', 'salon', 'wins', 'admin']);

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  const casinoId = casinoChannels.get(msg.guild.id);
  const inCasino = casinoId && msg.channel.id === casinoId;

  const [cmdRaw] = msg.content.startsWith(PREFIX) ? msg.content.slice(PREFIX.length).trim().split(/\s+/) : [''];
  const cmd = (cmdRaw || '').toLowerCase();
  const args = msg.content.startsWith(PREFIX) ? msg.content.slice(PREFIX.length).trim().split(/\s+/).slice(1) : [];
  const isPlayerCmd = PLAYER_CMDS.has(cmd);
  const isOwnerCmd = OWNER_CMDS.has(cmd);

  // Dans le salon casino, on joue avec les boutons (privés) : les messages des joueurs sont supprimés.
  // Le propriétaire peut y écrire librement (!setup, !classement, !add, !remove...).
  if (inCasino && !isCrown(msg)) {
    msg.delete().catch(() => {});
    const hint = await msg.channel
      .send(`<@${msg.author.id}> Utilise les boutons du panneau épinglé 👆 (tes parties sont privées).`)
      .catch(() => null);
    if (hint) setTimeout(() => hint.delete().catch(() => {}), 5000);
    return;
  }
  if (!isPlayerCmd && !isOwnerCmd) return;

  // Une fois le salon casino créé, les commandes joueurs n'y marchent que là
  if (isPlayerCmd && casinoId && !inCasino) {
    const warn = await msg.reply(`🎰 Ça se passe dans <#${casinoId}>, avec les boutons du panneau.`).catch(() => null);
    setTimeout(() => {
      msg.delete().catch(() => {});
      if (warn) warn.delete().catch(() => {});
    }, 6000);
    return;
  }

  try {
    switch (cmd) {
      case 'balance':
      case 'bal':
      case 'solde':
        return await cmdBalance(msg, args);
      case 'daily':
        return await cmdDaily(msg);
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
        return await cmdWins(msg);
      case 'admin':
        return await cmdAdmin(msg);
      default:
        return;
    }
  } catch (e) {
    console.error(`[${cmd}]`, e);
    msg.reply('⚠️ Une erreur est survenue, réessaie dans un instant.').catch(() => {});
  }
});

// ============================================================
//  BOUTONS, MENUS ET POP-UPS
// ============================================================
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (!i.guild || !i.customId) return;
    const id = i.customId;

    // Panneau admin
    if (id.startsWith('admin_') || id.startsWith('modal_admin_')) return await handleAdmin(i);

    const isGame =
      id.startsWith('panel_') ||
      id.startsWith('mines_') ||
      id.startsWith('bj_') ||
      id.startsWith('rl_') ||
      id.startsWith('replay|') ||
      id.startsWith('modal_');
    if (!isGame) return;

    // Les jeux ne marchent que dans le salon casino (quand il existe)
    const casinoId = casinoChannels.get(i.guild.id);
    if (casinoId && i.channelId !== casinoId) {
      return await i.reply({ content: `🎰 Les jeux ne marchent que dans <#${casinoId}>.`, flags: EPH });
    }

    if (i.isModalSubmit()) return await handleModalSubmit(i);
    if (!i.isButton()) return;

    if (id.startsWith('panel_')) return await handlePanelButton(i);
    if (id.startsWith('replay|')) return await handleReplay(i);
    if (id.startsWith('mines_lvl_')) {
      const level = id.slice('mines_lvl_'.length);
      return LEVELS[level] ? await i.showModal(minesBetModal(level)) : undefined;
    }
    if (id.startsWith('mines_')) return await handleMinesButton(i);
    if (id.startsWith('bj_')) return await handleBlackjackButton(i);
    if (id.startsWith('rl_')) {
      const key = id.slice('rl_'.length);
      return key === 'num' || parseRouletteBet(key) ? await i.showModal(rouletteModal(key)) : undefined;
    }
  } catch (e) {
    console.error('[interaction]', e);
    if (i.isRepliable?.() && !i.replied && !i.deferred) {
      i.reply({ content: '⚠️ Une erreur est survenue, réessaie dans un instant.', flags: EPH }).catch(() => {});
    }
  }
});

// Si un salon enregistré est supprimé à la main, on le "désenregistre"
client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  const gid = channel.guild.id;
  if (casinoChannels.get(gid) === channel.id) {
    casinoChannels.delete(gid);
    await supabase.from('casino_channels').delete().eq('guild_id', gid);
  }
  for (const kind of ['wins', 'admin']) {
    if (guildChannels.get(`${gid}:${kind}`) === channel.id) {
      guildChannels.delete(`${gid}:${kind}`);
      await supabase.from('guild_channels').delete().eq('guild_id', gid).eq('kind', kind);
    }
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Connecté en tant que ${c.user.tag}`);
  loadChannels();
  setInterval(updateLeaderboards, LEADERBOARD_REFRESH_MS);
  updateLeaderboards();
});

client.on(Events.Error, (e) => console.error('[client]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

client.login(DISCORD_TOKEN);
