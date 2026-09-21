# Dev log

Running progress notes for ask-alex-demo. Newest entry on top. Not auto-loaded —
read it when you want history; `CLAUDE.md` stays for standing invariants only.

## 2026-09-20 — two prompt-only defaults moved into code (window, job_fit stage)

**Root-caused the `job_fit` non-determinism flagged as a caveat on 2026-09-19 ("same neutral
question, opposite defaults on two runs").** It wasn't wiring — it's that "default to
`filters.stage: "applied"`" only existed in the prompt, so the model had to remember to pass it
every single call, and sometimes didn't: asked "top 3 job fit candidates who apply for this job"
(about as unambiguous as this gets), the tool call omitted `filters.stage` entirely, ranked the
whole 120-candidate pool instead of the job's 12 real applicants, and the model's own answer then
*claimed* "(default stage = applied)" — a statement its own tool call contradicts. Same session,
same root cause, second bug: `query_metrics`' time window. Code default when `window` is omitted
is all-time (`resolveWindow` → `null`); the prompt only said "use the default silently" without
ever stating what it *is*. Same question twice → two different model-invented defaults: one run
guessed `quarter_to_date` and reported "0 completed interviews" on a job that had 7 all-time; the
retry omitted the window and got the real number.

**Fix pattern, both times: stop telling the model the default, enforce it in code.**
- `server/src/semantic/queries.ts` — `rankCandidatesByFit` now computes
  `stage = f.wholePool ? undefined : (clean(f.stage) ?? "applied")` itself once a job is resolved,
  instead of trusting the model to pass `filters.stage`. `Filters` gained `wholePool?: boolean` —
  whole-pool sourcing is now an explicit opt-out the model has to state, not the silent behavior
  when it forgets a filter. Verified directly against `runEntityQuery`: no flag → `total: 12`
  (real applied-stage count) and rows restricted to that stage; `wholePool: true` → `total: 120`,
  unrestricted, matching the old behavior.
- `server/src/mastra/tools/index.ts` — added `wholePool` to the filters zod schema with a
  `.describe()` explaining when to set it; added a `.describe()` to `windowSchema` stating
  "omit for all-time (the real default) — never guess a period on your own."
- `server/src/mastra/agents/ask-alex.ts` — job_fit section rewritten to say the default is
  enforced in code now (model doesn't need to pass it), only `wholePool: true` opts out; window
  guidance in the tool-parameter-defaults bullet corrected from "a metric's window [has a
  documented default]" (never stated what it was) to "defaults to all-time... never guess one."
  Added an explicit instruction: state in the reply which scope was actually used, never narrate a
  scope the tool call didn't request — targets the second bug (the false "default stage = applied"
  claim) directly, not just the missing filter.

**The lesson, written up in `ask-chao-internals.html` section 10** (new callout, "A lesson
confirmed twice: a prompt-only default is not a default"): this is the third confirmed instance in
this codebase of the same mistake — telling the model a rule in the prompt instead of enforcing it
in code (first instance was the hallucinated-URL / `hideRedundantRecordLines` fix, see below in
this file). A prompt is advice a model can forget or invent around, not enforcement. Anywhere a
tool has a "default" that matters for correctness, the default needs to be code's job, and the
prompt's job is only to state facts about what actually happened (which scope was used, what the
real default resolves to) — never to be the sole source of the decision itself.

## 2026-09-19 (cont'd) — job_fit defaults flipped, candidate cards in chat, a demo-only ranking simplification

**job_fit's default is now "this job's applicants," not "the whole pool."** Live testing showed the
old default ("whole pool unless the question says 'applicants'") forced a clarifying question on
the single most common phrasing — "for people who apply this job, give me the top 3 job fit" —
because it didn't lexically match either trigger. Flipped it: `job_fit` now defaults to
`filters.stage: "applied"` immediately, and only drops to whole-pool mode when the question
explicitly says so ("whole candidate pool," "regardless of who's applied," sourcing language).
Updated in both `ask-alex.ts`'s instructions and `query_entities`'s tool description.
**Caveat found while re-testing this same session**: the same neutral question ("who is the best
job fit for the job") produced *opposite* defaults on two separate runs — one correctly used
`stage: applied`, the other silently ran whole-pool. Confirmed this isn't a wiring bug (the tool
call itself just omitted `filters.stage`) — it's genuine model non-determinism on a prompt-only
default for a phrasing that doesn't lexically signal either mode. Not fixed; noted here rather than
in the internals doc's "not fixed yet" list only because it was found and re-confirmed live today.

**`strength` ranking simplified to score-only, as an explicit, requested demo simplification.**
Real design (`PLAN.md` 5d) is stage-first, then `scoreRaw`, then recency — a documented "don't
quietly change" invariant. Dropped the stage term anyway, on request, because stage-first ranking
was producing "top 3" orderings a reader has to know the rule to verify (an `offer`-stage candidate
with a *lower* score outranking an `interviewing`-stage candidate with a higher one) — this was
also the direct cause of a separate bug below. Marked with a `ponytail:` comment and the restore
path in `queries.ts`; `CLAUDE.md`'s invariant line rewritten so it states the override instead of
silently going stale.

**A real bug, caught by an intentionally adversarial recruiter-question test session**: asked the
chat "top 3 for Senior SWE, Product (strength)" — the tool's own rows came back correctly ordered
(offer-stage candidate first per the real stage-first rule, verified independently), but the
model's prose swapped positions 2 and 3, silently re-sorting by the visible score number instead of
relaying the order it was actually given. Root cause: "never sort results yourself" read naturally
as "don't issue your own ORDER BY," not "don't silently re-derive the display order from a number
you can see." The `strength` simplification above happens to remove the failure mode for this
specific case (no more stage-vs-score conflict to get wrong), but the underlying instruction gap —
row order isn't self-evidently the answer to "who's #1" — is still open.

**Also caught in that same session**: `query_metrics`'s `pass_rate` ignored `filters.round` entirely
— `runEntityQuery` (the ranked-list path) had `if (f.round) where.push("i.round = ?")`, but
`runMetric` (the metrics path) never had the equivalent line. "Pass rate for onsite interviews"
silently computed over *all* rounds (55%, n=40) instead of onsite only (50%, n=8). One-line fix,
found by cross-checking the tool's answer against a raw SQL query with the exact same WHERE shape.

**Ask Alex sidebar gets structured candidate cards**, same treatment `generate_interview_questions`
already had: `query_entities` results now stream to the frontend as real rows (`routes/ask.ts` →
`api.ts`'s `CandidateRow` → `Sidebar.tsx`'s new `CandidateCards`), rendered as name + score badge +
a mode-appropriate "why" line (met/missing/nice-to-have skills for job_fit; stage/round/date for
strength/score). Whole card is a link, opens in a new tab. Model instructed to stop re-enumerating
candidates in prose now that cards render them — backstopped in code too
(`hideRedundantRecordLines`), because the prompt instruction alone didn't reliably stick, the same
lesson as the earlier hallucinated-URL fix. Two bugs found and fixed while building this:
a turn that calls `query_entities` twice (small limit for the answer, larger limit just for a pool
count) was letting the *second* call's rows silently replace the first call's cards — now keeps
whichever arrived first; and cards/questions were rendering mid-stream, next to the still-running
busy indicator, before the model's own text had started — now held back until the whole turn
finishes, so text and cards appear together instead of the busy dots sitting next to
finished-looking content.

**Frontend**: job detail page's "Job status" table is now sortable (reused the existing
`SortableHead`/`sortRows` pattern from the Jobs/Candidates/Interviews list pages, not a new
component); `openings` now shown in the job header (was already computed for chat answers but never
rendered); sidebar auto-focuses its input on open.

## 2026-09-19 — job_fit gets a single-candidate and applicant-stage mode, call/tool/answer timing, UI cleanup

**`job_fit` had no way to answer "what's X's fit score" or "top fit among who's applied."**
`sort.by=job_fit` only ever ranked the top 25 of the whole candidate pool — asking for one named
person's score (`filters.candidateId`) or scoping to a job's own applicants at a stage
(`filters.stage`) both hit the cap or the pool-wide-only default and came back empty or wrong.
Fixed both as new filters on the existing `job_fit` path in `rankCandidatesByFit`
(`queries.ts`), not new tools — `candidateId` bypasses the ranking/limit and scores just that
person; `stage` joins `Application` to scope the pool to this job's applicants at that stage,
verified against `@@unique([candidateId, jobId])` to confirm a candidate's stage on a *different*
job can never leak into the join. Pool-wide mode (no `filters.stage`) is unchanged and still the
default for sourcing questions. Added two eval cases (`job-fit-applied-only`,
`job-fit-whole-pool`) asserting candidates that only appear in one mode or the other, not names
that happen to pass either way — `job-fit-sourcing` (pre-existing) turned out to assert a
candidate who'd actually applied, so it never really proved pool-wide reach. Suite is 18 cases.

**Added call/tool/answer timing to both the eval log and the live server log.** Wrapped every
tool's `execute` with a shared timer (`toolTimings` in `tools/index.ts`) recording wall-clock
start/end; `evals/run.ts` and `routes/ask.ts` both slice that array around their own
request/turn and split elapsed time into: time before the first tool call, span from first tool
call to last tool result, and time after that to the finished reply. No schema or DB changes —
console-log only, per explicit "don't over-engineer this" direction.

**Two rounds of "the answer is confusing, not wrong."** A user question ("how's this pipeline
doing") produced a reply that read `interviewing: 3` next to `interviewScheduled: 0` as if they
disagreed — they don't; `stage` is a pipeline position, `Interview.status` is whether the event
happened, and under this demo's one-interview-per-application model an application already in
`interviewing` normally already had that interview *completed*, not scheduled. Fixed at two
layers: `schema-guide.ts` now says so explicitly (stops the model misreading it), and
`ask-alex.ts` now requires translating every bucket name to plain language in the reply itself
(`ranked` → "have a completed, scored interview", etc.) instead of printing the raw field name —
a recruiter has no reason to know what "ranked" means.

**Frontend**: job detail page's application table (renamed "Interview results" → "Job status")
now lists every application regardless of interview status — applied/screening candidates
showed `—` and their applied date instead of being dropped entirely — and its Score column now
shows the recommendation alongside the number (`96 (96.4 · strong yes)`). Candidate detail page:
the Applications section's interview line now links to the interview detail page (previously
only the job title linked anywhere); its Interviews table also gained the recommendation next to
score. Job detail header now shows `openings` (was computed and used in chat answers but never
rendered anywhere in the UI).

## 2026-09-18/19 — dead recruiter filter, pass-rate null-vs-zero bug, whole-pool skills filter

**`filters.recruiterId` was dead code.** Fully wired into `queries.ts` SQL (`a.ownerId = ?`) but
never added to the tool's actual zod schema, so the model had no way to ever set it — "how's
Marc's pipeline doing" was structurally unanswerable, not because the query couldn't do it but
because the parameter that would trigger it didn't exist on the tool call. Added
`filters.recruiterName` too (resolved server-side via a new `recruiterIdFromName()`, same pattern
as `companyIdFromName`), wired into both `runEntityQuery` and `runMetric` (the latter never
supported recruiter filtering at all before this). Verified live: "how many applications does
Marc Oyelaran own" → 59, matching a direct `db.application.count({ ownerId })`.

**Pass rate showing 0% meant two different things and looked identical.** Asked "what's the pass
rate for each stage" on a job — `applied: 0%` and `screening: 0%` sat right next to `rejected: 0%`
with no way to tell that the first two mean "no completed interviews yet" (mathematically
undefined) while the third is a real, computed zero (2 completed interviews, both rated
negatively). Root cause: `runMetric`'s row mapping collapsed every SQL `NULL` (from `NULLIF(...,
0)` or `AVG()` over zero rows) into `0`, for every metric alike. Fixed by only doing that
collapse for count-type metrics (`applications_count`, `interviews_completed`, `funnel_by_stage`)
— rate/average metrics (`pass_rate`, `offer_rate`, `offer_acceptance_rate`, `avg_score`,
`time_to_first_interview_days`, `competency_avg`) now pass `null` through, and the agent is
instructed to say "rate not defined" instead of a misleading `0%`. Required loosening
`query_metrics`'s output schema (`value: z.number()` → `.nullable()`) too.

**Added `filters.skills` / `filters.skillMatch`** ("all" = AND, "any" = OR) to `query_entities` —
"who knows React and Node" is a whole-pool question, same reasoning as `candidates_count` and
`job_fit` before it: it has nothing to do with who's applied anywhere, so a new candidate-native
function (`filterCandidatesBySkills`, same shape as `rankCandidatesByFit`) queries `Candidate` via
`CandidateSkill` directly. Still not a new tool — the running rule from `job_fit` held: a new
question shape becomes a new parameter on an existing generic tool, not a new tool verb. Verified
live end-to-end (AND match on react+node → Cara Esposito, 14y exp, matching a direct SQL check).

**A hallucinated absolute URL.** The agent wrote `https://app.example.com/candidates/...` in an
answer — no tool has ever returned anything but a relative path (`/candidates/{id}`), so the
domain was invented outright. Fixed at both layers: tightened the "link records" instruction to
say the url must be used verbatim with no domain/protocol ever added, and added a frontend regex
(`Sidebar.tsx`) that strips a fake `http(s)://host` prefix immediately before a real
`/candidates|jobs|interviews/id` path before linkifying — so even a repeat hallucination won't
render as a broken-looking mixed string.

**Investigated whether `round` and `stage` have a real relationship — they don't, in this seed.**
User found `round: "screen"` on an interview whose application was now `stage: "rejected"` and
asked what the relationship was supposed to be. Traced it to `seed.ts:188`: `round` is chosen by
`pick([...])` completely independently of `stage`, and confirmed against the full distribution —
every round type appears at every terminal stage with no pattern. Discussed a real multi-round
redesign (dropping `@@unique([applicationId])`, one `Interview` row per round in sequence) versus
a smaller fix (just correlate `round` with `stage` in the seed). Decided: leave it alone for now —
"it's only a demo," and the invariant is explicitly flagged in `CLAUDE.md` as one not to quietly
change.

**Frontend**: candidate name on the interview detail page links to their candidate page; added an
"Interviews" section to the candidate page listing every interview with a link to its detail page;
sidebar no longer defaults open on page load; reduced `rounded-[2rem]` to `rounded-[1rem]`
app-wide (all 15 occurrences) after a user-reported table corner visibly clipping into header
cell content at that radius; "offer" stage relabeled "Decision" for display only (the stored value
is still `"offer"` everywhere — `hired` and `Offer.status` already carry the actual accept/decline
outcome, so the display text was the only thing actually wrong).

Added one eval case (`skills-filter-and`). Suite is 16 cases now.

## 2026-09-18 — two more query_entities correctness bugs, plus a job_fit sourcing sort

**"Who are the rejected candidates for this job" returned zero rows despite the job page showing
7.** Root cause: `runEntityQuery` unconditionally appended `a.status = 'active' OR a.status =
'hired'` regardless of any explicit `stage` filter — every rejected application has
`status='rejected'`, which that clause can never match, so `filters.stage: 'rejected'` was
structurally unsatisfiable no matter the limit or date range. Fixed: only apply that default when
the caller hasn't already asked for a specific stage (`queries.ts:112`).

**Fixing that surfaced a second, more general bug**: of the 7 rejected candidates, only 2 came
back — the other 5 had never had a completed interview (rejected at applied/screening). The
default sort (`strength`) built its join as `needsScore ? INNER JOIN Interview...Feedback :
LEFT JOIN`, so any application without a completed, *scored* interview was dropped from the
result entirely, not just ranked lower — for `strength`/`score`/`most_recent_interview`, the three
most commonly used sorts. This contradicts an invariant already stated elsewhere in this same file
(`pipelineBuckets`'s own comment: "so nobody silently disappears from an answer") — the inner join
was quietly violating it for every default "top candidates" query, not just this one case. Fixed
by always using `LEFT JOIN`: SQLite sorts `NULL` last under `DESC`, so `f.scoreRaw DESC` still
ranks scored applications first with no inner join doing the exclusion instead.

**Added a `job_fit` sort key to `query_entities`** — deliberately *not* a new tool. The design
question that led here: "how do we answer 'who's a good fit for job A' without adding a new tool
every time a new question shape comes up." Looked at what's already in the codebase:
`query_metrics` is one tool dispatching through a `METRICS` registry (`candidates_count` earlier
this session was a new registry entry, not a new tool); `query_entities` is the same shape,
dispatching through `sort.by`. So `job_fit` is just another `sort.by` value, computed via a
separate code path (`rankCandidatesByFit`, parallel to `countCandidates`) because — like
`candidates_count` — ranking "the whole candidate pool by fit," not just applicants, has to query
`Candidate` directly, never through `Application`, or every candidate who hasn't applied yet
(the entire point of a sourcing query) would be invisible. Scoring rule, chosen for "help a
recruiter source candidates" specifically: required skills weighted 3x (full credit if years meet
the job's minimum, partial if under), nice-to-have skills weighted 1x, normalized to 0-100.
Verified live and against raw SQL before wiring into the tool schema.

**One more fix needed after wiring it up**: `query_entities`'s execute function unconditionally
attached applicant-pipeline `buckets` whenever `filters.jobId` was present. For `job_fit` those
numbers are meaningless (they describe applicants; job_fit ranks the whole pool) — the agent
instructions said not to report them, but the model dutifully reported them anyway because the
tool was still handing them over. Fixed by suppressing `buckets` at the tool level when
`sort.by === "job_fit"`, not just telling the model to ignore a field it shouldn't have gotten.

**Chat links now open in a new tab.** URLs embedded in tool output were already being turned into
clickable `<a>` tags (see the "linkify" entry above), but without `target="_blank"` clicking one
navigated the current tab away from the chat entirely — a real regression risk every time,
discarding the whole conversation to view one candidate. One attribute: `target="_blank" rel=
"noopener noreferrer"`.

Added 5 eval cases: `rejected-stage-not-dropped` (catches regression of both bugs above in one
question — a scored and an unscored rejected candidate both have to appear), `candidates-count-
by-title`, `search-full-name`, `search-fuzzy-typo`, and `job-fit-sourcing`. Suite is 15 cases now.

## 2026-09-18 — eval harness was grading the wrong thing on generate-questions

`generate-questions`'s `countEquals` check counted numbered/bulleted lines in the agent's own
prose reply (`answer.match(/^\s*(\d+[.)]|[-*])\s+/gm)`). That assumption went stale earlier this
session: the agent was deliberately changed to stop enumerating each question in text (the sidebar
renders the tool's structured question list itself now) — but the eval was never updated to match,
so it kept "failing" on a reply shape that no longer exists. Captured proof from one failing run:
tool genuinely returned 6 questions, reply said "...- Count: 6 questions (as of Sep 18, 2026)." —
one bullet-shaped line, so the regex counted 1 and the eval reported "expected 6, counted 1". A
real generation bug and a stale-eval false positive look identical in the FAIL output; only reading
the captured `answer` text (not just the failure count) told them apart.

Fixed by reading `res.steps[].toolResults[]` and counting the actual
`generate_interview_questions` result's `questions.length`, instead of parsing prose
(`evals/run.ts`). Confirmed the fix works: reran and `generate-questions` passed. Reran the full
suite again right after — a *different* case (`top-candidates-job`) failed instead. Not a
regression: these are live LLM calls, non-deterministic by nature; which 3 of 10 fail varies run to
run (already noted in the 2026-09-17 entry). The eval fix is real and durable; the specific fail set
on any one run is not a stable signal on its own.

## 2026-09-18 — search_entities never matched a two-word candidate name, added fuzzy fallback

**Reproduced via a live conversation**: `query_entities` correctly returned a candidate named
"Hugo Okafor" with a working `/candidates/...` url, but asking "give me details for Hugo Okafor"
in the same thread got "found no matches." Root cause in `search_entities` (`tools/index.ts`): the
candidate and interview branches matched the query as one whole string —
`firstName: { contains: "Hugo Okafor" }` — which can never match, since the name is split across
two columns. The **job** branch already had a per-significant-word fix for this exact class of bug
(a comment even documents the reasoning), but it was never applied to candidate/interview search
when those were written. Confirmed directly against the seeded db before and after: 0 rows via the
old whole-string query, 1 via a per-word `AND` of per-column `OR`s. Fixed by extracting a shared
`wordTerms()` helper and applying it to all three branches.

**Added fuzzy name matching** as a fallback for when even the per-word search finds nothing (a
typo, not just a multi-word name). No new dependency: Levenshtein edit-distance is a ~10-line DP
algorithm, and the candidate table is small (~120 rows in the seed), so a full-table JS-side scan
is cheap. Threshold is `max(2, 30% of the longer string's length)` — loose enough to forgive 1-2
typos ("Hugoo Okafr", "Hugo Okaffor" both still resolve), tight enough that unrelated text returns
nothing (verified with a nonsense query). **Known ceiling, not fixed**: this is an O(rows × name
length²) scan and would not hold up at real scale — a table with 100k+ candidates would need a
real fuzzy-search index (SQLite's `spellfix1`, Postgres `pg_trgm`, or an external search service)
instead of comparing every row by hand. Fine for this demo's size; flagged, not a silent gap.

## 2026-09-18 — sort-schema tool-call bug, candidate headcount gap, sidebar crash + redesign

**Real, reproducible bug in `query_entities`'s tool schema**, found live via a user report ("top
10 candidates for this job" returned "I wasn't able to put together an answer"). Traced with a
standalone repro script calling `agent.stream()` directly and reading `fullStream`: the model
correctly called `query_entities({ filters: { jobId }, limit: 10 })`, omitting `sort` entirely —
reasonable, since every field inside `sort` has a `.default()`. But `.default()` on `by`/`dir`
only fires once the `sort` *key* is present; the object itself had no default, so Zod rejected the
call with `AI_InvalidToolArgumentsError: sort Required`. That error never reaches
`onStepFinish` — the step just ends with `finishReason: "tool-calls"`, empty `toolCalls`, empty
text, which is indistinguishable from "the model gave up." **This is a different bug from the
`structuredOutputs`/empty-answer bug logged 2026-09-17** — same *symptom* (empty answer), unrelated
cause. Fix: `.default({})` on the `sort` object itself (`tools/index.ts`). Lesson for future zod
tool schemas here: an object where every field has a default still needs its own default, or
omitting it entirely (which a non-strict model will do) fails closed and silently.

**No way to answer "how many candidates have current title X."** Every existing metric/filter
reached Candidate only by joining through Application — correct for application-shaped questions,
wrong for a pure candidate fact. 23 of 120 seeded candidates have zero applications, so even a
naive fix (add a `currentTitle` filter to the existing Application-joined query) would have
silently dropped them. Added `candidates_count` (`metrics.ts`) with its own `countCandidates()`
path in `queries.ts` that queries `Candidate` directly — first metric that doesn't go through
Application at all. Also added `filters.currentTitle`, and one line each in `schema-guide.ts` and
`ask-alex.ts` distinguishing it from `filters.jobTitle` (a Job's title, not a candidate's).

**Sidebar crash, real and reproduced**: hitting "New thread" while a reply was still streaming
reset `messages` to `[]`, but the in-flight `onFrame` callback kept firing and did
`copy[copy.length - 1].text` — `copy[-1].text` on the now-empty array, throwing, with no error
boundary, taking down the whole page (React's dev overlay, not just the sidebar). Fixed with an
`AbortController` per request (aborted on reset) plus an empty-array guard in every `setMessages`
updater as a second line of defense against the one chunk that's already in flight when abort
fires.

**Ask Alex sidebar redesign** (`Sidebar.tsx`): tool-call steps moved from a single array shared
across the whole sidebar (wiped every `send()`, so a prior turn's steps vanished the moment a new
one started) onto each message, correlated call→result by `toolCallId` into one pill with a
running→done state instead of two separate badges per call. Added human labels
(`TOOL_LABELS`) since raw function names like `query_entities` meant nothing to the user. Loading
indicator went through three iterations per user feedback: static "…" → cycling word + bouncing
dots → typewriter effect (letters typed in, blinking cursor, animated `...` once the word finishes,
holds 5s) — worth remembering that "add an animation" requests here want the literal typing
metaphor, not a generic spinner.

`generate_interview_questions`'s `persist` default flipped `true` → `false`: chat-generated
questions were being saved to the job on every ask, which the user explicitly didn't want —
suggestions now stay suggestions unless persistence is asked for explicitly.

Committed as two commits (`9eb2e8e` backend, `ffbbfdf` frontend), pushed to `origin/main`.

## 2026-09-17 — warm-theme UI redesign, all pages + pagination + rebrand

Redesigned the whole web UI (`web/src/main.tsx`, `web/src/styles.css`, `web/index.html`) to match
a reference mockup the user supplied (`Hiring Platform.html`, now committed at repo root — a
bundled/exported single-page artifact, colors and fonts extracted via `getComputedStyle` in a
live browser, not eyeballed).

**Design system** (`.warm-theme` class in `styles.css`, scoped — doesn't touch the shared shadcn
theme tokens): Newsreader (headings) / Figtree (body) / Caprasimo (buttons, loaded but barely
used yet) fonts; cream/tan/mint/rust palette (`--warm-bg`, `--warm-tan`, `--warm-mint`,
`--warm-rust`, `--warm-rust-dark`, plus `--warm-good` for competency-bar coloring, not from the
reference — it only showed one page).

**Every page redesigned**, in this order: Job detail → Candidate detail → Interview detail (donut
`ScoreRing` via CSS `conic-gradient`, `RecommendationScale` using the schema's real 4 values, not
the reference's 5 — no "mixed" recommendation exists — `CompetencyBar`s colored by a 50-point
threshold, not a real "passing bar" from the data) → Jobs/Candidates/Interviews list pages (real
computed header stats, functional client-side search + status/source filter pills, no fake
"New job"/"Add candidate"/"My roles" controls since there's no backend or auth to support them —
same reasoning applied consistently each time this came up).

**Badge tone corrections**, both found by comparing against the user's reference screenshots after
the fact, not designed correctly the first time: `job.status = "open"` and `interview.status =
"completed"` both moved from bold rust to mint — rust is reserved for an earned outcome
(hired/offer), not a routine lifecycle state.

**Pagination**: added after the user reported slowness. `Pagination` component, 20/page,
client-side (search/filter already worked over the full fetched list; this just caps what mounts
in the DOM, which was the actual render cost). Diagnosed rather than guessed — curl'd all three
list endpoints (2-20ms) and instrumented `fetch` timing in a live browser session (17-77ms) before
finding pagination was still worth doing regardless. A *separate*, still-open, real inefficiency
found during that diagnosis and not yet fixed: `/api/candidates` and `/api/interviews` return full
nested `job`/`candidate`/`feedback` objects per row (359KB / 167KB payloads) when the list views
only need a handful of fields each — `/api/jobs` already does this right with
`_count.applications`; the other two don't. Not done — user said it wasn't causing a real problem
right now.

**Rebrand**: nav gets a "Trellis" logo mark (reused the reference's brand name, didn't invent one).
Assistant renamed "Ask Alex" → "Ask Chao" — **frontend UI text only** (nav button, sidebar header,
tab title, empty-state copy). The backend Mastra agent (`server/src/mastra/agents/ask-alex.ts`,
the `askAlex` variable/id, its instructions, the eval suite) was deliberately left alone — flagged
to the user as a scope decision, not fixed silently either way.

**Cleanup**: once every page had migrated to the warm-theme badges, `StatusBadge`, `SourceBadge`,
`TONE_CLASSES`, `STATUS_TONE`, `SOURCE_TONE_CLASSES`, and the now-unused `Badge` import were all
removed — dead code created by these exact changes, not pre-existing.

Typecheck stayed at the same 12 pre-existing router-typing errors (confirmed via `git stash`
early in the redesign work) through every change in this entry. All UI work is committed and
pushed (`4174653..6cd8923`).

## 2026-09-17 — root cause of the empty-answer bug, actually fixed this time

Added debug logging (`ASK_ALEX_DEBUG=0` to silence): `routes/ask.ts` now `console.log`s the
inbound message/pageContext, the full message array sent to the agent, every tool call's args,
every tool result, the final answer, and any thrown error — all prefixed `[ask <threadId>]`.

**Root cause of the empty-answer/garbage-filter bug, fully traced this time** (previous entries
found symptoms and a sanitizer; this is the actual mechanism). Traced through
`node_modules/@ai-sdk/openai/dist/index.js`:
- `supportsStructuredOutputs` defaults to `this.settings.structuredOutputs ?? isReasoningModel(modelId)`.
- `isReasoningModel` = `modelId.startsWith("o") || modelId.startsWith("gpt-5")` — true for `gpt-5-mini`.
- `ask-alex.ts` never set `structuredOutputs`, so it silently defaulted to `true` for this model,
  which forces `strict: true` on every tool definition sent to OpenAI.
- OpenAI's strict/structured-output mode requires every property in `required`, with true
  optionality expressed as a `["type","null"]` union. Confirmed via `zod-to-json-schema` directly
  on `queryMetrics.inputSchema`: our generated schema correctly omits optional fields from
  `required` and never adds a null-type union — i.e. valid ordinary JSON Schema, not valid
  strict-mode JSON Schema. `@ai-sdk/openai` passes this schema through unmodified and just adds
  `strict: true` on top, without upgrading it.
- Net effect: the model is contractually forced to supply a value for every optional field, with
  no schema-legal way to represent "omit this" or "null" — so it invents one. This explains every
  symptom collected tonight: `"null"`/`":null"` sentinel strings, `""` empty strings, and valid-but-
  irrelevant enum picks (`stage: "applied"`, `round: "screen"`, `location: "sf"`) on questions that
  named none of them. Empty/zero-row tool results triggered retries with cosmetically different but
  equally-invented filters, exhausting steps without ever converging on a real answer.

**Fix:** `openai(model, { structuredOutputs: false })` in `ask-alex.ts`, one line. Verified against
the exact conversation that failed live (multi-turn: "how many apply" → "this week" → "for all
stages for all time") — before the fix, that last turn sent `filters` with 6+ invented fields and
`rows: []` forever; after the fix, the same turn sent `filters: {"jobId": "..."}` alone — nothing
else — and returned the correct number (27) in one clean tool call. Reran the full eval suite:
6/10 → 8/10 (varies run to run — `demographics-refusal` remains the known curly-quote harness
false-fail; `avg-score` now returns a real, close-but-not-exact number instead of empty, a much
smaller problem worth a separate look; `generate-questions` now flakes differently, see below).

**New tradeoff, not free:** `generate_interview_questions`'s own internal call
(`agent.generate(prompt, { output: schema })` in `generate-questions.ts`) reuses this same agent
for *object* generation, which benefits from native structured-output/JSON mode — with
`structuredOutputs: false` it falls back to prompted "tool"-mode object generation
(`defaultObjectGenerationMode` returns `"tool"` when `!supportsStructuredOutputs`), which is less
reliable. Observed one run failing outright ("No object generated: response did not match schema")
and another succeeding cleanly — probabilistic, not deterministic. Not yet decided whether to give
that internal call its own model instance with `structuredOutputs: true` restored, since it doesn't
suffer the same optional-filter problem (its schema has few/no optional fields). Flagging as a
decision point, not fixing preemptively.

**Multi-turn memory was also never wired in production**, found via a live user screenshot before
the above: `routes/ask.ts` called `agent.stream(context + message, ...)` with only the current
message on every turn. `ChatMessage` rows were persisted per turn but never read back — write-only
logging, not memory. Fixed: fetch prior `ChatMessage` rows for the thread and pass the full
conversation as a `CoreMessage[]` array, same technique the eval runner already used. Confirmed
working live: a "this week" follow-up correctly reused the metric and job from two turns earlier.

## 2026-09-17 — multi-turn memory gap + root cause of the empty-answer bug, found

**Multi-turn memory was never wired in production.** Reported by the user via a live screenshot:
on a job page, asked "how many people apply for this job," got a real answer that asked for a date
range; replied "all time"; got "I didn't get what you'd like shown... do you want a specific
metric?" — the agent had completely forgotten its own question. Root cause: `routes/ask.ts` called
`agent.stream(context + message, ...)` with only the current message on every turn. `ChatMessage`
rows were being persisted per turn, but never read back — the DB history was write-only logging,
not memory. Fixed: fetch prior `ChatMessage` rows for the thread and pass the full conversation as
a `CoreMessage[]` array (same technique already used in the eval runner for scripted multi-turn).

**Found the actual root cause of the empty-answer bug** (open since the earlier avg-score
discovery), with real captured evidence this time — queried the persisted `toolCalls` JSON on the
assistant message straight from the DB rather than guessing. The model sends a placeholder string
for an optional field it means to leave unset — observed both `"null"` and `":null"` — instead of
omitting the key. Every filter check in `queries.ts` was a truthy-string check (`if (f.company)`),
so `company: ":null"` was treated as a real company name, resolved to zero matches, and hit the
`return { rows: [], ... }` early-exit path. Empty rows made the model retry with slightly different
garbage, repeatedly, until it exhausted its steps and returned empty text. This is the same
trust-boundary class of bug as the earlier `resolveWindow` date-string crash, just on string filters
instead of dates. Fixed: a `clean()` helper in `queries.ts` treats `"null"`/`":null"`/`"none"`/
`"n/a"` (case-insensitive) as absent, applied to every free-text filter (`company`, `jobTitle`,
`jobId`, `source`, `recruiterId`) in both `runEntityQuery` and `runMetric`. Verified directly
against the exact captured garbage payload — now returns a real row instead of `rows: []`.

**Not fully solved:** the model was also filling enum-typed optional fields (`stage`, `round`,
`location`, a relative `window`) with arbitrary-but-valid values for a question that shouldn't
have been filtered by any of them ("how many applied to this job" got `stage: applied`,
`round: screen`, `location: remote`, `window: today` — an almost self-contradictory combination
that returns 0 regardless of the real count). The sentinel-string fix stops the infinite-retry/
empty-answer crash, but a wrong, over-narrow answer is still possible from this same "fill every
slot" tendency. Still suspect this traces back to how zod `.optional()` fields compile to JSON
schema for this model/SDK combination — not yet investigated further.

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
