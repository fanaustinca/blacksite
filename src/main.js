import * as THREE from 'three';
import { World, CELL } from './world.js';
import { Player } from './player.js';
import { Weapon } from './weapons.js';
import { spawnEnemies } from './enemies.js';
import { unlockAudio, startAmbient, hurtSound, pickupSound, deathSound } from './audio.js';

// ---------- renderer / scene ----------
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.autoClear = false;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.032);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
scene.add(camera);

// player flashlight — the core of the atmosphere
const flashlight = new THREE.SpotLight(0xfff2dc, 60, 32, 0.5, 0.5, 1.5);
flashlight.castShadow = false;
camera.add(flashlight);
flashlight.position.set(0.1, -0.05, 0);
const flTarget = new THREE.Object3D();
flTarget.position.set(0, -0.06, -4);
camera.add(flTarget);
flashlight.target = flTarget;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (weapon) weapon.setAspect(camera.aspect);
});

// ---------- HUD refs ----------
const $ = id => document.getElementById(id);
const hud = {
  health: $('health-value'), healthFill: $('health-fill'),
  mag: $('ammo-mag'), reserve: $('ammo-reserve'),
  enemies: $('enemy-count'), overlay: $('overlay'),
  overlayMsg: $('overlay-msg'), vignette: $('damage-vignette'),
  hurtFlash: $('hurt-flash'), hitmarker: $('hitmarker'),
};

// ---------- game state ----------
let world = null, player = null, weapon = null, enemies = [];
let level = 1;
let running = false;
let pickups = [];

function makePickup(kind, pos) {
  const color = kind === 'health' ? 0x51d073 : 0xd0b451;
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4,
  });
  const geo = kind === 'health'
    ? new THREE.BoxGeometry(0.34, 0.34, 0.34)
    : new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos.x, 0.55, pos.z);
  scene.add(mesh);
  return { kind, mesh, pos: pos.clone(), taken: false };
}

function buildLevel() {
  // clear previous
  if (world) {
    scene.remove(world.group);
    for (const e of enemies) e.dispose();
    for (const p of pickups) scene.remove(p.mesh);
    scene.clear();
    scene.add(camera);
  }
  world = new World(scene, 30 + level * 2, 30 + level * 2);
  const spawn = world.roomCenterWorld(0);

  if (!player) player = new Player(camera, world, renderer.domElement);
  player.world = world;
  const wasDead = player.dead;
  player.spawnAt(spawn);

  if (!weapon) {
    weapon = new Weapon(camera, scene, world);
  } else {
    weapon.world = world;
    weapon.attachSparks(scene);
    if (wasDead) { weapon.mag = 15; weapon.reserve = 60; weapon.reloading = 0; }
  }

  const count = 5 + level * 2;
  enemies = spawnEnemies(scene, world, count, spawn);

  pickups = [];
  for (let i = 1; i < world.rooms.length; i += 2) {
    const c = world.roomCenterWorld(i);
    c.x += 1; c.z += 1;
    if (world.isOpenWorld(c.x, c.z))
      pickups.push(makePickup(Math.random() < 0.5 ? 'health' : 'ammo', c));
  }
  hud.enemies.textContent = enemies.length;
}

function onPlayerHit(dmg) {
  player.takeDamage(dmg);
  hurtSound();
  hud.hurtFlash.style.opacity = '1';
  setTimeout(() => hud.hurtFlash.style.opacity = '0', 90);
  if (player.dead) {
    deathSound();
    running = false;
    showOverlay('K.I.A.', 'CLICK / TAP TO RESTART SECTOR');
  }
}

function showOverlay(title, msg) {
  hud.overlay.querySelector('h1').textContent = title;
  hud.overlayMsg.textContent = msg;
  hud.overlay.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function startGame() {
  hud.overlay.classList.add('hidden');
  unlockAudio();
  startAmbient();
  if (!player || player.dead || enemies.filter(e => e.alive).length === 0) {
    buildLevel();
  }
  running = true;
  lockPointer();
}

function lockPointer() {
  if (player.isTouch || document.pointerLockElement) return;
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

hud.overlay.addEventListener('click', startGame);
hud.overlay.addEventListener('touchend', e => { e.preventDefault(); startGame(); }, { passive: false });
// if a pointer-lock request was rejected (rapid Esc+click), clicking the canvas re-locks
renderer.domElement.addEventListener('click', () => { if (running && player) lockPointer(); });

// re-show menu if pointer lock is lost mid-game (Esc)
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && running && player && !player.isTouch && !player.dead) {
    running = false;
    showOverlay('PAUSED', 'CLICK TO RESUME');
  }
});
// ---------- loop ----------
const clock = new THREE.Clock();

function updateHUD() {
  hud.health.textContent = Math.ceil(player.health);
  const pct = player.health / player.maxHealth;
  hud.healthFill.style.width = (pct * 100) + '%';
  hud.healthFill.style.background = pct > 0.5 ? '#7fc97f' : pct > 0.25 ? '#d4b451' : '#d05151';
  hud.vignette.style.opacity = pct < 0.4 ? String(0.9 - pct * 1.5) : '0';
  hud.mag.textContent = weapon.reloading > 0 ? '--' : weapon.mag;
  hud.reserve.textContent = weapon.reserve;
  hud.enemies.textContent = enemies.filter(e => e.alive).length;
}

let hitmarkerT = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!world) { renderer.render(scene, camera); return; }

  if (running) {
    player.update(dt);
    world.update(dt);

    if (player.wantReload) { player.wantReload = false; weapon.startReload(); }
    if (player.wantFire && !player.dead) {
      const res = weapon.tryFire(player, enemies);
      if (res && res.hitEnemy) {
        hitmarkerT = 0.18;
        hud.hitmarker.style.opacity = '1';
      }
      if (res && res.killed) {
        const left = enemies.filter(e => e.alive).length;
        if (left === 0) {
          running = false;
          level++;
          setTimeout(() => showOverlay('SECTOR CLEAR', `ENTERING SECTOR ${level} — CLICK / TAP TO CONTINUE`), 900);
        }
      }
    }

    for (const e of enemies) e.update(dt, player, onPlayerHit);

    // pickups
    for (const p of pickups) {
      if (p.taken) continue;
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.55 + Math.sin(clock.elapsedTime * 3 + p.pos.x) * 0.08;
      if (player.pos.distanceTo(p.pos) < 0.9) {
        p.taken = true;
        p.mesh.visible = false;
        pickupSound();
        if (p.kind === 'health') player.health = Math.min(player.maxHealth, player.health + 35);
        else weapon.addAmmo(30);
      }
    }

    weapon.update(dt, player);
    updateHUD();

    if (hitmarkerT > 0) {
      hitmarkerT -= dt;
      if (hitmarkerT <= 0) hud.hitmarker.style.opacity = '0';
    }
  } else if (player) {
    // still render (paused/menu behind overlay)
    player.update(0);
  }

  renderer.clear();
  renderer.render(scene, camera);
  if (weapon && !player?.dead) {
    renderer.clearDepth();
    renderer.render(weapon.vmScene, weapon.vmCamera);
  }
}

tick();

// debug/testing: ?autostart skips the menu; &nearenemy teleports next to a hostile
if (location.search.includes('autostart')) {
  startGame();
  if (location.search.includes('nearenemy') && enemies.length) {
    const e = enemies[0];
    player.pos.set(e.pos.x + 3, 0, e.pos.z + 0.5);
    player.pos.copy(world.collide(player.pos, 0.38));
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
    player.yaw = Math.atan2(-dx, -dz);
  }
}

// PWA service worker (best-effort; game works fine without it)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
