'use strict';
/*
 * web/football.js — PARIS FOOT avec des ZTKN (données football-data.org v4).
 *
 * - Matchs : GET /v4/matches?dateFrom&dateTo (cache 90 s, clé dans FOOTBALL_DATA_KEY).
 * - COTES AUTOMATIQUES réalistes : modèle de Poisson basé sur le classement réel
 *   (buts marqués / encaissés, avantage du terrain) + marge du casino (admin).
 *   Si l'API fournit de vraies cotes (abonnement payant), elles sont utilisées pour le 1X2.
 *   Marchés : 1X2, Plus/Moins de 2,5 buts, Les deux équipes marquent.
 * - Mise débitée à la prise de pari, cote figée. Règlement automatique à la fin du match
 *   (score du temps réglementaire), remboursement si match annulé.
 *
 * Fichiers : data/football_bets.json, data/football_cfg.json, data/football_standings.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = String(process.env.FOOTBALL_API || 'https://api.football-data.org/v4').replace(/\/+$/, '');
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const MATCH_TTL = 90 * 1000;
const STAND_TTL = 12 * 3600 * 1000;
const DAYS_AHEAD = 3;
const LOCK_BEFORE_MS = 60 * 1000; // paris fermés 1 min avant le coup d'envoi
const REFUND_AFTER_MS = 7 * 24 * 3600 * 1000;

function load(file, fb) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || fb; } catch { return fb; } }
function save(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { console.error('[foot] write', file, e?.message || e); }
}
const ymd = (d) => d.toISOString().slice(0, 10);

// ------------------------------------------------------------------ modèle de cotes
function poisson(l, kmax) {
  const out = [Math.exp(-l)];
  for (let k = 1; k <= kmax; k++) out.push(out[k - 1] * l / k);
  return out;
}
/** probabilités 1X2 / over 2.5 / BTTS à partir des buts attendus */
function probsFrom(lh, la) {
  const K = 10;
  const ph = poisson(lh, K), pa = poisson(la, K);
  let h = 0, x = 0, a = 0, over = 0, btts = 0, tot = 0;
  for (let i = 0; i <= K; i++) {
    for (let j = 0; j <= K; j++) {
      const p = ph[i] * pa[j];
      tot += p;
      if (i > j) h += p; else if (i === j) x += p; else a += p;
      if (i + j >= 3) over += p;
      if (i > 0 && j > 0) btts += p;
    }
  }
  return { h: h / tot, x: x / tot, a: a / tot, over: over / tot, btts: btts / tot };
}
const toOdd = (p, margin) => {
  const o = 1 / (Math.max(0.005, Math.min(0.995, p)) * (1 + margin));
  return Math.round(Math.max(1.01, Math.min(60, o)) * 100) / 100;
};

function create(dataDir, deps) {
  const BETS_FILE = path.join(dataDir, 'football_bets.json');
  const CFG_FILE = path.join(dataDir, 'football_cfg.json');
  const STAND_FILE = path.join(dataDir, 'football_standings.json');

  const envNum = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  const cfg = Object.assign({
    margin: 0.06,
    min: envNum('FOOT_MIN_BET', 1),
    max: envNum('FOOT_MAX_BET', 100000),
    maxPayout: envNum('FOOT_MAX_PAYOUT', 10000000),
  }, load(CFG_FILE, {}));
  const bets = load(BETS_FILE, []); // [{id, uid, name, matchId, market, pick, odds, stake, status, payout, ...}]
  const standings = load(STAND_FILE, {}); // code -> { t, avg, teams:{id:{pg,gf,ga}} }
  let betsTimer = null;
  const persistBets = () => { clearTimeout(betsTimer); betsTimer = setTimeout(() => save(BETS_FILE, bets), 400); };
  const persistStand = () => save(STAND_FILE, standings);
  const key = () => String(process.env.FOOTBALL_DATA_KEY || process.env.FOOTBALL_DATA_TOKEN || '').trim();

  // ---------------------------------------------------------------- API
  async function apiGet(p) {
    if (!key()) throw new Error('Paris foot indisponibles : FOOTBALL_DATA_KEY manquante côté serveur.');
    if (typeof fetch !== 'function') throw new Error('Node 18+ requis (fetch).');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(API + p, { signal: ctl.signal, headers: { 'X-Auth-Token': key(), Accept: 'application/json' } });
      if (r.status === 429) throw new Error('RATE');
      if (r.status === 403) throw new Error('Cette compétition n’est pas incluse dans ton offre football-data.org.');
      if (!r.ok) throw new Error('football-data HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // ---------------------------------------------------------------- classements (file d'attente : limite 10 req/min)
  const standQueue = new Set();
  let standBusy = false;
  function wantStandings(code) {
    if (!code) return;
    const s = standings[code];
    if (s && Date.now() - s.t < STAND_TTL) return;
    if (s && s.fail && Date.now() - s.fail < 3600 * 1000) return;
    standQueue.add(code);
    if (!standBusy) runStandQueue();
  }
  async function runStandQueue() {
    standBusy = true;
    try {
      while (standQueue.size) {
        const code = standQueue.values().next().value;
        standQueue.delete(code);
        try {
          const d = await apiGet('/competitions/' + encodeURIComponent(code) + '/standings');
          const teams = {};
          let gf = 0, pg = 0;
          for (const st of d.standings || []) {
            if (st.type && st.type !== 'TOTAL') continue;
            for (const row of st.table || []) {
              if (!row.team || !row.playedGames) continue;
              teams[row.team.id] = { pg: row.playedGames, gf: row.goalsFor, ga: row.goalsAgainst };
              gf += row.goalsFor; pg += row.playedGames;
            }
          }
          standings[code] = pg >= 6 ? { t: Date.now(), avg: gf / pg, teams } : { t: Date.now(), fail: Date.now(), avg: 0, teams: {} };
          persistStand();
        } catch (e) {
          standings[code] = Object.assign(standings[code] || { avg: 0, teams: {}, t: 0 }, { fail: Date.now() });
          if (e.message === 'RATE') { standQueue.add(code); await new Promise((r) => setTimeout(r, 30000)); }
        }
        await new Promise((r) => setTimeout(r, 6500));
      }
    } finally { standBusy = false; }
  }

  // ---------------------------------------------------------------- cotes automatiques
  function expectedGoals(m) {
    const s = standings[m.comp.code];
    const h = s && s.teams[m.home.id], a = s && s.teams[m.away.id];
    const avg = s && s.avg > 0.6 ? s.avg : 1.35;
    if (!h || !a) return { lh: 1.5, la: 1.15, model: false };
    const K = 4; // régression vers la moyenne (peu de matchs joués)
    const att = (t) => ((t.gf + avg * K) / (t.pg + K)) / avg;
    const def = (t) => ((t.ga + avg * K) / (t.pg + K)) / avg;
    let lh = avg * att(h) * def(a) * 1.12;
    let la = avg * att(a) * def(h) * 0.92;
    lh = Math.max(0.3, Math.min(3.8, lh));
    la = Math.max(0.3, Math.min(3.8, la));
    return { lh, la, model: true };
  }
  function oddsFor(m) {
    const { lh, la, model } = expectedGoals(m);
    const p = probsFrom(lh, la);
    const mg = cfg.margin;
    const o = {
      '1X2': { 1: toOdd(p.h, mg), X: toOdd(p.x, mg), 2: toOdd(p.a, mg) },
      OU25: { over: toOdd(p.over, mg), under: toOdd(1 - p.over, mg) },
      BTTS: { yes: toOdd(p.btts, mg), no: toOdd(1 - p.btts, mg) },
    };
    let src = model ? 'model' : 'basic';
    const ro = m.rawOdds;
    if (ro && Number(ro.homeWin) > 1 && Number(ro.draw) > 1 && Number(ro.awayWin) > 1) {
      o['1X2'] = { 1: Number(ro.homeWin), X: Number(ro.draw), 2: Number(ro.awayWin) };
      src = 'api';
    }
    return { odds: o, src };
  }

  // ---------------------------------------------------------------- matchs
  let mCache = { t: 0, list: [] };
  const norm = (m) => ({
    id: m.id,
    comp: { code: m.competition?.code || '', name: m.competition?.name || '', emblem: m.competition?.emblem || '' },
    home: { id: m.homeTeam?.id, name: m.homeTeam?.shortName || m.homeTeam?.name || '?', crest: m.homeTeam?.crest || '' },
    away: { id: m.awayTeam?.id, name: m.awayTeam?.shortName || m.awayTeam?.name || '?', crest: m.awayTeam?.crest || '' },
    utcDate: m.utcDate, status: m.status,
    score: m.score?.fullTime && m.score.fullTime.home != null ? { h: m.score.fullTime.home, a: m.score.fullTime.away } : null,
    rawOdds: m.odds && typeof m.odds === 'object' ? m.odds : null,
  });
  async function fetchMatches(force) {
    if (!force && Date.now() - mCache.t < MATCH_TTL) return mCache.list;
    try {
      const from = new Date(), to = new Date(Date.now() + DAYS_AHEAD * 86400000);
      const d = await apiGet(`/matches?dateFrom=${ymd(from)}&dateTo=${ymd(to)}`);
      mCache = { t: Date.now(), list: (d.matches || []).map(norm) };
      for (const c of new Set(mCache.list.map((x) => x.comp.code))) wantStandings(c);
    } catch (e) {
      if (e.message === 'RATE' && mCache.list.length) return mCache.list; // on garde le cache si quota atteint
      if (e.message === 'RATE') throw new Error('Trop de requêtes vers football-data.org, réessaie dans une minute.');
      throw e;
    }
    return mCache.list;
  }
  const open = (m) => (m.status === 'TIMED' || m.status === 'SCHEDULED') && new Date(m.utcDate).getTime() - Date.now() > LOCK_BEFORE_MS;

  async function listMatches() {
    const list = await fetchMatches();
    return list
      .filter((m) => m.status !== 'CANCELLED')
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .map((m) => {
        const { odds, src } = oddsFor(m);
        return { id: m.id, comp: m.comp, home: m.home, away: m.away, utcDate: m.utcDate, status: m.status, score: m.score, open: open(m), odds, src };
      });
  }

  // ---------------------------------------------------------------- paris
  const MARKETS = { '1X2': ['1', 'X', '2'], OU25: ['over', 'under'], BTTS: ['yes', 'no'] };
  const pub = (b) => ({
    id: b.id, matchId: b.matchId, home: b.home, away: b.away, comp: b.comp, utcDate: b.utcDate, market: b.market, pick: b.pick,
    odds: b.odds, stake: b.stake, status: b.status, payout: b.payout || 0, at: b.at, score: b.score || null,
  });
  const locks = new Map();
  async function withLock(uid, fn) {
    while (locks.get(uid)) await locks.get(uid).catch(() => {});
    const p = (async () => fn())();
    locks.set(uid, p);
    try { return await p; } finally { if (locks.get(uid) === p) locks.delete(uid); }
  }

  async function place(user, d) {
    const matchId = Number(d.matchId);
    const market = String(d.market || '1X2');
    const pick = String(d.pick || '');
    if (!MARKETS[market] || !MARKETS[market].includes(pick)) throw new Error('Pari invalide.');
    const stake = floor2(Number(String(d.stake).replace(',', '.')));
    if (!Number.isFinite(stake) || stake < cfg.min) throw new Error('Mise minimale : ' + cfg.min + '.');
    if (stake > cfg.max) throw new Error('Mise maximale : ' + cfg.max + '.');
    const list = await fetchMatches();
    const m = list.find((x) => x.id === matchId);
    if (!m) throw new Error('Match introuvable.');
    if (!open(m)) throw new Error('Les paris sont fermés sur ce match.');
    const { odds } = oddsFor(m);
    const odd = odds[market][pick];
    if (d.odds != null && Math.abs(Number(d.odds) - odd) > 0.005) {
      const e = new Error('La cote a changé (' + odd.toFixed(2) + '), valide à nouveau.'); e.code = 'ODDS'; throw e;
    }
    if (stake * odd > cfg.maxPayout) throw new Error('Gain potentiel trop élevé (max ' + cfg.maxPayout + ').');
    return withLock(user.uid, async () => {
      const spent = bets.filter((b) => b.uid === user.uid && b.matchId === matchId && b.status === 'open').reduce((a, b) => a + b.stake, 0);
      if (spent + stake > cfg.max) throw new Error('Mise totale maximale sur ce match : ' + cfg.max + '.');
      const bal = await deps.debit(user.uid, stake);
      if (bal === null) throw new Error('Solde insuffisant.');
      const bet = {
        id: crypto.randomBytes(5).toString('hex'), uid: user.uid, name: user.name, matchId, market, pick, odds: odd, stake,
        status: 'open', payout: 0, at: Date.now(), utcDate: m.utcDate, home: m.home.name, away: m.away.name, comp: m.comp.name,
      };
      bets.push(bet);
      persistBets();
      return { bet: pub(bet), bal };
    });
  }
  const myBets = (uid, limit = 60) => bets.filter((b) => b.uid === uid).sort((a, b) => b.at - a.at).slice(0, limit).map(pub);

  // ---------------------------------------------------------------- règlement
  function resultOf(m) {
    const sc = m.score || {};
    const useReg = sc.duration && sc.duration !== 'REGULAR' && sc.regularTime && sc.regularTime.home != null;
    const s = useReg ? sc.regularTime : sc.fullTime;
    if (!s || s.home == null || s.away == null) return null;
    return { h: s.home, a: s.away };
  }
  function won(b, r) {
    if (b.market === '1X2') return b.pick === (r.h > r.a ? '1' : r.h === r.a ? 'X' : '2');
    if (b.market === 'OU25') return b.pick === (r.h + r.a >= 3 ? 'over' : 'under');
    if (b.market === 'BTTS') return b.pick === (r.h > 0 && r.a > 0 ? 'yes' : 'no');
    return false;
  }
  let settling = false;
  async function finish(b, status, payout, score) {
    const prev = { status: b.status, payout: b.payout, score: b.score };
    b.status = status; b.payout = payout; b.score = score || b.score || null; b.settledAt = Date.now();
    persistBets();
    let bal = null;
    if (payout > 0) {
      try { bal = await deps.credit(b.uid, payout); }
      catch (e) {
        console.error('[foot] credit KO', b.uid, payout, e?.message || e);
        Object.assign(b, prev); delete b.settledAt; persistBets(); return; // on retentera au prochain passage
      }
    }
    try { if (deps.onSettle) await deps.onSettle(b, bal); } catch (e) { console.error('[foot] notify', e?.message || e); }
  }
  async function settleDue() {
    if (settling || !key()) return { settled: 0 };
    settling = true;
    let n = 0;
    try {
      const due = bets.filter((b) => b.status === 'open' && new Date(b.utcDate).getTime() < Date.now() + 60000);
      const ids = [...new Set(due.map((b) => b.matchId))];
      for (let i = 0; i < ids.length; i += 40) {
        const chunk = ids.slice(i, i + 40);
        let found = new Map();
        try {
          const d = await apiGet('/matches?ids=' + chunk.join(','));
          found = new Map((d.matches || []).map((m) => [m.id, m]));
        } catch (e) { console.error('[foot] settle fetch', e?.message || e); continue; }
        for (const id of chunk) {
          const m = found.get(id);
          const list = due.filter((b) => b.matchId === id && b.status === 'open');
          if (!m) {
            for (const b of list) if (Date.now() - new Date(b.utcDate).getTime() > REFUND_AFTER_MS) { await finish(b, 'refunded', b.stake); n++; }
            continue;
          }
          if (m.status === 'FINISHED' || m.status === 'AWARDED') {
            const r = resultOf(m);
            if (!r) continue;
            for (const b of list) {
              const w = won(b, r);
              await finish(b, w ? 'won' : 'lost', w ? floor2(b.stake * b.odds) : 0, r);
              n++;
            }
          } else if (m.status === 'CANCELLED') {
            for (const b of list) { await finish(b, 'refunded', b.stake); n++; }
          } else if ((m.status === 'POSTPONED' || m.status === 'SUSPENDED') && Date.now() - new Date(list[0].utcDate).getTime() > REFUND_AFTER_MS) {
            for (const b of list) { await finish(b, 'refunded', b.stake); n++; }
          }
        }
      }
    } finally { settling = false; }
    return { settled: n };
  }
  const timer = setInterval(() => { settleDue().catch((e) => console.error('[foot] settle', e?.message || e)); }, 2 * 60 * 1000);
  if (timer.unref) timer.unref();
  setTimeout(() => settleDue().catch(() => {}), 20000).unref?.();

  // ---------------------------------------------------------------- admin
  const cfgPub = () => ({ margin: cfg.margin, min: cfg.min, max: cfg.max, maxPayout: cfg.maxPayout, keySet: !!key() });
  function setCfg(d) {
    if (d.margin != null && d.margin !== '') {
      const pct = Number(String(d.margin).replace(',', '.'));
      if (!Number.isFinite(pct) || pct < 0 || pct > 30) throw new Error('Marge entre 0 et 30 %.');
      cfg.margin = pct / 100;
    }
    if (d.min != null && d.min !== '') { const v = Number(d.min); if (!(v > 0)) throw new Error('Mise min invalide.'); cfg.min = v; }
    if (d.max != null && d.max !== '') { const v = Number(d.max); if (!(v >= cfg.min)) throw new Error('Mise max invalide.'); cfg.max = v; }
    if (d.maxPayout != null && d.maxPayout !== '') { const v = Number(d.maxPayout); if (!(v > 0)) throw new Error('Gain max invalide.'); cfg.maxPayout = v; }
    save(CFG_FILE, cfg);
    return cfgPub();
  }
  const adminBets = (limit = 60) => [...bets].sort((a, b) => b.at - a.at).slice(0, limit).map((b) => ({ ...pub(b), name: b.name, uid: b.uid }));
  const stats = () => {
    const open_ = bets.filter((b) => b.status === 'open');
    const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost');
    const staked = settled.reduce((a, b) => a + b.stake, 0), paid = settled.reduce((a, b) => a + (b.payout || 0), 0);
    return { open: open_.length, openStake: floor2(open_.reduce((a, b) => a + b.stake, 0)), houseProfit: floor2(staked - paid) };
  };

  return { listMatches, place, myBets, settleDue, cfgPub, setCfg, adminBets, stats, MARKETS };
}

module.exports = { create, probsFrom };
