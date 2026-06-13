export function publishedMessage(handle: string, newCalls: number, newScored: number): string {
  return `✅ ${handle}: published — ${newCalls} new call(s), ${newScored} newly scored.`;
}

export function blockedMessage(handle: string, reason: string): string {
  return [
    `🚫 ${handle}: ingest BLOCKED — ${reason}`,
    `Investigate, then: ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock bun run scripts/resume.ts ${handle}"`,
  ].join("\n");
}

export async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.warn("notify: TELEGRAM_* unset"); return; }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
  if (!r.ok) console.warn(`notify failed: ${r.status}`);
}
