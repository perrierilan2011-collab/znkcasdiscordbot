'use strict';
/*
 * web/rank.js — rangs (gains cumulés) + ELO du casino ZNK.
 *
 * RANG  : basé sur le TOTAL des gains accumulés, jamais sur le solde. Les pertes ne font jamais descendre :
 *         tu as gagné 100, tu perds tout, tu regagnes 10 => 110 de gains cumulés.
 *         Chaque manche gagnée (profit net > 0, tous les jeux du site) s'ajoute au total.
 * ELO   : duel « implicite » entre les joueurs d'une même manche (poker, blackjack, roulette en ligne).
 *         Les joueurs d'une manche sont comparés deux à deux (celui qui a fait le meilleur résultat « bat » l'autre).
 *         Les jeux solo n'ont pas d'adversaire : ils comptent pour le rang mais pas pour l'ELO.
 *
 * Pour modifier la difficulté des rangs : changer uniquement les seuils (min) dans FAMILIES ci-dessous.
 */
const fs = require('fs');
const path = require('path');

const ROMAN = ['III', 'II', 'I']; // III = bas de palier, I = haut de palier

// fam : nom · c1/c2 : dégradé du logo · sym : emblème · mins : seuils de gains cumulés (1 valeur = palier unique, 3 = III / II / I)
const FAMILIES = [
  { fam: 'Bronze',      c1: '#e0a06a', c2: '#8a4b14', sym: 'chev',  mins: [0, 250, 1000] },
  { fam: 'Argent',      c1: '#f3f4f6', c2: '#8b94a3', sym: 'chev',  mins: [2500, 6000, 15000] },
  { fam: 'Or',          c1: '#fde68a', c2: '#d97706', sym: 'star',  mins: [40000, 100000, 250000] },
  { fam: 'Platine',     c1: '#a5f3fc', c2: '#3b82a6', sym: 'star',  mins: [600000, 1500000, 4000000] },
  { fam: 'Émeraude',    c1: '#86efac', c2: '#047857', sym: 'gem',   mins: [10e6, 25e6, 60e6] },
  { fam: 'Diamant',     c1: '#bae6fd', c2: '#6366f1', sym: 'gem',   mins: [150e6, 400e6, 1e9] },
  { fam: 'Rubis',       c1: '#fda4af', c2: '#9f1239', sym: 'gem',   mins: [2.5e9, 6e9, 15e9] },
  { fam: 'Obsidienne',  c1: '#a78bfa', c2: '#1e1b4b', sym: 'flame', mins: [40e9, 100e9, 250e9] },
  { fam: 'Maître',      c1: '#fcd34d', c2: '#b45309', sym: 'crown', mins: [600e9] },
  { fam: 'Grand Maître', c1: '#f9a8d4', c2: '#be185d', sym: 'crown', mins: [2e12] },
  { fam: 'Champion',    c1: '#67e8f9', c2: '#0e7490', sym: 'crown', mins: [6e12] },
  { fam: 'Légende',     c1: '#fb923c', c2: '#b91c1c', sym: 'wings', mins: [20e12] },
  { fam: 'Mythique',    c1: '#e879f9', c2: '#6d28d9', sym: 'wings', mins: [75e12] },
  { fam: 'Immortel ZNK', c1: '#fff7ad', c2: '#f59e0b', sym: 'wings', mins: [250e12] },
];

const LADDER = [];
FAMILIES.forEach((f, fi) => {
  f.mins.forEach((min, k) => {
    const div = f.mins.length === 3 ? ROMAN[k] : '';
    LADDER.push({ id: LADDER.length, fam: f.fam, fi, div, name: div ? `${f.fam} ${div}` : f.fam, min, c1: f.c1, c2: f.c2, sym: f.sym, pips: f.mins.length === 3 ? k + 1 : 0 });
  });
});

function rankIndex(earned) {
  let i = 0;
  for (let k = 0; k < LADDER.length; k++) if (earned >= LADDER[k].min) i = k;
  return i;
}
/** infos de progression pour un total de gains donné */
function progress(earned) {
  const e = Math.max(0, Number(earned) || 0);
  const i = rankIndex(e), cur = LADDER[i], next = LADDER[i + 1] || null;
  const pct = next ? Math.max(0, Math.min(1, (e - cur.min) / (next.min - cur.min))) : 1;
  return { idx: i, pct, toNext: next ? Math.max(0, next.min - e) : 0, maxed: !next };
}

// ---------- ELO ----------
const ELO_START = 1000, ELO_FLOOR = 100;
const K = { poker: 24, blackjack: 12, roulette: 12 };
const PROVISIONAL = 10; // nombre de manches classées avant que l'ELO soit « fiable »

function create(file) {
  let users = {};
  try { users = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { users = {}; }
  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(users));
        fs.renameSync(file + '.tmp', file);
      } catch (e) { console.error('[rank] écriture', e?.message || e); }
    }, 2000);
    if (timer.unref) timer.unref();
  }
  const get = (uid, name, avatar) => {
    const u = users[uid] || (users[uid] = { n: name || 'Joueur', a: '', earned: 0, elo: ELO_START, eg: 0, peak: ELO_START, w: 0, l: 0 });
    if (name) u.n = name;
    if (avatar) u.a = avatar;
    return u;
  };

  /** une manche terminée : cumule les gains de chaque gagnant, puis met à jour l'ELO */
  function record(r, avatarOf) {
    const players = (r && r.players || []).filter((p) => p && p.uid);
    for (const p of players) {
      const u = get(String(p.uid), p.name, avatarOf && avatarOf(String(p.uid)));
      const net = Number(p.net) || 0;
      if (net > 0) u.earned = Math.round((u.earned + net) * 100) / 100; // les pertes ne retirent jamais rien
    }
    const k = K[r.game];
    if (k && players.length >= 2) {
      const score = players.map((p) => (r.game === 'poker' ? Number(p.net) || 0 : (Number(p.bet) > 0 ? (Number(p.net) || 0) / Number(p.bet) : 0)));
      const us = players.map((p) => get(String(p.uid)));
      const n = players.length, delta = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const S = Math.abs(score[i] - score[j]) < 1e-9 ? 0.5 : score[i] > score[j] ? 1 : 0;
          const E = 1 / (1 + Math.pow(10, (us[j].elo - us[i].elo) / 400));
          delta[i] += (k / (n - 1)) * (S - E);
        }
      }
      for (let i = 0; i < n; i++) {
        us[i].elo = Math.max(ELO_FLOOR, us[i].elo + delta[i]);
        us[i].eg++;
        if (score[i] > 0) us[i].w++; else if (score[i] < 0) us[i].l++;
        if (us[i].elo > us[i].peak) us[i].peak = us[i].elo;
      }
    }
    save();
  }

  const eloList = () => Object.entries(users).filter(([, u]) => u.eg > 0).sort((a, b) => b[1].elo - a[1].elo || b[1].eg - a[1].eg);
  function view(uid, top = 50) {
    const list = eloList();
    const row = ([id, u], i) => ({ pos: i + 1, uid: id, name: u.n, avatar: u.a || '', elo: Math.round(u.elo), games: u.eg, wins: u.w, prov: u.eg < PROVISIONAL, rank: rankIndex(u.earned) });
    const meU = users[uid];
    const mePos = list.findIndex(([id]) => id === uid);
    return {
      ladder: LADDER,
      me: meU
        ? { earned: meU.earned, ...progress(meU.earned), elo: Math.round(meU.elo), peak: Math.round(meU.peak), games: meU.eg, wins: meU.w, losses: meU.l, pos: mePos >= 0 ? mePos + 1 : 0, prov: meU.eg < PROVISIONAL, total: list.length }
        : { earned: 0, ...progress(0), elo: ELO_START, peak: ELO_START, games: 0, wins: 0, losses: 0, pos: 0, prov: true, total: list.length },
      elo: list.slice(0, top).map(row),
      meRow: mePos >= top ? row(list[mePos], mePos) : null,
      provisional: PROVISIONAL,
    };
  }
  const info = (uid) => LADDER[rankIndex((users[uid] && users[uid].earned) || 0)];
  return { info, record, view, touch: (uid, name, avatar) => { if (users[uid]) get(uid, name, avatar); } };
}

module.exports = { create, LADDER, progress, rankIndex };
