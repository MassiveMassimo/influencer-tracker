import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readImageCached } from "./vision";

// Fake OpenAI-compatible client: counts calls, returns a fixed hint reply.
function fakeClient(reply: unknown) {
  let calls = 0;
  const client = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
  return {
    get calls() { return calls; },
    fn: (...args: Parameters<typeof client>) => { calls++; return client(...args); },
  };
}

let dir: string;
let img: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hintcache-"));
  img = join(dir, "frame.jpg");
  await writeFile(img, Buffer.from([0xff, 0xd8, 0xff])); // dummy jpeg bytes
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("cache miss: calls the model once and writes the sidecar", async () => {
  const c = fakeClient({ ticker: "AAA", price: 12 });
  const hint = await readImageCached("vision-model", img, c.fn);
  expect(hint).toEqual({ ticker: "AAA", price: 12 });
  expect(c.calls).toBe(1);
  expect(existsSync(`${img}.hint.json`)).toBe(true);
  expect(JSON.parse(await readFile(`${img}.hint.json`, "utf8"))).toEqual({ ticker: "AAA", price: 12 });
});

test("cache hit: reuses the sidecar, never calls the model", async () => {
  await writeFile(`${img}.hint.json`, JSON.stringify({ ticker: "BBB", price: 7 }));
  const c = fakeClient({ ticker: "AAA", price: 12 }); // would differ if called
  const hint = await readImageCached("vision-model", img, c.fn);
  expect(hint).toEqual({ ticker: "BBB", price: 7 });
  expect(c.calls).toBe(0);
});

test("corrupt cache: falls through to a fresh OCR", async () => {
  await writeFile(`${img}.hint.json`, "{not json");
  const c = fakeClient({ ticker: "AAA", price: 12 });
  const hint = await readImageCached("vision-model", img, c.fn);
  expect(hint).toEqual({ ticker: "AAA", price: 12 });
  expect(c.calls).toBe(1);
});
