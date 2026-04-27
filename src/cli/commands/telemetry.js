/**
 * dvaa telemetry [on|off|status]
 *
 * Per-tool subcommand to inspect or change the persisted telemetry opt-out
 * for the dvaa CLI. Status is the default action.
 */

import * as tele from "@opena2a/telemetry";
import { runTelemetryCommand } from "@opena2a/cli-ui";

export default async function runTelemetry(argv) {
  const action = argv[0];
  const out = runTelemetryCommand(action, {
    tool: "dvaa",
    getStatus: tele.status,
    setOptOut: tele.setOptOut,
  });
  console.log(out);
  return 0;
}
