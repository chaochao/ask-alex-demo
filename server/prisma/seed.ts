import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

// deterministic RNG — evals depend on this data being identical every run
let _s = 20260921;
const rnd = () => ((_s = (_s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const NOW = new Date("2026-09-16T17:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 864e5);

const COMPANIES = [
  { name: "Acme Robotics", slug: "acme-robotics", industry: "robotics" },
  { name: "Northwind Health", slug: "northwind-health", industry: "healthtech" },
  { name: "Cobalt Financial", slug: "cobalt-financial", industry: "fintech" },
  { name: "Lumen Retail", slug: "lumen-retail", industry: "retail" },
  { name: "Vertex Labs", slug: "vertex-labs", industry: "biotech" },
];

const SKILLS = [
  ["typescript","language"],["python","language"],["go","language"],["sql","language"],
  ["react","framework"],["nextjs","framework"],["node","framework"],["fastapi","framework"],
  ["postgres","infra"],["kubernetes","infra"],["aws","infra"],["terraform","infra"],
  ["airflow","infra"],["dbt","infra"],["kafka","infra"],["redis","infra"],
  ["system design","domain"],["distributed systems","domain"],["data modeling","domain"],
  ["ml","domain"],["security","domain"],["payments","domain"],["hipaa","domain"],
  ["mentoring","soft"],["communication","soft"],["product sense","soft"],
] as const;

const FIRST = ["Ana","Ben","Cara","Dev","Elena","Farid","Grace","Hugo","Iris","Jonas","Kira","Liam","Maya","Noah","Olivia","Priya","Quinn","Rosa","Sam","Tara","Umar","Vera","Wes","Xenia","Yusuf","Zoe","Nina","Owen","Paul","Ruth"];
const LAST = ["Alvarez","Booth","Chen","Dupont","Esposito","Fischer","Gupta","Haddad","Ibrahim","Jensen","Kowalski","Lindqvist","Moreau","Nakamura","Okafor","Petrov","Quintero","Rossi","Silva","Tanaka","Ueda","Valdez","Wang","Xu","Yamada","Zhang"];
const CITIES = ["San Francisco, CA","Oakland, CA","Seattle, WA","Austin, TX","New York, NY","Denver, CO","Chicago, IL","Remote (US)"];

type JobSpec = {
  title: string; roleFamily: string; dept: string; seniority: string; status: string;
  company: number; skills: string[]; summary: string; reqs: string[];
};
const JOBS: JobSpec[] = [
  { title: "Staff Backend Engineer", roleFamily: "software_engineer", dept: "Engineering", seniority: "staff", status: "open", company: 0,
    skills: ["go","postgres","kubernetes","distributed systems","system design"],
    summary: "Own the services that move robot fleet telemetry from the edge into our platform.",
    reqs: ["8+ years building backend services in production","Deep Postgres experience including schema design and query tuning","Experience operating services on Kubernetes","Has designed a system handling sustained high write throughput","Comfortable owning on-call for services you build","Mentors engineers and raises the technical bar"] },
  { title: "Senior Software Engineer, Product", roleFamily: "software_engineer", dept: "Engineering", seniority: "senior", status: "open", company: 0,
    skills: ["typescript","react","nextjs","postgres","product sense"],
    summary: "Build the operator console our customers use to run robot fleets.",
    reqs: ["5+ years shipping production TypeScript and React","Strong opinions on state management and rendering performance","Has built or maintained a shared component library","Writes tests and can explain what is worth testing","Works directly with customers to shape requirements"] },
  { title: "Software Engineer, Platform", roleFamily: "software_engineer", dept: "Engineering", seniority: "mid", status: "open", company: 2,
    skills: ["typescript","node","aws","terraform","payments"],
    summary: "Build the payment and ledger services behind Cobalt's lending products.",
    reqs: ["3+ years backend engineering","Has worked on systems where correctness of money matters","Familiar with AWS and infrastructure as code","Understands idempotency and retries in distributed systems"] },
  { title: "Senior Data Engineer", roleFamily: "data_engineer", dept: "Data", seniority: "senior", status: "open", company: 2,
    skills: ["python","sql","dbt","airflow","data modeling"],
    summary: "Own the pipelines that turn partner files into reportable financial data.",
    reqs: ["5+ years in data engineering","Fluent in SQL and dimensional modeling","Has handled late-arriving and restated data","Experience with dbt and a scheduler such as Airflow or Dagster","Cares about data quality more than infrastructure novelty"] },
  { title: "Data Engineer", roleFamily: "data_engineer", dept: "Data", seniority: "mid", status: "on_hold", company: 1,
    skills: ["python","sql","airflow","hipaa"],
    summary: "Build clinical data pipelines under HIPAA constraints.",
    reqs: ["3+ years building data pipelines","SQL depth","Comfortable with healthcare data privacy requirements"] },
  { title: "Product Manager, Platform", roleFamily: "product_manager", dept: "Product", seniority: "senior", status: "open", company: 3,
    skills: ["product sense","communication","sql"],
    summary: "Own the merchant-facing platform roadmap.",
    reqs: ["5+ years in product management for technical products","Can write a spec engineers respect","Uses data to decide, and can query it themselves"] },
  { title: "Senior Frontend Engineer", roleFamily: "software_engineer", dept: "Engineering", seniority: "senior", status: "closed", company: 3,
    skills: ["typescript","react","nextjs","communication"],
    summary: "Lead the storefront rebuild.",
    reqs: ["5+ years frontend","Performance profiling experience","Design system ownership"] },
  { title: "Machine Learning Engineer", roleFamily: "software_engineer", dept: "Research", seniority: "senior", status: "closed", company: 4,
    skills: ["python","ml","aws","distributed systems"],
    summary: "Train and serve models for assay analysis.",
    reqs: ["5+ years ML engineering","Production model serving","Strong Python"] },
];

const COMPETENCIES = ["coding","system_design","communication","ownership","domain"] as const;
const WEIGHTS: Record<string, number> = { coding: 3, system_design: 3, communication: 2, ownership: 2, domain: 1 };

const EVIDENCE: Record<string, string[]> = {
  coding: ["Wrote a working solution without hints and covered the empty-input case unasked.","Got to a correct solution with one nudge on the data structure.","Struggled to translate the approach into code within the time."],
  system_design: ["Chose Postgres with clear reasoning and walked through the write path under load.","Named the right components but did not address failure modes until prompted.","Jumped to a queue without explaining why the simple option would not work."],
  communication: ["Restated the requirement and flagged an ambiguity before starting.","Explained tradeoffs clearly, checked in at each step.","Went quiet for long stretches; had to be asked what they were thinking."],
  ownership: ["Described carrying a feature through on-call and fixing the fallout themselves.","Owned a project end to end but handed off operations early.","Described work in terms of tickets assigned rather than outcomes."],
  domain: ["Has shipped in this domain and knew the common pitfalls.","General experience, picked up the domain quickly during the interview.","Little exposure to the domain; asked good questions."],
};

async function main() {
  console.log("seeding…");
  for (const t of ["FeedbackCompetency","Feedback","InterviewQuestion","Interview","Offer","Event","Activity","Application","CandidateSkill","Candidate","JobSkill","Job","Skill","User","Company","EvalResult","EvalRun","ChatMessage","ChatThread","Setting"]) {
    // @ts-expect-error dynamic model access
    await db[t[0].toLowerCase() + t.slice(1)].deleteMany();
  }

  const companies = await Promise.all(COMPANIES.map((c) => db.company.create({ data: c })));
  const skills = await Promise.all(SKILLS.map(([name, category]) => db.skill.create({ data: { name, category } })));
  const skillByName = new Map(skills.map((s) => [s.name, s]));

  const recruiters = await Promise.all(["Dana Cole","Marc Oyelaran","Sofia Reyes"].map((name, i) =>
    db.user.create({ data: { name, email: `recruiter${i}@demo.dev`, role: "recruiter", team: "Talent" } })));
  const hms = await Promise.all(["Ingrid Palme","Ravi Menon","Tom Bright","Joy Adeyemi"].map((name, i) =>
    db.user.create({ data: { name, email: `hm${i}@demo.dev`, role: "hiring_manager", team: "Engineering" } })));
  const interviewers = await Promise.all(["Lena Ortiz","Sam Whitfield","Priya Raman","Ken Abe","Mo Haddad"].map((name, i) =>
    db.user.create({ data: { name, email: `interviewer${i}@demo.dev`, role: "interviewer", team: "Engineering" } })));

  const jobs = [];
  for (const [i, j] of JOBS.entries()) {
    const openedAt = days(int(20, 160));
    const job = await db.job.create({ data: {
      companyId: companies[j.company].id,
      recruiterId: recruiters[i % recruiters.length].id,
      hiringManagerId: hms[i % hms.length].id,
      title: j.title, roleFamily: j.roleFamily, department: j.dept,
      location: pick(CITIES), remotePolicy: pick(["onsite","hybrid","remote"]),
      employmentType: "full_time", seniority: j.seniority,
      openings: int(1, 2), priority: pick(["normal","normal","high"]), status: j.status,
      description: `## About the role\n\n${j.summary}\n\n## What you'll do\n\n- Own features end to end, from design through operations.\n- Work directly with customers and the ${j.dept.toLowerCase()} team.\n\n## Requirements\n\n${j.reqs.map((r, n) => `${n + 1}. ${r}`).join("\n")}\n`,
      salaryMinCents: int(150, 190) * 1000 * 100, salaryMaxCents: int(200, 260) * 1000 * 100,
      openedAt, closedAt: j.status === "closed" ? days(int(1, 15)) : null,
      targetHireDate: days(-int(10, 60)),
    }});
    for (const [n, s] of j.skills.entries())
      await db.jobSkill.create({ data: { jobId: job.id, skillId: skillByName.get(s)!.id, required: n < 3, minYears: n < 3 ? int(2, 6) : null } });
    jobs.push(job);
  }

  // candidates
  const candidates = [];
  for (let i = 0; i < 120; i++) {
    const firstName = pick(FIRST), lastName = pick(LAST);
    const years = int(1, 18);
    const seniority = years < 3 ? "junior" : years < 7 ? "mid" : years < 12 ? "senior" : "staff";
    const c = await db.candidate.create({ data: {
      firstName, lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      phone: `+1-415-555-${String(1000 + i).slice(-4)}`,
      location: pick(CITIES), timezone: "America/Los_Angeles",
      currentTitle: pick(["Software Engineer","Senior Software Engineer","Staff Engineer","Data Engineer","Product Manager","Frontend Engineer"]),
      currentCompany: pick(["Stripe","Datadog","Shopify","a Series B startup","Oracle","Figma","freelance"]),
      yearsExperience: years, seniority,
      source: pick(["inbound","inbound","outbound","referral","agency","job_board"]),
      sourceDetail: pick(["LinkedIn","careers page","Hacker News","Recruiter outreach","Talent agency"]),
      requiresSponsorship: rnd() < 0.18,
      availableInDays: pick([0, 14, 14, 30, 60]),
      desiredSalaryCents: int(150, 280) * 1000 * 100,
      status: "active",
      resumeText: `${firstName} ${lastName} is a ${seniority} engineer with ${years} years of experience, most recently at ${pick(["Stripe","Datadog","Shopify","Oracle"])}. Built and operated production systems, led migrations, and mentored other engineers.`,
      linkedinUrl: `https://linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${i}`,
      createdAt: days(int(5, 200)), updatedAt: days(int(0, 5)),
    }});
    const picked = new Set<string>();
    for (let k = 0; k < int(3, 7); k++) picked.add(pick(SKILLS)[0]);
    for (const name of picked)
      await db.candidateSkill.create({ data: { candidateId: c.id, skillId: skillByName.get(name)!.id, years: int(1, Math.max(1, years)) } });
    candidates.push(c);
  }

  // applications: funnel shaped
  const STAGE_PLAN = [
    ...Array(70).fill("applied"), ...Array(35).fill("screening"), ...Array(28).fill("interviewing"),
    ...Array(8).fill("offer"), ...Array(5).fill("hired"), ...Array(14).fill("rejected"),
  ];
  const applications = [];
  const used = new Set<string>();
  for (const stage of STAGE_PLAN) {
    let cand = pick(candidates), job = pick(jobs.filter((j) => j.status !== "closed" || rnd() < 0.3));
    let key = `${cand.id}:${job.id}`, guard = 0;
    while (used.has(key) && guard++ < 50) { cand = pick(candidates); job = pick(jobs); key = `${cand.id}:${job.id}`; }
    if (used.has(key)) continue;
    used.add(key);
    const appliedAt = days(int(3, 90));
    const status = stage === "rejected" ? "rejected" : stage === "hired" ? "hired" : "active";
    const a = await db.application.create({ data: {
      candidateId: cand.id, jobId: job.id, ownerId: job.recruiterId,
      stage, stageEnteredAt: days(int(0, 25)), status,
      rejectedReason: status === "rejected" ? pick(["skills_mismatch","failed_interview","comp","timing","candidate_withdrew"]) : null,
      appliedAt, updatedAt: days(int(0, 3)),
    }});
    const late = rnd() < 0.1;
    await db.event.create({ data: { applicationId: a.id, type: "applied", toStage: "applied", occurredAt: appliedAt, recordedAt: late ? new Date(appliedAt.getTime() + int(1, 4) * 864e5) : appliedAt } });
    applications.push({ ...a, _stage: stage });
  }

  // one interview per application, for those that got past screening
  const interviewable = applications.filter((a) => ["interviewing","offer","hired","rejected"].includes(a._stage)).slice(0, 90);
  let completed = 0;
  for (const [i, a] of interviewable.entries()) {
    const future = i >= interviewable.length - 10;
    const status = future ? "scheduled" : i % 17 === 3 ? "no_show" : i % 23 === 7 ? "cancelled" : "completed";
    const scheduledAt = future ? days(-int(1, 12)) : days(int(1, 40));
    const iv = await db.interview.create({ data: {
      applicationId: a.id, round: pick(["screen","technical","technical","hiring_manager","onsite"]),
      mode: pick(["video","video","phone","onsite"]), interviewerId: pick(interviewers).id,
      scheduledAt, durationMinutes: pick([45, 60, 60, 90]),
      completedAt: status === "completed" ? scheduledAt : null,
      status, noShowReason: status === "no_show" ? "candidate did not join" : null,
      createdAt: new Date(scheduledAt.getTime() - 5 * 864e5),
    }});
    if (status !== "completed") continue;
    completed++;
    // LLM-style scoring: competencies with evidence -> weighted mean -> overall. 0-100 scale.
    const tilt = rnd();
    const comps = COMPETENCIES.filter(() => rnd() < 0.8).slice(0, 4);
    const list = (comps.length ? comps : ["coding","communication"]).map((c) => {
      const score = Math.max(0, Math.min(100, Math.round(65 + (tilt - 0.45) * 70 + (rnd() - 0.5) * 20)));
      return { competency: c, score, evidence: EVIDENCE[c][score >= 80 ? 0 : score >= 50 ? 1 : 2] };
    });
    const wsum = list.reduce((s, c) => s + WEIGHTS[c.competency], 0);
    const scoreRaw = list.reduce((s, c) => s + c.score * WEIGHTS[c.competency], 0) / wsum;
    const overallScore = Math.round(scoreRaw);
    const fb = await db.feedback.create({ data: {
      interviewId: iv.id, submittedById: iv.interviewerId,
      source: completed <= 2 ? "human" : "llm",
      transcriptRef: `transcripts/${iv.id}.txt`,
      overallScore, scoreRaw: Number(scoreRaw.toFixed(2)),
      recommendation: scoreRaw >= 90 ? "strong_yes" : scoreRaw >= 70 ? "yes" : scoreRaw >= 50 ? "no" : "strong_no",
      strengths: JSON.stringify(list.filter((c) => c.score >= 80).map((c) => c.competency)),
      concerns: JSON.stringify(list.filter((c) => c.score <= 40).map((c) => c.competency)),
      notes: `Scored from the transcript against the role rubric. ${list.map((c) => `${c.competency} ${c.score}`).join(", ")}.`,
      submittedAt: new Date(iv.completedAt!.getTime() + 36e5),
    }});
    for (const c of list) await db.feedbackCompetency.create({ data: { feedbackId: fb.id, ...c } });
    await db.event.create({ data: { applicationId: a.id, type: "interview_completed", occurredAt: iv.completedAt!, recordedAt: new Date(iv.completedAt!.getTime() + 36e5) } });
  }

  // offers
  for (const a of applications.filter((x) => ["offer","hired"].includes(x._stage)).slice(0, 10)) {
    const extendedAt = days(int(2, 30));
    const decided = a._stage === "hired" || rnd() < 0.6;
    await db.offer.create({ data: {
      applicationId: a.id, baseSalaryCents: int(170, 250) * 1000 * 100, bonusCents: int(0, 30) * 1000 * 100,
      equityPct: Number((rnd() * 0.3).toFixed(3)), startDate: days(-int(14, 45)),
      status: a._stage === "hired" ? "accepted" : decided ? "declined" : "extended",
      extendedAt, respondedAt: decided ? new Date(extendedAt.getTime() + int(2, 9) * 864e5) : null,
      declineReason: decided && a._stage !== "hired" ? pick(["comp","other_offer","counter_offer","location"]) : null,
    }});
  }

  // activities — some candidates deliberately cold
  for (const [i, a] of applications.entries()) {
    const n = i % 9 === 0 ? 0 : int(1, 4);
    for (let k = 0; k < n; k++) {
      const occurredAt = days(int(1, 40));
      await db.activity.create({ data: {
        candidateId: a.candidateId, applicationId: a.id, userId: a.ownerId,
        type: pick(["note","email_sent","email_received","call"]),
        body: pick(["Left a voicemail.","Sent the role overview and comp band.","Candidate asked about remote policy.","Debrief note: strong on fundamentals.","Scheduling for next week."]),
        occurredAt, recordedAt: occurredAt,
      }});
    }
  }

  // a small question library
  for (const job of jobs.slice(0, 4)) {
    for (const [n, q] of [
      ["Walk me through a system you designed that had to handle sustained write load.", "system_design"],
      ["Tell me about a production incident you owned end to end.", "behavioral"],
      ["How do you decide what to test, and what not to?", "technical"],
    ].entries()) {
      await db.interviewQuestion.create({ data: {
        jobId: job.id, text: q[0], category: q[1], difficulty: "medium", source: "library",
        rationale: "Baseline question from the library.", requirementIds: JSON.stringify([`R${n + 1}`]),
      }});
    }
  }

  for (const [key, value] of Object.entries({ model: process.env.MODEL ?? "openai/gpt-4.1-mini", temperature: "0.2", maxSteps: "6" }))
    await db.setting.create({ data: { key, value } });

  const counts = {
    companies: companies.length, users: recruiters.length + hms.length + interviewers.length,
    jobs: jobs.length, candidates: candidates.length, applications: applications.length,
    interviews: interviewable.length, scored: completed,
  };
  console.log("seeded", counts);
}

main().finally(() => db.$disconnect());
