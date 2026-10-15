// Algox race models: towering snow-folk. Hide, mammoth bone and tusk, carved snow and living blue ice.
// Buildings face +x toward the base center; units face +x with the weapon arm on +z (see render3d.js).
(function (G) {
  const R = G.render3d, K = G.kit, g = K.g, add = K.add, pivot = K.pivot, PI = Math.PI;

  const C = {
    hide: 0x8a6a4a, hideLight: 0xb89a72, hideDark: 0x5a4430, bone: 0xe0d8c0, tusk: 0xf0e8d0,
    snow: 0xe8eef4, ice: 0xa8e0f8, iceDeep: 0x5aa8d8, stone: 0x4a4e56, wood: 0x3a2a1e, fur: 0xd8dce0, furDark: 0x9aa0a8
  };
  const iceMat = () => K.m(C.ice, { transparent: true, opacity: 0.82, metalness: 0.2, roughness: 0.15, emissive: 0x16384a });
  const glowIce = () => K.lit(0xbfefff);

  // ---------------------------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------------------------
  function tusk(parent, x, y, z, len, curl, ry) {
    const t = pivot(parent, x, y, z);
    t.rotation.y = ry || 0;
    add(t, new THREE.TorusGeometry(len, len * 0.09, 5, 10, PI * 0.55), K.m(C.tusk), 0, 0, 0, { rz: curl });
    return t;
  }
  function mammothSkull(parent, x, y, z, s, ry = 0) {
    const sk = pivot(parent, x, y, z);
    sk.rotation.y = ry;
    sk.scale.setScalar(s);
    add(sk, g.sph(14, 10, 8), K.m(C.bone), 0, 0, 0, { sx: 0.9, sy: 1.1 });
    add(sk, g.box(10, 14, 16), K.m(C.bone), 8, -8, 0);
    for (const z of [-5, 5]) add(sk, g.sph(3.4, 6, 5), K.m(0x1a1612), 10, 3, z, { shadow: false });
    for (const sd of [-1, 1]) add(sk, new THREE.TorusGeometry(22, 2.6, 5, 12, PI * 0.7), K.m(C.tusk), 14, -14, sd * 9, { rz: PI * 1.1 });
    add(sk, g.cyl(3, 4, 18, 6), K.m(C.bone), 16, -18, 0, { rz: 0.2 });
    return sk;
  }
  function iceShard(parent, x, y, z, h, w, rz = 0, rx = 0) {
    return add(parent, g.cone(w, h, 5), iceMat(), x, y + h / 2, z, { rz, rx });
  }
  function hideBanner(parent, team, x, y, z, h = 60) {
    add(parent, g.cyl(2, 2.4, h, 6), K.m(C.wood), x, h / 2, z);
    add(parent, g.box(2, 34, 26), K.m(K.teamHex(team)), x + 1, h - 22, z + 14);
    add(parent, g.box(2.4, 3, 30), K.m(C.bone), x + 1, h - 4, z + 14);
    add(parent, g.sph(4, 7, 6), K.m(C.bone), x, h + 3, z);
    for (const dz of [4, 14, 24]) add(parent, g.cone(1.5, 8, 4), K.m(C.hideLight), x + 1, h - 42, z + dz, { rx: PI });
  }
  function brazier(parent, x, z, blue = true) {
    add(parent, g.cyl(10, 7, 14, 7), K.m(C.stone), x, 7, z);
    add(parent, g.cyl(9, 9, 2, 7), K.lit(blue ? 0x9fdcff : 0xff7a2a), x, 14.5, z, { shadow: false });
    return K.addGlow(parent, blue ? 0x9fdcff : 0xff8a30, 48, x, 26, z, 0.9);
  }
  function snowMound(parent, x, z, r, h) { return add(parent, g.dome(r, 14, 6), K.m(C.snow), x, 0, z, { sy: h / r }); }

  // ---------------------------------------------------------------------------------------------
  // Buildings
  // ---------------------------------------------------------------------------------------------
  const B = {};

  // Hide Yurt: a hide dome stretched over arched mammoth ribs, smoke-hole glow, a door flap.
  B.hut = (slot, base, team) => {
    const gr = new THREE.Group();
    snowMound(gr, 0, 0, 80, 10);
    add(gr, g.dome(62, 16, 8), K.m(C.hide), 0, 6, 0, { sy: 1.1 });
    add(gr, g.dome(40, 12, 6), K.m(C.hideLight), 0, 50, 0, { sy: 0.5 });
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * PI * 2;
      add(gr, new THREE.TorusGeometry(56, 3, 5, 12, PI * 0.42), K.m(C.bone), Math.cos(a) * 8, 8, Math.sin(a) * 8, { ry: -a, rz: PI * 0.08 });
    }
    add(gr, g.cyl(10, 12, 8, 8), K.m(C.hideDark), 0, 72, 0);
    K.addGlow(gr, 0xff9a40, 60, 0, 82, 0, 0.6);
    add(gr, g.box(4, 40, 30), K.m(C.hideDark), 61, 22, 0, { rz: -0.15 });
    tusk(gr, 62, 50, 22, 26, PI * 0.7, 0); tusk(gr, 62, 50, -22, 26, PI * 0.7, PI);
    K.addGlow(gr, 0xff8a30, 50, 66, 20, 0, 0.5);
    hideBanner(gr, team, -40, 0, -50, 90);
    return K.placeInSlot(gr, slot, base);
  };

  // Snow Burrow: a snow mound ringed with ice blocks, javelins planted around, hunters peeking out.
  B.digin = (slot, base, team) => {
    const gr = new THREE.Group();
    snowMound(gr, 0, 0, 74, 34);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * PI * 2;
      add(gr, g.box(22, 18 + (i % 3) * 4, 14), iceMat(), Math.cos(a) * 66, 10, Math.sin(a) * 66, { ry: -a });
    }
    for (let i = 0; i < 10; i++) {
      const a = -1.2 + i * 0.27;
      add(gr, g.cyl(1.4, 1.4, 50, 4), K.m(C.wood), Math.cos(a) * 78, 22, Math.sin(a) * 78, { rz: -0.3 + Math.sin(i) * 0.15 });
      add(gr, g.cone(3, 10, 4), glowIce(), Math.cos(a) * 78 + 7, 48, Math.sin(a) * 78, { rz: -0.3, shadow: false });
    }
    add(gr, g.cyl(26, 30, 8, 10), K.m(0x1a1612), 30, 30, 0, { rz: 0.5 });
    for (const z of [-24, 24]) unitHead(gr, team, 20, 32, z);
    hideBanner(gr, team, -40, 20, 0, 70);
    return K.placeInSlot(gr, slot, base);
  };
  function unitHead(parent, team, x, y, z) {
    add(parent, g.sph(10, 8, 6), K.m(C.fur), x, y + 8, z);
    add(parent, g.box(6, 6, 9), K.m(C.furDark), x + 8, y + 5, z);
    for (const s of [-1, 1]) add(parent, g.cone(1.5, 9, 4), K.m(C.tusk), x + 11, y + 8, z + s * 3, { rz: -2.4 });
    add(parent, g.box(2, 2, 10), K.m(K.teamHex(team)), x + 7, y + 13, z);
  }

  // Icicle Spire: a tall tower of stacked ice crystals in a bone scaffold, an ice ballista turret on top.
  B.support = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(48, 56, 10, 8), K.m(C.stone), 0, 5, 0);
    for (let i = 0; i < 5; i++) add(gr, g.oct(34 - i * 4), iceMat(), 0, 40 + i * 44, 0, { sy: 1.6, ry: i * 0.4 });
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * PI * 2 + PI / 4;
      add(gr, g.cyl(3, 4, 230, 5), K.m(C.bone), Math.cos(a) * 34, 115, Math.sin(a) * 34, { rz: Math.cos(a) * -0.08, rx: Math.sin(a) * 0.08 });
    }
    for (const y of [70, 150]) add(gr, g.torus(36 - y * 0.05, 2, 4, 16), K.m(C.hideDark), 0, y, 0, { rx: PI / 2 });
    add(gr, g.cyl(30, 26, 10, 8), K.m(C.bone), 0, 240, 0);
    const turret = pivot(gr, 0, 252, 0);
    add(turret, g.box(16, 10, 16), K.m(C.hideDark), 0, 0, 0);
    add(turret, g.cyl(2.5, 2.5, 56, 5), K.m(C.bone), 26, 4, 0, { rz: PI / 2 });
    add(turret, new THREE.TorusGeometry(24, 2, 4, 12, PI), K.m(C.tusk), 40, 4, 0, { rx: PI / 2, rz: -PI / 2 });
    add(turret, g.cone(4, 18, 5), glowIce(), 58, 4, 0, { rz: -PI / 2, shadow: false });
    K.addGlow(turret, 0x9fdcff, 40, 58, 4, 0, 0.8);
    const crystal = pivot(gr, 0, 290, 0);
    add(crystal, g.oct(14), glowIce(), 0, 0, 0, { sy: 2, shadow: false });
    K.addGlow(crystal, 0x9fdcff, 110, 0, 0, 0, 0.6);
    gr.add(...K.teamFlag(team, -40, 250, 0));
    gr.userData = { turret, tick(b, time) { crystal.rotation.y = time; crystal.position.y = 290 + Math.sin(time * 2) * 5; } };
    return K.placeInSlot(gr, slot, base);
  };

  // Glacier Hurler: a catapult of mammoth bone and sinew that throws a boulder of glacier ice.
  B.siege = (slot, base, team) => {
    const gr = new THREE.Group();
    snowMound(gr, 0, 0, 84, 8);
    const turret = pivot(gr, 0, 0, 0);
    const bone = K.m(C.bone);
    mammothSkull(turret, -40, 24, 0, 1.1, PI);
    for (const z of [-28, 28]) {
      add(turret, g.box(120, 10, 10), K.m(C.hideDark), 0, 16, z);
      add(turret, new THREE.TorusGeometry(40, 3.5, 5, 12, PI * 0.9), K.m(C.tusk), 5, 16, z, { rz: PI * 0.05 });
      for (const x of [-40, 40]) add(turret, g.cyl(15, 15, 7, 8), K.m(C.stone), x, 15, z + Math.sign(z) * 8, { rx: PI / 2 });
    }
    add(turret, g.cyl(4, 4, 64, 6), bone, 5, 78, 0, { rx: PI / 2 });
    add(turret, g.ico(16, 0), K.m(C.stone), 26, 50, 0);
    const arm = pivot(turret, 5, 78, 0);
    add(arm, g.box(110, 7, 7), bone, -45, 0, 0);
    add(arm, g.cyl(12, 7, 8, 8), K.m(C.hideDark), -98, 6, 0);
    const rock = add(arm, g.ico(10, 0), iceMat(), -98, 16, 0);
    gr.add(...K.teamFlag(team, -60, 75, -60));
    gr.userData = { turret, arm, rock };
    return K.placeInSlot(gr, slot, base);
  };

  // Blizzard Totem: a totem pole of carved beast skulls crowned with ice, whirling snow around it.
  B.storm = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(44, 50, 10, 8), K.m(C.stone), 0, 5, 0);
    add(gr, g.cyl(12, 15, 200, 8), K.m(C.wood), 0, 110, 0);
    for (let i = 0; i < 4; i++) {
      const y = 50 + i * 40;
      add(gr, g.sph(16, 8, 6), K.m(i % 2 ? C.bone : C.hideLight), 10, y, 0, { sx: 0.9 });
      for (const z of [-5, 5]) add(gr, g.sph(3, 6, 5), K.lit(0x9fdcff), 23, y + 3, z, { shadow: false });
      add(gr, g.box(4, 3, 26), K.m(K.teamHex(team)), 14, y - 12, 0);
      if (i % 2) for (const s of [-1, 1]) add(gr, g.cone(3, 20, 5), K.m(C.tusk), 0, y + 10, s * 18, { rx: s * 1.2 });
    }
    for (let i = 0; i < 5; i++) iceShard(gr, Math.cos(i * 1.26) * 8, 214, Math.sin(i * 1.26) * 8, 40 - i * 4, 7, Math.cos(i * 1.26) * 0.3, Math.sin(i * 1.26) * 0.3);
    const halo = K.addGlow(gr, 0xdff4ff, 160, 0, 236, 0, 0.6);
    const flakes = [];
    for (let i = 0; i < 14; i++) { const s = K.glow(0xffffff, 14, 0.9); gr.add(s); flakes.push(s); }
    gr.add(...K.teamFlag(team, -40, 230, 0));
    gr.userData = {
      tick(b, time) {
        halo.material.opacity = 0.5 + Math.sin(time * 2) * 0.15;
        flakes.forEach((s, i) => { const a = time * 2 + i * 0.45, r = 40 + (i % 4) * 14; s.position.set(Math.cos(a) * r, 60 + ((time * 40 + i * 30) % 180), Math.sin(a) * r); });
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Barracks: four distinct clan buildings.
  function longhouse(gr, team, len = 170) {
    add(gr, g.box(120, 12, len + 10), K.m(C.stone), 0, 6, 0);
    add(gr, g.box(108, 46, len), K.m(C.wood), 0, 35, 0);
    const roof = add(gr, g.cyl(74, 74, len + 14, 3), K.m(C.hide), 0, 92, 0, { rx: -PI / 2 });
    add(gr, g.cyl(42, 42, len + 4, 3), K.m(C.snow), 0, 126, 0, { rx: -PI / 2 });
    for (let i = 0; i < 5; i++) add(gr, new THREE.TorusGeometry(56, 3, 4, 10, PI * 0.6), K.m(C.bone), 0, 70, -len / 2 + 10 + i * (len - 20) / 4, { rz: PI * 0.2 });
    return roof;
  }
  B.barracks = (slot, base, team) => {
    const gr = new THREE.Group();
    longhouse(gr, team);
    add(gr, g.box(4, 46, 40), K.m(0x1a1210), 56, 30, 0);
    tusk(gr, 58, 70, 26, 34, PI * 0.72, 0); tusk(gr, 58, 70, -26, 34, PI * 0.72, PI);
    mammothSkull(gr, 60, 100, 0, 0.8);
    for (let i = 0; i < 3; i++) add(gr, g.cyl(2, 4, 30, 6), K.m(C.bone), 70, 15, -40 + i * 40, { rz: 0.3 });   // bone clubs leaning
    K.addGlow(gr, 0xff8a30, 70, 64, 30, 0, 0.5);
    hideBanner(gr, team, -40, 0, 95, 120);
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksArmored = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.box(130, 14, 170), K.m(C.stone), 0, 7, 0);
    add(gr, g.box(110, 70, 150), K.m(0x5a5e66), 0, 49, 0);
    for (let i = 0; i < 6; i++) add(gr, g.box(18, 76, 18), K.m(C.stone), (i % 2 ? 1 : -1) * 50, 52, -60 + Math.floor(i / 2) * 60);
    add(gr, g.box(120, 10, 160), K.m(C.snow), 0, 88, 0);
    add(gr, g.cyl(16, 20, 70, 8), K.m(C.stone), -30, 120, 40);
    K.addGlow(gr, 0x7fd8ff, 70, -30, 160, 40, 0.8);
    mammothSkull(gr, 62, 70, 0, 1.3);
    add(gr, g.box(4, 44, 50), K.lit(0x2a5a7a), 56, 26, 0, { shadow: false });
    K.addGlow(gr, 0x7fd8ff, 90, 60, 26, 0, 0.7);
    for (const z of [-50, 50]) { add(gr, g.cyl(8, 10, 26, 6), K.m(C.bone), 70, 13, z); add(gr, g.sph(9, 8, 6), K.m(C.bone), 70, 32, z); }
    hideBanner(gr, team, -40, 0, -95, 130);
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksShort = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.dodec(70), K.m(C.stone), -10, 30, 0, { sy: 0.7, sz: 1.2 });
    snowMound(gr, -10, 0, 90, 70);
    add(gr, g.cyl(28, 34, 10, 10), K.m(0x120e0c), 40, 30, 0, { rz: PI / 2 - 0.3 });
    K.addGlow(gr, 0xff8a30, 60, 46, 22, 0, 0.6);
    for (const z of [-60, 60]) {
      add(gr, g.box(8, 40, 50), K.m(C.wood), 55, 20, z);
      for (let i = 0; i < 6; i++) add(gr, g.cyl(1.2, 1.2, 56, 4), K.m(C.wood), 58, 34, z - 20 + i * 8, { rz: 0.15 });
      for (let i = 0; i < 6; i++) add(gr, g.cone(2.6, 9, 4), glowIce(), 62, 62, z - 20 + i * 8, { shadow: false });
    }
    for (let i = 0; i < 4; i++) add(gr, g.box(2, 34, 26), K.m(i % 2 ? C.fur : C.hideLight), -30 + i * 20, 60, 82, { rz: 0.1 });
    add(gr, g.cyl(1, 1, 90, 4), K.m(C.wood), 0, 78, 82, { rz: PI / 2 });
    hideBanner(gr, team, -60, 40, -60, 90);
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksLong = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(80, 86, 8, 12), K.m(C.stone), 0, 4, 0);
    for (const [x, z, h] of [[-20, -40, 150], [-20, 40, 130], [30, 0, 110]]) {
      add(gr, g.cone(42, h, 10), K.m(C.hide), x, h / 2 + 6, z);
      for (let i = 0; i < 5; i++) add(gr, g.cyl(1.2, 1.2, 30, 4), K.m(C.wood), x + Math.cos(i * 1.26) * 4, h + 14, z + Math.sin(i * 1.26) * 4, { rz: Math.cos(i * 1.26) * 0.4, rx: Math.sin(i * 1.26) * 0.4 });
      add(gr, g.box(3, 4, 30), K.m(K.teamHex(team)), x + 14, h * 0.5, z, { rz: -0.3 });
    }
    for (const z of [-60, 60]) {
      add(gr, new THREE.TorusGeometry(24, 2, 4, 12, PI), K.m(C.bone), 70, 40, z, { rz: -PI / 2 });
      add(gr, g.cyl(0.6, 0.6, 48, 3), K.m(0xe8e0c0), 70, 40, z, { shadow: false });
    }
    add(gr, g.cyl(14, 14, 6, 10), K.m(C.hideLight), 80, 30, 0, { rz: PI / 2 });
    add(gr, g.cyl(5, 5, 6.5, 10), K.lit(0x7fd8ff), 80, 30, 0, { rz: PI / 2, shadow: false });
    hideBanner(gr, team, -70, 0, 0, 110);
    return K.placeInSlot(gr, slot, base);
  };

  // Allies
  B.allyEngineer = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.dome(48, 14, 7), iceMat(), -10, 0, 0, { sy: 0.85 });
    for (let i = 0; i < 4; i++) add(gr, g.torus(47 - i * 9, 1.4, 4, 18, PI), K.m(0xcfefff), -10, 0, 0, { ry: i * PI / 4 });
    add(gr, g.cyl(16, 18, 26, 8), iceMat(), 32, 13, 0, { rz: PI / 2 });
    add(gr, g.cyl(11, 11, 4, 8), K.m(0x0a1a24), 46, 13, 0, { rz: PI / 2 });
    // An ice sculpture of a mammoth mid-carving, chisels and a block.
    const sculpt = pivot(gr, 30, 0, -40);
    add(sculpt, g.box(22, 24, 22), iceMat(), 0, 12, 0);
    add(sculpt, g.ico(14, 0), iceMat(), 0, 34, 0, { sx: 1.3 });
    add(sculpt, g.cone(2, 14, 4), glowIce(), 12, 32, 6, { rz: 2.2, shadow: false });
    add(gr, g.cyl(1.2, 1.2, 26, 4), K.m(C.wood), 40, 8, 40, { rz: 1.3 });
    add(gr, g.box(6, 3, 3), K.metal(0x8a9098), 52, 11, 40);
    K.addGlow(gr, 0x9fdcff, 70, -10, 20, 0, 0.6);
    gr.add(...K.teamFlag(team, -40, 80, 30));
    return K.placeInSlot(gr, slot, base);
  };
  B.allyMedic = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cone(46, 90, 9), K.m(C.hideLight), -6, 45, 0);
    for (let i = 0; i < 6; i++) add(gr, g.cyl(1.4, 1.4, 34, 4), K.m(C.wood), -6 + Math.cos(i) * 5, 98, Math.sin(i) * 5, { rz: Math.cos(i) * 0.5, rx: Math.sin(i) * 0.5 });
    for (const s of [-1, 1]) {
      const ant = pivot(gr, 30, 46, s * 10);
      add(ant, g.cyl(1.5, 2, 30, 5), K.m(C.bone), 0, 14, s * 4, { rx: s * 0.4 });
      for (let i = 0; i < 3; i++) add(ant, g.cyl(1, 1.2, 12, 4), K.m(C.bone), 0, 12 + i * 7, s * (8 + i * 2), { rx: s * 1.1 });
    }
    // Cauldron of glowing healing broth.
    add(gr, g.sph(14, 10, 8), K.metal(0x2a2a2e), 40, 14, 0, { sy: 0.8 });
    add(gr, g.cyl(12, 12, 2, 10), K.lit(0x9fe3a0), 40, 22, 0, { shadow: false });
    const steam = K.addGlow(gr, 0x9fe3a0, 50, 40, 34, 0, 0.6);
    for (let i = 0; i < 5; i++) add(gr, g.box(1, 10, 8), K.m([0x9fdcff, 0x9fe3a0, 0xe8c060, K.teamHex(team), 0xffffff][i]), -40 + i * 12, 70 - i * 6, 40, { rz: 0.1 });
    add(gr, g.cyl(0.4, 0.4, 70, 3), K.m(0x2a2a2a), -16, 58, 40, { rz: 1.2, shadow: false });
    gr.add(...K.teamFlag(team, -30, 110, -20));
    gr.userData = { tick(b, time) { steam.position.y = 34 + Math.sin(time * 3) * 4; steam.material.opacity = 0.5 + Math.sin(time * 5) * 0.15; } };
    return K.placeInSlot(gr, slot, base);
  };
  B.allyOfficer = (slot, base, team) => {
    const gr = new THREE.Group();
    for (let i = 0; i < 3; i++) add(gr, g.cyl(56 - i * 12, 60 - i * 12, 10, 8), K.m(C.stone), 0, 5 + i * 10, 0, { ry: PI / 8 });
    // The bone throne: mammoth-rib back, tusk arms, pelts.
    const th = pivot(gr, -10, 30, 0);
    add(th, g.box(24, 14, 34), K.m(C.bone), 0, 7, 0);
    add(th, g.box(26, 4, 36), K.m(C.fur), 2, 15, 0);
    for (let i = 0; i < 5; i++) add(th, new THREE.TorusGeometry(26, 2.4, 4, 10, PI * 0.5), K.m(C.bone), -12, 14, -16 + i * 8, { rz: PI * 0.45 });
    for (const s of [-1, 1]) tusk(th, 4, 18, s * 18, 18, PI * 0.8, s < 0 ? PI : 0);
    mammothSkull(th, -16, 66, 0, 0.6);
    for (const z of [-44, 44]) brazier(gr, 30, z, false);
    hideBanner(gr, team, -40, 30, 40, 90); hideBanner(gr, team, -40, 30, -40, 90);
    return K.placeInSlot(gr, slot, base);
  };
  B.allyDemolitionist = (slot, base, team) => {
    const gr = new THREE.Group();
    for (let i = 0; i < 6; i++) add(gr, g.dodec(30 - i * 4), K.m(C.stone), Math.sin(i) * 6, 14 + i * 22, Math.cos(i) * 6, { ry: i });
    add(gr, g.dome(22, 10, 5), K.m(C.snow), 0, 140, 0, { sy: 0.5 });
    for (const [x, z, r] of [[40, 30, 16], [44, -24, 14], [30, -44, 12], [50, 4, 11]]) {
      add(gr, g.sph(r, 10, 8), K.m(C.snow), x, r, z);
      add(gr, g.sph(r * 0.4, 6, 5), K.lit(0x9fdcff), x + r * 0.7, r * 1.2, z, { shadow: false });
    }
    // A great war-horn on a bone stand.
    add(gr, g.cyl(2, 2, 40, 4), K.m(C.wood), -40, 20, 0);
    add(gr, new THREE.TorusGeometry(18, 4, 6, 12, PI * 0.8), K.m(C.tusk), -40, 46, 0, { rz: PI * 0.1 });
    add(gr, g.cone(7, 14, 8), K.m(C.tusk), -24, 54, 0, { rz: -PI / 2 });
    K.addGlow(gr, 0x9fdcff, 60, 40, 30, 0, 0.5);
    gr.add(...K.teamFlag(team, -10, 160, 0));
    return K.placeInSlot(gr, slot, base);
  };

  // Great Clan Hall: a vast longhall at the foot of a glacier, ringed by ice cliffs and totems,
  // a giant mammoth skull over the gate, blue-fire braziers and a crowning ice crystal.
  B.command = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(150, 162, 16, 10), K.m(C.stone), 0, 8, 0);
    add(gr, g.cyl(140, 146, 10, 10), K.m(C.snow), 0, 20, 0);
    // Glacier wall behind: towering translucent ice shards.
    for (let i = 0; i < 16; i++) {
      const a = PI * 0.55 + i / 15 * PI * 0.9;
      const h = 120 + Math.sin(i * 1.7) * 50 + (i % 3) * 30;
      iceShard(gr, Math.cos(a) * 130, 20, Math.sin(a) * 130, h, 26 + (i % 3) * 6, Math.cos(a) * -0.15, Math.sin(a) * 0.15);
    }
    // The hall.
    add(gr, g.box(150, 80, 120), K.m(C.wood), 0, 66, 0);
    // Gabled roof with its ridge running front to back (gable over the gate).
    const roofP = pivot(gr, 0, 0, 0); roofP.rotation.y = PI / 2;
    add(roofP, g.cyl(96, 96, 160, 3), K.m(C.hide), 0, 150, 0, { rx: -PI / 2 });
    add(roofP, g.cyl(58, 58, 150, 3), K.m(C.snow), 0, 190, 0, { rx: -PI / 2 });
    for (let i = 0; i < 6; i++) add(gr, new THREE.TorusGeometry(70, 4, 4, 12, PI * 0.6), K.m(C.bone), -60 + i * 24, 120, 0, { ry: PI / 2, rz: PI * 0.2 });
    for (let i = 0; i < 4; i++) add(gr, g.box(4, 22, 14), K.lit(0xffa040), -45 + i * 30, 70, 61, { shadow: false });
    // Gate with the great mammoth skull and crossed tusks.
    add(gr, g.box(20, 70, 70), K.m(C.wood), 80, 61, 0);
    add(gr, g.box(4, 54, 44), K.m(0x120c08), 91, 52, 0);
    mammothSkull(gr, 96, 128, 0, 2.2);
    for (const z of [-58, 58]) {
      tusk(gr, 100, 60, z, 50, PI * 0.72, z < 0 ? PI : 0);
      brazier(gr, 120, z * 1.4, true);
    }
    // Totems at the corners.
    for (const [x, z] of [[60, -110], [60, 110], [-90, -90], [-90, 90]]) {
      add(gr, g.cyl(8, 10, 150, 7), K.m(C.wood), x, 95, z);
      for (let i = 0; i < 3; i++) add(gr, g.sph(11, 8, 6), K.m(i % 2 ? C.bone : C.hideLight), x + 6, 70 + i * 34, z);
      add(gr, g.box(3, 40, 30), K.m(K.teamHex(team)), x + 10, 140, z);
    }
    // Crowning crystal.
    const crystal = pivot(gr, 0, 260, 0);
    add(crystal, g.oct(30), glowIce(), 0, 0, 0, { sy: 1.8, shadow: false });
    K.addGlow(crystal, 0x9fdcff, 240, 0, 0, 0, 0.6);
    const light = G.kit.light(0x9fdcff, 1.6, 900, 2); crystal.add(light);
    const flag = add(gr, g.plane(70, 40), K.mat(K.teamHex(team), { side: THREE.DoubleSide }), -40, 260, -10, { ry: PI / 2 });
    add(gr, g.cyl(2, 2, 120, 4), K.m(C.wood), -40, 220, -44);
    gr.position.set(slot.x, 0, slot.y);
    gr.rotation.y = team === G.TEAM.PLAYER ? 0 : PI;
    gr.userData = { tick(b, time) { crystal.rotation.y = time * 0.5; crystal.position.y = 270 + Math.sin(time * 1.4) * 8; } };
    return gr;
  };

  // ---------------------------------------------------------------------------------------------
  // Units: hulking, shaggy, tusked snow-folk. Soldier contract: tunic (flash material), arm, l1, l2.
  // ---------------------------------------------------------------------------------------------
  function unit(team, kind, ranged) {
    const gr = new THREE.Group();
    const furM = K.mat(C.fur), dark = K.m(C.furDark), teamM = K.m(K.teamHex(team)), bone = K.m(C.bone);
    // Short thick legs.
    const l1 = pivot(gr, 0, 16, 6), l2 = pivot(gr, 0, 16, -6);
    for (const l of [l1, l2]) { add(l, g.cyl(4.5, 4, 14, 6), dark, 0, -7, 0); add(l, g.box(9, 3, 7), K.m(C.hideDark), 2, -14.5, 0); }
    // Hunched shaggy body with a team-colored war-paint sash and loincloth.
    add(gr, g.ico(15, 1), furM, -1, 30, 0, { sx: 0.9, sy: 1.05, sz: 1.05 });
    add(gr, g.ico(10, 1), furM, -5, 42, 0);
    add(gr, g.box(1.5, 22, 4), teamM, 12, 30, 0, { rx: 0.7 });
    add(gr, g.box(12, 10, 2), teamM, 9, 15, 0);
    // Head thrust forward: small dark eyes, heavy brow, upcurved tusks.
    add(gr, g.sph(7.5, 8, 6), furM, 9, 44, 0);
    add(gr, g.box(6, 5, 8), dark, 15, 41, 0);
    for (const z of [-2.5, 2.5]) add(gr, g.sph(1, 5, 4), K.lit(0x9fdcff), 15, 46, z, { shadow: false });
    for (const s of [-1, 1]) add(gr, new THREE.TorusGeometry(5, 0.9, 4, 8, PI * 0.6), K.m(C.tusk), 17, 38, s * 3, { rz: PI * 0.55 });
    // Off arm hangs long.
    add(gr, g.cyl(3.4, 3, 22, 6), furM, 2, 26, -13, { rx: -0.15 });
    add(gr, g.sph(4, 6, 5), dark, 3, 15, -15);
    const arm = pivot(gr, 2, 36, 13);
    add(arm, g.cyl(3.4, 3, 12, 6), furM, 0, -4, 0);
    let aura = null;
    if (kind === 'infantry') {
      add(arm, g.cyl(2, 3.6, 28, 6), bone, 0, 14, 0);
      for (let i = 0; i < 3; i++) add(arm, g.cone(1.5, 6, 4), K.lit(0xbfefff), 2, 20 + i * 4, (i - 1) * 2, { rz: -PI / 2, shadow: false });
    } else if (kind === 'armored') {
      // Mammoth-bone plate and a skull helm; a great ice-bladed axe.
      add(gr, g.dome(13, 10, 5), bone, -1, 38, 0, { sx: 1.2 });
      for (const s of [-1, 1]) add(gr, g.dome(7, 8, 5), bone, 0, 41, s * 12, { rx: s * 0.6 });
      add(gr, g.sph(8.4, 8, 6), bone, 9, 46, 0, { sy: 0.7 });
      for (const s of [-1, 1]) add(gr, g.cone(2, 10, 5), K.m(C.tusk), 7, 54, s * 6, { rx: s * 0.5 });
      add(arm, g.cyl(1.6, 1.6, 36, 5), K.m(C.wood), 0, 14, 0);
      add(arm, g.cone(10, 14, 3), iceMat(), 5, 28, 0, { rz: -PI / 2, sz: 0.3 });
    } else if (kind === 'short') {
      add(arm, g.cyl(1.1, 1.1, 40, 4), K.m(C.wood), 0, 10, 0);
      add(arm, g.cone(2.4, 8, 4), K.lit(0xbfefff), 0, 32, 0, { shadow: false });
      for (let i = 0; i < 4; i++) add(gr, g.cyl(0.9, 0.9, 34, 4), K.m(C.wood), -12, 44, -4 + i * 2.6, { rz: 0.35 });
    } else if (kind === 'long') {
      const bow = add(gr, new THREE.TorusGeometry(18, 1.3, 4, 12, PI), bone, 14, 32, 0, { rz: -PI / 2 });
      add(gr, g.box(0.3, 36, 0.3), K.m(0xe8e0c0), 14, 32, 0, { shadow: false });
      add(gr, g.cone(1.6, 7, 4), K.lit(0xbfefff), 19, 32, 0, { rz: -PI / 2, shadow: false });
    } else if (kind === 'engineer') {
      add(gr, g.box(14, 14, 14), iceMat(), -14, 40, 0);   // an ice block hauled on the back
      add(arm, g.cyl(1.4, 1.4, 22, 5), K.m(C.wood), 0, 10, 0);
      add(arm, g.cone(2.5, 12, 4), K.metal(0x8a9098), 0, 24, 3, { rx: PI / 2 });
    } else if (kind === 'medic') {
      for (const s of [-1, 1]) add(gr, g.cyl(0.8, 1, 14, 4), bone, 6, 54, s * 5, { rx: s * 0.6 });
      add(arm, g.cyl(1.2, 1.2, 40, 5), K.m(C.wood), 0, 10, 0);
      add(arm, g.sph(4, 8, 6), K.lit(0x9fe3a0), 0, 32, 0, { shadow: false });
      arm.add(K.glow(0x9fe3a0, 26, 0.8)); arm.children[arm.children.length - 1].position.y = 32;
      for (let i = 0; i < 3; i++) add(arm, g.box(0.6, 8, 3), K.m(0xffffff), 1, 26, (i - 1) * 3, { shadow: false });
    } else if (kind === 'officer') {
      // War Chief: horned helm, a great fur cloak and a throwing axe.
      add(gr, g.cyl(8, 8, 4, 8), K.metal(0x8a9098), 9, 50, 0);
      for (const s of [-1, 1]) add(gr, new THREE.TorusGeometry(8, 1.6, 4, 10, PI * 0.7), K.m(C.tusk), 7, 54, s * 8, { rx: s * 0.4, rz: 0.3 });
      add(gr, g.box(3, 34, 30), teamM, -14, 30, 0, { rz: -0.15 });
      add(gr, new THREE.TorusGeometry(7, 2, 4, 10, PI * 0.9), K.m(C.tusk), -10, 44, -12, { rz: 0.6 });
      add(arm, g.cyl(1.1, 1.1, 18, 4), K.m(C.wood), 0, 8, 0);
      add(arm, g.box(1.5, 8, 9), K.metal(0xb8bcc2), 0, 16, 3);
      aura = K.aura(1.5, 0x9fdcff); gr.add(aura);
    } else if (kind === 'demolitionist') {
      add(gr, g.sph(11, 10, 8), K.m(C.snow), -4, 56, 6);
      add(gr, g.sph(4, 6, 5), K.lit(0x9fdcff), 4, 60, 9, { shadow: false });
      gr.add(K.glow(0x9fdcff, 30, 0.8)); gr.children[gr.children.length - 1].position.set(4, 60, 9);
    }
    if (G.SQUAD_KINDS[kind].ally) gr.scale.setScalar(1.45);
    else if (kind === 'armored') gr.scale.setScalar(1.35);
    else gr.scale.setScalar(1.12);
    gr.userData = { tunic: furM, arm, l1, l2, ranged, aura, phase: Math.random() * 10 };
    return K.shadowed(gr);
  }

  // ---------------------------------------------------------------------------------------------
  // Shots (+x = flight direction)
  // ---------------------------------------------------------------------------------------------
  function shot(s) {
    const gr = new THREE.Group();
    if (s.shot === 'arrow') {   // ice javelin
      add(gr, g.cyl(1.2, 1.2, 34, 4), K.m(C.wood), 0, 0, 0, { rz: PI / 2, shadow: false });
      add(gr, g.cone(2.6, 12, 4), K.lit(0xbfefff), 21, 0, 0, { rz: -PI / 2, shadow: false });
    } else if (s.shot === 'bolt') {   // great icicle
      add(gr, g.cone(5, 52, 6), iceMat(), 0, 0, 0, { rz: -PI / 2, shadow: false });
      gr.add(K.glow(0x9fdcff, 50, 0.7));
    } else if (s.shot === 'boulder') {   // glacier boulder
      add(gr, g.ico(20, 0), iceMat(), 0, 0, 0);
      add(gr, g.dome(14, 8, 4), K.m(C.snow), 0, 8, 0);
      gr.add(K.glow(0x9fdcff, 60, 0.4));
    } else {   // avalanche bomb: a packed snowball with a glowing frost core
      add(gr, g.sph(9, 10, 8), K.m(C.snow), 0, 0, 0, { shadow: false });
      gr.add(K.glow(0x9fdcff, 40, 0.9));
    }
    return gr;
  }

  R.RACE_MODELS.algox = { buildings: B, unit, shot };
})(window.Game);
