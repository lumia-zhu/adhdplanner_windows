-- ============================================================
-- Supabase 数据库建表脚本
-- 在 Supabase Dashboard → SQL Editor 中执行本文件全部内容
-- 可重复执行：先删后建，不会报错
-- ============================================================

-- ====== 清理旧表（级联删除策略和索引） ======
drop table if exists memory_store cascade;
drop table if exists reflection_sessions cascade;
drop table if exists reflection_chats cascade;
drop table if exists tracker_events cascade;
drop table if exists activity_records cascade;
drop table if exists tasks cascade;
drop table if exists ai_configs cascade;
drop table if exists profiles cascade;

-- ====== 开始建表 ======

-- 1. 用户资料
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  major text default '',
  grade text default '',
  challenges text[] default '{}',
  workplaces text[] default '{}',
  plan_time text,
  reflection_time text,
  updated_at timestamptz default now()
);

-- 已建库的用户：补加 plan_time 列（多次执行不会报错）
alter table profiles add column if not exists plan_time text;

alter table profiles enable row level security;
create policy "profiles_user_policy" on profiles
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. AI 配置
create table if not exists ai_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  api_url text default '',
  api_key text default '',
  model_id text default '',
  updated_at timestamptz default now()
);

alter table ai_configs enable row level security;
create policy "ai_configs_user_policy" on ai_configs
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. 每日任务
create table if not exists tasks (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  title text not null default '',
  note text default '',
  priority text default 'medium',
  completed boolean default false,
  subtasks jsonb default '[]',
  paused_session jsonb,
  carried_from text,
  focus_duration integer default 0,
  created_at bigint,
  primary key (user_id, date, id)
);

alter table tasks enable row level security;
create policy "tasks_user_policy" on tasks
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_tasks_user_date on tasks(user_id, date);

-- 4. 活跃度采样
create table if not exists activity_records (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  ts bigint not null,
  idle integer default 0,
  active_samples integer default 0,
  total_samples integer default 0,
  active_ratio real default 0,
  app_usage jsonb default '{}'::jsonb
);

-- 已建库的用户：补加 app_usage 列（多次执行不会报错）
alter table activity_records add column if not exists app_usage jsonb default '{}'::jsonb;

alter table activity_records enable row level security;
create policy "activity_user_policy" on activity_records
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_activity_user_date on activity_records(user_id, date);

-- 5. 行为追踪事件
create table if not exists tracker_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  event_id text,
  event_type text,
  timestamp bigint,
  payload jsonb
);

alter table tracker_events enable row level security;
create policy "tracker_user_policy" on tracker_events
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_tracker_user_date on tracker_events(user_id, date);

-- 6. 反思聊天
create table if not exists reflection_chats (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_key text not null,
  bubbles jsonb default '[]',
  messages jsonb default '[]',
  step integer default 0,
  saved_at bigint,
  primary key (user_id, chat_key)
);

alter table reflection_chats enable row level security;
create policy "reflection_user_policy" on reflection_chats
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 7. 反思原始会话（Memory Raw Session）
create table if not exists reflection_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_key text not null,
  date text not null,
  mode text not null default 'daily',
  status text not null default 'in_progress',
  messages jsonb default '[]',
  started_at bigint,
  saved_at bigint,
  primary key (user_id, session_key)
);

alter table reflection_sessions enable row level security;
create policy "reflection_sessions_user_policy" on reflection_sessions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 8. 结构化记忆（Memory Store）
create table if not exists memory_store (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sessions jsonb default '[]',
  commitments jsonb default '[]',
  last_updated bigint default 0,
  saved_at bigint
);

alter table memory_store enable row level security;
create policy "memory_store_user_policy" on memory_store
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
