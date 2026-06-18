import { createFileRoute, redirect } from "@tanstack/react-router";

// Exact /t/$symbol → cross-creator view. Index route (sibling of $creator) so
// this redirect does NOT cascade onto /t/$symbol/$creator the way a parent
// layout's beforeLoad would.
export const Route = createFileRoute("/t/$symbol/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/t/$symbol/$creator",
      params: { symbol: params.symbol.toUpperCase(), creator: "all" },
      replace: true,
    });
  },
});
