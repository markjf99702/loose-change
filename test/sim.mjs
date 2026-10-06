// Headless matches between the regulars and a model of a decent human, for tuning ai.js.
//   node test/sim.mjs [games=400] [need=1]
// Prints each regular's win rate against the human model (human goes first in half the games),
// average turns per game, chooseShot time, and how often anything silly happened.
import { BOARD, lineY, makeCoin, strike, settle, bedOf, shortOfFirst } from '../js/physics.js';
import { newMarks, bedCounts, scoreTurn, winner } from '../js/rules.js';
import { REGULARS, chooseShot, wobble } from '../js/ai.js';

const COINS = 5;
const gauss = rnd => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
export const seeded = (s = 1) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

// A decent human: picks a bed they still need, slides the coin to a clear lane, shoves straight at the middle.
export function humanShot(board, marks, p, need, rnd, noise = { dist: 0.025, angle: 0.01 }) {
  const wanted = [];
  for (let b = 0; b < 9; b++) if (marks[p][b] < need) wanted.push(b);
  if (!wanted.length) wanted.push(4);
  const b = wanted[Math.floor(rnd() * wanted.length)];
  const mid = (lineY(b) + lineY(b + 1)) / 2;
  const lo = BOARD.side + BOARD.r + 4, hi = BOARD.w - BOARD.side - BOARD.r - 4;
  let best = null, bestGap = -1;
  for (let i = 0; i < 6; i++) {
    const x = lo + rnd() * (hi - lo);
    let gap = 999;
    for (const c of board) if (!c.dead && c.y < mid + 2 * BOARD.r) gap = Math.min(gap, Math.abs(c.x - x));
    if (gap > bestGap) { bestGap = gap; best = x; }
  }
  return { x: best, angle: gauss(rnd) * noise.angle, dist: (mid - BOARD.startY) * (1 + gauss(rnd) * noise.dist) };
}

// Play one turn of five coins for player p. `pick(board) -> shot`. Returns stats.
function turn(marks, p, need, pick, stats) {
  let hand = COINS, board = [], shots = 0, shorts = 0;
  while (hand > 0) {
    if (++shots > 40) { stats.stuck++; break; }
    hand--;
    const s = pick(board);
    s.x = Math.max(BOARD.r, Math.min(BOARD.w - BOARD.r, s.x));
    const c = makeCoin(s.x, shots);
    board.push(c);
    strike(c, s.angle, s.dist);
    settle(board, {}, 8);
    const short = board.filter(shortOfFirst);
    if (short.length) { shorts += short.length; board = board.filter(x => !short.includes(x)); hand += short.length; }
    board = board.filter(x => !x.dead);
  }
  stats.shorts += shorts; stats.shots += shots;
  const counts = bedCounts(board);
  const a = scoreTurn(marks, p, counts, need);
  stats.gifts[p] += a.filter(x => x.gift).length;
  stats.marks[p] += a.filter(x => !x.gift).length;
}

export function playGame(players, need, rnd, first = 0) {
  const marks = newMarks();
  const stats = { stuck: 0, shorts: 0, shots: 0, gifts: [0, 0], marks: [0, 0], turns: 0, ms: 0, cpu: 0 };
  let p = first;
  for (let t = 0; t < 200; t++) {
    stats.turns++;
    const pl = players[p];
    turn(marks, p, need, board => {
      if (pl === 'human') return humanShot(board, marks, p, need, rnd);
      const t0 = performance.now();
      const plan = chooseShot(board, marks, p, need, pl, rnd);
      stats.ms += performance.now() - t0; stats.cpu++;
      return wobble(plan, pl, rnd);
    }, stats);
    const w = winner(marks, need);
    if (w >= 0) return { w, stats };
    p = 1 - p;
  }
  return { w: -1, stats };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const games = Number(process.argv[2] || 400), need = Number(process.argv[3] || 1);
  const only = process.argv[4];
  // TUNE='{"alan":{"dist":0.03}}' tries other settings without editing ai.js
  const tune = JSON.parse(process.env.TUNE || '{}');
  for (const r of REGULARS) Object.assign(r, tune[r.id] || {});
  for (const who of REGULARS.filter(r => !only || r.id === only)) {
    let human = 0, turns = 0, ms = 0, cpu = 0, stuck = 0, shorts = 0, shots = 0, cpuGifts = 0, cpuMarks = 0;
    const rnd = seeded(12345);
    for (let g = 0; g < games; g++) {
      const first = g % 2;
      const { w, stats } = playGame(['human', who], need, rnd, first);
      if (w === 0) human++;
      turns += stats.turns; ms += stats.ms; cpu += stats.cpu; stuck += stats.stuck; shorts += stats.shorts; shots += stats.shots;
      cpuGifts += stats.gifts[1]; cpuMarks += stats.marks[1];
    }
    console.log(`${who.name.padEnd(13)} human wins ${(100 * human / games).toFixed(1)}%  turns/game ${(turns / games).toFixed(1)}  ` +
      `chooseShot ${(ms / cpu).toFixed(1)}ms  shorts/shot ${(shorts / shots).toFixed(3)}  stuck ${stuck}  cpu gifts/marks ${cpuGifts}/${cpuMarks}`);
  }
}
