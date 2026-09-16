# Working in this repo

Design doc: `PLAN.md` (same file as `../opto-pre/ask-alex-demo-plan.md`). Read section 5b–5d before
touching scoring, ranking or question generation — the rules there are deliberate.

## Mastra

The Mastra skill is installed (`.claude/skills/mastra`, also `.agents/skills/`). **Use it.** Its first
rule: do not trust model memory for Mastra APIs. After `npm install`, verify against
`node_modules/@mastra/core/dist/docs` before changing anything in `server/src/mastra/`.

Files written from documentation, not from a running install — verify them first:
- `server/src/mastra/agents/ask-alex.ts` — Agent constructor, `model` string form
- `server/src/routes/ask.ts` — `agent.stream()` return shape, `onStepFinish`, `textStream`
- `server/src/mastra/tools/*` — `createTool` execute signature, structured output in `generate()`

## Invariants — don't quietly change these

- The model never writes SQL. Queries live in `server/src/semantic/queries.ts`, parameterized.
- Metrics are defined once in `server/src/semantic/metrics.ts`. A metric that isn't there is unanswerable.
- One interview per application (`@@unique([applicationId])`); every completed interview has one Feedback row.
- Ranking = stage, then `scoreRaw`, then recency. The answer must state the rule it used.
- Tools return small structured results, never raw row dumps. Cap 25 rows.
- Read-only. No write tools.
- Seed RNG is fixed — evals depend on the data being identical.

## Status

Done: schema, deterministic seed, semantic layer (metrics + ranked queries), 5 tools, agent,
Hono server (REST + SSE `/api/ask`), eval cases + runner, web shell with jobs/candidates/interviews
list + detail and the Ask Alex sidebar (⌘K).

Next: `npm run setup`, fix whatever the install surfaces, then wire the evals page in
`web/src/main.tsx` (Settings → Evaluations) to `POST /api/evals/run`.
