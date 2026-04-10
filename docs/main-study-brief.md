# Main Study Protocol — Brief Overview

## Research Questions

**Main RQ**: How does GenAI-based metacognitive scaffolding manifest in the everyday task management practices of people with executive function difficulties, and what design implications does it reveal?

- **Sub-RQ1**: How do people with executive function difficulties invoke, interpret, and negotiate GenAI-based metacognitive scaffolding in everyday task management?
- **Sub-RQ2**: What key design principles and boundaries for GenAI-based metacognitive scaffolding are revealed through these use experiences?

---

## Study Design

- **Paradigm**: Qualitative-dominant mixed-methods field study
- **Duration**: ~2.5 weeks (Day 0 + 14-day deployment + Day 15)
- **Participants**: 12–16 university students with ADHD diagnosis or significant executive function difficulties
- **Prototype**: MetaPlan — a desktop task management tool with GenAI-based metacognitive scaffolding

---

## Timeline at a Glance

```
Day 0                          Day 1 ────────────────── Day 14           Day 15
 │                              │                          │                │
 ▼                              ▼                          ▼                ▼
Pre-study Session          2-week In-the-wild Deployment              Post-study Session
┌─────────────────┐       ┌──────────────────────────────┐       ┌──────────────────┐
│ Informed consent│       │ Natural use of MetaPlan      │       │ Post questionnaire│
│ Pre questionnaire│      │ Daily micro-survey (5 items) │       │ Semi-structured  │
│ Pre interview    │       │ Mid-check (Day 7–8)          │       │   interview with │
│ Install & onboard│      │ Min usage requirements       │       │   trace elicit.  │
└─────────────────┘       └──────────────────────────────┘       └──────────────────┘
     ~60–90 min              Participant's real context              ~60–90 min
```

---

## Day 0 — Pre-study Session

| Step | Detail | Duration |
|------|--------|:--------:|
| Informed consent | Purpose, data usage, right to withdraw | 5 min |
| Pre questionnaire | MAI-19 (adapted) + SESRL (adapted) | ~8 min |
| Pre interview | Current task management habits → serves as **baseline** | 20–30 min |
| Install & onboarding | Install MetaPlan, walk through core features once | 15–20 min |

**Pre-interview focus** (baseline collection):
1. Current daily task management practice (tools, strategies, routines)
2. Key difficulties (task initiation, getting stuck, forgetting to review)
3. Prior tool experience and expectations

> No separate baseline period — participants' existing habits collected through interview serve as the "before" reference.

---

## Day 1–14 — 2-week Deployment

**Minimum usage requirements** (to ensure analyzable data):
- Use MetaPlan ≥ 4 days per week
- Complete ≥ 3 reflection conversations per week
- Micro-survey response rate ≥ 70% (≥ 10 out of 14 days)

**Daily micro-survey** (5 items, 7-point Likert, ~1 min):

| # | Item | Dimension |
|:-:|------|-----------|
| 1 | I knew clearly what to do first today | Forethought |
| 2 | When stuck, I could figure out how to continue | Performance control |
| 3 | I had a clear sense of how I spent my time today | Monitoring |
| 4 | I am satisfied with my task completion today | Self-reflection |
| 5 | Using MetaPlan helped me manage my tasks today | Tool perception |

**Researcher role**: Passive observation + usage monitoring. No feature-specific nudging. Mid-check at Day 7–8 (brief, non-directive).

---

## Day 15 — Post-study Session

| Step | Detail | Duration |
|------|--------|:--------:|
| Post questionnaire | MAI-19 + SESRL (same as pre) | ~8 min |
| Part A: Overall reflection | General experience, positive & negative moments | 10 min |
| Part B: Trace elicitation | Walk through 3–5 key usage episodes from logs | 30–40 min |
| Part C: Feature-level discussion | For each feature: what it helps, when it helps/doesn't, what to change | 15–20 min |
| Part D: Wrap-up | Perceived changes, lasting habits, open feedback | 5–10 min |

---

## Data Collection → Research Questions Mapping

| Data Source | What It Captures | Sub-RQ1 | Sub-RQ2 |
|-------------|-----------------|:-------:|:-------:|
| **Pre interview** | Existing habits (baseline) | ✓ | |
| **Pre/post questionnaires** | Metacognitive awareness & self-efficacy shift | ✓ | |
| **System behavior logs** | Task events, session timing, feature usage patterns | ✓ | ✓ |
| **AI interaction traces** | How users invoke, adopt, ignore, or negotiate AI suggestions | ✓ | ✓ |
| **Daily micro-survey** | Day-level self-regulation perception trends | ✓ | |
| **Post interview + trace elicitation** | Deep understanding, negative cases, design boundaries | ✓ | ✓ |

### What each data source answers best

| Data Source | Best For |
|-------------|---------|
| System logs | What users did, when, which features were used/ignored |
| Daily micro-survey | Day-level subjective experience, trends over time |
| Pre interview | Baseline practices & difficulties |
| Post interview | How users understand the system, what helped vs. burdened |
| Trace elicitation | Why specific behaviors happened at specific moments |

---

## Analysis Approach

**Primary**: Reflexive Thematic Analysis (Braun & Clarke, 2006, 2019)
- Transcribe → open coding → organize by RQ → candidate themes → cross-case comparison → final themes

**Secondary** (quantitative, supportive):
- Pre/post questionnaire: Wilcoxon signed-rank test (small N)
- Micro-survey: 14-day trend visualization
- Log summary metrics: daily focus time, task completion, stuck frequency, reflection triggers

**Triangulation**:
```
Behavior logs ("what they did")
        ↕
Daily micro-survey ("how they felt")
        ↕
Post interview ("why they did it, how they understand it")
```

---

## Key Design Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| No baseline period | Pre-interview captures existing habits; avoids 3-day burden on ADHD participants |
| 2-week deployment (not 1 week) | Allows habit formation and pattern emergence beyond novelty effect |
| Minimum usage requirements | Ensures sufficient data for analysis while keeping expectations low |
| Trace elicitation in post interview | Grounds discussion in actual behavior, reduces recall bias |
| Qualitative-dominant | Small N; goal is understanding "how" and "why", not measuring effect size |
