// HUD: DOM-based ability bar (Q W E R with cooldown sweeps, a passive pip on the third, the ultimate
// set apart) plus hero name, HP bar and gold. Hovering an ability shows its description.
// One panel per player: split screen copies the #hud panel for the second player, one under each half.
(function (G) {
  let tip;
  let ccBars = [];  // [{team, fill, text}] top-of-screen Command Center health
  let cpuInfo;      // single player: the CPU hero's name, difficulty and health
  let views = [];   // one per player

  // The HUD redraws every frame, but its values rarely change: only touch the DOM when they do (any
  // write invalidates style and layout, even an unchanged one).
  const text = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
  const style = (el, k, v) => { const c = '_' + k; if (el[c] !== v) { el[c] = v; el.style[k] = v; } };
  const toggle = (el, cls, on) => { const c = '_' + cls; if (el[c] !== on) { el[c] = on; el.classList.toggle(cls, on); } };

  // Ability key labels: keyboard keys, or the controller buttons a split-screen player casts with.
  const PAD_KEYS = ['Ⓧ', 'Ⓨ', 'Ⓑ', 'RB'];

  function makeView(root, player) {
    const hero = player.hero, def = hero.def;
    const q = sel => root.querySelector(sel);
    const hpFill = q('.bar.hp .fill'), hpText = q('.bar.hp span');
    const goldText = q('.gold');
    const name = q('.heroName');
    name.textContent = (player.label ? player.label + ' · ' : '') + `${def.name} · ${def.role}`;
    name.style.color = def.css;
    const bar = q('.abilities');
    bar.innerHTML = '';
    const slots = [];
    let pip = null, pipText = null, hovered = null;
    // A locked ability (or passive) says what opens it, with progress so far.
    const lockLine = k => {
      if (G.isUnlocked(hero, k)) return '';
      const p = G.unlockProgress(hero, k);
      return `<br><span class="lockReq">🔒 ${p.text} · ${p.have}/${p.need}</span>`;
    };
    def.abilities.forEach((ab, i) => {
      const key = player.keyboard ? ab.key.toUpperCase() : PAD_KEYS[i];
      const el = document.createElement('div');
      el.className = 'ability' + (ab.ult ? ' ult' : '');
      el.style.setProperty('--hero', def.css);
      el.innerHTML =
        `<div class="icon">${ab.icon}</div><div class="sweep"></div><div class="cd"></div>` +
        `<div class="key">${key}</div><div class="prog"></div>`;
      if (i === 2) {
        // The third ability also carries the hero's passive.
        pip = document.createElement('div');
        pip.className = 'passive';
        pip.innerHTML = `<span>${def.passive.icon}</span><b></b>`;
        el.appendChild(pip);
        pipText = pip.querySelector('b');
      }
      // The third ability's description also summarizes the passive; the tooltip lists it on its own.
      const tipHtml = () => `<b>${ab.name}</b> <i>${key} · ${ab.cooldown}s</i>${lockLine(ab.key)}<br>${ab.desc.split(' Passive —')[0]}` +
        (i === 2 ? `<br><br><b>Passive — ${def.passive.name}</b>${lockLine('passive')}<br>${def.passive.desc}` : '');
      const slot = { ab, el, tipHtml, sweep: el.querySelector('.sweep'), cd: el.querySelector('.cd'), prog: el.querySelector('.prog') };
      el.addEventListener('mouseenter', () => {
        hovered = slot;
        tip.innerHTML = tip._html = tipHtml(); tip.hidden = false;
        // Show the tip above this panel.
        const r = root.getBoundingClientRect();
        tip.style.left = (r.left + r.width / 2) + 'px';
      });
      el.addEventListener('mouseleave', () => { hovered = null; tip.hidden = true; });
      bar.appendChild(el);
      slots.push(slot);
    });

    return function update() {
      style(hpFill, 'width', (100 * hero.hp / hero.maxHp).toFixed(1) + '%');
      text(hpText, `${Math.ceil(hero.hp)} / ${hero.maxHp}` + (hero.shieldAmt > 0 ? ` (+${Math.ceil(hero.shieldAmt)})` : ''));
      text(goldText, G.dev ? '● ∞ gold' : `● ${hero.gold} gold`);
      if (pip) {
        const open = G.isUnlocked(hero, 'passive');
        toggle(pip, 'locked', !open);
        text(pipText, !open ? '🔒' : hero.def.passiveText ? hero.def.passiveText(hero) : '');
      }

      for (const s of slots) {
        const open = G.isUnlocked(hero, s.ab.key);
        const left = open ? hero.cooldowns[s.ab.key] || 0 : 0;
        const frac = left / s.ab.cooldown;
        style(s.sweep, 'background', left > 0
          ? `conic-gradient(rgba(5,15,25,0.72) ${(frac * 360).toFixed(1)}deg, transparent 0)`
          : 'none');
        text(s.cd, !open ? '🔒' : left > 0 ? String(left >= 1 ? Math.ceil(left) : left.toFixed(1)) : '');
        if (!open) { const p = G.unlockProgress(hero, s.ab.key); text(s.prog, `${p.have}/${p.need}`); }
        else text(s.prog, '');
        // Flash the slot the moment it opens.
        if (s.wasLocked && open) { s.el.classList.remove('unlocked'); void s.el.offsetWidth; s.el.classList.add('unlocked'); }
        s.wasLocked = !open;
        toggle(s.el, 'locked', !open);
        toggle(s.el, 'ready', open && left <= 0);
      }
      if (hovered && !tip.hidden) { const html = hovered.tipHtml(); if (tip._html !== html) { tip._html = html; tip.innerHTML = html; } }
    };
  }

  G.hud = {
    // players: [{ hero, keyboard, label }] (see main.js).
    init(players) {
      // The left bar is always the viewer's own side (an East player in a network game sees East first).
      const own = players[0].hero.team, other = own === G.TEAM.PLAYER ? G.TEAM.ENEMY : G.TEAM.PLAYER;
      ccBars = [[own, '.you'], [other, '.enemy']].map(([team, sel]) => {
        const el = document.querySelector('#commandBars ' + sel);
        el.querySelector('.label').textContent = G.buildingName('command', team);
        return { team, fill: el.querySelector('.fill'), text: el.querySelector('.bar span') };
      });
      cpuInfo = document.getElementById('cpuInfo');
      cpuInfo.hidden = !G.ai.hero;
      tip = document.getElementById('abilityTip');
      const first = document.getElementById('hud');
      views = players.map((p, i) => {
        let root = first;
        if (i > 0) {
          root = first.cloneNode(true);
          root.removeAttribute('id');
          first.parentNode.insertBefore(root, first.nextSibling);
        }
        root.dataset.slot = i;
        return makeView(root, p);
      });
    },

    update() {
      for (const c of ccBars) {
        const b = G.commandCenters[c.team];
        style(c.fill, 'width', (100 * Math.max(0, b.hp) / b.maxHp).toFixed(1) + '%');
        text(c.text, `${Math.ceil(Math.max(0, b.hp))} / ${b.maxHp}`);
      }
      const cpu = G.ai.hero;
      if (cpu) {
        const html = `<b>CPU</b> ${cpu.def.name} · ${G.ai.difficulty.name} · ` +
          (cpu.dead ? 'fallen' : `${Math.ceil(cpu.hp)} / ${cpu.maxHp}`);
        if (cpuInfo.innerHTML !== html) cpuInfo.innerHTML = html;
      }
      for (const v of views) v();
    }
  };
})(window.Game);
