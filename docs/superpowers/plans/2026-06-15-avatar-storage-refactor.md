# Avatar Storage Refactor Implementation Plan

> Extension of the `dynamic-og-images` branch (coupled: the creator OG route renders `<img src={avatar}>` through satori, which needs inline bytes — so changing avatar storage forces a change to the OG render path). Execute task-by-task in the worktree `/Users/imo/Documents/GitHub/influencer-tracker-dynamic-og`. NEVER on main.

**Goal:** Store avatars as real image files (`data/avatars/<h>.<ext>`, committed) served from the CDN (`/avatars/<h>.<ext>`), with `index.json`/DB holding the **path** not a base64 data URI — shrinking the bundled `index.json` (~54KB→~5KB) and making avatars separately cacheable. The OG renderer resolves the path back to bytes at render time (the only consumer that needs bytes).

**Decision:** preserve source image format (ext from content-type/mime); NO transcode, no `sharp` (negligible gain on ~40–120px thumbnails; the win is base64-out-of-bundle).

**Robustness:** every avatar consumer must accept BOTH a path (`/avatars/...`) and a legacy data URI (`data:...`), so the change is safe before the prod DB is migrated. `<img src>` accepts both natively; the OG resolver branches on the prefix.

**Conventions:** worktree only; tests `bun test`; `#/`=`src/`; pin any `Intl`/locale formatting to `en-US` (SSR/client determinism — avoid reintroducing the React #418 hydration mismatch). Avatar code introduces no locale formatting.

---

### Task A: `AVATARS` dir constant

**File:** Modify `pipeline/config.ts`

- [ ] Add after the existing `DATA` const:

```ts
export const AVATARS = join(ROOT, "data", "avatars");
```

- [ ] `cd <worktree> && bunx tsc --noEmit` → exit 0.
- [ ] Commit: `git add pipeline/config.ts && git commit -m "feat(avatar): data/avatars dir constant"`

---

### Task B: `saveAvatar` writes a binary file + returns a path

**File:** Modify `pipeline/avatar.ts`

Rewrite `saveAvatar` to write raw bytes to `data/avatars/<handle>.<ext>` (ext from content-type) and return the public path `/avatars/<handle>.<ext>` (was: base64 data URI to `data/creators/<h>/avatar.txt`). Keep best-effort/null-on-failure.

- [ ] Replace the file body with:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AVATARS } from "./config";

// Platform-agnostic profile-pic storage. Each scraper (IG/X/TikTok/...) resolves its
// own avatar URL and hands it here; the downstream contract is uniform: a committed
// image file data/avatars/<h>.<ext> served at /avatars/<h>.<ext>, referenced by path
// from index.json/DB (NOT inlined). The bytes are captured at scrape time because CDN
// avatar URLs are signed and expire. Best-effort: skipped (null) on any failure.
// Returns the public path it wrote, or null.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function saveAvatar(
  handle: string,
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const ext = EXT_BY_MIME[mime] ?? "jpg";
    const bytes = Buffer.from(await res.arrayBuffer());
    await mkdir(AVATARS, { recursive: true });
    await writeFile(join(AVATARS, `${handle}.${ext}`), bytes);
    return `/avatars/${handle}.${ext}`;
  } catch {
    return null; /* avatar is optional */
  }
}
```

- [ ] `bunx tsc --noEmit` → exit 0.
- [ ] Commit: `git add pipeline/avatar.ts && git commit -m "feat(avatar): saveAvatar writes binary file, returns CDN path"`

---

### Task C: `score.ts` writes the avatar PATH into index.json

**File:** Modify `pipeline/score.ts` (`updateIndex`, ~line 124-134)

Replace the `avatar.txt` read with a lookup of the committed image file in `data/avatars/`, storing the path.

- [ ] Add import at top (with the other config imports): ensure `AVATARS` is imported from `./config` (the file already imports `creatorDir`/`DATA` from `./config` — add `AVATARS`).
- [ ] Replace:

```ts
let avatar: string | undefined;
try {
  avatar = (await readFile(join(creatorDir(handle), "avatar.txt"), "utf8")).trim();
} catch {}
```

with:

```ts
// Avatar is a committed image file data/avatars/<h>.<ext>; store its public path
// (not bytes). Find whichever extension saveAvatar wrote.
let avatar: string | undefined;
try {
  const file = readdirSync(AVATARS).find((f) => f.startsWith(`${handle}.`));
  if (file) avatar = `/avatars/${file}`;
} catch {}
```

- [ ] Ensure `readdirSync` is imported from `node:fs` at the top of `score.ts` (add to the existing `node:fs` import; if score.ts uses `node:fs/promises` only, add `import { readdirSync } from "node:fs";`). Verify the existing import style first.
- [ ] `bunx tsc --noEmit` → exit 0.
- [ ] Commit: `git add pipeline/score.ts && git commit -m "feat(avatar): index.json stores avatar path, not data URI"`

---

### Task D: one-time migration (decode existing base64 → files + path)

**Files:** Create `scripts/migrate-avatars.ts`; it rewrites `data/creators/index.json` and writes `data/avatars/*`.

- [ ] Create `scripts/migrate-avatars.ts`:

```ts
// One-time: convert inline base64 data-URI avatars in data/creators/index.json into
// committed image files data/avatars/<h>.<ext>, and rewrite the index `avatar` field
// to the public path /avatars/<h>.<ext>. Idempotent: entries already holding a path
// (or with no avatar) are left untouched. No re-scrape needed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../pipeline/config";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const INDEX = join(ROOT, "data", "creators", "index.json");
const AVATARS = join(ROOT, "data", "avatars");
mkdirSync(AVATARS, { recursive: true });

const idx = JSON.parse(readFileSync(INDEX, "utf8")) as { handle: string; avatar?: string }[];
let migrated = 0;
for (const e of idx) {
  const a = e.avatar;
  if (!a || !a.startsWith("data:")) continue; // already a path or absent
  const m = /^data:([^;]+);base64,(.*)$/s.exec(a);
  if (!m) {
    console.warn(`skip ${e.handle}: unparseable data URI`);
    continue;
  }
  const ext = EXT_BY_MIME[m[1].trim()] ?? "jpg";
  writeFileSync(join(AVATARS, `${e.handle}.${ext}`), Buffer.from(m[2], "base64"));
  e.avatar = `/avatars/${e.handle}.${ext}`;
  migrated++;
}
writeFileSync(INDEX, JSON.stringify(idx, null, 2) + "\n");
console.log(`migrated ${migrated} avatar(s) -> data/avatars/; index.json rewritten`);
```

- [ ] RUN it: `cd <worktree> && bun run scripts/migrate-avatars.ts`. Expected: `migrated N avatar(s)`; `data/avatars/<h>.<ext>` files appear; `index.json` `avatar` fields now `/avatars/...`.
- [ ] Verify shrink: `wc -c data/creators/index.json` should be ~5KB (was ~54KB). `ls -la data/avatars/`.
- [ ] Commit (include the generated avatars + rewritten index + the script):

```bash
git add scripts/migrate-avatars.ts data/avatars data/creators/index.json && git commit -m "chore(avatar): migrate index.json base64 avatars to committed files"
```

---

### Task E: prebuild copies `data/avatars/` → `public/avatars/`; gitignore the public copy

**Files:** Modify `scripts/prebuild.ts`, `.gitignore`

- [ ] In `scripts/prebuild.ts`, add path constants beside `PRICES_SRC`/`PRICES_DST`:

```ts
const AVATARS_SRC = join(ROOT, "data", "avatars");
const AVATARS_DST = join(PUB, "avatars");
```

- [ ] Beside the `rmSync(PRICES_DST, …)` line, add: `rmSync(AVATARS_DST, { recursive: true, force: true });`
- [ ] After the prices-copy `if (existsSync(PRICES_SRC)) { … }` block, add the mirror:

```ts
if (existsSync(AVATARS_SRC)) {
  mkdirSync(AVATARS_DST, { recursive: true });
  cpSync(AVATARS_SRC, AVATARS_DST, { recursive: true });
}
```

- [ ] In `.gitignore`, beside `public/prices/` (line ~37) add: `public/avatars/`
- [ ] Smoke-run: `cd <worktree> && bun run scripts/prebuild.ts` → completes; `ls public/avatars/` shows the migrated files.
- [ ] `bunx tsc --noEmit` → exit 0.
- [ ] Commit: `git add scripts/prebuild.ts .gitignore && git commit -m "feat(avatar): prebuild copies data/avatars to public/avatars (CDN)"`

---

### Task F: OG creator route resolves avatar path → inline bytes

**File:** Modify `src/routes/api/og/c.$handle.$rev.tsx`

`entry.avatar` is now a path (or, pre-prod-DB-migration, still a legacy data URI). satori needs inline bytes, so resolve it before calling `renderOgPng`. Keep the concern inside the OG route.

- [ ] Add a resolver helper inside the route file (module scope, above `Route`):

```ts
// satori needs inline image bytes — a /avatars/<h>.<ext> CDN path won't resolve inside
// the renderer. Resolve to a data URI at request time. Robust to the legacy inline
// data-URI form (passed through), so it works before/after the prod DB avatar migration.
async function resolveAvatar(avatar: string | undefined): Promise<string | undefined> {
  if (!avatar) return undefined;
  if (avatar.startsWith("data:")) return avatar; // legacy inline form
  if (!avatar.startsWith("/")) return undefined;
  try {
    const { siteUrl } = await import("#/og/site.ts");
    const res = await fetch(siteUrl(avatar));
    if (!res.ok) return undefined;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch {
    return undefined;
  }
}
```

- [ ] In the handler, where the creator card is built, replace `avatar: entry.avatar,` with a resolved value. Since the render call is currently a ternary expression, compute the avatar first. Change the block to:

```ts
const { renderOgPng } = await import("#/og/render.tsx");
const avatar = entry ? await resolveAvatar(entry.avatar) : undefined;
const png = await renderOgPng(
  entry
    ? {
        kind: "creator",
        theme: "dark",
        name: entry.name,
        handle,
        avatar,
        excess3m: entry.avgExcess3m,
        totalCalls: entry.totalCalls,
      }
    : { kind: "home", theme: "dark" },
);
```

(Read the current handler first and adapt precisely; only the avatar resolution changes.)

- [ ] `bunx tsc --noEmit` → exit 0.
- [ ] Commit: `git add src/routes/api/og/c.\$handle.\$rev.tsx && git commit -m "feat(avatar): OG creator route inlines avatar bytes from path"`

---

### Task G: docs — update CLAUDE.md "Profile pics" + note prod DB cutover

**Files:** Modify `CLAUDE.md`

- [ ] Rewrite the **Profile pics** section to describe the new model: `saveAvatar` writes a committed image file `data/avatars/<h>.<ext>` (served at `/avatars/<h>.<ext>`, prebuild copies → `public/avatars/`, gitignored like `public/prices/`); `score.ts` records the **path** in `index.json` (not a data URI); `db creators.avatar` holds the path (text, no schema change); `<img src>` consumers (WorkspaceRail/explore/home/ticker) use the path directly; the **OG creator route** resolves the path back to inline bytes (`resolveAvatar`) because satori needs bytes. Note `data/avatars/` is committed (build-time source for `public/avatars/`), mirroring `data/prices/`.
- [ ] Add a **prod cutover** note: after merge+deploy, run `bun run db:sync` (= `db:backfill && db:materialize`) on prod so the DB-served `avatar` becomes the path (until then, the DB still serves the legacy data URI — which still renders, and the OG resolver passes it through, so nothing breaks). If the `guard-no-shrink`/backfill count-guard trips on a drifted creator, use an owner `UPDATE creators SET avatar=… WHERE handle=…`.
- [ ] `git add CLAUDE.md && git commit -m "docs(avatar): document file-based avatar storage + prod cutover"`

---

### Task H: full verification

- [ ] `cd <worktree> && bun test` → green (183+ pass, 0 fail).
- [ ] `bunx tsc --noEmit` → exit 0.
- [ ] `bun run build` → exit 0.
- [ ] Confirm `wc -c data/creators/index.json` ~5KB; `ls public/avatars/` populated after build.
- [ ] **Dev smoke** (a non-3000 port; the creator OG route inlines the avatar, and a page renders the `<img>` path):

```bash
cd <worktree>
HANDLE=$(bun -e "console.log(require('./data/creators/index.json')[0].handle)")
bunx vite dev --port 4327 >/tmp/av-dev.log 2>&1 &
DEV=$!
for i in $(seq 1 20); do sleep 2; curl -s -o /dev/null http://localhost:4327/ && break; done
# OG creator card still shows the avatar (renders a PNG)
curl -s -o /tmp/av-og.png -w "OG: %{http_code} %{content_type}\n" "http://localhost:4327/api/og/c/$HANDLE/rev"
echo "OG MAGIC: $(xxd -l4 -p /tmp/av-og.png)"
# the creator page HTML references the /avatars/ path (or a data URI) in an <img>
curl -s "http://localhost:4327/c/$HANDLE" | grep -o '/avatars/[^"]*' | head -1
kill $DEV 2>/dev/null || true
```

Expected: OG `200 image/png`, MAGIC `89504e47`; the creator page references `/avatars/<h>.<ext>`.

- [ ] Confirm no new React #418 hydration warning in the dev log (`grep -i "418\|hydrat" /tmp/av-dev.log` → empty). The avatar change adds no locale formatting.
- [ ] No commit unless fixups were needed.

---

## Notes

- **DB**: schema unchanged (`creators.avatar` text holds a path now). Prod `db:sync` is a post-deploy cutover step (Task G) — not run in the worktree (no `.env`/creds here). Pre-migration, DB serves legacy data URIs which still render and pass through the OG resolver.
- **Consumers** (`WorkspaceRail.tsx`, `explore.tsx`, `index.tsx`, `t.$symbol.tsx`, `db-read.ts`, `call-index.ts`, `dataset-source.ts`) need no logic change — `<img src>` and the `avatar` field accept a path or a data URI identically.
- **render.tsx** unchanged: `OgCard.avatar` stays "inline bytes/data URI"; the route does the path→bytes resolution.
