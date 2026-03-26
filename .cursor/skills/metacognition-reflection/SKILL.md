---
name: metacognition-reflection
description: >-
  Metacognition theory framework for designing AI reflection prompts and
  evaluating reflection chat quality. Use when modifying reflection system
  prompts, adjusting AI dialogue flow, reviewing reflection features, or
  working on ReflectionChat / ReflectionView components.
---

# Metacognition Reflection Framework

This skill provides the theoretical foundation for the AI reflection assistant's prompt design. The prototype helps ADHD university students improve metacognition through a post-task reflection chat powered by GenAI.

## When to Use

- Modifying `buildReflectionSystemPrompt` or `buildWeeklyReflectionSystemPrompt` in `src/renderer/src/services/ai.ts`
- Adjusting conversation logic in `src/renderer/src/components/ReflectionChat.tsx`
- Changing reflection UI/UX in `src/renderer/src/components/ReflectionView.tsx`
- Evaluating whether AI-generated questions meet metacognitive quality standards
- Designing new reflection-related features (e.g., memory system, weekly summaries)

## Core Principle

The goal of reflection is NOT to make users answer more questions. It is to **help users see what they couldn't see before** — identify key patterns in their task process and turn those patterns into transferable experience.

## Four Metacognitive Dimensions

Every reflection question should target one of these dimensions. They are not sequential steps; follow the user's natural conversation direction.

| Dimension | Focus | Example Angle |
|-----------|-------|---------------|
| **See the Task** | Was the task's real difficulty where the user expected? Did initial understanding match reality? | "Which part turned out more complex than you thought?" |
| **See Yourself** | User's state, habits, and sources of difficulty during the task. | "What was happening when you got stuck — was it not knowing how, or not being able to keep going?" |
| **See the Strategy** | What methods did the user actually use? Which were effective? | "What approach helped the most? Why do you think it worked?" |
| **See the Pattern** | Extract transferable lessons from this experience for future tasks. | "Next time you hit a similar task, what would you want to watch out for?" |

## Prompt Design Constraints

These rules are already embedded in the current system prompts. Preserve them when making changes:

1. **Open-ended only** — No binary questions (yes/no/right?). Use "what conditions", "how did you do it", "which specific step".
2. **No leading questions** — Questions must not contain strategies, suggestions, or directional hints. AI presents data facts + asks curiously; the user generates their own strategies.
3. **One question per message** — First paragraph states data facts (2-3 sentences), second paragraph asks one core question.
4. **Never think for the user** — Questions can only point to the user's recall ("what did it feel like") or the user's own planning ("how would you arrange it"). Never hint at a direction.
5. **ADHD encouragement** — Affirm before exploring. No judgment words (short/only/not enough/inefficient/wasted/procrastinated).

## Key Project Files

| File | Role |
|------|------|
| `src/renderer/src/services/ai.ts` | `buildReflectionSystemPrompt`, `buildWeeklyReflectionSystemPrompt`, `chatReflectionStream` |
| `src/renderer/src/components/ReflectionChat.tsx` | Chat UI, message history, streaming display, end-chat logic |
| `src/renderer/src/components/ReflectionView.tsx` | Data visualization, system prompt construction, screenshot capture |
| `src/renderer/src/components/WeekView.tsx` | Weekly reflection data and chart rendering |
| `src/renderer/src/services/tracker.ts` | `buildDailySummary`, `summaryToLLMContext`, `buildWeeklyLLMContext` |

## Detailed Reference

For the full metacognition theory (definitions, knowledge taxonomy, regulation processes, detailed example questions per dimension), see [references/framework.md](references/framework.md).
