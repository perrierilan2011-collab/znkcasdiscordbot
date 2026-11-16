'use strict';
/*
 * web/table.js — moteur de la table de BLACKJACK multijoueur (côté serveur, c'est lui qui fait foi).
 *
 * Règles : 6 sabots · croupier tient sur tous les 17 · blackjack payé 3:2 · double sur 2 cartes ·
 *          séparation d'une paire (1 seule fois, pas de re-split) · pas d'assurance · le croupier regarde
 *          sa carte cachée si sa carte visible est un As ou une figure (blackjack croupier = fin immédiate).
 * Mise libre : n'importe quel montant (min BJ_MIN_BET, max = solde). L'argent est réellement débité / crédité
 *          via deps.debit / deps.credit (Supabase du bot).
 * Ordre de passage : les places sont jouées de gauche à droite (place 1 → place 5), une main après l'autre.
 */
const { randomInt } = require('crypto');

const SEATS = 5;
const DECKS = 6;
const MIN_BET = Math.max(0.01, Number(process.env.BJ_MIN_BET) || 1);
const MAX_BET = Math.max(MIN_BET, Number(process.env.BJ_MAX_BET) || 100_000_000);
const BET_TIME_MS = 15_000; // compte à rebours des mises (démarre à la 1re mise)
const BET_ALL_READY_MS = 4_000; // si tout le monde a misé
const TURN_MS = 25_000;
const RESULT_MS = 7_000;
const DEAL_STEP_MS = 520;
const DEALER_STEP_MS = 950;
const IDLE_ROUNDS_KICK = 3;
const OFFLINE_KICK_MS = 45_000;

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
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardPts(c.r);
    if (c.r === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}
const isNatural = (h) => h.cards.length === 2 && !h.fromSplit && handInfo(h.cards).total === 21;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Room {
  /**
   * deps : { getBalance(uid), debit(uid, amt) -> newBal|null, credit(uid, amt) -> newBal,
   *          pending: { set(key, amt), del(key) }, stats: { record(uid, name, net, outcome) }, onChange(room), onEmote(room, e) }
   */
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.seats = Array(SEATS).fill(null);
    this.phase = 'betting';
    this.deadline = 0;
    this.turn = null;
    this.dealer = { cards: [], hole: false };
    this.shoe = [];
    this.cardId = 0;
    this.round = 0;
    this.feed = [];
    this.timer = null;
    this.q = Promise.resolve();
    this.shuffled = false;
    this.fresh();
  }

  // ------------------------------------------------------------------ utilitaires
  fresh() {
    const s = [];
    for (let d = 0; d < DECKS; d++) for (const su of SUITS) for (const r of RANKS) s.push({ r, s: su });
    this.shoe = shuffle(s);
    this.cut = 60 + randomInt(40); // carte de coupe : on remélange quand il reste moins de cartes
    this.shuffled = true;
  }
  draw() {
    if (!this.shoe.length) this.fresh();
    const c = this.shoe.pop();
    return { id: ++this.cardId, r: c.r, s: c.s };
  }
  say(text) {
    this.feed.push({ t: Date.now(), text });
    if (this.feed.length > 8) this.feed.shift();
  }
  emit() {
    try {
      this.deps.onChange(this);
    } catch (e) {
      console.error('[bj] emit', e?.message || e);
    }
  }
  /** exécute fn à la suite des autres actions de la table (évite les courses avec les appels async) */
  run(fn) {
    const p = this.q.then(fn, fn);
    this.q = p.catch(() => {});
    return p;
  }
  findSeat(uid) {
    return this.seats.findIndex((p) => p && p.uid === uid);
  }
  inRound(p) {
    return !!p && p.hands.length > 0;
  }
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.run(fn).catch((e) => console.error('[bj] timer', e)), ms);
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
  }
  async setStaked(p, delta) {
    p.staked = floor2((p.staked || 0) + delta);
    const key = `${this.guildId}:${p.uid}`;
    if (p.staked > 0) this.deps.pending.set(key, p.staked);
    else this.deps.pending.del(key);
  }

  // ------------------------------------------------------------------ vue publique (identique pour tous)
  snapshot() {
    const dInfo = handInfo(this.dealer.cards.filter((_, i) => !(this.dealer.hole && i === 1)));
    return {
      now: Date.now(),
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      turn: this.turn,
      shoeLeft: this.shoe.length,
      shuffled: this.shuffled,
      min: MIN_BET,
      dealer: {
        cards: this.dealer.cards.map((c, i) => (this.dealer.hole && i === 1 ? { id: c.id, h: 1 } : { id: c.id, r: c.r, s: c.s })),
        total: this.dealer.cards.length ? dInfo.total : 0,
        soft: dInfo.soft,
        bj: !this.dealer.hole && this.dealer.cards.length === 2 && handInfo(this.dealer.cards).total === 21,
      },
      seats: this.seats.map((p) =>
        p
          ? {
              uid: p.uid,
              name: p.name,
              avatar: p.avatar,
              bal: p.bal,
              bet: p.bet,
              lastBet: p.lastBet,
              online: p.online !== false,
              leaving: !!p.leaving,
              hands: p.hands.map((h) => {
                const i = handInfo(h.cards);
                return {
                  cards: h.cards.map((c) => ({ id: c.id, r: c.r, s: c.s })),
                  bet: h.bet,
                  total: i.total,
                  soft: i.soft && i.total < 21,
                  state: h.state, // play | stand | bust | bj | 21 | done
                  doubled: !!h.doubled,
                  result: h.result || null, // win | lose | push | bj | bust
                  net: h.net ?? null,
                };
              }),
            }
          : null
      ),
      feed: this.feed,
    };
  }

  // ------------------------------------------------------------------ places
  sit(user, idx, bal) {
    if (!(idx >= 0 && idx < SEATS)) throw new Error('Place invalide.');
    if (this.findSeat(user.uid) >= 0) throw new Error('Tu es déjà assis à cette table.');
    if (this.seats[idx]) throw new Error('Place déjà prise.');
    this.seats[idx] = {
      uid: user.uid,
      name: user.name,
      avatar: user.avatar,
      bal,
      bet: 0,
      lastBet: 0,
      hands: [],
      idle: 0,
      staked: 0,
      online: true,
    };
    this.say(`🪑 ${user.name} prend la place ${idx + 1}`);
    this.emit();
  }

  async leave(uid) {
    const idx = this.findSeat(uid);
    if (idx < 0) return;
    const p = this.seats[idx];
    if (this.phase === 'betting') {
      await this.refundBet(p);
      this.seats[idx] = null;
      this.say(`🚪 ${p.name} quitte la table`);
      this.emit();
      this.checkBettingReady();
      return;
    }
    if (this.inRound(p)) {
      p.leaving = true; // il part à la fin de la manche ; ses mains restent jouées (stand auto)
      if (this.turn && this.turn.seat === idx) await this.act(uid, 'stand', true);
      this.say(`🚪 ${p.name} quittera la table à la fin de la manche`);
      this.emit();
    } else {
      this.seats[idx] = null;
      this.say(`🚪 ${p.name} quitte la table`);
      this.emit();
    }
  }

  async refundBet(p) {
    if (p.bet > 0) {
      p.bal = await this.deps.credit(p.uid, p.bet);
      await this.setStaked(p, -p.bet);
      p.bet = 0;
    }
  }

  // ------------------------------------------------------------------ mises
  async setBet(uid, amount) {
    if (this.phase !== 'betting') throw new Error('Les mises sont fermées.');
    const idx = this.findSeat(uid);
    if (idx < 0) throw new Error('Assieds-toi d’abord à une place.');
    const p = this.seats[idx];
    let a = floor2(Number(amount));
    if (!Number.isFinite(a) || a < 0) throw new Error('Montant invalide.');
    if (a > 0 && a < MIN_BET) throw new Error(`Mise minimale : ${MIN_BET}.`);
    if (a > MAX_BET) a = MAX_BET;
    const diff = floor2(a - p.bet);
    if (diff > 0) {
      const nb = await this.deps.debit(uid, diff);
      if (nb === null) throw new Error('Solde insuffisant.');
      p.bal = nb;
      await this.setStaked(p, diff);
    } else if (diff < 0) {
      p.bal = await this.deps.credit(uid, -diff);
      await this.setStaked(p, diff);
    }
    p.bet = a;
    p.idle = 0;
    this.emit();
    this.checkBettingReady();
  }

  checkBettingReady() {
    if (this.phase !== 'betting') return;
    const seated = this.seats.filter(Boolean);
    const bettors = seated.filter((p) => p.bet > 0);
    if (!bettors.length) {
      this.clearTimer();
      this.emit();
      return;
    }
    const all = bettors.length === seated.length;
    const remaining = this.deadline ? this.deadline - Date.now() : Infinity;
    if (!this.deadline) this.setTimer(all ? BET_ALL_READY_MS : BET_TIME_MS, () => this.deal());
    else if (all && remaining > BET_ALL_READY_MS) this.setTimer(BET_ALL_READY_MS, () => this.deal());
    this.emit();
  }

  // ------------------------------------------------------------------ distribution
  async deal() {
    if (this.phase !== 'betting') return;
    const players = this.seats.map((p, i) => ({ p, i })).filter((x) => x.p && x.p.bet > 0);
    if (!players.length) {
      this.clearTimer();
      this.emit();
      return;
    }
    this.clearTimer();
    this.phase = 'dealing';
    this.round++;
    this.turn = null;
    this.shuffled = false;
    if (this.shoe.length < this.cut) {
      this.fresh();
      this.say('🔀 Le sabot est remélangé');
    }
    this.dealer = { cards: [], hole: true };
    for (const { p } of players) {
      p.hands = [{ cards: [], bet: p.bet, state: 'play', doubled: false, fromSplit: false }];
      p.lastBet = p.bet;
      p.bet = 0;
    }
    for (const p of this.seats) if (p && !p.hands.length) p.idle++;
    this.emit();
    await sleep(500);
    for (let pass = 0; pass < 2; pass++) {
      for (const { p } of players) {
        p.hands[0].cards.push(this.draw());
        this.emit();
        await sleep(DEAL_STEP_MS);
      }
      this.dealer.cards.push(this.draw());
      this.emit();
      await sleep(DEAL_STEP_MS);
    }
    for (const { p } of players) {
      const h = p.hands[0];
      if (isNatural(h)) h.state = 'bj';
    }
    const up = this.dealer.cards[0];
    const peek = cardPts(up.r) >= 10;
    if (peek && handInfo(this.dealer.cards).total === 21) {
      this.say('🂡 Blackjack du croupier !');
      this.emit();
      await sleep(900);
      return this.dealerPlay(true);
    }
    this.phase = 'playing';
    this.emit();
    await sleep(350);
    return this.nextTurn();
  }

  // ------------------------------------------------------------------ tours de jeu
  nextTurn() {
    for (let i = 0; i < SEATS; i++) {
      const p = this.seats[i];
      if (!p) continue;
      for (let k = 0; k < p.hands.length; k++) {
        const h = p.hands[k];
        if (h.state === 'play') {
          this.turn = { seat: i, hand: k };
          const ms = p.online === false || p.leaving ? 3000 : TURN_MS;
          this.setTimer(ms, () => this.act(p.uid, 'stand', true));
          this.emit();
          return;
        }
      }
    }
    this.turn = null;
    this.clearTimer();
    return this.dealerPlay(false);
  }

  /** action d'un joueur : hit | stand | double | split. `auto` = déclenchée par le serveur (timeout) */
  async act(uid, action, auto = false) {
    if (this.phase !== 'playing' || !this.turn) throw new Error('Ce n’est pas ton tour.');
    const p = this.seats[this.turn.seat];
    if (!p || p.uid !== uid) throw new Error('Ce n’est pas ton tour.');
    const h = p.hands[this.turn.hand];
    if (!h || h.state !== 'play') throw new Error('Main terminée.');
    if (!auto) this.clearTimer();

    if (action === 'stand') {
      h.state = 'stand';
      this.clearTimer();
      this.emit();
      await sleep(250);
      return this.nextTurn();
    }
    if (action === 'hit') {
      this.clearTimer();
      h.cards.push(this.draw());
      this.afterCard(h);
      this.emit();
      await sleep(DEAL_STEP_MS);
      return this.nextTurn(); // même main si encore en jeu (timer relancé), sinon joueur suivant
    }
    if (action === 'double') {
      if (h.cards.length !== 2) throw new Error('Doubler : seulement sur 2 cartes.');
      const nb = await this.deps.debit(uid, h.bet);
      if (nb === null) {
        this.setTimer(TURN_MS, () => this.act(uid, 'stand', true));
        throw new Error('Solde insuffisant pour doubler.');
      }
      p.bal = nb;
      await this.setStaked(p, h.bet);
      this.clearTimer();
      h.bet = floor2(h.bet * 2);
      h.doubled = true;
      h.cards.push(this.draw());
      this.afterCard(h);
      if (h.state === 'play') h.state = 'stand';
      this.emit();
      await sleep(DEALER_STEP_MS * 0.8);
      return this.nextTurn();
    }
    if (action === 'split') {
      if (p.hands.length !== 1 || h.cards.length !== 2 || cardPts(h.cards[0].r) !== cardPts(h.cards[1].r)) {
        throw new Error('Séparation impossible.');
      }
      const nb = await this.deps.debit(uid, h.bet);
      if (nb === null) {
        this.setTimer(TURN_MS, () => this.act(uid, 'stand', true));
        throw new Error('Solde insuffisant pour séparer.');
      }
      p.bal = nb;
      await this.setStaked(p, h.bet);
      this.clearTimer();
      const aces = h.cards[0].r === 'A';
      const second = { cards: [h.cards.pop()], bet: h.bet, state: 'play', doubled: false, fromSplit: true };
      h.fromSplit = true;
      p.hands.push(second);
      this.emit();
      await sleep(DEAL_STEP_MS);
      for (const hh of p.hands) {
        hh.cards.push(this.draw());
        this.afterCard(hh);
        if (aces && hh.state === 'play') hh.state = 'stand'; // As séparés : 1 seule carte chacun
        this.emit();
        await sleep(DEAL_STEP_MS);
      }
      return this.nextTurn();
    }
    throw new Error('Action inconnue.');
  }

  afterCard(h) {
    const t = handInfo(h.cards).total;
    if (t > 21) h.state = 'bust';
    else if (t === 21) h.state = '21';
  }

  // ------------------------------------------------------------------ croupier + paiements
  async dealerPlay(natural) {
    this.phase = 'dealer';
    this.turn = null;
    this.clearTimer();
    this.emit();
    await sleep(500);
    this.dealer.hole = false; // la carte cachée se retourne
    this.emit();
    await sleep(DEALER_STEP_MS);
    if (!natural) {
      const live = this.seats.some((p) => p && p.hands.some((h) => h.state === 'stand' || h.state === '21'));
      if (live) {
        while (handInfo(this.dealer.cards).total < 17) {
          this.dealer.cards.push(this.draw());
          this.emit();
          await sleep(DEALER_STEP_MS);
        }
      }
    }
    return this.settle();
  }

  async settle() {
    const dInfo = handInfo(this.dealer.cards);
    const dBust = dInfo.total > 21;
    const dBJ = this.dealer.cards.length === 2 && dInfo.total === 21;
    const recapPlayers = [];
    for (const p of this.seats) {
      if (!p || !p.hands.length) continue;
      let payout = 0;
      let net = 0;
      let outcome = 'lose';
      for (const h of p.hands) {
        const t = handInfo(h.cards).total;
        let back = 0;
        if (h.state === 'bust') h.result = 'bust';
        else if (h.state === 'bj' && !dBJ) {
          back = floor2(h.bet * 2.5);
          h.result = 'bj';
        } else if (dBJ) {
          if (h.state === 'bj') {
            back = h.bet;
            h.result = 'push';
          } else h.result = 'lose';
        } else if (dBust || t > dInfo.total) {
          back = floor2(h.bet * 2);
          h.result = 'win';
        } else if (t === dInfo.total) {
          back = h.bet;
          h.result = 'push';
        } else h.result = 'lose';
        h.net = floor2(back - h.bet);
        payout += back;
        net += h.net;
      }
      let paid = true;
      if (payout > 0) {
        try {
          p.bal = await this.deps.credit(p.uid, payout);
        } catch (e) {
          paid = false;
          console.error('[bj] credit KO', p.uid, payout, e?.message || e);
        }
      }
      if (paid) await this.setStaked(p, -p.staked);
      net = floor2(net);
      const results = p.hands.map((h) => h.result);
      outcome = results.includes('bj') ? 'bj' : net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
      try {
        this.deps.stats.record(p.uid, p.name, net, outcome);
      } catch {
        /* stats facultatives */
      }
      recapPlayers.push({ uid: p.uid, name: p.name, bet: floor2(p.hands.reduce((x, h) => x + h.bet, 0)), net, outcome, hands: p.hands.map((h) => ({ cards: h.cards.map((c) => c.r + c.s), total: handInfo(h.cards).total, result: h.result })) });
      if (net > 0) this.say(`🏆 ${p.name} gagne ${net}`);
      else if (net < 0) this.say(`💸 ${p.name} perd ${-net}`);
      else this.say(`🤝 ${p.name} : égalité`);
    }
    this.phase = 'result';
    this.setTimer(RESULT_MS, () => this.newRound());
    this.emit();
    // récap envoyé dans le salon des victoires (jamais bloquant)
    try {
      if (recapPlayers.length && this.deps.onRoundEnd) {
        this.deps.onRoundEnd({ game: 'blackjack', round: this.round, dealer: { cards: this.dealer.cards.map((c) => c.r + c.s), total: dInfo.total, bust: dBust, bj: dBJ }, players: recapPlayers });
      }
    } catch (e) {
      console.error('[bj] recap', e?.message || e);
    }
  }

  async newRound() {
    this.turn = null;
    for (let i = 0; i < SEATS; i++) {
      const p = this.seats[i];
      if (!p) continue;
      const kick = p.leaving || p.idle >= IDLE_ROUNDS_KICK || (p.online === false && Date.now() - (p.offlineAt || 0) > OFFLINE_KICK_MS);
      p.hands = [];
      if (kick) {
        this.seats[i] = null;
        this.say(`🚪 ${p.name} a quitté la table`);
      }
    }
    this.dealer = { cards: [], hole: false };
    this.phase = 'betting';
    this.clearTimer();
    this.emit();
  }

  // ------------------------------------------------------------------ présence
  setPresence(uid, online) {
    const p = this.seats.find((x) => x && x.uid === uid);
    if (!p) return;
    if (p.online === online) return;
    p.online = online;
    p.offlineAt = online ? 0 : Date.now();
    if (!online) {
      // en attente de mise et déconnecté depuis longtemps : on libère la place
      setTimeout(() => {
        this.run(async () => {
          const idx = this.findSeat(uid);
          if (idx < 0) return;
          const q = this.seats[idx];
          if (q.online !== false || this.phase !== 'betting') return;
          await this.refundBet(q);
          this.seats[idx] = null;
          this.say(`🚪 ${q.name} a quitté la table`);
          this.emit();
          this.checkBettingReady();
        }).catch(() => {});
      }, OFFLINE_KICK_MS + 1000);
    }
    this.emit();
  }

  isEmpty() {
    return this.seats.every((p) => !p);
  }
}

module.exports = { Room, SEATS, MIN_BET, MAX_BET, handInfo, cardPts };
