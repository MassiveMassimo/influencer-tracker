import { spawnSync } from "node:child_process";

export function publishedMessage(handle: string, newCalls: number, newScored: number): string {
  return `✅ ${handle}: published — ${newCalls} new call(s), ${newScored} newly scored.`;
}

export function blockedMessage(handle: string, reason: string, recovery?: string): string {
  const fix =
    recovery ??
    `ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock bun run scripts/resume.ts ${handle}"`;
  return [`🚫 ${handle}: ingest BLOCKED — ${reason}`, `Investigate, then: ${fix}`].join("\n");
}

// True when at least one delivery path is configured. ingest.ts refuses to run blind only
// when this is false.
export function notifyConfigured(): boolean {
  return (
    Boolean(process.env.HERMES_BIN) ||
    Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
  );
}

export async function notify(text: string): Promise<boolean> {
  text = text.slice(0, 4000);
  // Prefer the Hermes gateway when HERMES_BIN points at its CLI — reuses Hermes's own Telegram
  // credentials and its configured home channel (HERMES_TARGET, default "telegram"), so no bot
  // token / chat id need live in this repo's .env. Falls back to the direct bot API.
  const hermes = process.env.HERMES_BIN;
  if (hermes) {
    const target = process.env.HERMES_TARGET ?? "telegram";
    const r = spawnSync(hermes, ["send", "--to", target, "--quiet", text], {
      encoding: "utf8",
      timeout: 20_000,
    });
    if (r.status === 0) return true;
    console.warn(`notify (hermes) failed: status=${r.status}, code=${r.error?.name ?? "exit"}`);
  }
  const token = process.env.TELEGRAM_BOT_TOKEN,
    chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.warn("notify: no delivery path configured (HERMES_BIN or TELEGRAM_*)");
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const result = (await r.json()) as { ok?: boolean };
    if (r.ok && result.ok === true) return true;
    console.warn(`notify failed: HTTP ${r.status}`);
  } catch {
    // Fetch errors can include the bot token in their URL. Never log the raw error.
    console.warn("notify failed: Telegram transport or response error");
  }
  return false;
}
