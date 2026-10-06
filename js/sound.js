// Every sound is made on the spot with Web Audio: no files to load.

let ctx = null, master = null, slideGain = null;
let muted = false;

export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; }
export const isMuted = () => muted;

export function wake() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
  // a steady soft hiss whose volume follows how fast the coins are sliding
  const buf = noise(2);
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
  slideGain = ctx.createGain(); slideGain.gain.value = 0;
  src.connect(bp).connect(slideGain).connect(master); src.start();
}

function noise(seconds) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export function slide(speed) {
  if (!ctx || !slideGain) return;
  const g = Math.min(0.12, speed / 9000);
  slideGain.gain.setTargetAtTime(g, ctx.currentTime, 0.03);
}

// brass on brass: a bright, short ring
export function clink(strength) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const v = Math.min(1, strength / 900) * 0.5 + 0.04;
  for (const [f, d] of [[3150, 0.09], [4710, 0.06], [6900, 0.03]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (0.98 + Math.random() * 0.04);
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d * 2.2);
    o.connect(g).connect(master); o.start(t); o.stop(t + d * 2.4);
  }
}

// the heel of the hand on the coin
export function shove(power) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = noise(0.12);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + power * 900;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.25 + power * 0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  s.connect(lp).connect(g).connect(master); s.start(t);
}

// off the end of the board, onto the pub floor
export function drop() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.25;
  for (let i = 0; i < 5; i++) {
    const at = t + i * (0.11 - i * 0.015);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 2200 + Math.random() * 600;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12 / (i + 1), at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    o.connect(g).connect(master); o.start(at); o.stop(at + 0.1);
  }
}

// a stroke of chalk
export function chalk() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = noise(0.25);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.18, t + 0.03);
  for (let i = 1; i < 8; i++) g.gain.setValueAtTime(0.06 + Math.random() * 0.14, t + 0.03 + i * 0.022);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  s.connect(hp).connect(g).connect(master); s.start(t);
}

export function cheer() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + i * 0.09);
    g.gain.linearRampToValueAtTime(0.12, t + i * 0.09 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.5);
    o.connect(g).connect(master); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.55);
  });
}
