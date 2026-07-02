// Enemy soldiers: low-poly humanoids with squad AI.
// States: patrol -> investigate (heard/was told something) -> combat.
// They pathfind through the level, strafe in firefights, share alerts with
// nearby allies, and hunt your last known position when you break contact.
//
// Types: grunt (rifleman), rusher (fast, melee), heavy (slow, tough, burst fire).
import * as THREE from 'three';
import { CELL } from './world.js';
import { enemyShot } from './audio.js';

const SIGHT_RANGE = 26;
const FOV = Math.PI * 0.55;          // ~100 degrees while not in combat
const TOO_CLOSE = 4;                 // ranged units back away under this
const ACCURACY_FALLOFF = 12;
const ALERT_RADIUS = 14;             // shout to allies on contact
const LOSE_CONTACT_T = 3.5;          // seconds without LOS before hunting
const SEARCH_T = 3.0;                // seconds looking around at last known pos

const TYPES = {
  grunt: {
    hp: 45, speed: 2.6, scale: 1.0,
    uniform: 0x3a4034, gear: 0x23261f, rifle: true,
    attackRange: 16, fireInterval: [0.8, 1.5], damage: [7, 14], burst: 1,
    melee: false,
  },
  rusher: {
    hp: 30, speed: 4.4, scale: 0.92,
    uniform: 0x5c3230, gear: 0x2b1a18, rifle: false,
    attackRange: 1.7, melee: true, meleeDamage: [10, 16], meleeInterval: 0.75,
  },
  heavy: {
    hp: 130, speed: 1.7, scale: 1.22,
    uniform: 0x2e3138, gear: 0x17181c, rifle: true,
    attackRange: 18, fireInterval: [1.7, 2.6], damage: [6, 10], burst: 3,
    melee: false,
  },
};

function buildSoldierMesh(cfg) {
  const g = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: cfg.uniform, roughness: 0.9 });
  const gear = new THREE.MeshStandardMaterial({ color: cfg.gear, roughness: 0.8 });
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
  g.add(torso, vest, head, helmet, legL, legR, armL, armR);

  if (cfg.rifle) {
    armL.rotation.x = -1.15; armR.rotation.x = -1.15;
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7), gunMat);
    rifle.position.set(0.1, 1.32, -0.42);
    g.add(rifle);
  } else {
    // knife fighter: arms forward and low, blade in right hand
    armL.rotation.x = -0.55; armR.rotation.x = -0.75;
    const knife = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.3), gunMat);
    knife.position.set(0.34, 0.95, -0.28);
    g.add(knife);
  }

  g.scale.setScalar(cfg.scale);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return { group: g, legL, legR, armL, armR, head };
}

export class Enemy {
  constructor(scene, world, spawnPos, type = 'grunt') {
    this.world = world;
    this.scene = scene;
    this.type = type;
    this.cfg = TYPES[type];
    const parts = buildSoldierMesh(this.cfg);
    this.mesh = parts.group;
    this.parts = parts;
    this.pos = spawnPos.clone();
    this.mesh.position.copy(this.pos);
    this.yaw = Math.random() * Math.PI * 2;
    this.health = this.cfg.hp;
    this.maxHealth = this.cfg.hp;
    this.radius = 0.38 * this.cfg.scale;
    this.height = 1.85 * this.cfg.scale;
    this.state = 'patrol';
    this.alive = true;
    this.deathT = 0;
    this.fireTimer = 1 + Math.random() * 2;
    this.meleeTimer = 0;
    this.burstLeft = 0;
    this.burstT = 0;
    this.walkPhase = Math.random() * 10;
    this.patrolTarget = null;
    this.patrolWait = Math.random() * 2;
    this.hitFlash = 0;

    // navigation
    this.path = null;
    this.pathGoal = new THREE.Vector3();
    this.repathT = Math.random() * 0.5;   // staggered so squads don't repath same frame

    // combat memory
    this.lastKnown = new THREE.Vector3();
    this.lostT = 0;
    this.searchT = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 1 + Math.random() * 1.5;
    this.needsAlertAllies = false;

    this.muzzle = new THREE.PointLight(0xffb45e, 0, 7, 2);
    this.muzzle.position.set(0.1, 1.32, -0.8);
    this.mesh.add(this.muzzle);

    // floating health bar (shows after taking damage)
    this.hpBarT = 0;
    const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x0c0e0c, depthWrite: false }));
    barBg.scale.set(0.72, 0.07, 1);
    const barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x62d072, depthWrite: false }));
    barFg.scale.set(0.68, 0.045, 1);
    barBg.renderOrder = 10; barFg.renderOrder = 11;
    barBg.position.y = this.height + 0.25;
    barFg.position.y = this.height + 0.25;
    barBg.visible = barFg.visible = false;
    // parent bars to the scene (not the mesh) so death rotation doesn't tip them
    this.barBg = barBg; this.barFg = barFg;
    scene.add(barBg, barFg);

    scene.add(this.mesh);
  }

  takeDamage(amount, player) {
    if (!this.alive) return;
    this.health -= amount;
    this.hitFlash = 0.12;
    this.hpBarT = 5;
    // getting shot: instant combat awareness + tell nearby allies
    this.lastKnown.copy(player.pos);
    if (this.state !== 'combat') this.needsAlertAllies = true;
    this.state = 'combat';
    this.lostT = 0;
    this.path = null;
    if (this.health <= 0) {
      this.alive = false;
      this.state = 'dead';
      this.deathT = 0;
      this.barBg.visible = this.barFg.visible = false;
    }
  }

  // gunshots and ally shouts
  hearNoise(pos) {
    if (!this.alive || this.state === 'combat') return;
    this.lastKnown.set(
      pos.x + (Math.random() - 0.5) * 2, 0,
      pos.z + (Math.random() - 0.5) * 2);
    this.state = 'investigate';
    this.searchT = SEARCH_T;
    this.path = null;
    this.repathT = 0;
  }

  canSee(player) {
    const toP = new THREE.Vector3().subVectors(player.pos, this.pos);
    const dist = toP.length();
    if (dist > SIGHT_RANGE) return false;
    // outside combat they only see inside their vision cone
    if (this.state !== 'combat') {
      const facing = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      toP.normalize();
      if (facing.dot(toP) < Math.cos(FOV / 2)) return false;
    }
    const eyeA = this.pos.clone().setY(1.6);
    const eyeB = player.pos.clone().setY(1.5);
    return this.world.hasLOS(eyeA, eyeB);
  }

  alertAllies(enemies, player) {
    for (const e of enemies) {
      if (e === this || !e.alive) continue;
      if (e.pos.distanceTo(this.pos) < ALERT_RADIUS) e.hearNoise(player.pos);
    }
  }

  pickPatrolTarget() {
    // prefer wandering toward a random room so patrols cover ground
    if (Math.random() < 0.4 && this.world.rooms.length > 1) {
      const r = this.world.rooms[(Math.random() * this.world.rooms.length) | 0];
      return new THREE.Vector3(r.cx * CELL + CELL / 2, 0, r.cy * CELL + CELL / 2);
    }
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

  faceToward(target, dt, turnSpeed = 8) {
    const dir = new THREE.Vector3().subVectors(target, this.pos);
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, turnSpeed * dt);
    return Math.abs(dy);
  }

  stepMove(dirX, dirZ, dt, speedScale) {
    this.pos.x += dirX * this.cfg.speed * speedScale * dt;
    this.pos.z += dirZ * this.cfg.speed * speedScale * dt;
    this.pos.copy(this.world.collide(this.pos, 0.35));
    this.walkPhase += dt * 7 * speedScale * (this.cfg.speed / 2.6);
  }

  // Pathfind toward goal and walk the path. Returns true when arrived.
  moveAlongPath(goal, dt, speedScale = 1) {
    if (this.pos.distanceTo(goal) < 0.6) return true;
    this.repathT -= dt;
    const goalMoved = this.pathGoal.distanceTo(goal) > CELL * 1.5;
    if (!this.path || this.path.length === 0 || (this.repathT <= 0 && goalMoved)) {
      this.path = this.world.findPath(this.pos, goal);
      this.pathGoal.copy(goal);
      this.repathT = 0.5 + Math.random() * 0.3;
      if (!this.path) return false; // unreachable
    }
    let wp = this.path[0];
    if (!wp) return true;
    if (this.pos.distanceTo(wp) < 0.5) {
      this.path.shift();
      wp = this.path[0];
      if (!wp) return this.pos.distanceTo(goal) < 1.2;
    }
    const dir = new THREE.Vector3().subVectors(wp, this.pos);
    dir.y = 0;
    dir.normalize();
    this.faceToward(wp, dt);
    this.stepMove(dir.x, dir.z, dt, speedScale);
    return false;
  }

  update(dt, player, onPlayerHit, enemies) {
    if (!this.alive) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT * 2.2);
      this.mesh.rotation.x = -t * Math.PI / 2 * 0.96;
      this.mesh.position.y = -t * 0.12;
      if (this.hitFlash > 0) this.hitFlash -= dt;
      return;
    }

    if (this.needsAlertAllies) {
      this.needsAlertAllies = false;
      this.alertAllies(enemies, player);
    }

    const seesPlayer = !player.dead && this.canSee(player);
    const distToPlayer = this.pos.distanceTo(player.pos);

    if (seesPlayer) {
      if (this.state !== 'combat') {
        this.needsAlertAllies = true; // shout on first contact
        this.state = 'combat';
        this.path = null;
      }
      this.lastKnown.copy(player.pos);
      this.lostT = 0;
    }

    if (this.state === 'patrol') {
      if (this.patrolTarget) {
        if (this.moveAlongPath(this.patrolTarget, dt, 0.45)) {
          this.patrolTarget = null;
          this.patrolWait = 1 + Math.random() * 3;
        }
      } else {
        this.patrolWait -= dt;
        if (this.patrolWait <= 0) { this.patrolTarget = this.pickPatrolTarget(); this.path = null; }
      }

    } else if (this.state === 'investigate') {
      // hurry to the noise, then sweep the area
      const arrived = this.moveAlongPath(this.lastKnown, dt, 0.85);
      if (arrived) {
        this.searchT -= dt;
        this.yaw += dt * 1.6; // scan around
        this.walkPhase += dt * 1.5;
        if (this.searchT <= 0) { this.state = 'patrol'; this.patrolTarget = null; this.path = null; }
      }

    } else if (this.state === 'combat') {
      if (this.cfg.melee) {
        this.updateMeleeCombat(dt, player, seesPlayer, distToPlayer, onPlayerHit);
      } else {
        this.updateRangedCombat(dt, player, seesPlayer, distToPlayer, onPlayerHit);
      }
    }

    // pending burst shots (heavy) fire even between AI decisions
    if (this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burstLeft--;
        this.burstT = 0.14;
        this.fireOne(player, distToPlayer, onPlayerHit, seesPlayer);
      }
    }

    // walk animation
    const swing = Math.sin(this.walkPhase) * 0.55;
    this.parts.legL.rotation.x = swing;
    this.parts.legR.rotation.x = -swing;
    if (this.cfg.melee) {
      // arm chop right after an attack, otherwise pumping arms while sprinting
      const chopping = this.meleeTimer > this.cfg.meleeInterval - 0.3;
      this.parts.armL.rotation.x = -0.55 + swing * 0.5;
      this.parts.armR.rotation.x = chopping ? -1.9 : -0.75 - swing * 0.5;
    }

    // hit flash
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.mesh.traverse(o => { if (o.isMesh) o.material.emissive?.setHex(0x661111); });
    } else {
      this.mesh.traverse(o => { if (o.isMesh) o.material.emissive?.setHex(0x000000); });
    }

    this.muzzle.intensity = Math.max(0, this.muzzle.intensity - dt * 60);

    // floating health bar
    if (this.hpBarT > 0) {
      this.hpBarT -= dt;
      const frac = Math.max(0, this.health / this.maxHealth);
      this.barBg.visible = this.barFg.visible = true;
      this.barBg.position.set(this.pos.x, this.height + 0.25, this.pos.z);
      this.barFg.position.set(this.pos.x, this.height + 0.25, this.pos.z);
      this.barFg.scale.set(0.68 * frac, 0.045, 1);
      this.barFg.material.color.setHex(frac > 0.5 ? 0x62d072 : frac > 0.25 ? 0xd0b451 : 0xd05151);
    } else {
      this.barBg.visible = this.barFg.visible = false;
    }

    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.yaw;
  }

  updateRangedCombat(dt, player, seesPlayer, distToPlayer, onPlayerHit) {
    if (seesPlayer && distToPlayer < this.cfg.attackRange) {
      const aimErr = this.faceToward(player.pos, dt, 10);

      // strafe perpendicular to the player; back off if too close
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeDir = -this.strafeDir;
        this.strafeT = 0.9 + Math.random() * 1.6;
      }
      const toP = new THREE.Vector3().subVectors(player.pos, this.pos).normalize();
      let mx = -toP.z * this.strafeDir, mz = toP.x * this.strafeDir;
      if (distToPlayer < TOO_CLOSE) { mx -= toP.x * 0.8; mz -= toP.z * 0.8; }
      const before = this.pos.clone();
      this.stepMove(mx, mz, dt, 0.5);
      // bumped into something -> reverse strafe
      if (this.pos.distanceTo(before) < this.cfg.speed * 0.5 * dt * 0.4) this.strafeDir = -this.strafeDir;

      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && aimErr < 0.25 && this.burstLeft === 0) {
        const [a, b] = this.cfg.fireInterval;
        this.fireTimer = a + Math.random() * (b - a);
        this.burstLeft = this.cfg.burst;
        this.burstT = 0;
      }
    } else if (seesPlayer) {
      this.moveAlongPath(player.pos, dt, 1);
    } else {
      this.huntLastKnown(dt);
    }
  }

  updateMeleeCombat(dt, player, seesPlayer, distToPlayer, onPlayerHit) {
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    if (distToPlayer < this.cfg.attackRange) {
      this.faceToward(player.pos, dt, 12);
      if (this.meleeTimer <= 0 && !player.dead) {
        this.meleeTimer = this.cfg.meleeInterval;
        const [a, b] = this.cfg.meleeDamage;
        onPlayerHit(a + Math.random() * (b - a));
      }
    } else if (seesPlayer || this.lostT < LOSE_CONTACT_T) {
      // sprint straight at the player, screaming (silently)
      this.moveAlongPath(seesPlayer ? player.pos : this.lastKnown, dt, 1);
      if (!seesPlayer) this.lostT += dt;
    } else {
      this.huntLastKnown(dt);
    }
  }

  huntLastKnown(dt) {
    this.lostT += dt;
    if (this.lostT > LOSE_CONTACT_T) {
      this.state = 'investigate';
      this.searchT = SEARCH_T;
      this.path = null;
    } else {
      this.moveAlongPath(this.lastKnown, dt, 1);
    }
  }

  fireOne(player, distToPlayer, onPlayerHit, seesPlayer) {
    this.muzzle.intensity = 9;
    enemyShot();
    if (!seesPlayer || player.dead) return; // suppressing fire at nothing
    let chance = 0.75 - distToPlayer / ACCURACY_FALLOFF * 0.35;
    if (player.speedNow > 3) chance -= 0.2;   // sprinting is harder to hit
    if (!player.grounded) chance -= 0.18;      // jumping too
    if (Math.random() < Math.max(0.08, chance)) {
      const [a, b] = this.cfg.damage;
      onPlayerHit(a + Math.random() * (b - a));
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.barBg);
    this.scene.remove(this.barFg);
    this.mesh.traverse(o => {
      if (o.isMesh) { o.geometry.dispose(); }
    });
  }
}

// Level-scaled squad composition: rushers appear from sector 1,
// heavies from sector 2, both growing with depth.
function pickType(level) {
  const r = Math.random();
  const heavyP = level >= 2 ? Math.min(0.05 + level * 0.05, 0.3) : 0;
  const rusherP = Math.min(0.15 + level * 0.05, 0.35);
  if (r < heavyP) return 'heavy';
  if (r < heavyP + rusherP) return 'rusher';
  return 'grunt';
}

export function spawnEnemies(scene, world, count, playerPos, level = 1) {
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
      enemies.push(new Enemy(scene, world, p, pickType(level)));
    }
    i++;
    if (i > count * 20) break; // safety
  }
  return enemies;
}
