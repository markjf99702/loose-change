import { BOARD, lineY, makeCoin, strike, step, moving, bedOf, shortOfFirst } from './physics.js';
import { newMarks, bedCounts, scoreTurn, winner, left } from './rules.js';
import { REGULARS, chooseShot, wobble } from './ai.js';
import { FACES, layout, resetCaches, drawBoard, drawCoin, drawChalk, drawWanted } from './render.js';
import * as sound from './sound.js';

const KEY = 'loose-change.v1';
const COINS = 5;
const MAX_DIST = 700;          // a full-strength shove, in mm
const MAX_ANGLE = 0.38;        // radians either side of straight up

const $ = id => document.getElementById(id);
const canvas = $('board');
const g = canvas.getContext('2d');
let dpr = 1, view = null;

// ---- saved things --------------------------------------------------------------------------------------------

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
const saved = load();
const prefs = { shots: saved.shots || 0, opp: saved.opp ?? 'doris', need: saved.need ?? 1, muted: !!saved.muted, record: saved.record || {}, best: saved.best || {}, lastPower: saved.lastPower || [null, null] };
let pendingGame = saved.game || null;
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      ...prefs,
      game: game && game.phase !== 'over' ? { opp: game.opp, need: game.need, marks: game.marks, turn: game.turn, turns: game.turns } : null,
    }));
  } catch { /* storage off: the game still plays */ }
}
sound.setMuted(prefs.muted);

// ---- the game --------------------------------------------------------------------------------------------------

let game = null;
let nextId = 1;

function names(opp) {
  if (opp === 'pass') return ['Copper', 'Silver'];
  if (opp === 'solo') return ['You', ''];
  return ['You', REGULARS.find(r => r.id === opp).name];
}
const isCpu = p => game.opp !== 'pass' && game.opp !== 'solo' && p === 1;
const isSolo = () => game.opp === 'solo';
const regular = () => REGULARS.find(r => r.id === game.opp);

function newGame(opp, need, resume) {
  game = {
    opp, need,
    names: names(opp),
    marks: resume?.marks || newMarks(),
    turn: resume?.turn ?? 0,
    turns: resume?.turns ?? 1,          // on your own: which turn this is
    hand: COINS, board: [], current: null,
    phase: 'aim', aim: null, chalk: null, fade: 0, falls: [],
    lastX: [BOARD.w / 2, BOARD.w / 2],
  };
  startTurn(true);
}

function startTurn(announce) {
  game.hand = COINS; game.board = []; game.falls = [];
  // five coins out of the drawer, in a random order
  game.faces = FACES[game.turn].map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, COINS);
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
  if (isCpu(game.turn)) cpuShot();
}

function shoot(angle, dist) {
  const c = game.current;
  game.lastX[game.turn] = c.x;
  if (!isCpu(game.turn)) { prefs.lastPower[game.turn] = dist / MAX_DIST; prefs.shots = (prefs.shots || 0) + 1; }
  strike(c, angle, dist);
  sound.shove(dist / MAX_DIST);
  game.phase = 'rolling'; game.aim = null; game.current = null;
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
  hud();
  const mine = awarded.filter(a => !a.gift).length, gifts = awarded.filter(a => a.gift).length;
  const who = game.names[game.turn];
  let line = mine === 0 ? 'Nothing this time' : `${mine} mark${mine > 1 ? 's' : ''}`;
  if (isSolo() && mine) line = `${mine} mark${mine > 1 ? 's' : ''}`;
  else if (game.opp !== 'pass' && game.turn === 0 && mine) line = `${mine} mark${mine > 1 ? 's' : ''} for you`;
  else if (mine) line = `${mine} mark${mine > 1 ? 's' : ''} for ${who}`;
  const spare = counts.reduce((sum, n) => sum + n, 0) - mine - gifts;
  const giftLine = gifts ? `${gifts} given to ${game.names[1 - game.turn]} from full beds` : '';
  let said = '';
  if (isCpu(1)) {
    const cpu = isCpu(game.turn);
    if (gifts) said = quip(cpu ? 'gave' : 'given');
    else if (mine >= 2) said = quip(cpu ? 'mine' : 'yours', 0.5);
  }
  banner(line, [giftLine || (isSolo() && spare > 0 ? `${spare} in beds already full` : ''), said], said ? 2000 : 1400);
  setTimeout(nextChalk, awarded.length ? 500 : 900);
}

function nextChalk() {
  if (!game || game.phase !== 'scoring') return;
  const a = game.queue.shift();
  if (!a) {
    game.chalk = null;
    const w = isSolo() ? (left(game.marks, 0, game.need) === 0 ? 0 : -1) : winner(game.marks, game.need);
    if (w >= 0) return gameOver(w);
    game.phase = 'clearing'; game.fade = 0;
    return;
  }
  game.chalk = { ...a, t: 0, start: performance.now() };
  sound.chalk();
  buzz(12);
}

function endClearing() {
  if (isSolo()) game.turns++;
  else game.turn = 1 - game.turn;
  startTurn(true);
}

function gameOver(w) {
  game.phase = 'over';
  hud();
  if (isSolo()) {
    const best = prefs.best[game.need];
    const record = !best || game.turns < best;
    if (record) prefs.best[game.need] = game.turns;
    save();
    sound.cheer();
    $('overTitle').textContent = 'Every bed filled';
    $('overText').textContent = `In ${game.turns} turn${game.turns === 1 ? '' : 's'}. ` +
      (record ? (best ? `That beats your best of ${best}.` : 'That\'s your best so far.') : `Your best is ${best}.`);
    setTimeout(() => show('over'), 900);
    return;
  }
  const pass = game.opp === 'pass';
  if (!pass) {
    const r = prefs.record[game.opp] || [0, 0];
    r[w === 0 ? 0 : 1]++;
    prefs.record[game.opp] = r;
  }
  save();
  if (w === 0 || pass) sound.cheer();
  $('overTitle').textContent = pass ? `${game.names[w]} wins` : w === 0 ? 'You win' : `${game.names[1]} wins`;
  const loser = left(game.marks, 1 - w, game.need);
  const rec = prefs.record[game.opp];
  $('overText').textContent = (pass ? `${game.names[1 - w]} had ${loser} mark${loser === 1 ? '' : 's'} to go.` :
    w === 0 ? `${game.names[1]} had ${loser} mark${loser === 1 ? '' : 's'} to go.` : `You had ${loser} mark${loser === 1 ? '' : 's'} to go.`)
    + (rec ? ` Against ${game.names[1]}: ${rec[0]} won, ${rec[1]} lost.` : '')
    + (pass ? '' : `\n${quip(w === 0 ? 'lost' : 'won', 1)}`);
  setTimeout(() => show('over'), 900);
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

function cpuShot() {
  const me = game;
  const who = regular();
  setTimeout(() => {
    if (game !== me || game.phase !== 'aim') return;
    const others = game.board.filter(c => c !== game.current);
    const plan = chooseShot(others, game.marks, game.turn, game.need, who);
    const shot = wobble(plan, who);
    shot.x = Math.max(BOARD.r, Math.min(BOARD.w - BOARD.r, shot.x));
    // slide the coin over, draw back, let go
    const c = game.current, x0 = c.x, t0 = performance.now();
    const dur = 450 + Math.abs(shot.x - x0) * 3;
    const anim = now => {
      if (game !== me || game.phase !== 'aim') return;
      const t = Math.min(1, (now - t0) / dur);
      c.x = x0 + (shot.x - x0) * (1 - Math.pow(1 - t, 3));
      const pull = Math.max(0, (now - t0 - dur * 0.6) / 650);
      if (pull > 0) game.aim = { angle: shot.angle, power: Math.min(1, pull) * Math.min(1, shot.dist / MAX_DIST) };
      if (t < 1 || pull < 1) requestAnimationFrame(anim);
      else setTimeout(() => { if (game === me && game.phase === 'aim') shoot(shot.angle, shot.dist); }, 120);
    };
    requestAnimationFrame(anim);
  }, 500 + Math.random() * 400);
}

// ---- input -----------------------------------------------------------------------------------------------------

let drag = null;
let hurry = false;     // a finger held down on the computer's turn runs its coins faster
canvas.addEventListener('pointerdown', e => {
  sound.wake();
  if (game && isCpu(game.turn)) { hurry = true; return; }
  if (!game || game.phase !== 'aim') return;
  canvas.setPointerCapture(e.pointerId);
  // A full shove is a long pull, but if you start low on the screen there's less room under your finger,
  // so the same ring fills in a shorter pull.
  const full = Math.min(300, view.ch * 0.42);
  const room = innerHeight - e.clientY - 12;
  const maxPull = Math.max(Math.min(full, 150), Math.min(full, room));
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, coinX: game.current.x, mode: null, maxPull };
});
canvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id || !game?.current) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.mode && Math.hypot(dx, dy) > 8) drag.mode = dy > Math.abs(dx) * 0.7 ? 'pull' : 'slide';
  if (drag.mode === 'slide') {
    game.current.x = Math.max(BOARD.r, Math.min(BOARD.w - BOARD.r, drag.coinX + dx / view.s));
  } else if (drag.mode === 'pull') {
    const maxPull = drag.maxPull;
    const len = Math.max(0, dy) > 0 ? Math.hypot(dx, dy) : 0;
    const angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.atan2(-dx, Math.max(1, dy))));
    game.aim = { angle, power: Math.min(1, len / maxPull), human: true };
  }
});
const release = e => {
  hurry = false;
  if (!drag || e.pointerId !== drag.id) return;
  const was = drag; drag = null;
  if (was.mode === 'pull' && game?.aim && game.phase === 'aim') {
    if (game.aim.power > 0.04 && e.type === 'pointerup') shoot(game.aim.angle, game.aim.power * MAX_DIST);
    else game.aim = null;
  }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// keyboard: arrows move and angle, space or enter holds to build power
let keyPower = null;
addEventListener('keydown', e => {
  if (!game || game.phase !== 'aim' || isCpu(game.turn) || !$('title').hidden || !$('menu').hidden) return;
  const c = game.current;
  if (e.key === 'ArrowLeft' && !keyPower) { c.x = Math.max(BOARD.r, c.x - 3); e.preventDefault(); }
  if (e.key === 'ArrowRight' && !keyPower) { c.x = Math.min(BOARD.w - BOARD.r, c.x + 3); e.preventDefault(); }
  if ((e.key === ' ' || e.key === 'Enter') && !keyPower && !e.repeat) {
    sound.wake();
    keyPower = { t0: performance.now(), angle: game.aim?.angle || 0 }; e.preventDefault();
  }
  if (keyPower && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    keyPower.angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, keyPower.angle + (e.key === 'ArrowLeft' ? -0.02 : 0.02)));
    e.preventDefault();
  }
});
addEventListener('keyup', e => {
  if ((e.key === ' ' || e.key === 'Enter') && keyPower && game?.phase === 'aim' && game.aim) {
    shoot(game.aim.angle, game.aim.power * MAX_DIST);
    keyPower = null;
  }
});

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
  if (game) update(dt, now);
  draw(now);
  requestAnimationFrame(frame);
}

function update(dt, now) {
  if (keyPower && game.phase === 'aim') {
    const t = (now - keyPower.t0) / 1600;
    game.aim = { angle: keyPower.angle, power: Math.min(1, t), human: true };
  }
  if (game.phase === 'rolling') {
    let fastest = 0;
    step(game.board, hurry && isCpu(game.turn) ? dt * 3 : dt, {
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
    game.chalk.t = Math.min(1, (now - game.chalk.start) / 320);
    if (game.chalk.t >= 1) {
      game.chalkMarks[game.chalk.player][game.chalk.bed]++;
      game.chalk = null;
      setTimeout(nextChalk, 140);
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
  const text = teach ? 'Slide to place · pull back to shove' : `${who}: ${FACES[game.turn][game.current.face].name}`;
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
  for (const p of [0, 1]) {
    const el = $(`who${p}`);
    const togo = left(game.marks, p, game.need);
    if (isSolo() && p === 1) {
      el.querySelector('.name').textContent = `Turn ${game.turns}`;
      el.querySelector('.togo').textContent = '';
    } else {
      el.querySelector('.name').textContent = game.names[p];
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
    const rec = prefs.record[o.id];
    const best = o.id === 'solo' && prefs.best[prefs.need];
    b.innerHTML = `<b></b><span></span>${rec || best ? '<em class="rec"></em>' : ''}`;
    b.querySelector('b').textContent = o.name;
    b.querySelector('span').textContent = o.blurb;
    if (rec) b.querySelector('.rec').textContent = `Won ${rec[0]}, lost ${rec[1]}`;
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

$('startBtn').onclick = () => { sound.wake(); pendingGame = null; show(null); newGame(prefs.opp, prefs.need); };
$('resumeBtn').onclick = () => { sound.wake(); const p = pendingGame; pendingGame = null; show(null); newGame(p.opp, p.need, p); };
$('rulesBtn').onclick = () => { rulesFrom = 'title'; show('rules'); };
$('menuRulesBtn').onclick = () => { rulesFrom = 'menu'; show('rules'); };
$('rulesClose').onclick = () => show(rulesFrom);
$('menuBtn').onclick = () => { if (game && game.phase !== 'over') { syncSound(); show('menu'); } else { buildTitle(); show('title'); } };
$('backBtn').onclick = () => show(null);
$('quitBtn').onclick = () => { game = null; save(); pendingGame = null; buildTitle(); show('title'); clearHud(); };
$('soundBtn').onclick = () => { prefs.muted = !prefs.muted; sound.setMuted(prefs.muted); save(); syncSound(); };
$('againBtn').onclick = () => { sound.wake(); show(null); const { opp, need } = game; newGame(opp, need); };
$('overMenuBtn').onclick = () => { game = null; buildTitle(); show('title'); clearHud(); };
function syncSound() { $('soundBtn').textContent = `Sound: ${prefs.muted ? 'off' : 'on'}`; }
function clearHud() {
  for (const p of [0, 1]) { const el = $(`who${p}`); el.querySelector('.name').textContent = ''; el.querySelector('.togo').textContent = ''; el.classList.remove('on'); }
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
