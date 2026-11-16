'use strict';
/*
 * web/poker.js — moteur de la table de POKER multijoueur (Texas Hold'em No-Limit), côté serveur : c'est lui qui fait foi.
 * Même table que le blackjack : 5 places, tapis violet, une table par serveur Discord.
 *
 * Règles : blinds fixes (POKER_BB, petite blind = moitié) · bouton du donneur qui tourne · heads-up géré (le bouton est
 *          petite blind) · pré-flop / flop / turn / river · relance minimale = dernière relance · tapis (all-in) avec
 *          pots annexes (side pots) · abattage : meilleure main de 5 cartes parmi 7 · égalité = pot partagé.
 * Argent : cave (buy-in) débitée au moment de s'asseoir (deps.debit), jetons de la table = « stack ».
 *          Le stack est recrédité quand on quitte la table (deps.credit). Si le bot plante en pleine main, le stack
 *          (+ ce qui est engagé) est remboursé au redémarrage (deps.pending, même mécanisme que le blackjack).
 * Variables facultatives : POKER_BB (défaut 10), POKER_MIN_BUYIN (défaut 20 BB), POKER_MAX_BUYIN (défaut 500 BB).
 * Cartes cachées : snapshot(uid) est PERSONNALISÉ — chacun ne voit que ses cartes (+ celles montrées à l'abattage).
 */
const { randomInt } = require('crypto');

const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEATS = 5;
const BB = Math.max(0.02, floor2(Number(process.env.POKER_BB) || 10));
const SB = Math.max(0.01, floor2(BB / 2));
const MIN_BUYIN = Math.max(BB * 2, floor2(Number(process.env.POKER_MIN_BUYIN) || BB * 20));
const MAX_BUYIN = Math.max(MIN_BUYIN, floor2(Number(process.env.POKER_MAX_BUYIN) || BB * 500));
const TURN_MS = 25_000;
const START_MS = 4_000; // délai avant le début d'une main quand ≥ 2 joueurs sont prêts
const RESULT_MS = 6_500;
const DEAL_STEP_MS = 420;
const STREET_MS = 750;
const RUNOUT_MS = 1_200; // tapis : les cartes restantes sont retournées une à une
const IDLE_ROUNDS_KICK = 3;
const OFFLINE_KICK_MS = 45_000;
const STREETS = ['preflop', 'flop', 'turn', 'river'];

const INFO = { sb: SB, bb: BB, min: MIN_BUYIN, max: MAX_BUYIN, seats: SEATS };

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RV = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const RL = (v) => (v <= 10 ? String(v) : { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[v]);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const newDeck = () => shuffle(RANKS.flatMap((r) => SUITS.map((s) => ({ r, s }))));

// ---------------------------------------------------------------- évaluation des mains
// score = catégorie * 15^5 + 5 départages (base 15) : comparables directement avec > / <
function score5(cs) {
  const vals = cs.map((c) => RV[c.r]).sort((a, b) => b - a);
  const flush = cs.every((c) => c.s === cs[0].s);
  let straight = 0;
  if (new Set(vals).size === 5) {
    if (vals[0] - vals[4] === 4) straight = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) straight = 5; // la roue A-2-3-4-5
  }
  const cnt = {};
  for (const v of vals) cnt[v] = (cnt[v] || 0) + 1;
  const g = Object.entries(cnt).map(([v, c]) => [c, Number(v)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let cat, tb;
  if (straight && flush) { cat = 8; tb = [straight]; }
  else if (g[0][0] === 4) { cat = 7; tb = [g[0][1], g[1][1]]; }
  else if (g[0][0] === 3 && g[1][0] === 2) { cat = 6; tb = [g[0][1], g[1][1]]; }
  else if (flush) { cat = 5; tb = vals; }
  else if (straight) { cat = 4; tb = [straight]; }
  else if (g[0][0] === 3) { cat = 3; tb = g.map((x) => x[1]); }
  else if (g[0][0] === 2 && g[1][0] === 2) { cat = 2; tb = g.map((x) => x[1]); }
  else if (g[0][0] === 2) { cat = 1; tb = g.map((x) => x[1]); }
  else { cat = 0; tb = vals; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (tb[i] || 0);
  return { s, cat, tb };
}
const COMBOS = [];
for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++) for (let e = d + 1; e < 7; e++) COMBOS.push([a, b, c, d, e]);
function handName(cat, tb) {
  switch (cat) {
    case 8: return tb[0] === 14 ? 'Quinte flush royale' : `Quinte flush au ${RL(tb[0])}`;
    case 7: return `Carré de ${RL(tb[0])}`;
    case 6: return `Full ${RL(tb[0])} par ${RL(tb[1])}`;
    case 5: return `Couleur au ${RL(tb[0])}`;
    case 4: return `Quinte au ${RL(tb[0])}`;
    case 3: return `Brelan de ${RL(tb[0])}`;
    case 2: return `Double paire ${RL(tb[0])} et ${RL(tb[1])}`;
    case 1: return `Paire de ${RL(tb[0])}`;
    default: return `Carte haute ${RL(tb[0])}`;
  }
}
/** meilleure main de 5 cartes parmi 5 à 7 */
function bestHand(cards) {
  let best = null;
  if (cards.length < 7) {
    const idx = cards.length === 5 ? [[0, 1, 2, 3, 4]] : COMBOS.filter((c) => c.every((i) => i < cards.length));
    for (const c of idx) {
      const r = score5(c.map((i) => cards[i]));
      if (!best || r.s > best.s) best = r;
    }
  } else {
    for (const c of COMBOS) {
      const r = score5(c.map((i) => cards[i]));
      if (!best || r.s > best.s) best = r;
    }
  }
  return { s: best.s, cat: best.cat, name: handName(best.cat, best.tb) };
}

/** nom de la main « en cours » (2 à 7 cartes) : sert à l'afficher sous tes cartes */
function liveHandName(cards) {
  if (cards.length >= 5) return bestHand(cards).name;
  const vals = cards.map((c) => RV[c.r]).sort((a, b) => b - a);
  const cnt = {};
  for (const v of vals) cnt[v] = (cnt[v] || 0) + 1;
  const g = Object.entries(cnt).map(([v, c]) => [c, Number(v)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (g[0][0] === 4) return `Carré de ${RL(g[0][1])}`;
  if (g[0][0] === 3) return `Brelan de ${RL(g[0][1])}`;
  if (g[0][0] === 2 && g[1] && g[1][0] === 2) return `Double paire ${RL(g[0][1])} et ${RL(g[1][1])}`;
  if (g[0][0] === 2) return `Paire de ${RL(g[0][1])}`;
  return `Carte haute ${RL(vals[0])}`;
}

class PokerRoom {
  /**
   * deps : { getBalance(uid), debit(uid, amt) -> newBal|null, credit(uid, amt) -> newBal,
   *          pending: { set(key, amt), del(key) }, stats: { record(uid, name, net, outcome) },
   *          onChange(room), onRoundEnd(recap) }
   */
  constructor(guildId, deps) {
    this.guildId = guildId;
    this.deps = deps;
    this.seats = Array(SEATS).fill(null);
    this.phase = 'waiting'; // waiting | dealing | preflop | flop | turn | river | showdown | result
    this.deadline = 0;
    this.turn = null; // index de la place qui doit parler
    this.button = -1;
    this.sbIdx = -1;
    this.bbIdx = -1;
    this.board = [];
    this.deck = [];
    this.cardId = 0;
    this.round = 0;
    this.currentBet = 0;
    this.minRaise = BB;
    this.lastPot = 0;
    this.revealed = false;
    this.feed = [];
    this.timer = null;
    this.q = Promise.resolve();
  }

  // ------------------------------------------------------------------ utilitaires
  say(text) {
    this.feed.push({ t: Date.now(), text });
    if (this.feed.length > 8) this.feed.shift();
  }
  emit() {
    try {
      this.deps.onChange(this);
    } catch (e) {
      console.error('[poker] emit', e?.message || e);
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
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.run(fn).catch((e) => console.error('[poker] timer', e)), ms);
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
  }
  key(p) {
    return `poker-${this.guildId}:${p.uid}`; // ce qui suit « : » = identifiant Discord (remboursement au redémarrage)
  }
  /** argent du joueur actuellement « en jeu » (stack + engagé dans la main) : remboursé si le bot plante */
  syncPending(p) {
    const v = floor2(p.stack + (p.total || 0));
    if (v > 0) this.deps.pending.set(this.key(p), v);
    else this.deps.pending.del(this.key(p));
  }
  draw() {
    const c = this.deck.pop();
    return { id: ++this.cardId, r: c.r, s: c.s };
  }
  canAct(p) {
    return !!p && p.inHand && !p.folded && !p.allin;
  }
  contenders() {
    return this.seats.filter((p) => p && p.inHand && !p.folded);
  }
  potTotal() {
    return floor2(this.seats.reduce((a, p) => a + (p ? p.total : 0), 0));
  }
  eligible() {
    const out = [];
    this.seats.forEach((p, i) => {
      if (p && p.stack > 0 && p.online !== false && !p.leaving) out.push(i);
    });
    return out;
  }
  /** première place de `list` strictement après `from` (en tournant) */
  nextIn(list, from) {
    for (let k = 1; k <= SEATS; k++) {
      const i = (from + k) % SEATS;
      if (list.includes(i)) return i;
    }
    return list[0];
  }
  resetHandFields(p) {
    p.inHand = false;
    p.folded = false;
    p.allin = false;
    p.bet = 0;
    p.total = 0;
    p.acted = false;
    p.noRaise = false;
    p.cards = [];
    p.last = null;
    p.show = false;
    p.ev = null;
    p.handName = null;
    p.won = 0;
    p.net = null;
  }

  // ------------------------------------------------------------------ vue (PERSONNALISÉE : tes cartes seulement)
  snapshot(uid) {
    return {
      now: Date.now(),
      phase: this.phase,
      deadline: this.deadline,
      round: this.round,
      turn: this.turn,
      button: this.button,
      sb: this.sbIdx,
      bb: this.bbIdx,
      blinds: { sb: SB, bb: BB },
      min: MIN_BUYIN,
      max: MAX_BUYIN,
      pot: this.phase === 'result' ? this.lastPot : this.potTotal(),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      board: this.board.map((c) => ({ id: c.id, r: c.r, s: c.s })),
      seats: this.seats.map((p) =>
        p
          ? {
              uid: p.uid,
              name: p.name,
              avatar: p.avatar,
              stack: p.stack,
              online: p.online !== false,
              leaving: !!p.leaving,
              inHand: p.inHand,
              folded: p.folded,
              allin: p.allin,
              bet: p.bet,
              noRaise: !!p.noRaise,
              last: p.last,
              cards: p.cards.map((c) => (p.uid === uid || p.show ? { id: c.id, r: c.r, s: c.s } : { id: c.id, h: 1 })),
              hand: p.show ? p.handName : null,
              live: p.uid === uid && p.inHand && !p.folded && p.cards.length >= 2 ? liveHandName([...p.cards, ...this.board]) : null,
              won: p.won || 0,
              net: p.net,
            }
          : null
      ),
      feed: this.feed,
    };
  }

  // ------------------------------------------------------------------ places & argent
  async sit(user, idx, amount) {
    if (!(idx >= 0 && idx < SEATS)) throw new Error('Place invalide.');
    if (this.findSeat(user.uid) >= 0) throw new Error('Tu es déjà assis à cette table.');
    if (this.seats[idx]) throw new Error('Place déjà prise.');
    const a = floor2(Number(amount));
    if (!Number.isFinite(a) || a <= 0) throw new Error('Montant invalide.');
    if (a < MIN_BUYIN) throw new Error(`Cave minimale : ${MIN_BUYIN}.`);
    if (a > MAX_BUYIN) throw new Error(`Cave maximale : ${MAX_BUYIN}.`);
    const nb = await this.deps.debit(user.uid, a);
    if (nb === null) throw new Error('Solde insuffisant.');
    const p = { uid: user.uid, name: user.name, avatar: user.avatar, stack: a, online: true, leaving: false, idle: 0 };
    this.resetHandFields(p);
    this.seats[idx] = p;
    this.syncPending(p);
    this.say(`🪑 ${p.name} prend la place ${idx + 1} (${a})`);
    this.emit();
    this.checkStart();
  }

  /** ajouter des jetons (entre deux mains uniquement) */
  async addChips(uid, amount) {
    const p = this.seats[this.findSeat(uid)];
    if (!p) throw new Error('Assieds-toi d’abord à une place.');
    if (p.inHand && this.phase !== 'waiting' && this.phase !== 'result') throw new Error('Tu pourras ajouter des jetons entre deux mains.');
    const a = floor2(Number(amount));
    if (!Number.isFinite(a) || a <= 0) throw new Error('Montant invalide.');
    if (floor2(p.stack + a) > MAX_BUYIN) throw new Error(`Cave maximale : ${MAX_BUYIN} (tu en as ${p.stack}).`);
    if (floor2(p.stack + a) < BB * 2) throw new Error(`Il faut au moins ${BB * 2} jetons à table.`);
    const nb = await this.deps.debit(uid, a);
    if (nb === null) throw new Error('Solde insuffisant.');
    p.stack = floor2(p.stack + a);
    this.syncPending(p);
    this.say(`➕ ${p.name} ajoute ${a}`);
    this.emit();
    this.checkStart();
  }

  /** rend le stack au portefeuille. false si le crédit a échoué (le remboursement reste dû au redémarrage) */
  async cashOut(p) {
    const amt = floor2(p.stack);
    if (amt > 0) {
      try {
        await this.deps.credit(p.uid, amt);
        p.stack = 0;
      } catch (e) {
        console.error('[poker] cashout KO', p.uid, amt, e?.message || e);
        return false;
      }
    }
    this.deps.pending.del(this.key(p));
    return true;
  }

  async leave(uid) {
    const idx = this.findSeat(uid);
    if (idx < 0) return;
    const p = this.seats[idx];
    const streetNow = STREETS.includes(this.phase);
    if (p.inHand && (streetNow || this.phase === 'dealing' || this.phase === 'showdown' || this.phase === 'result')) {
      // en pleine main : il se couche et part à la fin de la main (son stack lui est rendu à ce moment)
      p.leaving = true;
      if (streetNow && !p.folded && !p.allin) {
        if (this.turn === idx) await this.act(uid, 'fold', 0, true);
        else await this.foldOut(p);
      }
      this.say(`🚪 ${p.name} quittera la table à la fin de la main`);
      this.emit();
      return;
    }
    await this.cashOut(p);
    this.seats[idx] = null;
    this.say(`🚪 ${p.name} quitte la table`);
    this.emit();
    this.checkStart();
  }

  // ------------------------------------------------------------------ démarrage d'une main
  checkStart() {
    if (this.phase !== 'waiting') return;
    if (this.eligible().length < 2) {
      this.clearTimer();
      this.emit();
      return;
    }
    if (!this.deadline) this.setTimer(START_MS, () => this.startHand());
    this.emit();
  }

  commit(p, amount) {
    const a = Math.min(floor2(amount), p.stack);
    if (a <= 0) return 0;
    p.stack = floor2(p.stack - a);
    p.bet = floor2(p.bet + a);
    p.total = floor2(p.total + a);
    if (p.stack <= 0) p.allin = true;
    this.syncPending(p);
    return a;
  }

  async startHand() {
    if (this.phase !== 'waiting') return;
    const el = this.eligible();
    if (el.length < 2) {
      this.clearTimer();
      this.emit();
      return;
    }
    this.clearTimer();
    this.phase = 'dealing';
    this.round++;
    this.turn = null;
    this.board = [];
    this.deck = newDeck();
    this.revealed = false;
    this.currentBet = 0;
    this.minRaise = BB;
    this.lastPot = 0;
    for (const p of this.seats) if (p) this.resetHandFields(p);
    for (const i of el) this.seats[i].inHand = true;

    this.button = this.nextIn(el, this.button);
    if (el.length === 2) {
      // heads-up : le bouton est petite blind et parle en premier pré-flop
      this.sbIdx = this.button;
      this.bbIdx = this.nextIn(el, this.button);
    } else {
      this.sbIdx = this.nextIn(el, this.button);
      this.bbIdx = this.nextIn(el, this.sbIdx);
    }
    this.commit(this.seats[this.sbIdx], SB);
    this.commit(this.seats[this.bbIdx], BB);
    this.currentBet = Math.max(this.seats[this.sbIdx].bet, this.seats[this.bbIdx].bet);
    this.say(`🃏 Main n°${this.round} · blinds ${SB}/${BB}`);
    this.emit();
    await sleep(450);

    // distribution : 2 cartes chacun, en commençant à gauche du bouton
    const order = [];
    for (let k = 1; k <= SEATS; k++) {
      const i = (this.button + k) % SEATS;
      if (el.includes(i)) order.push(i);
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const i of order) {
        this.seats[i].cards.push(this.draw());
        this.emit();
        await sleep(DEAL_STEP_MS);
      }
    }
    this.phase = 'preflop';
    this.emit();
    await sleep(300);
    return this.nextTurn(this.bbIdx);
  }

  // ------------------------------------------------------------------ tours de mise
  nextTurn(from) {
    if (this.contenders().length < 2) return this.advance();
    const able = this.seats.filter((p) => this.canAct(p));
    if (!able.length || (able.length === 1 && able[0].bet >= this.currentBet)) return this.advance();
    for (let k = 1; k <= SEATS; k++) {
      const i = (from + k) % SEATS;
      const p = this.seats[i];
      if (this.canAct(p) && (!p.acted || p.bet < this.currentBet)) {
        this.turn = i;
        const ms = p.online === false ? 800 : p.leaving ? 500 : TURN_MS;
        this.setTimer(ms, () => this.timeout(p.uid));
        this.emit();
        return;
      }
    }
    return this.advance();
  }

  timeout(uid) {
    if (this.turn == null) return;
    const p = this.seats[this.turn];
    if (!p || p.uid !== uid) return;
    return this.act(uid, p.bet < this.currentBet ? 'fold' : 'check', 0, true);
  }

  /** action d'un joueur : fold | check | call | raise (amount = « relancer à ») | allin */
  async act(uid, action, amount = 0, auto = false) {
    if (!STREETS.includes(this.phase) || this.turn == null) throw new Error('Ce n’est pas ton tour.');
    const idx = this.turn;
    const p = this.seats[idx];
    if (!p || p.uid !== uid) throw new Error('Ce n’est pas ton tour.');
    const toCall = floor2(this.currentBet - p.bet);

    if (action === 'fold') {
      p.folded = true;
      p.last = { a: 'fold' };
      this.say(`${p.name} se couche`);
    } else if (action === 'check') {
      if (toCall > 0) throw new Error('Tu dois suivre ou te coucher.');
      p.acted = true;
      p.last = { a: 'check' };
    } else if (action === 'call') {
      if (toCall <= 0) {
        p.acted = true;
        p.last = { a: 'check' };
      } else {
        this.commit(p, toCall);
        p.acted = true;
        p.last = { a: p.allin ? 'allin' : 'call', v: p.bet };
        if (p.allin) this.say(`${p.name} est à tapis (${p.bet})`);
      }
    } else if (action === 'raise' || action === 'allin') {
      const maxTo = floor2(p.bet + p.stack);
      let target = action === 'allin' ? maxTo : floor2(Number(amount));
      if (!Number.isFinite(target) || target <= 0) throw new Error('Montant invalide.');
      if (target > maxTo) target = maxTo;
      if (target <= this.currentBet) {
        // tapis pour moins que (ou autant que) la mise : c'est un simple « suivre »
        if (action !== 'allin') throw new Error('Une relance doit dépasser la mise actuelle.');
        this.commit(p, toCall);
        p.acted = true;
        p.last = { a: 'allin', v: p.bet };
        this.say(`${p.name} est à tapis (${p.bet})`);
      } else {
        if (p.noRaise) throw new Error('Tu ne peux que suivre ou te coucher (relance non rouverte).');
        const size = floor2(target - this.currentBet);
        const isAll = target >= maxTo;
        if (!isAll && size < this.minRaise) throw new Error(`Relance minimale : ${floor2(this.currentBet + this.minRaise)}.`);
        const open = this.currentBet === 0;
        this.commit(p, floor2(target - p.bet));
        if (size >= this.minRaise) {
          this.minRaise = size;
          for (const q of this.seats) if (q && q !== p && this.canAct(q)) { q.acted = false; q.noRaise = false; }
        } else {
          // relance trop courte (tapis) : elle ne rouvre pas les relances pour ceux qui ont déjà parlé
          for (const q of this.seats) if (q && q !== p && this.canAct(q) && q.acted) q.noRaise = true;
        }
        this.currentBet = floor2(Math.max(this.currentBet, p.bet));
        p.acted = true;
        p.last = { a: p.allin ? 'allin' : 'raise', v: p.bet };
        this.say(p.allin ? `${p.name} est à tapis (${p.bet})` : `${p.name} ${open ? 'mise' : 'relance à'} ${p.bet}`);
      }
    } else throw new Error('Action inconnue.');

    this.clearTimer();
    this.turn = null;
    this.emit();
    await sleep(320);
    return this.nextTurn(idx);
  }

  /** se coucher hors tour (le joueur quitte la table en pleine main) */
  async foldOut(p) {
    if (!STREETS.includes(this.phase) || !p.inHand || p.folded || p.allin) return;
    p.folded = true;
    p.last = { a: 'fold' };
    this.say(`${p.name} se couche`);
    this.emit();
    if (this.contenders().length < 2) {
      this.clearTimer();
      this.turn = null;
      await this.advance();
    }
  }

  // ------------------------------------------------------------------ rues, abattage, paiements
  dealStreet() {
    this.deck.pop(); // brûle une carte
    const n = this.phase === 'preflop' ? 3 : 1;
    for (let i = 0; i < n; i++) this.board.push(this.draw());
    this.phase = this.phase === 'preflop' ? 'flop' : this.phase === 'flop' ? 'turn' : 'river';
    this.emit();
  }

  /** la mise de la rue est terminée : on ramasse, puis rue suivante / abattage / victoire sans abattage */
  async advance() {
    this.turn = null;
    this.clearTimer();
    for (const p of this.seats) {
      if (p && p.inHand) {
        p.bet = 0;
        p.acted = false;
        p.noRaise = false;
        if (!p.folded && !p.allin) p.last = null;
      }
    }
    this.currentBet = 0;
    this.minRaise = BB;
    this.emit();
    for (;;) {
      const cont = this.contenders();
      if (cont.length < 2) return this.settle(cont, true);
      if (this.phase === 'river') return this.showdown();
      const able = this.seats.filter((p) => this.canAct(p)).length;
      if (able < 2 && !this.revealed) {
        // tapis : tout le monde montre ses cartes avant de sortir le reste du board
        this.revealed = true;
        for (const p of cont) { p.show = true; p.handName = null; }
        this.say('🔥 Tapis : les cartes sont retournées');
        this.emit();
        await sleep(1000);
      }
      await sleep(able < 2 ? RUNOUT_MS : STREET_MS);
      this.dealStreet();
      if (able >= 2) {
        await sleep(250);
        return this.nextTurn(this.button);
      }
    }
  }

  async showdown() {
    this.phase = 'showdown';
    this.turn = null;
    this.clearTimer();
    const cont = this.contenders();
    for (const p of cont) {
      p.ev = bestHand([...p.cards, ...this.board]);
      p.handName = p.ev.name;
      p.show = true;
    }
    this.emit();
    await sleep(1300);
    return this.settle(cont, false);
  }

  /** pots principal + annexes à partir de ce que chacun a mis (les mises des joueurs couchés restent dans les pots) */
  buildPots() {
    const rem = this.seats.filter((p) => p && p.total > 0).map((p) => ({ p, rem: p.total }));
    const pots = [];
    for (;;) {
      const live = rem.filter((r) => r.rem > 0 && !r.p.folded);
      if (!live.length) break;
      const lvl = Math.min(...live.map((r) => r.rem));
      let amount = 0;
      for (const r of rem) {
        if (r.rem <= 0) continue;
        const take = Math.min(r.rem, lvl);
        amount = floor2(amount + take);
        r.rem = floor2(r.rem - take);
      }
      pots.push({ amount, eligible: live.map((r) => r.p) });
    }
    const left = floor2(rem.reduce((a, r) => a + r.rem, 0));
    if (left > 0 && pots.length) pots[pots.length - 1].amount = floor2(pots[pots.length - 1].amount + left);
    return pots;
  }

  async settle(cont, uncontested) {
    this.clearTimer();
    this.turn = null;
    const participants = this.seats.filter((p) => p && p.inHand);
    this.lastPot = this.potTotal();
    const pots = this.buildPots();
    const won = new Map();
    const dist = (p) => (this.seats.indexOf(p) - this.button - 1 + SEATS * 2) % SEATS;
    for (const pot of pots) {
      let elig = pot.eligible.filter((p) => !p.folded);
      if (!elig.length) elig = cont;
      if (!elig.length) continue;
      let winners;
      if (uncontested || elig.length === 1) winners = [elig[0]];
      else {
        const best = Math.max(...elig.map((p) => p.ev.s));
        winners = elig.filter((p) => p.ev.s === best);
      }
      winners.sort((a, b) => dist(a) - dist(b));
      const share = floor2(pot.amount / winners.length);
      const rest = floor2(pot.amount - share * winners.length);
      winners.forEach((p, i) => won.set(p.uid, floor2((won.get(p.uid) || 0) + share + (i === 0 ? rest : 0))));
    }

    const recap = [];
    for (const p of participants) {
      const gain = won.get(p.uid) || 0;
      const contributed = p.total;
      p.stack = floor2(p.stack + gain);
      p.won = gain;
      p.net = floor2(gain - contributed);
      p.total = 0;
      p.bet = 0;
      this.syncPending(p);
      try {
        this.deps.stats.record(p.uid, p.name, p.net, p.net > 0 ? 'win' : p.net < 0 ? 'lose' : 'push');
      } catch {
        /* stats facultatives */
      }
      if (p.net > 0) this.say(`🏆 ${p.name} gagne ${p.net}${p.show && p.handName ? ` (${p.handName})` : ''}`);
      recap.push({
        uid: p.uid,
        name: p.name,
        bet: contributed,
        win: gain,
        net: p.net,
        detail: uncontested ? 'tous les autres se couchent' : p.handName || '',
      });
    }
    this.phase = 'result';
    this.setTimer(RESULT_MS, () => this.newRound());
    this.emit();
    try {
      if (recap.length && this.deps.onRoundEnd) {
        this.deps.onRoundEnd({ game: 'poker', round: this.round, board: this.board.map((c) => c.r + c.s), players: recap });
      }
    } catch (e) {
      console.error('[poker] recap', e?.message || e);
    }
  }

  async newRound() {
    this.turn = null;
    for (let i = 0; i < SEATS; i++) {
      const p = this.seats[i];
      if (!p) continue;
      const played = p.inHand;
      this.resetHandFields(p);
      p.idle = played ? 0 : (p.idle || 0) + 1;
      const broke = p.stack <= 0;
      const kick = broke || p.leaving || p.idle >= IDLE_ROUNDS_KICK || (p.online === false && Date.now() - (p.offlineAt || 0) > OFFLINE_KICK_MS);
      if (kick) {
        await this.cashOut(p);
        this.seats[i] = null;
        this.say(broke ? `💀 ${p.name} n’a plus de jetons` : `🚪 ${p.name} a quitté la table`);
      }
    }
    this.board = [];
    this.sbIdx = -1;
    this.bbIdx = -1;
    this.currentBet = 0;
    this.phase = 'waiting';
    this.clearTimer();
    this.emit();
    this.checkStart();
  }

  // ------------------------------------------------------------------ présence
  setPresence(uid, online) {
    const p = this.seats.find((x) => x && x.uid === uid);
    if (!p || p.online === online) return;
    p.online = online;
    p.offlineAt = online ? 0 : Date.now();
    if (!online) {
      // déconnecté et pas en main : on libère la place (le stack est rendu) après un délai
      setTimeout(() => {
        this.run(async () => {
          const idx = this.findSeat(uid);
          if (idx < 0) return;
          const q = this.seats[idx];
          if (q.online !== false || q.inHand) return; // en main : newRound s'en charge
          await this.cashOut(q);
          this.seats[idx] = null;
          this.say(`🚪 ${q.name} a quitté la table`);
          this.emit();
          this.checkStart();
        }).catch(() => {});
      }, OFFLINE_KICK_MS + 1000);
    }
    this.emit();
    if (!online) this.checkStart();
  }

  isEmpty() {
    return this.seats.every((p) => !p);
  }
}

module.exports = { PokerRoom, INFO, SEATS, bestHand };
