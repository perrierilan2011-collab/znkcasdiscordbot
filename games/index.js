'use strict';
/*
 * games/ — animations en IMAGES pour chaque jeu (style néon violet ZNK)
 * ---------------------------------------------------------------------------
 * Phase 1 : les 10 premiers jeux
 *   mines · bj · roulette · coinflip · dice · slots · wheel · duel · suit · zone
 *
 * Pour ajouter un jeu : créer games/<cle>.js (voir coinflip.js comme modèle),
 * l'ajouter dans GAMES ci-dessous. Un jeu absent d'ici garde son animation texte.
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
};

module.exports = { create: (deps) => create(deps, GAMES), GAMES, KEYS: Object.keys(GAMES) };
