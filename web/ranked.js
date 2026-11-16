'use strict';
/*
 * web/ranked.js — Ranked Blackjack ZNK : multi 2–6 joueurs, entrée fixe 10 RR.
 * Interface calquée sur le blackjack online. Pot = n×10 RR, réparti par classement.
 */
const { randomInt } = require('crypto');

const SEATS = 6;
const MIN_PLAYERS = 2;
const ENTRY_RR = 10;
const DECKS = 6;
const TURN_MS = 25_000;
const RESULT_MS = 8_000;
const DEAL_STEP_MS = 420;
const DEALER_STEP_MS = 800;
const START_MS = 4_000;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;

function cardPts(r) {
  if (r === 'A') return 11;
  if (r === 'K' || r === 'Q' || r === 'J' || r === '10') return 10;
  return Number(r);
}
function handInfo(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardPts(c.r); if (c.r === 'A') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
const isNatural = (cards) => cards.length === 2 && handInfo(cards).total === 21;
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function shareWeights(n) {
  const w = [];
  for (let i = 0; i < n; i++) w.push(n - i);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

class RankedArena {
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.seats = Array(SEATS).fill(null);
    this.phase = 'lobby';
    this.deadline = 0;
    this.turn = null;
    this.dealer = { cards: [], hole: false };
    this.shoe = [];
    this.cardId = 0;
    this.round = 0;
    this.feed = [];
    this.timer = null;
    this.q = Promise.resolve();
    this.pot = 0;
    this._finalRows = null;
    this.fresh();
  }
  run(fn) { const p = this.q.catch(() => {}).then(fn); this.q = p.catch(() => {}); return p; }
  say(t) { this.feed.push({ t: Date.now(), text: t }); if (this.feed.length > 10) this.feed.shift(); }
  emit() { try { this.deps.onChange(this); } catch (e) { console.error('[ranked] emit', e?.message || e); } }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => { this.timer = null; this.deadline = 0; this.run(fn).catch((e) => console.error('[ranked] timer', e)); }, ms);
  }
  clearTimer() { clearTimeout(this.timer); this.timer = null; this.deadline = 0; }
  findSeat(uid) { return this.seats.findIndex((p) => p && p.uid === uid); }
  fresh() {
    const s = [];
    for (let d = 0; d < DECKS; d++) for (const su of SUITS) for (const r of RANKS) s.push({ r, s: su });
    this.shoe = shuffle(s);
  }
  draw() {
    if (this.shoe.length < 40) this.fresh();
    const c = this.shoe.pop();
    return { id: ++this.cardId, r: c.r, s: c.s };
  }

  snapshot(uid) {
    const dInfo = handInfo(this.dealer.cards.filter((_, i) => !(this.dealer.hole && i === 1)));
    return {
      now: Date.now(), mode: 'ranked', skill: false, game: 'blackjack',
      entry: ENTRY_RR, minPlayers: MIN_PLAYERS, maxPlayers: SEATS,
      phase: this.phase, deadline: this.deadline, round: this.round, turn: this.turn, pot: this.pot,
      shoeLeft: this.shoe.length,
      dealer: {
        cards: this.dealer.cards.map((c, i) => (this.dealer.hole && i === 1 ? { id: c.id, h: 1 } : { id: c.id, r: c.r, s: c.s })),
        total: this.dealer.cards.length ? dInfo.total : 0, soft: dInfo.soft,
        bj: !this.dealer.hole && this.dealer.cards.length === 2 && handInfo(this.dealer.cards).total === 21,
      },
      seats: this.seats.map((p) => p ? {
        uid: p.uid, name: p.name, avatar: p.avatar, online: p.online !== false,
        ready: !!p.ready, inMatch: !!p.inMatch, rr: p.rr, bet: p.bet || 0,
        hands: (p.hands || []).map((h) => {
          const i = handInfo(h.cards);
          return { cards: h.cards.map((c) => ({ id: c.id, r: c.r, s: c.s })), bet: h.bet, total: i.total, soft: i.soft && i.total < 21, state: h.state, result: h.result || null, net: h.net ?? null };
        }),
        place: p.place || null, delta: p.delta ?? null, won: p.won || 0, score: p.rr || 0,
      } : null),
      feed: this.feed,
      rounds: 1, match: this.round, plan: ['blackjack'], gameMode: 'blackjack',
      challenge: null, answered: false, lastRound: null,
      final: this.phase === 'result' ? this._finalRows : null,
    };
  }

  async join(user) {
    if (this.findSeat(user.uid) >= 0) throw new Error('Tu es déjà à la table.');
    if (this.phase !== 'lobby' && this.phase !== 'betting') throw new Error('Main en cours — attends la fin.');
    const idx = this.seats.findIndex((s) => !s);
    if (idx < 0) throw new Error('Table pleine (6 max).');
    let rr = ENTRY_RR;
    try { if (this.deps.getRR) rr = await this.deps.getRR(user.uid); } catch {}
    if (rr < ENTRY_RR) throw new Error(`Il te faut ${ENTRY_RR} RR (tu en as ${Math.floor(rr)}).`);
    this.seats[idx] = { uid: user.uid, name: user.name, avatar: user.avatar, online: true, ready: false, inMatch: false, rr, bet: 0, hands: [], place: null, delta: null, won: 0 };
    this.say(user.name + ' rejoint la table ranked');
    this.checkStart(); this.emit();
  }

  async leave(uid) {
    const idx = this.findSeat(uid);
    if (idx < 0) return;
    const p = this.seats[idx];
    if (p.inMatch && this.phase !== 'lobby' && this.phase !== 'result') {
      p.online = false; this.say(p.name + ' a abandonné');
      if (this.turn && this.turn.seat === idx) await this.act(uid, 'stand', true);
      this.emit(); return;
    }
    if (p.bet > 0 && (this.phase === 'lobby' || this.phase === 'betting')) {
      try { if (this.deps.creditRR) await this.deps.creditRR(p.uid, p.bet); } catch (e) { console.error('[ranked] refund', e?.message || e); }
      this.pot = floor2(this.pot - p.bet); p.bet = 0;
    }
    this.seats[idx] = null; this.say(p.name + ' quitte la table'); this.checkStart(); this.emit();
  }

  async ready(uid, on = true) {
    if (this.phase !== 'lobby' && this.phase !== 'betting') throw new Error('Main en cours.');
    const p = this.seats[this.findSeat(uid)];
    if (!p) throw new Error('Rejoins d’abord la table.');
    if (on && !p.bet) {
      let ok = null;
      try { if (this.deps.debitRR) ok = await this.deps.debitRR(p.uid, ENTRY_RR); } catch (e) { throw new Error(e?.message || 'Impossible de débiter les RR.'); }
      if (ok === null) throw new Error(`Solde RR insuffisant (besoin ${ENTRY_RR}).`);
      p.rr = typeof ok === 'number' ? ok : p.rr - ENTRY_RR;
      p.bet = ENTRY_RR; this.pot = floor2(this.pot + ENTRY_RR);
      this.say(`${p.name} mise ${ENTRY_RR} RR`);
    }
    if (!on && p.bet > 0) {
      try { if (this.deps.creditRR) p.rr = await this.deps.creditRR(p.uid, p.bet); } catch {}
      this.pot = floor2(this.pot - p.bet); p.bet = 0;
    }
    p.ready = !!on && p.bet > 0;
    this.checkStart(); this.emit();
  }

  checkStart() {
    if (this.phase !== 'lobby' && this.phase !== 'betting') return;
    this.phase = 'lobby';
    const seated = this.seats.filter(Boolean);
    const ready = seated.filter((p) => p.ready && p.bet > 0);
    if (ready.length >= MIN_PLAYERS && ready.length === seated.length) {
      if (!this.deadline) this.setTimer(START_MS, () => this.startHand());
    } else this.clearTimer();
    this.emit();
  }

  async startHand() {
    const players = this.seats.map((p, i) => ({ p, i })).filter((x) => x.p && x.p.ready && x.p.bet > 0);
    if (players.length < MIN_PLAYERS) { this.clearTimer(); this.phase = 'lobby'; this.emit(); return; }
    this.clearTimer(); this.phase = 'dealing'; this.round++; this.turn = null;
    this.dealer = { cards: [], hole: true }; this._finalRows = null;
    for (const { p } of players) {
      p.inMatch = true; p.hands = [{ cards: [], bet: p.bet, state: 'play', result: null, net: null }];
      p.place = null; p.delta = null; p.won = 0;
    }
    for (const p of this.seats) if (p && !p.inMatch) p.ready = false;
    this.say(`Main #${this.round} · pot ${this.pot} RR · ${players.length} joueurs`);
    this.emit(); await sleep(400);
    for (let pass = 0; pass < 2; pass++) {
      for (const { p } of players) { p.hands[0].cards.push(this.draw()); this.emit(); await sleep(DEAL_STEP_MS); }
      this.dealer.cards.push(this.draw()); this.emit(); await sleep(DEAL_STEP_MS);
    }
    for (const { p } of players) if (isNatural(p.hands[0].cards)) p.hands[0].state = 'bj';
    const up = this.dealer.cards[0];
    if (cardPts(up.r) >= 10 && handInfo(this.dealer.cards).total === 21) {
      this.say('Blackjack du croupier'); this.emit(); await sleep(700); return this.dealerPlay(true);
    }
    this.phase = 'playing'; this.emit(); await sleep(250); return this.nextTurn();
  }

  nextTurn() {
    for (let i = 0; i < SEATS; i++) {
      const p = this.seats[i]; if (!p || !p.inMatch) continue;
      for (let k = 0; k < p.hands.length; k++) {
        if (p.hands[k].state === 'play') {
          this.turn = { seat: i, hand: k };
          this.setTimer(p.online === false ? 2500 : TURN_MS, () => this.act(p.uid, 'stand', true));
          this.emit(); return;
        }
      }
    }
    this.turn = null; this.clearTimer(); return this.dealerPlay(false);
  }

  async act(uid, action, auto = false) {
    if (this.phase !== 'playing' || !this.turn) throw new Error('Ce n’est pas ton tour.');
    const p = this.seats[this.turn.seat];
    if (!p || p.uid !== uid) throw new Error('Ce n’est pas ton tour.');
    const h = p.hands[this.turn.hand];
    if (!h || h.state !== 'play') throw new Error('Main terminée.');
    if (!auto) this.clearTimer();
    if (action === 'stand') { h.state = 'stand'; this.emit(); await sleep(200); return this.nextTurn(); }
    if (action === 'hit') {
      h.cards.push(this.draw());
      const t = handInfo(h.cards).total;
      if (t > 21) h.state = 'bust'; else if (t === 21) h.state = '21';
      this.emit(); await sleep(DEAL_STEP_MS); return this.nextTurn();
    }
    throw new Error('Action inconnue (hit / stand uniquement).');
  }

  async dealerPlay(natural) {
    this.phase = 'dealer'; this.turn = null; this.clearTimer(); this.emit(); await sleep(400);
    this.dealer.hole = false; this.emit(); await sleep(DEALER_STEP_MS);
    if (!natural) {
      const live = this.seats.some((p) => p && p.inMatch && p.hands.some((h) => h.state === 'stand' || h.state === '21' || h.state === 'bj'));
      if (live) while (handInfo(this.dealer.cards).total < 17) { this.dealer.cards.push(this.draw()); this.emit(); await sleep(DEALER_STEP_MS); }
    }
    return this.settle();
  }

  handScore(h, dTotal, dBJ) {
    const t = handInfo(h.cards).total;
    if (h.state === 'bust' || t > 21) return -1000 + t;
    const bj = h.state === 'bj' || isNatural(h.cards);
    if (dBJ) return bj ? 500 : 100 + t;
    if (bj) return 900;
    if (dTotal > 21) return 700 + t;
    if (t > dTotal) return 600 + t;
    if (t === dTotal) return 400 + t;
    return 200 + t;
  }

  async settle() {
    const dInfo = handInfo(this.dealer.cards);
    const dBJ = this.dealer.cards.length === 2 && dInfo.total === 21;
    const participants = this.seats.filter((p) => p && p.inMatch && p.bet > 0);
    const ranked = participants.map((p) => {
      let best = -9999;
      for (const h of p.hands) { const s = this.handScore(h, dInfo.total, dBJ); if (s > best) best = s; }
      return { p, score: best };
    });
    ranked.sort((a, b) => b.score - a.score || a.p.uid.localeCompare(b.p.uid));
    const n = ranked.length;
    const weights = shareWeights(n);
    const pot = this.pot;
    let place = 1;
    const rows = [];
    for (let i = 0; i < n; i++) {
      if (i > 0 && ranked[i].score < ranked[i - 1].score) place = i + 1;
      const share = floor2(pot * weights[i]);
      const p = ranked[i].p;
      p.place = place; p.won = share; p.delta = floor2(share - p.bet);
      for (const h of p.hands) { h.net = p.delta; h.result = p.delta > 0 ? 'win' : p.delta < 0 ? 'lose' : 'push'; }
      try { if (share > 0 && this.deps.creditRR) p.rr = await this.deps.creditRR(p.uid, share); } catch (e) { console.error('[ranked] creditRR', p.uid, share, e?.message || e); }
      rows.push({ uid: p.uid, name: p.name, avatar: p.avatar, place, score: share, bet: p.bet, net: p.delta });
      this.say(`${p.name} #${place} · ${p.delta >= 0 ? '+' : ''}${p.delta} RR`);
    }
    try {
      if (this.deps.rankRecord) this.deps.rankRecord(rows.map((r) => ({ uid: r.uid, name: r.name, place: r.place, avatar: r.avatar })));
    } catch (e) { console.error('[ranked] rankRecord', e?.message || e); }
    this._finalRows = rows; this.phase = 'result'; this.pot = 0; this.emit();
    try { if (this.deps.onMatchEnd) this.deps.onMatchEnd({ game: 'ranked', players: rows }); } catch (e) { console.error('[ranked] onMatchEnd', e?.message || e); }
    this.setTimer(RESULT_MS, () => this.backToLobby());
  }

  async backToLobby() {
    for (let i = 0; i < SEATS; i++) {
      const p = this.seats[i]; if (!p) continue;
      if (p.online === false) { this.seats[i] = null; continue; }
      p.inMatch = false; p.ready = false; p.bet = 0; p.hands = []; p.place = null;
    }
    this.dealer = { cards: [], hole: false }; this.turn = null; this.phase = 'lobby'; this.clearTimer(); this.emit();
  }

  setPresence(uid, online) {
    const p = this.seats.find((x) => x && x.uid === uid);
    if (!p) return; p.online = online; this.emit();
  }
  isEmpty() { return this.seats.every((p) => !p); }
}

module.exports = { RankedArena, SEATS, MIN_PLAYERS, ENTRY_RR, ROUNDS: 1 };
