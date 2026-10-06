// Scoring, the pub way. Each player chalks up to `need` marks in each of the nine beds.
// A coin lying wholly in a bed scores a mark there. Once your bed is full, more coins in it chalk up for
// your opponent instead, unless that would be their winning mark: that one they have to score themselves.

import { BOARD, bedOf } from './physics.js';

export function newMarks() {
  return [Array(BOARD.beds).fill(0), Array(BOARD.beds).fill(0)];
}

export const full = (marks, p, need) => marks[p].every(m => m >= need);
export const left = (marks, p, need) => marks[p].reduce((s, m) => s + Math.max(0, need - m), 0);

// Count coins per bed (index 0 = bed 1).
export function bedCounts(coins) {
  const counts = Array(BOARD.beds).fill(0);
  for (const c of coins) { const b = bedOf(c); if (b) counts[b - 1]++; }
  return counts;
}

// Apply one turn's coins for player p. Returns the marks awarded, in order, for the chalk animation:
// [{ player, bed (0-based) }]. Mutates marks.
export function scoreTurn(marks, p, counts, need) {
  const o = 1 - p;
  const awarded = [];
  const spare = Array(BOARD.beds).fill(0);
  for (let b = 0; b < BOARD.beds; b++) {
    const room = Math.max(0, need - marks[p][b]);
    const mine = Math.min(room, counts[b]);
    for (let i = 0; i < mine; i++) { marks[p][b]++; awarded.push({ player: p, bed: b }); }
    spare[b] = counts[b] - mine;
  }
  for (let b = 0; b < BOARD.beds; b++) {
    for (let i = 0; i < spare[b]; i++) {
      if (marks[o][b] >= need) break;
      // the winning mark can't be given away
      if (left(marks, o, need) === 1) break;
      marks[o][b]++; awarded.push({ player: o, bed: b, gift: true });
    }
  }
  return awarded;
}

export function winner(marks, need) {
  if (full(marks, 0, need)) return 0;
  if (full(marks, 1, need)) return 1;
  return -1;
}
