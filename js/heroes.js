// Heroes: nine mercenaries any race can hire. Each definition carries stats, a basic attack, four
// abilities (Q W E R: the third also has a passive, the fourth is the ultimate) and optional hooks:
//   init(h), update(h, dt)          per-hero state
//   onBasicHit(h, t, dmg) -> dmg    adjust a basic attack as it lands
//   onDamage(h, t, amt) -> amt      adjust any damage the hero deals (G.hurt)
//   afterDamage(h, t, dealt)        react to damage dealt
//   onFoeDeath(h, e, src)           a foe died (anywhere); src.hero dealt the killing blow
//   onCast(h, ability)              an ability was just cast
//   onAllyDeath(h, e)               an ally died (anywhere)
//   onHurt(h, amt, src) -> amt      adjust damage the hero takes (G.inRanged() tells a ranged hit)
//   armor(h) -> fraction            extra damage reduction
//   passiveText(h) -> string        short counter shown on the HUD
// Ability: { key, name, icon, cooldown, range, aim: 'dir'|'point'|'foe'|'self', desc, cast(h, tx, ty) }.
// cast() returns false to cancel (no cost, no cooldown).
(function (G) {
  const T = G.TEAM;
  const angleTo = (h, tx, ty) => Math.atan2(ty - h.y, tx - h.x);
  const isUnit = e => e instanceof G.Entity;
  // Every `step` seconds while an effect lives: fn(o).
  const pulse = (step, fn) => (o, dt) => { o.acc = (o.acc || 0) + dt; while (o.acc >= step) { o.acc -= step; fn(o); } };

  // The foe nearest a point, within `near` of it and `reach` of the hero.
  function foeNear(h, tx, ty, near, reach, opts) {
    let best = null, bd = Infinity;
    for (const e of G.foesOf(h.team, opts)) {
      if (G.dist(h.x, h.y, e.x, e.y) - (e.r || 0) > reach) continue;
      const d = G.dist(tx, ty, e.x, e.y) - (e.r || 0);
      if (d < near && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // A wall of force (wave, stampede) sweeping from (x0, y0) along `angle`: hits each foe once as the
  // front passes it. onHit(e, lateral) where lateral is the signed side-offset from the center line.
  function sweep(o, onHit) {
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const front = Math.min(o.len, o.t * o.speed);
    for (const e of G.foesOf(o.team)) {
      if (o.hit.has(e)) continue;
      const rx = e.x - o.x0, ry = e.y - o.y0;
      const along = rx * c + ry * s, side = -rx * s + ry * c;
      if (along < -40 || along > front + (e.r || 0) || Math.abs(side) > o.width / 2 + (e.r || 0)) continue;
      o.hit.add(e);
      onHit(e, side);
    }
  }

  function teleport(h, x, y, color) {
    G.addFx('blink', { x: h.x, y: h.y, x2: x, y2: y, dur: 0.35, color });
    G.burst(h.x, h.y, '#ffffff', 10, 140);
    h.x = x; h.y = y; h.target = null;
    G.map.resolve(h);
    G.burst(x, y, '#ffffff', 14, 160);
  }

  // =====================================================================================
  // 1. Bannerspear — Human spear-and-shield tactician (melee)
  // =====================================================================================
  const BANNER_REACH = G.m(10);
  const CHARLIE_RESPAWN = 15;
  // A banner planted at (x, y) for `dur` seconds. style: 'doom' | 'courage' | 'hope' (see FX.banner).
  function plantBanner(h, x, y, style, r, dur, tick) {
    G.addFx('banner', { x, y, r, style, big: style === 'hope', team: h.team, dur, tick });
    G.addFx('ring', { x, y, r0: 20, r1: r, dur: 0.5, color: style === 'doom' ? 0xff4a3a : style === 'hope' ? 0xc8ffd0 : 0xe8c060 });
  }
  const alliesNear = (h, x, y, r) => G.alliesOf(h.team).filter(a => G.dist(a.x, a.y, x, y) <= r + a.r);
  const BANNERSPEAR = {
    id: 'bannerspear', name: 'Bannerspear', lore: 'Human', role: 'Melee',
    color: 0xe8c060, css: '#e8c060', r: 19, barH: 115,
    desc: 'A shield-and-spear tactician who fights at the head of the line, plants war banners and never goes anywhere without her squire Charlie.',
    hp: 1500, speed: 172,
    basic: { damage: 75, range: 46, cooldown: 1.05, impact: 0.14 },
    passive: { name: 'Charlie', icon: '⛨', desc: `Charlie, her squire (200 HP, no attack), keeps pace about 3 m away and always steps between her and the nearest enemy. He heals 1 HP per second and returns ${CHARLIE_RESPAWN}s after falling.` },
    init(h) { h.state.charlie = null; h.state.charlieT = 0; },
    update(h, dt) {
      const c = h.state.charlie;
      if ((c && !c.dead) || !G.passiveOn(h)) return;
      if (c) { h.state.charlie = null; h.state.charlieT = CHARLIE_RESPAWN; }
      if ((h.state.charlieT -= dt) > 0) return;
      const a = h.facing + Math.PI;
      const sq = G.summon(h, 'charlie', h.x + Math.cos(a) * G.m(1.5), h.y + Math.sin(a) * G.m(1.5), Infinity);
      h.state.charlie = sq.soldiers[0];
      G.burst(h.state.charlie.x, h.state.charlie.y, '#e8c060', 14, 140);
    },
    passiveText: h => (h.state.charlie || !G.passiveOn(h) ? '' : Math.ceil(Math.max(0, h.state.charlieT)) + 's'),
    abilities: [
      { key: 'q', name: 'Banner of Doom', icon: '☠', cooldown: 8, range: BANNER_REACH, aim: 'point',
        desc: 'Plants a cursed banner up to 10 m away for 5s. Foes within 3 m of it take 7 damage every 0.5s.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, BANNER_REACH), r = G.m(3); h.facing = angleTo(h, p.x, p.y); h.playCast(0);
          plantBanner(h, p.x, p.y, 'doom', r, 5, pulse(0.5, () => {
            for (const e of G.foesInRadius(h.team, p.x, p.y, r)) G.hurt(h, e, 7, { color: '#ff6a5a' });
            G.addFx('ring', { x: p.x, y: p.y, r0: 20, r1: r, dur: 0.3, color: 0xff4a3a });
          }));
          return true;
        } },
      { key: 'w', name: 'Banner of Courage', icon: '⚑', cooldown: 16, range: BANNER_REACH, aim: 'point',
        desc: 'Plants a war banner up to 10 m away for 8s. Allies within 6 m of it deal 20% more attack damage.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, BANNER_REACH), r = G.m(6); h.facing = angleTo(h, p.x, p.y); h.playCast(1);
          plantBanner(h, p.x, p.y, 'courage', r, 8, pulse(0.25, () => {
            for (const a of alliesNear(h, p.x, p.y, r)) G.addBuff(a, 'courage', 0.35, { dmg: 0.2 });
          }));
          return true;
        } },
      { key: 'e', name: 'Unbreakable Wall', icon: '⛊', cooldown: 7, range: 200, aim: 'dir',
        desc: 'Drives the shield into every foe in front of her within 200: 70 damage and a 0.5s stun. Passive — Charlie: her squire guards her, stepping between her and enemies.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(2);
          G.after(0.12, () => {
            for (const e of G.foesInCone(h.team, h.x, h.y, a, 200, 0.9)) { G.hurt(h, e, 70); G.stun(e, 0.5); }
            G.addFx('cone', { x: h.x, y: h.y, angle: a, r: 200, arc: 1.8, dur: 0.4, color: 0xffe08a });
          });
          return true;
        } },
      { key: 'r', name: 'Banner of Hope', icon: '♛', cooldown: 70, range: BANNER_REACH, aim: 'point', ult: true,
        desc: 'ULTIMATE. Plants a great standard up to 10 m away for 7s. Allies within 10 m of it heal 20 HP per second and ignore 50% of incoming damage.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, BANNER_REACH), r = G.m(10); h.facing = angleTo(h, p.x, p.y); h.playCast(3);
          plantBanner(h, p.x, p.y, 'hope', r, 7, pulse(0.25, () => {
            for (const a of alliesNear(h, p.x, p.y, r)) { G.mend(a, 5); G.addBuff(a, 'hope', 0.35, { armor: 0.5 }); }
          }));
          G.addFx('pillar', { x: p.x, y: p.y, dur: 0.8, color: 0xc8ffd0, r: 60 });
          G.burst(p.x, p.y, '#e8ffe8', 40, 320);
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 2. Boneshaper — Aesther necromancer (ranged summoner)
  // =====================================================================================
  const SKELETON_LIFE = 20;
  const RALLY_RANGE = G.m(12);
  const BACK_AGAIN_RANGE = G.m(10);
  const UNDEAD = new Set(['skeleton', 'skeletonSolo', 'boneBall']);
  const isSkeleton = e => e instanceof G.Soldier && (e.kind === 'skeleton' || e.kind === 'skeletonSolo');
  const BONESHAPER = {
    id: 'boneshaper', name: 'Boneshaper', lore: 'Aesther', role: 'Ranged',
    color: 0x8fe8a8, css: '#9ff0b8', r: 18, barH: 110,
    desc: 'A grave-robbing necromancer who raises skeletons (Doug and Doug, mostly), curses the living and rolls the dead into a great ball of bone.',
    hp: 1200, speed: 168,
    basic: { damage: 75, range: G.m(8), cooldown: 1.15, ranged: true, projectile: 'boneShard', speed: 850, muzzle: 62, color: '#cfeed8' },
    passive: { name: 'Rally the Dead', icon: '☠', desc: 'Her skeletons and Bone Balls within 12 m of her take 30% less damage.' },
    init(h) { h.state.backAgain = 0; h.state.rallied = 0; },
    update(h, dt) {
      let n = 0;
      for (const sq of G.passiveOn(h) ? G.squads : []) {
        if (sq.summoner !== h || !UNDEAD.has(sq.kind)) continue;
        for (const s of sq.alive) if (G.dist(s.x, s.y, h.x, h.y) <= RALLY_RANGE) { G.addBuff(s, 'rallyDead', 0.2, { armor: 0.3 }); n++; }
      }
      h.state.rallied = n;
      if (h.state.backAgain > 0) {
        const was = h.state.backAgain;
        h.state.backAgain -= dt;
        // A pulse of grave-light around her every half second while the dead may rise.
        if (Math.ceil(was * 2) !== Math.ceil(h.state.backAgain * 2))
          G.addFx('ring', { x: h.x, y: h.y, r0: BACK_AGAIN_RANGE - 30, r1: BACK_AGAIN_RANGE, dur: 0.45, color: 0x9ff0b8 });
      }
    },
    // Back Again: allies (other than skeletons) falling near her while it lasts get up as skeletons.
    onAllyDeath(h, e) {
      if (!(h.state.backAgain > 0) || !(e instanceof G.Entity) || isSkeleton(e)) return;
      if (G.dist(h.x, h.y, e.x, e.y) > BACK_AGAIN_RANGE) return;
      const x = e.x, y = e.y;
      G.addFx('grave', { x, y, r: 40, dur: 0.8 });
      G.after(0.35, () => { G.summon(h, 'skeletonSolo', x, y, SKELETON_LIFE); G.burst(x, y, '#cfeed8', 14, 140); });
    },
    passiveText: h => (h.state.rallied ? '×' + h.state.rallied : ''),
    abilities: [
      { key: 'q', name: 'Doug & Doug', icon: '☗', cooldown: 12, range: 350, aim: 'point',
        desc: `Raises five Skeleton warriors, every one of them Doug (70 HP, 15 damage each), that fight for ${SKELETON_LIFE}s.`,
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 350); h.facing = angleTo(h, p.x, p.y); h.playCast(0);
          G.addFx('grave', { x: p.x, y: p.y, r: 70, dur: 1 });
          G.after(0.25, () => {
            const sq = G.summon(h, 'skeleton', p.x, p.y, SKELETON_LIFE);
            for (const s of sq.soldiers) G.floaters.push({ x: s.x, y: s.y - s.r, text: 'Doug', t: 0, color: '#cfeed8' });
          });
          return true;
        } },
      { key: 'w', name: "Death's Curse", icon: '☁', cooldown: 10, range: G.m(15), aim: 'dir',
        desc: 'Sends a dark cloud (2 m radius) drifting slowly 15 m forward. Every foe it touches takes 15 damage and is slowed 50% and attacks 50% slower for 4s.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(1);
          const len = G.m(15), speed = G.m(3);
          G.addFx('curseCloud', { x: h.x, y: h.y, x0: h.x, y0: h.y, r: G.m(2), dur: len / speed + 0.4, team: h.team, hit: new Set(),
            tick(o) {
              const d = Math.min(len, o.t * speed);
              o.x = o.x0 + Math.cos(a) * d; o.y = o.y0 + Math.sin(a) * d;
              if (o.t * speed > len) return;  // spent: just fading out
              for (const e of G.foesInRadius(h.team, o.x, o.y, o.r)) {
                if (o.hit.has(e)) continue;
                o.hit.add(e);
                G.hurt(h, e, 15, { color: '#b8a0d8' }); G.slow(e, 0.5, 4); G.addBuff(e, 'curse', 4, { atk: -0.5 });
              }
            } });
          return true;
        } },
      { key: 'e', name: 'Back Again', icon: '⚰', cooldown: 20, range: 0, aim: 'self',
        desc: 'For 5s, every ally (other than skeletons) that dies within 10 m of her rises again as a Skeleton warrior. Passive — Rally the Dead: her skeletons and Bone Balls within 12 m take 30% less damage.',
        cast(h) {
          h.playCast(2);
          h.state.backAgain = 5;
          G.addFx('ring', { x: h.x, y: h.y, r0: 30, r1: BACK_AGAIN_RANGE, dur: 0.5, color: 0x9ff0b8 });
          G.burst(h.x, h.y, '#9ff0b8', 24, 220);
          return true;
        } },
      { key: 'r', name: 'Bone Ball', icon: '◉', cooldown: 75, range: 300, aim: 'point', ult: true,
        desc: 'ULTIMATE. Packs the dead into a great rolling Bone Ball (400 HP) that fights for 25s, hitting for 30% of its current health (at least 120). Every skeleton of hers it rolls within 1 m of is absorbed: +100 max health (up to 900) and heals 100.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 300); h.facing = angleTo(h, p.x, p.y); h.playCast(3);
          G.addFx('grave', { x: p.x, y: p.y, r: 120, dur: 1.2, big: true });
          G.after(0.55, () => {
            G.addFx('ring', { x: p.x, y: p.y, r0: 20, r1: 140, dur: 0.45, color: 0x9ff0b8 });
            G.burst(p.x, p.y, '#cfeed8', 40, 300);
            G.summon(h, 'boneBall', p.x, p.y, 25);
          });
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 3. Deathwalker — Valrath shadow reaper (melee)
  // =====================================================================================
  // Shadows: pools of dark the Deathwalker leaves where it steps and where it kills (at most 5 at a time).
  const SHADOW_R = G.m(2.5);
  const SHADOW_LIFE = 60;
  const MAX_SHADOWS = 5;
  const STEP_RANGE = G.m(7);
  const NIGHT_FALLS_RANGE = G.m(8);
  const shadowsOf = h => G.fx.filter(o => o.kind === 'shadowPool' && o.owner === h && !o.dead);
  // Leave a new shadow at (x, y); the oldest gives way past the cap.
  function placeShadow(h, x, y) {
    const mine = shadowsOf(h);
    if (mine.length >= MAX_SHADOWS) { mine[0].dead = true; G.burst(mine[0].x, mine[0].y, '#6a4aa8', 10, 100); }
    G.addFx('ring', { x, y, r0: 20, r1: SHADOW_R, dur: 0.4, color: 0x9a6cff });
    return G.addFx('shadowPool', { x, y, r: SHADOW_R, dur: SHADOW_LIFE, owner: h, team: h.team });
  }
  const inShadow = (h, e) => shadowsOf(h).some(s => G.dist(s.x, s.y, e.x, e.y) <= s.r + (e.r || 0) * 0.5);
  // Every foe standing in any of the Deathwalker's shadows.
  function foesInShadows(h) {
    const found = new Set();
    for (const s of shadowsOf(h)) for (const e of G.foesInRadius(h.team, s.x, s.y, s.r)) found.add(e);
    return [...found];
  }
  const DEATHWALKER = {
    id: 'deathwalker', name: 'Deathwalker', lore: 'Valrath', role: 'Melee',
    color: 0xa47cff, css: '#b28cff', r: 18, barH: 108,
    desc: 'A horned reaper who walks between shadows, leaving a pool of night behind every kill and growing deadlier with each.',
    hp: 1350, speed: 180,
    basic: { damage: 75, range: 44, cooldown: 1.1, impact: 0.14 },
    passive: { name: 'Night Comes', icon: '☾', desc: `Every enemy it kills leaves a shadow (${SHADOW_R / G.UNITS_PER_METER} m radius) for ${SHADOW_LIFE}s, up to ${MAX_SHADOWS} at a time; a new one replaces the oldest. Deals 5% more damage for each active shadow.` },
    init(h) { h.state.dark = 0; h.state.inDark = false; },
    update(h, dt) {
      if (!(h.state.dark > 0)) { h.state.inDark = false; return; }
      h.state.dark -= dt;
      h.state.inDark = inShadow(h, h);
      if (!h.state.inDark) return;
      G.addBuff(h, 'inTheDark', 0.2, { armor: 0.2 });
      G.mend(h, 5 * dt);
    },
    onDamage(h, t, amt) { return G.passiveOn(h) ? amt * (1 + 0.05 * shadowsOf(h).length) : amt; },
    onFoeDeath(h, e, src) {
      if (!src || src.hero !== h || !(e instanceof G.Entity) || !G.passiveOn(h)) return;
      placeShadow(h, e.x, e.y);
      G.addFx('soul', { x: e.x, y: e.y, to: h, dur: 0.6, color: 0xb28cff });
    },
    passiveText: h => String(shadowsOf(h).length || ''),
    abilities: [
      { key: 'q', name: 'Shadow Step', icon: '◐', cooldown: 8, range: STEP_RANGE, aim: 'point',
        desc: `Steps through the dark up to 7 m and leaves a shadow where it lands, dealing 50 damage to every foe in it.`,
        cast(h, tx, ty) {
          const spot = G.openSpot(h, tx, ty, STEP_RANGE);
          if (!spot) return false;
          h.playCast(0);
          teleport(h, spot.x, spot.y, 0xb28cff);
          placeShadow(h, spot.x, spot.y);
          for (const e of G.foesInRadius(h.team, spot.x, spot.y, SHADOW_R)) G.hurt(h, e, 50, { color: '#b28cff' });
          return true;
        } },
      { key: 'w', name: 'Darkness Grows', icon: '●', cooldown: 10, range: 0, aim: 'self',
        desc: 'Every foe standing in one of its shadows is stunned for 0.5s and takes 50 damage.',
        cast(h) {
          const shadows = shadowsOf(h);
          if (!shadows.length) return false;
          h.playCast(1);
          for (const e of foesInShadows(h)) { G.hurt(h, e, 50, { color: '#b28cff' }); G.stun(e, 0.5); }
          for (const s of shadows) {
            G.addFx('ring', { x: s.x, y: s.y, r0: s.r, r1: 10, dur: 0.4, color: 0xb28cff });
            G.burst(s.x, s.y, '#6a4aa8', 16, 160);
          }
          return true;
        } },
      { key: 'e', name: 'In the Dark', icon: '◑', cooldown: 18, range: 0, aim: 'self',
        desc: 'For 10s, while it stands in one of its shadows it takes 20% less damage and heals 5 HP per second. Passive — Night Comes: kills leave shadows (up to 5, 60s each); +5% damage per active shadow.',
        cast(h) {
          h.playCast(2);
          h.state.dark = 10;
          G.addFx('ring', { x: h.x, y: h.y, r0: 80, r1: 10, dur: 0.4, color: 0x9a6cff });
          G.burst(h.x, h.y, '#6a4aa8', 20, 160);
          return true;
        } },
      { key: 'r', name: 'Night Falls', icon: '✠', cooldown: 60, range: NIGHT_FALLS_RANGE, aim: 'foe', ult: true,
        desc: 'ULTIMATE. Gathers every one of its shadows into a foe within 8 m, dealing 60 damage for each shadow consumed.',
        cast(h, tx, ty) {
          const shadows = shadowsOf(h);
          if (!shadows.length) return false;
          const t = foeNear(h, tx, ty, 160, NIGHT_FALLS_RANGE) || G.nearestFoe(h.team, h.x, h.y, NIGHT_FALLS_RANGE);
          if (!t) return false;
          h.facing = angleTo(h, t.x, t.y); h.playCast(3);
          for (const s of shadows) {
            s.dead = true;
            G.addFx('soul', { x: s.x, y: s.y, to: t, dur: 0.5, color: 0x9a6cff });
          }
          const dmg = 60 * shadows.length;
          G.after(0.5, () => {
            if (t.dead) return;
            G.hurt(h, t, dmg, { color: '#d0b8ff' });
            G.addFx('pillar', { x: t.x, y: t.y, dur: 0.6, color: 0x9a6cff, r: 40 });
            G.burst(t.x, t.y, '#b28cff', 30, 260);
          });
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 4. Geminate — Harrower swarm of two minds (ranged / melee forms)
  // =====================================================================================
  const GEM_PINK = '#ff6fd0', GEM_VIOLET = '#a46cff';
  const GEM_RANGED = { damage: 75, range: G.m(8), cooldown: 0.95, ranged: true, projectile: 'twinOrb', speed: 950, muzzle: 48, color: GEM_PINK };
  const GEM_MELEE = { damage: 75, range: 30, cooldown: 0.85, impact: 0.1 };
  // Drag Down's crescent, measured along the aim from the Geminate: inside the outer circle (center c1
  // ahead, radius r1) but outside the inner one (c2, r2). Its outer edge reaches 8 m.
  const CRESCENT = { c1: G.m(4), r1: G.m(4), c2: G.m(2), r2: G.m(4) };
  function crescentFoes(h, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return G.foesOf(h.team).filter(e => {
      const r = e.r || 0;
      return G.dist(e.x, e.y, h.x + c * CRESCENT.c1, h.y + s * CRESCENT.c1) <= CRESCENT.r1 + r &&
        G.dist(e.x, e.y, h.x + c * CRESCENT.c2, h.y + s * CRESCENT.c2) >= CRESCENT.r2 - r;
    });
  }
  const TAILSPIN_R = G.m(1.5);
  // Swarm: a 4 m × 2 m patch (long side across the aim) landing 7 to 12 m away.
  const SWARM_MIN = G.m(7), SWARM_MAX = G.m(12), SWARM_LEN = G.m(4), SWARM_W = G.m(2), GEM_POISON = 10;
  function swarmSpot(h, tx, ty) {
    const a = angleTo(h, tx, ty), d = Math.max(SWARM_MIN, Math.min(SWARM_MAX, G.dist(h.x, h.y, tx, ty)));
    return { x: h.x + Math.cos(a) * d, y: h.y + Math.sin(a) * d, a };
  }
  function swarmFoes(h, p) {
    const c = Math.cos(p.a), s = Math.sin(p.a);
    return G.foesOf(h.team).filter(e => {
      const rx = e.x - p.x, ry = e.y - p.y, r = e.r || 0;
      return Math.abs(rx * c + ry * s) <= SWARM_W / 2 + r && Math.abs(-rx * s + ry * c) <= SWARM_LEN / 2 + r;
    });
  }
  const CARAPACE_TIME = 5, CARAPACE_REFLECT = 0.4;
  const RUSH_REACH = G.m(12);
  // Shared with the cast preview and the AI.
  G.geminate = { CRESCENT, crescentFoes, swarmSpot, swarmFoes, SWARM_LEN, SWARM_W, TAILSPIN_R };
  function setForm(h, f) {
    if (h.form === f) return;
    h.form = f;
    if (f === 'ranged') h.state.carapace = 0;
    G.burst(h.x, h.y, f === 'melee' ? GEM_PINK : GEM_VIOLET, 26, 220);
    G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 90, dur: 0.35, color: f === 'melee' ? 0xff6fd0 : 0xa46cff });
  }
  const GEMINATE = {
    id: 'geminate', name: 'Geminate', lore: 'Harrower', role: 'Ranged / Melee',
    color: 0xff6fd0, css: '#ff7ad6', r: 18, barH: 108,
    desc: 'A Harrower: a single mind spread through a robed swarm of insects, which can loose the swarm at range or harden into a clawed, tail-whipping carapace.',
    hp: 1350, speed: 185, startForm: 'ranged',
    basic: GEM_RANGED,
    formBasic: h => (h.form === 'melee' ? GEM_MELEE : GEM_RANGED),
    passive: { name: 'In Form', icon: '☯', desc: 'Ranged form deals 20% more damage. Melee form takes 15% less damage.' },
    init(h) { h.form = 'ranged'; h.state.carapace = 0; },
    update(h, dt) { h.state.carapace = Math.max(0, h.state.carapace - dt); },
    onDamage(h, t, amt) { return h.form === 'ranged' && G.passiveOn(h) ? amt * 1.2 : amt; },
    armor: h => (h.form === 'melee' && G.passiveOn(h) ? 0.15 : 0),
    // Tough Carapace: 40% of every hit bounces back at whoever struck.
    onHurt(h, amt, src) {
      if (!(h.state.carapace > 0) || h.form !== 'melee' || (src && (src.dot || src.reflect))) return amt;
      const who = src && (src.hero || src.by);
      if (who && who !== h && !who.dead && who.takeDamage) who.takeDamage(amt * CARAPACE_REFLECT, { reflect: true, hero: h, color: GEM_PINK });
      return amt;
    },
    passiveText: h => (h.form === 'melee' ? (h.state.carapace > 0 ? 'Melee ◈' : 'Melee') : 'Ranged'),
    abilities: [
      { key: 'q', name: 'Drag Down / Tailspin', icon: '☾', cooldown: 6, range: G.m(8), aim: 'dir',
        desc: 'Ranged form — Drag Down: the swarm rakes a crescent reaching 8 m in front of it, 70 damage to every foe inside. Melee form — Tailspin: whips its tail around, 85 damage to every foe within 1.5 m.',
        cast(h, tx, ty) {
          h.playCast(0);
          if (h.form === 'melee') {
            for (const e of G.foesInRadius(h.team, h.x, h.y, TAILSPIN_R)) G.hurt(h, e, 85, { color: GEM_PINK });
            G.addFx('slash', { x: h.x, y: h.y, angle: h.facing, arc: Math.PI * 2, r: TAILSPIN_R + 20, dur: 0.4, color: 0xff6fd0 });
            G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: TAILSPIN_R + 10, dur: 0.3, color: 0xa46cff });
            return true;
          }
          const a = angleTo(h, tx, ty); h.facing = a;
          G.after(0.15, () => {
            if (h.dead) return;
            for (const e of crescentFoes(h, a)) G.hurt(h, e, 70, { color: GEM_PINK });
            G.addFx('crescent', Object.assign({ x: h.x, y: h.y, angle: a, dur: 0.55 }, CRESCENT));
          });
          return true;
        } },
      { key: 'w', name: 'Swarm / Tough Carapace', icon: '⁂', cooldown: 12, range: SWARM_MAX, aim: 'point',
        desc: `Ranged form — Swarm: sends the swarm onto a 4 m × 2 m patch 7 to 12 m away: 50 damage and poison for ${GEM_POISON}s to every foe in it (every hit on a poisoned foe deals extra damage: +10 from a hero, +2 from a soldier). Melee form — Tough Carapace: for ${CARAPACE_TIME}s, 40% of all damage it takes is reflected back at the attacker.`,
        cast(h, tx, ty) {
          if (h.form === 'melee') {
            h.playCast(1);
            h.state.carapace = CARAPACE_TIME;
            G.burst(h.x, h.y, GEM_PINK, 24, 200);
            G.repeat(CARAPACE_TIME * 2, 0.5, () => {
              if (!h.dead && h.state.carapace > 0) G.addFx('ring', { x: h.x, y: h.y, r0: h.r + 30, r1: h.r + 8, dur: 0.35, color: 0xff6fd0 });
            });
            return true;
          }
          const p = swarmSpot(h, tx, ty); h.facing = p.a; h.playCast(1);
          G.addFx('swarm', { x: p.x, y: p.y, x0: h.x, y0: h.y, angle: p.a, len: SWARM_LEN, w: SWARM_W, dur: 1.2 });
          G.after(0.35, () => {
            for (const e of swarmFoes(h, p)) { G.hurt(h, e, 50, { color: '#d890ff' }); G.mark(e, 'poison', GEM_POISON); }
          });
          return true;
        } },
      { key: 'e', name: 'Form Swap', icon: '⇋', cooldown: 3, range: 0, aim: 'self',
        desc: 'Switches between ranged form (swarm bolts reaching 8 m) and melee form (claws), which also changes what Q and W do. Passive — In Form: ranged form deals 20% more damage; melee form takes 15% less damage.',
        cast(h) {
          h.playCast(2);
          setForm(h, h.form === 'melee' ? 'ranged' : 'melee');
          return true;
        } },
      { key: 'r', name: 'Rush Forward', icon: '➹', cooldown: 60, range: RUSH_REACH, aim: 'dir', ult: true,
        desc: 'ULTIMATE. Rushes 12 m forward; every foe in its path takes 90 damage and is stunned for 1s.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty);
          const spot = G.openSpot(h, h.x + Math.cos(a) * RUSH_REACH, h.y + Math.sin(a) * RUSH_REACH, RUSH_REACH);
          if (!spot) return false;
          h.facing = a; h.playCast(3); h.attackTarget = null; h.target = null;
          G.burst(h.x, h.y, GEM_VIOLET, 16, 180);
          h.dash = { tx: spot.x, ty: spot.y, speed: 1400, width: 30, hit: new Set(), trail: GEM_PINK,
            onPass(e) { G.hurt(h, e, 90, { color: GEM_PINK }); G.stun(e, 1); G.burst(e.x, e.y, GEM_PINK, 10, 160); },
            onArrive() { G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 90, dur: 0.35, color: 0xff6fd0 }); } };
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 5. Blinkblade — Quatryl chrono-duelist (melee)
  // =====================================================================================
  const DAGGER_REACH = G.m(5);
  const STAB_REACH = G.m(8);
  const POISON_TIME = 10;
  const CHARGE_RATE = 8, CHARGE_MAX = 100, CHARGE_DRAIN = 20;
  const INVIS_TIME = 30;
  const AMBUSH_SPLASH = G.m(1);
  // Ends Now You See Me (any ability or basic attack does).
  function reveal(h) {
    if (!h.invisible) return;
    h.invisible = false; h.state.invis = 0;
    G.burst(h.x, h.y, '#cfeeff', 16, 160);
  }
  const BLINKBLADE = {
    id: 'blinkblade', name: 'Blinkblade', lore: 'Quatryl', role: 'Melee',
    color: 0x7fd8ff, css: '#8fdcff', r: 16, barH: 90,
    desc: 'A tiny inventor with a time-folding engine on her back and a blade that is never quite where you look.',
    hp: 1350, speed: 205,
    basic: { damage: 75, range: 26, cooldown: 0.85, impact: 0.08 },
    passive: { name: 'Charge Up', icon: '⚡', desc: `Builds ${CHARGE_RATE} charge per second (up to ${CHARGE_MAX}). Using any ability speeds her up, burning ${CHARGE_DRAIN} charge per second until it runs out: Poison Dagger and Stab Them All recharge twice as fast, +80% move speed and +20% basic attack damage.` },
    init(h) { h.state.charge = 0; h.state.speeding = false; h.state.cutting = 0; h.state.invis = 0; h.state.ambush = 0; h.invisible = false; },
    update(h, dt) {
      const s = h.state;
      if (s.cutting > 0) { s.cutting -= dt; h.target = null; }
      if (s.speeding) {
        s.charge = Math.max(0, s.charge - CHARGE_DRAIN * dt);
        if (s.charge <= 0) s.speeding = false;
        else {
          // Half cooldowns: Q and W tick down twice as fast.
          for (const k of ['q', 'w']) h.cooldowns[k] = Math.max(0, (h.cooldowns[k] || 0) - dt);
          G.addBuff(h, 'speedUp', 0.2, { speed: 0.8, dmg: 0.2 });
          if (Math.random() < 0.5) G.particles.push({ x: h.x, y: h.y, vx: 0, vy: 0, life: 0.4, t: 0, color: '#8fdcff', size: 3 });
        }
      } else if (G.passiveOn(h)) s.charge = Math.min(CHARGE_MAX, s.charge + CHARGE_RATE * dt);
      if (s.ambush > 0) s.ambush -= dt;
      if (s.invis > 0 && (s.invis -= dt) <= 0) reveal(h);
    },
    onCast(h, ab) {
      if (ab.key !== 'r') reveal(h);
      if (h.state.charge > 0 && !h.state.speeding) {
        h.state.speeding = true;
        G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 90, dur: 0.3, color: 0x8fdcff });
      }
    },
    // Now You See Me: the first basic attack after vanishing hits for 150 and splashes 50 around the target.
    onBasicHit(h, t, dmg) {
      reveal(h);
      if (!(h.state.ambush > 0)) return dmg;
      h.state.ambush = 0;
      for (const e of G.foesInRadius(h.team, t.x, t.y, AMBUSH_SPLASH, { buildings: false })) if (e !== t) G.hurt(h, e, 50);
      G.addFx('ring', { x: t.x, y: t.y, r0: 10, r1: AMBUSH_SPLASH + 20, dur: 0.35, color: 0xcff4ff });
      G.addFx('slash', { x: t.x, y: t.y, angle: h.facing, arc: 2.4, r: 70, dur: 0.3, color: 0xcff4ff });
      return 150 * h.buffMul('dmg');
    },
    passiveText: h => Math.floor(h.state.charge || 0) + (h.state.speeding ? '»' : ''),
    abilities: [
      { key: 'q', name: 'Poison Dagger', icon: '🗡', cooldown: 6, range: DAGGER_REACH, aim: 'dir',
        desc: `Slashes a cone in front of her (5 m): 40 damage and poison for ${POISON_TIME}s. Every hit on a poisoned foe deals extra damage: +10 from a hero, +2 from a soldier.`,
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0); h.swing = 1;
          for (const e of G.foesInCone(h.team, h.x, h.y, a, DAGGER_REACH, 0.7)) {
            G.hurt(h, e, 40, { color: '#9fe870' });
            G.mark(e, 'poison', POISON_TIME);
          }
          G.addFx('cone', { x: h.x, y: h.y, angle: a, r: DAGGER_REACH, arc: 1.4, dur: 0.35, color: 0x8fe05a });
          G.addFx('slash', { x: h.x, y: h.y, angle: a, arc: 1.4, r: 90, dur: 0.25, color: 0xb8ff90 });
          return true;
        } },
      { key: 'w', name: 'Stab Them All', icon: '⚡', cooldown: 9, range: STAB_REACH, aim: 'self',
        desc: 'Blinks to the nearest foe within 8 m and strikes for 50 damage, then on to the next nearest: three strikes, 0.1s apart. Ends early when no new foe is within 8 m.',
        cast(h) {
          const hit = new Set();
          const next = () => {
            let best = null, bd = STAB_REACH;
            for (const e of G.foesOf(h.team, { buildings: false })) {
              if (hit.has(e)) continue;
              const d = G.dist(h.x, h.y, e.x, e.y) - (e.r || 0);
              if (d < bd) { bd = d; best = e; }
            }
            return best;
          };
          if (!next()) return false;
          h.playCast(1); h.state.cutting = 0.3; h.attackTarget = null;
          let over = false;
          G.repeat(3, 0.1, () => {
            if (over || h.dead) return;
            const t = next();
            if (!t) { over = true; h.state.cutting = 0; return; }
            hit.add(t);
            const a = Math.atan2(h.y - t.y, h.x - t.x), d = (t.r || 0) + h.r + 6;
            const nx = t.x + Math.cos(a) * d, ny = t.y + Math.sin(a) * d;
            G.addFx('blink', { x: h.x, y: h.y, x2: nx, y2: ny, dur: 0.3, color: 0x8fdcff });
            h.x = nx; h.y = ny; G.map.resolve(h);
            h.facing = Math.atan2(t.y - h.y, t.x - h.x);
            h.swing = 1; h.swingAlt = !h.swingAlt;
            G.hurt(h, t, 50);
            G.addFx('slash', { x: t.x, y: t.y, angle: h.facing, arc: 2, r: 60, dur: 0.2, color: 0xcff4ff });
          });
          return true;
        } },
      { key: 'e', name: 'Go Fast', icon: '⏩', cooldown: 15, range: 0, aim: 'self',
        desc: `Resets the cooldowns of Poison Dagger and Stab Them All, and for 5s: +50% move speed and +40% attack speed. Passive — Charge Up: builds ${CHARGE_RATE} charge per second (max ${CHARGE_MAX}); any ability spends it at ${CHARGE_DRAIN} per second to speed up (Q and W recharge twice as fast, +80% move speed, +20% basic damage).`,
        cast(h) {
          h.playCast(2);
          h.cooldowns.q = 0; h.cooldowns.w = 0;
          G.addBuff(h, 'goFast', 5, { speed: 0.5, atk: 0.4 });
          G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 110, dur: 0.35, color: 0x8fdcff });
          return true;
        } },
      { key: 'r', name: 'Now You See Me', icon: '◌', cooldown: 60, range: 0, aim: 'self', ult: true,
        desc: `ULTIMATE. Turns invisible for up to ${INVIS_TIME}s: enemies cannot see or target her. Attacking or using an ability ends it. Her first basic attack after vanishing deals 150 damage, plus 50 to every other foe within 1 m of the target.`,
        cast(h) {
          h.playCast(3);
          h.invisible = true; h.state.invis = INVIS_TIME; h.state.ambush = INVIS_TIME;
          h.attackTarget = null;
          G.addFx('ring', { x: h.x, y: h.y, r0: 90, r1: 10, dur: 0.4, color: 0xcff4ff });
          G.burst(h.x, h.y, '#cfeeff', 24, 200);
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 6. Crushing Tide — Lurker shell-crusher (melee tank)
  // =====================================================================================
  const RIPTIDE_TIME = 7, RIPTIDE_R = G.m(3);
  const SHELL_TIME = 4, SHELL_REFLECT = 0.3;
  const REJUV_WAIT = 4, REJUV_HEAL = 20;
  const EBB_R = G.m(8), FLOW_R = G.m(5);
  const CRUSHING_TIDE = {
    id: 'crushingtide', name: 'Crushing Tide', lore: 'Lurker', role: 'Melee',
    color: 0x3fc8d8, css: '#5fd8e8', r: 23, barH: 98,
    desc: 'A colossal crab-knight of the deep who breaks lines with its crusher claw and drowns armies in the tide.',
    hp: 1500, speed: 160,
    basic: { damage: 75, range: 34, cooldown: 1.3, impact: 0.2 },
    passive: { name: 'Rejuvenate', icon: '❀', desc: `After standing in the same spot for ${REJUV_WAIT}s, heals ${REJUV_HEAL} HP per second until it moves.` },
    init(h) { h.state.stillT = 0; h.state.stillX = h.x; h.state.stillY = h.y; h.state.riptide = 0; h.state.shells = 0; },
    update(h, dt) {
      const s = h.state;
      if (s.riptide > 0) s.riptide -= dt;
      if (s.shells > 0) s.shells -= dt;
      // Rejuvenate: any movement (walking, dashing, being shoved) starts the wait over.
      if (G.dist(h.x, h.y, s.stillX, s.stillY) > 2) { s.stillX = h.x; s.stillY = h.y; s.stillT = 0; return; }
      if (!G.passiveOn(h) || (s.stillT += dt) < REJUV_WAIT) return;
      G.mend(h, REJUV_HEAL * dt);
      if (h.hp < h.maxHp && Math.random() < 0.3) G.particles.push({ x: h.x + (Math.random() - 0.5) * h.r * 2, y: h.y, vx: 0, vy: -30, life: 0.6, t: 0, color: '#9fe3a0', size: 3 });
    },
    // Tide of Shells: ranged hits do nothing; every other hit bounces 30% back at whoever struck.
    onHurt(h, amt, src) {
      if (!(h.state.shells > 0) || (src && (src.dot || src.reflect))) return amt;
      if (G.inRanged()) { G.floaters.push({ x: h.x, y: h.y - h.r, text: '◈', t: 0, color: '#ffb0a0' }); return 0; }
      const who = src && (src.hero || src.by);
      if (who && who !== h && !who.dead && who.takeDamage) who.takeDamage(amt * SHELL_REFLECT, { reflect: true, hero: h, color: '#ff9a8a' });
      return amt;
    },
    passiveText: h => (!G.passiveOn(h) ? '' : h.state.stillT >= REJUV_WAIT ? '+' : Math.ceil(REJUV_WAIT - h.state.stillT) + 's'),
    abilities: [
      { key: 'q', name: 'Riptide', icon: '♋', cooldown: 10, range: 0, aim: 'self',
        desc: `For ${RIPTIDE_TIME}s, a churning current swirls around it: every foe within 3 m takes 8 damage every 0.5s.`,
        cast(h) {
          h.playCast(0);
          h.state.riptide = RIPTIDE_TIME;
          G.repeat(RIPTIDE_TIME * 2, 0.5, () => {
            if (h.dead) return;
            for (const e of G.foesInRadius(h.team, h.x, h.y, RIPTIDE_R)) G.hurt(h, e, 8, { color: '#5fe0e8' });
            G.addFx('ring', { x: h.x, y: h.y, r0: RIPTIDE_R, r1: h.r + 10, dur: 0.4, color: 0x5fe0e8 });
          });
          return true;
        } },
      { key: 'w', name: 'Tide of Shells', icon: '⬢', cooldown: 14, range: 0, aim: 'self',
        desc: `For ${SHELL_TIME}s, ignores all damage from ranged attacks, and every other hit it takes reflects 30% of its damage back at the attacker.`,
        cast(h) {
          h.playCast(1);
          h.state.shells = SHELL_TIME;
          G.burst(h.x, h.y, '#ff9a8a', 24, 200);
          G.repeat(SHELL_TIME * 2, 0.5, () => {
            if (!h.dead) G.addFx('ring', { x: h.x, y: h.y, r0: h.r + 30, r1: h.r + 8, dur: 0.35, color: 0xff8a7a });
          });
          return true;
        } },
      { key: 'e', name: 'Surge Tide', icon: '≈', cooldown: 15, range: 0, aim: 'self',
        desc: `For 6s: +30% move speed and +60% attack speed. Passive — Rejuvenate: after standing still for ${REJUV_WAIT}s, heals ${REJUV_HEAL} HP per second until it moves.`,
        cast(h) {
          h.playCast(2);
          G.addBuff(h, 'surgeTide', 6, { speed: 0.3, atk: 0.6 });
          G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 110, dur: 0.35, color: 0x5fd8e8 });
          G.burst(h.x, h.y, '#9fefff', 20, 200);
          return true;
        } },
      { key: 'r', name: 'Ebb and Flow', icon: '🌊', cooldown: 70, range: EBB_R, aim: 'self', ult: true,
        desc: 'ULTIMATE. Draws every foe within 8 m 5 m closer, crashes down on them all for 100 damage, then hurls every foe within 5 m 5 m away.',
        cast(h) {
          const foes = G.foesInRadius(h.team, h.x, h.y, EBB_R);
          if (!foes.length) return false;
          h.playCast(3);
          // Ebb: the water draws back, dragging them in.
          G.addFx('whirlpool', { x: h.x, y: h.y, r: EBB_R, dur: 0.9 });
          for (const e of foes) G.knock(e, h.x, h.y, -G.m(5), 0.4);
          G.after(0.45, () => {
            if (h.dead) return;
            for (const e of foes) G.hurt(h, e, 100, { color: '#9fefff' });
            G.addFx('pillar', { x: h.x, y: h.y, dur: 0.5, color: 0x5fd8e8, r: 70 });
            G.burst(h.x, h.y, '#9fefff', 40, 320);
            // Flow: the wave breaks outward.
            G.after(0.1, () => {
              if (h.dead) return;
              for (const e of G.foesInRadius(h.team, h.x, h.y, FLOW_R)) G.knock(e, h.x, h.y, G.m(5), 0.4);
              G.addFx('ring', { x: h.x, y: h.y, r0: 20, r1: FLOW_R + G.m(5), dur: 0.5, color: 0x5fd8e8 });
            });
          });
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 7. Trapper — Vermling hunter (ranged)
  // =====================================================================================
  function placeTrap(h, x, y, armT, dur) {
    const mine = G.fx.filter(o => o.kind === 'trap' && o.owner === h && !o.sprung && !o.dead);
    if (mine.length >= 8) mine[0].dead = true;
    return G.addFx('trap', { x, y, r: 34, dur, armT, owner: h, team: h.team, sprung: 0,
      tick(o, dt) {
        if (o.sprung) { if ((o.sprung += dt) > 1) o.dead = true; return; }
        if (o.t < o.armT) return;
        const e = G.foesInRadius(h.team, o.x, o.y, o.r, { buildings: false })[0];
        if (!e) return;
        o.sprung = 0.001;
        G.hurt(h, e, 90); G.root(e, 2);
        G.burst(o.x, o.y, '#d8b060', 18, 180);
      } });
  }
  const TRAPPER = {
    id: 'trapper', name: 'Trapper', lore: 'Vermling', role: 'Ranged',
    color: 0xd8b060, css: '#d8b060', r: 16, barH: 90,
    desc: 'A wiry rat-folk hunter with a repeating crossbow, a harpoon gun and more steel jaws than sense.',
    hp: 1200, speed: 188,
    basic: { damage: 75, range: 430, cooldown: 1.0, ranged: true, projectile: 'quarrel', speed: 1150, muzzle: 34, color: '#e8d8a0' },
    passive: { name: 'Predator', icon: '⌖', desc: 'Basic attacks deal 50% more damage to rooted, stunned or slowed foes.' },
    onBasicHit(h, t, dmg) { return t.impaired && G.passiveOn(h) ? dmg * 1.5 : dmg; },
    passiveText: h => String(G.fx.filter(o => o.kind === 'trap' && o.owner === h && !o.sprung).length || ''),
    abilities: [
      { key: 'q', name: 'Harpoon', icon: '⚓', cooldown: 7, range: 620, aim: 'dir',
        desc: 'Fires a chained harpoon 620 forward. The first foe hit takes 55 damage and is reeled in to the Trapper.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0);
          const chain = G.addFx('chain', { a: h, dur: 2 });
          const p = G.spawnProjectile({ x: h.x, y: h.y, h: 36, angle: a, speed: 1250, range: 620, r: 12, team: h.team, color: '#c8c8c8',
            style: 'harpoon', trail: null,
            onHit(e) {
              G.hurt(h, e, 55);
              chain.b = e; chain.dur = chain.t + 0.45;
              if (isUnit(e)) { const d = G.dist(h.x, h.y, e.x, e.y) - h.r - e.r - 24; G.knock(e, h.x, h.y, -Math.max(0, d), 0.4); G.stun(e, 0.4); }
            },
            onEnd() { chain.dead = true; } });
          chain.b = p;
          return true;
        } },
      { key: 'w', name: 'Bear Trap', icon: '⊓', cooldown: 2.5, range: 340, aim: 'point',
        desc: 'Sets a hidden bear trap (up to 8 out, each lasting 45s). It arms after 0.8s; the first foe to step on it takes 90 damage and is rooted for 2s.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 340); h.facing = angleTo(h, p.x, p.y); h.playCast(1);
          placeTrap(h, p.x, p.y, 0.8, 45);
          return true;
        } },
      { key: 'e', name: 'Snare Net', icon: '⌗', cooldown: 11, range: 440, aim: 'point',
        desc: 'Lobs a weighted net that bursts open over a 130 radius: 30 damage and roots every foe caught for 1.5s. Passive — Predator: +50% basic damage against rooted, stunned or slowed foes.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 440); h.facing = angleTo(h, p.x, p.y); h.playCast(2);
          G.addFx('lob', { x0: h.x, y0: h.y, x: p.x, y: p.y, dur: 0.45, style: 'net',
            end() {
              for (const e of G.foesInRadius(h.team, p.x, p.y, 130)) { G.hurt(h, e, 30); G.root(e, 1.5); }
              G.addFx('net', { x: p.x, y: p.y, r: 130, dur: 1.6 });
            } });
          return true;
        } },
      { key: 'r', name: 'Killing Field', icon: '✣', cooldown: 60, range: 500, aim: 'point', ult: true,
        desc: 'ULTIMATE. Scatters 8 armed bear traps in a 210 ring for 15s and a spike burst in the middle: 80 damage and a 40% slow for 2s to every foe inside.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 500); h.facing = angleTo(h, p.x, p.y); h.playCast(3);
          for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2;
            G.after(i * 0.04, () => placeTrap(h, p.x + Math.cos(a) * 210, p.y + Math.sin(a) * 210, 0, 15));
          }
          for (const e of G.foesInRadius(h.team, p.x, p.y, 210)) { G.hurt(h, e, 80); G.slow(e, 0.4, 2); }
          G.addFx('spikes', { x: p.x, y: p.y, r: 210, dur: 0.9 });
          G.addFx('ring', { x: p.x, y: p.y, r0: 20, r1: 230, dur: 0.5, color: 0xd8b060 });
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 8. Pyroclast — Savvas magma elemental (ranged)
  // =====================================================================================
  function magmaBlast(h, x, y) {
    for (const e of G.foesInRadius(h.team, x, y, 100)) G.hurt(h, e, 65);
    G.addFx('ring', { x, y, r0: 10, r1: 110, dur: 0.35, color: 0xff7a30 });
    G.burst(x, y, '#ffb050', 26, 240);
  }
  const PYROCLAST = {
    id: 'pyroclast', name: 'Pyroclast', lore: 'Savvas', role: 'Ranged',
    color: 0xff6a20, css: '#ff8a40', r: 18, barH: 107,
    desc: 'A living shard of the world’s molten heart, cracked obsidian over a furnace that never cools.',
    hp: 1350, speed: 175,
    basic: { damage: 75, range: 400, cooldown: 1.2, ranged: true, projectile: 'ember', speed: 850, muzzle: 52, color: '#ff9a40' },
    passive: { name: 'Kindling', icon: '♨', desc: "All of the Pyroclast's damage sets foes ablaze: 6 damage per second for 3s (refreshes)." },
    afterDamage(h, t) { if (G.passiveOn(h)) G.burn(t, 6, 3, 'kindling', '#ff9a40', h); },
    abilities: [
      { key: 'q', name: 'Magma Bolt', icon: '☄', cooldown: 4, range: 650, aim: 'dir',
        desc: 'Hurls a glob of magma 650 forward that bursts on the first foe (or at the end of its flight) for 65 damage in a 100 radius.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0);
          G.spawnProjectile({ x: h.x, y: h.y, h: 50, angle: a, speed: 900, range: 650, r: 14, team: h.team, color: '#ff8a30',
            style: 'magma', onHit(e, p) { magmaBlast(h, p.x, p.y); }, onEnd(p) { magmaBlast(h, p.x, p.y); } });
          return true;
        } },
      { key: 'w', name: 'Wall of Fire', icon: '▤', cooldown: 12, range: 420, aim: 'point',
        desc: 'Raises a 320-long wall of fire across the target point for 5s. Foes in it burn for 40 damage per second.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 420), a = angleTo(h, p.x, p.y); h.facing = a; h.playCast(1);
          const nx = -Math.sin(a) * 160, ny = Math.cos(a) * 160;
          const x1 = p.x + nx, y1 = p.y + ny, x2 = p.x - nx, y2 = p.y - ny;
          G.addFx('firewall', { x: p.x, y: p.y, x1, y1, x2, y2, w: 60, dur: 5,
            tick: pulse(0.25, () => {
              for (const e of G.foesInLine(h.team, x1, y1, x2, y2, 60)) {
                if (isUnit(e)) G.burn(e, 40, 0.5, 'firewall', '#ff7a30', h); else G.hurt(h, e, 10);
              }
            }) });
          return true;
        } },
      { key: 'e', name: 'Searing Breath', icon: '♆', cooldown: 9, range: 270, aim: 'dir',
        desc: 'Exhales a cone of white-hot fire (270 reach): 55 damage, then 14 burn damage per second for 4s. Passive — Kindling: all damage burns foes for 6 per second over 3s.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(2);
          for (const e of G.foesInCone(h.team, h.x, h.y, a, 270, 0.62)) { G.hurt(h, e, 55); G.burn(e, 14, 4, 'sear', '#ffd080', h); }
          G.addFx('cone', { x: h.x, y: h.y, angle: a, r: 270, arc: 1.24, dur: 0.5, color: 0xff7a30, fire: true });
          return true;
        } },
      { key: 'r', name: 'Eruption', icon: '🌋', cooldown: 75, range: 650, aim: 'point', ult: true,
        desc: 'ULTIMATE. Splits the ground into a 240-radius magma field for 4.5s (25 burn damage per second) while 12 meteors crash down over it, each dealing 70 damage in a 90 radius.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 650); h.facing = angleTo(h, p.x, p.y); h.playCast(3);
          G.addFx('magma', { x: p.x, y: p.y, r: 240, dur: 4.5,
            tick: pulse(0.25, () => {
              for (const e of G.foesInRadius(h.team, p.x, p.y, 240)) {
                if (isUnit(e)) G.burn(e, 25, 0.4, 'magma', '#ff7a30', h); else G.hurt(h, e, 6);
              }
            }) });
          G.repeat(12, 0.2, () => {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 220;
            const mx = p.x + Math.cos(a) * d, my = p.y + Math.sin(a) * d;
            G.addFx('meteor', { x: mx, y: my, dur: 0.55,
              end() {
                for (const e of G.foesInRadius(h.team, mx, my, 90)) G.hurt(h, e, 70);
                G.addFx('ring', { x: mx, y: my, r0: 10, r1: 100, dur: 0.35, color: 0xff7a30 });
                G.burst(mx, my, '#ffb050', 22, 260);
              } });
          });
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 9. Drifter — Inox veteran (melee bruiser)
  // =====================================================================================
  const FURY_REACH = G.m(7), FURY_HALF = 0.6;
  const EMPOWER_HITS = 4, EMPOWER_TIME = 7;
  const SHOCK_R = G.m(1);
  const STACK_STEP = 0.05, STACK_MAX = 8, STACK_WAIT = 4;
  const ODDS_REACH = G.m(12), ODDS_R = G.m(2);
  const DRIFTER = {
    id: 'drifter', name: 'Drifter', lore: 'Inox', role: 'Melee',
    color: 0xf0c070, css: '#f0c070', r: 21, barH: 120,
    desc: 'A grizzled old Inox who should have retired years ago, still swinging a great two-handed hammer with a whole lifetime of road behind every blow.',
    hp: 1500, speed: 168,
    basic: { damage: 75, range: 36, cooldown: 1.3, impact: 0.2 },
    passive: { name: 'Stack Up', icon: '⇈', desc: `Every basic attack adds a stack: +${STACK_STEP * 100}% attack speed and move speed each, up to +${STACK_MAX * STACK_STEP * 100}%. The stacks fall away after ${STACK_WAIT}s without attacking.` },
    init(h) { Object.assign(h.state, { stacks: 0, stackT: 0, crush: 0, crushT: 0, shock: 0, shockT: 0 }); },
    update(h, dt) {
      const s = h.state;
      if (s.crush > 0 && (s.crushT -= dt) <= 0) s.crush = 0;
      if (s.shock > 0 && (s.shockT -= dt) <= 0) s.shock = 0;
      if (s.stacks > 0 && (s.stackT -= dt) <= 0) s.stacks = 0;
      if (s.stacks > 0 && G.passiveOn(h)) G.addBuff(h, 'stackUp', 0.2, { atk: s.stacks * STACK_STEP, speed: s.stacks * STACK_STEP });
      if ((s.crush > 0 || s.shock > 0) && Math.random() < 0.35)
        G.particles.push({ x: h.x + (Math.random() - 0.5) * h.r * 2, y: h.y, h: 40 + Math.random() * 40, vx: 0, vy: 0, life: 0.4, t: 0, color: s.crush > 0 ? '#ffb040' : '#d8c8a8', size: 3 });
    },
    onBasicHit(h, t, dmg) {
      const s = h.state;
      if (G.passiveOn(h)) { s.stacks = Math.min(STACK_MAX, s.stacks + 1); s.stackT = STACK_WAIT; }
      // Crushing Weight: double damage.
      if (s.crush > 0) {
        s.crush--; dmg *= 2;
        G.addFx('ring', { x: t.x, y: t.y, r0: 10, r1: 60, dur: 0.3, color: 0xffb040 });
      }
      // Shockwave: half the blow ripples into every other foe around the target.
      if (s.shock > 0) {
        s.shock--;
        for (const e of G.foesInRadius(h.team, t.x, t.y, SHOCK_R)) if (e !== t) G.hurt(h, e, dmg * 0.5);
        G.addFx('ring', { x: t.x, y: t.y, r0: 10, r1: SHOCK_R + 20, dur: 0.35, color: 0xd8c8a8 });
        G.burst(t.x, t.y, '#d8c8a8', 12, 160);
      }
      return dmg;
    },
    passiveText: h => [h.state.stacks ? '+' + Math.round(h.state.stacks * STACK_STEP * 100) + '%' : '',
      h.state.crush ? '×' + h.state.crush : '', h.state.shock ? '≋' + h.state.shock : ''].filter(Boolean).join(' '),
    abilities: [
      { key: 'q', name: 'Destructive Fury', icon: '⚒', cooldown: 7, range: FURY_REACH, aim: 'dir',
        desc: 'Brings the hammer down so hard the ground splits: 75 damage to every foe in a 7 m cone in front of him.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0); h.swing = 1;
          G.after(0.15, () => {
            if (h.dead) return;
            for (const e of G.foesInCone(h.team, h.x, h.y, a, FURY_REACH, FURY_HALF)) G.hurt(h, e, 75);
            G.addFx('cone', { x: h.x, y: h.y, angle: a, r: FURY_REACH, arc: FURY_HALF * 2, dur: 0.45, color: 0xf0c070 });
            G.burst(h.x + Math.cos(a) * 80, h.y + Math.sin(a) * 80, '#c8a878', 24, 260);
          });
          return true;
        } },
      { key: 'w', name: 'Crushing Weight', icon: '⬇', cooldown: 12, range: 0, aim: 'self',
        desc: `His next ${EMPOWER_HITS} basic attacks deal double damage. Ends after ${EMPOWER_TIME}s if they are not all used.`,
        cast(h) {
          h.playCast(1);
          h.state.crush = EMPOWER_HITS; h.state.crushT = EMPOWER_TIME;
          G.addFx('ring', { x: h.x, y: h.y, r0: 90, r1: 10, dur: 0.35, color: 0xffb040 });
          G.burst(h.x, h.y, '#ffb040', 18, 160);
          return true;
        } },
      { key: 'e', name: 'Shockwave', icon: '≋', cooldown: 12, range: 0, aim: 'self',
        desc: `His next ${EMPOWER_HITS} basic attacks also deal 50% of their damage to every other foe within 1 m of the target. Ends after ${EMPOWER_TIME}s. Passive — Stack Up: each basic attack gives +${STACK_STEP * 100}% attack and move speed (max +${STACK_MAX * STACK_STEP * 100}%), lost after ${STACK_WAIT}s without attacking.`,
        cast(h) {
          h.playCast(2);
          h.state.shock = EMPOWER_HITS; h.state.shockT = EMPOWER_TIME;
          G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 110, dur: 0.35, color: 0xd8c8a8 });
          return true;
        } },
      { key: 'r', name: 'Against All Odds', icon: '⤒', cooldown: 60, range: ODDS_REACH, aim: 'point', ult: true,
        desc: 'ULTIMATE. Leaps up to 12 m and lands with a crushing thud: 200 damage to every foe within a 4 m wide circle.',
        cast(h, tx, ty) {
          const spot = G.openSpot(h, tx, ty, ODDS_REACH) || { x: h.x, y: h.y };
          h.playCast(3); h.attackTarget = null; h.target = null;
          G.burst(h.x, h.y, '#c8a878', 14, 160);
          h.dash = { tx: spot.x, ty: spot.y, speed: 950, arc: 140, trail: '#f0c070',
            onArrive() {
              for (const e of G.foesInRadius(h.team, h.x, h.y, ODDS_R)) G.hurt(h, e, 200);
              G.addFx('ring', { x: h.x, y: h.y, r0: 20, r1: ODDS_R + 30, dur: 0.45, color: 0xf0c070 });
              G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: ODDS_R * 1.8, dur: 0.6, color: 0xc8a878 });
              G.burst(h.x, h.y, '#c8a878', 40, 320);
            } };
          return true;
        } }
    ]
  };

  G.HEROES = [BANNERSPEAR, BONESHAPER, DEATHWALKER, GEMINATE, BLINKBLADE, CRUSHING_TIDE, TRAPPER, PYROCLAST, DRIFTER];
  const byId = {};
  for (const h of G.HEROES) byId[h.id] = h;
  G.heroById = id => byId[id] || BANNERSPEAR;

  // Deaths tell every living hero: foes through onFoeDeath (Deathwalker), allies through onAllyDeath
  // (Boneshaper's Back Again).
  G.deathListeners.push((e, src) => {
    for (const h of G.entities) {
      if (!(h instanceof G.Hero) || h.dead || h === e) continue;
      if (e.team !== h.team) { if (h.def.onFoeDeath) h.def.onFoeDeath(h, e, src); }
      else if (h.def.onAllyDeath) h.def.onAllyDeath(h, e);
    }
  });

  // Unlocked (see unlocks.js), free to act, off cooldown.
  G.canCast = function (hero, ability) {
    if (!G.isUnlocked(hero, ability.key)) return false;
    if (hero.dead || hero.stunned || hero.dash || (hero.state.cutting > 0)) return false;
    return !((hero.cooldowns[ability.key] || 0) > 0);
  };
  G.tryCast = function (hero, ability, tx, ty) {
    if (!G.canCast(hero, ability)) return false;
    if (!ability.cast(hero, tx, ty)) return false;
    hero.cooldowns[ability.key] = ability.cooldown;
    if (hero.def.onCast) hero.def.onCast(hero, ability);
    return true;
  };
})(window.Game);
