import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60 * 1000 },
    },
  });

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // The desktop content panel scrolls in a nested viewport (rounded corners stay
    // pinned), not the window. Register it so fresh navigations reset it to top;
    // its data-scroll-restoration-id (set in __root) handles back/forward restore.
    scrollToTopSelectors: ["#main-scroll [data-slot=scroll-area-viewport]"],
    defaultPreload: "intent",
    // Non-zero so an `intent` (hover) preload reuses recently-fetched loader data
    // instead of re-pulling the ~1.3MB creator dataset on every hover. Actual
    // navigations still respect the query staleTime (5min) above.
    defaultPreloadStaleTime: 30_000,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
