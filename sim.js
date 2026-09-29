// All simulation coordinates and velocities are integers, in tenths of a pixel.
export const MAX_TICKS = 7200;
export const LEVEL = Object.freeze({
  width: 36000, height: 5400, finish: 34300,
  platforms: [
    [0, 4400, 6000], [7400, 4400, 5000], [13800, 4400, 5200],
    [20500, 4400, 5700], [27700, 4400, 8300],
    [3400, 3500, 1250], [9200, 3450, 1350], [15800, 3500, 1500],
    [22700, 3450, 1400], [30200, 3500, 1500],
  ],
  coins: [
    [2200, 4000], [3900, 3100], [6600, 3520], [8500, 4000],
    [9800, 3050], [13000, 3520], [15000, 4000], [16500, 3100],
    [19700, 3520], [21800, 4000], [23300, 3050], [26900, 3520],
    [28800, 4000], [30900, 3100], [33000, 4000],
  ],
});

export function createState() {
  return { x: 700, y: 4100, vx: 0, vy: 0, grounded: true, ticks: 0,
    won: false, coins: 0, collected: LEVEL.coins.map(() => false), deaths: 0 };
}

export function scoreState(state) {
  return state.won
    ? Math.max(0, 10000 + state.coins * 250 + (MAX_TICKS - state.ticks) * 2 - state.deaths * 500)
    : 0;
}

export function step(state, input) {
  if (typeof input !== 'string' || !/^[0-5]$/.test(input)) throw new TypeError('Invalid replay input');
  if (state.won) throw new RangeError('Replay continues after victory');
  if (state.ticks >= MAX_TICKS) throw new RangeError('Replay exceeds 7200 ticks');
  const key = Number(input);
  state.vx = key === 1 || key === 4 ? -38 : key === 2 || key === 5 ? 38 : 0;
  if (key >= 3 && state.grounded) state.vy = -125;
  const previousBottom = state.y + 300;
  state.x = Math.max(0, Math.min(LEVEL.width - 220, state.x + state.vx));
  state.vy += 5;
  state.y += state.vy;
  state.grounded = false;
  if (state.vy >= 0) {
    for (const [x, y, width] of LEVEL.platforms) {
      if (state.x + 220 > x && state.x < x + width && previousBottom <= y && state.y + 300 >= y) {
        state.y = y - 300;
        state.vy = 0;
        state.grounded = true;
      }
    }
  }
  LEVEL.coins.forEach(([x, y], i) => {
    if (!state.collected[i] && Math.abs(state.x + 110 - x) < 230 && Math.abs(state.y + 150 - y) < 290) {
      state.collected[i] = true;
      state.coins++;
    }
  });
  if (state.y > 6100) {
    state.x = 700;
    state.y = 4100;
    state.vx = 0;
    state.vy = 0;
    state.grounded = true;
    state.deaths++;
  }
  state.ticks++;
  if (state.x >= LEVEL.finish && state.y + 300 <= 4400) state.won = true;
  return state;
}

export function simulate(inputs) {
  if (typeof inputs !== 'string' || inputs.length > MAX_TICKS || /[^0-5]/.test(inputs)) {
    throw new TypeError('Replay must contain at most 7200 input digits (0–5)');
  }
  const state = createState();
  for (const input of inputs) step(state, input);
  return { won: state.won, ticks: state.ticks, coins: state.coins, score: scoreState(state) };
}

// Deterministic fixture for integration checks; it still requires a real ranked run.
export function createWinningReplay() {
  const state = createState();
  let inputs = '';
  while (!state.won && inputs.length < MAX_TICKS) {
    const jump = [6000, 12400, 19000, 26200].some(gap => gap - state.x <= 420 && gap - state.x > 0);
    const input = jump ? '5' : '2';
    inputs += input;
    step(state, input);
  }
  if (!state.won || state.deaths !== 0) throw new Error('Winning replay fixture no longer completes the level');
  return inputs;
}
