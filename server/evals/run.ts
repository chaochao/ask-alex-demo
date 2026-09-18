import { mastra } from "../src/mastra/index.js";
import { db } from "../src/semantic/queries.js";
import cases from "./cases.json" with { type: "json" };

type Case = {
  id: string; question?: string; turns?: string[]; pageContextEntity?: string;
  expect: { tools?: string[]; metric?: string; behavior?: string; answerContains?: string[];
    numberFromSql?: string; tolerance?: number; countEquals?: number;
    statesRankingRule?: boolean; statesDateRange?: boolean };
};

const CLARIFY = /which|what (date|range|job|role|company)|could you|do you mean/i;
const DECLINE = /don'?t (have|track)|not (available|something i)|can'?t answer|available metrics/i;
const REFUSE  = /can'?t|cannot|won'?t|not able|read-only/i;

// The API call intermittently 404s (confirmed transient — same call succeeds on retry with
// no code change). Retry a couple of times with backoff before giving up.
async function generateWithRetry(agent: any, messages: unknown, attempts = 3): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    try { return await agent.generate(messages); }
    catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function main() {
  // Filter to one case: `npm run eval -- <case-id>` (or `tsx evals/run.ts <case-id>`).
  const only = process.argv[2];
  const selected = only ? (cases as Case[]).filter((c) => c.id === only) : (cases as Case[]);
  if (only && selected.length === 0) {
    console.error(`No case "${only}". Available: ${(cases as Case[]).map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  const agent = mastra.getAgent("askAlex");
  const model = process.env.MODEL ?? "openai/gpt-4.1-mini";
  const run = await db.evalRun.create({ data: { model, passed: 0, failed: 0 } });
  const job = await db.job.findFirst({ where: { title: { contains: "Staff Backend" } } });
  let passed = 0, failed = 0;

  for (const c of selected) {
    const started = Date.now();
    const failures: string[] = [];
    const prefix = c.pageContextEntity === "job" && job ? `The user is currently viewing job ${job.id}.\n\n` : "";
    const turns = c.turns ?? [c.question!];

    // Multi-round: replay the scripted conversation, grading only the final answer.
    // Stateless — no Memory/threadId, just the accumulated message array (agent.generate
    // accepts string | string[] | CoreMessage[]).
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    let answer = "";
    const used: string[] = [];
    const toolResults: { toolName: string; result: any }[] = [];
    for (let i = 0; i < turns.length; i++) {
      messages.push({ role: "user", content: i === 0 ? prefix + turns[i] : turns[i] });
      const res: any = await generateWithRetry(agent, messages);
      answer = res.text ?? "";
      used.push(...(res.steps ?? []).flatMap((s: any) => (s.toolCalls ?? []).map((t: any) => t.toolName)));
      toolResults.push(...(res.steps ?? []).flatMap((s: any) => s.toolResults ?? []));
      messages.push({ role: "assistant", content: answer });
    }
    const latencyMs = Date.now() - started;

    for (const t of c.expect.tools ?? []) if (!used.includes(t)) failures.push(`expected tool ${t}, used [${used.join(", ")}]`);
    if (c.expect.tools?.length === 0 && used.length) failures.push(`expected no tool calls, used [${used.join(", ")}]`);
    for (const s of c.expect.answerContains ?? []) if (!answer.toLowerCase().includes(s.toLowerCase())) failures.push(`answer missing "${s}"`);
    if (c.expect.behavior === "asks_clarifying_question" && !CLARIFY.test(answer)) failures.push("no clarifying question");
    if (c.expect.behavior === "declines_and_lists_available_metrics" && !DECLINE.test(answer)) failures.push("did not decline the missing metric");
    if (c.expect.behavior === "refuses" && !REFUSE.test(answer)) failures.push("did not refuse");
    if (c.expect.statesRankingRule && !/stage|score|rank/i.test(answer)) failures.push("did not state the ranking rule");
    if (c.expect.statesDateRange && !/\d{4}-\d{2}-\d{2}|last 7 days|sep|week/i.test(answer)) failures.push("did not state the date range");
    if (c.expect.numberFromSql) {
      const truth = Number((await db.$queryRawUnsafe<any[]>(c.expect.numberFromSql))[0]?.v ?? NaN);
      const nums = [...answer.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      const hit = nums.some((n) => Math.abs(n - truth) <= (c.expect.tolerance ?? 0.05));
      if (!hit) failures.push(`answer has no number within ${c.expect.tolerance ?? 0.05} of ${truth} (got ${nums.join(", ")})`);
    }
    if (c.expect.countEquals) {
      // Count the generate_interview_questions tool's actual result, not the prose reply —
      // the agent is instructed to summarize in one line, not enumerate each question, so a
      // regex over `answer` counts bullet-shaped lines that aren't there anymore (confirmed via
      // a captured failing run: 6 real questions, reply said "- Count: 6 questions", 1 bullet).
      const genResult = toolResults.find((r) => r.toolName === "generate_interview_questions");
      const n = genResult?.result?.questions?.length ?? 0;
      if (!genResult) failures.push(`expected ${c.expect.countEquals} questions, generate_interview_questions was not called`);
      else if (n !== c.expect.countEquals) failures.push(`expected ${c.expect.countEquals} questions, tool returned ${n}`);
    }

    const ok = failures.length === 0;
    ok ? passed++ : failed++;
    await db.evalResult.create({ data: { runId: run.id, caseId: c.id, passed: ok,
      failures: JSON.stringify(failures), answer, toolsUsed: JSON.stringify(used), latencyMs } });
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(24)} ${latencyMs}ms  ${failures.join(" · ")}`);
    if (!ok) console.log(`      answer: ${answer.replace(/\n+/g, " ")}`);
  }

  await db.evalRun.update({ where: { id: run.id }, data: { passed, failed } });
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
main();
