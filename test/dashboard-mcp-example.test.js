/**
 * The dashboard's MCP "Execute tool" example (#135).
 *
 * An agent card's Test modal builds a curl example from the agent's first
 * tool. The arguments are chosen per tool (mcpToolExample in
 * public/js/views/agents.js): each example uses only parameters its tool
 * declares, and the read_file path, resolved the way the read_file handler in
 * src/index.js resolves it, stays inside the sandbox and reaches a file the
 * sandbox plants. The sandbox is created for this test and removed after it.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mcpToolExample } from '../public/js/views/agents.js';
import { getAllAgents } from '../src/core/agents.js';
import { initSandbox } from '../src/sandbox/init.js';

const sandbox = initSandbox();
after(() => sandbox.cleanup());

const mcpAgents = getAllAgents().filter((a) => a.protocol === 'mcp');

// The read_file handler's resolution and boundary check, as in src/index.js.
function resolveLikeReadFile(requestedPath) {
  return requestedPath.startsWith('/')
    ? path.join(sandbox.root, requestedPath)
    : path.resolve(sandbox.home, requestedPath);
}

function isInsideSandbox(target) {
  const rel = path.relative(sandbox.root, path.resolve(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

test('the read_file example path stays inside the sandbox and reaches the planted file', () => {
  const { path: examplePath } = mcpToolExample('read_file');
  assert.equal(typeof examplePath, 'string', 'read_file example has no path');
  // The handler counts the read as an attack only for a traversal or /etc path.
  assert.ok(examplePath.includes('..') || examplePath.startsWith('/etc'), `not a traversal: ${examplePath}`);
  const resolved = resolveLikeReadFile(examplePath);
  assert.ok(
    isInsideSandbox(resolved),
    `${examplePath} resolves to ${resolved}, outside the sandbox root ${sandbox.root}; read_file refuses it`,
  );
  assert.match(fs.readFileSync(resolved, 'utf-8'), /^root:/, `${resolved} is not the sandbox's passwd file`);
});

test('every MCP tool example uses only parameters the tool declares', () => {
  assert.ok(mcpAgents.length > 0, 'no MCP agents');
  for (const agent of mcpAgents) {
    for (const tool of agent.tools) {
      const declared = Object.keys(tool.parameters || {});
      for (const key of Object.keys(mcpToolExample(tool.name))) {
        assert.ok(
          declared.includes(key),
          `${agent.id} ${tool.name}: example argument "${key}" is not a declared parameter (${declared.join(', ') || 'none'})`,
        );
      }
    }
  }
});

test('each MCP agent\'s first tool gets an example that fits the curl command', () => {
  for (const agent of mcpAgents) {
    const first = agent.tools[0];
    const args = mcpToolExample(first.name);
    if (Object.keys(first.parameters || {}).length > 0) {
      assert.ok(Object.keys(args).length > 0, `${agent.id}: no example arguments for its first tool ${first.name}`);
    }
    // The body goes inside -d '...', so a single quote would end the argument.
    const body = JSON.stringify({ tool: first.name, arguments: args });
    assert.ok(!body.includes("'"), `${agent.id}: example body has a single quote: ${body}`);
  }
});
