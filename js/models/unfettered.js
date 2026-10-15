// Unfettered race models: self-made automatons. Brass, riveted steel, pipes, gears and arc-light cores.
// Buildings face +x toward the base center; units face +x with the weapon arm on +z (see render3d.js).
(function (G) {
  const R = G.render3d, K = G.kit, g = K.g, add = K.add, pivot = K.pivot, PI = Math.PI;

  const C = { brass: 0xc89a40, copper: 0xb06a3a, steel: 0x7a8088, dark: 0x2a2e34, plate: 0x4a5058, glow: 0x7fe8ff, warn: 0xe0b020 };
  const brass = () => K.metal(C.brass, 0.3), copper = () => K.metal(C.copper, 0.35), steel = () => K.metal(C.steel, 0.4);
  const darkM = () => K.metal(C.dark, 0.5), plate = () => K.metal(C.plate, 0.45), core = () => K.lit(C.glow);

  // ---------------------------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------------------------
  function gear(parent, x, y, z, r, teeth = 10, mat = brass()) {
    const gr = pivot(parent, x, y, z);
    add(gr, g.cyl(r, r, r * 0.3, 16), mat, 0, 0, 0, { rx: PI / 2 });
    add(gr, g.cyl(r * 0.35, r * 0.35, r * 0.36, 10), darkM(), 0, 0, 0, { rx: PI / 2 });
    for (let i = 0; i < teeth; i++) {
      const a = i / teeth * PI * 2;
      add(gr, g.box(r * 0.28, r * 0.28, r * 0.3), mat, Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08, 0, { rz: a });
    }
    return gr;
  }
  function pipe(parent, x1, y1, z1, x2, y2, z2, r = 3, mat = copper()) {
    const m = new THREE.Mesh(g.cyl(r, r, 1, 8), mat);
    const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.y = a.distanceTo(b);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true; parent.add(m);
    return m;
  }
  // A hazard-striped team panel.
  function panel(parent, team, x, y, z, w, h, ry = 0) {
    const p = pivot(parent, x, y, z); p.rotation.y = ry;
    add(p, g.box(2, h, w), K.m(K.teamHex(team)), 0, 0, 0);
    for (let i = 0; i < 3; i++) add(p, g.box(2.4, h * 0.14, w * 0.9), K.m(C.warn), 0.2, -h / 2 + h * 0.15 + i * h * 0.35, 0);
    return p;
  }
  function stack(parent, x, z, h, r) {
    add(parent, g.cyl(r, r * 1.15, h, 10), darkM(), x, h / 2, z);
    add(parent, g.cyl(r * 1.25, r * 1.25, 5, 10), brass(), x, h, z);
    return K.addGlow(parent, 0x8a8a8a, r * 4, x, h + 14, z, 0.35);
  }
  function lamp(parent, x, y, z, color = C.glow, size = 30) {
    add(parent, g.sph(3, 8, 6), K.lit(color), x, y, z, { shadow: false });
    return K.addGlow(parent, color, size, x, y, z, 0.8);
  }
  function antenna(parent, team, x, y, z, h = 60) {
    add(parent, g.cyl(1.5, 2, h, 6), steel(), x, y + h / 2, z);
    for (let i = 1; i <= 3; i++) add(parent, g.box(14 - i * 3, 1.2, 1.2), steel(), x, y + h * i / 4, z);
    return lamp(parent, x, y + h + 3, z, K.teamGlow(team), 26);
  }

  const B = {};

  // Power Cell: a giant battery with glowing charge bands, cabled to the ground.
  B.hut = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(66, 72, 10, 12), plate(), 0, 5, 0);
    add(gr, g.cyl(42, 42, 110, 16), darkM(), 0, 65, 0);
    const bands = [];
    for (let i = 0; i < 4; i++) bands.push(add(gr, g.cyl(43, 43, 8, 16), core(), 0, 26 + i * 24, 0, { shadow: false }));
    add(gr, g.cyl(44, 44, 8, 16), brass(), 0, 124, 0);
    add(gr, g.cyl(14, 14, 14, 10), brass(), 0, 134, 0);
    add(gr, g.cyl(8, 8, 6, 10), K.lit(K.teamGlow(team)), 0, 144, 0, { shadow: false });
    for (let i = 0; i < 4; i++) { const a = i / 4 * PI * 2 + 0.4; pipe(gr, Math.cos(a) * 40, 30, Math.sin(a) * 40, Math.cos(a) * 64, 4, Math.sin(a) * 64, 3.5, darkM()); }
    panel(gr, team, 43, 70, 0, 30, 40);
    const glow = K.addGlow(gr, C.glow, 120, 0, 70, 0, 0.35);
    gr.userData = { tick(b, time) { bands.forEach((m, i) => { m.visible = (Math.floor(time * 2) % 5) >= i; }); glow.material.opacity = 0.3 + Math.sin(time * 3) * 0.08; } };
    return K.placeInSlot(gr, slot, base);
  };

  // Sentry Nest: a riveted bunker ring with twin gun turrets.
  B.digin = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(74, 80, 30, 12, true), plate(), 0, 15, 0);
    add(gr, g.cyl(70, 70, 4, 12), darkM(), 0, 4, 0);
    for (let i = 0; i < 12; i++) { const a = i / 12 * PI * 2; add(gr, g.cyl(3, 3, 3, 6), brass(), Math.cos(a) * 77, 28, Math.sin(a) * 77, { rz: PI / 2, ry: -a }); }
    for (const z of [-28, 28]) {
      const t = pivot(gr, 20, 30, z);
      add(t, g.sph(14, 10, 8), steel(), 0, 0, 0, { sy: 0.7 });
      for (const dz of [-4, 4]) add(t, g.cyl(2, 2, 30, 8), darkM(), 18, 2, dz, { rz: PI / 2 });
      lamp(t, 10, 8, 0, C.glow, 20);
    }
    panel(gr, team, -76, 20, 0, 40, 18);
    antenna(gr, team, -40, 0, 40, 70);
    return K.placeInSlot(gr, slot, base);
  };

  // Arc Turret: a tesla coil tower with an emitter that swings to aim; sparks crawl over the coil.
  B.support = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(44, 52, 14, 8), plate(), 0, 7, 0);
    for (let i = 0; i < 4; i++) { const a = i / 4 * PI * 2 + PI / 4; pipe(gr, Math.cos(a) * 40, 10, Math.sin(a) * 40, Math.cos(a) * 12, 150, Math.sin(a) * 12, 4, steel()); }
    add(gr, g.cyl(10, 14, 190, 10), darkM(), 0, 105, 0);
    for (let i = 0; i < 9; i++) add(gr, g.torus(18 - i * 0.6, 2.4, 6, 18), copper(), 0, 40 + i * 18, 0, { rx: PI / 2 });
    add(gr, g.cyl(26, 20, 12, 10), brass(), 0, 204, 0);
    const turret = pivot(gr, 0, 218, 0);
    add(turret, g.sph(14, 12, 10), steel(), 0, 0, 0);
    add(turret, g.cyl(4, 6, 36, 8), darkM(), 20, 0, 0, { rz: PI / 2 });
    for (let i = 0; i < 3; i++) add(turret, g.torus(6 - i, 1.2, 4, 10), copper(), 26 + i * 6, 0, 0, { ry: PI / 2 });
    add(turret, g.sph(5, 8, 6), core(), 40, 0, 0, { shadow: false });
    K.addGlow(turret, C.glow, 40, 40, 0, 0, 0.9);
    const sparks = [];
    for (let i = 0; i < 4; i++) { const s = K.glow(0xcff8ff, 24, 0.9); gr.add(s); sparks.push(s); }
    gr.add(...K.teamFlag(team, -40, 240, 0));
    gr.userData = {
      turret,
      tick(b, time) {
        sparks.forEach((s, i) => {
          const a = time * 7 + i * 1.6, y = 40 + ((time * 120 + i * 40) % 160);
          s.position.set(Math.cos(a) * 20, y, Math.sin(a) * 20);
          s.material.opacity = Math.random() < 0.7 ? 0.9 : 0.1;
        });
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Mortar Engine: a tracked heavy mortar; the barrel kicks back when it fires.
  B.siege = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(80, 86, 6, 12), plate(), 0, 3, 0);
    const turret = pivot(gr, 0, 0, 0);
    for (const z of [-34, 34]) {
      add(turret, g.box(110, 22, 18), darkM(), 0, 16, z);
      for (let i = 0; i < 5; i++) add(turret, g.cyl(9, 9, 20, 10), steel(), -44 + i * 22, 16, z, { rx: PI / 2 });
    }
    add(turret, g.box(80, 16, 60), plate(), 0, 34, 0);
    add(turret, g.cyl(26, 30, 18, 12), steel(), -6, 50, 0);
    panel(turret, team, 40, 36, 0, 40, 12);
    const barrel = pivot(turret, -6, 58, 0);
    barrel.rotation.z = 0.75;
    const tube = pivot(barrel, 0, 0, 0);
    add(tube, g.cyl(14, 16, 70, 14), darkM(), 0, 30, 0);
    add(tube, g.cyl(17, 17, 8, 14), brass(), 0, 64, 0);
    add(tube, g.cyl(10, 10, 2, 14), K.m(0x050505), 0, 68.5, 0);
    for (let i = 0; i < 3; i++) add(tube, g.torus(15.5, 1.5, 4, 14), brass(), 0, 12 + i * 16, 0, { rx: PI / 2 });
    const flash = K.addGlow(tube, 0xffd080, 120, 0, 80, 0, 0);
    stack(turret, -40, 0, 70, 6);
    gr.userData = {
      turret,
      tick(b) {
        const f = b.fired || 0;
        tube.position.y = f > 0.8 ? -(1 - f) / 0.2 * 14 : -f / 0.8 * 14;
        flash.material.opacity = f > 0.85 ? 1 : 0;
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Aegis Pylon: a field generator with counter-rotating rings around a pulsing core.
  B.storm = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(44, 52, 12, 8), plate(), 0, 6, 0);
    for (let i = 0; i < 3; i++) { const a = i / 3 * PI * 2; pipe(gr, Math.cos(a) * 40, 10, Math.sin(a) * 40, Math.cos(a) * 10, 190, Math.sin(a) * 10, 5, darkM()); }
    const coreM = add(gr, g.ico(22, 1), core(), 0, 150, 0, { shadow: false });
    const halo = K.addGlow(gr, 0xffd070, 180, 0, 150, 0, 0.6);
    const rings = [];
    for (let i = 0; i < 3; i++) { const r = add(gr, g.torus(36 + i * 10, 2.4, 6, 30), brass(), 0, 150, 0); rings.push(r); }
    add(gr, g.cone(10, 30, 8), brass(), 0, 205, 0);
    gr.add(...K.teamFlag(team, -40, 230, 0));
    gr.userData = {
      tick(b, time) {
        rings.forEach((r, i) => { r.rotation.set(time * (0.6 + i * 0.3) * (i % 2 ? -1 : 1), time * 0.4 * (i + 1), 0); });
        coreM.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
        halo.material.opacity = 0.45 + Math.sin(time * 4) * 0.15;
      }
    };
    return K.placeInSlot(gr, slot, base);
  };

  // Barracks: four factory floors.
  function factory(gr, team, w = 120, d = 170, h = 70) {
    add(gr, g.box(w + 12, 10, d + 12), plate(), 0, 5, 0);
    add(gr, g.box(w, h, d), K.metal(0x5a6068, 0.5), 0, 10 + h / 2, 0);
    for (let i = 0; i < 4; i++) add(gr, g.box(w + 2, 4, 4), brass(), 0, 14 + i * h / 3.2, d / 2 + 1);
    for (let i = 0; i < 6; i++) add(gr, g.box(4, 12, 16), core(), w / 2 + 1, h * 0.7, -d / 2 + 20 + i * (d - 40) / 5, { shadow: false });
    // Saw-tooth factory roof.
    for (let i = 0; i < 4; i++) add(gr, g.cyl(20, 20, w, 3), darkM(), 0, 10 + h + 10, -d / 2 + 22 + i * (d - 44) / 3, { rz: PI / 2 });
  }
  B.barracks = (slot, base, team) => {   // Assembly Line: a robotic arm assembles automatons on a conveyor
    const gr = new THREE.Group();
    factory(gr, team);
    add(gr, g.box(40, 6, 140), darkM(), 80, 16, 0);
    for (let i = 0; i < 7; i++) add(gr, g.cyl(3, 3, 40, 8), steel(), 80, 13, -60 + i * 20, { rz: PI / 2 });
    const parts = [];
    for (let i = 0; i < 3; i++) { const p = pivot(gr, 80, 20, 0); add(p, g.box(10, 14, 10), plate(), 0, 7, 0); add(p, g.sph(4, 6, 5), core(), 0, 17, 0, { shadow: false }); parts.push(p); }
    const armBase = pivot(gr, 60, 80, -40);
    add(armBase, g.cyl(8, 10, 10, 10), brass(), 0, 0, 0);
    const a1 = pivot(armBase, 0, 5, 0);
    add(a1, g.box(6, 40, 6), steel(), 0, 20, 0);
    const a2 = pivot(a1, 0, 40, 0);
    add(a2, g.box(5, 34, 5), steel(), 0, -17, 0);
    add(a2, g.sph(4, 6, 5), K.lit(0xffd080), 0, -36, 0, { shadow: false });
    const weld = K.addGlow(a2, 0xffd080, 40, 0, -36, 0, 0.8);
    panel(gr, team, 61, 30, 60, 30, 30);
    const smoke = stack(gr, -40, -50, 140, 9);
    gr.userData = {
      tick(b, time) {
        parts.forEach((p, i) => { p.position.z = ((time * 20 + i * 47) % 140) - 70; });
        armBase.rotation.y = 0.6 + Math.sin(time * 1.5) * 0.5;
        a1.rotation.z = 0.8 + Math.sin(time * 2) * 0.2; a2.rotation.z = 1.6 + Math.sin(time * 3) * 0.3;
        weld.material.opacity = Math.random() < 0.6 ? 0.9 : 0.2;
        smoke.position.y = 154 + Math.sin(time) * 4;
      }
    };
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksArmored = (slot, base, team) => {   // Heavy Foundry: crucible furnaces and tall chimneys
    const gr = new THREE.Group();
    factory(gr, team, 130, 160, 84);
    for (const z of [-50, 0, 50]) stack(gr, -40, z, 170 - Math.abs(z) * 0.6, 10);
    add(gr, g.cyl(26, 20, 34, 12), K.metal(0x3a3a40, 0.6), 74, 17, 40);
    add(gr, g.cyl(22, 22, 2, 12), K.lit(0xff8a30), 74, 34.5, 40, { shadow: false });
    const molten = K.addGlow(gr, 0xff7a20, 90, 74, 40, 40, 0.8);
    add(gr, g.box(4, 60, 60), darkM(), 66, 40, -30);
    for (let i = 0; i < 3; i++) add(gr, g.box(4.4, 4, 62), K.m(C.warn), 66.2, 20 + i * 18, -30);
    panel(gr, team, 66, 90, 0, 60, 18);
    gr.userData = { tick(b, time) { molten.material.opacity = 0.65 + Math.sin(time * 5) * 0.15; } };
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksShort = (slot, base, team) => {   // Rivet Works: a stamping press hammering out rivets
    const gr = new THREE.Group();
    factory(gr, team, 110, 150, 60);
    const press = pivot(gr, 76, 0, 0);
    add(press, g.box(30, 8, 50), darkM(), 0, 4, 0);
    for (const z of [-20, 20]) add(press, g.box(6, 80, 6), steel(), 0, 40, z);
    add(press, g.box(34, 10, 50), brass(), 0, 82, 0);
    const ram = pivot(press, 0, 60, 0);
    add(ram, g.box(24, 20, 30), plate(), 0, 0, 0);
    add(ram, g.cyl(4, 4, 30, 8), steel(), 0, 18, 0);
    for (let i = 0; i < 6; i++) add(gr, g.cyl(3, 3, 6, 8), brass(), 60 + (i % 3) * 8, 3, -60 + Math.floor(i / 3) * 8);
    panel(gr, team, 56, 50, -50, 30, 26);
    gr.userData = { tick(b, time) { const p = (time * 1.5) % 1; ram.position.y = p < 0.15 ? 60 - p / 0.15 * 40 : 20 + (p - 0.15) / 0.85 * 40; } };
    return K.placeInSlot(gr, slot, base);
  };
  B.barracksLong = (slot, base, team) => {   // Calibration Spire: a mast with a rotating range-finding dish
    const gr = new THREE.Group();
    factory(gr, team, 110, 140, 50);
    add(gr, g.cyl(8, 14, 170, 8), darkM(), -20, 145, 0);
    for (let i = 0; i < 6; i++) add(gr, g.torus(14 - i, 1.5, 4, 12), brass(), -20, 80 + i * 24, 0, { rx: PI / 2 });
    const dish = pivot(gr, -20, 230, 0);
    add(dish, g.dome(30, 16, 6), steel(), 10, 0, 0, { rz: -PI / 2, sy: 0.4 });
    add(dish, g.cyl(1.5, 1.5, 30, 6), brass(), 22, 0, 0, { rz: PI / 2 });
    lamp(dish, 38, 0, 0, C.glow, 30);
    for (let i = 0; i < 4; i++) add(gr, g.cyl(2, 2, 60, 6), steel(), 40, 50, -45 + i * 30, { rz: 0.4 });   // racked long rifles
    panel(gr, team, 56, 40, 50, 30, 20);
    gr.userData = { tick(b, time) { dish.rotation.y = time * 0.8; } };
    return K.placeInSlot(gr, slot, base);
  };

  // Allies
  B.allyEngineer = (slot, base, team) => {   // Repair Bay: an open garage with a gantry crane
    const gr = new THREE.Group();
    add(gr, g.box(110, 8, 100), plate(), 0, 4, 0);
    for (const [x, z] of [[-44, -40], [-44, 40], [30, -40], [30, 40]]) add(gr, g.box(6, 80, 6), steel(), x, 44, z);
    add(gr, g.box(84, 6, 6), K.m(C.warn), -7, 84, -40); add(gr, g.box(84, 6, 6), K.m(C.warn), -7, 84, 40);
    const trolley = pivot(gr, 0, 84, 0);
    add(trolley, g.box(10, 8, 86), darkM(), 0, 0, 0);
    add(trolley, g.cyl(0.6, 0.6, 40, 4), darkM(), 0, -20, 0);
    add(trolley, g.torus(4, 1.2, 4, 10, PI * 1.4), steel(), 0, -42, 0);
    gear(gr, -30, 20, 48, 12);
    add(gr, g.box(20, 16, 20), plate(), 10, 12, -10);
    add(gr, g.sph(6, 8, 6), core(), 10, 24, -10, { shadow: false });
    gr.add(...K.teamFlag(team, -44, 110, 40));
    gr.userData = { tick(b, time) { trolley.position.x = Math.sin(time * 0.8) * 26; } };
    return K.placeInSlot(gr, slot, base);
  };
  B.allyMedic = (slot, base, team) => {   // Coolant Station: tanks of glowing coolant and a dispenser arm
    const gr = new THREE.Group();
    add(gr, g.cyl(52, 56, 8, 10), plate(), 0, 4, 0);
    const levels = [];
    for (const [x, z] of [[-20, -26], [-20, 26], [-40, 0]]) {
      add(gr, g.cyl(16, 16, 70, 12, true), K.m(0xa8e8e0, { transparent: true, opacity: 0.35, metalness: 0.2, roughness: 0.1 }), x, 43, z, { shadow: false });
      levels.push(add(gr, g.cyl(14, 14, 60, 12), K.lit(0x7fffd0, { transparent: true, opacity: 0.85 }), x, 38, z, { shadow: false }));
      add(gr, g.cyl(17, 17, 5, 12), brass(), x, 80, z); add(gr, g.cyl(17, 17, 5, 12), brass(), x, 8, z);
    }
    pipe(gr, -20, 70, -26, 30, 50, 0, 3); pipe(gr, -20, 70, 26, 30, 50, 0, 3);
    add(gr, g.box(16, 50, 20), plate(), 34, 25, 0);
    add(gr, g.cyl(3, 3, 14, 8), steel(), 46, 40, 0, { rz: PI / 2 });
    K.addGlow(gr, 0x7fffd0, 80, -24, 40, 0, 0.5);
    gr.add(...K.teamFlag(team, 30, 70, -30));
    gr.userData = { tick(b, time) { levels.forEach((l, i) => { l.scale.y = 0.75 + Math.sin(time + i * 2) * 0.2; }); } };
    return K.placeInSlot(gr, slot, base);
  };
  B.allyOfficer = (slot, base, team) => {   // Command Node: a server tower with blinking lights and a holo-display
    const gr = new THREE.Group();
    add(gr, g.box(90, 10, 90), plate(), 0, 5, 0);
    add(gr, g.box(54, 110, 54), darkM(), -6, 65, 0);
    const lights = [];
    for (let i = 0; i < 12; i++) lights.push(add(gr, g.box(1.5, 3, 3), K.lit(i % 3 ? C.glow : K.teamGlow(team)), 21.5, 25 + Math.floor(i / 3) * 22, -12 + (i % 3) * 12, { shadow: false }));
    add(gr, g.box(58, 6, 58), brass(), -6, 122, 0);
    const holo = pivot(gr, -6, 150, 0);
    add(holo, g.oct(14), K.lit(K.teamGlow(team), { transparent: true, opacity: 0.6, wireframe: true }), 0, 0, 0, { shadow: false });
    K.addGlow(holo, K.teamGlow(team), 60, 0, 0, 0, 0.6);
    antenna(gr, team, -24, 125, -20, 50);
    gr.userData = { tick(b, time) { holo.rotation.y = time; lights.forEach((l, i) => { l.visible = Math.sin(time * 4 + i * 1.7) > -0.3; }); } };
    return K.placeInSlot(gr, slot, base);
  };
  B.allyDemolitionist = (slot, base, team) => {   // Munitions Works: a bunker with missile racks
    const gr = new THREE.Group();
    add(gr, g.cyl(40, 48, 44, 8), plate(), 0, 22, 0);
    add(gr, g.cyl(30, 42, 14, 8), darkM(), 0, 51, 0);
    add(gr, g.box(4, 8, 34), K.m(0x050505), 44, 32, 0);
    const rack = pivot(gr, -20, 58, 0); rack.rotation.z = 0.5;
    add(rack, g.box(30, 4, 36), steel(), 0, 0, 0);
    for (let i = 0; i < 4; i++) {
      add(rack, g.cyl(3.6, 3.6, 30, 8), K.metal(0xe8e8e8, 0.4), -6 + (i % 2) * 12, 16, -12 + Math.floor(i / 2) * 24);
      add(rack, g.cone(3.6, 8, 8), K.m(K.teamHex(team)), -6 + (i % 2) * 12, 35, -12 + Math.floor(i / 2) * 24);
    }
    for (let i = 0; i < 6; i++) add(gr, g.cyl(6, 6, 14, 8), K.m(C.warn), 40 + (i % 3) * 10, 7, -40 + Math.floor(i / 3) * 12);
    lamp(gr, 0, 66, 0, 0xff5030, 30);
    gr.add(...K.teamFlag(team, 0, 90, 0));
    return K.placeInSlot(gr, slot, base);
  };

  // Prime Core: a fortified reactor. A giant arc-light core suspended in gimbal rings, four pylons
  // feeding it, gear-walls around it and a sealed gate facing the enemy.
  B.command = (slot, base, team) => {
    const gr = new THREE.Group();
    add(gr, g.cyl(150, 162, 16, 8), plate(), 0, 8, 0, { ry: PI / 8 });
    add(gr, g.cyl(130, 136, 60, 8, true), K.metal(0x4a5058, 0.5), 0, 46, 0, { ry: PI / 8 });
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * PI * 2 + PI / 8;
      if (Math.abs(Math.cos(a)) > 0.9 && Math.cos(a) > 0) continue;   // leave the gate side open
      gear(gr, Math.cos(a) * 128, 50, Math.sin(a) * 128, 22, 12).rotation.y = -a + PI / 2;
    }
    add(gr, g.cyl(132, 132, 6, 8), brass(), 0, 78, 0, { ry: PI / 8 });
    // Pylons.
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * PI * 2 + PI / 4, x = Math.cos(a) * 100, z = Math.sin(a) * 100;
      add(gr, g.cyl(12, 18, 200, 8), darkM(), x, 100, z);
      for (let k = 0; k < 4; k++) add(gr, g.torus(15 - k, 2, 4, 12), copper(), x, 60 + k * 36, z, { rx: PI / 2 });
      add(gr, g.cone(14, 30, 8), brass(), x, 214, z);
      lamp(gr, x, 232, z, K.teamGlow(team), 50);
      pipe(gr, x, 180, z, x * 0.2, 170, z * 0.2, 4, copper());
      add(gr, g.box(3, 50, 30), K.m(K.teamHex(team)), x + Math.cos(a) * 14, 130, z + Math.sin(a) * 14, { ry: -a });
    }
    // Central block and the floating core.
    add(gr, g.cyl(56, 70, 80, 8), plate(), 0, 56, 0);
    add(gr, g.cyl(40, 50, 30, 8), darkM(), 0, 110, 0);
    const coreG = pivot(gr, 0, 190, 0);
    const coreMesh = add(coreG, g.ico(40, 1), core(), 0, 0, 0, { shadow: false });
    K.addGlow(coreG, C.glow, 320, 0, 0, 0, 0.55);
    const rings = [];
    for (let i = 0; i < 3; i++) rings.push(add(coreG, g.torus(58 + i * 12, 3.5, 6, 36), brass(), 0, 0, 0));
    const light = G.kit.light(C.glow, 1.8, 1000, 2); coreG.add(light);
    // Gate.
    add(gr, g.box(30, 70, 80), K.metal(0x3a3e44, 0.5), 140, 40, 0);
    add(gr, g.box(4, 54, 52), K.m(C.warn), 156, 34, 0);
    for (let i = 0; i < 5; i++) add(gr, g.box(4.4, 6, 54), K.m(0x111111), 156.2, 12 + i * 11, 0);
    for (const z of [-60, 60]) { stack(gr, 120, z, 90, 9); lamp(gr, 160, 70, z * 0.7, 0xff5030, 30); }
    gr.position.set(slot.x, 0, slot.y);
    gr.rotation.y = team === G.TEAM.PLAYER ? 0 : PI;
    gr.userData = {
      tick(b, time) {
        rings.forEach((r, i) => r.rotation.set(time * (0.5 + i * 0.25), time * 0.3 * (i % 2 ? -1 : 1), i));
        coreMesh.rotation.y = time * 0.7;
        coreG.position.y = 190 + Math.sin(time * 1.3) * 6;
        light.intensity = 1.5 + Math.sin(time * 4) * 0.3;
      }
    };
    return gr;
  };

  // ---------------------------------------------------------------------------------------------
  // Units: riveted automatons with arc-light cores and single-eye visors.
  // ---------------------------------------------------------------------------------------------
  function unit(team, kind, ranged) {
    if (BEASTS[kind]) return BEASTS[kind](team);
    const gr = new THREE.Group();
    const body = K.mat(C.plate, { metalness: 0.6, roughness: 0.4 }), dk = darkM(), br = brass(), teamM = K.m(K.teamHex(team));
    // Piston legs.
    const l1 = pivot(gr, 0, 16, 5), l2 = pivot(gr, 0, 16, -5);
    for (const l of [l1, l2]) {
      add(l, g.cyl(2.2, 2.2, 9, 8), dk, 0, -3, 0);
      add(l, g.cyl(1.4, 1.4, 8, 8), K.metal(0xc8ccd2, 0.25), 0, -10, 0);
      add(l, g.box(8, 3, 6), br, 1.5, -15, 0);
    }
    // Torso: plated drum with a glowing core window, shoulder bolts, team chest panel.
    add(gr, g.box(12, 18, 16), body, 0, 26, 0);
    add(gr, g.cyl(4.5, 4.5, 2, 12), core(), 6.2, 28, 0, { rz: PI / 2, shadow: false });
    add(gr, g.box(1, 6, 12), teamM, 6.3, 20, 0);
    for (const s of [-1, 1]) add(gr, g.sph(3.6, 8, 6), br, 0, 33, s * 9);
    add(gr, g.cyl(2, 2, 4, 6), dk, 0, 37, 0);
    // Head: a domed cylinder with a glowing visor slit and a little antenna.
    add(gr, g.cyl(5, 5.5, 8, 12), body, 0, 42, 0);
    add(gr, g.dome(5, 12, 4), br, 0, 46, 0);
    add(gr, g.box(1, 2, 7), core(), 5, 42, 0, { shadow: false });
    add(gr, g.cyl(0.4, 0.4, 6, 4), dk, -2, 50, 2);
    add(gr, g.sph(0.9, 5, 4), K.lit(K.teamGlow(team)), -2, 53, 2, { shadow: false });
    // Off arm: jointed with a clamp hand.
    add(gr, g.cyl(1.8, 1.6, 18, 6), dk, 2, 24, -11, { rz: -0.2 });
    add(gr, g.box(4, 4, 4), br, 4, 15, -11);
    const arm = pivot(gr, 1, 32, 11);
    add(arm, g.cyl(2, 1.8, 10, 6), dk, 0, -3, 0);
    let aura = null;
    if (kind === 'infantry') {
      add(arm, g.box(2, 22, 1), K.metal(0xd8dce2, 0.2), 0, 12, 0);
      add(arm, g.box(0.6, 20, 1.2), core(), 1.2, 12, 0, { shadow: false });
    } else if (kind === 'armored') {
      // Juggernaut: slab armor, big shoulder plates, a piston hammer.
      add(gr, g.box(15, 20, 20), K.metal(0x3a3e44, 0.45), 0, 27, 0);
      for (const s of [-1, 1]) add(gr, g.box(10, 6, 8), plate(), 0, 37, s * 11, { rx: s * 0.3 });
      add(arm, g.cyl(1.4, 1.4, 30, 6), dk, 0, 12, 0);
      add(arm, g.cyl(6, 6, 14, 10), br, 0, 28, 0, { rz: PI / 2 });
      add(arm, g.cyl(5, 5, 15, 10), K.m(C.warn), 0, 28, 0, { rz: PI / 2 });
    } else if (kind === 'short') {
      // Rivet gun built into the forearm.
      add(arm, g.box(5, 10, 5), dk, 0, 6, 0);
      add(arm, g.cyl(1.4, 1.4, 12, 6), steel(), 0, 16, 0);
      add(gr, g.cyl(4, 4, 10, 8), br, -8, 34, 0, { rx: PI / 2 });   // rivet hopper
    } else if (kind === 'long') {
      // Rangefinder: a long rifle and a scope eye.
      add(gr, g.cyl(1.4, 1.4, 44, 6), dk, 14, 30, 0, { rz: PI / 2 });
      add(gr, g.cyl(2, 2, 10, 8), br, 12, 34, 0, { rz: PI / 2 });
      add(gr, g.cyl(1.6, 1.6, 4, 8), K.lit(0xff4030), 7, 43, 3, { rz: PI / 2, shadow: false });
    } else if (kind === 'spearman') {
      // Piston pike: a long steel shaft with a brass collar and an arc-lit spike.
      add(arm, g.cyl(1.1, 1.3, 70, 6), steel(), 0, 22, 0);
      add(arm, g.cyl(2.4, 2.4, 6, 8), br, 0, 54, 0);
      add(arm, g.cone(2.2, 12, 6), core(), 0, 63, 0, { shadow: false });
    } else if (kind === 'elite') {
      // Duelist frame: a team crest fin, slim plating and a long arc-blade.
      add(gr, g.box(10, 6, 1.2), teamM, -2, 52, 0);
      for (const s of [-1, 1]) add(gr, g.box(8, 3, 6), br, 0, 36, s * 10, { rx: s * 0.4 });
      add(arm, g.box(2.2, 40, 1), K.metal(0xd8dce2, 0.2), 0, 22, 0);
      add(arm, g.box(0.6, 36, 1.4), core(), 1.4, 22, 0, { shadow: false });
      add(arm, g.box(3, 2.4, 11), br, 0, 2, 0);
    } else if (kind === 'caster') {
      // Arc-caster: a coil-wound staff throwing lightning and a capacitor pack on the back.
      add(gr, g.box(8, 16, 12), dk, -9, 30, 0);
      for (const z of [-3, 3]) add(gr, g.cyl(1.4, 1.4, 12, 6), core(), -13.5, 32, z, { shadow: false });
      add(arm, g.cyl(1.2, 1.2, 50, 6), steel(), 0, 14, 0);
      for (let i = 0; i < 4; i++) add(arm, g.torus(2.6, 0.6, 4, 10), K.metal(C.copper, 0.3), 0, 28 + i * 3, 0, { rx: PI / 2 });
      add(arm, g.sph(3.8, 8, 6), core(), 0, 42, 0, { shadow: false });
      K.addGlow(arm, C.glow, 32, 0, 42, 0, 0.85);
    } else if (kind === 'engineer') {
      add(gr, g.box(8, 12, 12), br, -9, 30, 0);   // tool pack
      gear(gr, -14, 30, 0, 4, 8).rotation.y = PI / 2;
      add(arm, g.box(2, 18, 2), steel(), 0, 9, 0);
      add(arm, g.torus(3, 1.2, 4, 8, PI * 1.5), steel(), 0, 20, 0);
    } else if (kind === 'medic') {
      for (const z of [-4, 4]) add(gr, g.cyl(3, 3, 14, 10), K.lit(0x7fffd0), -9, 30, z, { shadow: false });
      add(arm, g.cyl(1.2, 1.2, 14, 6), steel(), 0, 7, 0);
      add(arm, g.cone(2.4, 6, 8), br, 0, 16, 0);
      arm.add(K.glow(0x7fffd0, 22, 0.8)); arm.children[arm.children.length - 1].position.y = 20;
    } else if (kind === 'officer') {
      for (let i = 0; i < 3; i++) add(gr, g.cyl(0.4, 0.4, 10 + i * 4, 4), dk, -3, 52 + i * 2, -3 + i * 3);
      add(gr, g.box(2, 24, 18), teamM, -7, 26, 0);
      add(arm, g.box(3, 8, 3), dk, 0, 5, 0);
      add(arm, g.cyl(1.2, 1.2, 8, 6), steel(), 2, 9, 0, { rz: -PI / 2 });
      aura = K.aura(1.5, C.glow); gr.add(aura);
    } else if (kind === 'demolitionist') {
      const pod = pivot(gr, -4, 40, -8);
      add(pod, g.box(10, 10, 10), dk, 0, 0, 0);
      for (const [y, z] of [[2.5, 2.5], [2.5, -2.5], [-2.5, 2.5], [-2.5, -2.5]]) add(pod, g.cyl(1.8, 1.8, 2, 8), K.m(0xff5030), 5.2, y, z, { rz: PI / 2 });
    }
    if (G.SQUAD_KINDS[kind].ally) gr.scale.setScalar(1.45);
    else if (kind === 'armored') gr.scale.setScalar(1.35);
    gr.userData = { tunic: body, arm, l1, l2, ranged, aura, phase: Math.random() * 10 };
    return K.shadowed(gr);
  }

  // Beasts and engines: clockwork hounds, steam-charger riders and the siege crawler. Same soldier
  // contract; they pose their own legs, heads, treads and guns in userData.tick.
  const BEASTS = {
    // Clockwork hound: a riveted box frame on piston legs, a snapping steel jaw and a glowing eye slit.
    creature(team) {
      const gr = new THREE.Group();
      const body = K.mat(C.plate, { metalness: 0.6, roughness: 0.4 }), dk = darkM(), br = brass(), teamM = K.m(K.teamHex(team));
      add(gr, g.box(30, 12, 13), body, 0, 24, 0);
      for (const x of [-8, 0, 8]) add(gr, g.box(2, 13, 14), br, x, 24, 0);
      for (const s of [-1, 1]) add(gr, g.box(12, 5, 1), teamM, 4, 24, s * 6.8);
      add(gr, g.cyl(3, 3, 1, 10), core(), -8, 31, 0, { shadow: false });
      add(gr, g.cyl(0.6, 0.6, 14, 4), dk, -19, 30, 0, { rz: 0.9 });
      add(gr, g.sph(1.2, 5, 4), K.lit(K.teamGlow(team)), -24, 35, 0, { shadow: false });
      const head = pivot(gr, 15, 29, 0);
      add(head, g.box(11, 8, 9), body, 4, 1, 0);
      add(head, g.box(9, 3, 8), dk, 8, -4.5, 0);
      add(head, g.box(1, 2, 7), core(), 9.6, 2, 0, { shadow: false });
      for (const z of [-3, 3]) add(head, g.cone(1.4, 5, 4), br, 1, 7, z);
      const legs = K.legs4(gr, 11, 18, 6, p => {
        add(p, g.cyl(1.8, 1.8, 9, 6), dk, 0, -4, 0);
        add(p, g.cyl(1.2, 1.2, 9, 6), K.metal(0xc8ccd2, 0.25), 0, -12, 0);
        add(p, g.box(5, 2, 4), br, 1, -17, 0);
      });
      gr.scale.setScalar(1.15);
      gr.userData = { tunic: body, arm: pivot(gr), l1: pivot(gr), l2: pivot(gr), ranged: false, aura: null, phase: Math.random() * 10,
        tick(u, e, time) { K.gait(legs, e, time, u.phase, 18, 0.6); head.rotation.z = -K.ease.bump(e.swing || 0) * 0.5; } };
      return K.shadowed(gr);
    },
    // Charger: an automaton lancer on a boiler-bellied mechanical steed with piston legs and a smokestack.
    mounted(team) {
      const gr = new THREE.Group();
      const body = K.mat(C.plate, { metalness: 0.6, roughness: 0.4 }), dk = darkM(), br = brass(), teamM = K.m(K.teamHex(team));
      add(gr, g.cyl(10, 10, 46, 10), K.metal(C.copper, 0.35), 0, 36, 0, { rz: PI / 2 });
      for (const x of [-16, 0, 16]) add(gr, g.cyl(10.6, 10.6, 2.4, 10), br, x, 36, 0, { rz: PI / 2 });
      for (const s of [-1, 1]) add(gr, g.box(24, 7, 1), teamM, 0, 36, s * 10.4);
      add(gr, g.cyl(3, 4, 16, 8), dk, -16, 50, 0);
      K.addGlow(gr, 0xffb060, 18, -16, 59, 0, 0.6);
      add(gr, g.box(8, 20, 8), dk, 25, 46, 0, { rz: -0.6 });
      add(gr, g.box(16, 7, 8), body, 33, 56, 0, { rz: -0.35 });
      add(gr, g.box(1, 2, 7), core(), 41.2, 54.5, 0, { rz: -0.35, shadow: false });
      add(gr, g.box(10, 4, 16), dk, -2, 47, 0);
      const legs = K.legs4(gr, 16, 30, 7, p => {
        add(p, g.cyl(2.2, 2.2, 12, 8), dk, 0, -6, 0);
        add(p, g.cyl(1.4, 1.4, 12, 8), K.metal(0xc8ccd2, 0.25), 0, -17, 0);
        add(p, g.box(6, 3, 5), br, 0.5, -24, 0);
      });
      // Rider.
      add(gr, g.box(10, 16, 13), body, -2, 58, 0);
      add(gr, g.cyl(3.4, 3.4, 1, 10), core(), 3.2, 60, 0, { rz: PI / 2, shadow: false });
      for (const s of [-1, 1]) add(gr, g.cyl(1.6, 1.6, 14, 6), dk, 0, 46, s * 10, { rx: s * 0.6 });
      add(gr, g.cyl(4.5, 5, 8, 12), body, -2, 71, 0);
      add(gr, g.dome(4.5, 12, 4), br, -2, 75, 0);
      add(gr, g.box(1, 2, 6), core(), 2.6, 71, 0, { shadow: false });
      add(gr, g.box(1.5, 10, 12), teamM, -2, 58, -8);
      const lance = pivot(gr, -2, 62, 9);
      add(lance, g.cyl(1.2, 2.4, 82, 8), steel(), 0, 27, 0);
      add(lance, g.cyl(3, 3, 6, 8), br, 0, 2, 0);
      add(lance, g.cone(2.2, 12, 6), core(), 0, 74, 0, { shadow: false });
      lance.rotation.z = -1.3;
      gr.userData = { tunic: body, arm: pivot(gr), l1: pivot(gr), l2: pivot(gr), ranged: false, aura: null, phase: Math.random() * 10,
        tick(u, e, time) { K.gait(legs, e, time, u.phase, 19, 0.75); lance.position.x = -2 + K.ease.bump(e.swing || 0) * 12; } };
      return K.shadowed(gr);
    },
    // Siege crawler: a treaded steel hull with an arc-cannon turret and a tesla node on each flank.
    warMachine(team) {
      const gr = new THREE.Group();
      const body = K.mat(C.plate, { metalness: 0.6, roughness: 0.4 }), dk = darkM(), br = brass(), teamM = K.m(K.teamHex(team));
      add(gr, g.box(96, 24, 56), body, 0, 34, 0);
      add(gr, g.box(22, 14, 56), plate(), 50, 30, 0, { rz: 0.6 });
      for (const s of [-1, 1]) {
        add(gr, g.box(108, 22, 16), dk, 0, 13, s * 34);
        add(gr, g.box(70, 5, 1), teamM, -4, 38, s * 28.6);
        add(gr, g.cyl(3, 4, 16, 8), dk, -40, 54, s * 16);
        K.addGlow(gr, 0xffb060, 16, -40, 63, s * 16, 0.6);
      }
      add(gr, g.cyl(6, 6, 2, 12), core(), -30, 47, 0, { shadow: false });
      const wheels = [];
      for (const x of [-42, -14, 14, 42]) for (const s of [-1, 1]) {
        const w = pivot(gr, x, 13, s * 42.5);
        add(w, g.cyl(9, 9, 2, 10), br, 0, 0, 0, { rx: PI / 2 });
        add(w, g.box(14, 2, 2.2), dk);
        wheels.push(w);
      }
      const turret = pivot(gr, 6, 46, 0);
      add(turret, g.cyl(20, 23, 14, 12), plate(), 0, 7, 0);
      add(turret, g.dome(14, 12, 5), br, 0, 14, 0);
      const barrel = pivot(turret, 0, 16, 0);
      add(barrel, g.cyl(5, 6, 60, 10), steel(), 30, 0, 0, { rz: -PI / 2 });
      for (let i = 0; i < 3; i++) add(barrel, g.torus(6.2, 1, 4, 12), K.metal(C.copper, 0.3), 20 + i * 10, 0, 0, { ry: PI / 2 });
      add(barrel, g.box(8, 10, 10), dk, 60, 0, 0);
      add(barrel, g.cyl(2, 2, 1, 8), core(), 64.2, 0, 0, { rz: PI / 2, shadow: false });
      for (const s of [-1, 1]) {
        const gun = pivot(gr, 26, 48, s * 22);
        add(gun, g.cyl(2.4, 3, 10, 8), dk, 0, 3, 0);
        add(gun, g.sph(3.4, 8, 6), core(), 0, 11, 0, { shadow: false });
        K.addGlow(gun, C.glow, 22, 0, 11, 0, 0.7);
      }
      gr.userData = { tunic: body, arm: pivot(gr), l1: pivot(gr), l2: pivot(gr), ranged: true, aura: null, phase: Math.random() * 10,
        tick(u, e, time) {
          if (e.moving) for (const w of wheels) w.rotation.z = -time * 5;
          turret.rotation.y = -((e.aim ?? e.facing ?? 0) - (e.facing ?? 0));
          barrel.position.x = -K.ease.bump(e.swing || 0) * 9;
        } };
      return K.shadowed(gr);
    }
  };

  function shot(s) {
    const gr = new THREE.Group();
    if (s.shot === 'arrow') {   // energy dart
      add(gr, g.box(22, 1.6, 1.6), core(), 0, 0, 0, { shadow: false });
      gr.add(K.glow(C.glow, 34, 0.9));
    } else if (s.shot === 'bolt') {   // rail spike wreathed in arc-light
      add(gr, g.box(44, 3, 3), steel(), 0, 0, 0, { shadow: false });
      add(gr, g.cone(3, 10, 4), steel(), 27, 0, 0, { rz: -PI / 2, shadow: false });
      gr.add(K.glow(C.glow, 60, 0.8));
    } else if (s.shot === 'boulder') {   // iron shell with glowing seams
      add(gr, g.sph(16, 12, 10), K.metal(0x2a2e34, 0.4), 0, 0, 0);
      add(gr, g.torus(16, 1.4, 4, 16), core(), 0, 0, 0, { shadow: false });
      add(gr, g.torus(16, 1.4, 4, 16), core(), 0, 0, 0, { ry: PI / 2, shadow: false });
    } else if (s.shot === 'orb') {   // ball lightning
      add(gr, g.sph(4.5, 8, 6), core(), 0, 0, 0, { shadow: false });
      gr.add(K.glow(C.glow, 48, 0.95));
    } else if (s.shot === 'shell') {   // arc shell
      add(gr, g.sph(8, 10, 8), K.metal(0x2a2e34, 0.4), 0, 0, 0);
      add(gr, g.torus(8, 1, 4, 12), core(), 0, 0, 0, { shadow: false });
    } else {   // missile
      add(gr, g.cyl(3, 3, 22, 8), K.metal(0xe8e8e8, 0.4), 0, 0, 0, { rz: PI / 2, shadow: false });
      add(gr, g.cone(3, 8, 8), K.m(K.teamHex(s.team)), 15, 0, 0, { rz: -PI / 2, shadow: false });
      for (const r of [0, PI / 2]) add(gr, g.box(6, 10, 1), darkM(), -9, 0, 0, { rx: r, shadow: false });
      const flare = K.glow(C.glow, 34, 0.95); flare.position.x = -14; gr.add(flare);
    }
    return gr;
  }

  R.RACE_MODELS.unfettered = { buildings: B, unit, shot };
})(window.Game);
