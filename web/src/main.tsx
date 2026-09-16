import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider, useParams, useRouterState,
} from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { api } from "./lib/api";
import { AskAlexSidebar } from "./components/AskAlex/Sidebar";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import "./styles.css";

const money = (c?: number | null) => (c == null ? "—" : `$${Math.round(c / 100_000)}k`);
const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

const POSITIVE = new Set(["hired", "accepted", "completed", "strong_yes", "yes"]);
const NEGATIVE = new Set(["closed", "rejected", "declined", "no_show", "cancelled", "withdrawn", "strong_no", "no", "on_hold", "do_not_contact"]);
function StatusBadge({ status }: { status: string }) {
  const variant = POSITIVE.has(status) ? "default" : NEGATIVE.has(status) ? "outline" : "secondary";
  return <Badge variant={variant} className="font-normal">{status.replace(/_/g, " ")}</Badge>;
}

function NavLink({ to, path, children }: { to: string; path: string; children: React.ReactNode }) {
  const active = path === to || path.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

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
      <nav className="sticky top-0 z-20 flex items-center gap-1 border-b bg-background/95 px-4 py-2.5 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-6">
        <NavLink to="/jobs" path={path}>Jobs</NavLink>
        <NavLink to="/candidates" path={path}>Candidates</NavLink>
        <NavLink to="/interviews" path={path}>Interviews</NavLink>
        <NavLink to="/settings" path={path}>Settings</NavLink>
        <div className="flex-1" />
        <Button size="sm" variant={open ? "secondary" : "outline"} onClick={() => setOpen((o) => !o)}>
          <Sparkles data-icon="inline-start" />
          Ask Alex
          <kbd className="ml-1 hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">⌘K</kbd>
        </Button>
      </nav>
      <div className="flex min-h-[calc(100svh-49px)]">
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
        <AskAlexSidebar open={open} onClose={() => setOpen(false)} pageContext={{ route: path, ...ctx }} />
      </div>
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });
const route = (path: string, component: React.ComponentType) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

function PageHeader({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-6 space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function Loading() {
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}

function Jobs() {
  const { data = [] } = useQuery({ queryKey: ["jobs"], queryFn: () => api<any[]>("/api/jobs") });
  return (
    <div>
      <PageHeader title="Jobs" />
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Applications</TableHead>
              <TableHead>Opened</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="font-medium whitespace-normal">
                  <Link to="/jobs/$jobId" params={{ jobId: j.id }} className="hover:underline">{j.title}</Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{j.company.name}</TableCell>
                <TableCell><StatusBadge status={j.status} /></TableCell>
                <TableCell className="text-right tabular-nums">{j._count.applications}</TableCell>
                <TableCell className="text-muted-foreground">{date(j.openedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function JobDetail() {
  const { jobId } = useParams({ strict: false }) as { jobId: string };
  const { data: j } = useQuery({ queryKey: ["job", jobId], queryFn: () => api<any>(`/api/jobs/${jobId}`) });
  if (!j) return <Loading />;
  const ranked = [...j.applications]
    .filter((a: any) => a.interview?.feedback)
    .sort((a: any, b: any) => b.interview.feedback.scoreRaw - a.interview.feedback.scoreRaw);
  return (
    <div className="space-y-8">
      <PageHeader
        title={j.title}
        subtitle={`${j.company.name} · ${j.seniority} · ${j.location} · ${money(j.salaryMinCents)}–${money(j.salaryMaxCents)} · recruiter ${j.recruiter.name}`}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {j.byStage.map((s: any) => (
          <Card key={s.dimension} size="sm">
            <CardContent className="space-y-1">
              <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.dimension}</div>
            </CardContent>
          </Card>
        ))}
        <Card size="sm">
          <CardContent className="space-y-1">
            <div className="text-2xl font-semibold tabular-nums">{j.buckets.notYetInterviewed}</div>
            <div className="text-xs text-muted-foreground">not yet interviewed</div>
          </CardContent>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Requirements</h2>
        <ul className="space-y-1.5 text-sm">
          {j.skills.map((s: any) => (
            <li key={s.skillId} className="flex items-center gap-2">
              <span>{s.skill.name}</span>
              {s.required && <Badge variant="secondary" className="font-normal">required</Badge>}
              {s.minYears && <span className="text-xs text-muted-foreground">{s.minYears}y+</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Description</h2>
        <pre className="text-wrap font-sans text-sm text-foreground/90 whitespace-pre-wrap">{j.description}</pre>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Scored candidates</h2>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Round</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Interviewed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    <Link to="/candidates/$candidateId" params={{ candidateId: a.candidate.id }} className="hover:underline">
                      {a.candidate.firstName} {a.candidate.lastName}
                    </Link>
                  </TableCell>
                  <TableCell><StatusBadge status={a.stage} /></TableCell>
                  <TableCell className="text-muted-foreground">{a.interview.round}</TableCell>
                  <TableCell className="tabular-nums">
                    <span className="font-semibold">{a.interview.feedback.overallScore}</span>{" "}
                    <span className="text-muted-foreground">({a.interview.feedback.scoreRaw.toFixed(1)})</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{date(a.interview.completedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Generated questions</h2>
        {j.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet — ask Ask Alex to generate some.</p>
        ) : (
          <ul className="space-y-2">
            {j.questions.map((q: any) => (
              <li key={q.id} className="flex items-start gap-2 text-sm">
                <Badge variant="secondary" className="mt-0.5 shrink-0 font-normal">{q.category}</Badge>
                <span>{q.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Candidates() {
  const { data = [] } = useQuery({ queryKey: ["candidates"], queryFn: () => api<any[]>("/api/candidates") });
  return (
    <div>
      <PageHeader title="Candidates" />
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Years</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Applications</TableHead>
              <TableHead className="text-right">Best score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => {
              const best = c.applications.map((a: any) => a.interview?.feedback?.overallScore).filter(Boolean).sort().at(-1);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link to="/candidates/$candidateId" params={{ candidateId: c.id }} className="hover:underline">
                      {c.firstName} {c.lastName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.currentTitle}</TableCell>
                  <TableCell className="tabular-nums">{c.yearsExperience}</TableCell>
                  <TableCell><Badge variant="secondary" className="font-normal">{c.source.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{c.applications.length}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{best ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CandidateDetail() {
  const { candidateId } = useParams({ strict: false }) as { candidateId: string };
  const { data: c } = useQuery({ queryKey: ["candidate", candidateId], queryFn: () => api<any>(`/api/candidates/${candidateId}`) });
  if (!c) return <Loading />;
  return (
    <div className="space-y-8">
      <PageHeader
        title={`${c.firstName} ${c.lastName}`}
        subtitle={`${c.currentTitle} at ${c.currentCompany} · ${c.yearsExperience}y · ${c.location} · ${c.source.replace(/_/g, " ")}${c.requiresSponsorship ? " · needs sponsorship" : ""}`}
      />

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Skills</h2>
        <div className="flex flex-wrap gap-1.5">
          {c.skills.map((s: any) => (
            <Badge key={s.skillId} variant="secondary" className="font-normal">
              {s.skill.name}{s.years ? ` · ${s.years}y` : ""}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Applications</h2>
        <div className="space-y-3">
          {c.applications.map((a: any) => (
            <Card key={a.id}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/jobs/$jobId" params={{ jobId: a.job.id }} className="font-medium hover:underline">{a.job.title}</Link>
                  <span className="text-sm text-muted-foreground">— {a.job.company.name}</span>
                  <StatusBadge status={a.stage} />
                </div>
                {a.interview ? (
                  <div className="text-sm text-muted-foreground">
                    <div>
                      {a.interview.round} with {a.interview.interviewer.name} · {a.interview.status}
                      {a.interview.feedback && (
                        <>
                          {" "}· score <span className="font-semibold text-foreground">{a.interview.feedback.overallScore}</span>{" "}
                          ({a.interview.feedback.recommendation.replace(/_/g, " ")}){" "}
                          <Badge variant="outline" className="font-normal">{a.interview.feedback.source}</Badge>
                        </>
                      )}
                    </div>
                    {a.interview.feedback && (
                      <ul className="mt-2 space-y-1">
                        {a.interview.feedback.competencies.map((k: any) => (
                          <li key={k.id}><span className="font-medium text-foreground">{k.competency}</span>: {k.score} — {k.evidence}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : <div className="text-sm text-muted-foreground">No interview yet</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Resume</h2>
        <p className="text-sm text-foreground/90">{c.resumeText}</p>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent activity</h2>
        <ul className="space-y-1.5 text-sm">
          {c.activities.map((a: any) => (
            <li key={a.id}><span className="text-muted-foreground">{date(a.occurredAt)}</span> {a.type}: {a.body}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Interviews() {
  const { data = [] } = useQuery({ queryKey: ["interviews"], queryFn: () => api<any[]>("/api/interviews") });
  return (
    <div>
      <PageHeader title="Interviews" />
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Round</TableHead>
              <TableHead>Interviewer</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">
                  <Link to="/interviews/$interviewId" params={{ interviewId: i.id }} className="hover:underline">
                    {i.application.candidate.firstName} {i.application.candidate.lastName}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{i.application.job.title}</TableCell>
                <TableCell>{i.round}</TableCell>
                <TableCell className="text-muted-foreground">{i.interviewer.name}</TableCell>
                <TableCell className="text-muted-foreground">{date(i.completedAt ?? i.scheduledAt)}</TableCell>
                <TableCell><StatusBadge status={i.status} /></TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{i.feedback?.overallScore ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function InterviewDetail() {
  const { interviewId } = useParams({ strict: false }) as { interviewId: string };
  const { data: i } = useQuery({ queryKey: ["interview", interviewId], queryFn: () => api<any>(`/api/interviews/${interviewId}`) });
  if (!i) return <Loading />;
  return (
    <div className="space-y-8">
      <PageHeader
        title={`${i.application.candidate.firstName} ${i.application.candidate.lastName} — ${i.round}`}
        subtitle={`${i.application.job.title} · ${i.interviewer.name} · ${date(i.completedAt ?? i.scheduledAt)} · ${i.status}`}
      />
      {i.feedback ? (
        <>
          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Score</h2>
            <p className="flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{i.feedback.overallScore}</span>
              <span className="text-sm text-muted-foreground">
                raw {i.feedback.scoreRaw.toFixed(1)} · {i.feedback.recommendation.replace(/_/g, " ")} · scored by {i.feedback.source}
              </span>
            </p>
          </section>
          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Competencies</h2>
            <ul className="space-y-1.5 text-sm">
              {i.feedback.competencies.map((c: any) => (
                <li key={c.id}><span className="font-semibold">{c.competency} {c.score}</span> — {c.evidence}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Notes</h2>
            <p className="text-sm text-foreground/90">{i.feedback.notes}</p>
          </section>
        </>
      ) : <p className="text-sm text-muted-foreground">No feedback — this interview is {i.status}.</p>}
    </div>
  );
}

function Settings() {
  const { data = [] } = useQuery({ queryKey: ["settings"], queryFn: () => api<any[]>("/api/settings") });
  return (
    <div className="space-y-8">
      <PageHeader title="Settings" />
      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Model</h2>
        <ul className="space-y-1.5 text-sm">
          {data.map((s) => (
            <li key={s.key}><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{s.key}</code>: {s.value}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Evaluations</h2>
        <p className="text-sm text-muted-foreground">
          Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">npm run eval</code> to score the agent against{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">server/evals/cases.json</code>.
          Results are stored in EvalRun / EvalResult; wiring them into this page is the last milestone.
        </p>
      </section>
    </div>
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
