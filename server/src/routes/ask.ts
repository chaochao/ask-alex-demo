import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mastra } from "../mastra/index.js";
import { db } from "../semantic/queries.js";
import { toolTimings } from "../mastra/tools/index.js";

export const ask = new Hono();

/** POST /api/ask — SSE frames: tool-call, tool-result, token, done */
ask.post("/api/ask", (c) =>
  streamSSE(c, async (stream) => {
    const { message, threadId, pageContext } = await c.req.json<{
      message: string; threadId?: string;
      pageContext?: { route?: string; entityType?: string; entityId?: string };
    }>();

    const thread = threadId
      ? await db.chatThread.findUnique({ where: { id: threadId } })
      : await db.chatThread.create({ data: { title: message.slice(0, 60) } });

    // Prior turns, fetched before inserting this one — otherwise the model has no memory of
    // its own previous question and treats a follow-up like "all time" as a cold, unrelated message.
    const priorMessages = threadId
      ? (await db.chatMessage.findMany({ where: { threadId: thread!.id }, orderBy: { createdAt: "asc" } }))
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      : [];
    await db.chatMessage.create({ data: { threadId: thread!.id, role: "user", content: message } });

    const context = pageContext?.entityId
      ? `Page context: entityType=${pageContext.entityType} entityId=${pageContext.entityId}. ` +
        `Resolve "this job"/"this candidate"/"this interview" (or an implicit subject) to it, per the page-context rule in your instructions.\n\n`
      : "";
    const messages = [...priorMessages, { role: "user" as const, content: context + message }];

    // Debug log: the whole request, and every tool call/result, to stdout — set ASK_ALEX_DEBUG=0 to quiet it.
    const debug = process.env.ASK_ALEX_DEBUG !== "0";
    const log = (...args: unknown[]) => { if (debug) console.log(`[ask ${thread!.id}]`, ...args); };
    log("message:", message, "pageContext:", pageContext);
    log("messages sent to agent:", JSON.stringify(messages));

    const agent = mastra.getAgent("askAlex");
    const toolCalls: unknown[] = [];
    let text = "";

    // Same call/tool/answer split as the eval log: call = model thinking before its first tool
    // call, tool = span from first tool call start to last tool call end, answer = time after the
    // last tool result to the finished reply. toolTimings is the shared timing array every tool's
    // execute() writes to (server/src/mastra/tools/index.ts) — read only, this request's slice.
    const turnStart = Date.now();
    const timingsBefore = toolTimings.length;

    try {
      const result = await agent.stream(messages, {
        abortSignal: c.req.raw.signal,
        onStepFinish: async (step: any) => {
          for (const call of step?.toolCalls ?? []) {
            toolCalls.push({ tool: call.toolName, args: call.args });
            log("tool-call", call.toolName, JSON.stringify(call.args));
            await stream.writeSSE({ event: "tool-call", data: JSON.stringify({ id: call.toolCallId, tool: call.toolName, args: call.args }) });
          }
          for (const r of step?.toolResults ?? []) {
            const rows = Array.isArray((r as any).result?.rows) ? (r as any).result.rows.length : undefined;
            // Forwarded as-is so the sidebar can render the question list/candidate ranking itself
            // instead of relying on the model to reformat it readably in prose.
            const questions = (r as any).toolName === "generate_interview_questions" ? (r as any).result?.questions : undefined;
            const candidates = (r as any).toolName === "query_entities" ? (r as any).result?.rows : undefined;
            log("tool-result", (r as any).toolName, JSON.stringify((r as any).result).slice(0, 1000));
            await stream.writeSSE({ event: "tool-result", data: JSON.stringify({ id: (r as any).toolCallId, tool: (r as any).toolName, rows, questions, candidates }) });
          }
        },
      } as any);

      for await (const chunk of (result as any).textStream) {
        text += chunk;
        await stream.writeSSE({ event: "token", data: JSON.stringify({ t: chunk }) });
      }
      const turnEnd = Date.now();
      const calls = toolTimings.slice(timingsBefore);
      let callMs: number, toolMs: number, answerMs: number;
      if (calls.length) {
        const firstStart = Math.min(...calls.map((t) => t.start));
        const lastEnd = Math.max(...calls.map((t) => t.end));
        callMs = firstStart - turnStart; toolMs = lastEnd - firstStart; answerMs = turnEnd - lastEnd;
      } else {
        callMs = 0; toolMs = 0; answerMs = turnEnd - turnStart;
      }
      log("timing", JSON.stringify({ callMs, toolMs, answerMs, totalMs: turnEnd - turnStart }));
      // Safety net: a tool-call loop can exhaust its steps without ever emitting text.
      // Never send an empty response — the underlying loop is a separate, open bug (see DEVLOG).
      if (!text.trim()) {
        log("EMPTY final text — tool loop did not converge");
        text = "I wasn't able to put together an answer for that — could you narrow it to a specific job, company, or date range and ask again?";
        await stream.writeSSE({ event: "token", data: JSON.stringify({ t: text }) });
      }
      log("final answer:", text);
    } catch (err) {
      log("ERROR:", (err as Error).message);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ message: (err as Error).message }) });
    }

    await db.chatMessage.create({ data: { threadId: thread!.id, role: "assistant", content: text, toolCalls: JSON.stringify(toolCalls) } });
    await stream.writeSSE({ event: "done", data: JSON.stringify({ threadId: thread!.id }) });
  }));

ask.get("/api/threads/:id", async (c) =>
  c.json(await db.chatThread.findUnique({ where: { id: c.req.param("id") }, include: { messages: { orderBy: { createdAt: "asc" } } } })));
