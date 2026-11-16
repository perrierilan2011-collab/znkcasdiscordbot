'use strict';
/*
 * web/ranked.js — Arène Ranked ZNK (2–8 joueurs).
 * Aucun ZTKN : uniquement du RR.
 * Format : Showdown poker — 2 cartes privées + board commun, meilleure main gagne.
 * Plusieurs manches (best of) puis classement → rankApi.recordRanked.
 */
const { randomInt } = require('crypto');
const { bestHand } = require('./poker');

const SEATS = 8;
const MIN_PLAYERS = 2;
const ROUNDS = 3; // manches par match
const TURN_MS = 12_000;
const START_MS = 5_000;
const RESULT_MS = 7_000;
const DEAL_MS = 280;
const REVEAL_MS = 900;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const newDeck = () => shuffle(RANKS.flatMap((r) => SUITS.map((s) => ({ r, s }))));

class RankedArena {
  /**
   * deps: { onChange(room), onMatchEnd(results), rankRecord(players) }
   */
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.seats = Array(SEATS).fill(null);
    this.phase = 'lobby'; // lobby | countdown | dealing | reveal | round_result | match_end
    this.deadline = 0;
    this.round = 0; // 1..ROUNDS
    this.match = 0;
    this.board = [];
    this.deck = [];
    this.cardId = 0;
    this.feed = [];
    this.timer = null;
    this.q = Promise.resolve();
    this.scores = {}; // uid -> wins this match
  }

  run(fn) {
    const p = this.q.then(fn, fn);
    this.q = p.catch(() => {});
    return p;
  }
  say(t) {
    this.feed.push({ t: Date.now(), text: t });
    if (this.feed.length > 10) this.feed.shift();
  }
  emit() {
    try {
      this.deps.onChange(this);
    } catch (e) {
      console.error('[ranked] emit', e?.message || e);
    }
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
  draw() {
    const c = this.deck.pop();
    return { id: ++this.cardId, r: c.r, s: c.s };
  }
  findSeat(uid) {
    return this.seats.findIndex((p) => p && p.uid === uid);
  }
  alive() {
    return this.seats.filter((p) => p && p.inMatch);
  }
  lobbyCount() {
    return this.seats.filter(Boolean).length;
  }

  snapshot(uid) {
    return {
      now: Date.now(),
      mode: 'ranked',
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      rounds: ROUNDS,
      match: this.match,
      board: this.board.map((c) => ({ id: c.id, r: c.r, s: c.s })),
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
              cards:
                p.uid === uid || this.phase === 'reveal' || this.phase === 'round_result' || this.phase === 'match_end'
                  ? (p.cards || []).map((c) => ({ id: c.id, r: c.r, s: c.s }))
                  : (p.cards || []).map((c) => ({ id: c.id, h: 1 })),
              hand: p.handName || null,
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

  async join(user) {
    if (this.findSeat(user.uid) >= 0) throw new Error('Tu es déjà dans l’arène.');
    if (this.phase !== 'lobby' && this.phase !== 'match_end') throw new Error('Match en cours — attends la fin.');
    const idx = this.seats.findIndex((s) => !s);
    if (idx < 0) throw new Error('Arène pleine (8 max).');
    this.seats[idx] = {
      uid: user.uid,
      name: user.name,
      avatar: user.avatar,
      online: true,
      ready: false,
      inMatch: false,
      cards: [],
      handName: null,
      lastPlace: null,
      delta: null,
    };
    this.say(`⚔️ ${user.name} rejoint l’arène`);
    this.emit();
    this.checkStart();
  }

  async leave(uid) {
    const idx = this.findSeat(uid);
    if (idx < 0) return;
    const p = this.seats[idx];
    if (p.inMatch && this.phase !== 'lobby' && this.phase !== 'match_end') {
      p.online = false;
      this.say(`💨 ${p.name} se déconnecte`);
      this.emit();
      return;
    }
    this.seats[idx] = null;
    this.say(`🚪 ${p.name} quitte`);
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
    for (const p of this.seats) {
      if (!p) continue;
      p.inMatch = !!p.ready;
      p.cards = [];
      p.handName = null;
      p.lastPlace = null;
      p.delta = null;
      if (p.inMatch) this.scores[p.uid] = 0;
    }
    this.say(`🏆 Match ranked #${this.match} · ${players.length} joueurs · ${ROUNDS} manches`);
    this.emit();
    await sleep(600);
    return this.nextRound();
  }

  async nextRound() {
    this.round++;
    if (this.round > ROUNDS) return this.endMatch();
    this.phase = 'dealing';
    this.board = [];
    this.deck = newDeck();
    for (const p of this.seats) {
      if (p && p.inMatch) {
        p.cards = [];
        p.handName = null;
      }
    }
    this.say(`Manche ${this.round}/${ROUNDS}`);
    this.emit();
    await sleep(400);
    const order = this.seats.map((p, i) => (p && p.inMatch ? i : -1)).filter((i) => i >= 0);
    for (let pass = 0; pass < 2; pass++) {
      for (const i of order) {
        this.seats[i].cards.push(this.draw());
        this.emit();
        await sleep(DEAL_MS);
      }
    }
    // board 5 cartes
    this.deck.pop();
    for (let k = 0; k < 5; k++) {
      if (k === 3 || k === 4) this.deck.pop();
      this.board.push(this.draw());
      this.emit();
      await sleep(DEAL_MS + 80);
    }
    this.phase = 'reveal';
    this.emit();
    await sleep(REVEAL_MS);
    return this.scoreRound();
  }

  async scoreRound() {
    const cont = this.alive();
    for (const p of cont) {
      const ev = bestHand([...p.cards, ...this.board]);
      p.handName = ev.name;
      p._s = ev.s;
    }
    cont.sort((a, b) => b._s - a._s);
    // ex-aequo possible
    const best = cont[0]._s;
    const winners = cont.filter((p) => p._s === best);
    for (const w of winners) {
      this.scores[w.uid] = (this.scores[w.uid] || 0) + 1;
    }
    this.say(`🥇 ${winners.map((w) => w.name).join(', ')} · ${winners[0].handName}`);
    this.phase = 'round_result';
    this.emit();
    await sleep(RESULT_MS);
    for (const p of cont) delete p._s;
    return this.nextRound();
  }

  async endMatch() {
    this.phase = 'match_end';
    const players = this.alive();
    // classement par score de manches puis tie-break aléatoire stable
    const ranked = [...players].sort((a, b) => (this.scores[b.uid] || 0) - (this.scores[a.uid] || 0) || a.uid.localeCompare(b.uid));
    // places 1..n (ex-aequo same score → same logical place for RR: use dense rank)
    let place = 1;
    const payload = [];
    for (let i = 0; i < ranked.length; i++) {
      if (i > 0 && (this.scores[ranked[i].uid] || 0) < (this.scores[ranked[i - 1].uid] || 0)) place = i + 1;
      ranked[i].lastPlace = place;
      payload.push({ uid: ranked[i].uid, name: ranked[i].name, avatar: ranked[i].avatar, place, score: this.scores[ranked[i].uid] || 0 });
    }
    let changes = [];
    try {
      changes = this.deps.rankRecord(payload) || [];
    } catch (e) {
      console.error('[ranked] rankRecord', e?.message || e);
    }
    for (const c of changes) {
      const p = this.seats.find((x) => x && x.uid === c.uid);
      if (p) p.delta = c.delta;
    }
    this.say('Match terminé — RR mis à jour');
    this.emit();
    try {
      if (this.deps.onMatchEnd) this.deps.onMatchEnd({ game: 'ranked', players: payload, changes });
    } catch (e) {
      console.error('[ranked] onMatchEnd', e?.message || e);
    }
    // retour lobby
    this.setTimer(RESULT_MS + 2000, () => {
      for (const p of this.seats) {
        if (!p) continue;
        p.inMatch = false;
        p.ready = false;
        p.cards = [];
        p.handName = null;
        if (p.online === false) {
          const i = this.seats.indexOf(p);
          if (i >= 0) this.seats[i] = null;
        }
      }
      this.board = [];
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

  isEmpty() {
    return this.seats.every((p) => !p);
  }
}

module.exports = { RankedArena, SEATS, MIN_PLAYERS, ROUNDS };
