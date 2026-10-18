// Special troops: each race's own two units and the barracks that train them (see SQUAD_KINDS in
// squads.js and G.RACES[].special), modelled on the Frosthaven figures of the same name. Also the
// effects they leave: the Wavethrower's surge and a broken ram.
// Buildings face +x toward the base center; units face +x with the weapon arm on +z, on the soldier
// contract (tunic, arm, l1, l2; see render3d.js). Builders must be deterministic (seeded G.rng, never
// Math.random for shapes): models of one type share their merged geometry.
(function (G) {
  const R = G.render3d, K = G.kit, g = K.g, add = K.add, pivot = K.pivot, PI = Math.PI;
  const U = R.SPECIAL_UNITS, B = R.SPECIAL_BUILDINGS;

  const HUM = { wood: 0x3a2a1d, plank: 0x5a4330, dark: 0x16100b, stone: 0x2f2f31, roof: 0x3b3226, snow: 0x7f8790, hide: 0x5e4632,
    iron: 0x3a3c40, steel: 0x8a8f96, skin: 0xc9a487, straw: 0xc9b070, thatch: 0x9a8448, green: 0x3c4a2c, leather: 0x5a3e26, ash: 0x6b4a2a };
  const ALG = { hide: 0x8a6a4a, hideLight: 0xb89a72, hideDark: 0x5a4430, bone: 0xe0d8c0, tusk: 0xf0e8d0, snow: 0xe8eef4, ice: 0xa8e0f8,
    stone: 0x4a4e56, wood: 0x3a2a1e, fur: 0xd8dce0, furDark: 0x9aa0a8, storm: 0x46505e, cloud: 0x5a6272 };
  const LUR = { shell: 0x2a6a7a, shellHi: 0x4a9aa6, shellDark: 0x1a3a48, coral: 0xff8a7a, coralB: 0xffb060, coralC: 0xd86aa0,
    sand: 0xc8b090, pearl: 0xf0f0ff, kelp: 0x3a6a3a, rock: 0x3a4448, glow: 0x5fe0e8 };
  const UNF = { brass: 0xc89a40, copper: 0xb06a3a, steel: 0x7a8088, dark: 0x2a2e34, plate: 0x4a5058, glow: 0x7fe8ff, warn: 0xe0b020,
    rust: 0x8a4a2a, rustDark: 0x4a2a1a, dirt: 0x5a4630, dirtDark: 0x3a2c1e };

  const iceMat = () => K.m(ALG.ice, { transparent: true, opacity: 0.82, metalness: 0.2, roughness: 0.15, emissive: 0x16384a });
  const glowIce = () => K.lit(0xbfefff);
  const water = () => K.m(0x2a8aa8, { transparent: true, opacity: 0.72, metalness: 0.3, roughness: 0.15, emissive: 0x0a3040 });
  const metal = (c, r = 0.4) => K.metal(c, r);
  const rust = () => K.m(UNF.rust, { metalness: 0.5, roughness: 0.8 });

  // ---------------------------------------------------------------------------------------------
  // Shared pieces
  // ---------------------------------------------------------------------------------------------
  // A gabled roof lying along x: a triangular prism with its ridge up.
  const prisms = new Map();
  function prismX(r, len) {
    const key = r + ',' + len;
    if (!prisms.has(key)) prisms.set(key, new THREE.CylinderGeometry(r, r, len, 3).rotateX(-PI / 2).rotateY(PI / 2));
    return prisms.get(key);
  }
  // A straight piece from a to b (ropes, struts, lightning strokes). w: thickness.
  const UP = new THREE.Vector3(0, 1, 0);
  function strand(parent, ax, ay, az, bx, by, bz, w, material, shadow = false) {
    const m = new THREE.Mesh(g.box(1, 1, 1), material);
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.set(w, a.distanceTo(b), w);
    m.quaternion.setFromUnitVectors(UP, b.sub(a).normalize());
    m.castShadow = shadow;
    parent.add(m);
    return m;
  }
  // A jagged lightning bolt from (x, top, z) down to (x + dx, bottom, z + dz): its own group, so it can flicker.
  function bolt(parent, x, top, z, dx, bottom, dz, rand, w = 2.2, color = 0xe8f0ff) {
    const grp = pivot(parent);
    const n = 5, mat = K.lit(color);
    let px = x, py = top, pz = z;
    for (let i = 1; i <= n; i++) {
      const k = i / n, j = i < n ? 1 : 0;
      const nx = x + dx * k + (rand() - 0.5) * 26 * j, ny = top + (bottom - top) * k, nz = z + dz * k + (rand() - 0.5) * 26 * j;
      strand(grp, px, py, pz, nx, ny, nz, w, mat);
      px = nx; py = ny; pz = nz;
    }
    return grp;
  }
  // Soft smoke / storm-cloud puff (normal blending, so it can be dark).
  function puff(color, size, opacity) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTex(), color, transparent: true, opacity, depthWrite: false }));
    s.scale.set(size, size, 1);
    return s;
  }
  // Time step for a model tick (ticks are handed the clock, not a step).
  function stepOf(u, time) { const dt = u.t0 === undefined ? 0 : G.clamp(time - u.t0, 0, 0.1); u.t0 = time; return dt; }

  // Algox pieces.
  function tusk(parent, x, y, z, len, curl, ry) {
    const t = pivot(parent, x, y, z);
    t.rotation.y = ry || 0;
    add(t, g.torus(len, len * 0.09, 5, 10, PI * 0.55), K.m(ALG.tusk), 0, 0, 0, { rz: curl });
    return t;
  }
  function iceShard(parent, x, y, z, h, w, rz = 0, rx = 0, mat = iceMat()) {
    return add(parent, g.cone(w, h, 5), mat, x, y + h / 2, z, { rz, rx });
  }
  function snowMound(parent, x, z, r, h) { return add(parent, g.dome(r, 14, 6), K.m(ALG.snow), x, 0, z, { sy: h / r }); }
  function hideBanner(parent, team, x, y, z, h = 60) {
    add(parent, g.cyl(2, 2.4, h, 6), K.m(ALG.wood), x, y + h / 2, z);
    add(parent, g.box(2, 34, 26), K.m(K.teamHex(team)), x + 1, y + h - 22, z + 14);
    add(parent, g.box(2.4, 3, 30), K.m(ALG.bone), x + 1, y + h - 4, z + 14);
    add(parent, g.sph(4, 7, 6), K.m(ALG.bone), x, y + h + 3, z);
  }
  function brazier(parent, x, z, color = 0x9fdcff) {
    add(parent, g.cyl(10, 7, 14, 7), K.m(ALG.stone), x, 7, z);
    add(parent, g.cyl(9, 9, 2, 7), K.lit(color), x, 14.5, z, { shadow: false });
    return K.addGlow(parent, color, 48, x, 26, z, 0.9);
  }
  // A hulking Algox: shaggy hunched body, tusked head. Returns the parts the units dress up.
  function algoxBody(gr, furM, team, o = {}) {
    const dark = K.m(ALG.furDark), teamM = K.m(K.teamHex(team));
    const l1 = pivot(gr, 0, 16, 6.5), l2 = pivot(gr, 0, 16, -6.5);
    for (const l of [l1, l2]) { add(l, g.cyl(o.leg || 4.5, 4, 14, 6), dark, 0, -7, 0); add(l, g.box(9, 3, 7), K.m(ALG.hideDark), 2, -14.5, 0); }
    add(gr, g.ico(15, 1), furM, -1, 30, 0, { sx: 0.9, sy: 1.05, sz: 1.05 });
    add(gr, g.ico(10, 1), furM, -5, 42, 0);
    add(gr, g.box(12, 10, 2), teamM, 9, 15, 0);
    add(gr, g.sph(7.5, 8, 6), furM, 9, 44, 0);
    add(gr, g.box(6, 5, 8), dark, 15, 41, 0);
    for (const z of [-2.5, 2.5]) add(gr, g.sph(1, 5, 4), K.lit(o.eyes || 0x9fdcff), 15, 46, z, { shadow: false });
    for (const s of [-1, 1]) add(gr, g.torus(5, 0.9, 4, 8, PI * 0.6), K.m(ALG.tusk), 17, 38, s * 3, { rz: PI * 0.55 });
    const arm = pivot(gr, 2, 36, 13);
    add(arm, g.cyl(3.4, 3, 12, 6), furM, 0, -4, 0);
    return { l1, l2, arm, teamM, dark };
  }

  // Lurker pieces.
  function coral(parent, x, z, h, color, seed = 0) {
    const c = pivot(parent, x, 0, z);
    const m = K.m(color);
    add(c, g.cyl(h * 0.06, h * 0.09, h * 0.5, 6), m, 0, h * 0.25, 0);
    for (let i = 0; i < 4; i++) {
      const a = seed + i * 1.6, br = pivot(c, 0, h * (0.35 + i * 0.08), 0);
      br.rotation.set(Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7);
      add(br, g.cyl(h * 0.035, h * 0.05, h * 0.45, 5), m, 0, h * 0.22, 0);
      add(br, g.sph(h * 0.06, 6, 5), m, 0, h * 0.46, 0);
    }
    return c;
  }
  function conch(parent, x, y, z, s, color = LUR.sand) {
    const c = pivot(parent, x, y, z);
    for (let i = 0; i < 7; i++) {
      const r = s * (1 - i * 0.12);
      add(c, g.torus(r, r * 0.42, 6, 14), K.m(i % 2 ? color : 0xe8d8c0), Math.cos(i * 1.2) * s * 0.15, i * s * 0.3, Math.sin(i * 1.2) * s * 0.15, { rx: PI / 2 });
    }
    add(c, g.cone(s * 0.32, s * 1.1, 8), K.m(color), 0, s * 2.35, 0);
    return c;
  }
  function kelp(parent, x, z, h) {
    const k = pivot(parent, x, 0, z), segs = [];
    let p = k;
    for (let i = 0; i < 4; i++) {
      const s = pivot(p, 0, i ? h / 4 : 0, 0);
      add(s, g.box(1.5, h / 4, 6), K.m(LUR.kelp, { side: THREE.DoubleSide }), 0, h / 8, 0);
      segs.push(s); p = s;
    }
    return segs;
  }
  // Upright crab-folk: jointed legs, shell torso, eye stalks. Returns the parts the units dress up.
  function lurkerBody(gr, shellM, team, o = {}) {
    const hi = K.m(LUR.shellHi), under = K.m(LUR.sand), teamM = K.m(K.teamHex(team));
    const l1 = pivot(gr, 0, 14, 5), l2 = pivot(gr, 0, 14, -5);
    for (const [l, s] of [[l1, 1], [l2, -1]]) for (const dx of [-4, 4]) {
      add(l, g.cyl(1.4, 2, 10, 5), hi, dx, -3, s * 3, { rx: s * 0.6 });
      add(l, g.cyl(1, 1.4, 10, 5), hi, dx, -10, s * 6, { rx: -s * 0.2 });
    }
    add(gr, g.sph(11, 10, 8), shellM, -2, 28, 0, { sx: 0.85, sy: 1.15 });
    add(gr, g.sph(8, 8, 6), under, 3, 25, 0, { sx: 0.7, sy: 1.1 });
    for (let i = 0; i < 3; i++) add(gr, g.box(1, 1.4, 10 - i * 2), under, 9, 20 + i * 4, 0);
    add(gr, g.torus(10, 1.2, 4, 14, PI), teamM, -3, 30, 0, { ry: PI / 2, rx: 0.3 });
    add(gr, g.sph(5, 8, 6), shellM, 5, 40, 0, { sx: 1.1 });
    const eyes = [];
    for (const s of [-1, 1]) {
      add(gr, g.cyl(0.6, 0.8, 7, 4), hi, 6, 46, s * 2.5, { rx: s * 0.3 });
      if (!o.noEyes) eyes.push(add(gr, g.sph(1.5, 6, 5), K.lit(LUR.glow), 6, 50, s * 3.4, { shadow: false }));
    }
    add(gr, g.box(3, 2, 4), under, 10, 38, 0);
    return { l1, l2, hi, under, teamM };
  }

  // Unfettered pieces.
  function gear(parent, x, y, z, r, teeth = 10, mat = metal(UNF.brass, 0.3)) {
    const gr = pivot(parent, x, y, z);
    add(gr, g.cyl(r, r, r * 0.3, 16), mat, 0, 0, 0, { rx: PI / 2 });
    add(gr, g.cyl(r * 0.35, r * 0.35, r * 0.36, 10), metal(UNF.dark, 0.5), 0, 0, 0, { rx: PI / 2 });
    for (let i = 0; i < teeth; i++) {
      const a = i / teeth * PI * 2;
      add(gr, g.box(r * 0.28, r * 0.28, r * 0.3), mat, Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08, 0, { rz: a });
    }
    return gr;
  }
  function panel(parent, team, x, y, z, w, h, ry = 0) {
    const p = pivot(parent, x, y, z); p.rotation.y = ry;
    add(p, g.box(2, h, w), K.m(K.teamHex(team)), 0, 0, 0);
    for (let i = 0; i < 3; i++) add(p, g.box(2.4, h * 0.14, w * 0.9), K.m(UNF.warn), 0.2, -h / 2 + h * 0.15 + i * h * 0.35, 0);
    return p;
  }
  function smokestack(parent, x, z, h, r) {
    add(parent, g.cyl(r, r * 1.15, h, 10), metal(UNF.dark, 0.5), x, h / 2, z);
    add(parent, g.cyl(r * 1.25, r * 1.25, 5, 10), metal(UNF.brass, 0.3), x, h, z);
    return K.addGlow(parent, 0x8a8a8a, r * 4, x, h + 14, z, 0.35);
  }

  // ---------------------------------------------------------------------------------------------
  // HUMAN — Battering Ram, Longbowmen
  // ---------------------------------------------------------------------------------------------
  // Battering Ram: a wheeled shed under a ridge of wet hides, an iron-headed log slung on chains inside
  // and its four-man crew shoving from within (the Grunts that fight on when it breaks). The log draws
  // back and drives forward on a strike.
  U.ram = team => {
    const gr = new THREE.Group();
    const wood = K.mat(HUM.wood), plank = K.m(HUM.plank), dark = K.m(HUM.dark), iron = metal(HUM.iron, 0.5), hide = K.m(HUM.hide), teamM = K.m(K.teamHex(team));
    // Chassis on four spoked wheels.
    for (const z of [-24, 24]) add(gr, g.box(104, 9, 7), wood, 0, 22, z);
    for (const x of [-44, 0, 44]) add(gr, g.box(7, 7, 52), plank, x, 22, 0);
    const wheels = [];
    for (const x of [-34, 34]) for (const s of [-1, 1]) {
      const w = pivot(gr, x, 16, s * 31);
      add(w, g.cyl(15, 15, 6, 12), dark, 0, 0, 0, { rx: PI / 2 });
      add(w, g.box(28, 3, 6.4), plank); add(w, g.box(3, 28, 6.4), plank);
      add(w, g.cyl(4, 4, 8, 8), iron, 0, 0, 0, { rx: PI / 2 });
      wheels.push(w);
    }
    // Frame and roof: corner posts, plates, a hide-covered ridge with a crust of snow.
    for (const x of [-46, 46]) for (const z of [-24, 24]) add(gr, g.box(6, 52, 6), wood, x, 50, z);
    for (const z of [-24, 24]) add(gr, g.box(104, 6, 6), wood, 0, 76, z);
    add(gr, prismX(40, 112), hide, 0, 79 + 20 * 0.62, 0, { sy: 0.62 });
    add(gr, prismX(24, 100), K.m(HUM.snow), 0, 79 + 40 * 0.62 - 24 * 0.62 + 3, 0, { sy: 0.62 });
    for (const x of [-40, -13, 13, 40]) add(gr, g.box(4, 3, 70), plank, x, 82, 0);
    // Side hangings of hide with the crew's team shields.
    for (const s of [-1, 1]) {
      add(gr, g.box(96, 26, 2), hide, 0, 60, s * 28);
      for (const x of [-30, 0, 30]) {
        add(gr, g.cyl(9, 9, 2.4, 10), teamM, x, 60, s * 29.5, { rx: PI / 2 });
        add(gr, g.sph(2.4, 6, 4), iron, x, 60, s * 31);
      }
    }
    // The crew, half hidden inside, leaning into the push.
    const legs = [];
    for (const x of [-26, 10]) for (const z of [-11, 11]) {
      add(gr, g.cyl(6, 7.5, 18, 6), teamM, x, 34, z, { rz: -0.35 });
      add(gr, g.sph(5.5, 6, 5), metal(HUM.steel, 0.45), x + 6, 46, z);
      for (const dz of [-3, 3]) {
        const l = pivot(gr, x - 2, 22, z + dz);
        add(l, g.cyl(2.4, 2.2, 18, 5), dark, 0, -9, 0);
        add(l, g.box(6, 3, 4.5), K.m(HUM.leather), 1.5, -18.5, 0);
        legs.push(l);
      }
    }
    // The ram: an iron-banded log with a curled ram's head, hung from the roof on chains.
    const log = pivot(gr, 0, 50, 0);
    add(log, g.cyl(7, 8, 120, 10), K.m(HUM.ash), 0, 0, 0, { rz: PI / 2 });
    for (const x of [-40, 0, 36]) add(log, g.cyl(8.6, 8.6, 4, 10), iron, x, 0, 0, { rz: PI / 2 });
    add(log, g.box(16, 17, 17), iron, 64, 0, 0);
    add(log, g.box(8, 11, 12), iron, 74, -2, 0);
    for (const s of [-1, 1]) {
      add(log, g.torus(6.5, 2.4, 5, 10, PI * 1.5), iron, 60, 4, s * 9.5, { rz: PI * 0.25 });
      add(log, g.sph(1.4, 5, 4), K.lit(0xff8a40), 70, 4, s * 5, { shadow: false });
    }
    for (const x of [-28, 28]) add(log, g.cyl(0.9, 0.9, 24, 4), iron, x, 13, 0);
    // Banner at the back.
    add(gr, g.cyl(1.5, 1.5, 60, 4), dark, -50, 100, 0);
    add(gr, g.box(1.5, 22, 28), teamM, -50, 118, 14);
    gr.scale.setScalar(0.88);
    gr.userData = { tunic: wood, arm: pivot(gr), l1: pivot(gr), l2: pivot(gr), ranged: false, noLunge: true, aura: null, phase: Math.random() * 10,
      tick(u, e, time) {
        const s = e.moving ? Math.sin(time * 10 + u.phase) * 0.55 : 0;
        legs.forEach((l, i) => { l.rotation.z = i % 2 ? s : -s; });
        if (e.moving) for (const w of wheels) w.rotation.z = -time * 7;
        log.position.x = K.ease.windStrike(e.swing || 0) * 16;
      } };
    return K.shadowed(gr);
  };

  // Longbowman: a hooded yeoman in a green cloak over the team tunic, a quiver of fletched arrows on the
  // back and a yew longbow taller than he is.
  U.longbow = team => {
    const gr = new THREE.Group();
    const tunic = K.mat(K.teamHex(team)), dark = K.m(0x2a2420), cloak = K.m(HUM.green), leather = K.m(HUM.leather), yew = K.m(0x7a5230);
    const l1 = pivot(gr, 0, 14, 4), l2 = pivot(gr, 0, 14, -4);
    for (const l of [l1, l2]) { add(l, g.cyl(2.8, 2.5, 14, 5), dark, 0, -7, 0); add(l, g.box(7, 3, 5), leather, 1.5, -14, 0); }
    add(gr, g.cyl(7, 9.5, 24, 7), tunic, 0, 26, 0);
    add(gr, g.cyl(9.6, 9.6, 2.4, 8), leather, 0, 18, 0);
    add(gr, g.box(2, 32, 17), cloak, -8.5, 29, 0, { rz: -0.1 });
    add(gr, g.cyl(9, 9, 6, 8), cloak, 0, 36, 0);                       // mantle over the shoulders
    add(gr, g.sph(6, 7, 5), K.m(HUM.skin), 1, 43, 0);
    add(gr, g.sph(7.2, 7, 5), cloak, -1.5, 44, 0, { sx: 0.85 });     // hood
    add(gr, g.cone(5, 12, 6), cloak, -4, 50, 0, { rz: 0.9 });        // its pointed tail
    add(gr, g.box(1, 2, 7), dark, 6.5, 42, 0, { shadow: false });     // shadowed face
    // Quiver with fletched arrows.
    add(gr, g.cyl(3.4, 2.8, 20, 6), leather, -9, 34, -4, { rz: 0.35, rx: 0.2 });
    for (let i = 0; i < 4; i++) add(gr, g.cone(1.3, 5, 3), K.m(i % 2 ? 0xe8e0d0 : 0xa02a20), -12.5 + (i % 2), 45 + (i >> 1), -6.5 + i * 1.5, { rz: 0.35 });
    // Bow arm reaching out to the grip; the longbow and its string.
    add(gr, g.cyl(2.2, 1.9, 14, 5), cloak, 5, 33, -4, { rz: -1.3 });
    add(gr, g.torus(25, 1.1, 4, 16, PI), yew, 11, 31, 0, { rz: -PI / 2, sy: 0.36 });
    add(gr, g.box(0.3, 49, 0.3), K.m(0xe8e0c0), 11, 31, 0, { shadow: false });
    add(gr, g.cyl(0.5, 0.5, 24, 3), yew, 11, 31, 1, { rz: PI / 2 });
    // Draw hand on the shoulder pivot.
    const arm = pivot(gr, 0, 35, 9);
    add(arm, g.cyl(2.2, 1.9, 13, 5), cloak, 0, -6, 0);
    add(arm, g.sph(2.2, 5, 4), K.m(HUM.skin), 0, -13, 0);
    gr.scale.setScalar(1.12);
    gr.userData = { tunic, arm, l1, l2, ranged: true, aura: null, phase: Math.random() * 10 };
    return K.shadowed(gr);
  };

  // Ram Works: a carpenter's yard. A lean-to workshop at the back, a gantry out front with a new ram
  // log swinging on its ropes, a ram's chassis half built, a log pile and a forge with an iron ram's head.
  B.barracksRam = (slot, base, team) => {
    const gr = new THREE.Group();
    const wood = K.m(HUM.wood), plank = K.m(HUM.plank), dark = K.m(HUM.dark), iron = metal(HUM.iron, 0.5), stone = K.m(HUM.stone);
    add(gr, g.box(150, 8, 182), stone, 0, 4, 0);
    // Workshop: lean-to roof sloping toward the yard.
    add(gr, g.box(46, 70, 170), wood, -52, 43, 0);
    add(gr, g.box(70, 5, 184), K.m(HUM.roof), -40, 86, 0, { rz: -0.32 });
    add(gr, g.box(62, 3, 176), K.m(HUM.snow), -40, 89.5, 0, { rz: -0.32 });
    for (const z of [-60, 0, 60]) add(gr, g.box(4, 40, 26), dark, -28.5, 28, z);
    for (const z of [-80, 80]) add(gr, g.box(6, 76, 6), wood, -14, 38, z);
    // Gantry: two A-frames carrying a beam along x, the new ram slung beneath it.
    for (const x of [-10, 62]) {
      for (const s of [-1, 1]) strand(gr, x, 0, s * 38, x, 114, 0, 6, wood, true);
      add(gr, g.box(5, 5, 50), plank, x, 40, 0);
    }
    add(gr, g.box(84, 7, 7), wood, 26, 116, 0);
    const sling = pivot(gr, 26, 112, 0);
    for (const x of [-22, 22]) strand(sling, x, 0, 0, x, -52, 0, 1.2, K.m(0x8a7a5a));
    add(sling, g.cyl(8, 9, 100, 10), K.m(HUM.ash), 0, -58, 0, { rz: PI / 2 });
    for (const x of [-30, 10]) add(sling, g.cyl(9.6, 9.6, 4, 10), iron, x, -58, 0, { rz: PI / 2 });
    add(sling, g.box(15, 17, 17), iron, 54, -58, 0);
    for (const s of [-1, 1]) add(sling, g.torus(6.5, 2.4, 5, 10, PI * 1.5), iron, 51, -54, s * 9.5, { rz: PI * 0.25 });
    // A chassis on blocks, two wheels leaning on the workshop.
    for (const z of [42, 74]) add(gr, g.box(82, 7, 6), plank, 30, 20, z);
    for (const x of [-4, 30, 64]) { add(gr, g.box(6, 6, 38), plank, x, 20, 58); add(gr, g.box(10, 14, 10), stone, x, 9, 58); }
    for (const z of [-28, 28]) add(gr, g.cyl(15, 15, 6, 12), dark, -26, 16, z + (z < 0 ? -40 : 40), { rx: PI / 2, rz: 0.25 });
    // Log pile.
    for (const [x, y] of [[20, 10], [38, 10], [56, 10], [29, 25], [47, 25], [38, 40]]) add(gr, g.cyl(8, 8, 56, 8), K.m(HUM.ash), x, y, -62, { rx: PI / 2 });
    // Forge and anvil with a ram's head on it.
    add(gr, g.box(26, 24, 26), stone, -2, 12, -82);
    K.addGlow(gr, 0xff7a2a, 50, -2, 28, -82, 0.8);
    add(gr, g.box(10, 14, 8), iron, 6, 8, -78);
    add(gr, g.box(18, 5, 10), iron, 6, 17, -78);
    add(gr, g.box(12, 12, 12), iron, 6, 25, -78);
    add(gr, g.cyl(2, 2, 70, 4), dark, -60, 130, 70);
    gr.add(...K.teamFlag(team, -60, 160, 70));
    gr.userData = { tick(b, time) { sling.rotation.x = Math.sin(time * 0.9) * 0.06; sling.rotation.z = Math.sin(time * 0.6) * 0.02; } };
    return K.placeInSlot(gr, slot, base);
  };

  // Longbow Range: an open-fronted, thatched shooting gallery with a rack of yew bows at the back,
  // straw butts out in the yard bristling with arrows, and a tall popinjay pole with its painted bird.
  B.barracksLongbow = (slot, base, team) => {
    const gr = new THREE.Group();
    const wood = K.m(HUM.wood), dark = K.m(HUM.dark), straw = K.m(HUM.straw), yew = K.m(0x7a5230), teamM = K.m(K.teamHex(team));
    add(gr, g.box(150, 8, 182), K.m(HUM.stone), 0, 4, 0);
    // Gallery: back and side walls, front posts, a thatched gable along z.
    add(gr, g.box(8, 58, 170), wood, -66, 37, 0);
    for (const z of [-82, 82]) add(gr, g.box(60, 58, 6), wood, -39, 37, z);
    for (const z of [-82, -41, 0, 41, 82]) add(gr, g.box(6, 60, 6), dark, -12, 38, z);
    add(gr, g.box(6, 6, 170), dark, -12, 68, 0);
    const r = 48;
    add(gr, g.cyl(r, r, 182, 3), K.m(HUM.thatch), -39, 68 + r / 2, 0, { rx: -PI / 2 });
    add(gr, g.cyl(r * 0.55, r * 0.55, 174, 3), K.m(HUM.snow), -39, 68 + 1.5 * r - r * 0.55 + 2, 0, { rx: -PI / 2 });
    // Bow rack along the back wall.
    add(gr, g.box(4, 4, 140), dark, -60, 54, 0);
    for (let i = 0; i < 8; i++) {
      const z = -60 + i * 17;
      add(gr, g.torus(22, 1, 4, 12, PI), yew, -59, 32, z, { rz: -PI / 2, sy: 0.32 });
      add(gr, g.box(0.3, 43, 0.3), K.m(0xe8e0c0), -59, 32, z, { shadow: false });
    }
    // Fletcher's bench with arrow bundles; quiver barrels by the posts.
    add(gr, g.box(18, 3, 56), K.m(HUM.plank), -36, 24, 0);
    for (const z of [-22, 22]) add(gr, g.box(3, 22, 3), dark, -36, 12, z);
    for (const z of [-16, 0, 16]) for (let k = 0; k < 4; k++) add(gr, g.cyl(0.6, 0.6, 30, 3), yew, -36 + (k - 1.5) * 2, 26.5, z, { rx: PI / 2, rz: (k - 1.5) * 0.05 });
    for (const z of [-62, 62]) {
      add(gr, g.cyl(9, 8, 22, 8), K.m(HUM.leather), -2, 11, z);
      for (let k = 0; k < 6; k++) add(gr, g.cyl(0.6, 0.6, 26, 3), yew, -2 + Math.cos(k) * 4, 30, z + Math.sin(k) * 4, { rz: Math.cos(k) * 0.15, rx: Math.sin(k) * 0.15 });
    }
    // Butts in the yard, facing the gallery, stuck with arrows.
    const rand = G.rng(41);
    for (const z of [-58, 0, 58]) {
      for (const s of [-1, 1]) strand(gr, 64, 0, z + s * 12, 62, 40, z, 3, dark, true);
      strand(gr, 76, 0, z, 63, 36, z, 3, dark, true);
      add(gr, g.cyl(17, 17, 8, 14), straw, 60, 40, z, { rz: PI / 2 });
      add(gr, g.cyl(11, 11, 8.6, 14), teamM, 60, 40, z, { rz: PI / 2 });
      add(gr, g.cyl(5, 5, 9.2, 12), K.m(0xd9a530), 60, 40, z, { rz: PI / 2 });
      for (let k = 0; k < 4; k++) add(gr, g.cyl(0.5, 0.5, 16, 3), yew, 50, 40 + (rand() - 0.5) * 22, z + (rand() - 0.5) * 22, { rz: PI / 2 + (rand() - 0.5) * 0.3 });
    }
    // Popinjay pole: a tall mast with a painted bird on top, pennant below it.
    add(gr, g.cyl(2.4, 3.4, 190, 6), dark, -50, 95, 64 + 0);
    add(gr, g.sph(6, 8, 6), K.m(0x2f8a3a), -50, 196, 64, { sx: 1.4 });
    add(gr, g.cone(2, 6, 4), K.m(0xd9a530), -41, 197, 64, { rz: -PI / 2 });
    add(gr, g.cone(4, 10, 4), K.m(0xc8202a), -59, 198, 64, { rz: PI / 2 + 0.4 });
    add(gr, g.box(1.5, 18, 26), teamM, -50, 160, 77);
    gr.add(...K.teamFlag(team, -39, 150, -40));
    return K.placeInSlot(gr, slot, base);
  };

  // ---------------------------------------------------------------------------------------------
  // ALGOX — Stormspeaker, Icespeaker
  // ---------------------------------------------------------------------------------------------
  // Stormspeaker: an Algox shaman in a storm-grey mantle and feathered crown, a forked tusk staff
  // crowned with a churning thundercloud. While its storm shield is up a hazy dome of cloud and
  // lightning covers everything within reach; it flares where a shot strikes it.
  const STORM_S = 1.15;
  U.stormspeaker = team => {
    const gr = new THREE.Group();
    const furM = K.mat(ALG.fur), storm = K.m(ALG.storm), bone = K.m(ALG.bone);
    const { l1, l2, arm, teamM } = algoxBody(gr, furM, team, { eyes: 0xd8d0ff });
    add(gr, g.cone(16, 30, 9), storm, -1, 15, 0);                                   // long mantle
    for (let i = 0; i < 9; i++) {                                                  // feathered shoulders
      const a = -PI * 0.75 + i / 8 * PI * 1.5;
      add(gr, g.cone(2.6, 12, 4), K.m(i % 2 ? 0x2e343e : 0x6a7280), -2 + Math.cos(a) * 9, 38, Math.sin(a) * 13, { rx: Math.sin(a) * 1.2, rz: -Math.cos(a) * 1.2 });
    }
    add(gr, g.torus(7, 1.4, 4, 12), teamM, 8, 48, 0, { rx: PI / 2 });              // crown band
    for (let i = 0; i < 5; i++) add(gr, g.cone(1.3, 12 + (i % 2) * 5, 4), i % 2 ? bone : K.m(0x8890a0), 6 + Math.cos(i * 0.8 - 1.6) * 3, 55, Math.sin(i * 0.8 - 1.6) * 6, { rz: 0.25, rx: Math.sin(i * 0.8 - 1.6) * 0.4 });
    // Off hand raised, crackling.
    add(gr, g.cyl(3.4, 3, 20, 6), furM, 6, 40, -13, { rz: -0.9 });
    K.addGlow(gr, 0xc8d8ff, 18, 15, 46, -14, 0.8);
    // Staff: forked tusk prongs around a thundercloud.
    add(arm, g.cyl(1.3, 1.5, 58, 5), K.m(ALG.wood), 0, 16, 0);
    for (const s of [-1, 1]) add(arm, g.torus(7, 1, 4, 8, PI * 0.6), K.m(ALG.tusk), 0, 46, s * 3, { rz: PI * 0.2 * s + PI * 0.2 });
    const cloud = pivot(arm, 0, 52, 0);
    for (let i = 0; i < 4; i++) add(cloud, g.sph(4.5 - (i % 2), 7, 5), K.m(ALG.cloud), Math.cos(i * 1.6) * 4, (i % 2) * 2, Math.sin(i * 1.6) * 4);
    add(cloud, g.sph(2.6, 6, 5), K.lit(0xe8f0ff), 0, 0, 0, { shadow: false });
    const orbGlow = K.addGlow(cloud, 0xc8d8ff, 30, 0, 0, 0, 0.8);
    const rand = G.rng(77);
    const sparks = [0, 1, 2].map(i => bolt(arm, 0, 50, 0, Math.cos(i * 2.1) * 10, 36, Math.sin(i * 2.1) * 10, rand, 0.8));
    // The storm shield: a hazy dome of the ward's radius (the model's scale undone), clouds wheeling
    // round its crown, lightning flicking down inside it.
    const Rw = G.SQUAD_KINDS.stormspeaker.ward.r / STORM_S, H = 0.5;
    const dome = pivot(gr);
    const shellMat = new THREE.MeshBasicMaterial({ color: 0x9ab8e8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xc8dcff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const shell = new THREE.Mesh(g.dome(Rw, 32, 10), shellMat); shell.scale.y = H;
    const rim = new THREE.Mesh(g.ring(Rw - 6, Rw, 64), rimMat); rim.position.y = 2;
    dome.add(shell, rim);
    const clouds = pivot(dome);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * PI * 2, d = Rw * (0.55 + (i % 3) * 0.12);
      const p = puff(i % 2 ? 0x4a5262 : 0x7a8498, Rw * 0.42, 0.32);
      p.position.set(Math.cos(a) * d, Rw * H * Math.sqrt(1 - (d / Rw) ** 2) * 0.95, Math.sin(a) * d);
      clouds.add(p);
    }
    const strikes = [0, 1, 2, 3].map(i => {
      const a = i * 1.7, d = Rw * (0.3 + (i % 2) * 0.25);
      return bolt(dome, Math.cos(a) * d * 0.6, Rw * H * 0.85, Math.sin(a) * d * 0.6, Math.cos(a) * d * 0.5, 0, Math.sin(a) * d * 0.5, rand, 2.6, 0xdce8ff);
    });
    gr.scale.setScalar(STORM_S);
    K.shadowed(gr);
    gr.add(dome);   // after K.shadowed: a haze must not cast a shadow
    gr.userData = { tunic: furM, arm, l1, l2, ranged: false, aura: null, phase: Math.random() * 10, dome,
      tick(u, e, time) {
        const dt = stepOf(u, time), up = e.ward > 0;
        if (up && e.ward < (u.lastWard ?? e.ward)) u.hit = 1;   // a shot struck the shield
        u.lastWard = e.ward;
        u.hit = Math.max(0, (u.hit || 0) - dt * 3);
        dome.visible = up;
        shellMat.opacity = 0.06 + 0.02 * Math.sin(time * 2 + u.phase) + u.hit * 0.22;
        rimMat.opacity = 0.28 + 0.1 * Math.sin(time * 3 + u.phase) + u.hit * 0.4;
        clouds.rotation.y = time * 0.25 + u.phase;
        strikes.forEach((b, i) => { b.visible = up && (Math.sin(time * (5 + i * 2.3) + u.phase * (i + 1)) > 0.96 || u.hit > 0.7 - i * 0.1); });
        sparks.forEach((b, i) => { b.visible = Math.sin(time * (9 + i * 4.3) + i + u.phase) > 0.55; });
        orbGlow.material.opacity = 0.65 + Math.sin(time * 7 + u.phase) * 0.2;
        cloud.rotation.y = time * 2;
      } };
    return gr;
  };

  // Icespeaker: a towering Algox grown over with living ice: crystal spines from its shoulders and
  // back, a crown of ice, both fists locked in glowing frost. Ice motes drift around it.
  U.icespeaker = team => {
    const gr = new THREE.Group();
    const furM = K.mat(0xc8d4dc);
    const { l1, l2, arm, teamM } = algoxBody(gr, furM, team, { leg: 5.2, eyes: 0xcff8ff });
    add(gr, g.cone(14, 18, 8), K.m(ALG.hide), -1, 15, 0);
    add(gr, g.box(1.5, 22, 4), teamM, 12, 30, 0, { rx: 0.7 });
    const ice = iceMat();
    // Spines: clusters on both shoulders and down the back.
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) iceShard(gr, -2 - i * 3, 36 + i, s * (10 + i * 2), 13 - i * 2, 3, -0.3 - i * 0.2, s * (0.7 + i * 0.25), ice);
    for (let i = 0; i < 4; i++) iceShard(gr, -10 - i * 2, 28 + i * 5, 0, 12 - i, 3.2, 0.9 + i * 0.1, 0, ice);
    for (let i = 0; i < 4; i++) iceShard(gr, 6 + Math.cos(i * 1.6) * 3, 49, Math.sin(i * 1.6) * 4, 9 + (i % 2) * 4, 1.8, Math.cos(i * 1.6) * -0.3, Math.sin(i * 1.6) * 0.4, glowIce());
    // Off fist in ice.
    add(gr, g.cyl(3.6, 3.2, 22, 6), furM, 2, 26, -13, { rx: -0.15 });
    add(gr, g.ico(5.5, 0), ice, 3, 14, -15);
    // Striking fist: a club of ice with a glowing core.
    add(arm, g.ico(6.5, 0), ice, 0, 6, 0, { sy: 1.5 });
    add(arm, g.oct(2.6), glowIce(), 0, 6, 0, { shadow: false });
    for (let i = 0; i < 3; i++) iceShard(arm, Math.cos(i * 2.1) * 3, 8, Math.sin(i * 2.1) * 3, 8, 1.6, Math.cos(i * 2.1) * -0.6, Math.sin(i * 2.1) * 0.6, ice);
    K.addGlow(arm, 0x9fdcff, 26, 0, 6, 0, 0.75);
    K.addGlow(gr, 0xbfefff, 60, 0, 4, 0, 0.35);
    const motes = pivot(gr, 0, 0, 0);
    for (let i = 0; i < 5; i++) add(motes, g.oct(1.6), glowIce(), Math.cos(i * 1.26) * 18, 20 + (i % 3) * 10, Math.sin(i * 1.26) * 18, { shadow: false });
    gr.scale.setScalar(1.3);
    gr.userData = { tunic: furM, arm, l1, l2, ranged: false, aura: null, phase: Math.random() * 10,
      tick(u, e, time) { motes.rotation.y = time * 0.8 + u.phase; motes.position.y = Math.sin(time * 1.5 + u.phase) * 2; } };
    return K.shadowed(gr);
  };

  // Storm Cairn: a ring of rune-cut standing stones on a snow hill around a lightning rod of mammoth
  // tusk. A thundercloud broods over it and lightning keeps finding the rod.
  B.barracksStormspeaker = (slot, base, team) => {
    const gr = new THREE.Group();
    const rand = G.rng(19);
    snowMound(gr, 0, 0, 92, 16);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * PI * 2 + 0.3, h = 52 + (i * 13) % 30;
      add(gr, g.box(16, h, 12), K.m(ALG.stone), Math.cos(a) * 64, 10 + h / 2, Math.sin(a) * 64, { ry: -a, rz: Math.sin(i * 2.3) * 0.06 });
      add(gr, g.box(2, h * 0.5, 4), K.lit(0xc8d8ff), Math.cos(a) * 56, 14 + h * 0.5, Math.sin(a) * 56, { ry: -a, shadow: false });
    }
    // The rod: a carved pole with bone rings, a great tusk spike at the top.
    add(gr, g.cyl(6, 9, 150, 8), K.m(ALG.wood), 0, 88, 0);
    for (const y of [50, 90, 130]) add(gr, g.torus(8.5, 2.2, 4, 12), K.m(ALG.bone), 0, y, 0, { rx: PI / 2 });
    add(gr, g.cone(7, 46, 7), K.m(ALG.tusk), 0, 184, 0);
    for (const s of [-1, 1]) tusk(gr, 0, 150, s * 6, 22, PI * 0.75, s < 0 ? PI : 0);
    const tip = K.addGlow(gr, 0xc8d8ff, 70, 0, 206, 0, 0.7);
    // Thundercloud and its lightning.
    // A low-poly thundercloud: dark billows underneath, paler ones heaped on top.
    const cloud = pivot(gr, 0, 246, 0);
    cloud.scale.setScalar(0.8);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * PI * 2 + (i % 2) * 0.3, d = 30 + (i % 3) * 10;
      add(cloud, g.ico(18 + (i % 3) * 4, 1), K.m(0x4a5262), Math.cos(a) * d, -4 + (i % 2) * 4, Math.sin(a) * d, { sy: 0.7 });
    }
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * PI * 2 + 0.5;
      add(cloud, g.ico(17 + (i % 2) * 5, 1), K.m(0x7a8496), Math.cos(a) * 20, 14 + (i % 2) * 6, Math.sin(a) * 20, { sy: 0.8 });
    }
    add(cloud, g.ico(22, 1), K.m(0x8a94a6), 0, 24, 0, { sy: 0.8 });
    const flash = K.addGlow(cloud, 0xdce8ff, 220, 0, -10, 0, 0.0);
    const strikes = [0, 1, 2].map(i => bolt(gr, Math.cos(i * 2.1) * 40, 232, Math.sin(i * 2.1) * 40, -Math.cos(i * 2.1) * 40, 208, -Math.sin(i * 2.1) * 40, rand, 3));
    // The speakers' tent behind the ring.
    add(gr, g.cone(30, 64, 9), K.m(ALG.storm), -58, 32, -52);
    for (let i = 0; i < 5; i++) add(gr, g.cyl(1.2, 1.2, 22, 4), K.m(ALG.wood), -58 + Math.cos(i * 1.26) * 3, 70, -52 + Math.sin(i * 1.26) * 3, { rz: Math.cos(i * 1.26) * 0.4, rx: Math.sin(i * 1.26) * 0.4 });
    brazier(gr, 74, 40, 0xc8d8ff); brazier(gr, 74, -40, 0xc8d8ff);
    hideBanner(gr, team, -60, 10, 56, 100);
    gr.userData = {
      tick(b, time) {
        cloud.rotation.y = time * 0.2;
        let lit = 0;
        strikes.forEach((s, i) => { s.visible = Math.sin(time * (3.1 + i * 1.7) + i * 2) > 0.95; if (s.visible) lit = 1; });
        flash.material.opacity = lit * 0.8;
        tip.material.opacity = 0.5 + lit * 0.5;
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Frost Shrine: a temple hewn from a block of glacier ice under a pyramid of ice, a frost heart
  // floating inside it, ice pillars at the door under crossed tusks, ice spikes erupting around it.
  B.barracksIcespeaker = (slot, base, team) => {
    const gr = new THREE.Group();
    const ice = iceMat();
    add(gr, g.cyl(86, 92, 8, 12), K.m(ALG.stone), 0, 4, 0);
    snowMound(gr, -20, 0, 80, 10);
    add(gr, g.box(84, 76, 104), ice, -24, 46, 0);
    add(gr, g.cone(78, 66, 4), ice, -24, 117, 0, { ry: PI / 4 });
    add(gr, g.box(86, 6, 106), K.m(ALG.snow), -24, 85, 0);
    for (let i = 0; i < 9; i++) add(gr, g.cone(3, 12 + (i % 3) * 5, 4), glowIce(), 19, 78 - (i % 3) * 2.5, -48 + i * 12, { rx: PI, shadow: false });
    // The frost heart, seen through the ice.
    const heart = pivot(gr, -24, 48, 0);
    add(heart, g.oct(16), glowIce(), 0, 0, 0, { sy: 1.6, shadow: false });
    K.addGlow(heart, 0x9fdcff, 160, 0, 0, 0, 0.7);
    // Doorway: pillars, lintel and crossed tusks.
    for (const z of [-26, 26]) { add(gr, g.cyl(7, 8, 70, 6), ice, 34, 43, z); add(gr, g.cyl(10, 10, 6, 6), K.m(ALG.stone), 34, 8, z); }
    add(gr, g.box(18, 10, 70), ice, 34, 82, 0);
    add(gr, g.box(4, 54, 34), K.lit(0x2a5a7a), 19, 35, 0, { shadow: false });
    K.addGlow(gr, 0x7fd8ff, 80, 26, 35, 0, 0.6);
    tusk(gr, 40, 92, 18, 30, PI * 0.72, 0); tusk(gr, 40, 92, -18, 30, PI * 0.72, PI);
    // Ice spikes breaking out of the ground around it.
    for (let i = 0; i < 9; i++) {
      const a = PI * 0.15 + i / 8 * PI * 1.7;
      iceShard(gr, Math.cos(a) * 76, 2, Math.sin(a) * 76, 28 + (i % 3) * 16, 9, Math.cos(a) * -0.25, Math.sin(a) * 0.25, ice);
    }
    brazier(gr, 70, 56); brazier(gr, 70, -56);
    hideBanner(gr, team, -70, 8, -70, 110);
    const motes = pivot(gr, -24, 0, 0);
    for (let i = 0; i < 8; i++) add(motes, g.oct(3), glowIce(), Math.cos(i * 0.8) * 70, 40 + (i % 4) * 22, Math.sin(i * 0.8) * 70, { shadow: false });
    gr.userData = {
      tick(b, time) {
        heart.rotation.y = time * 0.7; heart.position.y = 48 + Math.sin(time * 1.3) * 5;
        motes.rotation.y = time * 0.3;
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // ---------------------------------------------------------------------------------------------
  // LURKER — Wavethrower, Clawcrusher
  // ---------------------------------------------------------------------------------------------
  // Wavethrower: a slender, fin-crested Lurker in a kelp sash, a ring of water swirling about its waist
  // and a globe of seawater cupped in its raised claw (spent on the throw, welling up again after).
  U.wavethrower = team => {
    const gr = new THREE.Group();
    const shellM = K.mat(LUR.shell, { metalness: 0.3, roughness: 0.45 });
    const { l1, l2, hi } = lurkerBody(gr, shellM, team);
    for (let i = 0; i < 5; i++) add(gr, g.box(1, 9 - Math.abs(i - 2) * 2, 4), K.m(LUR.coralC), -2 - i * 2.5, 47 - i * 1.5, 0, { rz: 0.3 + i * 0.12 });   // fin crest
    add(gr, g.box(14, 3, 2), K.m(LUR.kelp), 0, 30, 0, { rx: 0.8, ry: PI / 2 });
    for (let i = 0; i < 3; i++) add(gr, g.box(1.5, 12, 3), K.m(LUR.kelp), 8, 14 - i, -4 + i * 4, { rz: 0.1 });
    // Off claw held open.
    add(gr, g.cyl(2, 1.8, 14, 5), hi, 4, 30, -12, { rz: -1.1 });
    add(gr, g.sph(3.6, 7, 6), shellM, 12, 34, -13, { sx: 1.3 });
    // Throwing claw cupping the water globe.
    const arm = pivot(gr, 2, 34, 11);
    add(arm, g.cyl(2.2, 2, 12, 5), hi, 0, -3, 0);
    add(arm, g.sph(4, 8, 6), shellM, 0, 7, 0, { sy: 1.2 });
    for (const s of [-1, 1]) add(arm, g.cone(1.6, 8, 4), hi, s * 2.4, 13, 0, { rz: -s * 0.5 });
    const orb = pivot(arm, 0, 19, 0);
    add(orb, g.sph(5.5, 10, 8), water(), 0, 0, 0, { shadow: false });
    add(orb, g.sph(2.4, 6, 5), K.lit(LUR.glow), 0, 0, 0, { shadow: false });
    K.addGlow(orb, LUR.glow, 26, 0, 0, 0, 0.7);
    const swirl = pivot(gr, 0, 22, 0);
    add(swirl, g.torus(15, 1.2, 4, 18, PI * 1.4), water(), 0, 0, 0, { rx: PI / 2, shadow: false });
    add(swirl, g.torus(12, 0.8, 4, 16, PI), K.lit(0xbff8ff, { transparent: true, opacity: 0.6 }), 0, 6, 0, { rx: PI / 2, shadow: false });
    gr.scale.setScalar(1.1);
    gr.userData = { tunic: shellM, arm, l1, l2, ranged: true, aura: null, phase: Math.random() * 10,
      tick(u, e, time) {
        swirl.rotation.y = time * 3 + u.phase;
        swirl.position.y = 22 + Math.sin(time * 2 + u.phase) * 3;
        orb.scale.setScalar(Math.max(0.05, 1 - (e.swing || 0) * 1.4));
      } };
    return K.shadowed(gr);
  };

  // Clawcrusher: a hulking crab-knight with one colossal crusher claw, its back armored in a spiked,
  // barnacled shell. While the shell holds it only plods on; once it cracks off the creature beneath
  // glows red with rage.
  U.clawcrusher = team => {
    const gr = new THREE.Group();
    const shellM = K.mat(LUR.shell, { metalness: 0.3, roughness: 0.45 }), dark = K.m(LUR.shellDark);
    const { l1, l2, hi, under } = lurkerBody(gr, shellM, team, { noEyes: true });
    for (const s of [-1, 1]) for (const dx of [-3, 4]) add(gr, g.cyl(1.8, 1.2, 14, 5), hi, dx, 10, s * 9, { rx: s * 0.9 });   // extra walking legs
    const calm = pivot(gr), rage = pivot(gr);
    for (const s of [-1, 1]) {
      add(calm, g.sph(1.6, 6, 5), K.lit(LUR.glow), 6, 50, s * 3.4, { shadow: false });
      add(rage, g.sph(1.9, 6, 5), K.lit(0xff5a30), 6, 50, s * 3.4, { shadow: false });
    }
    // The shell: a spiked dome over the back and shoulders, barnacles and plates.
    const shell = pivot(gr);
    add(shell, g.dome(15, 12, 6), dark, -4, 30, 0, { sx: 1.15, sy: 1.35, rz: 0.35 });
    for (let i = 0; i < 6; i++) add(shell, g.cone(2.2, 11, 5), hi, -12 + i * 2.4, 44 - Math.abs(i - 2.5) * 1.6, (i - 2.5) * 3.2, { rz: 0.7 });
    for (const s of [-1, 1]) add(shell, g.dome(8, 8, 5), dark, 1, 39, s * 12, { rx: s * 0.7 });
    for (let i = 0; i < 6; i++) add(shell, g.cone(1.4, 3, 5), K.m(0xb8b0a0), -14 + (i % 3) * 4, 24 + (i >> 1) * 6, (i % 2 ? 1 : -1) * (5 + i), { rz: 1.2 });
    // Cracked: shards of shell left on a back glowing hot with rage.
    const cracked = pivot(gr);
    for (let i = 0; i < 4; i++) add(cracked, g.tet(5 - i * 0.6), dark, -8 + i * 2, 30 + i * 4, (i % 2 ? 1 : -1) * 6, { rz: i, rx: i * 0.7 });
    add(cracked, g.sph(9, 8, 6), K.lit(0xff6a3a), -6, 32, 0, { sx: 0.7, sy: 1.1, shadow: false });
    const fury = K.addGlow(cracked, 0xff5a30, 60, -2, 30, 0, 0.6);
    // Off claw.
    add(gr, g.cyl(2.4, 2, 14, 5), hi, 4, 26, -13, { rz: -0.8 });
    add(gr, g.sph(5, 7, 6), shellM, 13, 21, -14, { sx: 1.4 });
    add(gr, g.cone(2.4, 8, 4), hi, 19, 23, -14, { rz: -PI / 2 });
    // The crusher claw: a massive pincer that snaps shut on every blow.
    const arm = pivot(gr, 2, 34, 13);
    add(arm, g.cyl(3.4, 3, 12, 6), hi, 0, -3, 0);
    add(arm, g.sph(9, 10, 8), dark, 0, 12, 0, { sy: 1.45, sx: 1.1 });
    for (let i = 0; i < 5; i++) add(arm, g.cone(1, 4, 4), under, 0, 6 + i * 4, 8, { rx: PI / 2 });
    add(arm, g.cone(4.6, 22, 6), hi, 3, 31, 0);
    const jaw = pivot(arm, -2, 22, 0);
    add(jaw, g.cone(3.8, 18, 6), hi, -2, 8, 0, { rz: 0.35 });
    gr.scale.setScalar(1.35);
    gr.userData = { tunic: shellM, arm, l1, l2, ranged: false, aura: null, phase: Math.random() * 10,
      tick(u, e, time) {
        const whole = e.carapace > 0;
        shell.visible = calm.visible = whole;
        cracked.visible = rage.visible = !whole;
        if (!whole) fury.material.opacity = 0.45 + Math.sin(time * 8 + u.phase) * 0.2;
        jaw.rotation.z = 0.35 - K.ease.bump(e.swing || 0) * 0.5;
      } };
    return K.shadowed(gr);
  };

  // Tide Pool: a glowing pool in a reef of coral, a conch spire at its heart throwing an endless arc of
  // seawater, kelp swaying, a great curling stone wave rising behind it.
  B.barracksWavethrower = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(88, 94, 8, 14), K.m(LUR.sand), 0, 4, 0);
    add(gr, g.torus(60, 9, 6, 24), K.m(LUR.rock), 6, 10, 0, { rx: PI / 2 });
    add(gr, g.cyl(56, 56, 3, 24), K.lit(0x1a8a9a), 6, 9, 0, { shadow: false });
    add(gr, g.cyl(56, 56, 4, 24), water(), 6, 12, 0, { shadow: false });
    K.addGlow(gr, LUR.glow, 140, 6, 16, 0, 0.35);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * PI * 2 + 0.4;
      coral(gr, 6 + Math.cos(a) * 70, Math.sin(a) * 70, 26 + (i % 3) * 10, [LUR.coral, LUR.coralB, LUR.coralC][i % 3], i);
    }
    // The fountain: a conch spire and its arc of droplets.
    conch(gr, 6, 10, 0, 9, LUR.sand);
    const jet = pivot(gr, 6, 40, 0), drops = [];
    for (let i = 0; i < 10; i++) {
      const d = add(jet, g.sph(3.4 - (i % 3) * 0.6, 6, 5), K.lit(0xbff8ff), 0, 0, 0, { shadow: false });
      drops.push(d);
    }
    // A great wave of carved shell-stone curling over the back of the pool, foam along its lip.
    const curl = new THREE.CylinderGeometry(40, 40, 116, 18, 1, true, 1.75, 3.3);
    add(gr, curl, K.m(LUR.shellHi, { side: THREE.DoubleSide }), -48, 46, 0, { rx: PI / 2 });
    add(gr, g.box(30, 52, 116), K.m(LUR.shell), -76, 26, 0);
    for (let i = 0; i < 8; i++) add(gr, g.sph(6 + (i % 2) * 2, 6, 5), K.lit(0xeaffff), -9, 52 - (i % 3) * 2, -52 + i * 15, { shadow: false });
    for (let i = 0; i < 5; i++) add(gr, g.sph(5, 6, 5), K.lit(0xeaffff), -48 + (i % 2) * 6, 88, -46 + i * 23, { shadow: false });
    const fronds = [];
    for (const [x, z, h] of [[64, 64, 60], [70, -58, 50], [-20, 78, 56], [-22, -76, 48]]) fronds.push(kelp(gr, x, z, h));
    gr.add(...K.teamFlag(team, -70, 100, 60));
    gr.userData = {
      tick(b, time) {
        drops.forEach((d, i) => {
          const f = (time * 0.6 + i / drops.length) % 1, a = Math.floor(time * 0.6 + i / drops.length) * 2.4 + i * 0.37;
          d.position.set(Math.cos(a) * f * 46, Math.sin(f * PI) * 46 - f * 26, Math.sin(a) * f * 46);
        });
        fronds.forEach((segs, j) => segs.forEach((s, i) => { s.rotation.z = Math.sin(time * 1.3 + j + i * 0.6) * 0.18; }));
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Crusher Den: the hollow shell of a colossal crab turned into a cave, eyes glowing in its mouth;
  // giant claw molts and cracked shells lie around it among smashed boulders.
  B.barracksClawcrusher = (slot, base, team) => {
    const gr = new THREE.Group();
    const dark = K.m(LUR.shellDark), hi = K.m(LUR.shellHi);
    add(gr, g.cyl(88, 94, 8, 12), K.m(LUR.rock), 0, 4, 0);
    // The great shell.
    add(gr, g.dome(72, 18, 8), dark, -22, 6, 0, { sx: 1.05, sy: 0.85 });
    for (let i = 0; i < 7; i++) add(gr, g.cone(6, 30 - Math.abs(i - 3) * 3, 6), hi, -60 + i * 13, 60 - Math.abs(i - 3) * 4, 0, { rz: 0.5 });
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) add(gr, g.cone(4, 18, 5), hi, -50 + i * 20, 30, s * 62, { rx: s * 1.1 });
    const rand = G.rng(5);
    for (let i = 0; i < 12; i++) {
      const a = rand() * PI * 2, b = 0.3 + rand() * 0.9;
      add(gr, g.cone(2.6, 6, 5), K.m(0xb8b0a0), -22 + Math.cos(a) * Math.cos(b) * 72, 6 + Math.sin(b) * 60, Math.sin(a) * Math.cos(b) * 72, { rz: -Math.cos(a), rx: Math.sin(a) });
    }
    // Cave mouth with something watching from inside.
    add(gr, g.cyl(30, 34, 6, 12), K.m(0x0a1418), 40, 26, 0, { rz: PI / 2 - 0.25, sy: 1 });
    const eyes = pivot(gr, 40, 30, 0);
    for (const z of [-7, 7]) add(eyes, g.sph(2.6, 6, 5), K.lit(0xff6a3a), 0, 0, z, { shadow: false });
    K.addGlow(eyes, 0xff5a30, 40, 2, 0, 0, 0.5);
    // A giant molted claw lying in front, and a pile of cracked shells.
    const claw = pivot(gr, 52, 14, -58); claw.rotation.y = 0.6;
    add(claw, g.sph(18, 10, 8), dark, 0, 0, 0, { sx: 1.3, sy: 0.8 });
    add(claw, g.cone(8, 36, 6), hi, 30, 2, -4, { rz: -PI / 2 + 0.15 });
    add(claw, g.cone(6, 28, 6), hi, 24, 2, 10, { rz: -PI / 2 - 0.2 });
    for (const [x, z, r] of [[62, 48, 14], [48, 66, 11], [70, 70, 9], [-60, 70, 12]]) add(gr, g.dome(r, 10, 5), K.m(LUR.shell), x, 4, z, { rz: 0.3, sy: 0.8 });
    for (const [x, z, r] of [[78, -12, 12], [70, 24, 10], [-70, -66, 16], [20, 80, 10]]) add(gr, g.dodec(r), K.m(LUR.rock), x, r * 0.6, z, { ry: x });
    for (let i = 0; i < 5; i++) add(gr, g.sph(4, 8, 6), K.m(LUR.pearl, { metalness: 0.4, roughness: 0.15, emissive: 0x3a3a50 }), 60 + (i % 3) * 7, 6 + (i > 2) * 6, 40 + (i % 2) * 7);
    gr.add(...K.teamFlag(team, -70, 110, -60));
    add(gr, g.cyl(2.4, 3, 110, 6), K.m(0xe8e0d0), -70, 55, -60);
    gr.userData = { tick(b, time) { eyes.visible = Math.sin(time * 0.9) > -0.85; claw.rotation.z = Math.max(0, Math.sin(time * 0.4)) * 0.04; } };
    return K.placeInSlot(gr, slot, base);
  };

  // ---------------------------------------------------------------------------------------------
  // UNFETTERED — Ruined Machine, Burrowing Blade
  // ---------------------------------------------------------------------------------------------
  // Ruined Machine: a rusted, half-wrecked automaton limping on mismatched legs. Its cracked chest core
  // burns an unstable orange, one eye is dead, its off arm is a sparking stump; it still swings the
  // jagged blade it has for a hand.
  U.ruinedMachine = team => {
    const gr = new THREE.Group();
    const body = K.mat(UNF.rust, { metalness: 0.5, roughness: 0.8 }), dk = metal(UNF.dark, 0.6), scrap = metal(UNF.steel, 0.6);
    const l1 = pivot(gr, 0, 16, 5), l2 = pivot(gr, 0, 16, -5);
    add(l1, g.cyl(2.2, 2.2, 9, 8), dk, 0, -3, 0); add(l1, g.cyl(1.4, 1.4, 8, 8), scrap, 0, -10, 0); add(l1, g.box(8, 3, 6), rust(), 1.5, -15, 0);
    add(l2, g.cyl(2.6, 2, 10, 6), rust(), 0, -4, 0); add(l2, g.cone(1.6, 8, 5), dk, 0, -12, 0, { rx: PI });   // a peg for a foot
    add(gr, g.box(12, 16, 15), body, -1, 25, 0, { rz: 0.28 });
    add(gr, g.box(4, 8, 6), K.m(UNF.rustDark), -5, 31, 6, { rz: 0.5 });
    add(gr, g.box(1.2, 5, 8), K.m(K.teamHex(team)), 5, 19, 0, { rz: 0.28 });
    add(gr, g.box(6, 9, 1), scrap, 3, 22, 8.2, { rz: 0.7 });                  // plate hanging loose
    const core = add(gr, g.cyl(3.8, 3.8, 2, 10), K.lit(0xff7a30), 5.5, 27, 0, { rz: PI / 2 - 0.28, shadow: false });
    const coreGlow = K.addGlow(gr, 0xff6a20, 24, 8, 27, 0, 0.8);
    for (const s of [-1, 1]) add(gr, g.box(0.6, 4, 0.6), K.m(0x1a1210), 6.4, 27 + s * 1.2, s * 1.4, { rz: s, shadow: false });   // cracks
    // Head knocked askew: one eye burning, one dead.
    const head = pivot(gr, 4, 38, 0); head.rotation.set(0.35, 0, -0.2);
    add(head, g.cyl(5, 5.5, 8, 10), body, 0, 0, 0);
    add(head, g.box(4, 2, 4), dk, 0, 5, 0);
    add(head, g.sph(1.6, 6, 5), K.lit(0xff4020), 5, 0.5, 2, { shadow: false });
    add(head, g.sph(1.4, 6, 5), K.m(0x111111), 5, 0.5, -2, { shadow: false });
    // Off arm: a stump trailing wires, spitting sparks.
    add(gr, g.cyl(2.2, 2, 6, 6), dk, 0, 30, -10, { rx: -0.5 });
    for (const [c, z] of [[0xc8202a, -11], [0xe0b020, -12.5], [0x2a6ad8, -10]]) add(gr, g.cyl(0.4, 0.4, 7, 3), K.m(c), 1, 26, z, { rz: 0.4, shadow: false });
    const sparks = K.addGlow(gr, 0xffe080, 16, 1, 23, -12, 0.9);
    const smoke = puff(0x3a3634, 28, 0.5); smoke.position.set(-10, 40, 0); gr.add(smoke);
    add(gr, g.cyl(1.6, 1.6, 10, 6), dk, -8, 35, 0, { rz: 0.6 });
    // Blade arm.
    const arm = pivot(gr, 1, 32, 11);
    add(arm, g.cyl(2, 1.8, 10, 6), dk, 0, -3, 0);
    add(arm, g.box(2.4, 18, 1.2), scrap, 0, 9, 0);
    for (let i = 0; i < 4; i++) add(arm, g.cone(1, 3, 3), scrap, 1.4, 3 + i * 4, 0, { rz: -PI / 2 });
    gr.userData = { tunic: body, arm, l1, l2, ranged: false, aura: null, phase: Math.random() * 10,
      tick(u, e, time) {
        const p = u.phase;
        coreGlow.material.opacity = 0.55 + Math.sin(time * 11 + p) * 0.2 + (Math.sin(time * 37 + p) > 0.8 ? 0.3 : 0);
        sparks.visible = Math.sin(time * 23 + p * 3) > 0.3;
        sparks.position.y = 23 + Math.sin(time * 41 + p) * 2;
        smoke.position.y = 40 + ((time * 14 + p * 5) % 16);
        smoke.material.opacity = 0.5 * (1 - ((time * 14 + p * 5) % 16) / 16);
        head.rotation.y = Math.sin(time * 6 + p) > 0.97 ? 0.4 : 0;   // a twitch now and then
      } };
    return K.shadowed(gr);
  };

  // Burrowing Blade: a low armored digging engine, a spinning drill bit for a nose, a saw blade on each
  // flank and scuttling piston legs. Underground it is just a heaving mound of earth with the saw fin
  // cutting along through it; it sinks into the ground as it digs in.
  const DIG = 0.8;   // seconds a dig-in takes (DIG_TIME in squads.js), for the sinking animation
  U.burrowingBlade = team => {
    const gr = new THREE.Group();
    const body = K.mat(UNF.plate, { metalness: 0.6, roughness: 0.4 }), dk = metal(UNF.dark, 0.5), br = metal(UNF.brass, 0.3), steel = metal(0xc8ccd2, 0.25);
    const up = pivot(gr);
    add(up, g.box(26, 10, 16), body, 0, 15, 0);
    add(up, g.dome(12, 12, 5), body, -2, 19, 0, { sx: 1.35, sy: 0.7 });
    for (const x of [-8, 0, 8]) add(up, g.box(2, 11, 17), br, x, 15, 0);
    add(up, g.box(1, 3, 10), K.lit(UNF.glow), 13.2, 18, 0, { shadow: false });
    add(up, g.box(8, 1.2, 6), K.m(K.teamHex(team)), -4, 27.5, 0);
    const drill = pivot(up, 14, 14, 0);
    add(drill, g.cone(6.5, 20, 10), steel, 10, 0, 0, { rz: -PI / 2 });
    for (let i = 0; i < 3; i++) add(drill, g.torus(5 - i * 1.6, 0.8, 4, 10), br, 4 + i * 5, 0, 0, { ry: PI / 2 });
    const saws = [];
    for (const s of [-1, 1]) {
      add(up, g.box(10, 3, 3), dk, 6, 16, s * 9);
      const saw = pivot(up, 9, 16, s * 11);
      add(saw, g.cyl(8, 8, 1.2, 16), steel, 0, 0, 0, { rx: PI / 2 });
      for (let i = 0; i < 8; i++) add(saw, g.box(2.4, 2.4, 1.3), steel, Math.cos(i * PI / 4) * 8.6, Math.sin(i * PI / 4) * 8.6, 0, { rz: i * PI / 4 + PI / 4 });
      add(saw, g.cyl(2, 2, 1.6, 8), br, 0, 0, 0, { rx: PI / 2 });
      saws.push(saw);
    }
    const legs = K.legs4(up, 7, 12, 8, (p, sx, sz) => {
      add(p, g.cyl(1.4, 1.2, 9, 6), dk, 0, -2, sz * 4, { rx: sz * 1.1 });
      add(p, g.cone(1.2, 8, 5), br, 0, -8, sz * 7, { rx: PI + sz * 0.3 });
    });
    // Burrowed: the mound, its clods and the fin of a saw cutting through the earth.
    const mound = pivot(gr);
    add(mound, g.dome(15, 12, 5), K.m(UNF.dirt), 0, 0, 0, { sx: 1.5, sy: 0.45 });
    add(mound, g.dome(10, 10, 4), K.m(UNF.dirtDark), -12, 0, 0, { sx: 1.4, sy: 0.35 });
    const clods = [];
    for (let i = 0; i < 5; i++) clods.push(add(mound, g.dodec(2.6 + (i % 2)), K.m(i % 2 ? UNF.dirt : UNF.dirtDark), -10 + i * 6, 4, (i % 2 ? 1 : -1) * 8));
    const fin = pivot(mound, 6, 5, 0);
    add(fin, g.cyl(10, 10, 2, 16), steel, 0, 0, 0, { rx: PI / 2 });
    for (let i = 0; i < 8; i++) add(fin, g.box(3, 3, 2.2), steel, Math.cos(i * PI / 4) * 10.6, Math.sin(i * PI / 4) * 10.6, 0, { rz: i * PI / 4 + PI / 4 });
    add(fin, g.cyl(2.4, 2.4, 2.4, 8), K.lit(UNF.glow), 0, 0, 0, { rx: PI / 2, shadow: false });
    gr.scale.setScalar(1.15);
    gr.userData = { tunic: body, arm: pivot(gr), l1: pivot(gr), l2: pivot(gr), ranged: false, aura: null, phase: Math.random() * 10,
      tick(u, e, time) {
        const dig = e.digIn > 0, under = e.burrowed && !dig, sunk = dig ? 1 - Math.min(1, e.digIn / DIG) : 0;
        up.visible = !under;
        mound.visible = under || dig;
        up.position.y = -sunk * 22;
        up.rotation.x = dig ? Math.sin(time * 45) * 0.06 : 0;
        mound.scale.setScalar(dig ? 0.4 + 0.6 * sunk : 1);
        const spin = time * (e.swing > 0 ? 34 : e.moving || dig ? 16 : 4);
        drill.rotation.x = spin;
        for (const s of saws) s.rotation.z = -spin;
        fin.rotation.z = -spin;
        K.gait(legs, e, time, u.phase, 24, 0.5);
        clods.forEach((c, i) => { c.position.y = 4 + (e.moving ? Math.abs(Math.sin(time * 11 + i * 1.3)) * 6 : 0); });
      } };
    return K.shadowed(gr);
  };

  // Scrap Heap: a mound of wrecked machines picked over by a gantry crane with a grab on a chain, a
  // giant automaton head half buried in it, and a reassembly frame where a ruined machine hangs
  // sparking as it is welded back together.
  B.barracksRuinedMachine = (slot, base, team) => {
    const gr = new THREE.Group();
    const rand = G.rng(23), dk = metal(UNF.dark, 0.5), st = metal(UNF.steel, 0.5);
    add(gr, g.box(150, 6, 180), K.m(0x2a2622), 0, 3, 0);
    // The heap.
    add(gr, g.dome(62, 14, 6), K.m(UNF.rustDark), -26, 4, 0, { sy: 0.55 });
    const junk = [rust(), dk, st, K.m(UNF.rustDark), metal(UNF.copper, 0.5)];
    for (let i = 0; i < 26; i++) {
      const a = rand() * PI * 2, d = rand() * 52, y = 6 + Math.sqrt(Math.max(0, 1 - (d / 62) ** 2)) * 30;
      const x = -26 + Math.cos(a) * d, z = Math.sin(a) * d, m = junk[i % junk.length], s = 6 + rand() * 9;
      if (i % 3 === 0) add(gr, g.box(s * 1.6, s * 0.6, s), m, x, y, z, { ry: rand() * 3, rz: (rand() - 0.5) });
      else if (i % 3 === 1) add(gr, g.cyl(s * 0.4, s * 0.4, s * 2, 8), m, x, y, z, { rx: rand() * 3, rz: rand() * 3 });
      else gear(gr, x, y, z, s * 0.6, 8, m).rotation.set(rand() * 3, rand() * 3, 0);
    }
    const head = pivot(gr, -30, 22, -18); head.rotation.set(0.3, 0.6, 0.25);
    add(head, g.cyl(22, 24, 30, 12), rust(), 0, 0, 0);
    add(head, g.dome(22, 12, 5), dk, 0, 15, 0);
    add(head, g.box(4, 8, 30), K.m(0x111111), 22, 2, 0);
    add(head, g.sph(5, 8, 6), K.lit(0x7a2010), 23, 2, 8, { shadow: false });
    // Gantry crane over the heap.
    for (const [x, z] of [[-70, 54], [-50, 54], [-70, 74], [-50, 74]]) add(gr, g.box(5, 150, 5), dk, x, 75, z);
    for (const y of [40, 80, 120]) { add(gr, g.box(26, 3, 3), st, -60, y, 54); add(gr, g.box(26, 3, 3), st, -60, y, 74); }
    const crane = pivot(gr, -60, 152, 64);
    add(crane, g.box(14, 8, 14), metal(UNF.warn, 0.4), 0, 0, 0);
    add(crane, g.box(100, 6, 6), metal(UNF.warn, 0.4), 34, 4, 0);
    add(crane, g.box(20, 10, 10), dk, -18, 4, 0);
    strand(crane, 70, 0, 0, 70, -70, 0, 1.4, dk);
    const grab = pivot(crane, 70, -72, 0);
    add(grab, g.cyl(8, 6, 6, 8), dk, 0, 0, 0);
    for (let i = 0; i < 3; i++) add(grab, g.cone(2, 12, 4), st, Math.cos(i * 2.1) * 6, -7, Math.sin(i * 2.1) * 6, { rx: PI + Math.sin(i * 2.1) * 0.4, rz: -Math.cos(i * 2.1) * 0.4 });
    const lamp = K.addGlow(crane, 0xffb030, 30, 0, 10, 0, 0.9);
    add(crane, g.sph(2.4, 6, 5), K.lit(0xffb030), 0, 6, 0, { shadow: false });
    // Reassembly frame with a machine hung in it.
    for (const z of [-40, 10]) add(gr, g.box(5, 80, 5), dk, 48, 40, z);
    add(gr, g.box(5, 5, 56), dk, 48, 80, -15);
    for (const z of [-24, -6]) strand(gr, 48, 80, z, 48, 60, -15, 0.8, st);
    add(gr, g.box(12, 15, 14), rust(), 48, 52, -15, { rz: 0.2 });
    add(gr, g.cyl(4.5, 5, 8, 10), rust(), 49, 64, -15);
    add(gr, g.cyl(3.4, 3.4, 2, 10), K.lit(0xff7a30), 54.5, 53, -15, { rz: PI / 2, shadow: false });
    const weld = K.addGlow(gr, 0xcff4ff, 34, 54, 46, -8, 0.9);
    add(gr, g.box(10, 22, 10), dk, 64, 11, -54);      // a toolbox and gas bottles
    for (const z of [-30, -22]) add(gr, g.cyl(3.6, 3.6, 26, 8), metal(0x3a6a4a, 0.4), 68, 13, z);
    panel(gr, team, 74, 30, 30, 30, 26);
    gr.add(...K.teamFlag(team, -60, 175, 64));
    gr.userData = {
      tick(b, time) {
        crane.rotation.y = Math.sin(time * 0.35) * 0.9 - 0.6;
        grab.position.y = -72 + Math.sin(time * 0.7) * 8;
        lamp.material.opacity = Math.sin(time * 4) > 0 ? 0.9 : 0.15;
        weld.visible = Math.sin(time * 17) + Math.sin(time * 7.3) > 0.4;
        weld.scale.setScalar(26 + Math.sin(time * 31) * 8);
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Bore Works: a lattice drilling derrick over a shaft, its great spiral bit churning down into the
  // earth and up again, spoil heaps and a conveyor, a riveted boiler puffing beside it.
  B.barracksBurrowingBlade = (slot, base, team) => {
    const gr = new THREE.Group();
    const dk = metal(UNF.dark, 0.5), st = metal(UNF.steel, 0.45), br = metal(UNF.brass, 0.3);
    add(gr, g.cyl(88, 94, 6, 12), K.m(UNF.dirtDark), 0, 3, 0);
    // Shaft and its dirt rim.
    add(gr, g.cyl(26, 26, 1, 16), K.m(0x0c0a08), 16, 6.6, 0, { shadow: false });
    add(gr, g.torus(28, 6, 5, 18), K.m(UNF.dirt), 16, 6, 0, { rx: PI / 2 });
    // Derrick: four legs leaning in to a crown block, braced with cross struts.
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of corners) strand(gr, 16 + sx * 40, 0, sz * 40, 16 + sx * 12, 190, sz * 12, 5, dk, true);
    for (const y of [50, 100, 150]) {
      const w = 40 - (y / 190) * 28;
      for (const [sx, sz] of corners) {
        const nx = corners[(corners.findIndex(c => c[0] === sx && c[1] === sz) + 1) % 4];
        strand(gr, 16 + sx * w, y, sz * w, 16 + nx[0] * w, y, nx[1] * w, 2.4, st);
      }
    }
    add(gr, g.box(30, 8, 30), br, 16, 194, 0);
    const pulley = gear(gr, 16, 206, 0, 12, 10);
    // The drill: shaft, spiral bit, bobbing in and out of the hole as it turns.
    const drill = pivot(gr, 16, 0, 0);
    add(drill, g.cyl(3.5, 3.5, 130, 8), st, 0, 120, 0);
    add(drill, g.cyl(9, 9, 12, 10), br, 0, 60, 0);
    add(drill, g.cone(16, 46, 10), metal(0xc8ccd2, 0.25), 0, 30, 0, { rx: PI });
    for (let i = 0; i < 4; i++) add(drill, g.torus(13 - i * 3, 1.6, 4, 12), br, 0, 46 - i * 9, 0, { rx: PI / 2 + 0.2, rz: i * 0.8 });
    // Spoil heaps, a conveyor up onto one, a boiler with its stack.
    for (const [x, z, r] of [[-56, -50, 30], [-40, -76, 20], [60, -66, 22]]) add(gr, g.dome(r, 12, 5), K.m(UNF.dirt), x, 4, z, { sy: 0.7 });
    strand(gr, 0, 14, -28, -46, 36, -50, 8, dk, true);
    for (let i = 0; i < 5; i++) add(gr, g.cyl(2, 2, 10, 6), br, -i * 10, 17 + i * 4.4, -30 - i * 4.6, { rx: PI / 2 });
    add(gr, g.cyl(18, 18, 52, 14), br, -58, 22, 40, { rx: PI / 2 });
    for (const z of [22, 40, 58]) add(gr, g.torus(18.4, 1.4, 4, 16), dk, -58, 22, z);
    const steam = smokestack(gr, -70, 40, 90, 6);
    add(gr, g.sph(3, 6, 5), K.lit(0xff7a30), -40, 18, 40, { shadow: false });
    panel(gr, team, 74, 26, 40, 30, 24);
    gr.add(...K.teamFlag(team, 40, 170, -40));
    add(gr, g.cyl(2, 2, 140, 4), dk, 40, 100, -40);
    gr.userData = {
      tick(b, time) {
        drill.rotation.y = time * 4;
        drill.position.y = -14 + Math.sin(time * 0.9) * 14;
        pulley.rotation.z = time * 3;
        steam.material.opacity = 0.25 + Math.max(0, Math.sin(time * 2.3)) * 0.4;
        steam.position.y = 104 + Math.max(0, Math.sin(time * 2.3)) * 14;
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // ---------------------------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------------------------
  const env = (o, inT = 0.1, outT = 0.3) => Math.min(1, o.t / inT, (o.dur - o.t) / outT);

  // Wavethrower's surge: a narrow wall of water (o.width across) rolling o.len along `angle` from
  // (x0, y0), foam on its lip, spray flying, a wet streak behind.
  R.FX.surge = {
    make(o) {
      const grp = new THREE.Group(), wall = pivot(grp);
      const wet = K.mat(0x2a8aa8, { transparent: true, opacity: 0.8, metalness: 0.3, roughness: 0.2, flatShading: false, side: THREE.DoubleSide });
      const crest = add(wall, new THREE.CylinderGeometry(20, 20, o.width, 14, 1, true, 0, PI), wet, 0, 26, 0, { rx: PI / 2, shadow: false });
      crest.rotation.y = PI / 2;
      add(wall, g.box(30, 30, o.width), wet, -14, 15, 0, { shadow: false });
      const foam = K.lit(0xeaffff, { transparent: true, opacity: 0.9 });
      for (let i = 0; i < 6; i++) add(wall, g.sph(5 + (i % 2) * 2, 6, 5), foam, 8 + (i % 3) * 3, 44 + (i % 2) * 4, (i / 5 - 0.5) * o.width, { shadow: false });
      const spray = [];
      for (let i = 0; i < 7; i++) {
        const s = K.glow(0xdffcff, 22 + i * 3, 0.8);
        s.userData = { z: (i / 6 - 0.5) * o.width, ph: i / 7 };
        wall.add(s); spray.push(s);
      }
      const trailMat = new THREE.MeshBasicMaterial({ color: 0x1a5a70, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      const trail = add(grp, g.plane(1, 1), trailMat, 0, 1.5, 0, { rx: -PI / 2, shadow: false });
      grp.userData = { wall, trail, trailMat, wet, spray };
      grp.rotation.y = -o.angle;
      grp.position.set(o.x0, 0, o.y0);
      return grp;
    },
    update(m, o, time) {
      const u = m.userData, front = Math.min(o.len, o.t * o.speed), k = env(o, 0.15, 0.4);
      u.wall.position.x = front;
      u.wall.scale.set(1, 0.4 + 0.6 * k, 1);
      u.wet.opacity = 0.8 * k;
      u.trail.scale.set(Math.max(1, front), o.width * 0.8, 1);
      u.trail.position.x = front / 2;
      u.trailMat.opacity = 0.3 * k;
      for (const s of u.spray) {
        const f = (time * 1.8 + s.userData.ph) % 1;
        s.position.set(12 + f * 20, 40 + f * 30, s.userData.z);
        s.material.opacity = (1 - f) * 0.8 * k;
      }
    }
  };

  // What's left of a battering ram: the shed's roof caved in on its side, the log, a loose wheel and
  // scattered planks. It sinks into the snow before it goes.
  R.FX.ramWreck = {
    make(o) {
      const grp = new THREE.Group();
      const plank = K.m(HUM.plank), hide = K.m(HUM.hide), iron = metal(HUM.iron, 0.5);
      add(grp, prismX(40, 100), hide, -4, 10, 8, { sy: 0.62, rx: 0.5, rz: 0.08 });
      add(grp, g.cyl(7, 8, 120, 10), K.m(HUM.ash), 10, 8, -22, { rz: PI / 2, ry: 0.25 });
      add(grp, g.box(16, 17, 17), iron, 70, 9, -36, { ry: 0.25 });
      add(grp, g.cyl(15, 15, 6, 12), K.m(HUM.dark), -40, 3, 34);
      add(grp, g.cyl(15, 15, 6, 12), K.m(HUM.dark), 44, 14, 30, { rx: 1.2 });
      const rand = G.rng(3);
      for (let i = 0; i < 8; i++) add(grp, g.box(28 + rand() * 30, 4, 6), plank, (rand() - 0.5) * 120, 3, (rand() - 0.5) * 90, { ry: rand() * 3 });
      for (let i = 0; i < 2; i++) add(grp, g.cyl(9, 9, 2.4, 10), K.m(K.teamHex(o.team)), -20 + i * 50, 2, 44 - i * 80, { rz: 0.1 });
      grp.rotation.y = -o.angle;
      grp.position.set(o.x, 0, o.y);
      return grp;
    },
    update(m, o) {
      m.position.y = -Math.max(0, o.t - (o.dur - 1.5)) / 1.5 * 22;
    }
  };
})(window.Game);
