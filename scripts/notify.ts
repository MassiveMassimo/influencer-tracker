import { spawnSync } from "node:child_process";

export function publishedMessage(handle: string, newCalls: number, newScored: number): string {
  return `✅ ${handle}: published — ${newCalls} new call(s), ${newScored} newly scored.`;
}

export function blockedMessage(handle: string, reason: string): string {
  return [
    `🚫 ${handle}: ingest BLOCKED — ${reason}`,
    `Investigate, then: ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock bun run scripts/resume.ts ${handle}"`,
  ].join("\n");
}

// True when at least one delivery path is configured. ingest.ts refuses to run blind only
// when this is false.
export function notifyConfigured(): boolean {
  return Boolean(process.env.HERMES_BIN) || Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function notify(text: string): Promise<void> {
  // Prefer the Hermes gateway when HERMES_BIN points at its CLI — reuses Hermes's own Telegram
  // credentials and its configured home channel (HERMES_TARGET, default "telegram"), so no bot
  // token / chat id need live in this repo's .env. Falls back to the direct bot API.
  const hermes = process.env.HERMES_BIN;
  if (hermes) {
    const target = process.env.HERMES_TARGET ?? "telegram";
    const r = spawnSync(hermes, ["send", "--to", target, "--quiet", text], { encoding: "utf8" });
    if (r.status !== 0) console.warn(`notify (hermes) failed: status=${r.status} ${r.stderr ?? r.error ?? ""}`);
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.warn("notify: no delivery path configured (HERMES_BIN or TELEGRAM_*)"); return; }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
  if (!r.ok) console.warn(`notify failed: ${r.status}`);
}
