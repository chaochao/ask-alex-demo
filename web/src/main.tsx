import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider, useParams, useRouterState,
} from "@tanstack/react-router";
import {
  Briefcase, CalendarCheck2, Clock, Handshake, Inbox, ListChecks, MessagesSquare,
  Settings as SettingsIcon, Sparkles, UserCheck, Users, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

const TONE_CLASSES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-transparent bg-secondary text-secondary-foreground",
} as const;

// job.status, application.stage and interview.status share one vocabulary of outcomes
const STATUS_TONE: Record<string, keyof typeof TONE_CLASSES> = {
  open: "success", hired: "success", completed: "success",
  applied: "info", screening: "info", interviewing: "info", offer: "info", scheduled: "info",
  on_hold: "warning", no_show: "warning", cancelled: "warning",
  rejected: "danger",
};

// Job pipeline stat cards: one color + icon per funnel stage, in natural progression order —
// not sorted by count, so the row reads as a funnel rather than a leaderboard.
const STAGE_ORDER = ["applied", "screening", "interviewing", "offer", "hired", "rejected"] as const;
// Colors/type from Hiring Platform.html (warm-theme palette) — tan for the neutral early stages,
// mint deepening toward rust as a candidate advances, rust-bold for the outcome that matters (hired),
// and the same muted outline for anything no longer moving (rejected, not yet interviewed).
type WarmCardTone = { icon: LucideIcon; bg: string; ink: string; iconBg: string; iconInk: string; border?: boolean };
const STAGE_CARD_THEME: Record<string, WarmCardTone> = {
  applied: { icon: Inbox, bg: "bg-[var(--warm-tan)]", ink: "text-[var(--warm-ink)]", iconBg: "bg-[var(--warm-ink)]/10", iconInk: "text-[var(--warm-ink)]" },
  screening: { icon: ListChecks, bg: "bg-[var(--warm-tan)]", ink: "text-[var(--warm-ink)]", iconBg: "bg-[var(--warm-ink)]/10", iconInk: "text-[var(--warm-ink)]" },
  interviewing: { icon: MessagesSquare, bg: "bg-[var(--warm-mint)]", ink: "text-[var(--warm-mint-ink)]", iconBg: "bg-[var(--warm-mint-ink)]/15", iconInk: "text-[var(--warm-mint-ink)]" },
  offer: { icon: Handshake, bg: "bg-[var(--warm-rust)]/15", ink: "text-[var(--warm-rust-dark)]", iconBg: "bg-[var(--warm-rust-dark)]/15", iconInk: "text-[var(--warm-rust-dark)]" },
  hired: { icon: UserCheck, bg: "bg-[var(--warm-rust)]", ink: "text-[var(--warm-bg)]", iconBg: "bg-[var(--warm-bg)]", iconInk: "text-[var(--warm-rust-dark)]" },
  rejected: { icon: XCircle, bg: "bg-transparent", ink: "text-[var(--warm-ink)]", iconBg: "bg-[var(--warm-ink)]/10", iconInk: "text-[var(--warm-ink)]", border: true },
  not_yet_interviewed: { icon: Clock, bg: "bg-transparent", ink: "text-[var(--warm-ink)]", iconBg: "bg-[var(--warm-ink)]/10", iconInk: "text-[var(--warm-ink)]", border: true },
};

// application.stage / job.status badge tones, warm-theme version — scoped to the job detail
// page only, kept separate from the shared StatusBadge used elsewhere.
const WARM_BADGE_TONE: Record<string, string> = {
  offer: "bg-[var(--warm-rust-dark)] text-[var(--warm-bg)]",
  hired: "bg-[var(--warm-rust-dark)] text-[var(--warm-bg)]",
  open: "bg-[var(--warm-rust-dark)] text-[var(--warm-bg)]",
  completed: "bg-[var(--warm-rust-dark)] text-[var(--warm-bg)]",
  applied: "bg-[var(--warm-mint)] text-[var(--warm-mint-ink)]",
  screening: "bg-[var(--warm-mint)] text-[var(--warm-mint-ink)]",
  interviewing: "bg-[var(--warm-mint)] text-[var(--warm-mint-ink)]",
  scheduled: "bg-[var(--warm-mint)] text-[var(--warm-mint-ink)]",
  rejected: "bg-[var(--warm-cream-badge)] text-[var(--warm-badge-ink)]",
  on_hold: "bg-[var(--warm-tan)] text-[var(--warm-ink)]",
  no_show: "bg-[var(--warm-tan)] text-[var(--warm-ink)]",
  cancelled: "bg-[var(--warm-tan)] text-[var(--warm-ink)]",
};

function WarmBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs capitalize", WARM_BADGE_TONE[status] ?? "bg-[var(--warm-tan)] text-[var(--warm-ink)]")}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// job.description is plain text following one convention: "## Heading" sections, "- " bullets,
// "N. " numbered lists. Parsed here rather than pulled from markdown, since the seed data always
// follows this exact shape and a library would be more code to render the same three cases.
function WarmDescription({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { type: "bullet" | "number"; items: string[] } | null = null;
  const flushList = () => {
    if (!list) return;
    if (list.type === "bullet") {
      blocks.push(
        <ul key={blocks.length} className="ml-1 list-disc space-y-1 pl-4 text-sm">
          {list.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>,
      );
    } else {
      blocks.push(
        <ol key={blocks.length} className="space-y-2">
          {list.items.map((it, i) => (
            <li key={i} className="flex items-baseline gap-3 text-sm">
              <span className="warm-heading flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--warm-bg)] text-xs">{i + 1}</span>
              <span>{it}</span>
            </li>
          ))}
        </ol>,
      );
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,3}\s+(.*)/.exec(line);
    const bullet = /^-\s+(.*)/.exec(line);
    const numbered = /^\d+\.\s+(.*)/.exec(line);
    if (heading) {
      flushList();
      blocks.push(<h3 key={blocks.length} className="warm-heading text-xl">{heading[1]}</h3>);
    } else if (bullet) {
      if (list?.type !== "bullet") flushList();
      (list ??= { type: "bullet", items: [] }).items.push(bullet[1]);
    } else if (numbered) {
      if (list?.type !== "number") flushList();
      (list ??= { type: "number", items: [] }).items.push(numbered[1]);
    } else {
      flushList();
      blocks.push(<p key={blocks.length} className="text-sm text-[var(--warm-body)]">{line}</p>);
    }
  }
  flushList();
  return <div className="space-y-3">{blocks}</div>;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", TONE_CLASSES[STATUS_TONE[status] ?? "neutral"])}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

// candidate.source is categorical, not good/bad — distinct hues, not a semantic scale
const SOURCE_TONE_CLASSES: Record<string, string> = {
  referral: "border-violet-200 bg-violet-50 text-violet-700",
  inbound: "border-sky-200 bg-sky-50 text-sky-700",
  outbound: "border-cyan-200 bg-cyan-50 text-cyan-700",
  agency: "border-orange-200 bg-orange-50 text-orange-700",
  job_board: "border-slate-200 bg-slate-50 text-slate-700",
};

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal", SOURCE_TONE_CLASSES[source] ?? TONE_CLASSES.neutral)}>
      {source.replace(/_/g, " ")}
    </Badge>
  );
}

function NavLink({ to, path, icon: Icon, children }: { to: string; path: string; icon: LucideIcon; children: React.ReactNode }) {
  const active = path === to || path.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4 translate-x-0 translate-y-0 transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:scale-110" />
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
      <nav className="sticky top-0 z-20 flex h-14 items-center gap-1 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-6">
        <NavLink to="/jobs" path={path} icon={Briefcase}>Jobs</NavLink>
        <NavLink to="/candidates" path={path} icon={Users}>Candidates</NavLink>
        <NavLink to="/interviews" path={path} icon={CalendarCheck2}>Interviews</NavLink>
        <NavLink to="/settings" path={path} icon={SettingsIcon}>Settings</NavLink>
        <div className="flex-1" />
        <Button size="sm" variant={open ? "secondary" : "outline"} onClick={() => setOpen((o) => !o)}>
          <Sparkles data-icon="inline-start" />
          Ask Alex
          <kbd className="ml-1 hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">⌘K</kbd>
        </Button>
      </nav>
      <div className="flex min-h-[calc(100svh-3.5rem)]">
        <main
          key={path}
          className={cn(
            "page-transition min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 motion-safe:lg:transition-[margin-right] motion-safe:lg:duration-300 motion-safe:lg:ease-in-out",
            open && "lg:mr-[420px]",
          )}
        >
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

function StageStatCard({ stage, value }: { stage: string; value: number }) {
  const theme = STAGE_CARD_THEME[stage] ?? STAGE_CARD_THEME.applied;
  const Icon = theme.icon;
  return (
    <Card size="sm" className={cn("rounded-[2rem] border-0 shadow-none", theme.bg, theme.border && "ring-1 ring-[var(--warm-border)]")}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className={cn("warm-heading text-3xl", theme.ink)}>{value}</div>
          <div className={cn("text-xs opacity-80", theme.ink)}>{stage.replace(/_/g, " ")}</div>
        </div>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", theme.iconBg, theme.iconInk)}>
          <Icon className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

// Donut ring via conic-gradient — no chart library for one shape. `trackBg` must match whatever
// card background the ring sits on, since the hole is punched by an inner circle of that color.
function ScoreRing({ value, trackBg = "var(--warm-tan)" }: { value: number; trackBg?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className="relative flex size-24 shrink-0 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(var(--warm-rust) ${pct}%, ${trackBg} ${pct}% 100%)` }}
    >
      <div className="absolute inset-[7px] rounded-full" style={{ background: trackBg }} />
      <span className="warm-heading relative text-2xl">{value}</span>
    </div>
  );
}

// The schema's real recommendation values, in order — no "mixed" here, unlike the reference,
// because Feedback.recommendation only ever holds one of these four (see schema-guide.ts).
const RECOMMENDATION_SCALE = ["strong_no", "no", "yes", "strong_yes"] as const;
function RecommendationScale({ value }: { value: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RECOMMENDATION_SCALE.map((r) => (
        <span
          key={r}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs capitalize",
            r === value ? "bg-[var(--warm-rust-dark)] text-[var(--warm-bg)]" : "bg-[var(--warm-bg)] text-[var(--warm-ink)] opacity-70",
          )}
        >
          {r.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

// Score bands: no real "passing bar" exists in the data, so 50 (the midpoint of the 0-100 scale)
// is used as the good/below-bar threshold — a defensible default, not a measured cutoff.
function CompetencyBar({ label, score, evidence }: { label: string; score: number; evidence: string }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="warm-heading text-lg capitalize">{label.replace(/_/g, " ")}</span>
        <span className="warm-heading text-lg">{score}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--warm-tan)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: score >= 50 ? "var(--warm-good)" : "var(--warm-rust)" }}
        />
      </div>
      <p className="text-sm opacity-70">{evidence}</p>
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
  const byStage: Record<string, number> = Object.fromEntries(j.byStage.map((s: any) => [s.dimension, s.value]));
  const stageCards = STAGE_ORDER.filter((s) => byStage[s] != null).map((s) => ({ stage: s, value: byStage[s] }));
  return (
    <div className="warm-theme space-y-8 rounded-[2rem] bg-[var(--warm-bg)] p-6 sm:p-8">
      <div className="space-y-1">
        <h1 className="warm-heading text-4xl sm:text-5xl">{j.title}</h1>
        <p className="text-sm opacity-70">
          {j.seniority} · {j.location} · {money(j.salaryMinCents)}–{money(j.salaryMaxCents)} · recruiter {j.recruiter.name}
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        {stageCards.map(({ stage, value }) => <StageStatCard key={stage} stage={stage} value={value} />)}
        <StageStatCard stage="not_yet_interviewed" value={j.buckets.notYetInterviewed} />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Requirements</h2>
            <div className="space-y-2">
              {j.skills.map((s: any) => (
                <div key={s.skillId} className="flex items-center justify-between rounded-2xl bg-[var(--warm-tan)] px-5 py-3.5">
                  <span className="text-sm font-medium">{s.skill.name}</span>
                  <div className="flex items-center gap-3">
                    {s.required
                      ? <span className="rounded-full bg-[var(--warm-rust-dark)] px-2.5 py-0.5 text-xs text-[var(--warm-bg)]">Required</span>
                      : <span className="rounded-full bg-[var(--warm-mint)] px-2.5 py-0.5 text-xs text-[var(--warm-mint-ink)]">Nice to have</span>}
                    <span className="w-10 text-right text-xs opacity-60">{s.minYears ? `${s.minYears}y+` : "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Description</h2>
            <div className="rounded-[2rem] bg-[var(--warm-tan)] p-6">
              <WarmDescription text={j.description} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Scored candidates</h2>
            <div className="overflow-hidden rounded-[2rem] border border-[var(--warm-border)]">
              <Table>
                <TableHeader>
                  <TableRow className="border-[var(--warm-border)] hover:bg-transparent">
                    <TableHead className="text-[var(--warm-ink)] opacity-60">Candidate</TableHead>
                    <TableHead className="text-[var(--warm-ink)] opacity-60">Stage</TableHead>
                    <TableHead className="text-[var(--warm-ink)] opacity-60">Round</TableHead>
                    <TableHead className="text-[var(--warm-ink)] opacity-60">Score</TableHead>
                    <TableHead className="text-[var(--warm-ink)] opacity-60">Interviewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranked.map((a: any) => (
                    <TableRow key={a.id} className="border-[var(--warm-border)] hover:bg-[var(--warm-tan)]/40">
                      <TableCell className="font-medium">
                        <Link to="/candidates/$candidateId" params={{ candidateId: a.candidate.id }} className="hover:underline">
                          {a.candidate.firstName} {a.candidate.lastName}
                        </Link>
                      </TableCell>
                      <TableCell><WarmBadge status={a.stage} /></TableCell>
                      <TableCell className="opacity-70 capitalize">{a.interview.round.replace(/_/g, " ")}</TableCell>
                      <TableCell className="tabular-nums">
                        <span className="warm-heading">{a.interview.feedback.overallScore}</span>{" "}
                        <span className="opacity-60">({a.interview.feedback.scoreRaw.toFixed(1)})</span>
                      </TableCell>
                      <TableCell className="opacity-70">{date(a.interview.completedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>

        <section className="lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase opacity-60">
            <Sparkles className="size-3.5" /> Generated questions
          </h2>
          {j.questions.length === 0 ? (
            <p className="text-sm opacity-70">None yet — ask Ask Alex to generate some.</p>
          ) : (
            <div className="space-y-3">
              {j.questions.map((q: any) => (
                <div key={q.id} className="space-y-2 rounded-[1.25rem] border border-[var(--warm-border)] bg-[var(--warm-bg)] p-4">
                  <span className="inline-flex rounded-full bg-[var(--warm-tan)] px-2.5 py-0.5 text-xs capitalize">{q.category.replace(/_/g, " ")}</span>
                  <p className="text-sm">{q.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
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
                  <TableCell><SourceBadge source={c.source} /></TableCell>
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
    <div className="warm-theme space-y-8 rounded-[2rem] bg-[var(--warm-bg)] p-6 sm:p-8">
      <div className="space-y-1">
        <h1 className="warm-heading text-4xl sm:text-5xl">{c.firstName} {c.lastName}</h1>
        <p className="text-sm opacity-70">
          {c.currentTitle} at {c.currentCompany} · {c.yearsExperience}y · {c.location} · {c.source.replace(/_/g, " ")}
          {c.requiresSponsorship ? " · needs sponsorship" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Skills</h2>
            <div className="flex flex-wrap gap-1.5">
              {c.skills.map((s: any) => (
                <span key={s.skillId} className="rounded-full bg-[var(--warm-tan)] px-3 py-1 text-xs">
                  {s.skill.name}{s.years ? ` · ${s.years}y` : ""}
                </span>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Applications</h2>
            <div className="space-y-3">
              {c.applications.map((a: any) => (
                <div key={a.id} className="space-y-2 rounded-[1.5rem] bg-[var(--warm-tan)] p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/jobs/$jobId" params={{ jobId: a.job.id }} className="warm-heading text-lg hover:underline">{a.job.title}</Link>
                    <span className="text-sm opacity-70">— {a.job.company.name}</span>
                    <WarmBadge status={a.stage} />
                  </div>
                  {a.interview ? (
                    <div className="text-sm opacity-80">
                      <div className="capitalize">
                        {a.interview.round.replace(/_/g, " ")} with {a.interview.interviewer.name} · {a.interview.status.replace(/_/g, " ")}
                        {a.interview.feedback && (
                          <>
                            {" "}· score <span className="warm-heading text-base">{a.interview.feedback.overallScore}</span>{" "}
                            ({a.interview.feedback.recommendation.replace(/_/g, " ")}){" "}
                            <span className="rounded-full bg-[var(--warm-bg)] px-2 py-0.5 text-xs">{a.interview.feedback.source}</span>
                          </>
                        )}
                      </div>
                      {a.interview.feedback && (
                        <ul className="mt-2 space-y-1">
                          {a.interview.feedback.competencies.map((k: any) => (
                            <li key={k.id}><span className="font-medium opacity-100 capitalize">{k.competency.replace(/_/g, " ")}</span>: {k.score} — {k.evidence}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : <div className="text-sm opacity-70">No interview yet</div>}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Resume</h2>
            <div className="rounded-[2rem] bg-[var(--warm-tan)] p-6">
              <p className="text-sm text-[var(--warm-body)]">{c.resumeText}</p>
            </div>
          </section>
        </div>

        <section className="lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Recent activity</h2>
          <ul className="space-y-4 border-l border-[var(--warm-border)] pl-4">
            {c.activities.map((a: any) => (
              <li key={a.id} className="relative text-sm">
                <span className="absolute top-1.5 -left-[1.15rem] size-2 rounded-full bg-[var(--warm-rust)]" />
                <div className="opacity-60">{date(a.occurredAt)}</div>
                <div><span className="font-medium capitalize">{a.type.replace(/_/g, " ")}</span>: {a.body}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
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
    <div className="warm-theme space-y-8 rounded-[2rem] bg-[var(--warm-bg)] p-6 sm:p-8">
      <div className="space-y-1">
        <h1 className="warm-heading text-4xl sm:text-5xl capitalize">
          {i.application.candidate.firstName} {i.application.candidate.lastName} — {i.round.replace(/_/g, " ")}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm opacity-70">
          {i.application.job.title} · {i.interviewer.name} · {date(i.completedAt ?? i.scheduledAt)} <WarmBadge status={i.status} />
        </p>
      </div>

      {i.feedback ? (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-6 rounded-[2rem] bg-[var(--warm-tan)] p-6">
            <ScoreRing value={i.feedback.overallScore} />
            <div className="space-y-2">
              <h2 className="warm-heading text-2xl capitalize">{i.feedback.recommendation.replace(/_/g, " ")}</h2>
              <RecommendationScale value={i.feedback.recommendation} />
              <p className="text-xs opacity-60">raw {i.feedback.scoreRaw.toFixed(1)} · scored by {i.feedback.source}</p>
            </div>
          </div>

          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Competencies</h2>
            <div className="space-y-5">
              {i.feedback.competencies.map((c: any) => (
                <CompetencyBar key={c.id} label={c.competency} score={c.score} evidence={c.evidence} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-medium tracking-wide uppercase opacity-60">Notes</h2>
            <div className="space-y-2 rounded-[2rem] bg-[var(--warm-tan)] p-6">
              <p className="text-sm text-[var(--warm-body)]">{i.feedback.notes}</p>
              <p className="text-xs opacity-60">{i.interviewer.name} · {date(i.completedAt ?? i.scheduledAt)}</p>
            </div>
          </section>
        </div>
      ) : <p className="text-sm opacity-70">No feedback — this interview is {i.status.replace(/_/g, " ")}.</p>}
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
