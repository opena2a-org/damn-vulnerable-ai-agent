/**
 * dvaa telemetry [on|off|status]
 *
 * Per-tool subcommand to inspect or change the persisted telemetry opt-out
 * for the dvaa CLI. Status is the default action.
 */

import * as tele from "@opena2a/telemetry";
import { runTelemetryCommand } from "@opena2a/cli-ui";

// The actions runTelemetryCommand understands; undefined is the default (status).
const ACTIONS = new Set([undefined, "on", "off", "status", "--help", "-h"]);

export default async function runTelemetry(argv) {
  // --offline is the global telemetry switch; commands that parse their own
  // flags accept it, and so does this one.
  const args = argv.filter(a => a !== "--offline");
  const action = args[0];
  // runTelemetryCommand answers an unknown action with a message on the success
  // path, so validate first: a typo (`dvaa telemetry of`) must not exit 0 and
  // leave a script believing the opt-out changed.
  if (!ACTIONS.has(action) || args.length > 1) {
    const bad = ACTIONS.has(action) ? args[1] : action;
    process.stderr.write(`Unknown telemetry action '${bad}'. Try 'dvaa telemetry [on|off|status]'.\n`);
    return 1;
  }
  const out = runTelemetryCommand(action, {
    tool: "dvaa",
    getStatus: tele.status,
    setOptOut: tele.setOptOut,
  });
  console.log(out);
  return 0;
}
