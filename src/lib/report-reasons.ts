// Closed enum of report reasons. Lives here (not in db/reports.ts) so both the server
// (db/reports.ts, the /api/report endpoint) and the client UI can import it without
// pulling drizzle/neon into the client bundle. Reasons are operator-only (never displayed).
export const REPORT_REASONS = ["wrong-ticker", "not-a-buy", "wrong-direction", "not-a-call", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
