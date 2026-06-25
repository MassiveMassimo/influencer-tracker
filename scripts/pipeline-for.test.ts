import { test, expect } from "bun:test";
import { pipelineFor } from "./pipeline-for";

test("pipelineFor: ig selects IG pipeline, default stays X", () => {
  expect(pipelineFor("ig")).toBe("pipeline");
  expect(pipelineFor("x")).toBe("pipeline:x");
  expect(pipelineFor(undefined)).toBe("pipeline:x");
  expect(pipelineFor("")).toBe("pipeline:x");
});
