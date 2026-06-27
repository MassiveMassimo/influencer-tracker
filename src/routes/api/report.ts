import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { makeDb } from "../../../db/client";
import { insertReport } from "../../../db/reports";
import { REPORT_REASONS } from "#/lib/report-reasons.ts";

// Public write path for crowdsourced "report incorrect" flags. Connects through the
// INSERT-only `report` role (DATABASE_URL_REPORT) so a compromised endpoint can't read the
// ledger. The FK on call_reports→calls turns a report for a non-existent call into a 404.
// The reason enum is closed (no free text) so there is no PII / stored-XSS surface.

export interface ReportInput {
  handle: string;
  shortcode: string;
  ticker: string;
  reason: string;
}

// Validate the public body: closed reason enum, present + length-bounded ids. Returns the
// clean input or null (→ 400). No free text, so no PII / stored-XSS surface. `ticker`
// identifies which call within a (possibly multi-stock) post is being flagged.
export function validateReportBody(body: unknown): ReportInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const { handle, shortcode, ticker, reason } = b;
  if (typeof handle !== "string" || handle.length < 1 || handle.length > 64) return null;
  if (typeof shortcode !== "string" || shortcode.length < 1 || shortcode.length > 64) return null;
  if (typeof ticker !== "string" || ticker.length < 1 || ticker.length > 32) return null;
  if (typeof reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(reason))
    return null;
  return { handle, shortcode, ticker, reason };
}

// Non-reversible, salted hash of the client IP — operational dedupe only, never stored raw
// or displayed. Empty/unknown IP still hashes (all such reporters share one bucket).
export function reporterHashOf(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

// First hop in x-forwarded-for is the client per Vercel's edge; fall back to x-real-ip.
// Never logged or stored raw — only fed to reporterHashOf.
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0]!.trim() : "") || req.headers.get("x-real-ip") || "";
}

export const Route = createFileRoute("/api/report")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const url = process.env.DATABASE_URL_REPORT;
        const salt = process.env.REPORT_SALT;
        // Misconfigured: refuse rather than write through the wrong role or an unsalted hash.
        if (!url || !salt) {
          return Response.json({ error: "reporting not configured" }, { status: 503 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad body" }, { status: 400 });
        }

        const input = validateReportBody(body);
        if (!input) {
          return Response.json({ error: "invalid report" }, { status: 400 });
        }

        try {
          await insertReport(makeDb(url), {
            ...input,
            reporterHash: reporterHashOf(clientIp(request), salt),
            createdAt: new Date().toISOString().slice(0, 10),
          });
        } catch (err) {
          // FK violation → the reported call does not exist. Surface as 404, not 500.
          if (/foreign key/i.test(String((err as Error)?.message ?? err))) {
            return Response.json({ error: "unknown call" }, { status: 404 });
          }
          console.error("[report] insert failed", err);
          return Response.json({ error: "could not record report" }, { status: 500 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
