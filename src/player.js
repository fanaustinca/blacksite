// Player controller: pointer-lock mouse look + WASD on desktop, twin-zone touch on mobile.
import * as THREE from 'three';

const EYE_HEIGHT = 1.62;
const RADIUS = 0.38;
const WALK = 4.2, SPRINT = 6.6;

export class Player {
  constructor(camera, world, dom) {
    this.camera = camera;
    this.world = world;
    this.dom = dom;
    this.pos = new THREE.Vector3(5, 0, 5);
    this.yaw = 0;
    this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.health = 100;
    this.maxHealth = 100;
    this.dead = false;
    this.keys = {};
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.recoil = 0;
    this.wantFire = false;
    this.wantReload = false;
    this.isTouch = ('ontouchstart' in window) && matchMedia('(pointer: coarse)').matches;
    this.moveInput = new THREE.Vector2(); // from touch stick
    this.speedNow = 0;

    if (this.isTouch) document.body.classList.add('touch');
    this.bindKeyboard();
    this.bindMouse();
    if (this.isTouch) this.bindTouch();
  }

  spawnAt(v) {
    this.pos.copy(v);
    this.health = this.maxHealth;
    this.dead = false;
  }

  bindKeyboard() {
    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyR') this.wantReload = true;
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  }

  bindMouse() {
    this.dom.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    this.dom.addEventListener('mousedown', e => {
      if (document.pointerLockElement === this.dom && e.button === 0) this.wantFire = true;
    });
    this.dom.addEventListener('mouseup', e => { if (e.button === 0) this.wantFire = false; });
  }

  bindTouch() {
    const stickZone = document.getElementById('stick-zone');
    const lookZone = document.getElementById('look-zone');
    const base = document.getElementById('stick-base');
    const nub = document.getElementById('stick-nub');
    const fireBtn = document.getElementById('btn-fire');
    const reloadBtn = document.getElementById('btn-reload');
    let stickId = null, stickOrigin = null;
    let lookId = null, lookLast = null;

    stickZone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      stickId = t.identifier;
      stickOrigin = { x: t.clientX, y: t.clientY };
      base.style.display = 'block';
      base.style.left = t.clientX + 'px';
      base.style.top = t.clientY + 'px';
    }, { passive: false });
    stickZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        let dx = t.clientX - stickOrigin.x, dy = t.clientY - stickOrigin.y;
        const len = Math.hypot(dx, dy), max = 48;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.moveInput.set(dx / max, -dy / max);
      }
    }, { passive: false });
    const endStick = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        stickId = null;
        this.moveInput.set(0, 0);
        base.style.display = 'none';
        nub.style.transform = 'translate(-50%,-50%)';
      }
    };
    stickZone.addEventListener('touchend', endStick);
    stickZone.addEventListener('touchcancel', endStick);

    lookZone.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lookLast = { x: t.clientX, y: t.clientY };
    }, { passive: false });
    lookZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        this.yaw -= (t.clientX - lookLast.x) * 0.005;
        this.pitch -= (t.clientY - lookLast.y) * 0.005;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });
    const endLook = e => {
      for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
    };
    lookZone.addEventListener('touchend', endLook);
    lookZone.addEventListener('touchcancel', endLook);

    fireBtn.addEventListener('touchstart', e => { e.preventDefault(); this.wantFire = true; }, { passive: false });
    fireBtn.addEventListener('touchend', e => { e.preventDefault(); this.wantFire = false; }, { passive: false });
    reloadBtn.addEventListener('touchstart', e => { e.preventDefault(); this.wantReload = true; }, { passive: false });
  }

  takeDamage(amount) {
    if (this.dead) return;
    this.health -= amount;
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  update(dt) {
    // input direction
    let ix = 0, iz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) iz += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) iz -= 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) ix -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) ix += 1;
    ix += this.moveInput.x; iz += this.moveInput.y;
    const inLen = Math.hypot(ix, iz);
    if (inLen > 1) { ix /= inLen; iz /= inLen; }

    const sprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed = sprint ? SPRINT : WALK;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // camera forward on ground plane
    const fx = -sin, fz = -cos;
    const rx = cos, rz = -sin;
    const wishX = (fx * iz + rx * ix) * speed;
    const wishZ = (fz * iz + rz * ix) * speed;

    // smooth accel
    const accel = 14;
    this.vel.x += (wishX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wishZ - this.vel.z) * Math.min(1, accel * dt);
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);

    if (!this.dead) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      const corrected = this.world.collide(this.pos, RADIUS);
      this.pos.copy(corrected);
    }

    // head bob scaled by speed
    const targetAmp = Math.min(1, this.speedNow / WALK) * 0.045;
    this.bobAmp += (targetAmp - this.bobAmp) * Math.min(1, 8 * dt);
    this.bobPhase += this.speedNow * dt * 1.9;
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * this.bobAmp * 0.5;

    // recoil decays
    this.recoil = Math.max(0, this.recoil - dt * 4.5);

    this.camera.position.set(
      this.pos.x + rx * bobX,
      EYE_HEIGHT + bobY + (this.dead ? -0.9 : 0),
      this.pos.z + rz * bobX
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoil * 0.04 + (this.dead ? 0.4 : 0);
    this.camera.rotation.z = this.dead ? 0.5 : 0;
  }

  forwardDir() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return d;
  }

  eyePos() {
    return this.camera.position.clone();
  }
}
