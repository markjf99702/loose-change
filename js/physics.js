// The board and the coins, in millimetres and seconds. Top-down: x across the board, y away from the player.
// Sizes follow a pub shove ha'penny board: 24 by 14 inches, nine beds of 1¼ inches, coins an inch across.

export const BOARD = {
  w: 356,          // width
  h: 610,          // length; past this the coin falls off the far end
  r: 12.7,         // coin radius
  first: 230,      // the first line
  bed: 31.75,      // bed depth
  beds: 9,
  side: 44,        // the two long lines; between them and the edge is the chalk
  line: 1.2,       // a coin touching a line doesn't count
  startY: 4,       // where a coin sits before it's struck: hanging over the near edge
};

export const lineY = k => BOARD.first + k * BOARD.bed;   // k = 0 (first line) … 9 (last line)

const DECEL = 2400;       // sliding friction, mm/s² (brass on polished wood, μ ≈ 0.25)
const RESTITUTION = 0.82; // brass on brass
const DT = 1 / 600;

export function makeCoin(x, id = 0) {
  return { id, x, y: BOARD.startY, vx: 0, vy: 0, dead: false, rot: (id * 2.39996) % (Math.PI * 2), spin: 0 };
}

// The launch speed that slides a lone coin a given distance on the board.
export const speedFor = dist => Math.sqrt(2 * DECEL * Math.max(0, dist));
export const distFor = speed => (speed * speed) / (2 * DECEL);

export function strike(coin, angle, dist) {
  const v = speedFor(dist);
  coin.vx = Math.sin(angle) * v;
  coin.vy = Math.cos(angle) * v;
  coin.spin = (Math.random() - 0.5) * 4;
}

export const moving = coins => coins.some(c => !c.dead && (c.vx || c.vy));

// Advance by `seconds`. Calls onHit(strength mm/s) for coin-on-coin knocks and onFall(coin) for coins off the board.
export function step(coins, seconds, events = {}) {
  const n = Math.max(1, Math.round(seconds / DT));
  for (let s = 0; s < n; s++) tick(coins, DT, events);
}

function tick(coins, dt, ev) {
  const { r, w, h } = BOARD;
  for (const c of coins) {
    if (c.dead || (!c.vx && !c.vy)) continue;
    const sp = Math.hypot(c.vx, c.vy);
    const drop = DECEL * dt;
    if (sp <= drop) { c.vx = 0; c.vy = 0; c.spin = 0; continue; }
    const k = (sp - drop) / sp;
    c.vx *= k; c.vy *= k;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.rot += c.spin * dt; c.spin *= 0.995;
    // Off the board: once more than half the coin is past an edge (its centre is), it tips over.
    if (c.x < 0 || c.x > w || c.y > h) {
      c.dead = true; c.fellAt = { x: c.x, y: c.y, vx: c.vx, vy: c.vy };
      c.vx = 0; c.vy = 0;
      ev.onFall?.(c);
    }
  }
  const d2 = 4 * r * r;
  for (let i = 0; i < coins.length; i++) {
    const a = coins[i];
    if (a.dead) continue;
    for (let j = i + 1; j < coins.length; j++) {
      const b = coins[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dd = dx * dx + dy * dy;
      if (dd >= d2 || dd === 0) continue;
      const d = Math.sqrt(dd), nx = dx / d, ny = dy / d;
      // push apart
      const over = (2 * r - d) / 2;
      a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn >= 0) continue;
      const jimp = -(1 + RESTITUTION) * vn / 2;
      a.vx -= jimp * nx; a.vy -= jimp * ny;
      b.vx += jimp * nx; b.vy += jimp * ny;
      // a glancing knock sets coins turning a little
      const vt = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
      a.spin += vt * 0.004; b.spin -= vt * 0.004;
      ev.onHit?.(-vn, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  }
}

// Run until everything stops (or a time limit). For the computer player's planning and for tests.
export function settle(coins, events, limit = 6) {
  let t = 0;
  while (moving(coins) && t < limit) { step(coins, 1 / 60, events); t += 1 / 60; }
  for (const c of coins) { c.vx = 0; c.vy = 0; }
  return coins;
}

// Which bed a coin lies wholly inside: 1 (nearest) to 9, or 0 for none.
export function bedOf(c) {
  if (c.dead) return 0;
  const { r, side, w, line, beds } = BOARD;
  if (c.x - r < side + line / 2 || c.x + r > w - side - line / 2) return 0;
  for (let k = 1; k <= beds; k++) {
    if (c.y - r > lineY(k - 1) + line / 2 && c.y + r < lineY(k) - line / 2) return k;
  }
  return 0;
}

// A coin that doesn't reach the first line is picked up and played again.
export const shortOfFirst = c => !c.dead && c.y + BOARD.r < lineY(0);
