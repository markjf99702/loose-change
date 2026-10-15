// Plays Loose Change in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Built on the junkdrawer kit skeleton. PORT=8092 by default.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
let down = false;   // while it's true the server drops every connection, like a phone with no signal
const server = createServer(async (req, res) => {
  if (down) { req.socket.destroy(); return; }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(Number(process.env.PORT || 8092));
await new Promise(r => server.once('listening', r));
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const problems = [];
const watch = p => {
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  p.on('requestfailed', r => problems.push('failed: ' + r.url()));
  p.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('left the site: ' + r.url()); });
  return p;
};
const page = watch(await ctx.newPage());

const step = msg => console.log('  ' + msg);
try {
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Nothing behind an open sheet takes the keyboard: the first Tab lands on the title card, not the menu button under it.
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('#title')), 'the first Tab should land on the title card: ' + await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));

  // Choosing an opponent from the keyboard leaves the keyboard on that button.
  await page.focus('#opponents button[data-opp="alan"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.getAttribute('#opponents button[data-opp="alan"]', 'aria-pressed'), 'true', 'Enter should pick Big Alan');
  assert.equal(await page.evaluate(() => document.activeElement.dataset?.opp), 'alan', 'the opponent chosen from the keyboard should keep the focus');
  step('an opponent chosen from the keyboard keeps the focus');

  // The keyboard's place shows as a ring, on the cards and on the gold button; a click shows none.
  const ring = () => page.evaluate(() => {
    const a = document.activeElement, s = getComputedStyle(a);
    return { on: a.id || a.dataset.opp, style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  await page.keyboard.press('Tab');
  let focused = await ring();
  assert.ok(focused.on === 'landlord' && focused.style !== 'none' && focused.width >= 2, 'a card with the keyboard should show a ring: ' + JSON.stringify(focused));
  await page.focus('#lengths button[data-need="3"]');
  await page.keyboard.press('Tab');
  focused = await ring();
  assert.ok(focused.on === 'startBtn' && focused.style !== 'none' && focused.width >= 2, 'the gold button with the keyboard should show a ring: ' + JSON.stringify(focused));
  step('keyboard focus shows a ring');

  // Start a quick game against whoever is picked (Doris by default).
  await page.click('#opponents button[data-opp="doris"]');
  focused = await ring();
  assert.ok(focused.on !== 'doris' || focused.style === 'none', 'a clicked card should not show the keyboard ring: ' + JSON.stringify(focused));
  await page.click('#lengths button[data-need="1"]').catch(() => {});
  await page.click('#startBtn');
  await page.waitForFunction(() => window.looseChange?.game?.phase === 'aim' && window.looseChange.game.turn === 0);
  step('game started, your turn');

  // A real drag: press on the board near the coin, pull straight back about 150px, let go.
  const box = await page.locator('#board').boundingBox();
  const startX = box.x + box.width / 2, startY = box.y + box.height * 0.8;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(startX, startY + 15 * i);
  const aimed = await page.evaluate(() => window.looseChange.game.aim);
  assert.ok(aimed && aimed.power > 0.04, 'pulling back should build up power: ' + JSON.stringify(aimed));
  // watch for the shot before letting go: the coin may settle quickly
  const shot = page.evaluate(() => new Promise(res => {
    const t0 = performance.now();
    const look = () => {
      const g = window.looseChange.game;
      if (g.phase === 'rolling' || g.board.some(c => c.vx || c.vy) || g.hand < 4) return res(true);
      if (performance.now() - t0 > 3000) return res(false);
      requestAnimationFrame(look);
    };
    look();
  }));
  await page.mouse.up();
  assert.ok(await shot, 'the drag should shove a coin');
  step('a pointer drag shoved a coin');

  // Play the rest of the turn from script, then the computer's turn runs on its own.
  const playOut = async () => {
    for (let i = 0; i < 40; i++) {
      const s = await page.evaluate(() => { const g = window.looseChange.game; return { phase: g.phase, turn: g.turn }; });
      if (s.turn !== 0) return;
      if (s.phase === 'aim') await page.evaluate(() => window.looseChange.shoot(0, 380 + Math.random() * 60));
      await page.waitForTimeout(400);
    }
  };
  await playOut();
  await page.waitForFunction(() => window.looseChange.game.turn === 1, null, { timeout: 20000 });
  step("the computer's turn began");

  // Turned on its side, the phone asks to be turned upright, and the game waits behind that until it is.
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.turn-me')).display), 'flex', 'a phone on its side should be asked to turn upright');
  const sidewaysAt = await page.evaluate(() => window.looseChange.game.clock);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.looseChange.game.clock), sidewaysAt, 'the game should wait while the phone is on its side');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(t => window.looseChange.game.clock > t, sidewaysAt, { timeout: 5000 });
  step('on its side the game waits; upright again it carries on');

  await page.waitForFunction(() => { const g = window.looseChange.game; return g.phase === 'over' || (g.turn === 0 && g.phase === 'aim'); }, null, { timeout: 45000 });
  const after = await page.evaluate(() => { const g = window.looseChange.game; return { phase: g.phase, marks: g.marks, turn: g.turn }; });
  const chalked = after.marks.map(m => m.reduce((a, b) => a + b, 0));
  step(`back to you; marks chalked: you ${chalked[0]}, Doris ${chalked[1]}`);
  assert.ok(after.phase === 'aim' && after.turn === 0, 'play should come back round to you');
  assert.ok(chalked.every(n => n >= 0 && n <= 9));

  // The hud says whose turn it is.
  assert.ok(await page.locator('#who0.on').count(), 'your name should be lit on your turn');

  // While the menu is open the bar and the board behind it are out of the keyboard's reach; closed, they're back.
  const behind = () => page.evaluate(() => !!document.activeElement.closest('#app'));
  await page.click('#menuBtn');
  assert.equal(await behind(), false, 'the menu button should not keep the keyboard behind the open menu');
  await page.focus('#backBtn');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await behind(), false, 'Shift+Tab from the menu should not reach the bar behind it');
  await page.click('#backBtn');
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), false, 'the board should be back once the menu closes');
  await page.click('#menuBtn');
  await page.click('#backBtn');
  step('the menu keeps the keyboard while it is open');

  // Fits a phone: nothing scrolls sideways.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

  // Works offline once it has been opened (when there's a service worker to do it).
  const hasSw = await access(join(root, 'sw.js')).then(() => true, () => false);
  const controlled = hasSw && await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).then(() => true, () => false);
  if (!hasSw) step('offline: skipped, no sw.js yet');
  else if (!controlled) step('offline: skipped, sw.js exists but no service worker took control (app.js only registers it over https)');
  else {
    // Take the server away. (ctx.setOffline doesn't reach the service worker's own requests, so the worker
    // would still get through to the server and this check could never fail.)
    down = true;
    server.closeAllConnections();
    await page.reload().catch(e => assert.fail('the page did not load offline: ' + e.message.split('\n')[0]));
    await page.waitForFunction(() => !!window.looseChange, null, { timeout: 10000 })
      .catch(() => assert.fail('the game did not start offline'));
    const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map(f => `${f.family} ${f.status}`); });
    assert.ok(fonts.length && fonts.every(f => f.endsWith(' loaded')), 'the fonts did not load offline: ' + fonts.join(', '));
    down = false;
    step('offline reload works, fonts and all');
  }

  // The slide's hiss is turned down frame by frame, and a hidden tab gets no frames: it has to stop anyway.
  {
    const hctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = watch(await hctx.newPage());
    await p.addInitScript(() => {
      // the hiss is the one sound whose level is eased with setTargetAtTime
      const ease = AudioParam.prototype.setTargetAtTime;
      AudioParam.prototype.setTargetAtTime = function (...a) { window.hiss = this; return ease.apply(this, a); };
      // switching tabs, as far as the page can tell: document.hidden, the event, and no frames until it's back
      let hidden = false;
      const held = [], raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => raf(t => (hidden ? held.push(cb) : cb(t)));
      Object.defineProperty(document, 'hidden', { get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') });
      window.hideTab = h => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); if (!h) held.splice(0).forEach(raf); };
    });
    await p.goto(base);
    await p.click('#startBtn');   // the tap wakes the sound
    await p.waitForFunction(() => window.looseChange.game?.phase === 'aim', null, { polling: 50 });
    await p.evaluate(() => window.looseChange.shoot(0, 690));
    await p.waitForFunction(() => window.hiss?.value > 0.05, null, { polling: 20, timeout: 5000 });
    await p.evaluate(() => window.hideTab(true));
    await p.waitForFunction(() => window.hiss.value < 0.005, null, { polling: 50, timeout: 3000 })
      .catch(() => assert.fail('the slide hiss kept going in a hidden tab'));
    await p.evaluate(() => window.hideTab(false));
    await p.waitForFunction(() => window.looseChange.game.phase === 'aim', null, { polling: 50, timeout: 10000 });
    await hctx.close();
    step('a hidden tab hushes the slide');
  }

  // A damaged or hand-edited record or best is dropped, the good ones are kept as they are, and a win still finishes.
  {
    const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const p = watch(await bctx.newPage());
    await p.goto(base);
    await p.evaluate(() => localStorage.setItem('loose-change.v1', JSON.stringify({
      record: { 'doris:1': 5, 'alan:1': 'ab', 'landlord:1': [2], 'landlord:3': [4, 1] },
      best: { 1: 'abc', 3: 7 },
    })));
    await p.reload();
    const recs = () => p.$$eval('#opponents button', bs => bs.map(b => b.querySelector('.rec')?.textContent || '').join('|'));
    await p.click('#lengths button[data-need="1"]');
    assert.equal(await recs(), '||||', 'bad records and bests should not show on the title');
    await p.click('#lengths button[data-need="3"]');
    assert.equal(await recs(), '||Pub rules: won 4, lost 1||Best: 7 turns', 'good records and bests should be kept');
    await p.click('#lengths button[data-need="1"]');
    await p.click('#opponents button[data-opp="doris"]');
    await p.click('#startBtn');
    await p.waitForFunction(() => window.looseChange.game?.phase === 'aim');
    await p.evaluate(() => { window.looseChange.game.marks[0] = [1, 1, 1, 1, 1, 1, 1, 1, 0]; });   // only bed 9 to go
    for (const aim of ['bed 9', 'off', 'off', 'off', 'off']) {
      await p.waitForFunction(() => { const g = window.looseChange.game; return g.phase === 'aim' && g.current; }, null, { timeout: 20000 });
      await p.evaluate(aim => {
        const lc = window.looseChange;
        lc.game.current.x = aim === 'off' ? 60 : lc.BOARD.w / 2;
        lc.shoot(0, aim === 'off' ? lc.MAX_DIST : (lc.lineY(8) + lc.lineY(9)) / 2 - lc.BOARD.startY);
      }, aim);
      await p.waitForFunction(() => window.looseChange.game.phase !== 'rolling', null, { timeout: 20000 });
    }
    await p.waitForFunction(() => !document.getElementById('over').hidden, null, { timeout: 20000 })
      .catch(() => assert.fail('the winning turn should finish the game'));
    const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('loose-change.v1')));
    assert.deepEqual(kept.record, { 'landlord:3': [4, 1], 'doris:1': [1, 0] });
    assert.deepEqual(kept.best, { 3: 7 });
    await bctx.close();
    step('bad records and bests are dropped and the good ones kept');
  }

  // A reload in the middle of a turn carries on from where it was: your coins stay where they lay and the one still
  // sliding finishes its slide, and the regular's turn plays out the same again, so a reload can't take back a bad
  // turn of yours or re-roll a good one of his.
  {
    const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
    const rctx = await browser.newContext(opts);
    const p = watch(await rctx.newPage());
    await p.goto(base);
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await p.click('#opponents button[data-opp="doris"]');
    await p.click('#lengths button[data-need="1"]');
    await p.click('#startBtn');
    const myAim = () => p.waitForFunction(() => { const g = window.looseChange.game; return g.turn === 0 && g.phase === 'aim' && g.current; }, null, { timeout: 20000 });
    const resting = () => p.evaluate(() => { const g = window.looseChange.game; return { hand: g.hand, coins: g.board.filter(c => c !== g.current && !c.dead).map(c => [c.x, c.y]) }; });
    // a straight shove from x to the middle of a bed, or off the far end
    const shove = (x, bed) => p.evaluate(([x, bed]) => {
      const lc = window.looseChange;
      lc.game.current.x = x;
      lc.shoot(0, bed ? (lc.lineY(bed - 1) + lc.lineY(bed)) / 2 - lc.BOARD.startY : lc.MAX_DIST);
      return lc.game.phase;
    }, [x, bed]);
    await myAim();
    await shove(120, 5);
    await myAim();
    const before = await resting();
    assert.equal(await shove(240, 8), 'rolling');
    await p.reload();                                 // with the second coin still sliding
    await p.click('#resumeBtn');
    await myAim();
    const after = await resting();
    assert.equal(after.hand, 2, 'Carry on should not hand back coins already played: ' + JSON.stringify(after));
    assert.deepEqual(after.coins[0], before.coins[0], 'the first coin should be where it lay');
    assert.ok(after.coins.length === 2 && Math.abs(after.coins[1][1] - 468) < 4, 'the coin that was sliding should finish its slide in bed 8: ' + JSON.stringify(after.coins));
    step('a reload in your turn carries on where it was');

    // Three more off the far end, then Doris's turn: keep the save from just after her second shove and let her finish.
    for (let i = 0; i < 3; i++) { await myAim(); await shove(178, 0); }
    await p.waitForFunction(() => window.looseChange.game.turn === 1, null, { timeout: 20000 });
    const hurry = async q => { const b = await q.locator('#board').boundingBox(); await q.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await q.mouse.down(); };
    const ending = q => q.waitForFunction(() => {
      const g = window.looseChange.game;
      return g.turn === 1 && g.phase === 'scoring' && { marks: g.marks, coins: g.board.filter(c => !c.dead).map(c => [c.x, c.y]) };
    }, null, { timeout: 60000 }).then(h => h.jsonValue());
    await hurry(p);
    const save = await p.waitForFunction(() => {
      const g = window.looseChange.game;
      return g.turn === 1 && g.snapshot?.shots === 1 && localStorage.getItem('loose-change.v1');
    }, null, { polling: 'raf', timeout: 30000 }).then(h => h.jsonValue());
    const first = await ending(p);
    await p.mouse.up();
    await rctx.close();
    // The same save on another page, as if the reload had come then.
    const sctx = await browser.newContext(opts);
    const q = watch(await sctx.newPage());
    await q.goto(base);
    await q.evaluate(s => localStorage.setItem('loose-change.v1', s), save);
    await q.reload();
    await q.click('#resumeBtn');
    await hurry(q);
    const again = await ending(q);
    await q.mouse.up();
    assert.deepEqual(again.marks, first.marks, "Doris's turn should chalk up the same after a reload");
    assert.ok(again.coins.length === first.coins.length && again.coins.every((c, i) => Math.hypot(c[0] - first.coins[i][0], c[1] - first.coins[i][1]) < 1e-6),
      "Doris's coins should end up where they did before the reload: " + JSON.stringify({ first: first.coins, again: again.coins }));
    step("a reload in Doris's turn plays it out the same");

    // A damaged turn-so-far in the save is dropped, and the game carries on from the start of that turn. That goes for a
    // shove far too big to be real too, which would overflow the physics and stop the game.
    const marks = [[1, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]];
    for (const soFar of [{ coins: 'abc', shove: [1, 2] }, { coins: [[178, 400, 1, 0]], shove: [178, 0, 1e305] }]) {
      await q.evaluate(([m, s]) => localStorage.setItem('loose-change.v1', JSON.stringify({
        game: { opp: 'doris', need: 1, marks: m, turn: 0, turns: 3, seed: 5, hand: 2, shots: 1, ...s },
      })), [marks, soFar]);
      await q.reload();
      await q.click('#resumeBtn');
      await q.waitForFunction(() => window.looseChange.game?.phase === 'aim', null, { timeout: 5000 })
        .catch(() => assert.fail('a damaged turn-so-far should start the turn again: ' + JSON.stringify(soFar)));
      const fresh = await q.evaluate(() => { const g = window.looseChange.game; return { turn: g.turn, hand: g.hand, coins: g.board.length, seed: g.seed, marks: g.marks }; });
      assert.deepEqual(fresh, { turn: 0, hand: 4, coins: 1, seed: 5, marks }, 'a damaged turn should start again from an empty board: ' + JSON.stringify(soFar));
    }
    step('a damaged turn-so-far starts the turn again');

    // A save from before the turn so far was kept, like every game in progress today (no seed, nothing about who went
    // first), carries on from the start of its turn with its marks, and the save picks up the turn's seed from there.
    await q.evaluate(m => localStorage.setItem('loose-change.v1', JSON.stringify({ game: { opp: 'pass', need: 1, marks: m, turn: 1, turns: 1 } })), marks);
    await q.reload();
    await q.click('#resumeBtn');
    await q.waitForFunction(() => window.looseChange.game?.phase === 'aim');
    const old = await q.evaluate(() => {
      const g = window.looseChange.game, kept = JSON.parse(localStorage.getItem('loose-change.v1')).game;
      return { turn: g.turn, hand: g.hand, coins: g.board.length, marks: g.marks, seedKept: Number.isInteger(g.seed) && kept.seed === g.seed };
    });
    assert.deepEqual(old, { turn: 1, hand: 4, coins: 1, marks, seedKept: true }, 'a save from before should carry on from the start of its turn');
    step('a save from before carries on from the start of its turn');
    await sctx.close();
  }

  // In Pass the phone the colours take turns to go first: Play again starts with the one that went second, even after
  // a reload in between.
  {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const p = watch(await pctx.newPage());
    await p.goto(base);
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await p.click('#opponents button[data-opp="pass"]');
    await p.click('#lengths button[data-need="1"]');
    await p.click('#startBtn');
    // whoever's turn it is needs only bed 9: one coin there and the rest off the far end wins it
    const finish = async () => {
      await p.waitForFunction(() => window.looseChange.game?.phase === 'aim');
      await p.evaluate(() => { const g = window.looseChange.game; g.marks[g.turn] = [1, 1, 1, 1, 1, 1, 1, 1, 0]; });
      for (const bed of [9, 0, 0, 0, 0]) {
        await p.waitForFunction(() => { const g = window.looseChange.game; return g.phase === 'aim' && g.current; }, null, { timeout: 20000 });
        await p.evaluate(bed => {
          const lc = window.looseChange;
          lc.game.current.x = bed ? lc.BOARD.w / 2 : 60;
          lc.shoot(0, bed ? (lc.lineY(8) + lc.lineY(9)) / 2 - lc.BOARD.startY : lc.MAX_DIST);
        }, bed);
        await p.waitForFunction(() => window.looseChange.game.phase !== 'rolling', null, { timeout: 20000 });
      }
      await p.waitForFunction(() => !document.getElementById('over').hidden, null, { timeout: 20000 });
    };
    const starts = () => p.evaluate(() => window.looseChange.game.turn);
    assert.equal(await starts(), 0, 'Copper should start the first game');
    await finish();
    await p.click('#againBtn');
    assert.equal(await starts(), 1, 'Silver should start the second game');
    assert.ok(await p.locator('#who1.on').count(), "the bar should show it's Silver's turn");
    await p.reload();
    await p.click('#resumeBtn');
    await finish();
    await p.click('#againBtn');
    assert.equal(await starts(), 0, 'Copper should start the third game');
    await pctx.close();
    step('in Pass the phone the colours take turns to go first');
  }

  // With JavaScript off, the page says what it needs it for instead of showing an empty board.
  {
    const nctx = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
    const p = await nctx.newPage();
    await p.goto(base);
    const box = await p.locator('.noscript').boundingBox();
    const cdp = await nctx.newCDPSession(p);
    await cdp.send('DOM.getDocument');
    const { backendNodeId } = await cdp.send('DOM.getNodeForLocation', { x: Math.round(box.x + 8), y: Math.round(box.y + 8) });
    const { node } = await cdp.send('DOM.describeNode', { backendNodeId });
    assert.ok(node.nodeName === 'P' && (node.attributes || []).includes('noscript'), 'with JavaScript off the message should be on top, not ' + node.nodeName);
    await nctx.close();
    step('with JavaScript off it says so');
  }

  assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
  console.log('all good');
} finally {
  await browser.close();
  server.close();
}
