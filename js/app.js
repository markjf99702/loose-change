import { BOARD, lineY, makeCoin, strike, step, moving, bedOf, shortOfFirst } from './physics.js';
import { newMarks, bedCounts, scoreTurn, winner, left } from './rules.js';
import { REGULARS, chooseShot, wobble } from './ai.js';
import { FACES, layout, resetCaches, drawBoard, drawCoin, drawChalk, drawWanted } from './render.js';
import * as sound from './sound.js';

const KEY = 'loose-change.v1';
const COINS = 5;
const MIN_DIST = 200;          // the gentlest shove, in mm: not quite to the first line
const MAX_DIST = 700;          // a full-strength shove: off the far end
const MAX_ANGLE = 0.38;        // radians either side of straight up
const HURRY = 3;               // how much faster the computer plays while you hold a finger down

// The power ring runs from the gentlest shove to the hardest, so all of it is useful.
const distOf = power => MIN_DIST + power * (MAX_DIST - MIN_DIST);
const powerOf = dist => Math.max(0, Math.min(1, (dist - MIN_DIST) / (MAX_DIST - MIN_DIST)));

const $ = id => document.getElementById(id);
const canvas = $('board');
const g = canvas.getContext('2d');
let dpr = 1, view = null;

// ---- saved things --------------------------------------------------------------------------------------------

const OPPONENTS = [...REGULARS.map(r => r.id), 'pass', 'solo'];
const goodMarks = m => Array.isArray(m) && m.length === 2 &&
  m.every(row => Array.isArray(row) && row.length === BOARD.beds && row.every(n => Number.isInteger(n) && n >= 0 && n <= 3));
const goodGame = s => s && OPPONENTS.includes(s.opp) && (s.need === 1 || s.need === 3) && goodMarks(s.marks) &&
  (s.turn === 0 || s.turn === 1) && Number.isInteger(s.turns ?? 1);

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
const saved = load();
const prefs = {
  shots: Number(saved.shots) || 0,
  opp: OPPONENTS.includes(saved.opp) ? saved.opp : 'doris',
  need: saved.need === 3 ? 3 : 1,
  muted: !!saved.muted,
  record: saved.record && typeof saved.record === 'object' ? saved.record : {},
  best: saved.best && typeof saved.best === 'object' ? saved.best : {},
  lastPower: Array.isArray(saved.lastPower) ? saved.lastPower : [null, null],
};
let pendingGame = goodGame(saved.game) ? saved.game : null;

// What's saved for "Carry on" is always the start of a turn (game.snapshot), never a turn half played.
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...prefs, game: game ? game.snapshot : pendingGame }));
  } catch { /* storage off: the game still plays */ }
}
sound.setMuted(prefs.muted);

const recordKey = (opp, need) => `${opp}:${need}`;
const lengthName = need => (need === 3 ? 'pub rules' : 'quick games');

// ---- the game --------------------------------------------------------------------------------------------------

let game = null;
let nextId = 1;

function names(opp) {
  if (opp === 'pass') return ['Copper', 'Silver'];
  if (opp === 'solo') return ['You', ''];
  return ['You', REGULARS.find(r => r.id === opp)?.name ?? 'The regular'];
}
const isCpu = p => game.opp !== 'pass' && game.opp !== 'solo' && p === 1;
const isSolo = () => game.opp === 'solo';
const regular = () => REGULARS.find(r => r.id === game.opp);
// a player's name in the middle of a sentence
const nameIn = p => (game.opp !== 'pass' && !isSolo() && p === 0 ? 'you' : game.names[p]);

function newGame(opp, need, resume) {
  game = {
    opp, need,
    names: names(opp),
    marks: resume?.marks ? resume.marks.map(m => [...m]) : newMarks(),
    turn: resume?.turn ?? 0,
    turns: resume?.turns ?? 1,          // on your own: which turn this is
    hand: COINS, board: [], current: null,
    phase: 'aim', aim: null, chalk: null, fade: 0, falls: [],
    lastX: [BOARD.w / 2, BOARD.w / 2],
    clock: 0, timers: [],               // the game's own time: it stops while the menu is open
    cpu: null, winner: -1, snapshot: null,
  };
  pendingGame = null;
  startTurn(true);
}

// Run fn after `seconds` of game time.
function later(seconds, fn) { game.timers.push({ at: game.clock + seconds, fn }); }

function startTurn(announce) {
  game.hand = COINS; game.board = []; game.falls = [];
  // five coins out of the drawer, in a random order
  game.faces = FACES[game.turn].map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, COINS);
  game.snapshot = { opp: game.opp, need: game.need, marks: game.marks.map(m => [...m]), turn: game.turn, turns: game.turns };
  save();
  if (announce) {
    const who = game.names[game.turn];
    const togo = left(game.marks, game.turn, game.need);
    banner(isSolo() ? `Turn ${game.turns}` : game.opp === 'pass' ? `${who}'s turn` : game.turn === 0 ? 'Your turn' : `${who}'s turn`,
      `${togo} mark${togo === 1 ? '' : 's'} to go`, 1200);
  }
  nextCoin();
}

function nextCoin() {
  game.hand--;
  game.current = makeCoin(game.lastX[game.turn], nextId++);
  game.current.kind = game.turn;
  game.current.face = game.faces[game.hand % game.faces.length];
  game.board.push(game.current);
  game.phase = 'aim'; game.aim = null;
  hud();
  if (isCpu(game.turn)) game.cpu = { stage: 'think', t: 0, wait: 0.5 + Math.random() * 0.4 };
}

function shoot(angle, dist) {
  const c = game.current;
  if (!c) return;
  game.lastX[game.turn] = c.x;
  if (!isCpu(game.turn)) { prefs.lastPower[game.turn] = powerOf(dist); prefs.shots = (prefs.shots || 0) + 1; }
  strike(c, angle, dist);
  sound.shove(powerOf(dist));
  game.phase = 'rolling'; game.aim = null; game.current = null; game.cpu = null;
  hud();
}

function afterShot() {
  // coins that didn't reach the first line come back to the hand
  const short = game.board.filter(shortOfFirst);
  if (short.length) {
    game.board = game.board.filter(c => !short.includes(c));
    game.hand += short.length;
    banner('Short of the line', short.length > 1 ? 'Those come back' : 'That one comes back', 900);
  }
  game.board = game.board.filter(c => !c.dead);
  if (game.hand > 0) { nextCoin(); return; }
  scoreUp();
}

function scoreUp() {
  const counts = bedCounts(game.board);
  const before = game.marks.map(m => [...m]);
  let awarded = scoreTurn(game.marks, game.turn, counts, game.need);
  if (isSolo()) {
    // nobody to give spare marks to
    for (const a of awarded) if (a.gift) game.marks[a.player][a.bed]--;
    awarded = awarded.filter(a => !a.gift);
  }
  game.phase = 'scoring';
  game.scored = game.board.filter(c => bedOf(c));
  game.chalkMarks = before;                 // what's drawn so far
  const tally = before.map(m => [...m]);
  game.queue = awarded.map(a => ({ ...a, index: tally[a.player][a.bed]++ }));
  game.chalk = null;

  // Settle the result now, so a reload during the chalk can't replay or lose this turn.
  game.winner = isSolo() ? (left(game.marks, 0, game.need) === 0 ? 0 : -1) : winner(game.marks, game.need);
  if (game.winner >= 0) {
    game.snapshot = null;
    keepResult(game.winner);
  } else {
    game.snapshot = {
      opp: game.opp, need: game.need, marks: game.marks.map(m => [...m]),
      turn: isSolo() ? game.turn : 1 - game.turn, turns: isSolo() ? game.turns + 1 : game.turns,
    };
  }
  save();
  hud();

  const mine = awarded.filter(a => !a.gift).length, gifts = awarded.filter(a => a.gift).length;
  const marks = n => `${n} mark${n > 1 ? 's' : ''}`;
  let line = 'Nothing this time';
  if (mine && (isSolo() || game.opp === 'pass')) line = isSolo() ? marks(mine) : `${marks(mine)} for ${game.names[game.turn]}`;
  else if (mine) line = `${marks(mine)} for ${nameIn(game.turn)}`;
  const spare = counts.reduce((sum, n) => sum + n, 0) - mine - gifts;
  const giftLine = gifts ? `${gifts} given to ${nameIn(1 - game.turn)} from full beds` : '';
  let said = '';
  if (isCpu(1)) {
    const cpu = isCpu(game.turn);
    if (gifts) said = quip(cpu ? 'gave' : 'given');
    else if (mine >= 2) said = quip(cpu ? 'mine' : 'yours', 0.5);
  }
  banner(line, [giftLine || (isSolo() && spare > 0 ? `${spare} in beds already full` : ''), said], said ? 2000 : 1400);
  later(awarded.length ? 0.5 : 0.9, nextChalk);
}

function nextChalk() {
  if (game.phase !== 'scoring') return;
  const a = game.queue.shift();
  if (!a) {
    game.chalk = null;
    if (game.winner >= 0) return gameOver(game.winner);
    game.phase = 'clearing'; game.fade = 0;
    hud();
    return;
  }
  game.chalk = { ...a, t: 0 };
  sound.chalk();
  buzz(12);
}

function endClearing() {
  if (isSolo()) game.turns++;
  else game.turn = 1 - game.turn;
  startTurn(true);
}

// The record is kept as soon as the winning turn is scored.
function keepResult(w) {
  if (isSolo()) {
    const best = prefs.best[game.need];
    game.result = { best, beat: !best || game.turns < best };
    if (game.result.beat) prefs.best[game.need] = game.turns;
  } else if (game.opp !== 'pass') {
    const key = recordKey(game.opp, game.need);
    const r = prefs.record[key] || [0, 0];
    r[w === 0 ? 0 : 1]++;
    prefs.record[key] = r;
  }
}

function gameOver(w) {
  game.phase = 'over';
  hud();
  if (isSolo()) {
    const { best, beat } = game.result;
    sound.cheer();
    $('overTitle').textContent = 'Every bed filled';
    $('overText').textContent = `In ${game.turns} turn${game.turns === 1 ? '' : 's'}. ` +
      (beat ? (best ? `That beats your best of ${best}.` : 'That\'s your best so far.') : `Your best is ${best}.`);
  } else {
    const pass = game.opp === 'pass';
    if (w === 0 || pass) sound.cheer();
    $('overTitle').textContent = pass ? `${game.names[w]} wins` : w === 0 ? 'You win' : `${game.names[1]} wins`;
    const loser = left(game.marks, 1 - w, game.need);
    const rec = prefs.record[recordKey(game.opp, game.need)];
    const loserName = pass ? game.names[1 - w] : w === 0 ? game.names[1] : 'You';
    $('overText').textContent = `${loserName} had ${loser} mark${loser === 1 ? '' : 's'} to go.`
      + (rec && !pass ? ` Against ${game.names[1]} in ${lengthName(game.need)}: ${rec[0]} won, ${rec[1]} lost.` : '')
      + (pass ? '' : `\n${quip(w === 0 ? 'lost' : 'won', 1)}`);
  }
  later(0.9, () => show('over'));
}

// What the regulars say. Picked now and then, never every turn.
const QUIPS = {
  doris: {
    mine: ['Ooh, look at that.', 'Beginner\'s luck, at my age.', 'I do love this game.'],
    yours: ['Well done, love.', 'You\'ve played before.', 'Oh, very tidy.'],
    given: ['Ta very much.', 'Oh, for me? Thank you.'],
    gave: ['Oh, was that one full?', 'Silly me.'],
    won: ['Same time Tuesday?', 'Oh, I never win.'],
    lost: ['You go and get yourself a drink, love.'],
  },
  alan: {
    mine: ['BOOM.', 'Read it and weep.', 'That\'s how you shove.'],
    yours: ['Fluke.', 'Board\'s tilted your way.', 'Lucky.'],
    given: ['Cheers, mate.', 'I\'ll take that.'],
    gave: ['Board\'s crooked.', 'Meant that.'],
    won: ['Best of three?', 'Fluke. Again.'],
    lost: ['Get them in, then.'],
  },
  landlord: {
    mine: ['My board. My rules.', 'Forty years on this board.', 'Watch and learn.'],
    yours: ['Hm.', 'Not bad. For a Tuesday.', 'Steady hand.'],
    given: ['Generous of you.', 'Much obliged.'],
    gave: ['That one was deliberate.', 'Call it charity.'],
    won: ['Last orders.', 'Same again next week?'],
    lost: ['You can put your name on the board.'],
  },
};
function quip(kind, chance = 0.6) {
  const q = QUIPS[game.opp]?.[kind];
  if (!q || Math.random() > chance) return '';
  return `${game.names[1]}: “${q[Math.floor(Math.random() * q.length)]}”`;
}

// A tap of feedback on phones that have it.
const buzz = ms => { if (!prefs.muted) try { navigator.vibrate?.(ms); } catch { /* not allowed here */ } };

// ---- the computer's turn ----------------------------------------------------------------------------------------

// Think, slide the coin over, draw back, let go. Runs on game time, so the menu pauses it and a held
// finger hurries it.
function updateCpu(dt) {
  const cpu = game.cpu;
  if (!cpu || game.phase !== 'aim' || !game.current) return;
  cpu.t += dt;
  const c = game.current;
  if (cpu.stage === 'think' && cpu.t >= cpu.wait) {
    const who = regular();
    const others = game.board.filter(o => o !== c);
    const shot = wobble(chooseShot(others, game.marks, game.turn, game.need, who), who);
    shot.x = Math.max(BOARD.r, Math.min(BOARD.w - BOARD.r, shot.x));
    Object.assign(cpu, { stage: 'move', t: 0, shot, x0: c.x, dur: 0.45 + Math.abs(shot.x - c.x) * 0.003 });
  }
  if (cpu.stage === 'move') {
    const { shot, x0, dur } = cpu;
    const t = Math.min(1, cpu.t / dur);
    c.x = x0 + (shot.x - x0) * (1 - Math.pow(1 - t, 3));
    const pull = Math.max(0, (cpu.t - dur * 0.6) / 0.65);
    if (pull > 0) game.aim = { angle: shot.angle, power: Math.min(1, pull) * powerOf(shot.dist) };
    if (t >= 1 && pull >= 1) { cpu.stage = 'hold'; cpu.t = 0; }
  }
  if (cpu.stage === 'hold' && cpu.t >= 0.12) shoot(cpu.shot.angle, cpu.shot.dist);
}

// ---- input -----------------------------------------------------------------------------------------------------

const sheetOpen = () => !!document.querySelector('.sheet:not([hidden])');
// A phone on its side is asked to turn upright (.turn-me in css/app.css, the same query), and the game waits for it.
const sideways = matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
const paused = () => !$('menu').hidden || !$('rules').hidden || sideways.matches;

let drag = null;
let hurry = null;      // the pointer held down on the computer's turn, which runs its turn faster
canvas.addEventListener('pointerdown', e => {
  sound.wake();
  if (!game) return;
  if (isCpu(game.turn) || game.phase !== 'aim') {
    if (isCpu(game.turn)) { hurry = e.pointerId; canvas.setPointerCapture(e.pointerId); }
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  // A full shove is a long pull, but if you start low on the screen there's less room under your finger,
  // so the same ring fills in a shorter pull.
  const full = Math.min(300, view.ch * 0.42);
  const room = innerHeight - e.clientY - 12;
  const maxPull = Math.max(60, Math.min(full, room));
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, coinX: game.current.x, mode: null, maxPull };
});
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id || !game?.current || game.phase !== 'aim') return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.mode && Math.hypot(dx, dy) > 8) drag.mode = dy > Math.abs(dx) * 0.7 ? 'pull' : 'slide';
  if (drag.mode === 'slide') {
    game.current.x = Math.max(BOARD.r, Math.min(BOARD.w - BOARD.r, drag.coinX + dx / view.s));
  } else if (drag.mode === 'pull') {
    const len = dy > 0 ? Math.hypot(dx, dy) : 0;
    const angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.atan2(-dx, Math.max(1, dy))));
    game.aim = { angle, power: Math.min(1, len / drag.maxPull), human: true };
  }
});
const release = e => {
  if (e.pointerId === hurry) hurry = null;
  if (!drag || e.pointerId !== drag.id) return;
  const was = drag; drag = null;
  if (was.mode === 'pull' && game?.aim?.human && game.phase === 'aim') {
    if (game.aim.power > 0.04 && e.type === 'pointerup') shoot(game.aim.angle, distOf(game.aim.power));
    else game.aim = null;
  }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// keyboard: arrows move and angle, space or enter held down builds the shove
let keyPower = null;
const keyAim = () => (keyPower ? Math.min(1, (performance.now() - keyPower.t0) / 1600) : 0);
const shoveKey = e => e.key === ' ' || e.key === 'Enter';
addEventListener('keydown', e => {
  if (!game || game.phase !== 'aim' || isCpu(game.turn) || sheetOpen()) return;
  // Enter or space on a button (the menu) is for the button
  if (shoveKey(e) && e.target?.closest?.('button, a')) return;
  const c = game.current;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const sign = e.key === 'ArrowLeft' ? -1 : 1;
    if (keyPower) keyPower.angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, keyPower.angle + sign * 0.02));
    else c.x = Math.max(BOARD.r, Math.min(BOARD.w - BOARD.r, c.x + sign * 3));
    e.preventDefault();
  }
  if (shoveKey(e)) {
    e.preventDefault();
    if (!keyPower && !e.repeat) { sound.wake(); keyPower = { t0: performance.now(), angle: 0 }; }
  }
});
addEventListener('keyup', e => {
  if (!shoveKey(e) || !keyPower) return;
  const power = keyAim(), angle = keyPower.angle;
  keyPower = null;
  if (!game || game.phase !== 'aim' || isCpu(game.turn) || sheetOpen()) return;
  if (power > 0.04) shoot(angle, distOf(power));
  else game.aim = null;
});
addEventListener('blur', () => { keyPower = null; hurry = null; if (game?.aim?.human) game.aim = null; });

// ---- drawing ---------------------------------------------------------------------------------------------------

function resize() {
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  view = layout(r.width, r.height);
}
addEventListener('resize', resize);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (game && !paused()) update(hurry != null && isCpu(game.turn) ? dt * HURRY : dt);
  else sound.slide(0);
  draw(now);
  requestAnimationFrame(frame);
}
// A hidden tab gets no frames, and the frames are what turn the slide's hiss down, so hush it here.
document.addEventListener('visibilitychange', () => { if (document.hidden) sound.slide(0); });

function update(dt) {
  game.clock += dt;
  const due = game.timers.filter(t => t.at <= game.clock);
  if (due.length) {
    game.timers = game.timers.filter(t => t.at > game.clock);
    for (const t of due) t.fn();
  }
  if (keyPower) {
    if (game.phase === 'aim' && !isCpu(game.turn)) game.aim = { angle: keyPower.angle, power: keyAim(), human: true };
    else keyPower = null;
  }
  updateCpu(dt);
  if (game.phase === 'rolling') {
    let fastest = 0;
    step(game.board, dt, {
      onHit: v => { sound.clink(v); if (v > 150) buzz(6); },
      onFall: c => { game.falls.push({ c, t: 0 }); sound.drop(); },
    });
    for (const c of game.board) if (!c.dead) fastest = Math.max(fastest, Math.hypot(c.vx, c.vy));
    sound.slide(fastest);
    if (!moving(game.board)) { sound.slide(0); afterShot(); }
  }
  for (const f of game.falls) f.t += dt;
  game.falls = game.falls.filter(f => f.t < 0.6);
  if (game.phase === 'scoring' && game.chalk) {
    game.chalk.t = Math.min(1, game.chalk.t + dt / 0.32);
    if (game.chalk.t >= 1) {
      game.chalkMarks[game.chalk.player][game.chalk.bed]++;
      game.chalk = null;
      hud();
      later(0.14, nextChalk);
    }
  }
  if (game.phase === 'clearing') {
    game.fade += dt / 0.55;
    if (game.fade >= 1) endClearing();
  }
}

function draw(now) {
  const v = view;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, v.cw, v.ch);
  drawBoard(g, v, dpr);
  if (!game) { drawIdle(now); return; }

  if (game.phase === 'aim' && !isCpu(game.turn)) drawWanted(g, v, game.marks, game.turn, game.need);

  // chalk: during scoring, draw only what's been chalked so far plus the stroke in progress
  if (game.phase === 'scoring') {
    const shown = game.chalkMarks.map(m => [...m]);
    let fresh = null;
    if (game.chalk) { shown[game.chalk.player][game.chalk.bed]++; fresh = { ...game.chalk }; }
    drawChalk(g, v, shown, game.need, fresh);
  } else drawChalk(g, v, game.marks, game.need, null);

  // coins
  const scoring = game.phase === 'scoring';
  const fade = game.phase === 'clearing' ? game.fade : 0;
  for (const c of game.board) {
    if (c.dead) continue;
    const inBed = scoring && game.scored.includes(c);
    const counting = !scoring && !fade && (game.phase === 'aim' || game.phase === 'rolling') && !(c.vx || c.vy) && bedOf(c);
    const yOff = fade * 40;
    drawCoin(g, v, v.X(c.x), v.Y(c.y) + yOff, c.rot, c.kind, dpr, { face: c.face,
      alpha: 1 - fade, glow: inBed ? 'rgba(255,214,120,0.55)' : null,
    });
    if (counting) {
      g.strokeStyle = 'rgba(255,214,120,0.75)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(v.X(c.x), v.Y(c.y), BOARD.r * v.s + 3, 0, Math.PI * 2); g.stroke();
    }
  }
  for (const f of game.falls) {
    const c = f.c, k = f.t / 0.6;
    const x = f.c.fellAt.x + f.c.fellAt.vx * f.t * 0.3, y = f.c.fellAt.y + f.c.fellAt.vy * f.t * 0.3;
    drawCoin(g, v, v.X(x), v.Y(y), c.rot + k * 3, c.kind, dpr, { face: c.face, alpha: 1 - k, scale: 1 - k * 0.45, lift: -k * 6 });
  }

  // aim guide
  if (game.phase === 'aim' && game.current && game.aim) drawAim(game.current, game.aim);

  // the hand: coins still to play, below the board
  const hy = v.oy + v.bh + Math.min(48, (v.ch - v.oy - v.bh) / 2);
  const gap = BOARD.r * v.s * 2.4;
  const n = Math.max(0, game.hand);
  for (let i = 0; i < n; i++) {
    const x = v.cw / 2 + (i - (n - 1) / 2) * gap;
    drawCoin(g, v, x, hy, i * 1.3, game.turn, dpr, { scale: 0.9, face: game.faces[i % game.faces.length] });
  }
  if (game.phase === 'aim' && game.current) drawCaption(now, hy);
}

function drawAim(c, aim) {
  const v = view, s = v.s;
  const x = v.X(c.x), y = v.Y(c.y), r = BOARD.r * s;
  // direction: a short dashed line up the board
  const len = 70 * s;
  g.save();
  g.setLineDash([4, 5]);
  g.strokeStyle = 'rgba(255,235,200,0.55)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x + Math.sin(aim.angle) * r * 1.4, y - Math.cos(aim.angle) * r * 1.4);
  g.lineTo(x + Math.sin(aim.angle) * len, y - Math.cos(aim.angle) * len); g.stroke();
  g.setLineDash([]);
  // the pull: a short band back from the coin, longer the harder you shove
  const back = r * 1.75 + aim.power * 46;
  g.strokeStyle = 'rgba(255,235,200,0.35)'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x - Math.sin(aim.angle) * r * 1.75, y + Math.cos(aim.angle) * r * 1.75);
  g.lineTo(x - Math.sin(aim.angle) * back, y + Math.cos(aim.angle) * back); g.stroke();
  g.fillStyle = 'rgba(255,235,200,0.6)';
  g.beginPath(); g.arc(x - Math.sin(aim.angle) * back, y + Math.cos(aim.angle) * back, 4, 0, Math.PI * 2); g.fill();
  // power ring
  const R = r * 1.75;
  g.lineWidth = 5; g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.stroke();
  const hue = 45 - aim.power * 45;
  g.strokeStyle = `hsl(${hue}, 85%, 60%)`;
  g.beginPath(); g.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + aim.power * Math.PI * 2); g.stroke();
  // notch: your last shove
  const lp = aim.human ? prefs.lastPower[game.turn] : null;
  if (lp != null) {
    const a = -Math.PI / 2 + lp * Math.PI * 2;
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x + Math.cos(a) * (R - 6), y + Math.sin(a) * (R - 6)); g.lineTo(x + Math.cos(a) * (R + 6), y + Math.sin(a) * (R + 6)); g.stroke();
  }
  g.restore();
}

// Under the hand: what's being shoved, or how to shove it until you've got the hang of it.
function drawCaption(now, hy) {
  const v = view;
  const human = !isCpu(game.turn);
  const teach = human && !game.aim && !drag && (prefs.shots || 0) < 3;
  const a = teach ? 0.35 + 0.25 * Math.sin(now / 400) : 0.6;
  const who = game.opp === 'pass' ? game.names[game.turn] : human ? 'You' : game.names[game.turn];
  const text = teach ? 'Slide to place · pull back to shove'
    : `${who}: ${FACES[game.turn][game.current.face].name}${!human && hurry == null && game.cpu ? ' · hold to hurry' : ''}`;
  g.fillStyle = `rgba(243,231,214,${a})`;
  g.font = '500 13px Figtree, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const y = Math.min(v.ch - 12, hy + BOARD.r * v.s * 2.1);
  g.fillText(text, v.cw / 2, y);
}

// Behind the title screen: a few coins resting on the board.
const idle = [[160, 290, 0], [240, 352, 1], [110, 420, 0], [205, 455, 1], [300, 250, 0], [70, 180, 1]];
function drawIdle() {
  for (const [x, y, k] of idle) drawCoin(g, view, view.X(x), view.Y(y), x * 0.1, k, dpr);
}

// ---- the bar, banners and sheets -------------------------------------------------------------------------------

function hud() {
  if (!game) return;
  // while the chalk goes up, the counts follow the chalk
  const marks = game.phase === 'scoring' && game.chalkMarks ? game.chalkMarks : game.marks;
  for (const p of [0, 1]) {
    const el = $(`who${p}`);
    const togo = left(marks, p, game.need);
    if (isSolo() && p === 1) {
      el.querySelector('.name').textContent = `Turn ${game.turns}`;
      el.querySelector('.togo').textContent = '';
    } else {
      // on the narrowest phones "The Landlord" is just "Landlord"
      el.querySelector('.name').textContent = innerWidth < 360 ? game.names[p].replace(/^The /, '') : game.names[p];
      el.querySelector('.togo').textContent = String(togo);
      el.querySelector('.togo').title = `${togo} to go`;
    }
    el.classList.toggle('on', game.turn === p);
    el.classList.toggle('solo', isSolo() && p === 1);
  }
  let st = '';
  const thrown = COINS - game.hand;
  if (game.phase === 'aim' || game.phase === 'rolling') st = `Coin ${Math.min(COINS, thrown)} of ${COINS}`;
  if (game.phase === 'scoring' || game.phase === 'clearing') st = 'Chalking up';
  if (game.phase === 'over') st = 'Game over';
  $('status').textContent = st;
}

let bannerTimer = 0;
function banner(text, small = '', ms = 1200) {
  const b = $('banner');
  b.innerHTML = '';
  b.append(text);
  for (const line of [].concat(small)) {
    if (!line) continue;
    const s = document.createElement('small'); s.textContent = line; b.append(s);
  }
  b.hidden = false;
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}

function show(id) {
  for (const s of ['title', 'menu', 'rules', 'over']) $(s).hidden = s !== id;
  // a button on a sheet that just closed shouldn't keep the keyboard
  if (!id && document.activeElement?.closest?.('.sheet')) document.activeElement.blur();
}

let rulesFrom = 'title';
function buildTitle() {
  const box = $('opponents');
  box.innerHTML = '';
  const opts = [...REGULARS.map(r => ({ id: r.id, name: r.name, blurb: r.blurb })), { id: 'pass', name: 'Pass the phone', blurb: 'Two players, copper against silver' }, { id: 'solo', name: 'On your own', blurb: 'Fill every bed in as few turns as you can' }];
  for (const o of opts) {
    const b = document.createElement('button');
    b.dataset.opp = o.id;
    b.setAttribute('aria-pressed', String(prefs.opp === o.id));
    const rec = prefs.record[recordKey(o.id, prefs.need)];
    const best = o.id === 'solo' && prefs.best[prefs.need];
    b.innerHTML = `<b></b><span></span>${rec || best ? '<em class="rec"></em>' : ''}`;
    b.querySelector('b').textContent = o.name;
    b.querySelector('span').textContent = o.blurb;
    if (rec) b.querySelector('.rec').textContent = `${lengthName(prefs.need)[0].toUpperCase()}${lengthName(prefs.need).slice(1)}: won ${rec[0]}, lost ${rec[1]}`;
    if (best) b.querySelector('.rec').textContent = `Best: ${best} turn${best === 1 ? '' : 's'}`;
    b.onclick = () => { prefs.opp = o.id; save(); buildTitle(); };
    box.append(b);
  }
  for (const b of $('lengths').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.need) === prefs.need));
    b.onclick = () => { prefs.need = Number(b.dataset.need); save(); buildTitle(); };
  }
  const r = $('resumeBtn');
  r.hidden = !pendingGame;
  if (pendingGame) r.textContent = pendingGame.opp === 'pass' ? 'Carry on: copper against silver'
    : pendingGame.opp === 'solo' ? `Carry on: turn ${pendingGame.turns || 1} on your own` : `Carry on against ${names(pendingGame.opp)[1]}`;
}

let quitArmed = false;
function syncMenu() {
  $('soundBtn').textContent = `Sound: ${prefs.muted ? 'off' : 'on'}`;
  quitArmed = false;
  $('quitBtn').textContent = 'New game';
}
function toTitle() {
  game = null;
  save();
  buildTitle(); show('title'); clearHud();
}

$('startBtn').onclick = () => { sound.wake(); show(null); newGame(prefs.opp, prefs.need); };
$('resumeBtn').onclick = () => { if (!pendingGame) return; sound.wake(); const p = pendingGame; show(null); newGame(p.opp, p.need, p); };
$('rulesBtn').onclick = () => { rulesFrom = 'title'; show('rules'); };
$('menuRulesBtn').onclick = () => { rulesFrom = 'menu'; show('rules'); };
$('rulesClose').onclick = () => show(rulesFrom);
$('menuBtn').onclick = () => {
  if (game && game.phase !== 'over') { syncMenu(); show('menu'); }
  else { if (game) toTitle(); else { buildTitle(); show('title'); } }
};
$('backBtn').onclick = () => show(null);
$('quitBtn').onclick = () => {
  if (!quitArmed) { quitArmed = true; $('quitBtn').textContent = 'Tap again to give up this game'; return; }
  pendingGame = null;
  toTitle();
};
$('soundBtn').onclick = () => { prefs.muted = !prefs.muted; sound.setMuted(prefs.muted); save(); syncMenu(); };
$('againBtn').onclick = () => { if (!game) return; sound.wake(); show(null); const { opp, need } = game; newGame(opp, need); };
$('overMenuBtn').onclick = toTitle;
function clearHud() {
  for (const p of [0, 1]) { const el = $(`who${p}`); el.querySelector('.name').textContent = ''; el.querySelector('.togo').textContent = ''; el.classList.remove('on', 'solo'); }
  $('status').textContent = '';
}

// ---- start ---------------------------------------------------------------------------------------------------

resize();
buildTitle();
show('title');
requestAnimationFrame(frame);
document.fonts?.ready.then(() => { resetCaches(); resize(); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.LOOSE_CHANGE_ARTIFACT) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// for tests and screenshots
window.looseChange = { get game() { return game; }, newGame, shoot, BOARD, lineY, MAX_DIST };
