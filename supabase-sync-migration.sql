-- Non-destructive sync schema migration.
-- Run this in Supabase SQL Editor for an existing project before testing new sync fields.

create table if not exists mood_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  mood integer not null check (mood between 1 and 5),
  note text default '',
  updated_at bigint default 0,
  primary key (user_id, date)
);

alter table mood_records enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'mood_records'
      and policyname = 'mood_records_user_policy'
  ) then
    create policy "mood_records_user_policy" on mood_records
      for all using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

create index if not exists idx_mood_records_user_date on mood_records(user_id, date);

alter table memory_store add column if not exists first_steps jsonb default '[]';
alter table memory_store add column if not exists stable_first_steps jsonb default '[]';
alter table memory_store add column if not exists stuck_reasons jsonb default '[]';
alter table memory_store add column if not exists hint_feedback jsonb default '[]';

-- Required by activity_records upsert on (user_id, date, ts).
create unique index if not exists activity_records_user_date_ts_unique
  on activity_records(user_id, date, ts);
