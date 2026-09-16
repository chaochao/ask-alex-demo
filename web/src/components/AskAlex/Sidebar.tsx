import { useEffect, useRef, useState } from "react";
import { X, RotateCcw, SendHorizontal } from "lucide-react";
import { askStream } from "../../lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type Msg = { role: "user" | "assistant"; text: string };
type Tool = { tool: string; rows?: number };

export function AskAlexSidebar({ open, onClose, pageContext }:{
  open: boolean; onClose: () => void;
  pageContext?: { route?: string; entityType?: string; entityId?: string; label?: string };
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadId = useRef<string | undefined>(undefined);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [messages, tools]);
  if (!open) return null;

  const suggestions = pageContext?.entityType === "job"
    ? ["How is this pipeline doing?", "Top candidates for this role", "Generate 8 interview questions for this JD"]
    : pageContext?.entityType === "candidate"
      ? ["Summarize this candidate", "Why did they score that way?"]
      : ["What's our pass rate by round?", "Which candidates are stuck in screening?"];

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput(""); setTools([]); setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      await askStream({ message: text, threadId: threadId.current, pageContext }, (f) => {
        if (f.event === "tool-call") setTools((t) => [...t, { tool: f.data.tool }]);
        if (f.event === "tool-result") setTools((t) => [...t, { tool: f.data.tool, rows: f.data.rows }]);
        if (f.event === "token") setMessages((m) => {
          const copy = [...m]; copy[copy.length - 1] = { role: "assistant", text: copy[copy.length - 1].text + f.data.t }; return copy;
        });
        if (f.event === "error") setMessages((m) => {
          const copy = [...m]; copy[copy.length - 1] = { role: "assistant", text: `Error: ${f.data.message}` }; return copy;
        });
        if (f.event === "done") threadId.current = f.data.threadId;
      });
    } finally { setBusy(false); }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex h-svh w-full max-w-[420px] flex-col border-l bg-sidebar text-sidebar-foreground shadow-2xl lg:sticky lg:top-0 lg:shadow-none">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <strong className="text-sm font-semibold">Ask Alex</strong>
        <div className="flex-1" />
        <Button
          size="icon-sm" variant="ghost"
          onClick={() => { setMessages([]); setTools([]); threadId.current = undefined; }}
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
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "text-sm",
              m.role === "user"
                ? "max-w-[85%] self-end rounded-lg bg-muted px-3 py-2 text-foreground"
                : "whitespace-pre-wrap text-foreground",
            )}
          >
            {m.text || (busy && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
        {tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t, i) => (
              <Badge key={i} variant="outline" className="font-mono text-[11px] font-normal text-muted-foreground">
                {t.tool}{t.rows !== undefined ? ` · ${t.rows} rows` : ""}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <Separator />
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 p-3">
        <Input
          value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about candidates, jobs, interviews…"
        />
        <Button type="submit" size="icon" disabled={busy} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
    </aside>
  );
}
