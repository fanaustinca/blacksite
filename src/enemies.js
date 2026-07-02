// Enemy soldiers: low-poly humanoids with patrol/chase/shoot AI.
import * as THREE from 'three';
import { CELL } from './world.js';
import { enemyShot } from './audio.js';

const SPEED = 2.6;
const SIGHT_RANGE = 26;
const FOV = Math.PI * 0.55;          // ~100 degrees
const ATTACK_RANGE = 16;
const FIRE_INTERVAL = [0.9, 1.7];    // seconds between shots
const DAMAGE = [7, 14];
const ACCURACY_FALLOFF = 12;         // hit chance drops with distance

function buildSoldierMesh() {
  const g = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: 0x3a4034, roughness: 0.9 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6f58, roughness: 0.85 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0.6 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), uniform);
  torso.position.y = 1.12;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.34), gear);
  vest.position.y = 1.18;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin);
  head.position.y = 1.61;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.32), gear);
  helmet.position.y = 1.72;

  const mkLimb = (w, h, mat) => {
    const pivot = new THREE.Group();
    const seg = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    seg.position.y = -h / 2;
    pivot.add(seg);
    return pivot;
  };
  const legL = mkLimb(0.17, 0.8, uniform); legL.position.set(-0.14, 0.82, 0);
  const legR = mkLimb(0.17, 0.8, uniform); legR.position.set(0.14, 0.82, 0);
  const armL = mkLimb(0.13, 0.58, uniform); armL.position.set(-0.34, 1.38, 0);
  const armR = mkLimb(0.13, 0.58, uniform); armR.position.set(0.34, 1.38, 0);
  // arms raised holding rifle
  armL.rotation.x = -1.15; armR.rotation.x = -1.15;
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7), gunMat);
  rifle.position.set(0.1, 1.32, -0.42);

  g.add(torso, vest, head, helmet, legL, legR, armL, armR, rifle);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, legL, legR, head, rifle };
}

export class Enemy {
  constructor(scene, world, spawnPos) {
    this.world = world;
    this.scene = scene;
    const parts = buildSoldierMesh();
    this.mesh = parts.group;
    this.parts = parts;
    this.pos = spawnPos.clone();
    this.mesh.position.copy(this.pos);
    this.yaw = Math.random() * Math.PI * 2;
    this.health = 45;
    this.state = 'patrol';
    this.alive = true;
    this.deathT = 0;
    this.fireTimer = 1 + Math.random() * 2;
    this.walkPhase = Math.random() * 10;
    this.patrolTarget = null;
    this.patrolWait = Math.random() * 2;
    this.hitFlash = 0;
    this.muzzle = new THREE.PointLight(0xffb45e, 0, 7, 2);
    this.muzzle.position.set(0.1, 1.32, -0.8);
    this.mesh.add(this.muzzle);
    scene.add(this.mesh);
  }

  takeDamage(amount, player) {
    if (!this.alive) return;
    this.health -= amount;
    this.hitFlash = 0.12;
    // getting shot alerts them regardless of LOS
    this.state = 'chase';
    if (this.health <= 0) {
      this.alive = false;
      this.state = 'dead';
      this.deathT = 0;
    }
  }

  canSee(player) {
    const toP = new THREE.Vector3().subVectors(player.pos, this.pos);
    const dist = toP.length();
    if (dist > SIGHT_RANGE) return false;
    const facing = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    toP.normalize();
    if (this.state === 'patrol' && facing.dot(toP) < Math.cos(FOV / 2)) return false;
    const eyeA = this.pos.clone().setY(1.6);
    const eyeB = player.pos.clone().setY(1.5);
    return this.world.hasLOS(eyeA, eyeB);
  }

  pickPatrolTarget() {
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = 3 + Math.random() * 7;
      const t = new THREE.Vector3(
        this.pos.x + Math.cos(ang) * d, 0,
        this.pos.z + Math.sin(ang) * d);
      if (this.world.isOpenWorld(t.x, t.z)) return t;
    }
    return null;
  }

  moveToward(target, dt, speedScale = 1) {
    const dir = new THREE.Vector3().subVectors(target, this.pos);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 0.4) return true;
    dir.normalize();
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    // shortest-arc turn
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, 8 * dt);
    this.pos.x += dir.x * SPEED * speedScale * dt;
    this.pos.z += dir.z * SPEED * speedScale * dt;
    this.pos.copy(this.world.collide(this.pos, 0.35));
    this.walkPhase += dt * 7 * speedScale;
    return false;
  }

  update(dt, player, onPlayerHit) {
    if (!this.alive) {
      // death: fall over and sink slightly
      this.deathT += dt;
      const t = Math.min(1, this.deathT * 2.2);
      this.mesh.rotation.x = -t * Math.PI / 2 * 0.96;
      this.mesh.position.y = -t * 0.12;
      if (this.hitFlash > 0) this.hitFlash -= dt;
      return;
    }

    const seesPlayer = !player.dead && this.canSee(player);
    const distToPlayer = this.pos.distanceTo(player.pos);

    if (this.state === 'patrol') {
      if (seesPlayer) {
        this.state = 'chase';
      } else if (this.patrolTarget) {
        if (this.moveToward(this.patrolTarget, dt, 0.5)) {
          this.patrolTarget = null;
          this.patrolWait = 1 + Math.random() * 3;
        }
      } else {
        this.patrolWait -= dt;
        if (this.patrolWait <= 0) this.patrolTarget = this.pickPatrolTarget();
      }
    } else if (this.state === 'chase') {
      // face/approach player; stop at attack range if visible
      if (seesPlayer && distToPlayer < ATTACK_RANGE) {
        // aim at player
        const dir = new THREE.Vector3().subVectors(player.pos, this.pos);
        const targetYaw = Math.atan2(-dir.x, -dir.z);
        let dy = targetYaw - this.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw += dy * Math.min(1, 10 * dt);
        // strafe a little
        this.walkPhase += dt * 3;
        this.fireTimer -= dt;
        if (this.fireTimer <= 0 && Math.abs(dy) < 0.3) {
          this.fireTimer = FIRE_INTERVAL[0] + Math.random() * (FIRE_INTERVAL[1] - FIRE_INTERVAL[0]);
          this.shoot(player, distToPlayer, onPlayerHit);
        }
      } else {
        this.moveToward(player.pos, dt, 1);
        if (!seesPlayer && distToPlayer > SIGHT_RANGE * 1.3) this.state = 'patrol';
      }
    }

    // walk animation
    const swing = Math.sin(this.walkPhase) * 0.55;
    this.parts.legL.rotation.x = swing;
    this.parts.legR.rotation.x = -swing;

    // hit flash
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.mesh.traverse(o => { if (o.isMesh) o.material.emissive?.setHex(0x661111); });
    } else {
      this.mesh.traverse(o => { if (o.isMesh) o.material.emissive?.setHex(0x000000); });
    }

    // muzzle light decay
    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 60);

    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.yaw;
  }

  shoot(player, dist, onPlayerHit) {
    this.muzzle.intensity = 9;
    enemyShot();
    // hit chance decreases with distance; moving player is harder to hit
    let chance = 0.75 - dist / ACCURACY_FALLOFF * 0.35;
    if (player.speedNow > 3) chance -= 0.2;
    if (Math.random() < Math.max(0.08, chance)) {
      const dmg = DAMAGE[0] + Math.random() * (DAMAGE[1] - DAMAGE[0]);
      onPlayerHit(dmg);
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse(o => {
      if (o.isMesh) { o.geometry.dispose(); }
    });
  }
}

export function spawnEnemies(scene, world, count, playerPos) {
  const enemies = [];
  const candidates = [];
  for (const room of world.rooms) {
    const c = new THREE.Vector3(room.cx * CELL + CELL / 2, 0, room.cy * CELL + CELL / 2);
    if (c.distanceTo(playerPos) > CELL * 4) candidates.push(room);
  }
  let i = 0;
  while (enemies.length < count && candidates.length > 0) {
    const room = candidates[i % candidates.length];
    const gx = room.x + 1 + ((Math.random() * (room.w - 2)) | 0);
    const gy = room.y + 1 + ((Math.random() * (room.h - 2)) | 0);
    const p = new THREE.Vector3(gx * CELL + CELL / 2, 0, gy * CELL + CELL / 2);
    if (world.isOpenWorld(p.x, p.z) && p.distanceTo(playerPos) > CELL * 3) {
      enemies.push(new Enemy(scene, world, p));
    }
    i++;
    if (i > count * 20) break; // safety
  }
  return enemies;
}
