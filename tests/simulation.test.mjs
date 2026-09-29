import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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

test('login refresh reloads an already-ready bridge before requesting a fresh profile', async () => {
  const nodes = new Map();
  const windowListeners = new Map();
  const messages = [];
  const navigations = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      listeners: new Map(),
      addEventListener(type, handler) { this.listeners.set(type, handler); },
      replaceChildren() {},
      getBoundingClientRect: () => ({ width: 960, height: 540 }),
      getContext: () => ({}),
    });
    return nodes.get(id);
  }
  const iframe = node('backend-bridge');
  iframe.contentWindow = { postMessage: (message, origin) => messages.push({ message, origin }) };
  Object.defineProperty(iframe, 'src', { set: value => navigations.push(value) });
  const context = vm.createContext({
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener: (type, handler) => windowListeners.set(type, handler) },
    location: { hostname: 'games.mingweiyang.com' },
    createState: () => ({}),
    matchMedia: () => ({ matches: false }),
    ResizeObserver: class { observe() {} },
    requestAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    URL,
  });
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '');
  vm.runInContext(source, context);
  const receive = windowListeners.get('message');
  const ready = () => receive({
    origin: 'https://mingweiyang.com', source: iframe.contentWindow, data: { source: 'mwg-backend-ready' },
  });
  assert.equal(navigations.length, 1);
  ready();
  assert.equal(messages.filter(({ message }) => message.method === 'profile').length, 1);
  node('refresh-profile').listeners.get('click')();
  assert.equal(navigations.length, 2);
  assert.equal(navigations[1], 'https://mingweiyang.com/wp-admin/admin-post.php?action=mwg_bridge');
  assert.equal(messages.filter(({ message }) => message.method === 'profile').length, 1,
    'Do not send profile through the stale anonymous bridge');
  ready();
  assert.equal(messages.filter(({ message }) => message.method === 'profile').length, 2);
  for (const { message, origin } of messages) {
    assert.equal(origin, 'https://mingweiyang.com');
    receive({
      origin, source: iframe.contentWindow,
      data: { source: 'mwg-backend', id: message.id, ok: false, error: { message: 'Test cleanup' } },
    });
  }
  await new Promise(resolve => setImmediate(resolve));
});
