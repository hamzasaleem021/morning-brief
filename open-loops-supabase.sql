create table if not exists public.open_loops_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.open_loops_state enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on table public.open_loops_state to authenticated;
revoke all on table public.open_loops_state from anon;

drop policy if exists "users read own open loops state" on public.open_loops_state;
create policy "users read own open loops state"
on public.open_loops_state
for select
using (auth.uid() = user_id);

drop policy if exists "users insert own open loops state" on public.open_loops_state;
create policy "users insert own open loops state"
on public.open_loops_state
for insert
with check (auth.uid() = user_id);

drop policy if exists "users update own open loops state" on public.open_loops_state;
create policy "users update own open loops state"
on public.open_loops_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.get_open_loops_state(p_user_id uuid)
returns setof public.open_loops_state
language sql
security invoker
as $$
  select *
  from public.open_loops_state
  where user_id = p_user_id
    and auth.uid() = p_user_id;
$$;

grant execute on function public.get_open_loops_state(uuid) to authenticated;
revoke all on function public.get_open_loops_state(uuid) from anon;

create or replace function public.upsert_open_loops_state(p_user_id uuid, p_state_data jsonb)
returns public.open_loops_state
language plpgsql
security invoker
as $$
declare
  result public.open_loops_state;
begin
  insert into public.open_loops_state (user_id, state_data, updated_at)
  values (p_user_id, p_state_data, now())
  on conflict (user_id) do update
    set state_data = excluded.state_data,
        updated_at = now()
  where public.open_loops_state.user_id = auth.uid()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.upsert_open_loops_state(uuid, jsonb) to authenticated;
revoke all on function public.upsert_open_loops_state(uuid, jsonb) from anon;

do $$
begin
  begin
    alter publication supabase_realtime add table public.open_loops_state;
  exception
    when duplicate_object then null;
  end;
end;
$$;
