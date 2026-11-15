'use strict';
/*
 * web/offline.js — jeux « offline » SOLO jouables sur le site : mines, fusé (crash) et blackjack.
 * Le serveur fait foi (tirages, multiplicateurs, paiements). Une partie en cours par joueur et par jeu.
 * Argent : débité au lancement, crédité à l'encaissement (deps.debit / deps.credit). Si le bot plante en
 * pleine partie, la mise est remboursée au redémarrage (deps.pending, même mécanisme que la roulette).
 * + pile ou face, dés, chevaux, roulette russe (mêmes règles / cotes que dans le bot Discord).
 * Variables facultatives : OFFLINE_MIN_BET, OFFLINE_MAX_BET.
 */
const { randomInt } = require('crypto');

const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
const MIN_BET = Math.max(0.01, Number(process.env.OFFLINE_MIN_BET) || Number(process.env.BJ_MIN_BET) || 1);
const MAX_BET = Math.max(MIN_BET, Number(process.env.OFFLINE_MAX_BET) || 100_000_000);
const EDGE = 0.97; // retour au joueur : 97 %
const CELLS = 25; // mines : grille 5x5
const RATE = 0.00012; // fusé : le multiplicateur vaut exp(RATE * ms)
const LEAD_MS = 900; // fusé : délai avant décollage
const MAX_CRASH = 10000;
const TYPES = { mines: 'mines', fuse: 'fuse', bj: 'bj', coin: 'coin', dice: 'dice', horses: 'horses', russian: 'russian' };
const INSTANT = new Set(['coin', 'dice', 'horses', 'russian']); // jeux « un coup » : résolus d'un coup côté serveur, animés côté site
const COIN_MULT = 1.95;
const DICE_MULT = { under: 2.3, over: 2.3, seven: 5.8 };
const HORSES = [{ p: 0.4, mult: 2.4 }, { p: 0.25, mult: 3.8 }, { p: 0.18, mult: 5.3 }, { p: 0.11, mult: 8.6 }, { p: 0.06, mult: 15.8 }];

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const minesMult = (m, k) => { let r = EDGE; for (let i = 0; i < k; i++) r *= (CELLS - i) / (CELLS - m - i); return r; };
const round2 = (x) => Math.floor(x * 100) / 100;
const russianMult = (k) => round2((0.96 * 6) / (6 - k));
// tirage d'un jeu « un coup » (le choix du joueur est validé AVANT le débit)
function rollInstant(g) {
  if (g.type === 'coin') {
    if (!['pile', 'face'].includes(g.choice)) throw new Error('Choisis pile ou face.');
    g.side = randomInt(2) ? 'pile' : 'face';
    g.mult = g.side === g.choice ? COIN_MULT : 0;
  } else if (g.type === 'dice') {
    if (!DICE_MULT[g.choice]) throw new Error('Pari invalide.');
    g.a = randomInt(1, 7); g.b = randomInt(1, 7); g.sum = g.a + g.b;
    const out = g.sum < 7 ? 'under' : g.sum > 7 ? 'over' : 'seven';
    g.mult = out === g.choice ? DICE_MULT[g.choice] : 0;
  } else if (g.type === 'horses') {
    const want = Number(g.choice) - 1;
    if (!Number.isInteger(want) || want < 0 || want >= HORSES.length) throw new Error('Cheval invalide.');
    let r = randomInt(1_000_000) / 1_000_000, winner = HORSES.length - 1;
    for (let k = 0; k < HORSES.length; k++) { if (r < HORSES[k].p) { winner = k; break; } r -= HORSES[k].p; }
    g.want = want; g.winner = winner; g.mult = winner === want ? HORSES[want].mult : 0;
  } else {
    const k = Number(g.choice);
    if (!Number.isInteger(k) || k < 1 || k > 5) throw new Error('Nombre de balles invalide (1 à 5).');
    const dead = randomInt(6) < k, others = shuffle([1, 2, 3, 4, 5]);
    const loaded = new Set(dead ? [0, ...others.slice(0, k - 1)] : others.slice(0, k)); // chambre 0 = sous le percuteur
    g.k = k; g.dead = dead; g.chambers = [0, 1, 2, 3, 4, 5].map((n) => loaded.has(n));
    g.mult = dead ? 0 : russianMult(k);
  }
}
const NAMES = { pile: 'Pile', face: 'Face', under: 'Moins de 7', over: 'Plus de 7', seven: 'Exactement 7' };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const newDeck = () => shuffle(RANKS.flatMap((r) => SUITS.map((s) => ({ r, s }))));
const cardVal = (c) => (c.r === 'A' ? 11 : ['K', 'Q', 'J', '10'].includes(c.r) ? 10 : Number(c.r));
function bjVal(cards) { let t = 0, aces = 0; for (const c of cards) { t += cardVal(c); if (c.r === 'A') aces++; } while (t > 21 && aces-- > 0) t -= 10; return t; }
const cs = (c) => c.r + c.s;

function create(deps, pending) {
  const games = new Map();
  const locks = new Map();
  const gk = (u, t) => `${u.guildId}:${u.uid}:${t}`;
  const pk = (u, t) => `off-${t}-${u.guildId}:${u.uid}`; // la partie après « : » doit être l'identifiant Discord (remboursement au redémarrage)
  function lock(k, fn) {
    const p = (locks.get(k) || Promise.resolve()).then(fn, fn);
    const tail = p.catch(() => {});
    locks.set(k, tail);
    tail.then(() => { if (locks.get(k) === tail) locks.delete(k); });
    return p;
  }
  const stake = (u, g, amt) => { g.staked = floor2((g.staked || 0) + amt); pending.set(pk(u, g.type), g.staked); };
  async function end(u, g, back) {
    const stake = g.staked || g.bet;
    g.over = true; g.win = floor2(back);
    if (g.win > 0) g.bal = await deps.credit(u.uid, g.win);
    g.staked = 0; pending.del(pk(u, g.type));
    // récap dans le salon des victoires : uniquement si le joueur a gagné (jamais de message sur une perte / égalité)
    const net = floor2(g.win - stake);
    if (net > 0 && deps.onRoundEnd) {
      const detail = g.type === 'mines' ? `${g.picks.length} case(s) · ${g.m} mine(s)` : g.type === 'fuse' ? `encaissé à ${g.at}x`
        : g.type === 'coin' ? NAMES[g.side] : g.type === 'dice' ? `${g.a}+${g.b}=${g.sum} (${NAMES[g.choice]})`
        : g.type === 'horses' ? `cheval n°${g.winner + 1}` : g.type === 'russian' ? `${g.k} balle${g.k > 1 ? 's' : ''}, survécu` : g.outcome === 'bj' ? 'BLACKJACK' : '';
      try {
        deps.onRoundEnd(u.guildId, { game: g.type === 'bj' ? 'bj-solo' : g.type, players: [{ uid: u.uid, name: u.name, bet: stake, win: g.win, net, mult: floor2(g.win / stake), detail }] });
      } catch (e) { console.error('[offline] recap', e?.message || e); }
    }
  }

  const snaps = {
    mines: (g) => {
      const k = g.picks.length;
      return { type: 'mines', bet: g.bet, mines: g.m, picks: g.picks, hit: g.hit, mult: round2(minesMult(g.m, k)), next: k < CELLS - g.m ? round2(minesMult(g.m, k + 1)) : null,
        cash: floor2(g.bet * minesMult(g.m, k)), over: g.over, win: g.win || 0, mineAt: g.over ? [...g.set] : undefined };
    },
    fuse: (g) => ({ type: 'fuse', bet: g.bet, start: g.start, rate: RATE, auto: g.auto, over: g.over, win: g.win || 0, at: g.over ? g.at : undefined, crash: g.over ? g.cp : undefined }),
    coin: (g) => ({ type: 'coin', bet: g.bet, choice: g.choice, side: g.side, mult: g.mult, over: true, win: g.win || 0, outcome: g.win > 0 ? 'win' : 'lose' }),
    dice: (g) => ({ type: 'dice', bet: g.bet, choice: g.choice, a: g.a, b: g.b, sum: g.sum, mult: g.mult, over: true, win: g.win || 0, outcome: g.win > 0 ? 'win' : 'lose' }),
    horses: (g) => ({ type: 'horses', bet: g.bet, want: g.want, winner: g.winner, mult: g.mult, over: true, win: g.win || 0, outcome: g.win > 0 ? 'win' : 'lose' }),
    russian: (g) => ({ type: 'russian', bet: g.bet, k: g.k, dead: g.dead, chambers: g.chambers, mult: g.mult, over: true, win: g.win || 0, outcome: g.win > 0 ? 'win' : 'lose' }),
    bj: (g) => {
      const dl = g.over ? g.dealer : [g.dealer[0]];
      return { type: 'bj', bet: g.bet, player: g.player.map(cs), dealer: g.over ? g.dealer.map(cs) : [cs(g.dealer[0]), '?'], pv: bjVal(g.player), dv: bjVal(dl),
        over: g.over, outcome: g.outcome, win: g.win || 0, canDouble: !g.over && g.player.length === 2 && !g.doubled };
    },
  };
  async function reply(u, g, fresh) {
    const bal = fresh ? await deps.getBalance(u.uid) : g ? g.bal : undefined;
    return { g: g ? snaps[g.type](g) : null, bal, now: Date.now() };
  }

  // ---------------- fusé
  async function resolveFuse(u, g, now) {
    if (g.over || games.get(gk(u, 'fuse')) !== g) return;
    const m = Math.exp(RATE * Math.max(0, now - g.start));
    if (m >= g.cp) { g.at = null; return end(u, g, 0); }
    if (g.auto && m >= g.auto) { g.at = g.auto; return end(u, g, g.bet * g.auto); }
  }
  function scheduleFuse(u, g) {
    const target = g.auto && g.auto < g.cp ? g.auto : g.cp;
    const delay = Math.max(0, g.start + Math.log(target) / RATE - Date.now()) + 40;
    setTimeout(() => lock(gk(u, 'fuse'), () => resolveFuse(u, g, Date.now())).catch((e) => console.error('[offline] fuse', e?.message || e)), delay);
  }

  // ---------------- blackjack
  async function bjFinish(u, g) {
    const pv = bjVal(g.player);
    if (pv > 21) { g.outcome = 'bust'; return end(u, g, 0); }
    while (bjVal(g.dealer) < 17) g.dealer.push(g.deck.pop());
    const dv = bjVal(g.dealer);
    if (dv > 21 || pv > dv) { g.outcome = 'win'; return end(u, g, g.bet * 2); }
    if (pv === dv) { g.outcome = 'push'; return end(u, g, g.bet); }
    g.outcome = 'lose'; return end(u, g, 0);
  }

  async function handle(u, d) {
    const type = TYPES[d.game];
    if (!type) throw new Error('Jeu inconnu.');
    const action = String(d.action);
    return lock(gk(u, type), async () => {
      const key = gk(u, type);
      let g = games.get(key);
      if (action === 'ostate') {
        if (g && type === 'fuse' && !g.over) await resolveFuse(u, g, Date.now());
        return reply(u, g, !d.poll);
      }
      if (action === 'ostart') {
        const bet = floor2(Number(d.bet));
        if (!Number.isFinite(bet) || bet <= 0) throw new Error('Montant invalide.');
        if (bet < MIN_BET) throw new Error(`Mise minimale : ${MIN_BET}.`);
        if (bet > MAX_BET) throw new Error(`Mise maximale : ${MAX_BET}.`);
        if (g && !g.over) throw new Error('Une partie est déjà en cours.');
        const ng = { type, bet, over: false, win: 0, staked: 0 };
        if (type === 'mines') {
          const m = Number(d.mines);
          if (!Number.isInteger(m) || m < 1 || m > CELLS - 1) throw new Error('Nombre de mines invalide (1 à 24).');
          ng.m = m; ng.picks = []; ng.set = new Set(shuffle([...Array(CELLS).keys()]).slice(0, m));
        } else if (type === 'fuse') {
          const auto = Number(d.auto) || 0;
          if (auto && (auto < 1.01 || auto > MAX_CRASH)) throw new Error('Encaissement auto invalide (minimum 1.01).');
          ng.auto = auto ? round2(auto) : 0;
          ng.cp = Math.min(MAX_CRASH, Math.max(1, round2(EDGE / (1 - randomInt(1_000_000_000) / 1e9))));
          ng.start = Date.now() + LEAD_MS;
        } else if (INSTANT.has(type)) {
          ng.choice = String(d.choice); rollInstant(ng);
        } else {
          ng.deck = newDeck(); ng.player = [ng.deck.pop()]; ng.dealer = [ng.deck.pop()]; ng.player.push(ng.deck.pop()); ng.dealer.push(ng.deck.pop());
        }
        const nb = await deps.debit(u.uid, bet);
        if (nb === null) throw new Error('Solde insuffisant.');
        ng.bal = nb; stake(u, ng, bet); g = ng;
        if (INSTANT.has(type)) { await end(u, g, g.bet * g.mult); return reply(u, g, false); } // un coup : jamais gardé en mémoire
        games.set(key, ng);
        if (type === 'fuse') scheduleFuse(u, g);
        if (type === 'bj') {
          const pb = bjVal(g.player) === 21, db = bjVal(g.dealer) === 21;
          if (pb && db) { g.outcome = 'push'; await end(u, g, g.bet); }
          else if (pb) { g.outcome = 'bj'; await end(u, g, g.bet * 2.5); }
          else if (db) { g.outcome = 'lose'; await end(u, g, 0); }
        }
        return reply(u, g, false);
      }
      if (action === 'omove') {
        if (!g || g.over) throw new Error('Aucune partie en cours.');
        const mv = String(d.move);
        if (type === 'mines') {
          if (mv === 'pick') {
            const i = Number(d.i);
            if (!Number.isInteger(i) || i < 0 || i >= CELLS) throw new Error('Case invalide.');
            if (g.picks.includes(i)) throw new Error('Case déjà révélée.');
            if (g.set.has(i)) { g.hit = i; await end(u, g, 0); }
            else { g.picks.push(i); if (g.picks.length === CELLS - g.m) await end(u, g, g.bet * minesMult(g.m, g.picks.length)); }
          } else if (mv === 'cash') {
            if (!g.picks.length) throw new Error('Révèle au moins une case.');
            await end(u, g, g.bet * minesMult(g.m, g.picks.length));
          } else throw new Error('Action inconnue.');
        } else if (type === 'fuse') {
          if (mv !== 'cash') throw new Error('Action inconnue.');
          const now = Date.now();
          await resolveFuse(u, g, now);
          if (!g.over) { const m = Math.max(1, round2(Math.exp(RATE * Math.max(0, now - g.start)))); g.at = m; await end(u, g, g.bet * m); }
        } else {
          if (mv === 'hit') {
            g.player.push(g.deck.pop());
            if (bjVal(g.player) >= 21) await bjFinish(u, g);
          } else if (mv === 'stand') await bjFinish(u, g);
          else if (mv === 'double') {
            if (g.player.length !== 2 || g.doubled) throw new Error('Doubler est impossible maintenant.');
            const nb = await deps.debit(u.uid, g.bet);
            if (nb === null) throw new Error('Solde insuffisant pour doubler.');
            g.bal = nb; stake(u, g, g.bet); g.bet = floor2(g.bet * 2); g.doubled = true;
            g.player.push(g.deck.pop()); await bjFinish(u, g);
          } else throw new Error('Action inconnue.');
        }
        return reply(u, g, false);
      }
      throw new Error('Action inconnue.');
    });
  }
  return { handle };
}

module.exports = { create, MIN_BET, MAX_BET };
