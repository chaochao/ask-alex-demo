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
}).optional();

const windowSchema = z.object({
  field: z.enum(["interview_completed","interview_scheduled","applied","offer_extended"]).optional(),
  relative: z.enum(["today","this_week","last_week","last_7_days","last_14_days","last_30_days","quarter_to_date"]).optional(),
  from: z.string().optional(), to: z.string().optional(),
}).optional();

export const searchEntities = createTool({
  id: "search_entities",
  description: "Find a job, candidate or interview by name or title. Use when the user names something specific.",
  inputSchema: z.object({
    entity: z.enum(["candidate","job","interview"]),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  outputSchema: z.object({ rows: z.array(z.object({ id: z.string(), label: z.string(), subtitle: z.string(), url: z.string() })) }),
  execute: async ({ context: { entity, query, limit } }) => {
    if (entity === "job") {
      // Match per significant word, not the whole phrase — a query like "Staff Backend
      // Engineer job posting" must not require the title to contain that entire string.
      const words = query.trim().split(/\s+/).filter((w) => w.length >= 3);
      const terms = words.length ? words : [query];
      const rows = await db.job.findMany({
        where: { AND: terms.map((t) => ({ OR: [{ title: { contains: t } }, { company: { name: { contains: t } } }] })) },
        include: { company: true }, take: limit });
      return { rows: rows.map((j) => ({ id: j.id, label: j.title, subtitle: `${j.company.name} · ${j.status}`, url: `/jobs/${j.id}` })) };
    }
    if (entity === "candidate") {
      const rows = await db.candidate.findMany({
        where: { OR: [{ firstName: { contains: query } }, { lastName: { contains: query } }, { email: { contains: query } }] }, take: limit });
      return { rows: rows.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}`, subtitle: `${c.currentTitle ?? ""} · ${c.yearsExperience}y`, url: `/candidates/${c.id}` })) };
    }
    const rows = await db.interview.findMany({
      where: { application: { candidate: { OR: [{ firstName: { contains: query } }, { lastName: { contains: query } }] } } },
      include: { application: { include: { candidate: true, job: true } } }, take: limit });
    return { rows: rows.map((i) => ({ id: i.id, label: `${i.application.candidate.firstName} ${i.application.candidate.lastName} — ${i.round}`, subtitle: `${i.application.job.title} · ${i.status}`, url: `/interviews/${i.id}` })) };
  },
});

export const getEntity = createTool({
  id: "get_entity",
  description: "Load one record in detail: a candidate with their application and interview, a job with its pipeline, or an interview with its feedback.",
  inputSchema: z.object({ entity: z.enum(["candidate","job","interview"]), id: z.string() }),
  outputSchema: z.object({ entity: z.string(), url: z.string(), asOf: z.string(), data: z.any() }),
  execute: async ({ context: { entity, id } }) => {
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
  },
});

export const queryMetrics = createTool({
  id: "query_metrics",
  description: `Compute a defined metric. Use for any count, rate or average. Metrics: ${METRIC_NAMES.join(", ")}.`,
  inputSchema: z.object({
    metric: z.enum(METRIC_NAMES),
    dimensions: z.array(z.enum(DIMENSIONS)).max(1).optional(),
    filters, window: windowSchema,
  }),
  outputSchema: z.object({
    metric: z.string(), definition: z.string(), asOf: z.string(),
    rows: z.array(z.object({ dimension: z.string().nullable(), value: z.number() })),
    ambiguous: z.array(z.string()),
  }),
  execute: async ({ context: { metric, dimensions, filters, window } }) =>
    runMetric(metric as any, (dimensions ?? []) as any, filters ?? {}, window),
});

export const queryEntities = createTool({
  id: "query_entities",
  description: "Ranked list of records — 'top N', 'who', 'which', 'list'. Returns rows already ordered, plus the ranking definition used. Use query_metrics instead for counts and averages.",
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
      by: z.enum(["strength","score","most_recent_interview","years_experience","applied_at","stage_age","name"]).default("strength"),
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
  execute: async ({ context }) => {
    const res = await runEntityQuery(context as any);
    const buckets = context.filters?.jobId ? await pipelineBuckets(context.filters.jobId) : undefined;
    return { ...res, buckets };
  },
});

// Keys must match each tool's `id` — Mastra reports tool calls by this object key, not by `id`.
export const tools = { search_entities: searchEntities, get_entity: getEntity, query_metrics: queryMetrics, query_entities: queryEntities };
export { METRICS };
