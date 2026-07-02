// Player weapon: viewmodel carbine (rendered in its own pass so world lights
// can't blow it out and it never clips into walls), hitscan shooting, FX.
import * as THREE from 'three';
import { gunshot, reloadSound, hitmarkerSound } from './audio.js';

const FIRE_RATE = 0.13;       // seconds per shot (hold to fire)
const RELOAD_TIME = 1.4;
const MAG_SIZE = 15;
const DAMAGE = [16, 26];
const HEADSHOT_MULT = 2.2;
const RANGE = 60;

function buildViewmodel() {
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

  // muzzle flash: crossed additive quads
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffc873, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flashGeo = new THREE.PlaneGeometry(0.22, 0.22);
  const flash1 = new THREE.Mesh(flashGeo, flashMat);
  flash1.position.set(0, 0.02, -0.58);
  const flash2 = flash1.clone();
  flash2.rotation.y = Math.PI / 2;
  g.add(flash1, flash2);

  return { group: g, flashMat };
}

export class Weapon {
  constructor(camera, scene, world) {
    this.camera = camera;
    this.scene = scene;
    this.world = world;

    // --- separate viewmodel scene/camera ---
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 5);
    const vm = buildViewmodel();
    this.vm = vm.group;
    this.flashMat = vm.flashMat;
    this.vm.position.set(0.24, -0.24, -0.5);
    this.vmScene.add(this.vm);
    this.vmScene.add(new THREE.AmbientLight(0x8a929c, 1.4));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.6);
    key.position.set(-0.5, 1, 0.3);
    this.vmScene.add(key);

    // light the *world* when firing (attached to main camera)
    this.worldMuzzle = new THREE.PointLight(0xffb45e, 0, 9, 1.8);
    this.worldMuzzle.position.set(0.2, -0.1, -0.8);
    camera.add(this.worldMuzzle);

    this.mag = MAG_SIZE;
    this.reserve = 60;
    this.cooldown = 0;
    this.reloading = 0;
    this.kick = 0;

    this.sparks = [];
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });
    this.attachSparks(scene);
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

  addAmmo(n) { this.reserve = Math.min(180, this.reserve + n); }

  startReload() {
    if (this.reloading > 0 || this.mag === MAG_SIZE || this.reserve === 0) return;
    this.reloading = RELOAD_TIME;
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

  // returns {hitEnemy, killed} or null if couldn't fire
  tryFire(player, enemies) {
    if (this.cooldown > 0 || this.reloading > 0) return null;
    if (this.mag <= 0) { this.startReload(); return null; }
    this.mag--;
    this.cooldown = FIRE_RATE;
    this.kick = 1;
    player.recoil = Math.min(1.6, player.recoil + 0.55);
    gunshot();
    this.flashMat.opacity = 0.9;
    this.worldMuzzle.intensity = 30;

    const origin = player.eyePos();
    const dir = player.forwardDir();
    // slight spread, worse while moving
    const spread = 0.004 + (player.speedNow > 3 ? 0.012 : 0);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();

    const wallDist = this.world.raycastWalls(origin, dir, RANGE);

    // enemy hit test: ray vs vertical cylinder per enemy
    let best = null, bestDist = Infinity, bestHead = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = e.pos.x - origin.x, ez = e.pos.z - origin.z;
      const dx = dir.x, dz = dir.z;
      const a = dx * dx + dz * dz;
      if (a < 1e-8) continue;
      const t = (ex * dx + ez * dz) / a;
      if (t < 0 || t > RANGE || t > bestDist || t > wallDist) continue;
      const px = origin.x + dir.x * t - e.pos.x;
      const pz = origin.z + dir.z * t - e.pos.z;
      const perp2 = px * px + pz * pz;
      if (perp2 > 0.38 * 0.38) continue;
      const hitY = origin.y + dir.y * t;
      if (hitY < 0 || hitY > 1.85) continue;
      best = e; bestDist = t; bestHead = hitY > 1.45;
    }

    if (best) {
      const dmg = (DAMAGE[0] + Math.random() * (DAMAGE[1] - DAMAGE[0])) * (bestHead ? HEADSHOT_MULT : 1);
      const wasAlive = best.alive;
      best.takeDamage(dmg, player);
      hitmarkerSound();
      const hitPoint = origin.clone().addScaledVector(dir, bestDist);
      this.spawnImpact(hitPoint, 4);
      return { hitEnemy: best, killed: wasAlive && !best.alive, headshot: bestHead };
    }

    if (wallDist !== Infinity) {
      const hitPoint = origin.clone().addScaledVector(dir, wallDist);
      this.spawnImpact(hitPoint, 6);
    }
    return { hitEnemy: null, killed: false };
  }

  update(dt, player) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = MAG_SIZE - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloading = 0;
      }
    }

    // viewmodel motion: kick + bob + reload dip
    this.kick = Math.max(0, this.kick - dt * 9);
    const bob = Math.sin(player.bobPhase * 2) * player.bobAmp * 0.6;
    const reloadDip = this.reloading > 0 ? Math.sin(Math.min(1, (RELOAD_TIME - this.reloading) / RELOAD_TIME) * Math.PI) * 0.28 : 0;
    this.vm.position.set(
      0.24 + Math.cos(player.bobPhase) * player.bobAmp * 0.3,
      -0.24 + bob - reloadDip,
      -0.5 + this.kick * 0.06);
    this.vm.rotation.x = this.kick * 0.14 - reloadDip * 1.2;

    // flash decay
    this.flashMat.opacity = Math.max(0, this.flashMat.opacity - dt * 12);
    this.worldMuzzle.intensity = Math.max(0, this.worldMuzzle.intensity - dt * 260);

    // sparks
    for (const s of this.sparks) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) { s.visible = false; continue; }
      s.userData.vel.y -= 9.8 * dt;
      s.position.addScaledVector(s.userData.vel, dt);
    }
  }
}
