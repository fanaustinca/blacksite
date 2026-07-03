// Frag grenades: thrown ballistics with wall bounces, fuse, radial damage.
import * as THREE from 'three';
import { CELL } from './world.js';
import { explosionSound, throwWhoosh } from './audio.js';
import { MODS } from './mods.js';

const FUSE = 2.1;
const RADIUS = 4.6;
const MAX_DMG = 95;
const SELF_SCALE = 0.5;   // you take half damage from your own grenades

export class GrenadeManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.count = MODS.grenadeCap;
    this.live = [];
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2c3328, roughness: 0.6, metalness: 0.3,
      emissive: 0xff2200, emissiveIntensity: 0,
    });
    this.geo = new THREE.SphereGeometry(0.09, 8, 8);

    // shared explosion FX
    this.boomLight = new THREE.PointLight(0xffa040, 0, 18, 1.6);
    scene.add(this.boomLight);
    this.debris = [];
    const dGeo = new THREE.SphereGeometry(0.035, 4, 4);
    const dMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(dGeo, dMat);
      m.visible = false;
      m.userData = { vel: new THREE.Vector3(), life: 0 };
      scene.add(m);
      this.debris.push(m);
    }
  }

  attach(scene, world) {
    this.scene = scene;
    this.world = world;
    scene.add(this.boomLight);
    for (const d of this.debris) scene.add(d);
    for (const g of this.live) g.dead = true;
    this.live = [];
  }

  throw(origin, dir) {
    if (this.count <= 0) return false;
    this.count--;
    throwWhoosh();
    const mesh = new THREE.Mesh(this.geo, this.bodyMat.clone());
    mesh.position.copy(origin).addScaledVector(dir, 0.4);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.live.push({
      mesh,
      pos: mesh.position.clone(),
      vel: dir.clone().multiplyScalar(11).add(new THREE.Vector3(0, 3.2, 0)),
      fuse: FUSE,
      dead: false,
    });
    return true;
  }

  // onDamageEnemy(enemy, dmg), onDamagePlayer(dmg), onBoom(pos)
  update(dt, enemies, playerPos, onDamageEnemy, onDamagePlayer, onBoom) {
    for (const g of this.live) {
      if (g.dead) continue;
      g.fuse -= dt;
      // blink faster near detonation
      g.mesh.material.emissiveIntensity = (Math.sin(g.fuse * (g.fuse < 0.8 ? 40 : 12)) > 0) ? 1.2 : 0;

      g.vel.y -= 22 * dt;
      // axis-separated wall bounce
      const nx = g.pos.x + g.vel.x * dt;
      if (this.world.isBlocked(Math.floor(nx / CELL), Math.floor(g.pos.z / CELL))) g.vel.x *= -0.42;
      else g.pos.x = nx;
      const nz = g.pos.z + g.vel.z * dt;
      if (this.world.isBlocked(Math.floor(g.pos.x / CELL), Math.floor(nz / CELL))) g.vel.z *= -0.42;
      else g.pos.z = nz;
      g.pos.y += g.vel.y * dt;
      if (g.pos.y < 0.09) {
        g.pos.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) > 1.2 ? -g.vel.y * 0.42 : 0;
        g.vel.x *= 0.92; g.vel.z *= 0.92; // ground friction
      }
      g.mesh.position.copy(g.pos);

      if (g.fuse <= 0) {
        g.dead = true;
        this.scene.remove(g.mesh);
        this.explode(g.pos, enemies, playerPos, onDamageEnemy, onDamagePlayer, onBoom);
      }
    }
    this.live = this.live.filter(g => !g.dead);

    // FX decay
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 160);
    for (const d of this.debris) {
      if (!d.visible) continue;
      d.userData.life -= dt;
      if (d.userData.life <= 0) { d.visible = false; continue; }
      d.userData.vel.y -= 14 * dt;
      d.position.addScaledVector(d.userData.vel, dt);
      if (d.position.y < 0.03) { d.position.y = 0.03; d.userData.vel.y *= -0.4; }
    }
  }

  explode(pos, enemies, playerPos, onDamageEnemy, onDamagePlayer, onBoom) {
    explosionSound();
    this.boomLight.position.copy(pos).setY(Math.max(0.6, pos.y));
    this.boomLight.intensity = 60;
    for (const d of this.debris) {
      d.visible = true;
      d.position.copy(pos);
      d.userData.life = 0.5 + Math.random() * 0.5;
      const ang = Math.random() * Math.PI * 2;
      const v = 3 + Math.random() * 6;
      d.userData.vel.set(Math.cos(ang) * v, 2 + Math.random() * 5, Math.sin(ang) * v);
    }
    const center = pos.clone().setY(1);
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = e.pos.clone().setY(1).distanceTo(center);
      if (d > RADIUS) continue;
      // explosions reach around thin cover a little; full LOS check for walls
      if (!this.world.hasLOS(center, e.pos.clone().setY(1)) && d > 1.5) continue;
      const dmg = MAX_DMG * (1 - d / RADIUS) * MODS.damage;
      onDamageEnemy(e, dmg);
    }
    if (playerPos) {
      const pd = playerPos.clone().setY(1).distanceTo(center);
      if (pd < RADIUS && (pd < 1.5 || this.world.hasLOS(center, playerPos.clone().setY(1)))) {
        onDamagePlayer(MAX_DMG * (1 - pd / RADIUS) * SELF_SCALE);
      }
    }
    if (onBoom) onBoom(pos);
  }
}
