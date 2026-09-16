import { PrismaClient } from "@prisma/client";
import { METRICS, type Dimension, type MetricName } from "./metrics.js";

export const db = new PrismaClient();
export const asOf = () => new Date().toISOString();

export type Window = { field?: "interview_completed" | "interview_scheduled" | "applied" | "offer_extended";
  relative?: "last_7_days" | "last_14_days" | "last_30_days" | "quarter_to_date"; from?: string; to?: string };

/** Dates are resolved in code, never by the model. Half-open [from, to). */
export function resolveWindow(w?: Window) {
  if (!w) return null;
  const now = new Date();
  const to = w.to ? new Date(w.to) : now;
  let from: Date;
  if (w.from) from = new Date(w.from);
  else if (w.relative === "last_7_days") from = new Date(to.getTime() - 7 * 864e5);
  else if (w.relative === "last_14_days") from = new Date(to.getTime() - 14 * 864e5);
  else if (w.relative === "last_30_days") from = new Date(to.getTime() - 30 * 864e5);
  else if (w.relative === "quarter_to_date") from = new Date(Date.UTC(to.getUTCFullYear(), Math.floor(to.getUTCMonth() / 3) * 3, 1));
  else return null;
  return { from: from.toISOString(), to: to.toISOString(), field: w.field ?? "interview_completed" };
}

export type Filters = {
  company?: string; roleFamily?: string; jobId?: string; stage?: string; round?: string;
  interviewStatus?: string; source?: string; minScore?: number; recruiterId?: string;
};

async function companyIdFromName(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const exact = await db.company.findFirst({ where: { OR: [{ id: name }, { slug }] } });
  if (exact) return [exact];
  return db.company.findMany({ where: { name: { contains: name.split(" ")[0] } } });
}

const STAGE_RANK = `CASE a.stage WHEN 'offer' THEN 4 WHEN 'interviewing' THEN 3 WHEN 'screening' THEN 2 ELSE 1 END`;

/** Ranked list of records. Filters and sort keys are enum-bound; every value is parameterized. */
export async function runEntityQuery(input: {
  entity: "candidate" | "job" | "interview" | "application";
  filters?: Filters; window?: Window; sort: { by: string; dir?: "asc" | "desc" }; limit?: number;
}) {
  const f = input.filters ?? {};
  const win = resolveWindow(input.window);
  const limit = Math.min(input.limit ?? 10, 25);
  const where: string[] = [];
  const params: unknown[] = [];
  let resolvedCompany: string | null = null;

  if (f.company) {
    const matches = await companyIdFromName(f.company);
    if (matches.length === 0) return { rows: [], total: 0, resolved: { company: null, window: win, sortDefinition: "", asOf: asOf(), ambiguous: [] as string[] } };
    if (matches.length > 1) return { rows: [], total: 0, resolved: { company: null, window: win, sortDefinition: "", asOf: asOf(), ambiguous: matches.map((m) => m.name) } };
    resolvedCompany = matches[0].name;
    where.push("j.companyId = ?"); params.push(matches[0].id);
  }
  if (f.jobId)      { where.push("a.jobId = ?");             params.push(f.jobId); }
  if (f.roleFamily) { where.push("j.roleFamily = ?");        params.push(f.roleFamily); }
  if (f.stage)      { where.push("a.stage = ?");             params.push(f.stage); }
  if (f.round)      { where.push("i.round = ?");             params.push(f.round); }
  if (f.source)     { where.push("c.source = ?");            params.push(f.source); }
  if (f.recruiterId){ where.push("a.ownerId = ?");           params.push(f.recruiterId); }
  if (f.minScore)   { where.push("f.scoreRaw >= ?");         params.push(f.minScore); }
  where.push("a.status = 'active' OR a.status = 'hired'");

  const needsScore = ["strength", "score", "most_recent_interview"].includes(input.sort.by);
  const join = needsScore
    ? `JOIN Interview i ON i.applicationId = a.id AND i.status = 'completed' JOIN Feedback f ON f.interviewId = i.id`
    : `LEFT JOIN Interview i ON i.applicationId = a.id LEFT JOIN Feedback f ON f.interviewId = i.id`;

  if (win) {
    const col = win.field === "interview_scheduled" ? "i.scheduledAt" : win.field === "applied" ? "a.appliedAt" : "i.completedAt";
    where.push(`${col} >= ? AND ${col} < ?`); params.push(win.from, win.to);
  }

  const ORDER: Record<string, string> = {
    strength: `${STAGE_RANK} DESC, f.scoreRaw DESC, i.completedAt DESC`,
    score: `f.scoreRaw DESC, i.completedAt DESC`,
    most_recent_interview: `i.completedAt DESC`,
    years_experience: `c.yearsExperience DESC`,
    applied_at: `a.appliedAt DESC`,
    stage_age: `a.stageEnteredAt ASC`,
    name: `c.lastName ASC`,
  };
  const order = ORDER[input.sort.by] ?? ORDER.strength;
  const SORT_DEF: Record<string, string> = {
    strength: "stage (offer > interviewing > screening > applied), then interview score, then most recent interview",
    score: "interview score (unrounded), then most recent interview",
    most_recent_interview: "most recent completed interview",
    years_experience: "years of experience",
    applied_at: "application date",
    stage_age: "longest time in current stage",
    name: "last name",
  };

  const sql = `
    SELECT c.id, c.firstName || ' ' || c.lastName AS label, a.stage, a.stageEnteredAt, a.jobId,
           j.title AS jobTitle, co.name AS companyName, i.round, i.completedAt,
           f.overallScore, f.scoreRaw
    FROM Application a
    JOIN Candidate c ON c.id = a.candidateId
    JOIN Job j       ON j.id = a.jobId
    JOIN Company co  ON co.id = j.companyId
    ${join}
    WHERE ${where.map((w) => `(${w})`).join(" AND ")}
    ORDER BY ${order}
    LIMIT ${limit}`;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);

  const countSql = `SELECT COUNT(*) AS n FROM Application a
    JOIN Candidate c ON c.id = a.candidateId
    JOIN Job j ON j.id = a.jobId
    JOIN Company co ON co.id = j.companyId
    ${join}
    WHERE ${where.map((w) => `(${w})`).join(" AND ")}`;
  const total = Number((await db.$queryRawUnsafe<any[]>(countSql, ...params))[0]?.n ?? 0);

  return {
    rows: rows.map((r) => ({
      id: r.id, label: r.label, url: `/candidates/${r.id}`,
      sortValue: r.scoreRaw ?? null,
      context: { stage: r.stage, job: r.jobTitle, company: r.companyName, round: r.round,
                 score: r.overallScore ?? null, interviewedAt: r.completedAt ?? null },
    })),
    total,
    resolved: { company: resolvedCompany, window: win, sortDefinition: SORT_DEF[input.sort.by] ?? SORT_DEF.strength, asOf: asOf(), ambiguous: [] as string[] },
  };
}

/** Buckets so nobody silently disappears from an answer. */
export async function pipelineBuckets(jobId: string) {
  const rows = await db.$queryRawUnsafe<any[]>(`
    SELECT
      SUM(CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END) AS ranked,
      SUM(CASE WHEN i.status = 'scheduled' THEN 1 ELSE 0 END) AS interview_scheduled,
      SUM(CASE WHEN i.id IS NULL THEN 1 ELSE 0 END)           AS not_yet_interviewed
    FROM Application a LEFT JOIN Interview i ON i.applicationId = a.id
    WHERE a.jobId = ? AND a.status = 'active'`, jobId);
  return { ranked: Number(rows[0]?.ranked ?? 0), interviewScheduled: Number(rows[0]?.interview_scheduled ?? 0), notYetInterviewed: Number(rows[0]?.not_yet_interviewed ?? 0) };
}

const DIM_SQL: Record<Dimension, string> = {
  job: "j.title", company: "co.name", stage: "a.stage", source: "c.source",
  round: "i.round", interviewer: "u.name", competency: "fc.competency",
  month: "strftime('%Y-%m', i.completedAt)",
};

export async function runMetric(metric: MetricName, dimensions: Dimension[] = [], filters: Filters = {}, window?: Window) {
  const win = resolveWindow(window);
  const dim = dimensions[0] ? DIM_SQL[dimensions[0]] : "NULL";
  const where: string[] = []; const params: unknown[] = [];
  if (filters.jobId)      { where.push("a.jobId = ?");      params.push(filters.jobId); }
  if (filters.roleFamily) { where.push("j.roleFamily = ?"); params.push(filters.roleFamily); }
  if (filters.stage)      { where.push("a.stage = ?");      params.push(filters.stage); }
  if (filters.source)     { where.push("c.source = ?");     params.push(filters.source); }
  if (filters.company) {
    const m = await companyIdFromName(filters.company);
    if (m.length !== 1) return { metric, definition: METRICS[metric].definition, asOf: asOf(), rows: [], ambiguous: m.map((x) => x.name) };
    where.push("j.companyId = ?"); params.push(m[0].id);
  }

  const base = `
    FROM Application a
    JOIN Candidate c ON c.id = a.candidateId
    JOIN Job j       ON j.id = a.jobId
    JOIN Company co  ON co.id = j.companyId
    LEFT JOIN Interview i ON i.applicationId = a.id
    LEFT JOIN User u      ON u.id = i.interviewerId
    LEFT JOIN Feedback f  ON f.interviewId = i.id
    LEFT JOIN FeedbackCompetency fc ON fc.feedbackId = f.id
    LEFT JOIN Offer o ON o.applicationId = a.id`;

  const EXPR: Record<MetricName, string> = {
    applications_count:   "COUNT(DISTINCT a.id)",
    interviews_completed: "COUNT(DISTINCT CASE WHEN i.status = 'completed' THEN i.id END)",
    avg_score:            "ROUND(AVG(f.scoreRaw), 2)",
    pass_rate:            "ROUND(100.0 * COUNT(DISTINCT CASE WHEN f.recommendation IN ('yes','strong_yes') THEN i.id END) / NULLIF(COUNT(DISTINCT CASE WHEN i.status='completed' THEN i.id END),0), 1)",
    offer_rate:           "ROUND(100.0 * COUNT(DISTINCT o.id) / NULLIF(COUNT(DISTINCT a.id),0), 1)",
    offer_acceptance_rate:"ROUND(100.0 * COUNT(DISTINCT CASE WHEN o.status='accepted' THEN o.id END) / NULLIF(COUNT(DISTINCT CASE WHEN o.respondedAt IS NOT NULL THEN o.id END),0), 1)",
    time_to_first_interview_days: "ROUND(AVG(julianday(i.completedAt) - julianday(a.appliedAt)), 1)",
    funnel_by_stage:      "COUNT(DISTINCT a.id)",
    competency_avg:       "ROUND(AVG(fc.score), 2)",
  };
  if (metric === "funnel_by_stage" && dimensions.length === 0) dimensions = ["stage"];
  if (win) {
    const col = win.field === "applied" ? "a.appliedAt" : win.field === "offer_extended" ? "o.extendedAt" : "i.completedAt";
    where.push(`${col} >= ? AND ${col} < ?`); params.push(win.from, win.to);
  }

  const dimExpr = dimensions[0] ? DIM_SQL[dimensions[0]] : "NULL";
  const sql = `SELECT ${dimExpr} AS dimension, ${EXPR[metric]} AS value ${base}
    ${where.length ? `WHERE ${where.map((w) => `(${w})`).join(" AND ")}` : ""}
    ${dimensions[0] ? `GROUP BY ${dimExpr} ORDER BY value DESC` : ""} LIMIT 50`;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);
  return {
    metric, definition: METRICS[metric].definition, asOf: asOf(), window: win,
    rows: rows.map((r) => ({ dimension: r.dimension === null ? null : String(r.dimension), value: r.value === null ? 0 : Number(r.value) })),
    ambiguous: [] as string[],
  };
}
