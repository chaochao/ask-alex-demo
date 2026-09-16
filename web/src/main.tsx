import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider, useParams, useRouterState,
} from "@tanstack/react-router";
import { api } from "./lib/api";
import { AskAlexSidebar } from "./components/AskAlex/Sidebar";
import "./styles.css";

const money = (c?: number | null) => (c == null ? "—" : `$${Math.round(c / 100_000)}k`);
const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

function Shell() {
  const [open, setOpen] = useState(true);
  const state = useRouterState();
  const path = state.location.pathname;
  const [ctx, setCtx] = useState<{ entityType?: string; entityId?: string; label?: string }>({});

  useEffect(() => {
    const m = /^\/(jobs|candidates|interviews)\/(.+)$/.exec(path);
    setCtx(m ? { entityType: m[1].slice(0, -1), entityId: m[2], label: undefined } : {});
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <nav className="nav">
        <Link to="/jobs" activeProps={{ className: "active" }}>Jobs</Link>
        <Link to="/candidates" activeProps={{ className: "active" }}>Candidates</Link>
        <Link to="/interviews" activeProps={{ className: "active" }}>Interviews</Link>
        <Link to="/settings" activeProps={{ className: "active" }}>Settings</Link>
        <span className="spacer" />
        <button onClick={() => setOpen((o) => !o)}>Ask Alex ⌘K</button>
      </nav>
      <div className="app">
        <main className="main"><Outlet /></main>
        <AskAlexSidebar open={open} onClose={() => setOpen(false)} pageContext={{ route: path, ...ctx }} />
      </div>
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const route = (path: string, component: React.ComponentType) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

function Jobs() {
  const { data = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => api<any[]>("/api/jobs") });
  return (
    <>
      <h1>Jobs</h1>
      <table><thead><tr><th>Title</th><th>Company</th><th>Status</th><th>Applications</th><th>Opened</th></tr></thead>
        <tbody>{data.map((j) => (
          <tr key={j.id}><td><Link to="/jobs/$jobId" params={{ jobId: j.id }}>{j.title}</Link></td>
            <td>{j.company.name}</td><td><span className="pill">{j.status}</span></td>
            <td>{j._count.applications}</td><td className="muted">{date(j.openedAt)}</td></tr>))}
        </tbody></table>
    </>
  );
}

function JobDetail() {
  const { jobId } = useParams({ strict: false }) as { jobId: string };
  const { data: j } = useQuery({ queryKey: ["job", jobId], queryFn: () => api<any>(`/api/jobs/${jobId}`) });
  if (!j) return <p className="muted">Loading…</p>;
  const ranked = [...j.applications]
    .filter((a: any) => a.interview?.feedback)
    .sort((a: any, b: any) => b.interview.feedback.scoreRaw - a.interview.feedback.scoreRaw);
  return (
    <>
      <h1>{j.title}</h1>
      <p className="muted">{j.company.name} · {j.seniority} · {j.location} · {money(j.salaryMinCents)}–{money(j.salaryMaxCents)} · recruiter {j.recruiter.name}</p>
      <div className="grid" style={{ marginTop: 16 }}>
        {j.byStage.map((s: any) => <div className="card" key={s.dimension}><div className="score">{s.value}</div><div className="muted">{s.dimension}</div></div>)}
        <div className="card"><div className="score">{j.buckets.notYetInterviewed}</div><div className="muted">not yet interviewed</div></div>
      </div>
      <h2>Requirements</h2>
      <ul>{j.skills.map((s: any) => <li key={s.skillId}>{s.skill.name}{s.required ? " (required)" : ""}{s.minYears ? ` · ${s.minYears}y+` : ""}</li>)}</ul>
      <h2>Description</h2>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{j.description}</pre>
      <h2>Scored candidates</h2>
      <table><thead><tr><th>Candidate</th><th>Stage</th><th>Round</th><th>Score</th><th>Interviewed</th></tr></thead>
        <tbody>{ranked.map((a: any) => (
          <tr key={a.id}><td><Link to="/candidates/$candidateId" params={{ candidateId: a.candidate.id }}>{a.candidate.firstName} {a.candidate.lastName}</Link></td>
            <td><span className="pill">{a.stage}</span></td><td>{a.interview.round}</td>
            <td className="score">{a.interview.feedback.overallScore} <span className="muted">({a.interview.feedback.scoreRaw.toFixed(2)})</span></td>
            <td className="muted">{date(a.interview.completedAt)}</td></tr>))}
        </tbody></table>
      <h2>Generated questions</h2>
      {j.questions.length === 0 ? <p className="muted">None yet — ask Ask Alex to generate some.</p> : (
        <ul>{j.questions.map((q: any) => <li key={q.id}>{q.text} <span className="pill">{q.category}</span></li>)}</ul>)}
    </>
  );
}

function Candidates() {
  const { data = [] } = useQuery({ queryKey: ["candidates"], queryFn: () => api<any[]>("/api/candidates") });
  return (
    <>
      <h1>Candidates</h1>
      <table><thead><tr><th>Name</th><th>Title</th><th>Years</th><th>Source</th><th>Applications</th><th>Best score</th></tr></thead>
        <tbody>{data.map((c) => {
          const best = c.applications.map((a: any) => a.interview?.feedback?.overallScore).filter(Boolean).sort().at(-1);
          return (<tr key={c.id}>
            <td><Link to="/candidates/$candidateId" params={{ candidateId: c.id }}>{c.firstName} {c.lastName}</Link></td>
            <td>{c.currentTitle}</td><td>{c.yearsExperience}</td><td><span className="pill">{c.source}</span></td>
            <td>{c.applications.length}</td><td className="score">{best ?? "—"}</td></tr>);
        })}</tbody></table>
    </>
  );
}

function CandidateDetail() {
  const { candidateId } = useParams({ strict: false }) as { candidateId: string };
  const { data: c } = useQuery({ queryKey: ["candidate", candidateId], queryFn: () => api<any>(`/api/candidates/${candidateId}`) });
  if (!c) return <p className="muted">Loading…</p>;
  return (
    <>
      <h1>{c.firstName} {c.lastName}</h1>
      <p className="muted">{c.currentTitle} at {c.currentCompany} · {c.yearsExperience}y · {c.location} · {c.source}
        {c.requiresSponsorship ? " · needs sponsorship" : ""}</p>
      <h2>Skills</h2>
      <p>{c.skills.map((s: any) => `${s.skill.name}${s.years ? ` (${s.years}y)` : ""}`).join(" · ")}</p>
      <h2>Applications</h2>
      {c.applications.map((a: any) => (
        <div className="card" key={a.id} style={{ marginBottom: 10 }}>
          <div><Link to="/jobs/$jobId" params={{ jobId: a.job.id }}>{a.job.title}</Link> — {a.job.company.name} <span className="pill">{a.stage}</span></div>
          {a.interview ? (
            <div className="muted" style={{ marginTop: 6 }}>
              {a.interview.round} with {a.interview.interviewer.name} · {a.interview.status}
              {a.interview.feedback && <> · score <span className="score">{a.interview.feedback.overallScore}</span> ({a.interview.feedback.recommendation}) · <span className="pill">{a.interview.feedback.source}</span></>}
              {a.interview.feedback && <ul>{a.interview.feedback.competencies.map((k: any) => <li key={k.id}>{k.competency}: {k.score} — {k.evidence}</li>)}</ul>}
            </div>) : <div className="muted">No interview yet</div>}
        </div>))}
      <h2>Resume</h2><p>{c.resumeText}</p>
      <h2>Recent activity</h2>
      <ul>{c.activities.map((a: any) => <li key={a.id}><span className="muted">{date(a.occurredAt)}</span> {a.type}: {a.body}</li>)}</ul>
    </>
  );
}

function Interviews() {
  const { data = [] } = useQuery({ queryKey: ["interviews"], queryFn: () => api<any[]>("/api/interviews") });
  return (
    <>
      <h1>Interviews</h1>
      <table><thead><tr><th>Candidate</th><th>Job</th><th>Round</th><th>Interviewer</th><th>When</th><th>Status</th><th>Score</th></tr></thead>
        <tbody>{data.map((i) => (
          <tr key={i.id}><td><Link to="/interviews/$interviewId" params={{ interviewId: i.id }}>{i.application.candidate.firstName} {i.application.candidate.lastName}</Link></td>
            <td>{i.application.job.title}</td><td>{i.round}</td><td>{i.interviewer.name}</td>
            <td className="muted">{date(i.completedAt ?? i.scheduledAt)}</td><td><span className="pill">{i.status}</span></td>
            <td className="score">{i.feedback?.overallScore ?? "—"}</td></tr>))}
        </tbody></table>
    </>
  );
}

function InterviewDetail() {
  const { interviewId } = useParams({ strict: false }) as { interviewId: string };
  const { data: i } = useQuery({ queryKey: ["interview", interviewId], queryFn: () => api<any>(`/api/interviews/${interviewId}`) });
  if (!i) return <p className="muted">Loading…</p>;
  return (
    <>
      <h1>{i.application.candidate.firstName} {i.application.candidate.lastName} — {i.round}</h1>
      <p className="muted">{i.application.job.title} · {i.interviewer.name} · {date(i.completedAt ?? i.scheduledAt)} · {i.status}</p>
      {i.feedback ? (<>
        <h2>Score</h2>
        <p><span className="score" style={{ fontSize: 28 }}>{i.feedback.overallScore}</span> <span className="muted">raw {i.feedback.scoreRaw.toFixed(2)} · {i.feedback.recommendation} · scored by {i.feedback.source}</span></p>
        <h2>Competencies</h2>
        <ul>{i.feedback.competencies.map((c: any) => <li key={c.id}><b>{c.competency} {c.score}</b> — {c.evidence}</li>)}</ul>
        <h2>Notes</h2><p>{i.feedback.notes}</p>
      </>) : <p className="muted">No feedback — this interview is {i.status}.</p>}
    </>
  );
}

function Settings() {
  const { data = [] } = useQuery({ queryKey: ["settings"], queryFn: () => api<any[]>("/api/settings") });
  return (
    <>
      <h1>Settings</h1>
      <h2>Model</h2>
      <ul>{data.map((s) => <li key={s.key}><code>{s.key}</code>: {s.value}</li>)}</ul>
      <h2>Evaluations</h2>
      <p className="muted">Run <code>npm run eval</code> to score the agent against <code>server/evals/cases.json</code>.
        Results are stored in EvalRun / EvalResult; wiring them into this page is the last milestone.</p>
    </>
  );
}

const routeTree = rootRoute.addChildren([
  route("/", Jobs), route("/jobs", Jobs), route("/jobs/$jobId", JobDetail),
  route("/candidates", Candidates), route("/candidates/$candidateId", CandidateDetail),
  route("/interviews", Interviews), route("/interviews/$interviewId", InterviewDetail),
  route("/settings", Settings),
]);
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
