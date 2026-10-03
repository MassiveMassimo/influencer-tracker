import { expect, test } from "bun:test";
import { xRequestError } from "./request-error";
import { isTransient } from "./scrape-x";

test("transaction parser errors retain an actionable cause", () => {
  const error = xRequestError({
    code: "ONDEMAND_FILE_URL_RESOLUTION_ERROR",
    message: "secret cookie",
  });
  expect(error.message).toContain("X client transaction");
  expect(error.message).toContain("ONDEMAND_FILE_URL_RESOLUTION_ERROR");
  expect(error.message).not.toContain("secret cookie");
  expect(isTransient(error)).toBe(false);
});

test("network and HTTP failures retain retry semantics without request secrets", () => {
  for (const status of [429, 500, 503]) {
    const error = xRequestError({ response: { status, headers: { cookie: "secret" } } });
    expect(isTransient(error)).toBe(true);
    expect(error.status).toBe(status);
    expect(JSON.stringify(error)).not.toContain("secret");
  }
  expect(isTransient(xRequestError({ code: "ETIMEDOUT" }))).toBe(true);
  expect(isTransient(xRequestError({ response: { status: 401 } }))).toBe(false);
  expect(xRequestError({ response: { status: 401 } }).message).toContain("X authentication");
});
