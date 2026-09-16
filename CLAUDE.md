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

Done: schema, deterministic seed (now 0-100 scores, not 1-5), semantic layer (metrics + ranked
queries), 5 tools, agent, Hono server (REST + SSE `/api/ask`), eval cases + runner. Web shell is
installed, running, and restyled with Tailwind v4 + shadcn/ui: jobs/candidates/interviews list +
detail, Settings, and the Ask Alex sidebar (⌘K) — color-coded status/source badges, nav icons,
a page fade transition, and a slide in/out sidebar. Pushed to a private GitHub repo
(`chaochao/ask-alex-demo`).

**Two non-obvious fixes worth knowing before touching this code again:**
- The installed `@mastra/core` (0.10.15) needs an actual `LanguageModelV1` object for `model`, not
  the bare `"provider/model"` string this repo's docs originally assumed. `ask-alex.ts` wires it
  through `@ai-sdk/openai`, pinned to `^1.3.24` specifically — later majors depend on
  `@ai-sdk/provider` v2+/v4, which the installed `ai@4.x` runtime rejects. Model is `gpt-5-mini`,
  set via `MODEL` in `.env`.
- Tailwind v4's `translate-x-*` utility compiles to `translate: var(--tw-translate-x)
  var(--tw-translate-y))` — if you use `translate-x-*` without ever setting a `translate-y-*`
  anywhere, `--tw-translate-y` is undefined, which invalidates the whole shorthand and the
  translate silently does nothing. Always pair `translate-x-*` with `translate-y-0` (or vice versa).

Next: wire the evals page in `web/src/main.tsx` (Settings → Evaluations) to `POST /api/evals/run`;
that's the only item left from the original plan. `ponytail` plugin was installed at project scope
(`.claude/settings.json`, uncommitted per user request) — takes effect next session.
