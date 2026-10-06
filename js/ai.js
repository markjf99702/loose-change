// The pub regulars. Each one tries a pile of shots on a copy of the board, keeps the best, then plays it
// with their own unsteady hand.

import { BOARD, lineY, makeCoin, strike, settle, bedOf, shortOfFirst } from './physics.js';

// tries: shots considered. dist, angle, x: how unsteady the hand is (fraction, radians, mm).
// think: 1 takes the best-looking shot, 2-3 also check it still works with their own wobble.
// knock: share of tries spent knocking coins already up the board. far: leaning towards the far beds.
// hard: how much harder than planned the shove comes out (a fraction of the distance), and push: extra
// welly put into knock-ons. firm: a liking for firm shots when there's little to choose between them.
export const REGULARS = [
  { id: 'doris', name: 'Doris', blurb: 'Plays Tuesdays. Means well.',
    tries: 40, dist: 0.046, angle: 0.016, x: 3, think: 1, knock: 0.15, far: 0, hard: 0, push: 0, firm: 0 },
  { id: 'alan', name: 'Big Alan', blurb: 'Hits everything hard.',
    tries: 150, dist: 0.026, angle: 0.009, x: 2, think: 1, knock: 0.6, far: 0.5, hard: 0.008, push: 60, firm: 0.0008 },
  { id: 'landlord', name: 'The Landlord', blurb: 'His board. His rules.',
    tries: 200, dist: 0.029, angle: 0.010, x: 1, think: 3, knock: 0.3, far: 0, hard: 0, push: 0, firm: 0 },
];

const gauss = rnd => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const MAX = 700;   // a full-strength shove, as in app.js
const clone = coins => coins.map(c => ({ ...c }));

// How good a board is for player p at this point in their turn.
export function value(coins, marks, p, need) {
  const o = 1 - p;
  const counts = Array(BOARD.beds).fill(0);
  let v = 0;
  for (const c of coins) {
    const b = bedOf(c);
    if (b) { counts[b - 1]++; continue; }
    if (c.dead) { v -= 0.05; continue; }
    if (shortOfFirst(c)) continue;
    // a coin resting near the middle of a bed it still needs can be knocked in later
    for (let k = 1; k <= BOARD.beds; k++) {
      const mid = (lineY(k - 1) + lineY(k)) / 2;
      if (Math.abs(c.y - mid) < BOARD.bed && marks[p][k - 1] < need) v += 0.08 * (1 - Math.abs(c.y - mid) / BOARD.bed);
    }
  }
  for (let b = 0; b < BOARD.beds; b++) {
    const room = Math.max(0, need - marks[p][b]);
    const mine = Math.min(room, counts[b]);
    v += mine * (1 + b * 0.02);           // far beds are a little harder to come back for
    const spare = counts[b] - mine;
    if (spare > 0 && marks[o][b] < need) v -= 0.9 * Math.min(spare, need - marks[o][b]);
  }
  return v;
}

function candidates(coins, marks, p, need, who, rnd) {
  const n = who.tries;
  const shots = [];
  const wanted = [];
  for (let b = 0; b < BOARD.beds; b++) if (marks[p][b] < need) wanted.push(b);
  if (!wanted.length) wanted.push(4);
  const lo = BOARD.side + BOARD.r + 3, hi = BOARD.w - BOARD.side - BOARD.r - 3;
  const onBoard = coins.filter(c => !c.dead && c.y > lineY(0) - BOARD.r);
  for (let i = 0; i < n; i++) {
    if (onBoard.length && rnd() < who.knock) {
      // knock a coin already up there
      const t = onBoard[Math.floor(rnd() * onBoard.length)];
      const x = Math.min(hi, Math.max(lo, t.x + (rnd() - 0.5) * 30));
      const dx = t.x - x, dy = t.y - BOARD.startY;
      const angle = Math.atan2(dx, dy) + (rnd() - 0.5) * 0.04;
      shots.push({ x, angle, dist: Math.min(MAX, Math.hypot(dx, dy) + 15 + rnd() * (90 + who.push)) });
    } else {
      // with `far`, the far beds are picked more often
      const b = wanted[Math.floor(Math.pow(rnd(), 1 - who.far * 0.6) * wanted.length)] ?? wanted[wanted.length - 1];
      const mid = (lineY(b) + lineY(b + 1)) / 2;
      const x = lo + rnd() * (hi - lo);
      const angle = (rnd() - 0.5) * 0.12;
      const tx = x + Math.sin(angle) * (mid - BOARD.startY);
      if (tx < lo || tx > hi) { i--; continue; }
      shots.push({ x, angle, dist: (mid - BOARD.startY) / Math.cos(angle) + (rnd() - 0.5) * 10 });
    }
  }
  return shots;
}

function play(coins, shot) {
  const sim = clone(coins);
  const c = makeCoin(shot.x, -1);
  sim.push(c);
  strike(c, shot.angle, shot.dist);
  settle(sim, {}, 5);
  return sim;
}

export function wobble(shot, who, rnd = Math.random) {
  return {
    x: shot.x + gauss(rnd) * who.x,
    angle: shot.angle + gauss(rnd) * who.angle,
    dist: shot.dist * (1 + (who.hard || 0) + gauss(rnd) * who.dist),
  };
}

// Pick a shot for player p. `coins` is what's on the board now (this turn's coins).
export function chooseShot(coins, marks, p, need, who, rnd = Math.random) {
  const shots = candidates(coins, marks, p, need, who, rnd);
  const scored = shots.map(s => ({ s, v: value(play(coins, s), marks, p, need) + (who.firm || 0) * s.dist }));
  scored.sort((a, b) => b.v - a.v);
  if (who.think < 2) return scored[0].s;
  // the better players think about their own hand: keep the shots that still work when they wobble a bit
  const top = scored.slice(0, who.think === 3 ? 10 : 5);
  let best = top[0], bestV = -Infinity;
  for (const t of top) {
    let sum = 0;
    const k = who.think === 3 ? 8 : 4;
    for (let i = 0; i < k; i++) sum += value(play(coins, wobble(t.s, who, rnd)), marks, p, need);
    if (sum / k > bestV) { bestV = sum / k; best = t; }
  }
  return best.s;
}
