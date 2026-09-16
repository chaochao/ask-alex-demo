# Ask Alex — demo

A small rebuild of an app-wide AI assistant over recruiting data: jobs, candidates, interviews.
Built the way the production version *should* have been — a few composable tools over a defined
semantic layer, deterministic SQL, and an eval set.

Plan and design decisions: `../opto-pre/ask-alex-demo-plan.md`

## Setup

```bash
npx skills add mastra-ai/skills     # gives your coding agent current Mastra APIs
cp .env.example .env                # add OPENAI_API_KEY
npm run setup                       # install + create + seed the SQLite db
npm run dev                         # server :4111, web :5173
npm run eval                        # run the evaluation set
```

## What's where

```
server/
  prisma/schema.prisma      data model
  prisma/seed.ts            deterministic seed (fixed RNG — evals rely on it)
  src/semantic/metrics.ts   metric definitions — the only place a metric is defined
  src/semantic/queries.ts   parameterized SQL. The model never writes SQL.
  src/mastra/tools/         4 tools: search, get, metrics, ranked list, question generation
  src/mastra/agents/        the Ask Alex agent
  src/routes/               REST for the UI + POST /api/ask (SSE)
  evals/                    cases.json + runner
web/
  src/routes/               jobs, candidates, interviews (list + detail)
  src/components/AskAlex/   the sidebar, available on every page
```

## Demo path

1. Jobs → a job → ask *"how is this pipeline doing?"*
2. *"top 10 candidates for this job"* — note the answer states the ranking rule
3. *"generate 8 interview questions for this JD, mostly technical"*
4. Settings → Evaluations → Run

## Status

Installed, seeded, running, and restyled (Tailwind v4 + shadcn/ui). Live at
`chaochao/ask-alex-demo` on GitHub (private). See `CLAUDE.md` for the two version-drift fixes
(Mastra's model wiring, a Tailwind v4 translate quirk) worth knowing before editing further, and
for what's left (wiring the evals page).
