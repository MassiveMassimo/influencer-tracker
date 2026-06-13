import { test, expect } from "bun:test";
import { REPORT_REASONS } from "#/lib/report-reasons.ts";
import { validateReportBody } from "../routes/api/report";

// Contract test: the body ReportButton.send() builds must pass the endpoint's validator
// for every enum reason. Asserts the UI and the /api/report contract can't drift apart.
test("every enum reason produces a body the endpoint accepts", () => {
  for (const reason of REPORT_REASONS) {
    const body = { handle: "somecreator", shortcode: "ABC123", reason };
    expect(validateReportBody(body)).toEqual(body);
  }
});
