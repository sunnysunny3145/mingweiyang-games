import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('backend authorization, bounded requests, export isolation and replay retry contracts', () => {
  const result = spawnSync(process.env.PHP_BIN || 'php', ['tests/backend-harness.php'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Backend assertions passed/);
});
