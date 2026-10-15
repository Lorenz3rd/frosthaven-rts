// Heroes: nine mercenaries any race can hire. Each definition carries stats, a basic attack, four
// abilities (Q W E R: the third also has a passive, the fourth is the ultimate) and optional hooks:
//   init(h), update(h, dt)          per-hero state
//   onBasicHit(h, t, dmg) -> dmg    adjust a basic attack as it lands
//   onDamage(h, t, amt) -> amt      adjust any damage the hero deals (G.hurt)
//   afterDamage(h, t, dealt)        react to damage dealt
//   onFoeDeath(h, e)                a foe died (anywhere)
//   armor(h) -> fraction            extra damage reduction
//   passiveText(h) -> string        short counter shown on the HUD
// Ability: { key, name, icon, cooldown, mana, range, aim: 'dir'|'point'|'foe'|'self', desc, cast(h, tx, ty) }.
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
  function bannerZone(h, x, y, big) {
    const r = big ? 270 : 230;
    G.addFx('banner', {
      x, y, r, big, team: h.team, dur: big ? 10 : 8,
      tick: pulse(0.25, () => {
        for (const a of G.alliesOf(h.team)) {
          if (G.dist(a.x, a.y, x, y) > r + a.r) continue;
          if (big) G.addBuff(a, 'vanguard', 0.35, { dmg: 0.25, armor: 0.25 });
          else { G.addBuff(a, 'rally', 0.35, { atk: 0.3 }); G.mend(a, 2); }
        }
      })
    });
  }
  const BANNERSPEAR = {
    id: 'bannerspear', name: 'Bannerspear', lore: 'Human', role: 'Melee',
    color: 0xe8c060, css: '#e8c060', r: 19, barH: 150,
    desc: 'A shield-and-spear tactician who fights at the head of the line and plants rallying banners.',
    hp: 640, mana: 200, speed: 172,
    basic: { damage: 24, range: 46, cooldown: 1.05, impact: 0.14 },
    passive: { name: 'Shield Wall', icon: '⛨', desc: 'Takes 10% less damage, plus 4% more for each allied soldier within 260 (up to 40%).' },
    armor(h) {
      let n = 0;
      for (const e of G.entities) if (e instanceof G.Soldier && !e.dead && e.team === h.team && G.dist(e.x, e.y, h.x, h.y) < 260) n++;
      return Math.min(0.4, 0.1 + n * 0.04);
    },
    passiveText: h => Math.round(h.armor() * 100) + '%',
    abilities: [
      { key: 'q', name: 'Phalanx Thrust', icon: '➶', cooldown: 5, mana: 35, range: 250, aim: 'dir',
        desc: 'Drives the spear forward through a 250-long line, dealing 70 damage to every foe in it and shoving them back.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0);
          const ex = h.x + Math.cos(a) * 250, ey = h.y + Math.sin(a) * 250;
          for (const e of G.foesInLine(h.team, h.x, h.y, ex, ey, 70)) { G.hurt(h, e, 70); G.push(e, a, 45, 0.2); }
          G.addFx('thrust', { x: h.x, y: h.y, x2: ex, y2: ey, w: 70, dur: 0.35, color: 0xffe08a });
          return true;
        } },
      { key: 'w', name: 'Shield Rush', icon: '⛊', cooldown: 9, mana: 45, range: 340, aim: 'point',
        desc: 'Charges behind the shield up to 340, dealing 45 damage to foes in the path, knocking them aside and slowing them 30% for 1.5s.',
        cast(h, tx, ty) {
          const spot = G.openSpot(h, tx, ty, 340);
          if (!spot) return false;
          h.playCast(1); h.attackTarget = null;
          h.dash = { tx: spot.x, ty: spot.y, speed: 950, width: 26, hit: new Set(), trail: '#e8c060',
            onPass(e) { G.hurt(h, e, 45); G.knock(e, h.x, h.y, 90, 0.25); G.slow(e, 0.3, 1.5); } };
          return true;
        } },
      { key: 'e', name: 'Rally Banner', icon: '⚑', cooldown: 16, mana: 60, range: 380, aim: 'point',
        desc: 'Plants a war banner for 8s. Allies within 230 attack 30% faster and heal 8 HP per second. Passive — Shield Wall: takes 10% less damage, +4% per allied soldier within 260 (max 40%).',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 380); h.facing = angleTo(h, p.x, p.y); h.playCast(2);
          bannerZone(h, p.x, p.y, false);
          G.addFx('ring', { x: p.x, y: p.y, r0: 20, r1: 230, dur: 0.5, color: 0xe8c060 });
          return true;
        } },
      { key: 'r', name: "Vanguard's Stand", icon: '♛', cooldown: 60, mana: 100, range: 520, aim: 'point', ult: true,
        desc: 'ULTIMATE. Leaps up to 520 and slams down a great standard: 150 damage and a 1.2s stun in a 220 radius. For 10s allies near the standard deal 25% more damage and take 25% less.',
        cast(h, tx, ty) {
          const spot = G.openSpot(h, tx, ty, 520) || { x: h.x, y: h.y };
          h.playCast(3); h.attackTarget = null;
          h.dash = { tx: spot.x, ty: spot.y, speed: 820, arc: 150, hit: new Set(), trail: '#ffe08a',
            onArrive() {
              for (const e of G.foesInRadius(h.team, h.x, h.y, 220)) { G.hurt(h, e, 150); G.stun(e, 1.2); }
              G.addFx('ring', { x: h.x, y: h.y, r0: 30, r1: 260, dur: 0.6, color: 0xffd060 });
              G.addFx('pillar', { x: h.x, y: h.y, dur: 0.8, color: 0xffe08a, r: 60 });
              G.burst(h.x, h.y, '#ffe08a', 40, 320);
              bannerZone(h, h.x, h.y, true);
            } };
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 2. Boneshaper — Aesther necromancer (ranged summoner)
  // =====================================================================================
  const BONESHAPER = {
    id: 'boneshaper', name: 'Boneshaper', lore: 'Aesther', role: 'Ranged',
    color: 0x8fe8a8, css: '#9ff0b8', r: 18, barH: 165,
    desc: 'A grave-robbing necromancer who shapes the fallen into skeletal servants and walking bone fortresses.',
    hp: 470, mana: 240, speed: 168,
    basic: { damage: 18, range: 400, cooldown: 1.15, ranged: true, projectile: 'boneShard', speed: 850, muzzle: 62, color: '#cfeed8' },
    passive: { name: 'Grave Harvest', icon: '☠', desc: 'When a foe dies within 550, gains 8 mana and heals 12 HP. Every 6th harvest raises a free Skeleton for 20s.' },
    init(h) { h.state.souls = 0; h.state.orbit = 0; h.state.orbitAcc = 0; },
    update(h, dt) {
      if (h.state.orbit > 0) {
        h.state.orbit -= dt;
        if ((h.state.orbitAcc += dt) >= 0.5) {
          h.state.orbitAcc = 0;
          for (const e of G.foesInRadius(h.team, h.x, h.y, 120, { buildings: false })) G.hurt(h, e, 15, { color: '#cfeed8' });
        }
      }
    },
    onFoeDeath(h, e) {
      if (G.dist(h.x, h.y, e.x, e.y) > 550) return;
      h.mana = Math.min(h.maxMana, h.mana + 8);
      G.heal(h, 12);
      G.addFx('soul', { x: e.x, y: e.y, to: h, dur: 0.6, color: 0x9ff0b8 });
      if (++h.state.souls % 6 === 0) {
        G.summon(h, 'skeletonSolo', e.x, e.y, 20);
        G.addFx('grave', { x: e.x, y: e.y, r: 50, dur: 0.8 });
      }
    },
    passiveText: h => (h.state.souls % 6) + '/6',
    abilities: [
      { key: 'q', name: 'Bone Spear', icon: '➹', cooldown: 4, mana: 30, range: 700, aim: 'dir',
        desc: 'Hurls a jagged spear of bone 700 forward. It pierces every foe in its path for 65 damage and slows them 30% for 1.5s.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0);
          G.spawnProjectile({ x: h.x, y: h.y, h: 50, angle: a, speed: 1100, range: 700, r: 16, team: h.team, color: '#cfeed8',
            style: 'boneSpear', pierce: true, onHit(e) { G.hurt(h, e, 65); G.slow(e, 0.3, 1.5); } });
          return true;
        } },
      { key: 'w', name: 'Raise Dead', icon: '☗', cooldown: 14, mana: 60, range: 350, aim: 'point',
        desc: 'Tears open the frozen earth and raises 3 Skeleton warriors (70 HP, 15 damage) that fight for 20s.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 350); h.facing = angleTo(h, p.x, p.y); h.playCast(1);
          G.addFx('grave', { x: p.x, y: p.y, r: 90, dur: 1 });
          G.after(0.25, () => G.summon(h, 'skeleton', p.x, p.y, 20));
          return true;
        } },
      { key: 'e', name: 'Bone Armor', icon: '⛉', cooldown: 12, mana: 45, range: 0, aim: 'self',
        desc: 'Wraps in orbiting bone plates for 6s: a shield absorbing 140 damage, and the plates deal 15 damage every 0.5s to foes within 120. Passive — Grave Harvest: foes dying within 550 restore 8 mana and 12 HP; every 6th raises a free Skeleton.',
        cast(h) {
          h.playCast(2);
          G.shield(h, 140, 6, 0xbff0c8);
          h.state.orbit = 6;
          G.addFx('ring', { x: h.x, y: h.y, r0: 120, r1: 30, dur: 0.4, color: 0xbff0c8 });
          return true;
        } },
      { key: 'r', name: 'Bone Colossus', icon: '♜', cooldown: 75, mana: 120, range: 300, aim: 'point', ult: true,
        desc: 'ULTIMATE. Raises a towering Bone Colossus (750 HP, 42 cleaving damage) for 25s. Its emergence deals 100 damage and hurls back foes within 180.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 300); h.facing = angleTo(h, p.x, p.y); h.playCast(3);
          G.addFx('grave', { x: p.x, y: p.y, r: 180, dur: 1.2, big: true });
          G.addFx('pillar', { x: p.x, y: p.y, dur: 1.1, color: 0x9ff0b8, r: 80 });
          G.after(0.55, () => {
            for (const e of G.foesInRadius(h.team, p.x, p.y, 180)) { G.hurt(h, e, 100); G.knock(e, p.x, p.y, 120, 0.3); }
            G.addFx('ring', { x: p.x, y: p.y, r0: 30, r1: 200, dur: 0.5, color: 0x9ff0b8 });
            G.burst(p.x, p.y, '#cfeed8', 40, 300);
            G.summon(h, 'colossus', p.x, p.y, 25);
          });
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 3. Deathwalker — Valrath shadow reaper (ranged)
  // =====================================================================================
  function shadowPool(h, x, y) {
    G.addFx('shadowPool', { x, y, r: 120, dur: 3, team: h.team,
      tick: pulse(0.2, () => { for (const e of G.foesInRadius(h.team, x, y, 120, { buildings: false })) G.slow(e, 0.45, 0.4); }) });
  }
  const DEATHWALKER = {
    id: 'deathwalker', name: 'Deathwalker', lore: 'Valrath', role: 'Ranged',
    color: 0xa47cff, css: '#b28cff', r: 18, barH: 160,
    desc: 'A horned reaper who walks between shadows, marking prey and drinking the life from them.',
    hp: 490, mana: 220, speed: 180,
    basic: { damage: 21, range: 380, cooldown: 1.1, ranged: true, projectile: 'shadowBolt', speed: 900, muzzle: 52, color: '#b28cff' },
    passive: { name: 'Gathering Shadows', icon: '☾', desc: 'Damage marks foes with Shadow for 6s. Shadowed foes take 20% more damage from the Deathwalker, and refund 15 mana when they die.' },
    onDamage(h, t, amt) { return t.marks && t.marks.shadow ? amt * 1.2 : amt; },
    afterDamage(h, t) { G.mark(t, 'shadow', 6); },
    onFoeDeath(h, e) {
      if (!e.marks || !e.marks.shadow) return;
      h.mana = Math.min(h.maxMana, h.mana + 15);
      G.addFx('soul', { x: e.x, y: e.y, to: h, dur: 0.6, color: 0xb28cff });
    },
    abilities: [
      { key: 'q', name: 'Shadow Scythe', icon: '☽', cooldown: 5, mana: 35, range: 560, aim: 'dir',
        desc: 'Flings a spinning crescent of shadow 560 forward that cuts through every foe for 70 damage.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0);
          G.spawnProjectile({ x: h.x, y: h.y, h: 40, angle: a, speed: 900, range: 560, r: 34, team: h.team, color: '#b28cff',
            style: 'crescent', pierce: true, onHit(e) { G.hurt(h, e, 70); } });
          return true;
        } },
      { key: 'w', name: 'Shadow Step', icon: '◐', cooldown: 10, mana: 50, range: 430, aim: 'point',
        desc: 'Steps through the dark up to 430, leaving pools of shadow at both ends that slow foes 45% for 3s.',
        cast(h, tx, ty) {
          const spot = G.openSpot(h, tx, ty, 430);
          if (!spot) return false;
          h.playCast(1);
          shadowPool(h, h.x, h.y);
          teleport(h, spot.x, spot.y, 0xb28cff);
          shadowPool(h, spot.x, spot.y);
          return true;
        } },
      { key: 'e', name: 'Soul Siphon', icon: '♁', cooldown: 13, mana: 50, range: 380, aim: 'foe',
        desc: 'Tethers a foe within 380 for 3s, draining 30 HP per second and healing for all of it. Breaks beyond 560. Passive — Gathering Shadows: marked foes take +20% damage and refund 15 mana on death.',
        cast(h, tx, ty) {
          const t = foeNear(h, tx, ty, 160, 380, { buildings: false }) || G.nearestFoe(h.team, h.x, h.y, 380, { buildings: false });
          if (!t) return false;
          h.facing = angleTo(h, t.x, t.y); h.playCast(2);
          G.addFx('tether', { a: h, b: t, dur: 3, color: 0xb28cff,
            tick: pulse(0.25, o => {
              if (t.dead || h.dead || G.dist(h.x, h.y, t.x, t.y) > 560) { o.dead = true; return; }
              const got = G.hurt(h, t, 7.5, { color: '#b28cff' });
              G.heal(h, got);
            }) });
          return true;
        } },
      { key: 'r', name: 'Reaping Night', icon: '✠', cooldown: 70, mana: 110, range: 600, aim: 'point', ult: true,
        desc: 'ULTIMATE. Drops a 260-radius field of night for 5s: foes inside take 30 damage per second and are slowed 50%. Then the night collapses for 160 damage to everything still inside.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 600); h.facing = angleTo(h, p.x, p.y); h.playCast(3);
          G.addFx('night', { x: p.x, y: p.y, r: 260, dur: 5, team: h.team,
            tick: pulse(0.25, () => {
              for (const e of G.foesInRadius(h.team, p.x, p.y, 260)) {
                if (isUnit(e)) { G.burn(e, 30, 0.3, 'night', '#b28cff'); G.slow(e, 0.5, 0.35); G.mark(e, 'shadow', 6); }
                else G.hurt(h, e, 7.5);
              }
            }),
            end() {
              for (const e of G.foesInRadius(h.team, p.x, p.y, 260)) G.hurt(h, e, 160);
              G.addFx('ring', { x: p.x, y: p.y, r0: 260, r1: 20, dur: 0.45, color: 0xb28cff });
              G.burst(p.x, p.y, '#b28cff', 50, 360);
            } });
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
    h.mana = Math.min(h.maxMana, h.mana + 20);
    G.burst(h.x, h.y, f === 'melee' ? '#ff6fb8' : '#6ff0e0', 26, 220);
    G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 90, dur: 0.35, color: f === 'melee' ? 0xff6fb8 : 0x6ff0e0 });
  }
  const GEMINATE = {
    id: 'geminate', name: 'Geminate', lore: 'Harrower', role: 'Ranged / Melee',
    color: 0x6ff0e0, css: '#6ff0e0', r: 18, barH: 155,
    desc: 'Two insect minds in one chitin shell, shifting between a far-casting form and a whirling blade form.',
    hp: 500, mana: 200, speed: 185, startForm: 'ranged',
    basic: GEM_RANGED,
    formBasic: h => (h.form === 'melee' ? GEM_MELEE : GEM_RANGED),
    passive: { name: 'Duality', icon: '☯', desc: 'Ranged form moves 15% faster. Melee form heals for 15% of damage dealt. Every form switch restores 20 mana.' },
    init(h) { h.form = 'ranged'; h.state.empower = 0; h.state.resonance = 0; },
    update(h, dt) {
      if (h.form === 'ranged') G.addBuff(h, 'duality', 0.2, { speed: 0.15 });
      h.state.empower = Math.max(0, h.state.empower - dt);
      h.state.resonance = Math.max(0, h.state.resonance - dt);
    },
    afterDamage(h, t, dealt) { if (h.form === 'melee') G.mend(h, dealt * 0.15); },
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
      { key: 'q', name: 'Twin Strike', icon: '♊', cooldown: 4, mana: 30, range: 600, aim: 'point',
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
      { key: 'w', name: 'Phase Shift', icon: '⇋', cooldown: 7, mana: 35, range: 280, aim: 'point',
        desc: 'Darts up to 280 and switches form (orb ⇄ blade). The next basic attack within 3s deals double damage.',
        cast(h, tx, ty) {
          h.playCast(1);
          const spot = G.openSpot(h, tx, ty, 280);
          const swap = () => { setForm(h, h.form === 'melee' ? 'ranged' : 'melee'); h.state.empower = 3; };
          if (!spot) { swap(); return true; }
          h.dash = { tx: spot.x, ty: spot.y, speed: 1300, hit: new Set(), trail: h.form === 'melee' ? '#ff6fb8' : '#6ff0e0', onArrive: swap };
          return true;
        } },
      { key: 'e', name: 'Resonance', icon: '≋', cooldown: 14, mana: 50, range: 0, aim: 'self',
        desc: 'For 6s basic attacks arc to 2 more foes within 220 for 60% damage. Passive — Duality: orb form +15% move speed, blade form heals 15% of damage dealt, switching forms restores 20 mana.',
        cast(h) {
          h.playCast(2);
          h.state.resonance = 6;
          G.addFx('ring', { x: h.x, y: h.y, r0: 20, r1: 220, dur: 0.5, color: 0xffffff });
          return true;
        } },
      { key: 'r', name: 'Convergence', icon: '✺', cooldown: 65, mana: 110, range: 550, aim: 'self', ult: true,
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
  const BLINKBLADE = {
    id: 'blinkblade', name: 'Blinkblade', lore: 'Quatryl', role: 'Melee',
    color: 0x7fd8ff, css: '#8fdcff', r: 16, barH: 125,
    desc: 'A tiny inventor with a time-folding engine on her back and a blade that is never quite where you look.',
    hp: 440, mana: 180, speed: 205,
    basic: { damage: 18, range: 26, cooldown: 0.6, impact: 0.08 },
    passive: { name: 'Momentum', icon: '⟳', desc: 'Each basic attack hit cuts Blink Strike and Overclock cooldowns by 0.6s.' },
    init(h) { h.state.cutting = 0; },
    update(h, dt) {
      if (h.state.cutting > 0) { h.state.cutting -= dt; h.target = null; if (h.state.cutting <= 0) h.untargetable = false; }
    },
    onBasicHit(h, t, dmg) {
      for (const k of ['q', 'w']) h.cooldowns[k] = Math.max(0, (h.cooldowns[k] || 0) - 0.6);
      return dmg;
    },
    abilities: [
      { key: 'q', name: 'Blink Strike', icon: '⚡', cooldown: 5, mana: 30, range: 420, aim: 'foe',
        desc: 'Blinks beside the foe nearest the cursor (within 420) and strikes for 65 damage. With no foe there, simply blinks to the spot.',
        cast(h, tx, ty) {
          const t = foeNear(h, tx, ty, 180, 420);
          h.playCast(0);
          if (!t) {
            const spot = G.openSpot(h, tx, ty, 420);
            if (!spot) return false;
            teleport(h, spot.x, spot.y, 0x8fdcff);
            return true;
          }
          const a = Math.atan2(h.y - t.y, h.x - t.x), d = (t.r || 0) + h.r + 6;
          teleport(h, t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, 0x8fdcff);
          h.facing = Math.atan2(t.y - h.y, t.x - h.x);
          h.swing = 1;
          G.hurt(h, t, 65);
          G.addFx('slash', { x: h.x, y: h.y, angle: h.facing, arc: 1.6, r: 70, dur: 0.25, color: 0x8fdcff });
          h.attackTarget = t;
          return true;
        } },
      { key: 'w', name: 'Overclock', icon: '⏩', cooldown: 12, mana: 40, range: 0, aim: 'self',
        desc: 'Overclocks the chrono-engine for 4s: +50% move speed and +60% attack speed.',
        cast(h) {
          h.playCast(1);
          G.addBuff(h, 'overclock', 4, { speed: 0.5, atk: 0.6 });
          G.addFx('ring', { x: h.x, y: h.y, r0: 10, r1: 110, dur: 0.35, color: 0x8fdcff });
          return true;
        } },
      { key: 'e', name: 'Rewind', icon: '⟲', cooldown: 16, mana: 50, range: 0, aim: 'self',
        desc: 'Snaps back to where it stood 3s ago and recovers half of the health lost since then. Passive — Momentum: every basic hit cuts Blink Strike and Overclock cooldowns by 0.6s.',
        cast(h) {
          const hist = h.history;
          if (hist.length < 2) return false;
          const past = hist[Math.max(0, hist.length - 30)];
          h.playCast(2);
          teleport(h, past.x, past.y, 0x8fdcff);
          G.addFx('ring', { x: past.x, y: past.y, r0: 90, r1: 10, dur: 0.4, color: 0x8fdcff });
          if (past.hp > h.hp) G.heal(h, (past.hp - h.hp) * 0.5);
          return true;
        } },
      { key: 'r', name: 'Thousand Cuts', icon: '✴', cooldown: 60, mana: 100, range: 450, aim: 'point', ult: true,
        desc: 'ULTIMATE. Becomes untouchable and blinks between foes within 350 of the target point, striking 10 times for 55 damage each.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 450);
          const foes = G.foesOf(h.team).filter(e => G.dist(e.x, e.y, p.x, p.y) < 350 + (e.r || 0));
          if (!foes.length) return false;
          h.playCast(3); h.untargetable = true; h.state.cutting = 1.35; h.attackTarget = null;
          G.repeat(10, 0.12, i => {
            const live = foes.filter(e => !e.dead);
            if (!live.length || h.dead) return;
            const t = live[i % live.length];
            const a = Math.random() * Math.PI * 2, d = (t.r || 0) + h.r + 6;
            const nx = t.x + Math.cos(a) * d, ny = t.y + Math.sin(a) * d;
            G.addFx('blink', { x: h.x, y: h.y, x2: nx, y2: ny, dur: 0.3, color: 0x8fdcff });
            h.x = nx; h.y = ny; G.map.resolve(h);
            h.facing = Math.atan2(t.y - h.y, t.x - h.x);
            h.swing = 1; h.swingAlt = !h.swingAlt;
            G.hurt(h, t, 55);
            G.addFx('slash', { x: t.x, y: t.y, angle: Math.random() * 6.28, arc: 2, r: 60, dur: 0.2, color: 0xcff4ff });
          });
          return true;
        } }
    ]
  };

  // =====================================================================================
  // 6. Crushing Tide — Lurker shell-crusher (melee tank)
  // =====================================================================================
  const CRUSHING_TIDE = {
    id: 'crushingtide', name: 'Crushing Tide', lore: 'Lurker', role: 'Melee',
    color: 0x3fc8d8, css: '#5fd8e8', r: 23, barH: 150,
    desc: 'A colossal crab-knight of the deep who breaks lines with its crusher claw and drowns armies in the tide.',
    hp: 780, mana: 180, speed: 160,
    basic: { damage: 28, range: 34, cooldown: 1.3, impact: 0.2 },
    passive: { name: 'Rising Tide', icon: '≈', desc: 'Each basic attack hit adds a Tide stack for 5s (max 5). Each stack gives 6% damage reduction.' },
    init(h) { h.state.tide = 0; h.state.tideT = 0; },
    update(h, dt) { if (h.state.tide && (h.state.tideT -= dt) <= 0) h.state.tide = 0; },
    onBasicHit(h, t, dmg) { h.state.tide = Math.min(5, h.state.tide + 1); h.state.tideT = 5; return dmg; },
    armor: h => h.state.tide * 0.06,
    passiveText: h => (h.state.tide ? '×' + h.state.tide : ''),
    abilities: [
      { key: 'q', name: 'Riptide Claw', icon: '♋', cooldown: 5, mana: 30, range: 180, aim: 'dir',
        desc: 'A sweeping crusher-claw blow across a wide cone in front (180 reach): 70 damage and a heavy knockback.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0);
          G.after(0.15, () => {
            for (const e of G.foesInCone(h.team, h.x, h.y, a, 180, 0.95)) { G.hurt(h, e, 70); G.knock(e, h.x, h.y, 100, 0.3); }
            G.addFx('cone', { x: h.x, y: h.y, angle: a, r: 180, arc: 1.9, dur: 0.4, color: 0x5fe0e8 });
          });
          return true;
        } },
      { key: 'w', name: 'Coral Carapace', icon: '⬢', cooldown: 12, mana: 45, range: 0, aim: 'self',
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
      { key: 'e', name: 'Undertow', icon: '◎', cooldown: 13, mana: 50, range: 400, aim: 'point',
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
      { key: 'r', name: 'Tsunami', icon: '🌊', cooldown: 70, mana: 110, range: 900, aim: 'dir', ult: true,
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
    color: 0xd8b060, css: '#d8b060', r: 16, barH: 120,
    desc: 'A wiry rat-folk hunter with a repeating crossbow, a harpoon gun and more steel jaws than sense.',
    hp: 460, mana: 200, speed: 188,
    basic: { damage: 18, range: 430, cooldown: 1.0, ranged: true, projectile: 'quarrel', speed: 1150, muzzle: 34, color: '#e8d8a0' },
    passive: { name: 'Predator', icon: '⌖', desc: 'Basic attacks deal 50% more damage to rooted, stunned or slowed foes.' },
    onBasicHit(h, t, dmg) { return t.impaired ? dmg * 1.5 : dmg; },
    passiveText: h => String(G.fx.filter(o => o.kind === 'trap' && o.owner === h && !o.sprung).length || ''),
    abilities: [
      { key: 'q', name: 'Harpoon', icon: '⚓', cooldown: 7, mana: 35, range: 620, aim: 'dir',
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
      { key: 'w', name: 'Bear Trap', icon: '⊓', cooldown: 2.5, mana: 25, range: 340, aim: 'point',
        desc: 'Sets a hidden bear trap (up to 8 out, each lasting 45s). It arms after 0.8s; the first foe to step on it takes 90 damage and is rooted for 2s.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 340); h.facing = angleTo(h, p.x, p.y); h.playCast(1);
          placeTrap(h, p.x, p.y, 0.8, 45);
          return true;
        } },
      { key: 'e', name: 'Snare Net', icon: '⌗', cooldown: 11, mana: 45, range: 440, aim: 'point',
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
      { key: 'r', name: 'Killing Field', icon: '✣', cooldown: 60, mana: 100, range: 500, aim: 'point', ult: true,
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
    color: 0xff6a20, css: '#ff8a40', r: 18, barH: 160,
    desc: 'A living shard of the world’s molten heart, cracked obsidian over a furnace that never cools.',
    hp: 450, mana: 230, speed: 175,
    basic: { damage: 22, range: 400, cooldown: 1.2, ranged: true, projectile: 'ember', speed: 850, muzzle: 52, color: '#ff9a40' },
    passive: { name: 'Kindling', icon: '♨', desc: "All of the Pyroclast's damage sets foes ablaze: 6 damage per second for 3s (refreshes)." },
    afterDamage(h, t) { G.burn(t, 6, 3, 'kindling', '#ff9a40'); },
    abilities: [
      { key: 'q', name: 'Magma Bolt', icon: '☄', cooldown: 4, mana: 30, range: 650, aim: 'dir',
        desc: 'Hurls a glob of magma 650 forward that bursts on the first foe (or at the end of its flight) for 65 damage in a 100 radius.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(0);
          G.spawnProjectile({ x: h.x, y: h.y, h: 50, angle: a, speed: 900, range: 650, r: 14, team: h.team, color: '#ff8a30',
            style: 'magma', onHit(e, p) { magmaBlast(h, p.x, p.y); }, onEnd(p) { magmaBlast(h, p.x, p.y); } });
          return true;
        } },
      { key: 'w', name: 'Wall of Fire', icon: '▤', cooldown: 12, mana: 55, range: 420, aim: 'point',
        desc: 'Raises a 320-long wall of fire across the target point for 5s. Foes in it burn for 40 damage per second.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 420), a = angleTo(h, p.x, p.y); h.facing = a; h.playCast(1);
          const nx = -Math.sin(a) * 160, ny = Math.cos(a) * 160;
          const x1 = p.x + nx, y1 = p.y + ny, x2 = p.x - nx, y2 = p.y - ny;
          G.addFx('firewall', { x: p.x, y: p.y, x1, y1, x2, y2, w: 60, dur: 5,
            tick: pulse(0.25, () => {
              for (const e of G.foesInLine(h.team, x1, y1, x2, y2, 60)) {
                if (isUnit(e)) G.burn(e, 40, 0.5, 'firewall', '#ff7a30'); else G.hurt(h, e, 10);
              }
            }) });
          return true;
        } },
      { key: 'e', name: 'Searing Breath', icon: '♆', cooldown: 9, mana: 40, range: 270, aim: 'dir',
        desc: 'Exhales a cone of white-hot fire (270 reach): 55 damage, then 14 burn damage per second for 4s. Passive — Kindling: all damage burns foes for 6 per second over 3s.',
        cast(h, tx, ty) {
          const a = angleTo(h, tx, ty); h.facing = a; h.playCast(2);
          for (const e of G.foesInCone(h.team, h.x, h.y, a, 270, 0.62)) { G.hurt(h, e, 55); G.burn(e, 14, 4, 'sear', '#ffd080'); }
          G.addFx('cone', { x: h.x, y: h.y, angle: a, r: 270, arc: 1.24, dur: 0.5, color: 0xff7a30, fire: true });
          return true;
        } },
      { key: 'r', name: 'Eruption', icon: '🌋', cooldown: 75, mana: 130, range: 650, aim: 'point', ult: true,
        desc: 'ULTIMATE. Splits the ground into a 240-radius magma field for 4.5s (25 burn damage per second) while 12 meteors crash down over it, each dealing 70 damage in a 90 radius.',
        cast(h, tx, ty) {
          const p = G.clampReach(h, tx, ty, 650); h.facing = angleTo(h, p.x, p.y); h.playCast(3);
          G.addFx('magma', { x: p.x, y: p.y, r: 240, dur: 4.5,
            tick: pulse(0.25, () => {
              for (const e of G.foesInRadius(h.team, p.x, p.y, 240)) {
                if (isUnit(e)) G.burn(e, 25, 0.4, 'magma', '#ff7a30'); else G.hurt(h, e, 6);
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
    color: 0xf0c070, css: '#f0c070', r: 21, barH: 165,
    desc: 'A horned wanderer hauling a whole camp on his back, who swings a lantern-hung walking staff like a battering ram.',
    hp: 700, mana: 190, speed: 168,
    basic: { damage: 30, range: 36, cooldown: 1.3, impact: 0.2 },
    passive: { name: 'Long Road', icon: '⛰', desc: 'After walking for 2s, gains Momentum: +25% move speed, and the next basic attack deals 80% more damage and stuns for 0.6s.' },
    init(h) { h.state.walk = 0; h.state.momentum = false; },
    update(h, dt) {
      if (h.moving) { h.state.walk += dt; if (h.state.walk >= 2 && !h.state.momentum) { h.state.momentum = true; G.burst(h.x, h.y, '#f0c070', 14, 140); } }
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
      { key: 'q', name: 'Staff Sweep', icon: '↻', cooldown: 5, mana: 30, range: 140, aim: 'self',
        desc: 'Spins the heavy walking staff in a full circle: 60 damage to all foes within 140, knocking them back.',
        cast(h) {
          h.playCast(0);
          G.after(0.12, () => {
            for (const e of G.foesInRadius(h.team, h.x, h.y, 140)) { G.hurt(h, e, 60); G.knock(e, h.x, h.y, 80, 0.25); }
            G.addFx('slash', { x: h.x, y: h.y, angle: h.facing, arc: Math.PI * 2, r: 140, dur: 0.4, color: 0xf0c070 });
          });
          return true;
        } },
      { key: 'w', name: 'Long Stride', icon: '⇶', cooldown: 9, mana: 40, range: 360, aim: 'point',
        desc: 'Covers 360 in a few great strides, dealing 40 damage to foes in the path and slowing them 40% for 2s.',
        cast(h, tx, ty) {
          const spot = G.openSpot(h, tx, ty, 360);
          if (!spot) return false;
          h.playCast(1); h.attackTarget = null;
          h.dash = { tx: spot.x, ty: spot.y, speed: 800, width: 26, hit: new Set(), trail: '#d8c8a8',
            onPass(e) { G.hurt(h, e, 40); G.slow(e, 0.4, 2); } };
          return true;
        } },
      { key: 'e', name: 'Waystone Camp', icon: '⛺', cooldown: 18, mana: 60, range: 250, aim: 'point',
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
      { key: 'r', name: 'Great Migration', icon: '🐘', cooldown: 70, mana: 110, range: 1000, aim: 'dir', ult: true,
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

  // Foes dying tell every living hero (Boneshaper / Deathwalker passives).
  G.deathListeners.push(e => {
    for (const h of G.entities)
      if (h instanceof G.Hero && !h.dead && h.def.onFoeDeath && e.team !== h.team) h.def.onFoeDeath(h, e);
  });

  // Free to act, off cooldown and with the mana.
  G.canCast = function (hero, ability) {
    if (hero.dead || hero.stunned || hero.dash || (hero.state.cutting > 0)) return false;
    return !((hero.cooldowns[ability.key] || 0) > 0 || hero.mana < ability.mana);
  };
  G.tryCast = function (hero, ability, tx, ty) {
    if (!G.canCast(hero, ability)) return false;
    if (!ability.cast(hero, tx, ty)) return false;
    hero.mana -= ability.mana;
    hero.cooldowns[ability.key] = ability.cooldown;
    return true;
  };
})(window.Game);
