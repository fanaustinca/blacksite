// 2-player co-op session over a WebRTC DataChannel.
// Host-authoritative: host simulates enemies/pickups; guest simulates its own
// movement + shooting and reports damage. Both build identical seeded worlds.
import * as THREE from 'three';
import { Enemy } from './enemies.js';
import { enemyShot } from './audio.js';

const SNAP_HZ = 12;

// remote teammate avatar (blue-tinted soldier)
function buildAvatar() {
  const g = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: 0x2e4a66, roughness: 0.9 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x1a2836, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6f58, roughness: 0.85 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), uniform);
  torso.position.y = 1.12;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.34), gear);
  vest.position.y = 1.18;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin);
  head.position.y = 1.61;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.32), gear);
  helmet.position.y = 1.72;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.8, 0.17), uniform);
  legL.position.set(-0.14, 0.42, 0);
  const legR = legL.clone(); legR.position.x = 0.14;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.6, roughness: 0.5 }));
  gun.position.set(0.2, 1.3, -0.35);
  g.add(torso, vest, head, helmet, legL, legR, gun);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Coop {
  constructor() {
    this.active = false;
    this.isHost = false;
    this.dc = null;
    this.remote = null;       // avatar state: pos, dead, speedNow, grounded, hp
    this.remoteMesh = null;
    this.remoteName = '';
    this.puppets = [];        // guest-side enemy stand-ins
    this.sendAcc = 0;
    this.handlers = {};       // msg-type -> fn(data)
    this.peerLeft = false;
  }

  start(dc, isHost, scene) {
    this.active = true;
    this.isHost = isHost;
    this.dc = dc;
    this.peerLeft = false;
    this.remote = {
      pos: new THREE.Vector3(), yaw: 0, dead: false, hp: 100,
      speedNow: 0, grounded: true, jumpY: 0,
      listenPos: null, // set by main to local player pos (footstep audio anchor)
    };
    this.remoteMesh = buildAvatar();
    this.remoteMesh.visible = false;
    scene.add(this.remoteMesh);
    dc.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      const h = this.handlers[m.t];
      if (h) h(m);
    };
    dc.onclose = () => { this.peerLeft = true; };
  }

  attachScene(scene) {
    if (this.remoteMesh) scene.add(this.remoteMesh);
  }

  on(type, fn) { this.handlers[type] = fn; }

  send(obj) {
    if (this.dc && this.dc.readyState === 'open') {
      try { this.dc.send(JSON.stringify(obj)); } catch { /* mid-close */ }
    }
  }

  stop() {
    this.active = false;
    if (this.dc) { try { this.dc.close(); } catch { } }
    this.dc = null;
    if (this.remoteMesh?.parent) this.remoteMesh.parent.remove(this.remoteMesh);
    this.remoteMesh = null;
    this.puppets = [];
  }

  // ---- per-frame ----

  update(dt, player, enemies) {
    if (!this.active) return;
    // stream local player state
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / SNAP_HZ) {
      this.sendAcc = 0;
      this.send({
        t: 'p',
        x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2),
        y: +player.jumpY.toFixed(2), yw: +player.yaw.toFixed(2),
        hp: Math.round(player.health), dd: player.dead ? 1 : 0,
        sp: player.speedNow > 0.8 ? 1 : 0,
      });
      if (this.isHost) this.sendEnemySnapshot(enemies);
    }
    // move remote avatar smoothly toward its snapshot
    if (this.remoteMesh && this.remote) {
      const m = this.remoteMesh;
      m.visible = !this.remote.dead && this.remote.seen !== false;
      const k = Math.min(1, 12 * dt);
      m.position.lerp(new THREE.Vector3(this.remote.pos.x, this.remote.jumpY, this.remote.pos.z), k);
      m.rotation.y += (this.remote.yaw - m.rotation.y) * k;
    }
  }

  handleRemoteState(m) {
    this.remote.pos.set(m.x, 0, m.z);
    this.remote.jumpY = m.y;
    this.remote.yaw = m.yw;
    this.remote.hp = m.hp;
    this.remote.dead = !!m.dd;
    this.remote.speedNow = m.sp ? 4 : 0;
    this.remote.seen = true;
  }

  // ---- host side ----

  sendEnemySnapshot(enemies) {
    this.send({
      t: 'e',
      l: enemies.map(e => [
        +e.pos.x.toFixed(2), +e.pos.z.toFixed(2), +e.yaw.toFixed(2),
        Math.round(e.health), e.alive ? 1 : 0,
      ]),
    });
  }

  sendLevel(level, seed, types) { this.send({ t: 'lvl', level, seed, types }); }
  sendPickup(i) { this.send({ t: 'pk', i }); }
  sendEnemyShoot(i) { this.send({ t: 'sh', i }); }
  sendPlayerHit(dmg) { this.send({ t: 'phit', d: Math.round(dmg) }); }
  sendClear() { this.send({ t: 'clear' }); }
  sendGameOver() { this.send({ t: 'over' }); }

  // ---- guest side ----

  buildPuppets(scene, world, types) {
    for (const p of this.puppets) p.dispose();
    this.puppets = types.map(ty => {
      // park puppets off-map until the first snapshot places them
      const e = new Enemy(scene, world, new THREE.Vector3(-50, 0, -50), ty);
      e.puppet = true;
      return e;
    });
    return this.puppets;
  }

  applyEnemySnapshot(m, localPlayerPos) {
    for (let i = 0; i < m.l.length && i < this.puppets.length; i++) {
      const [x, z, yaw, hp, alive] = m.l[i];
      const e = this.puppets[i];
      e.netTarget = { x, z, yaw };
      e.health = hp;
      if (!alive && e.alive) { e.alive = false; e.state = 'dead'; e.deathT = 0; }
      if (hp < e.maxHealth && alive) e.hpBarT = Math.max(e.hpBarT, 1.5);
      e._stepListener = localPlayerPos;
    }
  }

  updatePuppets(dt) {
    for (const e of this.puppets) {
      if (!e.alive) {
        // reuse the real death animation
        e.deathT += dt;
        const t = Math.min(1, e.deathT * 2.2);
        e.mesh.rotation.x = -t * Math.PI / 2 * 0.96;
        e.mesh.position.y = -t * 0.12;
        e.barBg.visible = e.barFg.visible = false;
        continue;
      }
      if (e.netTarget) {
        const prev = e.pos.clone();
        e.pos.x += (e.netTarget.x - e.pos.x) * Math.min(1, 10 * dt);
        e.pos.z += (e.netTarget.z - e.pos.z) * Math.min(1, 10 * dt);
        let dy = e.netTarget.yaw - e.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        e.yaw += dy * Math.min(1, 10 * dt);
        const moved = e.pos.distanceTo(prev) / Math.max(dt, 1e-4);
        if (moved > 0.5) e.walkPhase += dt * 7 * (moved / 2.6);
      }
      const swing = Math.sin(e.walkPhase) * 0.55;
      e.parts.legL.rotation.x = swing;
      e.parts.legR.rotation.x = -swing;
      e.muzzle.intensity = Math.max(0, e.muzzle.intensity - dt * 60);
      // health bar
      if (e.hpBarT > 0) {
        e.hpBarT -= dt;
        const frac = Math.max(0, e.health / e.maxHealth);
        e.barBg.visible = e.barFg.visible = true;
        e.barBg.position.set(e.pos.x, e.height + 0.25, e.pos.z);
        e.barFg.position.set(e.pos.x, e.height + 0.25, e.pos.z);
        e.barFg.scale.set(e.barW * frac, 0.045, 1);
      } else {
        e.barBg.visible = e.barFg.visible = false;
      }
      e.mesh.position.set(e.pos.x, 0, e.pos.z);
      e.mesh.rotation.y = e.yaw;
    }
  }

  puppetShoot(i) {
    const e = this.puppets[i];
    if (!e) return;
    e.muzzle.intensity = 9;
    enemyShot();
  }
}

export const coop = new Coop();
