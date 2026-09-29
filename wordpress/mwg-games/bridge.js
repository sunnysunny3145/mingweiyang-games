/* Same-site iframe keeps WordPress cookies and REST nonces out of the game origin. */
'use strict';
const config = JSON.parse(document.getElementById('mwg-config').dataset.config);
const methods = new Set(['profile', 'leaderboard', 'start', 'finish', 'export']);
let busy = 0;
window.addEventListener('message', async (event) => {
  if (event.source !== window.parent || !config.origins.includes(event.origin)) return;
  const message = event.data;
  if (!message || message.source !== 'mwg-app' || typeof message.id !== 'string'
      || message.id.length > 100 || !methods.has(message.method)) return;
  const reply = (result) => event.source.postMessage({
    source: 'mwg-backend', id: message.id, ...result,
  }, event.origin);
  if (busy >= 4) {
    reply({ ok: false, error: { code: 'busy', message: 'Too many requests. Please retry.' } });
    return;
  }
  busy++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const write = ['start', 'finish'].includes(message.method);
    const body = JSON.stringify(message.payload || {});
    if (body.length > 8000) throw new Error('Game replay is too large.');
    const response = await fetch(config.api + message.method, {
      method: write ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(config.nonce ? { 'X-WP-Nonce': config.nonce } : {}) },
      ...(write ? { body } : {}),
    });
    const data = await response.json();
    reply(response.ok
      ? { ok: true, data }
      : { ok: false, error: { code: data.code || 'backend_error', message: data.message || 'Backend request failed.' } });
  } catch (error) {
    reply({ ok: false, error: {
      code: 'connection_error',
      message: error.name === 'AbortError' ? 'The data server timed out. Please retry.' : error.message,
    } });
  } finally {
    clearTimeout(timeout);
    busy--;
  }
});
for (const origin of config.origins) {
  window.parent.postMessage({ source: 'mwg-backend-ready' }, origin);
}
