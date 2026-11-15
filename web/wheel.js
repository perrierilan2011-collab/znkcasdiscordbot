'use strict';
/*
 * web/wheel.js — ROUE DE LA FORTUNE multijoueur (côté serveur, c'est lui qui fait foi).
 *
 * Une seule roue par serveur Discord, partagée par TOUS les joueurs connectés (aucune limite de joueurs).
 * Chacun mise sur une ou plusieurs zones ; tout le monde voit en direct qui joue et qui a misé quoi.
 *
 * La roue : 50 cases, 4 zones — x2 (24 cases) · x3 (16 cases) · x6 (8 cases) · x24 (2 cases).
 *   Chaque zone rapporte 96 % de la mise en moyenne (avantage maison 4 %, identique quelle que soit la zone).
 * Cycle : mises ouvertes (WHEEL_BET_SECONDS, défaut 20 s, démarre à la 1re mise) → la roue tourne (même animation,
 *   au même moment, chez tout le monde) → résultats et paiements → nouvelle manche.
 * Argent : débité à la mise, crédité au résultat (deps.debit / deps.credit). Si le bot plante en pleine manche,
 *   les mises sont remboursées au redémarrage (deps.pending).
 */
const { randomInt } = require('crypto');

const TAU = Math.PI * 2;
const N = 50;
const ZONES = [2, 3, 6, 24];
const COUNTS = { 2: 24, 3: 16, 6: 8, 24: 2 };
const SEG = TAU / N;

const MIN_BET = Math.max(0.01, Number(process.env.WHEEL_MIN_BET) || Number(process.env.BJ_MIN_BET) || 1);
const MAX_BET = Math.max(MIN_BET, Number(process.env.WHEEL_MAX_BET) || 100_000_000); // par zone et par joueur
const BET_TIME_MS = Math.max(8, Number(process.env.WHEEL_BET_SECONDS) || 20) * 1000;
const LEAD_MS = 450; // délai entre l'annonce du tour et son départ (laisse le temps à tous les clients de recevoir l'ordre)
const SPIN_MS = 8500;
const RESULT_MS = 7000;
const OFFLINE_GRACE_MS = 8000;
const MAX_SPECTATORS_SENT = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const mod = (a, m) => ((a % m) + m) % m;

/** Dispose les 50 cases : x24 aux deux pôles, x6 régulièrement espacés, x3 intercalés, x2 pour le reste. */
function buildWheel() {
  const w = Array(N).fill(2);
  w[0] = 24;
  w[25] = 24;
  for (let j = 0; j < 8; j++) w[3 + 6 * j] = 6;
  const rest = [];
  for (let i = 0; i < N; i++) if (w[i] === 2) rest.push(i);
  for (let j = 0; j < COUNTS[3]; j++) w[rest[Math.floor(((j + 0.5) * rest.length) / COUNTS[3])]] = 3;
  for (const m of ZONES) if (w.filter((x) => x === m).length !== COUNTS[m]) throw new Error('roue mal construite');
  return w;
}
const WHEEL = buildWheel();
const INFO = { segs: WHEEL, zones: ZONES.map((m) => ({ m, n: COUNTS[m] })), min: MIN_BET, max: MAX_BET };

const emptyBets = () => ({ 2: 0, 3: 0, 6: 0, 24: 0 });
const totalOf = (b) => floor2(ZONES.reduce((a, m) => a + (b[m] || 0), 0));

class WheelRoom {
  /** deps : { getBalance, debit(uid, amt) -> newBal|null, credit(uid, amt) -> newBal, pending:{set,del}, onChange(room) } */
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.players = new Map(); // uid -> joueur présent à la roue
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
        console.error('[wheel] emit', e?.message || e);
      }
    }, 80);
  }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.run(fn).catch((e) => console.error('[wheel] timer', e)), ms);
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
  }
  async setStaked(p, delta) {
    p.staked = floor2((p.staked || 0) + delta);
    const key = `wheel-${this.guildId}:${p.uid}`;
    if (p.staked > 0) this.deps.pending.set(key, p.staked);
    else this.deps.pending.del(key);
  }
  anyBet() {
    for (const p of this.players.values()) if (totalOf(p.bets) > 0) return true;
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
    const zones = ZONES.map((m) => {
      let total = 0;
      let count = 0;
      for (const p of all) if (p.bets[m] > 0) { total += p.bets[m]; count++; }
      return { m, total: floor2(total), count };
    });
    return {
      now: Date.now(),
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      rot: this.rot,
      spin: this.spin,
      result: this.result,
      history: this.history,
      zones,
      pot: floor2(zones.reduce((a, z) => a + z.total, 0)),
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
      p = { uid: user.uid, name: user.name, avatar: user.avatar, bal, bets: emptyBets(), lastBets: null, staked: 0, online: true, net: null, win: null };
      this.players.set(user.uid, p);
      this.say(`🎡 ${user.name} rejoint la roue`);
    }
    this.emit();
  }

  async leave(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    if (this.phase === 'betting') {
      await this.refundAll(p);
      this.players.delete(uid);
      this.say(`🚪 ${p.name} quitte la roue`);
      if (!this.anyBet()) this.clearTimer();
    } else if (totalOf(p.bets) > 0) {
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
          } else if (totalOf(q.bets) <= 0) {
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
      p.bets = emptyBets();
    }
  }

  // ------------------------------------------------------------------ mises
  /** ajoute `amount` sur la zone `zone` (x2 / x3 / x6 / x24) */
  async bet(uid, zone, amount) {
    if (this.phase !== 'betting') throw new Error('Les mises sont fermées, la roue tourne !');
    const p = this.players.get(uid);
    if (!p) throw new Error('Rejoins d’abord la roue.');
    zone = Number(zone);
    if (!ZONES.includes(zone)) throw new Error('Zone invalide.');
    const a = floor2(Number(amount));
    if (!Number.isFinite(a) || a <= 0) throw new Error('Montant invalide.');
    if (a < MIN_BET) throw new Error(`Mise minimale : ${MIN_BET}.`);
    if (floor2(p.bets[zone] + a) > MAX_BET) throw new Error(`Mise maximale par zone : ${MAX_BET}.`);
    const nb = await this.deps.debit(uid, a);
    if (nb === null) throw new Error('Solde insuffisant.');
    p.bal = nb;
    p.bets[zone] = floor2(p.bets[zone] + a);
    await this.setStaked(p, a);
    this.afterBet();
  }

  /** rejoue exactement les mises de la manche précédente */
  async rebet(uid) {
    if (this.phase !== 'betting') throw new Error('Les mises sont fermées, la roue tourne !');
    const p = this.players.get(uid);
    if (!p) throw new Error('Rejoins d’abord la roue.');
    if (!p.lastBets || totalOf(p.lastBets) <= 0) throw new Error('Pas de mise précédente à rejouer.');
    const add = totalOf(p.lastBets);
    for (const m of ZONES) if (floor2(p.bets[m] + p.lastBets[m]) > MAX_BET) throw new Error(`Mise maximale par zone : ${MAX_BET}.`);
    const nb = await this.deps.debit(uid, add);
    if (nb === null) throw new Error('Solde insuffisant pour rejouer ces mises.');
    p.bal = nb;
    for (const m of ZONES) p.bets[m] = floor2(p.bets[m] + p.lastBets[m]);
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
      if (totalOf(p.bets) > 0) p.lastBets = { ...p.bets };
    }
    this.phase = 'spinning';
    this.say('🎡 Plus rien ne va ! La roue tourne…');
    this.emit();
    this.timer = setTimeout(() => this.run(() => this.settle()).catch((e) => console.error('[wheel] settle', e)), LEAD_MS + SPIN_MS + 250);
  }

  async settle() {
    if (this.phase !== 'spinning' || !this.spin) return;
    const idx = this.spin.idx;
    const m = WHEEL[idx];
    this.rot = mod(this.spin.to, TAU);
    this.spin = { ...this.spin, from: this.rot, to: this.rot };
    this.result = { idx, m };
    this.history.unshift(m);
    if (this.history.length > 24) this.history.pop();
    this.say(`🏁 La roue s'arrête sur x${m}`);
    let big = null;
    for (const p of this.players.values()) {
      const stake = totalOf(p.bets);
      if (stake <= 0) continue;
      const back = floor2(p.bets[m] * m);
      let paid = true;
      if (back > 0) {
        try {
          p.bal = await this.deps.credit(p.uid, back);
        } catch (e) {
          paid = false;
          console.error('[wheel] credit KO', p.uid, back, e?.message || e);
        }
      }
      if (paid) await this.setStaked(p, -p.staked);
      p.win = back;
      p.net = floor2(back - stake);
      if (p.net > 0) {
        this.say(`🏆 ${p.name} gagne ${p.net}`);
        if (!big || p.net > big.net) big = p;
      } else if (p.net < 0) this.say(`💸 ${p.name} perd ${-p.net}`);
      else this.say(`🤝 ${p.name} récupère sa mise`);
    }
    this.phase = 'result';
    this.setTimer(RESULT_MS, () => this.newRound());
    this.emit();
  }

  async newRound() {
    for (const [uid, p] of [...this.players]) {
      p.bets = emptyBets();
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

module.exports = { WheelRoom, WHEEL, INFO, ZONES, MIN_BET, MAX_BET };
