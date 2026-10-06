// Physics, scoring and the regulars, headless:  node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, lineY, makeCoin, strike, settle, step, bedOf, shortOfFirst, moving } from '../js/physics.js';
import { newMarks, scoreTurn, winner, left, full, bedCounts } from '../js/rules.js';
import { REGULARS, chooseShot, wobble, value } from '../js/ai.js';

const mid = k => (lineY(k - 1) + lineY(k)) / 2;           // middle of bed k (1..9)
const at = (x, y, extra = {}) => ({ ...makeCoin(x), y, ...extra });
const seeded = (s = 1) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

// ---- physics ----------------------------------------------------------------------------------------------------

test('a lone coin slides the distance strike() asks for', () => {
  for (const d of [80, 250, 400, 580]) {
    const c = makeCoin(BOARD.w / 2);
    strike(c, 0, d);
    settle([c]);
    assert.ok(Math.abs(c.y - BOARD.startY - d) < 3, `asked ${d}, went ${c.y - BOARD.startY}`);
    assert.ok(Math.abs(c.x - BOARD.w / 2) < 1e-6);
    assert.equal(moving([c]), false);
  }
});

test('an angled shot travels the same distance along its line', () => {
  const c = makeCoin(BOARD.w / 2);
  strike(c, 0.2, 400);
  settle([c]);
  const d = Math.hypot(c.x - BOARD.w / 2, c.y - BOARD.startY);
  assert.ok(Math.abs(d - 400) < 3, `went ${d}`);
  assert.ok(Math.abs(Math.atan2(c.x - BOARD.w / 2, c.y - BOARD.startY) - 0.2) < 1e-6);
});

test('bedOf: inside a bed scores, touching a line does not', () => {
  for (let k = 1; k <= 9; k++) assert.equal(bedOf(at(BOARD.w / 2, mid(k))), k);
  const { r, line } = BOARD;
  // just clear of the lines either side of bed 3
  assert.equal(bedOf(at(178, lineY(2) + line / 2 + r + 0.05)), 3);
  assert.equal(bedOf(at(178, lineY(3) - line / 2 - r - 0.05)), 3);
  // touching them
  assert.equal(bedOf(at(178, lineY(2) + line / 2 + r - 0.05)), 0);
  assert.equal(bedOf(at(178, lineY(3) - line / 2 - r + 0.05)), 0);
  // straddling a line
  assert.equal(bedOf(at(178, lineY(4))), 0);
  // short of the first line or past the last
  assert.equal(bedOf(at(178, lineY(0) - 20)), 0);
  assert.equal(bedOf(at(178, lineY(9) + 20)), 0);
  // dead coins never score
  assert.equal(bedOf(at(178, mid(5), { dead: true })), 0);
});

test('bedOf: in the side gutters, or touching a side line, does not score', () => {
  const { r, side, w, line } = BOARD;
  assert.equal(bedOf(at(side / 2, mid(4))), 0);
  assert.equal(bedOf(at(w - side / 2, mid(4))), 0);
  assert.equal(bedOf(at(side + line / 2 + r - 0.1, mid(4))), 0);
  assert.equal(bedOf(at(w - side - line / 2 - r + 0.1, mid(4))), 0);
  assert.equal(bedOf(at(side + line / 2 + r + 0.1, mid(4))), 4);
  assert.equal(bedOf(at(w - side - line / 2 - r - 0.1, mid(4))), 4);
});

test('shortOfFirst: only coins wholly short of the first line come back', () => {
  assert.equal(shortOfFirst(at(178, BOARD.startY)), true);
  assert.equal(shortOfFirst(at(178, lineY(0) - BOARD.r - 1)), true);
  assert.equal(shortOfFirst(at(178, lineY(0) - BOARD.r + 1)), false);   // touching the line
  assert.equal(shortOfFirst(at(178, mid(1))), false);
  assert.equal(shortOfFirst(at(178, 50, { dead: true })), false);
});

test('coin on coin: momentum roughly kept, target knocked forward', () => {
  const target = at(178, 300, { id: 1 });
  const shooter = makeCoin(178, 2);
  strike(shooter, 0, 500);
  const coins = [target, shooter];
  let hits = 0, p0 = shooter.vy, pAfter = null;
  // step finely until just after the first knock
  for (let i = 0; i < 2000 && !hits; i++) step(coins, 1 / 600, { onHit: () => hits++ });
  assert.equal(hits, 1, 'they should touch');
  pAfter = target.vy + shooter.vy;
  // friction acts on the way up, so compare against the shooter's speed just before impact
  const before = Math.sqrt(p0 * p0 - 2 * 2400 * (300 - 2 * BOARD.r - BOARD.startY));
  assert.ok(Math.abs(pAfter - before) / before < 0.05, `momentum ${before} -> ${pAfter}`);
  assert.ok(target.vy > shooter.vy, 'target should leave faster than the shooter');
  assert.ok(Math.abs(target.vx) < 1e-6 && Math.abs(shooter.vx) < 1e-6, 'a head-on knock stays straight');
  settle(coins);
  assert.ok(target.y > 300 + 20, `target moved to ${target.y}`);
  assert.ok(Math.hypot(target.x - shooter.x, target.y - shooter.y) >= 2 * BOARD.r - 0.01, 'no overlap at rest');
});

test('off the sides or the far end, a coin is dead', () => {
  const falls = [];
  const right = makeCoin(BOARD.w - 20); strike(right, 0.6, 300);
  const left_ = makeCoin(20); strike(left_, -0.6, 300);
  const far = makeCoin(178); strike(far, 0, 900);
  const stays = makeCoin(178); stays.x = 100; strike(stays, 0, 350);
  settle([right, left_, far, stays], { onFall: c => falls.push(c) });
  assert.equal(right.dead, true);
  assert.equal(left_.dead, true);
  assert.equal(far.dead, true);
  assert.equal(stays.dead, false);
  assert.equal(falls.length, 3);
  for (const c of [right, left_, far]) { assert.equal(bedOf(c), 0); assert.ok(c.fellAt); }
});

test('a coin knocked off the end by another is dead too', () => {
  const near = at(178, BOARD.h - 14, { id: 1 });
  const shooter = makeCoin(178, 2);
  strike(shooter, 0, 680);
  settle([near, shooter]);
  assert.equal(near.dead, true);
});

// ---- rules ------------------------------------------------------------------------------------------------------

const counts = obj => { const c = Array(9).fill(0); for (const [b, n] of Object.entries(obj)) c[b - 1] = n; return c; };

test('bedCounts counts coins per bed and ignores the rest', () => {
  const c = bedCounts([at(178, mid(2)), at(120, mid(2)), at(178, mid(7)), at(178, lineY(3)), at(178, mid(5), { dead: true })]);
  assert.deepEqual(c, counts({ 2: 2, 7: 1 }));
});

test('scoreTurn: ordinary marks', () => {
  const m = newMarks();
  const a = scoreTurn(m, 0, counts({ 1: 1, 4: 2, 9: 1 }), 3);
  assert.deepEqual(m[0], [1, 0, 0, 2, 0, 0, 0, 0, 1]);
  assert.deepEqual(m[1], Array(9).fill(0));
  assert.equal(a.length, 4);
  assert.ok(a.every(x => x.player === 0 && !x.gift));
});

test('scoreTurn: extra coins in a full bed go to the opponent', () => {
  const m = newMarks();
  m[0][2] = 2;
  const a = scoreTurn(m, 0, counts({ 3: 3 }), 3);
  assert.equal(m[0][2], 3);
  assert.equal(m[1][2], 2);
  assert.equal(a.filter(x => x.gift).length, 2);
  assert.ok(a.filter(x => x.gift).every(x => x.player === 1 && x.bed === 2));
});

test('scoreTurn: a gift is capped by the room the opponent has', () => {
  const m = newMarks();
  m[0][5] = 3; m[1][5] = 2;
  scoreTurn(m, 0, counts({ 6: 4 }), 3);
  assert.equal(m[0][5], 3);
  assert.equal(m[1][5], 3);
});

test('scoreTurn: the winning mark cannot be given away', () => {
  const m = newMarks();
  m[0] = Array(9).fill(1); m[0][0] = 0;                // player 0 needs only bed 1
  m[1][0] = 1;                                         // player 1 has bed 1 full
  const a = scoreTurn(m, 1, counts({ 1: 2 }), 1);
  assert.equal(m[0][0], 0, 'player 0 must score the last one themselves');
  assert.equal(a.length, 0);
  assert.equal(winner(m, 1), -1);
  // with two to go, one gift is allowed but not the second
  const n = newMarks();
  n[0] = Array(9).fill(3); n[0][4] = 1;
  n[1][4] = 3;
  const b = scoreTurn(n, 1, counts({ 5: 3 }), 3);
  assert.equal(n[0][4], 2);
  assert.equal(b.length, 1);
  assert.equal(left(n, 0, 3), 1);
});

test('scoreTurn: quick game, one mark a bed', () => {
  const m = newMarks();
  scoreTurn(m, 0, counts({ 2: 1, 3: 2 }), 1);
  assert.deepEqual(m[0], [0, 1, 1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(m[1], [0, 0, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(left(m, 0, 1), 7);
});

test('winner', () => {
  const m = newMarks();
  assert.equal(winner(m, 1), -1);
  m[1] = Array(9).fill(1);
  assert.equal(winner(m, 1), 1);
  assert.equal(winner(m, 3), -1);
  m[0] = Array(9).fill(3);
  assert.equal(winner(m, 3), 0);
  assert.equal(full(m, 0, 3), true);
});

test('finishing your own board in a turn wins it', () => {
  const m = newMarks();
  m[0] = Array(9).fill(1); m[0][8] = 0;
  scoreTurn(m, 0, counts({ 9: 1 }), 1);
  assert.equal(winner(m, 1), 0);
});

// ---- the regulars -----------------------------------------------------------------------------------------------

test('chooseShot returns a sensible, finite shot quickly for every regular', () => {
  const marks = newMarks();
  marks[1][3] = 1;
  const board = [at(150, mid(4)), at(220, mid(2) + 10), at(90, 120)];
  for (const who of REGULARS) {
    for (const need of [1, 3]) {
      const t0 = performance.now();
      const s = chooseShot(board, marks, 1, need, who, seeded(7));
      const ms = performance.now() - t0;
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.angle) && Number.isFinite(s.dist), JSON.stringify(s));
      assert.ok(s.x >= 0 && s.x <= BOARD.w, `x ${s.x}`);
      assert.ok(Math.abs(s.angle) < 0.4, `angle ${s.angle}`);
      assert.ok(s.dist > lineY(0) - BOARD.startY && s.dist < 700, `dist ${s.dist}`);
      assert.ok(ms < 250, `${who.name} took ${ms.toFixed(0)}ms`);
      const w = wobble(s, who, seeded(3));
      assert.ok(Number.isFinite(w.x + w.angle + w.dist));
    }
  }
});

test('chooseShot on an empty board aims into a bed it needs', () => {
  const marks = newMarks();
  marks[0] = [1, 1, 1, 1, 0, 1, 1, 1, 1];                // only bed 5 wanted
  for (const who of REGULARS) {
    let hit = 0;
    for (let i = 0; i < 10; i++) {
      const s = chooseShot([], marks, 0, 1, who, seeded(i + 1));
      const c = makeCoin(s.x); strike(c, s.angle, s.dist); settle([c]);
      if (bedOf(c) === 5) hit++;
    }
    assert.ok(hit >= 9, `${who.name} planned bed 5 only ${hit}/10 times`);
  }
});

test('value prefers a coin in a needed bed over a full one', () => {
  const marks = newMarks();
  marks[0][2] = 1;
  const good = value([at(178, mid(4))], marks, 0, 1);
  const bad = value([at(178, mid(3))], marks, 0, 1);
  assert.ok(good > bad);
  assert.ok(bad < 0, 'a gift to the opponent should count against you');
});
