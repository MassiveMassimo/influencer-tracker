import { test, expect, afterEach } from "bun:test";

// The revalidate seam is server-only and imports no DB/Vite modules, so no module stubs are
// needed (unlike routes.test.ts). The handler is reached structurally, mirroring how the
// Task 2 tests reach the GET handler.

type PostHandler = (ctx: { request: Request }) => Promise<Response>;
function getPostHandler(route: unknown): PostHandler {
  return (route as { options: { server: { handlers: { POST: PostHandler } } } }).options.server
    .handlers.POST;
}

const realToken = process.env.REVALIDATE_TOKEN;
afterEach(() => {
  if (realToken === undefined) delete process.env.REVALIDATE_TOKEN;
  else process.env.REVALIDATE_TOKEN = realToken;
});

function post(opts: { token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return new Request("https://example.com/api/revalidate", {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

test("POST /api/revalidate → 503 when REVALIDATE_TOKEN is unset", async () => {
  delete process.env.REVALIDATE_TOKEN;
  const { Route } = await import("./revalidate");
  const res = await getPostHandler(Route)({ request: post({ token: "anything" }) });
  expect(res.status).toBe(503);
});

test("POST /api/revalidate → 401 when token is missing", async () => {
  process.env.REVALIDATE_TOKEN = "s3cret-token-value";
  const { Route } = await import("./revalidate");
  const res = await getPostHandler(Route)({ request: post() });
  expect(res.status).toBe(401);
});

test("POST /api/revalidate → 401 when token is wrong", async () => {
  process.env.REVALIDATE_TOKEN = "s3cret-token-value";
  const { Route } = await import("./revalidate");
  const res = await getPostHandler(Route)({ request: post({ token: "wrong-token-value" }) });
  expect(res.status).toBe(401);
});

test("POST /api/revalidate → 200 with purge summary on a valid token", async () => {
  process.env.REVALIDATE_TOKEN = "s3cret-token-value";
  const { Route } = await import("./revalidate");
  const res = await getPostHandler(Route)({
    request: post({
      token: "s3cret-token-value",
      body: { paths: ["/c/kevvonz", "/api/calls-index"], tags: ["calls"] },
    }),
  });
  expect(res.status).toBe(200);
  // purge is a logging no-op in 3a (no network); the summary reflects what was requested.
  expect(await res.json()).toMatchObject({ ok: true, purged: { paths: 2, tags: 1 } });
});
