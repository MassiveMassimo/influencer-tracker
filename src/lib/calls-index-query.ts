import { queryOptions } from "@tanstack/react-query";
import { fetchCallsIndex } from "./data";

export function callsIndexQuery() {
  return queryOptions({
    queryKey: ["calls-index"],
    queryFn: fetchCallsIndex,
    staleTime: 60 * 60 * 1000,
  });
}
