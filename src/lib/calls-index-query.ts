import { queryOptions } from "@tanstack/react-query";
import { fetchCallsIndex } from "./data";

export function callsIndexQuery(version: string) {
  return queryOptions({
    queryKey: ["calls-index", version],
    queryFn: () => fetchCallsIndex(version),
    staleTime: 60 * 60 * 1000,
  });
}
