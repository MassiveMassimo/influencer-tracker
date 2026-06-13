import { useState } from "react";
import { REPORT_REASONS } from "#/lib/report-reasons.ts";

// Operator-facing reason keys mapped to user-facing labels. The keys are the closed
// REPORT_REASONS enum (the POST contract); labels never round-trip to the server.
const LABELS: Record<string, string> = {
  "wrong-ticker": "Wrong ticker",
  "not-a-buy": "Not a buy call",
  "wrong-direction": "Wrong direction",
  "not-a-call": "Not a stock call",
  other: "Something else",
};

// Crowdsourced "report incorrect" control. Client-safe: imports only react + the enum,
// never the route/db modules, so neon/drizzle stay out of the client bundle. Best-effort
// POST — the UI thanks the user immediately and dedupes per shortcode via localStorage.
export function ReportButton({ handle, shortcode }: { handle: string; shortcode: string }) {
  const key = `reported:${shortcode}`;
  const already = typeof localStorage !== "undefined" && localStorage.getItem(key) === "1";
  const [state, setState] = useState<"idle" | "open" | "sent">(already ? "sent" : "idle");

  async function send(reason: string) {
    setState("sent");
    try {
      localStorage.setItem(key, "1");
    } catch {
      // ignore
    }
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, shortcode, reason }),
      });
    } catch {
      // best-effort; UI already thanked the user
    }
  }

  if (state === "sent")
    return <p className="text-[11px] text-muted-foreground">Thanks — flagged for review.</p>;

  if (state === "idle")
    return (
      <button
        type="button"
        onClick={() => setState("open")}
        className="text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
      >
        Report incorrect
      </button>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted-foreground">Why?</span>
      {REPORT_REASONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => send(r)}
          className="rounded-md border border-border/60 px-2 py-1 text-[11px] transition-colors hover:bg-muted"
        >
          {LABELS[r] ?? r}
        </button>
      ))}
    </div>
  );
}
