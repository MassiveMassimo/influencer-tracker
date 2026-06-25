// Select the pipeline npm script for resume's prices+score stages. prices/score are
// platform-agnostic; only the orchestrator differs. Default is X so the existing X
// resume path is unchanged.
export function pipelineFor(platform?: string): "pipeline" | "pipeline:x" {
  return platform === "ig" ? "pipeline" : "pipeline:x";
}
