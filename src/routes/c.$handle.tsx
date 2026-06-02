import { createFileRoute } from "@tanstack/react-router";
import { getDataset } from "../lib/data";
import { CaveatsBanner } from "../components/CaveatsBanner";
import { Scorecard } from "../components/Scorecard";
import { Timeline } from "../components/Timeline";
import { AnalyticsCharts } from "../components/AnalyticsCharts";

export const Route = createFileRoute("/c/$handle")({
  loader: ({ params }) => getDataset({ data: params.handle }),
  component: Overview,
});

function Overview() {
  const ds = Route.useLoaderData();
  const { handle } = Route.useParams();
  return (
    <main className="mx-auto max-w-5xl p-8 space-y-6">
      <header><h1 className="text-2xl font-bold">@{ds.creator.handle}</h1>
        <p className="text-muted-foreground">{ds.creator.name} · as of {ds.generatedAt}</p></header>
      <CaveatsBanner caveats={ds.caveats} />
      <Scorecard sc={ds.scorecard} />
      <section><h2 className="font-semibold mb-2">Calls timeline</h2>
        <Timeline handle={handle} calls={ds.calls} /></section>
      <section><h2 className="font-semibold mb-2">Analytics</h2>
        <AnalyticsCharts ds={ds} /></section>
    </main>
  );
}
