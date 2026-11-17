'use strict';
/*
 * web/ranked.js — DEPRECATED / no longer used by the web server.
 *
 * Ranked mode is now BLACKJACK, driven by the same Room engine as online
 * blackjack (see `entry.ranked` in web/server.js, table id 'ranked'). RR/ELO
 * are recorded from ranked blackjack results via rankApi.recordRanked().
 *
 * The old skill-minigame arena is gone. The stubs below are kept only so any
 * legacy `require('./ranked')` stays harmless.
 */
const SEATS = 5;
const MIN_PLAYERS = 2;
const ROUNDS = 0;

class RankedArena {
  constructor() {
    this.q = Promise.resolve();
  }
  run(fn) { return Promise.resolve().then(fn); }
  setPresence() {}
  snapshot() { return { mode: 'ranked', skill: false, phase: 'lobby', seats: [] }; }
  isEmpty() { return true; }
  clearTimer() {}
}

module.exports = { RankedArena, SEATS, MIN_PLAYERS, ROUNDS };
