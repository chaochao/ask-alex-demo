// NOTE: verify createTool / Agent signatures against the installed package docs
// (.claude/skills/mastra → node_modules/@mastra/core/dist/docs) before relying on these.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db, runEntityQuery, runMetric, pipelineBuckets, asOf } from "../../semantic/queries.js";
import { METRIC_NAMES, DIMENSIONS, METRICS, LOCATION_KEYS } from "../../semantic/metrics.js";

const filters = z.object({
  company: z.string().optional(),
  roleFamily: z.enum(["software_engineer","data_engineer","product_manager","designer"]).optional(),
  jobId: z.string().optional(),
  jobTitle: z.string().optional(),
  currentTitle: z.string().optional(),
  stage: z.enum(["applied","screening","interviewing","offer","hired","rejected"]).optional(),
  round: z.enum(["screen","technical","hiring_manager","onsite"]).optional(),
  source: z.string().optional(),
  minScore: z.number().min(0).max(100).optional(),
  location: z.enum(LOCATION_KEYS).optional(),
  recruiterId: z.string().optional(),
  recruiterName: z.string().optional(),
  skills: z.array(z.string()).optional(),
  skillMatch: z.enum(["all","any"]).optional(),
  candidateId: z.string().optional(),
}).optional();

const windowSchema = z.object({
  field: z.enum(["interview_completed","interview_scheduled","applied","offer_extended"]).optional(),
  relative: z.enum(["today","this_week","last_week","last_7_days","last_14_days","last_30_days","quarter_to_date"]).optional(),
  from: z.string().optional(), to: z.string().optional(),
}).optional();

// Match per significant word, not the whole phrase — a two-word query like "Hugo Okafor" or
// "Staff Backend Engineer" must not require one column to contain that entire string; each word
// only needs to land in *some* column (AND of per-word ORs).
const wordTerms = (query: string, minLen: number) => {
  const words = query.trim().split(/\s+/).filter((w) => w.length >= minLen);
  return words.length ? words : [query];
};

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

// Typo tolerance for candidate names: SQLite here has no fuzzy-match extension loaded, and the
// table is small (low hundreds of rows), so a full-table edit-distance scan in JS is cheap and
// needs no new dependency. Only runs as a fallback once the exact word-match search finds nothing.
async function fuzzyCandidates(query: string, limit: number) {
  const q = query.trim().toLowerCase();
  const all = await db.candidate.findMany();
  return all
    .map((c) => {
      const name = `${c.firstName} ${c.lastName}`.toLowerCase();
      return { c, dist: levenshtein(q, name), maxLen: Math.max(q.length, name.length) };
    })
    .filter(({ dist, maxLen }) => dist <= Math.max(2, Math.floor(maxLen * 0.3)))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map(({ c }) => c);
}

// Per-call tool timings, for the eval log's call/tool/answer breakdown (evals/run.ts reads this).
export const toolTimings: { tool: string; start: number; end: number }[] = [];
export function timed<F extends (...a: any[]) => Promise<any>>(id: string, fn: F): F {
  return (async (...a: Parameters<F>) => {
    const start = Date.now();
    const result = await fn(...a);
    toolTimings.push({ tool: id, start, end: Date.now() });
    return result;
  }) as F;
}

export const searchEntities = createTool({
  id: "search_entities",
  description: "Find a job, candidate or interview by name or title. Use when the user names something specific.",
  inputSchema: z.object({
    entity: z.enum(["candidate","job","interview"]),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  outputSchema: z.object({ rows: z.array(z.object({ id: z.string(), label: z.string(), subtitle: z.string(), url: z.string() })) }),
  execute: timed("search_entities", async ({ context: { entity, query, limit } }) => {
    if (entity === "job") {
      const terms = wordTerms(query, 3);
      const rows = await db.job.findMany({
        where: { AND: terms.map((t) => ({ OR: [{ title: { contains: t } }, { company: { name: { contains: t } } }] })) },
        include: { company: true }, take: limit });
      return { rows: rows.map((j) => ({ id: j.id, label: j.title, subtitle: `${j.company.name} · ${j.status}`, url: `/jobs/${j.id}` })) };
    }
    if (entity === "candidate") {
      const terms = wordTerms(query, 1);
      let rows = await db.candidate.findMany({
        where: { AND: terms.map((t) => ({ OR: [{ firstName: { contains: t } }, { lastName: { contains: t } }, { email: { contains: t } }] })) },
        take: limit });
      if (rows.length === 0) rows = await fuzzyCandidates(query, limit);
      return { rows: rows.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`, subtitle: `${c.currentTitle ?? ""} · ${c.yearsExperience}y`, url: `/candidates/${c.id}` })) };
    }
    const terms = wordTerms(query, 1);
    let rows = await db.interview.findMany({
      where: { application: { candidate: { AND: terms.map((t) => ({ OR: [{ firstName: { contains: t } }, { lastName: { contains: t } }] })) } } },
      include: { application: { include: { candidate: true, job: true } } }, take: limit });
    if (rows.length === 0) {
      const candidateIds = (await fuzzyCandidates(query, limit)).map((c) => c.id);
      if (candidateIds.length) rows = await db.interview.findMany({
        where: { application: { candidateId: { in: candidateIds } } },
        include: { application: { include: { candidate: true, job: true } } }, take: limit });
    }
    return { rows: rows.map((i) => ({ id: i.id, label: `${i.application.candidate.firstName} ${i.application.candidate.lastName} — ${i.round}`, subtitle: `${i.application.job.title} · ${i.status}`, url: `/interviews/${i.id}` })) };
  }),
});

export const getEntity = createTool({
  id: "get_entity",
  description: "Load one record in detail: a candidate with their application and interview, a job with its pipeline, or an interview with its feedback.",
  inputSchema: z.object({ entity: z.enum(["candidate","job","interview"]), id: z.string() }),
  outputSchema: z.object({ entity: z.string(), url: z.string(), asOf: z.string(), data: z.any() }),
  execute: timed("get_entity", async ({ context: { entity, id } }) => {
    if (entity === "candidate") {
      const c = await db.candidate.findUnique({ where: { id }, include: {
        skills: { include: { skill: true } },
        applications: { include: { job: { include: { company: true } }, interview: { include: { feedback: { include: { competencies: true } } } } } } } });
      return { entity, url: `/candidates/${id}`, asOf: asOf(), data: c };
    }
    if (entity === "job") {
      const j = await db.job.findUnique({ where: { id }, include: { company: true, skills: { include: { skill: true } }, recruiter: true } });
      const buckets = j ? await pipelineBuckets(j.id) : null;
      const byStage = await runMetric("funnel_by_stage", ["stage"], { jobId: id });
      return { entity, url: `/jobs/${id}`, asOf: asOf(), data: { ...j, buckets, byStage: byStage.rows } };
    }
    const i = await db.interview.findUnique({ where: { id }, include: {
      interviewer: true, feedback: { include: { competencies: true } },
      application: { include: { candidate: true, job: { include: { company: true } } } } } });
    return { entity, url: `/interviews/${id}`, asOf: asOf(), data: i };
  }),
});

export const queryMetrics = createTool({
  id: "query_metrics",
  description: `Compute a defined metric. Use for any count, rate or average. Metrics: ${METRIC_NAMES.join(", ")}. ` +
    "For a rate or average metric, rows[].n is exactly how many records that value was computed over — state it when " +
    "reporting the metric. Never state a sample size for one metric using a count from a different tool call or a " +
    "different metric (e.g. a pipeline bucket's count, or another metric's n) — they filter differently and can " +
    "legitimately disagree; n is null when a metric has no meaningful denominator (plain counts).",
  inputSchema: z.object({
    metric: z.enum(METRIC_NAMES),
    dimensions: z.array(z.enum(DIMENSIONS)).max(1).optional(),
    filters, window: windowSchema,
  }),
  outputSchema: z.object({
    metric: z.string(), definition: z.string(), asOf: z.string(),
    rows: z.array(z.object({ dimension: z.string().nullable(), value: z.number().nullable(), n: z.number().nullable() })),
    ambiguous: z.array(z.string()),
  }),
  execute: timed("query_metrics", async ({ context: { metric, dimensions, filters, window } }) =>
    runMetric(metric as any, (dimensions ?? []) as any, filters ?? {}, window)),
});

export const queryEntities = createTool({
  id: "query_entities",
  description: "Ranked list of records — 'top N', 'who', 'which', 'list'. Returns rows already ordered, plus the ranking definition used. Use query_metrics instead for counts and averages. " +
    "sort.by='job_fit' (needs filters.jobId or filters.jobTitle) ranks the entire candidate pool by skill match to that job's requirements — regardless of whether they've applied. Use it for " +
    "'who fits this role' / sourcing questions; use the default 'strength' for 'top candidates for this role' among people already in the pipeline. " +
    "Add filters.candidateId to a job_fit call to get one named person's fit score directly — the ranked list caps at 25 rows, so a specific person's score ('what's Umar's fit for job A') " +
    "can be missing from it if they don't rank in the top 25; filters.candidateId returns their score regardless of rank. Resolve the id with search_entities first. " +
    "job_fit has two distinct modes and the caller must pick deliberately, because they answer different recruiter questions: filters.jobId alone ranks the ENTIRE candidate pool " +
    "regardless of application status — 'who's the best fit for this role' / sourcing people worth reaching out to who haven't applied. Adding filters.stage narrows that same ranking " +
    "to only this job's own applicants already at that stage — 'top 3 fit among people who applied' / shortlisting who's already in the pipeline for an interview decision. " +
    "Do not add filters.stage unless the question explicitly scopes to applicants/pipeline/a stage; default to the whole-pool mode. " +
    "filters.skills (with filters.skillMatch: 'all' or 'any', default 'all') filters the whole candidate pool by named skills, independent of any job — use for 'who knows React and Node'.",
  inputSchema: z.object({
    entity: z.enum(["candidate","job","interview","application"]).default("candidate"),
    filters, window: windowSchema,
    // .default({}) on the object itself, not just its fields — a field-level .default() only
    // fires once the key is present. The model reasonably omits `sort` entirely when every field
    // inside it has a default, and without this the whole call fails schema validation with
    // "sort: Required", silently: AI_InvalidToolArgumentsError never reaches onStepFinish, so the
    // step ends with finishReason "tool-calls" but empty toolCalls/text — looks identical to a
    // model that gave up, not a rejected call.
    sort: z.object({
      by: z.enum(["strength","score","most_recent_interview","years_experience","applied_at","stage_age","name","job_fit"]).default("strength"),
      dir: z.enum(["asc","desc"]).default("desc"),
    }).default({}),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  outputSchema: z.object({
    rows: z.array(z.object({ id: z.string(), label: z.string(), url: z.string(), sortValue: z.number().nullable(), context: z.record(z.any()) })),
    total: z.number(),
    resolved: z.object({ company: z.string().nullable(), window: z.any(), sortDefinition: z.string(), asOf: z.string(), ambiguous: z.array(z.string()) }),
    buckets: z.any().optional(),
  }),
  execute: timed("query_entities", async ({ context }) => {
    const res = await runEntityQuery(context as any);
    // Pipeline buckets describe applicants; meaningless for job_fit, which ranks the whole
    // candidate pool regardless of who's applied — attaching them there would just hand the
    // model applicant-pipeline numbers to (mis)report against a pool-wide ranking.
    const buckets = context.filters?.jobId && context.sort?.by !== "job_fit"
      ? await pipelineBuckets(context.filters.jobId) : undefined;
    return { ...res, buckets };
  }),
});

// Keys must match each tool's `id` — Mastra reports tool calls by this object key, not by `id`.
export const tools = { search_entities: searchEntities, get_entity: getEntity, query_metrics: queryMetrics, query_entities: queryEntities };
export { METRICS };
