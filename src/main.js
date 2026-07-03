import * as THREE from 'three';
import { World, CELL } from './world.js';
import { Player } from './player.js';
import { Weapon } from './weapons.js';
import { spawnEnemies, Enemy } from './enemies.js';
import { GrenadeManager } from './grenades.js';
import { MODS, resetMods, rollUpgrades } from './mods.js';
import { net } from './net.js';
import { coop } from './coop.js';
import {
  unlockAudio, startAmbient, hurtSound, pickupSound, deathSound,
  killConfirm, headshotDing, upgradeSound,
} from './audio.js';

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
  weaponName: $('weapon-name'), grenades: $('grenade-count'),
  enemies: $('enemy-count'), objective: $('objective'),
  overlay: $('overlay'), overlayTitle: $('overlay-title'),
  overlaySub: $('overlay-sub'), overlayMsg: $('overlay-msg'),
  runStats: $('run-stats'),
  vignette: $('damage-vignette'), hurtFlash: $('hurt-flash'), hitmarker: $('hitmarker'),
  minimap: $('minimap'),
  coopStatus: $('coop-status'), mateName: $('mate-name'), mateHp: $('mate-hp'),
  upgradePanel: $('upgrade-panel'), upgradeCards: $('upgrade-cards'), upgradeSubtitle: $('upgrade-subtitle'),
};
const mapCtx = hud.minimap.getContext('2d');

// ---------- game state ----------
let world = null, player = null, weapon = null, grenades = null, enemies = [];
let level = 1;
let running = false;
let pickups = [];
let shake = 0;
let visited = null;          // minimap fog-of-war
let visitT = 0, sprintNoiseT = 0;
let wasAlive = [];           // co-op death-event edge detection
let stats = null;

function newStats() {
  return { kills: 0, headshots: 0, shots: 0, hits: 0, startedAt: performance.now() };
}

function loadBest() {
  try { return JSON.parse(localStorage.getItem('blacksite_best')) || {}; } catch { return {}; }
}
function saveBest() {
  const best = loadBest();
  best.sector = Math.max(best.sector || 0, level);
  best.kills = Math.max(best.kills || 0, stats.kills);
  localStorage.setItem('blacksite_best', JSON.stringify(best));
}

const isBossLevel = lv => lv % 5 === 0;

// ---------- level construction ----------
function clearScene() {
  if (!world) return;
  scene.remove(world.group);
  for (const e of enemies) e.dispose();
  for (const p of pickups) scene.remove(p.mesh);
  scene.clear();
  scene.add(camera);
  coop.attachScene(scene);
}

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

// asGuest: build the world but let the host drive the enemies (puppets)
function buildLevel(seed = null, guestTypes = null) {
  clearScene();
  const gridSize = Math.min(64, 28 + level * 4);
  world = new World(scene, gridSize, gridSize, seed);
  const spawn = world.roomCenterWorld(0);

  if (!player) player = new Player(camera, world, renderer.domElement);
  player.world = world;
  const wasDead = player.dead;
  player.spawnAt(spawn);
  if (coop.active && !coop.isHost) player.pos.x += 1.2; // don't spawn inside host

  if (!weapon) {
    weapon = new Weapon(camera, scene, world);
  } else {
    weapon.world = world;
    weapon.attachSparks(scene);
    if (wasDead && !coop.active) weapon.resetAmmo();
  }
  weapon.damageHandler = (coop.active && !coop.isHost) ? guestDamageEnemy : null;

  if (!grenades) grenades = new GrenadeManager(scene, world);
  else grenades.attach(scene, world);

  if (guestTypes) {
    enemies = coop.buildPuppets(scene, world, guestTypes);
  } else {
    const count = 5 + level * 2;
    if (isBossLevel(level)) {
      enemies = spawnEnemies(scene, world, 3 + level, spawn, level);
      const bossPos = world.farthestRoomWorld(spawn);
      const boss = new Enemy(scene, world, bossPos, 'boss');
      boss.health = boss.maxHealth = 550 + level * 40;
      enemies.push(boss);
    } else {
      enemies = spawnEnemies(scene, world, count, spawn, level);
    }
  }
  wasAlive = enemies.map(e => e.alive);

  pickups = [];
  for (let i = 1; i < world.rooms.length; i += 2) {
    const c = world.roomCenterWorld(i);
    c.x += 1; c.z += 1;
    if (world.isOpenWorld(c.x, c.z))
      pickups.push(makePickup(world.rnd() < 0.5 ? 'health' : 'ammo', c));
  }

  visited = new Uint8Array(world.w * world.h);

  if (coop.active && coop.isHost) {
    coop.sendLevel(level, world.seed, enemies.map(e => e.type));
  }
}

// ---------- damage routing ----------
function onPlayerHit(dmg) {
  if (player.dead) return;
  player.takeDamage(dmg);
  hurtSound();
  shake = Math.min(0.6, shake + 0.22);
  hud.hurtFlash.style.opacity = '1';
  setTimeout(() => hud.hurtFlash.style.opacity = '0', 90);
  if (player.dead) {
    deathSound();
    if (coop.active) {
      // downed until sector clears; if both down, run ends (host decides)
      if (coop.remote?.dead) hostGameOver();
    } else {
      endRun();
    }
  }
}

function guestDamageEnemy(enemy, dmg, head) {
  const i = coop.puppets.indexOf(enemy);
  if (i === -1) return;
  coop.send({ t: 'dmg', i, d: Math.round(dmg), h: head ? 1 : 0 });
}

function damageEnemyDirect(e, dmg) {
  const wasA = e.alive;
  e.takeDamage(dmg, player);
  stats.hits++;
  if (wasA && !e.alive) onEnemyKilled(e, false);
}

function onEnemyKilled(e, headshot) {
  stats.kills++;
  if (headshot) { stats.headshots++; headshotDing(); }
  killConfirm();
  weapon.spawnImpact(e.pos.clone().setY(1.1), 10);
}

function hostGameOver() {
  if (coop.active && coop.isHost) coop.sendGameOver();
  endRun();
}

function endRun() {
  running = false;
  saveBest();
  const best = loadBest();
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  const mins = ((performance.now() - stats.startedAt) / 60000).toFixed(1);
  hud.runStats.innerHTML =
    `SECTOR REACHED <b>${level}</b> &nbsp;·&nbsp; KILLS <b>${stats.kills}</b> (${stats.headshots} headshots)<br>` +
    `ACCURACY <b>${acc}%</b> &nbsp;·&nbsp; TIME <b>${mins}m</b><br>` +
    `<span style="opacity:0.7">BEST: sector ${best.sector || 1}, ${best.kills || 0} kills</span>`;
  hud.runStats.classList.remove('hidden');
  showOverlay('K.I.A.', 'CLICK / TAP TO START NEW RUN');
}

// ---------- overlay / flow ----------
function showOverlay(title, msg) {
  hud.overlayTitle.textContent = title;
  hud.overlayMsg.textContent = msg;
  hud.overlay.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function resetRun() {
  resetMods();
  level = 1;
  stats = newStats();
  if (grenades) grenades.count = MODS.grenadeCap;
  if (weapon) weapon.resetAmmo();
}

function startGame() {
  // co-op guest can't start levels; they wait for the host's lvl message
  if (coop.active && !coop.isHost) { netMsg('waiting for host…'); return; }
  hud.overlay.classList.add('hidden');
  hud.runStats.classList.add('hidden');
  unlockAudio();
  startAmbient();
  if (!stats) stats = newStats();
  if (!player || player.dead || enemies.filter(e => e.alive).length === 0) {
    if (!player || player.dead) resetRun();
    buildLevel();
    grenades.count = Math.max(grenades.count, 1);
  }
  running = true;
  lockPointer();
}

function lockPointer() {
  if (!player || player.isTouch || document.pointerLockElement) return;
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

hud.overlay.addEventListener('click', e => {
  if (e.target.closest('#account-ui')) return; // account buttons, not "deploy"
  startGame();
});
hud.overlay.addEventListener('touchend', e => {
  if (e.target.closest('#account-ui')) return;
  e.preventDefault();
  startGame();
}, { passive: false });
renderer.domElement.addEventListener('click', () => { if (running && player) lockPointer(); });

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && running && player && !player.isTouch && !player.dead) {
    if (coop.active) return; // don't freeze a live co-op session
    running = false;
    showOverlay('PAUSED', 'CLICK TO RESUME');
  }
});

// ---------- upgrades ----------
function showUpgradePicker() {
  running = false;
  if (document.pointerLockElement) document.exitPointerLock();
  hud.upgradeCards.innerHTML = '';
  hud.upgradeSubtitle.textContent = 'CHOOSE ONE FIELD UPGRADE';
  for (const up of rollUpgrades(3)) {
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `<div class="up-name">${up.name}</div><div class="up-desc">${up.desc}</div>`;
    card.onclick = () => {
      up.apply({ player, weapon, grenades });
      upgradeSound();
      hud.upgradePanel.classList.add('hidden');
      afterUpgrade();
    };
    hud.upgradeCards.appendChild(card);
  }
  hud.upgradePanel.classList.remove('hidden');
}

function afterUpgrade() {
  if (coop.active && !coop.isHost) {
    // wait for host's next level
    hud.upgradeSubtitle.textContent = 'WAITING FOR HOST…';
    hud.upgradePanel.classList.remove('hidden');
    hud.upgradeCards.innerHTML = '';
    return;
  }
  buildLevel();
  running = true;
  lockPointer();
}

function onSectorClear() {
  running = false;
  level++;
  if (coop.active && coop.isHost) coop.sendClear();
  // revive a downed player between sectors
  setTimeout(showUpgradePicker, 900);
}

// ---------- co-op wiring ----------
function setupCoopHandlers() {
  coop.on('p', m => coop.handleRemoteState(m));
  coop.on('e', m => { if (!coop.isHost) coop.applyEnemySnapshot(m, player ? player.pos : null); });
  coop.on('lvl', m => {
    level = m.level;
    hud.upgradePanel.classList.add('hidden');
    hud.overlay.classList.add('hidden');
    if (!stats) stats = newStats();
    buildLevel(m.seed, m.types);
    running = true;
    lockPointer();
  });
  coop.on('dmg', m => {
    const e = enemies[m.i];
    if (!e || !e.alive) return;
    e._lastBy = 'g';
    const wasA = e.alive;
    e.takeDamage(m.d, { pos: coop.remote.pos });
    if (wasA && !e.alive) {
      coop.send({ t: 'die', i: m.i, by: 'g' });
      weapon.spawnImpact(e.pos.clone().setY(1.1), 10);
    }
  });
  coop.on('die', m => {
    const e = coop.puppets[m.i];
    if (e && e.alive) { e.alive = false; e.state = 'dead'; e.deathT = 0; }
    if (m.by === 'g') { stats.kills++; killConfirm(); }
  });
  coop.on('sh', m => coop.puppetShoot(m.i));
  coop.on('pk', m => {
    const p = pickups[m.i];
    if (p && !p.taken) { p.taken = true; p.mesh.visible = false; }
  });
  coop.on('phit', m => onPlayerHit(m.d));
  coop.on('clear', () => { if (!coop.isHost) { level++; setTimeout(showUpgradePicker, 900); } });
  coop.on('over', () => { if (!coop.isHost) endRun(); });
}

// ---------- account / menu UI ----------
const ui = {
  accountUi: $('account-ui'), signedOut: $('signed-out-row'), signedIn: $('signed-in-block'),
  callsign: $('my-callsign'), netMsg: $('net-msg'), hostInfo: $('host-info'),
  inviteList: $('invite-list'), friendsPanel: $('friends-panel'),
  friendList: $('friend-list'), requestList: $('request-list'), friendMsg: $('friend-msg'),
};
let hostCode = null;

function netMsg(s) { ui.netMsg.textContent = s; }

async function initAccountUI() {
  const ok = await net.init();
  if (!ok) return; // no firebase config — solo mode only
  ui.accountUi.style.display = 'flex';

  net.onAuth((user, profile) => {
    ui.signedOut.classList.toggle('hidden', !!user);
    ui.signedIn.classList.toggle('hidden', !user);
    if (user && profile) {
      ui.callsign.textContent = profile.username;
      net.listenFriends(renderFriends);
      net.listenRequests(renderRequests);
      net.listenInvites(renderInvites);
    }
  });

  $('btn-signin').onclick = () => net.signIn().catch(e => netMsg('sign-in failed: ' + e.code));
  $('btn-signout').onclick = () => net.signOut();
  $('btn-reroll').onclick = async () => {
    netMsg('rolling…');
    try {
      const n = await net.rerollUsername();
      ui.callsign.textContent = n;
      netMsg('new callsign assigned');
    } catch (e) { netMsg('reroll failed'); }
  };
  $('btn-delete').onclick = async () => {
    if (!confirm('Delete your account and all data? This cannot be undone.')) return;
    try {
      await net.deleteAccount();
      netMsg('account deleted');
    } catch (e) { netMsg('delete failed: ' + (e.code || e.message)); }
  };
  $('btn-friends').onclick = () => ui.friendsPanel.classList.toggle('hidden');
  $('btn-close-friends').onclick = () => ui.friendsPanel.classList.add('hidden');
  $('btn-add-friend').onclick = async () => {
    const name = $('friend-name').value;
    if (!name) return;
    ui.friendMsg.textContent = 'sending…';
    const r = await net.sendFriendRequest(name).catch(() => 'error');
    ui.friendMsg.textContent = { sent: 'request sent', 'not-found': 'no such callsign', self: "that's you", error: 'failed' }[r];
    if (r === 'sent') $('friend-name').value = '';
  };

  $('btn-host').onclick = async () => {
    netMsg('creating room…');
    try {
      const { code, channel } = await net.hostRoom(0);
      hostCode = code;
      ui.hostInfo.innerHTML = `ROOM CODE: <b>${code}</b><br><span style="font-size:11px;opacity:0.7">share the code or invite a friend — game starts when they join</span>`;
      ui.hostInfo.classList.remove('hidden');
      renderFriends(lastFriends); // adds INVITE buttons
      netMsg('');
      const dc = await channel;
      coop.start(dc, true, scene);
      coop.remoteName = 'GUEST';
      setupCoopHandlers();
      hud.coopStatus.style.display = 'block';
      resetRun();
      hud.overlay.classList.add('hidden');
      unlockAudio(); startAmbient();
      buildLevel();          // also sends lvl to guest
      running = true;
      lockPointer();
    } catch (e) { netMsg('hosting failed: ' + e.message); }
  };
  $('btn-join').onclick = () => joinByCode($('join-code').value);
}

async function joinByCode(code) {
  if (!code || code.length < 5) { netMsg('enter the 5-letter room code'); return; }
  netMsg('joining ' + code.toUpperCase() + '…');
  try {
    const { channel, hostName } = await net.joinRoom(code);
    const dc = await channel;
    coop.start(dc, false, scene);
    coop.remoteName = hostName || 'HOST';
    setupCoopHandlers();
    hud.coopStatus.style.display = 'block';
    hud.mateName.textContent = coop.remoteName;
    resetRun();
    netMsg('connected — waiting for host to start');
    unlockAudio(); startAmbient();
  } catch (e) { netMsg('join failed: ' + e.message); }
}

let lastFriends = [];
function renderFriends(friends) {
  lastFriends = friends;
  ui.friendList.innerHTML = friends.length ? '' : '<div style="opacity:0.5;font-size:12px">none yet</div>';
  for (const f of friends) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${f.username}</span>`;
    if (hostCode) {
      const btn = document.createElement('button');
      btn.className = 'menu-btn small';
      btn.textContent = 'INVITE';
      btn.onclick = () => { net.sendInvite(f.uid, hostCode); btn.textContent = 'SENT'; };
      row.appendChild(btn);
    }
    ui.friendList.appendChild(row);
  }
}

function renderRequests(reqs) {
  ui.requestList.innerHTML = reqs.length ? '' : '<div style="opacity:0.5;font-size:12px">none</div>';
  for (const r of reqs) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${r.username}</span>`;
    const yes = document.createElement('button');
    yes.className = 'menu-btn small';
    yes.textContent = 'ACCEPT';
    yes.onclick = () => net.acceptRequest(r.uid, r.username);
    const no = document.createElement('button');
    no.className = 'menu-btn small danger';
    no.textContent = 'X';
    no.onclick = () => net.declineRequest(r.uid);
    row.append(yes, no);
    ui.requestList.appendChild(row);
  }
}

function renderInvites(invites) {
  ui.inviteList.innerHTML = '';
  for (const inv of invites) {
    const div = document.createElement('div');
    div.className = 'inv';
    div.innerHTML = `<b>${inv.username}</b> invites you to co-op `;
    const btn = document.createElement('button');
    btn.className = 'menu-btn small';
    btn.textContent = 'JOIN';
    btn.onclick = () => { net.clearInvite(inv.uid); joinByCode(inv.code); };
    div.appendChild(btn);
    ui.inviteList.appendChild(div);
  }
}

initAccountUI();

// ---------- minimap ----------
function drawMinimap() {
  if (!world || !player) return;
  const c = mapCtx, S = hud.minimap.width;
  const sc = S / world.w;
  c.clearRect(0, 0, S, S);
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (!visited[y * world.w + x] || world.cell(x, y) === 0) continue;
      c.fillStyle = world.roomMask[y * world.w + x] ? 'rgba(150,180,150,0.28)' : 'rgba(150,180,150,0.16)';
      c.fillRect(x * sc, y * sc, sc + 0.5, sc + 0.5);
    }
  }
  for (const d of world.doors) {
    const gx = d.cx / CELL, gy = d.cz / CELL;
    if (!visited[Math.floor(gy) * world.w + Math.floor(gx)]) continue;
    c.fillStyle = d.open > 0.5 ? 'rgba(210,190,90,0.5)' : 'rgba(210,190,90,0.95)';
    c.fillRect(gx * sc - 2, gy * sc - 2, 4, 4);
  }
  for (const p of pickups) {
    if (p.taken) continue;
    const gx = p.pos.x / CELL, gy = p.pos.z / CELL;
    if (!visited[Math.floor(gy) * world.w + Math.floor(gx)]) continue;
    c.fillStyle = p.kind === 'health' ? '#51d073' : '#d0b451';
    c.fillRect(gx * sc - 1.5, gy * sc - 1.5, 3, 3);
  }
  for (const e of enemies) {
    if (!e.alive) continue;
    const near = e.pos.distanceTo(player.pos) < 16;
    if (!near && e.state !== 'combat') continue;
    const gx = e.pos.x / CELL, gy = e.pos.z / CELL;
    c.fillStyle = e.type === 'boss' ? '#ff8c30' : '#e05050';
    const r = e.type === 'boss' ? 3.4 : 2.2;
    c.beginPath();
    c.arc(gx * sc, gy * sc, r, 0, Math.PI * 2);
    c.fill();
  }
  if (coop.active && coop.remote && !coop.remote.dead) {
    c.fillStyle = '#6fb2e8';
    c.beginPath();
    c.arc(coop.remote.pos.x / CELL * sc, coop.remote.pos.z / CELL * sc, 2.6, 0, Math.PI * 2);
    c.fill();
  }
  // player arrow
  const px = player.pos.x / CELL * sc, py = player.pos.z / CELL * sc;
  c.save();
  c.translate(px, py);
  c.rotate(-player.yaw);
  c.fillStyle = '#d8f0d8';
  c.beginPath();
  c.moveTo(0, -4.4); c.lineTo(3, 3.4); c.lineTo(-3, 3.4);
  c.closePath();
  c.fill();
  c.restore();
}

// ---------- HUD ----------
function updateHUD() {
  hud.health.textContent = Math.ceil(player.health);
  const pct = player.health / player.maxHealth;
  hud.healthFill.style.width = (pct * 100) + '%';
  hud.healthFill.style.background = pct > 0.5 ? '#7fc97f' : pct > 0.25 ? '#d4b451' : '#d05151';
  hud.vignette.style.opacity = pct < 0.4 ? String(0.9 - pct * 1.5) : '0';
  hud.mag.textContent = weapon.reloading > 0 ? '--' : weapon.mag;
  hud.reserve.textContent = weapon.reserve;
  hud.weaponName.textContent = weapon.current.def.name;
  hud.grenades.textContent = grenades.count;
  const left = enemies.filter(e => e.alive).length;
  hud.objective.innerHTML = (isBossLevel(level) && enemies.some(e => e.type === 'boss' && e.alive))
    ? `<span style="color:#ffb060">ELIMINATE THE WARDEN</span> — HOSTILES: <b>${left}</b>`
    : `SECTOR ${level} — HOSTILES REMAINING: <b>${left}</b>`;
  if (coop.active && coop.remote) {
    hud.mateName.textContent = coop.remoteName;
    hud.mateHp.textContent = coop.remote.dead ? 'DOWN' : coop.remote.hp;
    hud.mateHp.style.color = coop.remote.dead ? '#e05050' : '#7fb8e8';
  }
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let hitmarkerT = 0;

function checkSectorClear() {
  if (!running) return;
  if (coop.active && !coop.isHost) return; // host decides
  if (enemies.length && enemies.every(e => !e.alive)) onSectorClear();
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!world) { renderer.clear(); renderer.render(scene, camera); return; }

  if (running) {
    player.update(dt);

    // door triggers + light flicker
    const actors = [player.pos];
    if (coop.active && coop.remote && !coop.remote.dead) actors.push(coop.remote.pos);
    for (const e of enemies) if (e.alive) actors.push(e.pos);
    world.update(dt, actors);

    // fog-of-war visit marking
    visitT -= dt;
    if (visitT <= 0) {
      visitT = 0.18;
      const cgx = Math.floor(player.pos.x / CELL), cgy = Math.floor(player.pos.z / CELL);
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const x = cgx + dx, y = cgy + dy;
          if (x >= 0 && y >= 0 && x < world.w && y < world.h && dx * dx + dy * dy <= 26)
            visited[y * world.w + x] = 1;
        }
    }

    // inputs
    if (player.wantReload) { player.wantReload = false; weapon.startReload(); }
    if (player.wantSwap) { player.wantSwap = false; weapon.swap(); }
    if (player.wantGrenade) {
      player.wantGrenade = false;
      if (!player.dead && grenades.throw(player.eyePos(), player.forwardDir())) {
        for (const e of enemies) {
          if (e.alive && !e.puppet && e.pos.distanceTo(player.pos) < 14) e.hearNoise(player.pos);
        }
      }
    }
    if (player.wantFire && !player.dead) {
      const res = weapon.tryFire(player, enemies);
      if (res) {
        stats.shots++;
        if (res.hitEnemy) stats.hits++;
        for (const e of enemies) {
          if (e.alive && !e.puppet && e.pos.distanceTo(player.pos) < 22) e.hearNoise(player.pos);
        }
        if (res.hitEnemy) {
          hitmarkerT = 0.18;
          hud.hitmarker.classList.toggle('head', !!res.headshot);
          hud.hitmarker.style.opacity = '1';
        }
        if (res.killed) onEnemyKilled(res.hitEnemy, res.headshot);
      }
    }

    // sprinting is loud
    if (player.sprinting) {
      sprintNoiseT -= dt;
      if (sprintNoiseT <= 0) {
        sprintNoiseT = 0.5;
        for (const e of enemies) {
          if (e.alive && !e.puppet && e.pos.distanceTo(player.pos) < 8) e.hearNoise(player.pos);
        }
      }
    }

    // enemies: host/solo simulates; guest lerps puppets
    if (coop.active && !coop.isHost) {
      coop.updatePuppets(dt);
    } else {
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        // pick the closer living target in co-op
        let target = player, hitCb = onPlayerHit;
        if (coop.active && coop.remote && !coop.remote.dead) {
          if (player.dead || coop.remote.pos.distanceTo(e.pos) < player.pos.distanceTo(e.pos)) {
            target = coop.remote;
            coop.remote.listenPos = player.pos;
            hitCb = d => coop.sendPlayerHit(d);
          }
        }
        e.update(dt, target, hitCb, enemies);
        if (coop.active && e.justShot) { e.justShot = false; coop.sendEnemyShoot(i); }
        if (wasAlive[i] && !e.alive) {
          wasAlive[i] = false;
          if (coop.active) coop.send({ t: 'die', i, by: e._lastBy || 'h' });
        }
      }
    }

    // grenades
    grenades.update(dt, enemies, player.pos,
      (e, dmg) => {
        if (coop.active && !coop.isHost) guestDamageEnemy(e, dmg, false);
        else damageEnemyDirect(e, dmg);
      },
      dmg => onPlayerHit(dmg),
      pos => {
        shake = Math.min(0.9, shake + Math.max(0.15, 0.8 - pos.distanceTo(player.pos) * 0.06));
        for (const e of enemies) {
          if (e.alive && !e.puppet && e.pos.distanceTo(pos) < 25) e.hearNoise(pos);
        }
      });

    // pickups
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      if (p.taken) continue;
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.55 + Math.sin(clock.elapsedTime * 3 + p.pos.x) * 0.08;
      if (!player.dead && player.pos.distanceTo(p.pos) < 0.9) {
        p.taken = true;
        p.mesh.visible = false;
        pickupSound();
        if (p.kind === 'health') {
          player.health = Math.min(player.maxHealth, player.health + Math.round(35 * MODS.pickup));
        } else {
          weapon.addAmmo();
          grenades.count = Math.min(MODS.grenadeCap, grenades.count + 1);
        }
        if (coop.active) coop.sendPickup(i);
      }
    }

    coop.update(dt, player, enemies);
    // whole squad down -> run over (host authoritative)
    if (coop.active && coop.isHost && player.dead && coop.remote?.dead) hostGameOver();
    weapon.update(dt, player);
    updateHUD();
    checkSectorClear();

    if (hitmarkerT > 0) {
      hitmarkerT -= dt;
      if (hitmarkerT <= 0) { hud.hitmarker.style.opacity = '0'; hud.hitmarker.classList.remove('head'); }
    }

    // screen shake (applied over the player's camera pose)
    if (shake > 0.002) {
      camera.rotation.x += (Math.random() - 0.5) * shake * 0.06;
      camera.rotation.z += (Math.random() - 0.5) * shake * 0.05;
      shake *= Math.max(0, 1 - 5 * dt);
    }

    drawMinimap();
  } else if (player) {
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

// PWA service worker (best-effort; game works fine without it)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// debug/testing: ?autostart skips the menu; &nearenemy teleports next to a
// hostile; &shotgun starts with the shotgun out; &boss forces a boss sector
if (location.search.includes('autostart')) {
  startGame();
  if (location.search.includes('boss')) { level = 5; buildLevel(); }
  if (location.search.includes('shotgun')) weapon.swap();
  if (location.search.includes('nearenemy') && enemies.length) {
    const e = enemies[0];
    player.pos.set(e.pos.x + 3, 0, e.pos.z + 0.5);
    player.pos.copy(world.collide(player.pos, 0.38));
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
    player.yaw = Math.atan2(-dx, -dz);
  }
}
