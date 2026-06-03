import { createServerFn } from "@tanstack/react-start";
import { DatasetSchema } from "./schema";
import type { Dataset } from "./types";
import { loadIndex, loadDatasetRaw } from "./dataset-source";

export const listCreators = createServerFn({ method: "GET" }).handler(
  async () => loadIndex(),
);

export const getDataset = createServerFn({ method: "GET" })
  .inputValidator((handle: string) => handle)
  .handler(async ({ data: handle }): Promise<Dataset> => {
    const raw = await loadDatasetRaw(handle);
    if (!raw) throw new Error(`Unknown creator: ${handle}`);
    return DatasetSchema.parse(JSON.parse(raw));
  });
