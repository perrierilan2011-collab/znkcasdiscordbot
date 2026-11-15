'use strict';
/*
 * games/ — animations des jeux (style néon violet ZNK)
 * ---------------------------------------------------------------------------
 * GIF animés (une seule image GIF envoyée, joue une fois) :
 *   coinflip (pièce lancée) · dice (dés qui rebondissent) ·
 *   bj · roulette · wheel · plinko · horses · crash (la fusée)
 *
 * Images fixes (une image par étape, en éditant le message) :
 *   mines · slots · duel · suit · zone
 *
 * Pour ajouter un jeu : créer games/<cle>.js (voir coinflip.js pour des images fixes,
 * plinko.js pour un GIF : exporter gif(res, ctx) => { dur, cap(t), draw(S, t) }),
 * puis l'ajouter dans GAMES ci-dessous. Un jeu absent d'ici garde son animation texte.
 * Couper les GIF sans toucher au code : variable GAME_GIF=off (retour aux images fixes).
 */
const { create } = require('./engine');

const GAMES = {
  mines: require('./mines'),
  bj: require('./bj'),
  roulette: require('./roulette'),
  coinflip: require('./coinflip'),
  dice: require('./dice'),
  slots: require('./slots'),
  wheel: require('./wheel'),
  duel: require('./duel'),
  suit: require('./suit'),
  zone: require('./zone'),
  plinko: require('./plinko'),
  crash: require('./crash'),
  horses: require('./horses'),
};

module.exports = { create: (deps) => create(deps, GAMES), GAMES, KEYS: Object.keys(GAMES) };
