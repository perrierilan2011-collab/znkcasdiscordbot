'use strict';
/*
 * web/shop.js — boutique, order codes, tasks quotidiennes.
 * JSON local + sync Supabase (tables shop_*) si deps.supabase fourni.
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
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

/**
 * @param {string} dataDir
 * @param {{ getBalance, debit, credit, getInviteCount?, getGamesPlayed?, supabase?,
 *          grantRole?, notifyUser? }} deps
 */
function create(dataDir, deps = {}) {
  // évite qu'un double-clic / double event crée deux achats pour la même récompense
  const buying = new Set();

  const sb = deps.supabase || null;
  const REWARDS_FILE = path.join(dataDir, 'shop_rewards.json');
  const ORDERS_FILE = path.join(dataDir, 'shop_orders.json');
  const TASKS_FILE = path.join(dataDir, 'shop_tasks.json');
  const PROGRESS_FILE = path.join(dataDir, 'shop_task_progress.json');
  const TICKETS_FILE = path.join(dataDir, 'shop_ticket_cfg.json');

  let rewards = load(REWARDS_FILE, []);
  let orders = load(ORDERS_FILE, {});
  let tasks = load(TASKS_FILE, []);
  let progress = load(PROGRESS_FILE, {});
  let ticketCfg = load(TICKETS_FILE, {});

  const persistRewards = () => {
    save(REWARDS_FILE, rewards);
    if (sb) syncRewardsUp().catch((e) => console.error('[shop] sb rewards', e?.message || e));
  };
  const persistOrders = () => {
    save(ORDERS_FILE, orders);
  };
  const persistTasks = () => {
    save(TASKS_FILE, tasks);
    if (sb) syncTasksUp().catch((e) => console.error('[shop] sb tasks', e?.message || e));
  };
  const persistProgress = () => {
    save(PROGRESS_FILE, progress);
  };
  const persistTickets = () => {
    save(TICKETS_FILE, ticketCfg);
    if (sb) syncTicketsUp().catch((e) => console.error('[shop] sb tickets', e?.message || e));
  };

  async function syncRewardsUp() {
    if (!sb || !rewards.length) return;
    const rows = rewards.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.desc || '',
      price: r.price,
      type: r.type || 'custom',
      role_id: r.roleId || '',
      min_invites: Number(r.minInvites) || 0,
      min_games: Number(r.minGames) || 0,
      active: r.active !== false,
      stock: r.stock == null ? null : Number(r.stock),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb.from('shop_rewards').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  async function syncTasksUp() {
    if (!sb || !tasks.length) return;
    const rows = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.desc || '',
      reward: t.reward,
      type: t.type || 'games',
      target: t.target || 1,
      active: t.active !== false,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb.from('shop_tasks').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  async function syncTicketsUp() {
    if (!sb) return;
    const rows = Object.entries(ticketCfg).map(([guild_id, c]) => ({
      guild_id,
      category_id: c.categoryId || null,
      panel_channel_id: c.panelChannelId || null,
      updated_at: new Date().toISOString(),
    }));
    if (!rows.length) return;
    const { error } = await sb.from('shop_ticket_cfg').upsert(rows, { onConflict: 'guild_id' });
    if (error) throw error;
  }

  async function upsertOrderDb(order) {
    if (!sb || !order) return { ok: true, error: null };
    const { error } = await sb.from('shop_orders').upsert(
      {
        code: order.code,
        user_id: order.uid,
        user_name: order.name || '',
        guild_id: order.guildId || '',
        reward_id: order.rewardId,
        reward_name: order.rewardName || '',
        type: order.type || 'custom',
        role_id: order.roleId || '',
        price: order.price,
        status: order.status || 'pending',
        created_at: order.createdAt || new Date().toISOString(),
        delivered_at: order.deliveredAt || null,
      },
      { onConflict: 'code' }
    );
    if (error) {
      console.error('[shop] sb order', error.message || error);
      return { ok: false, error: error.message || String(error) };
    }
    return { ok: true, error: null };
  }

  // Les rôles sont livrés directement : aucun order code n'est créé.
  // On garde quand même une trace durable dans shop_role_grants.
  async function recordRoleGrantDb(row) {
    if (!sb) return;
    const { error } = await sb.from('shop_role_grants').insert({
      user_id: String(row.uid),
      user_name: row.name || '',
      guild_id: String(row.guildId || ''),
      reward_id: String(row.rewardId || ''),
      reward_name: row.rewardName || '',
      role_id: String(row.roleId || ''),
      price: Number(row.price) || 0,
      status: row.status || 'delivered',
      error: row.roleErr || '',
      created_at: new Date().toISOString(),
    });
    if (error) console.error('[shop] sb role grant', error.message || error);
  }

  async function upsertProgressDb(uid, u) {
    if (!sb || !u) return { ok: true, error: null };
    const { error } = await sb.from('shop_task_progress').upsert(
      {
        user_id: String(uid),
        day: u.day,
        done: u.done || [],
        prog: u.prog || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,day' }
    );
    if (error) {
      console.error('[shop] sb progress', error.message || error);
      return { ok: false, error: error.message || String(error) };
    }
    return { ok: true, error: null };
  }

  async function loadFromSupabase() {
    if (!sb) return;
    try {
      const { data: rw, error: e1 } = await sb.from('shop_rewards').select('*');
      if (e1) throw e1;
      if (rw && rw.length) {
        rewards = rw.map((r) => ({
          id: r.id,
          name: r.name,
          desc: r.description || '',
          price: Number(r.price) || 0,
          type: r.type || 'custom',
          roleId: r.role_id || '',
          minInvites: Number(r.min_invites) || 0,
          minGames: Number(r.min_games) || 0,
          active: r.active !== false,
          stock: r.stock == null ? null : Number(r.stock),
        }));
        save(REWARDS_FILE, rewards);
      }

      const { data: tk, error: e2 } = await sb.from('shop_tasks').select('*');
      if (e2) throw e2;
      if (tk && tk.length) {
        tasks = tk.map((t) => ({
          id: t.id,
          name: t.name,
          desc: t.description || '',
          reward: Number(t.reward) || 0,
          type: t.type || 'games',
          target: Number(t.target) || 1,
          active: t.active !== false,
        }));
        save(TASKS_FILE, tasks);
      }

      const { data: od, error: e3 } = await sb.from('shop_orders').select('*').order('created_at', { ascending: false }).limit(2000);
      if (e3) throw e3;
      if (od && od.length) {
        const map = {};
        for (const o of od) {
          map[o.code] = {
            code: o.code,
            uid: o.user_id,
            name: o.user_name || '',
            guildId: o.guild_id || '',
            rewardId: o.reward_id,
            rewardName: o.reward_name || '',
            type: o.type || 'custom',
            roleId: o.role_id || '',
            price: Number(o.price) || 0,
            status: o.status || 'pending',
            createdAt: o.created_at,
            deliveredAt: o.delivered_at || null,
          };
        }
        orders = { ...orders, ...map };
        save(ORDERS_FILE, orders);
      }

      const day = dayKeyParis();
      const { data: pr, error: e4 } = await sb.from('shop_task_progress').select('*').eq('day', day);
      if (!e4 && pr) {
        for (const row of pr) {
          progress[row.user_id] = {
            day: row.day,
            done: row.done || [],
            prog: row.prog || {},
          };
        }
        save(PROGRESS_FILE, progress);
      }

      const { data: cfg, error: e5 } = await sb.from('shop_ticket_cfg').select('*');
      if (!e5 && cfg) {
        for (const c of cfg) {
          ticketCfg[c.guild_id] = {
            categoryId: c.category_id || null,
            panelChannelId: c.panel_channel_id || null,
          };
        }
        save(TICKETS_FILE, ticketCfg);
      }

      console.log('[shop] chargé depuis Supabase');
    } catch (e) {
      console.error('[shop] load supabase', e?.message || e);
    }
  }

  /** Pull the newest orders from Supabase into the local map so the bot sees new codes quickly. */
  async function syncOrdersFromDb() {
    if (!sb) return 0;
    try {
      const { data: od, error } = await sb.from('shop_orders').select('*').order('created_at', { ascending: false }).limit(2000);
      if (error) throw error;
      if (!od || !od.length) return 0;
      let added = 0;
      for (const o of od) {
        if (!o.code) continue;
        const prev = orders[o.code];
        const row = {
          code: o.code,
          uid: o.user_id,
          name: o.user_name || '',
          guildId: o.guild_id || '',
          rewardId: o.reward_id,
          rewardName: o.reward_name || '',
          type: o.type || 'custom',
          roleId: o.role_id || '',
          price: Number(o.price) || 0,
          status: o.status || 'pending',
          createdAt: o.created_at,
          deliveredAt: o.delivered_at || null,
        };
        // Keep a local "delivered" flag if the DB row is still pending (write in flight).
        if (prev && prev.status === 'delivered' && row.status === 'pending') {
          row.status = 'delivered';
          row.deliveredAt = prev.deliveredAt;
        }
        if (!prev) added++;
        orders[o.code] = row;
      }
      persistOrders();
      return added;
    } catch (e) {
      console.error('[shop] sync orders', e?.message || e);
      return 0;
    }
  }

  /** Resolve an order by code, refreshing from Supabase once if it is not in the local map. */
  async function getOrderAsync(code) {
    const local = getOrder(code);
    if (local) return local;
    await syncOrdersFromDb();
    return getOrder(code);
  }

  /** Remove orders for one user (uid given) or all orders; mirrors the deletions to Supabase. */
  async function clearOrders(uid) {
    const target = uid ? String(uid) : null;
    const codes = [];
    let removed = 0;
    for (const [code, o] of Object.entries(orders)) {
      if (target && String(o.uid) !== target) continue;
      delete orders[code];
      codes.push(code);
      removed++;
    }
    persistOrders();
    if (!removed) return 0;
    if (sb) {
      try {
        if (target) {
          const { error } = await sb.from('shop_orders').delete().eq('user_id', target);
          if (error) throw error;
        } else {
          const { error } = await sb.from('shop_orders').delete().neq('code', '');
          if (error) throw error;
        }
      } catch (e) {
        console.error('[shop] clear orders db', e?.message || e);
        for (const code of codes) {
          try { await sb.from('shop_orders').delete().eq('code', code); } catch { /* ignore */ }
        }
      }
    }
    return removed;
  }

  if (!tasks.length) {
    tasks = [
      { id: 'daily_login', name: 'Connexion du jour', desc: 'Ouvre le casino aujourd’hui', reward: 5, type: 'login', target: 1, active: true },
      { id: 'play_3', name: 'Jouer 3 parties', desc: 'Termine 3 manches (online ou offline)', reward: 15, type: 'games', target: 3, active: true },
      { id: 'play_10', name: 'Jouer 10 parties', desc: 'Termine 10 manches aujourd’hui', reward: 40, type: 'games', target: 10, active: true },
    ];
    persistTasks();
  }

  if (sb) {
    loadFromSupabase().then(() => {
      // push seeds if DB empty
      syncRewardsUp().catch(() => {});
      syncTasksUp().catch(() => {});
    });
    // New order codes are created by the web shop and redeemed by the Discord bot.
    // Keep the local map fresh so getOrderAsync() finds a code within ~2 s.
    syncOrdersFromDb().catch(() => {});
    setInterval(() => { syncOrdersFromDb().catch(() => {}); }, 2000).unref();
  }

  function listRewards(admin = false) {
    return rewards
      .filter((r) => admin || r.active !== false)
      .map((r) => ({
        id: r.id,
        name: r.name,
        desc: r.desc || '',
        price: r.price,
        type: r.type || 'custom',
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
    if (sb) sb.from('shop_rewards').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('[shop] del reward', error.message);
    });
    return true;
  }

  async function buy(uid, rewardId, guildId, name) {
    const lockKey = `${uid}:${rewardId}`;
    if (buying.has(lockKey)) throw new Error('Achats déjà en cours, réessaie dans un instant.');
    buying.add(lockKey);
    try {
      const r = rewards.find((x) => x.id === rewardId && x.active !== false);
      if (!r) throw new Error('Reward introuvable.');
      if (r.stock != null && r.stock <= 0) throw new Error('Rupture de stock.');
      const invites = deps.getInviteCount ? await deps.getInviteCount(uid, guildId) : 0;
      const games = deps.getGamesPlayed ? await deps.getGamesPlayed(uid) : 0;
      if ((r.minInvites || 0) > 0 && invites < r.minInvites) {
        throw new Error(`Il te faut ${r.minInvites} invitation(s) (tu en as ${invites}).`);
      }
      if ((r.minGames || 0) > 0 && games < r.minGames) {
        throw new Error(`Il te faut ${r.minGames} partie(s) jouée(s) (tu en as ${games}).`);
      }
      const bal = await deps.getBalance(uid);
      if (bal < r.price) throw new Error(`Solde insuffisant (${bal} < ${r.price}).`);
      await deps.debit(uid, r.price);
      if (r.stock != null) {
        r.stock = Math.max(0, r.stock - 1);
        persistRewards();
      }

      const base = {
        uid: String(uid),
        name: name || '',
        guildId: guildId ? String(guildId) : '',
        rewardId: r.id,
        rewardName: r.name,
        type: r.type || 'custom',
        roleId: r.roleId || '',
        price: r.price,
      };

      // RÔLE : livraison directe, aucun code, aucun ticket, aucun doublon.
      if (base.type === 'role' && base.roleId && deps.grantRole) {
        let roleErr = '';
        try {
          await deps.grantRole(base.guildId, base.uid, base.roleId);
        } catch (e) {
          roleErr = String(e?.message || e).slice(0, 160);
        }
        const deliveredAt = new Date().toISOString();
        const grant = { ...base, status: roleErr ? 'failed' : 'delivered', roleErr, deliveredAt, autoRole: true, roleAdded: !roleErr, code: null };
        await recordRoleGrantDb(grant);
        if (!roleErr && deps.notifyUser) {
          try {
            await deps.notifyUser(base.uid, '✅ **Role added**\nThe role **' + base.rewardName + '** has been added to your account. No order code is needed.');
          } catch (e) { console.error('[shop] role notify', e?.message || e); }
        }
        grant.msg = roleErr
          ? 'The role could not be added' + (roleErr ? ': ' + roleErr : '') + '.'
          : 'Role added to your account.';
        return grant;
      }

      // Autres récompenses : code classique (ticket Discord si besoin).
      let code;
      do {
        code = makeCode();
      } while (orders[code]);
      const order = {
        ...base,
        code,
        status: 'pending',
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        autoRole: false,
      };
      orders[code] = order;
      persistOrders();
      await upsertOrderDb(order); // row must exist in Supabase before the response is sent
      order.msg = 'Purchase complete. Order code: ' + order.code;
      return order;
    } finally {
      buying.delete(lockKey);
    }
  }

  function getOrder(code) {
    const c = String(code || '').trim().toUpperCase();
    return orders[c] || null;
  }

  function listOrders({ uid, limit = 50 } = {}) {
    let list = Object.values(orders);
    if (uid) list = list.filter((o) => o.uid === String(uid));
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return list.slice(0, limit);
  }

  async function markDelivered(code) {
    const o = getOrder(code);
    if (!o) throw new Error('Order introuvable.');
    o.status = 'delivered';
    o.deliveredAt = new Date().toISOString();
    persistOrders();
    await upsertOrderDb(o);
    return o;
  }

  function listTasks(admin = false) {
    return tasks
      .filter((t) => admin || t.active !== false)
      .map((t) => ({
        id: t.id,
        name: t.name,
        desc: t.desc || '',
        reward: t.reward,
        type: t.type || 'games',
        target: t.target || 1,
        active: t.active !== false,
      }));
  }

  function adminUpsertTask(body) {
    const id = String(body.id || crypto.randomBytes(4).toString('hex'));
    const name = String(body.name || '').trim().slice(0, 64);
    if (!name) throw new Error('Nom de task requis.');
    const reward = floor2(Number(body.reward));
    if (!(reward >= 0)) throw new Error('Récompense invalide.');
    const type = ['login', 'games', 'invites', 'custom'].includes(body.type) ? body.type : 'games';
    const target = Math.max(1, Math.floor(Number(body.target) || 1));
    const entry = {
      id,
      name,
      desc: String(body.desc || '').trim().slice(0, 200),
      reward,
      type,
      target,
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
    if (sb) sb.from('shop_tasks').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('[shop] del task', error.message);
    });
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
    upsertProgressDb(uid, u);
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
    if (t.type === 'login' && cur < t.target) u.prog[t.id] = t.target;
    const have = u.prog[t.id] || 0;
    if (have < t.target) throw new Error(`Progression insuffisante (${have}/${t.target}).`);
    u.done.push(t.id);
    persistProgress();
    upsertProgressDb(uid, u);
    let bal = null;
    if (t.reward > 0) bal = await deps.credit(uid, t.reward);
    return { reward: t.reward, balance: bal, task: t.name };
  }

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
    getOrderAsync,
    syncOrdersFromDb,
    clearOrders,
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
