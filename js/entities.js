// Entities: base Entity (with status effects), Hero, Algox training dummy, projectiles, effects.
(function (G) {
  G.entities = [];
  G.projectiles = [];
  G.particles = [];
  G.floaters = [];
  G.deathListeners = [];   // fn(entity) called whenever an entity dies
  const POISON_HERO = 10, POISON_UNIT = 2;   // extra damage per hit on a poisoned target

  class Entity {
    constructor(x, y, r, maxHp, team) {
      this.x = x; this.y = y; this.r = r;
      this.maxHp = maxHp; this.hp = maxHp;
      this.team = team;
      this.dead = false;
      this.resetStatus();
    }
    // Status effects. Everything here is cleared on respawn.
    resetStatus() {
      this.slowTimer = 0; this.slowAmount = 0;
      this.stunTimer = 0;        // can't move or attack
      this.rootTimer = 0;        // can't move
      this.knock = null;         // { vx, vy, t }: shoved along, overriding movement
      this.dots = [];            // damage over time: { dps, t, src, color, id }
      this.dotAcc = 0;           // damage ticked but not yet shown as a floater
      this.shieldAmt = 0; this.shieldTimer = 0; this.shieldColor = 0x9fdcff; this.onShieldEnd = null;
      this.buffs = {};           // id -> { t, speed, atk, dmg, armor }: fractional bonuses
      this.marks = {};           // id -> seconds left (e.g. Deathwalker's Shadow)
      this.flash = 0;
    }
    get stunned() { return this.stunTimer > 0; }
    get burning() { return this.dots.length > 0; }
    get impaired() { return this.stunTimer > 0 || this.rootTimer > 0 || this.slowTimer > 0; }
    get speedMul() {
      if (this.stunTimer > 0 || this.rootTimer > 0) return 0;
      return (this.slowTimer > 0 ? 1 - this.slowAmount : 1) * this.buffMul('speed');
    }
    // Product of (1 + bonus) over active buffs for one stat: 'speed', 'atk' (attack speed), 'dmg'.
    buffMul(stat) {
      let m = 1;
      for (const k in this.buffs) m *= 1 + (this.buffs[k][stat] || 0);
      return m;
    }
    // Fraction of incoming damage ignored.
    armor() {
      let a = 0;
      for (const k in this.buffs) a += this.buffs[k].armor || 0;
      return Math.min(0.8, a);
    }
    applySlow(amount, duration) {
      this.slowAmount = Math.max(this.slowTimer > 0 ? this.slowAmount : 0, amount);
      this.slowTimer = Math.max(this.slowTimer, duration);
    }
    takeDamage(amount, src) {
      if (this.dead || this.untargetable) return 0;
      // Poisoned (Blinkblade): every hit from a hero or a soldier lands harder.
      if (this.marks.poison && src && !src.dot) amount += src.hero ? POISON_HERO : src.unit ? POISON_UNIT : 0;
      amount *= 1 - this.armor();
      if (this.shieldAmt > 0) {
        const soak = Math.min(this.shieldAmt, amount);
        this.shieldAmt -= soak; amount -= soak;
        if (this.shieldAmt <= 0) this.endShield();
        if (amount <= 0) { G.floaters.push({ x: this.x, y: this.y - this.r, text: '◈', t: 0, color: '#9fdcff' }); return soak; }
      }
      this.hp -= amount;
      this.flash = 0.12;
      if (!src || !src.dot) G.floaters.push({ x: this.x + (Math.random() - 0.5) * 16, y: this.y - this.r, text: String(Math.round(amount)), t: 0, color: (src && src.color) || '#ffffff' });
      if (this.hp <= 0) { this.hp = 0; this.die(src); }
      return amount;
    }
    endShield() {
      const cb = this.onShieldEnd;
      this.shieldAmt = 0; this.shieldTimer = 0; this.onShieldEnd = null;
      if (cb) cb(this);
    }
    die(src) {
      this.dead = true;
      for (const fn of G.deathListeners) fn(this, src);
    }
    update(dt) {
      if (this.slowTimer > 0) this.slowTimer -= dt;
      if (this.stunTimer > 0) this.stunTimer -= dt;
      if (this.rootTimer > 0) this.rootTimer -= dt;
      if (this.flash > 0) this.flash -= dt;
      for (const k in this.buffs) if ((this.buffs[k].t -= dt) <= 0) delete this.buffs[k];
      for (const k in this.marks) if ((this.marks[k] -= dt) <= 0) delete this.marks[k];
      if (this.shieldTimer > 0 && (this.shieldTimer -= dt) <= 0) this.endShield();
      if (this.dead) return;
      if (this.dots.length) {
        let total = 0, by = null;   // by: a hero behind the burns, credited with the damage
        for (const d of this.dots) { d.t -= dt; total += d.dps * dt; by = by || d.src; }
        this.dots = this.dots.filter(d => d.t > 0);
        const color = this.dots[0] ? this.dots[0].color : '#ff9a40';
        this.takeDamage(total, { dot: true, hero: by });
        this.dotAcc += total;
        if (this.dotAcc >= 10 || (!this.dots.length && this.dotAcc >= 1)) {
          G.floaters.push({ x: this.x + (Math.random() - 0.5) * 16, y: this.y - this.r, text: String(Math.round(this.dotAcc)), t: 0, color });
          this.dotAcc = 0;
        }
        if (Math.random() < 0.5) G.particles.push({ x: this.x + (Math.random() - 0.5) * this.r * 1.5, y: this.y + (Math.random() - 0.5) * this.r, vx: 0, vy: -10, life: 0.5, t: 0, color, size: 3 });
      }
      if (this.knock && !this.dead) {
        const k = this.knock;
        this.x += k.vx * dt; this.y += k.vy * dt;
        G.map.resolve(this);
        if ((k.t -= dt) <= 0) this.knock = null;
      }
    }
  }
  G.Entity = Entity;

  const DEMOLISH_REACH = 24;   // edge-to-edge reach for tearing down one of your buildings

  // A hero is built from a definition in G.HEROES (see heroes.js): stats, basic attack, four abilities
  // and a passive. Definitions hook in with optional functions: init, update, onBasicHit, armor.
  class Hero extends Entity {
    constructor(x, y, def, team = G.TEAM.PLAYER) {
      super(x, y, def.r || 18, def.hp, team);
      this.def = def;
      this.speed = def.speed;
      this.hpRegen = def.hpRegen || 5;
      this.target = null;
      this.facing = 0;
      this.cooldowns = {};
      this.stuckTime = 0;
      this.attackTarget = null;   // left-click: chase, then attack
      this.attackCd = 0;
      this.swing = 0;             // 1 -> 0 over the basic attack animation
      this.swingAlt = false;      // alternates so combos can swap arms
      this.castAnim = 0;          // 1 -> 0 over an ability animation
      this.castSlot = -1;         // which ability (0-3) the cast animation is for
      this.demolishTarget = null; // friendly building the hero walks over to tear down
      this.gold = G.START_GOLD;
      this.dash = null;           // { tx, ty, speed, arc, hit:Set, onPass(e), onArrive() }
      this.lift = 0;              // height off the ground (leaps)
      this.moving = false;
      this.untargetable = false;
      this.invisible = false;     // unseen by the enemy (Blinkblade's ultimate)
      this.history = [];          // recent { x, y, hp } samples, newest last (for rewinds)
      this.histT = 0;
      this.state = {};            // per-hero passive state
      this.unlock = G.newUnlocks(); // ability unlock progress for this match (see unlocks.js)
      this.form = def.startForm || null;
      if (def.init) def.init(this);
    }
    get basic() { return this.def.formBasic ? this.def.formBasic(this) : this.def.basic; }
    get color() { return this.def.color; }
    armor() { return Math.min(0.8, super.armor() + (this.def.armor ? this.def.armor(this) : 0)); }
    moveTo(x, y) { this.target = { x, y }; this.stuckTime = 0; }
    takeDamage(amount, src) {
      if (G.dev) return 0;
      const dealt = super.takeDamage(amount, src);
      if (src && src.hero) G.noteDamage(src.hero, this, dealt);
      return dealt;
    }
    respawn(x, y) {
      this.dead = false; this.hp = this.maxHp;
      this.target = null; this.attackTarget = null; this.demolishTarget = null; this.dash = null;
      this.lift = 0; this.untargetable = false; this.invisible = false; this.history = [];
      this.resetStatus();
      this.x = x; this.y = y;
      if (this.def.init) this.def.init(this);
    }
    // Start an ability animation.
    playCast(slot) { this.castAnim = 1; this.castSlot = slot; }

    update(dt) {
      super.update(dt);
      if (this.dead) return;
      const ox = this.x, oy = this.y;
      this.hp = Math.min(this.maxHp, this.hp + this.hpRegen * dt);
      for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
      this.attackCd = Math.max(0, this.attackCd - dt * this.buffMul('atk'));
      this.swing = Math.max(0, this.swing - dt * 2.5);
      this.castAnim = Math.max(0, this.castAnim - dt * 1.6);
      if ((this.histT += dt) >= 0.1) {
        this.histT = 0;
        this.history.push({ x: this.x, y: this.y, hp: this.hp });
        if (this.history.length > 40) this.history.shift();
      }
      if (this.def.update) this.def.update(this, dt);
      this.moving = false;
      if (this.dash) { this.updateDash(dt); this.moving = true; return; }
      if (this.stunned || this.knock) return;

      if (this.demolishTarget) {
        const b = this.demolishTarget;
        if (b.dead || (b.team !== this.team && !G.dev)) this.demolishTarget = null;
        else if (G.dist(this.x, this.y, b.x, b.y) <= b.r + this.r + DEMOLISH_REACH) {
          this.demolishTarget = null;
          this.target = null;
          G.destroyBuilding(b, this);  // leaves its salvage coins for the hero to pick up
          return;
        } else {
          const d = G.dist(this.x, this.y, b.x, b.y) || 1;
          const reach = b.r + this.r + DEMOLISH_REACH * 0.5;
          this.moveTo(b.x + (this.x - b.x) / d * reach, b.y + (this.y - b.y) / d * reach);
        }
      }

      if (this.attackTarget) {
        const t = this.attackTarget, b = this.basic;
        if (t.dead || t.untargetable || (t.invisible && t.team !== this.team)) this.attackTarget = null;
        else if (G.dist(this.x, this.y, t.x, t.y) <= this.r + t.r + b.range) {
          this.target = null;
          this.facing = Math.atan2(t.y - this.y, t.x - this.x);
          if (this.attackCd <= 0) this.basicAttack(t);
          return;
        } else {
          this.moveTo(t.x, t.y);
        }
      }

      if (!this.target) return;
      // Walls in the way: head for a gate (or around the wall) first.
      const via = G.steer(this, this.target.x, this.target.y), goal = via && !via.wall ? via : this.target;
      const dx = goal.x - this.x, dy = goal.y - this.y;
      const d = Math.hypot(dx, dy);
      const step = this.speed * this.speedMul * dt;
      if (step <= 0) return;  // rooted
      this.moving = true;
      if (d <= step) { this.x = goal.x; this.y = goal.y; G.map.resolve(this); if (goal === this.target) this.target = null; return; }
      this.facing = Math.atan2(dy, dx);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      G.map.resolve(this);
      // If a rock keeps us from making progress, give up on the order.
      const moved = G.dist(ox, oy, this.x, this.y);
      this.stuckTime = moved < step * 0.25 ? this.stuckTime + dt : 0;
      if (this.stuckTime > 0.25) this.target = null;
    }

    basicAttack(t) {
      const b = this.basic;
      this.attackCd = b.cooldown;
      this.swing = 1;
      this.swingAlt = !this.swingAlt;
      const dmg = b.damage * this.buffMul('dmg');
      if (b.ranged) {
        const a = Math.atan2(t.y - this.y, t.x - this.x);
        G.spawnProjectile({
          x: this.x + Math.cos(a) * this.r, y: this.y + Math.sin(a) * this.r, h: b.muzzle || 44,
          angle: a, speed: b.speed || 900, range: 2000, r: 7, team: this.team, color: b.color || this.def.css,
          style: b.projectile, homing: t, owner: this,
          onHit: e => G.basicHit(this, e, dmg)
        });
      } else {
        // Melee lands partway through the swing, if the target is still in reach.
        G.after(b.impact || 0.12, () => {
          if (this.dead || t.dead) return;
          if (G.dist(this.x, this.y, t.x, t.y) <= this.r + t.r + b.range + 30) G.basicHit(this, t, dmg);
        });
      }
    }

    // Dashes and leaps: move at a fixed speed toward (tx, ty), touching foes along the way.
    updateDash(dt) {
      const d = this.dash;
      d.t = (d.t || 0) + dt;
      const dx = d.tx - this.x, dy = d.ty - this.y, dist = Math.hypot(dx, dy);
      const step = d.speed * dt;
      this.facing = Math.atan2(dy, dx);
      const total = d.total || (d.total = dist || 1);
      let arrived = dist <= step;
      if (!arrived) {
        const nx = this.x + dx / dist * step, ny = this.y + dy / dist * step;
        if (!d.arc && G.map.blocked(nx, ny, this.r, this.team)) arrived = true;
        else { this.x = nx; this.y = ny; }
      } else { this.x = d.tx; this.y = d.ty; }
      const k = G.clamp(1 - Math.hypot(d.tx - this.x, d.ty - this.y) / total, 0, 1);
      this.lift = d.arc ? d.arc * 4 * k * (1 - k) : 0;
      if (d.onPass) {
        for (const e of G.foesInRadius(this.team, this.x, this.y, this.r + (d.width || 20), { buildings: false })) {
          if (d.hit.has(e)) continue;
          d.hit.add(e); d.onPass(e);
        }
      }
      if (d.trail && Math.random() < 0.8) G.particles.push({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.5, t: 0, color: d.trail, size: 4 });
      if (arrived || d.t > 2) {
        G.map.resolve(this);
        this.dash = null; this.lift = 0; this.target = null;
        if (d.onArrive) d.onArrive();
      }
    }
  }
  G.Hero = Hero;

  class AlgoxDummy extends Entity {
    constructor(x, y) {
      super(x, y, 28, 400, G.TEAM.NEUTRAL);  // neutral beast: squads ignore it
      this.homeX = x; this.homeY = y;
      this.respawnTimer = 0;
    }
    die(src) {
      super.die(src);
      this.respawnTimer = 4;
      G.burst(this.x, this.y, '#d9c7b0', 24, 220);
    }
    update(dt) {
      super.update(dt);
      if (this.dead) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.dead = false; this.hp = this.maxHp; this.resetStatus();
          this.x = this.homeX; this.y = this.homeY;
          G.burst(this.x, this.y, '#ffffff', 16, 120);
        }
      }
    }
  }
  G.AlgoxDummy = AlgoxDummy;

  // ---- Projectiles ----
  // opts: { x, y, angle, speed, range, r, team, color, onHit(target, proj) }
  // Optional: h (flight height), style (model, see render3d), homing (target to chase; always hits it),
  // pierce (keeps flying, hits each foe once), buildings (false: fly through buildings),
  // onEnd(proj) when it runs out of range, trail (particle color, null for none), spin.
  G.spawnProjectile = function (o) {
    const p = Object.assign({ traveled: 0, dead: false, ox: o.x, oy: o.y, h: 34, hit: new Set(), t: 0 }, o, {
      vx: Math.cos(o.angle) * o.speed, vy: Math.sin(o.angle) * o.speed
    });
    G.projectiles.push(p);
    return p;
  };

  G.updateProjectiles = function (dt) {
    for (const p of G.projectiles) {
      if (p.dead) continue;
      p.t += dt;
      if (p.homing) {
        const t = p.homing;
        if (t.dead) { p.dead = true; G.burst(p.x, p.y, p.color, 6, 80); continue; }
        const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
        p.angle = Math.atan2(dy, dx);
        p.vx = dx / d * p.speed; p.vy = dy / d * p.speed;
        if (d <= p.speed * dt + (t.r || 0) * 0.6) {
          p.dead = true;
          if (G.canShoot(p.ox, p.oy, t)) p.onHit(t, p);
          G.burst(t.x, t.y, p.color, 10, 140);
          continue;
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.traveled += p.speed * dt;
      if (p.trail !== null && Math.random() < 0.7) G.particles.push({ x: p.x, y: p.y, h: p.h, vx: 0, vy: 0, life: 0.3, t: 0, color: p.trail || p.color, size: 3 });
      if (p.homing) continue;
      if (p.traveled >= p.range || G.map.hitsRock(p.x, p.y, p.r, p.team, true)) {
        p.dead = true;
        if (p.onEnd) p.onEnd(p); else G.burst(p.x, p.y, p.color, 10, 120);
        continue;
      }
      for (const e of G.foesOf(p.team, { buildings: p.buildings !== false })) {
        if (p.hit.has(e) || !G.canShoot(p.ox, p.oy, e)) continue;
        if (G.dist(p.x, p.y, e.x, e.y) < p.r + e.r) {
          p.hit.add(e);
          p.onHit(e, p);
          G.burst(p.x, p.y, p.color, 14, 160);
          if (!p.pierce) { p.dead = true; break; }
        }
      }
    }
    G.projectiles = G.projectiles.filter(p => !p.dead);
  };

  // ---- Particles & floating text ----
  G.burst = function (x, y, color, n, speed, h) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      G.particles.push({ x, y, h, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3, t: 0, color, size: 2 + Math.random() * 3 });
    }
  };

  G.updateEffects = function (dt) {
    for (const p of G.particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; }
    G.particles = G.particles.filter(p => p.t < p.life);
    if (G.particles.length > 2900) G.particles.splice(0, G.particles.length - 2900);
    for (const f of G.floaters) { f.t += dt; f.y -= 40 * dt; }
    G.floaters = G.floaters.filter(f => f.t < 0.9);
  };

})(window.Game);
