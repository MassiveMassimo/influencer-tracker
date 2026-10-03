import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(platform: "x" | "ig", failPush = false, pendingOnly = false) {
  const dir = await mkdtemp(join(tmpdir(), "ingest-wrapper-test-"));
  dirs.push(dir);
  await mkdir(join(dir, "scripts"));
  await mkdir(join(dir, "bin"));
  for (const name of [
    "ingest.ts",
    "ingest-ig.ts",
    "ingest-alerts.ts",
    "notify.ts",
    "shortcodes.ts",
  ]) {
    await copyFile(join(import.meta.dir, name), join(dir, "scripts", name));
  }
  for (const handle of ["first", "second"]) {
    const creator = join(dir, "data/creators", handle);
    await mkdir(creator, { recursive: true });
    await writeFile(join(creator, "dataset.json"), JSON.stringify({ creator: { name: handle } }));
    await writeFile(
      join(creator, "reel-calls.json"),
      JSON.stringify([{ shortcode: platform === "x" ? "12345" : "AbCd" }]),
    );
  }
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { "pipeline:x": "bun run stage.ts", pipeline: "bun run stage.ts" } }),
  );
  await writeFile(
    join(dir, "stage.ts"),
    `
    import { appendFile } from "node:fs/promises";
    await appendFile("attempts.log", "stage\\n");
    if (process.env.FAILURE_CAUSE) throw Error(process.env.FAILURE_CAUSE);
  `,
  );
  await writeFile(join(dir, "scripts/resume.ts"), "console.log('scored')");
  await writeFile(join(dir, "bin/hermes"), '#!/bin/sh\nprintf "%s\\n" "$*" >> messages.log\n', {
    mode: 0o700,
  });
  await writeFile(
    join(dir, "bin/git"),
    `#!/bin/sh
printf "%s\\n" "$*" >> git.log
case "$1" in
  status) ${pendingOnly ? ":" : 'echo " M data/creators/first/dataset.json"'} ;;
  rev-list) test -z "$FAILURE_CAUSE" && echo 1 || echo 0 ;;
  push) exit ${failPush ? "1" : "0"} ;;
esac
`,
    { mode: 0o700 },
  );
  return {
    dir,
    run(cause = "", invocation = "run-1") {
      return spawnSync(
        process.execPath,
        ["run", `scripts/ingest${platform === "ig" ? "-ig" : ""}.ts`],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            PATH: `${join(dir, "bin")}:${process.env.PATH}`,
            HERMES_BIN: join(dir, "bin/hermes"),
            TELEGRAM_BOT_TOKEN: "",
            TELEGRAM_CHAT_ID: "",
            INGEST_HANDLES: "first,second",
            INGEST_HANDLES_IG: "first,second",
            FAILURE_CAUSE: cause,
            INVOCATION_ID: invocation,
          },
        },
      );
    },
  };
}

for (const platform of ["x", "ig"] as const) {
  test(`${platform}: shared failure stops after one creator and stays quiet on the next run`, async () => {
    const f = await fixture(platform);
    const cause =
      platform === "x"
        ? "X client transaction failed (ONDEMAND_FILE_URL_RESOLUTION_ERROR)"
        : "IG session rejected (expired/challenged)";
    expect(f.run(cause).status).toBe(1);
    expect((await readFile(join(f.dir, "attempts.log"), "utf8")).trim()).toBe("stage");
    const first = await readFile(join(f.dir, "messages.log"), "utf8");
    expect(first).toContain(cause);
    expect(first).not.toContain("published");
    expect(f.run(cause, "run-2").status).toBe(1);
    expect(await readFile(join(f.dir, "messages.log"), "utf8")).toBe(first);
    expect(await readFile(join(f.dir, "git.log"), "utf8")).not.toMatch(/add|commit|push/);
  });

  test(`${platform}: failed push never sends a published message`, async () => {
    const f = await fixture(platform, true);
    expect(f.run().status).toBe(1);
    const messages = await readFile(join(f.dir, "messages.log"), "utf8");
    expect(messages).toContain("push failed");
    expect(messages).not.toContain("published");
  });

  test(`${platform}: pending commit is pushed even when no new diff exists`, async () => {
    const f = await fixture(platform, false, true);
    expect(f.run().status).toBe(0);
    const git = await readFile(join(f.dir, "git.log"), "utf8");
    expect(git).toContain("push origin main");
    expect(git).not.toContain("commit");
    expect(await readFile(join(f.dir, "messages.log"), "utf8")).toContain("published");
  });
}
