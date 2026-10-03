import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blockedMessage, notify } from "./notify";

export function failureReason(error: unknown): string {
  const e = error as { stderr?: Buffer; message?: string };
  const stderr = e?.stderr?.toString() ?? "";
  const reason =
    stderr
      .split("\n")
      .find((line) => line.startsWith("error:") && !line.startsWith('error: script "'))
      ?.replace(/^error:\s*/, "") ??
    e?.message ??
    String(error);
  return redact(reason).slice(0, 800);
}

export function redact(text: string): string {
  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && /KEY|TOKEN|PASSWORD|SECRET|DATABASE_URL/.test(key)) {
      text = text.replaceAll(value, "[REDACTED]");
    }
  }
  return text.replace(/(https?:\/\/|socks5h?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@");
}

export function sharedFailure(reason: string): boolean {
  return /IG_PROXY=|IG session rejected|login not detected|X client transaction|X authentication|RETTIWT_API_KEY not set|yt-dlp failed to launch/.test(
    reason,
  );
}

interface AlertState {
  incidents: Record<string, { reason: string; sentAt: number }>;
  completed?: { invocation: string; handled: boolean };
}

// The systemd lock serializes writers. This directory survives git's data/ cleanup.
export class IngestAlerts {
  private state: AlertState = { incidents: {} };
  private handled = true;
  private path: string;

  constructor(
    readonly unit: string,
    private dir = ".ingest-state",
    private send = notify,
    private now = Date.now,
  ) {
    this.path = join(dir, `${unit}.json`);
  }

  async load(): Promise<void> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8")) as AlertState;
      if (state.incidents && typeof state.incidents === "object") this.state = state;
    } catch {
      // Missing/corrupt state must send an alert, never suppress one.
    }
  }

  private async save(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
  }

  async block(scope: string, reason: string, recovery?: string): Promise<void> {
    reason = redact(reason);
    console.error(`[${this.unit}] ${scope}: ${reason}`);
    const previous = this.state.incidents[scope];
    if (previous?.reason === reason && this.now() - previous.sentAt < 86_400_000) return;
    if (await this.send(blockedMessage(scope, reason, recovery))) {
      this.state.incidents[scope] = { reason, sentAt: this.now() };
      await this.save();
    } else {
      this.handled = false;
    }
  }

  async published(handle: string, message: string): Promise<void> {
    delete this.state.incidents[handle];
    if (!(await this.send(message))) this.handled = false;
    await this.save();
  }

  async complete(
    invocation = process.env.INVOCATION_ID ?? "",
    recovered = false,
  ): Promise<boolean> {
    if (recovered) delete this.state.incidents[this.unit];
    this.state.completed = { invocation, handled: this.handled };
    await this.save();
    return this.handled;
  }
}

export async function failureWasHandled(
  unit: string,
  invocation: string,
  dir = ".ingest-state",
): Promise<boolean> {
  if (!invocation) return false;
  try {
    const state = JSON.parse(await readFile(join(dir, `${unit}.json`), "utf8")) as AlertState;
    return state.completed?.invocation === invocation && state.completed.handled === true;
  } catch {
    return false;
  }
}
