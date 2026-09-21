import { useEffect, useRef, useState } from "react";
import { X, RotateCcw, SendHorizontal, ChevronRight, ChevronDown, ThumbsUp, ThumbsDown } from "lucide-react";
import { askStream, type CandidateRow } from "../../lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type Question = { text: string; category: string; rationale: string };
type Step = { id: string; tool: string; status: "running" | "done"; rows?: number };
type Msg = { role: "user" | "assistant"; text: string; questions?: Question[]; candidates?: CandidateRow[]; steps?: Step[]; feedback?: "up" | "down" };

// UI-only for now — clicking just sets local state, nothing is sent anywhere.
function FeedbackButtons({ value, onChange }: { value?: "up" | "down"; onChange: (v: "up" | "down" | undefined) => void }) {
  const [popKey, setPopKey] = useState(0);
  const click = (v: "up" | "down") => { onChange(value === v ? undefined : v); setPopKey((k) => k + 1); };
  return (
    <div className="mt-1.5 flex items-center gap-0.5">
      <button
        type="button" onClick={() => click("up")} aria-label="Good response" aria-pressed={value === "up"}
        className={cn("rounded-md p-1 transition-colors hover:bg-muted", value === "up" ? "text-green-600" : "text-muted-foreground")}
      >
        <ThumbsUp key={value === "up" ? popKey : "up"} className={cn("size-3.5", value === "up" && "animate-in zoom-in-50 duration-300")} fill={value === "up" ? "currentColor" : "none"} />
      </button>
      <button
        type="button" onClick={() => click("down")} aria-label="Bad response" aria-pressed={value === "down"}
        className={cn("rounded-md p-1 transition-colors hover:bg-muted", value === "down" ? "text-red-600" : "text-muted-foreground")}
      >
        <ThumbsDown key={value === "down" ? popKey : "down"} className={cn("size-3.5", value === "down" && "animate-in zoom-in-50 duration-300")} fill={value === "down" ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

// Tool results embed app-relative paths as plain text (e.g. "profile: /candidates/abc123") —
// turn those into clickable links instead of leaving them as inert text the user has to copy.
const APP_LINK_RE = /(\/(?:candidates|jobs|interviews)\/[A-Za-z0-9_-]+)/g;
const IS_APP_LINK = /^\/(?:candidates|jobs|interviews)\/[A-Za-z0-9_-]+$/;
// The model occasionally invents a domain in front of a real relative path (no tool ever returns
// one) — strip it before linkifying so a hallucinated "https://app.example.com" never shows up
// next to the correct link.
const FAKE_HOST_RE = /https?:\/\/\S*?(?=\/(?:candidates|jobs|interviews)\/[A-Za-z0-9_-]+)/g;
// The model is told not to re-enumerate candidates in prose once cards render them (below), but
// that's a prompt instruction, not a guarantee — this is the code-level backstop: drop any line
// that names a candidate/job/interview record, since the cards already show it, rather than
// trusting the model to have actually left it out.
const APP_LINK_LINE_RE = /\/(?:candidates|jobs|interviews)\/[A-Za-z0-9_-]+/;
function hideRedundantRecordLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !APP_LINK_LINE_RE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function linkify(text: string) {
  return text.replace(FAKE_HOST_RE, "").split(APP_LINK_RE).map((part, i) =>
    IS_APP_LINK.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">{part}</a>
      : <span key={i}>{part}</span>
  );
}

// What each tool is doing, in plain language — the raw function name means nothing to a user.
const TOOL_LABELS: Record<string, string> = {
  search_entities: "Searching for a match",
  get_entity: "Loading the record",
  query_metrics: "Computing the metric",
  query_entities: "Running a ranked search",
  generate_interview_questions: "Generating interview questions",
};

function ToolSteps({ steps, live }: { steps: Step[]; live: boolean }) {
  const [expanded, setExpanded] = useState(live);
  // Auto-collapse once the turn finishes — the reasoning trail matters while it's happening,
  // not after; the user can still reopen it.
  useEffect(() => { if (!live) setExpanded(false); }, [live]);
  if (steps.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {steps.length} step{steps.length > 1 ? "s" : ""}
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {steps.map((s) => (
            <Badge
              key={s.id}
              variant="outline"
              className={cn(
                "animate-in fade-in-0 zoom-in-95 gap-1.5 text-xs font-normal text-muted-foreground duration-300",
                s.status === "running" && "text-foreground",
              )}
            >
              {s.status === "running" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
              {TOOL_LABELS[s.tool] ?? s.tool}
              {s.rows !== undefined && <span className="opacity-60">· {s.rows} rows</span>}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const BUSY_VERBS = ["Cooking", "Simmering", "Percolating", "Marinating", "Whisking", "Sautéing", "Brewing", "Stewing", "Noodling", "Digesting"];

// Typewriter state machine: type the word out, pause, delete it, move to the next word.
// A single setTimeout chain (not setInterval) so each phase can use its own delay and the
// effect's cleanup always cancels the right pending step.
function TypingDots() {
  const [wordIdx] = useState(() => Math.floor(Math.random() * BUSY_VERBS.length));
  const [step, setStep] = useState(0);
  const [chars, setChars] = useState(0);
  const [phase, setPhase] = useState<"typing" | "pausing" | "deleting">("typing");
  const [cursorOn, setCursorOn] = useState(true);
  const word = BUSY_VERBS[(wordIdx + step) % BUSY_VERBS.length];

  useEffect(() => {
    const delay = phase === "pausing" ? 5000 : phase === "deleting" ? 30 : 70;
    const id = setTimeout(() => {
      if (phase === "typing") {
        if (chars < word.length) setChars((c) => c + 1);
        else setPhase("pausing");
      } else if (phase === "pausing") {
        setPhase("deleting");
      } else if (chars > 0) {
        setChars((c) => c - 1);
      } else {
        setStep((s) => s + 1);
        setPhase("typing");
      }
    }, delay);
    return () => clearTimeout(id);
  }, [phase, chars, word]);

  useEffect(() => {
    const id = setInterval(() => setCursorOn((c) => !c), 500);
    return () => clearInterval(id);
  }, []);

  const [dotCount, setDotCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDotCount((d) => (d + 1) % 4), 400);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-flex items-center text-muted-foreground">
      {word.slice(0, chars)}
      {chars === word.length ? ".".repeat(dotCount) : ""}
      <span className={cn("ml-0.5 inline-block h-[1em] w-px translate-y-[0.1em] bg-current", cursorOn ? "opacity-100" : "opacity-0")} />
    </span>
  );
}

// query_entities' row shape varies by sort mode (job_fit vs strength/score vs a skills filter) —
// this covers each one it actually returns rather than dumping the raw context object.
function CandidateCards({ rows }: { rows: import("../../lib/api").CandidateRow[] }) {
  return (
    <ol className="mt-3 list-none space-y-2">
      {rows.map((r) => {
        const ctx = r.context ?? {};
        const isJobFit = Array.isArray(ctx.missingRequired);
        // job_fit's "why": met required skills earn full/partial credit, missing ones cost credit,
        // nice-to-have adds a little — show all three so the score isn't just a trust-me number.
        const why = isJobFit
          ? [
              (ctx.metRequired as string[])?.length ? `Has: ${(ctx.metRequired as string[]).join(", ")}` : null,
              (ctx.missingRequired as string[])?.length ? `Missing: ${(ctx.missingRequired as string[]).join(", ")}` : null,
              (ctx.niceToHave as string[])?.length ? `Nice-to-have: ${(ctx.niceToHave as string[]).join(", ")}` : null,
            ].filter(Boolean).join(" · ") || "Meets all required skills"
          : null;
        return (
          <li key={r.id}>
            <a
              href={r.url} target="_blank" rel="noopener noreferrer"
              className="block rounded-lg border bg-background p-2.5 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.label}</span>
                {r.sortValue != null && (
                  <Badge variant="outline" className="shrink-0 text-xs font-normal tabular-nums">
                    {isJobFit ? `${r.sortValue}% fit` : typeof ctx.score === "number" ? `score ${ctx.score}` : r.sortValue}
                  </Badge>
                )}
              </div>
              {why ? (
                <p className="mt-1 text-xs text-muted-foreground">{why}</p>
              ) : typeof ctx.stage === "string" ? (
                <p className="mt-1 text-xs text-muted-foreground capitalize">
                  {ctx.stage}{ctx.round ? ` · ${String(ctx.round).replace(/_/g, " ")}` : ""}
                  {ctx.interviewedAt ? ` · ${new Date(ctx.interviewedAt as string).toLocaleDateString()}` : ""}
                </p>
              ) : typeof ctx.currentTitle === "string" ? (
                <p className="mt-1 text-xs text-muted-foreground">{ctx.currentTitle}{ctx.yearsExperience != null ? ` · ${ctx.yearsExperience}y` : ""}</p>
              ) : null}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

export function AskAlexSidebar({ open, onClose, pageContext }:{
  open: boolean; onClose: () => void;
  pageContext?: { route?: string; entityType?: string; entityId?: string; label?: string };
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadId = useRef<string | undefined>(undefined);
  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Guards against a reply still streaming in from a request the user has since abandoned
  // (e.g. hit "New thread" mid-stream) — its onFrame callback would otherwise keep writing
  // into a `messages` array that's already been reset out from under it.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => { if (open) textareaRef.current?.focus(); }, [open]);

  const suggestions = pageContext?.entityType === "job"
    ? ["How is this pipeline doing?", "give me the top 5 job fit candidate","Generate 8 interview questions for this JD"]
    : pageContext?.entityType === "candidate"
      ? ["Summarize this candidate"]
      : ["What's our pass rate by round?", "Which candidates are stuck in screening?"];

  async function send(text: string) {
    if (!text.trim() || busy) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setInput(""); setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      await askStream({ message: text, threadId: threadId.current, pageContext }, (f) => {
        if (f.event === "tool-call") setMessages((m) => {
          if (m.length === 0) return m;
          const copy = [...m]; const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, steps: [...(last.steps ?? []), { id: f.data.id, tool: f.data.tool, status: "running" }] };
          return copy;
        });
        if (f.event === "tool-result") setMessages((m) => {
          if (m.length === 0) return m;
          const copy = [...m]; const last = copy[copy.length - 1];
          const steps = (last.steps ?? []).map((s) => s.id === f.data.id ? { ...s, status: "done" as const, rows: f.data.rows } : s);
          // A turn can call query_entities twice (a small limit for the answer, a larger one just
          // to total the pool/bucket count) — keep the FIRST candidates array, not whichever
          // tool-result happens to arrive last, or the second call's full list silently replaces
          // the top-N cards the model actually meant to show.
          copy[copy.length - 1] = { ...last, steps, questions: f.data.questions ?? last.questions, candidates: last.candidates ?? f.data.candidates };
          return copy;
        });
        if (f.event === "token") setMessages((m) => {
          if (m.length === 0) return m;
          const copy = [...m]; const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, role: "assistant", text: last.text + f.data.t }; return copy;
        });
        if (f.event === "error") setMessages((m) => {
          if (m.length === 0) return m;
          const copy = [...m]; copy[copy.length - 1] = { role: "assistant", text: `Error: ${f.data.message}` }; return copy;
        });
        if (f.event === "done") threadId.current = f.data.threadId;
      }, controller.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") throw err;
    } finally { setBusy(false); }
  }

  return (
    <aside
      inert={!open}
      className={cn(
        "fixed top-14 right-0 bottom-0 z-30 flex w-full max-w-[420px] flex-col border-l bg-sidebar text-sidebar-foreground shadow-2xl",
        "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-in-out",
        open ? "translate-x-0 translate-y-0" : "pointer-events-none translate-x-full translate-y-0",
      )}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <strong className="text-sm font-semibold">Ask me</strong>
        <div className="flex-1" />
        <Button
          size="icon-sm" variant="ghost"
          onClick={() => { abortRef.current?.abort(); setMessages([]); threadId.current = undefined; setBusy(false); }}
          aria-label="New thread" title="New thread"
        >
          <RotateCcw />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      {pageContext?.label && (
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">Viewing: {pageContext.label}</div>
      )}
      <div ref={logRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && suggestions.map((s) => (
          <Button
            key={s} variant="outline" size="sm"
            className="h-auto justify-start text-left whitespace-normal"
            onClick={() => send(s)}
          >
            {s}
          </Button>
        ))}
        {messages.map((m, i) => {
          const live = busy && i === messages.length - 1;
          return (
            <div
              key={i}
              className={cn(
                "text-sm",
                m.role === "user"
                  ? "max-w-[85%] self-end rounded-lg bg-muted px-3 py-2 text-foreground"
                  : "whitespace-pre-wrap text-foreground",
              )}
            >
              {m.text
                ? linkify(m.candidates?.length ? hideRedundantRecordLines(m.text) : m.text)
                : (live ? <TypingDots /> : "")}
              {!live && m.questions && m.questions.length > 0 && (
                <ol className="mt-3 list-none space-y-3">
                  {m.questions.map((q, qi) => (
                    <li key={qi} className="flex gap-2 rounded-lg border bg-background p-2.5">
                      <span className="shrink-0 font-medium text-muted-foreground">{qi + 1}.</span>
                      <div className="space-y-1">
                        <Badge variant="outline" className="text-[11px] font-normal capitalize">{q.category.replace(/_/g, " ")}</Badge>
                        <p>{q.text}</p>
                        <p className="text-xs text-muted-foreground">{q.rationale}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {/* Held back until the turn finishes — showing cards mid-stream, next to the still-
                  running busy indicator, read as broken (finished-looking content next to a
                  "still working" spinner). Show everything together once the answer is ready. */}
              {!live && m.candidates && m.candidates.length > 0 && <CandidateCards rows={m.candidates} />}
              {m.steps && <ToolSteps steps={m.steps} live={live} />}
              {m.role === "assistant" && m.text && !live && (
                <FeedbackButtons
                  value={m.feedback}
                  onChange={(v) => setMessages((ms) => { const copy = [...ms]; copy[i] = { ...copy[i], feedback: v }; return copy; })}
                />
              )}
            </div>
          );
        })}
      </div>
      <Separator />
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2 p-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          placeholder="Ask about candidates, jobs, interviews…"
          autoComplete="off"
          rows={1}
          className="max-h-40 min-h-8 w-full min-w-0 resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        />
        <Button type="submit" size="icon" disabled={busy} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
    </aside>
  );
}
