// Squads: barracks spawn groups of melee soldiers that think as a group and fight as individuals.
// The squad picks one target (nearest hostile hero, soldier or building) and marches in formation;
// once close, each soldier breaks off to swing at the nearest hostile around that target.
(function (G) {
  // Unit kinds a barracks can field (BUILDINGS[type].squad picks one).
  //   bounty: gold in the coin pile it drops on death. cols x rows: formation. range: edge-to-edge reach; anything over MELEE_MAX fires arrows instead of swinging.
  const INFANTRY_SPEED = 99;       // 165 - 40%
  const SQUAD_KINDS = {
    infantry: { bounty: 2, cols: 4, rows: 3, spacing: 44, r: 11, hp: 80, damage: 3, range: 25, cooldown: 1.0, speed: INFANTRY_SPEED },
    armored: { bounty: 6, cols: 4, rows: 1, spacing: 58, r: 15, hp: 350, damage: 2, range: 25, cooldown: 1.4, speed: 65 },
    short: { bounty: 3, cols: 5, rows: 2, spacing: 44, r: 11, hp: 50, damage: 2, range: 350, cooldown: 1.0, speed: INFANTRY_SPEED },
    long: { bounty: 4, cols: 3, rows: 2, spacing: 44, r: 11, hp: 40, damage: 5, range: 750, cooldown: 2.0, speed: 80 },
    // Allies: a single unit, 1.5x the size of a soldier. `role` gives support allies their own brain
    // (see Squad.updateSupport); `prefer: 'buildings'` makes a fighter pick buildings before anything else.
    engineer: { bounty: 12, ally: true, role: 'engineer', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 200, damage: 0, range: 20, cooldown: 0.5, speed: INFANTRY_SPEED },
    medic: { bounty: 14, ally: true, role: 'medic', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 80, damage: 0, range: 250, cooldown: 1.5, speed: INFANTRY_SPEED },
    officer: { bounty: 16, ally: true, role: 'officer', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 150, damage: 2, range: 300, cooldown: 0.75, speed: INFANTRY_SPEED },
    demolitionist: { bounty: 18, ally: true, prefer: 'buildings', cols: 1, rows: 1, spacing: 0, r: 16.5, hp: 70, damage: 80, range: 1000, cooldown: 2.0, speed: INFANTRY_SPEED },
    // Summons: raised by heroes (see heroes.js), never trained. They follow their summoner, ignore race
    // modifiers, drop no gold and crumble when their time runs out. cleave: melee hits splash this radius.
    skeleton: { bounty: 0, summon: true, cols: 3, rows: 1, spacing: 40, r: 12, hp: 70, damage: 15, range: 14, cooldown: 1.5, speed: 80 },
    skeletonSolo: { bounty: 0, summon: true, cols: 1, rows: 1, spacing: 0, r: 12, hp: 70, damage: 15, range: 14, cooldown: 1.5, speed: 80 },
    colossus: { bounty: 0, summon: true, cols: 1, rows: 1, spacing: 0, r: 30, hp: 750, damage: 42, range: 26, cooldown: 1.6, speed: 95, cleave: 70 }
  };
  const ENGINEER_HEAL = 20;        // building hp per second
  const MEDIC_HEAL = 15;          // hp per splash, every `cooldown` seconds
  const MEDIC_RADIUS = 75;         // ~3/4 of the area an infantry block covers (4x3 at 44 spacing)
  const OFFICER_AURA = 250;       // 5 m
  const OFFICER_HASTE = 1.3;       // attack speed multiplier inside the aura
  G.OFFICER_AURA = OFFICER_AURA;
  const MELEE_MAX = 40;
  const ARROW_SPEED = 900;
  const ROCKET_SPEED = 1100;
  G.SQUAD_KINDS = SQUAD_KINDS;
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
      // Each race tunes its trained troops (see races.js); summons are the same for everyone.
      const mod = k.summon ? { hp: 1, dmg: 1, speed: 1, cd: 1 } : G.raceMods(team);
      super(x, y, k.r, Math.round(k.hp * mod.hp), team);
      this.squad = squad;
      this.kind = kind;
      this.ranged = k.range > MELEE_MAX;
      this.speed = k.speed * mod.speed;
      this.damage = k.damage * mod.dmg * G.bonusOf(team).troopDmg;
      this.attackRange = k.range;  // edge-to-edge reach
      this.attackCooldown = k.cooldown * mod.cd;
      this.cleave = k.cleave || 0;
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
        foe.takeDamage(dmg);
        if (this.cleave) {
          for (const e of G.foesInRadius(this.team, foe.x, foe.y, this.cleave))
            if (e !== foe) e.takeDamage(dmg * 0.6);
          G.addFx('ring', { x: foe.x, y: foe.y, r0: 10, r1: this.cleave, dur: 0.35, color: 0xcfe8d0 });
        }
        return;
      }
      // Loose an arrow on the tower shot system: it homes on the foe and hits on arrival.
      // Demolitionists fire rockets instead: faster and nearly flat.
      const d = G.dist(this.x, this.y, foe.x, foe.y);
      const rocket = this.kind === 'demolitionist';
      G.shots.push({
        shot: rocket ? 'rocket' : 'arrow', team: this.team, damage: dmg, target: foe, tx: foe.x, ty: foe.y,
        x0: this.x, y0: this.y, h0: 34, t: 0, dur: Math.max(0.2, d / (rocket ? ROCKET_SPEED : ARROW_SPEED)), arc: d * (rocket ? 0.02 : 0.15),
        x: this.x, y: this.y, h: 34
      });
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
      const fwd = (rows - 1) / 2 * spacing - row * spacing;
      const side = (col - (cols - 1) / 2) * spacing;
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
      if ((this.think -= dt) <= 0 || (this.target && this.target.dead)) { this.think = RETHINK; this.decide(); }

      if (this.engaged && this.target && !this.target.dead) {
        // Melee: each soldier fights the nearest hostile near the squad's target.
        // The candidate list is only built on a step where some soldier actually re-picks.
        let foes = null;
        for (const s of live) {
          if (!s.foe || s.foe.dead || Math.random() < dt * 2) {
            if (!foes) foes = G.hostilesOf(this.team).filter(f => G.dist(f.x, f.y, this.target.x, this.target.y) < this.leash);
            s.foe = nearest(foes, s.x, s.y) || this.target;
          }
          if (this.prefer === 'buildings' && !(this.target instanceof G.Entity)) s.foe = this.target;
          s.attack(s.foe, dt);
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
        const ka = sa ? (sb ? 0.5 : 1) : 0, kb = 1 - ka, push = min - d;
        a.x -= dx / d * push * ka; a.y -= dy / d * push * ka;
        b.x += dx / d * push * kb; b.y += dy / d * push * kb;
      }
    }
    for (const e of bodies) if (e instanceof Soldier) G.map.resolve(e);
    G.squads = G.squads.filter(sq => sq.alive.length);
    G.entities = G.entities.filter(e => !(e instanceof Soldier && e.dead));
  };
})(window.Game);
