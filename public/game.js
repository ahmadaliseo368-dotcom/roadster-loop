'use strict';
/* ROADSTER LOOP – 3D night stunt racer. Three.js r128 (CDN). No build step.
   Part 1: pure physics (also testable in Node). Part 2: rendering, UI, audio. */
(function () {
  /* ================= constants ================= */
  const G = 9.81, PI = Math.PI, TAU = PI * 2;
  const C = { DS: 0.5, LOOP_X: 70, LOOP_R: 14, LOOP_Z: 9, RAMP_X: 190, RAMP_R: 60, RAMP_A: 40 * PI / 180,
    W: 9, ACC: 14, ROT: 4.5, WALL_X: 600, LOCK: 0.4, LAND_TOL: 0.42, GREEN_MAX: 1.5 };
  const clamp = (a, b, c) => Math.max(b, Math.min(c, a));
  const wrap = a => { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; };

  /* ================= track path (side-view profile, z = lateral) ================= */
  function buildPath() {
    const pts = []; let s = 0;
    const add = (x, y, z, th, k, yaw) => { pts.push({ x, y, z, th, k, yaw, s }); s += C.DS; };
    for (let x = 0; x < C.LOOP_X; x += C.DS) add(x, 0, 0, 0, 0, 0);
    const R = C.LOOP_R, n = Math.round(TAU * R / C.DS);
    for (let i = 0; i < n; i++) {
      const t = i / n, ph = t * TAU;
      const z = C.LOOP_Z * t * t * (3 - 2 * t), dz = C.LOOP_Z * 6 * t * (1 - t) / TAU;
      add(C.LOOP_X + R * Math.sin(ph), R * (1 - Math.cos(ph)), z, ph, 1 / R, -Math.atan(dz / R));
    }
    for (let x = C.LOOP_X; x < C.RAMP_X; x += C.DS) add(x, 0, C.LOOP_Z, TAU, 0, 0);
    const Rr = C.RAMP_R, m = Math.round(Rr * C.RAMP_A / C.DS);
    for (let i = 0; i <= m; i++) { const ph = i / m * C.RAMP_A; add(C.RAMP_X + Rr * Math.sin(ph), Rr * (1 - Math.cos(ph)), C.LOOP_Z, TAU + ph, 1 / Rr, 0); }
    return pts;
  }
  const PTS = buildPath(), LEN = PTS[PTS.length - 1].s;
  function sample(s) {
    const f = clamp(s / C.DS, 0, PTS.length - 1.001), i = Math.floor(f), t = f - i, a = PTS[i], b = PTS[i + 1];
    const l = k => a[k] + (b[k] - a[k]) * t;
    return { x: l('x'), y: l('y'), z: l('z'), th: l('th'), k: a.k, yaw: l('yaw') };
  }

  /* ================= physics state ================= */
  const S = {};
  function resetState() {
    Object.assign(S, { mode: 'idle', t: 0, greenAt: 3, lit: 0, s: 0, v: 0, x: 0, y: 0, z: 0, th: 0, yaw: 0, w: 0, vx: 0, vy: 0,
      rt: null, q: 0, vmax: 36, air: 0, rot: 0, flips: 0, dist: 0, wheel: 0, landing: null, impact: 0, suspT: 9, suspA: 0,
      why: '', crashT: 0, result: null, ev: [], tookOff: false });
  }
  resetState();
  const wheelMin = () => Math.min(S.y + -1.45 * Math.sin(S.th) + 0.36 * Math.cos(S.th), S.y + 1.45 * Math.sin(S.th) + 0.36 * Math.cos(S.th)) - 0.36;
  const BODY = [[-2.05, 0.3], [2.05, 0.3], [-0.9, 1.2], [0.9, 1.2]];
  const bodyMin = () => { let m = 1e9; for (const [lx, ly] of BODY) m = Math.min(m, S.y + lx * Math.sin(S.th) + ly * Math.cos(S.th)); return m; };

  function beginRun() { resetState(); S.mode = 'lights'; S.greenAt = 2.5 + 0.7 + Math.random() * 1.0; }
  function launch(rt) {
    S.rt = rt; S.q = clamp(1 - rt / 0.6, 0, 1); S.v = 4 + 12 * S.q; S.vmax = 36 + 8 * S.q; S.mode = 'drive'; S.ev.push('launch');
  }
  function tooEarly() { S.mode = 'toosearly'; S.ev.push('early'); }
  function applyPoint(p) { S.x = p.x; S.y = p.y; S.z = p.z; S.th = p.th; S.yaw = p.yaw; }
  function detach(p, why) {
    S.mode = 'air'; S.vx = S.v * Math.cos(p.th); S.vy = S.v * Math.sin(p.th); applyPoint(p); S.th = wrap(p.th);
    S.w = 0; S.rot = 0; S.air = 0; S.tookOff = why === 'ramp'; S.ev.push(why === 'ramp' ? 'takeoff' : 'detach');
  }
  function stepDrive(dt) {
    const p = sample(S.s);
    S.v += (C.ACC * Math.max(0, 1 - S.v / S.vmax) - G * Math.sin(p.th) - 0.0007 * S.v * S.v) * dt;
    if (S.v < 0) S.v = 0;
    const N = S.v * S.v * p.k + G * Math.cos(p.th);               // track contact force (loop needs v^2/R >= g at the top)
    if ((p.k > 0 && N < 0) || (S.v < 1.2 && Math.sin(p.th) > 0.2)) { detach(p, 'loop'); S.why = 'LOST GRIP IN LOOP'; return; }
    S.s += S.v * dt;
    if (S.s >= LEN - 0.01) { S.s = LEN; detach(PTS[PTS.length - 1], 'ramp'); return; }
    applyPoint(sample(S.s)); S.dist = S.x; S.wheel += S.v * dt;
  }
  function crash(why) {
    S.mode = 'crashed'; S.why = (!S.tookOff && S.why) ? S.why : why; S.crashT = 0;
    S.w = Math.min(S.w, 0) - 1.2; S.ev.push('crash');
  }
  function touchdown() {
    S.th = wrap(S.th);
    const a = Math.abs(S.th); S.impact = -S.vy; S.flips = Math.floor((Math.abs(S.rot) + 0.8) / TAU);
    if (a <= C.LAND_TOL && S.vx > 1) {
      S.mode = 'landed'; S.vy = 0; S.suspT = 0; S.suspA = clamp(S.impact * 0.012, 0.06, 0.3);
      S.landing = a < 0.12 ? 'PERFECT' : a < 0.26 ? 'CLEAN' : 'ROUGH'; S.ev.push('land');
    } else crash(a > 1.2 ? 'ROLLED OVER' : (S.th < 0 ? 'NOSE DIVE' : 'TAIL SLAM'));
  }
  function stepAir(dt, inp) {
    S.vy -= G * dt; S.x += S.vx * dt; S.y += S.vy * dt; S.air += dt; S.dist = S.x;
    const ctl = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);        // left = nose up, right = nose down
    S.w += (ctl * C.ROT + 0.1 * Math.sin(Math.atan2(S.vy, S.vx) - S.th)) * dt;   // weak aero stability
    S.w *= 1 - 0.7 * dt; S.th += S.w * dt; S.rot += S.w * dt; S.wheel += S.vx * dt * 0.5;
    if (S.x > C.WALL_X - 4) { crash('HIT THE WALL'); return; }
    if (S.vy <= 0 && Math.min(wheelMin(), bodyMin()) <= 0) touchdown();
  }
  function stepLanded(dt) {
    S.th += (0 - S.th) * (1 - Math.exp(-9 * dt));
    S.vx = Math.max(0, S.vx - 11 * dt); S.x += S.vx * dt; S.dist = S.x; S.wheel += S.vx * dt; S.suspT += dt;
    S.y = 0; S.y = -wheelMin();
    if (S.vx < 0.4) { S.vx = 0; finish(); }
  }
  function stepCrash(dt) {
    S.crashT += dt; S.vy -= G * dt; S.x += S.vx * dt; S.y += S.vy * dt; S.th += S.w * dt; S.dist = S.x;
    const m = Math.min(wheelMin(), bodyMin());
    if (m < 0) {
      S.y -= m;
      if (S.vy < 0) { if (-S.vy > 3) S.ev.push('bounce'); S.vy = -S.vy * 0.3; if (S.vy < 1) S.vy = 0; S.vx *= 0.8; S.w *= 0.6; }
    }
    if (m < 0.05) { S.vx *= Math.max(0, 1 - 1.6 * dt); S.w *= Math.max(0, 1 - 3 * dt); }
    if ((S.crashT > 1 && Math.abs(S.vx) < 0.5 && Math.abs(S.w) < 0.3 && m < 0.1) || S.crashT > 7) finish();
  }
  function finish() {
    if (S.mode === 'finished') return;
    const landed = S.mode === 'landed', d = Math.max(0, Math.round(S.x));
    const bd = { dist: Math.round(d * (landed ? 10 : 4)), air: Math.round(S.air * 150), flips: landed ? S.flips * 750 : 0,
      react: Math.max(0, Math.round((0.6 - (S.rt || 0.6)) * 2500)), land: landed ? { PERFECT: 1500, CLEAN: 800, ROUGH: 300 }[S.landing] : 0 };
    if (!landed) bd.air = 0;
    S.result = { landed, dist: d, bd, total: bd.dist + bd.air + bd.flips + bd.react + bd.land, why: S.why };
    S.mode = 'finished'; S.ev.push('finish');
  }
  function liveScore() { return Math.round(Math.max(0, S.x) * 10 + S.air * 150); }
  function update(dt, inp) {
    switch (S.mode) {
      case 'drive': stepDrive(dt); break;
      case 'air': stepAir(dt, inp); break;
      case 'landed': stepLanded(dt); break;
      case 'crashed': stepCrash(dt); break;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { C, S, PTS, LEN, sample, resetState, beginRun, launch, tooEarly, update, liveScore };
  }
  if (typeof THREE === 'undefined' || typeof document === 'undefined') {
    if (typeof document !== 'undefined') {
      const d = document.createElement('div'); d.className = 'fatal';
      d.textContent = 'Could not load Three.js. Check your internet connection and reload.'; document.body.appendChild(d);
    }
    return;
  }

  /* ================= renderer / scene ================= */
  const $ = id => document.getElementById(id);
  const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050b);
  scene.fog = new THREE.FogExp2(0x050a14, 0.0028);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);

  function tex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // reflection environment (neon strips + soft boxes) so the paint and glass have something to reflect
  const envTex = tex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b1a36'); gr.addColorStop(.5, '#05080f'); gr.addColorStop(1, '#020305');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) { g.fillStyle = i % 2 ? '#00ff9c' : '#18a8ff'; g.fillRect(rnd(0, w), rnd(h * .3, h * .62), rnd(20, 90), rnd(3, 9)); }
    g.fillStyle = '#cfe6ff'; g.fillRect(w * .18, h * .08, 110, 18); g.fillRect(w * .62, h * .12, 80, 14);
  });
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTex).texture; pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0x2a4a80, 0x07080c, 0.7));
  const moon = new THREE.DirectionalLight(0x7f9cff, 0.55); moon.position.set(-80, 120, 60); scene.add(moon);

  /* ---------- materials ---------- */
  const glow = (c, i = 1.6) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: i });
  const GREEN = 0x00ff9c, BLUE = 0x18a8ff;
  const roadTex = tex(256, 512, (g, w, h) => {
    g.fillStyle = '#0d1015'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.01, 0.05)})`; g.fillRect(rnd(0, w), rnd(0, h), 2, 2); }
    g.fillStyle = 'rgba(190,225,255,.75)';
    for (const u of [w / 3, w * 2 / 3]) for (let y = 0; y < h; y += 128) g.fillRect(u - 3, y, 6, 64);
    g.fillStyle = '#2d3a46'; g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);
  }, true);
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.42, metalness: 0.35, side: THREE.DoubleSide });

  /* ---------- track ribbon ---------- */
  function ribbon(z0, z1, nOff, mat, uvLen) {
    const n = PTS.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
    for (let i = 0; i < n; i++) {
      const p = PTS[i], nx = -Math.sin(p.th), ny = Math.cos(p.th);
      for (let j = 0; j < 2; j++) {
        const o = j ? z1 : z0, k = (i * 2 + j);
        pos[k * 3] = p.x + nx * nOff; pos[k * 3 + 1] = p.y + ny * nOff; pos[k * 3 + 2] = p.z + o;
        uv[k * 2] = j; uv[k * 2 + 1] = p.s / uvLen;
      }
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }
  const hw = C.W / 2;
  scene.add(ribbon(-hw, hw, 0, roadMat, 16));
  scene.add(ribbon(-hw - 0.2, -hw + 0.12, 0.04, glow(GREEN, 2), 16));
  scene.add(ribbon(hw - 0.12, hw + 0.2, 0.04, glow(BLUE, 2), 16));

  // ramp support body
  (function () {
    const sh = new THREE.Shape(); const rp = PTS.filter(p => p.x >= C.RAMP_X);
    sh.moveTo(C.RAMP_X, 0); rp.forEach(p => sh.lineTo(p.x, p.y - 0.08)); sh.lineTo(rp[rp.length - 1].x, 0); sh.lineTo(C.RAMP_X, 0);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: C.W, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0x141a21, roughness: 0.5, metalness: 0.7 }));
    m.position.z = C.LOOP_Z - hw; scene.add(m);
    const lip = rp[rp.length - 1], ln = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, C.W + 0.4), glow(GREEN, 2.5));
    ln.position.set(lip.x, lip.y, C.LOOP_Z); ln.rotation.z = lip.th; scene.add(ln);
  })();

  /* ---------- ground + landing strip ---------- */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ color: 0x07090d, roughness: 0.5, metalness: 0.45 }));
  ground.rotation.x = -PI / 2; ground.position.set(300, -0.03, 0); scene.add(ground);
  const stripLen = C.WALL_X - 230, stripW = 34;
  const stripTex = tex(512, 256, (g, w, h) => {
    g.fillStyle = '#0c0f14'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.01, 0.04)})`; g.fillRect(rnd(0, w), rnd(0, h), 2, 2); }
    g.fillStyle = '#18a8ff'; g.fillRect(0, 4, w, 5); g.fillStyle = '#00ff9c'; g.fillRect(0, h - 9, w, 5);
    g.strokeStyle = 'rgba(0,255,156,.55)'; g.lineWidth = 7;
    for (const cx of [90, 250, 410]) { g.beginPath(); g.moveTo(cx - 20, h / 2 - 34); g.lineTo(cx + 14, h / 2); g.lineTo(cx - 20, h / 2 + 34); g.stroke(); }
  }, true);
  stripTex.repeat.set(stripLen / 40, 1);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(stripLen, stripW), new THREE.MeshStandardMaterial({ map: stripTex, roughness: 0.4, metalness: 0.4 }));
  strip.rotation.x = -PI / 2; strip.position.set(230 + stripLen / 2, 0, C.LOOP_Z); scene.add(strip);
  // pre-ramp tarmac under start runway
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(C.RAMP_X + 60, 40), new THREE.MeshStandardMaterial({ color: 0x0a0c11, roughness: 0.6, metalness: 0.3 }));
  pad.rotation.x = -PI / 2; pad.position.set((C.RAMP_X + 60) / 2 - 30, -0.01, 3); scene.add(pad);

  function label(text, w = 256, h = 128, size = 64) {
    return tex(w, h, (g, W, H) => { g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(8,12,16,.8)'; g.fillRect(0, 0, W, H); g.strokeStyle = '#00ff9c'; g.lineWidth = 5; g.strokeRect(3, 3, W - 6, H - 6);
      g.fillStyle = '#e9fff6'; g.font = `700 ${size}px Orbitron, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2); });
  }
  for (let x = 250; x <= 550; x += 50) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: label(x + ' m'), transparent: true }));
    sp.position.set(x, 4, C.LOOP_Z + 19); scene.add(sp);
    const lg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), glow(BLUE, 1)); lg.position.set(x, 2, C.LOOP_Z + 19); scene.add(lg);
  }

  /* ---------- big neon walls (loop backdrop + finish barrier) ---------- */
  function wall(w, h, text, x, y, z, ry) {
    const t = tex(1024, 512, (g, W, H) => {
      g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(24,168,255,.55)'; g.lineWidth = 2;
      for (let x1 = 0; x1 <= W; x1 += 64) { g.beginPath(); g.moveTo(x1, 0); g.lineTo(x1, H); g.stroke(); }
      for (let y1 = 0; y1 <= H; y1 += 64) { g.beginPath(); g.moveTo(0, y1); g.lineTo(W, y1); g.stroke(); }
      g.fillStyle = '#00ff9c'; g.shadowColor = '#00ff9c'; g.shadowBlur = 30; g.font = '900 120px Orbitron, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2);
      g.lineWidth = 14; g.strokeStyle = '#00ff9c'; g.strokeRect(10, 10, W - 20, H - 20);
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2), new THREE.MeshStandardMaterial({ color: 0x0a0d12, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.85, roughness: 0.6, metalness: 0.5 }));
    m.position.set(x, y, z); m.rotation.y = ry || 0; scene.add(m); return m;
  }
  wall(96, 48, 'ROADSTER LOOP', C.LOOP_X, 24, -12, 0);
  wall(60, 24, 'FINISH', C.WALL_X, 12, C.LOOP_Z, -PI / 2);

  /* ---------- gantries, arches, posts ---------- */
  const lampMats = [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x000000, emissiveIntensity: 3 }));
  (function () {
    const dark = new THREE.MeshStandardMaterial({ color: 0x151b22, roughness: 0.4, metalness: 0.8 });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), dark); p.position.set(9, 3.5, s * (hw + 1)); scene.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.3, C.W + 3), dark); beam.position.set(9, 6.9, 0); scene.add(beam);
    lampMats.forEach((m, i) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), m); l.position.set(8.5, 6.9, -2.7 + i * 1.8); scene.add(l); });
    const ln = new THREE.Mesh(new THREE.PlaneGeometry(1.2, C.W), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    ln.rotation.x = -PI / 2; ln.position.set(3, 0.04, 0); scene.add(ln);
  })();
  [24, 44].forEach((x, i) => {
    const a = new THREE.Mesh(new THREE.TorusGeometry(hw + 0.8, 0.13, 8, 56, PI), glow(i % 2 ? BLUE : GREEN, 2.2));
    a.rotation.y = PI / 2; a.position.set(x, 0, 0); scene.add(a);
  });
  (function () {
    const geo = new THREE.CylinderGeometry(0.12, 0.16, 9, 8), headG = new THREE.BoxGeometry(1.6, 0.2, 0.5);
    const pm = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.6, metalness: 0.6 });
    const hm = [glow(0xbfe3ff, 2.4), glow(0x6fe0ff, 2.4)];
    for (let x = 0; x <= C.WALL_X; x += 30) {
      if (x > 38 && x < 105) continue;
      const zc = x < C.LOOP_X ? 0 : C.LOOP_Z, off = x < 230 ? hw + 3 : 18;
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(geo, pm), h = new THREE.Mesh(headG, hm[(x / 30 + (s > 0 ? 1 : 0)) & 1]);
        p.position.set(x, 4.5, zc + s * off); h.position.set(x, 9, zc + s * (off - 0.6)); scene.add(p, h);
      }
    }
  })();

  /* ---------- skyline + stars + moon ---------- */
  (function () {
    const winTex = tex(64, 128, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) if (Math.random() < 0.34) { const r = Math.random(); g.fillStyle = r < .5 ? '#ffd89a' : r < .75 ? '#6fd8ff' : '#9cffd0'; g.fillRect(x, y, 4, 4); }
    }, true);
    const mat = new THREE.MeshStandardMaterial({ color: 0x090c12, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.9, roughness: 0.8 });
    for (let i = 0; i < 110; i++) {
      const w = rnd(14, 38), h = rnd(30, 140), d = rnd(14, 38), geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 14, uv.getY(k) * h / 14);
      const m = new THREE.Mesh(geo, mat), side = Math.random() < 0.5 ? -1 : 1;
      m.position.set(rnd(-120, 760), h / 2, 4 + side * rnd(150, 380)); scene.add(m);
    }
    const sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) { const a = rnd(0, TAU), e = rnd(0.12, 1.35), r = 1400; sp[i * 3] = 300 + Math.cos(a) * Math.cos(e) * r; sp[i * 3 + 1] = Math.sin(e) * r; sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 2.2, sizeAttenuation: false, fog: false })));
    const mo = new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdfe9ff, fog: false }));
    mo.position.set(-300, 520, -1100); scene.add(mo);
  })();

  /* ================= the car ================= */
  const glowTex = tex(64, 64, (g, w, h) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(160,210,255,.45)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const car = new THREE.Group(); car.rotation.order = 'YZX';
  const bodyGrp = new THREE.Group(); car.add(bodyGrp);
  const wheels = [];
  (function () {
    const paint = new THREE.MeshStandardMaterial({ color: 0x161b22, metalness: 0.95, roughness: 0.16, envMapIntensity: 1.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x03060a, metalness: 1, roughness: 0.04, envMapIntensity: 2 });
    const sh = new THREE.Shape();
    sh.moveTo(-2.25, 0.3); sh.lineTo(-2.28, 0.62); sh.quadraticCurveTo(-2.2, 0.88, -1.6, 0.92); sh.lineTo(-0.9, 0.96);
    sh.quadraticCurveTo(0.2, 1.0, 1.0, 0.88); sh.lineTo(1.25, 0.8); sh.quadraticCurveTo(2.0, 0.66, 2.2, 0.48); sh.lineTo(2.22, 0.3);
    sh.lineTo(1.7, 0.22); sh.lineTo(-1.7, 0.22); sh.lineTo(-2.25, 0.3);
    const bg = new THREE.ExtrudeGeometry(sh, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 4, curveSegments: 14 });
    bg.translate(0, 0, -0.75); bodyGrp.add(new THREE.Mesh(bg, paint));
    const cs = new THREE.Shape();
    cs.moveTo(-1.25, 0.9); cs.quadraticCurveTo(-0.85, 1.43, 0.0, 1.47); cs.quadraticCurveTo(0.65, 1.42, 1.1, 0.86); cs.lineTo(-1.25, 0.9);
    const cg = new THREE.ExtrudeGeometry(cs, { depth: 1.05, bevelEnabled: true, bevelThickness: 0.13, bevelSize: 0.1, bevelSegments: 4, curveSegments: 16 });
    cg.translate(0, 0.02, -0.525); bodyGrp.add(new THREE.Mesh(cg, glass));
    const add = (g, m, x, y, z, rz) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); if (rz) o.rotation.z = rz; bodyGrp.add(o); return o; };
    const head = glow(0xd8f0ff, 4), tail = glow(0xff1830, 3), gr = glow(GREEN, 2.5), bl = glow(BLUE, 2.5);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.1, 0.07, 0.42), head, 2.17, 0.6, s * 0.52, -0.5);
      add(new THREE.BoxGeometry(3.0, 0.03, 0.02), bl, 0, 0.5, s * 1.0);
      add(new THREE.BoxGeometry(0.28, 0.12, 0.2), paint, 0.9, 0.98, s * 1.0);
      const hs = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      hs.position.set(2.3, 0.6, s * 0.52); hs.scale.set(1.8, 1.8, 1); bodyGrp.add(hs);
    }
    add(new THREE.BoxGeometry(0.05, 0.08, 1.55), tail, -2.3, 0.7, 0);
    add(new THREE.BoxGeometry(3.3, 0.04, 1.4), gr, 0, 0.2, 0);
    add(new THREE.BoxGeometry(0.4, 0.05, 1.7), paint, -2.05, 0.98, 0);
    const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 32); tire.rotateX(PI / 2);
    const rim = new THREE.CylinderGeometry(0.25, 0.25, 0.32, 6); rim.rotateX(PI / 2);
    const spoke = new THREE.BoxGeometry(0.5, 0.05, 0.34), tm = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.85 });
    const rm = new THREE.MeshStandardMaterial({ color: 0x9aa7b4, metalness: 1, roughness: 0.2 });
    for (const x of [-1.45, 1.45]) for (const z of [-0.88, 0.88]) {
      const w = new THREE.Group(); w.position.set(x, 0.36, z);
      const spin = new THREE.Group(); spin.add(new THREE.Mesh(tire, tm), new THREE.Mesh(rim, rm));
      for (let k = 0; k < 3; k++) { const s2 = new THREE.Mesh(spoke, gr); s2.rotation.z = k * PI / 3; spin.add(s2); }
      w.add(spin); car.add(w); wheels.push(spin);
    }
    const hl = new THREE.SpotLight(0xdfeaff, 3, 110, 0.45, 0.7, 1.2); hl.position.set(2, 0.7, 0); car.add(hl);
    const tg = new THREE.Object3D(); tg.position.set(40, 0.2, 0); car.add(tg); hl.target = tg;
    const ug = new THREE.PointLight(GREEN, 1.6, 9); ug.position.set(0, 0.1, 0); car.add(ug);
  })();
  scene.add(car);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6, 3),
    new THREE.MeshBasicMaterial({ map: tex(64, 64, (g, w, h) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(0,0,0,.9)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }), transparent: true, depthWrite: false }));
  shadow.rotation.x = -PI / 2; scene.add(shadow);

  /* ================= particles + effects ================= */
  const NP = 520, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP), pMax = new Float32Array(NP), pBase = new Float32Array(NP * 3);
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); pts.frustumCulled = false; scene.add(pts);
  let pHead = 0;
  function emit(x, y, z, n, spd, up, col, life) {
    for (let i = 0; i < n; i++) {
      const k = pHead; pHead = (pHead + 1) % NP;
      pPos[k * 3] = x; pPos[k * 3 + 1] = y; pPos[k * 3 + 2] = z;
      const a = rnd(0, TAU), s = rnd(0.2, 1) * spd;
      pVel[k * 3] = Math.cos(a) * s + rnd(-2, 2); pVel[k * 3 + 1] = rnd(0.3, 1) * up; pVel[k * 3 + 2] = Math.sin(a) * s;
      pLife[k] = pMax[k] = life * rnd(0.6, 1); const c = col[(Math.random() * col.length) | 0];
      pBase[k * 3] = (c >> 16 & 255) / 255; pBase[k * 3 + 1] = (c >> 8 & 255) / 255; pBase[k * 3 + 2] = (c & 255) / 255;
    }
  }
  function updateParticles(dt) {
    for (let i = 0; i < NP; i++) {
      if (pLife[i] <= 0) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; continue; }
      pLife[i] -= dt; pVel[i * 3 + 1] -= 9 * dt;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] = Math.max(0.05, pPos[i * 3 + 1] + pVel[i * 3 + 1] * dt); pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      const f = Math.max(0, pLife[i] / pMax[i]); pCol[i * 3] = pBase[i * 3] * f; pCol[i * 3 + 1] = pBase[i * 3 + 1] * f; pCol[i * 3 + 2] = pBase[i * 3 + 2] * f;
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  }
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  shock.rotation.x = -PI / 2; scene.add(shock); let shockT = 9;
  const boom = new THREE.PointLight(0xff7a2a, 0, 45); scene.add(boom); let boomI = 0;

  /* ================= audio (WebAudio, no files) ================= */
  const Aud = {
    ctx: null, muted: false,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = c.createGain(); this.master.gain.value = 0.55; this.master.connect(c.destination);
        this.o1 = c.createOscillator(); this.o1.type = 'sawtooth'; this.f1 = c.createBiquadFilter(); this.f1.type = 'lowpass'; this.f1.frequency.value = 420;
        this.g1 = c.createGain(); this.g1.gain.value = 0; this.o1.connect(this.f1); this.f1.connect(this.g1); this.g1.connect(this.master);
        this.o2 = c.createOscillator(); this.o2.type = 'sine'; this.g2 = c.createGain(); this.g2.gain.value = 0; this.o2.connect(this.g2); this.g2.connect(this.master);
        this.o1.start(); this.o2.start();
        const len = c.sampleRate * 1.5, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.nb = b;
      } catch (e) { this.ctx = null; }
    },
    setMute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; },
    engine(f, on) {
      if (!this.ctx) return; const t = this.ctx.currentTime;
      this.o1.frequency.setTargetAtTime(50 + f * 120, t, 0.08); this.o2.frequency.setTargetAtTime(220 + f * 1000, t, 0.08);
      this.g1.gain.setTargetAtTime(on ? 0.05 + f * 0.05 : 0.012, t, 0.1); this.g2.gain.setTargetAtTime(on ? 0.025 + f * 0.04 : 0.004, t, 0.1);
    },
    beep(f, d, type = 'sine', v = 0.2) {
      if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.02);
    },
    sweep(f0, f1, d, type = 'sawtooth', v = 0.2) {
      if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.02);
    },
    noise(d, f0, f1, v = 0.3, type = 'lowpass') {
      if (!this.ctx) return; const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
      s.buffer = this.nb; fl.type = type; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + d);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t); s.stop(t + d + 0.02);
    },
    tick() { this.beep(520, 0.2, 'square', 0.12); }, go() { this.beep(1040, 0.55, 'square', 0.16); },
    early() { this.beep(130, 0.6, 'sawtooth', 0.22); this.beep(98, 0.6, 'square', 0.12); },
    launch() { this.sweep(160, 1100, 0.9, 'sawtooth', 0.12); this.noise(0.5, 3000, 300, 0.12); },
    jump() { this.noise(0.9, 400, 3500, 0.2, 'bandpass'); this.sweep(300, 900, 0.5, 'sine', 0.1); },
    land() { this.sweep(140, 38, 0.35, 'sine', 0.5); this.noise(0.3, 2500, 200, 0.25); [660, 880, 1320].forEach((f, i) => setTimeout(() => this.beep(f, 0.3, 'triangle', 0.12), 120 + i * 90)); },
    crash() { this.noise(1.3, 3500, 90, 0.55); this.sweep(110, 30, 0.8, 'sawtooth', 0.35); },
    bounce() { this.noise(0.18, 1800, 150, 0.25); }
  };

  /* ================= UI ================= */
  const el = { menu: $('menu'), hud: $('hud'), res: $('result'), lights: $('lights'), banner: $('banner'), bt: $('bannerTitle'), bs: $('bannerSub'),
    dist: $('distVal'), score: $('scoreVal'), best: $('bestVal'), speed: $('speedVal'), react: $('reactVal'), air: $('airVal'), airBox: $('airBox'), gauge: $('gaugeFg'),
    flash: $('flash'), fx: $('speedfx'), touch: $('touch') };
  const lamps = [...el.lights.children];
  let best = 0; try { best = +localStorage.getItem('roadsterLoopBest') || 0; } catch (e) {}
  el.best.textContent = best;
  let bannerTimer = 0;
  function banner(title, sub, cls, ms) {
    el.banner.className = ''; void el.banner.offsetWidth; el.bt.textContent = title; el.bs.textContent = sub || '';
    el.banner.className = 'show ' + (cls || 'info'); clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => { el.banner.classList.remove('show'); el.banner.classList.add('hide'); }, ms);
  }
  const hideBanner = () => { clearTimeout(bannerTimer); el.banner.className = ''; };
  function flash(bad) { el.flash.className = ''; void el.flash.offsetWidth; el.flash.className = 'on' + (bad ? ' bad' : ''); }
  const cache = {}; const setT = (k, e, v) => { if (cache[k] !== v) { cache[k] = v; e.textContent = v; } };

  /* ================= input ================= */
  const input = { left: false, right: false }; let lockUntil = 0, greenStamp = 0, started = false;
  const now = () => performance.now() / 1000;
  function pressLaunch() {
    if (!started || now() < lockUntil) return; lockUntil = now() + C.LOCK;
    if (S.mode === 'lights') { tooEarly(); }
    else if (S.mode === 'ready') { launch((performance.now() - greenStamp) / 1000); }
    else if (S.mode === 'toosearly' || S.mode === 'finished') restart();
  }
  function restart() {
    Aud.init(); started = true; el.menu.hidden = true; el.res.hidden = true; el.hud.hidden = false; el.touch.hidden = false;
    beginRun(); lockUntil = now() + 0.2; hideBanner(); lamps.forEach(l => l.className = 'lamp'); el.lights.classList.add('show');
    el.react.textContent = '–'; el.react.classList.remove('bad'); camSnap = true;
  }
  addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) pressLaunch(); }
    else if (e.code === 'ArrowLeft') { input.left = true; e.preventDefault(); }
    else if (e.code === 'ArrowRight') { input.right = true; e.preventDefault(); }
    else if (e.code === 'KeyR' && started) restart();
    else if (e.code === 'KeyM') toggleMute();
    else if (e.code === 'Enter' && !started) restart();
  });
  addEventListener('keyup', e => { if (e.code === 'ArrowLeft') input.left = false; if (e.code === 'ArrowRight') input.right = false; });
  const hold = (id, fn) => { const b = $(id); ['pointerdown'].forEach(t => b.addEventListener(t, e => { e.preventDefault(); fn(true); })); ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, () => fn(false))); };
  hold('tLeft', v => input.left = v); hold('tRight', v => input.right = v); hold('tGo', v => { if (v) pressLaunch(); });
  $('startBtn').addEventListener('click', restart); $('restartBtn').addEventListener('click', restart); $('againBtn').addEventListener('click', restart);
  function toggleMute() { Aud.setMute(!Aud.muted); $('muteBtn').textContent = Aud.muted ? 'Sound off' : 'Sound on'; }
  $('muteBtn').addEventListener('click', toggleMute);
  document.addEventListener('visibilitychange', () => { if (document.hidden && Aud.ctx) Aud.engine(0, false); });

  /* ================= game events -> sound / fx / UI ================= */
  let shake = 0;
  function handleEvents() {
    while (S.ev.length) {
      const e = S.ev.shift();
      if (e === 'launch') {
        Aud.launch(); hideBanner(); lamps.forEach(l => l.className = 'lamp'); el.react.textContent = S.rt.toFixed(3);
        banner(S.rt < 0.25 ? 'LIGHTNING START' : S.rt < 0.45 ? 'GOOD LAUNCH' : 'SLOW LAUNCH', 'Reaction ' + S.rt.toFixed(3) + ' s', S.rt < 0.45 ? 'good' : 'info', 1300);
        setTimeout(() => el.lights.classList.remove('show'), 600); shake = 0.25;
      } else if (e === 'early') {
        Aud.early(); el.react.textContent = 'EARLY'; el.react.classList.add('bad'); flash(true);
        banner('TOO EARLY', 'Wait for the green light. Press Space to try again.', 'bad'); lamps.forEach(l => l.className = 'lamp red');
      } else if (e === 'takeoff') {
        Aud.jump(); banner('AIRBORNE', 'Left / Right to rotate. Land level.', 'info', 1800); shake = 0.4;
      } else if (e === 'detach') {
        Aud.jump(); banner('LOST GRIP', S.why, 'bad', 1800);
      } else if (e === 'land') {
        Aud.land(); flash(false); shake = 0.9; shockT = 0; shock.position.set(S.x, 0.06, S.z); shock.material.color.setHex(GREEN);
        emit(S.x, 0.2, S.z, 90, 11, 5, [0x00ff9c, 0x18a8ff, 0xffffff], 1.1);
        banner(S.landing + ' LANDING', (S.flips ? S.flips + ' flip' + (S.flips > 1 ? 's' : '') + ' · ' : '') + 'Air time ' + S.air.toFixed(1) + ' s', 'good', 2200);
      } else if (e === 'crash') {
        Aud.crash(); flash(true); shake = 1.6; boomI = 6; boom.position.set(S.x, 2, S.z);
        emit(S.x, 0.6, S.z, 190, 15, 11, [0xff7a2a, 0xffd36a, 0xffffff, 0xff3b4e], 1.5);
        banner('CRASH', S.why, 'bad', 2400);
      } else if (e === 'bounce') { Aud.bounce(); emit(S.x, 0.3, S.z, 24, 7, 6, [0xffb04a, 0xffffff], 0.8); shake = Math.max(shake, 0.5); }
      else if (e === 'finish') showResult();
    }
  }
  function showResult() {
    const r = S.result, b = r.bd;
    if (r.total > best) { best = r.total; try { localStorage.setItem('roadsterLoopBest', best); } catch (e) {} el.best.textContent = best; }
    $('resTitle').textContent = r.landed ? 'Landing stuck' : 'Run over'; $('resSub').textContent = r.landed ? S.landing.toLowerCase() + ' landing at ' + r.dist + ' m' : (r.why || 'Crash') + ' at ' + r.dist + ' m';
    $('rDist').textContent = r.dist + ' m (+' + b.dist + ')'; $('rAir').textContent = S.air.toFixed(1) + ' s (+' + b.air + ')'; $('rFlip').textContent = (r.landed ? S.flips : 0) + ' (+' + b.flips + ')';
    $('rReact').textContent = '+' + b.react; $('rLand').textContent = '+' + b.land; $('rTotal').textContent = r.total;
    el.res.querySelector('.result-card').className = 'result-card' + (r.landed ? '' : ' crash'); el.score.textContent = r.total;
    setTimeout(() => { if (S.mode === 'finished') el.res.hidden = false; }, 900);
  }

  /* ================= camera ================= */
  const camPos = new THREE.Vector3(-9, 4, 0), camLook = new THREE.Vector3(10, 1, 0), want = new THREE.Vector3(), wantL = new THREE.Vector3();
  let camSnap = true, fov = 62;
  function updateCamera(dt, t) {
    let k = 3, tf = 62; const sp = Math.hypot(S.mode === 'drive' ? S.v : S.vx, S.vy);
    switch (S.mode) {
      case 'idle': { const a = t * 0.25; want.set(S.x - 2 + Math.cos(a) * 7.5, 2.4, S.z + Math.sin(a) * 7.5); wantL.set(S.x, 0.8, S.z); k = 2; break; }
      case 'lights': case 'ready': case 'toosearly': want.set(S.x - 8.5, 3.3, S.z); wantL.set(S.x + 12, 1.4, S.z); break;
      case 'drive':
        if (S.s > C.LOOP_X - 16 && S.s < C.LOOP_X + TAU * C.LOOP_R + 6) { want.set(C.LOOP_X - 8 + (S.x - C.LOOP_X) * 0.25, C.LOOP_R * 0.9, 4.5 + 33); wantL.set(S.x, S.y + 1, S.z); tf = 58; k = 3; }
        else { want.set(S.x - 9.5 - S.v * 0.06, S.y * 0.6 + 3.4, S.z); wantL.set(S.x + 10, S.y + 1.2, S.z); tf = 62 + sp * 0.35; k = 4; }
        break;
      case 'air': want.set(S.x - 17, S.y * 0.65 + 5.5, S.z + 22); wantL.set(S.x + S.vx * 0.35, S.y + S.vy * 0.15, S.z); tf = 72; k = 2.2; break;
      case 'landed': want.set(S.x - 13, 3.8, S.z + 11); wantL.set(S.x + 5, 1, S.z); k = 3; break;
      default: want.set(S.x - 14, 6, S.z + 14); wantL.set(S.x, 1, S.z); k = 2.5;
    }
    const a = camSnap ? 1 : 1 - Math.exp(-k * dt), b = camSnap ? 1 : 1 - Math.exp(-6 * dt); camSnap = false;
    camPos.lerp(want, a); camLook.lerp(wantL, b); fov += (tf - fov) * (1 - Math.exp(-2 * dt));
    shake *= Math.exp(-4 * dt);
    camera.position.set(camPos.x + (Math.random() - .5) * shake * 0.3, camPos.y + (Math.random() - .5) * shake * 0.3, camPos.z + (Math.random() - .5) * shake * 0.3);
    camera.lookAt(camLook); camera.fov = fov; camera.updateProjectionMatrix();
  }

  /* ================= main loop ================= */
  function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; if (w / h < 0.8) camera.fov = 75; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  let last = performance.now(), clock = 0, kick = 0;
  function frame(tNow) {
    const dt = Math.min(0.05, (tNow - last) / 1000); last = tNow; clock += dt;
    // sequencing
    if (S.mode === 'lights') {
      S.t += dt; const marks = [0.9, 1.7, 2.5];
      while (S.lit < 3 && S.t >= marks[S.lit]) { lamps[S.lit].className = 'lamp red'; lampMats[S.lit].emissive.setHex(0xff2030); lampMats[S.lit].color.setHex(0xff2030); S.lit++; Aud.tick(); }
      if (S.t >= S.greenAt) { lamps[3].className = 'lamp green'; lampMats[3].emissive.setHex(0x00ff9c); lampMats[3].color.setHex(0x00ff9c); S.mode = 'ready'; greenStamp = performance.now(); Aud.go(); banner('GO!', 'Press Space', 'good', 700); }
    } else if (S.mode === 'ready') {
      const rt = (performance.now() - greenStamp) / 1000; el.react.textContent = rt.toFixed(3);
      if (rt > C.GREEN_MAX) { launch(C.GREEN_MAX); }
    }
    const before = S.mode; update(dt, input);
    if (S.mode === 'lights' || S.mode === 'idle') for (let i = S.lit; i < 4; i++) { lampMats[i].emissive.setHex(0x000000); lampMats[i].color.setHex(0x050505); }
    if (S.mode === 'drive' && before === 'ready') kick = 0.06;
    handleEvents();

    // car pose
    car.position.set(S.x, S.y, S.z); car.rotation.set(0, S.yaw, S.th);
    kick *= Math.exp(-3 * dt);
    const sus = S.mode === 'landed' ? S.suspA * Math.exp(-5 * S.suspT) * Math.cos(14 * S.suspT) : 0;
    bodyGrp.position.y = -sus * 0.5; bodyGrp.rotation.z = -kick + sus * 0.1;
    const spd = S.mode === 'drive' ? S.v : Math.abs(S.vx);
    wheels.forEach(w => { w.rotation.z = -S.wheel / 0.36; });
    // shadow
    const showSh = S.mode === 'air' || S.mode === 'landed' || S.mode === 'crashed' || S.mode === 'finished';
    shadow.visible = showSh; shadow.position.set(S.x, 0.04, S.z); const h = Math.max(0, S.y); shadow.scale.setScalar(1 + h * 0.04); shadow.material.opacity = clamp(1 - h / 40, 0.1, 0.8);
    // fx
    if (shockT < 1) { shockT += dt * 1.4; shock.scale.setScalar(1 + shockT * 26); shock.material.opacity = Math.max(0, 0.85 * (1 - shockT)); }
    boomI *= Math.exp(-5 * dt); boom.intensity = boomI;
    if (S.mode === 'landed' && spd > 5 && Math.random() < 0.7) emit(S.x - 1.4, 0.15, S.z + rnd(-0.9, 0.9), 2, 2, 1.5, [0x00ff9c, 0xffffff], 0.5);
    if (S.mode === 'drive' && S.v > 6 && S.y < 0.1 && Math.random() < 0.3) emit(S.x - 2.2, 0.1, S.z, 1, 1, 1, [0x18a8ff], 0.4);
    updateParticles(dt); updateCamera(dt, clock);

    // HUD
    const kmh = Math.round((S.mode === 'air' || S.mode === 'crashed' ? Math.hypot(S.vx, S.vy) : spd) * 3.6);
    setT('speed', el.speed, kmh); el.gauge.style.strokeDasharray = (245 * clamp(kmh / 200, 0, 1)).toFixed(1) + ' 400';
    setT('dist', el.dist, Math.max(0, Math.round(S.x))); if (S.mode !== 'finished') setT('score', el.score, liveScore());
    el.fx.style.opacity = clamp((kmh - 70) / 140, 0, 0.9).toFixed(2);
    const inAir = S.mode === 'air'; el.airBox.classList.toggle('on', inAir);
    setT('air', el.air, inAir ? S.air.toFixed(1) + 's · ' + Math.round(wrap(S.th) * 180 / PI) + '°' : '–');
    Aud.engine(clamp(spd / 44, 0, 1), S.mode === 'drive' || S.mode === 'landed');
    renderer.render(scene, camera); requestAnimationFrame(frame);
  }
  resetState(); S.mode = 'idle'; requestAnimationFrame(frame);
  if (typeof window !== 'undefined') window.__roadster = { S, C };
})();
