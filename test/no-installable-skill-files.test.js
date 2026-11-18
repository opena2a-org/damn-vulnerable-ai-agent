import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const GIT_LOCAL_ENV_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
];
const ENV_WITHOUT_GIT_LOCALS = { ...process.env };
for (const name of GIT_LOCAL_ENV_VARS) delete ENV_WITHOUT_GIT_LOCALS[name];
const GIT_OPTIONS = { env: ENV_WITHOUT_GIT_LOCALS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

const PLANTED = {
  'SKILL.md': '---\nname: a\ndescription: b\n---\n# A\n',
  'a/skill.md': '\uFEFF---\nname: a\n---\n',
  'b/Skill.Md': '\n  \n---\nname: b\n---\n',
  'c/SKILL.md': '# Title\n\n---\n',
  'd/x.skill.md': '---\nname: d\n---\n',
  'e/SKILL.fixture': '---\nname: e\n---\n',
  'f/SKILL.md': '---  \r\nname: f\n---\n',
};

function findInstallableSkillFiles(root, env) {
  const options = { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 };
  let insideWorkTree;
  let listed;
  try {
    insideWorkTree = execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], options).trim();
    listed = execFileSync('git', ['-C', root, 'ls-files', '-z'], options);
  } catch (err) {
    throw new Error(`git could not list the tracked files under ${root}, and this check never skips: ${err.message}`);
  }
  if (insideWorkTree !== 'true') {
    throw new Error(`git reports that ${root} is not inside a work tree, and this check never skips`);
  }
  const selected = listed
    .split('\0')
    .filter((file) => path.posix.basename(file).toLowerCase() === 'skill.md')
    .sort();
  const violations = selected
    .filter((file) => {
      const text = fs.readFileSync(path.join(root, file)).toString('utf8').replace(/^\uFEFF/, '');
      const firstLine = text.split('\n').find((line) => line.trim() !== '');
      return firstLine?.trimEnd() === '---';
    })
    .sort();
  return { selected, violations };
}

test('no tracked file named SKILL.md opens with a front-matter block', () => {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { ...GIT_OPTIONS, cwd: HERE }).trim();
  const { violations } = findInstallableSkillFiles(root, ENV_WITHOUT_GIT_LOCALS);
  assert.deepEqual(
    violations,
    [],
    `Tracked files named SKILL.md open with a front-matter block, which makes them installable by skill installers. Scenario skill files in this repository stay without front matter so they can be scanned in place and cannot be installed. Files:\n${violations.join('\n')}`,
  );
});

test('a tracked file named SKILL.md in any letter case that opens with a front-matter delimiter is reported', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-front-matter-')));
  try {
    execFileSync('git', ['-C', dir, 'init', '-q'], GIT_OPTIONS);
    for (const [file, content] of Object.entries(PLANTED)) {
      fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    }
    execFileSync('git', ['-C', dir, 'add', '--', ...Object.keys(PLANTED)], GIT_OPTIONS);
    const { selected, violations } = findInstallableSkillFiles(dir, ENV_WITHOUT_GIT_LOCALS);
    assert.deepEqual(selected, ['SKILL.md', 'a/skill.md', 'b/Skill.Md', 'c/SKILL.md', 'f/SKILL.md']);
    assert.deepEqual(violations, ['SKILL.md', 'a/skill.md', 'b/Skill.Md', 'f/SKILL.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the check throws when git finds no work tree', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-front-matter-')));
  try {
    const env = { ...ENV_WITHOUT_GIT_LOCALS, GIT_CEILING_DIRECTORIES: path.dirname(dir) };
    assert.throws(
      () => findInstallableSkillFiles(dir, env),
      (err) => err instanceof Error && err.message.includes('git') && err.message.includes('never skips'),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
