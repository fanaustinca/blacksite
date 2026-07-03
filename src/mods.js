// Run-scoped roguelite modifiers. Reset on death; upgraded between sectors.
export const MODS = {
  maxHp: 0,        // added to base 100
  speed: 1,        // movement multiplier
  reload: 1,       // reload time multiplier (lower = faster)
  damage: 1,       // weapon damage multiplier
  spread: 1,       // weapon spread multiplier (lower = tighter)
  pickup: 1,       // pickup effectiveness multiplier
  grenadeCap: 3,
};

export function resetMods() {
  MODS.maxHp = 0;
  MODS.speed = 1;
  MODS.reload = 1;
  MODS.damage = 1;
  MODS.spread = 1;
  MODS.pickup = 1;
  MODS.grenadeCap = 3;
}

// ctx: {player, weapon, grenades}
export const UPGRADES = [
  {
    id: 'plating', name: 'REINFORCED PLATING', desc: '+25 max integrity, restore 25 now',
    apply(ctx) {
      MODS.maxHp += 25;
      ctx.player.maxHealth = 100 + MODS.maxHp;
      ctx.player.health = Math.min(ctx.player.maxHealth, ctx.player.health + 25);
    },
  },
  {
    id: 'stims', name: 'STIM CIRCUITS', desc: '+15% movement speed',
    apply() { MODS.speed *= 1.15; },
  },
  {
    id: 'hands', name: 'QUICK HANDS', desc: '30% faster reloads',
    apply() { MODS.reload *= 0.7; },
  },
  {
    id: 'deadeye', name: 'DEADEYE ROUNDS', desc: '+15% weapon damage',
    apply() { MODS.damage *= 1.15; },
  },
  {
    id: 'stabilizer', name: 'MUZZLE STABILIZER', desc: '35% tighter spread',
    apply() { MODS.spread *= 0.65; },
  },
  {
    id: 'bandolier', name: 'BANDOLIER', desc: '+2 grenade capacity, +2 grenades now',
    apply(ctx) {
      MODS.grenadeCap += 2;
      ctx.grenades.count = Math.min(MODS.grenadeCap, ctx.grenades.count + 2);
    },
  },
  {
    id: 'scavenger', name: 'SCAVENGER', desc: 'Pickups give 50% more',
    apply() { MODS.pickup *= 1.5; },
  },
];

export function rollUpgrades(n = 3) {
  const pool = [...UPGRADES];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  }
  return out;
}
