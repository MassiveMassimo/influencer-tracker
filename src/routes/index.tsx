import { createFileRoute, Link } from "@tanstack/react-router";
import { listCreators } from "../lib/data";
import { Card } from "../components/ui/card";

export const Route = createFileRoute("/")({
  loader: () => listCreators(),
  component: Landing,
});

function Landing() {
  const creators = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-bold mb-6">Influencer Signal Tracker</h1>
      {creators.length === 0 && <p className="text-muted-foreground">No creators yet. Run the pipeline.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {creators.map(c => (
          <Link key={c.handle} to="/c/$handle" params={{ handle: c.handle }}>
            <Card className="p-4 hover:bg-accent">
              <div className="font-semibold">@{c.handle}</div>
              <div className="text-sm text-muted-foreground">{c.name}</div>
              <div className="mt-2 text-sm">{c.totalCalls} calls · 3m excess vs SPY:{" "}
                <span className={c.avgExcess3m >= 0 ? "text-green-600" : "text-red-600"}>
                  {(c.avgExcess3m * 100).toFixed(1)}%</span></div>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
