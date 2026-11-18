'use strict';
/*
 * web/penalty.js — 1v1 PENALTY SHOOTOUT (server-authoritative).
 * Each player shoots once and keeps once per round.
 * 1 point for a goal (as shooter) or a save (as keeper).
 * First to lead by 2 points wins. Ties continue with extra rounds.
 */
const { randomInt } = require('crypto');
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const MIN_BET = Math.max(0.01, Number(process.env.PENALTY_MIN_BET) || Number(process.env.BJ_MIN_BET) || 1);
const MAX_BET = Math.max(MIN_BET, Number(process.env.PENALTY_MAX_BET) || 100_000_000);
const PICK_MS = 12_000;
const ANIM_MS = 2_800;
const RESULT_MS = 3_500;
const DIRS = ['left', 'center', 'right'];

const INFO = { min: MIN_BET, max: MAX_BET, dirs: DIRS };

class PenaltyRoom {
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.seats = [null, null]; // 0 and 1
    this.phase = 'lobby'; // lobby | betting | pick_shot | pick_save | anim | round_result | match_end
    this.deadline = 0;
    this.round = 0;
    this.scores = [0, 0];
    this.shotDir = null;
    this.saveDir = null;
    this.goal = null;
    this.shooter = 0; // seat index shooting this half
    this.half = 0; // 0 first shooter of round, 1 second
    this.pot = 0;
    this.feed = [];
    this.timer = null;
    this.q = Promise.resolve();
    this.lastAnim = null;
  }
  run(fn) { const p = this.q.then(fn, fn); this.q = p.catch(() => {}); return p; }
  say(t) { this.feed.push({ t: Date.now(), text: t }); if (this.feed.length > 10) this.feed.shift(); }
  emit() { try { this.deps.onChange(this); } catch (e) { console.error('[penalty] emit', e?.message || e); } }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.run(fn).catch((e) => console.error('[penalty] timer', e)), ms);
  }
  clearTimer() { clearTimeout(this.timer); this.timer = null; this.deadline = 0; }
  key(p) { return `penalty-${this.guildId}:${p.uid}`; }
  syncPending(p) {
    const v = floor2(p.staked || 0);
    if (v > 0) this.deps.pending.set(this.key(p), v);
    else this.deps.pending.del(this.key(p));
  }
  snapshot(uid) {
    return {
      now: Date.now(),
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      scores: [...this.scores],
      shooter: this.shooter,
      half: this.half,
      pot: this.pot,
      min: MIN_BET,
      max: MAX_BET,
      shotDir: this.phase === 'anim' || this.phase === 'round_result' || this.phase === 'match_end' ? this.shotDir : null,
      saveDir: this.phase === 'anim' || this.phase === 'round_result' || this.phase === 'match_end' ? this.saveDir : null,
      goal: this.goal,
      anim: this.lastAnim,
      seats: this.seats.map((p) => p ? {
        uid: p.uid, name: p.name, avatar: p.avatar, bal: p.bal,
        online: p.online !== false, bet: p.bet, ready: !!p.ready,
        pick: (p.uid === uid && p.pick) ? p.pick : (this.phase === 'anim' || this.phase === 'round_result' || this.phase === 'match_end' ? p.pick : null),
      } : null),
      feed: this.feed,
      winner: this.winner || null,
    };
  }
  async join(user, bal, seat) {
    if (this.phase !== 'lobby' && this.phase !== 'betting') throw new Error('Match in progress.');
    const idx = this.seats.findIndex((p) => p && p.uid === user.uid);
    if (idx >= 0) {
      this.seats[idx].online = true; this.seats[idx].bal = bal; this.seats[idx].name = user.name;
      this.emit(); return;
    }
    let s = Number(seat);
    if (!Number.isInteger(s) || s < 0 || s > 1 || this.seats[s]) {
      s = this.seats[0] ? (this.seats[1] ? -1 : 1) : 0;
    }
    if (s < 0) throw new Error('Table full (1v1).');
    this.seats[s] = {
      uid: user.uid, name: user.name, avatar: user.avatar, bal,
      bet: 0, staked: 0, ready: false, pick: null, online: true,
    };
    this.say(`${user.name} joins seat ${s + 1}`);
    this.emit();
  }
  async leave(uid) {
    const i = this.seats.findIndex((p) => p && p.uid === uid);
    if (i < 0) return;
    const p = this.seats[i];
    if (this.phase === 'lobby' || this.phase === 'betting') {
      if (p.bet > 0) {
        p.bal = await this.deps.credit(p.uid, p.bet);
        p.staked = 0; this.syncPending(p);
      }
      this.seats[i] = null;
      this.say(`${p.name} leaves`);
      this.phase = 'lobby';
      this.clearTimer();
    } else {
      // forfeit
      p.online = false;
      const other = 1 - i;
      if (this.seats[other]) {
        this.scores[other] = Math.max(this.scores[other], this.scores[i] + 2);
        await this.finishMatch(other);
        return;
      }
    }
    this.emit();
  }
  async bet(uid, amount) {
    if (this.phase !== 'lobby' && this.phase !== 'betting') throw new Error('Betting closed.');
    this.phase = 'betting';
    const i = this.seats.findIndex((p) => p && p.uid === uid);
    if (i < 0) throw new Error('Join a seat first.');
    const p = this.seats[i];
    const a = floor2(Number(amount));
    if (!Number.isFinite(a) || a < MIN_BET) throw new Error(`Min bet ${MIN_BET}.`);
    if (a > MAX_BET) throw new Error(`Max bet ${MAX_BET}.`);
    const diff = floor2(a - p.bet);
    if (diff > 0) {
      const nb = await this.deps.debit(uid, diff);
      if (nb === null) throw new Error('Insufficient balance.');
      p.bal = nb; p.staked = floor2((p.staked || 0) + diff); this.syncPending(p);
    } else if (diff < 0) {
      p.bal = await this.deps.credit(uid, -diff);
      p.staked = floor2((p.staked || 0) + diff); this.syncPending(p);
    }
    p.bet = a; p.ready = false;
    this.emit();
  }
  async ready(uid) {
    if (this.phase !== 'betting' && this.phase !== 'lobby') throw new Error('Not in betting.');
    const i = this.seats.findIndex((p) => p && p.uid === uid);
    if (i < 0) throw new Error('Join first.');
    const p = this.seats[i];
    if (!(p.bet >= MIN_BET)) throw new Error('Place a bet first.');
    p.ready = true;
    this.emit();
    if (this.seats[0] && this.seats[1] && this.seats[0].ready && this.seats[1].ready && this.seats[0].bet === this.seats[1].bet) {
      await this.startMatch();
    } else if (this.seats[0] && this.seats[1] && this.seats[0].ready && this.seats[1].ready && this.seats[0].bet !== this.seats[1].bet) {
      this.say('Bets must match to start.');
      this.seats[0].ready = false; this.seats[1].ready = false;
      this.emit();
    }
  }
  async startMatch() {
    this.pot = floor2(this.seats[0].bet + this.seats[1].bet);
    this.scores = [0, 0];
    this.round = 0;
    this.winner = null;
    this.shooter = randomInt(2);
    this.say('Match starts — first to lead by 2 wins');
    await this.nextKick();
  }
  async nextKick() {
    this.clearTimer();
    if (this.half === 0) this.round++;
    const sh = this.shooter;
    const kp = 1 - sh;
    this.shotDir = null; this.saveDir = null; this.goal = null;
    this.lastAnim = null;
    if (this.seats[sh]) this.seats[sh].pick = null;
    if (this.seats[kp]) this.seats[kp].pick = null;
    this.phase = 'pick_shot';
    this.say(`${this.seats[sh].name} shoots`);
    this.setTimer(PICK_MS, () => this.autoPick('shot'));
    this.emit();
  }
  async autoPick(kind) {
    const sh = this.shooter;
    const kp = 1 - sh;
    if (kind === 'shot') {
      if (this.seats[sh] && !this.seats[sh].pick) this.seats[sh].pick = DIRS[randomInt(3)];
      this.phase = 'pick_save';
      this.say(`${this.seats[kp].name} dives`);
      this.setTimer(PICK_MS, () => this.autoPick('save'));
      this.emit();
    } else {
      if (this.seats[kp] && !this.seats[kp].pick) this.seats[kp].pick = DIRS[randomInt(3)];
      await this.resolveKick();
    }
  }
  async pick(uid, dir) {
    dir = String(dir);
    if (!DIRS.includes(dir)) throw new Error('Invalid direction.');
    const i = this.seats.findIndex((p) => p && p.uid === uid);
    if (i < 0) throw new Error('Not seated.');
    if (this.phase === 'pick_shot' && i === this.shooter) {
      this.seats[i].pick = dir;
      this.clearTimer();
      this.phase = 'pick_save';
      this.say(`${this.seats[1 - this.shooter].name} dives`);
      this.setTimer(PICK_MS, () => this.autoPick('save'));
      this.emit();
    } else if (this.phase === 'pick_save' && i === 1 - this.shooter) {
      this.seats[i].pick = dir;
      this.clearTimer();
      await this.resolveKick();
    } else throw new Error('Not your turn.');
  }
  async resolveKick() {
    const sh = this.shooter;
    const kp = 1 - sh;
    this.shotDir = this.seats[sh].pick || DIRS[randomInt(3)];
    this.saveDir = this.seats[kp].pick || DIRS[randomInt(3)];
    // Goal if directions differ; tiny skill noise: 8% wrong-foot still goals / saved
    let scored = this.shotDir !== this.saveDir;
    if (this.shotDir === this.saveDir && randomInt(100) < 8) scored = true;
    if (this.shotDir !== this.saveDir && randomInt(100) < 8) scored = false;
    this.goal = scored;
    if (scored) {
      this.scores[sh] += 1;
      this.say(`GOAL — ${this.seats[sh].name} scores`);
    } else {
      this.scores[kp] += 1;
      this.say(`SAVE — ${this.seats[kp].name} stops it`);
    }
    this.lastAnim = {
      shot: this.shotDir, save: this.saveDir, goal: this.goal,
      shooter: sh, t0: Date.now(), dur: ANIM_MS,
    };
    this.phase = 'anim';
    this.emit();
    this.setTimer(ANIM_MS, () => this.afterAnim());
  }
  async afterAnim() {
    const a = this.scores[0], b = this.scores[1];
    if (Math.abs(a - b) >= 2 && (a >= 2 || b >= 2)) {
      await this.finishMatch(a > b ? 0 : 1);
      return;
    }
    // switch roles within the round
    if (this.half === 0) {
      this.half = 1;
      this.shooter = 1 - this.shooter;
      await this.nextKick();
    } else {
      this.half = 0;
      // next round: alternate who starts shooting
      this.shooter = 1 - this.shooter;
      this.phase = 'round_result';
      this.emit();
      this.setTimer(RESULT_MS, () => this.nextKick());
    }
  }
  async finishMatch(winnerIdx) {
    this.clearTimer();
    this.phase = 'match_end';
    this.winner = winnerIdx;
    const w = this.seats[winnerIdx];
    const l = this.seats[1 - winnerIdx];
    const pot = this.pot;
    if (w && pot > 0) {
      try { w.bal = await this.deps.credit(w.uid, pot); } catch (e) { console.error('[penalty] credit', e); }
    }
    for (const p of this.seats) {
      if (!p) continue;
      p.staked = 0; this.syncPending(p);
      p.bet = 0; p.ready = false; p.pick = null;
    }
    this.pot = 0;
    this.say(`${w ? w.name : '?'} wins the shootout`);
    this.emit();
    try {
      if (this.deps.onRoundEnd) {
        this.deps.onRoundEnd({
          game: 'penalty',
          round: this.round,
          players: this.seats.filter(Boolean).map((p, i) => ({
            uid: p.uid, name: p.name,
            bet: floor2(pot / 2),
            win: i === winnerIdx ? pot : 0,
            net: i === winnerIdx ? floor2(pot / 2) : floor2(-pot / 2),
            detail: `${this.scores[0]}-${this.scores[1]}`,
          })),
        });
      }
    } catch (e) { console.error('[penalty] recap', e); }
    this.setTimer(RESULT_MS + 1500, () => this.resetLobby());
  }
  resetLobby() {
    this.phase = 'lobby';
    this.scores = [0, 0];
    this.round = 0;
    this.half = 0;
    this.winner = null;
    this.shotDir = null; this.saveDir = null; this.goal = null;
    this.lastAnim = null;
    for (const p of this.seats) if (p) { p.ready = false; p.pick = null; p.bet = 0; }
    this.clearTimer();
    this.emit();
  }
  setPresence(uid, online) {
    const p = this.seats.find((x) => x && x.uid === uid);
    if (!p || p.online === online) return;
    p.online = online;
    this.emit();
  }
  isEmpty() { return this.seats.every((p) => !p); }
}
module.exports = { PenaltyRoom, INFO, MIN_BET, MAX_BET };
