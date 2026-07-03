// Procedural WebAudio SFX — no audio files needed.
let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() { ac(); }

function noiseBuffer(dur) {
  const a = ac();
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function gunshot() {
  const a = ac();
  const t = a.currentTime;
  // crack: filtered noise burst
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(0.3);
  const bp = a.createBiquadFilter();
  bp.type = 'lowpass';
  bp.frequency.setValueAtTime(3200, t);
  bp.frequency.exponentialRampToValueAtTime(280, t + 0.22);
  const g = a.createGain();
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
  // low thump
  const osc = a.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  const og = a.createGain();
  og.gain.setValueAtTime(0.55, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  osc.connect(og).connect(a.destination);
  osc.start(t); osc.stop(t + 0.16);
}

export function enemyShot() {
  const a = ac();
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(0.22);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 1.2;
  const g = a.createGain();
  g.gain.setValueAtTime(0.28, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

export function reloadSound() {
  const a = ac();
  const t = a.currentTime;
  for (const [dt, f] of [[0, 900], [0.13, 600], [0.34, 1200]]) {
    const osc = a.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0, t + dt);
    g.gain.linearRampToValueAtTime(0.08, t + dt + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.06);
    osc.connect(g).connect(a.destination);
    osc.start(t + dt); osc.stop(t + dt + 0.08);
  }
}

export function hurtSound() {
  const a = ac();
  const t = a.currentTime;
  const osc = a.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(90, t + 0.18);
  const g = a.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(g).connect(a.destination);
  osc.start(t); osc.stop(t + 0.22);
}

export function hitmarkerSound() {
  const a = ac();
  const t = a.currentTime;
  const osc = a.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1400, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.05);
  const g = a.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(g).connect(a.destination);
  osc.start(t); osc.stop(t + 0.07);
}

export function pickupSound() {
  const a = ac();
  const t = a.currentTime;
  for (const [dt, f] of [[0, 520], [0.09, 780]]) {
    const osc = a.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0, t + dt);
    g.gain.linearRampToValueAtTime(0.15, t + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.12);
    osc.connect(g).connect(a.destination);
    osc.start(t + dt); osc.stop(t + dt + 0.15);
  }
}

export function deathSound() {
  const a = ac();
  const t = a.currentTime;
  const osc = a.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(35, t + 0.9);
  const g = a.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
  osc.connect(g).connect(a.destination);
  osc.start(t); osc.stop(t + 1.05);
}

let stepFlip = false;
export function footstep(vol = 0.08) {
  const a = ac();
  const t = a.currentTime;
  stepFlip = !stepFlip;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(0.07);
  const bp = a.createBiquadFilter();
  bp.type = 'lowpass';
  bp.frequency.value = stepFlip ? 420 : 360;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

export function killConfirm() {
  const a = ac();
  const t = a.currentTime;
  for (const [dt, f] of [[0, 660], [0.07, 440]]) {
    const osc = a.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0, t + dt);
    g.gain.linearRampToValueAtTime(0.14, t + dt + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.09);
    osc.connect(g).connect(a.destination);
    osc.start(t + dt); osc.stop(t + dt + 0.11);
  }
}

export function headshotDing() {
  const a = ac();
  const t = a.currentTime;
  const osc = a.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1980, t);
  const g = a.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(g).connect(a.destination);
  osc.start(t); osc.stop(t + 0.24);
}

export function explosionSound() {
  const a = ac();
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(0.9);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400, t);
  lp.frequency.exponentialRampToValueAtTime(80, t + 0.8);
  const g = a.createGain();
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
  src.connect(lp).connect(g).connect(a.destination);
  src.start(t);
  const osc = a.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(28, t + 0.5);
  const og = a.createGain();
  og.gain.setValueAtTime(0.6, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  osc.connect(og).connect(a.destination);
  osc.start(t); osc.stop(t + 0.6);
}

export function throwWhoosh() {
  const a = ac();
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(0.2);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(1600, t + 0.15);
  const g = a.createGain();
  g.gain.setValueAtTime(0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

export function upgradeSound() {
  const a = ac();
  const t = a.currentTime;
  for (const [dt, f] of [[0, 440], [0.1, 554], [0.2, 659]]) {
    const osc = a.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0, t + dt);
    g.gain.linearRampToValueAtTime(0.13, t + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.18);
    osc.connect(g).connect(a.destination);
    osc.start(t + dt); osc.stop(t + dt + 0.2);
  }
}

// quiet ambient hum, started once
let ambientStarted = false;
export function startAmbient() {
  if (ambientStarted) return;
  ambientStarted = true;
  const a = ac();
  const osc = a.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 55;
  const osc2 = a.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 110.7;
  const g = a.createGain();
  g.gain.value = 0.018;
  osc.connect(g); osc2.connect(g);
  g.connect(a.destination);
  osc.start(); osc2.start();
}
