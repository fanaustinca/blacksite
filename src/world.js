// Procedural level: rooms + corridors on a grid, built as textured meshes.
// Grid cells: 0 = wall/solid, 1 = open floor.
import * as THREE from 'three';
import { concreteWall, floorConcrete, ceilingPanels, rustedMetal, crateWood, hazardStripes } from './textures.js';

export const CELL = 3;        // world units per grid cell
export const WALL_H = 3.2;    // wall height

export class World {
  constructor(scene, gridW = 34, gridH = 34) {
    this.scene = scene;
    this.w = gridW;
    this.h = gridH;
    this.grid = new Uint8Array(gridW * gridH);
    this.rooms = [];
    this.group = new THREE.Group();
    this.lights = [];
    this.colliders = [];   // AABBs for props {min:Vector3, max:Vector3}
    this.pickups = [];
    this.time = 0;
    this.generate();
    this.build();
    scene.add(this.group);
  }

  cell(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.grid[y * this.w + x];
  }
  setCell(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.grid[y * this.w + x] = v;
  }
  isOpenWorld(wx, wz) {
    return this.cell(Math.floor(wx / CELL), Math.floor(wz / CELL)) === 1;
  }

  generate() {
    const ROOM_TRIES = 26;
    for (let i = 0; i < ROOM_TRIES; i++) {
      const rw = 4 + (Math.random() * 5) | 0;
      const rh = 4 + (Math.random() * 5) | 0;
      const rx = 1 + (Math.random() * (this.w - rw - 2)) | 0;
      const ry = 1 + (Math.random() * (this.h - rh - 2)) | 0;
      const room = { x: rx, y: ry, w: rw, h: rh,
        cx: rx + (rw >> 1), cy: ry + (rh >> 1) };
      let overlaps = false;
      for (const r of this.rooms) {
        if (rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y) { overlaps = true; break; }
      }
      if (overlaps) continue;
      this.rooms.push(room);
      for (let y = ry; y < ry + rh; y++)
        for (let x = rx; x < rx + rw; x++)
          this.setCell(x, y, 1);
    }
    // connect each room to the next with L-corridors (2 cells wide)
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1], b = this.rooms[i];
      this.corridor(a.cx, a.cy, b.cx, a.cy);
      this.corridor(b.cx, a.cy, b.cx, b.cy);
    }
    // a couple of extra loops so the map isn't a single path
    for (let i = 0; i < 3 && this.rooms.length > 3; i++) {
      const a = this.rooms[(Math.random() * this.rooms.length) | 0];
      const b = this.rooms[(Math.random() * this.rooms.length) | 0];
      if (a === b) continue;
      this.corridor(a.cx, a.cy, a.cx, b.cy);
      this.corridor(a.cx, b.cy, b.cx, b.cy);
    }
  }

  corridor(x0, y0, x1, y1) {
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    while (x !== x1 || y !== y1) {
      this.setCell(x, y, 1); this.setCell(x + 1, y, 1); this.setCell(x, y + 1, 1);
      if (x !== x1) x += dx; else y += dy;
    }
    this.setCell(x, y, 1); this.setCell(x + 1, y, 1); this.setCell(x, y + 1, 1);
  }

  build() {
    const wallTex = concreteWall();
    const floorTex = floorConcrete();
    floorTex.repeat.set(this.w, this.h);
    const ceilTex = ceilingPanels();
    ceilTex.repeat.set(this.w, this.h);

    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92, metalness: 0.05 });
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0.02 });
    const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.9, metalness: 0.1 });

    const W = this.w * CELL, H = this.h * CELL;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, H), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(W / 2, WALL_H, H / 2);
    this.group.add(ceil);

    // Instanced wall cells: one box per solid cell that borders an open cell.
    const boxGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    const cells = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.cell(x, y) === 1) continue;
        const nearOpen = this.cell(x + 1, y) || this.cell(x - 1, y) || this.cell(x, y + 1) || this.cell(x, y - 1)
          || this.cell(x + 1, y + 1) || this.cell(x - 1, y - 1) || this.cell(x + 1, y - 1) || this.cell(x - 1, y + 1);
        if (nearOpen) cells.push([x, y]);
      }
    }
    const walls = new THREE.InstancedMesh(boxGeo, wallMat, cells.length);
    const m = new THREE.Matrix4();
    cells.forEach(([x, y], i) => {
      m.makeTranslation(x * CELL + CELL / 2, WALL_H / 2, y * CELL + CELL / 2);
      walls.setMatrixAt(i, m);
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.group.add(walls);

    this.addProps();
    this.addLights();
  }

  addProps() {
    const crateMat = new THREE.MeshStandardMaterial({ map: crateWood(), roughness: 0.85 });
    const barrelMat = new THREE.MeshStandardMaterial({ map: rustedMetal(), roughness: 0.6, metalness: 0.5 });
    const hazardMat = new THREE.MeshStandardMaterial({ map: hazardStripes(), roughness: 0.8 });

    for (const room of this.rooms) {
      const n = 1 + (Math.random() * 3) | 0;
      for (let i = 0; i < n; i++) {
        const gx = room.x + 1 + ((Math.random() * (room.w - 2)) | 0);
        const gy = room.y + 1 + ((Math.random() * (room.h - 2)) | 0);
        // keep room centers clear for spawns
        if (Math.abs(gx - room.cx) < 2 && Math.abs(gy - room.cy) < 2) continue;
        const wx = gx * CELL + CELL / 2, wz = gy * CELL + CELL / 2;
        let mesh, half;
        if (Math.random() < 0.55) {
          const s = 1.0 + Math.random() * 0.4;
          mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
          mesh.position.set(wx, s / 2, wz);
          mesh.rotation.y = Math.random() * Math.PI;
          half = s * 0.72; // generous for rotation
        } else if (Math.random() < 0.5) {
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 12), barrelMat);
          mesh.position.set(wx, 0.575, wz);
          half = 0.5;
        } else {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), hazardMat);
          mesh.position.set(wx, 0.25, wz);
          half = 0.5;
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.colliders.push({
          min: new THREE.Vector3(wx - half, 0, wz - half),
          max: new THREE.Vector3(wx + half, 2, wz + half),
        });
      }
    }
  }

  addLights() {
    // dim ambient so nothing is pure black
    this.scene.add(new THREE.AmbientLight(0x36404c, 1.1));
    const hemi = new THREE.HemisphereLight(0x46525e, 0x241f18, 0.7);
    this.scene.add(hemi);

    // one ceiling fixture per room; a couple flicker
    const fixtureGeo = new THREE.BoxGeometry(1.1, 0.08, 0.4);
    const fixtureMat = new THREE.MeshStandardMaterial({ color: 0x222522, emissive: 0xbfd4c8, emissiveIntensity: 1.6 });
    let shadowBudget = 4; // shadow-casting lights are expensive; only a few
    for (const room of this.rooms) {
      const wx = room.cx * CELL + CELL / 2;
      const wz = room.cy * CELL + CELL / 2;
      const warm = Math.random() < 0.35;
      const color = warm ? 0xffd9a0 : 0xcfe0d8;
      const light = new THREE.PointLight(color, 32, CELL * 9, 1.6);
      light.position.set(wx, WALL_H - 0.35, wz);
      if (shadowBudget > 0 && room.w * room.h > 22) {
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.bias = -0.01;
        shadowBudget--;
      }
      this.group.add(light);
      const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
      fixture.position.set(wx, WALL_H - 0.08, wz);
      this.group.add(fixture);
      this.lights.push({ light, base: light.intensity, flicker: Math.random() < 0.28 });
    }
  }

  update(dt) {
    this.time += dt;
    for (const l of this.lights) {
      if (!l.flicker) continue;
      const t = this.time * 13 + l.light.position.x;
      const f = Math.sin(t) * Math.sin(t * 2.7) * Math.sin(t * 0.83);
      l.light.intensity = f > -0.25 ? l.base : l.base * 0.15;
    }
  }

  // Circle-vs-grid + props collision. Returns corrected position.
  collide(pos, radius) {
    const p = pos.clone();
    // grid walls: push out of solid cells near p
    const gx = Math.floor(p.x / CELL), gz = Math.floor(p.z / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx, cz = gz + dz;
        if (this.cell(cx, cz) === 1) continue;
        // closest point on this solid cell's AABB to p
        const minX = cx * CELL, maxX = minX + CELL;
        const minZ = cz * CELL, maxZ = minZ + CELL;
        const nx = Math.max(minX, Math.min(p.x, maxX));
        const nz = Math.max(minZ, Math.min(p.z, maxZ));
        let ex = p.x - nx, ez = p.z - nz;
        const d2 = ex * ex + ez * ez;
        if (d2 < radius * radius) {
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            p.x = nx + (ex / d) * radius;
            p.z = nz + (ez / d) * radius;
          } else {
            // center inside the box: push along smallest axis overlap
            const pushX = (p.x - (minX + maxX) / 2) >= 0 ? maxX + radius - p.x : minX - radius - p.x;
            const pushZ = (p.z - (minZ + maxZ) / 2) >= 0 ? maxZ + radius - p.z : minZ - radius - p.z;
            if (Math.abs(pushX) < Math.abs(pushZ)) p.x += pushX; else p.z += pushZ;
          }
        }
      }
    }
    // prop AABBs
    for (const c of this.colliders) {
      const nx = Math.max(c.min.x, Math.min(p.x, c.max.x));
      const nz = Math.max(c.min.z, Math.min(p.z, c.max.z));
      const ex = p.x - nx, ez = p.z - nz;
      const d2 = ex * ex + ez * ez;
      if (d2 < radius * radius && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        p.x = nx + (ex / d) * radius;
        p.z = nz + (ez / d) * radius;
      }
    }
    return p;
  }

  // Line-of-sight between two points, walls only (2D grid DDA).
  hasLOS(a, b) {
    let x0 = a.x / CELL, y0 = a.z / CELL;
    const x1 = b.x / CELL, y1 = b.z / CELL;
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 3);
    if (steps === 0) return true;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.cell(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t)) === 0) return false;
    }
    return true;
  }

  // Raycast against walls for bullets: returns distance to first wall hit or Infinity.
  raycastWalls(origin, dir, maxDist) {
    const step = 0.15;
    const p = origin.clone();
    const d = dir.clone().multiplyScalar(step);
    for (let t = 0; t < maxDist; t += step) {
      p.add(d);
      if (p.y < 0 || p.y > WALL_H) return t;
      if (this.cell(Math.floor(p.x / CELL), Math.floor(p.z / CELL)) === 0) return t;
    }
    return Infinity;
  }

  // BFS path over open cells, greedily smoothed with LOS. Returns world-space
  // waypoints (excluding start), or null if unreachable.
  findPath(fromW, toW) {
    const W = this.w, H = this.h;
    const sx = Math.floor(fromW.x / CELL), sy = Math.floor(fromW.z / CELL);
    const tx = Math.floor(toW.x / CELL), ty = Math.floor(toW.z / CELL);
    if (this.cell(sx, sy) === 0 || this.cell(tx, ty) === 0) return null;
    const start = sy * W + sx, target = ty * W + tx;
    if (start === target) return [];
    const prev = new Int32Array(W * H).fill(-1);
    const visited = new Uint8Array(W * H);
    visited[start] = 1;
    const queue = [start];
    let found = false;
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (cur === target) { found = true; break; }
      const cx = cur % W, cy = (cur / W) | 0;
      if (cx + 1 < W) this._bfsVisit(cur, cur + 1, visited, prev, queue);
      if (cx - 1 >= 0) this._bfsVisit(cur, cur - 1, visited, prev, queue);
      if (cy + 1 < H) this._bfsVisit(cur, cur + W, visited, prev, queue);
      if (cy - 1 >= 0) this._bfsVisit(cur, cur - W, visited, prev, queue);
    }
    if (!found) return null;
    const cells = [];
    for (let cur = target; cur !== start; cur = prev[cur]) {
      if (cur === -1) return null;
      cells.push(new THREE.Vector3((cur % W) * CELL + CELL / 2, 0, ((cur / W) | 0) * CELL + CELL / 2));
    }
    cells.reverse();
    // smoothing: from each anchor, jump to the farthest waypoint with clear LOS
    const path = [];
    let anchor = fromW;
    let i = 0;
    while (i < cells.length) {
      let j = i;
      while (j + 1 < cells.length && this.hasLOS(anchor, cells[j + 1])) j++;
      path.push(cells[j]);
      anchor = cells[j];
      i = j + 1;
    }
    return path;
  }

  _bfsVisit(cur, next, visited, prev, queue) {
    if (visited[next] || this.grid[next] === 0) return;
    visited[next] = 1;
    prev[next] = cur;
    queue.push(next);
  }

  roomCenterWorld(i) {
    const r = this.rooms[i % this.rooms.length];
    return new THREE.Vector3(r.cx * CELL + CELL / 2, 0, r.cy * CELL + CELL / 2);
  }
}
