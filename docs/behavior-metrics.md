# Behavior Metrics and Event Dictionary

This document is the shared source of truth for behavior tracking, Supabase analytics, dashboard metrics, and research exports.

## Version

- Metrics version: `2026-05-16-v1`
- Event schema version: `2026-05-16-v1`

When a metric definition changes, keep the old event data compatible and record the change here before updating dashboard calculations.

## Date Fields

- `timestamp`: the exact time the event happened, in milliseconds.
- `event.date`: the storage shard date for local files and Supabase `tracker_events.date`.
- `payload.date`: the date the user is viewing or reflecting on, when applicable.
- `logicalDate`: the behavioral date the event should be analyzed against. For reflection on a historical date, this should match the reflected date, not necessarily today's date.

For day-level analytics, prefer `logicalDate` when present, then `payload.date`, then `event.date`.

## Event Namespaces

- `plan.*`: planning and task start scaffolding.
- `exec.*`: task execution and micro-step lifecycle.
- `stuck.*`: stuck support and rescue funnel.
- `reflect.*`: reflection page and reflection chat behavior.
- `mood.*`: mood check-in flow.
- `memory.*`: memory management panel.
- `task.*`: task list and task structure changes.
- `session.*`: focus session lifecycle.
- `app.*`, `auth.*`, `settings.*`, `nav.*`, `mode.*`: system, account, navigation, and view mode events.

## Conversation Records

Raw AI conversations are saved separately from tracker events. Tracker events answer "what happened"; conversation records preserve "what was said".

Recommended canonical fields:

- `conversationId`: stable unique id.
- `conversationType`: `reflection` or `stuck`.
- `date`: storage date.
- `logicalDate`: date the conversation is about.
- `mode`: `daily`, `weekly`, or `stuck`.
- `sessionId`: focus session id, when available.
- `taskId` and `taskTitle`: task context, when available.
- `status`: `in_progress`, `processed`, or `abandoned`.
- `startedAt`, `endedAt`, `savedAt`: timestamps in milliseconds.
- `messages`: ordered message list with `role`, `content`, and `ts`.
- `metadata`: non-sensitive context such as stuck category, response mode, or source screen.

Conversation records should not replace `memory_store`. `memory_store` contains extracted summaries, commitments, first-step preferences, stuck reasons, and hint feedback. Conversations are the raw evidence behind those derived memories.

## Core Metrics

### Reflection Completion Rate

`reflect.ended` count / `reflect.opened` count.

Use only events with matching `logicalDate` and `mode`. `reflect.closed` is a lifecycle quality signal, not the numerator for completion.

### First-Step Adoption Rate

`plan.first_micro` where `source` is `ai_chip` or `memory_chip` / all `plan.first_micro`.

Keep `ai_chip` and `memory_chip` separate in dashboards because they represent different support mechanisms.

### Stuck Support Trigger Count

Count of `stuck.triggered`.

This is engagement with stuck support, not total real-world stuck moments.

### Stuck Rescue Success Rate

Stuck episodes followed by resumed execution or task completion / all stuck episodes.

A successful rescue can be inferred from `exec.micro_started`, `exec.micro_completed`, `session.ended` with `endReason='task_done'`, or future explicit `stuck.pivot_chosen` / `stuck.resolved` events sharing the same `sessionId`.

### Task Completion Rate

Completed tasks / total tasks for a given date.

Use the `tasks` table as the canonical source for day-level task outcomes.

### Focus To Computer Active Ratio

Focus session minutes / computer active minutes.

Computer active minutes come from `activity_records`, not from tracker events.

## Dashboard Rules

- Every dashboard card should cite one metric from this document.
- Research exports should include both raw event rows and derived metric columns where possible.
- Dashboard code should avoid hidden metric definitions inside ad hoc filters.
- If a metric depends on inferred matching, document the matching keys, usually `sessionId`, `taskId`, `logicalDate`, and `timestamp`.

## Current Known Gaps

- Stuck support has `stuck.triggered` and `stuck.reason`, but not all rescue decisions are explicit yet.
- Reflection events need consistent `daily` / `weekly` mode payloads.
- Historical-date reflection needs `logicalDate` to avoid mixing analysis date with today's storage date.
- Mood check-in flow needs explicit `mood.*` events for shown, submitted, dismissed, and reminded states.
