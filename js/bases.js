// Bases & buildings: circular bases laid out by the map (see map.js); each has 6 radial building slots (some maps: 4).
(function (G) {
  const SCALE = 3;                 // size multiplier for bases and buildings
  const BASE_R = 170 * SCALE;      // base radius
  const SLOT_RING = 108 * SCALE;   // distance from base center to each slot
  const SLOT_R = 32 * SCALE;       // clickable/visual radius of a slot
  const SLOT_COUNT = 6;
  const BUILDING_HP = 1500;
  const BARRACKS_HP = 1000;        // troop barracks (not the Allies buildings)
  // Defense weapons, shared by the towers and the Fortress (which carries several at once).
  const DIGIN_WEAPON = { range: G.m(15), minRange: 0, cooldown: 0.3, damage: 20, targets: 'all', pick: 'nearest', shot: 'arrow', muzzle: 40, speed: 900 };
  const SUPPORT_WEAPON = { range: G.m(25), minRange: 0, cooldown: 1.6, damage: 90, targets: 'units', pick: 'nearest', shot: 'bolt', muzzle: 230, speed: 1300 };
  const SIEGE_WEAPON = { range: G.m(41), minRange: G.m(12), cooldown: 10, damage: 500, targets: 'buildings', pick: 'nearest',
    shot: 'boulder', muzzle: 70, speed: 700 };
  // Wall: 6 segments on a ring just inside the base edge, one in front of each slot. Each segment is
  // made of posts (collision circles, see G.buildingSolids); the posts in its middle form a gate that
  // only its own side walks through. G.steer routes walkers through gates and around walled bases.
  const WALL_R = BASE_R - 22;
  const WALL_SPAN = Math.PI / SLOT_COUNT;     // half the angle one segment covers
  const GATE_HALF = 70 / WALL_R;              // half the gate's angle: a 2.8 m opening
  const POST_GAP = 24, POST_R = 16;

  // Building catalog. Add new building types here.
  G.BUILDINGS = {
    // `cost`: gold to build, set by value: hut (no effect yet) < dig-in < barracks < support/allies < storm/siege.
    // Destroyed buildings drop G.BUILDING_SALVAGE of it as coins (see economy.js). The Command Center is free.
    // No gameplay effects yet: these only differ in name and model.
    hut: { name: 'Hut', cost: 50, r: 26 * SCALE },
    // Defense: `weapon` (or `weapons`, several firing on their own) makes the building shoot (see towers.js).
    //   range/minRange: center-to-target distance. targets: 'units', 'buildings' or 'all' (units + buildings).
    //   pick: 'nearest', 'buildings' (buildings first, else the nearest) or 'maxHp' (highest max health).
    //   bldgMul: damage multiplier against buildings. splash: shots hurt every hostile this close to where they land.
    //   roll: boulder keeps rolling after landing, hurting everything within radius; each hit multiplies its damage by
    //   falloff and it stops once damage drops below minDamage, so it can't flatten a whole squad.
    //   beam: a constant ray that locks onto one target, hitting every `cooldown` for `damage`, multiplied by
    //   `ramp` after each hit up to `maxDamage`; it starts over on a new target.
    digin: { name: 'Dig-In', cost: 100, r: 26 * SCALE, weapon: DIGIN_WEAPON },
    // Command Center: one per side, at the center of its back-middle base; can't be built or torn down.
    // `hp` overrides BUILDING_HP. Destroying the enemy's wins the game (see G.destroyBuilding).
    command: { name: 'Command Center', cost: 0, r: 48 * SCALE, hp: 5000, command: true,
      weapon: Object.assign({}, DIGIN_WEAPON, { range: G.m(15), cooldown: 1.5, damage: 200, muzzle: 230 }) },
    support: { name: 'Support-Tower', cost: 150, r: 22 * SCALE, weapon: SUPPORT_WEAPON },
    siege: { name: 'Siege', cost: 300, r: 26 * SCALE, weapon: SIEGE_WEAPON },
    // Wall: built from any slot, it rings the whole base without taking the slot. Each of its `segments`
    // is a building of its own (type wallSegment) that foes target and break separately.
    wall: { name: 'Wall', cost: 250, wall: true, segments: SLOT_COUNT },
    wallSegment: { name: 'Wall', cost: 250 / SLOT_COUNT, r: 30, hp: 750, segment: true, menu: false },
    energy: { name: 'Energy Weapon', cost: 300, r: 22 * SCALE,
      weapon: { range: G.m(12), minRange: 0, cooldown: 0.5, damage: 3, ramp: 2, maxDamage: 96, targets: 'units', pick: 'maxHp', beam: true, muzzle: 250 } },
    rock: { name: 'Rock Launch', cost: 175, r: 26 * SCALE,
      weapon: { range: G.m(20), minRange: 0, cooldown: 6, damage: 50, splash: G.m(1), targets: 'all', pick: 'nearest', shot: 'boulder', muzzle: 90, speed: 650 } },
    // Fortress: two dig-ins, a support tower and a siege in one spot.
    fortress: { name: 'Fortress', cost: 800, r: 28 * SCALE, hp: 2500,
      weapons: [DIGIN_WEAPON, Object.assign({}, DIGIN_WEAPON, { muzzle: 120 }), Object.assign({}, SUPPORT_WEAPON, { muzzle: 260 }), SIEGE_WEAPON] },
    // Storm Tower: no weapon. Its field covers the whole base: ranged attacks from outside can't hit
    // anything of its side inside the base (see G.canShoot). Movement and shots out are unaffected.
    storm: { name: 'Storm Tower', cost: 225, r: 22 * SCALE, field: true },
    // Barracks: `squad` names the unit kind it spawns (see SQUAD_KINDS in squads.js). Grouped in the
    // build menu as Infantry, Ranged, Mobile and Special. They have BARRACKS_HP.
    barracks: { name: 'Grunt Barracks', cost: 75, r: 26 * SCALE, squad: 'infantry', hp: BARRACKS_HP },
    barracksSpear: { name: 'Spearmen Barracks', cost: 100, r: 26 * SCALE, squad: 'spearman', hp: BARRACKS_HP },
    barracksElite: { name: 'Elite Barracks', cost: 150, r: 26 * SCALE, squad: 'elite', hp: BARRACKS_HP },
    barracksArmored: { name: 'Armored Barracks', cost: 175, r: 26 * SCALE, squad: 'armored', hp: BARRACKS_HP },
    barracksShort: { name: 'Skirmisher Barracks', cost: 125, r: 26 * SCALE, squad: 'short', hp: BARRACKS_HP },
    barracksLong: { name: 'Marksmen Barracks', cost: 150, r: 26 * SCALE, squad: 'long', hp: BARRACKS_HP },
    barracksCaster: { name: 'Caster Sanctum', cost: 200, r: 26 * SCALE, squad: 'caster', hp: BARRACKS_HP },
    barracksCreature: { name: 'Creature Pens', cost: 125, r: 26 * SCALE, squad: 'creature', hp: BARRACKS_HP },
    barracksMounted: { name: 'Stables', cost: 175, r: 26 * SCALE, squad: 'mounted', hp: BARRACKS_HP },
    barracksWarMachine: { name: 'Siege Works', cost: 400, r: 26 * SCALE, squad: 'warMachine', hp: BARRACKS_HP },
    // Special: each race's own troops, listed on the build menu's Special page. `race` is the only race
    // that can build one (see G.RACES[].special).
    barracksRam: { name: 'Ram Works', race: 'human', cost: 300, r: 26 * SCALE, squad: 'ram', hp: BARRACKS_HP },
    barracksLongbow: { name: 'Longbow Range', race: 'human', cost: 300, r: 26 * SCALE, squad: 'longbow', hp: BARRACKS_HP },
    barracksStormspeaker: { name: 'Storm Cairn', race: 'algox', cost: 300, r: 26 * SCALE, squad: 'stormspeaker', hp: BARRACKS_HP },
    barracksIcespeaker: { name: 'Frost Shrine', race: 'algox', cost: 300, r: 26 * SCALE, squad: 'icespeaker', hp: BARRACKS_HP },
    barracksWavethrower: { name: 'Tide Pool', race: 'lurker', cost: 300, r: 26 * SCALE, squad: 'wavethrower', hp: BARRACKS_HP },
    barracksClawcrusher: { name: 'Crusher Den', race: 'lurker', cost: 300, r: 26 * SCALE, squad: 'clawcrusher', hp: BARRACKS_HP },
    barracksRuinedMachine: { name: 'Scrap Heap', race: 'unfettered', cost: 300, r: 26 * SCALE, squad: 'ruinedMachine', hp: BARRACKS_HP },
    barracksBurrowingBlade: { name: 'Bore Works', race: 'unfettered', cost: 300, r: 26 * SCALE, squad: 'burrowingBlade', hp: BARRACKS_HP },
    // Allies: barracks that train a single, larger specialist (see SQUAD_KINDS in squads.js).
    allyEngineer: { name: 'Engineer Lodge', cost: 150, r: 19 * SCALE, squad: 'engineer' },
    allyMedic: { name: 'Medic Tent', cost: 175, r: 19 * SCALE, squad: 'medic' },
    allyOfficer: { name: 'Officer Quarters', cost: 200, r: 19 * SCALE, squad: 'officer' },
    allyDemolitionist: { name: 'Demolitionist Workshop', cost: 225, r: 19 * SCALE, squad: 'demolitionist' }
  };
  G.BASE_R = BASE_R;

  G.SLOT_R = SLOT_R;
  G.bases = [];

  // The bases of the map in play (see map.js layouts). A base's `slots` building slots (6 unless the
  // layout says otherwise) sit round its center; its wall always has SLOT_COUNT segments.
  G.createBases = function () {
    G.bases = [];
    G.buildingsChanged();
    for (const def of G.map.layout.bases) {
      const { x, y } = def, n = def.slots || SLOT_COUNT;
      const slots = [];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        slots.push({ x: x + Math.cos(a) * SLOT_RING, y: y + Math.sin(a) * SLOT_RING, building: null });
      }
      // Wall slots: where each wall segment stands (its middle, on the wall ring), with the posts it is
      // made of. Never built on directly (see G.buildWall).
      const walls = [];
      for (let i = 0; i < SLOT_COUNT; i++) {
        const a = -Math.PI / 2 + (i / SLOT_COUNT) * Math.PI * 2, posts = [];
        const n = Math.round(2 * WALL_SPAN * WALL_R / POST_GAP);
        for (let k = 0; k < n; k++) {
          const d = -WALL_SPAN + (k + 0.5) / n * 2 * WALL_SPAN;
          posts.push({ x: x + Math.cos(a + d) * WALL_R, y: y + Math.sin(a + d) * WALL_R, cr: POST_R, gate: Math.abs(d) < GATE_HALF });
        }
        walls.push({ x: x + Math.cos(a) * WALL_R, y: y + Math.sin(a) * WALL_R, building: null, wall: true, angle: a, posts });
      }
      slots.push(...walls);
      // team: owner, or null while neutral. side: which side's half of the map it sits on (null: neither).
      // hq: the side's Command Center base. front: where its CPU hero holds the line.
      G.bases.push({ id: G.bases.length, x, y, r: BASE_R, side: def.side ?? null, team: null, slots, walls, hq: !!def.hq, front: !!def.front });
    }
    return G.bases;
  };

  // Each side's Command Center stands in the center of its hq base (Frosthaven: the middle rear base;
  // Mountain: the camp in its corner). It lives in an extra `core` slot at the base center, so everything
  // that walks base.slots (building lists, solids, storm fields, base ownership) sees it like any other building.
  G.createCommandCenters = function () {
    G.commandCenters = {};
    for (const side of [G.TEAM.PLAYER, G.TEAM.ENEMY]) {
      const base = G.bases.find(b => b.hq && b.side === side);
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
        if (!slot.core && !slot.wall && G.dist(x, y, slot.x, slot.y) <= SLOT_R) return { base, slot };
    return null;
  };

  // Returns null on success, or a reason string the caller can show.
  // team: who the building is for (defaults to the hero's side; the test menu can build for the enemy).
  G.buildCheck = function (hero, base, slot, team = hero.team, type = null) {
    if (base.team !== null && base.team !== team) return team === hero.team ? 'Enemy base' : 'Not an enemy base';
    const race = type && G.BUILDINGS[type].race;
    if (race && race !== G.raceOf(team)) return 'Another race builds that';
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
    if (def.wall) return G.buildWall(hero, hit, team);
    const reason = G.buildCheck(hero, hit.base, hit.slot, team, type) || (team === hero.team && !G.dev && hero.gold < def.cost ? 'Not enough gold' : null);
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

  // The wall goes up around the whole base the slot is in: every missing segment at once, for its share
  // of the cost (a full wall the first time, only the broken pieces after that). The slot stays free.
  G.buildWall = function (hero, hit, team = hero.team) {
    const def = G.BUILDINGS.wall, base = hit.base;
    const missing = base.walls.filter(w => !w.building);
    const price = Math.round(def.cost * missing.length / def.segments);
    let reason = null;
    if (base.team !== null && base.team !== team) reason = team === hero.team ? 'Enemy base' : 'Not an enemy base';
    else if (G.dist(hero.x, hero.y, base.x, base.y) > base.r) reason = 'Hero must be in the base';
    else if (!missing.length) reason = 'Already walled';
    else if (team === hero.team && !G.dev && hero.gold < price) reason = 'Not enough gold';
    if (reason) { refuse(hit.slot, reason); return false; }
    for (const w of missing) { G.addBuilding(base, w, 'wallSegment', team); G.burst(w.x, w.y, '#ffffff', 12, 120); }
    if (team === hero.team && !G.dev) hero.gold -= price;
    G.map.resolve(hero);  // off the wall line, if the hero stood on it
    return true;
  };

  // Buildings are attackable: they carry position, radius and hp like an entity.
  G.addBuilding = function (base, slot, type, team) {
    const def = G.BUILDINGS[type];
    const hp = def.hp || BUILDING_HP;
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

  // fn(building, by) whenever a building comes down; `by` is the hero tearing it down, if one is.
  G.buildingDeathListeners = [];

  G.destroyBuilding = function (b, by = null) {
    b.hp = 0; b.dead = true;
    b.slot.building = null;
    G.buildingsChanged();
    G.burst(b.x, b.y, '#8a7a66', 40, 260);
    G.dropCoins(b.x, b.y, G.BUILDINGS[b.type].cost * G.BUILDING_SALVAGE);
    for (const fn of G.buildingDeathListeners) fn(b, by);
    if (G.BUILDINGS[b.type].command) {
      G.burst(b.x, b.y, '#ffb050', 90, 520);
      G.endGame(b.team === G.TEAM.PLAYER ? G.TEAM.ENEMY : G.TEAM.PLAYER);
    }
    // A base with nothing left standing goes back to neutral.
    if (!b.base.slots.some(s => s.building)) b.base.team = null;
  };

  // The lists below are asked for many times per step (targeting, collisions, storm checks), so they
  // are cached and only rebuilt after a building goes up or comes down. Treat them as read-only.
  let listCache = null, solidsCache = null, stormCache = null, wallCache = null;
  G.buildingsChanged = function () { listCache = solidsCache = stormCache = wallCache = null; };

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
      for (const s of b.slots) {
        if (!s.building) continue;
        // A wall segment is a row of posts; its gate posts let its own side through (see G.map.resolve).
        if (s.wall) for (const p of s.posts) out.push({ x: p.x, y: p.y, cr: p.cr, wall: true, gate: p.gate, team: s.building.team });
        else out.push({ x: s.x, y: s.y, cr: G.BUILDINGS[s.building.type].r });
      }
    return (solidsCache = out);
  };

  // ---- Walls: getting through and around them ----
  // Bases with at least one wall segment standing.
  function walledBases() {
    if (wallCache) return wallCache;
    return (wallCache = G.bases.filter(b => b.walls.some(w => w.building)));
  }
  const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
  // The wall slot whose segment covers angle `a` (around the base center).
  const wallAt = (base, a) => base.walls[((Math.round((a + Math.PI / 2) / (2 * WALL_SPAN)) % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT];
  // Can a walker of `team` cross the wall ring of `base` at angle `a`? Through a broken segment, or
  // through the gate of a standing segment of its own side.
  function passable(base, a, team) {
    const w = wallAt(base, a), b = w.building;
    return !b || (b.team === team && Math.abs(wrapAngle(a - w.angle)) < GATE_HALF);
  }
  // Where the path (ax, ay) -> (bx, by) crosses the wall ring of `base`: [{ k (0..1 along the path), a (angle) }].
  function crossings(base, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, fx = ax - base.x, fy = ay - base.y;
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - WALL_R * WALL_R;
    const disc = B * B - 4 * A * C;
    if (A < 1e-6 || disc <= 0) return [];
    const sq = Math.sqrt(disc), out = [];
    for (const k of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)])
      if (k > 0 && k < 1) out.push({ k, a: Math.atan2(ay + dy * k - base.y, ax + dx * k - base.x) });
    return out;
  }
  // The passage through `base`'s wall that makes the shortest way from `e` to (tx, ty) for `team`, as an
  // angle, or null if there is none. `a`: where the straight path hits the wall. A broken segment opens
  // its whole span (less a margin for the walker's body); a gate only its middle.
  function bestPassage(base, e, tx, ty, a) {
    let best = null, bc = Infinity;
    for (const w of base.walls) {
      const b = w.building;
      if (b && b.team !== e.team) continue;
      const half = b ? 0 : Math.max(0, WALL_SPAN - ((e.r || 0) + POST_R + 6) / WALL_R);
      const at = w.angle + G.clamp(wrapAngle(a - w.angle), -half, half);
      const px = base.x + Math.cos(at) * WALL_R, py = base.y + Math.sin(at) * WALL_R;
      const cost = G.dist(e.x, e.y, px, py) + G.dist(px, py, tx, ty);
      if (cost < bc) { bc = cost; best = at; }
    }
    return best;
  }

  // Bend the way from `e` to (gx, gy) around a circle about the base center: while the path dips
  // within `rad` of the center, aim instead where it comes closest, pushed out to `out`. Re-steered
  // every step, this traces a curve around the circle.
  function bendAround(base, e, gx, gy, rad, out) {
    for (let i = 0; i < 4; i++) {
      const l2 = (gx - e.x) ** 2 + (gy - e.y) ** 2;
      if (l2 < 1) break;
      const k = G.clamp(((base.x - e.x) * (gx - e.x) + (base.y - e.y) * (gy - e.y)) / l2, 0, 1);
      let qx = e.x + (gx - e.x) * k - base.x, qy = e.y + (gy - e.y) * k - base.y, q = Math.hypot(qx, qy);
      if (k <= 0 || q >= rad) break;   // heading away from the circle, or passing clear of it
      if (q < 1) { qx = -(gy - e.y); qy = gx - e.x; q = Math.hypot(qx, qy) || 1; }  // dead on the center: pick a side
      gx = base.x + qx / q * out; gy = base.y + qy / q * out;
    }
    return { x: gx, y: gy };
  }

  // Where a walker `e` ({ x, y, r, team }) heading for (tx, ty) should actually head, given the walls
  // in the way. Returns null for a clear path, { x, y } for a waypoint, or { wall } when an unbroken
  // wall of another side shuts it out: then it has to break that segment first.
  // A destination on the wall line itself (a wall segment) can be walked straight up to.
  // Crevasses in the way come first: the walker heads round the end of one (G.map.gapSteer), minding walls.
  G.steer = function (e, tx, ty) {
    const g = G.map.gapSteer(e, tx, ty);
    return g ? wallSteer(e, g.x, g.y) || g : wallSteer(e, tx, ty);
  };
  function wallSteer(e, tx, ty) {
    const list = walledBases();
    if (!list.length) return null;
    const L = G.dist(e.x, e.y, tx, ty);
    if (L < 1) return null;
    let hit = null;
    for (const base of list) {
      const onWall = Math.abs(G.dist(tx, ty, base.x, base.y) - WALL_R) < 8;
      for (const c of crossings(base, e.x, e.y, tx, ty)) {
        if ((onWall && (1 - c.k) * L < 40) || passable(base, c.a, e.team)) continue;
        if (!hit || c.k < hit.k) hit = { base, k: c.k, a: c.a };
      }
    }
    if (!hit) return null;
    const { base } = hit, r = e.r || 0, clear = r + POST_R + 20;
    const de = G.dist(e.x, e.y, base.x, base.y), inside = de < WALL_R;
    // Both ends outside: walk around the wall instead of through it.
    if (!inside && G.dist(tx, ty, base.x, base.y) >= WALL_R) return bendAround(base, e, tx, ty, WALL_R, WALL_R + clear + 30);
    const at = bestPassage(base, e, tx, ty, hit.a);
    if (at === null) return { wall: wallAt(base, hit.a).building };
    // Line up on this side of the passage, then walk straight through to the far side. Anywhere the
    // body fits between the gate posts counts as lined up, so a crowd can file through side by side.
    const ea = Math.atan2(e.y - base.y, e.x - base.x), fit = Math.max(10, GATE_HALF * WALL_R - r - POST_R - 2);
    const lined = Math.abs(de - WALL_R) <= clear + 4 && Math.abs(wrapAngle(ea - at)) * WALL_R < fit;
    const rr = WALL_R + (inside === lined ? clear : -clear);
    const aa = at + G.clamp(wrapAngle(ea - at), -fit / WALL_R, fit / WALL_R);   // the nearest lane through
    const wx = base.x + Math.cos(aa) * rr, wy = base.y + Math.sin(aa) * rr;
    // Inside the Command Center's base, go round the Command Center on the way.
    const cc = base.core && base.core.building;
    if (!inside || lined || !cc) return { x: wx, y: wy };
    return bendAround(base, e, wx, wy, cc.r + r + 4, cc.r + r + 30);
  }

})(window.Game);
