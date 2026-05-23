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

alter table profiles add column if not exists preferred_name text default '';
alter table profiles add column if not exists plan_time text;
alter table profiles add column if not exists reflection_time text;

alter table memory_store add column if not exists first_steps jsonb default '[]';
alter table memory_store add column if not exists stable_first_steps jsonb default '[]';
alter table memory_store add column if not exists stuck_reasons jsonb default '[]';
alter table memory_store add column if not exists hint_feedback jsonb default '[]';

-- Required by activity_records upsert on (user_id, date, ts).
create unique index if not exists activity_records_user_date_ts_unique
  on activity_records(user_id, date, ts);

-- Helpful for dashboard filters over raw tracker events.
create index if not exists idx_tracker_user_date_type
  on tracker_events(user_id, date, event_type);

-- Unified raw AI conversations for reflection and stuck support.
create table if not exists ai_conversations (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  conversation_type text not null check (conversation_type in ('reflection', 'stuck')),
  date text not null,
  logical_date text not null,
  mode text not null,
  session_id text,
  task_id text,
  task_title text,
  status text not null default 'in_progress',
  started_at bigint,
  ended_at bigint,
  saved_at bigint,
  messages jsonb default '[]',
  metadata jsonb default '{}',
  primary key (user_id, conversation_id)
);

alter table ai_conversations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_conversations'
      and policyname = 'ai_conversations_user_policy'
  ) then
    create policy "ai_conversations_user_policy" on ai_conversations
      for all using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

create index if not exists idx_ai_conversations_user_date
  on ai_conversations(user_id, logical_date, conversation_type);

create index if not exists idx_ai_conversations_user_session
  on ai_conversations(user_id, session_id);
