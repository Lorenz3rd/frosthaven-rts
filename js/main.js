// Boot: build the world, wire input to the hero, run the loop.
(function (G) {
  // Starts the match in G.matchConfig (set by the menu). mode 'single': the player against a CPU hero
  // (see ai.js) at cfg.difficulty. mode 'local': two to four players on one screen (cfg.players, up to three
  // an army), each hero driven by its player's controller (or the mouse and keyboard, for one of them). mode 'nethost' / 'netclient': a networked 3 vs 3 (see net.js); the
  // host simulates every hero, a client only mirrors the host's world and sends its player's commands.
  // Anything else is the sandbox: the hero vs. training dummies and a static enemy barracks.
  //
  // Each player is { hero, cam, pad, menu, keyboard, scheme, label, moveMarker, act }. One-player games use
  // G.camera, G.pad and the mouse and keyboard; split screen gives each player their own camera (their
  // army's half of the screen, stacked with teammates), controller and build menu; a player assigned 'mkb'
  // plays with the mouse and keyboard in their view instead (their pad never connects). `act` carries out the player's orders: straight on the hero, or (network client) as commands to the host.
  G.startGame = function () {
    const canvas = document.getElementById('game');

    // Races and heroes come from the menu: west is the player, east the enemy.
    const cfg = G.matchConfig || {};
    const single = cfg.mode === 'single', local = cfg.mode === 'local';
    const netHost = cfg.mode === 'nethost', netClient = cfg.mode === 'netclient', net = netHost || netClient;
    const west = (cfg.sides || [])[0] || {}, east = (cfg.sides || [])[1] || {};
    // Local multiplayer's players (a match saved before four-player split screen named one a side).
    const roster = !local ? [] : cfg.players || [['west', west], ['east', east]].map(([side, s]) => ({ side, gamepad: s.gamepad, hero: s.hero }));
    G.teamRace[G.TEAM.PLAYER] = net ? cfg.races[0] : west.race || 'human';
    G.teamRace[G.TEAM.ENEMY] = net ? cfg.races[1] : east.race || 'algox';
    const heroDef = G.heroById(west.hero || 'bannerspear');
    if (net) G.dev = false;   // developer cheats stay out of shared games (not saved)

    G.map.use(cfg.map);
    G.createBases();
    G.createCommandCenters();
    G.resetUnlocks();
    // Spawn by the Command Center's base on each side.
    const HERO_SPAWN = G.map.spawnPoint(G.TEAM.PLAYER, 0);
    const FOE_SPAWN = G.map.spawnPoint(G.TEAM.ENEMY, 0);
    // Sandbox: training dummies stand around the middle of no-man's-land.
    const mid = G.map.w / 2, midY = G.map.h / 2;
    const DUMMY_SPOTS = single || local || net ? [] : [
      { x: mid - 300, y: midY - 930 }, { x: mid + 300, y: midY - 330 }, { x: mid - 300, y: midY + 330 }, { x: mid + 300, y: midY + 930 }
    ];

    G.map.generate(1337, [
      ...G.bases.map(b => ({ x: b.x, y: b.y, r: b.r + 40 })),
      { x: G.map.w / 2, y: G.map.h / 2, r: 0 },
      ...DUMMY_SPOTS.map(p => ({ x: p.x, y: p.y, r: 90 }))
    ]);

    // Network games and local multiplayer: up to three heroes a side, at the map's spawn points (Frosthaven:
    // one by each rear base, middle, then top, then bottom). A network host makes them all; a client gets them (and the rest of the world) from
    // the host's first snapshot.
    let hero = null, localHeroes = [];
    const respawns = [];
    if (netHost) {
      const heroById = {}, perTeam = [0, 0];
      for (const r of cfg.roster) {
        const team = r.team === 1 ? G.TEAM.ENEMY : G.TEAM.PLAYER;
        const at = netSpawn(team, perTeam[team]++ % 3);
        const h = new G.Hero(at.x, at.y, G.heroById(r.hero), team);
        if (team === G.TEAM.ENEMY) h.facing = Math.PI;
        G.entities.push(h);
        heroById[r.id] = h;
        respawns.push({ h, at, t: 0 });
        if (r.id === cfg.me) hero = h;
      }
      G.net.hostBegin(heroById);
    } else if (netClient) {
      hero = G.net.clientBegin(cfg);
    } else if (local) {
      const perTeam = [0, 0];
      localHeroes = roster.map(r => {
        const team = r.side === 'east' ? G.TEAM.ENEMY : G.TEAM.PLAYER;
        const at = netSpawn(team, perTeam[team]++ % 3);
        const h = new G.Hero(at.x, at.y, G.heroById(r.hero || (team === G.TEAM.ENEMY ? 'deathwalker' : 'bannerspear')), team);
        if (team === G.TEAM.ENEMY) h.facing = Math.PI;
        G.entities.push(h);
        respawns.push({ h, at, t: 0 });
        return h;
      });
      hero = localHeroes[0];
    } else {
      hero = new G.Hero(HERO_SPAWN.x, HERO_SPAWN.y, heroDef);
      G.entities.push(hero, ...DUMMY_SPOTS.map(p => new G.AlgoxDummy(p.x, p.y)));
      respawns.push({ h: hero, at: HERO_SPAWN, t: 0 });
    }
    G.hero = hero;
    // Neutral creatures roam no-man's-land (a network client gets them from the host).
    if (!netClient) G.spawnCreatures();
    function netSpawn(team, i) { return G.map.spawnPoint(team, i); }

    // Single player: the CPU hero holds the east. The sandbox enemy has no builder: give it a barracks in
    // its front-middle base so squads have a foe.
    let foe = null;
    if (net || local) {
      // Both sides have their players.
    } else if (single) {
      foe = new G.Hero(FOE_SPAWN.x, FOE_SPAWN.y, G.heroById(east.hero || 'deathwalker'), G.TEAM.ENEMY);
      foe.facing = Math.PI;
      G.entities.push(foe);
      G.ai.start(foe, cfg.difficulty, FOE_SPAWN);
    } else {
      const enemyFront = G.bases.find(b => b.side === G.TEAM.ENEMY && b.front);
      G.addBuilding(enemyFront, enemyFront.slots[4], 'barracks', G.TEAM.ENEMY);
    }
    // Fallen heroes rise at their spawn after 5s.
    if (foe) respawns.push({ h: foe, at: FOE_SPAWN, t: 0 });

    G.render3d.init(canvas);

    // Split-screen labels: the army, numbered when it has more than one player ("West 2").
    const localLabel = r => {
      const army = roster.filter(o => o.side === r.side);
      return (r.side === 'east' ? 'East' : 'West') + (army.length > 1 ? ' ' + (army.indexOf(r) + 1) : '');
    };
    const players = local
      ? localHeroes.map((h, i) => {
          const r = roster[i], label = localLabel(r), mkb = r.gamepad === 'mkb';
          const pad = G.makePad(mkb ? -1 : r.gamepad, false);
          const p = { hero: h, pad, cam: G.makeCamera(pad, mkb), keyboard: mkb, scheme: mkb ? 'mkb' : 'pad', label, moveMarker: null, padWalking: false, pendingCast: null };
          p.cam.init();
          return p;
        })
      : [{ hero, pad: G.pad, cam: G.camera, keyboard: true, get scheme() { return G.controlScheme; }, label: '', moveMarker: null, padWalking: false, pendingCast: null }];
    for (const p of players) {
      p.act = netClient ? G.net.clientActions(p) : G.localActions(p);
      p.menu = G.makeBuildMenu(p);
    }
    G.players = players;
    // The menu Esc closes (rather than pausing): the mouse-and-keyboard player's.
    G.buildMenu = (players.find(p => p.keyboard) || players[0]).menu;
    document.body.classList.toggle('split', local);

    // Win/lose: called when a Command Center falls. The world freezes (effects keep playing)
    // and the result banner comes up.
    G.winner = null;
    G.endGame = function (winner) {
      if (G.winner !== null) return;
      G.winner = winner;
      for (const p of players) p.menu.close();
      const won = winner === G.TEAM.PLAYER;
      const el = document.getElementById('gameOver');
      if (net) {
        // Victory / Defeat for this player's side, naming the army that won.
        const mine = winner === hero.team, army = t => (t === G.TEAM.PLAYER ? 'West' : 'East');
        el.classList.toggle('defeat', !mine);
        el.querySelector('.result').textContent = mine ? 'Victory' : 'Defeat';
        el.querySelector('.detail').textContent = `${army(winner)} Army wins: the ${army(winner === G.TEAM.PLAYER ? G.TEAM.ENEMY : G.TEAM.PLAYER)} Army's Command Center has fallen.`;
        el.querySelector('button').textContent = 'Back to menu';
      } else if (local) {
        // Split screen: name the winning army instead of Victory / Defeat.
        el.classList.remove('defeat');
        el.querySelector('.result').textContent = (won ? 'West' : 'East') + ' Army wins';
        el.querySelector('.detail').textContent = `The ${won ? 'East' : 'West'} Army's Command Center has fallen.`;
      } else {
        el.classList.toggle('defeat', !won);
        el.querySelector('.result').textContent = won ? 'Victory' : 'Defeat';
        el.querySelector('.detail').textContent = won ? 'The enemy Command Center has fallen.' : 'Your Command Center has fallen.';
      }
      el.hidden = false;
    };
    // Network games end the room: everyone goes back to the menu (a reload) to start another.
    document.querySelector('#gameOver button').addEventListener('click', () => {
      if (net) { G.net.leave(); G.net.backToMenu(); return; }
      location.hash = 'dev'; location.reload();
    });

    // Split screen: the west army on the left half, the east on the right, each half shared out in rows
    // between that army's players (two a side: four quarters). Divider lines run along the seams.
    const dividers = document.getElementById('splitDivider');
    function resize() {
      const W = window.innerWidth, H = window.innerHeight;
      if (local) {
        const cols = [G.TEAM.PLAYER, G.TEAM.ENEMY].map(t => players.filter(p => p.hero.team === t)).filter(c => c.length);
        const lines = [];
        cols.forEach((col, c) => {
          const x0 = Math.floor(W * c / cols.length), x1 = Math.floor(W * (c + 1) / cols.length);
          if (c) lines.push(`<div class="v" style="left:${x0}px"></div>`);
          col.forEach((p, r) => {
            const y0 = Math.floor(H * r / col.length), y1 = Math.floor(H * (r + 1) / col.length);
            p.cam.resize(x1 - x0, y1 - y0, x0, y0);
            if (r) lines.push(`<div class="h" style="top:${y0}px;left:${x0}px;width:${x1 - x0}px"></div>`);
          });
        });
        dividers.innerHTML = lines.join('');
      } else G.camera.resize(W, H);
      G.render3d.resize(W, H);
      G.hud.layout();
    }

    // Local players' input: orders for their heroes.
    function playerInput() {
      for (const p of players) {
        if (p.hero.dead) p.pendingCast = null;
        if (p.keyboard) mouseKeyboard(p);
        if (p.scheme === 'pad') padControls(p);
        p.menu.update();
      }
    }

    function update(dt) {
      if (local) for (const p of players) p.pad.poll();
      else G.pollPad();
      // A network game can't stop for one player: the menu opens over the running battle.
      const paused = G.pauseMenu.update();
      if (paused && !net) return;
      if (netClient) {
        if (!paused && G.winner === null && !G.netLost) playerInput();
        G.net.clientStep(dt);
        for (const p of players) {
          p.cam.update(dt, p.hero);
          if (p.moveMarker && (p.moveMarker.t += dt) > 0.5) p.moveMarker = null;
        }
        return;
      }
      if (G.winner !== null) {
        G.updateEffects(dt);
        for (const p of players) p.cam.update(dt, p.hero);
        // Split screen: any controller's A plays again (the mouse can click the button).
        if (local && players.some(p => p.pad.down[G.PAD_BTN.A])) document.querySelector('#gameOver button').click();
        if (netHost) G.net.hostTick();
        return;
      }
      if (!paused) playerInput();
      if (netHost) G.net.hostCommands();
      if (single) G.ai.update(dt);

      for (const e of G.entities) e.update(dt);
      G.updateCreatures();
      G.updateSquads(dt);
      for (const r of respawns) {
        if (r.h.away) continue;   // network player who dropped out: off the field until they're back
        if (r.h.dead && (r.t += dt) > 5) { r.t = 0; r.h.respawn(r.at.x, r.at.y); }
      }
      G.updateTowers(dt);
      G.updateCoins(dt);
      G.updateProjectiles(dt);
      G.updateFx(dt);
      G.updateEffects(dt);
      G.updateUnlocks();
      for (const p of players) {
        p.cam.update(dt, p.hero);
        if (p.moveMarker && (p.moveMarker.t += dt) > 0.5) p.moveMarker = null;
      }
      if (netHost) G.net.hostTick();
    }

    // Mouse and keyboard: right-click moves, left-click attacks / builds, QWER cast at the cursor.
    // In split screen only clicks inside the player's own view count.
    function mouseKeyboard(p) {
      const input = G.input, hero = p.hero, cam = p.cam, menu = p.menu;
      const inView = c => c.x >= cam.x && c.x < cam.x + cam.w && c.y >= cam.y && c.y < cam.y + cam.h;
      const toWorld = c => cam.screenToWorld(c.x - cam.x, c.y - cam.y);
      const menuUp = menu.isOpen || menu.isDemolish;  // its number hotkeys aren't orders
      // Ability confirm: any click or other key cancels the previewed ability (and still does its own thing).
      const pc = p.pendingCast;
      if (pc && (input.rightClicks.length || input.leftClicks.length || Object.keys(input.pressed).some(k => k !== pc.ab.key))) p.pendingCast = null;
      for (const c of hero.dead ? [] : input.rightClicks.filter(inView)) {
        const w = toWorld(c);
        p.act.move(w.x, w.y);
        p.moveMarker = { x: w.x, y: w.y, t: 0 };
      }
      if (input.rightClicks.length) menu.close();
      for (const c of input.leftClicks.filter(inView)) {
        const w = toWorld(c);
        // Developer mode: left-click any building (either side) for the destroy menu.
        const anyB = G.dev && !hero.dead ? demolishable(hero, w.x, w.y, 0) : null;
        if (anyB) { menu.openDemolish(anyB, c.x, c.y); continue; }
        // Left-click on a hostile: basic attack (hero chases into reach first).
        const foe = hero.dead ? null : G.foesOf(hero.team).find(e => G.dist(w.x, w.y, e.x, e.y) < e.r + 10);
        if (foe) { menu.close(); p.act.attack(foe); continue; }
        // Left-click on one of your own buildings: menu to destroy it or cancel.
        // The Command Center can't be torn down.
        const mine = hero.dead ? null : demolishable(hero, w.x, w.y, 0);
        if (mine) { menu.openDemolish(mine, c.x, c.y); continue; }
        // Any click on the ground closes the menu; a click on a buildable slot (re)opens it there.
        menu.close();
        if (hero.demolishTarget) p.act.clearDemolish();
        const hit = G.slotClick(hero, w.x, w.y);
        if (hit) menu.open(hit, c.x, c.y);
      }
      for (const ab of hero.def.abilities) {
        if (input.pressed[ab.key]) castOrPreview(p, ab, 'mkb');
      }
      if (input.pressed.f && !hero.dead) p.act.follow();
      // 1-4: orders for every commanded soldier (see G.commandOrder).
      G.COMMAND_ORDERS.forEach((o, i) => { if (input.pressed[i + 1] && !menuUp && !hero.dead) p.act.order(o); });
    }

    // An ability button press. Normally it casts. With "ability confirm before cast" on, the first press
    // only shows the preview (p.pendingCast, drawn by render3d) and pressing the same ability again casts.
    // A failed cast (e.g. nothing in reach) keeps the preview up.
    function castOrPreview(p, ab, via) {
      if (!G.isUnlocked(p.hero, ab.key)) { p.pendingCast = null; G.lockedNotice(p.hero, ab.key); return; }
      const pc = p.pendingCast;
      if (!G.confirmCast || (pc && pc.ab === ab)) {
        const t = aimFor(p, ab, via);
        if (p.act.cast(ab, t.x, t.y)) p.pendingCast = null;
        return;
      }
      p.pendingCast = G.canCast(p.hero, ab) ? { ab, via } : null;
    }
    // Where an ability would go: the cursor (mouse and keyboard), else along the left stick (controller),
    // as far out as the stick is tilted: fully tilted is the ability's full range. With the stick
    // centered, full range straight ahead.
    function aimFor(p, ab, via) {
      const hero = p.hero;
      if (via === 'mkb') return p.cam.screenToWorld(G.input.mouse.x - p.cam.x, G.input.mouse.y - p.cam.y);
      const reach = ab.range || 400, m = p.pad.move, tilt = Math.min(1, Math.hypot(m.x, m.y));
      const a = tilt ? Math.atan2(m.y, m.x) : hero.facing, d = tilt ? reach * tilt : reach;
      return { x: hero.x + Math.cos(a) * d, y: hero.y + Math.sin(a) * d };
    }

    // A building the hero may tear down within `pad` of (x, y): their own, or (developer mode) any.
    // The Command Center can't be torn down.
    function demolishable(hero, x, y, pad) {
      return G.buildingList().find(b => (G.dev || b.team === hero.team) && !G.BUILDINGS[b.type].command && G.dist(x, y, b.x, b.y) < b.r + pad) || null;
    }

    // Controller scheme: left stick walks the hero, face buttons act around them.
    // Abilities: X Y B RB = Q W E R.
    const CAST_BTNS = [G.PAD_BTN.X, G.PAD_BTN.Y, G.PAD_BTN.B, G.PAD_BTN.RB];
    function padControls(p) {
      const hero = p.hero, pad = p.pad, menu = p.menu, d = pad.down, B = G.PAD_BTN;
      // Ability confirm: any other button (zoom triggers aside) cancels the previewed ability.
      const pc = p.pendingCast;
      if (pc) {
        const own = CAST_BTNS[hero.def.abilities.indexOf(pc.ab)];
        if (d.some((v, i) => v && i !== own && i !== B.LT && i !== B.RT)) p.pendingCast = null;
      }
      if (hero.dead || menu.isOpen || menu.isDemolish) return;
      const m = pad.move;
      // Walking overrides the attack. The one exception: the stick still pointing (within 45°) the way it
      // aimed the A press, so aiming doesn't cancel itself. Steer elsewhere or let go and it's walking again.
      const aimOff = p.aimDir == null ? Infinity : Math.atan2(m.y, m.x) - p.aimDir;
      if (!(m.x || m.y)) {
        p.aimDir = null;
        if (p.padWalking) { p.act.stop(); p.padWalking = false; }
      } else if (!(Math.abs(Math.atan2(Math.sin(aimOff), Math.cos(aimOff))) <= Math.PI / 4 && hero.attackTarget && !hero.attackTarget.dead)) {
        p.aimDir = null;
        p.act.move(hero.x + m.x * 80, hero.y + m.y * 80);
        p.padWalking = true;
      }

      // The hero's spot on the page (menus pop up beside it).
      const hs = () => { const s = p.cam.worldToScreen(hero.x, hero.y, 40); return { x: s.x + p.cam.x, y: s.y + p.cam.y }; };
      // A: basic attack on a foe picked by the stick's direction (or the way the hero faces).
      if (d[B.A]) {
        const foe = padAttackTarget(hero, m);
        if (foe) {
          p.act.attack(foe);
          p.aimDir = m.x || m.y ? Math.atan2(m.y, m.x) : null; p.padWalking = false;
        }
      }
      // LB: on/next to a build slot, the build menu (LB again closes it). Next to one of your own
      // buildings instead, the destroy menu.
      if (d[B.LB]) {
        const hit = G.slotAt(hero.x, hero.y) || nearestSlot(hero);
        const ok = hit && G.slotClick(hero, hit.slot.x, hit.slot.y);
        const b = ok ? null : demolishable(hero, hero.x, hero.y, hero.r + 80);
        if (ok) { const s = hs(); menu.open(ok, s.x, s.y); pad.down = []; }  // don't let this LB close it again
        else if (b) { const s = hs(); menu.openDemolish(b, s.x, s.y); pad.down = []; }
      }
      // Abilities aim along the left stick, as far as it is tilted (see aimFor).
      CAST_BTNS.forEach((btn, i) => { if (d[btn]) castOrPreview(p, hero.def.abilities[i], 'pad'); });
      // Left stick click: call soldiers (F).
      if (d[B.L3]) p.act.follow();
      // D-pad: orders for every commanded soldier. Down cancel, left guard, right alert, up charge.
      [B.DOWN, B.LEFT, B.RIGHT, B.UP].forEach((btn, i) => { if (d[btn]) p.act.order(G.COMMAND_ORDERS[i]); });
    }
    // Controller attack target within 12 m, aimed by the left stick (the hero's facing when the stick is
    // centered). An enemy hero anywhere in that half of the circle wins outright; otherwise the nearest foe
    // within 45° of the aim, then within 90°, then in any direction.
    function padAttackTarget(hero, m) {
      const RANGE = G.m(12);
      const aim = m.x || m.y ? Math.atan2(m.y, m.x) : hero.facing;
      const foes = G.foesOf(hero.team).map(e => {
        const off = Math.atan2(e.y - hero.y, e.x - hero.x) - aim;
        return { e, d: G.dist(hero.x, hero.y, e.x, e.y) - (e.r || 0), ang: Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) };
      }).filter(f => f.d < RANGE);
      const nearest = list => list.reduce((a, b) => (!a || b.d < a.d ? b : a), null);
      const pick = nearest(foes.filter(f => f.e instanceof G.Hero && f.ang <= Math.PI / 2)) ||
        nearest(foes.filter(f => f.ang <= Math.PI / 4)) ||
        nearest(foes.filter(f => f.ang <= Math.PI / 2)) ||
        nearest(foes);
      return pick ? pick.e : null;
    }
    function nearestSlot(hero) {
      const base = G.baseAt(hero.x, hero.y);
      if (!base) return null;
      let best = null, bd = G.SLOT_R + hero.r + 60;
      for (const slot of base.slots) {
        if (slot.core || slot.wall) continue;
        const dd = G.dist(hero.x, hero.y, slot.x, slot.y);
        if (dd < bd) { bd = dd; best = { base, slot }; }
      }
      return best;
    }

    function render() {
      G.render3d.render(players.map(p => {
        // While the build menu is open, keep its slot highlighted; otherwise the slot under the mouse.
        let hover = p.menu.pending;
        const m = G.input.mouse, c = p.cam;
        if (!hover && p.keyboard && m.inside && m.x >= c.x && m.x < c.x + c.w && m.y >= c.y && m.y < c.y + c.h) {
          const mw = c.screenToWorld(m.x - c.x, m.y - c.y);
          hover = G.slotAt(mw.x, mw.y);
        }
        // Ability confirm: the previewed ability's shape, following the hero and the aim.
        const pc = p.pendingCast;
        let cast = null;
        if (pc) { const t = aimFor(p, pc.ab, pc.via); cast = { shapes: G.castPreview(p.hero, pc.ab, t.x, t.y), color: p.hero.def.color }; }
        return { cam: p.cam, hero: p.hero, hover, moveMarker: p.moveMarker, cast };
      }));
      G.hud.update();
      G.minimap.render();
    }

    window.addEventListener('resize', resize);
    resize();
    G.initInput(canvas);
    G.hud.init(players);
    for (const p of players) p.menu.init();
    G.pauseMenu.init();
    G.minimap.init();
    for (const p of players) p.cam.centerOn(p.hero.x, p.hero.y);
    G.startLoop(update, render);
  };
})(window.Game);
