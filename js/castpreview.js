// Cast preview ("ability confirm before cast" setting): the ground shape an ability will cover if cast
// now from where the hero stands toward (tx, ty). G.castPreview(h, ab, tx, ty) returns a list of shapes
// in world units, drawn translucent by render3d:
//   { t: 'ring', x, y, r }             faint outline (the ability's reach)
//   { t: 'circle', x, y, r }           glowing disc (an area)
//   { t: 'arrow', x, y, a, len, w }    arrow from (x, y) along angle a (a line, dash or blink)
//   { t: 'rect', x, y, a, len, w }     bar centered on (x, y), its length along angle a
//   { t: 'cone', x, y, a, r, arc }     wedge from (x, y)
//   { t: 'crescent', x, y, a, c1, r1, c2, r2 }  inside the circle (c1 along a, r1), outside (c2, r2)
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
    'Banner of Doom': area(150),
    'Banner of Courage': area(300),
    'Unbreakable Wall': cone(200, 1.8),
    'Banner of Hope': area(500),
    // Boneshaper
    'Doug & Doug': area(110),
    "Death's Curse": line(200),
    'Back Again': self(500),
    'Bone Ball': area(60),
    // Deathwalker
    'Shadow Step': dash(G.m(2.5)),
    'Darkness Grows': h => G.fx.filter(o => o.kind === 'shadowPool' && o.owner === h && !o.dead).map(o => ({ t: 'circle', x: o.x, y: o.y, r: o.r })),
    'In the Dark': self(h => h.r + 40),
    'Night Falls': foe(160),
    // Geminate: Q and W depend on the form.
    'Drag Down / Tailspin': (h, ab, tx, ty) => h.form === 'melee' ? self(G.geminate.TAILSPIN_R)(h)
      : [Object.assign({ t: 'crescent', x: h.x, y: h.y, a: angleTo(h, tx, ty) }, G.geminate.CRESCENT)],
    'Swarm / Tough Carapace': (h, ab, tx, ty) => {
      if (h.form === 'melee') return self(h => h.r + 40)(h);
      const s = G.geminate.swarmSpot(h, tx, ty);
      return [{ t: 'rect', x: s.x, y: s.y, a: s.a + Math.PI / 2, len: G.geminate.SWARM_LEN, w: G.geminate.SWARM_W }];
    },
    'Form Swap': self(h => h.r + 40),
    'Rush Forward': (h, ab, tx, ty) => {
      const a = angleTo(h, tx, ty), s = G.openSpot(h, h.x + Math.cos(a) * ab.range, h.y + Math.sin(a) * ab.range, ab.range);
      return s ? arrowTo(h, s, 60) : [];
    },
    // Blinkblade
    'Poison Dagger': cone(G.m(5), 1.4),
    'Stab Them All': self(G.m(8)),
    'Go Fast': self(h => h.r + 40),
    'Now You See Me': self(h => h.r + 40),
    // Crushing Tide
    'Riptide': self(G.m(3)),
    'Tide of Shells': self(h => h.r + 40),
    'Surge Tide': self(h => h.r + 40),
    'Ebb and Flow': self(G.m(8)),
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
    'Destructive Fury': cone(G.m(7), 1.2),
    'Crushing Weight': self(h => h.r + 40),
    'Shockwave': self(h => h.r + 40),
    'Against All Odds': dash(G.m(2))
  };
  const FALLBACK = { dir: line(40), point: area(60), foe: foe(160), self: self(h => h.r + 40) };

  G.castPreview = function (h, ab, tx, ty) {
    const shapes = (SHAPES[ab.name] || FALLBACK[ab.aim] || FALLBACK.self)(h, ab, tx, ty);
    // The reach, for anything aimed away from the hero.
    if (ab.aim !== 'self' && ab.range > 0) shapes.unshift({ t: 'ring', x: h.x, y: h.y, r: ab.range });
    return shapes;
  };
})(window.Game);
