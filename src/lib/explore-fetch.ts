import { createServerFn } from "@tanstack/react-start";
import { fetchCallsIndex, listCreators } from "./data";
import { EXPLORE_VISIBLE_STEP, buildExploreInitialData } from "./explore-data";

export const fetchExploreOverview = createServerFn({ method: "GET" }).handler(async () => {
  const [calls, creators] = await Promise.all([fetchCallsIndex(), listCreators()]);
  const initial = buildExploreInitialData(calls);
  const generatedAt = creators.reduce<string>(
    (max, creator) => (creator.generatedAt > max ? creator.generatedAt : max),
    "",
  );

  return {
    ...initial,
    generatedAt,
    indexVersion: generatedAt || "unversioned",
    initialTickers: initial.calls.slice(0, EXPLORE_VISIBLE_STEP).map((call) => call.ticker),
    creators: creators.map((creator) => ({
      handle: creator.handle,
      name: creator.name,
    })),
  };
});
