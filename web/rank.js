'use strict';
/*
 * web/rank.js — Rangs compétitifs ZNK (RR) + saisons hebdomadaires.
 *
 * RR uniquement via le mode RANKED (pas les tables cash ZTKN).
 * Placement : 5 parties avant d’afficher le vrai rang.
 * Soft reset chaque lundi 00:00 Europe/Paris : on garde ~85 % de l’écart au floor.
 * Paliers basés sur le RR (plus sur les gains cash).
 */
const fs = require('fs');
const path = require('path');

const ROMAN = ['III', 'II', 'I'];
let RR_START = 1000;
let RR_FLOOR = 100;
let PLACEMENT_N = 5;
let SOFT_KEEP = 0.85;
const K_ARENA = 28;

// Default families (English names) — used until Supabase ladder is loaded
const DEFAULT_FAMILIES = [
  { fam: 'Bronze', c1: '#e0a06a', c2: '#8a4b14', sym: 'chev', mins: [100, 400, 700] },
  { fam: 'Silver', c1: '#f3f4f6', c2: '#8b94a3', sym: 'chev', mins: [1000, 1200, 1400] },
  { fam: 'Gold', c1: '#fde68a', c2: '#d97706', sym: 'star', mins: [1600, 1800, 2000] },
  { fam: 'Platinum', c1: '#a5f3fc', c2: '#3b82a6', sym: 'star', mins: [2200, 2400, 2600] },
  { fam: 'Diamond', c1: '#c4b5fd', c2: '#6d28d9', sym: 'gem', mins: [2800, 3000, 3200] },
  { fam: 'Master', c1: '#fcd34d', c2: '#b45309', sym: 'crown', mins: [3400] },
  { fam: 'Grand Master', c1: '#f9a8d4', c2: '#be185d', sym: 'crown', mins: [3800] },
  { fam: 'Champion', c1: '#67e8f9', c2: '#0e7490', sym: 'crown', mins: [4200] },
  { fam: 'Legend', c1: '#fb923c', c2: '#b91c1c', sym: 'wings', mins: [4600] },
  { fam: 'Immortal ZNK', c1: '#fff7ad', c2: '#f59e0b', sym: 'wings', mins: [5000] },
];

function buildLadderFromFamilies(families) {
  const out = [];
  families.forEach((f, fi) => {
    f.mins.forEach((min, k) => {
      const div = f.mins.length === 3 ? ROMAN[k] : '';
      out.push({
        id: out.length,
        fam: f.fam,
        fi,
        div,
        name: div ? `${f.fam} ${div}` : f.fam,
        min: Number(min) || 0,
        c1: f.c1,
        c2: f.c2,
        sym: f.sym,
        pips: f.mins.length === 3 ? k + 1 : 0,
      });
    });
  });
  return out;
}

/** Mutable ladder — always visible to every player (even during placement) */
let LADDER = buildLadderFromFamilies(DEFAULT_FAMILIES);

function rankIndex(rr) {
  let i = 0;
  const v = Math.max(0, Number(rr) || 0);
  for (let k = 0; k < LADDER.length; k++) if (v >= LADDER[k].min) i = k;
  return i;
}
function progress(rr) {
  const e = Math.max(0, Number(rr) || 0);
  const i = rankIndex(e);
  const cur = LADDER[i] || LADDER[0];
  const next = LADDER[i + 1] || null;
  const pct = next ? Math.max(0, Math.min(1, (e - cur.min) / (next.min - cur.min))) : 1;
  return { idx: i, pct, toNext: next ? Math.max(0, next.min - e) : 0, maxed: !next, tier: cur };
}

/** lundi 00:00 Europe/Paris de la semaine courante */
function seasonStartMs(now = Date.now()) {
  // Trouver le lundi 00:00 Europe/Paris de la semaine en cours
  const dayMs = 86400000;
  let t = now;
  for (let guard = 0; guard < 400; guard++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .formatToParts(new Date(t))
        .filter((x) => x.type !== 'literal')
        .map((x) => [x.type, x.value])
    );
    if (parts.weekday === 'Mon' && parts.hour === '00' && parts.minute === '00') return t;
    t -= 15 * 60 * 1000; // recule de 15 min
    if (t < now - 8 * dayMs) break;
  }
  // fallback : maintenant - jours depuis lundi (approx)
  const wd = new Date(now).getUTCDay();
  const since = wd === 0 ? 6 : wd - 1;
  return now - since * dayMs;
}
function seasonEndMs(start) {
  return start + 7 * 86400000;
}

function seasonId(start) {
  const d = new Date(start);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p; // YYYY-MM-DD du lundi
}

function create(file, supabase) {
  let users = {};
  let meta = { season: null, lastReset: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    if (raw.users) {
      users = raw.users;
      meta = raw.meta || meta;
    } else {
      users = raw; // ancien format
    }
  } catch {
    users = {};
  }
  let timer = null;
  const dirty = new Set();

  const toRow = (id, u) => ({
    user_id: id,
    name: u.n || 'Joueur',
    avatar: u.a || '',
    earned: u.earned || 0,
    elo: u.elo,
    games: u.eg || 0,
    peak: u.peak,
    wins: u.w || 0,
    losses: u.l || 0,
    place: u.place || 0,
    season: meta.season || '',
    updated_at: new Date().toISOString(),
  });

  async function flushDb() {
    if (!supabase || !dirty.size) return;
    const ids = [...dirty];
    dirty.clear();
    const rows = ids.filter((id) => users[id]).map((id) => toRow(id, users[id]));
    for (let i = 0; i < rows.length; i += 500) {
      try {
        const { error } = await supabase.from('player_rank').upsert(rows.slice(i, i + 500), { onConflict: 'user_id' });
        if (error) throw error;
      } catch (e) {
        console.error('[rank] supabase', e?.message || e);
        rows.slice(i, i + 500).forEach((r) => dirty.add(r.user_id));
      }
    }
  }

  async function loadLadderFromDb() {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.from('site_rank_ladder').select('*').order('id', { ascending: true });
      if (error) throw error;
      if (data && data.length) {
        LADDER = data.map((r) => ({
          id: r.id,
          fam: r.fam,
          fi: r.fi || 0,
          div: r.div || '',
          name: r.name,
          min: Number(r.min_rr) || 0,
          c1: r.c1 || '#a78bfa',
          c2: r.c2 || '#5b21b6',
          sym: r.sym || 'chev',
          pips: r.pips || 0,
        }));
        console.log('[rank] ladder loaded from Supabase (' + LADDER.length + ' tiers)');
      }
    } catch (e) {
      console.error('[rank] ladder load', e?.message || e);
    }
  }

  async function saveLadderToDb() {
    if (!supabase || !LADDER.length) return;
    try {
      const rows = LADDER.map((t) => ({
        id: t.id,
        fam: t.fam,
        fi: t.fi || 0,
        div: t.div || '',
        name: t.name,
        min_rr: t.min,
        c1: t.c1,
        c2: t.c2,
        sym: t.sym,
        pips: t.pips || 0,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('site_rank_ladder').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    } catch (e) {
      console.error('[rank] ladder save', e?.message || e);
    }
  }

  /** Admin: update RR thresholds (array of { id, min } or full tiers) */
  function adminSetLadder(tiers) {
    if (!Array.isArray(tiers) || !tiers.length) throw new Error('Invalid ladder.');
    const next = tiers.map((t, i) => ({
      id: t.id != null ? Number(t.id) : i,
      fam: String(t.fam || t.name || 'Tier').slice(0, 32),
      fi: Number(t.fi) || 0,
      div: String(t.div || ''),
      name: String(t.name || t.fam || 'Tier').slice(0, 48),
      min: Math.max(0, Math.floor(Number(t.min) || 0)),
      c1: String(t.c1 || '#a78bfa'),
      c2: String(t.c2 || '#5b21b6'),
      sym: String(t.sym || 'chev'),
      pips: Number(t.pips) || 0,
    }));
    next.sort((a, b) => a.min - b.min || a.id - b.id);
    next.forEach((t, i) => (t.id = i));
    LADDER = next;
    saveLadderToDb();
    return LADDER.map((t) => ({ ...t }));
  }

  if (supabase)
    (async () => {
      try {
        await loadLadderFromDb();
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from('player_rank').select('*').range(from, from + 999);
          if (error) throw error;
          for (const r of data || []) {
            const loc = users[r.user_id];
            if (loc && (loc.eg || 0) > r.games) continue;
            users[r.user_id] = {
              n: r.name || 'Player',
              a: r.avatar || '',
              earned: Number(r.earned) || 0,
              elo: Number(r.elo) || RR_START,
              eg: r.games || 0,
              peak: Number(r.peak) || RR_START,
              w: r.wins || 0,
              l: r.losses || 0,
              place: r.place || 0,
            };
          }
          if (!data || data.length < 1000) break;
        }
        Object.keys(users).forEach((id) => dirty.add(id));
        await flushDb();
        console.log('[rank] RR loaded from Supabase');
      } catch (e) {
        console.error('[rank] supabase load', e?.message || e);
      }
    })();

  function save(ids) {
    for (const id of ids || []) dirty.add(id);
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify({ users, meta }));
        fs.renameSync(file + '.tmp', file);
      } catch (e) {
        console.error('[rank] écriture', e?.message || e);
      }
      flushDb();
    }, 2000);
    if (timer.unref) timer.unref();
  }

  const get = (uid, name, avatar) => {
    const u = users[uid] || (users[uid] = { n: name || 'Joueur', a: '', elo: RR_START, eg: 0, peak: RR_START, w: 0, l: 0, place: 0, earned: 0 });
    if (name) u.n = name;
    if (avatar) u.a = avatar;
    if (u.place == null) u.place = 0;
    return u;
  };

  /** soft reset saison si besoin */
  function ensureSeason() {
    const start = seasonStartMs();
    const id = seasonId(start);
    if (meta.season === id) return { start, end: seasonEndMs(start), id };
    // nouvelle saison
    const prev = meta.season;
    meta.season = id;
    meta.lastReset = Date.now();
    if (prev) {
      for (const u of Object.values(users)) {
        const above = Math.max(0, (u.elo || RR_START) - RR_FLOOR);
        u.elo = Math.round(RR_FLOOR + above * SOFT_KEEP);
        // peak de saison reset soft aussi
        u.peak = Math.max(u.elo, Math.round(RR_FLOOR + Math.max(0, (u.peak || u.elo) - RR_FLOOR) * SOFT_KEEP));
        // placement ne se rejoue pas chaque saison (option : reset place)
        // u.place = 0; // décommenter pour forcer re-placement
      }
      Object.keys(users).forEach((id) => dirty.add(id));
      save(Object.keys(users));
      console.log(`[rank] soft reset saison ${prev} → ${id}`);
    } else {
      save([]);
    }
    return { start, end: seasonEndMs(start), id };
  }

  /** Admin: hard reset every player back to the starting rank (RR/ELO + placement + stats). */
  function resetRankedSeason() {
    const ids = Object.keys(users);
    const sid = seasonId(seasonStartMs());
    for (const id of ids) {
      const u = users[id];
      u.elo = RR_START;
      u.peak = RR_START;
      u.eg = 0;
      u.w = 0;
      u.l = 0;
      u.place = 0;
      u.earned = 0;
    }
    meta.season = sid;
    meta.lastReset = Date.now();
    ids.forEach((id) => dirty.add(id));
    save(ids);
    flushDb();
    return { reset: ids.length };
  }

  /**
   * Résultat d'une partie ranked.
   * players: [{ uid, name, place: 1..n (1=gagnant), avatar? }]
   */
  function recordRanked(players, avatarOf) {
    ensureSeason();
    const list = (players || []).filter((p) => p && p.uid);
    if (list.length < 2) return [];
    const n = list.length;
    const us = list.map((p) => get(String(p.uid), p.name, (avatarOf && avatarOf(String(p.uid))) || p.avatar));
    const deltas = new Array(n).fill(0);

    // Chaque joueur vs chaque autre : place meilleure = victoire
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const Si = list[i].place < list[j].place ? 1 : list[i].place > list[j].place ? 0 : 0.5;
        const E = 1 / (1 + Math.pow(10, (us[j].elo - us[i].elo) / 400));
        deltas[i] += (K_ARENA / (n - 1)) * (Si - E);
      }
    }

    const changes = [];
    for (let i = 0; i < n; i++) {
      const u = us[i];
      const before = u.elo;
      const inPlacement = (u.place || 0) < PLACEMENT_N;
      u.elo = Math.max(RR_FLOOR, u.elo + deltas[i]);
      u.eg = (u.eg || 0) + 1;
      if (list[i].place === 1) u.w = (u.w || 0) + 1;
      else if (list[i].place === n) u.l = (u.l || 0) + 1;
      if (u.elo > (u.peak || 0)) u.peak = u.elo;

      if (inPlacement) {
        u.place = (u.place || 0) + 1;
        // bonus placement selon ratio de victoires de placement
        if (u.place >= PLACEMENT_N) {
          const winRate = u.w / Math.max(1, u.eg);
          // 5 wins théoriques → ~1200, 0 → ~800
          const target = Math.round(800 + winRate * 400);
          u.elo = Math.round(u.elo * 0.4 + target * 0.6);
          u.elo = Math.max(RR_FLOOR, u.elo);
        }
      }
      changes.push({
        uid: list[i].uid,
        name: list[i].name,
        delta: Math.round(u.elo - before),
        elo: Math.round(u.elo),
        place: list[i].place,
        placement: (u.place || 0) < PLACEMENT_N,
        placementLeft: Math.max(0, PLACEMENT_N - (u.place || 0)),
      });
    }
    save(list.map((p) => String(p.uid)));
    return changes;
  }

  /** legacy cash tables : n'affecte plus le RR ranked */
  function record() {
    /* no-op pour poker/bj/roulette cash */
  }

  const eloList = () =>
    Object.entries(users)
      .filter(([, u]) => (u.eg || 0) > 0 || (u.place || 0) > 0)
      .sort((a, b) => b[1].elo - a[1].elo || b[1].eg - a[1].eg);

  function view(uid, top = 50) {
    const season = ensureSeason();
    const list = eloList();
    const row = ([id, u], i) => {
      const placing = (u.place || 0) < PLACEMENT_N;
      const pr = progress(u.elo);
      // Always expose tier + ladder RR — even during placement
      return {
        pos: i + 1,
        uid: id,
        name: u.n,
        avatar: u.a || '',
        elo: Math.round(u.elo),
        games: u.eg || 0,
        wins: u.w || 0,
        prov: placing,
        placementLeft: placing ? PLACEMENT_N - (u.place || 0) : 0,
        rank: pr.idx,
        tier: pr.tier,
      };
    };
    const meU = users[uid];
    const mePos = list.findIndex(([id]) => id === uid);
    const mePlacing = meU ? (meU.place || 0) < PLACEMENT_N : true;
    const mePr = meU ? progress(meU.elo) : progress(RR_START);
    return {
      ladder: LADDER,
      season: {
        id: season.id,
        start: season.start,
        end: season.end,
        now: Date.now(),
        label: 'Saison ' + season.id,
      },
      placementN: PLACEMENT_N,
      me: meU
        ? {
            elo: Math.round(meU.elo),
            peak: Math.round(meU.peak || meU.elo),
            games: meU.eg || 0,
            wins: meU.w || 0,
            losses: meU.l || 0,
            pos: mePos >= 0 ? mePos + 1 : 0,
            prov: mePlacing,
            placementDone: (meU.place || 0),
            placementLeft: Math.max(0, PLACEMENT_N - (meU.place || 0)),
            total: list.length,
            ...(mePlacing ? { idx: 0, pct: (meU.place || 0) / PLACEMENT_N, toNext: 0, maxed: false, tier: null } : mePr),
          }
        : {
            elo: RR_START,
            peak: RR_START,
            games: 0,
            wins: 0,
            losses: 0,
            pos: 0,
            prov: true,
            placementDone: 0,
            placementLeft: PLACEMENT_N,
            total: list.length,
            ...progress(RR_START),
          },
      elo: list.slice(0, top).map(row),
      meRow: mePos >= top ? row(list[mePos], mePos) : null,
      provisional: PLACEMENT_N,
      mode: 'ranked',
    };
  }

  const info = (uid) => {
    const u = users[uid];
    if (!u || (u.place || 0) < PLACEMENT_N) {
      return { id: -1, name: 'Placement', fam: 'Placement', c1: '#a78bfa', c2: '#5b21b6', sym: 'chev', pips: 0, fi: 0 };
    }
    return LADDER[rankIndex(u.elo)] || LADDER[0];
  };

  /** Adjust RR directly (admin / ranked BJ) */
  function adjustRR(uid, delta, name) {
    const u = get(String(uid), name);
    const before = u.elo;
    u.elo = Math.max(RR_FLOOR, Math.round((u.elo + Number(delta)) * 100) / 100);
    if (u.elo > (u.peak || 0)) u.peak = u.elo;
    save([String(uid)]);
    return { before: Math.round(before), elo: Math.round(u.elo), delta: Math.round(u.elo - before) };
  }

  function getRR(uid) {
    const u = users[String(uid)];
    return u ? Math.round(u.elo) : RR_START;
  }

  return {
    info,
    record,
    recordRanked,
    view,
    touch: (uid, name, avatar) => {
      if (users[uid]) {
        get(uid, name, avatar);
        save([uid]);
      }
    },
    ensureSeason,
    resetRankedSeason,
    adminSetLadder,
    getLadder: () => LADDER.map((t) => ({ ...t })),
    adjustRR,
    getRR,
    get LADDER() {
      return LADDER;
    },
    RR_START,
    RR_FLOOR,
    PLACEMENT_N,
  };
}

module.exports = {
  create,
  /** Convenience wrapper: pass the api returned by create() to reset a season. */
  resetRankedSeason: (api) => (api && typeof api.resetRankedSeason === 'function') ? api.resetRankedSeason() : { reset: 0 },
  progress,
  rankIndex,
  get LADDER() {
    return LADDER;
  },
  get RR_START() {
    return RR_START;
  },
  get PLACEMENT_N() {
    return PLACEMENT_N;
  },
  SOFT_KEEP,
};
