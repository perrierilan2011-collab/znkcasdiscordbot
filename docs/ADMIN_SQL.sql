-- =====================================================================
-- ZNK CASINO — SQL utilitaire pour le panneau admin (Supabase / Postgres)
-- =====================================================================
-- À exécuter dans Supabase → SQL Editor.
--
-- IMPORTANT : Supabase SQL Editor NE SUPPORTE PAS les paramètres :uid / :amount.
-- Toutes les valeurs ci-dessous sont donc écrites en dur sous forme de texte :
-- REMPLACEZ 'YOUR_DISCORD_ID' / 'YOUR_CODE' / 100 / etc. par vos vraies valeurs
-- avant d'exécuter chaque requête. Les requêtes sont valides telles quelles
-- (elles ne touchent simplement aucune ligne si vous ne remplacez rien).
--
-- Le bot utilise la clé SERVICE ROLE : RLS doit être activé, le service role
-- contourne RLS. Les CREATE OR REPLACE sont sûrs ; aucun DROP n'est utilisé.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. SCHÉMA DE BASE (tables utilisées par le bot et le site)
-- ---------------------------------------------------------------------
create table if not exists public.players (
  user_id    text primary key,
  balance    numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_peaks (
  user_id    text primary key,
  peak       numeric(18,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.game_history (
  id         bigint generated always as identity primary key,
  user_id    text not null,
  game       text not null,
  bet        numeric(18,2) not null default 0,
  multiplier numeric(18,4) not null default 0,
  payout     numeric(18,2) not null default 0,
  profit     numeric(18,2) not null default 0,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists game_history_user_idx on public.game_history (user_id, created_at desc);
create index if not exists game_history_game_payout_idx on public.game_history (game, payout desc);

create table if not exists public.daily_claims (
  user_id    text not null,
  claim_day  date not null,
  amount     numeric(18,2) not null default 0,
  claimed_at timestamptz not null default now(),
  primary key (user_id, claim_day)
);

create table if not exists public.player_rank (
  user_id    text primary key,
  name       text not null default 'Joueur',
  avatar     text not null default '',
  earned     numeric(18,2) not null default 0,
  elo        integer not null default 1000,
  games      integer not null default 0,
  peak       integer not null default 1000,
  wins       integer not null default 0,
  losses     integer not null default 0,
  place      integer not null default 0,
  season     text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.site_rank_ladder (
  id         integer primary key,
  fam        text not null,
  fi         integer not null default 0,
  div        text not null default '',
  name       text not null,
  min_rr     integer not null default 0,
  c1         text not null default '#a78bfa',
  c2         text not null default '#5b21b6',
  sym        text not null default 'chev',
  pips       integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_rewards (
  id          text primary key,
  name        text not null,
  description text not null default '',
  price       numeric(18,2) not null default 0,
  type        text not null default 'custom',   -- nitro | role | custom
  role_id     text not null default '',
  min_invites integer not null default 0,
  min_games   integer not null default 0,
  active      boolean not null default true,
  stock       integer,
  updated_at  timestamptz not null default now()
);

create table if not exists public.shop_tasks (
  id          text primary key,
  name        text not null,
  description text not null default '',
  reward      numeric(18,2) not null default 0,
  type        text not null default 'games',    -- login | games | invites | custom
  target      integer not null default 1,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists public.shop_task_progress (
  user_id    text not null,
  day        text not null,                     -- AAAA-MM-JJ (Europe/Paris)
  done       jsonb not null default '[]'::jsonb,
  prog       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists public.shop_orders (
  code         text primary key,
  user_id      text not null,
  user_name    text not null default '',
  guild_id     text not null default '',
  reward_id    text not null,
  reward_name  text not null default '',
  type         text not null default 'custom',
  role_id      text not null default '',
  price        numeric(18,2) not null default 0,
  status       text not null default 'pending', -- pending | delivered
  created_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists shop_orders_user_idx on public.shop_orders (user_id, created_at desc);

create table if not exists public.shop_ticket_cfg (
  guild_id         text primary key,
  category_id      text,
  panel_channel_id text,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 0b. MISE À NIVEAU DES TABLES DÉJÀ EXISTANTES
-- « create table if not exists » ne modifie PAS une table déjà présente.
-- On ajoute donc explicitement toutes les colonnes utilisées plus bas.
-- Cela corrige notamment l'erreur : column "place" of relation "player_rank"
-- does not exist sur une ancienne table player_rank.
-- ---------------------------------------------------------------------
alter table public.players
  add column if not exists balance numeric(18,2) not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.player_peaks
  add column if not exists peak numeric(18,2) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.game_history
  add column if not exists user_id text not null default '',
  add column if not exists game text not null default '',
  add column if not exists bet numeric(18,2) not null default 0,
  add column if not exists multiplier numeric(18,4) not null default 0,
  add column if not exists payout numeric(18,2) not null default 0,
  add column if not exists profit numeric(18,2) not null default 0,
  add column if not exists detail text,
  add column if not exists created_at timestamptz not null default now();

alter table public.daily_claims
  add column if not exists claimed_at timestamptz not null default now();

alter table public.player_rank
  add column if not exists name text not null default 'Joueur',
  add column if not exists avatar text not null default '',
  add column if not exists earned numeric(18,2) not null default 0,
  add column if not exists elo integer not null default 1000,
  add column if not exists games integer not null default 0,
  add column if not exists peak integer not null default 1000,
  add column if not exists wins integer not null default 0,
  add column if not exists losses integer not null default 0,
  add column if not exists place integer not null default 0,
  add column if not exists season text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.site_rank_ladder
  add column if not exists fam text not null default '',
  add column if not exists fi integer not null default 0,
  add column if not exists div text not null default '',
  add column if not exists name text not null default '',
  add column if not exists min_rr integer not null default 0,
  add column if not exists c1 text not null default '#a78bfa',
  add column if not exists c2 text not null default '#5b21b6',
  add column if not exists sym text not null default 'chev',
  add column if not exists pips integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.shop_rewards
  add column if not exists name text not null default '',
  add column if not exists description text not null default '',
  add column if not exists price numeric(18,2) not null default 0,
  add column if not exists type text not null default 'custom',
  add column if not exists role_id text not null default '',
  add column if not exists min_invites integer not null default 0,
  add column if not exists min_games integer not null default 0,
  add column if not exists active boolean not null default true,
  add column if not exists stock integer,
  add column if not exists updated_at timestamptz not null default now();

alter table public.shop_tasks
  add column if not exists name text not null default '',
  add column if not exists description text not null default '',
  add column if not exists reward numeric(18,2) not null default 0,
  add column if not exists type text not null default 'games',
  add column if not exists target integer not null default 1,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.shop_task_progress
  add column if not exists done jsonb not null default '[]'::jsonb,
  add column if not exists prog jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.shop_orders
  add column if not exists user_name text not null default '',
  add column if not exists guild_id text not null default '',
  add column if not exists reward_id text not null default '',
  add column if not exists reward_name text not null default '',
  add column if not exists type text not null default 'custom',
  add column if not exists role_id text not null default '',
  add column if not exists price numeric(18,2) not null default 0,
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists delivered_at timestamptz;

alter table public.shop_ticket_cfg
  add column if not exists category_id text,
  add column if not exists panel_channel_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.players            enable row level security;
alter table public.player_peaks       enable row level security;
alter table public.game_history       enable row level security;
alter table public.player_rank        enable row level security;
alter table public.site_rank_ladder   enable row level security;
alter table public.shop_rewards       enable row level security;
alter table public.shop_tasks         enable row level security;
alter table public.shop_task_progress enable row level security;
alter table public.shop_orders        enable row level security;
alter table public.shop_ticket_cfg    enable row level security;

-- ---------------------------------------------------------------------
-- 1. FONCTIONS RPC APPELÉES PAR LE BOT (ne pas supprimer les existantes)
-- ---------------------------------------------------------------------
create or replace function public.get_balance(p_user_id text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  insert into public.players (user_id, balance) values (p_user_id, 0)
    on conflict (user_id) do nothing;
  select balance into v from public.players where user_id = p_user_id;
  return coalesce(v, 0);
end $$;

create or replace function public.change_balance(p_user_id text, p_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  perform public.get_balance(p_user_id);
  update public.players
     set balance = balance + p_amount, updated_at = now()
   where user_id = p_user_id
  returning balance into v;
  if v < 0 then
    raise exception 'insufficient_funds';
  end if;
  return v;
end $$;

create or replace function public.admin_adjust(p_user_id text, p_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
begin
  return public.change_balance(p_user_id, p_amount);
end $$;

create or replace function public.give_all(p_amount numeric)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.players set balance = balance + p_amount, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Postgres ne permet pas de changer le type de retour d'une fonction existante
-- avec CREATE OR REPLACE. On supprime donc l'ancienne signature avant de la
-- recréer (le grant execute est réappliqué juste après).
drop function if exists public.claim_daily(text, numeric);

create or replace function public.claim_daily(p_user_id text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'Europe/Paris')::date;
  v_ok boolean;
  v_bal numeric;
begin
  insert into public.daily_claims (user_id, claim_day, amount)
  values (p_user_id, v_day, p_amount)
  on conflict (user_id, claim_day) do nothing;
  get diagnostics v_ok = row_count;

  if v_ok then
    v_bal := public.change_balance(p_user_id, p_amount);
  else
    v_bal := public.get_balance(p_user_id);
  end if;
  return jsonb_build_object('claimed', v_ok, 'amount', p_amount, 'balance', v_bal);
end $$;

grant execute on function public.get_balance(text) to service_role;
grant execute on function public.change_balance(text, numeric) to service_role;
grant execute on function public.admin_adjust(text, numeric) to service_role;
grant execute on function public.give_all(numeric) to service_role;
grant execute on function public.claim_daily(text, numeric) to service_role;

-- =====================================================================
-- 2. COMMANDES DU PANNEAU ADMIN — ÉCONOMIE
-- =====================================================================

-- [Economy → + Add]  admin_eco {op:'add', userId, amount}
-- Remplacez 'YOUR_DISCORD_ID' et 100 :
select public.change_balance('YOUR_DISCORD_ID', 100);
-- équivalent SQL direct :
update public.players set balance = balance + 100, updated_at = now() where user_id = 'YOUR_DISCORD_ID';

-- [Economy → - Remove]  admin_eco {op:'remove', userId, amount}
select public.change_balance('YOUR_DISCORD_ID', -100);

-- [Economy → Set]  admin_eco {op:'set', userId, amount}
update public.players set balance = 100, updated_at = now() where user_id = 'YOUR_DISCORD_ID';

-- [Economy → View]  admin_eco {op:'view', userId}
select user_id, balance from public.players where user_id = 'YOUR_DISCORD_ID';
select elo, games, wins, losses, peak from public.player_rank where user_id = 'YOUR_DISCORD_ID';

-- [Economy → Player stats]  admin_eco {op:'player_stats', userId}
select p.user_id, p.balance, r.elo, r.games, r.wins, r.losses, r.peak,
       (select count(*) from public.game_history h where h.user_id = p.user_id) as rounds
  from public.players p
  left join public.player_rank r on r.user_id = p.user_id
 where p.user_id = 'YOUR_DISCORD_ID';

-- [Economy → Gift all]  admin_eco {op:'gift_all', amount}
select public.give_all(100);
-- ou : update public.players set balance = balance + 100, updated_at = now();

-- [Economy → Reset balances]  admin_eco {op:'reset_balances'}
update public.players set balance = 0, updated_at = now() where user_id <> '__impossible__';

-- [Economy → Reset all-time]  admin_eco {op:'reset_alltime'}
update public.player_peaks set peak = 0, updated_at = now() where user_id <> '__impossible__';

-- [Economy → Reset stats]  admin_eco {op:'reset_stats'}
delete from public.game_history where user_id <> '__impossible__';

-- [Reset du daily d'un joueur (utile en test)]
delete from public.daily_claims where user_id = 'YOUR_DISCORD_ID';

-- =====================================================================
-- 3. COMMANDES DU PANNEAU ADMIN — RANGS / RR (classé = blackjack)
-- =====================================================================

-- [Ranks → Save ladder]  admin_ladder_set
insert into public.site_rank_ladder (id, fam, fi, div, name, min_rr, c1, c2, sym, pips, updated_at)
values (0, 'Bronze', 1, 'III', 'Bronze III', 0, '#a78bfa', '#5b21b6', 'chev', 1, now())
on conflict (id) do update set
  fam = excluded.fam, fi = excluded.fi, div = excluded.div, name = excluded.name,
  min_rr = excluded.min_rr, c1 = excluded.c1, c2 = excluded.c2,
  sym = excluded.sym, pips = excluded.pips, updated_at = now();

-- [Ranks → Reload ladder]  admin_ladder_get
select * from public.site_rank_ladder order by id;

-- [Ranks → Reset RR / nouvelle saison]  admin_rank_reset
-- Remet TOUS les joueurs au rang de départ (identique au bouton "Réinitialiser les RR").
update public.player_rank
   set elo = 1000, peak = 1000, games = 0, wins = 0, losses = 0,
       place = 0, earned = 0, season = to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD'),
       updated_at = now()
 where true;

-- Classement RR actuel
select user_id, name, elo, games, wins, losses, peak, season
  from public.player_rank
 where games > 0 or place > 0
 order by elo desc, games desc
 limit 100;

-- =====================================================================
-- 4. COMMANDES DU PANNEAU ADMIN — BOUTIQUE / TÂCHES / COMMANDES
-- =====================================================================

-- [Rewards → créer / modifier]  admin_reward_save
insert into public.shop_rewards
  (id, name, description, price, type, role_id, min_invites, min_games, active, stock, updated_at)
values
  ('reward_exemple', 'Nitro', 'Discord Nitro', 500, 'role', '123456789012345678', 0, 0, true, null, now())
on conflict (id) do update set
  name = excluded.name, description = excluded.description, price = excluded.price,
  type = excluded.type, role_id = excluded.role_id, min_invites = excluded.min_invites,
  min_games = excluded.min_games, active = excluded.active, stock = excluded.stock,
  updated_at = now();

-- [Rewards → supprimer]  admin_reward_del
delete from public.shop_rewards where id = 'reward_exemple';

-- [Tasks → créer / modifier]  admin_task_save
insert into public.shop_tasks (id, name, description, reward, type, target, active, updated_at)
values ('task_exemple', 'Jouer 3 parties', 'Termine 3 manches', 15, 'games', 3, true, now())
on conflict (id) do update set
  name = excluded.name, description = excluded.description, reward = excluded.reward,
  type = excluded.type, target = excluded.target, active = excluded.active, updated_at = now();

-- [Tasks → supprimer]  admin_task_del
delete from public.shop_tasks where id = 'task_exemple';

-- [Orders → liste]
select code, user_id, user_name, reward_name, type, price, status, created_at, delivered_at
  from public.shop_orders
 order by created_at desc
 limit 2000;

-- [Orders → marquer livré]  (bouton "Mark delivered" du ticket Discord)
update public.shop_orders
   set status = 'delivered', delivered_at = now()
 where code = 'YOUR_ORDER_CODE';

-- [Orders → supprimer l'historique d'un joueur]  shop_orders_clear
delete from public.shop_orders where user_id = 'YOUR_DISCORD_ID';

-- [Orders → supprimer TOUT l'historique]  admin_orders_clear
delete from public.shop_orders where code <> '';

-- [Progression des tâches — lecture]
select * from public.shop_task_progress where day = '2026-11-17';

-- [Progression des tâches — écriture (usage interne)]
insert into public.shop_task_progress (user_id, day, done, prog, updated_at)
values ('YOUR_DISCORD_ID', '2026-11-17', '[]'::jsonb, '{}'::jsonb, now())
on conflict (user_id, day) do update set
  done = excluded.done, prog = excluded.prog, updated_at = now();

-- [Progression des tâches — reset quotidien manuel]
delete from public.shop_task_progress where day = '2026-11-17';

-- [Ticket claim rewards — configuration]  (/ticketsetup)
insert into public.shop_ticket_cfg (guild_id, category_id, panel_channel_id, updated_at)
values ('YOUR_GUILD_ID', 'YOUR_CATEGORY_ID', 'YOUR_PANEL_CHANNEL_ID', now())
on conflict (guild_id) do update set
  category_id = excluded.category_id, panel_channel_id = excluded.panel_channel_id,
  updated_at = now();
select * from public.shop_ticket_cfg;

-- =====================================================================
-- 5. DIAGNOSTIC — code invalide / commande non visible par le bot
-- =====================================================================
-- Le bot interroge shop_orders : cette ligne doit renvoyer exactement 1 pour
-- un code acheté sur le site. Si elle renvoie 0, le code est invalide.
select count(*) from public.shop_orders where upper(code) = upper('YOUR_ORDER_CODE');

-- Codes créés dans les dernières 24 h (vérification de la synchro)
select code, user_id, reward_name, status, created_at
  from public.shop_orders
 where created_at > now() - interval '24 hours'
 order by created_at desc;

-- Optionnel : activer Supabase Realtime sur shop_orders pour que le bot reçoive
-- les nouveaux codes instantanément (un polling SQL de 2 s reste actif sinon).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shop_orders'
  ) then
    alter publication supabase_realtime add table public.shop_orders;
  end if;
end $$;

-- =====================================================================
-- 6. RÔLES LIVRÉS DIRECTEMENT (aucun order code, aucun ticket)
-- =====================================================================
-- Les récompenses de type 'role' sont ajoutées directement par le site via
-- le bot. Aucune ligne n'est créée dans shop_orders pour ces récompenses.
-- On garde uniquement une trace durable ici.
create table if not exists public.shop_role_grants (
  id           bigint generated always as identity primary key,
  user_id      text not null,
  user_name    text not null default '',
  guild_id     text not null default '',
  reward_id    text not null default '',
  reward_name  text not null default '',
  role_id      text not null default '',
  price        numeric(18,2) not null default 0,
  status       text not null default 'delivered', -- delivered | failed
  error        text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists shop_role_grants_user_idx on public.shop_role_grants (user_id, created_at desc);
alter table public.shop_role_grants
  add column if not exists user_id text not null default '',
  add column if not exists user_name text not null default '',
  add column if not exists guild_id text not null default '',
  add column if not exists reward_id text not null default '',
  add column if not exists reward_name text not null default '',
  add column if not exists role_id text not null default '',
  add column if not exists price numeric(18,2) not null default 0,
  add column if not exists status text not null default 'delivered',
  add column if not exists error text not null default '',
  add column if not exists created_at timestamptz not null default now();
alter table public.shop_role_grants enable row level security;

select user_id, user_name, reward_name, role_id, price, status, error, created_at
  from public.shop_role_grants
  order by created_at desc;

-- =====================================================================
-- 7. ÉVÉNEMENT ROULETTE (chrono, participants, gagnant, ZTKN dédié)
-- =====================================================================
create table if not exists public.roulette_events (
  id            text primary key,
  guild_id      text not null,
  title         text not null default 'Roulette événement',
  amount        numeric(18,2) not null default 0,
  status        text not null default 'running', -- running | finished
  seconds       integer not null default 60,
  starts_at     timestamptz,
  ends_at       timestamptz,
  finished_at   timestamptz,
  winner_id     text,
  winner_name   text not null default '',
  winner_avatar text not null default '',
  participants  jsonb not null default '[]'::jsonb,
  launched_by   text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists roulette_events_guild_idx on public.roulette_events (guild_id, created_at desc);
alter table public.roulette_events
  add column if not exists title text not null default 'Roulette événement',
  add column if not exists amount numeric(18,2) not null default 0,
  add column if not exists status text not null default 'running',
  add column if not exists seconds integer not null default 60,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists winner_id text,
  add column if not exists winner_name text not null default '',
  add column if not exists winner_avatar text not null default '',
  add column if not exists participants jsonb not null default '[]'::jsonb,
  add column if not exists launched_by text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.roulette_event_participants (
  id          bigint generated always as identity primary key,
  event_id    text not null,
  guild_id    text not null default '',
  user_id     text not null,
  user_name   text not null default '',
  avatar      text not null default '',
  joined_at   timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists roulette_event_participants_event_idx on public.roulette_event_participants (event_id, joined_at);
alter table public.roulette_event_participants
  add column if not exists guild_id text not null default '',
  add column if not exists user_id text not null default '',
  add column if not exists user_name text not null default '',
  add column if not exists avatar text not null default '',
  add column if not exists joined_at timestamptz not null default now();

create table if not exists public.roulette_event_results (
  id          bigint generated always as identity primary key,
  event_id    text not null,
  guild_id    text not null default '',
  winner_id   text not null,
  winner_name text not null default '',
  amount      numeric(18,2) not null default 0,
  created_at  timestamptz not null default now(),
  unique (event_id, winner_id)
);
create index if not exists roulette_event_results_guild_idx on public.roulette_event_results (guild_id, created_at desc);
alter table public.roulette_event_results
  add column if not exists guild_id text not null default '',
  add column if not exists winner_id text not null default '',
  add column if not exists winner_name text not null default '',
  add column if not exists amount numeric(18,2) not null default 0,
  add column if not exists created_at timestamptz not null default now();

alter table public.roulette_events enable row level security;
alter table public.roulette_event_participants enable row level security;
alter table public.roulette_event_results enable row level security;

select id, title, amount, status, seconds, winner_name, participants, created_at
  from public.roulette_events
  order by created_at desc
  limit 20;

select event_id, winner_name, amount, created_at
  from public.roulette_event_results
  order by created_at desc
  limit 50;

-- =====================================================================
-- 8. RESET DU SOLDE D'UN JOUEUR / RESET GLOBAL
-- =====================================================================

-- [Economy → Reset solde joueur]  admin_eco {op:'reset_balance', userId}
-- Remplacez 'YOUR_DISCORD_ID' par le vrai ID Discord.
update public.players set balance = 0, updated_at = now() where user_id = 'YOUR_DISCORD_ID';

select user_id, balance from public.players where user_id = 'YOUR_DISCORD_ID';

-- [Reset RR d'un seul joueur]
update public.player_rank
   set elo = 1000, peak = 1000, games = 0, wins = 0, losses = 0,
       place = 0, earned = 0, updated_at = now()
 where user_id = 'YOUR_DISCORD_ID';
