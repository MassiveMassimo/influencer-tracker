import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isSafeAssetKey } from "./api-serve";
import {
  buildCreatorCallsPage,
  buildCreatorOverview,
  type CreatorCallsPage,
  type CreatorOverview,
} from "./creator-data";
import { fetchDataset } from "./data";

const HandleSchema = z.string().min(1).max(100).refine(isSafeAssetKey, "unsafe creator handle");

const CreatorInputSchema = z.object({ handle: HandleSchema });
const CreatorPageInputSchema = z.object({
  handle: HandleSchema,
  page: z.number().int().positive(),
});

export const fetchCreatorOverview = createServerFn({ method: "GET" })
  .validator(CreatorInputSchema)
  .handler(async ({ data }): Promise<CreatorOverview> => {
    return buildCreatorOverview(await fetchDataset(data.handle));
  });

export const fetchCreatorCallsPage = createServerFn({ method: "GET" })
  .validator(CreatorPageInputSchema)
  .handler(async ({ data }): Promise<CreatorCallsPage> => {
    return buildCreatorCallsPage(await fetchDataset(data.handle), data.page);
  });
