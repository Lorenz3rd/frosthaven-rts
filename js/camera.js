// Camera: an angled RTS camera looking at a focus point on the ground. Always centered on the hero;
// zooms with the mouse wheel. World (x, y) maps to Three.js (x, 0, y).
// G.camera is the main view. Split screen makes one camera per player (G.makeCamera): each covers the
// screen rectangle (x, y, w, h) and, with `pad` set, zooms with that controller alone.
(function (G) {
  const PITCH = 55 * Math.PI / 180;  // angle above the ground plane
  const FOV = 32;
  const MIN_DIST = 1100, MAX_DIST = 3400;

  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmp = new THREE.Vector3();
  const ndc = new THREE.Vector2();

  G.makeCamera = function (pad) {
    const cam = { x: 0, y: 0, fx: 0, fy: 0, w: 800, h: 600, dist: 2200, three: null, pad: pad || null };

    cam.init = function () {
      cam.three = new THREE.PerspectiveCamera(FOV, cam.w / cam.h, 10, 20000);
      cam.apply();
    };

    // (x, y): the view's top-left corner on the page; screen coordinates below are relative to it.
    cam.resize = function (w, h, x = 0, y = 0) {
      cam.w = w; cam.h = h; cam.x = x; cam.y = y;
      if (cam.three) { cam.three.aspect = w / h; cam.three.updateProjectionMatrix(); }
      cam.clamp();
    };

    cam.centerOn = function (x, y) { cam.fx = x; cam.fy = y; cam.clamp(); };

    cam.clamp = function () {
      const m = G.map;
      if (!m) return;
      cam.fx = G.clamp(cam.fx, 0, m.w);
      cam.fy = G.clamp(cam.fy, 0, m.h);
    };

    // Place the Three.js camera behind (+z) and above the focus point.
    cam.apply = function () {
      if (!cam.three) return;
      cam.three.position.set(cam.fx, Math.sin(PITCH) * cam.dist, cam.fy + Math.cos(PITCH) * cam.dist);
      cam.three.lookAt(cam.fx, 0, cam.fy);
      cam.three.updateMatrixWorld();
    };

    // The camera is always locked on the hero; only zoom is adjustable.
    cam.update = function (dt, hero) {
      // A split-screen camera ignores the mouse wheel: its own controller zooms it.
      if (!cam.pad && G.input.wheel) cam.dist = G.clamp(cam.dist * Math.pow(1.0015, G.input.wheel), MIN_DIST, MAX_DIST);
      const pad = cam.pad || (G.controlScheme === 'pad' ? G.pad : null);
      // Controller: LT zooms out, RT zooms in.
      if (pad && pad.connected) {
        const z = (pad.held[G.PAD_BTN.LT] ? 1 : 0) - (pad.held[G.PAD_BTN.RT] ? 1 : 0);
        if (z) cam.dist = G.clamp(cam.dist * Math.pow(1.0015, z * 25), MIN_DIST, MAX_DIST);
      }
      if (hero) cam.centerOn(hero.x, hero.y);
      cam.apply();
    };

    // Screen pixel -> point on the ground plane.
    cam.screenToWorld = function (sx, sy) {
      ndc.set((sx / cam.w) * 2 - 1, -(sy / cam.h) * 2 + 1);
      ray.setFromCamera(ndc, cam.three);
      const hit = ray.ray.intersectPlane(ground, tmp);
      return hit ? { x: hit.x, y: hit.z } : { x: cam.fx, y: cam.fy };
    };

    // World point (optionally lifted to height h) -> screen pixel. behind = true if not in front of the camera.
    cam.worldToScreen = function (wx, wy, h = 0) {
      tmp.set(wx, h, wy).project(cam.three);
      return { x: (tmp.x + 1) / 2 * cam.w, y: (1 - tmp.y) / 2 * cam.h, behind: tmp.z > 1 };
    };

    cam.isVisible = function (x, y, pad) {
      const s = cam.worldToScreen(x, y);
      return !s.behind && s.x > -pad && s.x < cam.w + pad && s.y > -pad && s.y < cam.h + pad;
    };

    return cam;
  };

  G.camera = G.makeCamera();
})(window.Game);
