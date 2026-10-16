// Ability unlocks: every hero starts a match with Q, W, E, the passive and R locked. Each opens for the
// rest of the match once its requirement is met. Developer mode unlocks everything.
// Progress lives on the hero (h.unlock) so network clients get it with the hero (see net.js).
(function (G) {
  const T = G.TEAM;
  const foeTeam = team => (team === T.PLAYER ? T.ENEMY : T.PLAYER);

  // progress(h) reads h.unlock; `need` is the target. Order matches the HUD: Q W E passive R.
  G.UNLOCKS = {
    q: { need: 5, text: 'Kill 5 enemy units (killing blows only)', progress: u => u.kills },
    w: { need: 4, text: "Claim 4 bases (your Command Center base doesn't count)", progress: u => u.bases },
    e: { need: 6, text: 'Fill all 6 build slots of a base', progress: u => u.slots },
    passive: { need: 200, text: 'Deal 200 damage to enemy heroes yourself', progress: u => u.heroDmg },
    r: { need: 1, text: 'Destroy an enemy building', progress: u => u.razed }
  };

  G.newUnlocks = () => ({ kills: 0, heroDmg: 0, bases: 0, slots: 0, razed: 0, done: {} });

  // key: an ability key ('q' 'w' 'e' 'r') or 'passive'.
  G.isUnlocked = (h, key) => G.dev || !!(h.unlock && h.unlock.done[key]);
  G.passiveOn = h => G.isUnlocked(h, 'passive');
  G.unlockProgress = function (h, key) {
    const req = G.UNLOCKS[key];
    return { have: Math.min(req.need, Math.floor(req.progress(h.unlock || G.newUnlocks()))), need: req.need, text: req.text };
  };

  // A hero of `src` dealt `dealt` damage to `target` (any route: abilities, basic attacks, burns).
  G.noteDamage = function (src, target, dealt) {
    if (src instanceof G.Hero && target instanceof G.Hero && target.team === foeTeam(src.team) && dealt > 0)
      src.unlock.heroDmg += dealt;
  };

  // Killing blows on enemy units (heroes included; neutral creatures don't count).
  G.deathListeners.push((e, src) => {
    const h = src && src.hero;
    if (h instanceof G.Hero && e instanceof G.Entity && e.team === foeTeam(h.team)) h.unlock.kills++;
  });

  // Any enemy building coming down counts, except one its own side tears down. Wall segments are
  // pieces of a wall, not buildings of their own.
  const razed = {}, claimed = {};   // team -> true; team -> Set of base ids
  G.buildingDeathListeners.push((b, by) => {
    if (G.BUILDINGS[b.type].segment || (by && by.team === b.team)) return;
    razed[foeTeam(b.team)] = true;
  });

  // Team-wide progress: bases ever claimed this match (not the Command Center's) and the fullest
  // base's built slots right now.
  function teamStats(team) {
    const home = G.commandCenters[team] && G.commandCenters[team].base;
    const mine = claimed[team] || (claimed[team] = new Set());
    let slots = 0;
    for (const b of G.bases) {
      if (b.team !== team) continue;
      if (b !== home) mine.add(b.id);
      slots = Math.max(slots, b.slots.filter(s => !s.core && !s.wall && s.building).length);
    }
    return { bases: mine.size, slots, razed: razed[team] ? 1 : 0 };
  }

  const LABEL = { q: 'Q', w: 'W', e: 'E', passive: 'Passive', r: 'R' };
  function announce(h, key) {
    const name = key === 'passive' ? h.def.passive.name : h.def.abilities.find(a => a.key === key).name;
    G.floaters.push({ x: h.x, y: h.y - 60, text: `${LABEL[key]} unlocked: ${name}`, t: 0, color: '#ffd27a' });
    if (!h.dead) G.burst(h.x, h.y, h.def.css, 24, 200);
  }

  G.resetUnlocks = function () { for (const k in razed) delete razed[k]; for (const k in claimed) delete claimed[k]; };

  // Every update step (host / local only): refresh progress and open what's been earned.
  G.updateUnlocks = function () {
    const stats = {};
    for (const h of G.entities) {
      if (!(h instanceof G.Hero)) continue;
      const u = h.unlock, s = stats[h.team] || (stats[h.team] = teamStats(h.team));
      // Team goals keep their best: losing buildings later doesn't take the progress (or the ability) back.
      u.bases = Math.max(u.bases, s.bases); u.slots = Math.max(u.slots, s.slots); u.razed = Math.max(u.razed, s.razed);
      for (const key in G.UNLOCKS) {
        if (u.done[key] || G.UNLOCKS[key].progress(u) < G.UNLOCKS[key].need) continue;
        u.done[key] = true;
        if (!G.dev) announce(h, key);
      }
    }
  };

  // A press on a locked ability: say what it still needs.
  G.lockedNotice = function (h, key) {
    const p = G.unlockProgress(h, key);
    G.floaters.push({ x: h.x, y: h.y - 50, text: `Locked · ${p.text} (${p.have}/${p.need})`, t: 0, color: '#c8b89a' });
  };
})(window.Game);
