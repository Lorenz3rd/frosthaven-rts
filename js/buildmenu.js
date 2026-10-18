// Build menu: pops up at the clicked slot and lets the player pick a building type.
// G.makeBuildMenu(player) makes one for a player { hero, pad, cam, keyboard, scheme }: split screen gives
// each player their own, kept inside their view. The keyboard only drives a menu whose player has `keyboard`.
(function (G) {
  // `page` opens a submenu instead of building.
  const MAIN = [
    { type: 'hut', icon: '⌂', hotkey: '1' },
    { page: 'defense', name: 'Defense', icon: '♜', hotkey: '2' },
    { page: 'barracks', name: 'Barracks', icon: '⚔', hotkey: '3' },
    { page: 'allies', name: 'Allies', icon: '✚', hotkey: '4' },
    // Developer mode: build for the enemy side.
    { type: 'hut', icon: '⌂', hotkey: '5', enemy: true },
    { page: 'defense', name: 'Defense', icon: '♜', hotkey: '6', enemy: true },
    { page: 'barracks', name: 'Barracks', icon: '⚔', hotkey: '7', enemy: true },
    { page: 'allies', name: 'Allies', icon: '✚', hotkey: '8', enemy: true }
  ];
  // The Wall rings the whole base the slot is in, leaving the slot itself free (see G.buildWall).
  const DEFENSE = [
    { type: 'digin', icon: '⛺', hotkey: '1' },
    { type: 'support', icon: '♜', hotkey: '2' },
    { type: 'siege', icon: '☄', hotkey: '3' },
    { type: 'wall', icon: '▥', hotkey: '4' },
    { type: 'energy', icon: '⚡', hotkey: '5' },
    { type: 'rock', icon: '●', hotkey: '6' },
    { type: 'fortress', icon: '♖', hotkey: '7' },
    { type: 'storm', icon: '☁', hotkey: '8' },
    { name: 'Special', icon: '✦', hotkey: '9', disabled: true },  // TODO: to be implemented later
    { back: true, name: 'Back', icon: '←', hotkey: 'backspace', label: '⌫' }
  ];
  const BARRACKS = [
    { page: 'infantry', name: 'Infantry', icon: '⚔', hotkey: '1' },
    { page: 'ranged', name: 'Ranged', icon: '➹', hotkey: '2' },
    { page: 'mobile', name: 'Mobile', icon: '♞', hotkey: '3' },
    { page: 'special', name: 'Special', icon: '✦', hotkey: '4' },
    { back: true, name: 'Back', icon: '←', hotkey: 'backspace', label: '⌫' }
  ];
  // Troop pages: each entry is a barracks, listed by the troops it trains. Back returns to Barracks.
  const INFANTRY = [
    { type: 'barracks', icon: '⚔', hotkey: '1' },
    { type: 'barracksSpear', icon: '↟', hotkey: '2' },
    { type: 'barracksElite', icon: '✦', hotkey: '3' },
    { type: 'barracksArmored', icon: '⛨', hotkey: '4' },
    { back: 'barracks', name: 'Back', icon: '←', hotkey: 'backspace', label: '⌫' }
  ];
  const RANGED = [
    { type: 'barracksShort', icon: '➶', hotkey: '1' },
    { type: 'barracksLong', icon: '➹', hotkey: '2' },
    { type: 'barracksCaster', icon: '✺', hotkey: '3' },
    { back: 'barracks', name: 'Back', icon: '←', hotkey: 'backspace', label: '⌫' }
  ];
  const MOBILE = [
    { type: 'barracksCreature', icon: '🐾', hotkey: '1' },
    { type: 'barracksMounted', icon: '♞', hotkey: '2' },
    { type: 'barracksWarMachine', icon: '⚙', hotkey: '3' },
    { back: 'barracks', name: 'Back', icon: '←', hotkey: 'backspace', label: '⌫' }
  ];
  // Special: the two troops only the building side's race trains (see G.RACES[].special).
  const SPECIAL_ICONS = { ram: '♈', longbow: '➹', stormspeaker: '☈', icespeaker: '❄', wavethrower: '🌊', clawcrusher: '🦀',
    ruinedMachine: '🔩', burrowingBlade: '⛏' };
  const SPECIAL = team => G.specialBarracks(team).map((type, i) => ({ type, icon: SPECIAL_ICONS[G.BUILDINGS[type].squad] || '✦', hotkey: String(i + 1) }))
    .concat({ back: 'barracks', name: 'Back', icon: '←', hotkey: 'backspace', label: '⌫' });
  const ALLIES = [
    { type: 'allyEngineer', name: 'Engineer', icon: '⚒', hotkey: '1' },
    { type: 'allyMedic', name: 'Medic', icon: '✚', hotkey: '2' },
    { type: 'allyOfficer', name: 'Officer', icon: '⚑', hotkey: '3' },
    { type: 'allyDemolitionist', name: 'Demolitionist', icon: '✹', hotkey: '4' },
    { back: true, name: 'Back', icon: '←', hotkey: 'backspace', label: '⌫' }
  ];
  const PAGES = { defense: { list: DEFENSE, title: 'Defense' }, barracks: { list: BARRACKS, title: 'Barracks' }, allies: { list: ALLIES, title: 'Allies' },
    infantry: { list: INFANTRY, title: 'Infantry' }, ranged: { list: RANGED, title: 'Ranged' }, mobile: { list: MOBILE, title: 'Mobile' },
    special: { list: SPECIAL, title: 'Special' } };
  // Opened by left-clicking one of the hero's own buildings.
  const DEMOLISH = [
    { action: 'destroy', name: 'Destroy', icon: '⚒', hotkey: '1' },
    { action: 'cancel', name: 'Cancel', icon: '✕', hotkey: '2', back: true }
  ];

  G.makeBuildMenu = function (player) {
    let el, pending = null; // pending = {base, slot} the menu was opened for
    let target = null;      // friendly building the menu was opened for (demolish mode)
    let options = MAIN, enemy = false, at = { x: 0, y: 0 };
    let sel = 0;            // controller-highlighted option
    let stickDir = 0, stickHold = 0;  // left stick: direction held and time until it repeats

    // -1/1 when the left stick is pushed up/down (once, then repeating while held), else 0.
    function stickStep() {
      const y = player.pad.move.y, dir = y > 0.5 ? 1 : y < -0.5 ? -1 : 0;
      if (dir !== stickDir) { stickDir = dir; stickHold = 0.4; return dir; }
      if (dir && (stickHold -= G.STEP) <= 0) { stickHold = 0.15; return dir; }
      return 0;
    }

    // list: options, or fn(team) -> options for a page that depends on who it builds for.
    function show(list, forEnemy, pageTitle) {
      const main = list === MAIN, hero = player.hero;
      // "Enemy" options build for the other side from this hero.
      const other = hero.team === G.TEAM.PLAYER ? G.TEAM.ENEMY : G.TEAM.PLAYER;
      if (typeof list === 'function') list = list(forEnemy ? other : hero.team);
      if (!G.dev) list = list.filter(o => !o.enemy);
      options = list; enemy = forEnemy; sel = 0;
      // A stick already pushed when the menu comes up doesn't move the highlight until it's let go.
      const y = player.pad.move.y;
      stickDir = y > 0.5 ? 1 : y < -0.5 ? -1 : 0;
      const title = main ? 'Build' : forEnemy ? pageTitle + ' (enemy)' : pageTitle;
      el.innerHTML = `<div class="title${!main && forEnemy ? ' enemy' : ''}">${title}</div>` + list.map((o, i) => {
        // Buildings are named by the race that would own them; allies also show the unit they train.
        // Troop barracks are listed by their troops, with squad size and strengths underneath.
        const team = o.enemy || forEnemy ? other : hero.team;
        const squad = o.type && G.BUILDINGS[o.type].squad, k = squad && G.SQUAD_KINDS[squad];
        const name = !squad ? (o.type ? G.buildingName(o.type, team) : o.name)
          : k.ally ? G.buildingName(o.type, team) + `<small>${G.unitName(squad)}</small>`
            : G.unitName(squad) + `<small>${[k.cols * k.rows + ' per squad', ...G.strengthText(squad), k.desc].filter(Boolean).join(' · ')}</small>`;
        const header = o.enemy && !list[i - 1].enemy ? '<div class="title enemy">Test: enemy</div>' : '';
        const cls = (i === sel && player.scheme === 'pad' ? 'sel ' : '') + (o.enemy || (forEnemy && o.type) ? 'enemy' : '') + (o.back ? ' back' : '');
        return header + `<button data-i="${i}" class="${cls}"${o.disabled ? ' disabled title="Coming later"' : ''}><span class="icon">${o.icon}</span>` +
          `<span class="name">${name}</span>${o.type && !o.enemy && !forEnemy ? `<span class="cost">${G.dev ? '∞' : G.BUILDINGS[o.type].cost + 'g'}</span>` : ''}` +
          (player.keyboard ? `<span class="hotkey">${o.label || o.hotkey}</span>` : '') + '</button>';
      }).join('');
      // Keep the menu fully inside the player's view.
      const w = el.offsetWidth, h = el.offsetHeight, c = player.cam;
      el.style.left = G.clamp(at.x + 12, c.x + 8, c.x + c.w - w - 8) + 'px';
      el.style.top = G.clamp(at.y - h / 2, c.y + 8, c.y + c.h - h - 8) + 'px';
    }

    const menu = {
      init() {
        el = document.createElement('div');
        el.className = 'buildMenu';
        el.hidden = true;
        document.body.appendChild(el);
        el.addEventListener('click', e => {
          const btn = e.target.closest('button');
          if (btn) menu.choose(options[btn.dataset.i]);
        });
        el.addEventListener('contextmenu', e => e.preventDefault());
      },

      get isOpen() { return !!pending; },
      get pending() { return pending; },

      // (sx, sy): page position to pop up beside.
      open(hit, sx, sy) {
        pending = hit;
        target = null;
        at = { x: sx, y: sy };
        el.hidden = false;
        show(MAIN, false);
      },

      get isDemolish() { return !!target; },

      // Menu for a building: Destroy sends the hero over to tear it down.
      openDemolish(b, sx, sy) {
        target = b;
        pending = null;
        at = { x: sx, y: sy };
        el.hidden = false;
        show(DEMOLISH, false, G.buildingName(b.type, b.team));
      },

      close() { pending = null; target = null; if (el) el.hidden = true; },

      choose(opt) {
        const hero = player.hero;
        if (target) {
          const b = target;
          menu.close();
          if (opt.action === 'destroy' && !b.dead) player.act.demolish(b);
          return;
        }
        if (!pending || opt.disabled) return;
        // Sub-pages keep building for whichever side the page was opened for.
        if (opt.page) { const pg = PAGES[opt.page]; show(pg.list, !!opt.enemy || enemy, pg.title); return; }
        if (opt.back) { const pg = PAGES[opt.back]; if (pg) show(pg.list, enemy, pg.title); else show(MAIN, false); return; }
        const other = hero.team === G.TEAM.PLAYER ? G.TEAM.ENEMY : G.TEAM.PLAYER;
        player.act.build(pending, opt.type, opt.enemy || enemy ? other : hero.team);
        menu.close();
      },

      // Called once per update step.
      update() {
        if (!pending && !target) return;
        if (player.keyboard) {
          const p = G.input.pressed;
          if (p.escape) { menu.close(); return; }
          for (const o of options) if (p[o.hotkey]) { menu.choose(o); return; }
        }
        // Controller: left stick / D-pad to highlight, A to choose, B to back out, LB to exit.
        const d = player.pad.down, B = G.PAD_BTN;
        if (player.scheme !== 'pad') return;
        if (d[B.LB]) { menu.close(); return; }
        if (d[B.B]) { const back = options.find(o => o.back); if (back) menu.choose(back); else menu.close(); return; }
        const dy = (d[B.DOWN] ? 1 : 0) - (d[B.UP] ? 1 : 0) || stickStep();
        if (dy) {
          sel = (sel + dy + options.length) % options.length;
          el.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', i === sel));
        }
        if (d[B.A]) menu.choose(options[sel]);
      }
    };
    return menu;
  };
})(window.Game);
