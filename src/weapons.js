// Player weapons: carbine + shotgun with swap, rendered in a separate
// viewmodel pass (so world lights can't blow them out and they never clip
// into walls). Hitscan ballistics, muzzle flash, impact FX.
import * as THREE from 'three';
import { gunshot, reloadSound, hitmarkerSound } from './audio.js';

const HEADSHOT_MULT = 2.2;
const SWAP_TIME = 0.4;

const DEFS = [
  {
    name: '9MM CARBINE',
    fireRate: 0.13, reloadTime: 1.4, magSize: 15, maxReserve: 180,
    damage: [16, 26], pellets: 1, spread: 0.004, moveSpread: 0.012,
    range: 60, flashScale: 1,
  },
  {
    name: 'COMBAT SHOTGUN',
    fireRate: 0.95, reloadTime: 2.1, magSize: 6, maxReserve: 42,
    damage: [8, 13], pellets: 8, spread: 0.045, moveSpread: 0.01,
    range: 26, flashScale: 1.7,
  },
];

function buildCarbine() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.55, metalness: 0.55 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a332a, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.52), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.4);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), grip);
  handle.position.set(0, -0.12, 0.12);
  handle.rotation.x = 0.25;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.22), grip);
  stock.position.set(0, -0.02, 0.32);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), dark);
  sight.position.set(0, 0.085, -0.1);
  g.add(body, barrel, handle, stock, sight);
  return g;
}

function buildShotgun() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.5, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.85 });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.34), steel);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 12), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.42);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 10), steel);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, -0.045, -0.37);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.07, 0.16), wood);
  pump.position.set(0, -0.045, -0.32);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.17, 0.1), wood);
  grip.position.set(0, -0.13, 0.1);
  grip.rotation.x = 0.3;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.26), wood);
  stock.position.set(0, -0.03, 0.32);
  g.add(receiver, barrel, tube, pump, grip, stock);
  g.userData.pump = pump;
  return g;
}

export class Weapon {
  constructor(camera, scene, world) {
    this.camera = camera;
    this.scene = scene;
    this.world = world;

    // --- separate viewmodel scene/camera ---
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 5);
    this.vmScene.add(new THREE.AmbientLight(0x8a929c, 1.4));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.6);
    key.position.set(-0.5, 1, 0.3);
    this.vmScene.add(key);

    // muzzle flash: crossed additive quads, shared by both weapons
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc873, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    this.slots = DEFS.map((def, i) => {
      const vm = i === 0 ? buildCarbine() : buildShotgun();
      vm.position.set(0.24, -0.24, -0.5);
      vm.visible = i === 0;
      this.vmScene.add(vm);
      const flashGeo = new THREE.PlaneGeometry(0.22 * def.flashScale, 0.22 * def.flashScale);
      const f1 = new THREE.Mesh(flashGeo, this.flashMat);
      f1.position.set(0, 0.02, -0.62);
      const f2 = f1.clone();
      f2.rotation.y = Math.PI / 2;
      vm.add(f1, f2);
      return { def, vm, mag: def.magSize, reserve: i === 0 ? 60 : 18 };
    });
    this.cur = 0;
    this.swapT = 0;

    // light the *world* when firing (attached to main camera)
    this.worldMuzzle = new THREE.PointLight(0xffb45e, 0, 9, 1.8);
    this.worldMuzzle.position.set(0.2, -0.1, -0.8);
    camera.add(this.worldMuzzle);

    this.cooldown = 0;
    this.reloading = 0;
    this.kick = 0;

    this.sparks = [];
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });
    this.attachSparks(scene);
  }

  get current() { return this.slots[this.cur]; }
  get mag() { return this.current.mag; }
  get reserve() { return this.current.reserve; }

  swap() {
    if (this.swapT > 0) return;
    this.cur = (this.cur + 1) % this.slots.length;
    this.reloading = 0;
    this.cooldown = 0;
    this.swapT = SWAP_TIME;
    for (let i = 0; i < this.slots.length; i++) this.slots[i].vm.visible = i === this.cur;
    reloadSound();
  }

  // (re)create impact particles in the given scene — called after level rebuilds
  attachSparks(scene) {
    this.scene = scene;
    this.sparks = [];
    const sparkGeo = new THREE.SphereGeometry(0.02, 4, 4);
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Mesh(sparkGeo, this.sparkMat);
      s.visible = false;
      s.userData = { vel: new THREE.Vector3(), life: 0 };
      scene.add(s);
      this.sparks.push(s);
    }
  }

  setAspect(aspect) {
    this.vmCamera.aspect = aspect;
    this.vmCamera.updateProjectionMatrix();
  }

  addAmmo() {
    this.slots[0].reserve = Math.min(DEFS[0].maxReserve, this.slots[0].reserve + 30);
    this.slots[1].reserve = Math.min(DEFS[1].maxReserve, this.slots[1].reserve + 8);
  }

  resetAmmo() {
    this.slots[0].mag = DEFS[0].magSize; this.slots[0].reserve = 60;
    this.slots[1].mag = DEFS[1].magSize; this.slots[1].reserve = 18;
    this.reloading = 0;
    this.cooldown = 0;
  }

  startReload() {
    const s = this.current;
    if (this.reloading > 0 || this.swapT > 0 || s.mag === s.def.magSize || s.reserve === 0) return;
    this.reloading = s.def.reloadTime;
    reloadSound();
  }

  spawnImpact(point, count = 6) {
    let used = 0;
    for (const s of this.sparks) {
      if (used >= count) break;
      if (s.visible) continue;
      s.visible = true;
      s.position.copy(point);
      s.userData.life = 0.25 + Math.random() * 0.2;
      s.userData.vel.set(
        (Math.random() - 0.5) * 4,
        Math.random() * 3,
        (Math.random() - 0.5) * 4);
      used++;
    }
  }

  // single hitscan pellet; returns {enemy, dist, head} or {wallDist}
  tracePellet(origin, dir, enemies, range) {
    const wallDist = this.world.raycastWalls(origin, dir, range);
    let best = null, bestDist = Infinity, bestHead = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      const r = e.radius, top = e.height;
      const ex = e.pos.x - origin.x, ez = e.pos.z - origin.z;
      const dx = dir.x, dz = dir.z;
      const a = dx * dx + dz * dz;
      if (a < 1e-8) continue;
      const t = (ex * dx + ez * dz) / a;
      if (t < 0 || t > range || t > bestDist || t > wallDist) continue;
      const px = origin.x + dir.x * t - e.pos.x;
      const pz = origin.z + dir.z * t - e.pos.z;
      if (px * px + pz * pz > r * r) continue;
      const hitY = origin.y + dir.y * t;
      if (hitY < 0 || hitY > top) continue;
      best = e; bestDist = t; bestHead = hitY > top * 0.78;
    }
    return { enemy: best, dist: bestDist, head: bestHead, wallDist };
  }

  // returns {hitEnemy, killed} or null if couldn't fire
  tryFire(player, enemies) {
    if (this.cooldown > 0 || this.reloading > 0 || this.swapT > 0) return null;
    const s = this.current, def = s.def;
    if (s.mag <= 0) { this.startReload(); return null; }
    s.mag--;
    this.cooldown = def.fireRate;
    this.kick = def.pellets > 1 ? 1.6 : 1;
    player.recoil = Math.min(1.8, player.recoil + (def.pellets > 1 ? 0.9 : 0.55));
    gunshot();
    this.flashMat.opacity = 0.9;
    this.worldMuzzle.intensity = 30 * def.flashScale;

    const origin = player.eyePos();
    const baseDir = player.forwardDir();
    let spread = def.spread;
    if (player.speedNow > 3) spread += def.moveSpread;
    if (!player.grounded) spread += 0.02;

    let hitAny = null, killedAny = false, headAny = false;
    for (let p = 0; p < def.pellets; p++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread * 2;
      dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      const hit = this.tracePellet(origin, dir, enemies, def.range);
      if (hit.enemy) {
        const dmg = (def.damage[0] + Math.random() * (def.damage[1] - def.damage[0])) * (hit.head ? HEADSHOT_MULT : 1);
        const wasAlive = hit.enemy.alive;
        hit.enemy.takeDamage(dmg, player);
        hitAny = hit.enemy;
        headAny = headAny || hit.head;
        if (wasAlive && !hit.enemy.alive) killedAny = true;
        this.spawnImpact(origin.clone().addScaledVector(dir, hit.dist), 2);
      } else if (hit.wallDist !== Infinity) {
        this.spawnImpact(origin.clone().addScaledVector(dir, hit.wallDist), def.pellets > 1 ? 1 : 6);
      }
    }
    if (hitAny) hitmarkerSound();
    return { hitEnemy: hitAny, killed: killedAny, headshot: headAny };
  }

  update(dt, player) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swapT = Math.max(0, this.swapT - dt);
    const s = this.current, def = s.def;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = def.magSize - s.mag;
        const take = Math.min(need, s.reserve);
        s.mag += take;
        s.reserve -= take;
        this.reloading = 0;
      }
    }

    // viewmodel motion: kick + bob + reload dip + swap raise
    this.kick = Math.max(0, this.kick - dt * 9);
    const bob = Math.sin(player.bobPhase * 2) * player.bobAmp * 0.6;
    const reloadDip = this.reloading > 0
      ? Math.sin(Math.min(1, (def.reloadTime - this.reloading) / def.reloadTime) * Math.PI) * 0.28 : 0;
    const swapDip = this.swapT > 0 ? (this.swapT / SWAP_TIME) * 0.35 : 0;
    const vm = s.vm;
    vm.position.set(
      0.24 + Math.cos(player.bobPhase) * player.bobAmp * 0.3,
      -0.24 + bob - reloadDip - swapDip,
      -0.5 + this.kick * 0.06);
    vm.rotation.x = this.kick * 0.14 - (reloadDip + swapDip) * 1.2;

    // shotgun pump slides during cooldown
    const pump = vm.userData.pump;
    if (pump) {
      const ph = def.fireRate > 0.5 && this.cooldown > 0
        ? Math.sin((1 - this.cooldown / def.fireRate) * Math.PI) : 0;
      pump.position.z = -0.32 + ph * 0.09;
    }

    // flash decay
    this.flashMat.opacity = Math.max(0, this.flashMat.opacity - dt * 12);
    this.worldMuzzle.intensity = Math.max(0, this.worldMuzzle.intensity - dt * 260);

    // sparks
    for (const sp of this.sparks) {
      if (!sp.visible) continue;
      sp.userData.life -= dt;
      if (sp.userData.life <= 0) { sp.visible = false; continue; }
      sp.userData.vel.y -= 9.8 * dt;
      sp.position.addScaledVector(sp.userData.vel, dt);
    }
  }
}
