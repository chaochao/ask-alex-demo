import { Hono } from "hono";
import { db, runMetric, pipelineBuckets } from "../semantic/queries.js";

export const rest = new Hono();

rest.get("/api/jobs", async (c) => {
  const jobs = await db.job.findMany({ include: { company: true, _count: { select: { applications: true } } }, orderBy: { openedAt: "desc" } });
  return c.json(jobs);
});

rest.get("/api/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const job = await db.job.findUnique({ where: { id }, include: {
    company: true, recruiter: true, hiringManager: true, skills: { include: { skill: true } },
    questions: { orderBy: { createdAt: "desc" } },
    applications: { include: { candidate: true, interview: { include: { feedback: true } } } } } });
  if (!job) return c.notFound();
  return c.json({ ...job, buckets: await pipelineBuckets(id), byStage: (await runMetric("funnel_by_stage", ["stage"], { jobId: id })).rows });
});

rest.get("/api/candidates", async (c) => {
  const q = c.req.query("q");
  const candidates = await db.candidate.findMany({
    where: q ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { email: { contains: q } }] } : undefined,
    include: { applications: { include: { job: true, interview: { include: { feedback: true } } } } },
    orderBy: { createdAt: "desc" }, take: 200 });
  return c.json(candidates);
});

rest.get("/api/candidates/:id", async (c) => {
  const candidate = await db.candidate.findUnique({ where: { id: c.req.param("id") }, include: {
    skills: { include: { skill: true } },
    activities: { orderBy: { occurredAt: "desc" }, take: 20 },
    applications: { include: { job: { include: { company: true } }, offer: true,
      interview: { include: { interviewer: true, feedback: { include: { competencies: true } } } } } } } });
  if (!candidate) return c.notFound();
  return c.json(candidate);
});

rest.get("/api/interviews", async (c) => {
  const interviews = await db.interview.findMany({
    include: { interviewer: true, feedback: true, application: { include: { candidate: true, job: { include: { company: true } } } } },
    orderBy: { scheduledAt: "desc" }, take: 200 });
  return c.json(interviews);
});

rest.get("/api/interviews/:id", async (c) => {
  const interview = await db.interview.findUnique({ where: { id: c.req.param("id") }, include: {
    interviewer: true, questions: true, feedback: { include: { competencies: true } },
    application: { include: { candidate: true, job: { include: { company: true } } } } } });
  if (!interview) return c.notFound();
  return c.json(interview);
});

rest.get("/api/settings", async (c) => c.json(await db.setting.findMany()));
rest.put("/api/settings/:key", async (c) => {
  const value = String((await c.req.json()).value);
  return c.json(await db.setting.upsert({ where: { key: c.req.param("key") }, update: { value }, create: { key: c.req.param("key"), value } }));
});
