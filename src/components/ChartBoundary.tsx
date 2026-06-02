import { Component, type ReactNode } from "react";

// Isolates a single chart's render failure so it can't blank the whole route.
export class ChartBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="grid h-40 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
          chart unavailable
        </div>
      );
    }
    return this.props.children;
  }
}
