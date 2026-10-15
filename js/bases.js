// Bases & buildings: each side has 6 circular bases; each base has 6 radial building slots.
(function (G) {
  const SCALE = 3;                 // size multiplier for bases and buildings
  const BASE_R = 170 * SCALE;      // base radius
  const SLOT_RING = 108 * SCALE;   // distance from base center to each slot
  const SLOT_R = 32 * SCALE;       // clickable/visual radius of a slot
  const SLOT_COUNT = 6;
  const BUILDING_HP = 1500;
  const DIGIN_WEAPON = { range: 600, minRange: 0, cooldown: 0.4, damage: 35, targets: 'all', pick: 'nearest', shot: 'arrow', muzzle: 40, speed: 900 };

  // Building catalog. Add new building types here.
  G.BUILDINGS = {
    // `cost`: gold to build, set by value: hut (no effect yet) < dig-in < barracks < support/allies < storm/siege.
    // Destroyed buildings drop G.BUILDING_SALVAGE of it as coins (see economy.js). The Command Center is free.
    // No gameplay effects yet: these only differ in name and model.
    hut: { name: 'Hut', cost: 50, r: 26 * SCALE },
    // Towers: `weapon` makes the building shoot (see towers.js).
    //   range/minRange: center-to-target distance. targets: 'units' or 'all' (units + buildings).
    //   pick: 'nearest' or 'healthiest'. roll: boulder keeps rolling after landing, hurting everything within radius; each hit multiplies its damage by
    //   falloff and it stops once damage drops below minDamage, so it can't flatten a whole squad.
    digin: { name: 'Dig-in', cost: 100, r: 26 * SCALE, weapon: DIGIN_WEAPON },
    // Command Center: one per side, at the center of its back-middle base; can't be built or torn down.
    // `hp` overrides BUILDING_HP. Destroying the enemy's wins the game (see G.destroyBuilding).
    command: { name: 'Command Center', cost: 0, r: 48 * SCALE, hp: 5000, command: true,
      weapon: Object.assign({}, DIGIN_WEAPON, { range: 1000, cooldown: 1.5, damage: 200, muzzle: 230 }) },
    support: { name: 'Support Tower', cost: 175, r: 22 * SCALE,
      weapon: { range: 1650, minRange: 0, cooldown: 1.2, damage: 90, targets: 'units', pick: 'nearest', shot: 'bolt', muzzle: 230, speed: 1300 } },
    siege: { name: 'Siege', cost: 250, r: 26 * SCALE,
      weapon: { range: 2050, minRange: 600, cooldown: 6.0, damage: 250, bldgMul: 2, targets: 'all', pick: 'buildings', roll: { distance: 380, speed: 420, falloff: 0.75, minDamage: 10, radius: 45 }, shot: 'boulder', muzzle: 70, speed: 700 } },
    // Storm Tower: no weapon. Its field covers the whole base: ranged attacks from outside can't hit
    // anything of its side inside the base (see G.canShoot). Movement and shots out are unaffected.
    storm: { name: 'Storm Tower', cost: 225, r: 22 * SCALE, field: true },
    // Barracks: `squad` names the unit kind it spawns (see SQUAD_KINDS in squads.js).
    barracks: { name: 'Infantry Barracks', cost: 125, r: 26 * SCALE, squad: 'infantry' },
    barracksArmored: { name: 'Armored Barracks', cost: 175, r: 26 * SCALE, squad: 'armored' },
    barracksShort: { name: 'Skirmisher Barracks', cost: 150, r: 26 * SCALE, squad: 'short' },
    barracksLong: { name: 'Archer Barracks', cost: 175, r: 26 * SCALE, squad: 'long' },
    // Allies: barracks that train a single, larger specialist (see SQUAD_KINDS in squads.js).
    allyEngineer: { name: 'Engineer Lodge', cost: 150, r: 19 * SCALE, squad: 'engineer' },
    allyMedic: { name: 'Medic Tent', cost: 175, r: 19 * SCALE, squad: 'medic' },
    allyOfficer: { name: 'Officer Quarters', cost: 200, r: 19 * SCALE, squad: 'officer' },
    allyDemolitionist: { name: 'Demolitionist Workshop', cost: 225, r: 19 * SCALE, squad: 'demolitionist' }
  };
  G.BASE_R = BASE_R;

  G.SLOT_R = SLOT_R;
  G.bases = [];
  G.BASE_COLS = [650, 2030];

  G.createBases = function () {
    const m = G.map;
    // Edge-to-edge gaps: 360 between bases on a side, 1920 between the two sides.
    const cols = G.BASE_COLS;                     // distance from each side's outer edge
    const rows = [m.h / 2 - 1280, m.h / 2, m.h / 2 + 1280];
    G.bases = [];
    G.buildingsChanged();
    for (const side of [G.TEAM.PLAYER, G.TEAM.ENEMY]) {
      for (const cx of cols) {
        for (const y of rows) {
          const x = side === G.TEAM.PLAYER ? cx : m.w - cx;
          const slots = [];
          for (let i = 0; i < SLOT_COUNT; i++) {
            const a = -Math.PI / 2 + (i / SLOT_COUNT) * Math.PI * 2;
            slots.push({ x: x + Math.cos(a) * SLOT_RING, y: y + Math.sin(a) * SLOT_RING, building: null });
          }
          // team: owner, or null while neutral. side: which half of the map it sits on.
          G.bases.push({ id: G.bases.length, x, y, r: BASE_R, side, team: null, slots });
        }
      }
    }
    return G.bases;
  };

  // Each side's Command Center stands in the center of its furthest-back middle base.
  // It lives in an extra `core` slot at the base center, so everything that walks base.slots
  // (building lists, solids, storm fields, base ownership) sees it like any other building.
  G.createCommandCenters = function () {
    const m = G.map;
    G.commandCenters = {};
    for (const side of [G.TEAM.PLAYER, G.TEAM.ENEMY]) {
      const x = side === G.TEAM.PLAYER ? G.BASE_COLS[0] : m.w - G.BASE_COLS[0];
      const base = G.bases.find(b => b.x === x && b.y === m.h / 2);
      const core = { x: base.x, y: base.y, building: null, core: true };
      base.slots.push(core);
      base.core = core;
      G.commandCenters[side] = G.addBuilding(base, core, 'command', side);
    }
  };

  G.baseAt = (x, y) => G.bases.find(b => G.dist(x, y, b.x, b.y) <= b.r) || null;

  G.slotAt = function (x, y) {
    for (const base of G.bases)
      for (const slot of base.slots)
        if (!slot.core && G.dist(x, y, slot.x, slot.y) <= SLOT_R) return { base, slot };
    return null;
  };

  // Returns null on success, or a reason string the caller can show.
  // team: who the building is for (defaults to the hero's side; the test menu can build for the enemy).
  G.buildCheck = function (hero, base, slot, team = hero.team) {
    if (base.team !== null && base.team !== team) return team === hero.team ? 'Enemy base' : 'Not an enemy base';
    if (slot.building) return 'Slot occupied';
    if (G.dist(hero.x, hero.y, base.x, base.y) > base.r) return 'Hero must be in the base';
    // The hero may stand on the slot; placeBuilding() steps them off it.
    return null;
  };

  function refuse(slot, reason) {
    G.floaters.push({ x: slot.x, y: slot.y - 20, text: reason, t: 0, color: '#ffd27a' });
  }

  // A click on the ground: returns {base, slot} if it hit a slot the hero can build on.
  // Shows the reason and returns null if the slot can't be built on (or no slot was hit).
  G.slotClick = function (hero, wx, wy) {
    const hit = G.slotAt(wx, wy);
    if (!hit) return null;
    const reason = G.buildCheck(hero, hit.base, hit.slot);
    // Developer mode: also open the menu if only an enemy building could go here.
    const other = hero.team === G.TEAM.PLAYER ? G.TEAM.ENEMY : G.TEAM.PLAYER;
    if (reason && (!G.dev || G.buildCheck(hero, hit.base, hit.slot, other))) { refuse(hit.slot, reason); return null; }
    return hit;
  };

  // Place a building on a slot picked earlier (re-checked, since the hero may have moved).
  G.placeBuilding = function (hero, hit, type, team = hero.team) {
    const def = G.BUILDINGS[type];
    const reason = G.buildCheck(hero, hit.base, hit.slot, team) || (team === hero.team && !G.dev && hero.gold < def.cost ? 'Not enough gold' : null);
    if (reason) { refuse(hit.slot, reason); return false; }
    G.addBuilding(hit.base, hit.slot, type, team);
    if (team === hero.team && !G.dev) hero.gold -= def.cost;  // TESTING: enemy buildings from the test menu are free
    // If the hero is standing where the building goes, push them out to its edge.
    const dx = hero.x - hit.slot.x, dy = hero.y - hit.slot.y;
    const d = Math.hypot(dx, dy);
    const reach = def.r + hero.r + 2;
    if (d < reach) {
      const ux = d > 0.001 ? dx / d : 0, uy = d > 0.001 ? dy / d : -1;
      hero.x = hit.slot.x + ux * reach;
      hero.y = hit.slot.y + uy * reach;
    }
    G.burst(hit.slot.x, hit.slot.y, '#ffffff', 20, 140);
    return true;
  };

  // Buildings are attackable: they carry position, radius and hp like an entity.
  G.addBuilding = function (base, slot, type, team) {
    const def = G.BUILDINGS[type];
    const hp = Math.round((def.hp || BUILDING_HP) * (def.command ? 1 : G.raceMods(team).bhp));
    slot.building = {
      type, team, base, slot, x: slot.x, y: slot.y, r: def.r,
      maxHp: hp, hp, dead: false, flash: 0,
      takeDamage(amount) {
        if (this.dead) return;
        this.hp -= amount; this.flash = 0.12;
        G.floaters.push({ x: this.x + (Math.random() - 0.5) * 40, y: this.y, text: String(Math.round(amount)), t: 0, color: '#ffffff' });
        if (this.hp <= 0) G.destroyBuilding(this);
      }
    };
    base.team = team; // first building claims a neutral base
    G.buildingsChanged();
    return slot.building;
  };

  G.destroyBuilding = function (b) {
    b.hp = 0; b.dead = true;
    b.slot.building = null;
    G.buildingsChanged();
    G.burst(b.x, b.y, '#8a7a66', 40, 260);
    G.dropCoins(b.x, b.y, G.BUILDINGS[b.type].cost * G.BUILDING_SALVAGE);
    if (G.BUILDINGS[b.type].command) {
      G.burst(b.x, b.y, '#ffb050', 90, 520);
      G.endGame(b.team === G.TEAM.PLAYER ? G.TEAM.ENEMY : G.TEAM.PLAYER);
    }
    // A base with nothing left standing goes back to neutral.
    if (!b.base.slots.some(s => s.building)) b.base.team = null;
  };

  // The lists below are asked for many times per step (targeting, collisions, storm checks), so they
  // are cached and only rebuilt after a building goes up or comes down. Treat them as read-only.
  let listCache = null, solidsCache = null, stormCache = null;
  G.buildingsChanged = function () { listCache = solidsCache = stormCache = null; };

  G.buildingList = function () {
    if (listCache) return listCache;
    const out = [];
    for (const b of G.bases) for (const s of b.slots) if (s.building) out.push(s.building);
    return (listCache = out);
  };

  // The living Storm Tower in a base, or null.
  G.stormOf = function (base) {
    for (const s of base.slots) if (s.building && s.building.type === 'storm' && !s.building.dead) return s.building;
    return null;
  };

  // [{ base, storm }] for every base under a storm field.
  function stormBases() {
    if (stormCache) return stormCache;
    stormCache = [];
    for (const base of G.bases) {
      const storm = G.stormOf(base);
      if (storm) stormCache.push({ base, storm });
    }
    return stormCache;
  }

  // Can a ranged attack launched from (sx, sy) hit `target`? Only a storm field can say no: it blocks
  // attacks from outside the base against its side's units and buildings inside. Shots from inside pass.
  G.canShoot = function (sx, sy, target) {
    for (const { base, storm } of stormBases()) {
      if (target.team !== storm.team) continue;
      if (G.dist(target.x, target.y, base.x, base.y) > base.r) continue;
      return G.dist(sx, sy, base.x, base.y) <= base.r;
    }
    return true;
  };

  G.buildingSolids = function () {
    if (solidsCache) return solidsCache;
    const out = [];
    for (const b of G.bases)
      for (const s of b.slots)
        if (s.building) out.push({ x: s.x, y: s.y, cr: G.BUILDINGS[s.building.type].r });
    return (solidsCache = out);
  };

})(window.Game);
