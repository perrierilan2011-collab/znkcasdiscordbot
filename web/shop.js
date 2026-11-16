'use strict';
/*
 * web/shop.js — boutique (rewards), commandes (order codes), tasks quotidiennes.
 * Stockage JSON local (+ optionnel sync). Le serveur web et le bot Discord partagent ce module.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;

function load(file, fb) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || fb;
  } catch {
    return fb;
  }
}
function save(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 0));
    fs.renameSync(file + '.tmp', file);
  } catch (e) {
    console.error('[shop] write', file, e?.message || e);
  }
}

function dayKeyParis(d = new Date()) {
  // YYYY-MM-DD en Europe/Paris
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function makeCode() {
  // 8 caractères lisibles, sans 0/O/1/I
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

/**
 * @param {string} dataDir
 * @param {{ getBalance, debit, credit, getInviteCount?: (uid, guildId)=>Promise<number>, getGamesPlayed?: (uid)=>Promise<number> }} deps
 */
function create(dataDir, deps = {}) {
  const REWARDS_FILE = path.join(dataDir, 'shop_rewards.json');
  const ORDERS_FILE = path.join(dataDir, 'shop_orders.json');
  const TASKS_FILE = path.join(dataDir, 'shop_tasks.json');
  const PROGRESS_FILE = path.join(dataDir, 'shop_task_progress.json');
  const TICKETS_FILE = path.join(dataDir, 'shop_ticket_cfg.json'); // guildId -> { categoryId, panelChannelId }

  let rewards = load(REWARDS_FILE, []);
  let orders = load(ORDERS_FILE, {});
  let tasks = load(TASKS_FILE, []);
  let progress = load(PROGRESS_FILE, {});
  let ticketCfg = load(TICKETS_FILE, {});

  const persistRewards = () => save(REWARDS_FILE, rewards);
  const persistOrders = () => save(ORDERS_FILE, orders);
  const persistTasks = () => save(TASKS_FILE, tasks);
  const persistProgress = () => save(PROGRESS_FILE, progress);
  const persistTickets = () => save(TICKETS_FILE, ticketCfg);

  // ---- seed defaults si vide ----
  if (!tasks.length) {
    tasks = [
      { id: 'daily_login', name: 'Connexion du jour', desc: 'Ouvre le casino aujourd’hui', reward: 5, type: 'login', target: 1, active: true },
      { id: 'play_3', name: 'Jouer 3 parties', desc: 'Termine 3 manches (online ou offline)', reward: 15, type: 'games', target: 3, active: true },
      { id: 'play_10', name: 'Jouer 10 parties', desc: 'Termine 10 manches aujourd’hui', reward: 40, type: 'games', target: 10, active: true },
    ];
    persistTasks();
  }

  function listRewards(admin = false) {
    return rewards
      .filter((r) => admin || r.active !== false)
      .map((r) => ({
        id: r.id,
        name: r.name,
        desc: r.desc || '',
        price: r.price,
        type: r.type || 'custom', // nitro | role | custom
        roleId: r.roleId || '',
        minInvites: Number(r.minInvites) || 0,
        minGames: Number(r.minGames) || 0,
        active: r.active !== false,
        stock: r.stock == null ? null : Number(r.stock),
      }))
      .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  }

  function adminUpsertReward(body) {
    const id = String(body.id || crypto.randomBytes(4).toString('hex'));
    const name = String(body.name || '').trim().slice(0, 64);
    if (!name) throw new Error('Nom de reward requis.');
    const price = floor2(Number(body.price));
    if (!(price >= 0)) throw new Error('Prix invalide.');
    const type = ['nitro', 'role', 'custom'].includes(body.type) ? body.type : 'custom';
    const roleId = String(body.roleId || '').replace(/\D/g, '').slice(0, 25);
    if (type === 'role' && !roleId) throw new Error('roleId requis pour un reward de type rôle.');
    const entry = {
      id,
      name,
      desc: String(body.desc || '').trim().slice(0, 200),
      price,
      type,
      roleId: type === 'role' ? roleId : '',
      minInvites: Math.max(0, Math.floor(Number(body.minInvites) || 0)),
      minGames: Math.max(0, Math.floor(Number(body.minGames) || 0)),
      active: body.active === false || body.active === 'false' ? false : true,
      stock: body.stock === '' || body.stock == null ? null : Math.max(0, Math.floor(Number(body.stock))),
    };
    const i = rewards.findIndex((r) => r.id === id);
    if (i >= 0) rewards[i] = entry;
    else rewards.push(entry);
    persistRewards();
    return entry;
  }

  function adminDeleteReward(id) {
    const before = rewards.length;
    rewards = rewards.filter((r) => r.id !== id);
    if (rewards.length === before) throw new Error('Reward introuvable.');
    persistRewards();
    return true;
  }

  async function buy(uid, rewardId, guildId, name) {
    const r = rewards.find((x) => x.id === rewardId && x.active !== false);
    if (!r) throw new Error('Reward introuvable ou désactivée.');
    if (r.stock != null && r.stock <= 0) throw new Error('Rupture de stock.');
    const minInv = Number(r.minInvites) || 0;
    const minGames = Number(r.minGames) || 0;
    if (minInv > 0 && deps.getInviteCount) {
      const inv = await deps.getInviteCount(uid, guildId);
      if (inv < minInv) throw new Error(`Il te faut au moins ${minInv} invitation(s) (tu en as ${inv}).`);
    }
    if (minGames > 0 && deps.getGamesPlayed) {
      const g = await deps.getGamesPlayed(uid);
      if (g < minGames) throw new Error(`Il te faut au moins ${minGames} partie(s) jouée(s) (tu en as ${g}).`);
    }
    const price = floor2(r.price);
    if (price > 0) {
      const nb = await deps.debit(uid, price);
      if (nb === null) throw new Error('Solde insuffisant.');
    }
    if (r.stock != null) {
      r.stock = Math.max(0, r.stock - 1);
      persistRewards();
    }
    let code;
    do {
      code = makeCode();
    } while (orders[code]);
    const order = {
      code,
      uid: String(uid),
      name: String(name || 'Joueur').slice(0, 32),
      rewardId: r.id,
      rewardName: r.name,
      type: r.type || 'custom',
      roleId: r.roleId || '',
      price,
      status: 'pending', // pending | delivered
      createdAt: Date.now(),
      deliveredAt: 0,
    };
    orders[code] = order;
    persistOrders();
    return { code, order, balance: price > 0 ? await deps.getBalance(uid).catch(() => null) : null };
  }

  function getOrder(code) {
    const c = String(code || '')
      .trim()
      .toUpperCase();
    return orders[c] || null;
  }

  function listOrders(filter = {}) {
    let list = Object.values(orders);
    if (filter.uid) list = list.filter((o) => o.uid === String(filter.uid));
    if (filter.status) list = list.filter((o) => o.status === filter.status);
    return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, filter.limit || 100);
  }

  function markDelivered(code, meta = {}) {
    const o = getOrder(code);
    if (!o) throw new Error('Order code invalide.');
    o.status = 'delivered';
    o.deliveredAt = Date.now();
    if (meta.by) o.deliveredBy = String(meta.by);
    if (meta.channelId) o.channelId = String(meta.channelId);
    persistOrders();
    return o;
  }

  // ---- tasks ----
  function listTasks(admin = false) {
    return tasks
      .filter((t) => admin || t.active !== false)
      .map((t) => ({
        id: t.id,
        name: t.name,
        desc: t.desc || '',
        reward: floor2(t.reward),
        type: t.type || 'custom', // login | games | invites | custom
        target: Math.max(1, Math.floor(Number(t.target) || 1)),
        active: t.active !== false,
      }));
  }

  function adminUpsertTask(body) {
    const id = String(body.id || crypto.randomBytes(4).toString('hex'));
    const name = String(body.name || '').trim().slice(0, 64);
    if (!name) throw new Error('Nom de task requis.');
    const reward = floor2(Number(body.reward));
    if (!(reward >= 0)) throw new Error('Récompense invalide.');
    const type = ['login', 'games', 'invites', 'custom'].includes(body.type) ? body.type : 'custom';
    const entry = {
      id,
      name,
      desc: String(body.desc || '').trim().slice(0, 200),
      reward,
      type,
      target: Math.max(1, Math.floor(Number(body.target) || 1)),
      active: body.active === false || body.active === 'false' ? false : true,
    };
    const i = tasks.findIndex((t) => t.id === id);
    if (i >= 0) tasks[i] = entry;
    else tasks.push(entry);
    persistTasks();
    return entry;
  }

  function adminDeleteTask(id) {
    const before = tasks.length;
    tasks = tasks.filter((t) => t.id !== id);
    if (tasks.length === before) throw new Error('Task introuvable.');
    persistTasks();
    return true;
  }

  function userDay(uid) {
    const day = dayKeyParis();
    let u = progress[uid];
    if (!u || u.day !== day) {
      u = { day, done: [], prog: {} };
      progress[uid] = u;
    }
    return u;
  }

  function bumpProgress(uid, type, amount = 1) {
    const u = userDay(String(uid));
    for (const t of tasks) {
      if (t.active === false) continue;
      if (t.type !== type) continue;
      if (u.done.includes(t.id)) continue;
      u.prog[t.id] = Math.min(t.target, (u.prog[t.id] || 0) + amount);
    }
    persistProgress();
  }

  function markLogin(uid) {
    bumpProgress(uid, 'login', 1);
  }

  function tasksForUser(uid) {
    const u = userDay(String(uid));
    return listTasks(false).map((t) => {
      const cur = u.done.includes(t.id) ? t.target : Math.min(t.target, u.prog[t.id] || 0);
      return {
        ...t,
        progress: cur,
        completed: u.done.includes(t.id),
        claimable: !u.done.includes(t.id) && cur >= t.target,
      };
    });
  }

  async function claimTask(uid, taskId) {
    const t = tasks.find((x) => x.id === taskId && x.active !== false);
    if (!t) throw new Error('Task introuvable.');
    const u = userDay(String(uid));
    if (u.done.includes(t.id)) throw new Error('Déjà réclamée aujourd’hui.');
    const cur = u.prog[t.id] || 0;
    // login auto-complete
    if (t.type === 'login' && cur < t.target) {
      u.prog[t.id] = t.target;
    }
    const have = u.prog[t.id] || 0;
    if (have < t.target) throw new Error(`Progression insuffisante (${have}/${t.target}).`);
    u.done.push(t.id);
    persistProgress();
    let bal = null;
    if (t.reward > 0) {
      bal = await deps.credit(uid, t.reward);
    }
    return { reward: t.reward, balance: bal, task: t.name };
  }

  // ---- ticket config per guild ----
  function setTicketCfg(guildId, cfg) {
    ticketCfg[String(guildId)] = { ...(ticketCfg[String(guildId)] || {}), ...cfg };
    persistTickets();
    return ticketCfg[String(guildId)];
  }
  function getTicketCfg(guildId) {
    return ticketCfg[String(guildId)] || null;
  }

  return {
    listRewards,
    adminUpsertReward,
    adminDeleteReward,
    buy,
    getOrder,
    listOrders,
    markDelivered,
    listTasks,
    adminUpsertTask,
    adminDeleteTask,
    tasksForUser,
    claimTask,
    bumpProgress,
    markLogin,
    setTicketCfg,
    getTicketCfg,
    dayKeyParis,
  };
}

module.exports = { create, dayKeyParis };
