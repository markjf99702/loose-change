// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded, so the same pictures come out every time. Needs Playwright, and upng-js from `npm install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const SEED = 4;

// Saved with a 256-colour palette: the wood grain makes full-colour PNGs several times bigger.
async function save(shot, path) {
  const img = UPNG.decode(shot);
  await writeFile(join(root, path), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
}
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// A game of pub rules (three marks a bed) against Doris, part way through: chalk on both sides.
const MARKS = [
  [3, 2, 3, 1, 0, 2, 3, 1, 0],
  [2, 3, 1, 3, 2, 0, 1, 3, 1],
];
// Your shots this turn: [where along the edge (mm), angle (radians), how far (mm)]. Bed k's middle is
// lineY(k - 1) + 15.9 up the board and a coin starts 4 mm up, so these land in beds 9, 8, 7, 3 and 2:
// three marks for you, and the coins in your full beds 7 and 3 chalk up for Doris.
const SHOTS = [
  [250, 0, 496],
  [110, 0, 464],
  [235, 0, 432],
  [105, 0, 305],
  [175, 0, 274],
];

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    try { localStorage.setItem('loose-change.v1', JSON.stringify({ opp: 'doris', need: 3, muted: true })); } catch {}
  }, SEED);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return page;
}

// Start the mid-game position and play `n` of this turn's shots, waiting for each to come to rest.
async function play(page, n) {
  await page.click('#startBtn');
  await page.evaluate(marks => {
    const lc = window.looseChange;
    lc.newGame('doris', 3);
    lc.game.marks = marks.map(m => [...m]);
  }, MARKS);
  for (const [x, angle, dist] of SHOTS.slice(0, n)) {
    await page.waitForFunction(() => window.looseChange.game.phase === 'aim' && window.looseChange.game.turn === 0 && window.looseChange.game.current);
    await page.evaluate(([x, angle, dist]) => {
      const lc = window.looseChange;
      lc.game.current.x = x;
      lc.shoot(angle, dist);
    }, [x, angle, dist]);
    await page.waitForFunction(() => window.looseChange.game.phase !== 'rolling');
  }
}

// Wait until the last chalk mark of the turn is up, while the scored coins still glow. At that point the chalk on
// screen should be exactly game.marks, so it's set to that, in case the animation's own count has drifted.
async function chalkedUp(page) {
  await page.waitForFunction(() => {
    const g = window.looseChange.game;
    if (g.phase !== 'scoring' || g.queue.length || g.chalk) return false;
    g.chalkMarks = g.marks.map(m => [...m]);
    return true;
  }, null, { polling: 'raf' });
  await page.waitForTimeout(30);
}

let board = null; // a crop of the running board for the link preview

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await save(await page.screenshot(), 'docs/phone-title.png');

  await play(page, 4);
  await page.waitForTimeout(1600); // let any banner fade
  // the next coin, half pulled back, so the aiming ring shows
  await page.evaluate(() => { const g = window.looseChange.game; g.current.x = 205; g.aim = { angle: -0.02, power: 0.55, human: true }; });
  await page.waitForTimeout(100);
  await save(await page.screenshot(), 'docs/phone-play.png');
  await page.evaluate(() => { window.looseChange.game.aim = null; });

  // the last coin, then the chalk going up
  await page.evaluate(([x, angle, dist]) => { const lc = window.looseChange; lc.game.current.x = x; lc.shoot(angle, dist); }, SHOTS[4]);
  await chalkedUp(page);
  await save(await page.screenshot(), 'docs/phone-chalk.png');
  await page.context().close();
}

// The board for the link preview: same position, drawn big so the crop is sharp.
{
  const page = await open({ width: 600, height: 1000 }, 2);
  await play(page, 5);
  await chalkedUp(page);
  board = await page.evaluate(() => {
    const lc = window.looseChange, canvas = document.getElementById('board');
    const r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
    // the same layout the game uses (render.js): find the board on the canvas
    const pad = 10, below = Math.max(96, r.height * 0.14);
    const s = Math.min((r.width - pad * 2) / lc.BOARD.w, (r.height - pad - below) / lc.BOARD.h);
    const ox = (r.width - lc.BOARD.w * s) / 2, oy = Math.max(pad, (r.height - below - lc.BOARD.h * s) / 2);
    // from just past the last line down into the open wood below the first, full width
    const top = oy + (lc.BOARD.h - lc.lineY(9) - 18) * s, bottom = oy + (lc.BOARD.h - lc.lineY(0) + 90) * s;
    const out = document.createElement('canvas');
    const sx = ox * k, sy = top * k, sw = lc.BOARD.w * s * k, sh = (bottom - top) * k;
    out.width = Math.round(sw); out.height = Math.round(sh);
    out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return { url: out.toDataURL('image/png'), w: out.width, h: out.height };
  });
  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left, the real board on the right.
{
  const page = await open({ width: 1200, height: 630 }, 1);
  const font = (await readFile(join(root, 'fonts/fraunces.woff2'))).toString('base64');
  const body = (await readFile(join(root, 'fonts/figtree.woff2'))).toString('base64');
  const H = 566, W = Math.round(board.w * H / board.h);
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: Fraunces; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 400 800; }
    @font-face { font-family: Figtree; src: url(data:font/woff2;base64,${body}) format('woff2'); font-weight: 400 700; }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { background: radial-gradient(ellipse at 30% 40%, #2e2018 0%, #1c1410 70%); color: #f3e7d6; position: relative; }
    .words { position: absolute; left: 84px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
    h1 { font-family: Fraunces; font-weight: 700; font-size: 112px; line-height: .95; letter-spacing: -.02em; margin: 0 0 28px; }
    h1 span { color: #e08a4c; display: block; }
    p { font-family: Figtree; font-size: 34px; color: #d6c3a8; margin: 0; }
    .rule { width: 120px; height: 5px; background: #d6ae55; border-radius: 3px; margin: 0 0 30px; }
    .board { position: absolute; right: 64px; top: ${(630 - H) / 2}px; width: ${W}px; height: ${H}px; border-radius: 10px; overflow: hidden;
      box-shadow: 0 0 0 6px #2a1a10, 0 20px 50px rgba(0,0,0,.6); transform: rotate(2.5deg); }
    .board img { width: 100%; height: 100%; display: block; }
  </style>
  <div class="words"><div class="rule"></div><h1>Loose<span>Change</span></h1><p>Shove ha’penny on your phone</p></div>
  <div class="board"><img src="${board.url}"></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await save(await page.screenshot(), 'og.png');
  await page.context().close();
}

await browser.close();
server.close();
const kb = async f => ((await stat(join(root, f))).size / 1024).toFixed(0) + ' KB';
console.log('screenshots written; og.png', await kb('og.png'));
