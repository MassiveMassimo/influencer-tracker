// Runtime data is bundled into the server build, not read from disk at request
// time. data/creators is gitignored except index.json and */dataset.json (see
// .gitignore); import.meta.glob compiles those into the bundle so they ship to
// serverless without depending on process.cwd()/fs file tracing. The dataset is
// frozen-for-reproducibility (see CLAUDE.md), so co-versioning it with the code
// is correct — publishing new data is a redeploy.

export interface IndexEntry {
  handle: string;
  name: string;
  totalCalls: number;
  firstCalls: number;
  hitRate3m: number;
  hitRate3mN: number;
  avgExcess3m: number;
  generatedAt: string;
  avatar?: string;
}

// index.json is small and needed by both the creator list and the OG cards —
// load it eagerly so it's a plain in-memory value.
const indexGlob = import.meta.glob<IndexEntry[]>("/data/creators/index.json", {
  eager: true,
  import: "default",
});

// Per-creator datasets are multi-MB — load lazily so a request only pulls the one
// handle it needs (each becomes its own code-split chunk). ?raw keeps them as
// strings: JSON.parse at runtime is faster than evaluating a multi-MB module.
const datasetGlob = import.meta.glob("/data/creators/*/dataset.json", {
  query: "?raw",
  import: "default",
});

export function loadIndex(): IndexEntry[] {
  return Object.values(indexGlob)[0] ?? [];
}

// Returns the raw dataset.json text for a handle, or null if unknown.
export async function loadDatasetRaw(handle: string): Promise<string | null> {
  const loader = datasetGlob[`/data/creators/${handle}/dataset.json`];
  if (!loader) return null;
  return (await loader()) as string;
}
