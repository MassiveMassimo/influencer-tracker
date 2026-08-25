import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isSafeAssetKey } from "./api-serve";
import { buildCreatorOverview, type CreatorCallsPage, type CreatorOverview } from "./creator-data";
import { fetchDataset, readFromDbOrNull } from "./data";
import { DatasetSchema } from "./schema";
import { siteUrl } from "../og/site";

const HandleSchema = z.string().min(1).max(100).refine(isSafeAssetKey, "unsafe creator handle");

const CreatorInputSchema = z.object({ handle: HandleSchema });
const CreatorPageInputSchema = z.object({
  handle: HandleSchema,
  page: z.number().int().positive(),
});
const CreatorCallsPageSchema = z.object({
  calls: DatasetSchema.shape.calls,
  currentPage: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  totalCalls: z.number().int().nonnegative(),
  posts: z.record(z.string(), z.array(z.object({ ticker: z.string(), company: z.string() }))),
});

async function fetchStaticCreatorCallsPage(
  handle: string,
  page: number,
): Promise<CreatorCallsPage> {
  const path = `/dataset-pages/${handle}/${page}.json`;
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`creator page ${handle}/${page}: ${response.status}`);
  return CreatorCallsPageSchema.parse(await response.json());
}

export const fetchCreatorOverview = createServerFn({ method: "GET" })
  .validator(CreatorInputSchema)
  .handler(async ({ data }): Promise<CreatorOverview> => {
    return buildCreatorOverview(await fetchDataset(data.handle));
  });

export const fetchCreatorCallsPage = createServerFn({ method: "GET" })
  .validator(CreatorPageInputSchema)
  .handler(async ({ data }): Promise<CreatorCallsPage> => {
    if (import.meta.env.SSR) {
      const result = await readFromDbOrNull(
        `fetchCreatorCallsPage ${data.handle} page ${data.page}`,
        async () => {
          const [{ getDb }, { readCreatorCallsPage }] = await Promise.all([
            import("../../db/client"),
            import("./db-read"),
          ]);
          return readCreatorCallsPage(getDb(), data.handle, data.page);
        },
      );
      if (result != null) return result;
    }
    return fetchStaticCreatorCallsPage(data.handle, data.page);
  });
