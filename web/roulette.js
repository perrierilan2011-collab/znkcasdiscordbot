'use strict';
/*
 * web/roulette.js — ROULETTE EUROPÉENNE multijoueur (côté serveur, c'est lui qui fait foi).
 *
 * Une seule roulette par serveur Discord, partagée par TOUS les joueurs connectés (aucune limite de joueurs).
 * Chacun mise sur ce qu'il veut (plusieurs mises possibles) ; tout le monde voit en direct qui joue et qui a misé quoi.
 *
 * 37 cases (0 à 36), un seul zéro → avantage maison 2,7 %.
 * Mises (clé → gain, mise comprise) :
 *   nX (plein, X = 0..36) x36 · red / black x2 · even / odd x2 · low (1-18) / high (19-36) x2
 *   d1 / d2 / d3 (douzaines) x3 · c1 / c2 / c3 (colonnes) x3
 *   Le 0 fait perdre toutes les mises extérieures (sauf le plein au 0).
 * Cycle : mises ouvertes (ROULETTE_BET_SECONDS, défaut 20 s, démarre à la 1re mise) → la roue tourne (même animation,
 *   au même moment, chez tout le monde) → résultats et paiements → nouvelle manche.
 * Argent : débité à la mise, crédité au résultat (deps.debit / deps.credit). Si le bot plante en pleine manche,
 *   les mises sont remboursées au redémarrage (deps.pending).
 */
const { randomInt } = require('crypto');

const TAU = Math.PI * 2;
// Ordre réel des numéros sur une roulette européenne
const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const N = ORDER.length; // 37
const SEG = TAU / N;
const REDS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const REDSET = new Set(REDS);

const env = (k, ...alts) => {
  for (const key of [k, ...alts]) {
    const v = Number(process.env[key]);
    if (v) return v;
  }
  return 0;
};
const MIN_BET = Math.max(0.01, env('ROULETTE_MIN_BET', 'WHEEL_MIN_BET', 'BJ_MIN_BET') || 1);
const MAX_BET = Math.max(MIN_BET, env('ROULETTE_MAX_BET', 'WHEEL_MAX_BET') || 100_000_000); // par mise et par joueur
const BET_TIME_MS = Math.max(8, env('ROULETTE_BET_SECONDS', 'WHEEL_BET_SECONDS') || 20) * 1000;
const LEAD_MS = 450; // délai entre l'annonce du tour et son départ (laisse le temps à tous les clients de recevoir l'ordre)
const SPIN_MS = 8500;
const RESULT_MS = 7000;
const OFFLINE_GRACE_MS = 8000;
const MAX_SPECTATORS_SENT = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // eslint-disable-line no-unused-vars
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const mod = (a, m) => ((a % m) + m) % m;

/** Toutes les mises possibles : clé → { mult (mise comprise), test(numéro) } */
const SPOTS = {};
for (let n = 0; n <= 36; n++) SPOTS['n' + n] = { mult: 36, test: (x) => x === n };
SPOTS.red = { mult: 2, test: (x) => REDSET.has(x) };
SPOTS.black = { mult: 2, test: (x) => x > 0 && !REDSET.has(x) };
SPOTS.even = { mult: 2, test: (x) => x > 0 && x % 2 === 0 };
SPOTS.odd = { mult: 2, test: (x) => x % 2 === 1 };
SPOTS.low = { mult: 2, test: (x) => x >= 1 && x <= 18 };
SPOTS.high = { mult: 2, test: (x) => x >= 19 };
SPOTS.d1 = { mult: 3, test: (x) => x >= 1 && x <= 12 };
SPOTS.d2 = { mult: 3, test: (x) => x >= 13 && x <= 24 };
SPOTS.d3 = { mult: 3, test: (x) => x >= 25 };
SPOTS.c1 = { mult: 3, test: (x) => x > 0 && x % 3 === 1 };
SPOTS.c2 = { mult: 3, test: (x) => x > 0 && x % 3 === 2 };
SPOTS.c3 = { mult: 3, test: (x) => x > 0 && x % 3 === 0 };

const INFO = { order: ORDER, reds: REDS, min: MIN_BET, max: MAX_BET };

const totalOf = (b) => floor2(Object.values(b).reduce((a, v) => a + (v || 0), 0));
const hasBets = (b) => totalOf(b) > 0;

class RouletteRoom {
  /** deps : { getBalance, debit(uid, amt) -> newBal|null, credit(uid, amt) -> newBal, pending:{set,del}, onChange(room) } */
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.players = new Map(); // uid -> joueur présent à la table
    this.phase = 'betting'; // betting | spinning | result
    this.deadline = 0;
    this.round = 0;
    this.rot = 0; // angle de repos de la roue (rad)
    this.spin = null;
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
  /** diffusion groupée (beaucoup de joueurs qui misent en même temps = un seul envoi toutes les ~80 ms) */
  emit() {
    if (this.emitT) return;
    this.emitT = setTimeout(() => {
      this.emitT = null;
      try {
        this.deps.onChange(this);
      } catch (e) {
        console.error('[roulette] emit', e?.message || e);
      }
    }, 80);
  }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.run(fn).catch((e) => console.error('[roulette] timer', e)), ms);
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
  }
  async setStaked(p, delta) {
    p.staked = floor2((p.staked || 0) + delta);
    const key = `roulette-${this.guildId}:${p.uid}`;
    if (p.staked > 0) this.deps.pending.set(key, p.staked);
    else this.deps.pending.del(key);
  }
  anyBet() {
    for (const p of this.players.values()) if (hasBets(p.bets)) return true;
    return false;
  }

  // ------------------------------------------------------------------ vue publique
  snapshot() {
    const all = [...this.players.values()].map((p) => ({
      uid: p.uid,
      name: p.name,
      avatar: p.avatar,
      bal: p.bal,
      online: p.online !== false,
      bets: { ...p.bets },
      total: totalOf(p.bets),
      net: p.net,
      win: p.win,
    }));
    const bettors = all.filter((p) => p.total > 0).sort((a, b) => b.total - a.total);
    const watchers = all.filter((p) => p.total <= 0);
    const spots = {};
    for (const p of all) {
      for (const [k, v] of Object.entries(p.bets)) {
        if (!(v > 0)) continue;
        const s = spots[k] || (spots[k] = { total: 0, count: 0 });
        s.total = floor2(s.total + v);
        s.count++;
      }
    }
    return {
      now: Date.now(),
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      rot: this.rot,
      spin: this.spin,
      result: this.result,
      history: this.history,
      spots,
      pot: floor2(Object.values(spots).reduce((a, s) => a + s.total, 0)),
      players: bettors.concat(watchers.slice(0, MAX_SPECTATORS_SENT)),
      present: all.length,
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
      p = { uid: user.uid, name: user.name, avatar: user.avatar, bal, bets: {}, lastBets: null, staked: 0, online: true, net: null, win: null };
      this.players.set(user.uid, p);
      this.say(`${user.name} rejoint la table`);
    }
    this.emit();
  }

  async leave(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    if (this.phase === 'betting') {
      await this.refundAll(p);
      this.players.delete(uid);
      this.say(`${p.name} quitte la table`);
      if (!this.anyBet()) this.clearTimer();
    } else if (hasBets(p.bets)) {
      p.leaving = true; // ses mises restent en jeu, il part à la fin de la manche
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
            if (!this.anyBet()) this.clearTimer();
            this.emit();
          } else if (!hasBets(q.bets)) {
            this.players.delete(uid);
            this.emit();
          } // sinon : mises en jeu, il sera retiré à la fin de la manche (et payé s'il gagne)
        }).catch(() => {});
      }, OFFLINE_GRACE_MS);
    }
  }

  async refundAll(p) {
    const t = totalOf(p.bets);
    if (t > 0) {
      p.bal = await this.deps.credit(p.uid, t);
      await this.setStaked(p, -t);
      p.bets = {};
    }
  }

  // ------------------------------------------------------------------ mises
  /** ajoute `amount` sur la mise `spot` (ex. 'red', 'd2', 'n17') */
  async bet(uid, spot, amount) {
    if (this.phase !== 'betting') throw new Error('Les mises sont fermées, la roue tourne !');
    const p = this.players.get(uid);
    if (!p) throw new Error('Rejoins d’abord la table.');
    spot = String(spot);
    if (!Object.prototype.hasOwnProperty.call(SPOTS, spot)) throw new Error('Mise invalide.');
    const a = floor2(Number(amount));
    if (!Number.isFinite(a) || a <= 0) throw new Error('Montant invalide.');
    if (a < MIN_BET) throw new Error(`Mise minimale : ${MIN_BET}.`);
    if (floor2((p.bets[spot] || 0) + a) > MAX_BET) throw new Error(`Mise maximale par case : ${MAX_BET}.`);
    const nb = await this.deps.debit(uid, a);
    if (nb === null) throw new Error('Solde insuffisant.');
    p.bal = nb;
    p.bets[spot] = floor2((p.bets[spot] || 0) + a);
    await this.setStaked(p, a);
    this.afterBet();
  }

  /** rejoue exactement les mises de la manche précédente */
  async rebet(uid) {
    if (this.phase !== 'betting') throw new Error('Les mises sont fermées, la roue tourne !');
    const p = this.players.get(uid);
    if (!p) throw new Error('Rejoins d’abord la table.');
    if (!p.lastBets || totalOf(p.lastBets) <= 0) throw new Error('Pas de mise précédente à rejouer.');
    const add = totalOf(p.lastBets);
    for (const [k, v] of Object.entries(p.lastBets)) if (floor2((p.bets[k] || 0) + v) > MAX_BET) throw new Error(`Mise maximale par case : ${MAX_BET}.`);
    const nb = await this.deps.debit(uid, add);
    if (nb === null) throw new Error('Solde insuffisant pour rejouer ces mises.');
    p.bal = nb;
    for (const [k, v] of Object.entries(p.lastBets)) p.bets[k] = floor2((p.bets[k] || 0) + v);
    await this.setStaked(p, add);
    this.afterBet();
  }

  async clear(uid) {
    if (this.phase !== 'betting') throw new Error('Les mises sont fermées.');
    const p = this.players.get(uid);
    if (!p) return;
    await this.refundAll(p);
    if (!this.anyBet()) this.clearTimer();
    this.emit();
  }

  afterBet() {
    if (this.phase === 'betting' && !this.deadline) this.setTimer(BET_TIME_MS, () => this.startSpin());
    this.emit();
  }

  // ------------------------------------------------------------------ tour de roue
  async startSpin() {
    if (this.phase !== 'betting') return;
    if (!this.anyBet()) {
      this.clearTimer();
      this.emit();
      return;
    }
    this.clearTimer();
    this.round++;
    const idx = randomInt(N);
    // la case gagnante s'arrête sous le pointeur (en haut), légèrement décalée dans la case pour le réalisme
    const jitter = (randomInt(1000) / 1000 - 0.5) * 0.7 * SEG;
    const from = this.rot;
    const turns = 6 + randomInt(3);
    const aim = mod(jitter - idx * SEG - from, TAU);
    const to = from + turns * TAU + aim;
    const start = Date.now() + LEAD_MS;
    this.spin = { start, dur: SPIN_MS, from, to, idx };
    this.result = null;
    for (const p of this.players.values()) {
      p.net = null;
      p.win = null;
      if (hasBets(p.bets)) p.lastBets = { ...p.bets };
    }
    this.phase = 'spinning';
    this.say('Rien ne va plus !');
    this.emit();
    this.timer = setTimeout(() => this.run(() => this.settle()).catch((e) => console.error('[roulette] settle', e)), LEAD_MS + SPIN_MS + 250);
  }

  async settle() {
    if (this.phase !== 'spinning' || !this.spin) return;
    const idx = this.spin.idx;
    const n = ORDER[idx];
    this.rot = mod(this.spin.to, TAU);
    this.spin = { ...this.spin, from: this.rot, to: this.rot };
    this.result = { idx, n };
    this.history.unshift(n);
    if (this.history.length > 24) this.history.pop();
    this.say(`La bille s'arrête sur le ${n}`);
    for (const p of this.players.values()) {
      const stake = totalOf(p.bets);
      if (stake <= 0) continue;
      let back = 0;
      for (const [k, v] of Object.entries(p.bets)) {
        const s = SPOTS[k];
        if (s && s.test(n)) back += v * s.mult;
      }
      back = floor2(back);
      let paid = true;
      if (back > 0) {
        try {
          p.bal = await this.deps.credit(p.uid, back);
        } catch (e) {
          paid = false;
          console.error('[roulette] credit KO', p.uid, back, e?.message || e);
        }
      }
      if (paid) await this.setStaked(p, -p.staked);
      p.win = back;
      p.net = floor2(back - stake);
      if (p.net > 0) this.say(`${p.name} gagne ${p.net}`);
      else if (p.net < 0) this.say(`${p.name} perd ${-p.net}`);
      else this.say(`${p.name} récupère sa mise`);
    }
    this.phase = 'result';
    this.setTimer(RESULT_MS, () => this.newRound());
    this.emit();
  }

  async newRound() {
    for (const [uid, p] of [...this.players]) {
      p.bets = {};
      p.net = null;
      p.win = null;
      if (p.leaving || p.online === false) this.players.delete(uid);
    }
    this.phase = 'betting';
    this.spin = null;
    this.result = null;
    this.clearTimer();
    this.emit();
  }
}

module.exports = { RouletteRoom, INFO, SPOTS, ORDER, MIN_BET, MAX_BET };
