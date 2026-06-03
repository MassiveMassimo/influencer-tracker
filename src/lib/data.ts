import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatasetSchema } from "./schema";
import type { Dataset } from "./types";

const DATA = join(process.cwd(), "data", "creators");

export const listCreators = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      return JSON.parse(
        await readFile(join(DATA, "index.json"), "utf8"),
      ) as {
        handle: string;
        name: string;
        totalCalls: number;
        avgExcess3m: number;
        generatedAt: string;
        avatar?: string;
      }[];
    } catch {
      return [];
    }
  },
);

export const getDataset = createServerFn({ method: "GET" })
  .inputValidator((handle: string) => handle)
  .handler(async ({ data: handle }): Promise<Dataset> => {
    const raw = JSON.parse(
      await readFile(join(DATA, handle, "dataset.json"), "utf8"),
    );
    return DatasetSchema.parse(raw);
  });
