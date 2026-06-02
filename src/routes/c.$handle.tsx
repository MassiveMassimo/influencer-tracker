import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout for /c/$handle and its children (overview index + ticker pages).
export const Route = createFileRoute("/c/$handle")({
  component: () => <Outlet />,
});
