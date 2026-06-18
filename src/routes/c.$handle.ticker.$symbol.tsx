import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy per-creator ticker URL → ticker-primary page with the creator selected.
// This route is a leaf (no children), so the beforeLoad redirect is safe.
export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/t/$symbol/$creator",
      params: { symbol: params.symbol.toUpperCase(), creator: params.handle },
      replace: true,
    });
  },
});
