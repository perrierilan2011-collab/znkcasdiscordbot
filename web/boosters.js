'use strict';
/*
 * web/boosters.js — BOOSTERS Pokémon (cartes TCGdex), achetés avec des ZTKN.
 *
 * - Les packs (nom, set TCGdex, prix, nombre de cartes) sont gérés depuis le panneau admin.
 * - Achat  : débite le wallet, ajoute un booster NON OUVERT à l'inventaire du joueur.
 * - Ouvrir : tire N cartes au hasard dans le set (crypto.randomInt), les ajoute à la collection.
 * - Les cartes viennent de https://api.tcgdex.net/v2/fr (appel côté serveur, mis en cache).
 *
 * Fichiers : data/boosters_packs.json, data/boosters_inventory.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = String(process.env.TCGDEX_API || 'https://api.tcgdex.net/v2/fr').replace(/\/+$/, '');
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const MAX_QTY = 20;

function load(file, fb) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || fb; } catch { return fb; }
}
function save(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { console.error('[boosters] write', file, e?.message || e); }
}

async function getJson(url, ms = 9000) {
  if (typeof fetch !== 'function') throw new Error('Node 18+ requis (fetch).');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('TCGdex HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/**
 * @param {string} dataDir
 * @param {{ debit(uid,amt)->newBal|null, credit(uid,amt)->newBal, getBalance(uid) }} deps
 */
function create(dataDir, deps) {
  const sb = deps.supabase || null; // si fourni : tout est aussi sauvegardé dans Supabase (survit aux redeploy)
  const PACKS_FILE = path.join(dataDir, 'boosters_packs.json');
  const INV_FILE = path.join(dataDir, 'boosters_inventory.json');

  let packs = load(PACKS_FILE, null);
  if (!Array.isArray(packs) || !packs.length) {
    packs = [{
      id: 'base', name: 'Booster Set de Base', desc: '5 cartes du set de Base',
      setId: 'base1', price: 50, cards: 5, active: true,
    }];
    save(PACKS_FILE, packs);
  }
  const inv = load(INV_FILE, {}); // uid -> { unopened:{packId:n}, cards:{cardId:{...,n}}, opened:n }
  let invTimer = null;
  const persistInv = () => { clearTimeout(invTimer); invTimer = setTimeout(() => save(INV_FILE, inv), 600); };
  const persistPacks = () => save(PACKS_FILE, packs);

  // ---------------------------------------------------------------- Supabase (tables booster_*, voir booster_supabase.sql)
  const dirty = new Map(); // uid -> Set(cardId) : cartes à envoyer
  const logErr = (what, e) => console.error('[boosters] supabase ' + what, e?.message || e);
  async function fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select('*').range(from, from + 999);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  const packRow = (p) => ({ id: p.id, name: p.name, description: p.desc || '', set_id: p.setId, price: p.price, cards: p.cards, active: p.active !== false, updated_at: new Date().toISOString() });
  async function syncPacksUp(list) {
    if (!sb || !list.length) return;
    try {
      const { error } = await sb.from('booster_packs').upsert(list.map(packRow), { onConflict: 'id' });
      if (error) throw error;
    } catch (e) { logErr('packs', e); }
  }
  async function syncUserUp(uid) {
    if (!sb || !inv[uid]) return;
    const m = inv[uid];
    try {
      const r1 = await sb.from('booster_inventory').upsert({ user_id: uid, unopened: m.unopened, opened: m.opened || 0, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (r1.error) throw r1.error;
      const ids = [...(dirty.get(uid) || [])].filter((id) => m.cards[id]);
      for (let i = 0; i < ids.length; i += 200) {
        const rows = ids.slice(i, i + 200).map((id) => {
          const c = m.cards[id];
          return { user_id: uid, card_id: id, name: c.name, image: c.image, rarity: c.rarity || '', set_name: c.set || '', qty: c.n, last_at: c.last || 0 };
        });
        const r2 = await sb.from('booster_cards').upsert(rows, { onConflict: 'user_id,card_id' });
        if (r2.error) throw r2.error;
      }
      dirty.delete(uid);
    } catch (e) { logErr('user ' + uid, e); }
  }
  /** Au démarrage : on recharge tout depuis Supabase. Les données locales absentes de la base (ancien JSON) y sont envoyées. */
  const ready = (async () => {
    if (!sb) return;
    try {
      const pr = await fetchAll('booster_packs');
      if (pr.length) {
        packs = pr.map((r) => ({ id: r.id, name: r.name, desc: r.description || '', setId: r.set_id, price: Number(r.price) || 0, cards: Number(r.cards) || 5, active: r.active !== false }));
        persistPacks();
      } else await syncPacksUp(packs);
      const ir = await fetchAll('booster_inventory');
      const cr = await fetchAll('booster_cards');
      const dbUsers = new Set();
      for (const r of ir) {
        dbUsers.add(r.user_id);
        inv[r.user_id] = { unopened: r.unopened && typeof r.unopened === 'object' ? r.unopened : {}, cards: {}, opened: Number(r.opened) || 0 };
      }
      for (const r of cr) {
        const m = inv[r.user_id] || (inv[r.user_id] = { unopened: {}, cards: {}, opened: 0 });
        dbUsers.add(r.user_id);
        m.cards[r.card_id] = { name: r.name, image: r.image, rarity: r.rarity || '', set: r.set_name || '', n: Number(r.qty) || 1, last: Number(r.last_at) || 0 };
      }
      // migration : joueurs présents seulement dans le JSON local
      for (const uid of Object.keys(inv)) {
        if (dbUsers.has(uid)) continue;
        dirty.set(uid, new Set(Object.keys(inv[uid].cards)));
        await syncUserUp(uid);
      }
      save(INV_FILE, inv);
      console.log('[boosters] chargé depuis Supabase (' + dbUsers.size + ' joueurs)');
    } catch (e) { logErr('load', e); }
  })();

  // verrou par joueur : pas deux achats / ouvertures en parallèle (double clic)
  const locks = new Map();
  async function withLock(uid, fn) {
    while (locks.get(uid)) await locks.get(uid).catch(() => {});
    const p = (async () => fn())();
    locks.set(uid, p);
    try { return await p; } finally { if (locks.get(uid) === p) locks.delete(uid); }
  }

  const me = (uid) => inv[uid] || (inv[uid] = { unopened: {}, cards: {}, opened: 0 });
  const packPub = (p) => ({ id: p.id, name: p.name, desc: p.desc || '', setId: p.setId, price: p.price, cards: p.cards, active: p.active !== false });

  // ---------------------------------------------------------------- cache TCGdex
  const setCache = new Map(); // setId -> { t, cards:[{id,name,image}], name, logo }
  const cardCache = new Map(); // cardId -> { rarity, ... }
  const SET_TTL = 6 * 3600 * 1000;
  let setsList = null, setsListT = 0;

  async function listSets() {
    if (setsList && Date.now() - setsListT < SET_TTL) return setsList;
    const d = await getJson(API + '/sets');
    setsList = (Array.isArray(d) ? d : []).map((s) => ({
      id: String(s.id), name: String(s.name || s.id), total: Number(s.cardCount?.total) || 0,
    }));
    setsListT = Date.now();
    return setsList;
  }
  async function loadSet(setId) {
    const c = setCache.get(setId);
    if (c && Date.now() - c.t < SET_TTL) return c;
    const d = await getJson(API + '/sets/' + encodeURIComponent(setId), 15000);
    const cards = (d.cards || []).filter((x) => x && x.id && x.image).map((x) => ({
      id: String(x.id), name: String(x.name || x.id), image: String(x.image), localId: String(x.localId || ''),
    }));
    if (!cards.length) throw new Error('Set « ' + setId + ' » vide ou introuvable.');
    const out = { t: Date.now(), cards, name: String(d.name || setId), logo: d.logo ? String(d.logo) : '' };
    setCache.set(setId, out);
    return out;
  }
  async function cardDetail(card) {
    let c = cardCache.get(card.id);
    if (c) return c;
    c = { rarity: '', hp: 0 };
    try {
      const d = await getJson(API + '/cards/' + encodeURIComponent(card.id), 6000);
      c = { rarity: String(d.rarity || ''), hp: Number(d.hp) || 0 };
    } catch { /* la rareté est un bonus : on affiche la carte quand même */ }
    cardCache.set(card.id, c);
    return c;
  }
  const imgUrl = (base) => (/\.(webp|png|jpg)$/i.test(base) ? base : base + '/high.webp');

  // ---------------------------------------------------------------- vue joueur
  function listPacks(uid) {
    const m = me(uid);
    return {
      packs: packs.filter((p) => p.active !== false).map((p) => ({ ...packPub(p), owned: m.unopened[p.id] || 0 })),
      unopened: Object.values(m.unopened).reduce((a, b) => a + b, 0),
      collection: Object.keys(m.cards).length,
      opened: m.opened || 0,
    };
  }
  function collection(uid) {
    const m = me(uid);
    return Object.entries(m.cards).map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => (b.last || 0) - (a.last || 0)).slice(0, 600);
  }

  async function buy(uid, packId, qty) {
    const p = packs.find((x) => x.id === packId && x.active !== false);
    if (!p) throw new Error('Booster introuvable.');
    const n = Math.max(1, Math.min(MAX_QTY, Math.floor(Number(qty) || 1)));
    const cost = floor2(p.price * n);
    if (!(cost > 0)) throw new Error('Prix invalide.');
    await ready;
    return withLock(uid, async () => {
      const bal = await deps.debit(uid, cost);
      if (bal === null) throw new Error('Solde insuffisant.');
      const m = me(uid);
      m.unopened[p.id] = (m.unopened[p.id] || 0) + n;
      persistInv();
      await syncUserUp(uid);
      return { bal, owned: m.unopened[p.id], cost, qty: n };
    });
  }

  async function open(uid, packId) {
    const p = packs.find((x) => x.id === packId);
    if (!p) throw new Error('Booster introuvable.');
    await ready;
    return withLock(uid, async () => {
      const m = me(uid);
      if (!(m.unopened[p.id] > 0)) throw new Error('Tu n’as pas de booster à ouvrir.');
      // on charge le set AVANT de consommer le booster : si TCGdex est en panne, rien n'est perdu
      const set = await loadSet(p.setId);
      m.unopened[p.id] -= 1;
      if (m.unopened[p.id] <= 0) delete m.unopened[p.id];
      const picks = [];
      const n = Math.max(1, Math.min(15, p.cards || 5));
      for (let i = 0; i < n; i++) picks.push(set.cards[crypto.randomInt(set.cards.length)]);
      const details = await Promise.all(picks.map((c) => cardDetail(c)));
      const now = Date.now();
      const out = picks.map((c, i) => {
        const prev = m.cards[c.id];
        const isNew = !prev;
        m.cards[c.id] = {
          name: c.name, image: imgUrl(c.image), rarity: details[i].rarity, set: set.name,
          n: (prev ? prev.n : 0) + 1, last: now,
        };
        return { id: c.id, name: c.name, image: imgUrl(c.image), rarity: details[i].rarity, isNew };
      });
      m.opened = (m.opened || 0) + 1;
      persistInv();
      const dset = dirty.get(uid) || new Set();
      for (const c of picks) dset.add(c.id);
      dirty.set(uid, dset);
      await syncUserUp(uid);
      return { cards: out, left: m.unopened[p.id] || 0, set: set.name };
    });
  }

  // ---------------------------------------------------------------- admin
  const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  function adminList() { return packs.map(packPub); }
  function adminUpsert(d) {
    const name = String(d.name || '').trim().slice(0, 64);
    if (!name) throw new Error('Nom requis.');
    const price = floor2(Number(String(d.price).replace(',', '.')));
    if (!Number.isFinite(price) || price <= 0 || price > 1e9) throw new Error('Prix invalide.');
    const setId = String(d.setId || '').trim().slice(0, 40);
    if (!/^[A-Za-z0-9._-]+$/.test(setId)) throw new Error('ID de set TCGdex invalide (ex : base1, sv01).');
    const cards = Math.max(1, Math.min(15, Math.floor(Number(d.cards) || 5)));
    let id = String(d.id || '').trim();
    let p = id ? packs.find((x) => x.id === id) : null;
    if (!p) {
      id = slug(name) || crypto.randomBytes(3).toString('hex');
      while (packs.some((x) => x.id === id)) id += '-' + crypto.randomBytes(1).toString('hex');
      p = { id };
      packs.push(p);
    }
    Object.assign(p, {
      name, desc: String(d.desc || '').trim().slice(0, 160), setId, price, cards,
      active: d.active === undefined ? p.active !== false : (d.active === true || d.active === 'true' || d.active === 1 || d.active === '1'),
    });
    persistPacks();
    syncPacksUp([p]);
    return packPub(p);
  }
  function adminSetPrice(id, price) {
    const p = packs.find((x) => x.id === id);
    if (!p) throw new Error('Booster introuvable.');
    const v = floor2(Number(String(price).replace(',', '.')));
    if (!Number.isFinite(v) || v <= 0 || v > 1e9) throw new Error('Prix invalide.');
    p.price = v;
    persistPacks();
    syncPacksUp([p]);
    return packPub(p);
  }
  function adminDelete(id) {
    const i = packs.findIndex((x) => x.id === id);
    if (i >= 0) {
      packs.splice(i, 1); persistPacks();
      if (sb) sb.from('booster_packs').delete().eq('id', id).then(({ error }) => { if (error) logErr('delete pack', error); });
    }
  }

  return { ready, listPacks, collection, buy, open, adminList, adminUpsert, adminSetPrice, adminDelete, listSets };
}

module.exports = { create };
