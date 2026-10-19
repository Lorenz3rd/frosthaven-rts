// Neutral creatures: tundra oxen roaming no-man's-land, the open snow between the two sides' front bases.
// They keep to its top and bottom flanks, clear of the middle lane where the armies meet. Squads and
// towers leave them be (G.hostilesOf skips neutrals), so they are a hero's to hunt for the coins they
// drop. An ox never starts a fight, but hit it and it turns on whoever hit it.
// There are always COUNT of them: one that falls is replaced at once, somewhere away from every hero.
(function (G) {
  const COUNT = 8;
  const HP = 150;
  const R = 30;
  const DAMAGE = 20, ATTACK_CD = 1;    // 20 damage a second
  const REACH = 20;                    // edge-to-edge melee reach
  const IMPACT = 0.25;                 // seconds into the headbutt that it lands
  const WANDER_SPEED = G.m(1), CHASE_SPEED = G.m(2.6);
  const WANDER_STEP = G.m(8);          // how far one amble goes
  const LEASH = G.m(14);               // a chase ends this far from where it started
  const COINS_MIN = 20, COINS_MAX = 40;
  const SPAWN_CLEAR = G.m(15);         // replacements appear at least this far from any hero
  // The two roaming zones { x0, x1, y0, y1 }, set by the map: no-man's-land above and below the middle lane.
  const zones = () => G.map.zones();
  const inZone = (z, x, y) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
  const rand = (a, b) => a + Math.random() * (b - a);

  // An open spot in zone z (or near (nx, ny) within it), null if none turns up.
  function openSpot(z, nx, ny, ok = () => true) {
    for (let i = 0; i < 30; i++) {
      const x = nx === undefined ? rand(z.x0, z.x1) : G.clamp(nx + rand(-WANDER_STEP, WANDER_STEP), z.x0, z.x1);
      const y = ny === undefined ? rand(z.y0, z.y1) : G.clamp(ny + rand(-WANDER_STEP, WANDER_STEP), z.y0, z.y1);
      if (!G.map.blocked(x, y, R + 10, G.TEAM.NEUTRAL) && ok(x, y)) return { x, y };
    }
    return null;
  }

  class Creature extends G.Entity {
    constructor(x, y, zone) {
      super(x, y, R, HP, G.TEAM.NEUTRAL);
      this.zone = zone;              // index into zones()
      this.facing = Math.random() * Math.PI * 2;
      this.goal = null;              // where it's ambling to
      this.rest = rand(0.5, 4);      // seconds left grazing before the next amble
      this.foe = null;               // who it's fighting back against
      this.chaseFrom = null;         // where that fight started (the leash anchor)
      this.attackCd = 0;
      this.swing = 0;                // 1 -> 0 over the headbutt
      this.moving = false;
      this.stuckTime = 0;
      this.homeX = x;                // only offsets the renderer's idle animation
    }

    takeDamage(amount, src) {
      const dealt = super.takeDamage(amount, src);
      if (!this.dead && !this.foe && dealt > 0) {
        // Hits carry their hero; damage over time doesn't, so blame the nearest hero then.
        const by = src && src.hero instanceof G.Hero ? src.hero : nearestHero(this.x, this.y, LEASH);
        if (by && by.team !== this.team) { this.foe = by; this.chaseFrom = { x: this.x, y: this.y }; this.goal = null; }
      }
      return dealt;
    }

    die(src) {
      super.die(src);
      G.dropCoins(this.x, this.y, COINS_MIN + Math.floor(Math.random() * (COINS_MAX - COINS_MIN + 1)));
      G.burst(this.x, this.y, '#8a6e52', 20, 200);
    }

    // Give up the fight and amble back to where it started.
    calm() {
      this.goal = this.chaseFrom;
      this.foe = null; this.chaseFrom = null;
      this.rest = 0;
    }

    update(dt) {
      super.update(dt);
      if (this.dead) return;
      this.attackCd = Math.max(0, this.attackCd - dt);
      this.swing = Math.max(0, this.swing - dt * 2.5);
      this.moving = false;
      if (this.stunned || this.knock) return;

      const f = this.foe;
      if (f) {
        if (f.dead || f.untargetable || f.invisible || !G.entities.includes(f) ||
            G.dist(this.x, this.y, this.chaseFrom.x, this.chaseFrom.y) > LEASH) { this.calm(); return; }
        if (G.dist(this.x, this.y, f.x, f.y) <= this.r + f.r + REACH) {
          this.facing = Math.atan2(f.y - this.y, f.x - this.x);
          if (this.attackCd <= 0) this.headbutt(f);
        } else if (this.walk(f.x, f.y, CHASE_SPEED, dt)) this.calm();   // stuck behind something: let it go
        return;
      }

      if (this.rest > 0) { this.rest -= dt; return; }
      if (!this.goal) {
        // Out of its zone (pulled away by a fight): head back in. Otherwise a short amble nearby.
        const z = zones()[this.zone];
        this.goal = inZone(z, this.x, this.y) ? openSpot(z, this.x, this.y) : openSpot(z);
        if (!this.goal) { this.rest = 1; return; }
      }
      if (this.walk(this.goal.x, this.goal.y, WANDER_SPEED, dt)) { this.goal = null; this.rest = rand(2, 6); }
    }

    // One step toward (tx, ty). True once there, or after being stuck against something for a moment.
    walk(tx, ty, speed, dt) {
      const ox = this.x, oy = this.y;
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
      const step = speed * this.speedMul * dt;
      if (step <= 0) return false;
      this.moving = true;
      if (d <= step) { this.x = tx; this.y = ty; G.map.resolve(this); return true; }
      this.facing = Math.atan2(dy, dx);
      this.x += dx / d * step; this.y += dy / d * step;
      G.map.resolve(this);
      this.stuckTime = G.dist(ox, oy, this.x, this.y) < step * 0.25 ? this.stuckTime + dt : 0;
      if (this.stuckTime > 0.5) { this.stuckTime = 0; return true; }
      return false;
    }

    headbutt(f) {
      this.attackCd = ATTACK_CD;
      this.swing = 1;
      G.after(IMPACT, () => {
        if (this.dead || f.dead || this.foe !== f) return;
        if (G.dist(this.x, this.y, f.x, f.y) > this.r + f.r + REACH + 30) return;
        f.takeDamage(DAMAGE, { color: '#e0c49a' });
        G.burst(f.x, f.y, '#d9c7b0', 8, 120);
      });
    }
  }
  G.Creature = Creature;

  function nearestHero(x, y, maxD) {
    let best = null, bd = maxD;
    for (const h of G.entities) {
      if (!(h instanceof G.Hero) || h.dead) continue;
      const d = G.dist(x, y, h.x, h.y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // A new creature in whichever zone has fewer, away from every hero. Null if no spot turns up.
  function spawnOne() {
    const zs = zones(), live = G.entities.filter(e => e instanceof Creature && !e.dead);
    const counts = zs.map((z, i) => live.filter(c => c.zone === i).length);
    const zone = counts[0] < counts[1] ? 0 : counts[1] < counts[0] ? 1 : Math.floor(Math.random() * 2);
    const clear = (x, y) => !G.entities.some(e => e instanceof G.Hero && !e.dead && G.dist(x, y, e.x, e.y) < SPAWN_CLEAR) &&
      !live.some(c => G.dist(x, y, c.x, c.y) < G.m(4));
    const at = openSpot(zs[zone], undefined, undefined, clear);
    if (!at) return null;
    const c = new Creature(at.x, at.y, zone);
    G.entities.push(c);
    G.burst(c.x, c.y, '#ffffff', 12, 100);
    return c;
  }

  G.spawnCreatures = function () {
    for (let i = 0; i < COUNT; i++) spawnOne();
  };

  // Called once per update step: clears out the fallen and tops the herd back up to COUNT.
  G.updateCreatures = function () {
    if (G.entities.some(e => e instanceof Creature && e.dead)) G.entities = G.entities.filter(e => !(e instanceof Creature && e.dead));
    let n = 0;
    for (const e of G.entities) if (e instanceof Creature) n++;
    if (n < COUNT) spawnOne();   // one a step: a failed try just goes again next step
  };
})(window.Game);
