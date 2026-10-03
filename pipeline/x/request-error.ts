// Rettiwt's default handler discards non-Axios errors, including parser failures.
// Keep retryable status/code fields, but never copy request headers or cookies.
export function xRequestError(error: unknown): Error & { status?: number; code?: string } {
  const e = error as {
    status?: number;
    code?: unknown;
    response?: { status?: number };
    name?: string;
  };
  const status = e?.response?.status ?? e?.status;
  const code = typeof e?.code === "string" && /^[A-Z0-9_]+$/.test(e.code) ? e.code : undefined;
  const transaction =
    code && /ONDEMAND|TRANSACTION|KEY_BYTE|SITE_VERIFICATION|ANIMATION_FRAME|INDICES/.test(code);
  let message = `X request failed${status ? ` (HTTP ${status})` : ""}${code ? ` (${code})` : ""}.`;
  if (transaction) {
    message = `X client transaction failed (${code}). Check the Rettiwt transaction parser version.`;
  } else if (status === 401 || status === 403) {
    message = `X authentication rejected (HTTP ${status}). Refresh the throwaway account key.`;
  }
  return Object.assign(new Error(message), { status, code });
}
