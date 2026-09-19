// Plain-English data dictionary for the agent — what entities and fields exist,
// so it stops guessing at names outside metrics.ts. Not a metric definition
// (that's metrics.ts) and not the DDL (that's prisma/schema.prisma) — this is
// the middle layer: what a human would tell a new hire about the data.
//
// Kept hand-written, not generated from Prisma's DMMF, because the value here
// is the prose ("stage order is applied → screening → interviewing → offer →
// hired/rejected"), not the column list — DMMF would give names and types but
// not that. See DEVLOG.md 2026-09-17 for why this is a separate file instead
// of inline in ask-alex.ts.
export const SCHEMA_GUIDE = `Data model:
- Company / Job: a Job belongs to one Company, has a roleFamily (software_engineer,
  data_engineer, product_manager, designer), seniority, and status (open, on_hold, closed).
- Candidate: one record per person. location is free text (e.g. "San Francisco, CA") —
  matched only against the fixed location filter list, not geocoded. currentTitle is the
  candidate's current job title at their current employer — distinct from a Job's title
  (the role they applied to). Filter on it with filters.currentTitle, never filters.jobTitle.
- Application: links a Candidate to a Job. stage moves forward through
  applied → screening → interviewing → offer → hired, or rejected at any point.
  One Application per (candidate, job) pair. ownerId is the recruiter working that
  application — filter on it with filters.recruiterId if you already have their id, or
  filters.recruiterName ("Marc") to have it resolved server-side. This is the recruiter
  owning the application, not necessarily the same person as the Job's own recruiter.
- Interview: at most one per Application (one interview round in this demo). Has a
  round (screen, technical, hiring_manager, onsite) and status (scheduled, completed,
  no_show, cancelled).
- Feedback: exactly one per completed Interview. overallScore (0-100, shown) and
  scoreRaw (unrounded, used for ranking) may differ slightly. recommendation is
  strong_no, no, yes, or strong_yes.
- Offer: at most one per Application, created after the offer stage is reached.`;

// ---- staleness check: warns if prisma/schema.prisma changed since this guide was written ----
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regenerate after a real schema change: `shasum -a 256 prisma/schema.prisma`,
// update this constant, and re-check SCHEMA_GUIDE above still matches.
const SCHEMA_HASH_WHEN_WRITTEN = "c4187b3ae54254e1cfc6c53f33ac5c5ac966bef2eea1ec5d38ddbcf237791ad6";

try {
  const schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
  const currentHash = createHash("sha256").update(readFileSync(schemaPath)).digest("hex");
  if (currentHash !== SCHEMA_HASH_WHEN_WRITTEN) {
    console.warn(
      "[schema-guide] prisma/schema.prisma changed since schema-guide.ts was last reviewed. " +
      "Update SCHEMA_GUIDE and SCHEMA_HASH_WHEN_WRITTEN in server/src/semantic/schema-guide.ts."
    );
  }
} catch {
  // ponytail: best-effort check, never block startup over it.
}
