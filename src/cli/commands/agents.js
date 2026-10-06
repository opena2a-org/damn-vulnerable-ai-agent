/**
 * dvaa agents - list all DVAA agents with port, protocol, and security level.
 */

import { listAgents } from '../agents.js';
import { emit, isJsonMode, tableRows, parseCommandArgs } from '../format.js';

export default async function run(argv) {
  const parsed = parseCommandArgs('agents', argv, { json: { type: 'boolean' } }, { maxPositionals: 0 });
  if (parsed.flags.has('help')) {
    console.log(USAGE);
    return 0;
  }

  const agents = listAgents();
  if (isJsonMode(parsed)) {
    emit(agents, parsed);
    return 0;
  }

  const lines = tableRows(agents, [
    { key: 'name',     header: 'NAME' },
    { key: 'port',     header: 'PORT' },
    { key: 'protocol', header: 'PROTO' },
    { key: 'security', header: 'SECURITY' },
    { key: 'url',      header: 'URL' },
  ]);
  emit([`${agents.length} agents:`, '', ...lines], parsed);
  return 0;
}

const USAGE = `Usage: dvaa agents [--json]

List all DVAA agents with port, protocol, and security level.

Options:
  --json    Machine-readable output
  --help    Show this message`;
