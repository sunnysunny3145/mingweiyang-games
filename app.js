import { createState, step, scoreState, LEVEL, MAX_TICKS } from './sim.js';

const $ = id => document.getElementById(id);
const origin = 'https://mingweiyang.com';
const accountDefault = `${origin}/wp-admin/admin-post.php?action=mwg_account`;
const iframe = $('backend-bridge');
const pending = new Map();
let ready = false;
let player = null;
let requestCount = 0;
let starting = false;
let saving = false;
let activeRun = null;
let saved = false;
let state = createState();
let inputs = '';
let mode = 'practice';
let playing = false;
let accumulator = 0;
let previousTime = 0;
const keys = new Set();
const touches = new Map();
const number = value => Number(value || 0).toLocaleString('zh-CN');

function status(message, kind = '') {
  $('game-status').textContent = message;
  $('game-status').className = `notice ${kind}`;
}
function connection(message, error = false) {
  $('connection-status').textContent = message;
  $('connection-status').className = `connection-status${error ? ' error' : ''}`;
}
function buttons() {
  $('ranked-play').disabled = !ready || !player || starting || saving;
  $('practice-play').disabled = starting || saving;
  $('overlay-play').disabled = starting || saving;
  $('export-data').disabled = !ready || !player;
}
function safeAccountUrl(value, fallback) {
  try {
    const url = new URL(value);
    return url.origin === origin && url.protocol === 'https:' ? url.href : fallback;
  } catch { return fallback; }
}
function request(method, payload = {}) {
  if (!ready) return Promise.reject(new Error('账号服务尚未连接。你仍可自由练习，请稍后刷新账号。'));
  const id = `${Date.now()}-${++requestCount}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('请求超时，请检查网络后重试；尚未确认保存成功。'));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    iframe.contentWindow.postMessage({ source: 'mwg-app', id, method, payload }, origin);
  });
}
window.addEventListener('message', event => {
  if (event.origin !== origin || event.source !== iframe.contentWindow) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.source === 'mwg-backend-ready') {
    ready = true;
    clearTimeout(readyTimer);
    buttons();
    refreshProfile();
    refreshLeaderboard();
    return;
  }
  if (message.source !== 'mwg-backend' || typeof message.id !== 'string') return;
  const task = pending.get(message.id);
  if (!task) return;
  clearTimeout(task.timer);
  pending.delete(message.id);
  if (message.ok === true) task.resolve(message.data);
  else task.reject(new Error(message.error?.message || '账号服务返回错误，请稍后重试。'));
});
function loadBridge() {
  ready = false;
  buttons();
  connection('正在连接账号服务…');
  iframe.src = `${origin}/wp-admin/admin-post.php?action=mwg_bridge`;
}
let readyTimer;
function waitForBridge() {
  clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    if (!ready) {
      connection('账号服务暂不可用（可能尚未安装或被浏览器拦截）。练习不受影响，登录后可点刷新重连。', true);
      $('leaderboard-status').textContent = '排行榜暂不可用。连接恢复后点击刷新。';
    }
  }, 12000);
}
async function refreshProfile() {
  $('refresh-profile').disabled = true;
  try {
    const data = await request('profile');
    player = data.player;
    $('profile-title').textContent = player ? `${player.displayName}，你好` : '冒险者，你好';
    $('profile-subtitle').textContent = player ? '星光档案已连接' : '登录后，让星光留下来';
    $('best-score').textContent = player ? number(player.bestScore) : '—';
    $('run-count').textContent = player ? number(player.runs) : '—';
    $('account-link').href = safeAccountUrl(data.accountUrl, accountDefault);
    $('account-link').textContent = player ? '我的账号 ↗' : '登录 / 注册 ↗';
    const logout = safeAccountUrl(data.logoutUrl, null);
    $('logout-link').hidden = !player || !logout;
    if (logout) $('logout-link').href = logout;
    const preview = location.hostname !== 'games.mingweiyang.com';
    connection(preview
      ? '预览站可能因跨站 Cookie 无法识别登录。请前往 games.mingweiyang.com 正式站后登录并刷新；练习始终可玩。'
      : player ? '账号已连接 · 数据保存在 WordPress。' : '在新页面登录 / 注册后，回来点击「登录后刷新」。如仍未登录，请检查 Cookie 设置。');
  } catch (error) {
    player = null;
    $('profile-title').textContent = '冒险者，你好';
    $('profile-subtitle').textContent = '账号连接待恢复 · 可自由练习';
    $('best-score').textContent = '—';
    $('run-count').textContent = '—';
    $('logout-link').hidden = true;
    connection(error.message, true);
  } finally {
    $('refresh-profile').disabled = false;
    buttons();
  }
}
async function refreshLeaderboard() {
  $('refresh-leaderboard').disabled = true;
  $('leaderboard-status').hidden = false;
  $('leaderboard-status').textContent = '正在读取公开排行榜…';
  try {
    const data = await request('leaderboard');
    const rows = data.players.slice(0, 20).map((entry, index) => {
      const li = document.createElement('li');
      const rank = document.createElement('span');
      rank.className = 'rank-number';
      rank.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'rank-name';
      name.textContent = entry.displayName;
      const points = document.createElement('span');
      points.className = 'rank-points';
      points.textContent = number(entry.score);
      const time = document.createElement('small');
      time.textContent = `${(entry.ticks / 60).toFixed(2)} 秒`;
      points.append(time);
      li.append(rank, name, points);
      return li;
    });
    $('leaderboard').replaceChildren(...rows);
    $('leaderboard-status').hidden = rows.length > 0;
    $('leaderboard-status').textContent = '天空还很安静。成为第一位留下星光的冒险者吧。';
  } catch (error) {
    $('leaderboard').replaceChildren();
    $('leaderboard-status').textContent = `暂时无法读取排行榜：${error.message}`;
  } finally {
    $('refresh-leaderboard').disabled = false;
  }
}
$('refresh-profile').addEventListener('click', () => {
  if (!ready) { loadBridge(); waitForBridge(); }
  else refreshProfile();
});
$('refresh-leaderboard').addEventListener('click', refreshLeaderboard);
$('export-data').addEventListener('click', async () => {
  $('export-data').disabled = true;
  try {
    const data = await request('export');
    if (data.schemaVersion !== 1) throw new Error('数据格式不受支持，未创建下载。');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mingwei-games-account.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    connection('账号数据已准备下载。请妥善保管包含个人信息的 JSON 文件。');
  } catch (error) { connection(`导出失败：${error.message}`, true); }
  finally { buttons(); }
});

function resetControls() {
  keys.clear();
  touches.clear();
  document.querySelectorAll('[data-control]').forEach(button => button.classList.remove('pressed'));
}
function startGame(nextMode, runId = null) {
  state = createState();
  inputs = '';
  mode = nextMode;
  activeRun = runId;
  saved = false;
  playing = true;
  accumulator = 0;
  resetControls();
  $('mode-label').textContent = mode === 'ranked' ? '正式排位' : '自由练习';
  $('overlay').hidden = true;
  $('retry-finish').hidden = true;
  status(mode === 'ranked' ? '排位已开始 · 抵达终点后将提交操作回放，由服务器验证成绩。' : '练习模式 · 本次成绩不会上传。方向键移动，空格起跳，向右寻找星星门。');
  $('game').focus({ preventScroll: true });
}
function practice() {
  if (!starting && !saving) startGame('practice');
}
$('practice-play').addEventListener('click', practice);
$('overlay-play').addEventListener('click', practice);
$('ranked-play').addEventListener('click', async () => {
  if (starting || saving || !player) return;
  const resumeOnFailure = playing;
  playing = false;
  resetControls();
  starting = true;
  buttons();
  status('正在申请排位场次，请稍候…');
  try {
    const data = await request('start');
    if (typeof data.runId !== 'string' || !data.runId || data.maxTicks !== MAX_TICKS) throw new Error('排位配置不匹配，请刷新页面。');
    startGame('ranked', data.runId);
  } catch (error) {
    playing = resumeOnFailure;
    accumulator = 0;
    status(`排位未开始：${error.message}`, 'error');
  }
  finally { starting = false; buttons(); }
});

async function finishRun() {
  if (starting || saving || saved || !activeRun || !state.won) return;
  saving = true;
  buttons();
  $('retry-finish').hidden = true;
  status('已通关，正在提交回放验证…请保留本页面。');
  try {
    const data = await request('finish', { runId: activeRun, inputs });
    saved = true;
    status(`已验证并保存！本次 ${number(data.score)} 分 · ${data.coins} 颗星星 · ${(data.ticks / 60).toFixed(2)} 秒。最佳 ${number(data.bestScore)} 分，累计完成 ${number(data.runs)} 次。`, 'success');
    $('overlay-note').textContent = '成绩已保存到 WordPress 账号';
    refreshProfile();
    refreshLeaderboard();
  } catch (error) {
    status(`本次成绩尚未确认保存：${error.message} 可重试同一场次；开始新游戏会放弃本页的重试记录。`, 'error');
    $('overlay-note').textContent = '尚未确认保存 · 可点击下方重试';
    $('retry-finish').hidden = false;
  } finally { saving = false; buttons(); }
}
$('retry-finish').addEventListener('click', finishRun);
function endGame() {
  playing = false;
  resetControls();
  $('overlay').hidden = false;
  $('overlay-badge').textContent = state.won ? '星光已经送达 ✦' : '冒险也需要休息一下';
  $('overlay-title').textContent = state.won ? `收获 ${number(scoreState(state))} 分` : '时间到，再试一次？';
  $('overlay-text').textContent = state.won
    ? `${state.coins} 颗星星 · ${(state.ticks / 60).toFixed(2)} 秒 · 掉落 ${state.deaths} 次。谢谢你，把星光带到这里。`
    : '每次起跳都会更熟练一点。靠近缺口时再跳，留足距离。';
  $('overlay-play').textContent = '再来一次练习 ↻';
  $('overlay-note').textContent = mode === 'practice' ? '练习成绩仅在本页显示，不会上传' : '再次排位请点击「开始排位」';
  if (state.won && mode === 'ranked') finishRun();
  else status(state.won ? '练习通关！本次成绩不会上传。登录后点击「开始排位」，再挑战一次吧。' : '本次已达到 120 秒上限，未通关，不会保存成绩。', state.won ? 'success' : '');
}
const controlKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'KeyA', 'KeyD', 'KeyW'];
window.addEventListener('keydown', event => {
  if (!playing || !controlKeys.includes(event.code) || event.target.closest('button,a,input,textarea,select')) return;
  event.preventDefault();
  keys.add(event.code);
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', resetControls);
document.addEventListener('visibilitychange', () => {
  resetControls();
  accumulator = 0;
  previousTime = 0;
});
document.querySelectorAll('[data-control]').forEach(button => {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (!playing) return;
    button.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, button.dataset.control);
    button.classList.add('pressed');
  });
  const release = event => {
    touches.delete(event.pointerId);
    if (![...touches.values()].includes(button.dataset.control)) button.classList.remove('pressed');
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});
function currentInput() {
  const held = new Set(touches.values());
  const left = keys.has('ArrowLeft') || keys.has('KeyA') || held.has('left');
  const right = keys.has('ArrowRight') || keys.has('KeyD') || held.has('right');
  const jump = keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW') || held.has('jump');
  return String((left === right ? 0 : left ? 1 : 2) + (jump ? 3 : 0));
}

const canvas = $('game');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function ellipse(x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}
function rounded(x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
function star(x, y, size, color, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 ? size * .46 : size;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function cloud(x, y, scale, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ellipse(0, 0, 42, 14, color);
  ellipse(-18, -10, 20, 17, color);
  ellipse(8, -16, 23, 23, color);
  ellipse(30, -5, 21, 15, color);
  ctx.restore();
}
function tree(x, y, scale, tint) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  rounded(-4, -66, 8, 68, 4, '#a0b594');
  ellipse(0, -83, 40, 51, tint);
  ellipse(-22, -65, 27, 32, tint);
  ellipse(22, -66, 28, 33, tint);
  ctx.strokeStyle = '#fff6d34a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -54); ctx.lineTo(0, -110); ctx.moveTo(0, -78); ctx.lineTo(17, -93);
  ctx.stroke();
  ctx.restore();
}
function mushroom(x, y, scale) {
  rounded(x - 3 * scale, y - 11 * scale, 6 * scale, 12 * scale, 2 * scale, '#f6eed7');
  ellipse(x, y - 12 * scale, 12 * scale, 7 * scale, '#d4a395');
  ellipse(x - 4 * scale, y - 14 * scale, 2 * scale, 2 * scale, '#f7ebd6');
  ellipse(x + 4 * scale, y - 12 * scale, 2 * scale, 1.5 * scale, '#f7ebd6');
}
function drawCharacter(x, y, time) {
  const walking = state.grounded && state.vx !== 0 && playing;
  const stride = walking ? Math.sin(state.ticks * .33) * 3 : 0;
  const bounce = reducedMotion ? 0 : state.grounded ? Math.sin(time * 3) * 1.2 : -1;
  ctx.save();
  ctx.translate(x + 11, y + 15 + bounce);
  if (state.vx < 0) ctx.scale(-1, 1);
  // Oversized head, leaf-shaped hair and a little mail satchel make an original courier.
  ellipse(-2, 18, 16, 3, '#77946a30');
  rounded(-8, 6 + stride, 7, 10, 3, '#4e6261');
  rounded(3, 6 - stride, 7, 10, 3, '#4e6261');
  rounded(-10, 13 + stride, 10, 5, 2, '#f8f1df');
  rounded(2, 13 - stride, 11, 5, 2, '#f8f1df');
  rounded(-12, -10, 25, 23, 9, '#8fb5a2');
  ellipse(-13, 0 - stride / 2, 5, 7, '#a7c9b0');
  ellipse(14, 0 + stride / 2, 5, 7, '#a7c9b0');
  ellipse(-14, 5 - stride / 2, 4, 4, '#f1d7bb');
  ellipse(15, 5 + stride / 2, 4, 4, '#f1d7bb');
  ctx.fillStyle = '#f1bf7d';
  ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(-26, -3 + Math.sin(time * 6) * 3); ctx.lineTo(-18, -12); ctx.closePath(); ctx.fill();
  rounded(-11, -13, 24, 7, 3, '#f0c181');
  ctx.strokeStyle = '#806f57'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(10, 10); ctx.stroke();
  rounded(3, 3, 13, 11, 3, '#b58d66');
  rounded(4, 3, 11, 5, 2, '#d2b184');
  ellipse(0, -24, 21, 21, '#546d73');
  ellipse(1, -20, 18, 16, '#f6dfc6');
  ellipse(-17, -20, 4, 5, '#f6dfc6');
  ellipse(18, -20, 4, 5, '#f6dfc6');
  ctx.fillStyle = '#546d73';
  ctx.beginPath(); ctx.moveTo(-19, -24); ctx.quadraticCurveTo(-21, -48, 2, -44); ctx.quadraticCurveTo(22, -47, 22, -21); ctx.lineTo(11, -30); ctx.lineTo(7, -23); ctx.lineTo(0, -31); ctx.lineTo(-5, -24); ctx.lineTo(-10, -30); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-3, -42); ctx.quadraticCurveTo(-14, -54, -19, -45); ctx.quadraticCurveTo(-10, -44, -3, -40); ctx.fill();
  ellipse(-6, -20, 2, 3, '#344d51'); ellipse(8, -20, 2, 3, '#344d51');
  ellipse(-11, -15, 4, 2, '#e8aa9a'); ellipse(13, -15, 4, 2, '#e8aa9a');
  ctx.strokeStyle = '#926f60'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(1, -16, 3, .2, Math.PI - .2); ctx.stroke();
  star(15, -34, 5, '#f3d184', .2);
  ctx.restore();
}
function render(time) {
  const w = canvas.width;
  const h = canvas.height;
  const camera = Math.max(0, Math.min(3600 - w, state.x / 10 - w * .28));
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#dcece7'); sky.addColorStop(.75, '#f2f0d9'); sky.addColorStop(1, '#e3e9d2');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  ellipse(765 - camera * .04, 94, 43, 43, '#faf3cd');
  ellipse(765 - camera * .04, 94, 57, 57, '#fff8d92b');
  for (let i = 0; i < 9; i++) {
    const x = i * 190 - (camera * .18) % 190;
    cloud(x, 83 + (i % 3) * 39, .8 + (i % 2) * .35, '#fffdf399');
  }
  for (let i = 0; i < 10; i++) {
    const x = i * 270 - (camera * .28) % 270;
    ellipse(x, 393 + (i % 2) * 15, 200, 131 + (i % 3) * 20, '#bdcdb780');
    ellipse(x + 120, 418, 165, 104, '#afc5a17a');
  }
  for (let i = 0; i < 13; i++) tree(i * 132 - (camera * .45) % 132, 423, .45 + (i % 4) * .14, i % 2 ? '#aac4a280' : '#c2cda680');
  for (let i = 0; i < 9; i++) {
    const x = ((i * 139 + 30 - camera * .1) % w + w) % w;
    const y = 166 + (i * 43) % 190 + Math.sin(time + i) * (reducedMotion ? 0 : 4);
    star(x, y, 2.5, '#ffffedaa', .3);
  }
  ctx.save();
  ctx.translate(-camera, 0);
  for (const [px, py, pw] of LEVEL.platforms) {
    const x = px / 10, y = py / 10, width = pw / 10;
    if (x + width < camera - 60 || x > camera + w + 60) continue;
    const floating = y < 440;
    const depth = floating ? 24 : 105;
    rounded(x, y + 4, width, depth, 12, floating ? '#c4b798' : '#c4b593');
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y + 14, width, depth - 10); ctx.clip();
    for (let j = 0; j < width / 28; j++) {
      ellipse(x + j * 31 + 14, y + 34 + (j % 3) * 16, 3, 2, '#e3d5b5');
      if (!floating) ellipse(x + j * 31, y + 85, 4, 2.5, '#a79f8160');
    }
    ctx.restore();
    rounded(x - 3, y - 2, width + 6, 15, 7, '#8ba878');
    rounded(x - 3, y - 3, width + 6, 6, 3, '#bdd097');
    for (let j = 25; j < width - 5; j += 57) {
      const tx = x + j;
      ctx.strokeStyle = '#8eaa7e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx, y); ctx.lineTo(tx - 3, y - 7); ctx.moveTo(tx, y); ctx.lineTo(tx + 4, y - 5); ctx.stroke();
    }
    if (!floating) {
      tree(x + width - 63, y, .72, '#98b78e');
      mushroom(x + 80, y - 1, .8);
      mushroom(x + 98, y - 1, .55);
      for (let j = 150; j < width - 100; j += 180) {
        ellipse(x + j, y - 3, 19, 8, '#9bb588');
        ellipse(x + j + 7, y - 11, 10, 10, '#a4bd90');
        ellipse(x + j + 4, y - 14, 3, 3, '#eee3af');
      }
    }
  }
  rounded(120, 386, 5, 55, 2, '#aa987a');
  rounded(102, 383, 77, 28, 4, '#f8efd9');
  ctx.fillStyle = '#82956f'; ctx.font = '12px system-ui'; ctx.fillText('星星门 →', 111, 402);
  LEVEL.coins.forEach(([cx, cy], i) => {
    if (state.collected[i]) return;
    const x = cx / 10, y = cy / 10 + (reducedMotion ? 0 : Math.sin(time * 2.5 + i) * 3);
    ellipse(x, y, 14, 14, '#fff4ba4d');
    star(x, y, 10, '#e3b954', reducedMotion ? 0 : Math.sin(time * 2 + i) * .12);
    star(x - 1, y - 1, 5, '#f7dc81');
  });
  rounded(3421, 348, 72, 94, 35, '#9cb098');
  rounded(3428, 355, 58, 87, 29, '#e4eed2');
  rounded(3434, 365, 46, 77, 23, '#c6ddbc');
  star(3456, 347, 21, '#ebca73');
  star(3456, 393, 13, '#fff5c7', time * (reducedMotion ? 0 : .2));
  ctx.fillStyle = '#6d866a'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('星光已在等你', 3456, 328); ctx.textAlign = 'left';
  drawCharacter(state.x / 10, state.y / 10, time);
  ctx.restore();
  $('coin-count').textContent = state.coins;
  const seconds = Math.floor(state.ticks / 60);
  $('time-count').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('progress-fill').style.width = `${Math.min(100, state.x / LEVEL.finish * 100)}%`;
}
function resizeCanvas() {
  // Keep physics pixels constant; reveal less of the world on narrow touch screens.
  const bounds = $('canvas-wrap').getBoundingClientRect();
  canvas.width = Math.round(540 * bounds.width / bounds.height) || 960;
  canvas.height = 540;
}
new ResizeObserver(resizeCanvas).observe($('canvas-wrap'));
function frame(time) {
  if (!document.hidden) {
    const delta = previousTime ? Math.min(250, time - previousTime) : 0;
    previousTime = time;
    if (playing) {
      accumulator += delta;
      while (accumulator >= 1000 / 60 && playing) {
        const input = currentInput();
        inputs += input;
        step(state, input);
        accumulator -= 1000 / 60;
        if (state.won || state.ticks >= MAX_TICKS) endGame();
      }
    }
    render(reducedMotion ? 0 : time / 1000);
  }
  requestAnimationFrame(frame);
}
loadBridge();
waitForBridge();
resizeCanvas();
requestAnimationFrame(frame);
