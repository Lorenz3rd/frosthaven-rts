// Combat toolkit for hero abilities: target queries, damage & status helpers, delayed tasks, and
// effects. An effect (G.fx) is a timed thing in the world: purely visual (a slash, a shockwave) or with
// gameplay attached (a trap, a banner, a field of fire) through its tick / end callbacks.
// The renderer draws each effect by its `kind` (see FX in render3d.js).
(function (G) {
  G.fx = [];
  G.tasks = [];

  const isUnit = e => e instanceof G.Entity;

  // Everything `team` can hit with abilities: other-team entities (training beasts included) and
  // enemy buildings. opts.units / opts.buildings (default true) narrow it.
  G.foesOf = function (team, opts = {}) {
    const out = [];
    if (opts.units !== false) {
      for (const e of G.entities)
        if (!e.dead && e.team !== team && !e.untargetable && !e.invisible && !(G.dev && e instanceof G.Hero)) out.push(e);
    }
    if (opts.buildings !== false) {
      for (const b of G.buildingList())
        if (!b.dead && b.team !== team && b.team !== G.TEAM.NEUTRAL) out.push(b);
    }
    return out;
  };

  // An invisible hero (Blinkblade's Now You See Me) is hidden from views with no local player on its team.
  G.unseen = (e, viewer) => !!e.invisible && (viewer ? viewer.team !== e.team : !G.players.some(p => p.hero && p.hero.team === e.team));

  G.alliesOf = function (team) {
    return G.entities.filter(e => !e.dead && e.team === team);
  };

  // Foes whose body touches a circle.
  G.foesInRadius = (team, x, y, r, opts) =>
    G.foesOf(team, opts).filter(e => G.dist(x, y, e.x, e.y) <= r + (e.r || 0));

  // Distance from point (px, py) to segment (ax, ay)-(bx, by).
  G.segDist = function (px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
    const t = G.clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  };

  // Foes touching a thick line.
  G.foesInLine = (team, ax, ay, bx, by, width, opts) =>
    G.foesOf(team, opts).filter(e => G.segDist(e.x, e.y, ax, ay, bx, by) <= width / 2 + (e.r || 0));

  // Foes inside a cone of half-angle `half` (radians) and length `range`.
  G.foesInCone = (team, x, y, angle, range, half, opts) =>
    G.foesOf(team, opts).filter(e => {
      const d = G.dist(x, y, e.x, e.y);
      if (d > range + (e.r || 0)) return false;
      if (d < (e.r || 0) + 10) return true;
      const a = Math.atan2(e.y - y, e.x - x);
      return Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) <= half + Math.atan2(e.r || 0, d);
    });

  G.nearestFoe = function (team, x, y, maxD, opts) {
    let best = null, bd = maxD;
    for (const e of G.foesOf(team, opts)) {
      const d = G.dist(x, y, e.x, e.y) - (e.r || 0);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  // Ability / attack damage from a hero (or null src). The hero definition's onDamage hook can
  // adjust it (marks, bonuses) and react to it (burns, lifesteal).
  G.hurt = function (src, target, amount, opts = {}) {
    if (!target || target.dead) return 0;
    if (src && src.def && src.def.onDamage) amount = src.def.onDamage(src, target, amount, opts) ?? amount;
    const dealt = target.takeDamage(amount, { color: opts.color, hero: src }) || 0;
    if (src && src.def && src.def.afterDamage) src.def.afterDamage(src, target, dealt, opts);
    return dealt;
  };

  // A hero's basic attack connecting.
  G.basicHit = function (hero, target, dmg) {
    if (hero.def.onBasicHit) dmg = hero.def.onBasicHit(hero, target, dmg) ?? dmg;
    G.hurt(hero, target, dmg, { basic: true });
    G.burst(target.x, target.y, hero.def.css, 8, 120);
  };

  G.heal = function (e, amount) {
    if (e.dead || !isUnit(e) || e.hp >= e.maxHp) return 0;
    const amt = Math.min(amount, e.maxHp - e.hp);
    e.hp += amt;
    if (amt >= 1) G.floaters.push({ x: e.x + (Math.random() - 0.5) * 16, y: e.y - e.r, text: '+' + Math.round(amt), t: 0, color: '#9fe3a0' });
    return amt;
  };
  // Healing too small to show every tick (zones): no floater.
  G.mend = function (e, amount) { if (!e.dead && isUnit(e)) e.hp = Math.min(e.maxHp, e.hp + amount); };

  G.stun = function (e, dur) {
    if (!isUnit(e) || e.dead) return;
    e.stunTimer = Math.max(e.stunTimer, dur);
    e.dash = null;
  };
  G.root = function (e, dur) { if (isUnit(e) && !e.dead) e.rootTimer = Math.max(e.rootTimer, dur); };
  G.slow = function (e, amount, dur) { if (isUnit(e) && !e.dead) e.applySlow(amount, dur); };
  // Shove away from (fx, fy) by `dist` over `dur` seconds. Negative dist pulls toward it.
  G.knock = function (e, fx, fy, dist, dur = 0.25) {
    if (!isUnit(e) || e.dead || (e instanceof G.Hero && e.dash)) return;
    const d = G.dist(fx, fy, e.x, e.y) || 1;
    if (dist < 0) dist = -Math.min(-dist, d - 4);  // a pull stops at the center
    e.knock = { vx: (e.x - fx) / d * dist / dur, vy: (e.y - fy) / d * dist / dur, t: dur };
  };
  // Shove in a direction (radians).
  G.push = function (e, angle, dist, dur = 0.3) {
    if (!isUnit(e) || e.dead) return;
    e.knock = { vx: Math.cos(angle) * dist / dur, vy: Math.sin(angle) * dist / dur, t: dur };
  };
  // Damage over time. One stack per id: re-applying refreshes it. src: the hero behind it, if any.
  G.burn = function (e, dps, dur, id = 'burn', color = '#ff8a30', src = null) {
    if (!isUnit(e) || e.dead) return;
    const old = e.dots.find(d => d.id === id);
    if (old) { old.t = Math.max(old.t, dur); old.dps = Math.max(old.dps, dps); old.src = src || old.src; return; }
    e.dots.push({ id, dps, t: dur, color, src });
  };
  G.shield = function (e, amount, dur, color = 0x9fdcff, onEnd = null) {
    if (e.shieldAmt > 0 && e.onShieldEnd) e.onShieldEnd = null;  // a fresh shield replaces the old one quietly
    e.shieldAmt = amount; e.shieldTimer = dur; e.shieldColor = color; e.onShieldEnd = onEnd;
  };
  // props: { speed, atk, dmg, armor } as fractional bonuses. Same id refreshes.
  G.addBuff = function (e, id, dur, props) {
    if (!isUnit(e) || e.dead) return;
    e.buffs[id] = Object.assign({ t: dur }, props);
  };
  G.mark = function (e, id, dur) { if (isUnit(e) && !e.dead) e.marks[id] = Math.max(e.marks[id] || 0, dur); };

  // Run fn after `delay` seconds of game time.
  G.after = function (delay, fn) { G.tasks.push({ t: delay, fn }); };
  // Run fn(i) `count` times, `interval` apart, starting now.
  G.repeat = function (count, interval, fn) { for (let i = 0; i < count; i++) G.after(i * interval, () => fn(i)); };

  // Add an effect. props: x, y, dur, and anything its kind / callbacks use.
  // tick(fx, dt) runs every step, end(fx) once when it runs out.
  G.addFx = function (kind, props) {
    const o = Object.assign({ kind, t: 0, dur: 0.5, dead: false }, props);
    G.fx.push(o);
    return o;
  };

  // A hero summons a squad of `kind` at (x, y) that serves them for `lifetime` seconds.
  G.summon = function (hero, kind, x, y, lifetime) {
    const sq = new G.Squad(x, y, hero.team, hero.facing, kind);
    sq.summoner = hero;
    sq.lifetime = lifetime;
    sq.think = 0;
    G.squads.push(sq);
    return sq;
  };

  // Called once per update step.
  G.updateFx = function (dt) {
    const due = [];
    for (const k of G.tasks) if ((k.t -= dt) <= 0) due.push(k);
    if (due.length) {
      G.tasks = G.tasks.filter(k => k.t > 0);
      for (const k of due) k.fn();
    }
    for (const o of G.fx) {
      if (o.dead) continue;
      o.t += dt;
      if (o.tick) o.tick(o, dt);
      if (o.t >= o.dur && !o.dead) { o.dead = true; if (o.end) o.end(o); }
    }
    G.fx = G.fx.filter(o => !o.dead);
  };

  // ---- Aiming helpers for abilities ----
  // Clamp a target point to `range` from the hero.
  G.clampReach = function (hero, tx, ty, range) {
    const dx = tx - hero.x, dy = ty - hero.y, d = Math.hypot(dx, dy);
    if (d <= range || d < 1) return { x: tx, y: ty, d };
    return { x: hero.x + dx / d * range, y: hero.y + dy / d * range, d: range };
  };
  // Furthest open ground from the hero toward (tx, ty), up to `range`. Null if none.
  G.openSpot = function (hero, tx, ty, range) {
    const dx = tx - hero.x, dy = ty - hero.y, d = Math.hypot(dx, dy);
    if (d < 1) return null;
    const ux = dx / d, uy = dy / d;
    for (let dist = Math.min(d, range); dist > 20; dist -= 8) {
      const nx = hero.x + ux * dist, ny = hero.y + uy * dist;
      if (!G.map.blocked(nx, ny, hero.r, hero.team)) return { x: nx, y: ny };
    }
    return null;
  };
})(window.Game);
