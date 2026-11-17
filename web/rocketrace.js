'use strict';
/*
 * web/rocketrace.js — COURSE DE FUSÉES multijoueur (côté serveur, c'est lui qui fait foi).
 *
 * Une course par serveur Discord, partagée par TOUS les joueurs connectés.
 * Chacun mise librement : sa fusée porte son pseudo, décolle de la Terre, fait le tour
 * du Soleil entre les planètes, puis revient se poser sur la Terre. Le premier arrivé
 * gagne le plus, le deuxième un peu moins, etc. (pot redistribué au classement).
 *
 * Cycle : mises ouvertes (ROCKET_BET_SECONDS, défaut 15 s, démarre à la 1re mise) ->
 *   "Prêts, partez !" (LEAD_MS) -> course animée (RACE_MS, trajectoire identique chez
 *   tous les clients) -> paiement au classement (RESULT_MS) -> nouvelle manche.
 * Argent : débité à la mise, crédité au résultat (deps.debit / deps.credit).
 * Si le bot plante en pleine manche, les mises sont remboursées (deps.pending).
 */
const { randomInt } = require('crypto');

const env = (k, ...alts) => {
  for (const key of [k, ...alts]) {
    const v = Number(process.env[key]);
    if (v) return v;
  }
  return 0;
};
const MIN_BET = Math.max(0.01, env('ROCKET_MIN_BET', 'BJ_MIN_BET') || 1);
const MAX_BET = Math.max(MIN_BET, env('ROCKET_MAX_BET') || 100_000_000);
const BET_TIME_MS = Math.max(8, env('ROCKET_BET_SECONDS') || 15) * 1000;
const LEAD_MS = 900;   // délai "3, 2, 1, PARTEZ" avant le décollage
const RACE_MS = 13000; // durée max d'un tour complet (le plus rapide arrive avant)
const RESULT_MS = 8000;
const OFFLINE_GRACE_MS = 8000;
const HOUSE_EDGE = 0.05; // 5 % de commission, le reste est redistribué au classement
const MAX_SPECTATORS_SENT = 40;

const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const rnd = (lo, hi) => lo + (randomInt(100000) / 100000) * (hi - lo);
const ROCKETS = [
  { key: 'red',    color: '#ef4444', glow: '#fca5a5', name: 'Rouge' },
  { key: 'blue',   color: '#3b82f6', glow: '#93c5fd', name: 'Bleue' },
  { key: 'green',  color: '#22c55e', glow: '#86efac', name: 'Verte' },
  { key: 'gold',   color: '#fbbf24', glow: '#fde68a', name: 'Or' },
  { key: 'violet', color: '#a855f7', glow: '#d8b4fe', name: 'Violette' },
  { key: 'cyan',   color: '#06b6d4', glow: '#a5f3fc', name: 'Cyan' },
  { key: 'pink',   color: '#ec4899', glow: '#f9a8d4', name: 'Rose' },
  { key: 'orange', color: '#f97316', glow: '#fdba74', name: 'Orange' },
];

/** Parts du pot selon le rang (1er, 2e, 3e, ...) : 1/(rang+1) normalisé. */
function sharesFor(n) {
  if (n <= 0) return [];
  if (n === 1) return [1];
  const w = [], tot = [];
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = 1 / (i + 1); w.push(v); sum += v; }
  for (const v of w) tot.push(v / sum);
  return tot;
}
/** Multiplicateur indicatif (mises égales) : part du pot APRÈS commission / part d'un partant. */
const multFor = (rank, n) => floor2((sharesFor(n)[rank] || 0) * n * (1 - HOUSE_EDGE));

const INFO = { min: MIN_BET, max: MAX_BET, rockets: ROCKETS, betSeconds: BET_TIME_MS / 1000, houseEdge: HOUSE_EDGE };

class RocketRaceRoom {
  /** deps : { getBalance, debit(uid, amt)->newBal|null, credit(uid, amt)->newBal, pending:{set,del}, onChange(room), onRoundEnd(recap) } */
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.players = new Map(); // uid -> joueur présent à la table
    this.phase = 'betting';   // betting | countdown | racing | result
    this.deadline = 0;
    this.round = 0;
    this.track = null;
    this.result = null;
    this.history = [];
    this.feed = [];
    this.timer = null;
    this.q = Promise.resolve();
    this.emitT = null;
  }

  // ------------------------------------------------------------------ utilitaires
  run(fn) {
    const p = this.q.then(fn, fn);
    this.q = p.catch(() => {});
    return p;
  }
  say(text) {
    this.feed.push({ t: Date.now(), text });
    if (this.feed.length > 8) this.feed.shift();
  }
  emit() {
    if (this.emitT) return;
    this.emitT = setTimeout(() => {
      this.emitT = null;
      try { this.deps.onChange(this); } catch (e) { console.error('[rocket] emit', e?.message || e); }
    }, 80);
  }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.run(fn).catch((e) => console.error('[rocket] timer', e)), ms);
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
  }
  async setStaked(p, delta) {
    p.staked = floor2((p.staked || 0) + delta);
    const key = `rocketrace-${this.guildId}:${p.uid}`;
    if (p.staked > 0) this.deps.pending.set(key, p.staked);
    else this.deps.pending.del(key);
  }
  bettors() {
    return [...this.players.values()].filter((p) => p.bet > 0);
  }

  // ------------------------------------------------------------------ vue publique
  snapshot() {
    const all = [...this.players.values()].map((p) => ({
      uid: p.uid, name: p.name, avatar: p.avatar, bal: p.bal,
      online: p.online !== false, bet: p.bet, rank: p.rank,
      net: p.net, win: p.win, rocket: p.rocket,
    }));
    const racers = all.filter((p) => p.bet > 0).sort((a, b) => b.bet - a.bet);
    const watchers = all.filter((p) => p.bet <= 0);
    return {
      now: Date.now(),
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      track: this.track,
      result: this.result,
      history: this.history,
      players: racers.concat(watchers.slice(0, MAX_SPECTATORS_SENT)),
      racers: racers.length,
      present: all.length,
      pot: floor2(racers.reduce((a, p) => a + p.bet, 0)),
      min: MIN_BET,
      max: MAX_BET,
      feed: this.feed,
    };
  }

  // ------------------------------------------------------------------ présence
  join(user, bal) {
    let p = this.players.get(user.uid);
    if (p) {
      p.leaving = false;
      p.online = true;
      p.bal = bal;
      p.name = user.name;
      p.avatar = user.avatar;
    } else {
      p = { uid: user.uid, name: user.name, avatar: user.avatar, bal, bet: 0, staked: 0,
        online: true, net: null, win: null, rank: null, rocket: null, leaving: false };
      this.players.set(user.uid, p);
      this.say(`${user.name} rejoint la course`);
    }
    this.emit();
  }

  async leave(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    if (this.phase === 'betting') {
      await this.refundAll(p);
      this.players.delete(uid);
      this.say(`${p.name} quitte la course`);
      if (!this.bettors().length) this.clearTimer();
    } else if (p.bet > 0) {
      p.leaving = true; // sa fusée reste en course, il sera payé puis retiré
    } else {
      this.players.delete(uid);
    }
    this.emit();
  }

  setPresence(uid, online) {
    const p = this.players.get(uid);
    if (!p || p.online === online) return;
    p.online = online;
    this.emit();
    if (!online) {
      setTimeout(() => {
        this.run(async () => {
          const q = this.players.get(uid);
          if (!q || q.online !== false) return;
          if (this.phase === 'betting') {
            await this.refundAll(q);
            this.players.delete(uid);
            if (!this.bettors().length) this.clearTimer();
            this.emit();
          } else if (q.bet <= 0) {
            this.players.delete(uid);
            this.emit();
          }
        }).catch(() => {});
      }, OFFLINE_GRACE_MS);
    }
  }

  async refundAll(p) {
    if (p.bet > 0) {
      p.bal = await this.deps.credit(p.uid, p.bet);
      await this.setStaked(p, -p.bet);
      p.bet = 0;
      p.rank = null;
    }
  }

  // ------------------------------------------------------------------ mises
  async bet(uid, amount) {
    if (this.phase !== 'betting') throw new Error('Les mises sont fermées, la course est lancée !');
    const p = this.players.get(uid);
    if (!p) throw new Error('Rejoins d’abord la course.');
    const a = floor2(Number(amount));
    if (!Number.isFinite(a) || a <= 0) throw new Error('Montant invalide.');
    if (a < MIN_BET) throw new Error(`Mise minimale : ${MIN_BET}.`);
    if (floor2(p.bet + a) > MAX_BET) throw new Error(`Mise maximale : ${MAX_BET}.`);
    const nb = await this.deps.debit(uid, a);
    if (nb === null) throw new Error('Solde insuffisant.');
    p.bal = nb;
    p.bet = floor2(p.bet + a);
    await this.setStaked(p, a);
    this.afterBet();
  }

  async clear(uid) {
    if (this.phase !== 'betting') throw new Error('Les mises sont fermées.');
    const p = this.players.get(uid);
    if (!p) return;
    await this.refundAll(p);
    if (!this.bettors().length) this.clearTimer();
    this.emit();
  }

  afterBet() {
    if (this.phase === 'betting' && !this.deadline) this.setTimer(BET_TIME_MS, () => this.startRace());
    this.emit();
  }

  /** le premier joueur peut lancer plus tôt (minimum 2 partants) */
  async go(uid) {
    if (this.phase !== 'betting') throw new Error('La course est déjà lancée.');
    if (!this.players.has(uid)) throw new Error('Rejoins d’abord la course.');
    if (this.bettors().length < 2) throw new Error('Il faut au moins 2 partants.');
    await this.startRace();
  }

  // ------------------------------------------------------------------ la course
  async startRace() {
    if (this.phase !== 'betting') return;
    let partants = this.bettors();
    if (partants.length < 2) {
      // un seul partant : on rembourse et on attend les autres (pas de gain garanti)
      for (const p of partants) await this.refundAll(p);
      this.clearTimer();
      this.say('Il faut au moins 2 partants — mises remboursées.');
      this.emit();
      return;
    }
    this.clearTimer();
    this.round++;
    // Tirage des temps d'arrivée : le plus petit fait le tour le premier et gagne.
    const times = partants.map(() => Math.round(rnd(RACE_MS * 0.62, RACE_MS * 0.98)));
    const order = partants.map((_, i) => i).sort((a, b) => times[a] - times[b]);
    const now = Date.now();
    // Chaque fusée a une trajectoire déterministe rejouée à l'identique par tous les clients
    // (voir rocketPos dans index.html). Le rayon diffère légèrement pour éviter les collisions.
    const lanes = partants.map((p, i) => {
      const rk = ROCKETS[i % ROCKETS.length];
      return {
        uid: p.uid,
        name: p.name,
        avatar: p.avatar || null,
        color: rk.color,
        glow: rk.glow,
        rocketKey: rk.key,
        finishMs: times[i],
        orbit: floor2(rnd(0.82, 1.12)),   // rayon de l'orbite (variation visuelle)
        phase: floor2(rnd(0, Math.PI * 2)), // phase de départ (étoiles / oscillation)
        wobble: floor2(rnd(0.4, 1.1)),
      };
    });
    const ranking = order.map((i) => lanes[i].uid);
    this.track = { t0: now + LEAD_MS, dur: RACE_MS, lanes, ranking };
    this.result = null;
    for (const p of this.players.values()) {
      p.net = null;
      p.win = null;
      p.rank = null;
    }
    this.phase = 'countdown';
    this.say('🚀 Prêts… 3… 2… 1… PARTEZ !');
    this.emit();
    // passe en "racing" après le décompte, puis règle à la fin du tour
    this.timer = setTimeout(() => this.run(() => {
      if (this.phase !== 'countdown') return;
      this.phase = 'racing';
      this.emit();
      this.timer = setTimeout(() => this.run(() => this.settle()).catch((e) => console.error('[rocket] settle', e)), RACE_MS + 300);
    }).catch((e) => console.error('[rocket] go', e)), LEAD_MS);
  }

  async settle() {
    if (this.phase !== 'racing' || !this.track) return;
    const ranking = this.track.ranking;
    const byUid = new Map(this.players.values().map((p) => [p.uid, p]));
    const recapPlayers = [];
    // Le POT est redistribué au classement : la maison prélève HOUSE_EDGE,
    // le reste est réparti selon sharesFor(rang), quelles que soient les mises.
    const pot = floor2(ranking.reduce((a, uid) => a + (byUid.get(uid)?.bet || 0), 0));
    const spendable = floor2(pot * (1 - HOUSE_EDGE));
    const shares = sharesFor(ranking.length);
    const wins = ranking.map((_, i) => floor2(spendable * shares[i]));
    const multipliers = ranking.map((_, i) => {
      const stake = byUid.get(ranking[i])?.bet || 0;
      return stake > 0 ? floor2(wins[i] / stake) : 0;
    });
    for (let i = 0; i < ranking.length; i++) {
      const uid = ranking[i];
      const p = byUid.get(uid);
      if (!p) continue;
      const stake = p.bet;
      const win = wins[i];
      let paid = true;
      if (win > 0) {
        try { p.bal = await this.deps.credit(p.uid, win); }
        catch (e) { paid = false; console.error('[rocket] credit KO', p.uid, win, e?.message || e); }
      }
      if (paid) await this.setStaked(p, -p.staked);
      p.win = win;
      p.net = floor2(win - stake);
      p.rank = i + 1;
      recapPlayers.push({ uid: p.uid, name: p.name, bet: stake, win, net: p.net, mult: multipliers[i], rank: i + 1, detail: `arrivé n°${i + 1}/${ranking.length}` });
      this.say(`🏁 ${p.name} arrivé n°${i + 1} · ${p.net >= 0 ? '+' : ''}${p.net}`);
    }
    this.result = { ranking, multipliers, pot };
    this.history.unshift(ranking[0]);
    if (this.history.length > 12) this.history.pop();
    this.phase = 'result';
    this.setTimer(RESULT_MS, () => this.newRound());
    this.emit();
    try {
      if (recapPlayers.length && this.deps.onRoundEnd) this.deps.onRoundEnd({ game: 'rocket', round: this.round, ranking, players: recapPlayers });
    } catch (e) { console.error('[rocket] recap', e?.message || e); }
  }

  async newRound() {
    for (const [uid, p] of [...this.players]) {
      p.bet = 0;
      p.net = null;
      p.win = null;
      p.rank = null;
      p.rocket = null;
      if (p.leaving || p.online === false) this.players.delete(uid);
    }
    this.phase = 'betting';
    this.result = null;
    this.track = null;
    this.clearTimer();
    this.emit();
  }
}

module.exports = { RocketRaceRoom, INFO, MIN_BET, MAX_BET, ROCKETS, sharesFor, multFor };
