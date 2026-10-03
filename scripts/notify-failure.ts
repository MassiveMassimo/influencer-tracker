import { spawnSync } from "node:child_process";
import { failureWasHandled } from "./ingest-alerts";
import { notify } from "./notify";

const unit = process.argv[2];
if (!/^influencer-ingest(?:-ig)?\.service$/.test(unit ?? "")) {
  throw new Error("Expected an influencer ingest service name");
}
const result = spawnSync("systemctl", ["show", unit, "--property=InvocationID", "--value"], {
  encoding: "utf8",
  timeout: 5000,
});
const invocation = result.status === 0 ? result.stdout.trim() : "";
if (await failureWasHandled(unit, invocation)) {
  console.log(`${unit}: completed failure already reported; no duplicate alert`);
} else if (!(await notify(`🚨 ${unit} failed or timed out. Check journalctl -u ${unit}.`))) {
  process.exitCode = 1;
}
