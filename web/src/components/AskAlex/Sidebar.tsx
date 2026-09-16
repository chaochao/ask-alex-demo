import { useEffect, useRef, useState } from "react";
import { askStream } from "../../lib/api";

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
    <aside className="sidebar">
      <header>
        <strong>Ask Alex</strong>
        <span className="spacer" style={{ flex: 1 }} />
        <button onClick={() => { setMessages([]); setTools([]); threadId.current = undefined; }}>New</button>
        <button onClick={onClose}>Close</button>
      </header>
      {pageContext?.label && <div className="ctx" style={{ padding: "6px 14px" }}>Viewing: {pageContext.label}</div>}
      <div className="log" ref={logRef}>
        {messages.length === 0 && suggestions.map((s) => (
          <button key={s} style={{ textAlign: "left" }} onClick={() => send(s)}>{s}</button>
        ))}
        {messages.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.text || (busy && i === messages.length - 1 ? "…" : "")}</div>)}
        {tools.map((t, i) => (
          <span key={i} className="toolchip">{t.tool}{t.rows !== undefined ? ` · ${t.rows} rows` : ""}</span>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about candidates, jobs, interviews…" />
        <button type="submit" disabled={busy}>Ask</button>
      </form>
    </aside>
  );
}
