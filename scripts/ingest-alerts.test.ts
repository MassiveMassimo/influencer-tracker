import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IngestAlerts, failureReason, failureWasHandled, sharedFailure } from "./ingest-alerts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(delivered = true) {
  const dir = await mkdtemp(join(tmpdir(), "ingest-alerts-test-"));
  dirs.push(dir);
  const messages: string[] = [];
  const send = async (message: string) => {
    messages.push(message);
    return delivered;
  };
  return { dir, messages, send };
}

test("same outage is quiet across process restarts, with a daily reminder", async () => {
  const { dir, messages, send } = await fixture();
  let now = 1000;
  const first = new IngestAlerts("influencer-ingest-ig.service", dir, send, () => now);
  await first.block(first.unit, "IG session rejected");
  const next = new IngestAlerts(first.unit, dir, send, () => now);
  await next.load();
  await next.block(first.unit, "IG session rejected");
  expect(messages).toHaveLength(1);
  now += 86_400_000;
  await next.block(first.unit, "IG session rejected");
  expect(messages).toHaveLength(2);
  await next.block(first.unit, "IG_PROXY=relay egress check failed");
  expect(messages).toHaveLength(3);
});

test("backstop suppression requires the exact completed invocation", async () => {
  const { dir, send } = await fixture();
  const alerts = new IngestAlerts("influencer-ingest.service", dir, send);
  await alerts.block(alerts.unit, "X client transaction failed");
  expect(await failureWasHandled(alerts.unit, "run-1", dir)).toBe(false);
  await alerts.complete("run-1");
  expect(await failureWasHandled(alerts.unit, "run-1", dir)).toBe(true);
  expect(await failureWasHandled(alerts.unit, "run-2", dir)).toBe(false);
  expect(await failureWasHandled(alerts.unit, "", dir)).toBe(false);
});

test("failed delivery is retried and never suppresses the independent backstop", async () => {
  const { dir, messages, send } = await fixture(false);
  const alerts = new IngestAlerts("influencer-ingest.service", dir, send);
  await alerts.block(alerts.unit, "outage");
  await alerts.block(alerts.unit, "outage");
  expect(messages).toHaveLength(2);
  expect(await alerts.complete("failed-send")).toBe(false);
  expect(await failureWasHandled(alerts.unit, "failed-send", dir)).toBe(false);
});

test("recovery resets outage suppression; partial success does not", async () => {
  const { dir, messages, send } = await fixture();
  const alerts = new IngestAlerts("influencer-ingest.service", dir, send);
  await alerts.block(alerts.unit, "outage");
  await alerts.published("creator", "published");
  await alerts.block(alerts.unit, "outage");
  expect(messages).toHaveLength(2);
  await alerts.complete("recovered", true);
  await alerts.block(alerts.unit, "outage");
  expect(messages).toHaveLength(3);
});

test("corrupt state cannot suppress an alert", async () => {
  const { dir, send, messages } = await fixture();
  const alerts = new IngestAlerts("influencer-ingest.service", dir, send);
  await writeFile(join(dir, `${alerts.unit}.json`), "bad json");
  await alerts.load();
  await alerts.block(alerts.unit, "outage");
  expect(messages).toHaveLength(1);
});

test("pipeline errors retain their cause and remove configured secrets", () => {
  process.env.TEST_ALERT_TOKEN = "private-token-for-test";
  try {
    const error = {
      stderr: Buffer.from(
        'error: IG_PROXY=socks5://user:pass@relay failed private-token-for-test\nerror: script "pipeline" exited with code 1',
      ),
      message: "ShellError: 1",
    };
    const reason = failureReason(error);
    expect(reason).toContain("IG_PROXY=");
    expect(reason).not.toContain("user:pass");
    expect(reason).not.toContain("private-token-for-test");
    expect(sharedFailure(reason)).toBe(true);
    expect(sharedFailure("guard: scored count shrank")).toBe(false);
  } finally {
    delete process.env.TEST_ALERT_TOKEN;
  }
});
