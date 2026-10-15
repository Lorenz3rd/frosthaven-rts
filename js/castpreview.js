// Cast preview ("ability confirm before cast" setting): the ground shape an ability will cover if cast
// now from where the hero stands toward (tx, ty). G.castPreview(h, ab, tx, ty) returns a list of shapes
// in world units, drawn translucent by render3d:
//   { t: 'ring', x, y, r }             faint outline (the ability's reach)
//   { t: 'circle', x, y, r }           glowing disc (an area)
//   { t: 'arrow', x, y, a, len, w }    arrow from (x, y) along angle a (a line, dash or blink)
//   { t: 'rect', x, y, a, len, w }     bar centered on (x, y), its length along angle a
//   { t: 'cone', x, y, a, r, arc }     wedge from (x, y)
// Shapes follow each ability's own geometry (see heroes.js); abilities missing from SHAPES fall back to
// one per aim type.
(function (G) {
  const angleTo = (h, tx, ty) => Math.atan2(ty - h.y, tx - h.x);

  // A projectile or sweep along the aim: width w, length len (default: the ability's range).
  const line = (w, len) => (h, ab, tx, ty) => [{ t: 'arrow', x: h.x, y: h.y, a: angleTo(h, tx, ty), len: len || ab.range, w }];
  // An area of radius r at the aim point, clamped to range.
  const area = r => (h, ab, tx, ty) => { const p = G.clampReach(h, tx, ty, ab.range); return [{ t: 'circle', x: p.x, y: p.y, r }]; };
  // An area of radius r around the hero.
  const self = r => h => [{ t: 'circle', x: h.x, y: h.y, r: typeof r === 'function' ? r(h) : r }];
  // A wedge in front of the hero.
  const cone = (r, arc) => (h, ab, tx, ty) => [{ t: 'cone', x: h.x, y: h.y, a: angleTo(h, tx, ty), r, arc }];
  // A dash / blink to open ground toward the aim (optionally slamming an area of radius endR there).
  const dash = endR => (h, ab, tx, ty) => {
    const s = G.openSpot(h, tx, ty, ab.range) || { x: h.x, y: h.y };
    return arrowTo(h, s, h.r * 2).concat(endR ? [{ t: 'circle', x: s.x, y: s.y, r: endR }] : [{ t: 'circle', x: s.x, y: s.y, r: h.r + 6 }]);
  };
  // A foe-targeted ability: marks the foe it would pick (nearest the aim within `near`, inside range).
  // With none: `fallback` (if given) or nothing but the reach.
  const foe = (near, fallback, opts) => (h, ab, tx, ty) => {
    const t = foeNear(h, tx, ty, near, ab.range, opts) || (fallback ? null : G.nearestFoe(h.team, h.x, h.y, ab.range, opts));
    if (!t) return fallback ? fallback(h, ab, tx, ty) : [];
    return arrowTo(h, t, 18).concat([{ t: 'circle', x: t.x, y: t.y, r: (t.r || 20) + 14 }]);
  };

  function arrowTo(h, p, w) {
    const len = G.dist(h.x, h.y, p.x, p.y);
    return len < 4 ? [] : [{ t: 'arrow', x: h.x, y: h.y, a: angleTo(h, p.x, p.y), len, w }];
  }
  function foeNear(h, tx, ty, near, reach, opts) {
    let best = null, bd = Infinity;
    for (const e of G.foesOf(h.team, opts)) {
      if (G.dist(h.x, h.y, e.x, e.y) - (e.r || 0) > reach) continue;
      const d = G.dist(tx, ty, e.x, e.y) - (e.r || 0);
      if (d < near && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  const SHAPES = {
    // Bannerspear
    'Phalanx Thrust': line(70),
    'Shield Rush': dash(),
    'Rally Banner': area(230),
    "Vanguard's Stand": dash(220),
    // Boneshaper
    'Bone Spear': line(32),
    'Raise Dead': area(90),
    'Bone Armor': self(120),
    'Bone Colossus': area(180),
    // Deathwalker
    'Shadow Scythe': line(68),
    'Shadow Step': dash(),
    'Soul Siphon': foe(160, null, { buildings: false }),
    'Reaping Night': area(260),
    // Geminate: Twin Strike depends on the form.
    'Twin Strike': (h, ab, tx, ty) => h.form === 'melee' ? self(140)(h) : area(300)(h, ab, tx, ty),
    'Phase Shift': dash(),
    'Resonance': self(220),
    'Convergence': self(550),
    // Blinkblade
    'Blink Strike': foe(180, dash()),
    'Overclock': self(h => h.r + 40),
    'Rewind': h => {
      const hist = h.history || [];
      if (hist.length < 2) return self(h.r + 20)(h);
      const past = hist[Math.max(0, hist.length - 30)];
      return arrowTo(h, past, h.r * 2).concat([{ t: 'circle', x: past.x, y: past.y, r: h.r + 10 }]);
    },
    'Thousand Cuts': area(350),
    // Crushing Tide
    'Riptide Claw': cone(180, 1.9),
    'Coral Carapace': self(150),
    'Undertow': area(170),
    'Tsunami': line(280),
    // Trapper
    'Harpoon': line(24),
    'Bear Trap': area(34),
    'Snare Net': area(130),
    'Killing Field': area(210),
    // Pyroclast
    'Magma Bolt': line(28),
    'Wall of Fire': (h, ab, tx, ty) => {
      const p = G.clampReach(h, tx, ty, ab.range);
      return [{ t: 'rect', x: p.x, y: p.y, a: angleTo(h, p.x, p.y) + Math.PI / 2, len: 320, w: 60 }];
    },
    'Searing Breath': cone(270, 1.24),
    'Eruption': area(240),
    // Drifter
    'Staff Sweep': self(140),
    'Long Stride': dash(),
    'Waystone Camp': area(200),
    'Great Migration': line(240)
  };
  const FALLBACK = { dir: line(40), point: area(60), foe: foe(160), self: self(h => h.r + 40) };

  G.castPreview = function (h, ab, tx, ty) {
    const shapes = (SHAPES[ab.name] || FALLBACK[ab.aim] || FALLBACK.self)(h, ab, tx, ty);
    // The reach, for anything aimed away from the hero.
    if (ab.aim !== 'self' && ab.range > 0) shapes.unshift({ t: 'ring', x: h.x, y: h.y, r: ab.range });
    return shapes;
  };
})(window.Game);
