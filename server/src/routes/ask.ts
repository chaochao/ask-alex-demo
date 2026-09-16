import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mastra } from "../mastra/index.js";
import { db } from "../semantic/queries.js";

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
    await db.chatMessage.create({ data: { threadId: thread!.id, role: "user", content: message } });

    const context = pageContext?.entityId
      ? `The user is currently viewing ${pageContext.entityType} ${pageContext.entityId}. Resolve "this role"/"this candidate" to it.\n\n`
      : "";

    const agent = mastra.getAgent("askAlex");
    const toolCalls: unknown[] = [];
    let text = "";

    try {
      const result = await agent.stream(context + message, {
        abortSignal: c.req.raw.signal,
        onStepFinish: async (step: any) => {
          for (const call of step?.toolCalls ?? []) {
            toolCalls.push({ tool: call.toolName, args: call.args });
            await stream.writeSSE({ event: "tool-call", data: JSON.stringify({ tool: call.toolName, args: call.args }) });
          }
          for (const r of step?.toolResults ?? []) {
            const rows = Array.isArray((r as any).result?.rows) ? (r as any).result.rows.length : undefined;
            await stream.writeSSE({ event: "tool-result", data: JSON.stringify({ tool: (r as any).toolName, rows }) });
          }
        },
      } as any);

      for await (const chunk of (result as any).textStream) {
        text += chunk;
        await stream.writeSSE({ event: "token", data: JSON.stringify({ t: chunk }) });
      }
    } catch (err) {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ message: (err as Error).message }) });
    }

    await db.chatMessage.create({ data: { threadId: thread!.id, role: "assistant", content: text, toolCalls: JSON.stringify(toolCalls) } });
    await stream.writeSSE({ event: "done", data: JSON.stringify({ threadId: thread!.id }) });
  }));

ask.get("/api/threads/:id", async (c) =>
  c.json(await db.chatThread.findUnique({ where: { id: c.req.param("id") }, include: { messages: { orderBy: { createdAt: "asc" } } } })));
