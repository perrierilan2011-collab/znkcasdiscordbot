'use strict';
/*
 * web/server.js — serveur web du casino ZNK (jeux « online » EXTERNES, hors Discord) : blackjack + poker + roulette multijoueur.
 * Sans dépendance : module http de Node + Server-Sent Events (temps réel) + POST pour les actions.
 *
 * Adresse publique : variable PUBLIC_URL (défaut : https://znk.up.railway.app)
 * Port : variable PORT (fournie automatiquement par Railway)
 * Le joueur arrive par un lien PERSONNEL généré par le bot (bouton Discord) : le lien contient un jeton signé
 * (identité Discord + serveur), valable 12 h. Aucun mot de passe, aucune appli OAuth à configurer.
 *   WEB_SECRET (optionnel) : clé de signature ; par défaut dérivée de DISCORD_TOKEN.
 *   WEB=off : n'ouvre pas le serveur.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Room, SEATS } = require('./table');
const { PokerRoom, INFO: POKER_INFO } = require('./poker');
const { RouletteRoom, INFO: ROULETTE_INFO } = require('./roulette');
const { create: createOffline } = require('./offline');
const { create: createRank } = require('./rank');
const { create: createShop } = require('./shop');
const { RankedArena } = require('./ranked');

const PUBLIC_URL = String(process.env.PUBLIC_URL || 'https://znk.up.railway.app').replace(/\/+$/, '');
const TOKEN_TTL_MS = 12 * 3600 * 1000;
// chat en direct : un salon par jeu (par serveur Discord), historique gardé en mémoire
const CHAT_ROOMS = new Set(['hub', 'bj', 'poker', 'roulette', 'ranked', 'off-bj', 'off-fuse', 'off-mine', 'off-coin', 'off-dice', 'off-horses', 'off-russian', 'off-slots', 'off-duel', 'off-scratch', 'off-plinko']);
const CHAT_KEEP = 60;
// salon de chat de chaque jeu : les victoires y sont annoncées automatiquement (+ dans l'accueil)
const GAME_ROOM = { blackjack: 'bj', poker: 'poker', roulette: 'roulette', ranked: 'ranked', 'bj-solo': 'off-bj', fuse: 'off-fuse', mines: 'off-mine', coin: 'off-coin', dice: 'off-dice', horses: 'off-horses', russian: 'off-russian', slots: 'off-slots', duel: 'off-duel', scratch: 'off-scratch', plinko: 'off-plinko' };
const EMOTES = new Set(['🔥', '👏', '😈', '🍀', '😱', '😂', '💸', '🎉']);
const DATA_DIR = path.join(__dirname, '..', 'data');

const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

function saveJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data));
    fs.renameSync(file + '.tmp', file);
  } catch (e) {
    console.error('[web] écriture', file, e?.message || e);
  }
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function init(deps) {
  if (/^(off|0|false|non|no)$/i.test(String(process.env.WEB || '').trim())) {
    console.log('[web] désactivé (WEB=off)');
    return { makeLink: () => null, enabled: false };
  }
  const secret = process.env.WEB_SECRET || crypto.createHash('sha256').update('znk-web:' + (deps.secretSeed || 'znk')).digest('hex');
  const sign = (p) => crypto.createHmac('sha256', secret).update(p).digest('base64url');

  function makeToken(user, guildId) {
    const payload = b64(
      JSON.stringify({
        u: String(user.id),
        n: String(user.name || 'Joueur').slice(0, 24),
        a: String(user.avatar || ''),
        r: String(user.role || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 32),
        g: String(guildId),
        e: Date.now() + TOKEN_TTL_MS,
      })
    );
    return `${payload}.${sign(payload)}`;
  }
  function readToken(tok) {
    try {
      const [payload, sig] = String(tok || '').split('.');
      if (!payload || !sig) return null;
      const good = sign(payload);
      if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
      const d = JSON.parse(unb64(payload));
      if (!d || d.e < Date.now() || !d.u || !d.g) return null;
      const avatar = /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(d.a) ? d.a : '';
      return { uid: d.u, name: d.n, avatar, role: String(d.r || ''), guildId: d.g };
    } catch {
      return null;
    }
  }
  const makeLink = (user, guildId, game) => `${PUBLIC_URL}/?t=${makeToken(user, guildId)}${game === 'roulette' || game === 'wheel' ? '&g=roulette' : ''}`;

  // ---------- argent en jeu : remboursé au redémarrage si le bot a planté en pleine manche ----------
  const PENDING_FILE = path.join(DATA_DIR, 'bj_pending.json');
  const pendingMap = readJson(PENDING_FILE, {});
  const pending = {
    set(k, v) {
      pendingMap[k] = v;
      saveJson(PENDING_FILE, pendingMap);
    },
    del(k) {
      if (k in pendingMap) {
        delete pendingMap[k];
        saveJson(PENDING_FILE, pendingMap);
      }
    },
  };
  (async () => {
    for (const [k, amt] of Object.entries({ ...pendingMap })) {
      const uid = k.split(':')[1];
      try {
        if (uid && Number(amt) > 0) {
          await deps.credit(uid, Number(amt));
          console.log(`[web] mise remboursée après redémarrage : ${uid} +${amt}`);
        }
        pending.del(k);
      } catch (e) {
        console.error('[web] remboursement impossible', k, e?.message || e);
      }
    }
  })();

  // ---------- rangs (gains cumulés) + ELO ----------
  // ---------- événements du casino : notifs communes à tout le serveur (boîte de réception de chaque joueur) ----------
  const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
  const guildEvents = readJson(EVENTS_FILE, {}); // guildId -> [notif]
  const EVENT_KEEP = 30, EVENT_TTL_MS = 7 * 24 * 3600 * 1000;
  let eventsTimer = null;
  const eventsOf = (guildId) => (guildEvents[guildId] || []).filter((n) => Date.now() - n.t < EVENT_TTL_MS);
  function pushEvent(guildId, n) {
    const notif = { id: crypto.randomBytes(6).toString('hex'), t: Date.now(), type: 'event', kind: String(n.kind || 'event'), title: String(n.title || 'Événement').slice(0, 80), text: String(n.text || '').slice(0, 240), eventId: n.eventId ? String(n.eventId) : '', amount: Number(n.amount) || 0, expiresAt: Number(n.expiresAt) || 0 };
    const list = eventsOf(String(guildId));
    list.unshift(notif);
    guildEvents[String(guildId)] = list.slice(0, EVENT_KEEP);
    clearTimeout(eventsTimer);
    eventsTimer = setTimeout(() => saveJson(EVENTS_FILE, guildEvents), 1500);
    const entry = rooms.get(String(guildId));
    if (entry) entry.broadcast(`event: notif\ndata: ${JSON.stringify(notif)}\n\n`);
    return notif;
  }
  const avatarMap = new Map(); // uid -> avatar (affiché dans les classements)
  const rankApi = createRank(path.join(DATA_DIR, 'rank.json'), deps.supabase);
  const shopApi = createShop(DATA_DIR, {
    getBalance: deps.getBalance,
    debit: deps.debit,
    credit: deps.credit,
    getInviteCount: deps.getInviteCount || (async () => 0),
    getGamesPlayed: deps.getGamesPlayed || (async (uid) => {
      try {
        const v = rankApi.view(String(uid), 1);
        return (v && v.me && v.me.games) || 0;
      } catch { return 0; }
      }),
  });


  // ---------- fin de manche : rang / ELO + récap Discord + annonce des gagnants dans le chat du site ----------
  function roundEnd(guildId, r) {
    try { rankApi.record(r, (uid) => avatarMap.get(uid)); } catch (e) { console.error('[web] rang/elo', e?.message || e); }
    try { for (const p of (r && r.players) || []) if (p && p.uid) shopApi.bumpProgress(p.uid, 'games', 1); } catch (e) { console.error('[web] shop tasks', e?.message || e); }
    try {
      const room = GAME_ROOM[r && r.game];
      if (room) {
        const entry = roomOf(guildId);
        const now = Date.now();
        for (const p of (r.players || []).filter((x) => x.net > 0)) {
          const mult = p.mult || (p.bet > 0 ? Math.floor(((p.bet + p.net) / p.bet) * 100) / 100 : 0);
          const base = { sys: 'win', game: r.game, uid: p.uid, name: p.name, role: '', text: '', bet: p.bet, net: p.net, mult, detail: p.detail || (p.outcome === 'bj' ? 'BLACKJACK' : ''), t: now };
          for (const rm of [room, 'hub']) {
            const msg = { ...base, room: rm };
            const list = entry.chat.get(rm) || [];
            list.push(msg);
            if (list.length > CHAT_KEEP) list.shift();
            entry.chat.set(rm, list);
            entry.broadcast(`event: chat\ndata: ${JSON.stringify(msg)}\n\n`);
          }
        }
      }
    } catch (e) { console.error('[web] annonce victoire', e?.message || e); }
    if (deps.onRoundEnd) deps.onRoundEnd(guildId, r);
  }

  // ---------- jeux offline solo (mines, fusé, blackjack, pile ou face, dés, chevaux, roulette russe) ----------
  const offline = createOffline({ getBalance: deps.getBalance, debit: deps.debit, credit: deps.credit, onRoundEnd: (guildId, r) => roundEnd(guildId, r) }, pending);

  // ---------- boîte de réception (notifications reçues : envoi de pièces…), gardée même hors ligne ----------
  const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');
  const inbox = readJson(INBOX_FILE, {});
  let inboxTimer = null;
  function pushNotif(uid, n) {
    const list = inbox[uid] || (inbox[uid] = []);
    list.unshift(n);
    if (list.length > 30) list.length = 30;
    clearTimeout(inboxTimer);
    inboxTimer = setTimeout(() => saveJson(INBOX_FILE, inbox), 1500);
  }
  // ---------- statistiques / classement (un fichier par jeu : blackjack, poker) ----------
  function makeStats(file) {
    const stats = readJson(file, {});
    let statsTimer = null;
    return {
      record(uid, name, net, outcome) {
        const s = stats[uid] || { n: name, rounds: 0, wins: 0, bj: 0, net: 0, best: 0 };
        s.n = name;
        s.a = avatarMap.get(uid) || s.a || '';
        s.rounds++;
        if (outcome === 'win' || outcome === 'bj') s.wins++;
        if (outcome === 'bj') s.bj++;
        s.net = Math.round((s.net + net) * 100) / 100;
        if (net > s.best) s.best = net;
        stats[uid] = s;
        clearTimeout(statsTimer);
        statsTimer = setTimeout(() => saveJson(file, stats), 2000);
      },
      top() {
        return Object.entries(stats)
          .map(([uid, s]) => ({ uid, name: s.n, avatar: s.a || '', rounds: s.rounds, wins: s.wins, bj: s.bj, net: s.net, best: s.best }))
          .sort((a, b) => b.net - a.net)
          .slice(0, 10);
      },
    };
  }
  const statsApi = makeStats(path.join(DATA_DIR, 'bj_stats.json'));
  const pokerStats = makeStats(path.join(DATA_DIR, 'poker_stats.json'));

  // ---------- tables multiples : quand toutes les tables d'un jeu sont pleines, une nouvelle s'ouvre ----------
  const MAX_TABLES = 12;
  function makePoker(entry, tid) {
    const pr = new PokerRoom(entry.guildId, {
      getBalance: deps.getBalance,
      debit: deps.debit,
      credit: deps.credit,
      pending,
      stats: pokerStats,
      onRoundEnd: (r) => roundEnd(entry.guildId, r),
      // snapshot PERSONNALISÉ (chaque joueur ne reçoit que ses propres cartes) => un envoi par connexion
      onChange: (p) => {
        for (const res of entry.clients) {
          try {
            res.write(`event: poker\ndata: ${JSON.stringify({ ...p.snapshot(res.uid), tid })}\n\n`);
          } catch {
            /* connexion fermée */
          }
        }
      },
    });
    pr.tid = tid;
    return pr;
  }
  function makeBj(entry, tid) {
    const r = new Room(entry.guildId, {
      getBalance: deps.getBalance,
      debit: deps.debit,
      credit: deps.credit,
      pending,
      stats: statsApi,
      onRoundEnd: (x) => roundEnd(entry.guildId, x),
      onChange: (room) => {
        const msg = `event: state\ndata: ${JSON.stringify({ ...room.snapshot(), tid })}\n\n`;
        for (const res of entry.clients) {
          try {
            res.write(msg);
          } catch {
            /* connexion fermée */
          }
        }
      },
    });
    r.tid = tid;
    return r;
  }
  const isFull = (r) => r.seats.every(Boolean);
  /** garde toujours au moins une table avec une place libre ; une table restée VIDE plus de 5 min est supprimée */
  const EMPTY_TTL_MS = 5 * 60 * 1000;
  function syncOne(entry, map, make, kind) {
    const nowMs = Date.now();
    for (const r of map.values()) {
      if (r.isEmpty()) { if (!r.emptySince) r.emptySince = nowMs; } // le chrono démarre quand la dernière personne part
      else r.emptySince = 0; // quelqu'un est assis : chrono remis à zéro
    }
    const expired = [...map.entries()].filter(([, r]) => r.isEmpty() && nowMs - r.emptySince >= EMPTY_TTL_MS).map(([t]) => t).sort((x, y) => y - x); // les plus hautes d'abord
    for (const t of expired) {
      if (map.size <= 1) break; // on garde toujours au moins une table
      if (![...map.entries()].some(([k, x]) => k !== t && !isFull(x))) continue; // toutes les autres sont pleines : celle-ci reste la table d'accueil
      const r = map.get(t);
      try { r.clearTimer(); } catch { /* ignore */ }
      map.delete(t);
      entry.broadcast(`event: tabledel\ndata: ${JSON.stringify({ game: kind, tid: t })}\n\n`);
    }
    if (!map.size || ([...map.values()].every(isFull) && map.size < MAX_TABLES)) {
      let tid = 1;
      while (map.has(tid)) tid++;
      const r = make(entry, tid);
      map.set(tid, r);
      r.emit();
    }
  }
  function syncTables(entry) {
    syncOne(entry, entry.bjs, makeBj, 'bj');
    syncOne(entry, entry.pokers, makePoker, 'poker');
  }
  setInterval(() => { for (const e of rooms.values()) syncTables(e); }, 4000).unref();
  const tidOf = (d) => (Number.isInteger(Number(d.tid)) && Number(d.tid) > 0 ? Number(d.tid) : 1);
  function otherSeat(map, uid, tid) {
    for (const [t, r] of map) if (t !== tid && r.findSeat(uid) >= 0) return t;
    return 0;
  }

  // ---------- tables (plusieurs par serveur Discord) ----------
  const rooms = new Map(); // guildId -> { bjs, pokers, roulette, clients:Set<res>, conns: Map<uid, n> }
  function roomOf(guildId) {
    let r = rooms.get(guildId);
    if (r) return r;
    const entry = { guildId, clients: new Set(), conns: new Map(), roulette: null, chat: new Map(), seen: new Map() };
    const broadcast = (msg) => {
      for (const res of entry.clients) {
        try {
          res.write(msg);
        } catch {
          /* connexion fermée */
        }
      }
    };
    entry.broadcast = broadcast;
    entry.arena = new RankedArena(guildId, {
      onChange: (room) => {
        for (const res of entry.clients) {
          try {
            res.write(`event: ranked\ndata: ${JSON.stringify(room.snapshot(res.uid))}\n\n`);
          } catch { /* fermée */ }
        }
      },
      rankRecord: (players) => rankApi.recordRanked(players, (uid) => avatarMap.get(uid)),
      onMatchEnd: (r) => roundEnd(guildId, r),
    });
    entry.roulette = new RouletteRoom(guildId, {
      getBalance: deps.getBalance,
      debit: deps.debit,
      credit: deps.credit,
      pending,
      onRoundEnd: (r) => roundEnd(guildId, r),
      onChange: (w) => broadcast(`event: roulette\ndata: ${JSON.stringify(w.snapshot())}\n\n`),
    });
    entry.bjs = new Map(); // tid -> Room (blackjack)
    entry.pokers = new Map(); // tid -> PokerRoom
    entry.syncTables = () => syncTables(entry);
    syncTables(entry);
    rooms.set(guildId, entry);
    return entry;
  }


  // ---------- connexion « Se connecter avec Discord » (OAuth2) : un seul lien public pour tout le monde ----------
  // À configurer : DISCORD_CLIENT_SECRET (Discord Developer Portal → OAuth2) + ajouter l'URL de redirection  PUBLIC_URL/auth/callback
  const CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
  const clientId = () => String(process.env.DISCORD_CLIENT_ID || (deps.clientId && deps.clientId()) || '').trim();
  const REDIRECT = PUBLIC_URL + '/auth/callback';
  const oauthOn = () => !!(CLIENT_SECRET && clientId() && deps.resolveMember);
  const SECURE = /^https:/.test(PUBLIC_URL) ? '; Secure' : '';
  const cookieOf = (req, k) => { const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(k + '=')); return m ? m.slice(k.length + 1) : ''; };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const page = (res, code, body, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...extra });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Casino</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f2f2f2;font:15px system-ui,sans-serif;text-align:center;padding:24px"><div style="max-width:420px">${body}</div>`);
  };
  const BTN = 'display:block;margin:10px 0;padding:13px 18px;border-radius:12px;background:#5865f2;color:#fff;text-decoration:none;font-weight:800';
  const goHome = (res, user, guildId) => { res.writeHead(302, { Location: '/?t=' + makeToken(user, guildId), 'Cache-Control': 'no-store', 'Set-Cookie': 'znk_oauth=; Path=/auth; Max-Age=0', ...SEC }); res.end(); };
  const seal = (obj) => { const p = b64(JSON.stringify({ ...obj, e: Date.now() + 10 * 60 * 1000 })); return p + '.' + sign(p); };
  const unseal = (t) => {
    try { const [p, sg] = String(t || '').split('.'); if (!p || !sg || sign(p) !== sg) return null; const d = JSON.parse(unb64(p)); return d.e > Date.now() ? d : null; } catch { return null; }
  };
  async function handleAuth(req, res, url) {
    if (!oauthOn()) return page(res, 503, '<h2>Connexion Discord indisponible</h2><p>L’administrateur doit configurer <b>DISCORD_CLIENT_SECRET</b> sur le serveur.</p>');
    if (url.pathname === '/login') {
      const state = crypto.randomBytes(16).toString('base64url');
      const q = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: REDIRECT, scope: 'identify guilds', state, prompt: 'none' });
      res.writeHead(302, { Location: 'https://discord.com/oauth2/authorize?' + q, 'Cache-Control': 'no-store', 'Set-Cookie': `znk_oauth=${state}; Path=/auth; Max-Age=600; HttpOnly; SameSite=Lax${SECURE}`, ...SEC });
      return res.end();
    }
    if (url.pathname === '/auth/guild') { // choix du serveur (si le joueur est dans plusieurs serveurs du casino)
      const t = unseal(url.searchParams.get('k')), c = t && t.o.find((x) => x.guildId === url.searchParams.get('g'));
      if (!c) return page(res, 400, '<h2>Session expirée</h2><a style="' + BTN + '" href="/login">Se connecter avec Discord</a>');
      return goHome(res, { id: t.u, name: c.name, avatar: c.avatar, role: c.role }, c.guildId);
    }
    // /auth/callback
    const state = url.searchParams.get('state') || '', code = url.searchParams.get('code');
    const fail = (m) => page(res, 400, `<h2>Connexion impossible</h2><p>${esc(m)}</p><a style="${BTN}" href="/login">Réessayer</a>`);
    if (url.searchParams.get('error')) return fail('Connexion annulée.');
    if (!code || !state || state !== cookieOf(req, 'znk_oauth')) return fail('Session invalide, réessaie.');
    try {
      const tk = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId(), client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT }) }).then((r) => r.json());
      if (!tk.access_token) throw new Error('refus de Discord');
      const H = { Authorization: 'Bearer ' + tk.access_token };
      const [u, gl] = await Promise.all([fetch('https://discord.com/api/users/@me', { headers: H }).then((r) => r.json()), fetch('https://discord.com/api/users/@me/guilds', { headers: H }).then((r) => r.json())]);
      if (!u || !u.id) throw new Error('profil introuvable');
      const opts = await deps.resolveMember(String(u.id), Array.isArray(gl) ? gl.map((g) => String(g.id)) : []);
      if (!opts || !opts.length) return page(res, 403, '<h2>Accès refusé</h2><p>Tu dois être membre du serveur Discord du casino pour jouer.</p>');
      if (opts.length === 1) return goHome(res, { id: u.id, name: opts[0].name, avatar: opts[0].avatar, role: opts[0].role }, opts[0].guildId);
      const k = seal({ u: String(u.id), o: opts.slice(0, 20).map((o) => ({ guildId: String(o.guildId), name: String(o.name), avatar: String(o.avatar || ''), role: String(o.role || ''), gn: String(o.guildName || o.guildId) })) });
      return page(res, 200, '<h2>Choisis ton serveur</h2>' + opts.slice(0, 20).map((o) => `<a style="${BTN}" href="/auth/guild?k=${encodeURIComponent(k)}&g=${encodeURIComponent(o.guildId)}">${esc(o.guildName || o.guildId)}</a>`).join(''), { 'Set-Cookie': 'znk_oauth=; Path=/auth; Max-Age=0' });
    } catch (e) { console.error('[web] oauth', e?.message || e); return fail('Discord n’a pas répondu, réessaie.'); }
  }

  // ---------- http ----------
  let html = null;
  const loadHtml = () => {
    if (!html || process.env.WEB_DEV) html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    return html;
  };
  const SEC = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' https://cdn.discordapp.com https://media.discordapp.net data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC });
    res.end(JSON.stringify(obj));
  };
  const lastAct = new Map();
  const lastChat = new Map();

  async function handleAct(req, res) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) return json(res, 413, { ok: false, error: 'Requête trop grosse.' });
    }
    let d;
    try {
      d = JSON.parse(body || '{}');
    } catch {
      return json(res, 400, { ok: false, error: 'JSON invalide.' });
    }
    const user = readToken(d.t);
    if (!user) return json(res, 401, { ok: false, error: 'Lien expiré : reclique sur « Jouer » dans Discord.' });
    if (user.avatar) avatarMap.set(user.uid, user.avatar);
    const now = Date.now();
    if (now - (lastAct.get(user.uid) || 0) < (/^[ro]/.test(String(d.action)) ? 50 : 120)) return json(res, 429, { ok: false, error: 'Doucement.' });
    lastAct.set(user.uid, now);
    const entry = roomOf(user.guildId);
    const { roulette } = entry;
    const tid = tidOf(d);
    const act = String(d.action);
    const needBj = ['sit', 'leave', 'bet', 'clear', 'hit', 'stand', 'double', 'split', 'emote', 'sync'].includes(act);
    const needPk = /^p/.test(act);
    const room = needBj ? entry.bjs.get(tid) : null;
    const poker = needPk ? entry.pokers.get(tid) : null;
    if ((needBj && !room) || (needPk && !poker)) return json(res, 200, { ok: false, error: 'Cette table n’existe plus.' });
    let walBal; // solde du portefeuille renvoyé après une action de poker
    let created; // numéro de la table créée par un joueur (action tnew)
    let daily; // résultat du daily (action daily)
    let evMsg; // message de confirmation d'un événement (claim / giveaway)
    try {
      if (String(d.action).startsWith('o')) return json(res, 200, { ok: true, ...(await offline.handle(user, d)) });
      switch (d.action) {
        // ---- envoi de pièces à un autre joueur du serveur
        case 'gift': {
          const to = String(d.to || '');
          const amt = Math.floor(Number(d.amount) * 100 + 1e-6) / 100;
          if (!/^\d{5,25}$/.test(to)) throw new Error('Choisis un joueur.');
          if (to === user.uid) throw new Error('Tu ne peux pas t’envoyer de pièces à toi-même.');
          if (!Number.isFinite(amt) || amt < 1) throw new Error('Montant minimum : 1.');
          if (deps.isMember && !(await deps.isMember(user.guildId, to))) throw new Error('Ce joueur n’est pas sur le serveur.');
          const nb = await deps.debit(user.uid, amt);
          if (nb === null) throw new Error('Solde insuffisant.');
          try {
            await deps.credit(to, amt);
          } catch (e) {
            await deps.credit(user.uid, amt).catch(() => {}); // échec : on rembourse l’expéditeur
            throw new Error('Envoi impossible, réessaie.');
          }
          walBal = nb;
          const rb = await deps.getBalance(to).catch(() => null);
          const notif = { id: crypto.randomBytes(6).toString('hex'), t: Date.now(), type: 'gift', from: user.name, amount: amt };
          pushNotif(to, notif);
          for (const c of entry.clients) {
            if (c.uid !== to) continue;
            try {
              c.write(`event: notif\ndata: ${JSON.stringify(notif)}\n\n`);
              if (rb !== null) c.write(`event: bal\ndata: ${JSON.stringify({ bal: rb })}\n\n`);
            } catch { /* fermée */ }
          }
          break;
        }
        // ---- admin : créer de l'argent pour n'importe quel joueur (réservé au(x) compte(s) admin)
        case 'admingive': {
          if (!deps.isAdmin || !(await deps.isAdmin(user.uid))) throw new Error('Action réservée à l’administrateur.');
          const to = String(d.to || '');
          const amt = Math.floor(Number(d.amount) * 100 + 1e-6) / 100;
          if (!/^\d{5,25}$/.test(to)) throw new Error('Choisis un joueur.');
          if (!Number.isFinite(amt) || amt < 1 || amt > 1e12) throw new Error('Montant invalide.');
          const nb = await deps.credit(to, amt);
          console.log(`[web] ADMIN ${user.name} (${user.uid}) ajoute ${amt} à ${to}`);
          const notif = { id: crypto.randomBytes(6).toString('hex'), t: Date.now(), type: 'gift', from: user.name, amount: amt };
          pushNotif(to, notif);
          const rb = typeof nb === 'number' ? nb : await deps.getBalance(to).catch(() => null);
          for (const c of entry.clients) {
            if (c.uid !== to) continue;
            try {
              c.write(`event: notif\ndata: ${JSON.stringify(notif)}\n\n`);
              if (rb !== null) c.write(`event: bal\ndata: ${JSON.stringify({ bal: rb })}\n\n`);
            } catch { /* fermée */ }
          }
          break;
        }
        // ---- admin : lancer un événement (mêmes événements que le bot Discord) → MP + notif dans la boîte de réception
        case 'adminevent': {
          if (!deps.isAdmin || !(await deps.isAdmin(user.uid))) throw new Error('Action réservée à l’administrateur.');
          const kind = String(d.kind || '');
          let r;
          if (kind === 'claim' || kind === 'giveaway') {
            if (!deps.launchEvent) throw new Error('Événements indisponibles.');
            r = await deps.launchEvent(user.guildId, user.uid, kind, d.amount, d.winners, d.minutes);
          } else {
            if (!deps.launchBoost) throw new Error('Événements indisponibles.');
            r = await deps.launchBoost(user.guildId, user.uid, kind, d.minutes);
          }
          console.log(`[web] ADMIN ${user.name} (${user.uid}) lance l'événement ${kind}`);
          created = undefined;
          break;
        }
        // ---- participer à un événement (claim / giveaway) depuis la notification
        case 'evclaim':
        case 'evjoin': {
          const fn = d.action === 'evclaim' ? deps.eventClaim : deps.eventJoin;
          if (!fn) throw new Error('Événements indisponibles.');
          const r = await fn(user.uid, user.guildId, String(d.eid || ''));
          if (!r || !r.ok) throw new Error((r && r.msg) || 'Événement indisponible.');
          evMsg = r.msg;
          if (r.balance != null) {
            walBal = r.balance;
            for (const c of entry.clients) {
              if (c.uid !== user.uid) continue;
              try { c.write(`event: bal\ndata: ${JSON.stringify({ bal: r.balance })}\n\n`); } catch { /* fermée */ }
            }
          }
          break;
        }
        // ---- daily : récompense quotidienne (même règle que le bouton Discord)
        case 'daily': {
          if (!deps.claimDaily) throw new Error('Daily indisponible pour le moment.');
          const r = await deps.claimDaily(user.uid);
          if (!r) throw new Error('Daily indisponible, réessaie.');
          daily = { claimed: !!r.claimed, amount: r.amount };
          if (r.balance != null) {
            walBal = r.balance;
            for (const c of entry.clients) {
              if (c.uid !== user.uid) continue;
              try { c.write(`event: bal\ndata: ${JSON.stringify({ bal: r.balance })}\n\n`); } catch { /* fermée */ }
            }
          }
          break;
        }
        // ---- créer une table (même si les autres ne sont pas remplies)
        case 'tnew': {
          const kind = d.game === 'poker' ? 'poker' : 'bj';
          const map = kind === 'poker' ? entry.pokers : entry.bjs;
          if (map.size >= MAX_TABLES) throw new Error(`Maximum ${MAX_TABLES} tables.`);
          let nt = 1;
          while (map.has(nt)) nt++;
          const r = (kind === 'poker' ? makePoker : makeBj)(entry, nt);
          r.emptySince = Date.now();
          map.set(nt, r);
          r.emit();
          created = nt;
          break;
        }
        // ---- chat en direct
        case 'chatsend': {
          const chatRoom = String(d.room);
          if (!CHAT_ROOMS.has(chatRoom)) throw new Error('Salon inconnu.');
          const text = String(d.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
          if (!text) break;
          if (now - (lastChat.get(user.uid) || 0) < 1200) throw new Error('Doucement : un message par seconde maximum.');
          lastChat.set(user.uid, now);
          const rk = rankApi.info(user.uid); // le rang du casino remplace le rôle Discord
          const msg = { room: chatRoom, uid: user.uid, name: user.name, rk: { id: rk.id, fi: rk.fi, name: rk.name, sym: rk.sym, pips: rk.pips, c1: rk.c1, c2: rk.c2 }, avatar: user.avatar, text, t: now };
          const list = entry.chat.get(chatRoom) || [];
          list.push(msg);
          if (list.length > CHAT_KEEP) list.shift();
          entry.chat.set(chatRoom, list);
          entry.broadcast(`event: chat\ndata: ${JSON.stringify(msg)}\n\n`);
          break;
        }
        // ---- roulette
        case 'rjoin': {
          const bal = await deps.getBalance(user.uid);
          await roulette.run(async () => roulette.join(user, bal));
          break;
        }
        case 'rleave':
          await roulette.run(() => roulette.leave(user.uid));
          break;
        case 'rbet':
          await roulette.run(() => roulette.bet(user.uid, d.spot, d.amount));
          break;
        case 'rrebet':
          await roulette.run(() => roulette.rebet(user.uid));
          break;
        case 'rclear':
          await roulette.run(() => roulette.clear(user.uid));
          break;
        case 'remote': {
          if (!EMOTES.has(d.e) || !roulette.players.has(user.uid)) break;
          entry.broadcast(`event: remote\ndata: ${JSON.stringify({ uid: user.uid, e: d.e })}\n\n`);
          break;
        }
        case 'rsync': {
          const p = roulette.players.get(user.uid);
          if (p) {
            p.bal = await deps.getBalance(user.uid);
            roulette.emit();
          }
          break;
        }
        // ---- poker (Texas Hold'em)
        case 'psit': {
          const o = otherSeat(entry.pokers, user.uid, tid);
          if (o) throw new Error(`Tu es déjà assis à la table ${o} : quitte-la d’abord.`);
          await poker.run(() => poker.sit(user, Number(d.seat), d.amount));
          walBal = await deps.getBalance(user.uid);
          break;
        }
        case 'pbuy': {
          await poker.run(() => poker.addChips(user.uid, d.amount));
          walBal = await deps.getBalance(user.uid);
          break;
        }
        case 'pleave':
          await poker.run(() => poker.leave(user.uid));
          walBal = await deps.getBalance(user.uid);
          break;
        case 'pfold':
          await poker.run(() => poker.act(user.uid, 'fold'));
          break;
        case 'pcheck':
          await poker.run(() => poker.act(user.uid, 'check'));
          break;
        case 'pcall':
          await poker.run(() => poker.act(user.uid, 'call'));
          break;
        case 'praise':
          await poker.run(() => poker.act(user.uid, 'raise', d.amount));
          break;
        case 'pallin':
          await poker.run(() => poker.act(user.uid, 'allin'));
          break;
        case 'psync':
          walBal = await deps.getBalance(user.uid);
          break;
        // ---- blackjack
        case 'sit': {
          const o = otherSeat(entry.bjs, user.uid, tid);
          if (o) throw new Error(`Tu es déjà assis à la table ${o} : quitte-la d’abord.`);
          const seat = Number(d.seat);
          const bal = await deps.getBalance(user.uid);
          await room.run(async () => room.sit(user, seat, bal));
          break;
        }
        case 'leave':
          await room.run(() => room.leave(user.uid));
          break;
        case 'bet':
          await room.run(() => room.setBet(user.uid, d.amount));
          break;
        case 'clear':
          await room.run(() => room.setBet(user.uid, 0));
          break;
        case 'hit':
        case 'stand':
        case 'double':
        case 'split':
          await room.run(() => room.act(user.uid, d.action));
          break;
        case 'emote': {
          if (!EMOTES.has(d.e) || room.findSeat(user.uid) < 0) break;
          const msg = `event: emote\ndata: ${JSON.stringify({ uid: user.uid, e: d.e, tid })}\n\n`;
          for (const c of roomOf(user.guildId).clients) c.write(msg);
          break;
        }
        case 'sync': {
          const i = room.findSeat(user.uid);
          if (i >= 0) {
            room.seats[i].bal = await deps.getBalance(user.uid);
            room.emit();
          }
          break;
        }


        // ---- ranked arena
        case 'rkjoin': {
          await entry.arena.run(() => entry.arena.join(user));
          break;
        }
        case 'rkleave': {
          await entry.arena.run(() => entry.arena.leave(user.uid));
          break;
        }
        case 'rkready': {
          await entry.arena.run(() => entry.arena.ready(user.uid, d.on !== false));
          break;
        }
        case 'rkunready': {
          await entry.arena.run(() => entry.arena.ready(user.uid, false));
          break;
        }
        case 'rksync': {
          break;
        }

        // ---- boutique / tasks / profil
        case 'shop_list': {
          shopApi.markLogin(user.uid);
          return json(res, 200, { ok: true, rewards: shopApi.listRewards(false) });
        }
        case 'shop_buy': {
          const out = await shopApi.buy(user.uid, String(d.id || ''), user.guildId, user.name);
          walBal = out.balance;
          return json(res, 200, { ok: true, code: out.code, order: { code: out.code, rewardName: out.order.rewardName, type: out.order.type, price: out.order.price }, rbal: walBal });
        }
        case 'shop_orders': {
          return json(res, 200, { ok: true, orders: shopApi.listOrders({ uid: user.uid, limit: 30 }) });
        }
        case 'tasks_list': {
          shopApi.markLogin(user.uid);
          return json(res, 200, { ok: true, day: shopApi.dayKeyParis(), tasks: shopApi.tasksForUser(user.uid) });
        }
        case 'tasks_claim': {
          const out = await shopApi.claimTask(user.uid, String(d.id || ''));
          walBal = out.balance;
          return json(res, 200, { ok: true, reward: out.reward, msg: `+${out.reward} · ${out.task}`, rbal: walBal, tasks: shopApi.tasksForUser(user.uid) });
        }
        case 'profile': {
          shopApi.markLogin(user.uid);
          const inv = deps.getInviteCount ? await deps.getInviteCount(user.uid, user.guildId).catch(() => 0) : 0;
          const games = deps.getGamesPlayed ? await deps.getGamesPlayed(user.uid).catch(() => 0) : 0;
          let rankGames = 0;
          try { rankGames = rankApi.view(user.uid, 1).me.games || 0; } catch {}
          const bal = await deps.getBalance(user.uid);
          const inviteUrl = deps.inviteUrl ? await deps.inviteUrl(user.guildId).catch(() => '') : '';
          return json(res, 200, {
            ok: true,
            bal,
            invites: inv,
            games: Math.max(games, rankGames),
            inviteUrl: inviteUrl || '',
            inviteReward: Number(process.env.INVITE_REWARD) || 10,
            orders: shopApi.listOrders({ uid: user.uid, limit: 10 }),
          });
        }
        case 'admin_shop_list': {
          if (!deps.isAdmin || !(await deps.isAdmin(user.uid))) throw new Error('Action réservée à l’administrateur.');
          return json(res, 200, { ok: true, rewards: shopApi.listRewards(true), tasks: shopApi.listTasks(true), orders: shopApi.listOrders({ limit: 50 }) });
        }
        case 'admin_reward_save': {
          if (!deps.isAdmin || !(await deps.isAdmin(user.uid))) throw new Error('Action réservée à l’administrateur.');
          const entry = shopApi.adminUpsertReward(d);
          return json(res, 200, { ok: true, reward: entry, rewards: shopApi.listRewards(true) });
        }
        case 'admin_reward_del': {
          if (!deps.isAdmin || !(await deps.isAdmin(user.uid))) throw new Error('Action réservée à l’administrateur.');
          shopApi.adminDeleteReward(String(d.id || ''));
          return json(res, 200, { ok: true, rewards: shopApi.listRewards(true) });
        }
        case 'admin_task_save': {
          if (!deps.isAdmin || !(await deps.isAdmin(user.uid))) throw new Error('Action réservée à l’administrateur.');
          const entry = shopApi.adminUpsertTask(d);
          return json(res, 200, { ok: true, task: entry, tasks: shopApi.listTasks(true) });
        }
        case 'admin_task_del': {
          if (!deps.isAdmin || !(await deps.isAdmin(user.uid))) throw new Error('Action réservée à l’administrateur.');
          shopApi.adminDeleteTask(String(d.id || ''));
          return json(res, 200, { ok: true, tasks: shopApi.listTasks(true) });
        }

        default:
          return json(res, 400, { ok: false, error: 'Action inconnue.' });
      }
      entry.syncTables();
      return json(res, 200, { ok: true, tid: created, daily, msg: evMsg, rbal: walBal ?? roulette.players.get(user.uid)?.bal });
    } catch (e) {
      return json(res, 200, { ok: false, error: String(e?.message || e).slice(0, 160), rbal: walBal ?? roulette.players.get(user.uid)?.bal });
    }
  }

  function handleStream(req, res, url) {
    const user = readToken(url.searchParams.get('t'));
    if (!user) {
      res.writeHead(401, SEC);
      return res.end('expired');
    }
    const entry = roomOf(user.guildId);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...SEC,
    });
    res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ uid: user.uid, name: user.name, avatar: user.avatar, seats: SEATS, coin: deps.coin || '🪙', roulette: ROULETTE_INFO, poker: POKER_INFO })}\n\n`);
    res.uid = user.uid; // sert au snapshot personnalisé du poker
    Promise.resolve(deps.isAdmin ? deps.isAdmin(user.uid) : false).then((a) => { if (a) try { res.write(`event: admin\ndata: {"admin":true}\n\n`); } catch { /* fermée */ } }).catch(() => {});
    if (user.avatar) avatarMap.set(user.uid, user.avatar);
    entry.seen.set(user.uid, { uid: user.uid, name: user.name, avatar: user.avatar });
    if (entry.seen.size > 300) entry.seen.delete(entry.seen.keys().next().value);
    entry.clients.add(res);
    entry.conns.set(user.uid, (entry.conns.get(user.uid) || 0) + 1);
    for (const [t, r] of entry.bjs) {
      r.setPresence(user.uid, true);
      res.write(`event: state\ndata: ${JSON.stringify({ ...r.snapshot(), tid: t })}\n\n`);
    }
    for (const [t, r] of entry.pokers) {
      r.setPresence(user.uid, true);
      res.write(`event: poker\ndata: ${JSON.stringify({ ...r.snapshot(user.uid), tid: t })}\n\n`);
    }
    deps.getBalance(user.uid).then((b) => { try { res.write(`event: bal\ndata: ${JSON.stringify({ bal: b })}\n\n`); } catch { /* fermée */ } }).catch(() => {});
    entry.roulette.setPresence(user.uid, true);
    res.write(`event: roulette\ndata: ${JSON.stringify(entry.roulette.snapshot())}\n\n`);
    entry.arena.setPresence(user.uid, true);
    res.write(`event: ranked\ndata: ${JSON.stringify(entry.arena.snapshot(user.uid))}\n\n`);
    res.write(`event: chathist\ndata: ${JSON.stringify(Object.fromEntries(entry.chat))}\n\n`);
    res.write(`event: inbox\ndata: ${JSON.stringify([...(inbox[user.uid] || []), ...eventsOf(user.guildId)].sort((a, b) => b.t - a.t).slice(0, 30))}\n\n`);
    const hb = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* fermée */
      }
    }, 20000);
    req.on('close', () => {
      clearInterval(hb);
      entry.clients.delete(res);
      const n = (entry.conns.get(user.uid) || 1) - 1;
      if (n <= 0) {
        entry.conns.delete(user.uid);
        setTimeout(() => {
          if (!entry.conns.has(user.uid)) {
            for (const r of entry.bjs.values()) r.setPresence(user.uid, false);
            for (const r of entry.pokers.values()) r.setPresence(user.uid, false);
            entry.roulette.setPresence(user.uid, false);
            try { entry.arena.setPresence(user.uid, false); } catch {}
          }
        }, 8000); // tolérance : rechargement de page / coupure réseau brève
      } else entry.conns.set(user.uid, n);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SEC });
        return res.end(loadHtml());
      }
      if (req.method === 'GET' && (url.pathname === '/login' || url.pathname === '/auth/callback' || url.pathname === '/auth/guild')) return await handleAuth(req, res, url);
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/stream') return handleStream(req, res, url);
      if (req.method === 'GET' && url.pathname === '/api/top') return json(res, 200, { top: (url.searchParams.get('g') === 'poker' ? pokerStats : statsApi).top() });
      if (req.method === 'GET' && url.pathname === '/api/rank') { // page « Rank » : mon rang + classement ELO
        const u = readToken(url.searchParams.get('t'));
        if (!u) return json(res, 401, { error: 'expired' });
        if (u.avatar) avatarMap.set(u.uid, u.avatar);
        rankApi.touch(u.uid, u.name, u.avatar);
        return json(res, 200, rankApi.view(u.uid));
      }
      if (req.method === 'GET' && url.pathname === '/api/boards') return json(res, 200, await Promise.resolve(deps.getBoards ? deps.getBoards() : null).catch(() => null) || { rich: [], alltime: [] });
      if (req.method === 'GET' && url.pathname === '/api/players') { // recherche d'un joueur (menu « Envoyer des pièces »)
        const u = readToken(url.searchParams.get('t'));
        if (!u) return json(res, 401, { players: [] });
        const q = String(url.searchParams.get('q') || '').trim().slice(0, 32).toLowerCase();
        const seen = [...roomOf(u.guildId).seen.values()].filter((p) => !q || p.name.toLowerCase().includes(q));
        const found = q && deps.searchMembers ? await Promise.resolve(deps.searchMembers(u.guildId, q)).catch(() => []) : [];
        const out = new Map();
        for (const p of [...found, ...seen]) if (p && p.uid !== u.uid && !out.has(p.uid)) out.set(p.uid, { uid: String(p.uid), name: String(p.name), avatar: /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(p.avatar || '') ? p.avatar : '' });
        return json(res, 200, { players: [...out.values()].slice(0, 8) });
      }
      if (req.method === 'POST' && url.pathname === '/api/act') return await handleAct(req, res);
      res.writeHead(404, SEC);
      res.end('Not found');
    } catch (e) {
      console.error('[web]', e);
      try {
        res.writeHead(500);
        res.end('error');
      } catch {
        /* ignore */
      }
    }
  });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`[web] blackjack + poker + roulette en ligne → ${PUBLIC_URL} (port ${port})`));
  server.on('error', (e) => console.error('[web] serveur :', e?.message || e));

  return { makeLink, pushEvent, enabled: true, rooms, server, publicUrl: PUBLIC_URL, oauth: oauthOn, shop: shopApi };
}

module.exports = { init };
