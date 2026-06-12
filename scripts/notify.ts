export function reviewMessage(handle: string, newCalls: number, newScored: number): string {
  return [
    `📋 ${handle}: ${newCalls} new calls (${newScored} newly scored).`,
    `Review: ssh ubuntu@imos-vm 'cat ~/influencer-tracker/data/creators/${handle}/calls.review.md'`,
    `Resume: ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock bun run scripts/resume.ts ${handle}"`,
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
