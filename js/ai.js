// CPU opponent for single player: the difficulty presets, and the brain that drives the enemy hero.
// Every `think` seconds the brain scores its goals (retreat, defend, fight the hero, skirmish with troops,
// build, collect gold, push with the army, hold the front) and commits to the best one. Every step it
// carries that goal out (walking around rocks and buildings, attacking, kiting), and every few tenths of a
// second it looks for an ability cast worth making (see PLAYBOOK).
(function (G) {
  const T = G.TEAM;

  // think: seconds between decisions. cast: chance to take a good cast when one shows up.
  // aimErr: random spread (world units) on aimed casts. lead: how far ahead of a moving hero it aims (0..1).
  // minHit / ultMin: what a normal cast / the ultimate must be worth (enemy hero 5, soldier 1, see worth()).
  // retreat: health fraction at which it backs off. aggro: bias toward picking fights with the hero.
  // careful: stays out of enemy tower fire, saves mana for the ultimate, won't grab gold under the enemy's nose.
  // defend: how much it cares about its buildings being hit. buildPause: seconds of rest between builds.
  // plan: 'basic' (a few barracks and dig-ins) or 'full' (see nextBuild). kite: ranged heroes step back from
  // melee heroes between shots. troopDmg / gold: the enemy team's bonuses (see G.teamBonus in races.js).
  G.DIFFICULTIES = [
    { id: 'easy', name: 'Easy', desc: 'A green commander: slow to react, wastes abilities and builds little.',
      think: 0.75, cast: 0.3, aimErr: 130, lead: 0, minHit: 3, ultMin: 4, retreat: 0.12, aggro: 0.35,
      careful: false, defend: 0.6, buildPause: 22, plan: 'basic', kite: false, troopDmg: 1, gold: 1 },
    { id: 'medium', name: 'Medium', desc: 'A seasoned captain who builds steadily and picks fair fights.',
      think: 0.4, cast: 0.7, aimErr: 55, lead: 0.5, minHit: 2.5, ultMin: 6, retreat: 0.25, aggro: 0.1,
      careful: true, defend: 0.9, buildPause: 8, plan: 'full', kite: false, troopDmg: 1, gold: 1 },
    { id: 'hard', name: 'Hard', desc: 'A ruthless warlord: sharp aim, quick builds, kites and punishes mistakes.',
      think: 0.2, cast: 1, aimErr: 14, lead: 1, minHit: 2, ultMin: 6, retreat: 0.3, aggro: 0,
      careful: true, defend: 1, buildPause: 2, plan: 'full', kite: true, troopDmg: 1, gold: 1 },
    { id: 'griefs', name: '7 Griefs', desc: 'Hard, and then some. Enemy troops deal +20% damage and the enemy hero collects +30% gold.',
      think: 0.15, cast: 1, aimErr: 0, lead: 1, minHit: 2, ultMin: 6, retreat: 0.3, aggro: 0.05,
      careful: true, defend: 1, buildPause: 0, plan: 'full', kite: true, troopDmg: 1.2, gold: 1.3 }
  ];
  G.difficultyById = id => G.DIFFICULTIES.find(d => d.id === id) || G.DIFFICULTIES[1];

  // How the brain uses each hero's abilities (see heroes.js for what they do):
  //   line {range, width, first, splash}: skill shot (first: stops at the first foe, splash: bursts there)
  //   cone {range, half}   aoe {range, radius}: area at a point   self {radius}: area around the hero
  //   foe {range}: needs a foe to target (engage: with no foe there it blinks, so it also escapes)
  //   dash {range}: close on the enemy hero, or escape   blink {range}: escape only
  //   buff {radius}: while brawling   shield {radius}: while under fire   zone {radius}: rally/heal ground
  //   summon {range}: raise fighters near foes   rewind: undo recent damage   twin: Geminate's form strike
  const PLAYBOOK = {
    bannerspear: { q: { use: 'line', range: 250, width: 70 }, w: { use: 'dash', range: 340 }, e: { use: 'zone', radius: 230 }, r: { use: 'aoe', range: 520, radius: 220 } },
    boneshaper: { q: { use: 'line', range: 700, width: 40 }, w: { use: 'summon', range: 350 }, e: { use: 'shield', radius: 120 }, r: { use: 'aoe', range: 300, radius: 180 } },
    deathwalker: { q: { use: 'line', range: 560, width: 68 }, w: { use: 'blink', range: 430 }, e: { use: 'foe', range: 380 }, r: { use: 'aoe', range: 600, radius: 260 } },
    geminate: { q: { use: 'twin' }, w: { use: 'dash', range: 280 }, e: { use: 'buff', radius: 220 }, r: { use: 'self', radius: 550 } },
    blinkblade: { q: { use: 'foe', range: 420, engage: true }, w: { use: 'buff', radius: 200 }, e: { use: 'rewind' }, r: { use: 'aoe', range: 450, radius: 350 } },
    crushingtide: { q: { use: 'cone', range: 180, half: 0.95 }, w: { use: 'shield', radius: 150 }, e: { use: 'aoe', range: 400, radius: 170 }, r: { use: 'line', range: 900, width: 280 } },
    trapper: { q: { use: 'line', range: 620, width: 24, first: true }, w: { use: 'aoe', range: 340, radius: 50 }, e: { use: 'aoe', range: 440, radius: 130 }, r: { use: 'aoe', range: 500, radius: 210 } },
    pyroclast: { q: { use: 'line', range: 650, width: 28, first: true, splash: 100 }, w: { use: 'aoe', range: 420, radius: 150 }, e: { use: 'cone', range: 270, half: 0.62 }, r: { use: 'aoe', range: 650, radius: 240 } },
    drifter: { q: { use: 'self', radius: 140 }, w: { use: 'dash', range: 360 }, e: { use: 'zone', radius: 200 }, r: { use: 'line', range: 1000, width: 240 } }
  };

  const BARRACKS = ['barracks', 'barracksLong', 'barracksArmored', 'barracksShort'];
  const ENGAGE = 750;          // picks a fight with a hero this close (further when it raids our bases)
  const SKIRMISH = 750;        // hunts enemy soldiers this close
  const ARMY = 5;              // soldiers near the hero that make a push worthwhile

  let me = null, diff = null, spawn = null;
  let goal = null;             // what the brain is doing: { kind, ... } (see plan)
  let clock = 0, thinkT = 0, castT = 0, buildT = 0;
  let alarm = null;            // own building hit recently: { b, t }
  const lastHp = new Map();    // own building -> hp at the last decision
  const seen = new Map();      // enemy hero -> { x, y, vx, vy } for leading shots
  // Walking: the current waypoint toward `to`, re-planned every 0.15s; a short sidestep when stuck.
  const nav = { t: 0, to: null, wp: null, lx: 0, ly: 0, checkT: 0, walked: false, detour: null, detourT: 0 };

  // ---------------------------------------------------------------------------
  // Reading the battlefield
  // ---------------------------------------------------------------------------
  const isSoldier = e => e instanceof G.Soldier;
  const ownDir = () => (me.team === T.ENEMY ? 1 : -1);   // +x toward our own map edge

  // What touching a foe with a cast is worth.
  function worth(e) {
    if (e instanceof G.Hero) return 5;
    if (isSoldier(e)) {
      const k = G.SQUAD_KINDS[e.kind];
      return e.kind === 'colossus' ? 4 : k.ally ? 2 : e.kind === 'armored' ? 1.5 : 1;
    }
    if (e instanceof G.Entity) return 0;  // training beasts
    return 0.4;                           // buildings
  }
  const sumWorth = list => list.reduce((a, e) => a + worth(e), 0);

  // The targetable enemy hero nearest us, or null (dead, untouchable, or developer mode).
  function enemyHero() {
    let best = null, bd = Infinity;
    for (const e of G.foesOf(me.team, { buildings: false })) {
      if (!(e instanceof G.Hero)) continue;
      const d = G.dist(me.x, me.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function soldiersNear(x, y, r, ours) {
    return G.entities.filter(e => isSoldier(e) && !e.dead && (ours ? e.team === me.team : e.team !== me.team && e.team !== T.NEUTRAL) &&
      G.dist(x, y, e.x, e.y) < r);
  }

  // Damage per second the enemy's towers pour onto (x, y).
  function towerDps(x, y, team = me.team) {
    let dps = 0;
    for (const b of G.buildingList()) {
      const w = G.BUILDINGS[b.type].weapon;
      if (!w || b.dead || b.team === team) continue;
      const d = G.dist(x, y, b.x, b.y);
      if (d <= w.range + 20 && d >= w.minRange) dps += w.damage / w.cooldown;
    }
    return dps;
  }

  // Rough damage per second a hero puts out (basic attacks plus abilities).
  const heroDps = h => h.basic.damage / h.basic.cooldown * 1.6;
  const soldierDps = list => list.reduce((a, s) => a + s.damage / s.attackCooldown, 0);

  // How much harm (dps) waits at (x, y): towers, the enemy hero, enemy soldiers in reach.
  function danger(x, y) {
    let d = towerDps(x, y);
    for (const e of G.foesOf(me.team, { buildings: false })) {
      const dd = G.dist(x, y, e.x, e.y);
      if (e instanceof G.Hero) { if (dd < 650) d += heroDps(e); } else if (isSoldier(e) && dd < e.attackRange + 250) d += e.damage / e.attackCooldown;
    }
    return d;
  }

  // Would we win a fight with `foe` here? Compares how long each hero lasts against everything that would
  // be shooting at it. > 0 favours us.
  function advantage(foe) {
    const mid = { x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 };
    const ours = soldiersNear(mid.x, mid.y, 550, true), theirs = soldiersNear(mid.x, mid.y, 550, false);
    const myDps = heroDps(me) + soldierDps(ours) * 0.5 + towerDps(foe.x, foe.y, foe.team);
    const foeDps = heroDps(foe) + soldierDps(theirs) * 0.5 + towerDps(me.x, me.y);
    let a = Math.log((me.hp / foeDps) / (foe.hp / myDps));
    const ult = me.def.abilities[3];
    if ((me.cooldowns[ult.key] || 0) <= 0 && me.mana >= ult.mana) a += 0.2;
    a += (me.mana / me.maxMana - 0.5) * 0.3;
    return a + diff.aggro;
  }

  const ownBase = (x, y) => { const b = G.baseAt(x, y); return b && b.team === me.team ? b : null; };

  function cost(type) { return G.BUILDINGS[type].cost; }

  // Note which of our buildings took damage since the last decision (the Command Center matters most).
  function checkAlarm() {
    for (const b of G.buildingList()) {
      if (b.team !== me.team) continue;
      const was = lastHp.get(b);
      if (was !== undefined && b.hp < was - 0.5 && (!alarm || clock - alarm.t > 1 || G.BUILDINGS[b.type].command || alarm.b.dead))
        alarm = { b, t: clock };
      lastHp.set(b, b.hp);
    }
    for (const b of lastHp.keys()) if (b.dead) lastHp.delete(b);
  }

  // Keep an eye on how enemy heroes move, to lead skill shots.
  function track(dt) {
    for (const e of G.entities) {
      if (!(e instanceof G.Hero) || e.team === me.team) continue;
      const s = seen.get(e) || { x: e.x, y: e.y, vx: 0, vy: 0 };
      let vx = (e.x - s.x) / dt, vy = (e.y - s.y) / dt;
      if (Math.hypot(vx, vy) > 1500) vx = vy = 0;  // blinked or respawned
      s.vx = s.vx * 0.8 + vx * 0.2; s.vy = s.vy * 0.8 + vy * 0.2;
      s.x = e.x; s.y = e.y;
      seen.set(e, s);
    }
  }

  // Where to aim at `e`: heroes are led along their path, by difficulty.
  function aimPoint(e) {
    const s = seen.get(e);
    if (!s || !diff.lead) return { x: e.x, y: e.y };
    const t = (G.dist(me.x, me.y, e.x, e.y) / 1000 + 0.15) * diff.lead;
    return { x: e.x + s.vx * t, y: e.y + s.vy * t };
  }

  // HP lost over the last `secs` seconds (hero history samples every 0.1s).
  function hpLost(secs) {
    const h = me.history, past = h[Math.max(0, h.length - Math.round(secs * 10))];
    return past ? Math.max(0, past.hp - me.hp) : 0;
  }

  // ---------------------------------------------------------------------------
  // Places to go
  // ---------------------------------------------------------------------------
  // Our nearest tower-guarded base that the enemy hero isn't standing between us and.
  function safeSpot(foe) {
    let best = null, bs = Infinity;
    for (const b of G.bases) {
      if (b.team !== me.team || !b.slots.some(s => s.building && G.BUILDINGS[s.building.type].weapon)) continue;
      const d = G.dist(me.x, me.y, b.x, b.y);
      const s = d + (foe && G.dist(foe.x, foe.y, b.x, b.y) < d ? 2500 : 0);
      if (s < bs) { bs = s; best = b; }
    }
    if (!best) return spawn;
    return { x: best.x + ownDir() * (best.core ? 270 : 60), y: best.y };
  }

  // Furthest open ground up to `range` away from trouble, leaning toward safety.
  function escapePoint(range, foe) {
    const safe = safeSpot(foe);
    let ax = safe.x - me.x, ay = safe.y - me.y;
    const al = Math.hypot(ax, ay) || 1;
    ax /= al; ay /= al;
    if (foe) {
      const fx = me.x - foe.x, fy = me.y - foe.y, fl = Math.hypot(fx, fy) || 1;
      ax = ax * 0.6 + fx / fl; ay = ay * 0.6 + fy / fl;
    }
    const l = Math.hypot(ax, ay) || 1;
    return G.openSpot(me, me.x + ax / l * range, me.y + ay / l * range, range);
  }

  // Where to stand with nothing better to do: just behind our biggest group of soldiers, else our front gate.
  function holdSpot() {
    let best = null, bn = 0;
    for (const sq of G.squads) {
      if (sq.team !== me.team || sq.summoner || G.SQUAD_KINDS[sq.kind].ally) continue;
      const live = sq.formation;
      if (live.length > bn) { bn = live.length; best = live; }
    }
    if (best) {
      const x = best.reduce((a, s) => a + s.x, 0) / best.length, y = best.reduce((a, s) => a + s.y, 0) / best.length;
      return { x: x + ownDir() * 120, y };
    }
    const front = G.bases.find(b => b.side === me.team && b.y === G.map.h / 2 && b.x === (me.team === T.ENEMY ? G.map.w - G.BASE_COLS[1] : G.BASE_COLS[1]));
    return { x: front.x - ownDir() * 200, y: front.y };
  }

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------
  function nextBuild() {
    const n = {};
    let damaged = false;
    for (const b of G.buildingList()) {
      if (b.team !== me.team || b.dead) continue;
      n[b.type] = (n[b.type] || 0) + 1;
      if (b.hp < b.maxHp * 0.7) damaged = true;
    }
    const c = t => n[t] || 0;
    const troops = BARRACKS.reduce((a, t) => a + c(t), 0);
    const towers = c('digin') + c('support') + c('siege');
    if (diff.plan === 'basic') return troops <= c('digin') * 2 ? (troops % 2 ? 'barracksShort' : 'barracks') : 'digin';
    if (troops < 1) return 'barracks';
    if (troops < 2) return 'barracksLong';
    if (c('digin') < 1) return 'digin';
    if (troops < 3) return 'barracksArmored';
    if (c('allyMedic') < 1) return 'allyMedic';
    if (c('support') < 1) return 'support';
    if (troops < 4) return 'barracksShort';
    if (c('allyOfficer') < 1) return 'allyOfficer';
    if (c('storm') < 1) return 'storm';
    if (c('allyDemolitionist') < 1) return 'allyDemolitionist';
    if (c('siege') < 1) return 'siege';
    if (damaged && c('allyEngineer') < 1) return 'allyEngineer';
    // From here on: alternate more troops and more towers.
    return troops <= towers ? BARRACKS[troops % 4] : ['support', 'digin', 'siege'][towers % 3];
  }

  // The base and slot for a new building: bases we hold before new ground, closest to the enemy first,
  // and never one the enemy is fighting over. Towers and barracks face the enemy; allies sit at the back.
  function placeFor(type) {
    const goalCC = G.commandCenters[me.team === T.ENEMY ? T.PLAYER : T.ENEMY];
    const open = b => (b.team === null || b.team === me.team) && b.slots.some(s => !s.core && !s.building);
    let bases = G.bases.filter(b => b.side === me.team && open(b));
    if (!bases.length) bases = G.bases.filter(open);
    let best = null, bs = Infinity;
    for (const b of bases) {
      const s = (b.team === me.team ? 0 : 900) + G.dist(b.x, b.y, goalCC.x, goalCC.y) + G.dist(me.x, me.y, b.x, b.y) * 0.3 +
        (danger(b.x, b.y) > 30 ? 5000 : 0);
      if (s < bs) { bs = s; best = b; }
    }
    if (!best) return null;
    const back = /^ally/.test(type) ? -1 : 1;
    const slot = best.slots.filter(s => !s.core && !s.building)
      .sort((p, q) => back * (G.dist(p.x, p.y, goalCC.x, goalCC.y) - G.dist(q.x, q.y, goalCC.x, goalCC.y)))[0];
    return { base: best, slot };
  }

  // Walk in between the base center and the slot (clear of the Command Center and the slot's footprint), then build.
  function build(g) {
    const { base, slot, type } = g;
    if (slot.building || (base.team !== null && base.team !== me.team) || me.gold < cost(type)) { replan(); return; }
    const sx = base.x + (slot.x - base.x) * 0.62, sy = base.y + (slot.y - base.y) * 0.62;
    if (G.dist(me.x, me.y, sx, sy) > 50) { walk(sx, sy); return; }
    me.target = null;
    if (G.placeBuilding(me, { base, slot }, type)) buildT = diff.buildPause;
    replan();
  }

  // ---------------------------------------------------------------------------
  // Gold and pushes
  // ---------------------------------------------------------------------------
  function bestCoin(foe, adv) {
    let best = null;
    const mul = G.bonusOf(me.team).gold;
    for (const c of G.coins) {
      const d = G.dist(me.x, me.y, c.x, c.y);
      if (d > 2600) continue;
      if (diff.careful && (towerDps(c.x, c.y) > 0 || (foe && adv < 0 && G.dist(foe.x, foe.y, c.x, c.y) < 500))) continue;
      const v = c.amount * mul / (1 + d / 450);
      if (!best || v > best.v) best = { c, v };
    }
    if (!best || best.v < 0.8) return null;
    return { c: best.c, score: 38 + Math.min(26, best.v * 3) };
  }

  // With an army at our side (or the enemy hero down), take the fight to the nearest enemy building:
  // march with the troops until they close in, then help knock it down.
  function pushGoal(foe) {
    const army = soldiersNear(me.x, me.y, 700, true);
    if (army.length < ARMY && foe) return null;
    let t = null, td = Infinity;
    for (const b of G.buildingList()) {
      if (b.team === me.team || b.dead) continue;
      const d = G.dist(me.x, me.y, b.x, b.y);
      if (d < td) { td = d; t = b; }
    }
    if (!t) return null;
    if (army.length < ARMY && td > 1600) return null;  // hero alone: only nearby buildings
    const score = (foe ? 40 : 58) + Math.min(16, army.length);
    if (army.length >= ARMY) {
      const cx = army.reduce((a, s) => a + s.x, 0) / army.length, cy = army.reduce((a, s) => a + s.y, 0) / army.length;
      if (G.dist(cx, cy, t.x, t.y) > 700) return { score, g: { kind: 'move', x: cx + ownDir() * 60, y: cy } };
    }
    return { score, g: { kind: 'attack', t } };
  }

  // Weakest-nearest enemy soldier, sticking with the current one when it's still in the list.
  function pickSoldier(list) {
    if (goal && goal.t && list.includes(goal.t)) return goal.t;
    let best = null, bs = Infinity;
    for (const s of list) {
      const v = G.dist(me.x, me.y, s.x, s.y) + s.hp * 3 - worth(s) * 60;
      if (v < bs) { bs = v; best = s; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Deciding
  // ---------------------------------------------------------------------------
  function replan() { goal = null; thinkT = 0; }

  function plan() {
    checkAlarm();
    const foe = enemyHero();
    const hpF = me.hp / me.maxHp;
    const here = danger(me.x, me.y);
    const adv = foe ? advantage(foe) : 1;
    const foeD = foe ? G.dist(me.x, me.y, foe.x, foe.y) : Infinity;
    const opts = [];
    // Sticking with what we're doing beats flip-flopping between near-equal goals.
    const add = (score, g) => opts.push({ score: score + (goal && goal.kind === g.kind ? 8 : 0), g });
    const fragile = hpF < diff.retreat + 0.1;

    // Back off: badly hurt with harm nearby, or (careful) facing a fight we'd lose.
    if (hpF < diff.retreat + (goal && goal.kind === 'retreat' ? 0.15 : 0) && here > 4) add(95, { kind: 'retreat' });
    else if (diff.careful && foe && foeD < 550 && adv < -0.6) add(72, { kind: 'retreat' });

    // Defend what's being hit.
    if (alarm && clock - alarm.t < 5 && !alarm.b.dead && !fragile) {
      const b = alarm.b, cc = G.BUILDINGS[b.type].command, s = (cc ? 90 : 66) * diff.defend;
      const raider = foe && G.dist(foe.x, foe.y, b.x, b.y) < 800 ? foe : null;
      const troops = soldiersNear(b.x, b.y, 700, false);
      if (raider && (cc || adv > -0.4)) add(s, { kind: 'fight', t: raider });
      else if (troops.length) add(s, { kind: 'attack', t: pickSoldier(troops) });
      else add(s - 20, { kind: 'move', x: b.x + ownDir() * 200, y: b.y });
    }

    // Duel the enemy hero when it's close (or raiding us) and the odds are good.
    if (foe && !fragile) {
      const keep = goal && goal.kind === 'fight' && goal.t === foe;
      const reach = (ownBase(foe.x, foe.y) ? 1400 : ENGAGE) + (keep ? 300 : 0);
      const intoTowers = diff.careful && towerDps(foe.x, foe.y) > 12 && foe.hp / foe.maxHp > 0.2;
      if (foeD < reach && adv > (keep ? -0.25 : 0) && !intoTowers) add(foe.hp / foe.maxHp < 0.3 ? 85 : 76, { kind: 'fight', t: foe });
    }

    // Cut down enemy soldiers close by (they drop gold).
    const army = soldiersNear(me.x, me.y, 600, true).length;
    const prey = soldiersNear(me.x, me.y, SKIRMISH, false).filter(s => !diff.careful || army >= ARMY || towerDps(s.x, s.y) < 1);
    if (prey.length && (!fragile || here < 10)) add(55 + Math.min(15, prey.length * 1.5), { kind: 'attack', t: pickSoldier(prey) });

    // Spend gold.
    if (buildT <= 0) {
      const type = nextBuild();
      const spot = me.gold >= cost(type) && placeFor(type);
      if (spot) add(66, { kind: 'build', type, base: spot.base, slot: spot.slot });
    }

    // Pick up gold.
    const coin = bestCoin(foe, adv);
    if (coin) add(coin.score, { kind: 'collect', c: coin.c });

    // Push with the army.
    const push = !fragile && pushGoal(foe);
    if (push) add(push.score, push.g);

    // Otherwise hold the line.
    const h = holdSpot();
    add(10, { kind: 'move', x: h.x, y: h.y });

    goal = opts.reduce((a, b) => (b.score > a.score ? b : a)).g;
    if (goal.kind === 'retreat') { const s = safeSpot(foe); goal.x = s.x; goal.y = s.y; }
  }

  // ---------------------------------------------------------------------------
  // Doing
  // ---------------------------------------------------------------------------
  // Walk toward (x, y), stepping around the first rock, tree or building in the way.
  function waypoint(tx, ty) {
    const dx = tx - me.x, dy = ty - me.y, L = Math.hypot(dx, dy);
    if (L < 1) return { x: tx, y: ty };
    const ux = dx / L, uy = dy / L;
    let hit = null, ha = Infinity;
    for (const k of G.map.solids()) {
      if (G.dist(k.x, k.y, tx, ty) < k.cr + me.r + 4) continue;  // the destination itself (a building we attack)
      const rx = k.x - me.x, ry = k.y - me.y;
      const along = rx * ux + ry * uy;
      if (along <= 0 || along >= L) continue;
      const side = ry * ux - rx * uy, clear = k.cr + me.r + 4;
      if (Math.abs(side) < clear && along < ha) { ha = along; hit = { k, side, clear }; }
    }
    if (!hit) return { x: tx, y: ty };
    // Pass on the side the path already leans to; the other side if that one is walled off.
    const nx = -uy, ny = ux, pref = hit.side > 0 ? -1 : 1;
    for (const off of [hit.clear + 16, hit.clear + 45, hit.clear + 90]) {
      for (const s of [pref, -pref]) {
        const wx = hit.k.x + nx * off * s, wy = hit.k.y + ny * off * s;
        if (!G.map.blocked(wx, wy, me.r)) return { x: wx, y: wy };
      }
    }
    return { x: tx, y: ty };
  }

  function walk(x, y) {
    me.attackTarget = null;
    if (G.dist(me.x, me.y, x, y) < 14) { me.target = null; return; }
    nav.walked = true;
    if (nav.detourT > 0) { me.moveTo(nav.detour.x, nav.detour.y); return; }
    if (nav.t <= 0 || !nav.to || G.dist(nav.to.x, nav.to.y, x, y) > 40 || G.dist(me.x, me.y, nav.wp.x, nav.wp.y) < 24) {
      nav.t = 0.15; nav.to = { x, y }; nav.wp = waypoint(x, y);
    }
    me.moveTo(nav.wp.x, nav.wp.y);
  }

  // Every 0.4s: if we meant to walk but barely moved, sidestep for a moment.
  function unstick(dt) {
    nav.t -= dt;
    nav.detourT -= dt;
    if ((nav.checkT -= dt) > 0) return;
    nav.checkT = 0.4;
    const moved = G.dist(me.x, me.y, nav.lx, nav.ly);
    if (nav.walked && nav.to && moved < 15 && me.speedMul > 0.3 && !me.dash) {
      const a = Math.atan2(nav.to.y - me.y, nav.to.x - me.x) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random() * 0.6);
      for (const k of [0, Math.PI]) {
        const x = me.x + Math.cos(a + k) * 150, y = me.y + Math.sin(a + k) * 150;
        if (!G.map.blocked(x, y, me.r)) { nav.detour = { x, y }; nav.detourT = 0.6; break; }
      }
    }
    nav.lx = me.x; nav.ly = me.y; nav.walked = false;
  }

  // Close in and attack; ranged heroes on high difficulties kite melee heroes between shots.
  function attack(t) {
    const b = me.basic, d = G.dist(me.x, me.y, t.x, t.y);
    if (d > me.r + (t.r || 0) + b.range) { walk(t.x, t.y); return; }
    if (diff.kite && b.ranged && t instanceof G.Hero && !t.basic.ranged && me.attackCd > 0.2 && d < me.r + t.r + t.basic.range + 90) {
      const a = Math.atan2(me.y - t.y, me.x - t.x), x = me.x + Math.cos(a) * 160, y = me.y + Math.sin(a) * 160;
      if (!G.map.blocked(x, y, me.r)) { me.attackTarget = null; me.moveTo(x, y); return; }
    }
    me.attackTarget = t;
  }

  function act() {
    if (me.dash || me.stunned || me.state.cutting > 0 || !goal) return;
    const g = goal;
    if (g.kind === 'fight' || g.kind === 'attack') {
      if (g.t.dead || g.t.untargetable) { me.attackTarget = null; replan(); return; }
      attack(g.t);
    } else if (g.kind === 'build') build(g);
    else if (g.kind === 'collect') { if (g.c.dead) replan(); else walk(g.c.x, g.c.y); }
    else walk(g.x, g.y);  // move, retreat
  }

  // ---------------------------------------------------------------------------
  // Abilities
  // ---------------------------------------------------------------------------
  const scored = (hits, p, aimed = true) => ({ score: sumWorth(hits), x: p.x, y: p.y, hero: hits.some(e => e instanceof G.Hero), aimed });

  // Foes we could aim at within `reach`, closest first (capped to keep it cheap).
  function targets(reach) {
    return G.foesOf(me.team)
      .filter(e => worth(e) > 0 && G.dist(me.x, me.y, e.x, e.y) - (e.r || 0) <= reach)
      .sort((a, b) => G.dist(me.x, me.y, a.x, a.y) - G.dist(me.x, me.y, b.x, b.y))
      .slice(0, 24);
  }
  function bestOf(list, fn) {
    let best = null;
    for (const e of list) { const c = fn(e); if (c && (!best || c.score > best.score)) best = c; }
    return best;
  }

  // What casting this ability right now would be worth, and where to aim it.
  function judge(how, foe) {
    const team = me.team, hpF = me.hp / me.maxHp;
    const fleeing = goal && goal.kind === 'retreat';
    const duel = foe && goal && goal.kind === 'fight' && goal.t === foe;
    const foeD = foe ? G.dist(me.x, me.y, foe.x, foe.y) : Infinity;
    switch (how.use) {
      case 'line':
        return bestOf(targets(how.range + 30), e => {
          const p = aimPoint(e), a = Math.atan2(p.y - me.y, p.x - me.x);
          let hits = G.foesInLine(team, me.x, me.y, me.x + Math.cos(a) * how.range, me.y + Math.sin(a) * how.range, how.width);
          if (how.first && hits.length) {
            const f = hits.reduce((u, v) => (G.dist(me.x, me.y, v.x, v.y) < G.dist(me.x, me.y, u.x, u.y) ? v : u));
            hits = how.splash ? G.foesInRadius(team, f.x, f.y, how.splash) : [f];
          }
          return scored(hits, p);
        });
      case 'cone':
        return bestOf(targets(how.range), e => {
          const a = Math.atan2(e.y - me.y, e.x - me.x);
          return scored(G.foesInCone(team, me.x, me.y, a, how.range, how.half), e);
        });
      case 'aoe':
        return bestOf(targets(how.range + how.radius * 0.7), e => {
          const p0 = aimPoint(e), p = G.clampReach(me, p0.x, p0.y, how.range);
          return scored(G.foesInRadius(team, p.x, p.y, how.radius), p);
        });
      case 'self':
        return scored(G.foesInRadius(team, me.x, me.y, how.radius), me, false);
      case 'twin':
        if (me.form === 'melee') return scored(G.foesInRadius(team, me.x, me.y, 140), me, false);
        return bestOf(targets(600), e => {
          const p = aimPoint(e);
          return scored(G.foesInRadius(team, p.x, p.y, 300).sort((u, v) => worth(v) - worth(u)).slice(0, 2), p);
        });
      case 'foe': {
        if (how.engage && fleeing) { const s = escapePoint(how.range, foe); return s && { score: 8, x: s.x, y: s.y }; }
        const list = targets(how.range);
        if (!list.length) return null;
        const t = list.includes(foe) ? foe : list.reduce((a, b) => (worth(b) > worth(a) ? b : a));
        return { score: worth(t), x: t.x, y: t.y, hero: t === foe };
      }
      case 'dash':
      case 'blink': {
        const cornered = how.use === 'blink' && foe && foeD < 170 && !foe.basic.ranged && hpF < 0.6;
        if (fleeing || cornered) { const s = escapePoint(how.range, foe); return s && { score: 8, x: s.x, y: s.y }; }
        if (how.use === 'dash' && duel && hpF > 0.35) {
          const reach = me.r + foe.r + me.basic.range;
          if (foeD > reach + 40 && foeD < how.range + 60) { const p = aimPoint(foe); return { score: 6, x: p.x, y: p.y, hero: true, aimed: true }; }
        }
        return null;
      }
      case 'buff':
        if (duel && foeD < 500) return { score: 6, x: me.x, y: me.y };
        if (me.attackTarget && !me.attackTarget.dead) return scored(G.foesInRadius(team, me.x, me.y, how.radius + 120), me, false);
        return null;
      case 'shield': {
        const around = sumWorth(G.foesInRadius(team, me.x, me.y, how.radius + 160, { buildings: false }));
        return hpLost(1.5) > me.maxHp * 0.05 || around >= 5 ? { score: 5 + around, x: me.x, y: me.y } : null;
      }
      case 'zone': {
        const fighting = sumWorth(G.foesInRadius(team, me.x, me.y, 450, { buildings: false }));
        const allies = G.alliesOf(team).filter(a => G.dist(a.x, a.y, me.x, me.y) < how.radius).length;
        const score = (fighting >= 2 ? 1 + allies * 0.6 + (fighting >= 5 ? 2 : 0) : 0) + (hpF < 0.55 ? 4 : 0);
        return score ? { score, x: me.x, y: me.y } : null;
      }
      case 'summon': {
        const list = targets(650), w = sumWorth(list);
        if (w < 2) return null;
        const p = G.clampReach(me, list[0].x, list[0].y, how.range);
        return { score: Math.min(8, w), x: p.x, y: p.y };
      }
      case 'rewind': {
        const h = me.history, past = h[Math.max(0, h.length - 30)];
        return past && past.hp - me.hp > me.maxHp * 0.22 && danger(past.x, past.y) <= danger(me.x, me.y) + 10 ? { score: 9, x: me.x, y: me.y } : null;
      }
    }
    return null;
  }

  function tryCasts() {
    if (me.stunned || me.dash || me.state.cutting > 0) return;
    const book = PLAYBOOK[me.def.id];
    if (!book) return;
    const foe = enemyHero();
    const ult = me.def.abilities.find(a => a.ult);
    let best = null;
    for (const ab of me.def.abilities) {
      if ((me.cooldowns[ab.key] || 0) > 0 || me.mana < ab.mana || !book[ab.key]) continue;
      const c = judge(book[ab.key], foe);
      if (!c) continue;
      // The ultimate waits for a big moment, or a hurt enemy hero in reach.
      const need = ab.ult && !(c.hero && foe && foe.hp / foe.maxHp < 0.6) ? diff.ultMin : diff.minHit;
      if (c.score < need) continue;
      // Careful heroes don't spend the mana their ultimate is about to need on small casts.
      if (!ab.ult && ult && diff.careful && c.score < 5 && (me.cooldowns[ult.key] || 0) < 3 && me.mana - ab.mana < ult.mana) continue;
      if (!best || c.score > best.c.score) best = { ab, c };
    }
    if (!best || Math.random() > diff.cast) return;
    let { x, y } = best.c;
    if (best.c.aimed && diff.aimErr) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * diff.aimErr;
      x += Math.cos(a) * r; y += Math.sin(a) * r;
    }
    G.tryCast(me, best.ab, x, y);
  }

  // ---------------------------------------------------------------------------
  G.ai = {
    get hero() { return me; },
    get difficulty() { return diff; },
    get goal() { return goal; },

    // Take control of `hero` (respawning at `home`) at the given difficulty, and apply its team bonuses.
    start(hero, difficultyId, home) {
      me = hero; diff = G.difficultyById(difficultyId); spawn = home;
      goal = null; alarm = null; clock = 0; thinkT = 0.5; castT = 0; buildT = 0;
      lastHp.clear(); seen.clear();
      G.teamBonus[hero.team] = { troopDmg: diff.troopDmg, gold: diff.gold };
    },

    // Called once per update step, before the entities move.
    update(dt) {
      if (!me) return;
      clock += dt;
      track(dt);
      if (me.dead) { goal = null; me.attackTarget = null; return; }
      buildT = Math.max(0, buildT - dt);
      unstick(dt);
      if ((thinkT -= dt) <= 0) { thinkT = diff.think * (0.8 + Math.random() * 0.4); plan(); }
      if ((castT -= dt) <= 0) { castT = Math.max(0.12, diff.think * 0.6); tryCasts(); }
      act();
    }
  };
})(window.Game);
