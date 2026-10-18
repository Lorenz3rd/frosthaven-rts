// Squads: barracks spawn groups of melee soldiers that think as a group and fight as individuals.
// The squad picks one target (nearest hostile hero, soldier or building) and marches in formation;
// once close, each soldier breaks off to swing at the nearest hostile around that target.
(function (G) {
  // Unit kinds a barracks can field (BUILDINGS[type].squad picks one). Every race fields the same troops
  // under the same names; only the models differ (see js/models/).
  //   name: shown in menus. bounty: gold in the coin pile it drops on death. cols x rows: formation.
  //   range: edge-to-edge reach; anything over MELEE_MAX fires shots instead of swinging.
  //   bonus: { kind: x } multiplies damage dealt to that kind; resist: { kind: x } multiplies damage taken from it.
  //   splash: shots hurt every hostile this close to where they land. shot: projectile look (default 'arrow').
  //   messy: formation slots wander this far from their place. charge: rides past foes instead of
  //   standing to fight (see Soldier.ride). guns: secondary weapons (see Soldier.fireGuns).
  //   pick: 'healthiest' aims the main weapon at the healthiest hostile in range. barH: hp bar height.
  //   mass: how hard it shoves other soldiers when bodies collide (default 1).
  // Special troops (one race each, see G.RACES[].special) add their own traits:
  //   targets: 'buildings' never picks anything else. desc: a line for the build menu.
  //   wreck: { kind, count } spawns that many of that kind where it falls. ward: storm shield (see stormspeak).
  //   reflect: share of each hit taken bounced back at the attacker. chill: attackers' attack speed
  //   multiplier and how long it lasts. surge: attacks with a rolling wave (see surge). carapace: a shell
  //   soaking `hp` damage first; it won't attack until the shell breaks, then moves at `speed` and hits
  //   everything around it. deathBlast: explodes on death. burrow: travels underground, untouchable,
  //   until within `surface` of the building it goes for (see burrowStep).
  const INFANTRY_SPEED = 99;       // 165 - 40%
  const SQUAD_KINDS = {
    // Infantry
    infantry: { name: 'Grunts', bounty: 3, cols: 4, rows: 3, spacing: 44, r: 11, hp: 80, damage: 3, range: G.m(0.5), cooldown: 1.0, speed: INFANTRY_SPEED,
      resist: { short: 0.7 } },
    spearman: { name: 'Spearmen', bounty: 3, cols: 5, rows: 2, spacing: 44, r: 11, hp: 100, damage: 5, range: G.m(1.5), cooldown: 1.1, speed: INFANTRY_SPEED,
      bonus: { armored: 1.3 } },
    elite: { name: 'Elites', bounty: 6, cols: 8, rows: 1, spacing: 76, r: 11, hp: 90, damage: 5, range: G.m(0.5), cooldown: 0.5, speed: 120,
      bonus: { infantry: 1.3 } },
    armored: { name: 'Armored', bounty: 10, cols: 4, rows: 1, spacing: 58, r: 15, hp: 400, damage: 2, range: G.m(0.5), cooldown: 1.4, speed: 65, barH: 84,
      resist: { long: 0.7 } },
    // Ranged
    short: { name: 'Skirmishers', bounty: 2, cols: 5, rows: 2, spacing: 44, r: 11, hp: 60, damage: 2, range: G.m(7), cooldown: 1.0, speed: INFANTRY_SPEED,
      resist: { elite: 0.7 } },
    long: { name: 'Marksmen', bounty: 3, cols: 3, rows: 2, spacing: 44, r: 11, hp: 40, damage: 5, range: G.m(15), cooldown: 2.0, speed: 80,
      bonus: { spearman: 1.3 } },
    caster: { name: 'Casters', bounty: 12, cols: 2, rows: 2, spacing: 52, r: 11, hp: 50, damage: 5, range: G.m(8), cooldown: 1.5, speed: INFANTRY_SPEED,
      splash: G.m(1), shot: 'orb', bonus: { creature: 1.3 } },
    // Mobile
    creature: { name: 'Creatures', bounty: 5, cols: 4, rows: 2, spacing: 66, messy: 34, r: 14, hp: 120, damage: 4, range: G.m(0.5), cooldown: 0.75, speed: 150,
      bonus: { mounted: 1.3 } },
    mounted: { name: 'Mounted', bounty: 15, cols: 3, rows: 1, spacing: 84, r: 18, hp: 220, damage: 45, range: G.m(1.5), cooldown: 2.0, speed: 140, barH: 104,
      charge: true, mass: 4, resist: { caster: 0.7 } },
    warMachine: { name: 'War Machine', bounty: 50, cols: 1, rows: 1, spacing: 0, r: 42, hp: 700, damage: 80, range: G.m(15), cooldown: 3.0, speed: 50, barH: 150,
      splash: G.m(1), shot: 'shell', pick: 'healthiest', mass: 10, guns: { count: 2, damage: 5, cooldown: 0.75, range: G.m(8) } },
    // Special: Human
    ram: { name: 'Battering Ram', bounty: 35, cols: 1, rows: 1, spacing: 0, r: 34, hp: 700, damage: 150, range: G.m(1.5), cooldown: 1.5, speed: 110, barH: 110,
      targets: 'buildings', mass: 10, wreck: { kind: 'infantry', count: 4 }, desc: 'Buildings only · breaks into 4 Grunts' },
    longbow: { name: 'Longbowmen', bounty: 3, cols: 5, rows: 1, spacing: 44, r: 11, hp: 55, damage: 10, range: G.m(22), cooldown: 2.0, speed: 80, desc: '22 m range' },
    // Special: Algox
    stormspeaker: { name: 'Stormspeakers', bounty: 20, role: 'stormspeaker', cols: 2, rows: 1, spacing: 70, r: 13, hp: 125, damage: 0, range: G.m(4), cooldown: 1, speed: 110, barH: 80,
      ward: { r: G.m(7), hp: 400, regrow: 8 }, desc: 'Storm shield over allies stops ranged attacks' },
    icespeaker: { name: 'Icespeakers', bounty: 12, cols: 3, rows: 1, spacing: 60, r: 15, hp: 500, damage: 2, range: G.m(0.5), cooldown: 1.4, speed: 110, barH: 86,
      targets: 'buildings', reflect: 0.2, chill: { atk: -0.4, dur: 4 }, desc: 'Buildings only · hitting one hurts and chills' },
    // Special: Lurker
    wavethrower: { name: 'Wavethrowers', bounty: 12, cols: 4, rows: 1, spacing: 48, r: 12, hp: 150, damage: 25, range: G.m(8), cooldown: 3.0, speed: 99,
      surge: { width: G.m(1.5), len: G.m(12), speed: G.m(3), push: G.m(2) }, desc: 'Waves wash foes back 2 m' },
    clawcrusher: { name: 'Clawcrushers', bounty: 12, cols: 3, rows: 1, spacing: 62, r: 16, hp: 110, damage: 30, range: G.m(0.5), cooldown: 2.0, speed: 90, barH: 86,
      targets: 'buildings', carapace: { hp: 250, speed: 130 }, desc: 'Buildings only · enraged once its shell breaks' },
    // Special: Unfettered
    ruinedMachine: { name: 'Ruined Machines', bounty: 3, cols: 3, rows: 2, spacing: 44, r: 11, hp: 80, damage: 3, range: G.m(0.5), cooldown: 1.0, speed: INFANTRY_SPEED,
      deathBlast: { r: G.m(1.5), damage: 50 }, desc: 'Explode when destroyed' },
    burrowingBlade: { name: 'Burrowing Blades', bounty: 12, cols: 4, rows: 1, spacing: 50, r: 13, hp: 200, damage: 3, range: G.m(0.5), cooldown: 0.3, speed: 80,
      targets: 'buildings', burrow: { surface: G.m(4) }, desc: 'Buildings only · tunnels up to its target' },
    // Allies: a single unit, 1.5x the size of a soldier. `role` gives support allies their own brain
    // (see Squad.updateSupport); `prefer: 'buildings'` makes a fighter pick buildings before anything else.
    engineer: { name: 'Engineer', bounty: 12, ally: true, role: 'engineer', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 200, damage: 0, range: 20, cooldown: 0.5, speed: INFANTRY_SPEED },
    medic: { name: 'Medic', bounty: 14, ally: true, role: 'medic', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 80, damage: 0, range: 250, cooldown: 1.5, speed: INFANTRY_SPEED },
    officer: { name: 'Officer', bounty: 16, ally: true, role: 'officer', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 150, damage: 2, range: 300, cooldown: 0.75, speed: INFANTRY_SPEED },
    demolitionist: { name: 'Demolitionist', bounty: 18, ally: true, prefer: 'buildings', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 70, damage: 80, range: 1000, cooldown: 2.0, speed: INFANTRY_SPEED },
    // Summons: raised by heroes (see heroes.js), never trained. They follow their summoner, drop no gold
    // and crumble when their time runs out. cleave: melee hits splash this radius.
    skeleton: { bounty: 0, summon: true, cols: 2, rows: 1, spacing: 40, r: 12, hp: 70, damage: 15, range: 14, cooldown: 1.5, speed: 80 },
    skeletonSolo: { bounty: 0, summon: true, cols: 1, rows: 1, spacing: 0, r: 12, hp: 70, damage: 15, range: 14, cooldown: 1.5, speed: 80 },
    // hpDamage: hits for this share of its current health, `damage` at least.
    // absorb: rolls up friendly soldiers of these kinds it touches, growing with each (see absorb).
    boneBall: { bounty: 0, summon: true, cols: 1, rows: 1, spacing: 0, r: 30, hp: 400, damage: 120, hpDamage: 0.3, range: 26, cooldown: 1.5, speed: 110, barH: 105,
      absorb: { kinds: ['skeleton', 'skeletonSolo'], reach: G.m(1), hp: 100, maxHp: 900 } },
    // The Bannerspear's squire: never attacks, just shadows her (see guard). Speed follows hers.
    charlie: { bounty: 0, summon: true, role: 'guardian', cols: 1, rows: 1, spacing: 0, r: 14, hp: 200, damage: 0, range: 20, cooldown: 1, speed: 172, barH: 80 }
  };
  // Cavalry handling: how fast a rider can turn (rad/s), how long it rides on after a strike before
  // wheeling round, and how wide of its foe it aims so it rides past instead of into it.
  const RIDE_TURN = 1.7, RIDE_OVERRUN = 1.1, RIDE_PASS = 14;
  const ENGINEER_HEAL = 20;        // building hp per second
  const MEDIC_HEAL = 15;          // hp per splash, every `cooldown` seconds
  const MEDIC_RADIUS = 75;         // ~3/4 of the area an infantry block covers (4x3 at 44 spacing)
  const OFFICER_AURA = 250;       // 5 m
  const OFFICER_HASTE = 1.3;       // attack speed multiplier inside the aura
  const GUARD_DIST = G.m(3);       // Charlie keeps about this far from his hero
  const GUARD_WATCH = G.m(12);     // ...and steps in front of hostiles this close to her
  const GUARD_REGEN = 1;           // hp per second
  G.OFFICER_AURA = OFFICER_AURA;
  const MELEE_MAX = 80;            // longest melee reach (spears, lances: 1.5 m)
  const ARROW_SPEED = 900;
  const ROCKET_SPEED = 1100;
  const ORB_SPEED = 600;
  const SHELL_SPEED = 750;
  G.SQUAD_KINDS = SQUAD_KINDS;
  G.isRangedKind = kind => SQUAD_KINDS[kind].range > MELEE_MAX;

  // Troop strengths: the damage multiplier for a hit from a soldier of `kind` on `target`.
  // Only troops have strengths; heroes, buildings and beasts take hits as they come.
  G.kindMul = function (kind, target) {
    const a = kind && SQUAD_KINDS[kind], d = target instanceof Soldier ? SQUAD_KINDS[target.kind] : null;
    if (!a || !d) return 1;
    return ((a.bonus && a.bonus[target.kind]) || 1) * ((d.resist && d.resist[kind]) || 1);
  };
  // One line per strength for menus, e.g. "30% more damage to Armored", "takes 30% less from Skirmishers".
  G.strengthText = function (kind) {
    const k = SQUAD_KINDS[kind], pct = x => Math.round(Math.abs(x - 1) * 100) + '%', out = [];
    for (const [t, x] of Object.entries(k.bonus || {})) out.push(`${pct(x)} ${x > 1 ? 'more' : 'less'} damage to ${SQUAD_KINDS[t].name}`);
    for (const [t, x] of Object.entries(k.resist || {})) out.push(`takes ${pct(x)} ${x < 1 ? 'less' : 'more'} from ${SQUAD_KINDS[t].name}`);
    return out;
  };
  const SPAWN_INTERVAL = 30;       // minimum seconds between squads per barracks
  const RETHINK = 0.5;             // seconds between squad target decisions
  const ENGAGE_RANGE = 260;        // squad breaks formation within this distance of its target
  const LEASH = 420;               // soldiers only chase hostiles this close to the squad target
  const COMMAND_RADIUS = 170;      // friendly soldiers this close to the hero can be commanded
  const FOLLOW_COLS = 5, FOLLOW_SPACING = 34;
  const GUARD_REACH = G.m(8);      // guarding / alert melee: hostiles this close to their spot
  const FORM_COLS = 8, FORM_GAP = 12;  // order formations: soldiers per row, room between bodies
  const FORM_CLUSTER = G.m(10);    // groups this close together form up as one block
  const FORM_TIME = 3;             // charge: longest wait for the block to form before setting off
  const BLOCK_AHEAD = G.m(1.5);    // charging melee: a hostile this close ahead (past its reach) blocks it
  const BLOCK_LANE = G.m(1);       // ...when this close to its line (besides both bodies)
  const SUMMON_LEASH = 900;        // summons only fight foes this close to their summoner
  const DIG_TIME = 0.8;            // burrowing: seconds to dig in (it stands still, still hittable)
  const REBURROW = 2;              // ...and it digs back in once its building is over `surface` x this away
  const SURFACE_PAUSE = 0.5;       // seconds after popping up before its first strike

  G.squads = [];
  let wards = [];                  // Stormspeakers with their storm shield up, refreshed every step
  // Soldiers under a hero's command (any number of groups) live in hero.followers; see G.commandFollow.

  class Soldier extends G.Entity {
    constructor(x, y, team, squad, kind) {
      const k = SQUAD_KINDS[kind];
      super(x, y, k.r, k.hp, team);
      this.squad = squad;
      this.kind = kind;
      this.ranged = k.range > MELEE_MAX;
      this.speed = k.speed;
      this.damage = k.damage * G.bonusOf(team).troopDmg;
      this.attackRange = k.range;  // edge-to-edge reach
      this.attackCooldown = k.cooldown;
      this.cleave = k.cleave || 0;
      this.mass = k.mass || 1;
      if (k.charge) { this.heading = 0; this.overrun = 0; this.passSide = 0; this.stuck = 0; this.rideFrom = null; }
      if (k.guns) { this.aim = 0; this.gunCd = Array.from({ length: k.guns.count }, (_, i) => i * k.guns.cooldown / k.guns.count); }
      if (k.ward) { this.ward = k.ward.hp; this.wardT = 0; }
      if (k.carapace) this.carapace = k.carapace.hp;
      if (k.burrow) { this.burrowed = false; this.digIn = DIG_TIME; }   // digs in right where it's trained
      this.cd = Math.random() * 0.5;
      this.swing = 0;              // 1 -> 0 over an attack animation
      this.facing = 0;
      this.moving = false;
      this.foe = null;             // individual target while engaged
      this.heroFollow = false;     // commanded by a hero: leaves the squad's brain for the hero's orders
      this.commander = null;       // ...that hero
      this.cmd = null;             // ...its order: 'follow', 'guard', 'alert' or 'charge'
      this.followOffset = { x: 0, y: 0 };
      this.post = null;            // guard/alert/charge: its spot in the formation
      this.cmdGroup = null;        // charge: { t, formed, pace } shared by the block it formed up in
      this.cmdHp = 0;              // alert: health last step (a drop means it was hit)
      this.haste = 0;              // seconds left of an officer's attack speed boost
      this.auraOn = false;         // officer: aura is touching a friendly soldier
    }
    // Attack cooldown recovers faster under an officer's aura.
    tickCooldown(dt) {
      this.cd = Math.max(0, this.cd - dt * (this.haste > 0 ? OFFICER_HASTE : 1) * this.buffMul('atk'));
      this.haste = Math.max(0, this.haste - dt);
    }
    // Shells soak hits first; Icespeakers bite back at whoever hits them.
    takeDamage(amount, src) {
      if (this.carapace > 0 && !this.dead && !this.untargetable && amount > 0) {
        const soak = Math.min(this.carapace, amount);
        this.carapace -= soak; amount -= soak; this.flash = 0.12;
        G.floaters.push({ x: this.x + (Math.random() - 0.5) * 16, y: this.y - this.r, text: String(Math.round(soak)), t: 0, color: '#8fe0e8' });
        if (this.carapace <= 0) crack(this);
        if (amount <= 0) return soak;
      }
      const dealt = super.takeDamage(amount, src);
      const k = SQUAD_KINDS[this.kind];
      if ((k.reflect || k.chill) && src && !src.dot && !src.reflect) iceBite(this, k, dealt, src.by || src.hero);
      return dealt;
    }
    die(src) {
      super.die(src);
      const k = SQUAD_KINDS[this.kind];
      G.burst(this.x, this.y, k.summon ? '#cfe8d0' : '#a33a2a', 10, 120);
      G.dropCoins(this.x, this.y, k.bounty);
      if (k.deathBlast) blast(this, k.deathBlast);
      if (k.wreck) wreck(this, k.wreck);
    }

    // Step toward (tx, ty), stopping `stop` short. Returns true when arrived.
    // Walls in the way: head for a gate (or around the wall) first; see G.steer. Burrowers go under.
    walk(tx, ty, stop, dt, speedMul = 1) {
      let dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
      if (d <= stop) return true;
      if (this.digIn > 0) return false;  // digging in
      const via = !this.burrowed && G.steer(this, tx, ty);
      if (via && !via.wall) { dx = via.x - this.x; dy = via.y - this.y; d = Math.hypot(dx, dy) || 1; stop = 0; }
      const step = Math.min(d - stop, this.speed * this.speedMul * speedMul * dt);
      if (step <= 0) return false;  // stunned or rooted
      this.facing = Math.atan2(dy, dx);
      this.x += (dx / d) * step; this.y += (dy / d) * step;
      this.moving = true;
      // The earth heaves over a burrower: a trail of kicked-up dirt.
      if (this.burrowed && Math.random() < dt * 6) G.particles.push({ x: this.x, y: this.y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.6, t: 0, color: '#5a4630', size: 3 });
      return false;
    }

    update(dt) {
      super.update(dt);
      if (this.dead) return;
      this.tickCooldown(dt);
      this.swing = Math.max(0, this.swing - dt * 2.5);
      this.moving = false;
      const k = SQUAD_KINDS[this.kind];
      if (k.ward && this.ward <= 0 && (this.wardT -= dt) <= 0) {
        this.ward = k.ward.hp;   // the storm gathers again
        G.addFx('ring', { x: this.x, y: this.y, r0: 20, r1: k.ward.r, dur: 0.6, color: 0xbfd8ff });
      }
      if (k.burrow) burrowStep(this, k.burrow, dt);
      // Movement and attacks are driven by the squad (see Squad.update).
    }

    attack(foe, dt) {
      // A foe behind an enemy wall: break the wall first (ranged soldiers shoot over it if in reach).
      const via = !this.burrowed && G.dist(this.x, this.y, foe.x, foe.y) > this.r + foe.r + this.attackRange && G.steer(this, foe.x, foe.y);
      if (via && via.wall) foe = via.wall;
      // Close in, then strike from anywhere in reach: a body being jostled by a crowd (foes shoving
      // into a ram) keeps getting nudged off the exact spot it walked to.
      const reach = this.r + foe.r + this.attackRange;
      if (!this.walk(foe.x, foe.y, reach - 2, dt) && G.dist(this.x, this.y, foe.x, foe.y) > reach) return;
      this.strike(foe);
    }

    // Swing or loose a shot at `foe` if it is in reach and the cooldown is ready.
    strike(foe) {
      this.facing = Math.atan2(foe.y - this.y, foe.x - this.x);
      if (this.cd > 0 || this.stunned || this.burrowed || this.digIn > 0 || this.carapace > 0) return;
      if (this.ranged && !G.canShoot(this.x, this.y, foe)) return;  // blocked by a storm field
      this.cd = this.attackCooldown * (0.9 + Math.random() * 0.2);
      this.swing = 1;
      const k = SQUAD_KINDS[this.kind];
      const base = k.hpDamage ? Math.max(this.damage, this.hp * k.hpDamage * G.bonusOf(this.team).troopDmg) : this.damage;
      const dmg = base * this.buffMul('dmg') * (0.85 + Math.random() * 0.3);
      if (!this.ranged) {
        if (k.carapace) { crush(this, dmg); return; }
        foe.takeDamage(dmg * G.kindMul(this.kind, foe), { unit: true, by: this });
        if (this.cleave) {
          for (const e of G.foesInRadius(this.team, foe.x, foe.y, this.cleave))
            if (e !== foe) e.takeDamage(dmg * 0.6, { unit: true, by: this });
          G.addFx('ring', { x: foe.x, y: foe.y, r0: 10, r1: this.cleave, dur: 0.35, color: 0xcfe8d0 });
        }
        return;
      }
      if (k.surge) { surge(this, foe, dmg, k.surge); return; }
      // Loose a shot on the tower shot system: it homes on the foe and hits on arrival (strengths and
      // splash are applied there, see towers.js). Demolitionists fire rockets: faster and nearly flat.
      // Casters hurl slow orbs; a war machine lobs heavy shells.
      const shot = this.kind === 'demolitionist' ? 'rocket' : k.shot || 'arrow';
      const speed = { rocket: ROCKET_SPEED, orb: ORB_SPEED, shell: SHELL_SPEED }[shot] || ARROW_SPEED;
      const arc = { rocket: 0.02, orb: 0.08, shell: 0.3 }[shot] ?? 0.15;
      this.fire(foe, shot, dmg, speed, arc, k.splash || 0, shot === 'shell' ? 70 : 34);
    }

    fire(foe, shot, damage, speed, arc, splash, h0, ox = 0, oy = 0) {
      const x0 = this.x + ox, y0 = this.y + oy, d = G.dist(x0, y0, foe.x, foe.y);
      G.shots.push({
        shot, team: this.team, kind: this.kind, from: this, damage, splash, target: foe, tx: foe.x, ty: foe.y,
        x0, y0, h0, t: 0, dur: Math.max(0.2, d / speed), arc: d * arc, x: x0, y: y0, h: h0
      });
    }

    // Cavalry never stops: it rides at full tilt toward a point just wide of its foe, strikes as it
    // passes, rides on for a moment, then wheels round (turning no faster than RIDE_TURN) for the next pass.
    ride(foe, dt) {
      const reach = this.r + foe.r + this.attackRange;
      const dx = foe.x - this.x, dy = foe.y - this.y, d = Math.hypot(dx, dy) || 1;
      // Pinned (a rock, a wall of bodies): stop riding on and wheel away until clear.
      const from = this.rideFrom, want = this.speed * this.speedMul * dt;
      if (from && want > 0) this.stuck = G.dist(from.x, from.y, this.x, this.y) < want * 0.35 ? this.stuck + dt : 0;
      if (this.stuck > 0.1) {
        this.overrun = 0;
        this.heading += RIDE_TURN * 1.5 * dt * (this.passSide || 1);
      } else if (this.overrun > 0) this.overrun -= dt;
      else {
        // Pass on whichever side of the foe the rider is already on (picked once per pass).
        const nx = -Math.sin(this.heading), ny = Math.cos(this.heading);
        if (!this.passSide) this.passSide = dx * nx + dy * ny >= 0 ? 1 : -1;
        const wide = Math.min(foe.r + this.r + RIDE_PASS, d * 0.8);
        const ax = foe.x - nx * this.passSide * wide, ay = foe.y - ny * this.passSide * wide;
        const want = Math.atan2(ay - this.y, ax - this.x);
        const da = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
        this.heading += G.clamp(da, -RIDE_TURN * dt, RIDE_TURN * dt);
      }
      if (d - 2 <= reach && this.cd <= 0 && !this.stunned) {
        this.strike(foe);
        this.overrun = RIDE_OVERRUN;
        this.passSide = 0;
      }
      const step = this.speed * this.speedMul * dt;
      this.facing = this.heading;
      this.rideFrom = { x: this.x, y: this.y };
      if (step <= 0) return;  // stunned or rooted
      this.x += Math.cos(this.heading) * step; this.y += Math.sin(this.heading) * step;
      this.moving = true;
    }

    // War machine: the main gun lobs a shell at the healthiest hostile in range; the secondary guns
    // each pepper the nearest hostile in their (shorter) range. Fires on the move.
    fireGuns(hostiles, dt) {
      const k = SQUAD_KINDS[this.kind], gn = k.guns;
      let best = null;
      for (const e of hostiles) {
        if (e.dead || G.dist(this.x, this.y, e.x, e.y) > this.r + (e.r || 0) + this.attackRange || !G.canShoot(this.x, this.y, e)) continue;
        if (!best || e.hp > best.hp) best = e;
      }
      if (best) {
        this.aim = Math.atan2(best.y - this.y, best.x - this.x);
        const facing = this.facing;
        this.strike(best);
        this.facing = facing;  // the turret turns, not the hull
      }
      if (this.stunned) return;
      for (let i = 0; i < gn.count; i++) {
        if ((this.gunCd[i] -= dt * this.buffMul('atk')) > 0) continue;
        const foe = nearest(hostiles.filter(e => G.canShoot(this.x, this.y, e)), this.x, this.y, this.r + gn.range);
        if (!foe) { this.gunCd[i] = 0.2; continue; }
        this.gunCd[i] = gn.cooldown * (0.9 + Math.random() * 0.2);
        // Side guns sit on either flank of the hull.
        const side = i % 2 ? -1 : 1, ox = -Math.sin(this.facing) * side * this.r * 0.6, oy = Math.cos(this.facing) * side * this.r * 0.6;
        const dmg = gn.damage * G.bonusOf(this.team).troopDmg * this.buffMul('dmg') * (0.85 + Math.random() * 0.3);
        this.fire(foe, 'arrow', dmg, ARROW_SPEED, 0.1, 0, 44, ox, oy);
      }
    }
  }
  G.Soldier = Soldier;

  // Everything a squad of `team` may attack: heroes, soldiers, buildings. Never neutral beasts or burrowers.
  // While squads update, each team's list is built once per step and shared (see G.updateSquads);
  // callers skip the ones that fall meanwhile, and none may change the list.
  let hostileCache = null;
  G.hostilesOf = function (team) {
    if (hostileCache && hostileCache[team]) return hostileCache[team];
    const out = [];
    if (hostileCache) hostileCache[team] = out;
    for (const e of G.entities)
      if (!e.dead && e.team !== team && e.team !== G.TEAM.NEUTRAL && !e.invisible && !e.burrowed && !(G.dev && e instanceof G.Hero)) out.push(e);
    for (const b of G.buildingList())
      if (!b.dead && b.team !== team) out.push(b);
    return out;
  };

  function nearest(list, x, y, maxD = Infinity) {
    let best = null, bd = maxD;
    for (const t of list) {
      if (t.dead) continue;  // lists may be shared across a step in which some fall
      const d = G.dist(x, y, t.x, t.y) - (t.r || 0);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  class Squad {
    // count: soldiers in it, when not a full formation of its kind (a ram's crew).
    constructor(x, y, team, facing, kind = 'infantry', count = 0) {
      const k = SQUAD_KINDS[kind], n = count || k.cols * k.rows;
      this.team = team;
      this.kind = kind;
      this.cols = Math.min(k.cols, n); this.rows = Math.ceil(n / this.cols); this.spacing = k.spacing;
      // Ranged squads stop and shoot from range instead of closing to melee.
      this.engageRange = Math.max(ENGAGE_RANGE, k.range + 120);
      this.leash = Math.max(LEASH, k.range + 160);
      this.x = x; this.y = y;      // formation anchor (center of the block)
      this.facing = facing;
      this.role = k.role || null;
      this.prefer = k.prefer || null;
      this.target = null;
      this.think = 0;
      this.engaged = false;
      this.summoner = null;        // hero that raised this squad (summons only)
      this.lifetime = Infinity;    // seconds until a summoned squad crumbles
      this.clock = 0;
      // Messy squads (creatures): each slot sits off its place in the block and drifts about it.
      this.messy = k.messy || 0;
      this.jitter = Array.from({ length: n }, () => ({
        x: (Math.random() - 0.5) * 2 * this.messy, y: (Math.random() - 0.5) * 2 * this.messy, ph: Math.random() * 10, rate: 0.4 + Math.random() * 0.5
      }));
      this.soldiers = [];
      for (let i = 0; i < n; i++) {
        const o = this.slotPos(i);
        const s = new Soldier(o.x, o.y, team, this, kind);
        s.facing = facing;
        G.map.resolve(s);
        this.soldiers.push(s);
        G.entities.push(s);
      }
    }

    get alive() { return this.soldiers.filter(s => !s.dead); }
    // Soldiers still in formation (commanded followers are driven by the hero, not the squad).
    get formation() { return this.soldiers.filter(s => !s.dead && !s.heroFollow); }

    // World position of formation slot i: rows go back from the anchor, columns go across.
    slotPos(i) {
      const { cols, rows, spacing } = this;
      const row = Math.floor(i / cols), col = i % cols;
      let fwd = (rows - 1) / 2 * spacing - row * spacing;
      let side = (col - (cols - 1) / 2) * spacing;
      if (this.messy) {
        const j = this.jitter[i], t = this.clock * j.rate + j.ph;
        fwd += j.x + Math.sin(t) * this.messy * 0.6;
        side += j.y + Math.cos(t * 1.3) * this.messy * 0.6;
      }
      const c = Math.cos(this.facing), s = Math.sin(this.facing);
      return { x: this.x + c * fwd - s * side, y: this.y + s * fwd + c * side };
    }

    decide() {
      // Pick from the group's center so the whole squad commits to one target.
      const live = this.formation;
      const cx = live.reduce((a, s) => a + s.x, 0) / live.length;
      const cy = live.reduce((a, s) => a + s.y, 0) / live.length;
      // Ranged squads don't pick targets they can't shoot (inside a storm field).
      const k = SQUAD_KINDS[this.kind], ranged = k.range > MELEE_MAX;
      let pool = G.hostilesOf(this.team).filter(f => !ranged || G.canShoot(cx, cy, f));
      const boss = this.summoner;
      if (boss) {
        // Summons fight the nearest foe (beasts included) and never stray far from their master.
        pool = G.foesOf(this.team).filter(f => G.dist(f.x, f.y, boss.x, boss.y) < SUMMON_LEASH);
      }
      // Building-only troops never look at anything else. Burrowers tunnel under walls, so they pass
      // wall segments by while any other building stands.
      if (k.targets === 'buildings') {
        pool = pool.filter(f => !(f instanceof G.Entity));
        const solid = k.burrow ? pool.filter(f => !G.BUILDINGS[f.type].segment) : [];
        if (solid.length) pool = solid;
      }
      // Demolitionists go for buildings first and only fall back to units when none are left.
      const buildings = this.prefer === 'buildings' ? pool.filter(f => !(f instanceof G.Entity)) : [];
      this.target = nearest(buildings.length ? buildings : pool, cx, cy);
      // A target behind an enemy wall the squad can't shoot over from outside it: the wall comes first.
      const t = this.target, via = t && !k.burrow && G.steer({ x: cx, y: cy, r: live[0].r, team: this.team }, t.x, t.y);
      if (via && via.wall && (!ranged || G.dist(via.wall.x, via.wall.y, t.x, t.y) - t.r > k.range)) this.target = via.wall;
      const was = this.engaged;
      this.engaged = !!this.target && G.dist(cx, cy, this.target.x, this.target.y) - this.target.r < this.engageRange;
      if (was && !this.engaged) {
        // Snap the anchor back to the group so stragglers re-form instead of chasing a ghost.
        this.x = cx; this.y = cy;
      }
    }

    update(dt) {
      const live = this.formation;
      if (!live.length) return;
      if (this.role === 'stormspeaker') { stormspeak(this, live, dt); return; }
      if (this.role) { this.updateSupport(live[0], dt); return; }
      this.clock += dt;
      if (SQUAD_KINDS[this.kind].absorb) for (const s of live) absorb(s);
      if ((this.think -= dt) <= 0 || (this.target && this.target.dead)) { this.think = RETHINK; this.decide(); }
      const k = SQUAD_KINDS[this.kind];
      if (k.guns) {
        const hostiles = G.hostilesOf(this.team);
        for (const s of live) s.fireGuns(hostiles, dt);
      }

      if (this.engaged && this.target && !this.target.dead) {
        // Melee: each soldier fights the nearest hostile near the squad's target.
        // The candidate list is only built on a step where some soldier actually re-picks.
        // Demolitionists and building-only troops stick to the building the squad picked.
        let foes = null;
        const onlyTarget = (this.prefer === 'buildings' || k.targets === 'buildings') && !(this.target instanceof G.Entity);
        for (const s of live) {
          if (onlyTarget) s.foe = this.target;
          else if (!s.foe || s.foe.dead || Math.random() < dt * (k.charge ? 0.3 : 2)) {
            if (!foes) foes = G.hostilesOf(this.team).filter(f => G.dist(f.x, f.y, this.target.x, this.target.y) < this.leash);
            s.foe = nearest(foes, s.x, s.y) || this.target;
          }
          if (k.charge) s.ride(s.foe, dt);
          // The war machine only closes to main-gun range; fireGuns does the shooting.
          else if (k.guns) s.walk(s.foe.x, s.foe.y, s.r + s.foe.r + s.attackRange - 10, dt);
          else s.attack(s.foe, dt);
        }
      } else {
        if (!this.target && this.summoner && !this.summoner.dead) {
          // Summons with nothing to fight trail their master.
          const s = this.summoner, d = G.dist(this.x, this.y, s.x, s.y);
          if (d > 120) {
            const want = Math.atan2(s.y - this.y, s.x - this.x);
            this.facing = want;
            const step = Math.min(d - 100, live[0].speed * 1.1 * dt);
            this.x += Math.cos(want) * step; this.y += Math.sin(want) * step;
          }
        }
        if (this.target) {
          // March: turn the block toward the target and advance the anchor,
          // slowed down whenever the formation is stretched so the group stays together.
          // Walls in the way: the block makes for a gate too, so it files through instead of piling up.
          // (Burrowers go straight under.)
          const via = !k.burrow && G.steer({ x: this.x, y: this.y, r: 0, team: this.team }, this.target.x, this.target.y);
          const gx = via && !via.wall ? via.x : this.target.x, gy = via && !via.wall ? via.y : this.target.y;
          const dx = gx - this.x, dy = gy - this.y;
          const want = Math.atan2(dy, dx);
          let da = Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing));
          this.facing += G.clamp(da, -2.5 * dt, 2.5 * dt);
          let lag = 0;
          this.soldiers.forEach((s, i) => {
            if (s.dead || s.heroFollow) return;
            const o = this.slotPos(i); lag = Math.max(lag, G.dist(s.x, s.y, o.x, o.y));
          });
          const pace = G.clamp(1.1 - lag / 120, 0.15, 0.9) * (Math.abs(da) > 0.6 ? 0.4 : 1);
          const step = live[0].speed * pace * dt;
          const d = Math.hypot(dx, dy);
          if (d > 1) { this.x += (dx / d) * step; this.y += (dy / d) * step; }
        }
        this.soldiers.forEach((s, i) => {
          if (s.dead || s.heroFollow) return;
          s.foe = null;
          const o = this.slotPos(i);
          // Catch up a little faster than the anchor so the block holds shape.
          if (s.walk(o.x, o.y, 2, dt, 1.15)) s.facing = this.facing;
          if (k.charge) { s.heading = s.facing; s.overrun = 0; s.passSide = 0; s.stuck = 0; s.rideFrom = null; }  // next charge starts from here
        });
      }

    }

    // Support allies don't fight: they pick a friendly to help, walk over and help it.
    updateSupport(s, dt) {
      if (this.role === 'guardian') { guard(this, s, dt); return; }
      if ((this.think -= dt) <= 0 || (this.target && (this.target.dead || this.target.team !== this.team))) {
        this.think = RETHINK;
        this.target = this.pickSupportTarget(s);
      }
      const t = this.target;
      if (this.role === 'officer') {
        officerAura(s);
        // Staying with the troops comes first; shoot whatever wanders into range on the way.
        if (t) s.walk(t.x, t.y, OFFICER_AURA * 0.3, dt);
        officerShoot(s);
        return;
      }
      if (!t) {
        // Nothing needs help: wait by the building that trained it.
        if (this.home && !this.home.dead) s.walk(this.home.x, this.home.y, this.home.r + s.r + 40, dt);
        return;
      }
      if (this.role === 'engineer') {
        if (!s.walk(t.x, t.y, t.r + s.r + s.attackRange, dt)) return;
        s.facing = Math.atan2(t.y - s.y, t.x - s.x);
        t.hp = Math.min(t.maxHp, t.hp + ENGINEER_HEAL * dt);
        if (s.cd <= 0) { s.cd = s.attackCooldown; s.swing = 1; G.burst(t.x, t.y, '#ffd27a', 4, 90); }
        if (t.hp >= t.maxHp) this.think = 0;
        return;
      }
      // Medic: get close, then splash-heal everything friendly around the patient.
      if (t !== s && !s.walk(t.x, t.y, t.r + s.r + s.attackRange, dt)) return;
      if (t !== s) s.facing = Math.atan2(t.y - s.y, t.x - s.x);
      if (s.cd > 0) return;
      s.cd = s.attackCooldown;
      s.swing = 1;
      for (const e of G.entities) {
        if (e.dead || e.team !== this.team || e.hp >= e.maxHp || G.dist(e.x, e.y, t.x, t.y) > MEDIC_RADIUS + e.r) continue;
        const amt = Math.min(MEDIC_HEAL, e.maxHp - e.hp);
        e.hp += amt;
        G.floaters.push({ x: e.x + (Math.random() - 0.5) * 16, y: e.y - e.r, text: '+' + Math.round(amt), t: 0, color: '#9fe3a0' });
      }
      G.burst(t.x, t.y, '#9fe3a0', 30, MEDIC_RADIUS * 2.2);
      this.think = 0;
    }

    pickSupportTarget(s) {
      if (this.role === 'engineer')
        return nearest(G.buildingList().filter(b => !b.dead && b.team === this.team && b.hp < b.maxHp), s.x, s.y);
      if (this.role === 'medic')
        return nearest(G.entities.filter(e => !e.dead && e.team === this.team && e.hp < e.maxHp), s.x, s.y);
      // Officer: the nearest friendly group of regular soldiers, by the group's center.
      let best = null, bd = Infinity;
      for (const sq of G.squads) {
        if (sq.team !== this.team || sq.summoner || sq.role || SQUAD_KINDS[sq.kind].ally) continue;
        const live = sq.formation;
        if (!live.length) continue;
        const x = live.reduce((a, e) => a + e.x, 0) / live.length, y = live.reduce((a, e) => a + e.y, 0) / live.length;
        const d = G.dist(s.x, s.y, x, y);
        if (d < bd) { bd = d; best = { x, y, r: 0 }; }
      }
      return best;
    }
  }
  G.Squad = Squad;

  // ---- Special troops ----

  // Stormspeakers: each keeps within reach (s.attackRange) of a friendly group or hero, the nearest one
  // first; a second Stormspeaker covers the next nearest group when there is one close by, so their
  // shields spread out. With nobody to cover they wait by their barracks. Shields: see G.soakRanged.
  const SPREAD = G.m(20);          // a second group further off than this isn't worth splitting up for
  function stormspeak(sq, live, dt) {
    if ((sq.think -= dt) <= 0) {
      sq.think = RETHINK;
      const spots = [];
      for (const o of G.squads) {
        if (o.team !== sq.team || o.role || SQUAD_KINDS[o.kind].ally) continue;
        const m = o.formation;
        if (m.length) spots.push(centroid(m));
      }
      for (const e of G.entities) if (e instanceof G.Hero && e.team === sq.team && !e.dead) spots.push({ x: e.x, y: e.y });
      sq.spots = spots;
    }
    const spots = sq.spots || [];
    live.forEach((s, i) => {
      const byDist = spots.slice().sort((a, b) => G.dist(s.x, s.y, a.x, a.y) - G.dist(s.x, s.y, b.x, b.y));
      let t = byDist[Math.min(i, byDist.length - 1)];
      if (t && i && G.dist(s.x, s.y, t.x, t.y) > G.dist(s.x, s.y, byDist[0].x, byDist[0].y) + SPREAD) t = byDist[0];
      if (!t) {
        if (sq.home && !sq.home.dead) s.walk(sq.home.x, sq.home.y, sq.home.r + s.r + 40 + i * 50, dt);
        return;
      }
      if (s.walk(t.x, t.y, s.attackRange * 0.75, dt)) s.facing = sq.team === G.TEAM.PLAYER ? 0 : Math.PI;
    });
  }

  // The friendly storm shield over `e`, or null. Shields cover every friendly unit and hero within
  // their radius, Stormspeakers included.
  G.wardOver = function (e) {
    for (const s of wards)
      if (s.team === e.team && !s.dead && s.ward > 0 && G.dist(s.x, s.y, e.x, e.y) <= SQUAD_KINDS[s.kind].ward.r) return s;
    return null;
  };
  // A ranged attack about to hurt `e` for `amount`: a storm shield over it takes the whole hit (one
  // that breaks the shield included). Returns the damage that gets through.
  G.soakRanged = function (e, amount) {
    const s = G.wardOver(e);
    if (!s) return amount;
    s.ward -= amount;
    G.floaters.push({ x: e.x, y: e.y - e.r, text: '◈', t: 0, color: '#bfd8ff' });
    if (s.ward <= 0) {
      const w = SQUAD_KINDS[s.kind].ward;
      s.ward = 0; s.wardT = w.regrow;
      G.burst(s.x, s.y, '#bfd8ff', 40, w.r * 1.6, 120);
      G.floaters.push({ x: s.x, y: s.y - 40, text: 'Shield broken', t: 0, color: '#bfd8ff' });
    }
    return 0;
  };

  // Icespeaker hit by `who` (a soldier, hero or building; none for an unclaimed hit): a share of the
  // damage bounces back at a soldier or hero, and whoever struck it is chilled to a slower attack.
  function iceBite(s, k, dealt, who) {
    if (!who || who.dead || who.team === s.team) return;
    if (who instanceof G.Entity) {
      if (k.reflect && dealt > 0) who.takeDamage(dealt * k.reflect, { reflect: true, color: '#9fdcff' });
      if (k.chill) { G.addBuff(who, 'cold', k.chill.dur, { atk: k.chill.atk }); G.mark(who, 'cold', k.chill.dur); }
    } else if (k.chill) {
      who.cold = Math.max(who.cold || 0, k.chill.dur); who.coldAtk = k.chill.atk;   // towers reload slower (see towers.js)
    }
    if (Math.random() < 0.3) G.burst(who.x, who.y, '#bfefff', 6, 90);
  }

  // Clawcrusher's shell gives way: it gets faster and starts fighting.
  function crack(s) {
    s.carapace = 0;
    s.speed = SQUAD_KINDS[s.kind].carapace.speed;
    G.burst(s.x, s.y, '#2a6a7a', 24, 200); G.burst(s.x, s.y, '#ff6a40', 12, 140);
    G.floaters.push({ x: s.x, y: s.y - 40, text: 'Enraged!', t: 0, color: '#ff8a60' });
  }
  // Clawcrusher strike: the claw sweeps everything hostile within its reach.
  function crush(s, dmg) {
    for (const e of G.hostilesOf(s.team))
      if (!e.dead && G.dist(s.x, s.y, e.x, e.y) <= s.r + (e.r || 0) + s.attackRange + 4) e.takeDamage(dmg * G.kindMul(s.kind, e), { unit: true, by: s });
    G.addFx('ring', { x: s.x, y: s.y, r0: s.r, r1: s.r + s.attackRange + 20, dur: 0.3, color: 0xff8a60 });
  }

  // Ruined Machine: bursts apart, hurting everything hostile close by.
  function blast(s, b) {
    G.addFx('ring', { x: s.x, y: s.y, r0: 8, r1: b.r, dur: 0.35, color: 0xffa040 });
    G.burst(s.x, s.y, '#ffb040', 26, 260); G.burst(s.x, s.y, '#5a5450', 14, 160);
    for (const e of G.foesInRadius(s.team, s.x, s.y, b.r)) e.takeDamage(b.damage * G.bonusOf(s.team).troopDmg, { unit: true, by: s, blast: true });
  }

  // Battering Ram: breaks apart, leaving its crew to fight on as a squad of their own. The barracks
  // waits for them as it would for the ram.
  function wreck(s, w) {
    const sq = new Squad(s.x, s.y, s.team, s.facing, w.kind, w.count);
    sq.home = s.squad.home;
    if (sq.home && sq.home.squad === s.squad) sq.home.squad = sq;
    sq.think = 0;
    G.squads.push(sq);
    G.addFx('ramWreck', { x: s.x, y: s.y, angle: s.facing, team: s.team, dur: 6 });
    G.burst(s.x, s.y, '#6a4a2a', 30, 220);
  }

  // Wavethrower: a wall of water rolls out along the line to its foe, hurting and washing back every
  // hostile it reaches (each once). Buildings take the hit but don't move. It counts as a ranged attack:
  // a storm field or storm shield stops it, and the shove with it.
  function surge(s, foe, dmg, w) {
    const a = Math.atan2(foe.y - s.y, foe.x - s.x), team = s.team, kind = s.kind;
    const x0 = s.x + Math.cos(a) * s.r, y0 = s.y + Math.sin(a) * s.r;
    G.addFx('surge', { x0, y0, x: x0, y: y0, angle: a, width: w.width, len: w.len, speed: w.speed, dur: w.len / w.speed + 0.4, team, hit: new Set(),
      tick(o) {
        const c = Math.cos(o.angle), sn = Math.sin(o.angle), front = o.t * o.speed;
        if (front > o.len) return;
        o.x = o.x0 + c * front; o.y = o.y0 + sn * front;
        for (const e of G.hostilesOf(team)) {
          if (e.dead || e.untargetable || o.hit.has(e)) continue;
          const rx = e.x - o.x0, ry = e.y - o.y0, along = rx * c + ry * sn, side = -rx * sn + ry * c, r = e.r || 0;
          if (along < front - 40 - r || along > front + r || Math.abs(side) > o.width / 2 + r) continue;
          o.hit.add(e);
          if (!G.canShoot(o.x0, o.y0, e)) continue;
          const shielded = e instanceof G.Entity && G.wardOver(e);
          G.asRanged(() => e.takeDamage(dmg * G.kindMul(kind, e), { unit: true, by: s }));
          if (!shielded && e instanceof G.Entity && !e.dead && !(e instanceof G.Hero && e.dash)) G.push(e, o.angle, w.push, 0.35);
        }
      } });
  }

  // Burrowing Blade: underground (untouchable, under walls, out of every list of targets) until within
  // `surface` of the building it goes for, then it pops up to attack it. Once that building is far off
  // again (it fell), it digs back in, standing still for DIG_TIME first.
  function burrowStep(s, b, dt) {
    if (s.digIn > 0) {
      s.untargetable = false;
      if (Math.random() < dt * 20) G.particles.push({ x: s.x + (Math.random() - 0.5) * 20, y: s.y + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120, life: 0.5, t: 0, color: '#6a5438', size: 4 });
      if ((s.digIn -= dt) <= 0) { s.digIn = 0; s.burrowed = s.untargetable = true; s.knock = null; }
      return;
    }
    const sqT = s.squad && !s.heroFollow && s.squad.target;
    const t = sqT && !(sqT instanceof G.Entity) && !sqT.dead ? sqT : nearestBuilding(s);
    const gap = t ? G.dist(s.x, s.y, t.x, t.y) - t.r - s.r : Infinity;
    if (s.burrowed && gap <= b.surface) {
      s.burrowed = s.untargetable = false;
      s.cd = Math.max(s.cd, SURFACE_PAUSE);
      G.burst(s.x, s.y, '#6a5438', 22, 200); G.burst(s.x, s.y, '#c9d2da', 8, 120);
    } else if (!s.burrowed && gap > b.surface * REBURROW) s.digIn = DIG_TIME;
  }
  function nearestBuilding(s) {
    const list = G.hostilesOf(s.team).filter(f => !(f instanceof G.Entity) && !G.BUILDINGS[f.type].segment);
    return nearest(list, s.x, s.y);
  }

  // Bone Ball: each friendly skeleton whose body comes within reach is rolled up into it, raising the
  // ball's max health (up to a cap) and healing it. Its hits scale with its health (see hpDamage).
  function absorb(ball) {
    const a = SQUAD_KINDS[ball.kind].absorb;
    for (const e of G.entities) {
      if (!(e instanceof Soldier) || e.dead || e.team !== ball.team || !a.kinds.includes(e.kind)) continue;
      if (G.dist(e.x, e.y, ball.x, ball.y) - e.r - ball.r > a.reach) continue;
      e.hp = 0; e.dead = true;  // swallowed whole: no death of its own (it isn't one)
      ball.maxHp = Math.min(a.maxHp, ball.maxHp + a.hp); ball.hp = Math.min(ball.maxHp, ball.hp + a.hp);
      G.burst(e.x, e.y, '#cfeed8', 16, 160);
      G.floaters.push({ x: ball.x, y: ball.y - ball.r, text: '+' + a.hp, t: 0, color: '#9fe3a0' });
    }
  }

  // Charlie: keep pace with the hero about GUARD_DIST away, between her and the nearest hostile unit.
  // With nobody around he holds his bearing from her. He falls with her (she brings him back).
  function guard(sq, s, dt) {
    const h = sq.summoner;
    if (!h || h.dead) { s.hp = 0; s.die(); return; }
    s.speed = h.speed * h.buffMul('speed');
    s.hp = Math.min(s.maxHp, s.hp + GUARD_REGEN * dt);
    const foe = nearest(G.hostilesOf(s.team).filter(e => e instanceof G.Entity), h.x, h.y, GUARD_WATCH);
    const now = Math.atan2(s.y - h.y, s.x - h.x);
    let a = now, d = GUARD_DIST;
    if (foe) {
      // Circle round her toward the foe's side (never through her), a bit at a time.
      const want = Math.atan2(foe.y - h.y, foe.x - h.x), turn = Math.atan2(Math.sin(want - now), Math.cos(want - now));
      a = now + G.clamp(turn, -0.8, 0.8);
      // A foe already closer than that: stand halfway, right in its way.
      d = Math.min(GUARD_DIST, Math.max(h.r + s.r + 4, (G.dist(h.x, h.y, foe.x, foe.y) - foe.r) / 2));
      if (Math.abs(turn) > 0.8) d = Math.max(d, h.r + s.r + 30);
    }
    if (s.walk(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, 6, dt)) s.facing = foe ? a : h.facing;
  }

  // Boost every friendly soldier in the officer's aura, wherever the officer happens to be.
  function officerAura(s) {
    s.auraOn = false;
    for (const e of G.entities)
      if (e instanceof Soldier && e !== s && !e.dead && e.team === s.team &&
        G.dist(e.x, e.y, s.x, s.y) <= OFFICER_AURA + e.r) { e.haste = 0.25; s.auraOn = true; }
  }

  // Officer sidearm: fire at the nearest hostile already in range, without chasing it.
  function officerShoot(s) {
    // Range first: the storm-field test is the costly part, and only a few hostiles are ever in reach.
    let foe = null, bd = s.attackRange + s.r;
    for (const f of G.hostilesOf(s.team)) {
      if (f.dead) continue;
      const d = G.dist(s.x, s.y, f.x, f.y) - (f.r || 0);
      if (d < bd && G.canShoot(s.x, s.y, f)) { bd = d; foe = f; }
    }
    if (!foe) return;
    const facing = s.facing;
    s.strike(foe);
    if (s.moving) s.facing = facing;  // keep looking where it's walking
  }

  // Hero command. A hero can hold any number of groups at once (a group is one squad's soldiers,
  // however far they have strayed). Every soldier under command is in hero.followers with its own
  // order in s.cmd:
  //   follow (F):  walk in a block about the hero, swinging at whatever comes within reach.
  //   guard (2):   hold a spot in formation. Melee fights units that come within GUARD_REACH of its
  //                spot, then goes back to it; ranged stands fast and shoots anything in range.
  //   alert (3):   hold a spot in formation until a unit comes in range (melee: within GUARD_REACH)
  //                or it is hit: then it goes back to its squad.
  //   charge (4):  form up, then march straight for the enemy's side of the map, stopping only for
  //                hostiles in the way (ranged: one in its path and in range). Shoots on the move.
  // Cancel (1) hands every one of them back to its squad.
  G.COMMAND_ORDERS = ['cancel', 'guard', 'alert', 'charge'];
  const ORDER_TEXT = { guard: 'Guard', alert: 'Alert', charge: 'Charge!' };
  const centroid = list => ({ x: list.reduce((a, s) => a + s.x, 0) / list.length, y: list.reduce((a, s) => a + s.y, 0) / list.length });
  const shout = (hero, text) => G.floaters.push({ x: hero.x, y: hero.y - hero.r - 30, text, t: 0, color: '#9fe3a0' });
  // The hero's soldiers still standing (a group another hero has called away is no longer his).
  const commanded = hero => (hero.followers = (hero.followers || []).filter(s => !s.dead && s.heroFollow && s.commander === hero));
  const following = (s, hero) => s.commander === hero && s.cmd === 'follow';

  // F: the nearest group with a soldier within COMMAND_RADIUS of the hero joins the ones already
  // following him. A group of his under another order (or another hero's) is called back too.
  G.commandFollow = function (hero) {
    const mine = commanded(hero);
    const near = G.entities.filter(e => e instanceof Soldier && !e.dead && e.team === hero.team && e.squad.role !== 'guardian' &&
      !following(e, hero) && G.dist(e.x, e.y, hero.x, hero.y) < COMMAND_RADIUS);
    if (!near.length) return false;
    const group = nearest(near, hero.x, hero.y).squad.alive.filter(s => !following(s, hero));
    for (const s of group) {
      s.heroFollow = true; s.commander = hero; s.cmd = 'follow';
      s.foe = null; s.post = null; s.cmdGroup = null;
    }
    hero.followers = mine.filter(s => !group.includes(s)).concat(group);
    // Every follower gets a place in one block about the hero, nearest soldiers first.
    const list = hero.followers.filter(s => s.cmd === 'follow');
    list.sort((a, b) => G.dist(a.x, a.y, hero.x, hero.y) - G.dist(b.x, b.y, hero.x, hero.y));
    followSlots(hero, list);
    shout(hero, 'Follow');
    return true;
  };

  // Rows of up to FOLLOW_COLS, spaced for the widest body in each row (like formUp), centered on the
  // hero. A row level with the hero parts around him: he holds his ground, so a soldier given a spot
  // inside him would be shoved off it and walk back every step.
  function followSlots(hero, list) {
    const rows = [];
    for (let i = 0; i < list.length; i += FOLLOW_COLS) rows.push(list.slice(i, i + FOLLOW_COLS));
    const gaps = rows.map(row => Math.max(FOLLOW_SPACING, Math.max(...row.map(s => s.r)) * 2 + 6));
    const ys = [];
    let y = 0;
    rows.forEach((row, i) => { if (i) y += (gaps[i - 1] + gaps[i]) / 2; ys.push(y); });
    rows.forEach((row, i) => {
      const oy = ys[i] - y / 2, gap = gaps[i], n = row.length;
      const clear = hero.r + (gap - 6) / 2 + 4;   // center-to-center room past the hero
      const parts = Math.abs(oy) < clear;
      row.forEach((s, j) => {
        let ox = (j - (n - 1) / 2) * gap;
        if (parts) {
          // Alternate right and left of the hero, outward from his edge.
          const k = Math.floor(j / 2);
          ox = (j % 2 ? -1 : 1) * (Math.sqrt(Math.max(0, clear * clear - oy * oy)) + k * gap);
        }
        s.followOffset = { x: ox, y: oy };
      });
    });
  }

  // 1-4: an order for every soldier under the hero's command. False when there is nobody to give it to.
  G.commandOrder = function (hero, order) {
    const list = commanded(hero);
    if (!list.length || !G.COMMAND_ORDERS.includes(order)) return false;
    if (order === 'cancel') { releaseFollowers(hero); shout(hero, 'Dismissed'); return true; }
    for (const block of blocks(list)) formUp(block, hero.team, order);
    shout(hero, ORDER_TEXT[order]);
    return true;
  };

  // Groups standing within FORM_CLUSTER of each other form up together; one far off forms where it is.
  function blocks(list) {
    const bySquad = new Map();
    for (const s of list) { if (!bySquad.has(s.squad)) bySquad.set(s.squad, []); bySquad.get(s.squad).push(s); }
    const out = [];
    for (const g of bySquad.values()) {
      const c = centroid(g), b = out.find(o => G.dist(o.x, o.y, c.x, c.y) < FORM_CLUSTER);
      if (b) { b.members.push(...g); Object.assign(b, centroid(b.members)); } else out.push({ members: g, ...c });
    }
    return out.map(b => b.members);
  }

  // Line a block up where it stands, facing the enemy's side: fighters up front, then shooters, then
  // support allies. Rows hold up to FORM_COLS soldiers, spaced for the widest body in the row.
  function formUp(members, team, order) {
    const dir = team === G.TEAM.PLAYER ? 1 : -1, c = centroid(members);
    const rank = s => (s.squad.role ? 2 : s.ranged ? 1 : 0);
    const rows = [];
    for (let r = 0; r <= 2; r++) {
      const tier = members.filter(s => rank(s) === r).sort((a, b) => (b.x - a.x) * dir);  // frontmost first
      for (let i = 0; i < tier.length; i += FORM_COLS) rows.push(tier.slice(i, i + FORM_COLS).sort((a, b) => a.y - b.y));
    }
    const gaps = rows.map(row => Math.max(...row.map(s => s.r)) * 2 + FORM_GAP);
    let back = 0;
    const at = rows.map((row, i) => (i ? (back -= (gaps[i - 1] + gaps[i]) / 2) : 0));
    const group = { t: 0, formed: false, pace: Math.min(...members.map(s => s.speed)) };
    rows.forEach((row, i) => row.forEach((s, j) => {
      const p = { x: c.x + dir * (at[i] - back / 2), y: c.y + (j - (row.length - 1) / 2) * gaps[i], r: s.r, team };
      G.map.resolve(p);  // never a spot inside a rock or building
      s.post = { x: p.x, y: p.y }; s.cmd = order; s.foe = null; s.cmdHp = s.hp;
      s.cmdGroup = order === 'charge' ? group : null;
    }));
  }

  // Released soldiers stay where they stand: each affected squad re-anchors on its members'
  // current centroid and re-decides at once, so it picks a fresh target from there.
  function releaseFollowers(hero, list = hero.followers || []) {
    const squads = new Set();
    for (const s of list) {
      if (s.commander !== hero) continue;
      s.heroFollow = false; s.commander = null; s.cmd = null; s.post = null; s.cmdGroup = null; s.foe = null;
      if (s.squad) squads.add(s.squad);
    }
    hero.followers = (hero.followers || []).filter(s => s.heroFollow && s.commander === hero);
    for (const sq of squads) {
      const live = sq.formation;
      if (!live.length) continue;
      Object.assign(sq, centroid(live));
      sq.target = null;
      sq.engaged = false;
      sq.think = 0;
    }
  }
  G.releaseFollowers = releaseFollowers;

  function updateFollowers(dt) {
    for (const hero of G.entities) if (hero instanceof G.Hero && hero.followers) followHero(hero, dt);
  }

  // Cooldowns, swings and the moving flag tick in Soldier.update; here each soldier carries out its order.
  function followHero(hero, dt) {
    // A fallen hero's followers lose their lead; soldiers holding a spot or charging carry on.
    if (hero.dead) releaseFollowers(hero, hero.followers.filter(s => s.cmd === 'follow'));
    const list = commanded(hero);
    if (!list.length) return;
    // Hostiles are looked up once for the whole command this step, and only if somebody asks.
    // foes(s): what that soldier may fight (building-only troops: buildings).
    let all = null, units = null, buildings = null;
    const ctx = {
      dir: hero.team === G.TEAM.PLAYER ? 1 : -1, dt,
      all: () => all || (all = G.hostilesOf(hero.team)),
      units: () => units || (units = ctx.all().filter(e => e instanceof G.Entity)),
      buildings: () => buildings || (buildings = ctx.all().filter(e => !(e instanceof G.Entity))),
      foes: s => (SQUAD_KINDS[s.kind].targets === 'buildings' ? ctx.buildings() : ctx.all())
    };
    // A charging block sets off once every soldier is in place (or it has waited long enough).
    for (const g of new Set(list.map(s => s.cmdGroup).filter(Boolean))) {
      g.t += dt;
      if (!g.formed) g.formed = g.t > FORM_TIME || list.every(s => s.cmdGroup !== g || G.dist(s.x, s.y, s.post.x, s.post.y) < 12);
    }
    const done = [];
    for (const s of list) {
      if (s.squad.role === 'officer') officerAura(s);
      if (ORDERS[s.cmd](s, hero, ctx)) done.push(s);
    }
    if (!done.length) return;
    // Alert broken: one "!" over each squad that goes back to fighting.
    for (const sq of new Set(done.map(s => s.squad))) {
      const s = done.find(e => e.squad === sq);
      G.floaters.push({ x: s.x, y: s.y - s.r - 24, text: '!', t: 0, color: '#ffd27a' });
    }
    releaseFollowers(hero, done);
  }

  // Each returns true when the soldier is done with its order and goes back to its squad.
  const ORDERS = {
    follow(s, hero, ctx) {
      // Following comes first: keep walking to the spot in line with the hero, never faster than baseline.
      // A spot inside a rock or building can't be reached: aim for the nearest free place by it.
      const p = { x: hero.x + s.followOffset.x, y: hero.y + s.followOffset.y, r: s.r, team: s.team };
      G.map.resolve(p);
      s.walk(p.x, p.y, 2, ctx.dt);
      fireAtWill(s, ctx);
    },
    guard(s, hero, ctx) {
      const p = s.post;
      if (!s.ranged && !s.squad.role) {
        // Melee: take on units that come near its spot (building-only troops: buildings); let one go
        // once it has left the spot well behind.
        if (s.foe && (s.foe.dead || G.dist(s.foe.x, s.foe.y, p.x, p.y) - s.foe.r > GUARD_REACH * 1.25)) s.foe = null;
        if (!s.foe) s.foe = nearest(SQUAD_KINDS[s.kind].targets === 'buildings' ? ctx.buildings() : ctx.units(), p.x, p.y, GUARD_REACH);
        if (s.foe) { s.attack(s.foe, ctx.dt); return; }
      }
      hold(s, ctx);
      fireAtWill(s, ctx);
    },
    alert(s, hero, ctx) {
      const hit = s.hp < s.cmdHp - 0.01;
      s.cmdHp = s.hp;
      if (hit || nearest(ctx.units(), s.x, s.y, s.ranged ? s.attackRange + s.r : GUARD_REACH)) return true;
      hold(s, ctx);
    },
    charge(s, hero, ctx) {
      const { dir, dt } = ctx, p = s.post;
      if (!s.cmdGroup.formed) { s.walk(p.x, p.y, 2, dt, 1.15); fireAtWill(s, ctx); return; }
      // In the way: the nearest hostile ahead along its line, close by (melee) or in range (ranged).
      const melee = !s.ranged, reach = melee ? s.attackRange + BLOCK_AHEAD : s.attackRange;
      let block = null, bd = Infinity;
      for (const e of ctx.foes(s)) {
        if (e.dead || (e.x - s.x) * dir <= 0 || Math.abs(e.y - s.y) > e.r + s.r + BLOCK_LANE) continue;
        const d = G.dist(s.x, s.y, e.x, e.y) - e.r - s.r;
        if (d <= reach && d < bd) { block = e; bd = d; }
      }
      // ...or an unbroken enemy wall across the way.
      if (!block) {
        const via = G.steer(s, s.x + dir * 400, p.y), w = via && via.wall;
        if (w && G.dist(s.x, s.y, w.x, w.y) - w.r - s.r <= reach) block = w;
      }
      if (block) {
        p.x = s.x;  // the line moves on from wherever the fight leaves it
        if (melee && !s.squad.role) s.attack(block, dt);
        else fireAtWill(s, ctx);
        return;
      }
      // Clear way: the spot moves on at the block's pace, waiting for a soldier that has fallen behind.
      // A spot moving into a rock or building skips to its far side, so the soldier goes round it.
      if (G.dist(s.x, s.y, p.x, p.y) < 40) {
        p.x += dir * s.cmdGroup.pace * dt;
        for (let i = 0; i < 40 && G.map.hitsRock(p.x, p.y, s.r, s.team); i++) p.x += dir * 10;
        p.x = G.clamp(p.x, s.r, G.map.w - s.r);
      }
      s.walk(p.x, p.y, 2, dt, 1.15);
      fireAtWill(s, ctx);
    }
  };

  // Stand at its spot in the formation, facing the enemy's side.
  // (Nudged a little off it by the crowd, it steps back but keeps facing front.)
  function hold(s, ctx) {
    s.walk(s.post.x, s.post.y, 2, ctx.dt);
    if (G.dist(s.x, s.y, s.post.x, s.post.y) < 8) s.facing = ctx.dir > 0 ? 0 : Math.PI;
  }

  // Fight from where it stands: swing or shoot at the nearest hostile already within reach.
  // Support allies don't fight (an officer's sidearm aside); a war machine works all its guns.
  function fireAtWill(s, ctx) {
    const role = s.squad.role;
    if (role) { if (role === 'officer') officerShoot(s); return; }
    if (SQUAD_KINDS[s.kind].guns) { s.fireGuns(ctx.all(), ctx.dt); return; }
    const foe = nearest(ctx.foes(s), s.x, s.y, s.attackRange + s.r);
    if (foe) s.strike(foe);
  }

  // Called once per update step: tick barracks spawn timers, run squads, clear out the fallen.
  G.updateSquads = function (dt) {
    updateFollowers(dt);
    for (const b of G.buildingList()) {
      const kind = G.BUILDINGS[b.type].squad;
      if (!kind || b.dead) continue;
      if (b.spawnTimer === undefined) b.spawnTimer = 0;  // first squad as soon as it's built
      b.spawnTimer = Math.max(0, b.spawnTimer - dt);
      // One squad at a time: wait until the last one is wiped out.
      if (b.spawnTimer > 0 || (b.squad && b.squad.alive.length)) continue;
      b.spawnTimer = SPAWN_INTERVAL;
      const dir = b.team === G.TEAM.PLAYER ? 1 : -1;
      // Troops pour out of the barracks itself (pushed to its walls), facing the enemy side.
      const sq = new Squad(b.x, b.y, b.team, dir > 0 ? 0 : Math.PI, kind);
      sq.home = b;
      b.squad = sq;
      G.squads.push(sq);
      G.burst(b.x, b.y, '#ffffff', 20, 160);
    }
    hostileCache = {};
    for (const sq of G.squads) {
      if (sq.summoner && (sq.lifetime -= dt) <= 0) {
        for (const s of sq.alive) { s.hp = 0; s.die(); }
        continue;
      }
      sq.update(dt);
    }
    hostileCache = null;
    // Bodies don't overlap: soldiers push apart from each other (both teams) and from heroes/beasts,
    // then out of rocks and buildings. Sweep along x: with bodies sorted by x, each one only meets the
    // few that follow it within reach, instead of every other body on the map. Burrowers pass beneath.
    const bodies = G.entities.filter(e => !e.dead && !e.burrowed).sort((a, b) => a.x - b.x);
    let maxR = 0;
    for (const e of bodies) if (e.r > maxR) maxR = e.r;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i], reach = a.r + maxR + 2;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (b.x - a.x >= reach) break;
        const sa = a instanceof Soldier, sb = b instanceof Soldier;
        if (!sa && !sb) continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r + 2;
        if (dx >= min || dx <= -min || dy >= min || dy <= -min) continue;  // cheap reject before the sqrt
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 0.001) continue;
        // Only soldiers get shoved; a hero or beast holds its ground.
        // Heavier soldiers (cavalry, war machines) shove lighter ones aside.
        const ka = sa ? (sb ? b.mass / (a.mass + b.mass) : 1) : 0, kb = 1 - ka, push = min - d;
        a.x -= dx / d * push * ka; a.y -= dy / d * push * ka;
        b.x += dx / d * push * kb; b.y += dy / d * push * kb;
      }
    }
    for (const e of G.entities) if (e instanceof Soldier && !e.dead) G.map.resolve(e);
    G.squads = G.squads.filter(sq => sq.alive.length);
    G.entities = G.entities.filter(e => !(e instanceof Soldier && e.dead));
    wards = G.entities.filter(e => e.ward > 0);
  };
})(window.Game);
