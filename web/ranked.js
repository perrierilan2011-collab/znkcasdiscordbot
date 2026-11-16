'use strict';
/*
 * web/ranked.js — Arène Ranked ZNK : 100 % SKILL, zéro hasard dans le résultat.
 *
 * 5 épreuves (ordre mélangé à chaque match, toutes différentes) :
 *   react    Réflexe   — clique dès que l'écran passe au vert
 *   aim      Visée     — 6 cibles qui rétrécissent, le plus rapide et le plus précis gagne
 *   sequence Mémoire   — rejoue une séquence de 5 signaux
 *   timing   Précision — stoppe un curseur qui fait des allers-retours dans une zone étroite
 *   math     Calcul    — 3 opérations mentales
 *
 * Le hasard ne sert qu'à générer l'épreuve (identique pour tous les joueurs d'un même match).
 * Le classement d'une manche dépend uniquement de la performance.
 * Chaque manche donne (n - place + 1) points ; le total des 5 manches fixe la place → RR.
 *
 * Correctifs par rapport à l'ancienne version :
 *  - les clients se calent sur l'horloge serveur (le GO n'était jamais synchronisé → "Trop tôt" à tort)
 *  - plus aucun sleep() dans la file d'actions (le serveur ne se bloquait plus pendant 4,5 s)
 *  - le deadline est remis à zéro quand un timer se déclenche (le compte à rebours ne repartait pas)
 *  - la phase "match_end" ne cassait plus le lobby
 */
const { randomInt } = require('crypto');

const SEATS = 8;
const MIN_PLAYERS = 2;
const ROUNDS = 5;
const START_MS = 4000;
const INTRO_MS = 2600;
const RESULT_MS = 4200;
const END_MS = 10000;

const REACT_MAX = 1500;
const REACT_MIN = 100; // en dessous = anticipation
const TIMING_PERIOD = 1500;
const TIMING_LEAD = 1200;
const TIMING_WINDOW = 6000;
const AIM_N = 6;
const AIM_LEAD = 1800;
const AIM_WINDOW = 16000;
const AIM_MISS_MS = 500;
const SEQ_LEN = 5;
const SEQ_SHOW = 550;
const SEQ_GAP = 240;
const SEQ_ANSWER = 10000;
const MATH_N = 3;
const MATH_LEAD = 1500;
const MATH_WINDOW = 25000;

const GAMES = ['react', 'aim', 'sequence', 'timing', 'math'];

function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makeMath() {
  const qs = [];
  const ans = [];
  for (let i = 0; i < MATH_N; i++) {
    const k = i % 3;
    if (k === 0) {
      const a = 12 + randomInt(8), b = 3 + randomInt(7);
      qs.push(a + ' × ' + b); ans.push(a * b);
    } else if (k === 1) {
      const a = 40 + randomInt(60), b = 20 + randomInt(60), c = 10 + randomInt(30);
      qs.push(a + ' + ' + b + ' − ' + c); ans.push(a + b - c);
    } else {
      const a = 6 + randomInt(8), b = 4 + randomInt(6), c = 10 + randomInt(40);
      qs.push(a + ' × ' + b + ' + ' + c); ans.push(a * b + c);
    }
  }
  return { qs, ans };
}

class RankedArena {
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.seats = Array(SEATS).fill(null);
    this.phase = 'lobby'; // lobby | intro | playing | round_result | match_end
    this.deadline = 0;
    this.round = 0;
    this.match = 0;
    this.plan = [];
    this.mode = null;
    this.challenge = null;
    this.secret = null;
    this.answers = {};
    this.scores = {};
    this.lastRound = null;
    this.final = null;
    this.feed = [];
    this.timer = null;
    this.q = Promise.resolve();
  }

  /* ---------- infra ---------- */
  run(fn) {
    const p = this.q.catch(() => {}).then(fn);
    this.q = p.catch(() => {});
    return p;
  }
  say(t) {
    this.feed.push({ t: Date.now(), text: t });
    if (this.feed.length > 10) this.feed.shift();
  }
  emit() {
    try { this.deps.onChange(this); } catch (e) { console.error('[ranked] emit', e?.message || e); }
  }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = 0;
      this.run(fn).catch((e) => console.error('[ranked] timer', e));
    }, ms);
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
  }
  findSeat(uid) { return this.seats.findIndex((p) => p && p.uid === uid); }
  alive() { return this.seats.filter((p) => p && p.inMatch && p.online !== false); }
  lobbyCount() { return this.seats.filter(Boolean).length; }
  inLobby() { return this.phase === 'lobby'; }

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
      plan: this.plan,
      gameMode: this.mode,
      challenge: this.challenge,
      answered: !!mine,
      lastRound: this.lastRound,
      final: this.final,
      seats: this.seats.map((p) =>
        p
          ? {
              uid: p.uid, name: p.name, avatar: p.avatar,
              online: p.online !== false, inMatch: !!p.inMatch, ready: !!p.ready,
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

  /* ---------- lobby ---------- */
  async join(user) {
    if (this.findSeat(user.uid) >= 0) throw new Error('Tu es déjà dans l’arène.');
    if (!this.inLobby()) throw new Error('Match en cours — rejoins à la fin.');
    const idx = this.seats.findIndex((s) => !s);
    if (idx < 0) throw new Error('Arène pleine (8 max).');
    this.seats[idx] = {
      uid: user.uid, name: user.name, avatar: user.avatar,
      online: true, ready: false, inMatch: false, lastPlace: null, delta: null,
    };
    this.say(user.name + ' rejoint l’arène');
    this.checkStart();
  }

  async leave(uid) {
    const idx = this.findSeat(uid);
    if (idx < 0) return;
    const p = this.seats[idx];
    if (p.inMatch && !this.inLobby()) {
      p.online = false; // il reste classé en dernier s'il abandonne
      this.say(p.name + ' a abandonné');
      this.emit();
      if (this.phase === 'playing') this.maybeCloseRound();
      return;
    }
    this.seats[idx] = null;
    this.say(p.name + ' quitte l’arène');
    this.checkStart();
  }

  async ready(uid, on = true) {
    if (!this.inLobby()) throw new Error('Match en cours.');
    const p = this.seats[this.findSeat(uid)];
    if (!p) throw new Error('Rejoins l’arène d’abord.');
    p.ready = !!on;
    this.checkStart();
  }

  checkStart() {
    if (this.inLobby()) {
      const ready = this.seats.filter((p) => p && p.ready).length;
      if (ready >= MIN_PLAYERS && ready === this.lobbyCount()) {
        if (!this.deadline) this.setTimer(START_MS, () => this.startMatch());
      } else {
        this.clearTimer();
      }
    }
    this.emit();
  }

  /* ---------- match ---------- */
  async startMatch() {
    const players = this.seats.filter((p) => p && p.ready);
    if (!this.inLobby() || players.length < MIN_PLAYERS) return this.checkStart();
    this.match++;
    this.round = 0;
    this.scores = {};
    this.lastRound = null;
    this.final = null;
    this.plan = shuffle(GAMES).slice(0, ROUNDS);
    for (const p of this.seats) {
      if (!p) continue;
      p.inMatch = !!p.ready;
      p.lastPlace = null;
      p.delta = null;
      if (p.inMatch) this.scores[p.uid] = 0;
    }
    this.say('Match #' + this.match + ' — ' + players.length + ' joueurs');
    return this.nextRound();
  }

  async nextRound() {
    this.round++;
    if (this.round > ROUNDS) return this.endMatch();
    this.mode = this.plan[this.round - 1];
    this.answers = {};
    this.challenge = null;
    this.secret = null;
    this.lastRound = null;
    this.phase = 'intro';
    this.emit();
    this.setTimer(INTRO_MS, () => this.beginRound());
  }

  async beginRound() {
    if (this.phase !== 'intro') return;
    const now = Date.now();
    this.phase = 'playing';
    let ms = 0;

    if (this.mode === 'react') {
      const goAt = now + 1400 + randomInt(2600);
      this.challenge = { type: 'react', goAt, maxMs: REACT_MAX };
      ms = goAt - now + REACT_MAX + 400;
    } else if (this.mode === 'aim') {
      const targets = [];
      for (let i = 0; i < AIM_N; i++) targets.push({ x: 0.1 + randomInt(81) / 100, y: 0.12 + randomInt(77) / 100 });
      this.challenge = { type: 'aim', targets, startsAt: now + AIM_LEAD, n: AIM_N };
      ms = AIM_LEAD + AIM_WINDOW + 400;
    } else if (this.mode === 'timing') {
      const center = 0.2 + randomInt(61) / 100;
      this.challenge = { type: 'timing', center, width: 0.1, period: TIMING_PERIOD, startedAt: now + TIMING_LEAD, window: TIMING_WINDOW };
      ms = TIMING_LEAD + TIMING_WINDOW + 400;
    } else if (this.mode === 'math') {
      const { qs, ans } = makeMath();
      this.secret = { ans };
      this.challenge = { type: 'math', qs, startedAt: now + MATH_LEAD, window: MATH_WINDOW };
      ms = MATH_LEAD + MATH_WINDOW + 400;
    } else {
      const seq = [];
      for (let i = 0; i < SEQ_LEN; i++) seq.push(randomInt(4));
      const showStart = now + 700;
      this.secret = { seq };
      this.challenge = { type: 'sequence', stage: 'show', seq, showStart, show: SEQ_SHOW, gap: SEQ_GAP, len: SEQ_LEN };
      ms = 700 + SEQ_LEN * (SEQ_SHOW + SEQ_GAP) + 300;
      this.setTimer(ms, () => this.sequenceAnswerPhase());
      this.emit();
      return;
    }
    this.emit();
    this.setTimer(ms, () => this.scoreRound());
  }

  async sequenceAnswerPhase() {
    if (this.mode !== 'sequence' || this.phase !== 'playing') return;
    this.challenge = { type: 'sequence', stage: 'answer', len: SEQ_LEN, startedAt: Date.now(), inputMs: SEQ_ANSWER };
    this.emit();
    this.setTimer(SEQ_ANSWER + 300, () => this.scoreRound());
  }

  async act(uid, answer) {
    if (this.phase !== 'playing' || !this.challenge) throw new Error('Pas de manche en cours.');
    const p = this.seats[this.findSeat(uid)];
    if (!p || !p.inMatch) throw new Error('Tu ne joues pas ce match.');
    if (this.answers[uid]) throw new Error('Déjà répondu.');
    const now = Date.now();
    const a = answer || {};
    const c = this.challenge;

    if (c.type === 'react') {
      if (a.early || !Number.isFinite(Number(a.t)) || Number(a.t) < c.goAt) {
        this.answers[uid] = { early: true };
      } else {
        // t = horloge serveur estimée par le client ; borné pour limiter la triche
        const t = clamp(Number(a.t), now - 1200, now);
        const ms = Math.round(t - c.goAt);
        this.answers[uid] = ms < REACT_MIN ? { early: true } : { ms: Math.min(ms, REACT_MAX) };
      }
    } else if (c.type === 'timing') {
      const t = clamp(Number(a.t), now - 1200, now);
      if (!Number.isFinite(t) || t < c.startedAt) throw new Error('Attends le départ.');
      const ph = ((t - c.startedAt) % c.period) / c.period;
      const pos = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const dist = Math.abs(pos - c.center);
      const half = c.width / 2;
      const accuracy = dist <= half ? 1 - (dist / half) * 0.15 : Math.max(0, 0.85 - ((dist - half) / 0.5) * 0.85);
      this.answers[uid] = { pos, dist, accuracy };
    } else if (c.type === 'aim') {
      if (now < c.startsAt) throw new Error('Attends le départ.');
      const misses = clamp(Math.floor(Number(a.misses) || 0), 0, 12);
      const t = clamp(Number(a.t), now - 1200, now);
      const raw = Math.round(t - c.startsAt);
      const ms = Math.max(c.n * 180, raw) + misses * AIM_MISS_MS;
      this.answers[uid] = { ms, misses };
    } else if (c.type === 'math') {
      if (now < c.startedAt) throw new Error('Attends le départ.');
      const got = Array.isArray(a.answers) ? a.answers.map(Number) : [];
      let correct = 0;
      for (let i = 0; i < this.secret.ans.length; i++) if (got[i] === this.secret.ans[i]) correct++;
      this.answers[uid] = { correct, total: this.secret.ans.length, ms: Math.max(500, now - c.startedAt) };
    } else if (c.type === 'sequence') {
      if (c.stage !== 'answer') throw new Error('Attends la fin de la séquence.');
      const got = Array.isArray(a.seq) ? a.seq.map(Number) : [];
      let correct = 0;
      for (let i = 0; i < this.secret.seq.length; i++) {
        if (got[i] === this.secret.seq[i]) correct++;
        else break;
      }
      this.answers[uid] = { correct, total: this.secret.seq.length, ms: Math.max(0, now - c.startedAt) };
    } else {
      throw new Error('Épreuve inconnue.');
    }
    this.emit();
    this.maybeCloseRound();
  }

  maybeCloseRound() {
    if (this.phase !== 'playing') return;
    if (this.challenge?.type === 'sequence' && this.challenge.stage !== 'answer') return;
    const need = this.alive();
    if (!need.length || need.every((p) => this.answers[p.uid])) {
      this.clearTimer();
      this.run(() => this.scoreRound()).catch(() => {});
    }
  }

  async scoreRound() {
    if (this.phase !== 'playing') return;
    this.phase = 'round_result';
    const scored = this.alive().map((p) => {
      const a = this.answers[p.uid];
      let metric = -1, label = 'pas de réponse';
      if (a) {
        if (a.early) { metric = 0; label = 'faux départ'; }
        else if (this.mode === 'react') { metric = 100000 - a.ms; label = a.ms + ' ms'; }
        else if (this.mode === 'timing') { metric = Math.round(a.accuracy * 1000); label = Math.round(a.accuracy * 100) + ' %'; }
        else if (this.mode === 'aim') { metric = 1000000 - a.ms; label = (a.ms / 1000).toFixed(2) + ' s' + (a.misses ? ' · ' + a.misses + ' raté' + (a.misses > 1 ? 's' : '') : ''); }
        else if (this.mode === 'math') { metric = a.correct * 1000000 - a.ms; label = a.correct + '/' + a.total + ' · ' + (a.ms / 1000).toFixed(1) + ' s'; }
        else { metric = a.correct * 100000 - a.ms; label = a.correct + '/' + a.total + (a.correct === a.total ? ' · ' + (a.ms / 1000).toFixed(1) + ' s' : ''); }
      }
      return { uid: p.uid, name: p.name, metric, label };
    });
    scored.sort((x, y) => y.metric - x.metric);
    const n = scored.length;
    const rows = [];
    let place = 1;
    scored.forEach((s, i) => {
      if (i > 0 && s.metric < scored[i - 1].metric) place = i + 1;
      const pts = Math.max(0, n - place + 1);
      this.scores[s.uid] = (this.scores[s.uid] || 0) + pts;
      rows.push({ uid: s.uid, name: s.name, place, pts, label: s.label, score: this.scores[s.uid] });
    });
    this.lastRound = { mode: this.mode, round: this.round, rows };
    this.challenge = null;
    this.secret = null;
    this.emit();
    this.setTimer(RESULT_MS, () => this.nextRound());
  }

  async endMatch() {
    this.phase = 'match_end';
    this.challenge = null;
    this.mode = null;
    const players = this.seats.filter((p) => p && p.inMatch);
    const sc = (p) => this.scores[p.uid] || 0;
    const ranked = [...players].sort((a, b) => sc(b) - sc(a) || a.uid.localeCompare(b.uid));
    let place = 1;
    const payload = ranked.map((p, i) => {
      if (i > 0 && sc(p) < sc(ranked[i - 1])) place = i + 1;
      p.lastPlace = place;
      return { uid: p.uid, name: p.name, avatar: p.avatar, place, score: sc(p) };
    });
    let changes = [];
    try { changes = this.deps.rankRecord(payload) || []; } catch (e) { console.error('[ranked] rankRecord', e?.message || e); }
    for (const c of changes) {
      const p = this.seats.find((x) => x && x.uid === c.uid);
      if (p) p.delta = c.delta;
    }
    this.final = payload.map((r) => {
      const c = changes.find((x) => x.uid === r.uid);
      return { ...r, delta: c ? c.delta : null, elo: c ? c.elo : null, placement: c ? c.placement : false, placementLeft: c ? c.placementLeft : 0 };
    });
    this.say('Match terminé — RR mis à jour');
    this.emit();
    try { if (this.deps.onMatchEnd) this.deps.onMatchEnd({ game: 'ranked', players: payload, changes }); }
    catch (e) { console.error('[ranked] onMatchEnd', e?.message || e); }
    this.setTimer(END_MS, () => this.backToLobby());
  }

  async backToLobby() {
    for (let i = 0; i < this.seats.length; i++) {
      const p = this.seats[i];
      if (!p) continue;
      if (p.online === false) { this.seats[i] = null; continue; }
      p.inMatch = false;
      p.ready = false;
    }
    this.challenge = null;
    this.secret = null;
    this.answers = {};
    this.lastRound = null;
    this.phase = 'lobby';
    this.clearTimer();
    this.emit();
  }

  setPresence(uid, online) {
    const p = this.seats.find((x) => x && x.uid === uid);
    if (!p) return;
    p.online = online;
    this.emit();
    if (!online && this.phase === 'playing') this.maybeCloseRound();
  }
  isEmpty() { return this.seats.every((p) => !p); }
}

module.exports = { RankedArena, SEATS, MIN_PLAYERS, ROUNDS };
