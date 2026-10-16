// Heroes: nine mercenaries any race can hire. Each definition carries stats, a basic attack, four
// abilities (Q W E R: the third also has a passive, the fourth is the ultimate) and optional hooks:
//   init(h), update(h, dt)          per-hero state
//   onBasicHit(h, t, dmg) -> dmg    adjust a basic attack as it lands
//   onDamage(h, t, amt) -> amt      adjust any damage the hero deals (G.hurt)
//   afterDamage(h, t, dealt)        react to damage dealt
//   onFoeDeath(h, e, src)           a foe died (anywhere); src.hero dealt the killing blow
//   onCast(h, ability)              an ability was just cast
//   onAllyDeath(h, e)               an ally died (anywhere)
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
    hp: 750, speed: 172,
    basic: { damage: 40, range: 46, cooldown: 1.05, impact: 0.14 },
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
    hp: 450, speed: 168,
    basic: { damage: 40, range: G.m(8), cooldown: 1.15, ranged: true, projectile: 'boneShard', speed: 850, muzzle: 62, color: '#cfeed8' },
    passive: { name: 'Rally the Dead', icon: '☠', desc: 'Her skeletons and Bone Balls within 12 m of her take 20% less damage.' },
    init(h) { h.state.backAgain = 0; h.state.rallied = 0; },
    update(h, dt) {
      let n = 0;
      for (const sq of G.passiveOn(h) ? G.squads : []) {
        if (sq.summoner !== h || !UNDEAD.has(sq.kind)) continue;
        for (const s of sq.alive) if (G.dist(s.x, s.y, h.x, h.y) <= RALLY_RANGE) { G.addBuff(s, 'rallyDead', 0.2, { armor: 0.2 }); n++; }
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
        desc: `Raises two Skeleton warriors, Doug and Doug (70 HP, 15 damage each), that fight for ${SKELETON_LIFE}s.`,
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
        desc: 'Sends a dark cloud (2 m radius) drifting slowly 15 m forward. Every foe it touches takes 15 damage and is slowed 50% and attacks 50% slower for 2s.',
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
                G.hurt(h, e, 15, { color: '#b8a0d8' }); G.slow(e, 0.5, 2); G.addBuff(e, 'curse', 2, { atk: -0.5 });
              }
            } });
          return true;
        } },
      { key: 'e', name: 'Back Again', icon: '⚰', cooldown: 20, range: 0, aim: 'self',
        desc: 'For 3s, every ally (other than skeletons) that dies within 10 m of her rises again as a Skeleton warrior. Passive — Rally the Dead: her skeletons and Bone Balls within 12 m take 20% less damage.',
        cast(h) {
          h.playCast(2);
          h.state.backAgain = 3;
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
    hp: 450, speed: 180,
    basic: { damage: 40, range: 44, cooldown: 1.1, impact: 0.14 },
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
  const GEM_RANGED = { damage: 19, range: 400, cooldown: 0.95, ranged: true, projectile: 'twinOrb', speed: 950, muzzle: 48, color: '#6ff0e0' };
  const GEM_MELEE = { damage: 30, range: 30, cooldown: 0.85, impact: 0.1 };
  function setForm(h, f) {
    if (h.form === f) return;
    h.form = f;
    G.burst(h.x, h.y, f === 'melee' ? '#ff6fb8' : '#6ff0e0', 26, 220);
    G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 90, dur: 0.35, color: f === 'melee' ? 0xff6fb8 : 0x6ff0e0 });
  }
  const GEMINATE = {
    id: 'geminate', name: 'Geminate', lore: 'Harrower', role: 'Ranged / Melee',
    color: 0x6ff0e0, css: '#6ff0e0', r: 18, barH: 108,
    desc: 'Two insect minds in one chitin shell, shifting between a far-casting form and a whirling blade form.',
    hp: 500, speed: 185, startForm: 'ranged',
    basic: GEM_RANGED,
    formBasic: h => (h.form === 'melee' ? GEM_MELEE : GEM_RANGED),
    passive: { name: 'Duality', icon: '☯', desc: 'Ranged form moves 15% faster. Melee form heals for 15% of damage dealt.' },
    init(h) { h.form = 'ranged'; h.state.empower = 0; h.state.resonance = 0; },
    update(h, dt) {
      if (h.form === 'ranged' && G.passiveOn(h)) G.addBuff(h, 'duality', 0.2, { speed: 0.15 });
      h.state.empower = Math.max(0, h.state.empower - dt);
      h.state.resonance = Math.max(0, h.state.resonance - dt);
    },
    afterDamage(h, t, dealt) { if (h.form === 'melee' && G.passiveOn(h)) G.mend(h, dealt * 0.15); },
    onBasicHit(h, t, dmg) {
      if (h.state.empower > 0) { dmg *= 2; h.state.empower = 0; G.addFx('ring', { x: t.x, y: t.y, r0: 10, r1: 70, dur: 0.3, color: 0xffffff }); }
      if (h.state.resonance > 0) {
        const others = G.foesInRadius(h.team, t.x, t.y, 220).filter(e => e !== t).slice(0, 2);
        for (const e of others) {
          G.hurt(h, e, dmg * 0.6);
          G.addFx('arc', { x: t.x, y: t.y, x2: e.x, y2: e.y, dur: 0.25, color: h.form === 'melee' ? 0xff6fb8 : 0x6ff0e0 });
        }
      }
      return dmg;
    },
    passiveText: h => (h.form === 'melee' ? 'Blade' : 'Orb'),
    abilities: [
      { key: 'q', name: 'Twin Strike', icon: '♊', cooldown: 4, range: 600, aim: 'point',
        desc: 'Orb form: looses two seeking orbs at foes near the target point, 50 damage each. Blade form: a whirling double slash for 70 damage to all foes within 140.',
        cast(h, tx, ty) {
          h.playCast(0);
          if (h.form === 'melee') {
            for (const e of G.foesInRadius(h.team, h.x, h.y, 140)) G.hurt(h, e, 70);
            G.addFx('slash', { x: h.x, y: h.y, angle: h.facing, arc: Math.PI * 2, r: 140, dur: 0.35, color: 0xff6fb8 });
            G.addFx('slash', { x: h.x, y: h.y, angle: h.facing + Math.PI, arc: Math.PI * 2, r: 110, dur: 0.4, color: 0x6ff0e0, spin: -1 });
            return true;
          }
          const a = angleTo(h, tx, ty); h.facing = a;
          const near = G.foesOf(h.team).filter(e => G.dist(e.x, e.y, tx, ty) < 300 && G.dist(e.x, e.y, h.x, h.y) < 650)
            .sort((p, q) => G.dist(p.x, p.y, tx, ty) - G.dist(q.x, q.y, tx, ty));
          [-0.35, 0.35].forEach((off, i) => {
            const t = near.length ? near[i % near.length] : null;
            G.spawnProjectile({ x: h.x, y: h.y, h: 48, angle: a + off, speed: 900, range: 650, r: 10, team: h.team,
              color: i ? '#ff6fb8' : '#6ff0e0', style: 'twinOrb', homing: t, onHit(e) { G.hurt(h, e, 50); } });
          });
          return true;
        } },
      { key: 'w', name: 'Phase Shift', icon: '⇋', cooldown: 7, range: 280, aim: 'point',
        desc: 'Darts up to 280 and switches form (orb ⇄ blade). The next basic attack within 3s deals double damage.',
        cast(h, tx, ty) {
          h.playCast(1);
          const spot = G.openSpot(h, tx, ty, 280);
          const swap = () => { setForm(h, h.form === 'melee' ? 'ranged' : 'melee'); h.state.empower = 3; };
          if (!spot) { swap(); return true; }
          h.dash = { tx: spot.x, ty: spot.y, speed: 1300, hit: new Set(), trail: h.form === 'melee' ? '#ff6fb8' : '#6ff0e0', onArrive: swap };
          return true;
        } },
      { key: 'e', name: 'Resonance', icon: '≋', cooldown: 14, range: 0, aim: 'self',
        desc: 'For 6s basic attacks arc to 2 more foes within 220 for 60% damage. Passive — Duality: orb form +15% move speed, blade form heals 15% of damage dealt.',
        cast(h) {
          h.playCast(2);
          h.state.resonance = 6;
          G.addFx('ring', { x: h.x, y: h.y, r0: 20, r1: 220, dur: 0.5, color: 0xffffff });
          return true;
        } },
      { key: 'r', name: 'Convergence', icon: '✺', cooldown: 65, range: 550, aim: 'self', ult: true,
        desc: 'ULTIMATE. Roots itself for 0.8s while both minds spin out 16 chitin shards that spiral outward, then dive at foes within 550 for 40 damage each.',
        cast(h) {
          const foes = G.foesOf(h.team).filter(e => G.dist(e.x, e.y, h.x, h.y) < 550 + (e.r || 0));
          if (!foes.length) return false;
          h.playCast(3); G.root(h, 0.8); h.target = null;
          const shards = [];
          for (let i = 0; i < 16; i++) shards.push({ a: i / 16 * Math.PI * 2, x: h.x, y: h.y, h: 50, target: foes[i % foes.length], done: false, color: i % 2 ? 0xff6fb8 : 0x6ff0e0 });
          G.addFx('shards', { x: h.x, y: h.y, dur: 2.2, owner: h, shards,
            tick(o, dt) {
              for (const s of o.shards) {
                if (s.done) continue;
                if (o.t < 0.8) {
                  // Spiral out around the Geminate.
                  const k = o.t / 0.8, a = s.a + o.t * 7;
                  s.x = h.x + Math.cos(a) * (40 + k * 120); s.y = h.y + Math.sin(a) * (40 + k * 120); s.h = 50 + k * 60;
                  continue;
                }
                const t = s.target.dead ? null : s.target;
                if (!t) { s.done = true; G.burst(s.x, s.y, '#ffffff', 4, 60); continue; }
                const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy), step = 1000 * dt;
                s.h = Math.max(30, s.h - 140 * dt);
                if (d <= step + (t.r || 0) * 0.5) { s.done = true; G.hurt(h, t, 40); G.burst(t.x, t.y, s.color === 0xff6fb8 ? '#ff6fb8' : '#6ff0e0', 8, 140); continue; }
                s.x += dx / d * step; s.y += dy / d * step;
              }
              if (o.t > 0.8 && o.shards.every(s => s.done)) o.dead = true;
            } });
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
    hp: 600, speed: 205,
    basic: { damage: 40, range: 26, cooldown: 0.85, impact: 0.08 },
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
  const CRUSHING_TIDE = {
    id: 'crushingtide', name: 'Crushing Tide', lore: 'Lurker', role: 'Melee',
    color: 0x3fc8d8, css: '#5fd8e8', r: 23, barH: 98,
    desc: 'A colossal crab-knight of the deep who breaks lines with its crusher claw and drowns armies in the tide.',
    hp: 780, speed: 160,
    basic: { damage: 28, range: 34, cooldown: 1.3, impact: 0.2 },
    passive: { name: 'Rising Tide', icon: '≈', desc: 'Each basic attack hit adds a Tide stack for 5s (max 5). Each stack gives 6% damage reduction.' },
    init(h) { h.state.tide = 0; h.state.tideT = 0; },
    update(h, dt) { if (h.state.tide && (h.state.tideT -= dt) <= 0) h.state.tide = 0; },
    onBasicHit(h, t, dmg) { if (G.passiveOn(h)) { h.state.tide = Math.min(5, h.state.tide + 1); h.state.tideT = 5; } return dmg; },
    armor: h => h.state.tide * 0.06,
    passiveText: h => (h.state.tide ? '×' + h.state.tide : ''),
    abilities: [
      { key: 'q', name: 'Riptide Claw', icon: '♋', cooldown: 5, range: 180, aim: 'dir',
        desc: 'A sweeping crusher-claw blow across a wide cone in front (180 reach): 70 damage and a heavy knockback.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0);
          G.after(0.15, () => {
            for (const e of G.foesInCone(h.team, h.x, h.y, a, 180, 0.95)) { G.hurt(h, e, 70); G.knock(e, h.x, h.y, 100, 0.3); }
            G.addFx('cone', { x: h.x, y: h.y, angle: a, r: 180, arc: 1.9, dur: 0.4, color: 0x5fe0e8 });
          });
          return true;
        } },
      { key: 'w', name: 'Coral Carapace', icon: '⬢', cooldown: 12, range: 0, aim: 'self',
        desc: 'Grows a coral shell absorbing 200 damage for 5s. When it breaks or fades it bursts, dealing 70 damage to foes within 150.',
        cast(h) {
          h.playCast(1);
          G.shield(h, 200, 5, 0xff8a7a, () => {
            if (h.dead) return;
            for (const e of G.foesInRadius(h.team, h.x, h.y, 150)) G.hurt(h, e, 70);
            G.addFx('ring', { x: h.x, y: h.y, r0: 20, r1: 160, dur: 0.4, color: 0xff8a7a });
            G.burst(h.x, h.y, '#ff9a8a', 30, 260);
          });
          return true;
        } },
      { key: 'e', name: 'Undertow', icon: '◎', cooldown: 13, range: 400, aim: 'point',
        desc: 'Opens a whirlpool (170 radius) that drags every foe inside to its center for 45 damage and slows them 40% for 2s. Passive — Rising Tide: basic hits stack 6% damage reduction (up to 5).',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 400); h.facing = angleTo(h, p.x, p.y); h.playCast(2);
          G.addFx('whirlpool', { x: p.x, y: p.y, r: 170, dur: 1.3 });
          for (const e of G.foesInRadius(h.team, p.x, p.y, 170)) {
            G.hurt(h, e, 45);
            if (isUnit(e)) { G.knock(e, p.x, p.y, -G.dist(e.x, e.y, p.x, p.y), 0.55); G.slow(e, 0.4, 2); }
          }
          return true;
        } },
      { key: 'r', name: 'Tsunami', icon: '🌊', cooldown: 70, range: 900, aim: 'dir', ult: true,
        desc: 'ULTIMATE. Calls a 280-wide wall of water that rolls 900 forward. Every foe it reaches takes 150 damage, is swept 200 along and stunned for 1s.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(3);
          G.addFx('wave', { x0: h.x - Math.cos(a) * 30, y0: h.y - Math.sin(a) * 30, x: h.x, y: h.y, angle: a, len: 900, width: 280, speed: 750,
            dur: 900 / 750 + 0.3, team: h.team, hit: new Set(),
            tick(o) { sweep(o, e => { G.hurt(h, e, 150); G.stun(e, 1); G.push(e, a, 200, 0.4); }); } });
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
    hp: 460, speed: 188,
    basic: { damage: 18, range: 430, cooldown: 1.0, ranged: true, projectile: 'quarrel', speed: 1150, muzzle: 34, color: '#e8d8a0' },
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
    hp: 450, speed: 175,
    basic: { damage: 22, range: 400, cooldown: 1.2, ranged: true, projectile: 'ember', speed: 850, muzzle: 52, color: '#ff9a40' },
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
  // 9. Drifter — Inox wanderer (melee bruiser)
  // =====================================================================================
  const DRIFTER = {
    id: 'drifter', name: 'Drifter', lore: 'Inox', role: 'Melee',
    color: 0xf0c070, css: '#f0c070', r: 21, barH: 120,
    desc: 'A horned wanderer hauling a whole camp on his back, who swings a lantern-hung walking staff like a battering ram.',
    hp: 700, speed: 168,
    basic: { damage: 30, range: 36, cooldown: 1.3, impact: 0.2 },
    passive: { name: 'Long Road', icon: '⛰', desc: 'After walking for 2s, gains Momentum: +25% move speed, and the next basic attack deals 80% more damage and stuns for 0.6s.' },
    init(h) { h.state.walk = 0; h.state.momentum = false; },
    update(h, dt) {
      if (h.moving && G.passiveOn(h)) { h.state.walk += dt; if (h.state.walk >= 2 && !h.state.momentum) { h.state.momentum = true; G.burst(h.x, h.y, '#f0c070', 14, 140); } }
      else h.state.walk = 0;
      if (h.state.momentum && h.moving) G.addBuff(h, 'longroad', 0.2, { speed: 0.25 });
    },
    onBasicHit(h, t, dmg) {
      if (!h.state.momentum) return dmg;
      h.state.momentum = false; h.state.walk = 0;
      G.stun(t, 0.6);
      G.addFx('ring', { x: t.x, y: t.y, r0: 10, r1: 80, dur: 0.3, color: 0xf0c070 });
      return dmg * 1.8;
    },
    passiveText: h => (h.state.momentum ? '!' : ''),
    abilities: [
      { key: 'q', name: 'Staff Sweep', icon: '↻', cooldown: 5, range: 140, aim: 'self',
        desc: 'Spins the heavy walking staff in a full circle: 60 damage to all foes within 140, knocking them back.',
        cast(h) {
          h.playCast(0);
          G.after(0.12, () => {
            for (const e of G.foesInRadius(h.team, h.x, h.y, 140)) { G.hurt(h, e, 60); G.knock(e, h.x, h.y, 80, 0.25); }
            G.addFx('slash', { x: h.x, y: h.y, angle: h.facing, arc: Math.PI * 2, r: 140, dur: 0.4, color: 0xf0c070 });
          });
          return true;
        } },
      { key: 'w', name: 'Long Stride', icon: '⇶', cooldown: 9, range: 360, aim: 'point',
        desc: 'Covers 360 in a few great strides, dealing 40 damage to foes in the path and slowing them 40% for 2s.',
        cast(h, tx, ty) {
          const spot = G.openSpot(h, tx, ty, 360);
          if (!spot) return false;
          h.playCast(1); h.attackTarget = null;
          h.dash = { tx: spot.x, ty: spot.y, speed: 800, width: 26, hit: new Set(), trail: '#d8c8a8',
            onPass(e) { G.hurt(h, e, 40); G.slow(e, 0.4, 2); } };
          return true;
        } },
      { key: 'e', name: 'Waystone Camp', icon: '⛺', cooldown: 18, range: 250, aim: 'point',
        desc: 'Pitches camp for 10s: allies within 200 of the fire heal 12 HP per second and move 20% faster. Passive — Long Road: walking 2s builds Momentum (+25% speed, next hit +80% damage and a 0.6s stun).',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 250); h.facing = angleTo(h, p.x, p.y); h.playCast(2);
          G.addFx('camp', { x: p.x, y: p.y, r: 200, dur: 10,
            tick: pulse(0.25, () => {
              for (const a of G.alliesOf(h.team)) {
                if (G.dist(a.x, a.y, p.x, p.y) > 200 + a.r) continue;
                G.mend(a, 3); G.addBuff(a, 'camp', 0.35, { speed: 0.2 });
              }
            }) });
          return true;
        } },
      { key: 'r', name: 'Great Migration', icon: '🐘', cooldown: 70, range: 1000, aim: 'dir', ult: true,
        desc: 'ULTIMATE. Calls a stampede of spectral mammoths down a 240-wide, 1000-long path. Foes trampled take 140 damage, are flung aside and stunned for 0.8s.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(3);
          G.addFx('stampede', { x0: h.x - Math.cos(a) * 120, y0: h.y - Math.sin(a) * 120, x: h.x, y: h.y, angle: a, len: 1100, width: 240, speed: 650,
            dur: 1100 / 650 + 0.4, team: h.team, hit: new Set(),
            tick(o) {
              sweep(o, (e, side) => {
                G.hurt(h, e, 140); G.stun(e, 0.8);
                G.push(e, a + (side >= 0 ? Math.PI / 2 : -Math.PI / 2), 140, 0.35);
              });
            } });
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
