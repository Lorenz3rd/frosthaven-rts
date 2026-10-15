// Towers: buildings with a `weapon` (see G.BUILDINGS) pick a target and lob shots at it.
// Shots fly along an arc for a fixed time; arrows/bolts follow their target and hit it on arrival,
// boulders land where the target stood when fired, then roll on along their flight line,
// crushing what they touch with less force after every hit.
(function (G) {
  G.shots = [];

  function candidates(b, w) {
    const out = [];
    for (const e of G.hostilesOf(b.team)) {
      if (w.targets === 'units' && !(e instanceof G.Entity)) continue;
      if (!G.canShoot(b.x, b.y, e)) continue;
      const d = G.dist(b.x, b.y, e.x, e.y);
      if (d <= w.range + (e.r || 0) && d >= w.minRange) out.push({ e, d });
    }
    return out;
  }

  function pickTarget(b, w) {
    let best = null;
    let list = candidates(b, w);
    // 'buildings': buildings first, otherwise the nearest of anything else.
    if (w.pick === 'buildings') {
      const bl = list.filter(c => !(c.e instanceof G.Entity));
      if (bl.length) list = bl;
    }
    for (const c of list) {
      if (!best) { best = c; continue; }
      if (w.pick === 'healthiest' ? c.e.hp > best.e.hp : c.d < best.d) best = c;
    }
    return best && best.e;
  }

  function fire(b, w, t) {
    const d = G.dist(b.x, b.y, t.x, t.y);
    G.shots.push({
      shot: w.shot, team: b.team, damage: w.damage, bldgMul: w.bldgMul, roll: w.roll,
      x0: b.x, y0: b.y, h0: w.muzzle, target: w.roll ? null : t, tx: t.x, ty: t.y,
      t: 0, dur: Math.max(0.25, d / w.speed), arc: w.shot === 'boulder' ? d * 0.35 : d * 0.12,
      x: b.x, y: b.y, h: w.muzzle
    });
    b.fired = 1;
  }

  const ROLL_R = 20;  // boulder radius while rolling

  function land(s) {
    if (!s.roll) {
      // A shot from outside can still be stopped by a storm field the target moved into.
      if (s.target && !s.target.dead && G.canShoot(s.x0, s.y0, s.target)) {
        s.target.takeDamage(s.damage * (s.bldgMul && !(s.target instanceof G.Entity) ? s.bldgMul : 1));
      }
      const fx = G.raceDef(s.team).shotFx;
      if (s.shot === 'rocket') { G.burst(s.tx, s.ty, fx.trail, 18, 200); G.burst(s.tx, s.ty, '#5a5450', 10, 120); }
      else G.burst(s.tx, s.ty, fx.impact, 5, 80);
      s.dead = true;
      return;
    }
    // Start rolling onward in the direction it was thrown.
    const d = G.dist(s.x0, s.y0, s.tx, s.ty) || 1;
    s.rolling = { dx: (s.tx - s.x0) / d, dy: (s.ty - s.y0) / d, left: s.roll.distance, hits: new Set() };
    s.h = ROLL_R;
    G.burst(s.x, s.y, '#8a7a66', 24, 220);
    crush(s);
  }

  // Damage anything hostile the boulder is touching (once each). Returns true if it should stop.
  function crush(s) {
    const r = s.rolling;
    for (const e of G.hostilesOf(s.team)) {
      if (r.hits.has(e) || G.dist(s.x, s.y, e.x, e.y) > s.roll.radius + (e.r || 0)) continue;
      if (!G.canShoot(s.x0, s.y0, e)) continue;
      r.hits.add(e);
      e.takeDamage(s.damage * (s.bldgMul && !(e instanceof G.Entity) ? s.bldgMul : 1));
      s.damage *= s.roll.falloff;
      G.burst(e.x, e.y, '#ffffff', 8, 140);
      if (!(e instanceof G.Entity)) return true;  // buildings stop it dead
      if (s.damage < s.roll.minDamage) return true;
    }
    return false;
  }

  function rollStep(s, dt) {
    const r = s.rolling, step = Math.min(r.left, s.roll.speed * dt);
    s.x += r.dx * step; s.y += r.dy * step; r.left -= step;
    s.spin = (s.spin || 0) + step / ROLL_R;
    if (Math.random() < 0.3) G.particles.push({ x: s.x, y: s.y, vx: 0, vy: 0, life: 0.5, t: 0, color: '#c9d2da', size: 3 });
    if (crush(s) || r.left <= 0 || G.map.hitsRock(s.x, s.y, ROLL_R)) {
      s.dead = true;
      G.burst(s.x, s.y, '#8a7a66', 16, 160);
    }
  }

  // Called once per update step.
  G.updateTowers = function (dt) {
    for (const b of G.buildingList()) {
      const w = G.BUILDINGS[b.type].weapon;
      if (!w || b.dead) continue;
      b.fired = Math.max(0, (b.fired || 0) - dt * 1.5);
      if (b.cd === undefined) b.cd = 0;
      if ((b.cd -= dt) > 0) continue;
      const t = pickTarget(b, w);
      if (!t) { b.cd = 0.2; continue; }  // nothing in range: look again soon
      b.aim = Math.atan2(t.y - b.y, t.x - b.x);
      b.cd = w.cooldown;
      fire(b, w, t);
    }
    for (const s of G.shots) {
      if (s.rolling) { rollStep(s, dt); continue; }
      if (s.target && !s.target.dead) { s.tx = s.target.x; s.ty = s.target.y; }
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      s.x = G.lerp(s.x0, s.tx, k); s.y = G.lerp(s.y0, s.ty, k);
      s.h = G.lerp(s.h0, 20, k) + s.arc * 4 * k * (1 - k);
      if (s.shot === 'rocket') G.particles.push({ x: s.x, y: s.y, h: s.h, vx: 0, vy: 0, life: 0.45, t: 0, color: Math.random() < 0.4 ? G.raceDef(s.team).shotFx.trail : '#6a6460', size: 3 });
      if (k >= 1) land(s);
    }
    G.shots = G.shots.filter(s => !s.dead);
  };
})(window.Game);
