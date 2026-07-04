/* ============================================================================
   GameCube Graphics — interactive layer
   Everything you see is drawn live in your browser with the 2D canvas API —
   including the "3D": the transform, rasterisation, texturing, lighting,
   z-buffer and TEV labs all run their own tiny software pipelines, exactly
   the algorithms the course describes. No WebGL, no libraries, and no game
   assets ship with this page; every image is procedural.
   ============================================================================ */
'use strict';

/* ------------------------------------------------------------- helpers ---- */
const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* Size a canvas's bitmap to its CSS box × devicePixelRatio (capped at 2 so
   phones don't burn battery on 3× pixels nobody can see). Returns the dpr. */
function fit(canvas, dprMax = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, dprMax);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  return dpr;
}

/* Tell a lab when it scrolls into / out of view so animations can pause.
   cb(visible) fires on every transition; assume visible if IO is missing. */
function whenVisible(el, cb) {
  if (!('IntersectionObserver' in window)) { cb(true); return; }
  const obs = new IntersectionObserver(
    es => es.forEach(e => cb(e.isIntersecting)),
    { rootMargin: '100px' }
  );
  obs.observe(el);
}

/* segmented buttons: exclusive selection within one .seg-btns group.
   onPick(value) is called with the picked button's data-* value. */
function segGroup(group, attr, onPick) {
  group.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    group.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    onPick(b.dataset[attr], b);
  }));
}

/* tiny 3-vector helpers for the software-3D labs */
const V3 = {
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  rotX(p, s, c) { return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; },
  rotY(p, s, c) { return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; },
};

/* ==========================================================================
   Module 01 — pixel-grid lab
   A scene is painted onto an N×N offscreen canvas, its pixels are read back,
   channel-masked, and blown up with image smoothing OFF so each pixel is a
   visible square. Hovering reads out one pixel's three numbers.
   ========================================================================== */
function PixelLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const resR = root.querySelector('[data-res]');
  const resV = root.querySelector('[data-res-val]');
  const info = root.querySelector('[data-pix-info]');
  const chans = { r: true, g: true, b: true };
  const off = document.createElement('canvas');
  const octx = off.getContext('2d', { willReadFrequently: true });
  let img = null, N = 0, dpr = 1;

  function n() { return Math.pow(2, parseInt(resR.value, 10)); }

  /* the scene — sky, sun, hills and a smiley, all vector shapes so it can be
     re-painted crisply at ANY grid size from 8×8 up */
  function paintScene(s) {
    const g = octx;
    g.clearRect(0, 0, s, s);
    const sky = g.createLinearGradient(0, 0, 0, s);
    sky.addColorStop(0, '#3a68d8'); sky.addColorStop(0.72, '#7fb0ef');
    g.fillStyle = sky; g.fillRect(0, 0, s, s);
    // sun
    g.fillStyle = '#ffd23e';
    g.beginPath(); g.arc(s * 0.78, s * 0.2, s * 0.11, 0, 7); g.fill();
    // hills
    g.fillStyle = '#3f9e52';
    g.beginPath(); g.arc(s * 0.22, s * 1.18, s * 0.5, 0, 7); g.fill();
    g.fillStyle = '#2f7c40';
    g.beginPath(); g.arc(s * 0.85, s * 1.28, s * 0.55, 0, 7); g.fill();
    // smiley
    g.fillStyle = '#ffcf3b';
    g.beginPath(); g.arc(s * 0.42, s * 0.47, s * 0.2, 0, 7); g.fill();
    g.fillStyle = '#20203a';
    g.beginPath(); g.arc(s * 0.35, s * 0.42, s * 0.032, 0, 7); g.fill();
    g.beginPath(); g.arc(s * 0.49, s * 0.42, s * 0.032, 0, 7); g.fill();
    g.strokeStyle = '#20203a'; g.lineWidth = Math.max(1, s * 0.022); g.lineCap = 'round';
    g.beginPath(); g.arc(s * 0.42, s * 0.48, s * 0.11, 0.35, Math.PI - 0.35); g.stroke();
  }

  function rebuild() {
    N = n();
    off.width = off.height = N;
    paintScene(N);
    img = octx.getImageData(0, 0, N, N);
    resV.textContent = N + ' × ' + N;
    draw();
    defaultInfo();
  }

  function defaultInfo() {
    const bytes = N * N * 3;
    info.innerHTML = '<b>' + N + ' × ' + N + '</b> = ' + (N * N).toLocaleString('en-GB')
      + ' pixels · 3 bytes each → <b>' + (bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B')
      + '</b> of framebuffer · hover a pixel to read its numbers';
  }

  function draw() {
    dpr = fit(canvas);
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // channel-masked copy
    const view = new ImageData(new Uint8ClampedArray(img.data), N, N);
    const d = view.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!chans.r) d[i] = 0;
      if (!chans.g) d[i + 1] = 0;
      if (!chans.b) d[i + 2] = 0;
    }
    off.width = off.height = N;           // reuse offscreen as the blit source
    octx.putImageData(view, 0, 0);
    const size = Math.min(W, H) - 16 * dpr;
    const x0 = (W - size) / 2, y0 = (H - size) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, x0, y0, size, size);
    // grid lines while pixels are big enough to see individually
    if (N <= 32) {
      ctx.strokeStyle = 'rgba(12,10,19,0.55)';
      ctx.lineWidth = 1;
      for (let i = 1; i < N; i++) {
        const t = x0 + size * i / N;
        ctx.beginPath(); ctx.moveTo(t, y0); ctx.lineTo(t, y0 + size); ctx.stroke();
        const u = y0 + size * i / N;
        ctx.beginPath(); ctx.moveTo(x0, u); ctx.lineTo(x0 + size, u); ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(57,47,87,0.9)';
    ctx.strokeRect(x0, y0, size, size);
    canvas.__geo = { x0, y0, size };
    // restore full-colour pixels in the offscreen for the hover readout
    octx.putImageData(img, 0, 0);
  }

  canvas.addEventListener('pointermove', e => {
    const g = canvas.__geo; if (!g) return;
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    const cx = Math.floor((px - g.x0) / g.size * N), cy = Math.floor((py - g.y0) / g.size * N);
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) { defaultInfo(); return; }
    const i = (cy * N + cx) * 4, d = img.data;
    info.innerHTML = 'pixel (' + cx + ', ' + cy + ') = '
      + '<b style="color:#ff5f6a">R ' + d[i] + '</b> · '
      + '<b style="color:#5fd18b">G ' + d[i + 1] + '</b> · '
      + '<b style="color:#6aa8ff">B ' + d[i + 2] + '</b>';
  });
  canvas.addEventListener('pointerleave', defaultInfo);

  root.querySelectorAll('.chan-btns button').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('on');
    chans[b.dataset.ch] = b.classList.contains('on');
    draw();
  }));
  resR.addEventListener('input', rebuild);
  window.addEventListener('resize', draw);
  rebuild();
}

/* ==========================================================================
   Module 03 — transform & projection lab
   A wireframe cube pushed through the whole Module 03 chain by hand:
   rotate (model→world), translate away from the camera (world→view), then
   either perspective-divide or orthographic-flatten onto the screen.
   ========================================================================== */
function TransformLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const rx = root.querySelector('[data-rx]'), ry = root.querySelector('[data-ry]');
  const tz = root.querySelector('[data-tz]'), fov = root.querySelector('[data-fov]');
  const rxV = root.querySelector('[data-rx-val]'), ryV = root.querySelector('[data-ry-val]');
  const tzV = root.querySelector('[data-tz-val]'), fovV = root.querySelector('[data-fov-val]');
  let persp = true;

  const VERTS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

  function draw() {
    const dpr = fit(canvas);
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    const ax = parseFloat(rx.value) * Math.PI / 180, ay = parseFloat(ry.value) * Math.PI / 180;
    const dist = parseFloat(tz.value), fv = parseFloat(fov.value) * Math.PI / 180;
    const f = (H * 0.5) / Math.tan(fv / 2);       // perspective focal length
    const orthoS = H / 5.2;                        // fixed orthographic scale
    rxV.textContent = rx.value + '°'; ryV.textContent = ry.value + '°';
    tzV.textContent = (+tz.value).toFixed(1); fovV.textContent = fov.value + '°';

    const sx = Math.sin(ax), cxx = Math.cos(ax), sy = Math.sin(ay), cyy = Math.cos(ay);
    const toView = p => {
      let q = V3.rotX(p, sx, cxx); q = V3.rotY(q, sy, cyy);
      return [q[0], q[1], q[2] + dist];
    };
    const project = v => {
      if (persp) {
        if (v[2] < 0.15) return null;              // behind the near plane
        const s = f / v[2];
        return [cx + v[0] * s, cy + v[1] * s];
      }
      return [cx + v[0] * orthoS, cy + v[1] * orthoS];
    };

    // ground grid (world space — NOT rotated with the cube), y = +1.6
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(168,132,255,0.22)';
    for (let i = -4; i <= 4; i++) {
      const a = project([i, 1.6, Math.max(0.4, dist - 3)]);
      const b = project([i, 1.6, dist + 7]);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }
    for (let j = 0; j <= 8; j++) {
      const z = Math.max(0.4, dist - 3) + j * 1.25;
      const a = project([-4, 1.6, z]), b = project([4, 1.6, z]);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }

    // the cube
    const pts = VERTS.map(toView).map(project);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#45e4d1';
    ctx.shadowColor = '#45e4d1'; ctx.shadowBlur = 9 * dpr;
    EDGES.forEach(([a, b]) => {
      const p = pts[a], q = pts[b];
      if (!p || !q) return;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    });
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff5f9e';
    pts.forEach(p => { if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 3 * dpr, 0, 7); ctx.fill(); } });

    ctx.fillStyle = 'rgba(135,127,158,0.9)';
    ctx.font = (10.5 * dpr) + 'px ui-monospace, Menlo, monospace';
    ctx.fillText(persp ? 'perspective — far edges shrink, grid lines converge' : 'orthographic — depth changes nothing, parallels stay parallel', 12 * dpr, H - 12 * dpr);
  }

  [rx, ry, tz, fov].forEach(el => el.addEventListener('input', draw));
  segGroup(root.querySelector('[data-proj]'), 'mode', m => { persp = m === 'persp'; draw(); });
  window.addEventListener('resize', draw);
  draw();
}

/* ==========================================================================
   Module 04 — rasteriser lab
   A big-pixel grid and one triangle with draggable vertices. Every pixel
   CENTRE is run through the three edge tests; covered pixels light up, and
   in interpolation mode each covered pixel gets its barycentric-weighted
   blend of the three vertex colours.
   ========================================================================== */
function RasterLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const info = root.querySelector('[data-raster-info]');
  const COLS = 26, ROWS = 15;
  let mode = 'coverage', dpr = 1, dragging = -1;
  const verts = [
    { x: 3.4, y: 12.2, c: [69, 228, 209] },
    { x: 12.6, y: 1.8, c: [255, 95, 158] },
    { x: 23.2, y: 11.0, c: [255, 177, 78] },
  ];
  const E = (a, b, px, py) => (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);

  function draw() {
    dpr = fit(canvas);
    const W = canvas.width, H = canvas.height;
    const cell = Math.min(W / COLS, H / ROWS);
    const x0 = (W - cell * COLS) / 2, y0 = (H - cell * ROWS) / 2;
    canvas.__geo = { cell, x0, y0 };
    ctx.clearRect(0, 0, W, H);

    let area = E(verts[0], verts[1], verts[2].x, verts[2].y);
    const sign = area >= 0 ? 1 : -1;
    area = Math.abs(area) || 1e-6;

    let covered = 0;
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        const px = gx + 0.5, py = gy + 0.5;    // the pixel CENTRE
        const w0 = E(verts[1], verts[2], px, py) * sign;
        const w1 = E(verts[2], verts[0], px, py) * sign;
        const w2 = E(verts[0], verts[1], px, py) * sign;
        const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
        if (inside) {
          covered++;
          if (mode === 'interp') {
            const r = (w0 * verts[0].c[0] + w1 * verts[1].c[0] + w2 * verts[2].c[0]) / area;
            const g = (w0 * verts[0].c[1] + w1 * verts[1].c[1] + w2 * verts[2].c[1]) / area;
            const b = (w0 * verts[0].c[2] + w1 * verts[1].c[2] + w2 * verts[2].c[2]) / area;
            ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
          } else {
            ctx.fillStyle = 'rgba(168,132,255,0.75)';
          }
          ctx.fillRect(x0 + gx * cell + 1, y0 + gy * cell + 1, cell - 2, cell - 2);
        }
      }
    }
    // grid + pixel centres
    ctx.strokeStyle = 'rgba(44,37,66,0.9)'; ctx.lineWidth = 1;
    for (let i = 0; i <= COLS; i++) { const x = x0 + i * cell; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + ROWS * cell); ctx.stroke(); }
    for (let j = 0; j <= ROWS; j++) { const y = y0 + j * cell; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + COLS * cell, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(135,127,158,0.55)';
    for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
      ctx.beginPath(); ctx.arc(x0 + (gx + 0.5) * cell, y0 + (gy + 0.5) * cell, 1.4 * dpr, 0, 7); ctx.fill();
    }
    // triangle outline (the "true" mathematical edges)
    const P = v => [x0 + v.x * cell, y0 + v.y * cell];
    ctx.strokeStyle = 'rgba(236,232,246,0.9)'; ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    const p0 = P(verts[0]); ctx.moveTo(p0[0], p0[1]);
    [1, 2, 0].forEach(i => { const p = P(verts[i]); ctx.lineTo(p[0], p[1]); });
    ctx.stroke();
    // draggable vertices
    verts.forEach(v => {
      const p = P(v);
      ctx.fillStyle = 'rgb(' + v.c.join(',') + ')';
      ctx.strokeStyle = '#0c0a13'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(p[0], p[1], 7 * dpr, 0, 7); ctx.fill(); ctx.stroke();
    });
    info.innerHTML = '<b>' + covered + '</b> of ' + (COLS * ROWS)
      + ' pixel centres pass all three edge tests — drag the vertices';
  }

  function toGrid(e) {
    const r = canvas.getBoundingClientRect(), g = canvas.__geo;
    return {
      x: ((e.clientX - r.left) * dpr - g.x0) / g.cell,
      y: ((e.clientY - r.top) * dpr - g.y0) / g.cell,
    };
  }
  canvas.addEventListener('pointerdown', e => {
    const p = toGrid(e);
    let best = -1, bd = 2.2;
    verts.forEach((v, i) => { const d = Math.hypot(v.x - p.x, v.y - p.y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { dragging = best; canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  canvas.addEventListener('pointermove', e => {
    if (dragging < 0) return;
    const p = toGrid(e);
    verts[dragging].x = clamp(p.x, 0.2, COLS - 0.2);
    verts[dragging].y = clamp(p.y, 0.2, ROWS - 0.2);
    draw();
  });
  canvas.addEventListener('pointerup', () => { dragging = -1; });
  segGroup(root.querySelector('[data-rmode]'), 'mode', m => { mode = m; draw(); });
  window.addEventListener('resize', draw);
  draw();
}

/* ==========================================================================
   Module 05 — texture-filter lab
   A checkerboard floor receding to a horizon, textured per-pixel in software
   with a real perspective divide, under three sampling schemes:
   nearest, bilinear, and bilinear + mipmaps. The slow scroll makes the
   difference brutal: nearest shimmers, no-mipmap sparkles in the distance,
   mipmaps trade the sparkle for calm (slightly blurrier) far ground.
   ========================================================================== */
function TextureLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const playBtn = root.querySelector('[data-tex-play]');
  const IW = 340, IH = 190;
  const off = document.createElement('canvas');
  off.width = IW; off.height = IH;
  const octx = off.getContext('2d');
  const out = octx.createImageData(IW, IH);
  let filter = 'mip', playing = !REDUCED, visible = false, raf = null, t = 0, last = 0;

  /* ---- build the texture + its mip chain (RGB, 64×64 down to 1×1) ------- */
  const TS = 64;
  const mips = [];
  {
    const base = new Uint8ClampedArray(TS * TS * 3);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const i = (y * TS + x) * 3;
      const check = ((x >> 3) + (y >> 3)) & 1;
      let r = check ? 232 : 38, g = check ? 232 : 34, b = check ? 240 : 56;
      if (x % 32 === 0 || y % 32 === 0) { r = 255; g = 95; b = 158; }   // thin magenta rules — the shimmer bait
      base[i] = r; base[i + 1] = g; base[i + 2] = b;
    }
    mips.push({ d: base, s: TS });
    let s = TS, cur = base;
    while (s > 1) {
      const ns = s >> 1, nd = new Uint8ClampedArray(ns * ns * 3);
      for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
        for (let c = 0; c < 3; c++) {
          nd[(y * ns + x) * 3 + c] = (
            cur[((2 * y) * s + 2 * x) * 3 + c] + cur[((2 * y) * s + 2 * x + 1) * 3 + c] +
            cur[((2 * y + 1) * s + 2 * x) * 3 + c] + cur[((2 * y + 1) * s + 2 * x + 1) * 3 + c]) >> 2;
        }
      }
      mips.push({ d: nd, s: ns });
      s = ns; cur = nd;
    }
  }
  const wrap = (v, s) => { v = v % s; return v < 0 ? v + s : v; };
  function texel(m, x, y, c) { return m.d[(wrap(y, m.s) * m.s + wrap(x, m.s)) * 3 + c]; }
  function bilerp(m, u, v, c) {
    const x = Math.floor(u - 0.5), y = Math.floor(v - 0.5);
    const fx = u - 0.5 - x, fy = v - 0.5 - y;
    const a = texel(m, x, y, c), b = texel(m, x + 1, y, c);
    const d = texel(m, x, y + 1, c), e = texel(m, x + 1, y + 1, c);
    return (a + (b - a) * fx) + ((d + (e - d) * fx) - (a + (b - a) * fx)) * fy;
  }

  function render() {
    const d = out.data;
    const horizon = IH * 0.24;
    const camH = 30;                     // "eye height" in texel units
    for (let y = 0; y < IH; y++) {
      const row = y * IW * 4;
      if (y <= horizon) {                // sky
        const k = y / horizon;
        for (let x = 0; x < IW; x++) {
          const i = row + x * 4;
          d[i] = 16 + 14 * k; d[i + 1] = 13 + 12 * k; d[i + 2] = 30 + 26 * k; d[i + 3] = 255;
        }
        continue;
      }
      const z = camH / (y - horizon);                  // perspective: depth of this row
      const du = z * 0.62;                             // texels per screen pixel on this row
      let level = 0, mA = mips[0], mB = mips[0], lf = 0;
      if (filter === 'mip') {
        const l = clamp(Math.log2(Math.max(du, 1e-6)), 0, mips.length - 1.001);
        level = Math.floor(l); lf = l - level;
        mA = mips[level]; mB = mips[Math.min(level + 1, mips.length - 1)];
      }
      const vRow = z * 20 + t;                         // scrolls toward the camera
      for (let x = 0; x < IW; x++) {
        const u = (x - IW / 2) * du + 32.3;
        const i = row + x * 4;
        let r, g, b;
        if (filter === 'nearest') {
          const m = mips[0];
          r = texel(m, Math.floor(u), Math.floor(vRow), 0);
          g = texel(m, Math.floor(u), Math.floor(vRow), 1);
          b = texel(m, Math.floor(u), Math.floor(vRow), 2);
        } else if (filter === 'bilinear') {
          r = bilerp(mips[0], u, vRow, 0); g = bilerp(mips[0], u, vRow, 1); b = bilerp(mips[0], u, vRow, 2);
        } else {
          const sA = 1 / mips[0].s * mA.s, sB = 1 / mips[0].s * mB.s;   // scale UVs into each level
          for (let c = 0; c < 3; c++) {
            const a = bilerp(mA, u * sA, vRow * sA, c);
            const bb = bilerp(mB, u * sB, vRow * sB, c);
            const v = a + (bb - a) * lf;
            if (c === 0) r = v; else if (c === 1) g = v; else b = v;
          }
        }
        // fade the far ground slightly into the sky so the horizon isn't a hard cut
        const fog = clamp((z - 18) / 30, 0, 0.55);
        d[i] = r + (30 - r) * fog; d[i + 1] = g + (25 - g) * fog; d[i + 2] = b + (56 - b) * fog;
        d[i + 3] = 255;
      }
    }
    octx.putImageData(out, 0, 0);
    fit(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function frame(ts) {
    raf = null;
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    t += dt * 9;                                       // scroll speed, texels/s
    render();
    if (playing && visible) raf = requestAnimationFrame(frame);
  }
  function kick() { if (playing && visible && !raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function syncBtn() {
    playBtn.innerHTML = (playing ? ICON_STOP : ICON_PLAY) + (playing ? ' Pause scroll' : ' Scroll the floor');
  }
  playBtn.addEventListener('click', () => { playing = !playing; syncBtn(); kick(); if (!playing) render(); });
  segGroup(root.querySelector('[data-filter]'), 'f', f => { filter = f; render(); });
  whenVisible(root, v => { visible = v; kick(); });
  window.addEventListener('resize', render);
  syncBtn();
  render();
}

/* ==========================================================================
   Module 06 — lighting lab
   A latitude/longitude sphere lit per-vertex with the classic
   ambient + diffuse(N·L) + specular(N·H) recipe, then filled per-face.
   "Flat" lights each face once with its face normal (you see the facets);
   "Gouraud" lights the corner vertices and blends — the mesh melts smooth,
   but watch the specular highlight go soft and blotchy: the era's tell.
   ========================================================================== */
function LightLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const amb = root.querySelector('[data-amb]'), dif = root.querySelector('[data-diff]'), spe = root.querySelector('[data-spec]');
  const ambV = root.querySelector('[data-amb-val]'), difV = root.querySelector('[data-diff-val]'), speV = root.querySelector('[data-spec-val]');
  let shade = 'gouraud', az = 0.9, el = 0.5, dragging = false;

  // mesh: unit sphere, LAT bands × LON slices
  const LAT = 13, LON = 22;
  const ring = [];
  for (let i = 0; i <= LAT; i++) {
    const th = Math.PI * i / LAT, r = [];
    for (let j = 0; j < LON; j++) {
      const ph = 2 * Math.PI * j / LON;
      r.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]);
    }
    ring.push(r);
  }
  const BASE = [172, 138, 255];          // the sphere's own colour (GameCube violet)

  function lightAt(nrm, L, H, ka, kd, ks) {
    const ndl = Math.max(0, V3.dot(nrm, L));
    const ndh = Math.max(0, V3.dot(nrm, H));
    const s = ks * Math.pow(ndh, 34);
    return [
      clamp(BASE[0] * (ka + kd * ndl) + 255 * s, 0, 255),
      clamp(BASE[1] * (ka + kd * ndl) + 255 * s, 0, 255),
      clamp(BASE[2] * (ka + kd * ndl) + 255 * s, 0, 255),
    ];
  }

  function draw() {
    const dpr = fit(canvas);
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const ka = amb.value / 100, kd = dif.value / 100, ks = spe.value / 100;
    ambV.textContent = ka.toFixed(2); difV.textContent = kd.toFixed(2); speV.textContent = ks.toFixed(2);
    const L = V3.norm([Math.cos(el) * Math.sin(az), -Math.sin(el), Math.cos(el) * Math.cos(az)]);
    const HV = V3.norm([L[0], L[1], L[2] + 1]);        // half-vector, view = (0,0,1)
    const R = Math.min(W, H) * 0.38, cx = W / 2, cy = H / 2 + 4 * dpr;
    const P = v => [cx + v[0] * R, cy - v[1] * R];

    // tilt the sphere a touch so the pole isn't dead centre
    const s0 = Math.sin(0.35), c0 = Math.cos(0.35);
    const tilt = v => V3.rotX(v, s0, c0);

    for (let i = 0; i < LAT; i++) {
      for (let j = 0; j < LON; j++) {
        const j2 = (j + 1) % LON;
        const quad = [ring[i][j], ring[i][j2], ring[i + 1][j2], ring[i + 1][j]].map(tilt);
        // face normal ≈ average of the corner normals (a unit sphere's vertex
        // normal IS its position — one of geometry's small gifts)
        const fn = V3.norm([
          quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0],
          quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1],
          quad[0][2] + quad[1][2] + quad[2][2] + quad[3][2]]);
        if (fn[2] <= 0.001) continue;                  // back-face cull
        let col;
        if (shade === 'flat') {
          col = lightAt(fn, L, HV, ka, kd, ks);
        } else {
          let r = 0, g = 0, b = 0;
          quad.forEach(v => { const c = lightAt(v, L, HV, ka, kd, ks); r += c[0]; g += c[1]; b += c[2]; });
          col = [r / 4, g / 4, b / 4];
        }
        const css = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
        ctx.fillStyle = css; ctx.strokeStyle = css; ctx.lineWidth = 1;
        ctx.beginPath();
        const p0 = P(quad[0]); ctx.moveTo(p0[0], p0[1]);
        for (let k = 1; k < 4; k++) { const p = P(quad[k]); ctx.lineTo(p[0], p[1]); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    // light marker: a little sun on the light's side of the sphere
    const lm = [cx + L[0] * R * 1.32, cy - L[1] * R * 1.32];
    ctx.fillStyle = '#ffb14e'; ctx.shadowColor = '#ffb14e'; ctx.shadowBlur = 14 * dpr;
    ctx.beginPath(); ctx.arc(lm[0], lm[1], 6.5 * dpr, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,177,78,0.5)'; ctx.lineWidth = 1.2 * dpr; ctx.setLineDash([4 * dpr, 5 * dpr]);
    ctx.beginPath(); ctx.moveTo(lm[0], lm[1]); ctx.lineTo(cx + L[0] * R, cy - L[1] * R); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(135,127,158,0.9)';
    ctx.font = (10.5 * dpr) + 'px ui-monospace, Menlo, monospace';
    ctx.fillText('drag anywhere to move the light', 12 * dpr, H - 12 * dpr);
  }

  function setLight(e) {
    const r = canvas.getBoundingClientRect();
    az = ((e.clientX - r.left) / r.width - 0.5) * 3.6;
    el = ((e.clientY - r.top) / r.height - 0.5) * 2.4;
    draw();
  }
  canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); setLight(e); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => { if (dragging) setLight(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  [amb, dif, spe].forEach(el2 => el2.addEventListener('input', draw));
  segGroup(root.querySelector('[data-shade]'), 'mode', m => { shade = m; draw(); });
  window.addEventListener('resize', draw);
  draw();
}

/* ==========================================================================
   Module 07 — z-buffer lab
   Two triangles that genuinely intersect in depth, rasterised in software
   with interpolated z. Painter's mode draws whole triangles in list order
   (whoever is drawn last wins everywhere); z-buffer mode tests every pixel.
   The alpha slider shows why transparency ruins the z-buffer's party.
   ========================================================================== */
function ZBufferLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const alphaR = root.querySelector('[data-alpha]');
  const alphaV = root.querySelector('[data-alpha-val]');
  const info = root.querySelector('[data-z-info]');
  const IW = 320, IH = 180;
  const off = document.createElement('canvas'); off.width = IW; off.height = IH;
  const octx = off.getContext('2d');
  const img = octx.createImageData(IW, IH);
  const zbuf = new Float32Array(IW * IH);
  let mode = 'zbuffer', order = 0;   // order 0: cyan first, 1: magenta first

  // two slabs crossing in an X when seen from above; z: 0 (near) … 1 (far)
  const triCyan = {
    v: [[34, 30, 0.15], [34, 152, 0.15], [296, 92, 0.85]],
    c: [69, 228, 209], a: 1,
  };
  const triMag = {
    v: [[288, 22, 0.15], [288, 160, 0.15], [26, 92, 0.85]],
    c: [255, 95, 158], a: 1,
  };

  function rasterise(tri, useZ) {
    const [A, B, C] = tri.v;
    const E = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    let area = E(A, B, C[0], C[1]);
    const sg = area >= 0 ? 1 : -1; area = Math.abs(area) || 1e-6;
    const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
    const maxX = Math.min(IW - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
    const maxY = Math.min(IH - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const d = img.data;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = E(B, C, px, py) * sg, w1 = E(C, A, px, py) * sg, w2 = E(A, B, px, py) * sg;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = (w0 * A[2] + w1 * B[2] + w2 * C[2]) / area;
        const idx = y * IW + x, i = idx * 4;
        if (useZ && z >= zbuf[idx]) continue;          // depth test: keep the nearer pixel
        if (useZ) zbuf[idx] = z;                        // …and transparent pixels STILL write z
        const shade = 1 - z * 0.55;                     // darken with distance so depth reads
        const sr = tri.c[0] * shade, sgg = tri.c[1] * shade, sb = tri.c[2] * shade;
        const a = tri.a;
        d[i] = d[i] * (1 - a) + sr * a;
        d[i + 1] = d[i + 1] * (1 - a) + sgg * a;
        d[i + 2] = d[i + 2] * (1 - a) + sb * a;
        d[i + 3] = 255;
      }
    }
  }

  function draw() {
    triMag.a = alphaR.value / 100;
    alphaV.textContent = alphaR.value + ' %';
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = 9; d[i + 1] = 7; d[i + 2] = 16; d[i + 3] = 255; }
    zbuf.fill(Infinity);
    const list = order === 0 ? [triCyan, triMag] : [triMag, triCyan];
    list.forEach(t => rasterise(t, mode === 'zbuffer'));
    octx.putImageData(img, 0, 0);
    fit(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    const first = list[0] === triCyan ? 'cyan' : 'magenta';
    const last = list[1] === triCyan ? 'cyan' : 'magenta';
    if (mode === 'painter') {
      info.innerHTML = 'painter&rsquo;s algorithm · drawn ' + first + ' → ' + last
        + ' — <b>' + last + ' wins everywhere it covers</b>, even where it is actually behind';
    } else {
      info.innerHTML = 'z-buffer · every pixel keeps whichever surface is <b>nearer</b> — draw order '
        + (triMag.a < 1 ? 'stops mattering for opaque pixels, but watch the see-through one misbehave'
          : 'no longer matters; the crossing appears');
    }
  }

  segGroup(root.querySelector('[data-zmode]'), 'mode', m => { mode = m; draw(); });
  root.querySelector('[data-swap]').addEventListener('click', () => { order = 1 - order; draw(); });
  alphaR.addEventListener('input', draw);
  window.addEventListener('resize', draw);
  draw();
}

/* ==========================================================================
   Module 11 — TEV combiner lab
   One real TEV colour stage: pick each of the four inputs a, b, c, d from
   { texture, rasterised colour, constant, 0, 1 }, and the output canvas is
   computed per pixel as  a·(1−c) + b·c + d  — the exact blend Flipper's
   texture-environment stages run 16 of, back to back.
   ========================================================================== */
function TevLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const konstIn = root.querySelector('[data-konst]');
  const OW = 260, OH = 150;                            // output resolution
  const off = document.createElement('canvas'); off.width = OW; off.height = OH;
  const octx = off.getContext('2d');
  const img = octx.createImageData(OW, OH);
  const sel = { a: 'zero', b: 'tex', c: 'ras', d: 'zero' };

  /* -- procedural inputs, precomputed at output resolution ----------------- */
  const texBuf = new Float32Array(OW * OH * 3);
  const rasBuf = new Float32Array(OW * OH * 3);
  {
    // texture: grey stone bricks with mortar lines + speckle
    let seed = 40503;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
      const i = (y * OW + x) * 3;
      const row = Math.floor(y / 26);
      const xo = x + (row % 2 ? 22 : 0);
      const mortar = (y % 26 < 3) || (xo % 44 < 3);
      let v = mortar ? 0.16 : 0.55 + 0.16 * Math.sin(row * 3.1 + Math.floor(xo / 44) * 1.7);
      v += (rnd() - 0.5) * 0.07;
      texBuf[i] = clamp(v * 1.02, 0, 1);
      texBuf[i + 1] = clamp(v * 0.94, 0, 1);
      texBuf[i + 2] = clamp(v * 1.1, 0, 1);
    }
    // rasterised (per-vertex) colour: a warm light falling from the upper left,
    // as if vertex lighting had already run — bright hotspot fading to shadow
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
      const i = (y * OW + x) * 3;
      const dx = x / OW - 0.28, dy = y / OH - 0.24;
      const v = clamp(1.15 - Math.hypot(dx * 1.4, dy) * 1.9, 0.05, 1);
      rasBuf[i] = v; rasBuf[i + 1] = v * 0.9; rasBuf[i + 2] = v * 0.82;
    }
  }
  function konstRGB() {
    const h = konstIn.value;
    return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  }
  function inputAt(name, i, k) {
    switch (name) {
      case 'tex': return [texBuf[i], texBuf[i + 1], texBuf[i + 2]];
      case 'ras': return [rasBuf[i], rasBuf[i + 1], rasBuf[i + 2]];
      case 'konst': return k;
      case 'one': return [1, 1, 1];
      default: return [0, 0, 0];
    }
  }

  function render() {
    const k = konstRGB();
    const d = img.data;
    for (let p = 0, i = 0, j = 0; p < OW * OH; p++, i += 3, j += 4) {
      const a = inputAt(sel.a, i, k), b = inputAt(sel.b, i, k), c = inputAt(sel.c, i, k), dd = inputAt(sel.d, i, k);
      for (let ch = 0; ch < 3; ch++) {
        d[j + ch] = clamp(a[ch] * (1 - c[ch]) + b[ch] * c[ch] + dd[ch], 0, 1) * 255;
      }
      d[j + 3] = 255;
    }
    octx.putImageData(img, 0, 0);

    const dpr = fit(canvas);
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    // input thumbnails across the top
    const names = ['a', 'b', 'c', 'd'];
    const tw = Math.min(120 * dpr, (W - 60 * dpr) / 4), th2 = tw * 0.62, gap = (W - tw * 4) / 5;
    ctx.font = 700 + ' ' + (10 * dpr) + 'px ui-monospace, Menlo, monospace';
    names.forEach((nm, ni) => {
      const x = gap + ni * (tw + gap), y = 8 * dpr;
      drawInputThumb(ctx, sel[nm], x, y, tw, th2, k);
      ctx.strokeStyle = 'rgba(57,47,87,1)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, tw, th2);
      ctx.fillStyle = '#a884ff';
      ctx.fillText(nm + ' = ' + sel[nm], x, y + th2 + 13 * dpr);
    });
    // arrow + output
    const oy = 8 * dpr + th2 + 42 * dpr;
    const oh = H - oy - 8 * dpr;
    const ow = Math.min(W - 16 * dpr, oh * (OW / OH));
    const ox = (W - ow) / 2;
    ctx.fillStyle = 'rgba(135,127,158,0.9)';
    ctx.fillText('out = a·(1−c) + b·c + d', ox, oy - 6 * dpr);
    ctx.drawImage(off, ox, oy, ow, oh);
    ctx.strokeStyle = 'rgba(69,228,209,0.5)'; ctx.lineWidth = 1.4 * dpr; ctx.strokeRect(ox, oy, ow, oh);
  }

  function drawInputThumb(g, name, x, y, w, h, k) {
    if (name === 'tex' || name === 'ras') {
      // reuse the precomputed buffers via a tiny ImageData
      const tW = 64, tH = 40, t = octx.createImageData(tW, tH);
      const src = name === 'tex' ? texBuf : rasBuf;
      for (let yy = 0; yy < tH; yy++) for (let xx = 0; xx < tW; xx++) {
        const si = ((Math.floor(yy * OH / tH)) * OW + Math.floor(xx * OW / tW)) * 3;
        const di = (yy * tW + xx) * 4;
        t.data[di] = src[si] * 255; t.data[di + 1] = src[si + 1] * 255; t.data[di + 2] = src[si + 2] * 255; t.data[di + 3] = 255;
      }
      const tmp = document.createElement('canvas'); tmp.width = tW; tmp.height = tH;
      tmp.getContext('2d').putImageData(t, 0, 0);
      g.drawImage(tmp, x, y, w, h);
    } else {
      const v = name === 'one' ? 255 : name === 'zero' ? 0 : null;
      g.fillStyle = v === null
        ? 'rgb(' + (k[0] * 255 | 0) + ',' + (k[1] * 255 | 0) + ',' + (k[2] * 255 | 0) + ')'
        : 'rgb(' + v + ',' + v + ',' + v + ')';
      g.fillRect(x, y, w, h);
    }
  }

  /* wire the four slot pickers */
  root.querySelectorAll('[data-tev]').forEach(group => {
    segGroup(group, 'src', src => { sel[group.dataset.tev] = src; render(); });
  });
  function setSel(next) {
    Object.assign(sel, next);
    root.querySelectorAll('[data-tev]').forEach(group => {
      group.querySelectorAll('button').forEach(b =>
        b.classList.toggle('on', b.dataset.src === sel[group.dataset.tev]));
    });
    render();
  }
  const PRESETS = {
    modulate: { a: 'zero', b: 'tex', c: 'ras', d: 'zero' },   // tex × lighting
    glow: { a: 'tex', b: 'zero', c: 'zero', d: 'konst' },     // tex + constant glow
    lerp: { a: 'tex', b: 'konst', c: 'ras', d: 'zero' },      // blend two looks by light
  };
  segGroup(root.querySelector('[data-preset]'), 'p', p => setSel(PRESETS[p]));
  konstIn.addEventListener('input', render);
  window.addEventListener('resize', render);
  render();
}

/* ==========================================================================
   Module 12 — CMPR block-compression lab
   A 64×64 procedural image is carved into 4×4 blocks and each block is
   CMPR-encoded live: pick two endpoint colours, derive two more between
   them, and store a 2-bit palette index per texel. The detail panel shows
   the original block, the indices, and the reconstruction side by side.
   ========================================================================== */
function CmprLab(root) {
  const srcC = root.querySelector('.cmpr-src');
  const detC = root.querySelector('.cmpr-detail');
  const sctx = srcC.getContext('2d');
  const dctx = detC.getContext('2d');
  const blockR = root.querySelector('[data-block]');
  const info = root.querySelector('[data-cmpr-info]');
  const sws = root.querySelectorAll('.swatches .sw i');
  const S = 64, BLOCKS = S / 4;                        // 16×16 = 256 blocks

  /* source image: a sky/sun/sea scene — smooth areas (kind to CMPR) plus a
     sharp two-colour boundary and a noisy patch (cruel to CMPR) */
  const src = new Uint8ClampedArray(S * S * 3);
  {
    let seed = 77031;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 3;
      let r, g, b;
      if (y < 36) { const t = y / 36; r = 26 + 90 * t; g = 20 + 40 * t; b = 74 + 90 * t; } // dusk sky
      else { const t = (y - 36) / 28; r = 18 + 24 * t; g = 34 + 60 * t; b = 78 + 60 * t; } // sea
      const dx = x - 44, dy = y - 18, dd = Math.hypot(dx, dy);
      if (dd < 9) { r = 255; g = 190; b = 70; }                                            // hard-edged sun
      else if (dd < 13) { const t = (dd - 9) / 4; r = r * t + 255 * (1 - t); g = g * t + 170 * (1 - t); b = b * t + 90 * (1 - t); }
      if (y > 40 && ((x + y * 2) % 11 < 2)) { r += 46; g += 46; b += 52; }                 // wave glints
      if (x < 18 && y > 46) { const n = rnd() * 70; r = 30 + n; g = 60 + n * 0.8; b = 40 + n * 0.4; } // noisy rocks
      src[i] = clamp(r, 0, 255); src[i + 1] = clamp(g, 0, 255); src[i + 2] = clamp(b, 0, 255);
    }
  }
  const texAt = (x, y) => { const i = (y * S + x) * 3; return [src[i], src[i + 1], src[i + 2]]; };
  const to565 = c => [c[0] >> 3 << 3 | c[0] >> 5, c[1] >> 2 << 2 | c[1] >> 6, c[2] >> 3 << 3 | c[2] >> 5];

  /* encode one 4×4 block the CMPR/DXT1 way (endpoints chosen by the widest
     pair — real encoders search harder, same idea) */
  function encode(bx, by) {
    const texels = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) texels.push(texAt(bx * 4 + x, by * 4 + y));
    let e0 = 0, e1 = 0, best = -1;
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) {
      const a = texels[i], b = texels[j];
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d > best) { best = d; e0 = i; e1 = j; }
    }
    const c0 = to565(texels[e0]), c1 = to565(texels[e1]);
    const pal = [
      c0, c1,
      [Math.round((2 * c0[0] + c1[0]) / 3), Math.round((2 * c0[1] + c1[1]) / 3), Math.round((2 * c0[2] + c1[2]) / 3)],
      [Math.round((c0[0] + 2 * c1[0]) / 3), Math.round((c0[1] + 2 * c1[1]) / 3), Math.round((c0[2] + 2 * c1[2]) / 3)],
    ];
    const idx = texels.map(t => {
      let bi = 0, bd = Infinity;
      pal.forEach((p, pi) => {
        const d = (t[0] - p[0]) ** 2 + (t[1] - p[1]) ** 2 + (t[2] - p[2]) ** 2;
        if (d < bd) { bd = d; bi = pi; }
      });
      return bi;
    });
    return { texels, pal, idx };
  }

  function draw() {
    const bi = parseInt(blockR.value, 10);
    const bx = bi % BLOCKS, by = Math.floor(bi / BLOCKS);
    const enc = encode(bx, by);

    /* --- source panel: whole image + selected block highlighted ---------- */
    const dpr = fit(srcC);
    const W = srcC.width, H = srcC.height;
    sctx.clearRect(0, 0, W, H);
    const size = Math.min(W, H) - 12 * dpr;
    const x0 = (W - size) / 2, y0 = (H - size) / 2;
    const tmp = document.createElement('canvas'); tmp.width = S; tmp.height = S;
    const timg = tmp.getContext('2d').createImageData(S, S);
    for (let p = 0, i = 0, j = 0; p < S * S; p++, i += 3, j += 4) {
      timg.data[j] = src[i]; timg.data[j + 1] = src[i + 1]; timg.data[j + 2] = src[i + 2]; timg.data[j + 3] = 255;
    }
    tmp.getContext('2d').putImageData(timg, 0, 0);
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(tmp, x0, y0, size, size);
    const cs = size / BLOCKS;
    sctx.strokeStyle = '#45e4d1'; sctx.lineWidth = 2 * dpr;
    sctx.strokeRect(x0 + bx * cs, y0 + by * cs, cs, cs);
    srcC.__geo = { x0, y0, size, dpr };

    /* --- detail panel: original | 2-bit indices | reconstructed ---------- */
    const ddpr = fit(detC);
    const DW = detC.width, DH = detC.height;
    dctx.clearRect(0, 0, DW, DH);
    const pane = Math.min((DW - 64 * ddpr) / 3, DH - 46 * ddpr);
    const gy = 30 * ddpr, gapX = (DW - pane * 3) / 4;
    const cell = pane / 4;
    dctx.font = (10 * ddpr) + 'px ui-monospace, Menlo, monospace';
    dctx.fillStyle = '#877f9e';
    const titles = ['original 4×4', '2-bit indices', 'rebuilt'];
    titles.forEach((t, k) => dctx.fillText(t, gapX + k * (pane + gapX), gy - 8 * ddpr));
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const t = enc.texels[y * 4 + x], id = enc.idx[y * 4 + x], p = enc.pal[id];
      // original
      dctx.fillStyle = 'rgb(' + t.join(',') + ')';
      dctx.fillRect(gapX + x * cell, gy + y * cell, cell - 1, cell - 1);
      // index grid
      dctx.fillStyle = '#16121f';
      dctx.fillRect(gapX * 2 + pane + x * cell, gy + y * cell, cell - 1, cell - 1);
      dctx.fillStyle = ['#45e4d1', '#ff5f9e', '#b7afce', '#877f9e'][id];
      dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
      dctx.font = 700 + ' ' + (12 * ddpr) + 'px ui-monospace, Menlo, monospace';
      dctx.fillText(String(id), gapX * 2 + pane + x * cell + cell / 2, gy + y * cell + cell / 2);
      dctx.textAlign = 'start'; dctx.textBaseline = 'alphabetic';
      dctx.font = (10 * ddpr) + 'px ui-monospace, Menlo, monospace';
      // reconstruction
      dctx.fillStyle = 'rgb(' + p.join(',') + ')';
      dctx.fillRect(gapX * 3 + pane * 2 + x * cell, gy + y * cell, cell - 1, cell - 1);
    }
    dctx.fillStyle = '#877f9e';
    dctx.fillText('block (' + bx + ', ' + by + ')  ·  8 bytes: c0 + c1 + 16 × 2-bit indices', gapX, gy + pane + 18 * ddpr);

    /* --- palette swatches + ratio readout --------------------------------- */
    enc.pal.forEach((p, k) => { sws[k].style.background = 'rgb(' + p.join(',') + ')'; });
    info.innerHTML = 'this block: 16 texels × 2 B (RGB565) = <b>32 B</b> raw → <b>8 B</b> CMPR = '
      + '<b>4:1</b> <span class="v">(8:1 vs 32-bit RGBA8)</span> · whole 64×64 texture: 8 KB → <b>2 KB</b>';
  }

  srcC.addEventListener('pointerdown', pick);
  srcC.addEventListener('pointermove', e => { if (e.buttons) pick(e); });
  function pick(e) {
    const g = srcC.__geo; if (!g) return;
    const r = srcC.getBoundingClientRect();
    const px = (e.clientX - r.left) * g.dpr, py = (e.clientY - r.top) * g.dpr;
    const bx = clamp(Math.floor((px - g.x0) / g.size * BLOCKS), 0, BLOCKS - 1);
    const by = clamp(Math.floor((py - g.y0) / g.size * BLOCKS), 0, BLOCKS - 1);
    blockR.value = by * BLOCKS + bx;
    draw();
    e.preventDefault();
  }
  blockR.addEventListener('input', draw);
  window.addEventListener('resize', draw);
  draw();
}

/* ==========================================================================
   Module 14 — specialised vs ubershader lab
   A toy frame-time strip. Draw calls arrive with TEV configurations drawn
   from a drifting distribution (new areas bring new configs). Specialised
   mode compiles a shader on every first sight — a stutter spike. Ubershader
   mode never compiles but every call costs more. Hybrid compiles in the
   background while the ubershader covers the gap.
   ========================================================================== */
function ShaderLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const playBtn = root.querySelector('[data-sim-play]');
  const resetBtn = root.querySelector('[data-sim-reset]');
  const info = root.querySelector('[data-sim-info]');
  let mode = 'spec', playing = !REDUCED, visible = false, raf = null;
  let seed, cache, pool, frames, stutters, frameNo, pending;

  function reset() {
    seed = 123457;
    cache = new Set();
    pool = 6;              // configs seen so far in the "game"
    frames = [];
    stutters = 0;
    frameNo = 0;
    pending = 0;           // hybrid: compiles still running in the background
    drawStrip();
    note();
  }
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  function simFrame() {
    frameNo++;
    // every ~90 frames the "camera walks into a new area": fresh configs appear
    if (frameNo % 90 === 0) pool += 3 + Math.floor(rnd() * 4);
    const calls = 24 + Math.floor(rnd() * 14);
    let ms = 3.2;                                     // fixed per-frame cost
    let compiledThisFrame = 0;
    for (let i = 0; i < calls; i++) {
      // mostly recent configs, occasionally something older
      const cfg = Math.floor(Math.min(pool - 1, Math.max(0, pool - 1 - Math.floor(rnd() * rnd() * pool))));
      const known = cache.has(cfg);
      if (mode === 'uber') {
        ms += 0.22;                                   // every call pays the interpreter tax
      } else if (known) {
        ms += 0.09;                                   // cheap specialised shader
      } else if (mode === 'spec') {
        cache.add(cfg);
        ms += 18 + rnd() * 34;                        // driver compile — the stutter
        compiledThisFrame++;
      } else {                                        // hybrid
        cache.add(cfg); pending++;
        ms += 0.22;                                   // ubershader covers the gap
      }
    }
    if (mode === 'hybrid' && pending > 0) {
      pending = Math.max(0, pending - 2);             // background thread drains the queue
      ms += 0.6;                                      // slight load while compiling
    }
    if (ms > 16.7) stutters++;
    frames.push(ms);
    if (frames.length > 160) frames.shift();
    return compiledThisFrame;
  }

  function drawStrip() {
    const dpr = fit(canvas);
    const W = canvas.width, H = canvas.height, pad = 8 * dpr;
    ctx.clearRect(0, 0, W, H);
    const n = 160, bw = (W - pad * 2) / n;
    const yOf = ms => H - pad - Math.min(1, ms / 60) * (H - pad * 2);
    // 16.7 ms (60 fps) budget line
    ctx.strokeStyle = 'rgba(95,209,139,0.5)'; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, yOf(16.7)); ctx.lineTo(W - pad, yOf(16.7)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#877f9e'; ctx.font = (9.5 * dpr) + 'px ui-monospace, Menlo, monospace';
    ctx.fillText('16.7 ms — one 60 fps frame', pad + 4 * dpr, yOf(16.7) - 4 * dpr);
    frames.forEach((ms, i) => {
      const x = pad + (n - frames.length + i) * bw;
      const y = yOf(ms);
      ctx.fillStyle = ms <= 16.7 ? 'rgba(69,228,209,0.85)' : ms <= 33 ? 'rgba(255,177,78,0.9)' : 'rgba(255,106,106,0.95)';
      ctx.fillRect(x, y, Math.max(1, bw - 1), H - pad - y);
    });
  }

  function note() {
    const m = mode === 'spec' ? 'specialised' : mode === 'uber' ? 'ubershader' : 'hybrid';
    info.innerHTML = '<b>' + m + '</b> · shaders compiled: <b>' + cache.size + '</b>'
      + (mode === 'hybrid' ? ' · compiling in background: <b>' + pending + '</b>' : '')
      + ' · frames over budget: <span class="m">' + stutters + '</span>';
  }

  function frame() {
    raf = null;
    simFrame();
    drawStrip();
    note();
    if (playing && visible) raf = requestAnimationFrame(frame);
  }
  function kick() { if (playing && visible && !raf) raf = requestAnimationFrame(frame); }
  function syncBtn() {
    playBtn.innerHTML = (playing ? ICON_STOP : ICON_PLAY) + (playing ? ' Pause' : ' Run the stream');
  }
  playBtn.addEventListener('click', () => { playing = !playing; syncBtn(); kick(); });
  resetBtn.addEventListener('click', reset);
  segGroup(root.querySelector('[data-sim]'), 'mode', m => {
    mode = m; reset();                                 // same seed → fair comparison
  });
  whenVisible(root, v => { visible = v; kick(); });
  window.addEventListener('resize', drawStrip);
  syncBtn();
  reset();
}

/* ------------------------------------------------------- hero ambient ----- */
/* A slowly tumbling wireframe cube, dissolving into scanlines and stray
   "pixels" — the course's whole arc (geometry → raster) in one ornament.
   Low-opacity (the canvas itself is faded in CSS) and reduced-motion aware. */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let t = 0.6, raf = null, visible = true;
  function size() { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
  size(); window.addEventListener('resize', size);

  const VERTS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

  function draw() {
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const cx = W * 0.76, cy = H * 0.52, R = Math.min(W, H) * 0.34;
    const sy = Math.sin(t * 0.5), cyy = Math.cos(t * 0.5);
    const sx = Math.sin(0.42 + 0.12 * Math.sin(t * 0.23)), cxx = Math.cos(0.42 + 0.12 * Math.sin(t * 0.23));
    const pts = VERTS.map(p => {
      let q = V3.rotY(p, sy, cyy); q = V3.rotX(q, sx, cxx);
      const s = 3.4 / (q[2] + 4.4);
      return [cx + q[0] * R * s, cy + q[1] * R * s, q[2]];
    });
    // edges
    c.lineWidth = 1.4 * dpr;
    EDGES.forEach(([a, b], i) => {
      const p = pts[a], q = pts[b];
      const col = i % 3 === 0 ? 'rgba(255,95,158,0.75)' : i % 3 === 1 ? 'rgba(168,132,255,0.8)' : 'rgba(69,228,209,0.7)';
      c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 8 * dpr;
      c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
      // a few stray "pixels" dissolving off each edge
      const k = (t * 0.9 + i * 0.37) % 1;
      const px = p[0] + (q[0] - p[0]) * k, py = p[1] + (q[1] - p[1]) * k;
      c.fillStyle = col;
      c.fillRect(Math.round(px / (3 * dpr)) * 3 * dpr, Math.round(py / (3 * dpr)) * 3 * dpr, 2.4 * dpr, 2.4 * dpr);
    });
    c.shadowBlur = 0;
    // vertices as chunky pixels
    c.fillStyle = 'rgba(236,232,246,0.85)';
    pts.forEach(p => c.fillRect(p[0] - 1.6 * dpr, p[1] - 1.6 * dpr, 3.2 * dpr, 3.2 * dpr));
    // scanline mask — knock out every third row so it reads like a raster
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = 'rgba(0,0,0,0.5)';
    for (let y = 0; y < H; y += 5 * dpr) c.fillRect(0, y, W, 1.6 * dpr);
    c.restore();
    if (!REDUCED) { t += 0.006; if (visible) raf = requestAnimationFrame(draw); else raf = null; }
  }
  whenVisible(canvas, v => { visible = v; if (v && !raf && !REDUCED) raf = requestAnimationFrame(draw); });
  draw();
}

/* ------------------------------------------------------- glossary tooltips */
/* Every jargon word is wrapped in <span class="term" data-tip="…">. We show
   the definition in a single shared floating bubble on hover, keyboard focus,
   or tap — positioned above the word and clamped so it never leaves the
   viewport. One bubble (rather than a CSS ::after per term) keeps it from
   being clipped by scroll containers and works on touch screens.            */
function initTooltips() {
  const terms = [...document.querySelectorAll('.term[data-tip]')];
  if (!terms.length) return;
  const tip = document.createElement('div');
  tip.className = 'tip-bubble';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let current = null;

  function place(el) {
    current = el;
    const esc = s => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const label = el.textContent.trim().replace(/\s+/g, ' ');
    tip.innerHTML = '<span class="tt">' + esc(label) + '</span> — ' + esc(el.getAttribute('data-tip'));
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight, pad = 10;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
    let top = r.top - th - 10, below = false;
    if (top < 8) { top = r.bottom + 10; below = true; }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.toggle('below', below);
    tip.style.setProperty('--arrow-x', (r.left + r.width / 2 - left) + 'px');
  }
  function hide(el) { if (!el || current === el) { tip.classList.remove('show'); current = null; } }

  terms.forEach(el => {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.addEventListener('mouseenter', () => place(el));
    el.addEventListener('mouseleave', () => hide(el));
    el.addEventListener('focus', () => place(el));
    el.addEventListener('blur', () => hide(el));
    el.addEventListener('click', e => { e.stopPropagation(); current === el ? hide(el) : place(el); });
  });
  window.addEventListener('scroll', () => hide(current), true);
  window.addEventListener('resize', () => hide(current));
  document.addEventListener('click', () => hide(current));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(current); });
}

/* ------------------------------------------------------- scroll-spy nav    */
function scrollSpy() {
  const links = [...document.querySelectorAll('.toc a')];
  const map = new Map();
  links.forEach(a => { const id = a.getAttribute('href').slice(1); const el = document.getElementById(id); if (el) map.set(el, a); });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        const a = map.get(e.target); if (a) a.classList.add('active');
      }
    });
  }, { rootMargin: '-20% 0px -72% 0px', threshold: 0 });
  map.forEach((_a, el) => obs.observe(el));
}

/* ------------------------------------------------------- reading progress  */
function readingProgress() {
  const fill = document.getElementById('progress-fill');
  const pct = document.getElementById('pct');
  const links = [...document.querySelectorAll('.toc a')];
  const modules = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  let ticking = false;
  function update() {
    ticking = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const p = max > 0 ? Math.min(1, doc.scrollTop / max) : 0;
    if (fill) fill.style.width = (p * 100).toFixed(1) + '%';
    if (pct) pct.textContent = Math.round(p * 100) + '%';
    // mark a module "done" once its top has scrolled above 40% of viewport
    const mark = doc.clientHeight * 0.4;
    modules.forEach((el, i) => {
      const top = el.getBoundingClientRect().top;
      if (top < mark) links[i].classList.add('done');
      else links[i].classList.remove('done');
    });
  }
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
}

/* ==========================================================================
   Wire-up
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const heroCanvas = document.getElementById('hero-gfx');
  if (heroCanvas) heroAmbient(heroCanvas);

  const wire = (id, Ctor) => { const el = document.getElementById(id); if (el) Ctor(el); };
  wire('lab-pixel', PixelLab);
  wire('lab-transform', TransformLab);
  wire('lab-raster', RasterLab);
  wire('lab-texfilter', TextureLab);
  wire('lab-light', LightLab);
  wire('lab-zbuffer', ZBufferLab);
  wire('lab-tev', TevLab);
  wire('lab-cmpr', CmprLab);
  wire('lab-ubershader', ShaderLab);

  initTooltips();
  scrollSpy();
  readingProgress();

  /* mobile menu */
  const mb = document.getElementById('menu-btn');
  const sb = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const closeMenu = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
  mb.addEventListener('click', () => { sb.classList.toggle('open'); scrim.classList.toggle('show'); });
  scrim.addEventListener('click', closeMenu);
  sb.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
});

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px"><path d="M8 5v14l11-7z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
