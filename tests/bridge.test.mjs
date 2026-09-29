import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../wordpress/mwg-games/bridge.js', import.meta.url), 'utf8');

function bridge(fetcher) {
  let listener;
  const replies = [];
  const parent = { postMessage: (data, origin) => replies.push({ data, origin }) };
  const config = {
    origins: ['https://games.mingweiyang.com'],
    api: 'https://mingweiyang.com/wp-json/mwg/v1/',
    nonce: 'test-nonce',
  };
  runInNewContext(source, {
    document: { getElementById: () => ({ dataset: { config: JSON.stringify(config) } }) },
    window: { parent, addEventListener: (type, handler) => { listener = handler; } },
    fetch: fetcher, setTimeout, clearTimeout, AbortController,
  });
  return {
    replies,
    send: (data, origin = config.origins[0], eventSource = parent) =>
      listener({ data, origin, source: eventSource }),
    message: { source: 'mwg-app', id: 'test-1', method: 'profile', payload: {} },
  };
}

test('bridge rejects foreign origins, sibling frames and unknown methods', async () => {
  const b = bridge(() => { throw new Error('Should never fetch'); });
  await b.send(b.message, 'https://evil.example');
  await b.send(b.message, 'https://games.mingweiyang.com', {});
  await b.send({ ...b.message, method: 'delete_users' });
  assert.equal(b.replies.length, 1); // Only the startup handshake.
});

test('bridge sends nonce only to the fixed WordPress origin', async () => {
  let request;
  const b = bridge(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ player: null }) };
  });
  await b.send(b.message);
  assert.equal(request.url, 'https://mingweiyang.com/wp-json/mwg/v1/profile');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['X-WP-Nonce'], 'test-nonce');
  assert.equal(b.replies[1].origin, 'https://games.mingweiyang.com');
  assert.equal(b.replies[1].data.ok, true);
});

test('bridge reports server errors, network failures and oversized writes', async () => {
  const b = bridge(async () => ({
    ok: false, json: async () => ({ code: 'login_required', message: 'Sign in first' }),
  }));
  await b.send(b.message);
  assert.equal(b.replies[1].data.error.code, 'login_required');
  const offline = bridge(async () => { throw new Error('Offline'); });
  await offline.send(offline.message);
  assert.equal(offline.replies[1].data.ok, false);
  assert.equal(offline.replies[1].data.error.message, 'Offline');
  const large = bridge(() => { throw new Error('Should never fetch oversized data'); });
  await large.send({ ...large.message, method: 'finish', payload: { inputs: '0'.repeat(8001) } });
  assert.match(large.replies[1].data.error.message, /too large/);
});
