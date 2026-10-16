// Lurker race models: crab-folk of the frozen deep. Coral, shell, pearl, kelp and glowing brine.
// Buildings face +x toward the base center; units face +x with the weapon arm on +z (see render3d.js).
(function (G) {
  const R = G.render3d, K = G.kit, g = K.g, add = K.add, pivot = K.pivot, PI = Math.PI;

  const C = {
    shell: 0x2a6a7a, shellHi: 0x4a9aa6, shellDark: 0x1a3a48, coral: 0xff8a7a, coralB: 0xffb060, coralC: 0xd86aa0,
    sand: 0xc8b090, pearl: 0xf0f0ff, kelp: 0x3a6a3a, rock: 0x3a4448, glow: 0x5fe0e8, ink: 0x3a1a5a
  };
  const water = () => K.m(0x2a8aa8, { transparent: true, opacity: 0.72, metalness: 0.3, roughness: 0.15, emissive: 0x0a3040 });
  const glowM = () => K.lit(C.glow);
  const pearlM = () => K.m(C.pearl, { metalness: 0.4, roughness: 0.15, emissive: 0x3a3a50 });
  const coralCols = [C.coral, C.coralB, C.coralC];

  // ---------------------------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------------------------
  // A branching coral: a trunk splitting into tipped branches.
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
  // Spiral conch: stacked shrinking rings twisting upward.
  function conch(parent, x, y, z, s, color = C.sand) {
    const c = pivot(parent, x, y, z);
    for (let i = 0; i < 7; i++) {
      const r = s * (1 - i * 0.12);
      add(c, g.torus(r, r * 0.42, 6, 14), K.m(i % 2 ? color : 0xe8d8c0), Math.cos(i * 1.2) * s * 0.15, i * s * 0.3, Math.sin(i * 1.2) * s * 0.15, { rx: PI / 2 });
    }
    add(c, g.cone(s * 0.32, s * 1.1, 8), K.m(color), 0, s * 2.35, 0);
    return c;
  }
  function urchin(parent, x, y, z, r, color = 0x2a1a3a) {
    const u = pivot(parent, x, y, z);
    add(u, g.ico(r, 0), K.m(color), 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4, b = Math.acos(1 - 2 * ((i + 0.5) / 14));
      const sp = pivot(u, 0, 0, 0); sp.rotation.set(b, a, 0);
      add(sp, g.cone(r * 0.18, r * 1.6, 4), K.m(0x5a3a6a), 0, r * 1.1, 0);
    }
    return u;
  }
  function kelp(parent, x, z, h) {
    const k = pivot(parent, x, 0, z);
    const segs = [];
    let p = k;
    for (let i = 0; i < 4; i++) {
      const s = pivot(p, 0, i ? h / 4 : 0, 0);
      add(s, g.box(1.5, h / 4, 6), K.m(C.kelp, { side: THREE.DoubleSide }), 0, h / 8, 0);
      segs.push(s); p = s;
    }
    k.userData.segs = segs;
    return k;
  }
  function pool(parent, x, z, r) {
    add(parent, g.cyl(r + 8, r + 12, 8, 16), K.m(C.rock), x, 4, z);
    const w = add(parent, g.disc(r, 32), water(), x, 8.5, z, { shadow: false });
    return w;
  }
  function shellBanner(parent, team, x, z, h = 80) {
    add(parent, g.cyl(2, 3, h, 6), K.m(C.coralB), x, h / 2, z);
    add(parent, g.box(2, 30, 24), K.m(K.teamHex(team)), x + 1, h - 20, z + 13);
    add(parent, g.torus(6, 2, 5, 10), pearlM(), x, h + 4, z, { rx: PI / 2 });
    add(parent, g.sph(4, 8, 6), pearlM(), x, h + 4, z);
  }

  const B = {};

  // Tide Shell: a giant spiral conch turned into a dwelling, a pearl lamp at its mouth.
  B.hut = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(72, 78, 6, 14), K.m(C.sand), 0, 3, 0);
    // The conch lies on its side, spire pointing away and its mouth (the door) toward the base center.
    const shell = conch(gr, 30, 52, 0, 40, 0xd8b088);
    shell.rotation.z = PI / 2;
    add(gr, g.disc(36, 24), K.m(0x140c08, { side: THREE.DoubleSide }), 32, 52, 0, { rz: PI / 2, shadow: false });
    add(gr, g.torus(42, 7, 6, 18), K.m(0xffc8a8), 34, 52, 0, { ry: PI / 2 });
    const lamp = add(gr, g.sph(6, 10, 8), pearlM(), 50, 44, 18);
    K.addGlow(gr, C.glow, 50, 50, 44, 18, 0.7);
    coral(gr, 40, -46, 50, C.coral, 1); coral(gr, -50, 40, 40, C.coralB, 2);
    kelp(gr, -40, -40, 50);
    shellBanner(gr, team, -30, -60, 100);
    return K.placeInSlot(gr, slot, base);
  };

  // Reef Trench: a ring of coral and rock around a brine pit, urchin launchers peeking over.
  B.digin = (slot, base, team) => {
    const gr = new THREE.Group();
    pool(gr, 0, 0, 52);
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * PI * 2;
      if (i % 2) coral(gr, Math.cos(a) * 66, Math.sin(a) * 66, 36 + (i % 3) * 10, coralCols[i % 3], i);
      else add(gr, g.dodec(14), K.m(C.rock), Math.cos(a) * 66, 10, Math.sin(a) * 66);
    }
    for (const [x, z] of [[20, -26], [30, 8], [8, 34]]) {
      add(gr, g.sph(9, 8, 6), K.m(C.shell), x, 14, z, { sy: 0.7 });
      for (const s of [-1, 1]) add(gr, g.cyl(0.6, 0.6, 7, 4), K.m(C.shellHi), x + 3, 22, z + s * 2);
      add(gr, g.sph(1.4, 6, 5), glowM(), x + 3, 26, z + 2, { shadow: false });
    }
    shellBanner(gr, team, -40, -30, 80);
    return K.placeInSlot(gr, slot, base);
  };

  // Spine Coral: a towering branching coral with an urchin launcher that turns to aim.
  B.support = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(46, 54, 10, 10), K.m(C.rock), 0, 5, 0);
    add(gr, g.cyl(14, 26, 210, 8), K.m(C.coral), 0, 110, 0);
    for (let i = 0; i < 8; i++) {
      const a = i * 0.9, y = 50 + i * 22;
      const br = pivot(gr, 0, y, 0); br.rotation.set(Math.sin(a) * 0.9, a, Math.cos(a) * 0.9);
      add(br, g.cyl(3, 6, 50 - i * 3, 6), K.m(coralCols[i % 3]), 0, 22, 0);
      add(br, g.sph(6, 6, 5), glowM(), 0, 48 - i * 3, 0, { shadow: false });
    }
    add(gr, g.cyl(26, 16, 14, 8), K.m(C.shellDark), 0, 220, 0);
    const turret = pivot(gr, 0, 236, 0);
    add(turret, g.sph(14, 10, 8), K.m(C.shell), 0, 0, 0, { sy: 0.7 });
    add(turret, g.cyl(5, 7, 40, 8), K.m(C.shellHi), 22, 4, 0, { rz: PI / 2 });
    urchin(turret, 46, 4, 0, 7);
    K.addGlow(turret, C.glow, 40, 0, 10, 0, 0.6);
    gr.add(...K.teamFlag(team, -40, 250, 0));
    gr.userData = { turret };
    return K.placeInSlot(gr, slot, base);
  };

  // Brine Mortar: a giant clam that gapes open to lob a globe of brine.
  B.siege = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(80, 86, 6, 14), K.m(C.sand), 0, 3, 0);
    const turret = pivot(gr, 0, 0, 0);
    add(turret, g.dome(48, 16, 6), K.m(C.shell), 0, 6, 0, { sy: 0.45, rx: PI });
    add(turret, g.cyl(48, 48, 6, 16), K.m(C.shellDark), 0, 6, 0);
    for (let i = 0; i < 8; i++) add(turret, g.box(90, 2, 3), K.m(C.shellHi), 0, 4, -40 + i * 11.5);
    const lid = pivot(turret, -44, 10, 0);
    add(lid, g.dome(48, 16, 6), K.m(C.shellHi), 44, 0, 0, { sy: 0.5 });
    for (let i = 0; i < 6; i++) add(lid, new THREE.TorusGeometry(48 - i * 7, 1.5, 4, 16, PI), K.m(C.shell), 44, 0, 0, { rx: PI / 2 - 0.0, ry: 0, rz: 0 });
    add(lid, g.sph(10, 10, 8), K.m(0xffb0a0), 44, -2, 0, { sy: 0.5 });
    const globe = add(turret, g.sph(14, 12, 10), water(), 10, 22, 0);
    const glow = K.addGlow(turret, C.glow, 70, 10, 22, 0, 0.6);
    for (const z of [-60, 60]) coral(gr, -30, z, 44, coralCols[(z > 0) + 0], z);
    gr.add(...K.teamFlag(team, -60, 75, -60));
    gr.userData = {
      turret,
      tick(b, time) {
        const f = b.fired || 0;   // 1 just fired -> 0 reloaded
        lid.rotation.z = (f > 0.6 ? 1 : f / 0.6) * 1.1 + 0.06;
        globe.visible = glow.visible = f < 0.3;
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Maelstrom Pool: a tidal pool feeding a twisting column of water with pearls riding it.
  B.storm = (slot, base, team) => {
    const gr = new THREE.Group();
    pool(gr, 0, 0, 50);
    const column = pivot(gr, 0, 8, 0);
    for (let i = 0; i < 16; i++) add(column, g.torus(15 - i * 0.4, 7.5, 6, 14), water(), Math.cos(i * 0.8) * 5, i * 12.5, Math.sin(i * 0.8) * 5, { rx: PI / 2 });
    add(column, g.cyl(9, 14, 200, 12), K.m(0x9ff0e8, { transparent: true, opacity: 0.35, emissive: 0x206060 }), 0, 100, 0, { shadow: false });
    const pearls = [];
    for (let i = 0; i < 5; i++) { const p = add(gr, g.sph(5, 8, 6), pearlM(), 0, 0, 0); pearls.push(p); }
    const halo = K.addGlow(gr, C.glow, 170, 0, 210, 0, 0.6);
    for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2; conch(gr, Math.cos(a) * 62, 6, Math.sin(a) * 62, 7, coralCols[i % 3]); }
    gr.add(...K.teamFlag(team, -40, 230, 0));
    gr.userData = {
      tick(b, time) {
        column.rotation.y = time * 2;
        halo.material.opacity = 0.5 + Math.sin(time * 2) * 0.15;
        pearls.forEach((p, i) => { const a = time * 1.6 + i * 1.26, y = (time * 30 + i * 40) % 200; p.position.set(Math.cos(a) * 22, 12 + y, Math.sin(a) * 22); });
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Barracks
  B.barracks = (slot, base, team) => {   // Spawning Pool: egg clusters in brine under coral arches
    const gr = new THREE.Group();
    const w = pool(gr, 0, 0, 68);
    for (let i = 0; i < 18; i++) {
      const a = i * 2.4, d = 10 + (i % 6) * 9;
      add(gr, g.sph(6 + (i % 3), 8, 6), K.m(0xffc8a0, { transparent: true, opacity: 0.85, emissive: 0x402010 }), Math.cos(a) * d, 12, Math.sin(a) * d);
    }
    for (let i = 0; i < 3; i++) add(gr, new THREE.TorusGeometry(70, 7, 6, 16, PI), K.m(coralCols[i]), 0, 0, -40 + i * 40, {});
    K.addGlow(gr, 0xffb080, 120, 0, 20, 0, 0.4);
    shellBanner(gr, team, -60, 60, 120);
    gr.userData = { tick(b, time) { w.material.opacity = 0.65 + Math.sin(time * 2) * 0.08; } };
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksArmored = (slot, base, team) => {   // Carapace Grotto: a cave inside a colossal crab shell
    const gr = new THREE.Group();
    add(gr, g.cyl(84, 90, 8, 14), K.m(C.rock), 0, 4, 0);
    add(gr, g.sph(80, 16, 10), K.m(C.shell), -10, 8, 0, { sx: 0.9, sy: 0.6, sz: 1.05 });
    for (let i = 0; i < 7; i++) add(gr, g.cone(7, 34 - Math.abs(i - 3) * 4, 6), K.m(C.shellHi), -50 + i * 15, 58 - Math.abs(i - 3) * 5, 0, { rz: 0.25 });
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) add(gr, g.cone(5, 22, 5), K.m(C.shellHi), -40 + i * 26, 36, s * 74, { rx: s * 1.3 });
    add(gr, g.sph(34, 12, 8), K.m(0x0a1418), 52, 18, 0, { sx: 0.4, sy: 0.7 });
    K.addGlow(gr, C.glow, 80, 64, 20, 0, 0.6);
    for (const s of [-1, 1]) {
      const claw = pivot(gr, 60, 10, s * 54);
      add(claw, g.sph(16, 10, 8), K.m(C.shellHi), 0, 14, 0, { sx: 1.5 });
      add(claw, g.cone(10, 34, 6), K.m(C.shellHi), 26, 24, 0, { rz: -PI / 2 - 0.3 });
      add(claw, g.cone(8, 28, 6), K.m(C.shellHi), 22, 8, 0, { rz: -PI / 2 + 0.2 });
    }
    shellBanner(gr, team, -60, -60, 110);
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksShort = (slot, base, team) => {   // Spine Den: a mound bristling with urchin spines
    const gr = new THREE.Group();
    add(gr, g.dome(72, 16, 8), K.m(C.rock), -6, 0, 0, { sy: 0.8 });
    for (let i = 0; i < 40; i++) {
      const a = i * 2.4, b = 0.25 + (i % 10) / 10 * 1.0;
      const sp = pivot(gr, -6, 0, 0); sp.rotation.set(Math.sin(a) * b, 0, Math.cos(a) * b);
      add(sp, g.cone(2.5, 30, 4), K.m(0x5a3a6a), 0, 66, 0);
    }
    add(gr, g.sph(24, 10, 8), K.m(0x0a0a10), 54, 16, 0, { sx: 0.4 });
    for (const z of [-50, 50]) urchin(gr, 60, 12, z, 9);
    K.addGlow(gr, 0xb07aff, 60, 60, 16, 0, 0.5);
    shellBanner(gr, team, -50, 60, 100);
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksLong = (slot, base, team) => {   // Harpoon Reef: whalebone arches and harpoon racks on a reef
    const gr = new THREE.Group();
    add(gr, g.cyl(84, 90, 10, 14), K.m(C.rock), 0, 5, 0);
    for (let i = 0; i < 4; i++) add(gr, new THREE.TorusGeometry(54 - i * 4, 4, 5, 12, PI * 0.9), K.m(0xe8e0d0), -30 + i * 22, 6, 0, { ry: PI / 2, rz: 0.15 });
    for (const z of [-60, 60]) {
      add(gr, g.box(10, 50, 40), K.m(C.shellDark), 50, 25, z);
      for (let i = 0; i < 5; i++) { add(gr, g.cyl(1.2, 1.2, 70, 4), K.m(0x6b4a2a), 56, 40, z - 16 + i * 8, { rz: 0.1 }); add(gr, g.cone(3, 10, 4), K.metal(0x9aa0a8), 60, 78, z - 16 + i * 8); }
    }
    coral(gr, -60, -50, 60, C.coral, 3); coral(gr, -60, 50, 50, C.coralC, 5);
    add(gr, g.cyl(10, 10, 4, 10), K.m(C.sand), 80, 30, 0, { rz: PI / 2 });
    add(gr, g.cyl(4, 4, 4.5, 10), glowM(), 80, 30, 0, { rz: PI / 2, shadow: false });
    shellBanner(gr, team, -70, 0, 120);
    return K.placeInSlot(gr, slot, base);
  };
  // A trident planted in the ground: driftwood shaft, steel crossbar and three prongs.
  function trident(parent, x, z, h, glow = false) {
    const steelM = K.metal(0x9aa0a8);
    add(parent, g.cyl(h * 0.014, h * 0.018, h, 6), K.m(0x6b4a2a), x, h / 2, z);
    add(parent, g.box(h * 0.02, h * 0.02, h * 0.16), steelM, x, h, z);
    for (const dz of [-1, 0, 1]) add(parent, g.cone(h * 0.02, h * (dz ? 0.13 : 0.17), 4), glow && !dz ? glowM() : steelM, x, h * (dz ? 1.065 : 1.085), z + dz * h * 0.07);
  }
  B.barracksSpear = (slot, base, team) => {   // Trident Garden: a ring of planted tridents around a great glowing trident, kelp swaying
    const gr = new THREE.Group();
    add(gr, g.cyl(84, 90, 10, 14), K.m(C.rock), 0, 5, 0);
    add(gr, g.cyl(30, 34, 14, 10), K.m(C.shellDark), -10, 12, 0);
    trident(gr, -10, 0, 200, true);
    K.addGlow(gr, C.glow, 70, -10, 214, 0, 0.7);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * PI * 2 + PI / 8;
      trident(gr, -10 + Math.cos(a) * 66, Math.sin(a) * 66, 110);
    }
    const weeds = [[40, -30], [40, 30], [-50, -20], [-50, 30], [10, -62], [10, 62]].map(([x, z]) => kelp(gr, x, z, 50));
    for (const z of [-50, 50]) add(gr, g.box(10, 22, 36), K.m(C.shellDark), 70, 11, z);
    coral(gr, 70, -50, 40, C.coral, 1); coral(gr, 70, 50, 40, C.coralB, 4);
    shellBanner(gr, team, -60, -70, 110);
    gr.userData = { tick(b, time) { weeds.forEach((k, i) => k.userData.segs.forEach((s, j) => { s.rotation.z = Math.sin(time * 1.4 + i + j * 0.6) * 0.2; })); } };
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksElite = (slot, base, team) => {   // Razor Arena: giant clam shells fan around a sand pit, a razorclaw trophy behind
    const gr = new THREE.Group();
    add(gr, g.cyl(84, 90, 8, 14), K.m(C.rock), 0, 4, 0);
    add(gr, g.cyl(46, 48, 3, 16), K.m(C.sand), 10, 9, 0);
    for (let i = 0; i < 9; i++) {
      if (i === 4) continue;   // the trophy stands in this gap at the back
      const a = PI * 0.25 + i / 8 * PI * 1.5;   // open toward the front
      const p = pivot(gr, 10 + Math.cos(a) * 62, 8, Math.sin(a) * 62); p.rotation.y = -a;
      for (let k = 0; k < 7; k++) {   // a scallop fan standing on its hinge
        const t = (k - 3) * 0.34;
        add(p, g.cone(7, 40, 4), K.m(i % 2 ? C.shellHi : 0xe8d0c0), 0, 4 + 20 * Math.cos(t), 20 * Math.sin(t), { rx: t, sx: 0.35 });
      }
      add(p, g.sph(5, 8, 6), pearlM(), -6, 8, 0);
    }
    for (let i = 0; i < 8; i++) {
      const a = PI * 0.25 + (i + 0.5) / 8 * PI * 1.5;
      add(gr, g.cone(4, 36, 5), K.m(coralCols[i % 3]), 10 + Math.cos(a) * 70, 26, Math.sin(a) * 70);
    }
    // The trophy: a huge razorclaw on a rock at the back of the pit.
    add(gr, g.dodec(22), K.m(C.rock), -56, 16, 0);
    const claw = pivot(gr, -56, 34, 0); claw.rotation.z = 0.5;
    add(claw, g.sph(16, 10, 8), K.m(C.coral), 0, 14, 0, { sy: 1.5 });
    add(claw, g.cone(9, 46, 6), K.m(C.coral), 4, 50, 4);
    add(claw, g.cone(7, 36, 6), K.m(C.coral), -4, 44, -6, { rx: -0.3 });
    for (let i = 0; i < 4; i++) add(claw, g.cone(2, 8, 4), K.m(0xe8e0d0), 10, 30 + i * 8, 4, { rz: -PI / 2 });
    K.addGlow(gr, C.glow, 90, 10, 18, 0, 0.4);
    shellBanner(gr, team, -60, -60, 110);
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksCaster = (slot, base, team) => {   // Tide Temple: a towering conch shrine over a brine pool, a glowing pearl afloat
    const gr = new THREE.Group();
    add(gr, g.cyl(84, 90, 8, 14), K.m(C.rock), 0, 4, 0);
    conch(gr, -36, 8, 0, 34, C.coralC);
    add(gr, g.sph(16, 10, 8), K.m(0x0a1418), 12, 24, 0, { sx: 0.4, sy: 0.9 });
    const w = pool(gr, 48, 0, 26);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * PI * 2;
      add(gr, g.cyl(3, 4, 30, 6), K.m(C.sand), 48 + Math.cos(a) * 40, 15, Math.sin(a) * 40);
      add(gr, g.sph(4, 8, 6), glowM(), 48 + Math.cos(a) * 40, 33, Math.sin(a) * 40, { shadow: false });
    }
    const orb = pivot(gr, 48, 56, 0);
    add(orb, g.sph(10, 12, 10), pearlM(), 0, 0, 0);
    K.addGlow(orb, C.glow, 110, 0, 0, 0, 0.75);
    const ring = pivot(gr, 48, 56, 0);
    add(ring, g.torus(20, 1.2, 4, 24), glowM(), 0, 0, 0, { rx: PI / 2, shadow: false });
    const weeds = [[-70, -40], [-70, 40], [0, -70], [0, 70]].map(([x, z]) => kelp(gr, x, z, 60));
    shellBanner(gr, team, -60, -66, 120);
    gr.userData = {
      tick(b, time) {
        orb.position.y = 56 + Math.sin(time * 1.4) * 6;
        ring.rotation.x = Math.sin(time * 0.9) * 0.5; ring.rotation.z = time * 0.8;
        w.material.opacity = 0.65 + Math.sin(time * 2) * 0.08;
        weeds.forEach((k, i) => k.userData.segs.forEach((s, j) => { s.rotation.z = Math.sin(time * 1.2 + i + j * 0.6) * 0.2; }));
      }
    };
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksCreature = (slot, base, team) => {   // Snapjaw Pens: three tide pools, each holding a snapping crab beast
    const gr = new THREE.Group();
    add(gr, g.box(170, 6, 180), K.m(C.sand), 0, 3, 0);
    const claws = [];
    for (const [x, z, r] of [[-36, -44, 32], [-36, 44, 32], [38, 0, 34]]) {
      pool(gr, x, z, r);
      const crab = pivot(gr, x, 8, z);
      add(crab, g.dome(16, 12, 6), K.m(C.shell), 0, 0, 0, { sx: 1.3, sy: 0.7 });
      for (const dz of [-4, 4]) add(crab, g.sph(2, 6, 5), glowM(), 16, 8, dz, { shadow: false });
      for (const s of [-1, 1]) {
        const c = pivot(crab, 14, 4, s * 14);
        add(c, g.sph(6, 8, 6), K.m(C.shellHi), 4, 0, 0, { sx: 1.6 });
        const jaw = pivot(c, 12, 0, 0);
        add(jaw, g.cone(3, 12, 5), K.m(C.shellHi), 6, 2, 0, { rz: -PI / 2 });
        claws.push(jaw);
      }
    }
    // Low rock walls and nets between the pens, urchins along the front.
    add(gr, g.box(60, 18, 10), K.m(C.rock), -36, 9, 0);
    for (const z of [-60, 60]) add(gr, g.box(10, 18, 50), K.m(C.rock), 30, 9, z);
    add(gr, g.torus(18, 1, 4, 12, PI), K.m(0x8a7a5a), -70, 26, 0, { ry: PI / 2 });
    for (const z of [-30, 30]) urchin(gr, 76, 10, z, 7);
    shellBanner(gr, team, -76, -80, 100);
    gr.userData = { tick(b, time) { claws.forEach((j, i) => { j.rotation.y = Math.max(0, Math.sin(time * 3 + i * 1.3)) * -0.6 * (i % 2 ? -1 : 1); }); } };
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksMounted = (slot, base, team) => {   // Strider Roost: a shell-vaulted stable on coral stilts over a tide pool
    const gr = new THREE.Group();
    const w = pool(gr, 0, 0, 70);
    for (const [x, z] of [[-50, -64], [-50, 64], [10, -64], [10, 64], [-50, 0], [10, 0]]) add(gr, g.cyl(5, 7, 60, 6), K.m(C.coralB), x, 30, z);
    add(gr, g.box(84, 6, 150), K.m(C.shellDark), -20, 62, 0);
    const vault = new THREE.CylinderGeometry(40, 40, 140, 12, 1, false, -PI / 2, PI).rotateX(-PI / 2);
    add(gr, vault, K.m(C.shell), -20, 65, 0);
    for (let i = 0; i < 7; i++) add(gr, g.cone(5, 26, 5), K.m(C.shellHi), -20, 112, -60 + i * 20);
    add(gr, g.box(4, 34, 30), K.m(0x0a1418), 17, 82, 0);
    // A ramp down to the pool, and long lobster antennae arching over it from the gateposts.
    add(gr, g.box(70, 4, 30), K.m(C.shellDark), 46, 34, 0, { rz: -0.8 });
    for (const s of [-1, 1]) {
      add(gr, g.cyl(4, 5, 46, 6), K.m(C.coral), 74, 23, s * 22);
      add(gr, g.cyl(1.2, 2, 90, 5), K.m(0xc84a2a), 64, 86, s * 40, { rx: s * 0.45, rz: 0.25 });
    }
    // Tail fan over the door.
    for (let i = 0; i < 5; i++) add(gr, g.cone(6, 26, 4), K.m(0xc84a2a), 22, 112, (i - 2) * 9, { rx: (i - 2) * 0.35, sz: 0.4 });
    K.addGlow(gr, C.glow, 70, 24, 90, 0, 0.5);
    shellBanner(gr, team, -70, -80, 130);
    gr.userData = { tick(b, time) { w.material.opacity = 0.65 + Math.sin(time * 2) * 0.08; } };
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksWarMachine = (slot, base, team) => {   // Leviathan Cradle: a colossal spiral shell grown in a whalebone cradle, a brine mortar out front
    const gr = new THREE.Group();
    add(gr, g.cyl(86, 92, 10, 14), K.m(C.rock), 0, 5, 0);
    const shellP = conch(gr, 30, 60, 0, 36, C.sand);
    shellP.rotation.z = PI / 2;
    for (let i = 0; i < 4; i++) add(gr, new THREE.TorusGeometry(56, 4, 5, 12, PI), K.m(0xe8e0d0), -60 + i * 30, 60, 0, { ry: PI / 2, rz: PI });
    coral(gr, -20, -50, 40, C.coral, 2); coral(gr, 10, 54, 34, C.coralC, 6); coral(gr, -60, 40, 30, C.coralB, 9);
    // The brine mortar: a squat barrel on a rock, glowing at the mouth.
    add(gr, g.dodec(20), K.m(C.rock), 62, 14, -54);
    add(gr, g.cyl(12, 16, 30, 10), K.m(C.shellDark), 62, 44, -54, { rz: -0.4 });
    add(gr, g.cyl(10, 10, 1, 10), glowM(), 68, 58, -54, { rz: -0.4, shadow: false });
    const mouth = K.addGlow(gr, C.glow, 60, 68, 60, -54, 0.8);
    for (const z of [-30, 30]) urchin(gr, 70, 12, z, 8);
    shellBanner(gr, team, -76, -60, 130);
    gr.userData = { tick(b, time) { mouth.material.opacity = 0.6 + Math.sin(time * 3) * 0.25; } };
    return K.placeInSlot(gr, slot, base);
  };

  // Allies
  B.allyEngineer = (slot, base, team) => {   // Coral Nursery: rows of young coral under glowing polyps
    const gr = new THREE.Group();
    add(gr, g.box(100, 8, 90), K.m(C.sand), 0, 4, 0);
    for (let i = 0; i < 9; i++) coral(gr, -30 + (i % 3) * 30, -30 + Math.floor(i / 3) * 30, 26 + (i % 2) * 10, coralCols[i % 3], i);
    for (const z of [-46, 46]) add(gr, g.box(100, 14, 4), K.m(C.rock), 0, 10, z);
    const polyps = [];
    for (let i = 0; i < 5; i++) { const p = K.glow(C.glow, 24, 0.8); gr.add(p); polyps.push(p); }
    gr.add(...K.teamFlag(team, -40, 70, 30));
    gr.userData = { tick(b, time) { polyps.forEach((p, i) => p.position.set(-40 + i * 20, 40 + Math.sin(time * 2 + i) * 6, Math.cos(time + i) * 20)); } };
    return K.placeInSlot(gr, slot, base);
  };
  B.allyMedic = (slot, base, team) => {   // Tidal Font: a fountain in a giant scallop, glowing healing water
    const gr = new THREE.Group();
    add(gr, g.cyl(50, 56, 8, 14), K.m(C.rock), 0, 4, 0);
    for (let i = 0; i < 11; i++) add(gr, g.cone(10, 44, 4), K.m(i % 2 ? 0xffc8a8 : 0xffa888), Math.cos((i / 10 - 0.5) * 2.4) * 30 - 20, 30, Math.sin((i / 10 - 0.5) * 2.4) * 30, { rz: Math.cos((i / 10 - 0.5) * 2.4) * -0.7 - 0.3, rx: Math.sin((i / 10 - 0.5) * 2.4) * 0.7 });
    add(gr, g.cyl(28, 20, 10, 12), K.m(C.sand), 10, 14, 0);
    add(gr, g.cyl(26, 26, 1, 12), K.lit(0x9fe3d0), 10, 19.6, 0, { shadow: false });
    add(gr, g.cyl(3, 4, 36, 6), K.m(C.coral), 10, 36, 0);
    const jet = add(gr, g.cone(8, 22, 8), K.m(0x9ff0e8, { transparent: true, opacity: 0.7, emissive: 0x206060 }), 10, 62, 0, { rx: PI });
    const glow = K.addGlow(gr, 0x9fe3d0, 90, 10, 50, 0, 0.6);
    gr.add(...K.teamFlag(team, -30, 100, -10));
    gr.userData = { tick(b, time) { jet.scale.y = 1 + Math.sin(time * 6) * 0.15; glow.material.opacity = 0.5 + Math.sin(time * 3) * 0.15; } };
    return K.placeInSlot(gr, slot, base);
  };
  B.allyOfficer = (slot, base, team) => {   // Warden's Spire: a tall spiral shell crowned with coral
    const gr = new THREE.Group();
    add(gr, g.cyl(50, 56, 10, 14), K.m(C.rock), 0, 5, 0);
    conch(gr, 0, 10, 0, 22, 0x6a8aa0);
    for (let i = 0; i < 5; i++) coral(gr, Math.cos(i * 1.26) * 8, Math.sin(i * 1.26) * 8, 30, coralCols[i % 3], i).position.y = 90;
    add(gr, g.sph(8, 10, 8), pearlM(), 0, 110, 0);
    K.addGlow(gr, C.glow, 70, 0, 110, 0, 0.7);
    shellBanner(gr, team, 40, 40, 90); shellBanner(gr, team, 40, -40, 90);
    return K.placeInSlot(gr, slot, base);
  };
  B.allyDemolitionist = (slot, base, team) => {   // Ink Grotto: a dark cave oozing ink, ink-sac bombs stacked out front
    const gr = new THREE.Group();
    add(gr, g.dodec(48), K.m(0x2a2e34), -14, 26, 0, { sy: 0.7 });
    add(gr, g.sph(20, 10, 8), K.m(0x050308), 26, 18, 0, { sx: 0.4 });
    add(gr, g.disc(30, 20), K.lit(C.ink), 40, 1.5, 0, { shadow: false });
    for (const [x, z, r] of [[44, 30, 9], [50, -26, 8], [36, -40, 7], [56, 6, 6]]) {
      add(gr, g.sph(r, 10, 8), K.m(C.ink, { emissive: 0x2a0a4a, roughness: 0.3 }), x, r, z, { sy: 1.2 });
      add(gr, g.cone(2, 6, 5), K.m(0x6a4a2a), x, r * 2.3, z);
    }
    K.addGlow(gr, 0x9a4aff, 70, 30, 14, 0, 0.6);
    kelp(gr, -40, 36, 60); kelp(gr, -46, -34, 50);
    gr.add(...K.teamFlag(team, -14, 80, 0));
    return K.placeInSlot(gr, slot, base);
  };

  // Abyssal Reef Throne: a coral citadel grown around a colossal clam holding a glowing pearl.
  B.command = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(150, 162, 14, 16), K.m(C.rock), 0, 7, 0);
    add(gr, g.disc(140, 48), water(), 0, 14.5, 0, { shadow: false });
    // Ring wall of coral and shell spires.
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * PI * 2, x = Math.cos(a) * 124, z = Math.sin(a) * 124;
      if (i % 3 === 0) {
        conch(gr, x, 10, z, 14, coralCols[i % 3]);
        add(gr, g.box(4, 30, 22), K.m(K.teamHex(team)), x + 12, 70, z);
      } else coral(gr, x, z, 70 + (i % 2) * 30, coralCols[i % 3], i);
    }
    // Central reef mound with arches.
    add(gr, g.dodec(80), K.m(C.rock), 0, 50, 0, { sy: 0.6 });
    for (let i = 0; i < 4; i++) add(gr, new THREE.TorusGeometry(60, 9, 6, 16, PI), K.m(coralCols[i % 3]), 0, 40, 0, { ry: i * PI / 4 });
    // The great clam and its pearl.
    const clam = pivot(gr, 0, 100, 0);
    add(clam, g.dome(50, 16, 6), K.m(C.shell), 0, 0, 0, { sy: 0.4, rx: PI });
    const lid = pivot(clam, -46, 2, 0);
    add(lid, g.dome(50, 16, 6), K.m(C.shellHi), 46, 0, 0, { sy: 0.45 });
    lid.rotation.z = 0.9;
    const pearl = add(clam, g.sph(22, 16, 12), pearlM(), 4, 22, 0);
    K.addGlow(clam, C.glow, 260, 4, 22, 0, 0.6);
    const light = G.kit.light(C.glow, 1.6, 900, 2); light.position.set(4, 30, 0); clam.add(light);
    // Gate: whalebone arch facing the enemy, with guardian urchins.
    for (let i = 0; i < 2; i++) add(gr, new THREE.TorusGeometry(46 - i * 6, 5, 5, 12, PI), K.m(0xe8e0d0), 130 + i * 10, 10, 0, { ry: PI / 2 });
    urchin(gr, 140, 20, -56, 12); urchin(gr, 140, 20, 56, 12);
    for (let i = 0; i < 6; i++) kelp(gr, -80 + (i % 3) * 30, (i < 3 ? -1 : 1) * 70, 70);
    gr.position.set(slot.x, 0, slot.y);
    gr.rotation.y = team === G.TEAM.PLAYER ? 0 : PI;
    gr.userData = { tick(b, time) { pearl.rotation.y = time; lid.rotation.z = 0.85 + Math.sin(time * 0.8) * 0.08; clam.position.y = 100 + Math.sin(time * 1.2) * 2; } };
    return gr;
  };

  // ---------------------------------------------------------------------------------------------
  // Units: upright crab-folk. Shell body, eye stalks, a claw (or a weapon held in it).
  // ---------------------------------------------------------------------------------------------
  function unit(team, kind, ranged) {
    if (BEASTS[kind]) return BEASTS[kind](team);
    const gr = new THREE.Group();
    const shellM = K.mat(C.shell, { metalness: 0.3, roughness: 0.45 }), hi = K.m(C.shellHi), under = K.m(C.sand), teamM = K.m(K.teamHex(team));
    // Two pairs of jointed legs (each pivot swings as one stride).
    const l1 = pivot(gr, 0, 14, 5), l2 = pivot(gr, 0, 14, -5);
    for (const [l, s] of [[l1, 1], [l2, -1]]) for (const dx of [-4, 4]) {
      add(l, g.cyl(1.4, 2, 10, 5), hi, dx, -3, s * 3, { rx: s * 0.6 });
      add(l, g.cyl(1, 1.4, 10, 5), hi, dx, -10, s * 6, { rx: -s * 0.2 });
    }
    // Shell torso: carapace on the back, pale belly plates, team-colored shell markings.
    add(gr, g.sph(11, 10, 8), shellM, -2, 28, 0, { sx: 0.85, sy: 1.15 });
    add(gr, g.sph(8, 8, 6), under, 3, 25, 0, { sx: 0.7, sy: 1.1 });
    for (let i = 0; i < 3; i++) add(gr, g.box(1, 1.4, 10 - i * 2), under, 9, 20 + i * 4, 0);
    add(gr, g.torus(10, 1.2, 4, 14, PI), teamM, -3, 30, 0, { ry: PI / 2, rx: 0.3 });
    for (let i = 0; i < 3; i++) add(gr, g.cone(1.6, 6, 4), hi, -10, 26 + i * 6, 0, { rz: 1.4 });
    // Head with eye stalks and mouthparts.
    add(gr, g.sph(5, 8, 6), shellM, 5, 40, 0, { sx: 1.1 });
    for (const s of [-1, 1]) {
      add(gr, g.cyl(0.6, 0.8, 7, 4), hi, 6, 46, s * 2.5, { rx: s * 0.3 });
      add(gr, g.sph(1.5, 6, 5), K.lit(C.glow), 6, 50, s * 3.4, { shadow: false });
    }
    add(gr, g.box(3, 2, 4), under, 10, 38, 0);
    // Off claw (left).
    add(gr, g.cyl(2, 1.8, 14, 5), hi, 4, 26, -12, { rz: -0.8 });
    add(gr, g.sph(4, 7, 6), shellM, 12, 22, -13, { sx: 1.4 });
    add(gr, g.cone(2, 7, 4), hi, 17, 24, -13, { rz: -PI / 2 });
    const arm = pivot(gr, 2, 34, 11);
    add(arm, g.cyl(2.2, 2, 10, 5), hi, 0, -3, 0);
    let aura = null;
    if (kind === 'infantry') {
      // A big crushing claw raised overhead.
      add(arm, g.sph(5, 8, 6), shellM, 0, 10, 0, { sy: 1.4 });
      add(arm, g.cone(2.6, 12, 5), hi, 1.5, 20, 0, {});
      add(arm, g.cone(2, 10, 5), hi, -2.5, 18, 0, { rz: 0.4 });
    } else if (kind === 'armored') {
      // Spiked heavy carapace and a massive serrated claw.
      add(gr, g.dome(13, 10, 5), K.m(C.shellDark), -3, 30, 0, { sx: 1.1, sy: 1.3, rz: 0.3 });
      for (let i = 0; i < 5; i++) add(gr, g.cone(2, 10, 5), hi, -8 + i * 2, 42 - Math.abs(i - 2), (i - 2) * 3, { rz: 0.6 });
      add(arm, g.sph(7, 8, 6), K.m(C.shellDark), 0, 12, 0, { sy: 1.5 });
      add(arm, g.cone(3.6, 18, 5), hi, 2, 26, 0, {});
      add(arm, g.cone(3, 15, 5), hi, -3.5, 23, 0, { rz: 0.4 });
      for (let i = 0; i < 4; i++) add(arm, g.cone(0.8, 3, 4), under, 0.5, 18 + i * 3, 2.6, { rx: PI / 2 });
    } else if (kind === 'short') {
      // A bundle of urchin spines to hurl.
      for (let i = 0; i < 4; i++) add(arm, g.cone(0.9, 22, 4), K.m(0x5a3a6a), (i - 1.5) * 1.6, 12, (i % 2) * 1.5, { rz: (i - 1.5) * 0.08 });
      add(gr, g.ico(5, 0), K.m(0x2a1a3a), -10, 36, 4);
    } else if (kind === 'long') {
      // A coral throwing-stick with a harpoon nocked.
      add(gr, g.cyl(1, 1, 44, 4), K.m(0x6b4a2a), 12, 30, 0, { rz: PI / 2 - 0.3 });
      add(gr, g.cone(2.2, 8, 4), K.metal(0x9aa0a8), 32, 37, 0, { rz: -PI / 2 + 0.3 });
      add(gr, g.cyl(1.4, 1.6, 20, 5), K.m(C.coral), 8, 24, 2, { rz: PI / 2 - 0.3 });
    } else if (kind === 'spearman') {
      // A long trident of driftwood and polished steel.
      add(arm, g.cyl(1.1, 1.3, 70, 5), K.m(0x6b4a2a), 0, 22, 0);
      add(arm, g.box(10, 1.6, 1.6), K.metal(0x9aa0a8), 0, 56, 0);
      for (const dx of [-4.5, 0, 4.5]) add(arm, g.cone(1.3, 9, 4), K.metal(0xc8ccd2), dx, 61, 0);
    } else if (kind === 'elite') {
      // Razorclaw: a crest of coral spikes and a huge claw edged with a serrated shell blade.
      for (let i = 0; i < 4; i++) add(gr, g.cone(1.3, 10 - i, 4), K.m(C.coral), 2 - i * 2.5, 47 - i, 0, { rz: 0.3 + i * 0.15 });
      add(arm, g.sph(6, 8, 6), K.m(C.shellDark), 0, 11, 0, { sy: 1.5 });
      add(arm, g.box(2, 26, 10), K.metal(0xc8ccd2, 0.25), 0, 28, 3);
      for (let i = 0; i < 5; i++) add(arm, g.cone(0.9, 4, 4), K.m(C.pearl), 0, 18 + i * 5, 8.5, { rx: PI / 2 });
    } else if (kind === 'caster') {
      // Tide priest: a kelp robe to the ground and a pearl staff glowing with brine light.
      add(gr, g.cone(13, 26, 8), K.m(C.kelp), 0, 13, 0);
      add(arm, g.cyl(1.2, 1.4, 50, 5), K.m(C.coralB), 0, 14, 0);
      add(arm, g.sph(4.5, 10, 8), pearlM(), 0, 41, 0);
      K.addGlow(arm, C.glow, 34, 0, 41, 0, 0.85);
    } else if (kind === 'engineer') {
      coral(gr, -10, 0, 16, C.coral, 2).position.set(-10, 34, 0);
      add(arm, g.cyl(1, 1, 26, 4), K.m(C.coralB), 0, 12, 0);
      add(arm, g.sph(3, 6, 5), glowM(), 0, 26, 0, { shadow: false });
    } else if (kind === 'medic') {
      add(gr, g.box(1.5, 18, 14), K.m(C.kelp), 8, 22, 0);   // kelp robe front
      conch(arm, 0, 6, 0, 3, 0xffd8c0);
      arm.add(K.glow(0x9fe3d0, 26, 0.8)); arm.children[arm.children.length - 1].position.y = 14;
    } else if (kind === 'officer') {
      for (let i = 0; i < 5; i++) add(gr, g.cone(1.4, 9 + (i % 2) * 4, 4), K.m(coralCols[i % 3]), 4 + Math.cos(i * 1.26) * 3, 48, Math.sin(i * 1.26) * 3);
      add(gr, g.box(2, 26, 22), teamM, -10, 28, 0, { rz: -0.15 });
      add(arm, g.cyl(1, 1, 36, 4), K.metal(0x9aa0a8), 0, 14, 0);
      for (const dz of [-3, 0, 3]) add(arm, g.cone(1, 7, 4), K.metal(0xc8ccd2), 0, 34, dz);
      aura = K.aura(1.5, C.glow); gr.add(aura);
    } else if (kind === 'demolitionist') {
      add(gr, g.sph(8, 10, 8), K.m(C.ink, { emissive: 0x2a0a4a, roughness: 0.3 }), -10, 40, 0, { sy: 1.2 });
      gr.add(K.glow(0x9a4aff, 26, 0.7)); gr.children[gr.children.length - 1].position.set(-10, 40, 0);
    }
    if (G.SQUAD_KINDS[kind].ally) gr.scale.setScalar(1.45);
    else if (kind === 'armored') gr.scale.setScalar(1.35);
    else gr.scale.setScalar(1.05);
    gr.userData = { tunic: shellM, arm, l1, l2, ranged, aura, phase: Math.random() * 10 };
    return K.shadowed(gr);
  }

  // Beasts and engines: snapjaw crabs, strider riders and the leviathan. Same soldier contract;
  // they pose their own legs, claws and guns in userData.tick.
  const BEASTS = {
    // Snapjaw: a low, wide-shelled crab beast with two crushing claws that snap shut on a strike.
    creature(team) {
      const gr = new THREE.Group();
      const shellM = K.mat(C.shell, { metalness: 0.3, roughness: 0.45 }), hi = K.m(C.shellHi), dark = K.m(C.shellDark), teamM = K.m(K.teamHex(team));
      add(gr, g.sph(14, 12, 8), shellM, 0, 20, 0, { sx: 1.2, sy: 0.55, sz: 1.1 });
      add(gr, g.torus(12, 1.2, 4, 16, PI), teamM, -2, 24, 0, { rx: -PI / 2 });
      for (let i = 0; i < 5; i++) add(gr, g.cone(1.4, 6, 4), hi, -6 + i * 3, 27, (i - 2) * 4, { rz: 0.4 });
      for (const s of [-1, 1]) {
        add(gr, g.cyl(0.6, 0.8, 8, 4), hi, 12, 28, s * 3);
        add(gr, g.sph(1.5, 6, 5), K.lit(C.glow), 12, 32, s * 3, { shadow: false });
      }
      const claws = pivot(gr, 13, 18, 0);
      for (const s of [-1, 1]) {
        add(claws, g.cyl(2, 1.6, 10, 5), hi, 3, 0, s * 9, { rz: -PI / 2 + 0.3 });
        add(claws, g.sph(5, 8, 6), dark, 10, 1, s * 10, { sx: 1.5 });
        add(claws, g.cone(2.2, 8, 4), hi, 17, 3, s * 9, { rz: -PI / 2 });
        add(claws, g.cone(1.6, 6, 4), hi, 16, -1, s * 11, { rz: -PI / 2 - 0.4 });
      }
      const legs = K.legs4(gr, 7, 18, 11, (p, sx, sz) => {
        add(p, g.cyl(1.7, 1.3, 14, 5), hi, 0, -4, sz * 5, { rx: sz * 1.0 });
        add(p, g.cyl(1.2, 0.8, 12, 5), hi, 0, -12, sz * 10, { rx: sz * 0.2 });
      });
      gr.scale.setScalar(1.15);
      gr.userData = { tunic: shellM, arm: pivot(gr), l1: pivot(gr), l2: pivot(gr), ranged: false, aura: null, phase: Math.random() * 10,
        tick(u, e, time) { K.gait(legs, e, time, u.phase, 22, 0.45); claws.rotation.z = K.ease.bump(e.swing || 0) * 0.5; } };
      return K.shadowed(gr);
    },
    // Strider rider: a crab-folk lancer on a long-legged lobster steed with a fanned tail.
    mounted(team) {
      const gr = new THREE.Group();
      const shellM = K.mat(C.shell, { metalness: 0.3, roughness: 0.45 }), steed = K.m(0xb8503a), hi = K.m(0xe07a5a), teamM = K.m(K.teamHex(team));
      add(gr, g.sph(12, 10, 8), steed, 0, 36, 0, { sx: 1.9, sy: 0.75, sz: 0.85 });
      for (let i = 0; i < 3; i++) add(gr, g.sph(7 - i, 8, 6), hi, -24 - i * 8, 34 - i * 2, 0, { sx: 1.2, sy: 0.6 });
      add(gr, g.cone(8, 9, 5), steed, -50, 31, 0, { rz: PI / 2, sz: 0.35 });
      add(gr, g.sph(6, 8, 6), steed, 24, 38, 0);
      for (const s of [-1, 1]) {
        add(gr, g.cyl(0.5, 0.6, 32, 4), hi, 34, 50, s * 4, { rz: -1.0, rx: s * 0.2 });
        add(gr, g.sph(1.4, 6, 5), K.lit(C.glow), 28, 43, s * 3, { shadow: false });
      }
      add(gr, g.box(18, 4, 22), teamM, -2, 45, 0);
      const legs = K.legs4(gr, 14, 32, 8, (p, sx, sz) => {
        add(p, g.cyl(2.2, 1.8, 18, 5), hi, 0, -6, sz * 4, { rx: sz * 0.6 });
        add(p, g.cyl(1.6, 1.0, 20, 5), hi, 0, -22, sz * 7, { rx: -sz * 0.1 });
      });
      // Rider.
      add(gr, g.sph(9, 10, 8), shellM, -2, 58, 0, { sx: 0.85, sy: 1.15 });
      add(gr, g.torus(8.5, 1.1, 4, 14, PI), teamM, -3, 60, 0, { ry: PI / 2, rx: 0.3 });
      add(gr, g.sph(4.5, 8, 6), shellM, 3, 70, 0, { sx: 1.1 });
      for (const s of [-1, 1]) {
        add(gr, g.cyl(0.6, 0.8, 6, 4), hi, 4, 75, s * 2.4, { rx: s * 0.3 });
        add(gr, g.sph(1.3, 6, 5), K.lit(C.glow), 4, 79, s * 3.2, { shadow: false });
        add(gr, g.cyl(1.4, 1.2, 14, 5), K.m(C.shellHi), 0, 46, s * 11, { rx: s * 0.6 });
      }
      const lance = pivot(gr, -2, 62, 10);
      add(lance, g.cyl(1.1, 1.6, 82, 6), K.m(0x6b4a2a), 0, 27, 0);
      add(lance, g.cone(2.8, 12, 4), K.metal(0xc8ccd2, 0.25), 0, 74, 0);
      for (const s of [-1, 1]) add(lance, g.cone(0.9, 6, 4), K.metal(0xc8ccd2, 0.25), s * 2.4, 67, 0, { rz: s * 2.6 });
      lance.rotation.z = -1.3;
      gr.userData = { tunic: shellM, arm: pivot(gr), l1: pivot(gr), l2: pivot(gr), ranged: false, aura: null, phase: Math.random() * 10,
        tick(u, e, time) { K.gait(legs, e, time, u.phase, 18, 0.6); lance.position.x = -2 + K.ease.bump(e.swing || 0) * 12; } };
      return K.shadowed(gr);
    },
    // Leviathan: a colossal hermit crab hauling a coral-grown spiral shell with a brine mortar on top
    // and spine launchers on each side.
    warMachine(team) {
      const gr = new THREE.Group();
      const shellM = K.mat(0xc8845a, { roughness: 0.6 }), dark = K.m(C.shellDark), hi = K.m(C.shellHi), teamM = K.m(K.teamHex(team));
      add(gr, g.sph(34, 14, 10), shellM, -12, 54, 0, { sx: 1.25, sy: 0.9, sz: 0.95 });
      for (let i = 0; i < 4; i++) add(gr, g.torus(30 - i * 6, 4.5, 6, 16), K.m(i % 2 ? 0xe8c8a0 : 0x9a5a3a), -20 + i * 2, 50 + i * 9, 0, { rx: PI / 2 });
      for (const [x, z, c, s] of [[-40, -18, C.coral, 1], [-34, 22, C.coralC, 2], [-2, -26, C.coralB, 3]]) coral(gr, x, z, 30, c, s).position.y = 62;
      for (const s of [-1, 1]) add(gr, g.box(40, 22, 2), teamM, -14, 42, s * 32);
      add(gr, g.sph(16, 10, 8), dark, 30, 30, 0, { sx: 1.3 });
      for (const s of [-1, 1]) {
        add(gr, g.cyl(1, 1.2, 14, 4), hi, 40, 46, s * 5, { rx: s * 0.3 });
        add(gr, g.sph(2.4, 6, 5), K.lit(C.glow), 40, 53, s * 6.5, { shadow: false });
        add(gr, g.sph(10, 8, 6), dark, 48, 20, s * 20, { sx: 1.6 });
        add(gr, g.cone(4, 14, 5), hi, 62, 22, s * 19, { rz: -PI / 2 });
      }
      const legs = K.legs4(gr, 26, 28, 24, (p, sx, sz) => {
        add(p, g.cyl(3.6, 2.8, 22, 6), hi, 0, -6, sz * 6, { rx: sz * 0.8 });
        add(p, g.cyl(2.6, 1.6, 20, 6), hi, 0, -20, sz * 13, { rx: sz * 0.15 });
      });
      const turret = pivot(gr, -12, 92, 0);
      add(turret, g.cyl(14, 16, 8, 10), dark, 0, 4, 0);
      const barrel = pivot(turret, 0, 10, 0);
      add(barrel, g.cyl(9, 11, 30, 10), K.m(C.coral), 8, 8, 0, { rz: -0.9 });
      add(barrel, g.sph(7, 10, 8), water(), 18, 17, 0);
      barrel.add(K.glow(C.glow, 40, 0.7)); barrel.children[barrel.children.length - 1].position.set(18, 17, 0);
      for (const s of [-1, 1]) urchin(gr, 12, 56, s * 26, 5);
      gr.userData = { tunic: shellM, arm: pivot(gr), l1: pivot(gr), l2: pivot(gr), ranged: true, aura: null, phase: Math.random() * 10,
        tick(u, e, time) {
          K.gait(legs, e, time, u.phase, 9, 0.35);
          turret.rotation.y = -((e.aim ?? e.facing ?? 0) - (e.facing ?? 0));
          barrel.position.x = -K.ease.bump(e.swing || 0) * 7;
        } };
      return K.shadowed(gr);
    }
  };

  function shot(s) {
    const gr = new THREE.Group();
    if (s.shot === 'arrow') {   // urchin spine
      add(gr, g.cone(1.4, 30, 4), K.m(0x5a3a6a), 0, 0, 0, { rz: -PI / 2, shadow: false });
    } else if (s.shot === 'bolt') {   // water spear
      add(gr, g.cone(3, 50, 6), K.m(0x9ff0e8, { transparent: true, opacity: 0.8, emissive: 0x206060 }), 0, 0, 0, { rz: -PI / 2, shadow: false });
      gr.add(K.glow(C.glow, 60, 0.8));
    } else if (s.shot === 'boulder') {   // brine globe
      add(gr, g.sph(18, 14, 10), water(), 0, 0, 0);
      add(gr, g.sph(7, 8, 6), pearlM(), 0, 0, 0, { shadow: false });
      gr.add(K.glow(C.glow, 70, 0.6));
    } else if (s.shot === 'orb') {   // tide orb
      add(gr, g.sph(5, 10, 8), water(), 0, 0, 0, { shadow: false });
      gr.add(K.glow(C.glow, 46, 0.95));
    } else if (s.shot === 'shell') {   // small brine globe with a pearl core
      add(gr, g.sph(10, 12, 8), water(), 0, 0, 0);
      add(gr, g.sph(4, 8, 6), pearlM(), 0, 0, 0, { shadow: false });
      gr.add(K.glow(C.glow, 40, 0.6));
    } else {   // ink bomb
      add(gr, g.sph(7, 10, 8), K.m(C.ink, { emissive: 0x2a0a4a }), 0, 0, 0, { sx: 1.3, shadow: false });
      gr.add(K.glow(0x9a4aff, 40, 0.9));
    }
    return gr;
  }

  R.RACE_MODELS.lurker = { buildings: B, unit, shot };
})(window.Game);
