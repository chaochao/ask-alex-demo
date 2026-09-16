export const api = async <T,>(path: string): Promise<T> => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};

export type Frame =
  | { event: "tool-call"; data: { tool: string; args: unknown } }
  | { event: "tool-result"; data: { tool: string; rows?: number } }
  | { event: "token"; data: { t: string } }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: { threadId: string } };

/** POST + SSE. EventSource can't POST, so we read the stream by hand. */
export async function askStream(
  body: { message: string; threadId?: string; pageContext?: Record<string, unknown> },
  onFrame: (f: Frame) => void,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/ask", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const event = /^event:\s*(.+)$/m.exec(chunk)?.[1]?.trim();
      const data = /^data:\s*(.+)$/m.exec(chunk)?.[1];
      if (event && data) onFrame({ event, data: JSON.parse(data) } as Frame);
    }
  }
}
