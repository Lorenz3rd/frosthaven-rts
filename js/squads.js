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
    // Allies: a single unit, 1.5x the size of a soldier. `role` gives support allies their own brain
    // (see Squad.updateSupport); `prefer: 'buildings'` makes a fighter pick buildings before anything else.
    engineer: { name: 'Engineer', bounty: 12, ally: true, role: 'engineer', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 200, damage: 0, range: 20, cooldown: 0.5, speed: INFANTRY_SPEED },
    medic: { name: 'Medic', bounty: 14, ally: true, role: 'medic', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 80, damage: 0, range: 250, cooldown: 1.5, speed: INFANTRY_SPEED },
    officer: { name: 'Officer', bounty: 16, ally: true, role: 'officer', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 150, damage: 2, range: 300, cooldown: 0.75, speed: INFANTRY_SPEED },
    demolitionist: { name: 'Demolitionist', bounty: 18, ally: true, prefer: 'buildings', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 70, damage: 80, range: 1000, cooldown: 2.0, speed: INFANTRY_SPEED },
    // Summons: raised by heroes (see heroes.js), never trained. They follow their summoner, drop no gold
    // and crumble when their time runs out. cleave: melee hits splash this radius.
    skeleton: { bounty: 0, summon: true, cols: 3, rows: 1, spacing: 40, r: 12, hp: 70, damage: 15, range: 14, cooldown: 1.5, speed: 80 },
    skeletonSolo: { bounty: 0, summon: true, cols: 1, rows: 1, spacing: 0, r: 12, hp: 70, damage: 15, range: 14, cooldown: 1.5, speed: 80 },
    colossus: { bounty: 0, summon: true, cols: 1, rows: 1, spacing: 0, r: 30, hp: 750, damage: 42, range: 26, cooldown: 1.6, speed: 95, cleave: 70, barH: 190 }
  };
  // Cavalry handling: how fast a rider can turn (rad/s), how long it rides on after a strike before
  // wheeling round, and how wide of its foe it aims so it rides past instead of into it.
  const RIDE_TURN = 1.7, RIDE_OVERRUN = 1.1, RIDE_PASS = 14;
  const ENGINEER_HEAL = 20;        // building hp per second
  const MEDIC_HEAL = 15;          // hp per splash, every `cooldown` seconds
  const MEDIC_RADIUS = 75;         // ~3/4 of the area an infantry block covers (4x3 at 44 spacing)
  const OFFICER_AURA = 250;       // 5 m
  const OFFICER_HASTE = 1.3;       // attack speed multiplier inside the aura
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
  const COMMAND_MIN = 3;           // a group needs at least this many soldiers to take the command
  const FOLLOW_COLS = 5, FOLLOW_SPACING = 34;
  const SUMMON_LEASH = 900;        // summons only fight foes this close to their summoner

  G.squads = [];
  // Soldiers following a hero (one group per hero at a time) live in hero.followers.

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
      this.cd = Math.random() * 0.5;
      this.swing = 0;              // 1 -> 0 over an attack animation
      this.facing = 0;
      this.moving = false;
      this.foe = null;             // individual target while engaged
      this.heroFollow = false;     // commanded by the hero: leaves the squad and follows him
      this.followOffset = { x: 0, y: 0 };
      this.haste = 0;              // seconds left of an officer's attack speed boost
      this.auraOn = false;         // officer: aura is touching a friendly soldier
    }
    // Attack cooldown recovers faster under an officer's aura.
    tickCooldown(dt) {
      this.cd = Math.max(0, this.cd - dt * (this.haste > 0 ? OFFICER_HASTE : 1) * this.buffMul('atk'));
      this.haste = Math.max(0, this.haste - dt);
    }
    die(src) {
      super.die(src);
      G.burst(this.x, this.y, SQUAD_KINDS[this.kind].summon ? '#cfe8d0' : '#a33a2a', 10, 120);
      G.dropCoins(this.x, this.y, SQUAD_KINDS[this.kind].bounty);
    }

    // Step toward (tx, ty), stopping `stop` short. Returns true when arrived.
    walk(tx, ty, stop, dt, speedMul = 1) {
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
      if (d <= stop) return true;
      const step = Math.min(d - stop, this.speed * this.speedMul * speedMul * dt);
      if (step <= 0) return false;  // stunned or rooted
      this.facing = Math.atan2(dy, dx);
      this.x += (dx / d) * step; this.y += (dy / d) * step;
      this.moving = true;
      return false;
    }

    update(dt) {
      super.update(dt);
      if (this.dead) return;
      this.tickCooldown(dt);
      this.swing = Math.max(0, this.swing - dt * 2.5);
      this.moving = false;
      // Movement and attacks are driven by the squad (see Squad.update).
    }

    attack(foe, dt) {
      const reach = this.r + foe.r + this.attackRange;
      if (!this.walk(foe.x, foe.y, reach - 2, dt)) return;
      this.strike(foe);
    }

    // Swing or loose a shot at `foe` if it is in reach and the cooldown is ready.
    strike(foe) {
      this.facing = Math.atan2(foe.y - this.y, foe.x - this.x);
      if (this.cd > 0 || this.stunned) return;
      if (this.ranged && !G.canShoot(this.x, this.y, foe)) return;  // blocked by a storm field
      this.cd = this.attackCooldown * (0.9 + Math.random() * 0.2);
      this.swing = 1;
      const dmg = this.damage * this.buffMul('dmg') * (0.85 + Math.random() * 0.3);
      if (!this.ranged) {
        foe.takeDamage(dmg * G.kindMul(this.kind, foe));
        if (this.cleave) {
          for (const e of G.foesInRadius(this.team, foe.x, foe.y, this.cleave))
            if (e !== foe) e.takeDamage(dmg * 0.6);
          G.addFx('ring', { x: foe.x, y: foe.y, r0: 10, r1: this.cleave, dur: 0.35, color: 0xcfe8d0 });
        }
        return;
      }
      // Loose a shot on the tower shot system: it homes on the foe and hits on arrival (strengths and
      // splash are applied there, see towers.js). Demolitionists fire rockets: faster and nearly flat.
      // Casters hurl slow orbs; a war machine lobs heavy shells.
      const k = SQUAD_KINDS[this.kind];
      const shot = this.kind === 'demolitionist' ? 'rocket' : k.shot || 'arrow';
      const speed = { rocket: ROCKET_SPEED, orb: ORB_SPEED, shell: SHELL_SPEED }[shot] || ARROW_SPEED;
      const arc = { rocket: 0.02, orb: 0.08, shell: 0.3 }[shot] ?? 0.15;
      this.fire(foe, shot, dmg, speed, arc, k.splash || 0, shot === 'shell' ? 70 : 34);
    }

    fire(foe, shot, damage, speed, arc, splash, h0, ox = 0, oy = 0) {
      const x0 = this.x + ox, y0 = this.y + oy, d = G.dist(x0, y0, foe.x, foe.y);
      G.shots.push({
        shot, team: this.team, kind: this.kind, damage, splash, target: foe, tx: foe.x, ty: foe.y,
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
        if ((this.gunCd[i] -= dt) > 0) continue;
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

  // Everything a squad of `team` may attack: heroes, soldiers, buildings. Never neutral beasts.
  G.hostilesOf = function (team) {
    const out = [];
    for (const e of G.entities)
      if (!e.dead && e.team !== team && e.team !== G.TEAM.NEUTRAL && !(G.dev && e instanceof G.Hero)) out.push(e);
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
    constructor(x, y, team, facing, kind = 'infantry') {
      const k = SQUAD_KINDS[kind];
      this.team = team;
      this.kind = kind;
      this.cols = k.cols; this.rows = k.rows; this.spacing = k.spacing;
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
      this.jitter = Array.from({ length: k.cols * k.rows }, () => ({
        x: (Math.random() - 0.5) * 2 * this.messy, y: (Math.random() - 0.5) * 2 * this.messy, ph: Math.random() * 10, rate: 0.4 + Math.random() * 0.5
      }));
      this.soldiers = [];
      for (let i = 0; i < this.cols * this.rows; i++) {
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
      const ranged = SQUAD_KINDS[this.kind].range > MELEE_MAX;
      let pool = G.hostilesOf(this.team).filter(f => !ranged || G.canShoot(cx, cy, f));
      const boss = this.summoner;
      if (boss) {
        // Summons fight what their master fights (beasts included) and never stray far from them.
        pool = G.foesOf(this.team).filter(f => G.dist(f.x, f.y, boss.x, boss.y) < SUMMON_LEASH);
        const focus = boss.attackTarget;
        if (focus && !focus.dead && pool.includes(focus)) pool = [focus];
      }
      // Demolitionists go for buildings first and only fall back to units when none are left.
      const buildings = this.prefer === 'buildings' ? pool.filter(f => !(f instanceof G.Entity)) : [];
      this.target = nearest(buildings.length ? buildings : pool, cx, cy);
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
      if (this.role) { this.updateSupport(live[0], dt); return; }
      this.clock += dt;
      if ((this.think -= dt) <= 0 || (this.target && this.target.dead)) { this.think = RETHINK; this.decide(); }
      const k = SQUAD_KINDS[this.kind];
      if (k.guns) {
        const hostiles = G.hostilesOf(this.team);
        for (const s of live) s.fireGuns(hostiles, dt);
      }

      if (this.engaged && this.target && !this.target.dead) {
        // Melee: each soldier fights the nearest hostile near the squad's target.
        // The candidate list is only built on a step where some soldier actually re-picks.
        let foes = null;
        for (const s of live) {
          if (!s.foe || s.foe.dead || Math.random() < dt * (k.charge ? 0.3 : 2)) {
            if (!foes) foes = G.hostilesOf(this.team).filter(f => G.dist(f.x, f.y, this.target.x, this.target.y) < this.leash);
            s.foe = nearest(foes, s.x, s.y) || this.target;
          }
          if (this.prefer === 'buildings' && !(this.target instanceof G.Entity)) s.foe = this.target;
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
          const dx = this.target.x - this.x, dy = this.target.y - this.y;
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
        if (sq.team !== this.team || SQUAD_KINDS[sq.kind].ally) continue;
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

  // Boost every friendly soldier in the officer's aura, wherever the officer happens to be.
  function officerAura(s) {
    s.auraOn = false;
    for (const e of G.entities)
      if (e instanceof Soldier && e !== s && !e.dead && e.team === s.team &&
        G.dist(e.x, e.y, s.x, s.y) <= OFFICER_AURA + e.r) { e.haste = 0.25; s.auraOn = true; }
  }

  // Officer sidearm: fire at the nearest hostile already in range, without chasing it.
  function officerShoot(s) {
    const foe = nearest(G.hostilesOf(s.team).filter(f => G.canShoot(s.x, s.y, f)), s.x, s.y, s.attackRange + s.r);
    if (!foe) return;
    const facing = s.facing;
    s.strike(foe);
    if (s.moving) s.facing = facing;  // keep looking where it's walking
  }

  // Hero command: the group the hero stands in (every soldier of the squads near him, however far
  // those members are) peels off and follows him until a new command goes to another group.
  // Still swing at any hostile in reach while following.
  G.commandFollow = function (hero) {
    // Pressing F while a group is already following cancels that order.
    if ((hero.followers || []).some(s => !s.dead && s.heroFollow)) {
      releaseFollowers(hero);
      G.floaters.push({ x: hero.x, y: hero.y - hero.r - 30, text: 'Stop', t: 0, color: '#9fe3a0' });
      return true;
    }
    const near =G.entities.filter(e => e instanceof Soldier && !e.dead && e.team === hero.team &&
      G.dist(e.x, e.y, hero.x, hero.y) < COMMAND_RADIUS);
    // A lone ally can be commanded on its own; regular soldiers need a group.
    if (near.length < COMMAND_MIN && !near.some(e => SQUAD_KINDS[e.kind].ally)) return false;
    releaseFollowers(hero);
    const squads = new Set(near.map(s => s.squad).filter(Boolean));
    const group = new Set(near);
    for (const sq of squads) for (const s of sq.alive) group.add(s);
    const members = [...group];
    members.sort((a, b) => G.dist(a.x, a.y, hero.x, hero.y) - G.dist(b.x, b.y, hero.x, hero.y));
    const cols = Math.min(FOLLOW_COLS, members.length), rows = Math.ceil(members.length / cols);
    members.forEach((s, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      s.followOffset = {
        x: (col - (cols - 1) / 2) * FOLLOW_SPACING,
        y: (row - (rows - 1) / 2) * FOLLOW_SPACING
      };
      s.heroFollow = true;
      s.foe = null;
    });
    hero.followers = members;
    G.floaters.push({ x: hero.x, y: hero.y - hero.r - 30, text: 'Follow', t: 0, color: '#9fe3a0' });
    return true;
  };

  // Released soldiers stay where they stand: each affected squad re-anchors on its members'
  // current centroid and re-decides at once, so it picks a fresh target from there.
  function releaseFollowers(hero) {
    const squads = new Set();
    for (const s of hero.followers || []) {
      s.heroFollow = false; s.foe = null;
      if (s.squad) squads.add(s.squad);
    }
    hero.followers = [];
    for (const sq of squads) {
      const live = sq.formation;
      if (!live.length) continue;
      sq.x = live.reduce((a, s) => a + s.x, 0) / live.length;
      sq.y = live.reduce((a, s) => a + s.y, 0) / live.length;
      sq.target = null;
      sq.engaged = false;
      sq.think = 0;
    }
  }
  G.releaseFollowers = releaseFollowers;

  function updateFollowers(dt) {
    for (const hero of G.entities) if (hero instanceof G.Hero && hero.followers) followHero(hero, dt);
  }

  function followHero(hero, dt) {
    if (hero.dead) releaseFollowers(hero);
    hero.followers = hero.followers.filter(s => !s.dead && s.heroFollow);
    let hostiles = null;  // shared by the whole group this step
    for (const s of hero.followers) {
      s.tickCooldown(dt);
      s.swing = Math.max(0, s.swing - dt * 2.5);
      const tx = hero.x + s.followOffset.x, ty = hero.y + s.followOffset.y;
      s.moving = false;
      // Following comes first: keep walking to the spot in line with the hero, never faster than baseline.
      s.walk(tx, ty, 2, dt);
      // ...and swing at any hostile that is already within reach along the way.
      // Support allies don't fight; an officer keeps its aura up while following.
      if (s.squad.role) { if (s.squad.role === 'officer') { officerAura(s); officerShoot(s); } continue; }
      const foe = nearest(hostiles || (hostiles = G.hostilesOf(s.team)), s.x, s.y, s.attackRange + s.r);
      if (foe) s.strike(foe);
    }
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
    for (const sq of G.squads) {
      if (sq.summoner && (sq.lifetime -= dt) <= 0) {
        for (const s of sq.alive) { s.hp = 0; s.die(); }
        continue;
      }
      sq.update(dt);
    }
    // Bodies don't overlap: soldiers push apart from each other (both teams) and from heroes/beasts,
    // then out of rocks and buildings. Sweep along x: with bodies sorted by x, each one only meets the
    // few that follow it within reach, instead of every other body on the map.
    const bodies = G.entities.filter(e => !e.dead).sort((a, b) => a.x - b.x);
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
    for (const e of bodies) if (e instanceof Soldier) G.map.resolve(e);
    G.squads = G.squads.filter(sq => sq.alive.length);
    G.entities = G.entities.filter(e => !(e instanceof Soldier && e.dead));
  };
})(window.Game);
