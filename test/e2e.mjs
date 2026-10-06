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
const server = createServer(async (req, res) => {
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
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('left the site: ' + r.url()); });

const step = msg => console.log('  ' + msg);
try {
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Start a quick game against whoever is picked (Doris by default).
  await page.click('#opponents button[data-opp="doris"]');
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
  await page.waitForFunction(() => { const g = window.looseChange.game; return g.phase === 'over' || (g.turn === 0 && g.phase === 'aim'); }, null, { timeout: 45000 });
  const after = await page.evaluate(() => { const g = window.looseChange.game; return { phase: g.phase, marks: g.marks, turn: g.turn }; });
  const chalked = after.marks.map(m => m.reduce((a, b) => a + b, 0));
  step(`back to you; marks chalked: you ${chalked[0]}, Doris ${chalked[1]}`);
  assert.ok(after.phase === 'aim' && after.turn === 0, 'play should come back round to you');
  assert.ok(chalked.every(n => n >= 0 && n <= 9));

  // The hud says whose turn it is.
  assert.ok(await page.locator('#who0.on').count(), 'your name should be lit on your turn');

  // Fits a phone: nothing scrolls sideways.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

  // Works offline once it has been opened (when there's a service worker to do it).
  const hasSw = await access(join(root, 'sw.js')).then(() => true, () => false);
  const controlled = hasSw && await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).then(() => true, () => false);
  if (!hasSw) step('offline: skipped, no sw.js yet');
  else if (!controlled) step('offline: skipped, sw.js exists but no service worker took control (app.js only registers it over https)');
  else {
    await ctx.setOffline(true);
    await page.reload();
    assert.ok(await page.title(), 'the page did not load offline');
    await page.waitForFunction(() => !!window.looseChange, null, { timeout: 5000 });
    await ctx.setOffline(false);
    step('offline reload works');
  }

  assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
  console.log('all good');
} finally {
  await browser.close();
  server.close();
}
