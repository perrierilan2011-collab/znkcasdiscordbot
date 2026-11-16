'use strict';
/*
 * web/ranked.js — Arène Ranked ZNK : SKILL (pas de pure chance).
 * react / timing / sequence — 5 manches — RR
 */
const { randomInt } = require('crypto');

const SEATS = 8;
const MIN_PLAYERS = 2;
const ROUNDS = 5;
const START_MS = 4_000;
const RESULT_MS = 4_500;
const REACT_MAX_MS = 2500;
const REACT_MIN_OK = 90;
const TIMING_WINDOW_MS = 4000;
const SEQ_LEN_BASE = 3;
const SEQ_SHOW_MS = 650;
const SEQ_GAP_MS = 280;
const SEQ_ANSWER_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODES = ['react', 'timing', 'sequence'];

class RankedArena {
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.seats = Array(SEATS).fill(null);
    this.phase = 'lobby';
    this.deadline = 0;
    this.round = 0;
    this.match = 0;
    this.mode = null;
    this.challenge = null;
    this.answers = {};
    this.scores = {};
    this.lastRound = null;
    this.feed = [];
    this.timer = null;
    this.q = Promise.resolve();
  }

  run(fn) {
    const p = this.q.then(fn, fn);
    this.q = p.catch(() => {});
    return p;
  }
  say(t) {
    this.feed.push({ t: Date.now(), text: t });
    if (this.feed.length > 12) this.feed.shift();
  }
  emit() {
    try { this.deps.onChange(this); } catch (e) { console.error('[ranked] emit', e?.message || e); }
  }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.run(fn).catch((e) => console.error('[ranked] timer', e)), ms);
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
  }
  findSeat(uid) { return this.seats.findIndex((p) => p && p.uid === uid); }
  alive() { return this.seats.filter((p) => p && p.inMatch && p.online !== false); }
  lobbyCount() { return this.seats.filter(Boolean).length; }

  snapshot(uid) {
    const mine = this.answers[uid] || null;
    return {
      now: Date.now(),
      mode: 'ranked',
      skill: true,
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      rounds: ROUNDS,
      match: this.match,
      gameMode: this.mode,
      challenge: this.challengeForClient(uid),
      answered: !!mine,
      myAnswer: mine,
      lastRound: this.lastRound,
      seats: this.seats.map((p) =>
        p
          ? {
              uid: p.uid,
              name: p.name,
              avatar: p.avatar,
              online: p.online !== false,
              inMatch: !!p.inMatch,
              ready: !!p.ready,
              score: this.scores[p.uid] || 0,
              answered: !!this.answers[p.uid],
              lastPlace: p.lastPlace || null,
              delta: p.delta ?? null,
            }
          : null
      ),
      feed: this.feed,
      minPlayers: MIN_PLAYERS,
      maxPlayers: SEATS,
    };
  }

  challengeForClient(uid) {
    if (!this.challenge) return null;
    const c = { ...this.challenge };
    if (this.mode === 'sequence' && this.phase === 'playing' && c.stage === 'answer') {
      return { type: 'sequence', stage: 'answer', len: c.seq.length, inputMs: c.inputMs, startedAt: c.startedAt };
    }
    return c;
  }

  async join(user) {
    if (this.findSeat(user.uid) >= 0) throw new Error('Tu es déjà dans l’arène.');
    if (this.phase !== 'lobby' && this.phase !== 'match_end') throw new Error('Match en cours — attends la fin.');
    const idx = this.seats.findIndex((s) => !s);
    if (idx < 0) throw new Error('Arène pleine (8 max).');
    this.seats[idx] = {
      uid: user.uid, name: user.name, avatar: user.avatar,
      online: true, ready: false, inMatch: false, lastPlace: null, delta: null,
    };
    this.say('⚔️ ' + user.name + ' rejoint');
    this.emit();
    this.checkStart();
  }

  async leave(uid) {
    const idx = this.findSeat(uid);
    if (idx < 0) return;
    const p = this.seats[idx];
    if (p.inMatch && this.phase !== 'lobby' && this.phase !== 'match_end') {
      p.online = false;
      this.say('💨 ' + p.name + ' déco');
      this.emit();
      this.maybeCloseRound();
      return;
    }
    this.seats[idx] = null;
    this.say('🚪 ' + p.name + ' part');
    this.emit();
    this.checkStart();
  }

  async ready(uid, on = true) {
    if (this.phase !== 'lobby' && this.phase !== 'match_end') throw new Error('Pas en lobby.');
    const p = this.seats[this.findSeat(uid)];
    if (!p) throw new Error('Rejoins l’arène d’abord.');
    p.ready = !!on;
    this.emit();
    this.checkStart();
  }

  checkStart() {
    if (this.phase !== 'lobby' && this.phase !== 'match_end') return;
    const ready = this.seats.filter((p) => p && p.ready);
    if (ready.length >= MIN_PLAYERS && ready.length === this.lobbyCount()) {
      if (!this.deadline) this.setTimer(START_MS, () => this.startMatch());
    } else {
      this.clearTimer();
      if (this.phase === 'match_end') this.phase = 'lobby';
    }
    this.emit();
  }

  async startMatch() {
    const players = this.seats.filter((p) => p && p.ready);
    if (players.length < MIN_PLAYERS) {
      this.phase = 'lobby';
      this.clearTimer();
      this.emit();
      return;
    }
    this.match++;
    this.round = 0;
    this.scores = {};
    this.lastRound = null;
    for (const p of this.seats) {
      if (!p) continue;
      p.inMatch = !!p.ready;
      p.lastPlace = null;
      p.delta = null;
      if (p.inMatch) this.scores[p.uid] = 0;
    }
    this.say('🏆 Match #' + this.match + ' · ' + players.length + ' joueurs · ' + ROUNDS + ' manches SKILL');
    this.phase = 'countdown';
    this.emit();
    await sleep(600);
    return this.nextRound();
  }

  pickMode() {
    return MODES[(this.round - 1) % MODES.length];
  }

  async nextRound() {
    this.round++;
    if (this.round > ROUNDS) return this.endMatch();
    this.answers = {};
    this.mode = this.pickMode();
    this.phase = 'playing';
    this.lastRound = null;

    if (this.mode === 'react') {
      const delay = 1200 + randomInt(1800);
      const goAt = Date.now() + delay;
      this.challenge = { type: 'react', goAt, maxMs: REACT_MAX_MS };
      this.say('Manche ' + this.round + '/' + ROUNDS + ' · RÉFLEXE — attends le GO');
      this.emit();
      this.setTimer(delay + REACT_MAX_MS + 200, () => this.scoreRound());
      return;
    }

    if (this.mode === 'timing') {
      const center = 0.25 + randomInt(50) / 100;
      const width = 0.08 + randomInt(5) / 100;
      const duration = TIMING_WINDOW_MS;
      const startedAt = Date.now();
      this.challenge = { type: 'timing', center, width, duration, startedAt };
      this.say('Manche ' + this.round + '/' + ROUNDS + ' · PRÉCISION — zone verte');
      this.emit();
      this.setTimer(duration + 400, () => this.scoreRound());
      return;
    }

    const len = SEQ_LEN_BASE + Math.min(3, Math.floor((this.round - 1) / 2));
    const seq = [];
    for (let i = 0; i < len; i++) seq.push(randomInt(4));
    this.challenge = { type: 'sequence', stage: 'show', seq, len };
    this.say('Manche ' + this.round + '/' + ROUNDS + ' · MÉMOIRE — ' + len + ' signaux');
    this.emit();
    const showMs = len * (SEQ_SHOW_MS + SEQ_GAP_MS) + 400;
    this.setTimer(showMs, () => this.run(() => this.sequenceAnswerPhase()));
  }

  async sequenceAnswerPhase() {
    if (this.mode !== 'sequence' || this.phase !== 'playing') return;
    this.challenge = {
      type: 'sequence',
      stage: 'answer',
      seq: this.challenge.seq,
      len: this.challenge.seq.length,
      inputMs: SEQ_ANSWER_MS,
      startedAt: Date.now(),
    };
    this.emit();
    this.setTimer(SEQ_ANSWER_MS + 300, () => this.scoreRound());
  }

  async act(uid, answer) {
    if (this.phase !== 'playing') throw new Error('Pas de manche en cours.');
    const p = this.seats[this.findSeat(uid)];
    if (!p || !p.inMatch) throw new Error('Pas en match.');
    if (this.answers[uid]) throw new Error('Déjà répondu.');

    if (this.mode === 'react') {
      const goAt = this.challenge?.goAt || 0;
      const t = Number(answer?.t);
      if (!Number.isFinite(t)) throw new Error('Réponse invalide.');
      if (t < goAt) throw new Error('Trop tôt !');
      let ms = t - goAt;
      if (ms < REACT_MIN_OK) ms = REACT_MAX_MS;
      if (ms > REACT_MAX_MS) ms = REACT_MAX_MS;
      this.answers[uid] = { ms, raw: t };
    } else if (this.mode === 'timing') {
      let pos = Number(answer?.pos);
      if (!Number.isFinite(pos)) throw new Error('Réponse invalide.');
      pos = Math.max(0, Math.min(1, pos));
      const { center, width } = this.challenge;
      const dist = Math.abs(pos - center);
      const half = width / 2;
      const accuracy = dist <= half ? 1 - (dist / half) * 0.15 : Math.max(0, 1 - dist / 0.5);
      this.answers[uid] = { pos, accuracy, dist };
    } else if (this.mode === 'sequence') {
      if (this.challenge?.stage !== 'answer') throw new Error('Attends la fin de la séquence.');
      const got = Array.isArray(answer?.seq) ? answer.seq.map((x) => Number(x)) : [];
      const target = this.challenge.seq;
      let correct = 0;
      for (let i = 0; i < target.length; i++) {
        if (got[i] === target[i]) correct++;
        else break;
      }
      const ms = Math.max(0, Date.now() - (this.challenge.startedAt || Date.now()));
      this.answers[uid] = { correct, total: target.length, ms, got };
    } else {
      throw new Error('Mode inconnu.');
    }

    this.emit();
    this.maybeCloseRound();
  }

  maybeCloseRound() {
    const need = this.alive();
    if (!need.length) {
      this.clearTimer();
      return this.scoreRound();
    }
    if (need.every((p) => this.answers[p.uid])) {
      this.clearTimer();
      return this.scoreRound();
    }
  }

  async scoreRound() {
    if (this.phase !== 'playing') return;
    this.phase = 'round_result';
    const players = this.alive();
    const scored = [];

    for (const p of players) {
      const a = this.answers[p.uid];
      let metric = 0;
      let label = '—';
      if (!a) {
        metric = -1;
        label = 'timeout';
      } else if (this.mode === 'react') {
        metric = 10000 - a.ms;
        label = a.ms + ' ms';
      } else if (this.mode === 'timing') {
        metric = Math.round(a.accuracy * 1000);
        label = Math.round(a.accuracy * 100) + '%';
      } else if (this.mode === 'sequence') {
        metric = a.correct * 10000 - a.ms;
        label = a.correct + '/' + a.total + (a.correct === a.total ? ' · ' + a.ms + 'ms' : '');
      }
      scored.push({ uid: p.uid, name: p.name, metric, label, a });
    }

    scored.sort((a, b) => b.metric - a.metric);
    const n = scored.length;
    const rows = [];
    let place = 1;
    for (let i = 0; i < scored.length; i++) {
      if (i > 0 && scored[i].metric < scored[i - 1].metric) place = i + 1;
      const pts = Math.max(0, n - place + 1);
      this.scores[scored[i].uid] = (this.scores[scored[i].uid] || 0) + pts;
      rows.push({
        uid: scored[i].uid,
        name: scored[i].name,
        place,
        pts,
        label: scored[i].label,
        score: this.scores[scored[i].uid],
      });
    }
    this.lastRound = { mode: this.mode, rows };
    if (rows[0]) this.say('🥇 ' + rows[0].name + ' · ' + rows[0].label + ' (+' + rows[0].pts + ' pts)');
    this.emit();
    await sleep(RESULT_MS);
    return this.nextRound();
  }

  async endMatch() {
    this.phase = 'match_end';
    this.challenge = null;
    const players = this.seats.filter((p) => p && p.inMatch);
    const ranked = [...players].sort(
      (a, b) => (this.scores[b.uid] || 0) - (this.scores[a.uid] || 0) || a.uid.localeCompare(b.uid)
    );
    let place = 1;
    const payload = [];
    for (let i = 0; i < ranked.length; i++) {
      if (i > 0 && (this.scores[ranked[i].uid] || 0) < (this.scores[ranked[i - 1].uid] || 0)) place = i + 1;
      ranked[i].lastPlace = place;
      payload.push({
        uid: ranked[i].uid, name: ranked[i].name, avatar: ranked[i].avatar,
        place, score: this.scores[ranked[i].uid] || 0,
      });
    }
    let changes = [];
    try { changes = this.deps.rankRecord(payload) || []; } catch (e) { console.error('[ranked] rankRecord', e?.message || e); }
    for (const c of changes) {
      const p = this.seats.find((x) => x && x.uid === c.uid);
      if (p) p.delta = c.delta;
    }
    this.say('Match terminé — RR mis à jour');
    this.emit();
    try {
      if (this.deps.onMatchEnd) this.deps.onMatchEnd({ game: 'ranked', players: payload, changes });
    } catch (e) { console.error('[ranked] onMatchEnd', e?.message || e); }
    this.setTimer(RESULT_MS + 1500, () => {
      for (const p of this.seats) {
        if (!p) continue;
        p.inMatch = false;
        p.ready = false;
        if (p.online === false) {
          const i = this.seats.indexOf(p);
          if (i >= 0) this.seats[i] = null;
        }
      }
      this.challenge = null;
      this.answers = {};
      this.lastRound = null;
      this.phase = 'lobby';
      this.clearTimer();
      this.emit();
    });
  }

  setPresence(uid, online) {
    const p = this.seats.find((x) => x && x.uid === uid);
    if (!p) return;
    p.online = online;
    this.emit();
  }
  isEmpty() { return this.seats.every((p) => !p); }
}

module.exports = { RankedArena, SEATS, MIN_PLAYERS, ROUNDS };
