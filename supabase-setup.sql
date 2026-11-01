-- aug.mente : base de données (Supabase)
-- À coller dans Supabase > SQL Editor > New query, puis « Run ».
-- Le script peut être relancé sans risque : il ne recrée que ce qui manque.

-- 1. Données de chaque utilisateur (rituels, actions, caps, bilans)
create table if not exists public.weekly_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  constraint weekly_state_taille check (octet_length(data::text) < 2000000)
);
alter table public.weekly_state enable row level security;
drop policy if exists "lire ses donnees"      on public.weekly_state;
drop policy if exists "creer ses donnees"     on public.weekly_state;
drop policy if exists "modifier ses donnees"  on public.weekly_state;
drop policy if exists "supprimer ses donnees" on public.weekly_state;
-- Chaque personne ne voit et ne modifie que ses propres données.
-- L'administrateur n'y a PAS accès : le contenu reste privé.
create policy "lire ses donnees"      on public.weekly_state for select using (auth.uid() = user_id);
create policy "creer ses donnees"     on public.weekly_state for insert with check (auth.uid() = user_id);
create policy "modifier ses donnees"  on public.weekly_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "supprimer ses donnees" on public.weekly_state for delete using (auth.uid() = user_id);

-- 2. Profils : offre (free / plus / pro) et rôle administrateur
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  plan       text not null default 'free' check (plan in ('free','plus','pro')),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

drop policy if exists "voir son profil"          on public.profiles;
drop policy if exists "admin modifie les offres" on public.profiles;
-- Chacun voit son profil ; l'administrateur voit tous les profils.
create policy "voir son profil" on public.profiles for select using (id = auth.uid() or public.is_admin());
-- Seul l'administrateur peut changer une offre (personne ne peut s'attribuer Plus ou Pro).
create policy "admin modifie les offres" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

-- Création automatique du profil à l'inscription.
-- L'adresse ci-dessous devient administrateur, avec accès à toutes les offres.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, is_admin, plan)
  values (new.id, new.email,
          lower(new.email) = 'damien.courtin@gmail.com',
          case when lower(new.email) = 'damien.courtin@gmail.com' then 'pro' else 'free' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Comptes déjà créés avant ce script
insert into public.profiles (id, email) select id, email from auth.users on conflict (id) do nothing;
update public.profiles set is_admin = true, plan = 'pro' where lower(email) = 'damien.courtin@gmail.com';

-- 3. Usage du coach IA (quota mensuel). Écrit uniquement par le serveur.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month   text not null,
  calls   integer not null default 0,
  primary key (user_id, month)
);
alter table public.ai_usage enable row level security;
drop policy if exists "voir son usage" on public.ai_usage;
create policy "voir son usage" on public.ai_usage for select using (user_id = auth.uid() or public.is_admin());

-- 4. Suppression de son propre compte (bouton dans Réglages)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
