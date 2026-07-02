// Procedural canvas textures — grimy industrial surfaces, no external assets.
import * as THREE from 'three';

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// Deterministic-ish noise painter
function speckle(ctx, size, count, colors, minR, maxR, alpha) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    ctx.globalAlpha = alpha * (0.4 + Math.random() * 0.6);
    const r = minR + Math.random() * (maxR - minR);
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function grunge(ctx, size, strength) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * strength;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function finalize(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function concreteWall() {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#5a5c58';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 900, ['#4e504c', '#63655f', '#565851', '#6a6c66'], 1, 4, 0.5);
  // horizontal formwork seams
  ctx.strokeStyle = 'rgba(30,32,30,0.55)';
  ctx.lineWidth = 2;
  for (const y of [size * 0.33, size * 0.66]) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // drip stains
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * size, y = Math.random() * size * 0.5;
    const h = 20 + Math.random() * 60;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(25,28,25,0.35)');
    g.addColorStop(1, 'rgba(25,28,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 2 + Math.random() * 4, h);
  }
  grunge(ctx, size, 26);
  return finalize(c, 1, 1);
}

export function floorConcrete() {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#3e403c';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 1200, ['#35372f', '#484a44', '#3a3c36', '#52544e'], 1, 3, 0.5);
  // expansion joint grid
  ctx.strokeStyle = 'rgba(18,20,18,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  // oil stains
  for (let i = 0; i < 4; i++) {
    const g = ctx.createRadialGradient(
      Math.random() * size, Math.random() * size, 2,
      size / 2, size / 2, 30 + Math.random() * 50);
    g.addColorStop(0, 'rgba(15,15,12,0.4)');
    g.addColorStop(1, 'rgba(15,15,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  grunge(ctx, size, 20);
  return finalize(c, 1, 1);
}

export function ceilingPanels() {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#2e302e';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 400, ['#282a28', '#343634'], 1, 3, 0.5);
  ctx.strokeStyle = 'rgba(12,14,12,0.8)';
  ctx.lineWidth = 4;
  const half = size / 2;
  ctx.strokeRect(0, 0, half, half);
  ctx.strokeRect(half, 0, half, half);
  ctx.strokeRect(0, half, half, half);
  ctx.strokeRect(half, half, half, half);
  grunge(ctx, size, 14);
  return finalize(c, 1, 1);
}

export function rustedMetal() {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#4a4440';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 700, ['#5c4a38', '#6b4f36', '#403a34', '#55504a'], 1, 5, 0.5);
  // rivet rows
  ctx.fillStyle = 'rgba(20,18,16,0.8)';
  for (let x = 16; x < size; x += 32) {
    for (const y of [10, size - 10]) {
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  grunge(ctx, size, 24);
  return finalize(c, 1, 1);
}

export function crateWood() {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#6b5638';
  ctx.fillRect(0, 0, size, size);
  // planks
  for (let i = 0; i < 6; i++) {
    const y = i * (size / 6);
    ctx.fillStyle = `rgb(${95 + Math.random() * 25}, ${75 + Math.random() * 18}, ${48 + Math.random() * 12})`;
    ctx.fillRect(0, y + 2, size, size / 6 - 4);
  }
  // grain
  ctx.strokeStyle = 'rgba(60,45,25,0.4)';
  for (let i = 0; i < 40; i++) {
    ctx.lineWidth = 1;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + (Math.random() - 0.5) * 8, size * 0.7, y + (Math.random() - 0.5) * 8, size, y);
    ctx.stroke();
  }
  // frame
  ctx.strokeStyle = 'rgba(40,30,15,0.9)';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, size - 14, size - 14);
  grunge(ctx, size, 16);
  return finalize(c, 1, 1);
}

export function hazardStripes() {
  const size = 128;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#8a7a1e';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#1a1a18';
  for (let i = -size; i < size * 2; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + 16, 0);
    ctx.lineTo(i + 16 - size, size); ctx.lineTo(i - size, size);
    ctx.fill();
  }
  grunge(ctx, size, 22);
  return finalize(c, 1, 1);
}
