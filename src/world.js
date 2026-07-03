// Procedural level: rooms + corridors on a grid, built as textured meshes.
// Grid cells: 0 = wall/solid, 1 = open floor. Sliding doors sit on open cells
// where corridors meet rooms and block movement/sight until they open.
// Generation is seeded so co-op peers build identical worlds.
import * as THREE from 'three';
import { concreteWall, floorConcrete, ceilingPanels, rustedMetal, crateWood, hazardStripes } from './textures.js';

export const CELL = 3;        // world units per grid cell
export const WALL_H = 3.2;    // wall height

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(scene, gridW = 34, gridH = 34, seed = null) {
    this.scene = scene;
    this.w = gridW;
    this.h = gridH;
    this.seed = seed ?? ((Math.random() * 2 ** 31) | 0);
    this.rnd = mulberry32(this.seed);
    this.grid = new Uint8Array(gridW * gridH);
    this.roomMask = new Uint8Array(gridW * gridH);
    this.rooms = [];
    this.group = new THREE.Group();
    this.lights = [];
    this.colliders = [];   // AABBs for props
    this.doors = [];
    this.doorAt = new Map(); // "x,y" -> door
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
  // solid wall OR a mostly-closed door
  isBlocked(x, y) {
    if (this.cell(x, y) === 0) return true;
    const d = this.doorAt.get(x + ',' + y);
    return d ? d.open < 0.6 : false;
  }
  isOpenWorld(wx, wz) {
    return this.cell(Math.floor(wx / CELL), Math.floor(wz / CELL)) === 1;
  }

  generate() {
    const ROOM_TRIES = 26;
    for (let i = 0; i < ROOM_TRIES; i++) {
      const rw = 4 + (this.rnd() * 5) | 0;
      const rh = 4 + (this.rnd() * 5) | 0;
      const rx = 1 + (this.rnd() * (this.w - rw - 2)) | 0;
      const ry = 1 + (this.rnd() * (this.h - rh - 2)) | 0;
      const room = { x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) };
      let overlaps = false;
      for (const r of this.rooms) {
        if (rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y) { overlaps = true; break; }
      }
      if (overlaps) continue;
      this.rooms.push(room);
      for (let y = ry; y < ry + rh; y++)
        for (let x = rx; x < rx + rw; x++) {
          this.setCell(x, y, 1);
          this.roomMask[y * this.w + x] = 1;
        }
    }
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1], b = this.rooms[i];
      this.corridor(a.cx, a.cy, b.cx, a.cy);
      this.corridor(b.cx, a.cy, b.cx, b.cy);
    }
    for (let i = 0; i < 3 && this.rooms.length > 3; i++) {
      const a = this.rooms[(this.rnd() * this.rooms.length) | 0];
      const b = this.rooms[(this.rnd() * this.rooms.length) | 0];
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

    this.placeDoors();
    this.addProps();
    this.addLights();
  }

  placeDoors() {
    // corridor cells that touch a room cell = doorway candidates
    const isRoom = (x, y) => (x >= 0 && y >= 0 && x < this.w && y < this.h) && this.roomMask[y * this.w + x] === 1;
    const isCorr = (x, y) => this.cell(x, y) === 1 && !isRoom(x, y);
    const candidates = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (!isCorr(x, y)) continue;
        if (isRoom(x + 1, y) || isRoom(x - 1, y) || isRoom(x, y + 1) || isRoom(x, y - 1)) candidates.push([x, y]);
      }

    const doorMat = new THREE.MeshStandardMaterial({ map: rustedMetal(), roughness: 0.5, metalness: 0.6 });
    const stripeMat = new THREE.MeshStandardMaterial({ map: hazardStripes(), roughness: 0.7 });
    const taken = new Set();
    let placed = 0;
    for (const [x, y] of candidates) {
      if (placed >= 14) break;
      if (taken.has(x + ',' + y)) continue;
      // don't crowd doors together
      let crowded = false;
      for (const d of this.doors) {
        if (Math.abs(d.gx - x) + Math.abs(d.gy - y) < 4) { crowded = true; break; }
      }
      if (crowded) continue;

      // pair with an adjacent corridor-candidate cell (corridors are 2 wide)
      let pair = null;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (isCorr(nx, ny) && !taken.has(nx + ',' + ny)
          && candidates.some(([cx, cy]) => cx === nx && cy === ny)) { pair = [nx, ny]; break; }
      }
      const cellsHere = pair ? [[x, y], pair] : [[x, y]];
      const along = pair ? (pair[0] !== x ? 'x' : 'z') : (isRoom(x + 1, y) || isRoom(x - 1, y) ? 'z' : 'x');

      // door slab spanning the cells
      const minX = Math.min(...cellsHere.map(c => c[0])), maxX = Math.max(...cellsHere.map(c => c[0]));
      const minY = Math.min(...cellsHere.map(c => c[1])), maxY = Math.max(...cellsHere.map(c => c[1]));
      const cx = (minX + maxX + 1) / 2 * CELL, cz = (minY + maxY + 1) / 2 * CELL;
      const spanX = along === 'x' ? (maxX - minX + 1) * CELL : 0.32;
      const spanZ = along === 'z' ? (maxY - minY + 1) * CELL : 0.32;

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(spanX, WALL_H, spanZ), doorMat);
      mesh.position.set(cx, WALL_H / 2, cz);
      mesh.castShadow = true;
      // hazard stripe base strip
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(along === 'x' ? spanX : 0.36, 0.5, along === 'z' ? spanZ : 0.36), stripeMat);
      strip.position.set(cx, 0.25, cz);
      mesh.userData.strip = strip;
      this.group.add(mesh, strip);

      const door = { gx: x, gy: y, cells: cellsHere, mesh, strip, open: 0, cx, cz };
      this.doors.push(door);
      for (const c of cellsHere) {
        taken.add(c[0] + ',' + c[1]);
        this.doorAt.set(c[0] + ',' + c[1], door);
      }
      placed++;
    }
  }

  addProps() {
    const crateMat = new THREE.MeshStandardMaterial({ map: crateWood(), roughness: 0.85 });
    const barrelMat = new THREE.MeshStandardMaterial({ map: rustedMetal(), roughness: 0.6, metalness: 0.5 });
    const hazardMat = new THREE.MeshStandardMaterial({ map: hazardStripes(), roughness: 0.8 });

    for (const room of this.rooms) {
      const n = 1 + (this.rnd() * 3) | 0;
      for (let i = 0; i < n; i++) {
        const gx = room.x + 1 + ((this.rnd() * (room.w - 2)) | 0);
        const gy = room.y + 1 + ((this.rnd() * (room.h - 2)) | 0);
        if (Math.abs(gx - room.cx) < 2 && Math.abs(gy - room.cy) < 2) continue;
        const wx = gx * CELL + CELL / 2, wz = gy * CELL + CELL / 2;
        let mesh, half;
        if (this.rnd() < 0.55) {
          const s = 1.0 + this.rnd() * 0.4;
          mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
          mesh.position.set(wx, s / 2, wz);
          mesh.rotation.y = this.rnd() * Math.PI;
          half = s * 0.72;
        } else if (this.rnd() < 0.5) {
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
    this.scene.add(new THREE.AmbientLight(0x36404c, 1.1));
    const hemi = new THREE.HemisphereLight(0x46525e, 0x241f18, 0.7);
    this.scene.add(hemi);

    const fixtureGeo = new THREE.BoxGeometry(1.1, 0.08, 0.4);
    const fixtureMat = new THREE.MeshStandardMaterial({ color: 0x222522, emissive: 0xbfd4c8, emissiveIntensity: 1.6 });
    let shadowBudget = 4;
    for (const room of this.rooms) {
      const wx = room.cx * CELL + CELL / 2;
      const wz = room.cy * CELL + CELL / 2;
      const warm = this.rnd() < 0.35;
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
      this.lights.push({ light, base: light.intensity, flicker: this.rnd() < 0.28 });
    }
  }

  // actors: array of Vector3 positions that can trigger doors
  update(dt, actors = []) {
    this.time += dt;
    for (const l of this.lights) {
      if (!l.flicker) continue;
      const t = this.time * 13 + l.light.position.x;
      const f = Math.sin(t) * Math.sin(t * 2.7) * Math.sin(t * 0.83);
      l.light.intensity = f > -0.25 ? l.base : l.base * 0.15;
    }
    for (const d of this.doors) {
      let want = 0;
      for (const p of actors) {
        const dx = p.x - d.cx, dz = p.z - d.cz;
        if (dx * dx + dz * dz < 2.6 * 2.6) { want = 1; break; }
      }
      d.open += (want - d.open) * Math.min(1, 6 * dt);
      d.mesh.position.y = WALL_H / 2 + d.open * WALL_H * 0.94;
      d.strip.position.y = 0.25 + d.open * WALL_H * 0.94;
    }
  }

  // Circle-vs-grid + props collision. Returns corrected position.
  collide(pos, radius) {
    const p = pos.clone();
    const gx = Math.floor(p.x / CELL), gz = Math.floor(p.z / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx, cz = gz + dz;
        if (!this.isBlocked(cx, cz)) continue;
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
            const pushX = (p.x - (minX + maxX) / 2) >= 0 ? maxX + radius - p.x : minX - radius - p.x;
            const pushZ = (p.z - (minZ + maxZ) / 2) >= 0 ? maxZ + radius - p.z : minZ - radius - p.z;
            if (Math.abs(pushX) < Math.abs(pushZ)) p.x += pushX; else p.z += pushZ;
          }
        }
      }
    }
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

  // Line-of-sight between two points; walls and closed doors block it.
  hasLOS(a, b) {
    let x0 = a.x / CELL, y0 = a.z / CELL;
    const x1 = b.x / CELL, y1 = b.z / CELL;
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 3);
    if (steps === 0) return true;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlocked(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
    }
    return true;
  }

  // Raycast for bullets: walls and closed doors stop shots.
  raycastWalls(origin, dir, maxDist) {
    const step = 0.15;
    const p = origin.clone();
    const d = dir.clone().multiplyScalar(step);
    for (let t = 0; t < maxDist; t += step) {
      p.add(d);
      if (p.y < 0 || p.y > WALL_H) return t;
      if (this.isBlocked(Math.floor(p.x / CELL), Math.floor(p.z / CELL))) return t;
    }
    return Infinity;
  }

  // BFS path over open cells (doors count as open — walkers trigger them),
  // greedily smoothed with wall-only LOS.
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
    // smoothing uses walls-only visibility so paths still route through doors
    const wallLOS = (a, b) => {
      let x0 = a.x / CELL, y0 = a.z / CELL;
      const dx = b.x / CELL - x0, dy = b.z / CELL - y0;
      const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 3);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (this.cell(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t)) === 0) return false;
      }
      return true;
    };
    const path = [];
    let anchor = fromW;
    let i = 0;
    while (i < cells.length) {
      let j = i;
      while (j + 1 < cells.length && wallLOS(anchor, cells[j + 1])) j++;
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

  // farthest room center from a point (boss placement)
  farthestRoomWorld(from) {
    let best = null, bestD = -1;
    for (let i = 0; i < this.rooms.length; i++) {
      const c = this.roomCenterWorld(i);
      const d = c.distanceTo(from);
      if (d > bestD) { bestD = d; best = c; }
    }
    return best;
  }
}
