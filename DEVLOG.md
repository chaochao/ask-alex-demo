# Dev log

Running progress notes for ask-alex-demo. Newest entry on top. Not auto-loaded —
read it when you want history; `CLAUDE.md` stays for standing invariants only.

## 2026-09-17 — real bug fixes: tool args, job-title resolution, retry wrapper

**Confirmed and fixed a blocking runtime bug**, not just a type error: every tool's `execute`
destructured its top-level argument directly (`execute: async ({ entity, query, limit }) => ...`),
but the installed `@mastra/core`'s actual signature nests parsed input under `.context`
(`execute: async (context: { context: <parsed input>, mastra, runtimeContext, ... }) => ...`).
Confirmed by reading `node_modules/@mastra/core/dist/base-5ZyKaTRr.d.ts` directly — every tool was
receiving `undefined` for all its arguments. Fixed all 5 `execute` functions across
`server/src/mastra/tools/index.ts` and `generate-questions.ts` to destructure `{ context }`.

**Also fixed:** tool object keys didn't match each tool's own `id` (Mastra reports tool calls by
the object *key* in `tools: {...}`, not by `id` — confirmed by observation, not docs). Renamed
`tools/index.ts`'s exported map and `ask-alex.ts`'s `generateInterviewQuestions` entry to snake_case
so eval expectations, agent instructions, and actual tool-call names all agree. Also dropped
`Agent`'s invalid `id:` field (not part of `AgentConfig` — `name` is the id) and added a null check
where `generate-questions.ts` accessed `mastra` from the wrong argument entirely.

**Research detour:** forked a background agent to read a 46-lesson AI-agent course
(`~/Documents/repo/ai-learning/xiaozhe-E-commerce-main-...`) for patterns applicable to our
open problems (over-asking, empty answers, page-context wiring, evaluation). Its most actionable
finding: resolve a named-but-not-id'd entity **in code**, not via a prompt instruction telling the
model to search-then-chain — deterministic beats requested politeness.

Acted on that finding: added `jobIdFromTitle` in `queries.ts` (same pattern as the existing
`companyIdFromName` — fuzzy, word-based match, returns ambiguous list or empty rather than
guessing), exposed as `filters.jobTitle` on `query_metrics`/`query_entities`. The model can now
scope to "the Staff Backend Engineer role" in one tool call instead of search → chain → hope.
Also fixed `search_entities`' job branch the same way (word-based `AND` match instead of requiring
the whole query string as one substring — a real bug: a query like "Staff Backend Engineer job
posting" doesn't literally contain-match against the title "Staff Backend Engineer"), and added
company-name matching to it (was title-only).

Narrowed `ask-alex.ts`'s search-first instruction to only fire when the user actually names a
candidate/interview — the broader wording caused a regression where "How is the pipeline doing?"
(names nothing) triggered an unnecessary `search_entities` call.

Added a fixed fallback answer in `routes/ask.ts` for when the model returns empty text (a known,
still-unexplained failure mode — see below) — a production safety net, not a fix.

**Eval infra:** `server/evals/run.ts` calls sometimes 404'd (`service_auth_failure`) — spent a
while chasing this as a Mastra-internals bug (two sequential `mastra.getAgent().generate()` calls
in one process seemed to reliably fail on the 2nd), but a 6-in-a-row repeat test all succeeded —
it's transient flakiness, not deterministic. Retracted the wrong "Mastra bug" conclusion drawn from
too small a sample (2 trials). Real fix: `generateWithRetry()` wrapper (3 attempts, backoff) around
the eval's `agent.generate()` call.

**Full suite result after all fixes: 6/10 pass, no crash.** Of the 4 remaining fails, 3 are eval
*harness* bugs, not agent bugs:
- `demographics-refusal`, `write-refusal`: the agent correctly refuses, but its refusal regex
  (`can'?t`) and the `"read-only"` substring check only match ASCII `'`/`-` — the model outputs a
  curly apostrophe (’) and a non-breaking hyphen (‑) that don't match. Not fixed yet.
- `generate-questions`: harness counts bullet lines to check "6 questions"; the model's answer has
  a "what to listen for" sub-bullet under each question, doubling the count (12). Not a real
  question-count bug. Not fixed yet.

`avg-score` is the one still-genuinely-open bug: the follow-up turn ("All companies, all time.")
makes the model call `query_metrics` repeatedly with hallucinated, unrelated filter values, then
return empty text. Not understood yet — see the entry below for the original discovery and the
zod-optional-schema suspicion.

## 2026-09-17 — multi-turn eval + single-case runner + a new open bug

Added to `server/evals/run.ts`:
- Cases can now be a scripted conversation: `"turns": ["q1", "follow-up"]` instead of
  a single `"question"`, replayed as a stateless message array (`agent.generate`
  accepts `CoreMessage[]`, no Memory/threadId needed) — only the final turn is graded,
  tool usage accumulates across all turns. Converted `avg-score` to use this, answering
  the agent's own clarifying question.
- `npm run eval -- <case-id>` runs one case instead of all 10 (`process.argv[2]` filter).
- On FAIL, prints the actual answer text below the summary line.

Hardened `resolveWindow` in `queries.ts`: it was doing `new Date(w.from).toISOString()`
directly on model-supplied strings — a crash surfaced by the new avg-score follow-up
turn, where the model sent `window.from: "null"` (the literal string) and
`toISOString()` threw `RangeError: Invalid time value`, killing the whole tool call.
Now invalid/unparseable date strings are treated as absent instead of thrown. This is
a trust-boundary fix (model output is untrusted input into a date parser), not a
prompt-tuning fix.

**Open bug, not yet understood:** even after the crash fix, the avg-score follow-up
turn ("All companies, all time.") makes the model call `query_metrics` 7 times in a
row, each time inventing unrelated filter values (`stage: 'applied'`, `round: 'screen'`,
`location: 'sf'`, `roleFamily: 'software_engineer'`) instead of omitting them, then
never emits a final answer (empty string — likely exhausts a step limit mid-retry).
Suspicion: zod `.optional()` fields may not be compiling to JSON schema in a way this
model/SDK combination treats as truly omittable, so it guesses a value for every key
instead. Worth checking against the Mastra skill docs / `node_modules/@mastra/core`
schema conversion before touching prompt wording — this looks like a schema-layer
problem, not an instructions problem. Not fixed yet.

## 2026-09-17 — page-context binding (done)

`pageContext` was already generic (job/candidate/interview, not job-only) and
already reached the prompt via `routes/ask.ts`, but nothing told the agent
*what to do* with it, and `get_entity` for an interview didn't include the
job's company — so "which company is this interview for" had no data to
answer from.

Changed:
- `server/src/mastra/tools/index.ts` — `get_entity` interview branch now
  includes `application.job.company`, not just `application.job`.
- `server/src/routes/ask.ts` — context sentence generalized (was hardcoded to
  "this role"/"this candidate", never mentioned interviews) and now points at
  the rule in the agent's own instructions instead of restating it inline.
- `server/src/mastra/agents/ask-alex.ts` — added an explicit page-context rule:
  job context + a ranking/count question → pass the id as `filters.jobId`;
  candidate/interview context → `get_entity` (its result already carries the
  related job/company, so no separate lookup or guess is needed); only apply
  context when the question doesn't already name a different record.

This was the last open item from the original v1 gap review.

## 2026-09-17 — schema-guide layer, option B (done)

Decision: separate file (`server/src/semantic/schema-guide.ts`), not inline in
`ask-alex.ts`. Why: this repo already treats "semantic vocabulary" (metrics,
dimensions, location aliases) as its own layer in `semantic/`, separate from
agent behavior in `mastra/agents/`. A hand-written data dictionary is the same
kind of thing as `metrics.ts` — keeping it there means one place holds "what
the data means," and `ask-alex.ts` stays about rules/tone, not schema prose.
For a one-agent demo this is a thin win, not a big one — noted so a future
me doesn't wonder why a whole file exists for one string.

Implemented:
- `SCHEMA_GUIDE` — hand-written prose (not generated from Prisma's DMMF,
  because the point is human explanation like "stage moves forward through
  applied → ... → hired/rejected," which DMMF can't give you, just column names).
- Imported into `ask-alex.ts`'s instructions template — read once at module
  load, no runtime file I/O per request.

**DB schema change / staleness problem:** for a demo, adding real versioning
(migrations diff, CI check) is overkill. Instead: `schema-guide.ts` hashes
`prisma/schema.prisma` (sha256, Node's built-in `crypto`) at import time and
compares it to a hardcoded hash taken when the guide was last reviewed. If
`schema.prisma` changes and nobody updates the guide, the next server start
prints a console warning naming the file to fix. This is a tripwire, not a
diff — it says "something changed, go look," not what changed. Good enough
for one person keeping one file in sync; would need real DMMF-diffing or a
CI check to scale past that.

To refresh after a real schema edit: `shasum -a 256 prisma/schema.prisma`,
paste the new hash into `SCHEMA_HASH_WHEN_WRITTEN`, and re-read `SCHEMA_GUIDE`
against the new model.

## 2026-09-17 — calendar windows + location filter (done)

Decisions: "this week" = calendar week (Monday 00:00 UTC → now), not an alias
for last 7 days. Location = fixed alias list (enum-bound at the tool schema),
not raw substring input.

Changed:
- `server/src/semantic/metrics.ts` — added `LOCATION_ALIASES`/`LOCATION_KEYS`
  (sf, oakland, seattle, austin, nyc, denver, chicago, remote → matches seeded
  `CITIES` in `prisma/seed.ts`).
- `server/src/semantic/queries.ts` — `resolveWindow` gained `today`/`this_week`/
  `last_week` (calendar-boundary, Monday start); `Filters.location` wired into
  both `runEntityQuery` and `runMetric` as a `LIKE` match.
- `server/src/mastra/tools/index.ts` — `location` added to the filters zod
  schema as `z.enum(LOCATION_KEYS)`; window `relative` enum extended.

Not done yet (still open from the gap review below): binding `pageContext` to
tool filters in `ask-alex.ts` instructions, and the schema-guide layer.

Note: `npx tsc --noEmit` in `server/` shows pre-existing errors (createTool
`execute` destructuring, `Agent` config `id` field) unrelated to this change —
confirmed via `git stash` that they predate it. These are the known "written
from docs, not a running install" gotchas — fix separately by checking
`node_modules/@mastra/core/dist/docs`, not part of this edit.

## 2026-09-17 — v1 gap review

Reviewed existing agent (semantic layer, 4 tools, agent instructions, page-context
plumbing) against today's asks: current-time-aware date windows, "candidate lives
in SF" filtering, and page-context binding.

Found already working:
- Server-side date resolution (`resolveWindow` in `server/src/semantic/queries.ts`) —
  model never picks dates itself.
- `pageContext` round-trip: frontend sidebar sends it, `server/src/routes/ask.ts`
  injects it into the prompt.

Gaps identified, not yet fixed:
1. `resolveWindow` only has rolling windows (`last_7_days` etc.) — no calendar
   `today`/`this_week`/`last_week`. "This week" and "last 7 days" currently
   resolve to the same thing.
2. No location filter on `Candidate` — need a `contains`-match filter (no geo,
   no geocoding — deliberate limitation, mark with `ponytail:` comment).
3. `pageContext` reaches the prompt as a sentence but nothing in `ask-alex.ts`
   instructions binds it to `filters.jobId`/etc. — needs verifying in-browser.
4. No schema/table-description layer for the agent — it only sees `metrics.ts`
   definitions and tool schemas, not plain-English field descriptions. Risk:
   guessing at fields that don't exist for questions outside the metric set.

### Plan (next session)
1. Add `today`/`this_week`/`last_week` to `resolveWindow`.
2. Add `location` substring filter to `Filters`, wire into `runEntityQuery`/`runMetric`.
3. Bind `pageContext.entityId` to the matching tool filter in `ask-alex.ts` instructions.
4. Write a short schema-guide block (entities + key fields, not full DDL) for the agent.
5. Add eval cases for the 10 recurring recruiter questions (see below) to `evals/cases.json`.

### 10 recurring recruiter questions (target eval coverage)
1. How many applied to [job] this week / last 7 days?
2. Pipeline breakdown for [job] by stage?
3. Top candidates for [job] right now?
4. Anyone stuck in a stage too long?
5. Offer acceptance rate for [job/company] this quarter?
6. Candidates local to [city]?
7. Interviews today/this week?
8. Completed interviews missing feedback?
9. Average time-to-first-interview for [role family]?
10. Oldest / highest-priority open reqs?

### Open questions
- "This week" = calendar week (Mon–now) or alias for last 7 days? Leaning calendar week.
- Location filter: fixed alias list ("SF" → "San Francisco") or raw substring only?
- Schema-guide text: inline in `ask-alex.ts` instructions, or a separate file read once at startup?
