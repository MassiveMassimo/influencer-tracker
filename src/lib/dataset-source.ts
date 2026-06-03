// index.json is small and hit on every page, so it's bundled into the server
// build via import.meta.glob (no fs/process.cwd() at runtime). The large per-creator
// datasets are NOT bundled — they ship as static CDN assets and are fetched by
// fetchDataset() in data.ts (see public/datasets/<handle>.json, written at build).

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

const indexGlob = import.meta.glob<IndexEntry[]>("/data/creators/index.json", {
  eager: true,
  import: "default",
});

export function loadIndex(): IndexEntry[] {
  return Object.values(indexGlob)[0] ?? [];
}
