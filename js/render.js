// Drawing the board, the coins and the chalk. Board units are millimetres; `view` maps them to the canvas.

import { BOARD, lineY } from './physics.js';

export function layout(cw, ch) {
  const pad = 10, below = Math.max(96, ch * 0.14);
  const s = Math.min((cw - pad * 2) / BOARD.w, (ch - pad - below) / BOARD.h);
  const bw = BOARD.w * s, bh = BOARD.h * s;
  const ox = (cw - bw) / 2, oy = Math.max(pad, (ch - below - bh) / 2);
  return {
    s, ox, oy, bw, bh, cw, ch,
    X: x => ox + x * s,
    Y: y => oy + (BOARD.h - y) * s,
    toBoard: (px, py) => ({ x: (px - ox) / s, y: BOARD.h - (py - oy) / s }),
  };
}

// --- the board, drawn once per size -------------------------------------------------------------------------

let woodCache = null;

// Drop the drawn board and coins, e.g. once the fonts have loaded.
export function resetCaches() { woodCache = null; spriteCache.clear(); }

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function wood(v, dpr) {
  const key = `${v.bw}x${v.bh}@${dpr}`;
  if (woodCache?.key === key) return woodCache.canvas;
  const c = document.createElement('canvas');
  c.width = Math.ceil(v.bw * dpr); c.height = Math.ceil(v.bh * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const s = v.s, W = v.bw, H = v.bh;
  const rnd = seeded(7);
  // varnished mahogany
  const base = g.createLinearGradient(0, 0, W, 0);
  base.addColorStop(0, '#5a2a14'); base.addColorStop(0.5, '#7b3d1c'); base.addColorStop(1, '#5c2b15');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  // grain runs the length of the board
  for (let i = 0; i < 140; i++) {
    const x0 = rnd() * W, amp = 2 + rnd() * 6, f = 0.004 + rnd() * 0.01, ph = rnd() * 6;
    g.strokeStyle = rnd() < 0.5 ? `rgba(30,10,4,${0.06 + rnd() * 0.12})` : `rgba(190,110,60,${0.04 + rnd() * 0.07})`;
    g.lineWidth = 0.5 + rnd() * 1.6;
    g.beginPath();
    for (let y = 0; y <= H; y += 6) {
      const x = x0 + Math.sin(y * f + ph) * amp + Math.sin(y * f * 3.1 + ph * 2) * amp * 0.3;
      y ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  // a long soft sheen down the middle
  const sheen = g.createLinearGradient(0, 0, W, 0);
  sheen.addColorStop(0.2, 'rgba(255,220,180,0)'); sheen.addColorStop(0.45, 'rgba(255,220,180,0.10)');
  sheen.addColorStop(0.55, 'rgba(255,220,180,0.10)'); sheen.addColorStop(0.8, 'rgba(255,220,180,0)');
  g.fillStyle = sheen; g.fillRect(0, 0, W, H);
  // the chalk gutters are worn paler from years of being wiped
  for (const gx of [0, (BOARD.w - BOARD.side) * s]) {
    g.fillStyle = 'rgba(20,8,2,0.22)'; g.fillRect(gx, 0, BOARD.side * s, H);
  }
  // brass lines let into the wood
  const Y = y => (BOARD.h - y) * s;
  const brass = (x1, y1, x2, y2) => {
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(20,6,0,0.6)'; g.lineWidth = Math.max(1.5, BOARD.line * s + 1.2);
    g.beginPath(); g.moveTo(x1, y1 + 0.8); g.lineTo(x2, y2 + 0.8); g.stroke();
    const gr = g.createLinearGradient(x1, y1 - 2, x1, y1 + 2);
    g.strokeStyle = '#d6ae55'; g.lineWidth = Math.max(1, BOARD.line * s);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = 'rgba(255,240,190,0.5)'; g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(x1, y1 - 0.4); g.lineTo(x2, y2 - 0.4); g.stroke();
    void gr;
  };
  for (let k = 0; k <= BOARD.beds; k++) brass(0, Y(lineY(k)), W, Y(lineY(k)));
  const top = Y(lineY(BOARD.beds)), bot = Y(lineY(0));
  brass(BOARD.side * s, top, BOARD.side * s, bot);
  brass((BOARD.w - BOARD.side) * s, top, (BOARD.w - BOARD.side) * s, bot);
  // bed numbers, faint, in the middle of each bed
  g.fillStyle = 'rgba(255,225,190,0.13)';
  g.font = `600 ${Math.round(14 * s)}px Fraunces, Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 1; k <= BOARD.beds; k++) g.fillText(String(k), W / 2, Y((lineY(k - 1) + lineY(k)) / 2));
  // edge bevel
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
  g.strokeStyle = 'rgba(255,200,150,0.15)'; g.lineWidth = 1; g.strokeRect(3, 3, W - 6, H - 6);
  woodCache = { key, canvas: c };
  return c;
}

// --- coins ------------------------------------------------------------------------------------------------------

const METAL = [
  { rim: '#8a4a22', hi: '#f2b27a', mid: '#c46f37', lo: '#7b3c18', mark: 'rgba(80,30,8,0.55)' },   // copper
  { rim: '#7d8288', hi: '#f4f6f8', mid: '#bfc5cb', lo: '#80868c', mark: 'rgba(50,55,60,0.5)' },   // silver
];

// The loose change from the drawer. All the same size, by luck; only the faces differ.
export const FACES = [
  [ // copper
    { mark: '½', name: "a ha'penny from 1967" },
    { mark: '1¢', name: 'a wheat penny from 1952' },
    { mark: '2p', name: 'a two-pence piece from a holiday' },
    { mark: 'K', name: 'a skee-ball token' },
    { hole: true, name: 'a brass washer' },
    { mark: 'C', name: 'a centime nobody remembers keeping' },
  ],
  [ // silver
    { star: true, name: 'a laundromat token' },
    { mark: '5¢', name: 'a buffalo nickel' },
    { mark: '25', name: 'a Canadian quarter' },
    { mark: 'T', name: 'a bus token from 1987' },
    { mark: '10', name: "a dime that's been through the wash" },
    { mark: '?', name: 'a coin from somewhere' },
  ],
];

const spriteCache = new Map();
function sprite(kind, face, px, dpr) {
  const key = `${kind}:${face}:${px}:${dpr}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const size = Math.ceil(px * 2 * dpr) + 4;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2); g.scale(dpr, dpr);
  const r = px, m = METAL[kind], f = FACES[kind][face % FACES[kind].length];
  const body = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  body.addColorStop(0, m.hi); body.addColorStop(0.55, m.mid); body.addColorStop(1, m.lo);
  g.fillStyle = body; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = m.rim; g.lineWidth = Math.max(1, r * 0.09); g.beginPath(); g.arc(0, 0, r * 0.94, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = m.mark; g.lineWidth = Math.max(0.6, r * 0.04);
  if (f.hole) {
    // a washer: plain ring with a hole through it
    g.beginPath(); g.arc(0, 0, r * 0.62, 0, Math.PI * 2); g.stroke();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(0, 0, r * 0.36, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = m.lo; g.lineWidth = Math.max(0.8, r * 0.07);
    g.beginPath(); g.arc(0, 0, r * 0.38, 0, Math.PI * 2); g.stroke();
  } else {
    g.beginPath(); g.arc(0, 0, r * 0.76, 0, Math.PI * 2); g.stroke();
    // milled dots round the edge
    g.fillStyle = m.mark;
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, Math.max(0.4, r * 0.03), 0, 7); g.fill(); }
    g.fillStyle = m.mark;
    if (f.star) {
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.22 : r * 0.5; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill();
    } else {
      const fs = f.mark.length > 1 ? r * 0.72 : r * 0.95;
      g.font = `700 ${fs}px Fraunces, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(f.mark, 0, r * 0.05);
    }
  }
  // glint
  const glint = g.createRadialGradient(-r * 0.4, -r * 0.45, 0, -r * 0.4, -r * 0.45, r * 0.6);
  glint.addColorStop(0, 'rgba(255,255,255,0.45)'); glint.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glint; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  spriteCache.set(key, c);
  return c;
}

export function drawCoin(g, v, x, y, rot, kind, dpr, { alpha = 1, scale = 1, lift = 0, glow = null, face = 0 } = {}) {
  const r = BOARD.r * v.s * scale;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath(); g.ellipse(x + r * 0.12 + lift, y + r * 0.18 + lift, r, r, 0, 0, Math.PI * 2); g.fill();
  if (glow) {
    g.shadowColor = glow; g.shadowBlur = r * 1.1;
    g.fillStyle = glow; g.beginPath(); g.arc(x, y, r * 1.02, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  }
  const sp = sprite(kind, face, Math.round(BOARD.r * v.s * 4) / 4, dpr);
  g.translate(x - lift * 0.3, y - lift * 0.5); g.rotate(rot); g.scale(scale, scale);
  g.drawImage(sp, -sp.width / dpr / 2, -sp.height / dpr / 2, sp.width / dpr, sp.height / dpr);
  g.restore();
}

// --- chalk ------------------------------------------------------------------------------------------------------

// Wobbly chalk strokes, the same every time for a given bed and mark.
function stroke(g, x1, y1, x2, y2, seed, w, t = 1) {
  const rnd = seeded(seed);
  g.lineCap = 'round';
  for (let pass = 0; pass < 3; pass++) {
    g.strokeStyle = `rgba(245,240,228,${0.28 + rnd() * 0.3})`;
    g.lineWidth = w * (0.5 + rnd() * 0.6);
    g.beginPath();
    const steps = 6;
    for (let i = 0; i <= steps * t; i++) {
      const f = i / steps;
      const x = x1 + (x2 - x1) * f + (rnd() - 0.5) * w * 0.5, y = y1 + (y2 - y1) * f + (rnd() - 0.5) * w * 0.5;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
}

// marks[p][bed]; `fresh` = { player, bed, index, t } for the stroke being drawn now.
export function drawChalk(g, v, marks, need, fresh) {
  const s = v.s;
  for (let p = 0; p < 2; p++) {
    const gx0 = p === 0 ? 0 : BOARD.w - BOARD.side;
    for (let b = 0; b < BOARD.beds; b++) {
      const yTop = v.Y(lineY(b + 1)), yBot = v.Y(lineY(b));
      const h = yBot - yTop, cx = v.X(gx0 + BOARD.side / 2);
      const n = Math.min(need, marks[p][b]);
      const span = BOARD.side * s * 0.62;
      for (let i = 0; i < n; i++) {
        const isFresh = fresh && fresh.player === p && fresh.bed === b && fresh.index === i;
        const t = isFresh ? fresh.t : 1;
        if (need === 1) {
          stroke(g, cx - span * 0.32, yTop + h * 0.25, cx + span * 0.32, yBot - h * 0.25, b * 31 + p * 7 + 1, 2.4 * s, Math.min(1, t * 2));
          if (t > 0.5) stroke(g, cx + span * 0.32, yTop + h * 0.25, cx - span * 0.32, yBot - h * 0.25, b * 31 + p * 7 + 2, 2.4 * s, (t - 0.5) * 2);
        } else {
          const x = cx - span / 2 + (span * (i + 0.5)) / need;
          stroke(g, x - 1 * s, yTop + h * 0.2, x + 1 * s, yBot - h * 0.2, b * 31 + p * 7 + i * 3, 2.6 * s, t);
        }
      }
      if (n >= need && need > 1 && !(fresh && fresh.player === p && fresh.bed === b)) {
        stroke(g, cx - span * 0.55, yBot - h * 0.3, cx + span * 0.55, yTop + h * 0.3, b * 17 + p * 5 + 99, 2.2 * s);
      }
    }
  }
}

export function drawBoard(g, v, dpr) {
  drawTable(g, v);
  g.drawImage(wood(v, dpr), v.ox, v.oy, v.bw, v.bh);
}

// On a wide screen there's table either side of the board: a beer mat, and the ring a pint left behind.
function drawTable(g, v) {
  if (v.ox < 170) return;
  const R = Math.min(v.ox * 0.36, 96);
  // the mat
  const mx = v.ox / 2 + 6, my = v.oy + v.bh * 0.34;
  g.save();
  g.translate(mx, my); g.rotate(-0.21);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.arc(4, 6, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8dcc2';
  g.beginPath();
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2, rr = R * (1 + 0.012 * Math.sin(i * 6));
    i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(rr, 0);
  }
  g.fill();
  g.strokeStyle = '#a3402c'; g.lineWidth = R * 0.06;
  g.beginPath(); g.arc(0, 0, R * 0.86, 0, Math.PI * 2); g.stroke();
  g.lineWidth = R * 0.015;
  g.beginPath(); g.arc(0, 0, R * 0.78, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#a3402c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${R * 0.13}px Figtree, system-ui, sans-serif`;
  g.fillText('THE', 0, -R * 0.36);
  g.font = `800 ${R * 0.24}px Fraunces, Georgia, serif`;
  g.fillText('Loose', 0, -R * 0.12);
  g.fillText('Change', 0, R * 0.14);
  g.font = `600 ${R * 0.09}px Figtree, system-ui, sans-serif`;
  g.fillStyle = '#6b4a3a';
  g.fillText('EST. IN A DRAWER', 0, R * 0.42);
  // a damp ring where a glass sat on it
  g.strokeStyle = 'rgba(120,80,40,0.18)'; g.lineWidth = R * 0.05;
  g.beginPath(); g.arc(R * 0.18, R * 0.1, R * 0.62, 0.4, Math.PI * 1.7); g.stroke();
  g.restore();
  // a pint ring on the bare table on the other side
  const rx = v.ox + v.bw + v.ox / 2, ry = v.oy + v.bh * 0.62;
  g.strokeStyle = 'rgba(214,174,85,0.08)'; g.lineWidth = R * 0.07;
  g.beginPath(); g.arc(rx, ry, R * 0.6, 0, Math.PI * 2); g.stroke();
  g.lineWidth = R * 0.03;
  g.beginPath(); g.arc(rx + R * 0.16, ry - R * 0.08, R * 0.6, 1, 4.8); g.stroke();
}

// The beds the player still needs, lit faintly so you know where to aim.
export function drawWanted(g, v, marks, p, need) {
  for (let b = 0; b < BOARD.beds; b++) {
    if (marks[p][b] >= need) continue;
    const y1 = v.Y(lineY(b + 1)), y2 = v.Y(lineY(b));
    g.fillStyle = 'rgba(255,214,140,0.07)';
    g.fillRect(v.X(BOARD.side), y1, (BOARD.w - BOARD.side * 2) * v.s, y2 - y1);
  }
}
