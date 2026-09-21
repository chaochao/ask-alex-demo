import { PrismaClient } from "@prisma/client";
import { METRICS, LOCATION_ALIASES, type Dimension, type LocationKey, type MetricName } from "./metrics.js";

export const db = new PrismaClient();
export const asOf = () => new Date().toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

// The model sends a placeholder string for an optional field it means to leave unset (observed:
// "null", ":null") instead of omitting the key. A truthy-string check treats that as a real value —
// e.g. company: ":null" resolves to zero companies and silently empties every result. Same trust-
// boundary reasoning as resolveWindow's date guard: never let a model-supplied placeholder act as data.
const NULLISH = /^:?\s*(null|none|n\/a|undefined)\s*$/i;
const clean = (s?: string) => (s && !NULLISH.test(s.trim())) ? s : undefined;

export type Window = { field?: "interview_completed" | "interview_scheduled" | "applied" | "offer_extended";
  relative?: "today" | "this_week" | "last_week" | "last_7_days" | "last_14_days" | "last_30_days" | "quarter_to_date";
  from?: string; to?: string };

const startOfUTCDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
// Calendar week starts Monday, per TIMEZONE = UTC in metrics.ts.
const startOfUTCWeek = (d: Date) => { const start = startOfUTCDay(d); start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); return start; };

/** Dates are resolved in code, never by the model. Half-open [from, to). */
export function resolveWindow(w?: Window) {
  if (!w) return null;
  // The model is untrusted input here: it has sent the literal string "null" for an
  // optional field before. Never let a bad date string reach toISOString() and throw.
  const parseDate = (s?: string) => { if (!s) return undefined; const d = new Date(s); return isNaN(d.getTime()) ? undefined : d; };
  const now = new Date();
  let to = parseDate(w.to) ?? now;
  let from = parseDate(w.from);
  if (!from) {
    if (w.relative === "today") from = startOfUTCDay(to);
    else if (w.relative === "this_week") from = startOfUTCWeek(to);
    else if (w.relative === "last_week") { to = startOfUTCWeek(to); from = new Date(to.getTime() - 7 * 864e5); }
    else if (w.relative === "last_7_days") from = new Date(to.getTime() - 7 * 864e5);
    else if (w.relative === "last_14_days") from = new Date(to.getTime() - 14 * 864e5);
    else if (w.relative === "last_30_days") from = new Date(to.getTime() - 30 * 864e5);
    else if (w.relative === "quarter_to_date") from = new Date(Date.UTC(to.getUTCFullYear(), Math.floor(to.getUTCMonth() / 3) * 3, 1));
    else return null;
  }
  return { from: from.toISOString(), to: to.toISOString(), field: w.field ?? "interview_completed" };
}

export type Filters = {
  company?: string; roleFamily?: string; jobId?: string; jobTitle?: string; stage?: string; round?: string;
  interviewStatus?: string; source?: string; minScore?: number; recruiterId?: string; recruiterName?: string;
  location?: LocationKey; currentTitle?: string; skills?: string[]; skillMatch?: "all" | "any"; candidateId?: string;
  wholePool?: boolean;
};

async function companyIdFromName(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const exact = await db.company.findFirst({ where: { OR: [{ id: name }, { slug }] } });
  if (exact) return [exact];
  return db.company.findMany({ where: { name: { contains: name.split(" ")[0] } } });
}

// Resolves a recruiter named by the model (never by it guessing a User id) — same reasoning as
// companyIdFromName. Scoped to role='recruiter' so "Marc" doesn't also match an interviewer or
// hiring manager who happens to share a first name.
async function recruiterIdFromName(name: string) {
  return db.user.findMany({ where: { role: "recruiter", OR: [{ id: name }, { name: { contains: name } }] } });
}

// Resolves a job named by title (never by the model guessing an id), scoped to a company
// when one is already resolved. Matches per significant word, same reasoning as search_entities:
// a title filter like "Staff Backend Engineer role" must not require the whole phrase to match.
async function jobIdFromTitle(title: string, companyId?: string) {
  const words = title.trim().split(/\s+/).filter((w) => w.length >= 3);
  const terms = words.length ? words : [title];
  return db.job.findMany({
    where: { AND: terms.map((t) => ({ title: { contains: t } })), ...(companyId ? { companyId } : {}) },
    include: { company: true },
  });
}

const STAGE_RANK = `CASE a.stage WHEN 'offer' THEN 4 WHEN 'interviewing' THEN 3 WHEN 'screening' THEN 2 ELSE 1 END`;

// Sourcing, not pipeline ranking: "who in the whole candidate pool fits this job" has nothing to
// do with whether someone applied, so by default this queries Candidate directly (like
// countCandidates above), never through Application — an applicant filter would just drop everyone
// recruiters haven't found yet, which is the entire point of this sort. filters.stage is the one
// opt-in exception: "top fit among who's applied" is asking for the applicant pool specifically, so
// when stage is given the query joins Application to scope to it.
async function rankCandidatesByFit(f: Filters, limit: number) {
  const company = clean(f.company), jobTitle = clean(f.jobTitle), jobId = clean(f.jobId),
        candidateId = clean(f.candidateId);
  let resolvedCompany: string | null = null, resolvedCompanyId: string | undefined, resolvedJobId = jobId;

  if (company) {
    const matches = await companyIdFromName(company);
    if (matches.length !== 1) return { rows: [], total: 0, resolved: { company: null, window: null, sortDefinition: "", asOf: asOf(), ambiguous: matches.map((m) => m.name) } };
    resolvedCompany = matches[0].name; resolvedCompanyId = matches[0].id;
  }
  if (!resolvedJobId && jobTitle) {
    const matches = await jobIdFromTitle(jobTitle, resolvedCompanyId);
    if (matches.length !== 1) return { rows: [], total: 0, resolved: { company: resolvedCompany, window: null, sortDefinition: "", asOf: asOf(), ambiguous: matches.map((j) => `${j.title} @ ${j.company.name}`) } };
    resolvedJobId = matches[0].id;
  }
  if (!resolvedJobId) return { rows: [], total: 0, resolved: { company: resolvedCompany, window: null, sortDefinition: "", asOf: asOf(), ambiguous: [] as string[] } };

  // A job is resolved: default to its own applicants unless the caller explicitly asked for the
  // whole pool. This is enforced here, not just told to the model in the prompt — a model that
  // forgets to pass filters.stage should still get the applicant-scoped answer, not silently fall
  // through to ranking all candidates in the database.
  const stage = f.wholePool ? undefined : (clean(f.stage) ?? "applied");

  const reqs = await db.jobSkill.findMany({ where: { jobId: resolvedJobId }, include: { skill: true } });
  let sortDefinition = "required skills met (full credit if years meet the job's minimum, "
    + "partial credit if under, weighted 3x), plus nice-to-have skills present (weighted 1x), "
    + "as a percent of the maximum possible — independent of whether they've applied";
  if (stage) sortDefinition += `, restricted to candidates with an application to this job in the '${stage}' stage`;
  if (reqs.length === 0) return { rows: [], total: 0, resolved: { company: resolvedCompany, window: null, sortDefinition, asOf: asOf(), ambiguous: [] as string[] } };

  const possible = reqs.reduce((sum, r) => sum + (r.required ? 3 : 1), 0);
  // candidateId pins the query to one person instead of ranking the pool — needed because the
  // ranked path caps at 25 rows, which silently drops anyone not in the top 25 by fit. stage scopes
  // the pool to this job's own applicants at that stage — "top fit among who's applied" needs both
  // the skill-fit score (only computed here) and the applicant filter (normally only on the
  // strength/score sort path), so this joins Application in rather than duplicating the query.
  const params: unknown[] = [resolvedJobId];
  let joinSql = "";
  if (stage) { joinSql = "JOIN Application a ON a.candidateId = c.id AND a.jobId = ? AND a.stage = ?"; params.push(resolvedJobId, stage); }
  let whereSql = "";
  if (candidateId) { whereSql = "WHERE c.id = ?"; params.push(candidateId); }
  let limitSql = "";
  if (!candidateId) { limitSql = "LIMIT ?"; params.push(limit); }

  const scored = await db.$queryRawUnsafe<any[]>(`
    SELECT c.id, c.firstName || ' ' || c.lastName AS label,
      SUM(
        CASE
          WHEN js.required = 1 AND cs.skillId IS NULL THEN 0
          WHEN js.required = 1 AND js.minYears IS NULL THEN 3.0
          WHEN js.required = 1 THEN 3.0 * min(1.0, CAST(cs.years AS REAL) / js.minYears)
          WHEN js.required = 0 AND cs.skillId IS NOT NULL THEN 1.0
          ELSE 0
        END
      ) AS earned
    FROM Candidate c
    CROSS JOIN JobSkill js ON js.jobId = ?
    LEFT JOIN CandidateSkill cs ON cs.candidateId = c.id AND cs.skillId = js.skillId
    ${joinSql}
    ${whereSql}
    GROUP BY c.id
    ORDER BY earned DESC
    ${limitSql}`, ...params);

  const theirSkills = await db.candidateSkill.findMany({ where: { candidateId: { in: scored.map((r) => r.id) } } });
  const has = new Map<string, Set<string>>();
  for (const cs of theirSkills) {
    if (!has.has(cs.candidateId)) has.set(cs.candidateId, new Set());
    has.get(cs.candidateId)!.add(cs.skillId);
  }

  const total = stage
    ? await db.application.count({ where: { jobId: resolvedJobId, stage } })
    : await db.candidate.count();
  return {
    rows: scored.map((r) => {
      const owned = has.get(r.id) ?? new Set<string>();
      return {
        id: r.id, label: r.label, url: `/candidates/${r.id}`,
        sortValue: Math.round((100 * r.earned) / possible),
        context: {
          metRequired: reqs.filter((q) => q.required && owned.has(q.skillId)).map((q) => q.skill.name),
          missingRequired: reqs.filter((q) => q.required && !owned.has(q.skillId)).map((q) => q.skill.name),
          niceToHave: reqs.filter((q) => !q.required && owned.has(q.skillId)).map((q) => q.skill.name),
        },
      };
    }),
    total,
    resolved: { company: resolvedCompany, window: null, sortDefinition, asOf: asOf(), ambiguous: [] as string[] },
  };
}

// "Who has React and Node" is a whole-pool question, same reasoning as candidates_count and
// job_fit: it has nothing to do with who's applied anywhere, so this queries Candidate directly
// via CandidateSkill, never through Application.
async function filterCandidatesBySkills(f: Filters, sortBy: string, limit: number) {
  const names = [...new Set((f.skills ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (names.length === 0) return { rows: [], total: 0, resolved: { company: null, window: null, sortDefinition: "", asOf: asOf(), ambiguous: [] as string[] } };

  const skills = await db.skill.findMany({ where: { name: { in: names } } });
  const found = new Set(skills.map((s) => s.name));
  const missing = names.filter((n) => !found.has(n));
  if (missing.length > 0) return { rows: [], total: 0, resolved: { company: null, window: null, sortDefinition: "", asOf: asOf(), ambiguous: missing.map((n) => `unknown skill: ${n}`) } };

  const matchAll = f.skillMatch !== "any";
  const skillIds = skills.map((s) => s.id);
  const placeholders = skillIds.map(() => "?").join(",");
  const having = matchAll ? `COUNT(DISTINCT cs.skillId) = ${skillIds.length}` : `COUNT(DISTINCT cs.skillId) >= 1`;
  const ORDER: Record<string, string> = { years_experience: "c.yearsExperience DESC", name: "c.lastName ASC" };
  const order = ORDER[sortBy] ?? ORDER.years_experience;

  const rows = await db.$queryRawUnsafe<any[]>(`
    SELECT c.id, c.firstName || ' ' || c.lastName AS label, c.currentTitle, c.yearsExperience
    FROM Candidate c
    JOIN CandidateSkill cs ON cs.candidateId = c.id AND cs.skillId IN (${placeholders})
    GROUP BY c.id
    HAVING ${having}
    ORDER BY ${order}
    LIMIT ?`, ...skillIds, limit);
  const totalRow = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) AS n FROM (
      SELECT c.id FROM Candidate c
      JOIN CandidateSkill cs ON cs.candidateId = c.id AND cs.skillId IN (${placeholders})
      GROUP BY c.id HAVING ${having})`, ...skillIds);

  return {
    rows: rows.map((r) => ({
      id: r.id, label: r.label, url: `/candidates/${r.id}`,
      sortValue: r.yearsExperience ?? null,
      context: { currentTitle: r.currentTitle, yearsExperience: r.yearsExperience },
    })),
    total: Number(totalRow[0]?.n ?? 0),
    resolved: { company: null, window: null,
      sortDefinition: `has ${matchAll ? "all" : "any"} of: ${names.join(", ")}`,
      asOf: asOf(), ambiguous: [] as string[] },
  };
}

/** Ranked list of records. Filters and sort keys are enum-bound; every value is parameterized. */
export async function runEntityQuery(input: {
  entity: "candidate" | "job" | "interview" | "application";
  filters?: Filters; window?: Window; sort: { by: string; dir?: "asc" | "desc" }; limit?: number;
}) {
  if (input.sort.by === "job_fit") return rankCandidatesByFit(input.filters ?? {}, Math.min(input.limit ?? 10, 25));
  if (input.filters?.skills?.length) return filterCandidatesBySkills(input.filters, input.sort.by, Math.min(input.limit ?? 10, 25));
  const f = input.filters ?? {};
  const win = resolveWindow(input.window);
  const limit = Math.min(input.limit ?? 10, 25);
  const where: string[] = [];
  const params: unknown[] = [];
  let resolvedCompany: string | null = null;
  let resolvedCompanyId: string | undefined;

  const company = clean(f.company), jobTitle = clean(f.jobTitle), jobId = clean(f.jobId),
        source = clean(f.source), recruiterName = clean(f.recruiterName);
  let recruiterId = clean(f.recruiterId);

  if (company) {
    const matches = await companyIdFromName(company);
    if (matches.length === 0) return { rows: [], total: 0, resolved: { company: null, window: win, sortDefinition: "", asOf: asOf(), ambiguous: [] as string[] } };
    if (matches.length > 1) return { rows: [], total: 0, resolved: { company: null, window: win, sortDefinition: "", asOf: asOf(), ambiguous: matches.map((m) => m.name) } };
    resolvedCompany = matches[0].name;
    resolvedCompanyId = matches[0].id;
    where.push("j.companyId = ?"); params.push(matches[0].id);
  }
  if (jobTitle) {
    const matches = await jobIdFromTitle(jobTitle, resolvedCompanyId);
    if (matches.length === 0) return { rows: [], total: 0, resolved: { company: resolvedCompany, window: win, sortDefinition: "", asOf: asOf(), ambiguous: [] as string[] } };
    if (matches.length > 1) return { rows: [], total: 0, resolved: { company: resolvedCompany, window: win, sortDefinition: "", asOf: asOf(), ambiguous: matches.map((j) => `${j.title} @ ${j.company.name}`) } };
    where.push("a.jobId = ?"); params.push(matches[0].id);
  }
  if (jobId)        { where.push("a.jobId = ?");             params.push(jobId); }
  if (f.roleFamily) { where.push("j.roleFamily = ?");        params.push(f.roleFamily); }
  if (f.stage)      { where.push("a.stage = ?");             params.push(f.stage); }
  if (f.round)      { where.push("i.round = ?");             params.push(f.round); }
  if (source)       { where.push("c.source = ?");            params.push(source); }
  if (!recruiterId && recruiterName) {
    const matches = await recruiterIdFromName(recruiterName);
    if (matches.length === 0) return { rows: [], total: 0, resolved: { company: resolvedCompany, window: win, sortDefinition: "", asOf: asOf(), ambiguous: [] as string[] } };
    if (matches.length > 1) return { rows: [], total: 0, resolved: { company: resolvedCompany, window: win, sortDefinition: "", asOf: asOf(), ambiguous: matches.map((m) => m.name) } };
    recruiterId = matches[0].id;
  }
  if (recruiterId)  { where.push("a.ownerId = ?");           params.push(recruiterId); }
  if (f.minScore)   { where.push("f.scoreRaw >= ?");         params.push(f.minScore); }
  if (f.location)   { where.push("c.location LIKE ?");       params.push(`%${LOCATION_ALIASES[f.location]}%`); }
  // Default to active/hired only when the caller didn't already ask for a specific stage —
  // an explicit stage:'rejected' filter must not be silently vetoed by this, since every
  // rejected application has status='rejected', never 'active' or 'hired'.
  if (!f.stage) where.push("a.status = 'active' OR a.status = 'hired'");

  // Always LEFT JOIN — an inner join here would silently drop any application without a
  // completed, scored interview (e.g. rejected before ever interviewing) from every ranked
  // list, not just filter its score. SQLite sorts NULLs last under DESC, so f.scoreRaw DESC
  // still ranks scored applications first without an inner join doing the exclusion instead.
  const join = `LEFT JOIN Interview i ON i.applicationId = a.id LEFT JOIN Feedback f ON f.interviewId = i.id`;

  if (win) {
    const col = win.field === "interview_scheduled" ? "i.scheduledAt" : win.field === "applied" ? "a.appliedAt" : "i.completedAt";
    where.push(`${col} >= ? AND ${col} < ?`); params.push(win.from, win.to);
  }

  // ponytail: demo simplification, requested explicitly — "strength" normally ranks stage first
  // (PLAN.md 5d, CLAUDE.md's "don't quietly change" invariant), dropped here to score-only so a
  // top-N answer is trivial to eyeball-verify. Restore `${STAGE_RANK} DESC, ` as the leading term
  // to bring stage-first ranking back.
  const ORDER: Record<string, string> = {
    strength: `f.scoreRaw DESC, i.completedAt DESC`,
    score: `f.scoreRaw DESC, i.completedAt DESC`,
    most_recent_interview: `i.completedAt DESC`,
    years_experience: `c.yearsExperience DESC`,
    applied_at: `a.appliedAt DESC`,
    stage_age: `a.stageEnteredAt ASC`,
    name: `c.lastName ASC`,
  };
  const order = ORDER[input.sort.by] ?? ORDER.strength;
  const SORT_DEF: Record<string, string> = {
    strength: "interview score (unrounded), then most recent interview — stage not factored in, demo simplification",
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

// Candidate is not reached through Application here: joining from Application would silently
// drop candidates with zero applications, which is exactly the kind of undercount this project's
// invariants forbid (see pipelineBuckets above).
async function countCandidates(filters: Filters, dimension?: Dimension) {
  const currentTitle = clean(filters.currentTitle), source = clean(filters.source);
  const where: string[] = []; const params: unknown[] = [];
  if (currentTitle) { where.push("c.currentTitle LIKE ?"); params.push(`%${currentTitle}%`); }
  if (source)       { where.push("c.source = ?");          params.push(source); }
  if (filters.location) { where.push("c.location LIKE ?"); params.push(`%${LOCATION_ALIASES[filters.location]}%`); }
  const dimExpr = dimension === "source" ? "c.source" : null;
  const sql = `SELECT ${dimExpr ?? "NULL"} AS dimension, COUNT(*) AS value FROM Candidate c
    ${where.length ? `WHERE ${where.map((w) => `(${w})`).join(" AND ")}` : ""}
    ${dimExpr ? `GROUP BY ${dimExpr} ORDER BY value DESC` : ""} LIMIT 50`;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);
  return {
    metric: "candidates_count" as MetricName, definition: METRICS.candidates_count.definition, asOf: asOf(),
    rows: rows.map((r) => ({ dimension: r.dimension === null ? null : String(r.dimension), value: Number(r.value), n: null })),
    ambiguous: [] as string[],
  };
}

export async function runMetric(metric: MetricName, dimensions: Dimension[] = [], filters: Filters = {}, window?: Window) {
  if (metric === "candidates_count") return countCandidates(filters, dimensions[0]);
  const win = resolveWindow(window);
  const dim = dimensions[0] ? DIM_SQL[dimensions[0]] : "NULL";
  const where: string[] = []; const params: unknown[] = [];
  const jobId = clean(filters.jobId), source = clean(filters.source),
        company = clean(filters.company), jobTitle = clean(filters.jobTitle),
        recruiterName = clean(filters.recruiterName);
  let recruiterId = clean(filters.recruiterId);
  if (jobId)               { where.push("a.jobId = ?");      params.push(jobId); }
  if (filters.roleFamily)  { where.push("j.roleFamily = ?"); params.push(filters.roleFamily); }
  if (filters.stage)       { where.push("a.stage = ?");      params.push(filters.stage); }
  if (filters.round)       { where.push("i.round = ?");      params.push(filters.round); }
  if (source)              { where.push("c.source = ?");     params.push(source); }
  if (filters.location)    { where.push("c.location LIKE ?"); params.push(`%${LOCATION_ALIASES[filters.location]}%`); }
  if (!recruiterId && recruiterName) {
    const m = await recruiterIdFromName(recruiterName);
    if (m.length !== 1) return { metric, definition: METRICS[metric].definition, asOf: asOf(), rows: [], ambiguous: m.map((x) => x.name) };
    recruiterId = m[0].id;
  }
  if (recruiterId)          { where.push("a.ownerId = ?");   params.push(recruiterId); }
  let resolvedCompanyId: string | undefined;
  if (company) {
    const m = await companyIdFromName(company);
    if (m.length !== 1) return { metric, definition: METRICS[metric].definition, asOf: asOf(), rows: [], ambiguous: m.map((x) => x.name) };
    resolvedCompanyId = m[0].id;
    where.push("j.companyId = ?"); params.push(m[0].id);
  }
  if (jobTitle) {
    const m = await jobIdFromTitle(jobTitle, resolvedCompanyId);
    if (m.length !== 1) return { metric, definition: METRICS[metric].definition, asOf: asOf(), rows: [], ambiguous: m.map((j) => `${j.title} @ ${j.company.name}`) };
    where.push("a.jobId = ?"); params.push(m[0].id);
  }

  // FeedbackCompetency is one row per competency per interview (4-5 per completed interview) —
  // joining it unconditionally fans out every other row in this query, silently weighting
  // AVG(f.scoreRaw) (avg_score) and AVG(julianday(...)) (time_to_first_interview_days) by how many
  // competencies each interview happened to have, instead of averaging one value per interview.
  // Only join it when a metric or dimension actually needs a per-competency row.
  const needsCompetency = metric === "competency_avg" || dimensions[0] === "competency";
  const base = `
    FROM Application a
    JOIN Candidate c ON c.id = a.candidateId
    JOIN Job j       ON j.id = a.jobId
    JOIN Company co  ON co.id = j.companyId
    LEFT JOIN Interview i ON i.applicationId = a.id
    LEFT JOIN User u      ON u.id = i.interviewerId
    LEFT JOIN Feedback f  ON f.interviewId = i.id
    ${needsCompetency ? "LEFT JOIN FeedbackCompetency fc ON fc.feedbackId = f.id" : ""}
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
    candidates_count:     "COUNT(DISTINCT c.id)", // unreachable: candidates_count returns via countCandidates() above
  };
  // Rate/average metrics can genuinely have no defined value for a group (zero completed
  // interviews, zero offers) — that's NULL from SQL (via NULLIF or AVG() over an empty set), and
  // it means "no data," not "0". Count metrics don't have this ambiguity: zero really is zero.
  // Collapsing both cases to 0 below would make "nobody's interviewed yet" indistinguishable from
  // "everyone failed."
  const isRateMetric = ["pass_rate", "offer_rate", "offer_acceptance_rate", "avg_score", "time_to_first_interview_days", "competency_avg"].includes(metric);
  // How many records actually fed a rate/average, so the model can state it truthfully instead of
  // reusing an unrelated count from a different tool call (e.g. pipelineBuckets.ranked, which
  // excludes rejected applications — avg_score does not) — a real bug caught live: the model
  // reported avg_score as "computed from 5 candidates" when the query has no status filter at all
  // and actually averaged over 7 scored interviews, including 2 from rejected applications.
  const SAMPLE_SIZE_EXPR: Partial<Record<MetricName, string>> = {
    avg_score: "COUNT(f.scoreRaw)",
    pass_rate: "COUNT(DISTINCT CASE WHEN i.status = 'completed' THEN i.id END)",
    offer_rate: "COUNT(DISTINCT a.id)",
    offer_acceptance_rate: "COUNT(DISTINCT CASE WHEN o.respondedAt IS NOT NULL THEN o.id END)",
    time_to_first_interview_days: "COUNT(CASE WHEN i.completedAt IS NOT NULL THEN 1 END)",
    competency_avg: "COUNT(fc.score)",
  };
  if (metric === "funnel_by_stage" && dimensions.length === 0) dimensions = ["stage"];
  if (win) {
    const col = win.field === "applied" ? "a.appliedAt" : win.field === "offer_extended" ? "o.extendedAt" : "i.completedAt";
    where.push(`${col} >= ? AND ${col} < ?`); params.push(win.from, win.to);
  }

  const dimExpr = dimensions[0] ? DIM_SQL[dimensions[0]] : "NULL";
  const sampleSizeExpr = SAMPLE_SIZE_EXPR[metric] ?? "NULL";
  const sql = `SELECT ${dimExpr} AS dimension, ${EXPR[metric]} AS value, ${sampleSizeExpr} AS n ${base}
    ${where.length ? `WHERE ${where.map((w) => `(${w})`).join(" AND ")}` : ""}
    ${dimensions[0] ? `GROUP BY ${dimExpr} ORDER BY value DESC` : ""} LIMIT 50`;
  const rows = await db.$queryRawUnsafe<any[]>(sql, ...params);
  return {
    metric, definition: METRICS[metric].definition, asOf: asOf(), window: win,
    rows: rows.map((r) => ({
      dimension: r.dimension === null ? null : String(r.dimension),
      value: r.value === null ? (isRateMetric ? null : 0) : Number(r.value),
      n: r.n === null ? null : Number(r.n),
    })),
    ambiguous: [] as string[],
  };
}
