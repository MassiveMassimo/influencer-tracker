import { test, expect } from "bun:test";
import { publishedMessage, blockedMessage } from "./notify";
import { spawnSync } from "node:child_process";

function checkTransport(source: string, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd: import.meta.dir + "/..",
    encoding: "utf8",
    env: {
      ...process.env,
      HERMES_BIN: "",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_CHAT_ID: "",
      ...extraEnv,
    },
    timeout: 5000,
  });
  expect(result.status).toBe(0);
  return result.stdout + result.stderr;
}

test("notify checks Telegram acceptance, with a bounded request", () => {
  const output = checkTransport(
    `
    import { notify } from "./scripts/notify";
    globalThis.fetch = async (_url, options) => {
      if (!options.signal || JSON.parse(options.body).text.length > 4000) throw Error("invalid request");
      return Response.json({ok:true});
    };
    if (!(await notify("long".repeat(2000)))) process.exit(1);
  `,
    { TELEGRAM_BOT_TOKEN: "dummy-secret-token", TELEGRAM_CHAT_ID: "123" },
  );
  expect(output).not.toContain("dummy-secret-token");
});

test("notify falls back after Hermes launch failure", () => {
  checkTransport(
    `
    import { notify } from "./scripts/notify";
    globalThis.fetch = async () => Response.json({ok:true});
    if (!(await notify("hello"))) process.exit(1);
  `,
    {
      HERMES_BIN: "/does-not-exist",
      TELEGRAM_BOT_TOKEN: "dummy-secret-token",
      TELEGRAM_CHAT_ID: "123",
    },
  );
});

test("notify reports transport and API failures without leaking its token", () => {
  const output = checkTransport(
    `
    import { notify } from "./scripts/notify";
    globalThis.fetch = async () => { throw Error("URL contains dummy-secret-token"); };
    if (await notify("hello")) process.exit(1);
    globalThis.fetch = async () => Response.json({ok:false});
    if (await notify("hello")) process.exit(1);
  `,
    { TELEGRAM_BOT_TOKEN: "dummy-secret-token", TELEGRAM_CHAT_ID: "123" },
  );
  expect(output).not.toContain("dummy-secret-token");
});

test("publishedMessage states handle + counts, no SSH review command", () => {
  const m = publishedMessage("theprofinvestor", 4, 2);
  expect(m).toContain("theprofinvestor");
  expect(m).toContain("4");
  expect(m).toContain("2");
  expect(m).not.toContain("calls.review.md"); // no human-review prompt anymore
});

test("blockedMessage names the reason and the manual investigation command", () => {
  const m = blockedMessage("theprofinvestor", "guard: scored 1 << baseline 30");
  expect(m).toContain("theprofinvestor");
  expect(m).toContain("guard: scored 1 << baseline 30");
  expect(m).toContain("resume.ts theprofinvestor"); // operator can re-run after investigating
});

test("blockedMessage: default keeps the X resume command; override replaces it", () => {
  expect(blockedMessage("foo", "why")).toContain("scripts/resume.ts foo");
  const ig = blockedMessage("bar", "session died", "RE-AUTH VIA VNC then re-run");
  expect(ig).toContain("RE-AUTH VIA VNC then re-run");
  expect(ig).not.toContain("scripts/resume.ts");
});
