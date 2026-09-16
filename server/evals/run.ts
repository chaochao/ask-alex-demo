import { mastra } from "../src/mastra/index.js";
import { db } from "../src/semantic/queries.js";
import cases from "./cases.json" with { type: "json" };

type Case = {
  id: string; question: string; pageContextEntity?: string;
  expect: { tools?: string[]; metric?: string; behavior?: string; answerContains?: string[];
    numberFromSql?: string; tolerance?: number; countEquals?: number;
    statesRankingRule?: boolean; statesDateRange?: boolean };
};

const CLARIFY = /which|what (date|range|job|role|company)|could you|do you mean/i;
const DECLINE = /don'?t (have|track)|not (available|something i)|can'?t answer|available metrics/i;
const REFUSE  = /can'?t|cannot|won'?t|not able|read-only/i;

async function main() {
  const agent = mastra.getAgent("askAlex");
  const model = process.env.MODEL ?? "openai/gpt-4.1-mini";
  const run = await db.evalRun.create({ data: { model, passed: 0, failed: 0 } });
  const job = await db.job.findFirst({ where: { title: { contains: "Staff Backend" } } });
  let passed = 0, failed = 0;

  for (const c of cases as Case[]) {
    const started = Date.now();
    const failures: string[] = [];
    const prefix = c.pageContextEntity === "job" && job ? `The user is currently viewing job ${job.id}.\n\n` : "";
    const res: any = await agent.generate(prefix + c.question);
    const answer: string = res.text ?? "";
    const used: string[] = (res.steps ?? []).flatMap((s: any) => (s.toolCalls ?? []).map((t: any) => t.toolName));
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
      const n = (answer.match(/^\s*(\d+[.)]|[-*])\s+/gm) ?? []).length;
      if (n !== c.expect.countEquals) failures.push(`expected ${c.expect.countEquals} questions, counted ${n}`);
    }

    const ok = failures.length === 0;
    ok ? passed++ : failed++;
    await db.evalResult.create({ data: { runId: run.id, caseId: c.id, passed: ok,
      failures: JSON.stringify(failures), answer, toolsUsed: JSON.stringify(used), latencyMs } });
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(24)} ${latencyMs}ms  ${failures.join(" · ")}`);
  }

  await db.evalRun.update({ where: { id: run.id }, data: { passed, failed } });
  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
main();
