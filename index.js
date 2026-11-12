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
  ComponentType,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits,
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
const round2 = (n) => Math.round(n * 100) / 100;
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const fmt = (n) =>
  `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${COIN}`;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// "5", "2.5", "2,5", "all"/"tout"/"max" (si max fourni)
function parseAmount(str, max) {
  if (!str) return null;
  const s = String(str).toLowerCase().replace(',', '.');
  if (['all', 'tout', 'max'].includes(s)) return max && max > 0 ? max : null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

function parseUserId(str) {
  if (!str) return null;
  const m = str.match(/^<@!?(\d{15,25})>$/) || str.match(/^(\d{15,25})$/);
  return m ? m[1] : null;
}

// Un seul jeu en cours par joueur
const busy = new Set();

const MSG = {
  busy: '⏳ Tu as déjà une partie en cours, termine-la d’abord.',
  noMoney: `Tu n’as pas de pièces ${COIN}. Fais **${PREFIX}daily** pour récupérer ta récompense du jour.`,
  insufficient: 'Tu n’as pas assez de pièces pour cette mise.',
};

// ============================================================
//  BASE DE DONNÉES (Supabase)
// ============================================================
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

const getBalance = async (id) => Number(await rpc('get_balance', { p_user_id: id }));
const credit = async (id, amount) =>
  Number(await rpc('change_balance', { p_user_id: id, p_amount: amount }));

// Retire `amount` : renvoie le nouveau solde, ou null si solde insuffisant
async function debit(id, amount) {
  try {
    return Number(await rpc('change_balance', { p_user_id: id, p_amount: -amount }));
  } catch (e) {
    if (String(e?.message || '').includes('insufficient_funds')) return null;
    throw e;
  }
}

// ============================================================
//  .balance / .daily
// ============================================================
async function cmdBalance(msg, args) {
  const targetId = parseUserId(args[0]) || msg.author.id;
  const bal = await getBalance(targetId);
  if (targetId === msg.author.id) return msg.reply(`💰 Ton solde : **${fmt(bal)}**`);
  return msg.reply(`💰 Solde de <@${targetId}> : **${fmt(bal)}**`);
}

async function cmdDaily(msg) {
  const res = await rpc('claim_daily', { p_user_id: msg.author.id, p_amount: DAILY_AMOUNT });
  if (res.claimed) {
    return msg.reply(
      `🎁 Tu as reçu **${fmt(DAILY_AMOUNT)}** ! Nouveau solde : **${fmt(res.balance)}**`
    );
  }
  return msg.reply(
    `⏰ Tu as déjà récupéré ta récompense aujourd’hui. Reviens après minuit (heure de Paris) !\nSolde : **${fmt(res.balance)}**`
  );
}

// ============================================================
//  MINES  (grille 4x5, 1 à 5 mines, petits multiplicateurs)
// ============================================================
const MINES_CELLS = 20;
const MINES_EDGE = 0.97; // avantage de la maison : multiplicateurs légèrement réduits

function minesMultiplier(safePicks, mines) {
  if (safePicks <= 0) return 1;
  let m = 1;
  for (let i = 0; i < safePicks; i++) m *= (MINES_CELLS - i) / (MINES_CELLS - mines - i);
  return Math.max(1, Math.floor(m * MINES_EDGE * 100) / 100);
}

function minesRows(state, over) {
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      const b = new ButtonBuilder().setCustomId(`mines_${i}`);
      if (state.revealed.has(i)) {
        b.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
      } else if (over && state.mineSet.has(i)) {
        b.setEmoji('💣')
          .setStyle(state.hit === i ? ButtonStyle.Danger : ButtonStyle.Secondary)
          .setDisabled(true);
      } else {
        b.setLabel('?').setStyle(ButtonStyle.Secondary).setDisabled(!!over);
      }
      row.addComponents(b);
    }
    rows.push(row);
  }
  const gain = floor2(state.bet * minesMultiplier(state.revealed.size, state.mines));
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('mines_cash')
        .setLabel(`Encaisser ${gain.toLocaleString('fr-FR')}`)
        .setEmoji('💰')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(over || state.revealed.size === 0)
    )
  );
  return rows;
}

function minesEmbed(state, end) {
  const picks = state.revealed.size;
  const safeTotal = MINES_CELLS - state.mines;
  const mult = minesMultiplier(picks, state.mines);
  const e = new EmbedBuilder()
    .setTitle('💣 Mines')
    .addFields(
      { name: 'Mise', value: fmt(state.bet), inline: true },
      { name: 'Mines', value: String(state.mines), inline: true },
      { name: 'Multiplicateur', value: `x${mult.toFixed(2)}`, inline: true },
      { name: 'Gain actuel', value: fmt(floor2(state.bet * mult)), inline: true }
    );
  if (end) {
    e.setColor(end.color).setDescription(end.text);
    e.addFields({ name: 'Solde', value: fmt(end.balance), inline: true });
  } else {
    e.setColor(COLORS.blue);
    if (picks < safeTotal) {
      e.addFields({
        name: 'Prochain case',
        value: `x${minesMultiplier(picks + 1, state.mines).toFixed(2)}`,
        inline: true,
      });
    }
    e.setDescription('Clique sur les cases. Évite les 💣 et encaisse quand tu veux !');
  }
  return e;
}

async function cmdMines(msg, args) {
  const id = msg.author.id;
  if (busy.has(id)) return msg.reply(MSG.busy);
  busy.add(id);
  let handedOff = false;

  try {
    const bal = await getBalance(id);
    if (bal <= 0) return msg.reply(MSG.noMoney);

    const bet = parseAmount(args[0], bal);
    if (!bet) return msg.reply(`Usage : \`${PREFIX}mines <mise|all> [mines 1-5]\` (3 mines par défaut)`);
    const mines = args[1] === undefined ? 3 : parseInt(args[1], 10);
    if (!Number.isInteger(mines) || mines < 1 || mines > 5) {
      return msg.reply('Le nombre de mines doit être compris entre 1 et 5.');
    }
    if (bet > bal) return msg.reply(MSG.insufficient);
    if ((await debit(id, bet)) === null) return msg.reply(MSG.insufficient);

    const mineSet = new Set(shuffle(Array.from({ length: MINES_CELLS }, (_, i) => i)).slice(0, mines));
    const state = { bet, mines, mineSet, revealed: new Set(), hit: null };
    const safeTotal = MINES_CELLS - mines;

    let sent;
    try {
      sent = await msg.reply({ embeds: [minesEmbed(state)], components: minesRows(state, false) });
    } catch (e) {
      await credit(id, bet).catch(() => {});
      throw e;
    }

    let finished = false;
    const collector = sent.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: 90_000,
      time: 10 * 60_000,
    });

    async function settle(i, kind) {
      if (finished) return;
      finished = true;
      try {
        collector.stop('settled');
        const picks = state.revealed.size;
        let payout = 0;
        let text;
        let color;
        if (kind === 'lose') {
          text = '💥 **Boom !** Tu as touché une mine, la mise est perdue.';
          color = COLORS.red;
        } else if (picks === 0) {
          payout = bet;
          text = '⏱️ Partie abandonnée, mise remboursée.';
          color = COLORS.grey;
        } else {
          payout = floor2(bet * minesMultiplier(picks, mines));
          text =
            kind === 'timeout'
              ? `⏱️ Temps écoulé, encaissement automatique : **${fmt(payout)}**`
              : `✅ Bien joué ! Tu encaisses **${fmt(payout)}** (profit : ${fmt(round2(payout - bet))}).`;
          color = COLORS.green;
        }
        const balance = payout > 0 ? await credit(id, payout) : await getBalance(id);
        const payload = {
          embeds: [minesEmbed(state, { text, color, balance })],
          components: minesRows(state, true),
        };
        if (i) await i.update(payload);
        else await sent.edit(payload);
      } catch (e) {
        console.error('[mines] settle', e);
      } finally {
        busy.delete(id);
      }
    }

    collector.on('collect', async (i) => {
      try {
        if (i.user.id !== id) {
          return i.reply({ content: 'Ce n’est pas ta partie.', flags: MessageFlags.Ephemeral });
        }
        if (finished) return i.deferUpdate().catch(() => {});

        if (i.customId === 'mines_cash') {
          if (state.revealed.size === 0) return i.deferUpdate();
          return settle(i, 'cash');
        }

        const idx = Number(i.customId.split('_')[1]);
        if (state.revealed.has(idx)) return i.deferUpdate();

        if (state.mineSet.has(idx)) {
          state.hit = idx;
          return settle(i, 'lose');
        }
        state.revealed.add(idx);
        if (state.revealed.size === safeTotal) return settle(i, 'cash');
        return i.update({ embeds: [minesEmbed(state)], components: minesRows(state, false) });
      } catch (e) {
        console.error('[mines] collect', e);
      }
    });

    collector.on('end', () => {
      if (!finished) settle(null, 'timeout');
    });

    handedOff = true;
  } finally {
    if (!handedOff) busy.delete(id);
  }
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

function bjEmbed(s, end) {
  const pv = handValue(s.player);
  const e = new EmbedBuilder().setTitle('🃏 Blackjack');
  e.addFields(
    { name: `Ta main (${pv})`, value: s.player.map(cardStr).join('  ') },
    end
      ? { name: `Croupier (${handValue(s.dealer)})`, value: s.dealer.map(cardStr).join('  ') }
      : { name: `Croupier (${handValue([s.dealer[0]])})`, value: `${cardStr(s.dealer[0])}  🂠` },
    { name: 'Mise', value: fmt(s.bet), inline: true }
  );
  if (end) {
    e.setColor(end.color).setDescription(end.text);
    e.addFields({ name: 'Solde', value: fmt(end.balance), inline: true });
  } else {
    e.setColor(COLORS.blue).setDescription('À toi : **Tirer**, **Rester** ou **Doubler**.');
  }
  return e;
}

function bjButtons(disabled, canDouble) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_hit').setLabel('Tirer').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('Rester').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
  if (canDouble) {
    row.addComponents(
      new ButtonBuilder().setCustomId('bj_double').setLabel('Doubler').setStyle(ButtonStyle.Success).setDisabled(disabled)
    );
  }
  return [row];
}

async function cmdBlackjack(msg, args) {
  const id = msg.author.id;
  if (busy.has(id)) return msg.reply(MSG.busy);
  busy.add(id);
  let handedOff = false;

  try {
    const bal = await getBalance(id);
    if (bal <= 0) return msg.reply(MSG.noMoney);

    const bet = parseAmount(args[0], bal);
    if (!bet) return msg.reply(`Usage : \`${PREFIX}blackjack <mise|all>\``);
    if (bet > bal) return msg.reply(MSG.insufficient);
    if ((await debit(id, bet)) === null) return msg.reply(MSG.insufficient);

    const deck = newDeck();
    const state = {
      bet,
      deck,
      player: [deck.pop(), deck.pop()],
      dealer: [deck.pop(), deck.pop()],
    };

    // Blackjack naturel ?
    const pBJ = handValue(state.player) === 21;
    const dBJ = handValue(state.dealer) === 21;
    if (pBJ || dBJ) {
      let payout = 0;
      let text;
      let color;
      if (pBJ && dBJ) {
        payout = bet;
        text = '🤝 Double blackjack : égalité, mise remboursée.';
        color = COLORS.grey;
      } else if (pBJ) {
        payout = floor2(bet * 2.5);
        text = `🎉 **Blackjack !** Tu gagnes **${fmt(round2(payout - bet))}** (paiement 3:2).`;
        color = COLORS.green;
      } else {
        text = '😬 Le croupier a un blackjack, mise perdue.';
        color = COLORS.red;
      }
      const balance = payout > 0 ? await credit(id, payout) : await getBalance(id);
      return msg.reply({ embeds: [bjEmbed(state, { text, color, balance })] });
    }

    let sent;
    try {
      sent = await msg.reply({ embeds: [bjEmbed(state)], components: bjButtons(false, true) });
    } catch (e) {
      await credit(id, bet).catch(() => {});
      throw e;
    }

    let finished = false;
    const collector = sent.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: 90_000,
      time: 10 * 60_000,
    });

    async function settle(i, kind) {
      if (finished) return;
      finished = true;
      try {
        collector.stop('settled');
        if (kind === 'stand') {
          while (handValue(state.dealer) < 17) state.dealer.push(state.deck.pop());
        }
        const pv = handValue(state.player);
        const dv = handValue(state.dealer);
        let payout = 0;
        let text;
        let color;
        if (kind === 'bust') {
          text = `💥 Tu dépasses 21 (${pv}), mise perdue.`;
          color = COLORS.red;
        } else if (dv > 21) {
          payout = state.bet * 2;
          text = `🎉 Le croupier dépasse 21 ! Tu gagnes **${fmt(state.bet)}**.`;
          color = COLORS.green;
        } else if (pv > dv) {
          payout = state.bet * 2;
          text = `🎉 ${pv} contre ${dv} : tu gagnes **${fmt(state.bet)}**.`;
          color = COLORS.green;
        } else if (pv === dv) {
          payout = state.bet;
          text = `🤝 Égalité à ${pv}, mise remboursée.`;
          color = COLORS.grey;
        } else {
          text = `😬 ${pv} contre ${dv} : tu perds ta mise.`;
          color = COLORS.red;
        }
        const balance = payout > 0 ? await credit(id, payout) : await getBalance(id);
        const payload = {
          embeds: [bjEmbed(state, { text, color, balance })],
          components: bjButtons(true, false),
        };
        if (i) await i.update(payload);
        else await sent.edit(payload);
      } catch (e) {
        console.error('[blackjack] settle', e);
      } finally {
        busy.delete(id);
      }
    }

    collector.on('collect', async (i) => {
      try {
        if (i.user.id !== id) {
          return i.reply({ content: 'Ce n’est pas ta partie.', flags: MessageFlags.Ephemeral });
        }
        if (finished) return i.deferUpdate().catch(() => {});

        if (i.customId === 'bj_hit') {
          state.player.push(state.deck.pop());
          const v = handValue(state.player);
          if (v > 21) return settle(i, 'bust');
          if (v === 21) return settle(i, 'stand');
          return i.update({ embeds: [bjEmbed(state)], components: bjButtons(false, false) });
        }

        if (i.customId === 'bj_stand') return settle(i, 'stand');

        if (i.customId === 'bj_double') {
          if (state.player.length !== 2) return i.deferUpdate();
          const left = await debit(id, state.bet);
          if (left === null) {
            return i.reply({ content: 'Pas assez de pièces pour doubler.', flags: MessageFlags.Ephemeral });
          }
          state.bet = round2(state.bet * 2);
          state.player.push(state.deck.pop());
          if (handValue(state.player) > 21) return settle(i, 'bust');
          return settle(i, 'stand');
        }
      } catch (e) {
        console.error('[blackjack] collect', e);
      }
    });

    collector.on('end', () => {
      if (!finished) settle(null, 'stand');
    });

    handedOff = true;
  } finally {
    if (!handedOff) busy.delete(id);
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
  const s = str.toLowerCase();
  if (['rouge', 'red', 'r'].includes(s)) return { type: 'rouge', label: 'Rouge 🔴', mult: 2, win: (n) => n !== 0 && REDS.has(n) };
  if (['noir', 'black', 'n'].includes(s)) return { type: 'noir', label: 'Noir ⚫', mult: 2, win: (n) => n !== 0 && !REDS.has(n) };
  if (['pair', 'even', 'p'].includes(s)) return { type: 'pair', label: 'Pair', mult: 2, win: (n) => n !== 0 && n % 2 === 0 };
  if (['impair', 'odd', 'i'].includes(s)) return { type: 'impair', label: 'Impair', mult: 2, win: (n) => n % 2 === 1 };
  if (['vert', 'green', 'v'].includes(s)) return { type: 'num', label: 'Vert 🟢 (0)', mult: 36, win: (n) => n === 0 };
  if (/^\d{1,2}$/.test(s) && Number(s) >= 0 && Number(s) <= 36) {
    const target = Number(s);
    return { type: 'num', label: `Numéro ${target}`, mult: 36, win: (n) => n === target };
  }
  return null;
}

async function cmdRoulette(msg, args) {
  const id = msg.author.id;
  const usage = `Usage : \`${PREFIX}roulette <mise|all> <rouge|noir|pair|impair|vert|0-36>\`\nRouge/noir/pair/impair paient **x2**, un numéro (ou vert) paie **x36**.`;

  const bal = await getBalance(id);
  if (bal <= 0) return msg.reply(MSG.noMoney);

  const bet = parseAmount(args[0], bal);
  const choice = parseRouletteBet(args[1]);
  if (!bet || !choice) return msg.reply(usage);
  if (bet > bal) return msg.reply(MSG.insufficient);
  if ((await debit(id, bet)) === null) return msg.reply(MSG.insufficient);

  const result = randomInt(0, 37);
  const won = choice.win(result);
  const payout = won ? floor2(bet * choice.mult) : 0;
  const balance = payout > 0 ? await credit(id, payout) : await getBalance(id);

  const spinning = await msg.reply(`🎡 La roulette tourne... (mise **${fmt(bet)}** sur **${choice.label}**)`);
  await sleep(2500);

  const embed = new EmbedBuilder()
    .setTitle('🎡 Roulette')
    .setColor(won ? COLORS.green : COLORS.red)
    .setDescription(
      `La bille tombe sur **${colorEmoji[colorOf(result)]} ${result}** (${colorOf(result)}).\n\n` +
        (won
          ? `🎉 Gagné ! Tu empoches **${fmt(payout)}** (profit : ${fmt(round2(payout - bet))}).`
          : `😬 Perdu, tu laisses **${fmt(bet)}**.`)
    )
    .addFields(
      { name: 'Ton pari', value: choice.label, inline: true },
      { name: 'Solde', value: fmt(balance), inline: true }
    );
  await spinning.edit({ content: '', embeds: [embed] });
}

// ============================================================
//  COMMANDES DU PROPRIÉTAIRE (👑 la couronne)
// ============================================================
const isCrown = (msg) => msg.guild && msg.author.id === msg.guild.ownerId;
const CROWN_ONLY = '👑 Seul le propriétaire du serveur (celui qui a la couronne) peut utiliser cette commande.';

async function cmdAdjust(msg, args, sign) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const name = sign > 0 ? 'add' : 'remove';
  const targetId = parseUserId(args[0]);
  const amount = parseAmount(args[1]);
  if (!targetId || !amount) return msg.reply(`Usage : \`${PREFIX}${name} @membre <montant>\``);
  if (amount > 1_000_000_000) return msg.reply('Montant trop grand (max 1 000 000 000).');

  const balance = Number(await rpc('admin_adjust', { p_user_id: targetId, p_amount: sign * amount }));
  return msg.reply(
    sign > 0
      ? `✅ **${fmt(amount)}** ajoutés à <@${targetId}>. Nouveau solde : **${fmt(balance)}**`
      : `✅ **${fmt(amount)}** retirés à <@${targetId}>. Nouveau solde : **${fmt(balance)}**`
  );
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
//  AIDE
// ============================================================
function buildHelpEmbed() {
  const p = PREFIX;
  return new EmbedBuilder()
    .setTitle(`${COIN} Commandes`)
    .setColor(COLORS.blue)
    .setDescription(
      [
        `**${p}balance** [@membre] : voir ton solde`,
        `**${p}daily** : ${DAILY_AMOUNT} pièces gratuites par jour`,
        `**${p}mines** <mise|all> [1-5 mines] : jeu des mines`,
        `**${p}blackjack** <mise|all> : blackjack contre le croupier`,
        `**${p}roulette** <mise|all> <rouge|noir|pair|impair|vert|0-36>`,
        '',
        '👑 **Propriétaire du serveur uniquement**',
        `**${p}add** @membre <montant> : ajouter de l’argent`,
        `**${p}remove** @membre <montant> : retirer de l’argent`,
        `**${p}classement** : afficher le classement (mis à jour chaque minute)`,
        `**${p}setup** : créer le salon casino (les commandes de jeu ne marchent que là)`,
      ].join('\n')
    );
}

function cmdHelp(msg) {
  return msg.reply({ embeds: [buildHelpEmbed()] });
}

// ============================================================
//  SALON CASINO (les commandes de jeu ne marchent que là)
// ============================================================
const casinoChannels = new Map(); // guildId -> channelId

async function loadCasinoChannels() {
  const { data, error } = await supabase.from('casino_channels').select('guild_id, channel_id');
  if (error) {
    console.error('[casino] chargement des salons :', error.message);
    return;
  }
  for (const r of data) casinoChannels.set(r.guild_id, r.channel_id);
}

async function cmdSetup(msg) {
  if (!isCrown(msg)) return msg.reply(CROWN_ONLY);
  const guild = msg.guild;

  const existingId = casinoChannels.get(guild.id);
  if (existingId) {
    const existing = await guild.channels.fetch(existingId).catch(() => null);
    if (existing) return msg.reply(`Le salon casino existe déjà : <#${existingId}>`);
    casinoChannels.delete(guild.id);
  }

  const me = guild.members.me;
  const P = PermissionFlagsBits;
  if (!me.permissions.has(P.ManageChannels)) {
    return msg.reply(
      '⚠️ Il me faut la permission **Gérer les salons** pour créer le salon (Paramètres du serveur → Rôles → rôle du bot).'
    );
  }
  const botAllow = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages].filter(
    (p) => me.permissions.has(p)
  );

  const channel = await guild.channels.create({
    name: 'casino',
    type: ChannelType.GuildText,
    topic: `Casino 🪙 : tape ${PREFIX}aide pour voir les commandes`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
      { id: me.id, allow: botAllow },
    ],
  });

  try {
    const helpMsg = await channel.send({ embeds: [buildHelpEmbed()] });
    await helpMsg.pin().catch(() => {});
    const { error } = await supabase.from('casino_channels').upsert({
      guild_id: guild.id,
      channel_id: channel.id,
      help_message_id: helpMsg.id,
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
    : '\n⚠️ Il me manque **Gérer les messages** : je ne pourrai pas épingler l’aide ni nettoyer le salon.';
  return msg.reply(
    `✅ Salon <#${channel.id}> créé. Les commandes de jeu ne marchent plus que là, et seules les commandes y restent visibles.${warn}`
  );
}

// ============================================================
//  ROUTEUR DE COMMANDES
// ============================================================
const PLAYER_CMDS = new Set(['balance', 'bal', 'solde', 'daily', 'mines', 'blackjack', 'bj', 'roulette', 'aide', 'help']);
const OWNER_CMDS = new Set(['add', 'ajouter', 'remove', 'retirer', 'classement', 'setup']);

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  const casinoId = casinoChannels.get(msg.guild.id);
  const inCasino = casinoId && msg.channel.id === casinoId;

  const [cmdRaw, ...args] = msg.content.startsWith(PREFIX)
    ? msg.content.slice(PREFIX.length).trim().split(/\s+/)
    : [''];
  const cmd = (cmdRaw || '').toLowerCase();
  const isPlayerCmd = PLAYER_CMDS.has(cmd);
  const isOwnerCmd = OWNER_CMDS.has(cmd);

  // Dans le salon casino, on ne garde que les commandes (le propriétaire peut y écrire librement)
  if (inCasino && !isPlayerCmd && !isOwnerCmd && !isCrown(msg)) {
    msg.delete().catch(() => {});
    return;
  }
  if (!isPlayerCmd && !isOwnerCmd) return;

  // Les commandes de jeu ne marchent que dans le salon casino
  if (isPlayerCmd && casinoId && !inCasino) {
    const warn = await msg.reply(`🎰 Les commandes casino ne marchent que dans <#${casinoId}>.`).catch(() => null);
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
      case 'mines':
        return await cmdMines(msg, args);
      case 'blackjack':
      case 'bj':
        return await cmdBlackjack(msg, args);
      case 'roulette':
        return await cmdRoulette(msg, args);
      case 'add':
      case 'ajouter':
        return await cmdAdjust(msg, args, +1);
      case 'remove':
      case 'retirer':
        return await cmdAdjust(msg, args, -1);
      case 'classement':
        return await cmdLeaderboard(msg);
      case 'setup':
        return await cmdSetup(msg);
      case 'aide':
      case 'help':
        return await cmdHelp(msg);
      default:
        return;
    }
  } catch (e) {
    console.error(`[${cmd}]`, e);
    msg.reply('⚠️ Une erreur est survenue, réessaie dans un instant.').catch(() => {});
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Connecté en tant que ${c.user.tag}`);
  loadCasinoChannels();
  setInterval(updateLeaderboards, LEADERBOARD_REFRESH_MS);
  updateLeaderboards();
});

// Si le salon casino est supprimé à la main, on libère les commandes
client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild || casinoChannels.get(channel.guild.id) !== channel.id) return;
  casinoChannels.delete(channel.guild.id);
  await supabase.from('casino_channels').delete().eq('guild_id', channel.guild.id);
});

client.on(Events.Error, (e) => console.error('[client]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

client.login(DISCORD_TOKEN);
