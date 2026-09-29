import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWinningReplay, simulate, MAX_TICKS } from '../sim.js';

const verifier = fileURLToPath(new URL('../wordpress/mwg-games/simulation.php', import.meta.url));
function php(replays) {
  const result = spawnSync(process.env.PHP_BIN || 'php', ['-r', `
    require $argv[1];
    $result = [];
    foreach (json_decode(stream_get_contents(STDIN), true) as $input) {
      try { $result[] = mwg_simulate($input); }
      catch (InvalidArgumentException $e) { $result[] = ['error' => true]; }
    }
    echo json_encode($result);
  `, verifier], { input: JSON.stringify(replays), encoding: 'utf8' });
  assert.equal(result.status, 0, `PHP verifier failed: ${result.error || result.stderr}`);
  return JSON.parse(result.stdout);
}

test('known winning replay has exact JS/PHP parity and deterministic score', () => {
  const replay = createWinningReplay();
  const result = simulate(replay);
  assert.equal(result.ticks, 885);
  assert.equal(result.won, true);
  assert.equal(result.coins, 6);
  assert.equal(result.score, 24130);
  assert.equal(result.score, 10000 + result.coins * 250 + (7200 - result.ticks) * 2);
  assert.deepEqual(simulate(replay), result);
  assert.deepEqual(php([replay])[0], result);
});

test('invalid, oversized and post-victory replays are rejected', () => {
  const replay = createWinningReplay();
  const bad = ['6', 'x', '2\n', ' 2', '💫', '0'.repeat(MAX_TICKS + 1), replay + '0', replay + '2'];
  for (const input of bad) assert.throws(() => simulate(input));
  assert.deepEqual(php(bad), bad.map(() => ({ error: true })));
  assert.throws(() => simulate(null));
});

test('truncating or changing a winning replay does not preserve a claimed victory', () => {
  const replay = createWinningReplay();
  const modified = [replay.slice(0, -1), '2'.repeat(replay.length)];
  const outcomes = modified.map(simulate);
  for (const result of outcomes) {
    assert.equal(result.won, false);
    assert.equal(result.score, 0);
  }
  assert.deepEqual(php(modified), outcomes);
});

test('idle, full-length, jumps and seeded random inputs stay in parity', () => {
  let seed = 7361;
  const random = Array.from({ length: 12 }, () => Array.from({ length: 900 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return String(seed % 6);
  }).join(''));
  const inputs = ['', '0'.repeat(MAX_TICKS), '3'.repeat(1000), '2'.repeat(2200), ...random];
  assert.deepEqual(php(inputs), inputs.map(simulate));
});
