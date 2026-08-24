import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { fetchCreatorCallsPage } from "./creator-fetch";

export function creatorCallsPageQuery(handle: string, page: number) {
  return queryOptions({
    queryKey: ["creator-calls", handle, page],
    queryFn: () => fetchCreatorCallsPage({ data: { handle, page } }),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
