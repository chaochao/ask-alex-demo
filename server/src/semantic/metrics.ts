// The only place a metric is defined. Tools reference these names; nothing else invents a number.
export const METRICS = {
  applications_count:  { label: "Applications",            unit: "count",
    definition: "applications created, counted by applied date" },
  interviews_completed:{ label: "Interviews completed",    unit: "count",
    definition: "interviews with status = completed" },
  avg_score:           { label: "Average interview score", unit: "score_0_100",
    definition: "mean of scoreRaw over completed, scored interviews" },
  pass_rate:           { label: "Pass rate",               unit: "pct",
    definition: "completed interviews recommended yes or strong_yes ÷ completed interviews" },
  offer_rate:          { label: "Offer rate",              unit: "pct",
    definition: "applications that reached an offer ÷ applications" },
  offer_acceptance_rate:{ label: "Offer acceptance rate",  unit: "pct",
    definition: "accepted offers ÷ offers with a response" },
  time_to_first_interview_days: { label: "Time to first interview", unit: "days",
    definition: "mean days from applied date to first completed interview" },
  funnel_by_stage:     { label: "Applications by stage",   unit: "count",
    definition: "active applications grouped by current stage" },
  competency_avg:      { label: "Average competency score", unit: "score_0_100",
    definition: "mean competency score across scored interviews" },
} as const;

export type MetricName = keyof typeof METRICS;
export const METRIC_NAMES = Object.keys(METRICS) as [MetricName, ...MetricName[]];
export const DIMENSIONS = ["job","company","stage","source","round","interviewer","competency","month"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

// Business time only. Day boundaries are UTC in the demo — stated, not implied.
export const TIMEZONE = "UTC";
